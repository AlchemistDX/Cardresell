// tests/seeder-collector-number.mjs
//
// Q3 (owner decision, 2026-09-12): "Remove lstrip("0") from the seeder in this
// change and add tests showing that 007 remains 007, 000 remains 000 (not an
// empty value or 0), and SWSH001, TG12/TG30, 14a and ordinary numeric values
// remain unchanged."
//
// This suite drives the REAL seeder function. tools/seed_set_v2.py's
// build_card_record() is the single function seed_one_set() calls to build each
// card-index record, so what is asserted here is the shipped write path, not a
// JS reimplementation of it. If a future edit reintroduces stripping in the
// Python, these assertions fail.
//
// It deliberately does NOT assert anything about existing catalogue records.
// The stripped records cannot reveal which of them originally carried zeros;
// a backfill must rebuild from authoritative source values, and is out of
// scope per the same decision.
//
//   NODE_PATH=/home/user/node_modules node tests/seeder-collector-number.mjs

import { harness } from './_assert.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { check, section, done } = harness('seeder-collector-number');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEEDER = path.join(ROOT, 'tools', 'seed_set_v2.py');

/**
 * Call the real build_card_record() for each supplied card object and return
 * the records it produces. Python is invoked with the seeder imported as a
 * module, so no network request, image download or perceptual hash runs.
 */
function buildRecords(cards) {
  const script = `
import json, sys, importlib.util
spec = importlib.util.spec_from_file_location("seed_set_v2", ${JSON.stringify(SEEDER)})
mod = importlib.util.module_from_spec(spec)
sys.modules["seed_set_v2"] = mod
spec.loader.exec_module(mod)
cards = json.loads(sys.stdin.read())
out = [mod.build_card_record(c, "sv8", "Surging Sparks", "pp", "dd", "https://img/x.png")
       for c in cards]
print(json.dumps(out))
`;
  const raw = execFileSync('python3', ['-c', script], {
    input: JSON.stringify(cards),
    encoding: 'utf8',
    timeout: 60000,
  });
  return JSON.parse(raw);
}

// --- reachability -----------------------------------------------------------
// If the extraction is ever reverted, or the function renamed, the suite must
// fail loudly rather than silently assert nothing.
let REACHABLE = false;
try {
  const r = buildRecords([{ id: 'sv8-1', number: '1' }]);
  REACHABLE = Array.isArray(r) && r.length === 1 && r[0].nu === '1';
} catch (e) {
  console.log(`  build_card_record unreachable: ${e.message.slice(0, 200)}`);
}

await section('S0 the real seeder function is reachable', async () => {
  check('S0 tools/seed_set_v2.py build_card_record() is callable and returns a record',
    REACHABLE,
    'the record builder could not be driven; every assertion below would be vacuous');
});

