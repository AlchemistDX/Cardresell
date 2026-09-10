// Payout-presentation honesty guard. Added 2026-09-08 for BIAS-6.
//
// Two defects are pinned here, both found by the BIAS-6 walk and both about
// presenting a number as better-established than it is.
//
// 1. THE PAYOUT RANK CHART COULD NOT DRAW A LOSS.
//    The geometry was `Math.max(6, (net / rankBest) * 100)` on a left-anchored
//    bar inside an `overflow:hidden` track. Three failures, all pointing the
//    same way (worse venues looked better):
//      P-1 all payouts negative -> net/rankBest is a ratio of two negatives,
//          positive and > 1 for every venue worse than the best, so every
//          underwater venue clipped to a FULL bar identical to the winner's.
//      P-2 rankBest positive -> the 6% floor mapped every negative onto the
//          same stub, so -$5,000 drew the same bar as +$2.
//      P-3 `rankBest ?? 1` guarded null/undefined but not 0, so a best payout
//          of exactly $0 produced `width:NaN%`.
//    The fix is a SIGNED bar against a zero reference. What this suite asserts
//    is the acceptance set agreed with the reviewer, not the implementation:
//    all-negative stays distinguishable, mixed signs keep their signs, zero
//    renders finite, and the all-positive case is unchanged.
//
// 2. A BLANK COST FIELD WAS SAVED AS A CONFIRMED $0.
//    The three cost readers all did `Math.max(0, parseFloat(v) || 0)`, so
//    "seller never typed a fee" and "seller confirmed there was no fee"
//    became the same stored number. Those nets then summed into "Total Profit"
//    and ranked into "Best Flip" with no qualifier. A missing cost treated as
//    zero overstates profit by that cost, when the cost was actually incurred.
//
//    WHAT THIS SUITE USED TO ASSERT: nothing -- there was no registered test
//    for either surface. The earlier `hasCosts` flag looked like a
//    completeness check and is deliberately NOT asserted here, because
//    `(fees + shipping + grading) > 0` cannot tell "all confirmed zero" from
//    "one entered, two unknown" from "all blank". It was removed rather than
//    wired up. What replaced it is a four-state per-field record, and the
//    four states are what this suite pins.

import { completionGuard } from './_complete.mjs';
const { finish: _finish } = completionGuard('payout-honesty');

import { readCoreBundle } from './_assetRefs.mjs';

const bundle = readCoreBundle();
const src = bundle.source;
console.log(`live bundle: ${bundle.path.split('/').pop()}`);

let passed = 0, failed = 0;
function check(label, cond, hint) {
  if (cond && typeof cond.then === 'function') {
    failed++;
    console.log(`  FAIL ${label}\n       → TEST_API_MISUSE: a Promise is not a truth value`);
    return;
  }
  if (cond) { console.log('  \u2713 ' + label); passed++; }
  else { console.log('  \u2717 ' + label + (hint ? '\n      ' + hint : '')); failed++; }
}

/* Lift a top-level function out of the live bundle by name. We evaluate the
   shipped bytes rather than a copy, so this suite cannot pass against a
   reimplementation that the browser never loads. */
function lift(names) {
  const parts = names.map(n => {
    const m = src.match(new RegExp(`\\nfunction ${n}\\s*\\([\\s\\S]*?\\n}\\n`));
    if (!m) throw new Error(`could not lift ${n}() from the live bundle`);
    return m[0];
  });
  // _CR_COST_FIELDS / _CR_COST_LABELS are consts the lifted functions close over.
  const consts = ['_CR_COST_FIELDS', '_CR_COST_LABELS'].map(n => {
    const m = src.match(new RegExp(`\\nconst ${n} = [\\s\\S]*?;\\n`));
    if (!m) throw new Error(`could not lift ${n} from the live bundle`);
    return m[0];
  });
  return new Function(`${consts.join('\n')}\n${parts.join('\n')}\nreturn {${names.join(',')}};`)();
}

const { _payoutBarGeom, _costState, _flipCompleteness, _flipNetOf } =
  lift(['_payoutBarGeom', '_costState', '_flipCompleteness', '_flipNetOf']);

