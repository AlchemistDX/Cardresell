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
const srcGradeState = slice('/* \u2500\u2500 BIAS-5 / BIAS-7/8 scoped grading-cost state',
                            'function renderGradingUpside(', 'scoped grading-cost state');
const srcRender    = slice('function renderGradingUpside(', '\nfunction applyGradeFromLadder', 'renderGradingUpside');

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
    `${srcFeeEbay}\n${srcNetForPr}\n${srcProfile}\n${srcGradeState}\n${srcRender}\n` +
    `return { feeEbay, netEbayForPrice, _crSellerProfile, renderGradingUpside,` +
    ` _crSetGradingCost, _crSetGradingGrader, _crGradingScope, _crColumnProvenance,` +
    ` _crGradingCostStore: () => window._crGradingCostStore };`
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
/* BIAS-5 RESOLVED, 2026-09-07 -- option (a) modified: seller-entered cost,
   scoped to (card, grader), with NO numeric default.

   Two earlier generations of assertion lived at this address and both are
   gone. The first pinned `GRADING_FEE = 25` so BIAS-1 could not move it while
   claiming to be routing fees. The second replaced that with "the cost used in
   the arithmetic equals the cost disclosed", which was right as far as it went
   but still assumed a constant existed to disclose.

   There is no constant now, so the checks below are about the STATE MACHINE:
   empty is a real state, entry is scoped, and nothing is ever assumed on the
   seller's behalf. The one thing that must never come back is a default, so
   that is asserted first and directly. */

T.check('BIAS-5: no grading-cost constant survives in the panel',
  !/const GRADING_(FEE|COST)\s*=\s*[\d.]/.test(core),
  'a numeric grading-cost constant is exactly what this decision removed');

T.check('BIAS-5: the rejected $51.99 default is not present as a value',
  !/GRADING[_A-Z]*\s*=\s*51\.99|\|\|\s*51\.99|\?\?\s*51\.99/.test(core),
  '$51.99 was researched and rejected -- it must not appear as a fallback');

T.check('BIAS-5: no ||/?? fallback supplies a number for an unentered cost',
  !/GRADING_COST\s*(\|\||\?\?)/.test(core),
  'an unentered cost must stay null, not coalesce to a number');

/* Cost is entered through the real handler, which re-renders the panel, rather
   than by writing the store directly -- the store is an implementation detail
   and a test that seeded it would pass against a build whose input was
   disconnected. TEST_COST is deliberately NOT a round number and not any
   figure the app could have guessed: if an expectation below still matched
   after the input stopped working, a default would be the only explanation. */
const TEST_COST = 79.99;
// ── the behavioural claim: the rendered net IS the model net ────────────────
// Mirrors the bundle's own formatter. Duplicated deliberately and narrowly: the
// assertion is about the NUMBER reaching the DOM, and the only way to read that
// number back out of the markup is to format an expectation the same way.
const fmt$ = n => (n == null || !isFinite(n)) ? '—' : (n < 0 ? '−$' + Math.abs(n).toFixed(0) : '$' + n.toFixed(0));

/* render(raw, graded, opts) -- drives the panel the way the seller does.
   `cost` undefined leaves the panel in its EMPTY state, which is now a state
   worth rendering rather than an error. Passing a cost calls the production
   change handler, which re-renders into the same element. */
function render(raw, graded, opts) {
  const o = opts || {};
  const a = o.api || api, w = o.win || win;
  w._crGradingCostStore = {}; w._crGradingGraderStore = {};
  const el = { innerHTML: '' };
  const prices = o.prices || { raw, psa_10: graded };
  a.renderGradingUpside(el, { source: 'pricecharting', prices }, 10, 10, {});
  if (o.grader) a._crSetGradingGrader(o.grader);
  if (o.cost !== undefined) a._crSetGradingCost(o.cost);
  return el.innerHTML;
}
// Most numeric cases want a costed panel; this is the common shape.
function renderCosted(raw, graded, opts) {
  return render(raw, graded, Object.assign({ cost: String(TEST_COST) }, opts || {}));
}

const ctx = { ebayStore: 'none', ebayPromo: 0, trsEligible: false };
const modelUpside = (raw, graded) =>
  api.netEbayForPrice(graded, ctx) - api.netEbayForPrice(raw, ctx) - TEST_COST;
const flatUpside = (raw, graded) =>
  // 25 is INTENTIONALLY literal here: this reproduces the RETIRED panel as it
  // actually behaved, so it must not track the current constant. If BIAS-5
  // changes GRADING_FEE, the old panel still subtracted 25.
  graded * 0.87 - raw * 0.87 - 25;