if (!REACHABLE) {
  done();
} else {

  // Every case in one Python invocation.
  const CASES = [
    // [label, api number, what must come out]
    ['leading zero preserved',            '007',      '007'],
    ['double leading zero preserved',     '0012',     '0012'],
    ['all zeros preserved',               '000',      '000'],
    ['single zero preserved',             '0',        '0'],
    ['plain number unchanged',            '134',      '134'],
    ['plain low number unchanged',        '1',        '1'],
    ['prefixed + zero preserved',         'SWSH001',  'SWSH001'],
    ['trainer gallery unchanged',         'TG12',     'TG12'],
    ['trainer gallery high unchanged',    'TG30',     'TG30'],
    ['trainer gallery zero preserved',    'TG012',    'TG012'],
    ['radiant collection unchanged',      'RC8',      'RC8'],
    ['radiant collection zero preserved', 'RC08',     'RC08'],
    ['letter suffix unchanged',           '14a',      '14a'],
    ['galarian gallery unchanged',        'GG05',     'GG05'],
    ['already-fractional unchanged',      '134/132',  '134/132'],
    ['H-prefixed unchanged',              'H12',      'H12'],
  ];

  const built = buildRecords(
    CASES.map(([, num], i) => ({ id: `sv8-${i}`, number: num, name: 'X', rarity: 'Common' })),
  );

  await section('S1 the printed collector number survives the seeder verbatim', async () => {
    CASES.forEach(([label, input, expected], i) => {
      const got = built[i].nu;
      check(`S1.${i} ${label}: ${JSON.stringify(input)} -> ${JSON.stringify(expected)}`,
        got === expected,
        `got ${JSON.stringify(got)}`);
    });
  });

  await section('S2 the zero cases specifically named in the decision', async () => {
    const nu = (n) => built[CASES.findIndex(([, v]) => v === n)].nu;

    check('S2a 007 remains 007, not 7', nu('007') === '007', `got ${JSON.stringify(nu('007'))}`);
    check('S2b 000 remains 000, not an empty value',
      nu('000') === '000' && nu('000') !== '',
      `got ${JSON.stringify(nu('000'))}`);
    check('S2c 000 remains 000, not 0',
      nu('000') !== '0',
      'the old "lstrip(\\"0\\") or \\"0\\"" collapsed 000 to 0; that must not recur');
    check('S2d SWSH001 keeps its zeros', nu('SWSH001') === 'SWSH001');
    check('S2e TG12 and TG30 are untouched', nu('TG12') === 'TG12' && nu('TG30') === 'TG30');
    check('S2f 14a is untouched', nu('14a') === '14a');
  });

  await section('S3 non-vacuity — the assertions above can actually fail', async () => {
    // If build_card_record were an identity function over its whole input, or
    // if `nu` were being copied from some other field, S1/S2 would pass without
    // testing the number handling. Both are ruled out here.
    const [r] = buildRecords([{
      id: 'sv8-nv', number: '007', name: 'Nonvacuity', rarity: 'Illustration Rare',
      set: { ptcgoCode: 'SSP' },
    }]);

    check('S3a nu is populated from the API number field, not left empty',
      r.nu === '007');
    check('S3b other fields are genuinely mapped (so the builder is doing work)',
      r.n === 'Nonvacuity' && r.r === 'Illustration Rare' && r.sc === 'SSP',
      JSON.stringify(r));
    check('S3c an absent number yields an empty string, not a fabricated 0',
      buildRecords([{ id: 'sv8-none', name: 'NoNumber' }])[0].nu === '',
      'the old code substituted "0" for a missing number, inventing a collector number');
    check('S3d the record shape is unchanged by the fix',
      ['id', 'n', 's', 'si', 'sc', 'nu', 'r', 'p', 'd', 'i', 'g']
        .every((k) => Object.hasOwn(r, k)) && Object.keys(r).length === 11,
      Object.keys(r).join(','));
  });

  await section('S4 the stripping really is gone from the source', async () => {
    // A behavioural assertion cannot distinguish "removed" from "still present
    // but bypassed", and the owner's rule is that a negative grep proves
    // nothing on its own. So this is a supporting check next to S1/S2, not the
    // evidence: the behaviour above is the evidence.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(SEEDER, 'utf8'));
    // First cut of this assertion greped the whole file and FAILED — on the
    // comment at the write site that documents the removal. The product was
    // right and the assertion was wrong, so the assertion changed: only
    // executable lines count. Comment text is not behaviour.
    const codeLines = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'));
    check('S4a no lstrip("0") remains on any executable line of the seeder',
      !codeLines.some((l) => l.includes('lstrip("0")') || l.includes("lstrip('0')")),
      codeLines.filter((l) => l.includes('lstrip')).join(' | '));
    check('S4b the removal is documented where the field is written',
      /Collector number, stored VERBATIM/.test(src));
    check('S4c the no-backfill constraint is recorded in the source',
      /NOT a licence to backfill/.test(src));
  });

  done();
}
