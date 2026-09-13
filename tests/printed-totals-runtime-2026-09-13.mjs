/*
 * printed-totals-runtime — the denominator table must not need the filesystem.
 *
 * WHY THIS EXISTS
 *
 * api/_setPrintedTotals.js resolved data/set-printed-totals.json at runtime
 * with import.meta.url + readFileSync. Deployed, that killed the function:
 * /api/drafts returned 500 FUNCTION_INVOCATION_FAILED for every method while
 * /api/health (200), /api/scan (405), /api/ebay-sold (400) and
 * /api/grade-share (400) stayed healthy. The same unauthenticated request
 * returned 401 on the previous release and 500 on efcff10, so the regression is
 * measured rather than argued. It was the only file under api/ touching
 * import.meta and api/drafts.js was its only importer.
 *
 * WHAT THIS SUITE CAN AND CANNOT PROVE
 *
 * It cannot prove the deployed function boots. Every slot in this runner is an
 * in-process node import, and the failure lived in the built serverless
 * runtime; that is exactly why 64 green slots shipped a broken endpoint. The
 * deployed-route check stays a separate, live gate.
 *
 * What it does prove is that the mechanism which broke is gone and stays gone,
 * that behaviour through the real exported interface is unchanged, and that the
 * embedded runtime table still agrees with the seeder's reviewed JSON record.
 * The source scan supports the regression test; it does not replace the live
 * check.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { harness } from './_assert.mjs';
import { printedTotalForSet, resolvePrintedTotal } from '../api/_setPrintedTotals.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const T = harness('printed-totals-runtime');

/* ── the mechanism that broke is absent from the module ──────────────────────
 *
 * Comments are stripped first, because this file and the module both discuss
 * the very tokens under test. A grep that matched prose would report health
 * from a module that still called readFileSync. */
await T.section('the runtime no longer depends on the filesystem', async () => {
  const raw = readFileSync(join(ROOT, 'api', '_setPrintedTotals.js'), 'utf8');
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  T.check('sanity: executable source survived comment stripping',
    code.includes('export function printedTotalForSet')
    && code.includes('export function resolvePrintedTotal')
    && code.length > 400,
    `stripped to ${code.length} chars — the stripper is wrong and every ` +
    'absence assertion below would pass vacuously');

  for (const token of ['import.meta', 'node:fs', 'node:url', 'node:path', 'readFileSync']) {
    T.check(`no ${token} on any executable line`,
      !code.includes(token),
      code.split('\n').filter(l => l.includes(token)).join(' | '));
  }

  T.check('the table is reached through loadPrintedTotals()',
    code.includes('function loadPrintedTotals') && code.includes('loadPrintedTotals()'),
    'the loader seam named in the fix is missing');
});

/* ── behaviour through the real exported interface ────────────────────────── */
await T.section('the denominator still resolves to the printed value', async () => {
  T.check('printedTotalForSet("me1") === 132',
    printedTotalForSet('me1') === 132, String(printedTotalForSet('me1')));

  T.check('printedTotalForSet("MEG") === 132 via the ptcgoCode fallback',
    printedTotalForSet('MEG') === 132, String(printedTotalForSet('MEG')));

  /* The live pokemontcg.io set object still outranks the reviewed table. */
  T.check('a live printedTotal still wins over the table',
    resolvePrintedTotal({ liveSet: { printedTotal: 77 }, setId: 'me1' }) === 77,
    String(resolvePrintedTotal({ liveSet: { printedTotal: 77 }, setId: 'me1' })));

  /* The grounded id "me1-134" is NOT a set key and does not resolve on its
     own; the setCode carries it. Asserted explicitly so the pair below cannot
     be mistaken for id parsing this module does not do. */
  T.check('the grounded id alone does not resolve — it is not a set key',
    resolvePrintedTotal({ setId: 'me1-134' }) === null,
    String(resolvePrintedTotal({ setId: 'me1-134' })));

  T.check('a grounded card with setCode MEG resolves to 132, not the submitted 188',
    resolvePrintedTotal({ setId: 'me1-134', setCode: 'MEG' }) === 132,
    String(resolvePrintedTotal({ setId: 'me1-134', setCode: 'MEG' })));

  T.check('an unverified set stays null so callers print the bare number',
    resolvePrintedTotal({ setId: 'zzz9', setCode: 'ZZZ' }) === null,
    String(resolvePrintedTotal({ setId: 'zzz9', setCode: 'ZZZ' })));

  T.check('the exported interface is exactly the two functions the callers use',
    typeof printedTotalForSet === 'function' && typeof resolvePrintedTotal === 'function');
});

/* ── parity: the embedded table and the seeder's record cannot drift ──────────
 *
 * The JSON is read HERE, in the test process only. The production module no
 * longer reads it, so this is the thing that keeps the reviewed metadata record
 * and the shipped lookup table in agreement. */
await T.section('every seeder JSON entry resolves identically at runtime', async () => {
  const parsed = JSON.parse(
    readFileSync(join(ROOT, 'data', 'set-printed-totals.json'), 'utf8'));
  const sets = (parsed && parsed.sets) || {};
  const ids = Object.keys(sets);

  T.check(`floor: the JSON record parsed ${ids.length} set(s) (at least 1)`,
    ids.length >= 1,
    'an empty table would make every parity assertion below pass vacuously');

  for (const id of ids) {
    const entry = sets[id];

    T.check(`${id}: JSON printedTotal is a positive integer`,
      Number.isInteger(entry.printedTotal) && entry.printedTotal > 0,
      JSON.stringify(entry.printedTotal));

    T.check(`${id}: resolves to the JSON printedTotal (${entry.printedTotal}) by set id`,
      printedTotalForSet(id) === entry.printedTotal,
      `runtime=${printedTotalForSet(id)} json=${entry.printedTotal}`);

    if (entry.ptcgoCode) {
      T.check(`${id}: resolves to the same value by ptcgoCode ${entry.ptcgoCode}`,
        printedTotalForSet(entry.ptcgoCode) === entry.printedTotal,
        `runtime=${printedTotalForSet(entry.ptcgoCode)} json=${entry.printedTotal}`);
    }

    /* The denominator must never be the catalogue's record count. */
    if (Number.isInteger(entry.total)) {
      T.check(`${id}: the resolved value is the printed denominator, not total (${entry.total})`,
        printedTotalForSet(id) !== entry.total || entry.printedTotal === entry.total,
        `resolved ${printedTotalForSet(id)} equals total ${entry.total}`);
    }

    T.check(`${id}: the JSON entry records where the value was verified`,
      typeof entry.verifiedFrom === 'string' && entry.verifiedFrom.startsWith('http'),
      String(entry.verifiedFrom));
  }
});

T.done();
