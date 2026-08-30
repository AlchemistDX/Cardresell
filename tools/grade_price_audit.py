#!/usr/bin/env python3
"""
Grade Price Audit — verify /api/pricecharting returns real graded prices
for a stratified sample of the 20,506-card index.

Strategy: sample cards weighted toward the ones users will actually check
graded prices on (holos, ultra rares, secret rares, chase-tier stuff) —
NOT random commons, because a random sample would be 90% $2 cards where
graded pricing doesn't matter.

For each card:
  1. Hit /api/pricecharting?name=&set=&number=&game=pokemon
  2. Record match status, raw price, and each graded tier
  3. Flag sanity failures:
       - no PC product match
       - PSA 10 missing when raw >= $10
       - PSA 10 < raw (impossible — grading always adds premium)
       - PSA 10 > 200x raw (data glitch — real ratio is 5-50x for chase)

Output: writes JSONL to workspace + prints a summary + writes markdown report.
"""
import json
import os
import random
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

INDEX_PATH = Path('/home/user/workspace/cardresell/card-index.json')
OUT_JSONL  = Path('/home/user/workspace/grade_price_audit_results.jsonl')
OUT_MD     = Path('/home/user/workspace/grade_price_audit_report.md')

API_URL = 'https://www.cardresell.org/api/pricecharting'
TIMEOUT_S = 15
CONCURRENCY = 4      # be polite — 4 in flight at a time
DELAY_MS = 250        # extra jitter between requests

# Sample size — configurable via CLI arg
SAMPLE_SIZE = int(sys.argv[1]) if len(sys.argv) > 1 else 300

random.seed(20260830)  # reproducible sample

# ── Card selection ────────────────────────────────────────────────────────
def load_index():
    with INDEX_PATH.open() as f:
        return json.load(f)

# Rarity buckets ordered by how much graded pricing matters
CHASE_RARITY = re.compile(
    r'(special illustration|ultra rare|illustration rare|hyper rare|secret rare|'
    r'rainbow rare|gold rare|full art|alt art|shiny rare|prism)',
    re.I,
)
HOLO_RARITY = re.compile(r'(holo|holofoil)', re.I)

# Modern chase sets — hot right now, users will scan a lot of these
MODERN_SETS = {
    'Crown Zenith', 'Crown Zenith Galarian Gallery',
    'Scarlet & Violet 151', 'Scarlet & Violet—151',
    'Paldean Fates', 'Paradox Rift', 'Obsidian Flames',
    'Surging Sparks', 'Prismatic Evolutions',
    'Twilight Masquerade', 'Stellar Crown',
    'Journey Together',
    'Temporal Forces', 'Shrouded Fable',
}
# Iconic older sets that always have graded comps
CLASSIC_SETS = {
    'Base Set', 'Base', 'Jungle', 'Fossil',
    'Neo Genesis', 'Neo Discovery', 'Neo Destiny', 'Neo Revelation',
    'Base Set 2', 'Team Rocket',
    'Expedition Base Set', 'Aquapolis', 'Skyridge',
    'EX Ruby & Sapphire', 'EX Dragon Frontiers',
    'Hidden Fates', 'Shining Fates', 'Celebrations',
    'Evolving Skies', 'Lost Origin', 'Silver Tempest',
}

def stratified_sample(cards, target_n):
    """Pick cards weighted toward what users actually check graded prices on."""
    by_bucket = {
        'modern_chase':  [],  # modern set + chase rarity
        'modern_holo':   [],  # modern set + holo
        'classic_chase': [],  # classic set + chase rarity
        'classic_holo':  [],  # classic set + holo
        'random_rare':   [],  # any rarity anywhere
    }
    for c in cards:
        s = c.get('s') or ''
        r = c.get('r') or ''
        is_modern  = any(m in s for m in MODERN_SETS)
        is_classic = any(m in s for m in CLASSIC_SETS)
        is_chase   = bool(CHASE_RARITY.search(r))
        is_holo    = bool(HOLO_RARITY.search(r))
        if is_modern and is_chase: by_bucket['modern_chase'].append(c)
        elif is_modern and is_holo: by_bucket['modern_holo'].append(c)
        elif is_classic and is_chase: by_bucket['classic_chase'].append(c)
        elif is_classic and is_holo: by_bucket['classic_holo'].append(c)
        elif is_chase or is_holo: by_bucket['random_rare'].append(c)
    # Target quotas per bucket
    quotas = {
        'modern_chase':  int(target_n * 0.30),
        'modern_holo':   int(target_n * 0.20),
        'classic_chase': int(target_n * 0.20),
        'classic_holo':  int(target_n * 0.15),
        'random_rare':   int(target_n * 0.15),
    }
    picked = []
    picked_ids = set()
    for bucket, quota in quotas.items():
        pool = by_bucket[bucket]
        take = min(quota, len(pool))
        for c in random.sample(pool, take):
            if c['id'] not in picked_ids:
                c = dict(c); c['_bucket'] = bucket
                picked.append(c); picked_ids.add(c['id'])
    # Pad up to target_n from random_rare if quotas underfilled
    if len(picked) < target_n:
        extra_pool = [c for c in by_bucket['random_rare'] if c['id'] not in picked_ids]
        for c in random.sample(extra_pool, min(target_n - len(picked), len(extra_pool))):
            c = dict(c); c['_bucket'] = 'random_rare_pad'
            picked.append(c); picked_ids.add(c['id'])
    return picked