// Prices chosen to straddle the two places a flat rate cannot follow the model:
// the per-order fee step at a $10 order total, and the value-tier boundary at
// $7,500 for a no-store seller.
const cases = [
  [5, 40], [8, 12], [9.99, 60], [10, 45], [12, 500],
  [20, 120], [50, 400], [100, 1200], [400, 8000], [1000, 9000],
];
for (const [raw, graded] of cases) {
  const html = renderCosted(raw, graded);
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
  renderCosted(100, 1200);
  const rawCol = win._lastGradeLadder.grades.find(g => g.key === 'raw');
  // Post-BIAS-5 the absent value is null, not 0. That distinction is the point:
  // 0 is a number the arithmetic could consume, null is a state that stops it.
  T.check('the raw baseline is the model net, and carries no upside of its own',
    rawCol.upsideNet === null && rawCol.upsidePct === null && rawCol.net != null,
    JSON.stringify(rawCol));
  const g10 = win._lastGradeLadder.grades.find(g => g.key === 'psa_10');
  T.check('the baseline subtracted is netEbayForPrice(raw), not raw itself',
    Math.abs((api.netEbayForPrice(1200, ctx) - g10.upsideNet - TEST_COST) - api.netEbayForPrice(100, ctx)) < 0.005,
    `implied baseline ${(api.netEbayForPrice(1200, ctx) - g10.upsideNet - TEST_COST).toFixed(4)}, ` +
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
// The caption now names the cost only once one exists, and names it as the
// seller's. Asserted against rendered output rather than source, because the
// conditional is the behaviour under test.
T.check('copy: a costed panel discloses the entered amount in the caption',
  renderCosted(100, 1200).includes(`$${TEST_COST.toFixed(2)} grading cost you entered`),
  'the entered cost must be disclosed where the net is described');
T.check('copy: an uncosted panel claims no grading cost in the caption',
  !/grading cost you entered/.test(render(100, 1200)),
  'nothing may be disclosed as entered when nothing was entered');


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
  render(100, 3000, { api: a, win: w, cost: String(TEST_COST) });
  const got = w._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet;
  T.check('Basic Store: ladder equals the independently computed $2,566.85',
    Math.abs(got - (2679.10 - 87.25 - TEST_COST)) < 0.005,
    `got ${got.toFixed(4)}, expected ${(2679.10 - 87.25 - TEST_COST).toFixed(4)}`);

  // The same pair on the default profile, computed independently:
  //   graded fvf = 3000 x 0.1325 = 397.50   (below the $7,500 boundary)
  //   graded net = 3000 - 397.50 - 0.40     = 2602.10
  //   raw    net = 100 - 13.25 - 0.40       = 86.35
  //   upside     = 2602.10 - 86.35 - 25     = 2490.75
  const { api: a2, win: w2 } = mkApi({});
  render(100, 3000, { api: a2, win: w2, cost: String(TEST_COST) });
  const dflt = w2._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet;
  T.check('default profile: same pair equals the independently computed $2,490.75',
    Math.abs(dflt - (2602.10 - 86.35 - TEST_COST)) < 0.005,
    `got ${dflt.toFixed(4)}, expected ${(2602.10 - 86.35 - TEST_COST).toFixed(4)}`);
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
  render(100, 1000, { api: a, win: w, cost: String(TEST_COST) });
  const got = w._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet;
  T.check('5% promo: ladder equals the independently computed $710.75',
    Math.abs(got - (817.10 - 81.35 - TEST_COST)) < 0.005,
    `got ${got.toFixed(4)}, expected ${(817.10 - 81.35 - TEST_COST).toFixed(4)}`);

  // Same pair, no promo: 867.10 - 86.35 - 25 = 755.75. The $45.00 gap is the
  // promo charged on both sides (50.00 on graded, 5.00 on raw).
  const { api: a2, win: w2 } = mkApi({});
  render(100, 1000, { api: a2, win: w2, cost: String(TEST_COST) });
  const dflt = w2._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet;
  T.check('no promo: same pair equals the independently computed $755.75',
    Math.abs(dflt - (867.10 - 86.35 - TEST_COST)) < 0.005,
    `got ${dflt.toFixed(4)}, expected ${(867.10 - 86.35 - TEST_COST).toFixed(4)}`);
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
  render(100, 1000, { api: a0, win: w0, cost: String(TEST_COST) });
  const undiscounted = w0._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet;

  for (const fields of [{ ebayTopRated: 'yes' },
                        { ebayTrsListing: 'yes' },
                        { ebayTopRated: 'yes', ebayTrsListing: 'yes' }]) {
    const { api: a, win: w } = mkApi(fields);
    render(100, 1000, { api: a, win: w, cost: String(TEST_COST) });
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




// ══ BIAS-3: conditional language per grade column ═══════════════════════════
// Each column states a dollar figure that only occurs IF the card receives
// that grade. The condition must be named in the column, and must not be
// dressed up as a probability.
{
  const html = renderCosted(100, 3000);

  T.check('BIAS-3: each priced grade column names its condition',
    (html.match(/if 10/g) || []).length >= 1,
    'the graded column must carry an "if <grade>" condition next to its figure');

  T.check('BIAS-3: the raw column is marked as the as-is alternative',
    /sell as-is/.test(html),
    'the raw column is the baseline the others are conditional against');

  T.check('BIAS-3: the section caption disclaims odds',
    /we don.t estimate the odds/i.test(html),
    'conditional figures must not imply we know the grade distribution');

  T.check('BIAS-3: no grade probability is published',
    !/(\d+)\s*% chance|likely to grade|odds of|probability/i.test(html),
    'no invented grade probabilities -- the condition is not a forecast');

  T.check('BIAS-3: the headline names the grade it is conditional on',
    /Best case <em[^>]*>if it grades 10<\/em>/.test(html),
    'the best-case pitch must state which grade produces it');

  T.check('BIAS-3: the headline no longer asserts a grader for the best case',
    !/Best case[^:]*Any grader/.test(html),
    'the old headline read "Best case: Any grader ->", asserting a grader the feed does not break out');

  // A column with no comp has no figure, so it must not carry a bare condition
  // implying a number was withheld for grading reasons rather than data ones.
  const sparse = renderCosted(100, 0);
  T.check('BIAS-3: an unpriced column shows no condition label',
    !/if 10/.test(sparse),
    'a missing comp is a data gap, not a conditional outcome');
}


/* ══ BIAS-3 edge cases: the headline names a grade the ladder can support ════
   Two failure modes are being closed here, and they are different failures.
   The first is naming a grade with no figure behind it -- "best case if it
   grades 10" printed over a 10 column reading "no comp". The second is naming
   the highest grade when a lower one produces the larger net, which is not
   hypothetical: the ladder subtracts one eBay net from another, and the value
   tier boundary can fall between two columns. */
{
  // 10 missing, 9.5 present. The pitch must move to the grade that has a figure.
  const h = renderCosted(0, 0, { prices: { raw: 100, grade_9: 400, grade_95: 900 } });
  T.check('BIAS-3 edge: a missing 10 does not produce an "if it grades 10" headline',
    !/if it grades 10/.test(h), 'the headline named a grade with no comp');
  T.check('BIAS-3 edge: the headline names the actual winning grade instead',
    /Best case <em[^>]*>if it grades 9\.5<\/em>/.test(h), h.slice(h.indexOf('Best case') - 40, h.indexOf('Best case') + 160));

  // 10 present but priced BELOW the 9.5. Highest grade != best outcome.
  const h2 = renderCosted(0, 0, { prices: { raw: 100, grade_95: 1500, psa_10: 900 } });
  T.check('BIAS-3 edge: best case is the largest net, not the highest grade',
    /if it grades 9\.5/.test(h2) && !/if it grades 10<\/em>/.test(h2),
    'the 10 column exists but the 9.5 pays more -- the pitch must follow the money');

  // Every graded comp missing: no conditional best-case claim at all.
  const h3 = renderCosted(0, 0, { prices: { raw: 100 } });
  T.check('BIAS-3 edge: no graded comps renders no best-case claim',
    !/Best case/.test(h3), 'a best-case claim appeared with nothing to support it');
  T.check('BIAS-3 edge: and says why instead of going blank',
    /No graded comps/.test(h3), h3.slice(-400));

  // No raw comp: nothing to compare against, so no claim.
  const h4 = renderCosted(0, 0, { prices: { psa_10: 900 } });
  T.check('BIAS-3 edge: no raw comp renders no best-case claim',
    !/Best case/.test(h4) && /nothing to compare/.test(h4), h4.slice(-400));
}

/* ══ BIAS-5: the empty state is a state, and entry is scoped ════════════════ */
{
  const empty = render(100, 1200);
  T.check('BIAS-5 empty: no upside figure is published before a cost is entered',
    !/Best case/.test(empty), 'an upside was computed with no cost');
  T.check('BIAS-5 empty: the ask is stated in the words the decision specified',
    /Add grading cost to calculate your upside/.test(empty), empty.slice(-500));
  T.check('BIAS-5 empty: the raw comp is still shown',
    empty.includes('>$100</div>'), 'raw comp must remain visible with no cost');
  T.check('BIAS-5 empty: the graded comp is still shown',
    empty.includes('>$1200</div>'), 'graded comp must remain visible with no cost');
  // eBay net per column is required in the empty state -- it is a fact we can
  // support without the seller, so withholding it would be over-correction.
  const nets = (empty.match(/net [−$]/g) || []).length;
  T.check('BIAS-5 empty: an eBay net is shown for each priced column',
    nets >= 2, `found ${nets} net rows, expected one for raw and one for the 10`);
  T.check('BIAS-5 empty: the input starts blank, with no value prefilled',
    /placeholder="your cost"/.test(empty) && !/value="[\d.]+"[^>]*placeholder="your cost"/.test(empty),
    'the cost field must start empty -- a prefilled figure is a default');

  const costed = renderCosted(100, 1200);
  T.check('BIAS-5 entered: the exact amount entered is what gets subtracted',
    Math.abs(win._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet
      - (api.netEbayForPrice(1200, ctx) - api.netEbayForPrice(100, ctx) - TEST_COST)) < 0.005,
    'the subtraction must use the seller\'s number, not a rounded or adjusted one');
  T.check('BIAS-5 entered: it is disclosed as the seller\'s estimate',
    /Grading cost \u2014 seller estimate/.test(costed), costed.slice(-700));
  T.check('BIAS-5 entered: what it includes is stated to be the seller\'s call',
    /What it includes is controlled by you/.test(costed), 'the ownership disclosure is missing');
  T.check('BIAS-5 entered: shipping and insurance are explicitly excluded',
    /Shipping and insurance are not included unless you included them/.test(costed),
    'the postage exclusion is the disclosure most likely to be assumed away');

  // Changed cost: the figure must move by exactly the delta, with no memory of
  // the previous entry surviving in the arithmetic.
  render(100, 1200, { cost: '40' });
  const at40 = win._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet;
  api._crSetGradingCost('90');
  const at90 = win._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet;
  T.check('BIAS-5 changed: re-entering a cost moves the figure by exactly the delta',
    Math.abs((at40 - at90) - 50) < 0.005, `40 -> ${at40.toFixed(2)}, 90 -> ${at90.toFixed(2)}`);

  // Blanking retracts, and must return to empty rather than to a default.
  api._crSetGradingCost('');
  T.check('BIAS-5 changed: blanking the field returns to the empty state, not a default',
    win._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet === null,
    'a retracted estimate must not fall back to a number');

  // Invalid entries: reported, and never silently coerced into arithmetic.
  for (const [bad, why] of [['abc', 'non-numeric'], ['-20', 'negative'], ['1e9', 'absurd'], ['12.3.4', 'malformed']]) {
    render(100, 1200, { cost: bad });
    const g = win._lastGradeLadder.grades.find(x => x.key === 'psa_10');
    T.check(`BIAS-5 invalid (${why}): "${bad}" produces no upside figure`,
      g.upsideNet === null, `got ${g.upsideNet}`);
  }
  const badHtml = render(100, 1200, { cost: 'abc' });
  T.check('BIAS-5 invalid: the seller is told, rather than the entry being dropped',
    /Enter a dollar amount/.test(badHtml), 'an invalid entry must report, not vanish');
  T.check('BIAS-5 invalid: what they typed is preserved so they can correct it',
    /value="abc"/.test(badHtml), 'clearing the field on error hides the mistake');
  // Zero is valid and is NOT the empty state -- a free bulk credit is a real $0.
  render(100, 1200, { cost: '0' });
  T.check('BIAS-5: zero is a valid entered cost, distinct from blank',
    Math.abs(win._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet
      - (api.netEbayForPrice(1200, ctx) - api.netEbayForPrice(100, ctx))) < 0.005,
    'a $0 submission credit is a real cost the seller can state');
}

/* ══ BIAS-5 scope: an estimate does not follow the seller ═══════════════════ */
{
  render(100, 1200, { cost: '79.99' });
  const before = win._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet;
  T.check('scope: the PSA estimate applies while PSA is selected', before !== null, 'setup');

  api._crSetGradingGrader('CGC');
  T.check('scope: switching grader does NOT carry the PSA cost across',
    win._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet === null,
    'a PSA Regular price is not a CGC Economy price -- it must not follow');

  api._crSetGradingCost('20');
  api._crSetGradingGrader('PSA');
  T.check('scope: switching back restores the cost entered for THAT grader',
    Math.abs(win._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet - before) < 0.005,
    'per-grader entries are kept apart, not overwritten by the last one typed');

  // Card scope. A different PriceCharting product is a different analysis.
  const elA = { innerHTML: '' }, elB = { innerHTML: '' };
  api.renderGradingUpside(elA, { source: 'pricecharting', url: 'https://x/a', prices: { raw: 100, psa_10: 1200 } }, 10, 10, {});
  api._crSetGradingCost('79.99');
  api.renderGradingUpside(elB, { source: 'pricecharting', url: 'https://x/b', prices: { raw: 100, psa_10: 1200 } }, 10, 10, {});
  T.check('scope: a cost entered on one card does not appear on another',
    win._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet === null,
    'card B inherited card A\'s estimate');
  T.check('scope: distinct cards produce distinct scope keys',
    api._crGradingScope({ url: 'https://x/a' }, {}) !== api._crGradingScope({ url: 'https://x/b' }, {}),
    'scope keys collided');
}

/* ══ BIAS-7/8: provenance is not inferred from syncKey ══════════════════════ */
{
  T.check('BIAS-7/8: 7, 8 and 9 are non-grader-specific under every selection',
    ['PSA','BGS','CGC','SGC'].every(gr =>
      ['grade_7','grade_8','grade_9'].every(k => api._crColumnProvenance(k, gr) === 'generic')),
    'selecting a grader must not convert an Any-grader comp into that grader\'s comp');
  T.check('BIAS-7/8: the 9.5 column is generic even when BGS or CGC is selected',
    api._crColumnProvenance('grade_95', 'BGS') === 'generic' &&
    api._crColumnProvenance('grade_95', 'CGC') === 'generic',
    'a combined BGS/CGC value is specific to neither');
  T.check('BIAS-7/8: the 10 matches only PSA',
    api._crColumnProvenance('psa_10', 'PSA') === 'match' &&
    ['BGS','CGC','SGC'].every(gr => api._crColumnProvenance('psa_10', gr) === 'mismatch'),
    'PriceCharting breaks out a grader only at the 10');

  // syncKey says psa:9, provenance must not.
  const g9 = (() => { renderCosted(100, 1200, { prices: { raw: 100, grade_9: 400 } });
                      return win._lastGradeLadder.grades.find(g => g.key === 'grade_9'); })();
  T.check('BIAS-7/8: a psa: syncKey does not make the column a PSA comp',
    g9.syncKey === 'psa:9' && g9.provenance === 'generic',
    `syncKey ${g9.syncKey}, provenance ${g9.provenance} -- the key is a UI default, not evidence`);

  const generic = renderCosted(0, 0, { prices: { raw: 100, grade_9: 400 } });
  T.check('BIAS-7/8: a generic-comp upside is labelled as such',
    /\u2020/.test(generic) && /not specific to PSA/.test(generic),
    'an upside off an Any-grader comp must say so');
  T.check('BIAS-7/8: the label names the grader actually selected',
    renderCosted(0, 0, { prices: { raw: 100, grade_9: 400 }, grader: 'CGC' }).includes('not specific to CGC'),
    'the disclosure must track the selection');

  // Mismatch: PSA-10-only comp while costing CGC. Withheld, not labelled.
  const mism = renderCosted(0, 0, { prices: { raw: 100, psa_10: 1200 }, grader: 'CGC' });
  T.check('BIAS-7/8: a PSA-only comp withholds the upside when costing another grader',
    win._lastGradeLadder.grades.find(g => g.key === 'psa_10').upsideNet === null &&
    /PSA-only comp/.test(mism),
    'there is no honest CGC upside to state off a PSA 10 comp');
  T.check('BIAS-7/8: and no best-case claim is made from a withheld column',
    !/Best case/.test(mism), 'the headline must not resurrect a withheld figure');
  T.check('BIAS-7/8: the seller is told how to make it computable',
    /Select PSA above/.test(mism), mism.slice(-400));

  // Column subtitles must not be rewritten by the selection.
  const asPsa = renderCosted(0, 0, { prices: { raw: 100, grade_9: 400 }, grader: 'PSA' });
  T.check('BIAS-7/8: selecting PSA leaves the 9 column labelled Any grader',
    /Any grader/.test(asPsa), 'the source label describes the source, not the selection');
}

T.done();
