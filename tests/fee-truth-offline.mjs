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

/** Pull a top-level `const NAME = { ... };` block out of index.html by brace matching.
 *  Needed because the extracted fee functions are evaluated in isolation via
 *  `new Function`, so module-level lookup tables they close over (TCG_LEVELS)
 *  are not otherwise in scope. */
function extractConst(name) {
  const start = src.indexOf(`const ${name} = {`);
  if (start === -1) throw new Error(`could not find const ${name} in index.html`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1) + ';';
}

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
  return new Function(...sig.split(',').map(s => s.trim()).filter(Boolean),
                      extractConst('TCG_LEVELS') + '\n' + body);
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
assert('TCGplayer wired with shipCharge and seller level',
  src.includes('feeTCGPlayer(price, shipCharge, tcgLevel)'));
assert('Mercari wired with shipCharge', src.includes('feeMercari(price, shipCharge)'));
assert('TCGplayer no longer hardcodes sellerShip 0',
  !/feeTCGPlayer\(price, shipCharge, tcgLevel\),[\s\S]{0,700}?sellerShip: 0,/.test(src));
assert('Fanatics no longer double-charges shipping',
  /feeFanatics\(price\),[\s\S]{0,500}?sellerShip: 0/.test(src));

// ── Published table must agree with the code ──
const acc = fs.readFileSync(path.join(root, 'accuracy.html'), 'utf8');
assert('Accuracy page states Fanatics 6%', /Buy Now: 6% seller/.test(acc));
assert('Accuracy page dropped the wrong Fanatics 8%', !/Buy Now: 8% seller/.test(acc));
assert('Accuracy page states Mercari flat 10%', /Flat 10% selling fee/.test(acc));
assert('Accuracy page dropped Mercari 2.9% + $0.50', !/10% marketplace \+ 2\.9% \+ \$0\.50/.test(acc));
assert('Accuracy page states TCGplayer self-ship', /you ship the card yourself/.test(acc));


/* ══════════════════════════════════════════════════════════════════════════
 * 2026-09-01 full 15-venue audit — fee-basis corrections
 *
 * Each expectation below is hand-computed from the venue's own published
 * schedule. Sources:
 *   Whatnot    commission on item only ("does not include shipping or taxes"),
 *              processing on total order value ("plus shipping and buyer-paid tax")
 *              https://help.whatnot.com/hc/en-us/articles/4847069165965-Whatnot-Seller-Fees-and-Commissions-Schedule
 *   Mana Pool  5% "not applied to shipping charges, only the price of the product";
 *              seller "receives the entire shipping fee, minus a credit card processing fee"
 *              https://support.manapool.com/hc/en-us/articles/21779686206615-Fees-Mana-Pool-and-Credit-Card-Fees
 *   CardNexus  "calculated on the order total (items + shipping)"
 *              https://help.cardnexus.com/articles/9938652-fee-structure-overview
 *   COMC       "$1 store credit fee when converting less than $250"
 *              https://www.comc.com/cashout
 * ══════════════════════════════════════════════════════════════════════════ */
const feeWhatnot   = extractFn('feeWhatnot');
const feeManaPool  = extractFn('feeManaPool');
const feeCardNexus = extractFn('feeCardNexus');
const feeCOMC      = extractFn('feeCOMC');

// Whatnot, $100 card + $5 buyer-paid shipping.
// commission = 100 * 0.08 = 8.00 (item only)
// processing = 105 * 0.029 + 0.30 = 3.045 + 0.30 = 3.345
eq('Whatnot split basis: commission item-only, processing on item+shipping',
  sum(feeWhatnot(100, 5)), 8.00 + 3.345);
eq('Whatnot commission ignores shipping',
  feeWhatnot(100, 5).find(f => /ommission/.test(f.l)).a, 8.00);
// Above the $1,500 category cutoff commission stops accruing but processing does not.
// commission = 1500 * 0.08 = 120 ; processing = 2005 * 0.029 + 0.30 = 58.145 + 0.30
eq('Whatnot 0% above $1,500 still pays processing on the whole order',
  sum(feeWhatnot(2000, 5)), 120 + (2005 * 0.029 + 0.30));

// Mana Pool, $100 card + $5 shipping.
// marketplace = 100 * 0.05 = 5.00 ; processing = 105 * 0.029 + 0.30 = 3.345
eq('Mana Pool 5% excludes shipping but processing includes it',
  sum(feeManaPool(100, 5)), 5.00 + 3.345);
