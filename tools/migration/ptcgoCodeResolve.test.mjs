/* Adversarial tests for the ptcgoCode -> canonical set identity repair.
 * Run: node tools/migration/ptcgoCodeResolve.test.mjs
 */
import assert from 'node:assert/strict';
import * as P from './ptcgoCodeResolve.mjs';
import { skuFor } from '../../api/_cardIdentity.js';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
};
const CANON = new Set(['swsh10', 'swsh10tg', 'swsh9', 'swsh9tg', 'cel25', 'cel25c',
  'swsh12pt5', 'swsh12pt5gg', 'swsh11', 'swsh11tg', 'swsh45', 'swsh45sv',
  'swsh12', 'swsh12tg', 'base1', 'sv1']);

console.log('the 7 measured ambiguous codes');
t('all seven codes are present and each maps to exactly two sets', () => {
  const k = Object.keys(P.AMBIGUOUS_PTCGO_CODES);
  assert.equal(k.length, 7, 'measured: exactly 7 codes map to more than one set');
  for (const c of k) assert.equal(P.AMBIGUOUS_PTCGO_CODES[c].length, 2, c);
});
t('the table is explicit, not derived from a *tg suffix rule', () => {
  // cel25c and swsh12pt5gg and swsh45sv do not end in "tg". A regex would miss them.
  assert.deepEqual(P.AMBIGUOUS_PTCGO_CODES.CEL, ['cel25', 'cel25c']);
  assert.deepEqual(P.AMBIGUOUS_PTCGO_CODES.CRZ, ['swsh12pt5', 'swsh12pt5gg']);
  assert.deepEqual(P.AMBIGUOUS_PTCGO_CODES.SHF, ['swsh45', 'swsh45sv']);
});

console.log('\nambiguity is never guessed');
t('an ambiguous code with a plain number is QUARANTINED, not assigned', () => {
  const d = P.resolveOne({ instanceId: 'i1', ptcgoCode: 'ASR', number: '25' }, { canonicalSetIds: CANON });
  assert.equal(d.outcome, P.OUTCOME.QUARANTINED_AMBIGUOUS);
  assert.equal(d.setId, null);
  assert.deepEqual(d.candidates, ['swsh10', 'swsh10tg']);
});
t('the parent set is NOT chosen as a default', () => {
  for (const code of Object.keys(P.AMBIGUOUS_PTCGO_CODES)) {
    const d = P.resolveOne({ instanceId: 'x', ptcgoCode: code, number: '12' }, { canonicalSetIds: CANON });
    assert.equal(d.setId, null, `${code} must not silently resolve to its parent set`);
  }
});
t('a subset number prefix IS evidence and resolves to the subset', () => {
  const d = P.resolveOne({ instanceId: 'i2', ptcgoCode: 'ASR', number: 'TG12' }, { canonicalSetIds: CANON });
  assert.equal(d.outcome, P.OUTCOME.RESOLVED);
  assert.equal(d.setId, 'swsh10tg');
});
t('GG, SV and RC prefixes resolve their own subsets', () => {
  assert.equal(P.resolveOne({ instanceId: 'a', ptcgoCode: 'CRZ', number: 'GG01' }, {}).setId, 'swsh12pt5gg');
  assert.equal(P.resolveOne({ instanceId: 'b', ptcgoCode: 'SHF', number: 'SV001' }, {}).setId, 'swsh45sv');
  assert.equal(P.resolveOne({ instanceId: 'c', ptcgoCode: 'CEL', number: 'RC1' }, {}).setId, 'cel25c');
});
t('an explicit trusted per-record set id resolves', () => {
  const d = P.resolveOne({ instanceId: 'i3', ptcgoCode: 'SIT', number: '5' },
    { trustedSetIdByInstance: new Map([['i3', 'swsh12tg']]) });
  assert.equal(d.outcome, P.OUTCOME.RESOLVED);
  assert.equal(d.setId, 'swsh12tg');
});
t('a trusted id outside the pair is rejected, not trusted blindly', () => {
  const d = P.resolveOne({ instanceId: 'i4', ptcgoCode: 'SIT', number: '5' },
    { trustedSetIdByInstance: new Map([['i4', 'base1']]) });
  assert.equal(d.outcome, P.OUTCOME.QUARANTINED_AMBIGUOUS);
});
t('a record with no code and no set id is quarantined, not dropped', () => {
  const d = P.resolveOne({ instanceId: 'i5', number: '4' }, {});
  assert.equal(d.outcome, P.OUTCOME.QUARANTINED_NO_CODE);
});
t('an already-canonical set id is left alone', () => {
  const d = P.resolveOne({ instanceId: 'i6', setId: 'base1', number: '4' }, { canonicalSetIds: CANON });
  assert.equal(d.outcome, P.OUTCOME.ALREADY_CANONICAL);
  assert.equal(d.setId, 'base1');
});
t('an unrecognised code is reported, not silently passed through', () => {
  const d = P.resolveOne({ instanceId: 'i7', ptcgoCode: 'ZZZ', number: '1' }, { canonicalSetIds: CANON });
  assert.equal(d.outcome, P.OUTCOME.UNKNOWN_CODE);
});

