/*
 * review-fee-dl-render — render the review screen's fee <dl> from PRODUCTION
 * BYTES, for the dt/dd contract test and the accessibility-tree check.
 *
 * WHY THIS SHAPE. The obvious harness reproduces the markup by calling the row
 * builders in the order the screen calls them. That harness passes when the
 * screen is broken, because the thing under test -- the ORDER and PAIRING of
 * rows in the template -- is exactly the part the harness would be restating
 * from memory. Instance 22 in the pattern corpus is this failure.
 *
 * So the template literal is SLICED OUT OF THE BUNDLE as text and evaluated
 * with the production row builders and the production FEE_DISCLOSURE bound as
 * locals. If someone reorders the rows, deletes the withheld pair, or swaps a
 * dt for a div, this harness renders the change. The only things reproduced are
 * the fee amounts (from the real feeEbay) and the verified pill (stubbed --
 * it is an <a>, outside the <dl>, and not part of the term/value contract).
 */

/*
 * BUNDLE RESOLUTION IS NOT DONE HERE. This file used to read index.html and
 * regex out `js/core.<hash>.js` itself. That was a second implementation of a
 * question tests/_assetRefs.mjs already owns, and it was worse in two ways
 * that only show up during a rename: its pattern accepted any hex length where
 * the convention is exactly 8, and it took the FIRST match, so a document
 * referencing both a live and a retired bundle would have resolved silently to
 * whichever appeared first instead of failing. `resolveCoreBundle` treats zero
 * matches and two matches as errors, which is the behaviour a rename needs.
 * Reuse the helper, do not re-implement its query.
 */
import { readCoreBundle } from '../tests/_assetRefs.mjs';

const bundle = readCoreBundle();
export const BUNDLE_PATH = bundle.rel;
export const BUNDLE_HASH = bundle.nameHash;
const src = bundle.source;

/** Slice a top-level `function name(...) { ... }` by brace matching. */
function fnSource(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found in ${BUNDLE_PATH}`);
  let depth = 0, i = src.indexOf('{', start);
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error(`unbalanced braces for ${name}`);
}

/** Slice a `const NAME = { ... };` object literal by brace matching. */
function constObjSource(name) {
  const start = src.indexOf(`const ${name} = {`);
  if (start < 0) throw new Error(`const ${name} not found`);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error(`unbalanced braces for ${name}`);
}

/* Production helpers, verbatim. */
const helperSrc = [
  fnSource('_draftsEsc'),
  fnSource('_reviewEsc'),
  fnSource('_reviewMoney'),
  fnSource('_reviewFeeRow'),
  fnSource('_reviewBasisRow'),
  fnSource('feeEbay'),
  constObjSource('FEE_DISCLOSURE'),
  "const FEE_UNKNOWN = '\\u2014';",
  /* 2026-09-08. PLATFORMS and the two tax functions are pulled from the bundle
     for the same reason as everything else here: the wording of the tax row is
     now SELECTED BY PRODUCTION CODE from a production field, so a harness that
     stubbed either would be testing its own copy of the decision. This is what
     the earlier "executed the helper and got true" check could not establish --
     that the row the screen RENDERS matches the state the field declares.
     Pulling PLATFORMS also means a classification change (a venue moving from
     false to unknown) shows up in this suite's rendered output. */
  constObjSource('PLATFORMS'),
  fnSource('venueTaxNote'),
  fnSource('_reviewTaxRow'),
  fnSource('venueEstimateNote'),
].join('\n');

const helpers = new Function(
  helperSrc + '; return { _reviewEsc, _reviewMoney, _reviewFeeRow, _reviewBasisRow, feeEbay, FEE_DISCLOSURE, FEE_UNKNOWN, PLATFORMS, venueTaxNote, _reviewTaxRow, venueEstimateNote };'
)();

/* The two template literals, sliced from the bundle as text. Anchored on the
   data-review-fees marker so a rename fails loudly instead of matching the
   wrong branch. */
function sliceTemplate(marker) {
  const at = src.indexOf(`data-review-fees="${marker}"`);
  if (at < 0) throw new Error(`no branch with data-review-fees="${marker}"`);
  const open = src.lastIndexOf('`', at);
  const close = src.indexOf('`;', open + 1);
  if (open < 0 || close < 0) throw new Error(`could not bound the ${marker} template`);
  return src.slice(open + 1, close);
}

export const TEMPLATES = {
  priced:   sliceTemplate('priced'),
  unpriced: sliceTemplate('unpriced'),
};

/** Every pid the shipped PLATFORMS table declares, for state coverage. */
export const PIDS = Object.keys(helpers.PLATFORMS);
/** The production tax decision, for tests that assert state, not markup. */
export const venueTaxNote = helpers.venueTaxNote;
export const venueEstimateNote = helpers.venueEstimateNote;

/**
 * Render one branch. `price` null renders the unpriced branch.
 *
 * `pid` defaults to the pid the live screen is pinned to. It is a PARAMETER so
 * the suite can render the unestablished and suppressed tax states too. Those
 * states are not reachable on the live screen today -- `CR_REVIEW_FEE_SLOT`
 * pins it to eBay -- so rendering them here proves the branch works, NOT that a
 * seller can currently see it. Tests must not claim otherwise.
 */
export function renderFeeBlock(price, profile, pid) {
  const prof = Object.assign({ ebayStore: 'none', ebayPromo: 0 }, profile || {});
  const H = helpers;
  const venue = pid || 'ebay';

  if (price === null || price === undefined) {
    return new Function('_reviewFeeRow', 'pill', 'return `' + TEMPLATES.unpriced + '`')(
      H._reviewFeeRow, '');
  }

  const items = H.feeEbay(price, 0, prof.ebayStore, prof.ebayPromo, false);
  const fees  = items.reduce((s, f) => s + f.a, 0);
  const c = { price, items, fees, net: price - fees };
  const feeRows = c.items
    .map((f) => H._reviewFeeRow('fee', String(f.l || 'Fee'), '\u2212' + H._reviewMoney(f.a)))
    .join('');

  return new Function(
    'c', 'pill', 'feeRows', '_reviewFeeRow', '_reviewBasisRow', '_reviewEsc', '_reviewMoney',
    'FEE_DISCLOSURE', 'FEE_UNKNOWN', '_reviewTaxRow', 'venueEstimateNote', 'pid',
    'return `' + TEMPLATES.priced + '`'
  )(c, '', feeRows, H._reviewFeeRow, H._reviewBasisRow, H._reviewEsc, H._reviewMoney,
    H.FEE_DISCLOSURE, H.FEE_UNKNOWN, H._reviewTaxRow, H.venueEstimateNote, venue);
}

export const DISCLOSURE = helpers.FEE_DISCLOSURE;
