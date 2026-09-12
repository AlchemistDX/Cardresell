// tests/cert-generation-compare.mjs
// Pure-function checks for tools/compare-cert-generation.mjs. No TTY, no
// network, no real credential. The question is whether the matcher can
// mislabel a generation, and whether any entered value reaches the output.
import { matchGeneration, fingerprint, hasEdgeWhitespace } from '../tools/compare-cert-generation.mjs';

let pass = 0, fail = 0;
const ck = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

const G = [
  { label: 'current', value: 'PRD-aaaa1111bbbb-2222-cccc-3333' },
  { label: 'grace, expires 2026-11-08', value: 'PRD-dddd4444eeee-5555-ffff-6666' },
];

ck('matches the current generation', matchGeneration(G[0].value, G).label === 'current');
ck('matches the grace generation', matchGeneration(G[1].value, G).matched === true);
ck('labels the grace generation correctly', matchGeneration(G[1].value, G).label.startsWith('grace'));
ck('unknown value does not match', matchGeneration('PRD-9999zzzz8888-7777-yyyy-6666', G).matched === false);
ck('no match returns a null label', matchGeneration('PRD-9999zzzz8888-7777-yyyy-6666', G).label === null);
ck('near-miss by one char does not match', matchGeneration(G[0].value.slice(0, -1) + '4', G).matched === false);
ck('prefix of a generation does not match', matchGeneration(G[0].value.slice(0, 20), G).matched === false);
ck('empty list yields no match', matchGeneration(G[0].value, []).matched === false);
ck('trailing newline is a different complete value',
  matchGeneration(G[0].value + '\n', G).matched === false);

// The result object is the only thing printed. It must carry no value.
const r = JSON.stringify(matchGeneration(G[0].value, G));
ck('result carries no credential value', !r.includes('PRD-'));

ck('fingerprint is fixed width regardless of input length',
  fingerprint('a').length === fingerprint('a'.repeat(500)).length);
ck('fingerprint differs for different inputs', !fingerprint('a').equals(fingerprint('b')));

ck('edge whitespace detected (trailing space)', hasEdgeWhitespace('PRD-x '));
ck('edge whitespace detected (literal backslash-n)', hasEdgeWhitespace('PRD-x\\n'));
ck('clean value not flagged', !hasEdgeWhitespace('PRD-x'));

/* The runner (tests/run-all.sh) treats a missing 'SUITE COMPLETE' marker as a
   FAILURE, deliberately: a suite that dies halfway prints a passing tally for
   the assertions it reached, and without the marker that tally would be read as
   a pass. This file was registered as slot 61/62 on 2026-09-12 but kept its own
   older wording ("suite completed: true"), which the runner does not recognise
   -- so it ran green and was reported red. The marker is emitted in the shared
   shape now. The tallies and the exit status are unchanged. */
console.log(`\ncert-generation-compare: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail === 0 ? 0 : 1}`);
process.exit(fail === 0 ? 0 : 1);
