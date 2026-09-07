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

/* ── page side, table 1: fees ───────────────────────────────────────────── */

const feeTable = accuracy.slice(
  accuracy.indexOf('<th>Venue</th><th>Fee model</th>'),
  accuracy.indexOf('<th>Venue</th><th>Operator</th>'));

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

T.done();
