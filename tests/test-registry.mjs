/*
 * test-registry — "registered" must be a derived fact, not a remembered one.
 *
 * WHY THIS EXISTS
 *
 * On 2026-09-07 `contrast-tokens` was reported as registered in run-all.sh when
 * it had never been wired in. Only its pass count had been observed, by hand,
 * once. That suite was itself the fix for instance 8 -- a hand-listed token
 * check replaced by a real derivation -- so the remedy for one instance of the
 * pattern arrived carrying another: a hand-observed green count reported as a
 * gate. A suite the runner never invokes is a file, not a guard.
 *
 * This file makes the claim runnable. Same move as the bundle citation map: the
 * tables are a cache, the tool is the source of truth. Here, the runner is the
 * source of truth for what is registered, and nobody's memory is.
 *
 * IT ALSO RETIRES THE SLOT BOOKKEEPING. run-all.sh prints "[n/N]" as literal
 * strings. N was hand-maintained across every addition. This derives N from the
 * actual invocation count and checks the numbering is contiguous, so a renumber
 * that is forgotten fails here instead of quietly misreporting progress.
 *
 * EVERY SET COMPARISON CARRIES ITS OWN FLOOR. Not the suite's -- its own. Two
 * empty sets compare equal, so a broken parser makes every diff below report
 * health. That happened for real in accuracy-fee-parity on 2026-09-07: in a
 * single run, the parsed-count floor failed while a set-equality assertion
 * reported ok from the identical broken state. One assertion knew and another
 * did not. The generalisation is that non-emptiness belongs inside the
 * assertion, never assumed around it.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { harness } from './_assert.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const T = harness('test-registry');

const runner = readFileSync(join(HERE, 'run-all.sh'), 'utf8');

/* ── what the runner actually invokes ───────────────────────────────────── */

const invoked = new Set(
  [...runner.matchAll(/\$ROOT\/tests\/([\w.-]+)/g)].map(m => m[1]));

T.check(`runner: parsed ${invoked.size} invocations from run-all.sh (floor 20)`,
  invoked.size >= 20,
  `parsed ${invoked.size} -- the invocation pattern changed and every diff ` +
  `below would compare against an empty set and report health`);

/* ── what exists on disk ────────────────────────────────────────────────── */

/* Leading underscore = shared helper, not a suite. Helpers are imported by
   suites, so they are covered transitively and must not be invoked directly. */
const present = new Set(readdirSync(HERE)
  .filter(f => /\.(mjs|js)$/.test(f))
  .filter(f => !f.startsWith('_')));

T.check(`disk: found ${present.size} suite files (floor 20)`,
  present.size >= 20,
  `found ${present.size} -- the glob is wrong`);

/* ── declared exclusions ────────────────────────────────────────────────────
 *
 * A file may sit outside the runner ONLY with a reason written here. The point
 * is not to permit exclusions; it is to stop them from being accidental. An
 * undeclared absence fails. Adding a line to this list is a visible act in a
 * diff, which is the property the previous arrangement lacked -- eleven
 * regression suites had drifted out of the runner with nothing recording it.
 */
