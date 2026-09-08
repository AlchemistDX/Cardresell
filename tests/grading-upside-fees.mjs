/**
 * tests/grading-upside-fees.mjs — BIAS-1: the grade ladder's net upside comes
 * from the shared eBay fee model, not from a local flat percentage.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `renderGradingUpside()` carried `const FEES_PCT = 13` and computed
 * `price * (1 - FEES_PCT/100)` twice — a second implementation of "net after
 * eBay fees", which is the duplicate-implementation bug this repo has been
 * bitten by nine times. It is now routed through `netEbayForPrice(price, ctx)`,
 * the same function the review screen's payout row and the target-net bisection
 * use.
 *
 * The assertions below run the REAL function out of the LIVE bundle rather than
 * grepping for the absence of a string, because "FEES_PCT is gone" is a claim
 * about a surface and "the numbers come from the fee model" is a claim about
 * behaviour. A grep would pass against a build that reintroduced a flat rate
 * under a different name — instance 1 of audit/PATTERN_ASSERTION_SURFACE.md.
 *
 * SCOPE. This file covers BIAS-1 ONLY. It deliberately does NOT assert
 * anything about:
 *   - grade LABELS being conditional on grader (BIAS-3)
 *   - the $25 grading fee agreeing with the server tier table (BIAS-5)
 *   - grader/price-basis compatibility or provenance (BIAS-7, BIAS-8)
 * Those need their own acceptance evidence. `GRADING_FEE = 25` is asserted here
 * as UNCHANGED, so that this suite fails if a later pass silently alters it
 * while claiming to be doing BIAS-1 work.
 */
import { harness } from './_assert.mjs';
import { readCoreBundle } from './_assetRefs.mjs';

const T = harness('grading-upside-fees');
const core = readCoreBundle().source;

// ── extract the real functions out of the live bundle ────────────────────────
function slice(startMarker, endMarker, label) {
  const i = core.indexOf(startMarker);
  T.check(`bundle: ${label} is locatable`, i !== -1, `marker ${JSON.stringify(startMarker)} not found`);
  if (i === -1) return '';
  const j = core.indexOf(endMarker, i);
  T.check(`bundle: ${label} has an end`, j !== -1, `end marker ${JSON.stringify(endMarker)} not found after ${i}`);
  return j === -1 ? '' : core.slice(i, j);
}

const srcFeeEbay   = slice('function feeEbay(',        '\nfunction netEbayForPrice(', 'feeEbay');
const srcNetForPr  = slice('function netEbayForPrice(', '\n/**',                      'netEbayForPrice');
const srcProfile   = slice('function _crSellerProfile(', '\n/* ──',                   '_crSellerProfile');
const srcRender    = slice('function renderGradingUpside(', '\nfunction ',            'renderGradingUpside');

// A DOM stub. getElementById returns null for every id, so _crSellerProfile
// falls through to its own documented defaults: no store, no promoted-listing
// rate. That is the seller-profile default this project settled on (no-store /
// not-Top-Rated / Level 1-4), so the suite measures the default seller, not a
// configuration invented by the test.
const sandbox = {
  document: { getElementById: () => null },
  isFinite,
  Math,
  Number,
  console,
};
// `renderGradingUpside` publishes its computed ladder on
// `window._lastGradeLadder` for the column-tap handler. That is production
// behaviour, not a test hook, and it carries `upsideNet` at full precision --
// so the numeric assertions below compare cents, not the markup's rounded
// dollars. The markup is checked separately, because a number computed
// correctly and never rendered is not a fixed surface.
const win = {};
const build = new Function('document', 'isFinite', 'window',
  `${srcFeeEbay}\n${srcNetForPr}\n${srcProfile}\n${srcRender}\n` +
  `return { feeEbay, netEbayForPrice, _crSellerProfile, renderGradingUpside };`);
const api = build(sandbox.document, isFinite, win);

T.check('the default profile is no-store with no promo rate',
  api._crSellerProfile().ebayStore === 'none' && api._crSellerProfile().ebayPromo === 0,
  JSON.stringify(api._crSellerProfile()));

// ── the surface-level claim, kept as a surface-level claim ───────────────────
T.check('source: no active flat fee percentage remains in the function',
  !/FEES_PCT\s*\/\s*100/.test(core) && !/const\s+FEES_PCT\s*=/.test(core),
  'a flat-rate divisor or constant is still live in the bundle');