console.log('\nthis is a DIFFERENT operation from the provider id migration');
t('it does not map pokemontcg.io ids to tcgdex ids', () => {
  // base6 -> lc is a PROVIDER remap and has no place in this repair.
  const d = P.resolveOne({ instanceId: 'i8', setId: 'base6', number: '4' }, { canonicalSetIds: CANON });
  assert.notEqual(d.setId, 'lc', 'provider id migration is setIdRemap.mjs, not this module');
});

console.log('\nquantities and history are never merged or lost');
t('a post-resolution collision reports both instanceIds and both quantities', () => {
  const rows = [
    { instanceId: 'a', ptcgoCode: 'ASR', number: 'TG12', quantity: 2, game: 'pokemon' },
    { instanceId: 'b', ptcgoCode: 'ASR', number: 'TG12', quantity: 5, game: 'pokemon' },
  ];
  const plan = P.planResolve(rows, { canonicalSetIds: CANON });
  const col = plan.rows.find((r) => r.outcome === P.OUTCOME.COLLISION);
  assert.ok(col, 'the collision must be reported');
  assert.deepEqual(col.collidesWith.instanceIds, ['a', 'b']);
  assert.deepEqual(col.collidesWith.quantities, [2, 5]);
  assert.equal(col.after, null, 'no write is planned for a collision');
});
t('purchase history and cost basis survive resolution verbatim', () => {
  const row = { instanceId: 'h1', ptcgoCode: 'ASR', number: 'TG12', quantity: 1,
    costBasis: 42.5, acquiredAt: '2025-01-02', photos: ['p1.jpg'], draftId: 'd9' };
  const plan = P.planResolve([row], { canonicalSetIds: CANON });
  const after = plan.rows[0].after;
  assert.equal(after.costBasis, 42.5);
  assert.equal(after.acquiredAt, '2025-01-02');
  assert.deepEqual(after.photos, ['p1.jpg']);
  assert.equal(after.draftId, 'd9');
  assert.equal(after.quantity, 1);
});

console.log('\nSKU and rollback');
t('the resolved SKU comes from the production generator', () => {
  const row = { instanceId: 's1', ptcgoCode: 'ASR', number: 'TG12', game: 'pokemon' };
  const plan = P.planResolve([row], { canonicalSetIds: CANON });
  assert.equal(plan.rows[0].after.sku, skuFor({ ...row, setId: 'swsh10tg' }));
  assert.ok(/^v2-/.test(plan.rows[0].after.sku));
});
t('rollback is exact and does not invent a SKU the record never had', () => {
  const rows = [{ instanceId: 'r1', ptcgoCode: 'ASR', number: 'TG12', game: 'pokemon' }]; // no sku field
  const plan = P.planResolve(rows, { canonicalSetIds: CANON });
  const applied = P.applyResolve(rows, plan);
  assert.ok('sku' in applied[0], 'apply adds a sku');
  const back = P.rollbackResolve(applied, plan.inverse);
  assert.equal('sku' in back[0], false, 'rollback must not leave a sku behind');
  assert.deepEqual(back[0], rows[0]);
});
t('the plan is idempotent: a second pass modifies nothing', () => {
  const rows = [{ instanceId: 'q1', ptcgoCode: 'ASR', number: 'TG12', game: 'pokemon' }];
  const applied = P.applyResolve(rows, P.planResolve(rows, { canonicalSetIds: CANON }));
  const second = P.planResolve(applied, { canonicalSetIds: CANON });
  assert.equal(second.summary.willModify, 0, 'already-canonical records must not be rewritten');
});
t('planResolve never mutates its input', () => {
  const rows = [{ instanceId: 'm1', ptcgoCode: 'ASR', number: 'TG12', game: 'pokemon' }];
  const snapshot = JSON.stringify(rows);
  P.planResolve(rows, { canonicalSetIds: CANON });
  assert.equal(JSON.stringify(rows), snapshot);
});
t('the summary separates will-modify from quarantined and collided', () => {
  const rows = [
    { instanceId: '1', ptcgoCode: 'ASR', number: 'TG12', game: 'pokemon' }, // resolved
    { instanceId: '2', ptcgoCode: 'ASR', number: '25', game: 'pokemon' },   // quarantined
    { instanceId: '3', number: '9', game: 'pokemon' },                       // no code
  ];
  const s = P.planResolve(rows, { canonicalSetIds: CANON }).summary;
  assert.equal(s.willModify, 1);
  assert.equal(s.quarantined, 2);
  assert.equal(s.collisions, 0);
  assert.equal(s.total, 3);
});

console.log('\nBLOCKER 4: a collision blocks BOTH sides, never just the later record');

