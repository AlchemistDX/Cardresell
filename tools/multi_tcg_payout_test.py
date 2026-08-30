#!/usr/bin/env python3
"""
Multi-TCG Payout Simulated Test — 2026-08-30

For each iconic card across Pokemon, MTG, Yu-Gi-Oh!, Lorcana, One Piece:
  1. Fetch live market price via /api/tcg-price
  2. Compute net payout across all eligible marketplaces (mirroring the
     fee formulas in index.html verbatim), assuming Market price + $5
     buyer-paid shipping + $1.50 seller shipping cost, ungraded.
  3. Sort venues descending by net payout — the exact list the new
     Ranking Strip would show on prod.
  4. Print the top-5 ranking + spread + winner-vs-worst delta so we
     can eyeball whether the ranking makes economic sense.

Pass criteria per card:
  - market price > 0
  - >= 3 eligible venues after game filter
  - winner net > worst net (non-trivial spread)
  - no venue net exceeds price+shipCharge (fees never negative)
"""
import json
import sys
import time
import urllib.parse
import urllib.request

BASE = 'https://www.cardresell.org'

CARDS = [
    {'game': 'pokemon',  'name': 'Charizard',           'set': 'Base Set',                    'number': '4',   'label': 'Pokemon · Base Set Charizard'},
    {'game': 'pokemon',  'name': 'Pikachu VMAX',        'set': 'Vivid Voltage',               'number': '188', 'label': 'Pokemon · Pikachu VMAX Rainbow'},
    {'game': 'mtg',      'name': 'Ragavan, Nimble Pilferer', 'set': 'Modern Horizons 2',     'number': '138', 'label': 'MTG · Ragavan MH2'},
    {'game': 'mtg',      'name': 'Sheoldred, the Apocalypse', 'set': 'Dominaria United',      'number': '107', 'label': 'MTG · Sheoldred DMU'},
    {'game': 'yugioh',   'name': 'Ash Blossom & Joyous Spring', 'set': '',                    'number': '',    'label': 'YGO · Ash Blossom (any print)'},
    {'game': 'lorcana',  'name': 'Elsa - Spirit of Winter', 'set': 'The First Chapter',       'number': '41',  'label': 'Lorcana · Elsa Spirit of Winter'},
    {'game': 'onepiece', 'name': 'Monkey D. Luffy',     'set': 'Romance Dawn',                'number': 'OP01-001', 'label': 'One Piece · Luffy Leader OP01'},
]

# Ship inputs mirror the UI defaults a real user would leave in.
SHIP_CHARGE = 5.0    # buyer-paid shipping (what listing charges)
SELLER_SHIP = 1.50   # actual USPS Ground Advantage cost

# ────────────────────────────────────────────────────────────
# Fee formulas — copied verbatim from index.html PLATFORMS block.
# Kept minimal: ungraded, default eBay store (basic), no promo boost,
# COMC Standard tier + Cash-out=No, Card Kingdom cash ratio.
# ────────────────────────────────────────────────────────────
def fee_ebay(price, ship):
    fvf = (price + ship) * 0.1325
    per_order = 0.30
    return fvf + per_order

def fee_tcgplayer(price):
    return price * 0.1025 + price * 0.025  # 10.25% commission + 2.5% payment

def fee_poshmark(price):
    return 2.95 if price < 15 else price * 0.20

def fee_comc(price):
    return 0.75 + price * 0.05 + 5  # per-card sub + 5% + ship-in

def fee_fanatics(price):
    return price * 0.08  # Buy Now default

def fee_whatnot(price):
    commission = min(price * 0.08, 1500)
    processing = (price + SHIP_CHARGE) * 0.029 + 0.30
    return commission + processing

def fee_mercari(price):
    return price * 0.10 + price * 0.029 + 0.50

def fee_manapool(price):
    return price * 0.05 + price * 0.029 + 0.30

def fee_cardsphere(price):
    return price * 0.03 + max(price * 0.10, 10)  # 3% + 10% cashout ($10 min)

def fee_cardmarket(price):
    # 5% capped at €100 (~$108)
    comm = min(price * 0.05, 108)
    fx = price * 0.03  # USD->EUR withdrawal
    return comm + fx

def fee_buylist(price, ratio):
    # buylist is "you get ratio × price", so fee = (1-ratio) × price
    return price * (1 - ratio)

def fee_cardnexus(price):
    return price * 0.08

VENUES = [
    ('eBay',           'all',     lambda p: fee_ebay(p, SHIP_CHARGE), SELLER_SHIP),
    ('TCGplayer',      'tcg',     fee_tcgplayer,                       0),
    ('Poshmark',       'all',     fee_poshmark,                        SELLER_SHIP),
    ('COMC',           'all',     fee_comc,                            0),
    ('Fanatics',       'all',     fee_fanatics,                        SELLER_SHIP),
    ('Whatnot',        'all',     fee_whatnot,                         SELLER_SHIP),
    ('Mercari',        'all',     fee_mercari,                         SELLER_SHIP),
    ('Mana Pool',      'mtg',     fee_manapool,                        SELLER_SHIP),
    ('Cardsphere',     'mtg',     fee_cardsphere,                      SELLER_SHIP),
    ('Cardmarket',     'tcg',     fee_cardmarket,                      SELLER_SHIP),
    ('Card Kingdom',   'tcg',     lambda p: fee_buylist(p, 0.50),      SELLER_SHIP),
    ('CoolStuffInc',   'tcg',     lambda p: fee_buylist(p, 0.48),      SELLER_SHIP),
    ('Star City Games','tcg',     lambda p: fee_buylist(p, 0.55),      SELLER_SHIP),
    ('CardNexus',      'tcg',     fee_cardnexus,                       SELLER_SHIP),
    ('TCG Bulk',       'tcg',     lambda p: fee_buylist(p, 0.50),      SELLER_SHIP),
]

