// Fee-truth regression test — CR-005 / CR-006 (2026-09-01)
//
// Expected values below are hand-computed from each venue's PUBLISHED fee
// schedule, NOT read back out of the app. That is deliberate: the previous
// harness (qa/fee_audit_2026-08-29.js) compared the code against expectations
// derived from the same code, so it could never catch a wrong rate.
//
// Verified Sep 1, 2026:
//   TCGplayer  10.75% commission (cap $75/item) + 2.5% + $0.30, both charged on
//              item + shipping. Level 1-4 seller ships to the buyer themselves.
//              https://seller.tcgplayer.com/blog/important-changes-to-tcgplayer-direct-minimum-pricing-and-marketplace-fees
//   Mercari    Flat 10% selling fee on item + buyer-paid shipping. No seller
//              processing fee since Jan 6, 2025.
//              https://www.mercari.com/us/help_center/article/2518/
//   Fanatics   Buy Now 6% under 120% of Card Ladder market value (12% at/above),
//              ship-in to vault required -> $5 modeled inbound, no ship-to-buyer.
//              https://support.fanaticscollect.com/en_us/buy-now-fees-ry33QCXaxe
//
// Run: node tests/fee-truth-offline.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

/** Pull a top-level `function name(...) { ... }` out of index.html by brace matching. */
function extractFn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`could not find function ${name} in index.html`);
  let depth = 0, i = src.indexOf('{', start);
  const open = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  const body = src.slice(open + 1, i);
  const sig = src.slice(src.indexOf('(', start) + 1, src.indexOf(')', start));
  return new Function(...sig.split(',').map(s => s.trim()).filter(Boolean), body);
}

const feeTCGPlayer = extractFn('feeTCGPlayer');
const feeMercari   = extractFn('feeMercari');
const feeFanatics  = extractFn('feeFanatics');

const sum = items => items.reduce((s, f) => s + f.a, 0);
const round = n => Math.round(n * 1e6) / 1e6;

let failures = 0;
function eq(label, actual, expected) {
  const ok = round(actual) === round(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  actual=${round(actual)} expected=${round(expected)}`);
}
function assert(label, cond) {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
}

// ── Scenario A: $100 card, buyer pays $5 shipping, seller postage $1.50 ──
const price = 100, shipCharge = 5, shipCost = 1.50;

// TCGplayer: fees bill on 105. 105*0.1075 = 11.2875 ; 105*0.025 + 0.30 = 2.925
eq('TCGplayer fees on item+shipping', sum(feeTCGPlayer(price, shipCharge)), 11.2875 + 2.925);
// Net = 100 + 5 - 14.2125 - 1.50 (seller ships themselves)
eq('TCGplayer net payout (self-ship)',
   price + shipCharge - sum(feeTCGPlayer(price, shipCharge)) - shipCost,
   89.2875);

// Mercari: 10% of 105 = 10.50, no processing fee
eq('Mercari selling fee on item+shipping', sum(feeMercari(price, shipCharge)), 10.50);
assert('Mercari charges exactly one fee line', feeMercari(price, shipCharge).length === 1);
eq('Mercari net payout', price + shipCharge - 10.50 - shipCost, 93.00);

// Fanatics: 6% of 100 = 6.00, plus $5 vault ship-in. Seller does not ship to buyer.
eq('Fanatics Buy Now fees', sum(feeFanatics(price)), 6.00 + 5.00);
eq('Fanatics net payout (ship-in, no buyer postage)', price + shipCharge - 11.00 - 0, 94.00);

// ── Scenario B: no buyer-paid shipping ──
eq('TCGplayer fees with no shipping', sum(feeTCGPlayer(100, 0)), 10.75 + (2.50 + 0.30));
eq('Mercari fee with no shipping', sum(feeMercari(100, 0)), 10.00);

// ── Scenario C: $75 commission cap ──
// 1000*0.1075 = 107.50 -> capped to 75. processing = 1000*0.025 + 0.30 = 25.30
eq('TCGplayer commission cap at $75', sum(feeTCGPlayer(1000, 0)), 75 + 25.30);
assert('TCGplayer labels the cap when it binds',
  feeTCGPlayer(1000, 0).some(f => f.l.includes('$75 cap')));

// ── Scenario D: legacy-call safety (shipCharge omitted must not produce NaN) ──
assert('feeTCGPlayer tolerates missing shipCharge', Number.isFinite(sum(feeTCGPlayer(100))));
assert('feeMercari tolerates missing shipCharge', Number.isFinite(sum(feeMercari(100))));

// ── Wiring: the calculator must pass shipping through and model ship-in correctly ──
assert('TCGplayer wired with shipCharge', src.includes('feeTCGPlayer(price, shipCharge)'));
assert('Mercari wired with shipCharge', src.includes('feeMercari(price, shipCharge)'));
assert('TCGplayer no longer hardcodes sellerShip 0',
  !/feeTCGPlayer\(price, shipCharge\),[\s\S]{0,400}?sellerShip: 0/.test(src));
assert('Fanatics no longer double-charges shipping',
  /feeFanatics\(price\),[\s\S]{0,500}?sellerShip: 0/.test(src));

// ── Published table must agree with the code ──
const acc = fs.readFileSync(path.join(root, 'accuracy.html'), 'utf8');
assert('Accuracy page states Fanatics 6%', /Buy Now: 6% seller/.test(acc));
assert('Accuracy page dropped the wrong Fanatics 8%', !/Buy Now: 8% seller/.test(acc));
assert('Accuracy page states Mercari flat 10%', /Flat 10% selling fee/.test(acc));
assert('Accuracy page dropped Mercari 2.9% + $0.50', !/10% marketplace \+ 2\.9% \+ \$0\.50/.test(acc));
assert('Accuracy page states TCGplayer self-ship', /you ship the card yourself/.test(acc));

console.log(failures === 0 ? '\nAll fee-truth checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
