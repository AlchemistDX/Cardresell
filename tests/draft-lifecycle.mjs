// tests/draft-lifecycle.mjs — delete + recreate, and the interruptions
//
// The requirement being proven is not "delete works". It is that no
// interruption, retry, or concurrent caller can produce either of the two
// failures that matter:
//
//   • a resurrection — a deleted draft recreated without a fresh seller action
//   • a duplicate    — two live drafts for one (seller, instance, slot)
//
// Every test below is named for the behaviour it protects, and each drives the
// real module. The store is an in-memory kv with the same command surface as
// the Upstash caller in api/drafts.js (makeKv), so a test cannot pass against
// a re-implementation of the logic it is checking.

import assert from 'node:assert';
import {
  lifecycleKey, LIFECYCLE_STATE, LIFECYCLE_ERR,
  readLifecycle, resolveLifecycle, recordDeletion,
  reserveCreate, commitCreate, withLifecycleLock,
} from '../api/_draftLifecycle.js';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond && typeof cond.then === 'function') {
    failed++;
    console.log(`  FAIL ${name}\n       → TEST_API_MISUSE: a Promise is not a truth value; await it`);
    return;
  }
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `\n       → ${detail}` : ''}`); }
}

// ── In-memory kv with injectable failures ───────────────────────────────────
//
// `failOn` matches on command + key substring, so a test can kill exactly the
// write it wants to interrupt and leave every other write working. That is the
// whole point: these are partial-failure tests, and a store that fails
// everything proves nothing about ordering.
function makeKv(opts = {}) {
  const data = new Map();
  const expiries = new Map();
  const calls = [];
  let failOn = opts.failOn || null;

  const kv = async (...args) => {
    const [cmd, key, ...rest] = args.map(String);
    calls.push([cmd, key]);
    if (failOn && failOn(cmd, key)) throw new Error('kv_500');

    if (cmd === 'get') {
      if (expiries.has(key) && expiries.get(key) <= Date.now()) { data.delete(key); expiries.delete(key); }
      return data.has(key) ? data.get(key) : null;
    }
    if (cmd === 'set') {
      const value = rest[0];
      const nx = rest.includes('NX');
      if (nx && data.has(key)) return null;
      data.set(key, value);
      const exAt = rest.indexOf('EX');
      if (exAt !== -1) expiries.set(key, Date.now() + Number(rest[exAt + 1]) * 1000);
      return 'OK';
    }
    if (cmd === 'del') { const had = data.delete(key); expiries.delete(key); return had ? 1 : 0; }
    throw new Error(`unsupported_${cmd}`);
  };

  kv._data = data;
  kv._calls = calls;
  kv._setFailOn = (f) => { failOn = f; };
  return kv;
}

const SUB = 'sub_fzUpcr';
const INST = 'inst_col_1789014701564';
const SLOT = 'ebay:fixed-price';

// A draft store the probe can read, so the tests can stage exactly the
// on-disk situation each interruption leaves behind.
function drafts() {
  const m = new Map();
  return {
    put(id, { deleted = false } = {}) { m.set(id, { deleted }); },
    expire(id) { m.delete(id); },          // tombstone retention lapses
    probe: async (id) => (m.has(id) ? { found: true, deleted: m.get(id).deleted } : { found: false, deleted: false }),
  };
}

console.log('\n── the normal lifecycle ──');
{
  const kv = makeKv(); const D = drafts();
  await reserveCreate(kv, SUB, INST, SLOT, 'drf_A', 0);
  D.put('drf_A');
  await commitCreate(kv, SUB, INST, SLOT, 'drf_A', 0);

  const live = await resolveLifecycle(kv, SUB, INST, SLOT, D.probe);
  check('a committed draft resolves as the live draft', live.ok && live.live === 'drf_A' && live.gen === 0);

  // Delete: tombstone FIRST (the caller's job), then record it.
  D.put('drf_A', { deleted: true });
  const del = await recordDeletion(kv, SUB, INST, SLOT, 'drf_A', 0);
  check('deletion advances the generation exactly once', del.ok && del.gen === 1 && del.advanced === true);

  const after = await resolveLifecycle(kv, SUB, INST, SLOT, D.probe);
  check('and there is no live draft afterwards', after.ok && after.live === null && after.gen === 1);
  check('a create at the OLD generation is refused as stale', after.gen !== 0);
}

console.log('\n── the four-step hole: tombstone written, generation never advanced ──');
{
  // 1. delete writes the tombstone, then stops before advancing the generation
  const kv = makeKv(); const D = drafts();
  await reserveCreate(kv, SUB, INST, SLOT, 'drf_B', 0);
  D.put('drf_B');
  await commitCreate(kv, SUB, INST, SLOT, 'drf_B', 0);
  D.put('drf_B', { deleted: true });
  // recordDeletion never runs — this is the interruption.

  // 2. the idempotency records expire (nothing to model: they are simply gone)
  // 3. an old create arrives, with no eligibility read in between
  const stored = await readLifecycle(kv, SUB, INST, SLOT);
  check('the stored generation is still 0, so a bare comparison WOULD pass',
        stored.record.gen === 0,
        'this is the premise of the hole, not a bug being asserted');

  // 4. so the create path resolves the authoritative state itself
  const res = await resolveLifecycle(kv, SUB, INST, SLOT, D.probe);
  check('resolve reads the tombstone and refuses regardless of the stored generation',
        res.ok && res.live === null && res.gen === 1 && res.repaired === true,
        'correctness must not depend on an eligibility read having happened');
  const persisted = await readLifecycle(kv, SUB, INST, SLOT);
  check('and it repairs the record so the next caller is cheap',
        persisted.record.gen === 1 && persisted.record.lastState === LIFECYCLE_STATE.DELETED);
}

console.log('\n── repair is repeatable and cannot advance twice ──');
{
  const kv = makeKv(); const D = drafts();
  await reserveCreate(kv, SUB, INST, SLOT, 'drf_C', 3);
  D.put('drf_C'); await commitCreate(kv, SUB, INST, SLOT, 'drf_C', 3);
  D.put('drf_C', { deleted: true });

  const a = await resolveLifecycle(kv, SUB, INST, SLOT, D.probe);
  const b = await resolveLifecycle(kv, SUB, INST, SLOT, D.probe);
  const c = await recordDeletion(kv, SUB, INST, SLOT, 'drf_C', 3);
  check('three repairs of one deletion all land on the same generation',
        a.gen === 4 && b.gen === 4 && c.gen === 4,
        'an INCR here would have produced 4, 5, 6');

  // Concurrent repair: both read the same record, both write.
  const kv2 = makeKv(); const D2 = drafts();
  await reserveCreate(kv2, SUB, INST, SLOT, 'drf_D', 7);
  D2.put('drf_D'); await commitCreate(kv2, SUB, INST, SLOT, 'drf_D', 7);
  D2.put('drf_D', { deleted: true });
  const [r1, r2] = await Promise.all([
    resolveLifecycle(kv2, SUB, INST, SLOT, D2.probe),
    resolveLifecycle(kv2, SUB, INST, SLOT, D2.probe),
  ]);
  check('concurrent repairs agree rather than compounding', r1.gen === 8 && r2.gen === 8);
  const fin = await readLifecycle(kv2, SUB, INST, SLOT);
  check('and the stored generation is 8, not 9', fin.record.gen === 8);
}

console.log('\n── a retry of an OLD deletion must not touch a newer lifecycle ──');
{
  const kv = makeKv(); const D = drafts();
  // gen 0 created and deleted
  await reserveCreate(kv, SUB, INST, SLOT, 'drf_OLD', 0);
  D.put('drf_OLD'); await commitCreate(kv, SUB, INST, SLOT, 'drf_OLD', 0);
  D.put('drf_OLD', { deleted: true });
  await recordDeletion(kv, SUB, INST, SLOT, 'drf_OLD', 0);
  // gen 1 created, live
  await reserveCreate(kv, SUB, INST, SLOT, 'drf_NEW', 1);
  D.put('drf_NEW'); await commitCreate(kv, SUB, INST, SLOT, 'drf_NEW', 1);

  const late = await recordDeletion(kv, SUB, INST, SLOT, 'drf_OLD', 0);
  const rec = await readLifecycle(kv, SUB, INST, SLOT);
  check('the late retry does not advance the generation', late.gen === 1 && rec.record.gen === 1);
  check('and does not overwrite the newer pointer',
        rec.record.lastDraftId === 'drf_NEW' && rec.record.lastState === LIFECYCLE_STATE.LIVE,
        'stranding drf_NEW with no record of itself would lose a live draft');
  const still = await resolveLifecycle(kv, SUB, INST, SLOT, D.probe);
  check('the live draft is still live afterwards', still.live === 'drf_NEW');
}

console.log('\n── partial creation: the draft landed, the pointer did not ──');
{
  const kv = makeKv(); const D = drafts();
  await reserveCreate(kv, SUB, INST, SLOT, 'drf_E', 0);
  D.put('drf_E');                                  // draft write succeeded
  kv._setFailOn((cmd, key) => cmd === 'set' && key.startsWith('draftinst:'));
  const commit = await commitCreate(kv, SUB, INST, SLOT, 'drf_E', 0);
  check('promoting the pointer fails', commit.ok !== true);
  kv._setFailOn(null);

  const res = await resolveLifecycle(kv, SUB, INST, SLOT, D.probe);
  check('the retry RECOVERS the existing draft instead of creating another',
        res.ok && res.live === 'drf_E',
        'a second create here is the duplicate this module exists to prevent');
  check('and the generation was not advanced by the failure', res.gen === 0);
}

console.log('\n── interrupted creation: the pointer landed, the draft did not ──');
{
  const kv = makeKv(); const D = drafts();
  await reserveCreate(kv, SUB, INST, SLOT, 'drf_F', 0);
  // draft write never happened; pointer sits at 'reserved'
  const res = await resolveLifecycle(kv, SUB, INST, SLOT, D.probe);
  check('a reserved pointer with no draft is NOT read as a deletion',
        res.ok && res.reservedGap === true && res.gen === 0 && res.live === null,
        'refusing here would block the seller over a press that produced nothing');
  check('so the generation is still usable', res.repaired === false);
}

console.log('\n── the tombstone expires; the refusal must not ──');
{
  const kv = makeKv(); const D = drafts();
  await reserveCreate(kv, SUB, INST, SLOT, 'drf_G', 2);
  D.put('drf_G'); await commitCreate(kv, SUB, INST, SLOT, 'drf_G', 2);
  D.put('drf_G', { deleted: true });
  await recordDeletion(kv, SUB, INST, SLOT, 'drf_G', 2);

  D.expire('drf_G');                               // day 91: retention lapses
  const res = await resolveLifecycle(kv, SUB, INST, SLOT, D.probe);
  check('after the tombstone expires the generation still refuses the old create',
        res.ok && res.gen === 3 && res.live === null,
        'protection reconstructed only from expiring evidence expires with it');

  // And the harder case: interrupted delete AND expired tombstone, so there is
  // no tombstone left to read and the stored generation was never advanced.
  const kv2 = makeKv(); const D2 = drafts();
  await reserveCreate(kv2, SUB, INST, SLOT, 'drf_H', 0);
  D2.put('drf_H'); await commitCreate(kv2, SUB, INST, SLOT, 'drf_H', 0);
  D2.put('drf_H', { deleted: true });
  D2.expire('drf_H');                              // never recorded, now unreadable
  const res2 = await resolveLifecycle(kv2, SUB, INST, SLOT, D2.probe);
  check('a LIVE pointer to a draft that is simply gone is treated as deleted',
        res2.ok && res2.gen === 1 && res2.live === null,
        'something was there, we recorded it, it is absent — that is a deletion');
}

console.log('\n── an unreadable store must not read as an empty one ──');
{
  const kv = makeKv({ failOn: (cmd, key) => cmd === 'get' && key.startsWith('draftinst:') });
  const D = drafts();
  const r = await readLifecycle(kv, SUB, INST, SLOT);
  check('a failed read is UNAVAILABLE, not generation 0',
        r.ok === false && r.error === LIFECYCLE_ERR.UNAVAILABLE,
        'generation 0 would authorise exactly the create this should refuse');

  const kv2 = makeKv(); const D2 = drafts();
  await reserveCreate(kv2, SUB, INST, SLOT, 'drf_I', 0);
  D2.put('drf_I'); await commitCreate(kv2, SUB, INST, SLOT, 'drf_I', 0);
  const res = await resolveLifecycle(kv2, SUB, INST, SLOT, async () => { throw new Error('boom'); });
  check('a draft read that throws does not report "no live draft"',
        res.ok === false && res.error === LIFECYCLE_ERR.UNAVAILABLE,
        'that answer would authorise a duplicate of a draft we failed to read');
}

console.log('\n── a corrupt record is unreadable, not empty ──');
{
  const kv = makeKv();
  kv._data.set(lifecycleKey(SUB, INST, SLOT), '{not json');
  const r = await readLifecycle(kv, SUB, INST, SLOT);
  check('unparseable bytes are UNAVAILABLE', r.ok === false && r.unreadable === true);
}

console.log('\n── the lock: check-then-act is not enough ──');
{
  const kv = makeKv();
  let inside = 0, maxInside = 0;
  const body = async () => {
    inside++; maxInside = Math.max(maxInside, inside);
    await new Promise((r) => setTimeout(r, 5));
    inside--;
    return { ok: true };
  };
  const results = await Promise.all([
    withLifecycleLock(kv, SUB, INST, SLOT, body),
    withLifecycleLock(kv, SUB, INST, SLOT, body),
    withLifecycleLock(kv, SUB, INST, SLOT, body),
  ]);
  check('only one caller enters the critical section', maxInside === 1);
  const busy = results.filter((r) => r.error === LIFECYCLE_ERR.BUSY);
  check('the losers are told BUSY and retryable, not allowed to fall through',
        busy.length === 2 && busy.every((r) => r.retryable === true));

  const after = await kv('get', 'draftinstlock:' + SUB + ':' + INST + ':' + SLOT);
  check('the lock is released when the body finishes', after === null);

  // Released even when the body throws — otherwise one error wedges the row
  // for the whole lock TTL.
  const kv2 = makeKv();
  await withLifecycleLock(kv2, SUB, INST, SLOT, async () => { throw new Error('body blew up'); })
    .catch(() => {});
  const after2 = await kv2('get', 'draftinstlock:' + SUB + ':' + INST + ':' + SLOT);
  check('and released when the body throws', after2 === null);
}

console.log('\n── a create paused immediately after its generation check ──');
{
  // The race the lock exists for: create reads gen 0, a delete lands, then the
  // create proceeds to write. Under the lock the delete cannot interleave, so
  // this test asserts the SERIALISED outcome rather than a hopeful one.
  const kv = makeKv(); const D = drafts();
  await reserveCreate(kv, SUB, INST, SLOT, 'drf_J', 0);
  D.put('drf_J'); await commitCreate(kv, SUB, INST, SLOT, 'drf_J', 0);

  let checkedGen = null;
  const create = withLifecycleLock(kv, SUB, INST, SLOT, async () => {
    const res = await resolveLifecycle(kv, SUB, INST, SLOT, D.probe);
    checkedGen = res.gen;
    await new Promise((r) => setTimeout(r, 10));       // paused, holding the lock
    const fresh = await resolveLifecycle(kv, SUB, INST, SLOT, D.probe);
    return { ok: true, staleAfterPause: fresh.gen !== checkedGen };
  });
  // This delete attempt races the paused create.
  const del = withLifecycleLock(kv, SUB, INST, SLOT, async () => {
    D.put('drf_J', { deleted: true });
    return recordDeletion(kv, SUB, INST, SLOT, 'drf_J', 0);
  });
  const [cOut, dOut] = await Promise.all([create, del]);

  check('the delete could not interleave with the paused create',
        dOut.error === LIFECYCLE_ERR.BUSY && cOut.ok === true,
        'without the lock this is a check-then-act window');
  check('so the create never acted on a generation that changed under it',
        cOut.staleAfterPause === false);

  // Retried after the create finished, the delete now succeeds.
  D.put('drf_J', { deleted: true });
  const retry = await withLifecycleLock(kv, SUB, INST, SLOT, () =>
    recordDeletion(kv, SUB, INST, SLOT, 'drf_J', 0));
  check('and the retried delete advances the generation once', retry.gen === 1);
}

console.log('\n── two rows of the same card are independent ──');
{
  // The scope test. A shared counter here would advance row B when row A is
  // deleted, minting an unseen key for B and producing a second live draft
  // for B while B's first is still active.
  const kv = makeKv(); const D = drafts();
  const A = 'inst_col_1789014701564';
  const B = 'inst_col_1789014799999';
  await reserveCreate(kv, SUB, A, SLOT, 'drf_A1', 0); D.put('drf_A1');
  await commitCreate(kv, SUB, A, SLOT, 'drf_A1', 0);
  await reserveCreate(kv, SUB, B, SLOT, 'drf_B1', 0); D.put('drf_B1');
  await commitCreate(kv, SUB, B, SLOT, 'drf_B1', 0);

  D.put('drf_A1', { deleted: true });
  await recordDeletion(kv, SUB, A, SLOT, 'drf_A1', 0);

  const bRes = await resolveLifecycle(kv, SUB, B, SLOT, D.probe);
  check("deleting row A leaves row B's generation untouched", bRes.gen === 0);
  check("and row B's draft is still the live one", bRes.live === 'drf_B1');
  const aRes = await resolveLifecycle(kv, SUB, A, SLOT, D.probe);
  check('while row A has advanced and has no live draft', aRes.gen === 1 && aRes.live === null);
}

console.log('\n── slots are independent too ──');
{
  const kv = makeKv(); const D = drafts();
  await reserveCreate(kv, SUB, INST, 'ebay:fixed-price', 'drf_FP', 0); D.put('drf_FP');
  await commitCreate(kv, SUB, INST, 'ebay:fixed-price', 'drf_FP', 0);
  await reserveCreate(kv, SUB, INST, 'ebay:auction', 'drf_AU', 0); D.put('drf_AU');
  await commitCreate(kv, SUB, INST, 'ebay:auction', 'drf_AU', 0);

  D.put('drf_FP', { deleted: true });
  await recordDeletion(kv, SUB, INST, 'ebay:fixed-price', 'drf_FP', 0);
  const au = await resolveLifecycle(kv, SUB, INST, 'ebay:auction', D.probe);
  check('deleting the fixed-price draft does not disturb the auction draft',
        au.gen === 0 && au.live === 'drf_AU');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
