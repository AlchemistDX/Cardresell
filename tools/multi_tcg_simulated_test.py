#!/usr/bin/env python3
"""
Multi-TCG Simulated Test — one iconic card per supported game.

Simulates the client scan flow for each card:
  1. GET /api/tcg-price  (raw market + range)
  2. GET /api/pricecharting  (graded ladder)
  3. GET /api/ebay-sold  (secondary raw comp)

Then reports the merged view the user would see on cardresell.org, plus
sanity checks:
  - Market price present and > 0
  - Range not absurd (High <= 3x Market  ← the fix we just shipped)
  - PriceCharting graded ladder has PSA 10
  - No pricecharting-error state
"""
import json
import sys
import time
import urllib.parse
import urllib.request

BASE = 'https://www.cardresell.org'

# One iconic card per supported game, chosen for high grading interest
CARDS = [
    # Pokemon
    {'game': 'pokemon',  'name': 'Charizard',           'set': 'Base Set',                   'number': '4',   'label': 'Pokemon — Base Set Charizard'},
    {'game': 'pokemon',  'name': 'Mew',                 'set': 'Crown Zenith Galarian Gallery','number': 'GG10','label': 'Pokemon — Mew GG10 Crown Zenith'},
    # MTG
    {'game': 'mtg',      'name': 'Black Lotus',         'set': 'Alpha',                      'number': '',    'label': 'MTG — Alpha Black Lotus'},
    {'game': 'mtg',      'name': 'Ragavan, Nimble Pilferer', 'set': 'Modern Horizons 2',    'number': '138', 'label': 'MTG — Ragavan MH2'},
    # Yu-Gi-Oh
    {'game': 'yugioh',   'name': 'Blue-Eyes White Dragon', 'set': 'Legend of Blue Eyes White Dragon', 'number': 'LOB-001', 'label': 'YGO — Blue-Eyes LOB'},
    {'game': 'yugioh',   'name': 'Dark Magician',       'set': 'Legend of Blue Eyes White Dragon',   'number': 'LOB-005', 'label': 'YGO — Dark Magician LOB'},
    # Lorcana
    {'game': 'lorcana',  'name': 'Mickey Mouse',        'set': 'The First Chapter',          'number': '204', 'label': 'Lorcana — Mickey Mouse Brave Little Tailor'},
    # One Piece TCG
    {'game': 'onepiece', 'name': 'Monkey D. Luffy',     'set': 'Romance Dawn',               'number': 'OP01-001', 'label': 'One Piece — Luffy Leader'},
]

def get(url, timeout=15):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'CardResell-multitcg-test'})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode('utf-8'))
    except Exception as e:
        return {'_error': str(e)}

def test_card(c):
    q = {'name': c['name'], 'set': c['set'], 'number': c['number'], 'game': c['game']}
    qs = urllib.parse.urlencode({k: v for k, v in q.items() if v})

    tcg = get(f'{BASE}/api/tcg-price?{qs}')
    time.sleep(0.3)
    pc  = get(f'{BASE}/api/pricecharting?{qs}')
    time.sleep(0.3)
    ebay = get(f'{BASE}/api/ebay-sold?{qs}')

    return {'card': c, 'tcg': tcg, 'pc': pc, 'ebay': ebay}

def evaluate(res):
    c    = res['card']
    tcg  = res['tcg']  or {}
    pc   = res['pc']   or {}
    ebay = res['ebay'] or {}

    flags = []
    # TCG market
    market = tcg.get('market')
    if not market or market <= 0:
        flags.append(f'TCG: no market (source={tcg.get("source")!r})')
    # High clamp check — the fix we just shipped
    high = tcg.get('high')
    if market and high and high > market * 3.01:
        flags.append(f'TCG: high not clamped ({high:.0f} > 3x market {market:.0f})')
    if tcg.get('highClamped'):
        # This is expected on cards where TCG returned a sniper — annotate not fail
        pass
    # PriceCharting graded
    src = pc.get('source')
    prices = pc.get('prices') or {}
    psa10 = prices.get('psa_10')
    raw = prices.get('raw')
    if src == 'pricecharting-error':
        flags.append('PC: pricecharting-error (upstream failure)')
    elif src == 'pricecharting' and not psa10 and raw and raw >= 10:
        # Missing PSA 10 for a $10+ card is a data-completeness concern
        flags.append(f'PC: no PSA 10 (raw=${raw:.2f})')
    return flags

def fmt_price(x):
    return f'${x:.2f}' if isinstance(x, (int, float)) and x > 0 else '—'

def main():
    print(f'Multi-TCG simulated test — {len(CARDS)} cards\n')
    results = []
    for c in CARDS:
        print(f'▸ {c["label"]}')
        r = test_card(c)
        r['flags'] = evaluate(r)
        results.append(r)
        tcg = r['tcg'] or {}
        pc  = r['pc']  or {}
        prices = pc.get('prices') or {}
        print(f"  TCG:  market={fmt_price(tcg.get('market'))}  "
              f"range={fmt_price(tcg.get('low'))}–{fmt_price(tcg.get('high'))}"
              f"  {'[CLAMPED]' if tcg.get('highClamped') else ''}")
        print(f"  PC:   raw={fmt_price(prices.get('raw'))}  "
              f"PSA9={fmt_price(prices.get('grade_9'))}  "
              f"PSA10={fmt_price(prices.get('psa_10'))}"
              f"  source={pc.get('source')}")
        if r['flags']:
            for f in r['flags']:
                print(f'  ⚠ {f}')
        print()

    # Summary
    total = len(results)
    passed = sum(1 for r in results if not r['flags'])
    print(f'\n=== SUMMARY: {passed}/{total} cards passed ===')
    if passed < total:
        print('Failures:')
        for r in results:
            if r['flags']:
                print(f"  {r['card']['label']}: {r['flags']}")

if __name__ == '__main__':
    main()
