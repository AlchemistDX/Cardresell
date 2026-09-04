/**
 * Majors batch — 2026-09-04
 *
 * Covers three majors from the Sol E2E audit:
 *   #1 cross-card contamination in _beginCardSwap
 *   #2 pack cost double-multiplied + pack tracker stale / qty-blind
 *   #3 flip P&L omits fees, shipping and grading
 *
 * Discipline: these tests EXTRACT the real source out of index.html and
 * EXECUTE it. Text-presence assertions survive neutering the enclosing `if`,
 * so anything that can be executed is executed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0;
const fails = [];
function ok(name, cond) {
  if (cond) { pass++; } else { fails.push(name); }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fails.push(`${name}\n      expected ${e}\n      actual   ${a}`); }
}
function near(name, actual, expected, tol = 0.005) {
  if (Math.abs(actual - expected) <= tol) { pass++; }
  else { fails.push(`${name}\n      expected ~${expected}\n      actual    ${actual}`); }
}

/**
 * Strip // and /* *\/ comments so an assertion cannot be satisfied by text that
 * is commented OUT. Commenting a call leaves its name in the source, which
 * silently defeated a naive presence check during mutation testing.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

/** Pull `function NAME(...) { ... }` out of the HTML by brace matching. */
function grabFn(name) {
  const sig = `function ${name}(`;
  const start = HTML.indexOf(sig);
  if (start === -1) throw new Error(`function ${name} not found in index.html`);
  // Start brace matching AFTER the parameter list so destructured params
  // ({a, b}) don't terminate the match early.
  let i = HTML.indexOf(')', start);
  i = HTML.indexOf('{', i);
  let depth = 0;
  for (let j = i; j < HTML.length; j++) {
    const c = HTML[j];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return HTML.slice(start, j + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

/* ══════════════════════════════════════════════════════════════
   MAJOR #3 — flip P&L: fees, shipping, grading
   ══════════════════════════════════════════════════════════════ */

const flipNetSrc = grabFn('_flipNetOf');
const _flipNetOf = new Function(`${flipNetSrc}; return _flipNetOf;`)();

// The audit's exact reproduction case. This is the whole point of the fix.
{
  const r = _flipNetOf({ buyPrice: 100, sellPrice: 150, fees: 20, shippingCost: 5, gradingCost: 25 });
  near('audit case: $100 buy / $150 sale / $20 fees / $5 ship / $25 grading nets $0.00', r.net, 0);
  near('audit case: ROI is 0.0%, not 50.0%', r.roiPct, 0);
  ok('audit case: net is NOT the old gross spread of +$50', Math.abs(r.net - 50) > 0.005);
  ok('audit case: ROI is NOT the old +50.0%', Math.abs(r.roiPct - 50) > 0.005);
  near('audit case: basis is total cash deployed ($150)', r.basis, 150);
  ok('audit case: hasCosts is true', r.hasCosts === true);
}

// Back-compat: a legacy flip with no cost fields must be byte-identical to the
// old `sellPrice - buyPrice` model. This is what keeps historical rows honest.
{
  const legacy = { buyPrice: 100, sellPrice: 150 };
  near('legacy flip (no cost fields) still nets the gross spread', _flipNetOf(legacy).net, 50);
  near('legacy flip ROI still divides by buyPrice alone', _flipNetOf(legacy).roiPct, 50);
  near('legacy flip basis collapses to buyPrice', _flipNetOf(legacy).basis, 100);
  ok('legacy flip reports hasCosts false', _flipNetOf(legacy).hasCosts === false);
}

// The three original audit arithmetic cases must be unchanged when no costs
// are recorded (section 3.1 of the portfolio report — those were PASSes).
{
  near('3.1 profit case unchanged', _flipNetOf({ buyPrice: 100, sellPrice: 150 }).net, 50);
  near('3.1 loss case unchanged', _flipNetOf({ buyPrice: 100, sellPrice: 70 }).net, -30);
  near('3.1 loss ROI unchanged', _flipNetOf({ buyPrice: 100, sellPrice: 70 }).roiPct, -30);
  near('3.1 break-even case unchanged', _flipNetOf({ buyPrice: 100, sellPrice: 100 }).net, 0);
  near('3.1 break-even ROI unchanged', _flipNetOf({ buyPrice: 100, sellPrice: 100 }).roiPct, 0);
}

// A flip whose costs exceed its spread must go NEGATIVE, not stay positive.
{
  const r = _flipNetOf({ buyPrice: 100, sellPrice: 140, fees: 20, shippingCost: 10, gradingCost: 25 });
  near('costs exceeding spread produce a real loss', r.net, -15);
  ok('loss-making flip reports a negative ROI', r.roiPct < 0);
}

// ROI must be undefined (null), never 0%, when nothing was invested.
{
  // NOTE: use strict identity, not JSON equality — JSON.stringify(Infinity)
  // serialises to "null", so an unguarded net/0 would masquerade as a correct
  // null and slip past the mutation check. (Caught doing exactly that.)
  const strictNull = (name, v) => ok(name, v === null);
  strictNull('zero basis yields null ROI, not 0% or Infinity', _flipNetOf({ buyPrice: 0, sellPrice: 40 }).roiPct);
  ok('zero-basis ROI is not Infinity', _flipNetOf({ buyPrice: 0, sellPrice: 40 }).roiPct !== Infinity);
  near('free-find flip still reports its full net', _flipNetOf({ buyPrice: 0, sellPrice: 40 }).net, 40);
  strictNull('empty object yields null ROI', _flipNetOf({}).roiPct);
  ok('empty object ROI is not NaN', !Number.isNaN(_flipNetOf({}).roiPct));
  near('empty object nets 0', _flipNetOf({}).net, 0);
  strictNull('null input does not throw and yields null ROI', _flipNetOf(null).roiPct);
}

// Negative costs must be clamped — otherwise a "-50" fee inflates profit.
{
  const r = _flipNetOf({ buyPrice: 100, sellPrice: 150, fees: -50 });
  near('negative fee is clamped to 0 and cannot inflate profit', r.net, 50);
  near('negative fee is clamped in the basis too', r.basis, 100);
  ok('negative fee is normalised to 0 in the returned components', r.fees === 0);
}

// Garbage / string inputs must coerce safely rather than produce NaN.
{
  const r = _flipNetOf({ buyPrice: '100', sellPrice: '150', fees: 'abc', shippingCost: null, gradingCost: undefined });
  near('string prices coerce correctly', r.net, 50);
  ok('non-numeric fee does not produce NaN', Number.isFinite(r.net));
  ok('non-numeric fee does not produce NaN in ROI', Number.isFinite(r.roiPct));
}

// Each cost lever must independently reduce net by exactly its amount.
{
  const base = _flipNetOf({ buyPrice: 100, sellPrice: 150 }).net;
  near('fees reduce net dollar-for-dollar',
    base - _flipNetOf({ buyPrice: 100, sellPrice: 150, fees: 7 }).net, 7);
  near('shipping reduces net dollar-for-dollar',
    base - _flipNetOf({ buyPrice: 100, sellPrice: 150, shippingCost: 7 }).net, 7);
  near('grading reduces net dollar-for-dollar',
    base - _flipNetOf({ buyPrice: 100, sellPrice: 150, gradingCost: 7 }).net, 7);
}

/* --- write paths must persist the components, not just the net --- */
for (const [label, fn] of [['confirmMarkSold', 'confirmMarkSold'], ['saveFlipEntry', 'saveFlipEntry']]) {
  const src = stripComments(grabFn(fn));
  ok(`${label} computes profit via _flipNetOf (not a raw subtraction)`, /_flipNetOf\(/.test(src));
  ok(`${label} no longer computes profit as a bare sellPrice - buyPrice`,
    !/const profit\s*=\s*sellPrice\s*-\s*buyPrice\s*;/.test(src));
  ok(`${label} persists fees`, /\bfees\b/.test(src));
  ok(`${label} persists shippingCost`, /shippingCost/.test(src));
  ok(`${label} persists gradingCost`, /gradingCost/.test(src));
  ok(`${label} clamps costs at zero on read`, /Math\.max\(0,\s*parseFloat/.test(src));
}

// The UI must actually offer the inputs, or the fields can never be populated.
for (const id of ['msFees', 'msShipCost', 'msGradingCost', 'mFees', 'mShipCost', 'mGradingCost']) {
  ok(`cost input #${id} exists in the markup`, HTML.includes(`id="${id}"`));
}
ok('manual flip cost row is a togglable field', HTML.includes('id="mCostsField"'));
ok('manual flip cost row is hidden in hold mode',
  /costField\.style\.display = mode === 'hold' \? 'none' : ''/.test(HTML));
ok('clearModal wipes the manual cost inputs so they do not leak between flips',
  /'mFees','mShipCost','mGradingCost'/.test(grabFn('clearModal')));
ok('mark-sold modal clears its cost inputs on open',
  /'msFees','msShipCost','msGradingCost'/.test(HTML));

// The live preview must use the same model as the save, or it lies.
{
  const src = stripComments(grabFn('_msUpdateProfitPreview'));
  ok('sold-modal preview computes via _flipNetOf', /_flipNetOf\(/.test(src));
  ok('sold-modal preview reads the fee input', /msFees/.test(src));
  ok('sold-modal preview reads the shipping input', /msShipCost/.test(src));
  ok('sold-modal preview reads the grading input', /msGradingCost/.test(src));
  // Each cost must be named only when it is actually non-zero, so the
  // breakdown line can never claim a cost that was not subtracted (or hide
  // one that was). A blanket /shipping/ match let a gutted branch through.
  ok('preview names fees only when fees > 0', /r\.fees > 0[\s\S]{0,80}?fees/.test(src));
  ok('preview names shipping only when shipping > 0', /r\.shippingCost > 0[\s\S]{0,80}?shipping/.test(src));
  ok('preview names grading only when grading > 0', /r\.gradingCost > 0[\s\S]{0,80}?grading/.test(src));
  ok('preview renders each named cost with its dollar amount',
    (src.match(/toFixed\(2\)\} (fees|shipping|grading)/g) || []).length === 3);
}

// Renderers must divide by total cash deployed, not buyPrice.
ok('Flip Log row derives ROI from the _flipNetOf basis',
  /const hasCost = _fn\.basis > 0;[\s\S]{0,120}?roi = hasCost \? \(pr \/ _fn\.basis\)/.test(HTML));
ok('Flip Log row no longer divides ROI by buyPrice alone',
  !/const roi = hasCost \? \(pr \/ b\) \* 100 : 0;/.test(HTML));
ok('CSV export carries the cost columns',
  /'Fees','Shipping','Grading','Net Profit'/.test(HTML));

/* ══════════════════════════════════════════════════════════════
   MAJOR #2 — pack cost double-multiplication + tracker
   ══════════════════════════════════════════════════════════════ */

// Reproduce the real cost-split loop from confirmBulkCostSave, then run the
// saved values through the real save semantics (qty SEPARATE entries, each
// assigned the full costs[i]) and check the booked total equals the pack cost.
{
  const src = grabFn('confirmBulkCostSave');
  ok('cost split assigns the per-copy cost', /costs\[i\] = perSlot;/.test(src));
  ok('cost split no longer multiplies by qty', !/costs\[i\] = perSlot \* qty;/.test(src));

  // Executable model of the two halves that have to agree.
  const splitAndBook = (packCost, rows) => {
    const n = rows.reduce((s, r) => s + (r.qty > 1 ? r.qty : 1), 0);
    const perSlot = (packCost > 0 && n > 0) ? packCost / n : 0;
    const costs = rows.map(() => perSlot);           // ← the fixed line
    let booked = 0;
    rows.forEach((r, i) => {                          // ← _bulkSaveToCollection
      const qty = r.qty > 1 ? r.qty : 1;
      for (let k = 0; k < qty; k++) booked += costs[i];
    });
    return { perSlot, booked };
  };

  const r1 = splitAndBook(120, [{ qty: 3 }, ...Array(9).fill({ qty: 1 })]);
  near('12-slot $120 box: per-copy cost is $10.00', r1.perSlot, 10);
  near('12-slot $120 box with a x3 row books exactly $120 of basis', r1.booked, 120);

  const r2 = splitAndBook(100, [{ qty: 4 }, { qty: 1 }]);
  near('$100 across 5 copies books exactly $100', r2.booked, 100);

  const r3 = splitAndBook(60, [{ qty: 1 }, { qty: 1 }, { qty: 1 }]);
  near('all-qty-1 case is unaffected by the fix', r3.booked, 60);

  // The pre-fix behaviour squared the qty multiplier. Prove we are not it.
  const buggy = (packCost, rows) => {
    const n = rows.reduce((s, r) => s + (r.qty > 1 ? r.qty : 1), 0);
    const perSlot = packCost / n;
    const costs = rows.map((r) => perSlot * (r.qty > 1 ? r.qty : 1));
    let booked = 0;
    rows.forEach((r, i) => {
      const qty = r.qty > 1 ? r.qty : 1;
      for (let k = 0; k < qty; k++) booked += costs[i];
    });
    return booked;
  };
  near('the old code really did over-book (regression guard on the guard)',
    buggy(120, [{ qty: 3 }, ...Array(9).fill({ qty: 1 })]), 180);
  ok('fixed booking differs from the old over-booked total',
    Math.abs(r1.booked - buggy(120, [{ qty: 3 }, ...Array(9).fill({ qty: 1 })])) > 0.005);
}

// What the row pill promises must equal what gets saved.
{
  const hint = grabFn('updateBulkPackCostHint');
  ok('row pill shows per-copy cost as the multiplicand', /\$\{perSlot\.toFixed\(2\)\}/.test(hint));
  ok('row pill shows the qty-multiplied row total', /rowTotal = perSlot \* qty/.test(hint));
}

// Pack tracker must count every copy and must refresh after edits.
{
  const src = grabFn('_bulkUpdatePackTracker');
  ok('pack tracker multiplies market price by qty', /p \* qty/.test(src));
  ok('pack tracker reads qty off the result row', /r\.qty && r\.qty > 1/.test(src));
  ok('pack tracker no longer sums bare market prices', !/return s \+ \(p > 0 \? p : 0\);/.test(src));

  // Executable: three copies of a $10 card must count as $30 recovered.
  const recovered = (rows) => rows.reduce((s, r) => {
    const p = (r && r.success && typeof r.marketPrice === 'number') ? r.marketPrice : 0;
    const qty = (r && r.qty && r.qty > 1) ? r.qty : 1;
    return s + (p > 0 ? p * qty : 0);
  }, 0);
  near('a x3 row of $10 cards counts as $30 recovered',
    recovered([{ success: true, marketPrice: 10, qty: 3 }]), 30);
  near('qty-1 rows are unaffected',
    recovered([{ success: true, marketPrice: 10, qty: 1 }]), 10);
  near('failed rows contribute nothing',
    recovered([{ success: false, marketPrice: 10, qty: 3 }]), 0);
  near('missing qty defaults to a single copy',
    recovered([{ success: true, marketPrice: 10 }]), 10);

  ok('_bulkUpdateRow refreshes the tracker so post-scan edits are not stale',
    /_bulkUpdatePackTracker\(/.test(stripComments(grabFn('_bulkUpdateRow'))));
  ok('bulkRemoveResult refreshes the tracker after dropping a row',
    /_bulkUpdatePackTracker\(/.test(stripComments(grabFn('bulkRemoveResult'))));
}

/* ══════════════════════════════════════════════════════════════
   MAJOR #1 — cross-card contamination on card swap
   ══════════════════════════════════════════════════════════════ */
{
  ok('_clearCardDerivedSurfaces exists', HTML.includes('function _clearCardDerivedSurfaces'));
  const src = grabFn('_clearCardDerivedSurfaces');
  for (const id of ['qpTiers', 'qpRows', 'qpLadder', 'qpGradedNote', 'quickPricing', 'resultsArea']) {
    ok(`card swap clears ${id}`, src.includes(id));
  }
  ok('card swap drops the previously chosen tier', /_qpChosenTier\s*=\s*null/.test(src));
  ok('card swap clears the price override', /priceOverride/.test(src));
  ok('card swap resets the override auto-fill flag', /_ovAutoFilled\s*=\s*false/.test(src));
  ok('card swap neutralises the eBay list button', /ebayListBtn/.test(src));
  ok('card swap neutralises the TCGplayer list button', /tcgpListBtn/.test(src));

  const swap = stripComments(grabFn('_beginCardSwap'));
  ok('_beginCardSwap actually calls the cleaner (not a commented-out call)',
    /_clearCardDerivedSurfaces\(/.test(swap));

  ok('loadCardUI re-enables the list buttons after a swap disabled them',
    /aria-disabled[\s\S]{0,400}?ebayListBtn\.href = buildEbaySearchUrl/.test(HTML)
    || /\[ebayListBtn, tcgpListBtn\]/.test(HTML));
  ok('_endCardSwap(false) restores the intro instead of stranding "Loading payouts…"',
    /showIntro\(\)/.test(grabFn('_endCardSwap')));
}

/* ══════════════════════════════════════════════════════════════ */
console.log(`\n  majors-flip-and-pack-2026-09-04: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('\n  FAILURES:');
  for (const f of fails) console.log(`   ✗ ${f}`);
  process.exit(1);
}
