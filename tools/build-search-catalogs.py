#!/usr/bin/env python3
"""Build reviewed, identity-only search snapshots. Never publishes or changes prices.

Usage: --cache /path/to/cache/YYYY-MM-DD --as-of YYYY-MM-DD
Cached source bodies are immutable for a run. Use a new cache directory for a
fresh run. Every group must complete before the manifest is replaced. TCGCSV is
read at most once per daily snapshot; no user-facing request downloads it.
"""
from __future__ import annotations
import argparse, concurrent.futures, datetime, hashlib, json, os, pathlib, threading, time, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[1]
UA = 'CardResell-Catalog/1.0 (+https://www.cardresell.org)'
class Sources:
    def __init__(self, cache):
        self.cache = cache; cache.mkdir(parents=True, exist_ok=True)
        self.proof = {}; self.lock = threading.Lock(); self.last_tcg = 0
    def get(self, name, url):
        path = self.cache / (name + '.json')
        if not path.exists():
            if 'tcgcsv.com' in url:
                with self.lock:
                    time.sleep(max(0, .15 - (time.monotonic() - self.last_tcg)))
                    self.last_tcg = time.monotonic()
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'}), timeout=25) as r:
                raw = r.read(32_000_001)
            if len(raw) > 32_000_000: raise ValueError('Source too large: ' + name)
            json.loads(raw)  # Never cache an HTML error page.
            tmp = path.with_suffix('.tmp'); tmp.write_bytes(raw); tmp.replace(path)
        raw = path.read_bytes(); data = json.loads(raw)
        self.proof[name] = {'url': url, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
        return data

def envelope(data):
    if not isinstance(data, dict) or data.get('success') is not True or data.get('errors') or not isinstance(data.get('results'), list): raise ValueError('Invalid TCGCSV envelope')
    rows = data['results']
    if data.get('totalItems') != len(rows) and not (data.get('totalItems') is None and rows == []): raise ValueError('Truncated TCGCSV response')
    return rows

def unique(rows, key):
    ids = [str(r[key]) for r in rows]
    if len(ids) != len(set(ids)): raise ValueError('Duplicate provider IDs: ' + key)

def tcg_catalog(src, category, game, language):
    key = 'onepiece-groups' if category == 68 else f'tcgcsv-{category}-groups'
    groups = envelope(src.get(key, f'https://tcgcsv.com/tcgplayer/{category}/groups'))
    if not groups: raise ValueError('Empty groups: ' + game)
    unique(groups, 'groupId'); sets = {}; cards = []; excluded = []; counts = {}
    def fetch_group(g):
        gid = g['groupId']
        if g.get('categoryId') != category: raise ValueError('Wrong category')
        data = src.get(f'tcgcsv-{category}-{gid}-products', f'https://tcgcsv.com/tcgplayer/{category}/{gid}/products')
        rows = envelope(data); unique(rows, 'productId'); return g, rows
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for idx, (g, rows) in enumerate(pool.map(fetch_group, groups)):
            gid = str(g['groupId']); sets[gid] = g['name']; counts[gid] = len(rows)
            for c in rows:
                if c.get('categoryId') != category or str(c.get('groupId')) != gid: raise ValueError('Product escaped its category/group')
                fields = {str(x.get('name','')).lower(): str(x.get('value','')).strip() for x in c.get('extendedData', [])}
                number = fields.get('number', '')
                if number.lower() in ['none','n/a','na','null','-']: number = ''
                # No sealed products/accessories in a physical-single card search.
                identity_values = [number, fields.get('rarity'), fields.get('cardtype'), fields.get('hp'), fields.get('inkcost')]
                if not any(str(v or '').lower() not in ['', 'none', 'n/a', 'na', 'null', '-'] for v in identity_values):
                    excluded.append({'id': c['productId'], 'reason': 'no single-card identity fields'}); continue
                name = str(c.get('name','')).strip()
                if not name: raise ValueError('Unnamed product')
                cards.append([str(c['productId']), name, gid, number, fields.get('rarity',''), (c.get('imageUrl') or '') if c.get('imageCount',0) > 0 else '', language, (c.get('presaleInfo') or {}).get('releasedOn') or '', bool((c.get('presaleInfo') or {}).get('isPresale'))])
            if (idx + 1) % 25 == 0: print(f'{game}: {idx+1}/{len(groups)} groups checked', flush=True)
    return {'provider': 'TCGCSV / TCGplayer', 'sets': sets, 'cards': cards}, {
        'provider_groups': len(groups), 'groups_checked': len(counts), 'product_count': sum(counts.values()),
        'group_product_counts': counts, 'empty_groups': [gid for gid,n in counts.items() if not n], 'excluded': excluded,
        'scope': 'All published provider groups; products with single-card identity fields only. Includes announced products. Not a certification of every regional printing.'}

def pokemonjp_catalog(src):
    data, coverage = tcg_catalog(src,85,'pokemonjp','ja')
    native = src.get('pokemonjp-cards','https://api.tcgdex.net/v2/ja/cards')
    sets = src.get('pokemonjp-sets','https://api.tcgdex.net/v2/ja/sets')
    unique(native,'id'); unique(sets,'id'); sm={s['id']:s for s in sets}
    data['nativeCards']=[]
    for c in native:
        sid=c['id'].rsplit('-',1)[0]
        if sid not in sm: raise ValueError('Unknown Japanese set')
        image=c.get('image',''); key='tcgdex:'+sid; data['sets'][key]=sm[sid]['name']
        data['nativeCards'].append(['tcgdex:'+c['id'],c['name'],key,c['localId'],'',image+'/low.webp' if image else '', 'ja'])
    coverage['supplemental_native_records']=len(native)
    coverage['native_scope']='Separate Japanese-name TCGdex lookup; may overlap TCGplayer identities, so not added to the physical-product count.'
    return data, coverage

def pokemon_catalog(src):
    sets = src.get('pokemon-tcgdex-sets','https://api.tcgdex.net/v2/en/sets')
    cards = src.get('pokemon-cards','https://api.tcgdex.net/v2/en/cards')
    series = src.get('pokemon-pocket-series','https://api.tcgdex.net/v2/en/series/tcgp')
    pocket = {s['id'] for s in series['sets']}
    if not pocket: raise ValueError('Pocket exclusion unavailable')
    unique(sets,'id'); unique(cards,'id'); sm = {s['id']:s for s in sets}; counts = {}; out = []
    for c in cards:
        sid = c['id'].rsplit('-',1)[0]
        if sid not in sm: raise ValueError('Unknown Pokemon set: '+sid)
        counts[sid] = counts.get(sid,0)+1
        if sid in pocket: continue
        image = c.get('image','')
        out.append([c['id'], c['name'], sid, c['localId'], '', image + '/low.webp' if image else '', 'en'])
    gaps = [{'id':s['id'],'name':s['name'],'declared':s['cardCount']['total'],'returned':counts.get(s['id'],0)} for s in sets if s['id'] not in pocket and s['cardCount']['total'] != counts.get(s['id'],0)]
    return {'provider':'TCGdex','sets':{s['id']:s['name'] for s in sets if s['id'] not in pocket},'cards':out}, {
        'provider_cards':len(cards),'excluded_pocket_cards':sum(counts.get(s,0) for s in pocket),'excluded_pocket_sets':sorted(pocket),'set_count_mismatches':gaps,
        'scope':'All returned English physical-card identities. Provider-declared gaps remain explicit; no inferred cards, finishes or prices.'}

def yugioh_catalog(src):
    cards = src.get('yugioh-cards','https://db.ygoprodeck.com/api/v7/cardinfo.php')['data']
    if not cards: raise ValueError('Empty Yu-Gi-Oh! catalog')
    unique(cards,'id'); sets = {}; out = []; seen = set(); identity_only = 0; duplicates = 0; excluded = []
    for c in cards:
        if c['name'] == '???': excluded.append(str(c['id'])); continue
        prints = c.get('card_sets') or [{}]
        for p in prints:
            sid = p.get('set_name',''); number = p.get('set_code',''); rarity = p.get('set_rarity','')
            key = '|'.join([str(c['id']),sid,number,rarity])
            if key in seen: duplicates += 1; continue
            seen.add(key); sets[sid] = sid
            # Card-level art/price is NOT an exact-printing reference.
            out.append([key,c['name'],sid,number,rarity,'','en'])
            if not number: identity_only += 1
    return {'provider':'YGOProDeck','sets':sets,'cards':out}, {'provider_card_identities':len(cards),'identity_only_records':identity_only,'duplicate_printing_rows_collapsed':duplicates,'excluded_placeholders':excluded,
        'scope':'All returned identities and set-code/rarity printings. Editions, alternative art and languages are not exhaustively mapped; no card-wide price or artwork assigned to a printing.'}

def tcg_stamp():
    with urllib.request.urlopen(urllib.request.Request('https://tcgcsv.com/last-updated.txt', headers={'User-Agent':UA}), timeout=20) as r:
        stamp=r.read(200).decode().strip()
    datetime.datetime.strptime(stamp,'%Y-%m-%dT%H:%M:%S%z')
    return stamp

def encode(data): return json.dumps(data,ensure_ascii=False,separators=(',',':')).encode()
def build(cache, as_of, output, allow_removals=False):
    datetime.date.fromisoformat(as_of); cache.mkdir(parents=True,exist_ok=True)
    marker = cache/'snapshot-date.txt'
    if marker.exists() and marker.read_text() != as_of: raise ValueError('Use a new cache directory for a fresh snapshot')
    marker.write_text(as_of)
    stamp=tcg_stamp(); stamp_file=cache/'tcg-snapshot.txt'
    if stamp_file.exists() and stamp_file.read_text() != stamp: raise ValueError('TCGCSV snapshot changed; start with a fresh cache')
    stamp_file.write_text(stamp)
    src = Sources(cache); staged = {}; report = {'as_of':as_of,'games':{}}; manifest = {'schema':1,'asOf':as_of,'games':{}}
    for game, loader in [('onepiece',lambda:tcg_catalog(src,68,'onepiece','en')),('lorcana',lambda:tcg_catalog(src,71,'lorcana','en')),('pokemonjp',lambda:pokemonjp_catalog(src)),('pokemon',lambda:pokemon_catalog(src)),('yugioh',lambda:yugioh_catalog(src))]:
        data, coverage = loader(); rows = data['cards']
        previous_manifest = output/'current.json'
        if previous_manifest.exists():
            previous = json.loads(previous_manifest.read_text()).get('games',{}).get(game)
            if previous:
                old = json.loads((output/pathlib.Path(previous['url']).name).read_text())
                old_ids = {c[0] for c in old['cards'] + old.get('nativeCards',[])}
                new_ids = {c[0] for c in rows + data.get('nativeCards',[])}
                removed = sorted(old_ids - new_ids)
                if removed and not allow_removals:
                    raise ValueError(f'{game}: {len(removed)} prior identities disappeared; review source changes before using --allow-removals')
                coverage['reviewed_removed_ids'] = removed
        if not rows or len({c[0] for c in rows}) != len(rows): raise ValueError('Empty/duplicate final IDs: '+game)
        data.update(schema=1,game=game,asOf=as_of)
        data['cards'].sort(key=lambda c:c[0])
        raw = encode(data); digest = hashlib.sha256(raw).hexdigest(); name = f'{game}.{digest[:12]}.json'; staged[name] = raw
        manifest['games'][game] = {'url':'/data/catalog/'+name,'count':len(rows),'provider':data['provider'],'sets':len(data['sets']),'nativeCount':len(data.get('nativeCards',[]))}
        report['games'][game] = dict(coverage, searchable_records=len(rows),represented_sets=len({c[2] for c in rows}),asset_sha256=digest,missing_images=sum(not c[5] for c in rows))
        print(game,len(rows),'records',flush=True)
    if tcg_stamp() != stamp: raise ValueError('TCGCSV changed during import; manifest not published')
    report['tcgcsv_updated_at'] = stamp
    report['sources'] = dict(sorted(src.proof.items()))
    # Stage all immutable bodies first; replace manifest last. A failed build
    # cannot expose an empty or half-imported catalog to the client.
    output.mkdir(parents=True,exist_ok=True)
    for name, raw in staged.items(): (output/name).write_bytes(raw)
    (output/'coverage.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    raw = encode(manifest); name = 'manifest.'+hashlib.sha256(raw).hexdigest()[:12]+'.json'
    (output/name).write_bytes(raw)
    (output/'current.json.tmp').write_bytes(raw); (output/'current.json.tmp').replace(output/'current.json')
    print('Manifest:',name,flush=True)
if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--cache',type=pathlib.Path,required=True);parser.add_argument('--as-of',required=True);parser.add_argument('--allow-removals',action='store_true',help='Use only after reviewing disappeared provider IDs; all removed IDs are recorded');parser.add_argument('--output',type=pathlib.Path,default=ROOT/'data/catalog');a=parser.parse_args();build(a.cache,a.as_of,a.output,a.allow_removals)