/* Render a whole ranking the way the view does: mode and scale are decided
   across every visible row, then each row gets its geometry. */
function renderRank(nets) {
  const signed = nets.some(n => !(n > 0));
  const maxAbs = nets.reduce((m, n) => Math.max(m, Number.isFinite(n) ? Math.abs(n) : 0), 0);
  return nets.map(n => ({ net: n, ...(_payoutBarGeom(n, maxAbs, signed)) }));
}
const finite = r => Number.isFinite(r.left) && Number.isFinite(r.width);
const inTrack = r => r.left >= -0.001 && r.left + r.width <= 100.001;

console.log('\n── Chart: acceptance requirements ──');

// R1 -- all-negative payouts remain distinguishable.
{
  const rows = renderRank([-3.93, -4.00, -6.45]);
  check('R1 all-negative: every row is finite and inside the track',
    rows.every(r => finite(r) && inTrack(r)),
    JSON.stringify(rows));
  const widths = rows.map(r => r.width.toFixed(3));
  check('R1 all-negative: the three rows are NOT all the same width (P-1 saturation)',
    new Set(widths).size === rows.length,
    `widths=${widths.join(', ')} -- under the old geometry all three clipped to 100%`);
  check('R1 all-negative: worse payout draws a WIDER loss bar, monotonically',
    rows[0].width < rows[1].width && rows[1].width < rows[2].width,
    JSON.stringify(widths));
  check('R1 all-negative: every bar is flagged as a loss',
    rows.every(r => r.neg === true));
}

// R2 -- mixed positive and negative retain their signs.
{
  const rows = renderRank([2, -5, -50, -5000]);
  const pos = rows[0], negs = rows.slice(1);
  check('R2 mixed: the positive row sits at or right of the zero reference',
    pos.left >= 50 - 0.001 && pos.neg === false,
    JSON.stringify(pos));
  check('R2 mixed: every negative row sits strictly left of the zero reference',
    negs.every(r => r.left < 50 - 0.0001 && r.left + r.width <= 50.001 && r.neg === true),
    JSON.stringify(negs));
  check('R2 mixed: a negative is never drawn on the positive side (the P-2 stub)',
    !rows.some(r => r.net < 0 && r.left >= 50));
}

// R3 -- zero produces a finite, valid rendering.
{
  const allZero = renderRank([0, 0, 0]);
  check('R3 all-zero: finite geometry, no NaN width',
    allZero.every(r => finite(r) && r.width > 0 && inTrack(r)),
    JSON.stringify(allZero));
  const bestZero = renderRank([0, -5, -10]);
  check('R3 best-is-zero: finite geometry (the P-3 NaN case)',
    bestZero.every(r => finite(r) && inTrack(r)),
    JSON.stringify(bestZero));
  check('R3 zero row is not drawn as a loss',
    bestZero[0].neg === false && bestZero[0].zero === true);
  // Guard the divide-by-zero directly, not only through a ranking.
  const g = _payoutBarGeom(0, 0, true);
  check('R3 maxAbs of 0 returns finite geometry rather than NaN',
    Number.isFinite(g.left) && Number.isFinite(g.width));
}

// R4 -- numeric amounts and ranking unchanged; all-positive presentation intact.
{
  const rows = renderRank([10, 5, 1]);
  check('R4 all-positive: unsigned mode, bars stay left-anchored',
    rows.every(r => r.left === 0 && r.neg === false),
    JSON.stringify(rows));
  check('R4 all-positive: widths are the old proportional values (100/50/10)',
    rows[0].width === 100 && rows[1].width === 50 && rows[2].width === 10,
    JSON.stringify(rows.map(r => r.width)));
  check('R4 the geometry function returns geometry only -- it cannot alter an amount',
    !('net' in _payoutBarGeom(5, 10, false)) && !('amount' in _payoutBarGeom(5, 10, false)));
}

console.log('\n── Profit records: four-state cost model ──');

check('blank field is recorded as blank, not as a measured zero',
  _costState('').state === 'blank' && _costState('   ').state === 'blank');