def get(url, timeout=20):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'CardResell-payout-test/1.0'})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode('utf-8'))
    except Exception as e:
        return {'_error': str(e)}

def eligibility(venue_scope, game):
    is_sports = game == 'sports'
    is_mtg = game == 'mtg'
    if venue_scope == 'all':
        return True
    if venue_scope == 'tcg':
        return not is_sports
    if venue_scope == 'mtg':
        return is_mtg
    return False

def extract_market_price(tcg_response, card):
    """tcg-price returns a flat { market, low, mid, high, ... } object."""
    if '_error' in tcg_response:
        return None, tcg_response['_error']
    mp = tcg_response.get('market') or tcg_response.get('marketPrice')
    if mp:
        note = ''
        if tcg_response.get('highClamped'):
            note = f" (high clamped from ${tcg_response.get('highRaw')} → ${tcg_response.get('high')})"
        return float(mp), note or None
    return None, f'no market price; keys={list(tcg_response.keys())[:8]}'

def test_card(c):
    q = {'name': c['name'], 'set': c['set'], 'number': c['number'], 'game': c['game']}
    qs = urllib.parse.urlencode({k: v for k, v in q.items() if v})
    tcg = get(f'{BASE}/api/tcg-price?{qs}')

    price, err = extract_market_price(tcg, c)
    if price is None or price <= 0:
        return {'card': c, 'status': 'FAIL_PRICE', 'error': err, 'raw_keys': list(tcg.keys())[:6]}

    # Compute payouts across every venue
    ranked = []
    for name, scope, fee_fn, seller_ship in VENUES:
        if not eligibility(scope, c['game']):
            continue
        fee = fee_fn(price)
        net = price + SHIP_CHARGE - fee - seller_ship
        ranked.append({'venue': name, 'fee': round(fee, 2), 'net': round(net, 2)})
    ranked.sort(key=lambda r: r['net'], reverse=True)

    if len(ranked) < 3:
        return {'card': c, 'status': 'FAIL_ELIGIBLE_LT_3', 'price': price, 'ranked': ranked}

    winner = ranked[0]
    worst = ranked[-1]
    if winner['net'] <= worst['net']:
        return {'card': c, 'status': 'FAIL_NO_SPREAD', 'price': price, 'ranked': ranked}

    # Sanity: no venue net can exceed price+ship (would mean negative fees)
    max_possible = price + SHIP_CHARGE
    if any(r['net'] > max_possible + 0.01 for r in ranked):
        return {'card': c, 'status': 'FAIL_NEGATIVE_FEE', 'price': price, 'ranked': ranked, 'max_possible': max_possible}

    return {
        'card': c,
        'status': 'PASS',
        'price': round(price, 2),
        'top5': ranked[:5],
        'winner_net': winner['net'],
        'worst_net': worst['net'],
        'spread_pct': round((winner['net'] - worst['net']) / winner['net'] * 100, 1) if winner['net'] > 0 else 0,
        'eligible_count': len(ranked),
    }

def main():
    results = []
    for c in CARDS:
        print(f"\n─── {c['label']} ───", flush=True)
        r = test_card(c)
        results.append(r)
        if r['status'] == 'PASS':
            print(f"  ✓ Market: ${r['price']}  |  {r['eligible_count']} eligible venues  |  spread {r['spread_pct']}%")
            for i, v in enumerate(r['top5'], 1):
                print(f"    #{i} {v['venue']:18} net ${v['net']:>8.2f}  (fees ${v['fee']:>7.2f})")
            print(f"    ↳ Winner keeps ${round(r['winner_net'] - r['worst_net'], 2)} more than worst venue")
        else:
            print(f"  ✗ {r['status']}: {r.get('error', r.get('ranked', ''))}")
        time.sleep(0.4)

    passing = sum(1 for r in results if r['status'] == 'PASS')
    print(f"\n{'═' * 60}")
    print(f"RESULT: {passing}/{len(results)} cards passed")
    print(f"{'═' * 60}")

    # Emit machine-parsable report line
    report = {
        'passing': passing,
        'total': len(results),
        'results': [
            {'label': r['card']['label'], 'status': r['status'],
             'price': r.get('price'), 'top5': r.get('top5', []),
             'error': r.get('error')}
            for r in results
        ]
    }
    print("\n__PAYOUT_TEST_REPORT__", json.dumps(report, separators=(',', ':')))
    return 0 if passing == len(results) else 1

if __name__ == '__main__':
    sys.exit(main())