eq('Mana Pool marketplace fee is item-only',
  feeManaPool(100, 5).find(f => /Marketplace/.test(f.l)).a, 5.00);

// CardNexus, $100 card + $5 shipping -> 8% of $105 = 8.40
eq('CardNexus 8% bills the order total including shipping',
  sum(feeCardNexus(100, 5)), 8.40);

// COMC cash-out add-on. $100 card, standard raw sub ($0.65), 5% tx = $5.00,
// $5 ship-in. convertible = 100 - 5 - 5 = 90 -> 10% = 9.00, plus $1 under-$250.
eq('COMC adds the $1 under-$250 cash-out surcharge',
  sum(feeCOMC(100, 'standard', false, 'yes')), 0.65 + 5.00 + 5 + 9.00 + 1);
// A large card clears the $250 threshold: convertible = 1000 - 50 - 5 = 945 -> 94.50, no $1.
eq('COMC drops the surcharge above $250',
  sum(feeCOMC(1000, 'standard', false, 'yes')), 0.65 + 50.00 + 5 + 94.50);
assert('COMC surcharge is absent when not cashing out',
  !feeCOMC(100, 'standard', false, 'no').some(f => /surcharge/i.test(f.l)));

// Legacy-call safety for the newly two-arg functions.
assert('feeWhatnot tolerates missing shipCharge', Number.isFinite(sum(feeWhatnot(100))));
assert('feeManaPool tolerates missing shipCharge', Number.isFinite(sum(feeManaPool(100))));
assert('feeCardNexus tolerates missing shipCharge', Number.isFinite(sum(feeCardNexus(100))));

// Wiring: call sites must pass shipping through.
assert('Whatnot wired with shipCharge', src.includes('feeWhatnot(price, shipCharge)'));
assert('Mana Pool wired with shipCharge', src.includes('feeManaPool(price, shipCharge)'));
assert('CardNexus wired with shipCharge', src.includes('feeCardNexus(price, shipCharge)'));

/* ── Cross-border disclosure must cover every venue, locked or not ────────── */
const pids = ['ebay','tcgplayer','poshmark','comc','fanatics','whatnot','mercari',
              'manapool','cardsphere','cardmarket','cardkingdom','coolstuffinc',
              'scg','cardnexus','tcgbulk'];
const cbStart = src.indexOf('const CROSS_BORDER = {');
assert('CROSS_BORDER table exists', cbStart !== -1);
const cbBlock = src.slice(cbStart, src.indexOf('\n};', cbStart));
for (const pid of pids) {
  assert(`CROSS_BORDER covers ${pid}`, new RegExp(`\\n  ${pid}: \\{`).test(cbBlock));
}
assert('Cardmarket flagged as a foreign operator', /cardmarket:[\s\S]*?foreign: true/.test(cbBlock));
assert('CardNexus flagged as a foreign operator', /cardnexus:[\s\S]*?foreign: true/.test(cbBlock));
assert('eBay discloses the 1.65% international fee', /1\.65% international fee/.test(cbBlock));
assert('TCGplayer discloses the 3.5% international processing rate', /3\.5% \+ \$0\.30 on international/.test(cbBlock));
assert('Cardmarket discloses EUR payout and US eligibility risk',
  /paid in EUR/.test(cbBlock) && /may not be able to register/.test(cbBlock));
