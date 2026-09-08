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
// `_crSellerProfile` reads its answers out of the DOM, so a profile is
// expressed here as the set of form values present. `mkApi({})` supplies none
// of them and therefore exercises the documented defaults: no store, not Top
// Rated, no promoted-listing rate -- the seller-profile default this project
// settled on. Passing fields simulates a seller who has filled the form in.
function mkApi(fields) {
  const doc = { getElementById: (id) => (id in fields ? { value: fields[id] } : null) };
  const win = {};
  const api = new Function('document', 'isFinite', 'window',
    `${srcFeeEbay}\n${srcNetForPr}\n${srcProfile}\n${srcRender}\n` +
    `return { feeEbay, netEbayForPrice, _crSellerProfile, renderGradingUpside };`
  )(doc, isFinite, win);
  return { api, win };
}
// `renderGradingUpside` publishes its computed ladder on
// `window._lastGradeLadder` for the column-tap handler. That is production
// behaviour, not a test hook, and it carries `upsideNet` at full precision --
// so the numeric assertions below compare cents, not the markup's rounded
// dollars. The markup is checked separately, because a number computed
// correctly and never rendered is not a fixed surface.
const { api, win } = mkApi({});

T.check('the default profile is no-store with no promo rate',
  api._crSellerProfile().ebayStore === 'none' && api._crSellerProfile().ebayPromo === 0,
  JSON.stringify(api._crSellerProfile()));

// ── the surface-level claim, kept as a surface-level claim ───────────────────
T.check('source: no active flat fee percentage remains in the function',
  !/FEES_PCT\s*\/\s*100/.test(core) && !/const\s+FEES_PCT\s*=/.test(core),
  'a flat-rate divisor or constant is still live in the bundle');
/* TEMPORARY -- REMOVE WHEN BIAS-5 LANDS. ─────────────────────────────────────
   This asserts a KNOWN DEFECT is still present. Its only purpose is to
   document THIS pass's isolation: BIAS-1 moved fee routing and must be shown
   not to have quietly moved the grading cost at the same time.

   $25 is wrong. It contradicts the server's tier table in
   api/grade-opportunity.js:44-52. This assertion must NOT become a standing
   requirement that blocks BIAS-5 from correcting it. When BIAS-5 lands,
   DELETE this check and replace it with the supported-cost behaviour checks:
   costs sourced from the tier table, and grading-only expenses accounted
   separately. A test that pins a defect in place outlives its purpose the
   moment the defect is scheduled for repair. */
T.check('TEMPORARY (BIAS-1 isolation only): the $25 grading fee is unchanged',
  /const GRADING_FEE = 25;/.test(core),
  'BIAS-1 must not move the grading fee; BIAS-5 SHOULD, and should delete this check');

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


/* ── Profile variation: the inputs the new routing introduces ────────────────
   The cases above exercise the default profile only. Routing through the
   shared model added three profile-derived inputs, and each needs its own
   evidence.

   Comparing the renderer against `netEbayForPrice` proves WIRING. It cannot
   prove the intended inputs arrived: a ladder that ignored the store setting
   entirely would still agree with a `netEbayForPrice` call that ignored it
   the same way. So every expectation below is calculated INDEPENDENTLY from
   eBay's published schedule and written as a literal, with the arithmetic
   shown. These literals are fixtures, not a second fee model -- nothing reads
   them but the assertion they sit in.

   Schedule used (https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822):
     no store / Starter : 13.25% up to $7,500, then 2.35% on the excess
     Basic Store and up : 12.35% up to $2,500, then 2.35% on the excess
     per-order fee      : $0.30 when the order total is <= $10, else $0.40
     promoted listings  : order total x rate
   ------------------------------------------------------------------------- */

