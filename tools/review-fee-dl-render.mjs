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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');
const m = indexHtml.match(/src="\/?(js\/core\.[0-9a-f]+\.js)"/);
if (!m) throw new Error('no bundle reference in index.html');
export const BUNDLE_PATH = m[1];
const src = readFileSync(join(ROOT, BUNDLE_PATH), 'utf8');

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
].join('\n');

const helpers = new Function(
  helperSrc + '; return { _reviewEsc, _reviewMoney, _reviewFeeRow, _reviewBasisRow, feeEbay, FEE_DISCLOSURE, FEE_UNKNOWN };'
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

/** Render one branch. `price` null renders the unpriced branch. */
export function renderFeeBlock(price, profile) {
  const prof = Object.assign({ ebayStore: 'none', ebayPromo: 0 }, profile || {});
  const H = helpers;

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
    'FEE_DISCLOSURE', 'FEE_UNKNOWN',
    'return `' + TEMPLATES.priced + '`'
  )(c, '', feeRows, H._reviewFeeRow, H._reviewBasisRow, H._reviewEsc, H._reviewMoney,
    H.FEE_DISCLOSURE, H.FEE_UNKNOWN);
}

export const DISCLOSURE = helpers.FEE_DISCLOSURE;
