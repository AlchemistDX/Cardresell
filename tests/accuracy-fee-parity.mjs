/*
 * accuracy-fee-parity — the published accuracy page and the shipped fee model
 * must name the same venues and the same audit dates.
 *
 * WHY THIS EXISTS
 *
 * accuracy.html is a static page. Nothing generates it, nothing imports it, and
 * no test read it before this file. It states, in public, when each venue's fees
 * were last verified. The fee model in the bundle carries its own
 * `feeAuditedOn` per venue. Those are two hand-maintained copies of one fact,
 * which is the shape that drifts -- and the drift is silent in the worst
 * direction, because the page keeps claiming a verification date the code no
 * longer backs. "Do not stamp a lie" is the rule this guards.
 *
 * BIDIRECTIONAL ON PURPOSE. Three distinct failures, not one:
 *   - a venue in the model but missing from the page  (we ship a fee we never published)
 *   - a venue on the page but missing from the model  (we publish a venue we cannot price)
 *   - the same venue carrying two different dates     (one of them is false)
 * A one-way check catches the first and sleeps through the other two.
 *
 * TWO TABLES, NOT ONE. accuracy.html publishes a fee table (backed by
 * PLATFORMS) and a cross-border table (backed by CROSS_BORDER). The
 * cross-border table groups four buylist venues into a single row, so ROW COUNT
 * IS NOT VENUE COUNT there -- 12 rows carry 15 venues. A naive row-count parity
 * reports a failure that does not exist. The grouped row is parsed by splitting
 * on the middot separator rather than assuming one venue per row.
 *
 * WHAT THIS DOES NOT CHECK. Venue identity and date only. It does not verify
 * that the fee TEXT on the page describes the arithmetic the model implements
 * -- that is a much harder claim and `fee-truth-offline` owns the parts of it we
 * can express. So a passing run here means "the two surfaces agree about which
 * venues exist and when they were checked", NOT "the published fee descriptions
 * are correct". Recording that limit because a green parity test is exactly the
 * kind of thing that gets read as a broader guarantee than it is -- and a parity
 * assertion defends a shared mistake as energetically as a shared truth.
 *
 * WHAT THIS FILE USED TO ASSERT, AND WHY THAT CHANGED (2026-09-08, T2.9).
 * Until today this file asserted venue identity and audit DATE only. It passed
 * 17/17 across every run while the sales-tax disclosure reached exactly one of
 * fifteen venues, because `taxNote` was not a venue field at all -- it was the
 * statement `items.taxNote = true` inside `feeEbay`. A per-venue parity test
 * cannot notice a missing per-venue value when no per-venue value exists; there
 * was nothing for the fourteen others to disagree about. The tax block below is
 * the assertion that would have caught it, and it is written against the FIELD
 * so that the next venue added is either stamped or red. The date assertions are
 * unchanged; `feeAuditedOn` deliberately did not move for this work, because
 * T2.9 re-read the tax window and not one rate, cap or tier.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { harness } from './_assert.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const T = harness('accuracy-fee-parity');

/* The bundle is content-hashed and gets renamed. Resolve it from index.html
   rather than hardcoding a filename that a rename silently invalidates. */
const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');
/* The tag is `<script defer src="/js/core.<hash>.js">` -- root-relative, with an
   attribute before src. The first version of this regex required `src="js/` and
   matched nothing, which the self-check below caught rather than letting every
   comparison pass over an empty set. */
const bundleMatch = indexHtml.match(/src="\/?(js\/core\.[0-9a-f]+\.js)"/);
T.check('bundle: resolved from index.html rather than hardcoded',
  !!bundleMatch,
  'no <script src="js/core.<hash>.js"> found in index.html');
const bundlePath = bundleMatch ? bundleMatch[1] : null;

const bundle = bundlePath ? readFileSync(join(ROOT, bundlePath), 'utf8') : '';
const accuracy = readFileSync(join(ROOT, 'accuracy.html'), 'utf8');

/* ── model side ─────────────────────────────────────────────────────────── */

function sliceObject(src, decl, endMarker) {
  const a = src.indexOf(decl);
  if (a < 0) return '';
  const b = src.indexOf(endMarker, a);
  return src.slice(a, b < 0 ? src.length : b);
}