// A Basic Store profile changes the ladder, AND changes it through the tier
// boundary rather than only through the headline rate. $3,000 is deliberately
// ABOVE the Basic Store boundary ($2,500) and BELOW the no-store one ($7,500),
// so the two profiles cannot agree unless the boundary itself was applied.
//
//   Basic Store, raw $100 -> PSA 10 $3,000
//     graded fvf  = 2500 x 0.1235 + 500 x 0.0235 = 308.75 + 11.75 = 320.50
//     graded net  = 3000 - 320.50 - 0.40                          = 2679.10
//     raw    net  = 100 - (100 x 0.1235) - 0.40 = 100 - 12.35 - 0.40 = 87.25
//     upside      = 2679.10 - 87.25 - 25                          = 2566.85
{
  const { api: a, win: w } = mkApi({ ebayStore: 'basic' });
  a.renderGradingUpside({ innerHTML: '' },
    { source: 'pricecharting', prices: { raw: 100, psa_10: 3000 } }, 10, 10, {});
  const got = w._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet;
  T.check('Basic Store: ladder equals the independently computed $2,566.85',
    Math.abs(got - 2566.85) < 0.005, `got ${got.toFixed(4)}`);

  // The same pair on the default profile, computed independently:
  //   graded fvf = 3000 x 0.1325 = 397.50   (below the $7,500 boundary)
  //   graded net = 3000 - 397.50 - 0.40     = 2602.10
  //   raw    net = 100 - 13.25 - 0.40       = 86.35
  //   upside     = 2602.10 - 86.35 - 25     = 2490.75
  const { api: a2, win: w2 } = mkApi({});
  a2.renderGradingUpside({ innerHTML: '' },
    { source: 'pricecharting', prices: { raw: 100, psa_10: 3000 } }, 10, 10, {});
  const dflt = w2._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet;
  T.check('default profile: same pair equals the independently computed $2,490.75',
    Math.abs(dflt - 2490.75) < 0.005, `got ${dflt.toFixed(4)}`);
  T.check('the store setting actually moves the ladder ($76.10 apart here)',
    Math.abs(got - dflt - 76.10) < 0.005,
    `basic ${got.toFixed(2)} vs default ${dflt.toFixed(2)}`);
}

// A nonzero promoted-listing rate reaches the calculation. Treated as an
// ASSUMPTION, not an observation: nothing here knows whether the seller will
// actually run a campaign on this card, and the ladder does not claim they
// will. What is asserted is only that the stated setting is applied.
//
//   no store, 5% promo, raw $100 -> PSA 10 $1,000
//     graded net = 1000 - 132.50 - 0.40 - (1000 x 0.05) = 1000 - 182.90 = 817.10
//     raw    net = 100 - 13.25 - 0.40 - (100 x 0.05)    = 81.35
//     upside     = 817.10 - 81.35 - 25                  = 710.75
{
  const { api: a, win: w } = mkApi({ ebayPromo: '5' });
  a.renderGradingUpside({ innerHTML: '' },
    { source: 'pricecharting', prices: { raw: 100, psa_10: 1000 } }, 10, 10, {});
  const got = w._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet;
  T.check('5% promo: ladder equals the independently computed $710.75',
    Math.abs(got - 710.75) < 0.005, `got ${got.toFixed(4)}`);

  // Same pair, no promo: 867.10 - 86.35 - 25 = 755.75. The $45.00 gap is the
  // promo charged on both sides (50.00 on graded, 5.00 on raw).
  const { api: a2, win: w2 } = mkApi({});
  a2.renderGradingUpside({ innerHTML: '' },
    { source: 'pricecharting', prices: { raw: 100, psa_10: 1000 } }, 10, 10, {});
  const dflt = w2._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet;
  T.check('no promo: same pair equals the independently computed $755.75',
    Math.abs(dflt - 755.75) < 0.005, `got ${dflt.toFixed(4)}`);
  T.check('the promo setting is applied to BOTH sides ($45.00 apart here)',
    Math.abs(dflt - got - 45.00) < 0.005,
    `promo ${got.toFixed(2)} vs none ${dflt.toFixed(2)}`);

  T.check('a promo rate is read as a number, not concatenated as a string',
    a._crSellerProfile().ebayPromo === 5, JSON.stringify(a._crSellerProfile()));
}