assert('Cross-border block renders on the LOCKED (ineligible) tile',
  /plat-sub">\$\{r\.note\}<\/div>\s*\n\s*\$\{crossBorderHtml\(r\.pid\)\}/.test(src));
assert('Cross-border block renders on the unlocked tile',
  /\$\{redFlagsHtml\}\s*\n\s*\$\{crossBorderHtml\(r\.pid\)\}/.test(src));
assert('Locked upsell list flags foreign venues',
  /CROSS_BORDER\[r\.pid\]\?\.foreign/.test(src));


// ── B1/B3/B4 (2026-09-02): the two free rows must be rebuildable on a phone ──
// A stranger reads the expand, punches the same numbers into a calculator, and
// must land on the same net. These pin the Base Set 2 Charizard first-run case
// ($422.40 TCGplayer market, no buyer-paid shipping, no seller postage) plus
// the derived fee-formula strings the winner tile and expand display.
// Tolerance is a nickel per the work order; asserted here at one cent.
const _feeEbayB = extractFn('feeEbay');
const CHZ = 422.40;
const netOf = (items, price, shipCharge, sellerShip) =>
  price + shipCharge - items.reduce((s, f) => s + f.a, 0) - sellerShip;

// Compare on the DISPLAYED cents: the UI formats to 2dp, so the raw
// 366.132 is what a stranger sees as $366.13 and rebuilds on a calculator.
const cents = n => (Math.round(n * 100) / 100).toFixed(2);

const _tc = feeTCGPlayer(CHZ, 0);
assert('Charizard TCGplayer net rebuilds to $366.13',
  cents(netOf(_tc, CHZ, 0, 0)) === '366.13');
eq('Charizard TCGplayer fee base is item-only when no buyer shipping', _tc.feeBase, CHZ);
assert('TCGplayer fee formula reads "10.75% + 2.5% + $0.30"',
  _tc.map(f => f.f).filter(Boolean).join(' + ') === '10.75% + 2.5% + $0.30');

const _eb = _feeEbayB(CHZ, 0, 'none', 0, 'no');
assert('Charizard eBay net rebuilds to $366.03',
  cents(netOf(_eb, CHZ, 0, 0)) === '366.03');
eq('Charizard eBay fee base is item + shipping + tax(0)', _eb.feeBase, CHZ);
assert('eBay fee formula reads "13.25% + $0.40"',
  _eb.map(f => f.f).filter(Boolean).join(' + ') === '13.25% + $0.40');

// Default must be no store and NOT Top Rated - a Top Rated discount the user
// hasn't earned would overstate every payout.
assert('eBay default is no store, not Top Rated',
  Math.abs(_eb[0].a - CHZ * 0.1325) < 0.005);

// The cap must announce itself in the formula the moment it binds.
assert('TCGplayer $75 cap appears in the formula when it fires',
  /capped \$75/.test(feeTCGPlayer(1000, 0).map(f => f.f).join(' + ')) &&
  !/capped/.test(feeTCGPlayer(100, 0).map(f => f.f).join(' + ')));

// Both nets must respond to the shared inputs (work-order QA steps 5 and 6).
assert('Raising price moves BOTH nets',
  netOf(feeTCGPlayer(500, 0), 500, 0, 0) > netOf(_tc, CHZ, 0, 0) &&
  netOf(_feeEbayB(500, 0, 'none', 0, 'no'), 500, 0, 0) > netOf(_eb, CHZ, 0, 0));
assert('Seller postage reduces BOTH nets by exactly the postage',
  Math.abs(netOf(_tc, CHZ, 0, 5) - (366.13 - 5)) < 0.01 &&
  Math.abs(netOf(_eb, CHZ, 0, 5) - (366.03 - 5)) < 0.01);

// The winner tile must render the DERIVED formula, never a hand-typed rate
// string, and the vague old copy must be gone.
assert('Winner tile renders the derived fee formula',
  /winner-sub">\$\{[\s\S]{0,600}?bannerResult\.feeFormula/.test(src));
assert('feeFormula is derived from the fee line items',
  /const feeFormula = p\.feeItems\.map\(f => f\.f\)/.test(src));
assert('Expand shows fee base and the not-modeled tax line',
  /Fee base <span class="fee-basis">/.test(src) &&
  /Buyer sales tax <span class="fee-basis">\(not modeled\)/.test(src));
assert('Clamp note says payout prices off Market, not High',
  /not the raw High/.test(src) && /highClamped/.test(src));


// ═══ Scenario H: seller profile — TCGplayer level & eBay Top Rated (2026-09-02) ═══
//
// Published tier table (help.tcgplayer.com/hc/en-us/articles/201357836-TCGplayer-Fees
// and .../360047732673-Fee-Calculation-Examples):
//   Level 1-4            10.75%  no Pro fee   2.5% + $0.30
//   Pro (non-Direct)      9.25%  + 2.5% Pro   2.5% + $0.30
//   Direct (non-Pro)      8.95%  no Pro fee   2.5%   (no $0.30)
//   Direct + Pro          8.95%  + 2.5% Pro   2.5%   (no $0.30)
// Direct also carries a per-item fee replacing postage: flat $1.12 above $2.49,
// 50% of sale price at $2.49 and below (seller.tcgplayer.com Jun 18 2026 change).
const P = 100;
eq('TCG Level 1-4 = 10.75% + 2.5% + $0.30',
   sum(feeTCGPlayer(P, 0, 'l14')), 10.75 + 2.50 + 0.30);
eq('TCG Pro = 9.25% + 2.5% Pro + 2.5% + $0.30',
   sum(feeTCGPlayer(P, 0, 'pro')), 9.25 + 2.50 + 2.50 + 0.30);
// Direct drops the $0.30 entirely and adds the $1.12 per-item fee.
eq('TCG Direct = 8.95% + 2.5% + $1.12, no $0.30',
   sum(feeTCGPlayer(P, 0, 'direct')), 8.95 + 2.50 + 1.12);
eq('TCG Direct+Pro = 8.95% + 2.5% Pro + 2.5% + $1.12',
   sum(feeTCGPlayer(P, 0, 'directpro')), 8.95 + 2.50 + 2.50 + 1.12);

assert('Direct level charges no $0.30 transaction fee',
  !feeTCGPlayer(P, 0, 'direct').some(f => (f.f || '').includes('$0.30')));
assert('Non-Direct level still charges the $0.30',
  feeTCGPlayer(P, 0, 'l14').some(f => (f.f || '').includes('$0.30')));
assert('Direct exposes tcgDirect so the caller can zero postage',
  feeTCGPlayer(P, 0, 'direct').tcgDirect === true &&
  feeTCGPlayer(P, 0, 'l14').tcgDirect === false);
assert('calc() zeroes TCGplayer postage on Direct levels',
  /sellerShip: tcgIsDirect \? 0 : shipCost/.test(src));

// Low-value Direct rule: 50% of sale price at or below $2.49.
eq('Direct per-item fee is 50% at $2.00',
   sum(feeTCGPlayer(2, 0, 'direct')), 2 * 0.0895 + 2 * 0.025 + 1.00);
assert('Direct per-item fee is flat $1.12 above $2.49',
  feeTCGPlayer(3, 0, 'direct').some(f => f.f === '$1.12'));

// The $75 cap covers commission AND Pro fee combined, not commission alone.
eq('Pro cap applies to commission + Pro fee combined',
   sum(feeTCGPlayer(1000, 0, 'pro')), 75 + 25.30);
assert('capped Pro formula names both capped components',
  /9\.25% \+ 2\.5% Pro capped \$75/.test(
    feeTCGPlayer(1000, 0, 'pro').map(f => f.f).filter(Boolean).join(' + ')));

// Unknown / tampered level must fall back to Level 1-4, never crash or free-ride.
eq('unknown seller level falls back to Level 1-4',
   sum(feeTCGPlayer(P, 0, 'bogus')), sum(feeTCGPlayer(P, 0, 'l14')));
assert('unknown level reports itself as l14', feeTCGPlayer(P, 0, 'bogus').tcgLevel === 'l14');

// Direct must genuinely beat Level 1-4 on the same card -- this is the whole
// point of modeling the profile.
assert('Direct nets more than Level 1-4 on the same card',
  sum(feeTCGPlayer(CHZ, 0, 'direct')) < sum(feeTCGPlayer(CHZ, 0, 'l14')));

// eBay Top Rated: the rate signature must state the EFFECTIVE rate, not the
// headline rate. Before this fix a Top Rated seller saw "13.25%" while paying
// 11.93%, i.e. the recipe line claimed a rate the math did not apply.
const trsItems  = _feeEbayB(P, 0, 'none', 0, 'yes');
const baseItems = _feeEbayB(P, 0, 'none', 0, 'no');
eq('eBay Top Rated pays 13.25% less 10%', sum(trsItems), 13.25 * 0.9 + 0.40);
assert('Top Rated formula states the discount, not a bare 13.25%',
  trsItems.some(f => f.f === '13.25% \u221210% Top Rated') &&
  !trsItems.some(f => f.f === '13.25%'));
// Above the tier boundary the rate really is a blend, so the blend is shown.
assert('above the $7,500 boundary the formula reports the blended rate',
  _feeEbayB(9000, 0, 'none', 0, 'no').some(f => /% effective$/.test(f.f || '')));
assert('non-Top-Rated formula still states the plain headline rate',
  baseItems.some(f => f.f === '13.25%'));
assert('Top Rated fee line discloses the discount',
  trsItems.some(f => /Top Rated/.test(f.l)));


console.log(failures === 0 ? '\nAll fee-truth checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