const platformsBlk = sliceObject(bundle, 'const PLATFORMS = {', '\nconst CROSS_BORDER');
const crossBlk     = sliceObject(bundle, 'const CROSS_BORDER = {', '\n// 2026-09-01: Stale-fee');

const modelVenues = new Map();   // key -> { name, date }
for (const m of platformsBlk.matchAll(
  /^ {2}(\w+):\s*\{\s*name:\s*'([^']+)'[\s\S]*?feeAuditedOn:\s*'([^']*)'/gm)) {
  modelVenues.set(m[1], { name: m[2], date: m[3] });
}

/* Self-check BEFORE any comparison. A parser that matches nothing makes every
   set-difference below empty, and "no differences" is indistinguishable from
   "in perfect agreement". This is the same vacuity that made the contrast sweep
   pass over zero nodes on 2026-09-07. Assert we found something to compare. */
T.check(`model: parsed ${modelVenues.size} venues from PLATFORMS (floor 10)`,
  modelVenues.size >= 10,
  `parsed ${modelVenues.size} -- parser is broken or PLATFORMS moved; every ` +
  `comparison below would pass vacuously`);

const undated = [...modelVenues].filter(([, v]) => !v.date).map(([k]) => k);
T.check('model: every venue carries a feeAuditedOn stamp',
  undated.length === 0,
  `unstamped: ${undated.join(', ')}`);

/* ── tax treatment (T2.9 / BIAS-10) ─────────────────────────────────────── */
/*
 * Two claims, and they are different claims:
 *   1. every venue CARRIES a `taxOn` -- so "never considered" cannot masquerade
 *      as "checked and does not apply", which is the hole BIAS-10 named;
 *   2. the disclosure renders iff `taxOn !== false` -- so only an established
 *      fee-base answer can suppress the seller-facing caveat.
 *
 * "CONFIRMED ZERO" WAS THE WRONG NAME FOR `false` (2026-09-08, review). It was
 * read, including by the author of this file, as "the buyer paid no tax". It
 * means something narrower: no fee base this model charges against can contain
 * buyer tax -- because the venue publishes the fee as tax-exclusive, or because
 * this model charges the seller no fee at all. The renamed vocabulary below
 * carries that distinction so the next reader cannot make the same inference.
 *
 * Claim 2 is checked by EXECUTING the shipped `venueTaxNote` against the
 * shipped PLATFORMS, not by regex-matching its body. A regex would assert the
 * source looks right; evaluating asserts the function behaves right, and those
 * come apart the moment anyone edits it. `taxBasis` is checked too, because an
 * answer without a recorded basis is how `false` stops meaning what it says.
 */
const TAX_ON     = new Set(['true', 'false', "'unknown'"]);
/* `no-buyer-tax` was RETIRED, not renamed for style. It asserted a fact about
   the buyer's tax that none of the four venues carrying it had established --
   three were inferred from "there is no retail checkout", which is not a tax
   determination, and the fourth (TCG Bulk) was inferred from "the venue is the
   buyer", which its own terms deny. `no-seller-fee` states what the repo can
   actually establish from its own code: this model charges no fee here, so
   there is no fee base for tax to enter. Leaving the old string out of the
   vocabulary is what stops it being reintroduced. */
const TAX_BASIS  = new Set(['published-inclusive', 'published-exclusive',
                            'no-seller-fee', 'payment-method', 'unstated']);

const taxFields = new Map();     // key -> { on, basis }
for (const m of platformsBlk.matchAll(
  /^ {2}(\w+)\s*:\s*\{[\s\S]*?\n\s*taxOn:\s*(true|false|'unknown'),\s*taxBasis:\s*'([^']*)'/gm)) {
  taxFields.set(m[1], { on: m[2], basis: m[3] });
}

const noTax = [...modelVenues.keys()].filter(k => !taxFields.has(k));
T.check('tax: every venue in PLATFORMS carries a taxOn + taxBasis',
  modelVenues.size > 0 && noTax.length === 0,
  `missing the field entirely: ${noTax.join(', ') || '(none -- but PLATFORMS parsed empty)'}`);

const badVal = [...taxFields].filter(([, v]) => !TAX_ON.has(v.on) || !TAX_BASIS.has(v.basis));
T.check('tax: every taxOn and taxBasis is one of the declared values',
  badVal.length === 0,
  `off-vocabulary: ${badVal.map(([k, v]) => `${k}=${v.on}/${v.basis}`).join(', ')}`);

/* A `false` may only rest on a basis that actually establishes the exclusion.
   This is the guard that keeps "the page never mentioned tax" from being
   written down as an answer -- the exact substitution T2.9 exists to prevent.
   It enforces CONSISTENCY between a field and its recorded basis; it cannot
   establish that the basis is true of the venue. That is a source question and
   is answered in audit/d3/TAX_TREATMENT_T2_9.md, not here. */
const SETTLED_BASES = new Set(['published-exclusive', 'no-seller-fee']);
const weakZero = [...taxFields].filter(([, v]) => v.on === 'false' && !SETTLED_BASES.has(v.basis));
T.check('tax: taxOn:false only ever rests on a basis that establishes the exclusion',
  weakZero.length === 0,
  `excluded on a non-establishing basis: ${weakZero.map(([k, v]) => `${k}=${v.basis}`).join(', ')}`);

/* `no-seller-fee` is a claim ABOUT THIS MODEL, so this file can check it: the
   venue must reach feeBuylist without a serviceFeePct argument. TCG Bulk is the
   counter-example that gives this check teeth -- it passes 0.10, which is why it
   may not carry this basis. Without this, `no-seller-fee` would be as
   unfalsifiable as the string it replaced. */
const feeFreeClaim = [...taxFields].filter(([, v]) => v.basis === 'no-seller-fee').map(([k]) => k);
const feeFreeBroken = feeFreeClaim.filter((k) => {
  const m = bundle.match(new RegExp(`feeBuylist\\(price,\\s*PLATFORMS\\.${k}\\.buylistRatio\\.cash([^)]*)\\)`));
  return !m || /,/.test(m[1]);
});
T.check(`tax: every no-seller-fee venue (${feeFreeClaim.length}) really charges no modelled fee`,
  feeFreeClaim.length > 0 && feeFreeBroken.length === 0,
  `claims no seller fee but passes a serviceFeePct (or was not found): ${feeFreeBroken.join(', ')}`);

/* The hardcoded line must be GONE, not merely superseded. Two implementations
   of one behaviour is the bug this repo has been bitten by nine times, and a
   dead `items.taxNote = true` left in `feeEbay` would be exactly that. */
/* ANCHORED TO LINE START, and that is not cosmetic. The first version of this
   check was `/items\.taxNote\s*=/` and it FAILED -- on the docblock above
   `venueTaxNote`, which explains the removal by quoting the removed line. The
   assertion matched its own explanation. A substring search for deleted code
   cannot tell code from prose about code, so it must be anchored where a
   statement can actually appear. */
T.check('tax: the hardcoded `items.taxNote = true` no longer exists as a statement',
  !/^\s*items\.taxNote\s*=/m.test(bundle),
  'feeEbay still sets taxNote directly -- two implementations of one venue fact');

T.check('tax: the render reads the disclosure from venueTaxNote(pid)',
  /taxNote:\s*venueTaxNote\(p\.pid\)/.test(bundle),
  'the render no longer sources taxNote from the shared helper');

/* The second surface. The D3 review screen builds its own fee table and used to
   emit the sales-tax row unconditionally -- right only because that screen is
   pinned to `ebay:fixed-price` and eBay is `taxOn: true`. Two implementations
   agreeing by coincidence of scope is the thing rule 1 forbids, so this asserts
   the review screen routes through the same helper. It names the behaviour
   ("both surfaces decide it the same way") and evidences the review-screen
   render site specifically, because the tile-render assertion above cannot see
   this one. */
T.check('tax: the review screen also gates its tax row on venueTaxNote(pid)',
  /function _reviewTaxRow\(pid\)\s*\{[\s\S]{0,200}?venueTaxNote\(pid\)/.test(bundle)
  && /\$\{_reviewTaxRow\(pid\)\}/.test(bundle),
  'the review screen emits the sales-tax row without consulting the shared helper');

T.check('tax: no unconditional _reviewBasisRow tax row survives',
  !/\$\{_reviewBasisRow\(FEE_DISCLOSURE\.taxLabel/.test(bundle),
  'an ungated review-screen tax row is still in the bundle');

/* Behaviour, executed. Build the shipped PLATFORMS and the shipped helper in a
   sandbox and ask it about every venue. */
let taxNoteFor = null;
try {
  const helperSrc = bundle.slice(bundle.indexOf('function venueTaxNote(pid)'));
  const helper = helperSrc.slice(0, helperSrc.indexOf('\n}') + 2);
  /* FEE_DISCLOSURE is now a dependency of the helper, because the WORDING moved
     in with the decision. Sliced from the bundle rather than stubbed -- a stub
     would let the shipped qualifiers drift from what this suite reads. */
  const discAt = bundle.indexOf('const FEE_DISCLOSURE = {');
  const disc = bundle.slice(discAt, bundle.indexOf('\n};', discAt) + 3);
  taxNoteFor = new Function(`${platformsBlk}\n${disc}\n${helper}\nreturn venueTaxNote;`)();
} catch (e) {
  taxNoteFor = null;
}
T.check('tax: PLATFORMS + venueTaxNote evaluate, so the check below is not vacuous',
  typeof taxNoteFor === 'function',
  'could not evaluate the shipped table and helper together');

if (typeof taxNoteFor === 'function') {
  const wrong = [...taxFields].filter(([k, v]) => !!taxNoteFor(k) !== (v.on !== 'false'));
  T.check('tax: disclosure renders if and only if taxOn !== false, for all 15 venues',
    taxFields.size > 0 && wrong.length === 0,
    `disagreement on: ${wrong.map(([k, v]) => `${k} (taxOn=${v.on}, renders=${!!taxNoteFor(k)})`).join(', ')}`);

  /* STATE, not just presence. The helper now picks the WORDING, and the whole
     point of the review correction is that a known omission and an
     unestablished treatment must not read the same. `true` must yield the
     conceding qualifier; `'unknown'` must yield the non-committal one. */
  const stateWrong = [...taxFields].filter(([k, v]) => {
    const n = taxNoteFor(k);
    if (v.on === 'false') return n !== null;
    return n.state !== (v.on === 'true' ? 'included' : 'unestablished');
  });
  T.check('tax: the note state follows taxOn (included / unestablished / none)',
    stateWrong.length === 0,
    `wrong state: ${stateWrong.map(([k, v]) => `${k} taxOn=${v.on} -> ${JSON.stringify(taxNoteFor(k))}`).join(', ')}`);

  const unkNote = taxNoteFor('cardmarket');
  T.check('tax: an unestablished treatment does not read as a known omission',
    unkNote && unkNote.qualifier !== taxNoteFor('ebay').qualifier
    && /not established/i.test(unkNote.qualifier),
    `unknown venues reuse the known-omission wording: ${JSON.stringify(unkNote)}`);

  /* Cardmarket's tax is VAT, normally already inside the item price. Naming it
     "Buyer sales tax" made a US-shaped claim about a European venue. */
  T.check('tax: Cardmarket names VAT rather than US sales tax',
    /VAT/.test(taxNoteFor('cardmarket').label)
    && !/sales tax/i.test(taxNoteFor('cardmarket').label),
    `Cardmarket label is ${JSON.stringify(taxNoteFor('cardmarket').label)}`);

  T.check('tax: TCG Bulk is unestablished, not excluded (its 10% fee has a base)',
    taxNoteFor('tcgbulk') && taxNoteFor('tcgbulk').state === 'unestablished',
    'TCG Bulk suppresses the caveat again -- the intermediary premise was withdrawn');

  /* Fail-closed, asserted rather than assumed. An unrecognised venue must SHOW
     the caveat; a helper that returned false here would hide a disclosure for
     every venue it failed to find. */
  T.check('tax: an unrecognised venue still renders the disclosure (fails closed)',
    !!taxNoteFor('no-such-venue-xyz')
    && taxNoteFor('no-such-venue-xyz').state === 'unestablished',
    'an unknown pid suppresses the caveat -- fails OPEN');

  const rendering = [...taxFields.keys()].filter(k => taxNoteFor(k)).length;
  T.check(`tax: the disclosure reaches ${rendering} venues, not one`,
    rendering > 1,
    `only ${rendering} venue(s) render it -- BIAS-10's single-venue state has returned`);
}

/* ── page side, table 1: fees ───────────────────────────────────────────── */

/* SLICE END MOVED 2026-09-08, and it was passing by luck before that.
 *
 * The end marker used to be the cross-border table's header. T2.9 inserted a
 * THIRD table (sales tax and the fee base) between the fee table and the
 * cross-border one, so that slice silently grew to cover fifteen extra rows.
 * The run still reported `parsed 15 venues` and full parity -- not because the
 * slice was right, but because the tax rows' third cell contains an `<a>` and
 * failed the row regex's `([^<]+)` on the date column. A parse that survives on
 * the shape of a neighbouring table's markup is one edit away from counting
 * thirty venues and comparing the wrong dates. Ending at the tax section makes
 * the boundary a stated intent rather than an accident, and the floor + named
 * anchors below still catch the case where this marker itself goes missing. */
const FEE_TABLE_END = '<h3>Sales tax and the fee base</h3>';
T.check('page: the fee table has an explicit end boundary before the tax table',
  accuracy.includes(FEE_TABLE_END),
  `"${FEE_TABLE_END}" not found -- the slice would run past the fee table again`);
const feeTable = accuracy.slice(
  accuracy.indexOf('<th>Venue</th><th>Fee model</th>'),
  accuracy.includes(FEE_TABLE_END)
    ? accuracy.indexOf(FEE_TABLE_END)
    : accuracy.indexOf('<th>Venue</th><th>Operator</th>'));

const pageFees = new Map();      // display name -> date string
for (const row of feeTable.matchAll(/<tr><td>([^<]+)<\/td><td>[\s\S]*?<\/td><td>([^<]+)<\/td>/g)) {
  pageFees.set(row[1].trim(), row[2].trim());
}

T.check(`page: parsed ${pageFees.size} venues from the fee table (floor 10)`,
  pageFees.size >= 10,
  `parsed ${pageFees.size} -- the fee table markup changed shape`);

/* Display names differ from model keys by design ("Star City Games (buylist)"
   on the page vs name 'Star City Games' in the model). Normalise rather than
   demanding the strings match, so a copy edit to a label is not a test failure
   -- but keep the mapping explicit so a NEW venue cannot slip through by simply
   not matching anything. */
const norm = s => s.toLowerCase()
  .replace(/\s*\((buylist|aggregator)\)\s*/g, '')
  .replace(/[^a-z0-9]/g, '');

/* NAMED ANCHORS, not a pinned count.
 *
 * 2026-09-07. The floor above proves the parser found SOMETHING. It does not
 * prove it found the right things: a floor of 10 still passes if five venues
 * vanish from the model and the page together, because parity between two
 * equally-wrong surfaces is still parity. The external reviewer asked for a
 * pinned count ("assert it found 15 rows") plus a known-venue presence check.
 * We are taking the second and declining the first, because a pinned count is
 * filed in this corpus as instance 19 -- `minors-011-012-013` pinned 125 gold
 * text usages, found 130, and reported an IMPROVEMENT as a defect. Adding a
 * sixteenth venue is the same shape of improvement, and it must not turn this
 * file red.
 *
 * Anchors give what the pin was reaching for -- identity rather than
 * cardinality -- and survive growth. They are chosen as the three venues a
 * removal would be least likely to be deliberate about: the default venue, the
 * TCG-native marketplace, and the one consignment venue.
 *
 * FALLIBILITY DEMONSTRATED, not assumed. Per the practice adopted 2026-09-07,
 * a guard does not count until observed failing. This one guards a defect that
 * has never occurred, so neither the stash-the-fix nor the assertion-first
 * route applies and mutation is the remaining option. Two mutations were run
 * and reverted (`js/core.7f9c03ad.js` verified byte-identical afterwards by
 * sha256):
 *
 *   1. ONE-SIDED: renamed `eBay` -> `eBoy` in the fee table only.
 *      Result 12 passed / 5 failed. The pre-existing directional checks catch
 *      this on their own, so it does NOT justify these assertions.
 *
 *   2. SYMMETRIC: removed eBay from the fee table, the cross-border table,
 *      PLATFORMS and CROSS_BORDER -- the deletion a careless refactor makes.
 *      Result 15 passed / 2 failed, and the only two failures were these two
 *      anchor checks. Every pre-existing assertion reported ok: both
 *      directional parity checks (two surfaces that agree about 14 venues do
 *      agree), both floors (14 >= 10), and the cross-border pair.
 *
 * Mutation 2 is the reason this exists. The product's DEFAULT venue can be
 * deleted from its published fee table and its fee model together, and a
 * 15-assertion bidirectional parity suite stays green, because parity between
 * two equally-wrong surfaces is still parity. */
const ANCHORS = ['eBay', 'TCGplayer', 'Fanatics Collect'];

const pageAnchorsMissing = ANCHORS.filter(a => ![...pageFees.keys()].some(n => norm(n) === norm(a)));
T.check(`page: named anchor venues present (${ANCHORS.join(', ')})`,
  pageAnchorsMissing.length === 0,
  `absent from the fee table: ${pageAnchorsMissing.join(', ')} -- the parser ` +
  `met its floor while missing a venue we know is published, so the floor was ` +
  `measuring quantity and not identity`);

const modelAnchorsMissing = ANCHORS.filter(a => ![...modelVenues.values()].some(v => norm(v.name) === norm(a)));
T.check(`model: named anchor venues present (${ANCHORS.join(', ')})`,
  modelAnchorsMissing.length === 0,
  `absent from PLATFORMS: ${modelAnchorsMissing.join(', ')} -- a symmetric ` +
  `deletion from both surfaces keeps every parity check green, and only a ` +
  `named check catches it`);

const modelByNorm = new Map([...modelVenues].map(([k, v]) => [norm(v.name), { key: k, ...v }]));
const pageByNorm  = new Map([...pageFees].map(([n, d]) => [norm(n), { label: n, date: d }]));

/* ISO in the model, "Sep 1, 2026" on the page. Compare as dates, not strings. */
const MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
function pageDateToISO(s) {
  const m = s.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return null;
  const mo = MONTHS[m[1].toLowerCase()];
  if (mo == null) return null;
  return `${m[3]}-${String(mo + 1).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`;
}

/* Prove the date parser rejects malformed input rather than returning something
   falsy that a comparison would treat as "no date, skip". */
T.check('date parser: converts the published format',
  pageDateToISO('Sep 1, 2026') === '2026-09-01',
  `got ${pageDateToISO('Sep 1, 2026')}`);
T.check('date parser: returns null on an unparseable stamp rather than guessing',
  pageDateToISO('sometime last week') === null && pageDateToISO('2026-09-01') === null,
  'a malformed stamp must not silently become a valid date');

/* ── direction 1: model -> page ─────────────────────────────────────────── */

const missingFromPage = [...modelByNorm.keys()].filter(k => !pageByNorm.has(k));
T.check('every venue the model prices is published on the accuracy page',
  missingFromPage.length === 0,
  `in PLATFORMS but absent from the fee table: ${missingFromPage.join(', ')} ` +
  `-- we would be shipping a fee we never published`);

/* ── direction 2: page -> model ─────────────────────────────────────────── */

const missingFromModel = [...pageByNorm.keys()].filter(k => !modelByNorm.has(k));
T.check('every venue the accuracy page publishes exists in the fee model',
  missingFromModel.length === 0,
  `on the fee table but absent from PLATFORMS: ${missingFromModel.join(', ')} ` +
  `-- we would be publishing a venue we cannot price`);

/* ── direction 3: dates agree ───────────────────────────────────────────── */

const dateMismatches = [];
const unparseable = [];
for (const [k, m] of modelByNorm) {
  const p = pageByNorm.get(k);
  if (!p) continue;                       // already reported by direction 1
  const iso = pageDateToISO(p.date);
  if (iso === null) { unparseable.push(`${p.label} -> "${p.date}"`); continue; }
  if (iso !== m.date) dateMismatches.push(`${p.label}: page ${iso} vs model ${m.date}`);
}

T.check('every published "last verified" date is parseable',
  unparseable.length === 0,
  `unparseable stamps (an unreadable date is not a passing date): ${unparseable.join(' · ')}`);

T.check('every venue carries the same audit date on both surfaces',
  dateMismatches.length === 0,
  `date drift: ${dateMismatches.join(' · ')} -- one of the two is false`);

/* ── table 2: cross-border ──────────────────────────────────────────────── */

const crossVenues = new Set(
  [...crossBlk.matchAll(/^ {2}(\w+):\s*\{/gm)].map(m => m[1]));

T.check(`model: parsed ${crossVenues.size} venues from CROSS_BORDER (floor 10)`,
  crossVenues.size >= 10,
  `parsed ${crossVenues.size} -- parser is broken or CROSS_BORDER moved`);

const crossTable = accuracy.slice(accuracy.indexOf('<th>Venue</th><th>Operator</th>'));
const crossPageNames = [];
for (const row of crossTable.matchAll(/<tr><td>([^<]+)<\/td><td>/g)) {
  /* ONE ROW CAN CARRY SEVERAL VENUES. The buylist row groups four behind a
     middot separator, so row count is not venue count and splitting is not
     optional. Assuming one-venue-per-row here reports four phantom absences. */
  for (const part of row[1].split(/\s*(?:·|&middot;)\s*/)) {
    const t = part.trim();
    if (t) crossPageNames.push(t);
  }
}

T.check('cross-border table: the grouped buylist row is split, not counted as one venue',
  crossPageNames.length > crossTable.split('<tr><td>').length - 1,
  `parsed ${crossPageNames.length} venue names from ` +
  `${crossTable.split('<tr><td>').length - 1} rows -- if these are equal the ` +
  `grouped row was not split and four venues are being missed`);

const crossPageNorm = new Set(crossPageNames.map(norm));
const crossModelNorm = new Map([...crossVenues]
  .filter(k => modelVenues.has(k))
  .map(k => [norm(modelVenues.get(k).name), k]));

const xMissingFromPage = [...crossModelNorm.keys()].filter(k => !crossPageNorm.has(k));
T.check('every venue in CROSS_BORDER appears in the published cross-border table',
  xMissingFromPage.length === 0,
  `in CROSS_BORDER but absent from the table: ${xMissingFromPage.join(', ')}`);

const xMissingFromModel = [...crossPageNorm].filter(k => !crossModelNorm.has(k));
T.check('every venue in the published cross-border table exists in CROSS_BORDER',
  xMissingFromModel.length === 0,
  `on the table but absent from CROSS_BORDER: ${xMissingFromModel.join(', ')}`);

/* ── the two model structures must cover the same venues ────────────────── */

const platOnly  = [...modelVenues.keys()].filter(k => !crossVenues.has(k));
const crossOnly = [...crossVenues].filter(k => !modelVenues.has(k));
/* Non-emptiness is part of the assertion, not a precondition of it. Two empty
   sets are equal, so without this the check reports `ok` in precisely the case
   where it knows nothing -- which is what it did on the first run while the
   bundle regex was broken. */
T.check('PLATFORMS and CROSS_BORDER cover the same non-empty venue set',
  modelVenues.size > 0 && crossVenues.size > 0 &&
  platOnly.length === 0 && crossOnly.length === 0,
  `sizes ${modelVenues.size}/${crossVenues.size} · ` +
  `priced but no cross-border entry: [${platOnly.join(', ')}] · ` +
  `cross-border entry but not priced: [${crossOnly.join(', ')}]`);

/* ── page side, table 3: sales tax and the fee base ─────────────────────── */
/*
 * T2.9 published the fifteen tax answers on accuracy.html, which makes them a
 * SECOND HAND-MAINTAINED COPY of `taxOn` -- the exact shape this whole file
 * exists to guard, created by the work that closes BIAS-10. Writing "the parity
 * guard does not cover this table" in a comment would have been an accurate
 * description of an avoidable gap; a fact recorded as prose next to the surface
 * that could enforce it is instance 22 all over again. So it is enforced.
 *
 * Bidirectional, same three failures as the fee table: a venue the model taxes
 * but the page omits, a venue the page publishes but the model does not carry,
 * and a venue whose two surfaces give different answers.
 */
const taxSection = accuracy.slice(
  accuracy.indexOf(FEE_TABLE_END),
  accuracy.indexOf('<h3>International &amp; cross-border selling</h3>'));

/* USED TO BE `(Yes|No|Unknown)` (changed 2026-09-08, review). The published
   column gained a fourth answer, "No fee to charge it on", because the three
   buylists reach `false` by a different route than Mercari and CardNexus do:
   not "the venue publishes a tax-exclusive base" but "this model charges no fee
   here, so there is no base". Both map to `taxOn: false`, and the parser must
   accept both -- a closed three-word alternation would have silently dropped
   those rows to 12 parsed, cleared the floor of 10, and passed vacuously on the
   exact venues this review pass corrected. The alternation stays CLOSED (no
   `[^<]+`) so a genuinely new answer still fails loudly instead of being
   mapped to a default. */
const PAGE_TAX = {
  'yes': 'true',
  'no': 'false',
  'no fee to charge it on': 'false',
  'unknown': "'unknown'",
};
const pageTax = new Map();       // normalised display name -> taxOn literal
for (const row of taxSection.matchAll(
  /<tr><td>([^<]+)<\/td><td><strong>(Yes|No fee to charge it on|No|Unknown)<\/strong><\/td>/g)) {
  pageTax.set(norm(row[1]), PAGE_TAX[row[2].toLowerCase()]);
}

T.check(`page: parsed ${pageTax.size} venues from the sales-tax table (floor 10)`,
  pageTax.size >= 10,
  `parsed ${pageTax.size} -- the tax table markup changed shape, and every ` +
  `comparison below would pass vacuously`);

const modelTaxByName = new Map(
  [...taxFields].map(([k, v]) => [norm(modelVenues.get(k)?.name || k), v.on]));

const taxPageOnly  = [...pageTax.keys()].filter(k => !modelTaxByName.has(k));
const taxModelOnly = [...modelTaxByName.keys()].filter(k => !pageTax.has(k));
T.check('tax: the published tax table and the model cover the same venue set',
  pageTax.size > 0 && modelTaxByName.size > 0 &&
  taxPageOnly.length === 0 && taxModelOnly.length === 0,
  `on the page but not in the model: [${taxPageOnly.join(', ')}] \u00b7 ` +
  `in the model but not published: [${taxModelOnly.join(', ')}]`);

const taxDisagree = [...pageTax].filter(([k, v]) =>
  modelTaxByName.has(k) && modelTaxByName.get(k) !== v);
T.check('tax: every venue gives the same tax answer on both surfaces',
  taxDisagree.length === 0,
  taxDisagree.map(([k, v]) => `${k}: page=${v} model=${modelTaxByName.get(k)}`).join(' \u00b7 '));

/* The prose above the table states the split as a count. A number written by
   hand beside a table generated from the same facts is a stamp, and a stamp
   that disagrees with the model is a lie regardless of how small it is. */
const counts = { true: 0, false: 0, "'unknown'": 0 };
for (const [, v] of taxFields) counts[v.on]++;
const renderCount = counts.true + counts["'unknown'"];
/* EXACT strings, no lenient fallback. The first draft of this loop fell back to
   `taxSection.includes(\`<strong>${n} \`)` when the phrased form did not match,
   which passes on any bold number anywhere in the section -- a check that
   cannot fail is worse than no check, because it reports `ok`. */
for (const claim of [`<strong>${counts.true} are confirmed tax-inclusive</strong>`,
                     /* USED TO ASSERT `${n} are confirmed zero` (changed
                        2026-09-08, review). "Confirmed zero" read as a claim
                        about the buyer's tax amount; `false` only ever meant
                        the amount is outside any fee base we charge. The count
                        is unchanged as an assertion -- only the noun it holds
                        the page to. */
                     `<strong>${counts.false} are excluded</strong>`,
                     `<strong>${counts["'unknown'"]} are unknown</strong>`,
                     `<strong>${renderCount} of ${taxFields.size}</strong>`]) {
  T.check(`tax: the page publishes the model's count \u2014 "${claim.replace(/<\/?strong>/g, '')}"`,
    taxSection.includes(claim),
    `the model's split is ${counts.true}/${counts.false}/${counts["'unknown'"]} ` +
    `(${renderCount} of ${taxFields.size} disclosing), but the page does not state ` +
    `"${claim.replace(/<\/?strong>/g, '')}"`);
}

T.done();