# ── PriceCharting client ──────────────────────────────────────────────────
def fetch_pc(card):
    params = {
        'name':   card['n'],
        'set':    card['s'],
        'number': card['nu'],
        'game':   card.get('g') or 'pokemon',
    }
    q = urllib.parse.urlencode(params)
    url = f'{API_URL}?{q}'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'CardResell/audit'})
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            return json.loads(r.read().decode('utf-8'))
    except Exception as e:
        return {'_error': str(e)}

# ── Sanity checks ─────────────────────────────────────────────────────────
def evaluate(card, pc):
    """Return (status, flags[]) for this card's PC response."""
    flags = []
    if '_error' in pc:
        return 'network_error', [pc['_error'][:80]]
    src = pc.get('source')
    if src == 'unconfigured':
        return 'pc_unconfigured', ['server missing PRICECHARTING_API_TOKEN']
    if src != 'pricecharting':
        return 'no_match', [f'source={src!r}']
    prices = pc.get('prices') or {}
    raw    = prices.get('raw')
    psa10  = prices.get('psa_10')
    psa9   = prices.get('grade_9')
    psa8   = prices.get('grade_8')
    if not any([raw, psa10, psa9, psa8]):
        return 'match_no_prices', []
    # PSA 10 is the key one for grading-decision UX
    if psa10 is None:
        # Only flag if raw exists and is meaningful — no PSA 10 comps for a
        # $3 common is fine, that's just PriceCharting not tracking it
        if raw and raw >= 10:
            flags.append(f'psa10_missing (raw=${raw:.2f})')
    else:
        if raw:
            ratio = psa10 / raw
            if psa10 < raw:
                flags.append(f'psa10_below_raw (psa10=${psa10:.2f} raw=${raw:.2f})')
            elif ratio > 200:
                flags.append(f'psa10_ratio_too_high ({ratio:.0f}x)')
        # PSA 10 < PSA 9 is another red flag
        if psa9 and psa10 < psa9:
            flags.append(f'psa10_below_psa9 (psa10=${psa10:.2f} psa9=${psa9:.2f})')
    status = 'ok' if not flags else 'sanity_fail'
    return status, flags

# ── Runner ────────────────────────────────────────────────────────────────
def worker(card):
    time.sleep(random.uniform(DELAY_MS / 1000, (DELAY_MS + 100) / 1000))
    pc = fetch_pc(card)
    status, flags = evaluate(card, pc)
    return {
        'id':     card['id'],
        'name':   card['n'],
        'set':    card['s'],
        'number': card['nu'],
        'bucket': card.get('_bucket'),
        'status': status,
        'flags':  flags,
        'raw':    (pc.get('prices') or {}).get('raw'),
        'psa10':  (pc.get('prices') or {}).get('psa_10'),
        'psa9':   (pc.get('prices') or {}).get('grade_9'),
        'psa8':   (pc.get('prices') or {}).get('grade_8'),
        'source': pc.get('source'),
        'matched_name': pc.get('productName'),
    }