const EXCLUDED = {
  'ebay-live.mjs':
    'Hits api.ebay.com for real and needs EBAY_LIVE=1 plus live credentials. ' +
    'It is the push-gate check, run deliberately by hand, never in the ' +
    'default suite. Currently 18/19; the gate requires 19/19.',
  'test-scan.mjs':
    'Integration suite for /api/scan. Fails offline with "Assertion failed: ' +
    '200" -- it expects a live handler environment this runner does not stand ' +
    'up. UNRESOLVED, not benign: it is excluded because it cannot pass here, ' +
    'not because it should not run. Needs an offline harness or an explicit ' +
    'env gate like the DRAFT_KV_LIVE pattern already used at slot 24.',
  'flip-completeness-e2e.mjs':
    'Added 2026-09-08 (BIAS-6). Drives the shipped page in a real browser to ' +
    'follow one flip record through save, reload, aggregate and CSV export -- ' +
    'the surfaces the original hasCosts defect actually reached, and the ones ' +
    'a helper-level unit test cannot speak for. Needs Playwright plus a local ' +
    'HTTP server, neither of which this offline runner provides, and the repo ' +
    'has no package.json to depend on Playwright from. Registering it as an ' +
    'offline slot would make an environment-dependent check look like part of ' +
    'the offline gate. Run by hand: node tests/flip-completeness-e2e.mjs ' +
    '(22/22 as of 2026-09-08). Tracked as RV-5 in RELEASE_VALIDATION_QUEUE.md.',
  'draft-lifecycle-real-redis.mjs':
    'Added 2026-09-10. Runs the three actual Lua scripts -- ACQUIRE_SCRIPT, ' +
    'FENCED_SET_SCRIPT and the UNLOCK_SCRIPT reached through ' +
    'releaseLifecycleLock -- inside a real redis-server, which the offline ' +
    'runner does not stand up. Excluded for the SAME reason as ' +
    'flip-completeness-e2e.mjs and listing-photos.mjs and on that precedent: ' +
    'registering an environment-dependent check as an offline slot would make ' +
    'the offline gate depend on an environment it does not provide. It does ' +
    'NOT replace draft-lifecycle.mjs, which stays registered and keeps its ' +
    'in-memory double; this one closes the separate question of whether the ' +
    'Lua source behaves as claimed under an actual Lua interpreter. Run by ' +
    'hand against an isolated server: redis-server --port 6399 --save "" ' +
    '--appendonly no, then CR_REDIS_PORT=6399 node ' +
    'tests/draft-lifecycle-real-redis.mjs (58/58 as of 2026-09-10, ' +
    'redis-server 8.0.5, Lua 5.1). Upstash compatibility is NOT covered: ' +
    'production speaks the Upstash REST endpoint, this speaks RESP.',
  'listing-photos.mjs':
    'Added 2026-09-08 (D7). Drives the IndexedDB photo store and the review ' +
    'screen photo UI in a real browser -- the picker, reorder, remove, the ' +
    'missing-photo tile, and the abort-before-commit rollback, none of which ' +
    'exist outside a browser. Excluded for the SAME reason as ' +
    'flip-completeness-e2e.mjs and on that precedent, not as a fresh ' +
    'judgement: it needs Playwright and a local HTTP server this offline ' +
    'runner does not stand up, and registering it as an offline slot would ' +
    'make the offline gate depend on an environment it does not provide. ' +
    'Run by hand: node tests/listing-photos.mjs (92/92 as of 2026-09-08). ' +
    'Tracked as RV-7 in RELEASE_VALIDATION_QUEUE.md.',
  'listing-export-e2e.mjs':
    'Added 2026-09-12 (listing-export defects). Drives the REAL ' +
    '_bulkScanRowToCard -> POST /api/drafts -> GET -> _ebayDraftCsv path in a ' +
    'real browser and asserts against tests/fixtures/ebay-draft-3.csv, the ' +
    'file the seller actually downloaded. Excluded for the SAME reason as ' +
    'listing-photos.mjs and flip-completeness-e2e.mjs, and on that precedent, ' +
    'not as a fresh judgement: the shipped mapper and CSV builder are only ' +
    'reachable as window globals from index.html, which needs Playwright and ' +
    'a local HTTP server this offline runner does not stand up. Registering ' +
    'it as an offline slot would make the offline gate depend on an ' +
    'environment it does not provide. Run by hand: node ' +
    'tests/listing-export-e2e.mjs (59/59 as of 2026-09-12). Its offline ' +
    'siblings ARE registered: collector-number-format.mjs (slot 59) and ' +
    'scan-rarity-grounding.mjs (slot 60), so the number formatter and the ' +
    'rarity grounding rule are both covered by the gate itself.',
  'entry-identity.mjs':
    'Added 2026-09-12 (collection-id integrity). Drives the REAL delegated ' +
    'click dispatcher, the REAL _bulkSaveToCollection, _unionById and the ' +
    'tombstone filter in a real browser, and dispatches real clicks on the ' +
    'markup the renderer emits -- the handler conversion it covers is only ' +
    'observable through actual DOM events. Excluded for the SAME reason as ' +
    'listing-photos.mjs and listing-export-e2e.mjs, and on that precedent, ' +
    'not as a fresh judgement: it needs Playwright and a local HTTP server ' +
    'this offline runner does not stand up, and two of its scenarios need ' +
    'TWO PAGES sharing one origin\u2019s storage, which is a browser ' +
    'property rather than something a double can supply. Registering it as ' +
    'an offline slot would make the offline gate depend on an environment it ' +
    'does not provide. Run by hand: node tests/entry-identity.mjs (62/62 as ' +
    'of 2026-09-12). Its offline sibling IS registered: ' +
    'scan-hygiene-2026-09-04.mjs (the \'every copy has a distinct id\' ' +
    'check), which now grabs the real _crNewEntryId, _crIsNoSecureId and ' +
    '_crGuardMint rather than stubs, so the generator and the refusal guard ' +
    'are both covered by the offline gate. NOW REGISTERED for release ' +
    'acceptance as required check RQ-1 in ' +
    'audit/RELEASE_VALIDATION_QUEUE.md, alongside RQ-2 ' +
    '(listing-export-e2e.mjs) and RQ-3 (listing-photos.mjs). Exclusion from ' +
    'this offline runner is a statement about the runner, not a release ' +
    'exemption -- all three are required green on the promotion commit.',
};

