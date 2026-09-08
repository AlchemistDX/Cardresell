/*
 * review-fee-dl — the fee breakdown's term/value contract (T2.14).
 *
 * WHAT THIS OWNS. The review screen's fee breakdown is a list of terms and
 * their values, so it is a <dl> of <dt>/<dd> pairs. Three things can break
 * without any number changing:
 *
 *   1. a row rendered as a <div>/<span> pair again, which announces as two
 *      unrelated runs of text instead of a term and its value;
 *   2. the WITHHELD row disappearing -- the Top Rated Plus discount we
 *      deliberately do not apply. Q-A settled the vocabulary for this class:
 *      withheld renders as a present dt/dd pair carrying a stated non-value,
 *      never-had renders as no pair at all. Delete the pair and a deliberate
 *      withholding becomes indistinguishable from a venue that has no such
 *      discount;
 *   3. the qualifier losing its literal space, which is invisible on screen
 *      (CSS margin supplies the gap) and collapses the accessible name to
 *      "Fee base(item)".
 *
 * WHAT IT DOES NOT OWN. Amounts. `fee-truth-offline` and the BIAS work own
 * whether the numbers are right; this file only asserts that whatever the model
 * produced is announced as a term and a value in the right order. A green run
 * here says nothing about the arithmetic.
 *
 * NEVER-HAD IS UNVERIFIED HERE, BY CONSTRUCTION. The screen models exactly one
 * slot (`CR_REVIEW_FEE_SLOT = 'ebay:fixed-price'`) and refuses every other one,
 * so no venue on this surface lacks a Top Rated program. T2.14's two-arm
 * contract is half-covered: the withheld arm is asserted below, the never-had
 * arm needs a second modelled venue and is recorded as open rather than
 * assumed to hold.
 *
 * FALLIBILITY. Per the practice adopted 2026-09-07, and because this guards
 * behaviour that is currently correct rather than fixing a live defect,
 * mutation is the applicable route. Three mutations were run against commit
 * b956c10 and reverted (`js/core.7f9c03ad.js` sha256 verified byte-identical
 * afterwards). Measured, not predicted:
 *
 *   - delete the withheld row from the priced template -> 12 passed / 3 failed
 *     (the three withheld checks, and only those).
 *   - swap the dt/dd in _reviewBasisRow for div/span -> 12 passed / 3 failed:
 *     alternation, the withheld pair, AND the qualifier floor, which reported
 *     "0 qualifier terms found (floor 2)". That third failure is the negative
 *     control doing its job -- without it the space check downstream would have
 *     passed over an empty set and reported ok on markup with no dt at all.
 *   - remove the literal space before the qualifier span -> 14 passed /
 *     1 failed, exactly the space check.
 *
 * An earlier run of these three was INVALID and is recorded because the numbers
 * were briefly believed: the mutation loop's `git checkout` reverted the bundle
 * to HEAD while the T2.14 edits were still uncommitted, so mutations 2 and 3
 * ran against a bundle that had no withheld row at all and their reported
 * failures were artifacts. The work was reapplied and committed BEFORE
 * re-running. Mutation testing requires a commit to revert to; the loss only
 * exists in the space between two commits.
 */

import { harness } from './_assert.mjs';
import { renderFeeBlock, DISCLOSURE, BUNDLE_PATH } from '../tools/review-fee-dl-render.mjs';

const T = harness('review-fee-dl');

/* Negative control before any structural claim. The renderer slices its
   template out of the bundle, so a moved marker yields an empty string and
   every "no bad rows found" assertion below would pass over nothing. */
const priced = renderFeeBlock(40);
const unpriced = renderFeeBlock(null);

T.check(`renderer: produced markup from ${BUNDLE_PATH} (priced ${priced.length}b, unpriced ${unpriced.length}b)`,
  priced.length > 400 && unpriced.length > 200,
  `priced ${priced.length}b / unpriced ${unpriced.length}b -- the template slice ` +
  `is empty or truncated, and every check below would pass vacuously`);