check('explicit 0 is recorded as a confirmed zero, distinct from blank',
  _costState('0').state === 'zero' && _costState('0.00').state === 'zero');
check('a positive amount is recorded as a value',
  _costState('12.50').state === 'value' && _costState('12.50').value === 12.5);
check('unusable input is recorded as invalid, not silently 0',
  _costState('abc').state === 'invalid' && _costState('-5').state === 'invalid');
check('all four states are distinguishable from one another',
  new Set(['', '0', '3', 'abc'].map(v => _costState(v).state)).size === 4);

// The distinction the removed `hasCosts` boolean could not draw.
{
  const allZero  = { buyPrice: 'zero',  fees: 'zero',  shippingCost: 'zero',  gradingCost: 'zero'  };
  const oneEntered = { buyPrice: 'value', fees: 'blank', shippingCost: 'blank', gradingCost: 'blank' };
  const allBlank = { buyPrice: 'blank', fees: 'blank', shippingCost: 'blank', gradingCost: 'blank' };
  const a = _flipCompleteness({ costMeta: allZero });
  const b = _flipCompleteness({ costMeta: oneEntered });
  const c = _flipCompleteness({ costMeta: allBlank });
  check('all costs explicitly zero => complete, not provisional',
    a.reason === 'complete' && a.provisional === false && a.missing.length === 0);
  check('one entered while others unknown => provisional, and names the unknowns',
    b.provisional === true && b.missing.length === 3 && b.missing.includes('fees'));
  check('all blank => provisional, and names all four',
    c.provisional === true && c.missing.length === 4);
  check('the three cases are NOT collapsed into one verdict (what hasCosts could not do)',
    new Set([a.reason, b.reason].map(String)).size === 2 &&
    a.missing.length !== b.missing.length && b.missing.length !== c.missing.length);
}

// Historical records must not be retroactively declared confirmed zeros.
{
  const legacy = _flipCompleteness({ buyPrice: 10, sellPrice: 20, profit: 10 });
  check('a record with no costMeta reports untracked, NOT complete',
    legacy.tracked === false && legacy.reason === 'untracked');
  check('an untracked record is treated as provisional, not as confirmed $0 costs',
    legacy.provisional === true);
  check('an untracked record claims no knowledge of WHICH fields are missing',
    legacy.missing.length === 0,
    'inventing a missing-field list for a legacy row would be a different fabrication');
}

// Completeness must travel with the arithmetic, and must not move the numbers.
{
  const r = _flipNetOf({
    sellPrice: 150, buyPrice: 100, fees: 20, shippingCost: 5, gradingCost: 25,
    costMeta: { buyPrice: 'value', fees: 'value', shippingCost: 'value', gradingCost: 'value' },
  });
  check('net arithmetic is unchanged by this work (150-100-20-5-25 = 0)', r.net === 0);
  check('basis arithmetic is unchanged (100+20+5+25 = 150)', r.basis === 150);
  check('a fully-entered record is reported complete', r.completeness === 'complete' && !r.provisional);

  const gap = _flipNetOf({
    sellPrice: 150, buyPrice: 100, fees: 0, shippingCost: 0, gradingCost: 0,
    costMeta: { buyPrice: 'value', fees: 'blank', shippingCost: 'blank', gradingCost: 'zero' },
  });
  check('a record with blanks reports the same net but flags it provisional',
    gap.net === 50 && gap.provisional === true,
    'the number is an upper bound, not a different number');
  check('the missing inputs are named, and a confirmed zero is not among them',
    gap.missingCosts.includes('fees') && gap.missingCosts.includes('shippingCost') &&
    !gap.missingCosts.includes('gradingCost'));
  // Assert the FIELD is gone, not the word: the bundle still explains in
  // comments why the flag was removed, and that prose is worth keeping.
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('the removed hasCosts flag is gone from code rather than left as a false reassurance',
    !('hasCosts' in gap) && !/hasCosts/.test(codeOnly),
    'reading it would have improved copy without fixing the record');
}

console.log(`\npayout-honesty: ${passed} passed, ${failed} failed`);
_finish(passed, failed);

_finish(passed, failed);