/* A stale exclusion is its own drift: it grants an exemption to a file that no
   longer exists, and reads as coverage-by-explanation. */
const staleExclusions = Object.keys(EXCLUDED).filter(f => !present.has(f));
T.check('every declared exclusion names a file that exists',
  staleExclusions.length === 0,
  `declared but absent from disk: ${staleExclusions.join(', ')}`);

const contradictory = Object.keys(EXCLUDED).filter(f => invoked.has(f));
T.check('no file is both invoked and declared excluded',
  contradictory.length === 0,
  `invoked by the runner yet listed as excluded: ${contradictory.join(', ')}`);

/* ── direction 1: every suite on disk is invoked or declared ────────────── */

const undeclared = [...present].filter(f => !invoked.has(f) && !EXCLUDED[f]);
T.check('every suite on disk is either invoked by the runner or declared excluded',
  present.size > 0 && undeclared.length === 0,
  `present but neither invoked nor declared (${undeclared.length}): ` +
  `${undeclared.join(', ')} -- each is a file, not a guard`);

/* ── direction 2: every invocation resolves to a real file ─────────────── */

const phantom = [...invoked].filter(f => !present.has(f));
T.check('every file the runner invokes exists on disk',
  invoked.size > 0 && phantom.length === 0,
  `invoked but missing (the runner would fail at run time): ${phantom.join(', ')}`);

/* ── slot numbering is derived, not remembered ─────────────────────────── */

const slots = [...runner.matchAll(/\u25b6 \[(\d+)\/(\d+)\]/g)]
  .map(m => ({ n: +m[1], d: +m[2] }));

T.check(`runner: parsed ${slots.length} slot labels (floor 20)`,
  slots.length >= 20,
  `parsed ${slots.length} -- the label format changed`);

const denominators = new Set(slots.map(s => s.d));
T.check('every slot label uses the same denominator',
  denominators.size === 1,
  `mixed denominators: ${[...denominators].join(', ')} -- a partial renumber`);

const declaredTotal = [...denominators][0];
const uniqueSlots = [...new Set(slots.map(s => s.n))].sort((a, b) => a - b);

T.check(`the declared total (${declaredTotal}) equals the number of distinct slots (${uniqueSlots.length})`,
  declaredTotal === uniqueSlots.length,
  `run-all.sh claims ${declaredTotal} checks but prints ${uniqueSlots.length} ` +
  `distinct slot numbers`);

const gaps = [];
for (let i = 0; i < uniqueSlots.length; i++) {
  if (uniqueSlots[i] !== i + 1) { gaps.push(`expected ${i + 1}, saw ${uniqueSlots[i]}`); break; }
}
T.check('slot numbers run 1..N with no gap',
  uniqueSlots.length > 0 && gaps.length === 0,
  `numbering breaks: ${gaps.join(' · ')}`);

/* A slot number may legitimately appear twice: the gated checks print one label
   on the run branch and another on the SKIPPED branch, sharing a slot. Three do
   this today (24 draft-kv-live, 25 endpoints-smoke, 26 condition-applicability).
   More than twice means a copy-paste that duplicated a number. */
const overUsed = [...new Set(slots.map(s => s.n))]
  .filter(n => slots.filter(s => s.n === n).length > 2);
T.check('no slot number is printed more than twice (run + SKIPPED branch)',
  overUsed.length === 0,
  `slots printed 3+ times: ${overUsed.join(', ')} -- a duplicated number`);

/* The declared total must also equal the number of distinct invoked files, or a
   label exists with no test behind it. */
T.check(`the declared total (${declaredTotal}) equals the number of invoked files (${invoked.size})`,
  declaredTotal === invoked.size,
  `${declaredTotal} labels against ${invoked.size} invoked files -- a slot ` +
  `label with no suite behind it, or a suite invoked without a label`);

T.done();