/** Children of the <dl>, in order, as {tag, kind, text}. */
function dlRows(html) {
  const m = html.match(/<dl class="review-fees-table">([\s\S]*?)<\/dl>/);
  if (!m) return null;
  const rows = [];
  for (const el of m[1].matchAll(/<(dt|dd|div|span|p)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    /* Only top-level children matter; the qualifier <span> lives inside a dt.
       Skip anything whose match started inside a previous element by tracking
       consumed offsets. */
    rows.push({
      tag: el[1],
      kind: (el[2].match(/data-fee-row="([^"]*)"/) || [, null])[1],
      text: el[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      raw: el[3],
      at: el.index,
    });
  }
  /* Drop nested matches: a span inside a dt has an offset inside that dt. */
  const top = [];
  let end = -1;
  for (const r of rows) {
    if (r.at < end) continue;
    top.push(r);
    end = r.at + r.raw.length;
  }
  return top;
}

const pricedRows = dlRows(priced);
T.check('priced: the fee breakdown is a <dl class="review-fees-table">',
  pricedRows !== null && pricedRows.length > 0,
  'no <dl class="review-fees-table"> in the priced branch');

/* ── 1. strict dt/dd alternation, matching kinds ────────────────────────── */

const alternationFaults = [];
if (pricedRows) {
  for (let i = 0; i < pricedRows.length; i += 2) {
    const a = pricedRows[i], b = pricedRows[i + 1];
    if (!a || a.tag !== 'dt') alternationFaults.push(`index ${i}: <${a ? a.tag : 'missing'}>, expected <dt>`);
    if (!b || b.tag !== 'dd') alternationFaults.push(`index ${i + 1}: <${b ? b.tag : 'missing'}>, expected <dd>`);
    if (a && b && a.kind !== b.kind) alternationFaults.push(`pair ${i}: dt kind "${a.kind}" vs dd kind "${b.kind}"`);
  }
}
T.check(`priced: every row is a <dt>/<dd> pair with a matching kind (${pricedRows ? pricedRows.length : 0} children)`,
  alternationFaults.length === 0,
  `${alternationFaults.join(' · ')} -- a div/span row announces as two ` +
  `unrelated text runs, not a term and its value`);

T.check('priced: an even number of <dl> children (no orphan term or value)',
  pricedRows && pricedRows.length % 2 === 0,
  `${pricedRows ? pricedRows.length : 0} children -- an odd count means a dt ` +
  `without its dd or the reverse`);

/* ── 2. the withheld pair exists and states a non-value ─────────────────── */

const withheld = (pricedRows || []).filter(r => r.kind === 'withheld');
T.check('priced: the withheld Top Rated Plus row renders as a dt/dd pair',
  withheld.length === 2 && withheld[0].tag === 'dt' && withheld[1].tag === 'dd',
  `found ${withheld.length} children with data-fee-row="withheld" ` +
  `(${withheld.map(r => r.tag).join(', ') || 'none'}) -- with no pair, a discount ` +
  `we deliberately withhold is indistinguishable from a venue that never had one`);

T.check('priced: the withheld row carries a stated non-value, not a computed amount',
  withheld.length === 2 && withheld[1].text === '\u2014',
  `withheld value is ${JSON.stringify(withheld.length === 2 ? withheld[1].text : null)} ` +
  `-- "$0.00" would claim the discount was computed and came to nothing; it was ` +
  `not computed at all`);

T.check('priced: the withheld term names the discount and says it was not applied',
  withheld.length === 2 &&
  withheld[0].text.includes(DISCLOSURE.trsWithheldLabel) &&
  withheld[0].text.includes(DISCLOSURE.trsWithheldQualifier),
  `withheld term is ${JSON.stringify(withheld.length === 2 ? withheld[0].text : null)}`);

/* ── 3. the qualifier's literal space (accessible name, not CSS) ────────── */

const qualRows = (pricedRows || []).filter(r => r.tag === 'dt' && /review-fee-qual/.test(r.raw));
T.check(`priced: ${qualRows.length} qualifier terms found (floor 2: fee base, tax)`,
  qualRows.length >= 2,
  `found ${qualRows.length} -- the qualifier markup changed and the space check below is vacuous`);

const unspaced = qualRows.filter(r => !/\s<span class="review-fee-qual">/.test(r.raw));
T.check('priced: every qualifier is preceded by a literal space in the markup',
  unspaced.length === 0,
  `no space before the qualifier span in: ${unspaced.map(r => r.text).join(' · ')} -- ` +
  `.review-fee-qual{margin-left} supplies the visual gap but contributes nothing ` +
  `to the accessible name, which collapses to "Fee base(item)"`);

const spacedNames = qualRows.map(r => r.text);
T.check('priced: computed term text reads "Label (qualifier)" with the separator',
  spacedNames.every(t => / \(/.test(t)),
  `terms without a spaced parenthetical: ${spacedNames.filter(t => !/ \(/.test(t)).join(' · ')}`);

/* ── 4. the unpriced branch is a skeleton, and says so ──────────────────── */

const unpricedRows = dlRows(unpriced);
T.check('unpriced: still renders the <dl> rather than hiding the breakdown',
  unpricedRows && unpricedRows.length >= 4,
  `${unpricedRows ? unpricedRows.length : 0} children -- an empty shape tells the ` +
  `seller what adding a price buys them; hiding it tells them nothing`);

const unpricedFaults = [];
if (unpricedRows) {
  for (let i = 0; i < unpricedRows.length; i += 2) {
    const a = unpricedRows[i], b = unpricedRows[i + 1];
    if (!a || a.tag !== 'dt') unpricedFaults.push(`index ${i}: <${a ? a.tag : 'missing'}>`);
    if (!b || b.tag !== 'dd') unpricedFaults.push(`index ${i + 1}: <${b ? b.tag : 'missing'}>`);
  }
}
T.check('unpriced: every row is a <dt>/<dd> pair too',
  unpricedFaults.length === 0,
  unpricedFaults.join(' · '));

/* The unpriced branch omits the withheld row, and that is NOT a T2.14
   violation: it omits the tax row and the fee rows as well, so the whole state
   reads as a skeleton rather than as a claim that this venue has no discount.
   Asserted explicitly so the reasoning is recorded rather than inferred from
   the absence of a check. */
T.check('unpriced: omits the withheld row along with tax and fees (skeleton, not a claim)',
  unpricedRows !== null &&
  unpricedRows.filter(r => r.kind === 'withheld').length === 0 &&
  unpricedRows.filter(r => r.kind === 'basis').length === 0 &&
  unpricedRows.filter(r => r.kind === 'fee').length === 0,
  `unpriced kinds present: ${[...new Set((unpricedRows || []).map(r => r.kind))].join(', ')} -- ` +
  `if tax or fee rows appear here while withheld does not, the omission stops ` +
  `reading as a skeleton and starts reading as "no such discount"`);

/* ── 5. seller-facing copy carries no ASCII double hyphen ───────────────── */

T.check('copy: the withheld note uses em dashes, not the codebase\'s comment "--"',
  !/--/.test(DISCLOSURE.trsWithheldNote),
  `literal "--" in seller-facing copy: ${JSON.stringify(DISCLOSURE.trsWithheldNote)}`);

T.check('copy: the estimate note likewise',
  !/--/.test(DISCLOSURE.estimateNote),
  `literal "--" in seller-facing copy: ${JSON.stringify(DISCLOSURE.estimateNote)}`);

T.done();
