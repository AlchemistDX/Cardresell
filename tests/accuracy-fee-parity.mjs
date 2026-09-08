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
 *   2. the disclosure renders iff `taxOn !== false` -- so a confirmed zero is
 *      the ONLY thing that can suppress the seller-facing caveat.
 *
 * Claim 2 is checked by EXECUTING the shipped `venueTaxNote` against the
 * shipped PLATFORMS, not by regex-matching its body. A regex would assert the
 * source looks right; evaluating asserts the function behaves right, and those
 * come apart the moment anyone edits it. `taxBasis` is checked too, because an
 * answer without a recorded basis is how `false` stops meaning what it says.
 */
const TAX_ON     = new Set(['true', 'false', "'unknown'"]);
const TAX_BASIS  = new Set(['published-inclusive', 'published-exclusive',
                            'no-buyer-tax', 'payment-method', 'unstated']);

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

/* A `false` may only rest on a basis that actually establishes a zero. This is
   the guard that keeps "the page never mentioned tax" from being written down
   as a confirmed zero -- the exact substitution T2.9 exists to prevent. */
const ZERO_BASES = new Set(['published-exclusive', 'no-buyer-tax']);
const weakZero = [...taxFields].filter(([, v]) => v.on === 'false' && !ZERO_BASES.has(v.basis));
T.check('tax: taxOn:false only ever rests on a basis that establishes a zero',
  weakZero.length === 0,
  `claimed zero on a non-establishing basis: ${weakZero.map(([k, v]) => `${k}=${v.basis}`).join(', ')}`);

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
  /venueTaxNote\(pid\)\s*\?\s*_reviewBasisRow\(FEE_DISCLOSURE\.taxLabel/.test(bundle),
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
  taxNoteFor = new Function(`${platformsBlk}\n${helper}\nreturn venueTaxNote;`)();
} catch (e) {
  taxNoteFor = null;
}
T.check('tax: PLATFORMS + venueTaxNote evaluate, so the check below is not vacuous',
  typeof taxNoteFor === 'function',
  'could not evaluate the shipped table and helper together');

if (typeof taxNoteFor === 'function') {
  const wrong = [...taxFields].filter(([k, v]) => taxNoteFor(k) !== (v.on !== 'false'));
  T.check('tax: disclosure renders if and only if taxOn !== false, for all 15 venues',
    taxFields.size > 0 && wrong.length === 0,
    `disagreement on: ${wrong.map(([k, v]) => `${k} (taxOn=${v.on}, renders=${taxNoteFor(k)})`).join(', ')}`);

  /* Fail-closed, asserted rather than assumed. An unrecognised venue must SHOW
     the caveat; a helper that returned false here would hide a disclosure for
     every venue it failed to find. */
  T.check('tax: an unrecognised venue still renders the disclosure (fails closed)',
    taxNoteFor('no-such-venue-xyz') === true,
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

const PAGE_TAX = { yes: 'true', no: 'false', unknown: "'unknown'" };
const pageTax = new Map();       // normalised display name -> taxOn literal
for (const row of taxSection.matchAll(
  /<tr><td>([^<]+)<\/td><td><strong>(Yes|No|Unknown)<\/strong><\/td>/g)) {
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
                     `<strong>${counts.false} are confirmed zero</strong>`,
                     `<strong>${counts["'unknown'"]} are unknown</strong>`,
                     `<strong>${renderCount} of ${taxFields.size}</strong>`]) {
  T.check(`tax: the page publishes the model's count \u2014 "${claim.replace(/<\/?strong>/g, '')}"`,
    taxSection.includes(claim),
    `the model's split is ${counts.true}/${counts.false}/${counts["'unknown'"]} ` +
    `(${renderCount} of ${taxFields.size} disclosing), but the page does not state ` +
    `"${claim.replace(/<\/?strong>/g, '')}"`);
}

T.done();