T.check('source: the $25 grading fee is UNCHANGED (BIAS-5 is not closed here)',
  /const GRADING_FEE = 25;/.test(core),
  'BIAS-1 must not move the grading fee');

// ── the behavioural claim: the rendered net IS the model net ────────────────
// Mirrors the bundle's own formatter. Duplicated deliberately and narrowly: the
// assertion is about the NUMBER reaching the DOM, and the only way to read that
// number back out of the markup is to format an expectation the same way.
const fmt$ = n => (n == null || !isFinite(n)) ? '—' : (n < 0 ? '−$' + Math.abs(n).toFixed(0) : '$' + n.toFixed(0));

function render(raw, graded) {
  const el = { innerHTML: '' };
  api.renderGradingUpside(el, { source: 'pricecharting', prices: { raw, psa_10: graded } }, 10, 10, {});
  return el.innerHTML;
}

const ctx = { ebayStore: 'none', ebayPromo: 0, trsEligible: false };
const modelUpside = (raw, graded) =>
  api.netEbayForPrice(graded, ctx) - api.netEbayForPrice(raw, ctx) - 25;
const flatUpside = (raw, graded) =>
  graded * 0.87 - raw * 0.87 - 25;

// Prices chosen to straddle the two places a flat rate cannot follow the model:
// the per-order fee step at a $10 order total, and the value-tier boundary at
// $7,500 for a no-store seller.
const cases = [
  [5, 40], [8, 12], [9.99, 60], [10, 45], [12, 500],
  [20, 120], [50, 400], [100, 1200], [400, 8000], [1000, 9000],
];
for (const [raw, graded] of cases) {
  const html = render(raw, graded);
  const want = modelUpside(raw, graded);
  const got  = win._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet;
  T.check(`raw $${raw} -> PSA 10 $${graded}: computed net matches the fee model to the cent`,
    Math.abs(got - want) < 0.005,
    `got ${got.toFixed(4)}, model ${want.toFixed(4)}, flat13 ${flatUpside(raw, graded).toFixed(4)}`);
  T.check(`raw $${raw} -> PSA 10 $${graded}: that figure reaches the markup (${fmt$(want)})`,
    html.includes(`>${fmt$(want)}</div>`),
    `expected ${fmt$(want)} in markup`);
}

// The raw column is the baseline both sides are measured against, so its net
// must come from the same model. It renders as "baseline" rather than a figure,
// which means an error here would be invisible on screen while shifting every
// other column.
{
  render(100, 1200);
  const rawCol = win._lastGradeLadder.grades.find(g => g.key === 'raw');
  T.check('the raw baseline is the model net, and carries no upside of its own',
    rawCol.upsideNet === 0 && rawCol.upsidePct === 0,
    JSON.stringify(rawCol));
  const g10 = win._lastGradeLadder.grades.find(g => g.key === 'psa_10');
  T.check('the baseline subtracted is netEbayForPrice(raw), not raw itself',
    Math.abs((api.netEbayForPrice(1200, ctx) - g10.upsideNet - 25) - api.netEbayForPrice(100, ctx)) < 0.005,
    `implied baseline ${(api.netEbayForPrice(1200, ctx) - g10.upsideNet - 25).toFixed(4)}, ` +
    `netEbayForPrice(100) ${api.netEbayForPrice(100, ctx).toFixed(4)}`);
}

// The discriminator: at least one case must render a figure the OLD flat-rate
// arithmetic could not produce. Without this, every assertion above would still
// pass if someone reverted the routing and the two happened to round alike.
{
  const diverging = cases.filter(([r, g]) =>
    fmt$(modelUpside(r, g)) !== fmt$(flatUpside(r, g)));
  T.check('at least one case distinguishes the model from a flat 13%',
    diverging.length > 0,
    `cases where the two formatters disagree: ${JSON.stringify(diverging)}`);
}

// ── copy: the caption no longer names a rate that no longer exists ──────────
// Standing rule is "fix the function, not the label". This is the case where
// the label had to move too: it stated a specific percentage, and after the
// routing there is no single percentage to state. Keeping "13% sale fees" would
// have been stamping a lie.
T.check('copy: the caption does not claim a flat 13% fee',
  !/13%\s*sale fees/.test(core), 'the caption still names 13%');
T.check('copy: the caption still names the $25 grading fee',
  /\$\$\{GRADING_FEE\} grading fee/.test(core), 'the $25 disclosure was dropped');

T.done();