// Neither a GLOBAL Top Rated answer nor an UNRELATED listing confirmation may
// discount this ladder. Top Rated Plus is a per-listing benefit; there is no
// listing here at all, so nothing could carry a per-listing confirmation.
{
  const { api: a0, win: w0 } = mkApi({});
  a0.renderGradingUpside({ innerHTML: '' },
    { source: 'pricecharting', prices: { raw: 100, psa_10: 1000 } }, 10, 10, {});
  const undiscounted = w0._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet;

  for (const fields of [{ ebayTopRated: 'yes' },
                        { ebayTrsListing: 'yes' },
                        { ebayTopRated: 'yes', ebayTrsListing: 'yes' }]) {
    const { api: a, win: w } = mkApi(fields);
    a.renderGradingUpside({ innerHTML: '' },
      { source: 'pricecharting', prices: { raw: 100, psa_10: 1000 } }, 10, 10, {});
    const got = w._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet;
    T.check(`no Top Rated discount reaches the ladder via ${JSON.stringify(fields)}`,
      Math.abs(got - undiscounted) < 0.005,
      `got ${got.toFixed(4)}, undiscounted ${undiscounted.toFixed(4)}`);
  }

  // Non-vacuity: the discount must be capable of moving this number, or the
  // three assertions above would pass against a model that had no TRS support
  // at all. 1000 -> fvf 132.50, x0.9 = 119.25, so net rises by 13.25.
  const ctxTrs = { ebayStore: 'none', ebayPromo: 0, trsEligible: true };
  T.check('the TRS discount is capable of moving the number (so the above has teeth)',
    Math.abs(api.netEbayForPrice(1000, ctxTrs) - api.netEbayForPrice(1000, ctx) - 13.25) < 0.005,
    `trs ${api.netEbayForPrice(1000, ctxTrs).toFixed(2)} vs ` +
    `plain ${api.netEbayForPrice(1000, ctx).toFixed(2)}`);
}

/* ── netEbayForPrice actually CONSUMES the context fields supplied ──────────
   Placing `trsEligible: false` in an object does not prove the function reads
   that property. Each field is probed twice: once with the real key, once
   with a misspelled key. If the misspelled variant produces the same answer
   as omitting the field, the real key is genuinely the one being read -- and
   the misspelling is silent, which is the failure this guards against. */
{
  const base = api.netEbayForPrice(1000, { ebayStore: 'none', ebayPromo: 0, trsEligible: false });
  const probe = (c) => api.netEbayForPrice(1000, { ebayStore: 'none', ebayPromo: 0, trsEligible: false, ...c });

  T.check('netEbayForPrice reads `ebayStore` (basic moves it, ebay_store does not)',
    probe({ ebayStore: 'basic' }) !== base &&
    Math.abs(probe({ ebay_store: 'basic' }) - base) < 0.005,
    `basic ${probe({ ebayStore: 'basic' }).toFixed(2)}, ` +
    `misspelled ${probe({ ebay_store: 'basic' }).toFixed(2)}, base ${base.toFixed(2)}`);

  T.check('netEbayForPrice reads `ebayPromo` (5 moves it, ebayPromoPct does not)',
    probe({ ebayPromo: 5 }) !== base &&
    Math.abs(probe({ ebayPromoPct: 5 }) - base) < 0.005,
    `promo ${probe({ ebayPromo: 5 }).toFixed(2)}, ` +
    `misspelled ${probe({ ebayPromoPct: 5 }).toFixed(2)}`);

  T.check('netEbayForPrice reads `trsEligible` (true moves it, trsEligable does not)',
    probe({ trsEligible: true }) !== base &&
    Math.abs(probe({ trsEligable: true }) - base) < 0.005,
    `true ${probe({ trsEligible: true }).toFixed(2)}, ` +
    `misspelled ${probe({ trsEligable: true }).toFixed(2)}`);

  // This is why the routing resolves a boolean before building ctx: the string
  // 'yes' is truthy in JS but fails the `=== true` test, so it would silently
  // drop the discount rather than raise anything.
  T.check("trsEligible is strict: the string 'yes' does NOT earn the discount",
    Math.abs(probe({ trsEligible: 'yes' }) - base) < 0.005,
    `'yes' ${probe({ trsEligible: 'yes' }).toFixed(2)}, base ${base.toFixed(2)}`);
}

T.done();