t('both members of a colliding pair keep their quantities and are NOT modified', () => {
  // Two records that resolve onto the SAME canonical identity. The old
  // single-pass plan marked only the second COLLISION and still modified the
  // first. Both must now be blocked.
  const recs = [
    { instanceId: 'A', game: 'pokemon', ptcgoCode: 'ASR', number: '1', quantity: 3 },
    { instanceId: 'B', game: 'pokemon', ptcgoCode: 'ASR', number: '1', quantity: 7 },
  ];
  const plan = P.planResolve(recs, { trustedSetIdByInstance: new Map([['A','swsh10'],['B','swsh10']]) });
  const A = plan.rows.find(r => r.instanceId === 'A');
  const B = plan.rows.find(r => r.instanceId === 'B');
  assert.equal(A.outcome, P.OUTCOME.COLLISION, 'the FIRST record must also be blocked');
  assert.equal(B.outcome, P.OUTCOME.COLLISION);
  assert.equal(A.after, null, 'a blocked row carries no `after`');
  assert.equal(B.after, null);
  // Neither may appear in inverse (nothing to roll back, because nothing changed).
  assert.ok(!plan.inverse.some(i => i.instanceId === 'A'), 'A must not enter inverse');
  assert.ok(!plan.inverse.some(i => i.instanceId === 'B'), 'B must not enter inverse');
  // applyResolve must not touch either, and quantities must be intact.
  const out = P.applyResolve(recs, plan);
  const oa = out.find(r => r.instanceId === 'A');
  const ob = out.find(r => r.instanceId === 'B');
  assert.equal(oa.quantity, 3, "A's quantity is unchanged");
  assert.equal(ob.quantity, 7, "B's quantity is unchanged");
  assert.equal(oa.ptcgoCode, 'ASR', 'A was not modified');
  assert.equal(ob.ptcgoCode, 'ASR', 'B was not modified');
  assert.equal(oa.setId, undefined, 'A did not receive a setId');
  assert.equal(ob.setId, undefined, 'B did not receive a setId');
  assert.equal(3 + 7, oa.quantity + ob.quantity, 'quantities were never summed into one row');
});

t('a resolved record is blocked by an UNTOUCHED record already on that identity', () => {
  // C is already canonical (no ptcgoCode to repair) and occupies the target
  // identity. D would resolve onto exactly that SKU. The old plan never compared
  // against untouched records at all, so D would have overwritten the identity.
  const canonical = { instanceId: 'C', game: 'pokemon', setId: 'swsh10', number: '1', quantity: 5 };
  const recs = [
    canonical,
    { instanceId: 'D', game: 'pokemon', ptcgoCode: 'ASR', number: '1', quantity: 2 },
  ];
  const plan = P.planResolve(recs, { trustedSetIdByInstance: new Map([['D','swsh10']]) });
  const D = plan.rows.find(r => r.instanceId === 'D');
  assert.equal(D.outcome, P.OUTCOME.COLLISION, 'an untouched canonical record must block the resolve');
  assert.equal(D.after, null);
  assert.ok(D.collidesWith.instanceIds.includes('C'), 'the untouched record is named in the collision');
  assert.ok(D.collidesWith.untouchedCanonical.includes('C'),
    'and is identified as untouched-canonical');
  assert.ok(!plan.inverse.some(i => i.instanceId === 'D'));
  const out = P.applyResolve(recs, plan);
  assert.equal(out.find(r => r.instanceId === 'C').quantity, 5);
  assert.equal(out.find(r => r.instanceId === 'D').quantity, 2);
  assert.equal(out.find(r => r.instanceId === 'D').setId, undefined);
});

t('the collision key is the production-generated SKU, not a reimplemented string', () => {
  const recs = [
    { instanceId: 'A', game: 'pokemon', ptcgoCode: 'ASR', number: '1', quantity: 1 },
    { instanceId: 'B', game: 'pokemon', ptcgoCode: 'ASR', number: '1', quantity: 1 },
  ];
  const plan = P.planResolve(recs, { trustedSetIdByInstance: new Map([['A','swsh10'],['B','swsh10']]) });
  const row = plan.rows.find(r => r.outcome === P.OUTCOME.COLLISION);
  assert.ok(row.collidesWith.sku, 'the contested SKU is reported');
  // skuFor() emits the v2- form; a hand-rolled pipe-delimited key would not.
  assert.match(row.collidesWith.sku, /^v2-/,
    'the grouping key is the real skuFor() output, so the plan cannot diverge from production');
});

/* The push gate judges an .mjs suite on THREE things: zero reported
 * failures, exit 0, AND this completion marker. A suite that dies before
 * its last assertion can still print a clean-looking count and exit 0, and
 * without the marker the runner records it as a failure rather than a pass.
 * Registering a suite in tests/run-all.sh therefore requires emitting it. */
console.log(`\nptcgoCodeResolve: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