def main():
    cards = load_index()
    print(f'[audit] index loaded — {len(cards)} cards', flush=True)
    sample = stratified_sample(cards, SAMPLE_SIZE)
    print(f'[audit] sampled {len(sample)} cards across buckets', flush=True)
    for b in sorted(set(c['_bucket'] for c in sample)):
        n = sum(1 for c in sample if c['_bucket'] == b)
        print(f'  {b:20s}  {n}', flush=True)

    results = []
    OUT_JSONL.write_text('')  # truncate
    done = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex, \
         OUT_JSONL.open('a') as jl:
        futures = {ex.submit(worker, c): c for c in sample}
        for fut in as_completed(futures):
            r = fut.result()
            results.append(r)
            jl.write(json.dumps(r) + '\n')
            jl.flush()
            done += 1
            if done % 25 == 0:
                elapsed = time.time() - t0
                print(f'  [{done}/{len(sample)}] {elapsed:.0f}s elapsed', flush=True)

    print(f'[audit] complete in {time.time()-t0:.1f}s', flush=True)

    # ── Summary ────────────────────────────────────────────────────────
    by_status = {}
    by_bucket_status = {}
    fails = []
    for r in results:
        by_status.setdefault(r['status'], 0)
        by_status[r['status']] += 1
        k = (r['bucket'], r['status'])
        by_bucket_status.setdefault(k, 0); by_bucket_status[k] += 1
        if r['status'] in ('no_match', 'sanity_fail', 'match_no_prices', 'network_error', 'pc_unconfigured'):
            fails.append(r)

    print('\n=== STATUS SUMMARY ===')
    for st, n in sorted(by_status.items(), key=lambda x: -x[1]):
        pct = n * 100 / len(results)
        print(f'  {st:20s}  {n:4d}  ({pct:5.1f}%)')

    # ── Markdown report ────────────────────────────────────────────────
    md = []
    md.append(f'# Grade Price Audit — {time.strftime("%Y-%m-%d %H:%M")} UTC')
    md.append('')
    md.append(f'Sample size: **{len(results)}** cards across 5 rarity/era buckets.')
    md.append(f'Endpoint: `{API_URL}`')
    md.append('')
    md.append('## Status breakdown')
    md.append('')
    md.append('| Status | Count | % |')
    md.append('|---|---:|---:|')
    for st, n in sorted(by_status.items(), key=lambda x: -x[1]):
        pct = n * 100 / len(results)
        md.append(f'| `{st}` | {n} | {pct:.1f}% |')
    md.append('')

    md.append('## Match rate by bucket')
    md.append('')
    md.append('| Bucket | Total | OK | Fails |')
    md.append('|---|---:|---:|---:|')
    buckets = sorted(set(r['bucket'] for r in results))
    for b in buckets:
        rows = [r for r in results if r['bucket'] == b]
        ok   = sum(1 for r in rows if r['status'] == 'ok')
        fail = len(rows) - ok
        md.append(f'| `{b}` | {len(rows)} | {ok} ({ok*100/len(rows):.0f}%) | {fail} |')
    md.append('')

    md.append(f'## Failures ({len(fails)})')
    md.append('')
    if not fails:
        md.append('_None._')
    else:
        md.append('| Card | Set | # | Bucket | Status | Flags |')
        md.append('|---|---|---|---|---|---|')
        for r in fails[:200]:
            flags = '; '.join(r['flags']) if r['flags'] else ''
            md.append(f"| {r['name']} | {r['set']} | {r['number']} | {r['bucket']} | `{r['status']}` | {flags} |")
        if len(fails) > 200:
            md.append(f'\n_… {len(fails)-200} more not shown; see JSONL for full data._')
    md.append('')

    md.append('## Sample OK rows (verify accurate)')
    md.append('')
    md.append('| Card | Set | # | Raw | PSA 8 | PSA 9 | PSA 10 |')
    md.append('|---|---|---|---:|---:|---:|---:|')
    ok_rows = [r for r in results if r['status'] == 'ok' and r['psa10']]
    ok_rows.sort(key=lambda r: -(r['psa10'] or 0))
    for r in ok_rows[:25]:
        def fmt(x): return f"${x:.2f}" if x else '—'
        md.append(f"| {r['name']} | {r['set']} | {r['number']} | {fmt(r['raw'])} | {fmt(r['psa8'])} | {fmt(r['psa9'])} | {fmt(r['psa10'])} |")
    md.append('')

    OUT_MD.write_text('\n'.join(md))
    print(f'\n[audit] report → {OUT_MD}')
    print(f'[audit] jsonl  → {OUT_JSONL}')

if __name__ == '__main__':
    main()
