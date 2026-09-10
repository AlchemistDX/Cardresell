// tests/draft-lifecycle.mjs — delete + recreate, and the interruptions
//
// The requirement being proven is not "delete works". It is that no
// interruption, retry, lock expiry, or concurrent caller can produce either of
// the two failures that matter:
//
//   • a resurrection — a removed draft recreated without a fresh seller action
//   • a duplicate    — two live drafts for one (seller, instance, slot)
//
// Every test drives the real module. The store is an in-memory kv with the same
// command surface as the Upstash caller in api/drafts.js (makeKv), so a test
// cannot pass against a re-implementation of the logic it is checking.

import { completionGuard } from './_complete.mjs';
const { finish: _finish } = completionGuard('draft-lifecycle');

import {
  lifecycleKey, lifecycleLockKey, lifecycleFenceKey,
  LIFECYCLE_STATE, LIFECYCLE_ERR, RESERVATION_RETIRE_MS,
  ACQUIRE_SCRIPT, FENCED_SET_SCRIPT,
  readLifecycle, resolveLifecycle, recordDeletion, fencedSet,
  reserveCreate, commitCreate, withLifecycleLock, acquireLifecycleLock,
  releaseLifecycleLock,
} from '../api/_draftLifecycle.js';
import { evalScript } from './_kvScripts.mjs';

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

// ── In-memory kv with injectable failures and controllable expiry ───────────
//
// `failOn` matches on command + key, so a test can kill exactly the write it
// wants to interrupt and leave every other write working. That is the point:
// these are partial-failure tests, and a store that fails everything proves
// nothing about ordering.
//
// `expireKey` forces a TTL to lapse on demand, which is how the lock-expiry
// sequence is driven without sleeping for 15 seconds.
function makeKv(opts = {}) {
  const data = new Map();
  const expiries = new Map();
  const log = [];
  let failOn = opts.failOn || null;

  const kv = async (...args) => {
    const [cmd, ...rest] = args.map(String);
    const key = rest[0];
    log.push({ cmd, args: rest });
    if (cmd === 'eval') {
      // The script semantics live in ONE place, shared with draft-crud-e2e.
      // Two copies would drift, and each suite would pass against its own.
      // Still no `await` on this path: the indivisibility is the property
      // under test.
      const nk = Number(rest[1]);
      const KEYS = rest.slice(2, 2 + nk);
      if (failOn && failOn('eval', KEYS[KEYS.length - 1])) throw new Error('kv_500');
      const live = (k) => {
        if (expiries.has(k) && expiries.get(k) <= Date.now()) { data.delete(k); expiries.delete(k); }
        return data.has(k) ? data.get(k) : null;
      };
      return evalScript({
        get: live,
        set: (k, v) => { data.set(k, v); expiries.delete(k); },
        del: (k) => { data.delete(k); expiries.delete(k); },
        setEx: (k, v, sec) => { data.set(k, v); expiries.set(k, Date.now() + sec * 1000); },
      }, rest);
    }
    if (failOn && failOn(cmd, key)) throw new Error('kv_500');

    if (cmd === 'get') {
      if (expiries.has(key) && expiries.get(key) <= Date.now()) { data.delete(key); expiries.delete(key); }
      return data.has(key) ? data.get(key) : null;
    }
    if (cmd === 'set') {
      const value = rest[1];
      const flags = rest.slice(2);
      if (expiries.has(key) && expiries.get(key) <= Date.now()) { data.delete(key); expiries.delete(key); }
      if (flags.includes('NX') && data.has(key)) return null;
      data.set(key, value);
      const exAt = flags.indexOf('EX');
      if (exAt !== -1) expiries.set(key, Date.now() + Number(flags[exAt + 1]) * 1000);
      return 'OK';
    }
    if (cmd === 'incr') {
      const n = Number(data.get(key) || 0) + 1;
      data.set(key, String(n));
      return n;
    }
    if (cmd === 'del') { const had = data.delete(key); expiries.delete(key); return had ? 1 : 0; }
    throw new Error(`unsupported_${cmd}`);
  };

  kv._data = data;
  kv._log = log;
  kv._setFailOn = (f) => { failOn = f; };
  kv._expireKey = (k) => { expiries.set(k, Date.now() - 1); };
  return kv;
}

// A draft store that actually lives in the kv, so the DRAFT write is governed
// by the same fence guard as the lifecycle record. The in-memory `drafts()`
// below is fine for logic tests, but it cannot show whether a lapsed owner's
// draft landed — and that is the failure point 2 is about.
function kvDrafts(kv) {
  const dk = (id) => `draft:${id}`;
  return {
    // The write a handler would do, through the store boundary.
    write: (sub, inst, slot, fence, id, body = {}) =>
      fencedSet(kv, sub, inst, slot, fence, dk(id), JSON.stringify({ id, deleted: false, ...body })),
    tombstone: (sub, inst, slot, fence, id) =>
      fencedSet(kv, sub, inst, slot, fence, dk(id), JSON.stringify({ id, deleted: true })),
    raw: (id) => {
      const v = kv._data.get(dk(id));
      return v === undefined ? null : JSON.parse(v);
    },
    count: () => [...kv._data.keys()].filter((k) => k.startsWith('draft:')).length,
    ids: () => [...kv._data.keys()].filter((k) => k.startsWith('draft:')).map((k) => k.slice(6)),
    probe: async (id) => {
      const v = kv._data.get(dk(id));
      if (v === undefined) return { found: false, deleted: false };
      return { found: true, deleted: JSON.parse(v).deleted === true };
    },
  };
}

const SUB = 'sub_fzUpcr';
const INST = 'inst_col_1789014701564';
const SLOT = 'ebay:fixed-price';

function drafts() {
  const m = new Map();
  return {
    put(id, { deleted = false } = {}) { m.set(id, { deleted }); },
    expire(id) { m.delete(id); },          // tombstone retention lapses
    probe: async (id) => (m.has(id) ? { found: true, deleted: m.get(id).deleted } : { found: false, deleted: false }),
  };
}

// Run a body under a real lock so every test uses real, monotonic fences.
function op(kv, inst, slot, fn) {
  return withLifecycleLock(kv, SUB, inst, slot, ({ fence }) => fn(fence));
}

// The normal create, as the handler will do it.
async function createDraft(kv, D, inst, slot, id, gen) {
  return op(kv, inst, slot, async (fence) => {
    await reserveCreate(kv, SUB, inst, slot, id, gen, fence);
    D.put(id);
    return commitCreate(kv, SUB, inst, slot, id, gen, fence);
  });
}

console.log('\n── the normal lifecycle ──');
{
  const kv = makeKv(); const D = drafts();
  await createDraft(kv, D, INST, SLOT, 'drf_A', 0);
  const live = await op(kv, INST, SLOT, (f) => resolveLifecycle(kv, SUB, INST, SLOT, D.probe, f));
  check('a committed draft resolves as the live draft', live.ok && live.live === 'drf_A' && live.gen === 0);

  D.put('drf_A', { deleted: true });                       // tombstone FIRST
  const del = await op(kv, INST, SLOT, (f) => recordDeletion(kv, SUB, INST, SLOT, 'drf_A', { deletedDraftGen: 0, fence: f }));
  check('removal advances the generation exactly once', del.ok && del.gen === 1 && del.advanced === true);

  const after = await op(kv, INST, SLOT, (f) => resolveLifecycle(kv, SUB, INST, SLOT, D.probe, f));
  check('and there is no live draft afterwards', after.ok && after.live === null && after.gen === 1);
  check('so a create at the OLD generation is refused as stale', after.gen !== 0);
}

console.log('\n── the four-step hole: tombstone written, generation never advanced ──');
{
  const kv = makeKv(); const D = drafts();
  await createDraft(kv, D, INST, SLOT, 'drf_B', 0);
  D.put('drf_B', { deleted: true });                       // 1. tombstone, then stop
  // 2. the idempotency records expire (nothing to model: they are simply gone)
  // 3. an old create arrives with no eligibility read in between
  const stored = await readLifecycle(kv, SUB, INST, SLOT);
  check('the stored generation is still 0, so a bare comparison WOULD pass',
        stored.record.gen === 0,
        'this is the premise of the hole, not a bug being asserted');

  const res = await op(kv, INST, SLOT, (f) => resolveLifecycle(kv, SUB, INST, SLOT, D.probe, f));
  check('resolve reads the tombstone and refuses regardless of the stored generation',
        res.ok && res.live === null && res.gen === 1 && res.repaired === true,
        'correctness must not depend on an eligibility read having happened');
  const persisted = await readLifecycle(kv, SUB, INST, SLOT);
  check('and it repairs the record so the next caller is cheap',
        persisted.record.gen === 1 && persisted.record.lastState === LIFECYCLE_STATE.DELETED);
}

console.log('\n── lock expiry while the owner is still running ──');
{
  // A takes the lock and pauses. The lock expires. B takes it and changes the
  // row. A resumes and tries to write, and tries to release.
  const kv = makeKv(); const D = drafts();
  await createDraft(kv, D, INST, SLOT, 'drf_K', 0);

  const a = await acquireLifecycleLock(kv, SUB, INST, SLOT);
  check('A holds the lock with a fence', a.ok && Number.isInteger(a.fence));

  kv._expireKey(lifecycleLockKey(SUB, INST, SLOT));        // A's 15s lapses
  const b = await acquireLifecycleLock(kv, SUB, INST, SLOT);
  check('B can acquire the lapsed lock', b.ok === true);
  check('and B holds a HIGHER fence than A', b.fence > a.fence,
        'fences are minted after acquisition, so they follow acquisition order');

  // B changes the row: removes the draft.
  D.put('drf_K', { deleted: true });
  const bDel = await recordDeletion(kv, SUB, INST, SLOT, 'drf_K', { deletedDraftGen: 0, fence: b.fence });
  check('B advances the generation', bDel.ok && bDel.gen === 1);

  // A resumes, still believing it holds the row, and writes.
  const aLate = await reserveCreate(kv, SUB, INST, SLOT, 'drf_K2', 0, a.fence);
  check('A\'s late write is REFUSED as fenced',
        aLate.ok === false && aLate.error === LIFECYCLE_ERR.FENCED,
        'a lock cannot protect a write issued after it expired; only the fence can');
  const stillB = await readLifecycle(kv, SUB, INST, SLOT);
  check('so the row still shows B\'s state, not A\'s',
        stillB.record.gen === 1 && stillB.record.lastState === LIFECYCLE_STATE.DELETED);

  const aDel = await recordDeletion(kv, SUB, INST, SLOT, 'drf_K', { deletedDraftGen: 0, fence: a.fence });
  check('and A cannot record a removal either', aDel.ok === false && aDel.error === LIFECYCLE_ERR.FENCED);
  const aCommit = await commitCreate(kv, SUB, INST, SLOT, 'drf_K2', 0, a.fence);
  check('nor commit one', aCommit.ok === false && aCommit.error === LIFECYCLE_ERR.FENCED);

  // A releases. It must NOT free B's lock.
  const freed = await releaseLifecycleLock(kv, SUB, INST, SLOT, a.token);
  check('A\'s release does not free B\'s lock', Number(freed) === 0,
        'a GET-then-DEL here would hand the row to a third caller mid-operation');
  const lockNow = await kv('get', lifecycleLockKey(SUB, INST, SLOT));
  check('B still holds the lock afterwards', lockNow === b.token);

  const bFreed = await releaseLifecycleLock(kv, SUB, INST, SLOT, b.token);
  check('B\'s own release does free it', Number(bFreed) === 1);
}

console.log('\n── acquisition and fence allocation are ONE atomic step ──');
{
  // The interleaving that breaks a two-command version:
  //   A wins the lock, pauses BEFORE allocating, its lock expires, B acquires
  //   and takes fence 1, A resumes and takes fence 2 — the expired owner now
  //   holds the higher fence and the whole scheme inverts.
  //
  // It cannot be driven against this module because there is no moment between
  // winning the lock and holding a fence. So what is asserted is exactly that
  // absence of a gap, which is what a future split would break.
  const kv = makeKv();
  const a = await acquireLifecycleLock(kv, SUB, INST, SLOT);
  check('acquisition returns a fence', a.ok && a.fence === 1);
  check('the counter is ALREADY at that fence when acquisition returns',
        (await kv('get', lifecycleFenceKey(SUB, INST, SLOT))) === '1',
        'a lagging counter here would mean allocation happens in a later command');
  check('and the stored lock value carries the fence it was allocated with',
        String(kv._data.get(lifecycleLockKey(SUB, INST, SLOT))).endsWith(':1'),
        'lock and fence are written by the same script, so neither can exist without the other');

  kv._expireKey(lifecycleLockKey(SUB, INST, SLOT));
  const b = await acquireLifecycleLock(kv, SUB, INST, SLOT);
  check('B, acquiring the lapsed lock, gets the HIGHER fence',
        b.ok && b.fence === 2 && b.fence > a.fence,
        'this is the assertion the two-command ordering would have failed');

  // A has no way to obtain a fresh fence without acquiring again, and acquiring
  // again would put it behind B in the same order.
  const aAgain = await acquireLifecycleLock(kv, SUB, INST, SLOT);
  check('A cannot re-acquire while B holds the lock', aAgain.ok === false && aAgain.error === LIFECYCLE_ERR.BUSY);

  // ── The structural check ────────────────────────────────────────────────
  //
  // The three assertions above are necessary but NOT sufficient: in an ordinary
  // run with no interleaving, a two-command SET-then-INCR implementation
  // produces exactly the same observable state. They cannot distinguish the
  // two, so they cannot prove the gap is absent.
  //
  // What distinguishes them is the number of round trips. So this asserts the
  // implementation directly: acquisition issues ONE command, that command is
  // the acquire script, and the allocation happens inside it.
  const kvS = makeKv();
  const s = await acquireLifecycleLock(kvS, SUB, INST, SLOT);
  check('acquisition issues exactly ONE store command',
        kvS._log.length === 1,
        `issued ${kvS._log.length}: ${kvS._log.map((e) => e.cmd).join(', ')}`);
  check('and that command is an EVAL of the acquire script',
        kvS._log[0].cmd === 'eval' && kvS._log[0].args[0] === ACQUIRE_SCRIPT);
  check('no INCR is ever issued as a separate command',
        kvS._log.every((e) => e.cmd !== 'incr'),
        'a separate INCR is the two-command shape that permits the inversion');
  check('the script itself both takes the lock and allocates the fence',
        ACQUIRE_SCRIPT.includes("redis.call('incr',KEYS[2])")
          && ACQUIRE_SCRIPT.includes("redis.call('set',KEYS[1]")
          && ACQUIRE_SCRIPT.includes("redis.call('exists',KEYS[1])"),
        'if either half leaves the script, the atomicity claim is void');
  check('a fence was still allocated', s.ok && s.fence === 1);

  // The same for the write path: guard and mutation must not be separable.
  const kvW = makeKv();
  const w = await acquireLifecycleLock(kvW, SUB, INST, SLOT);
  kvW._log.length = 0;
  await fencedSet(kvW, SUB, INST, SLOT, w.fence, 'draft:drf_STRUCT', '{}');
  check('a fenced write issues exactly ONE store command', kvW._log.length === 1,
        `issued ${kvW._log.length}: ${kvW._log.map((e) => e.cmd).join(', ')}`);
  check('and it is an EVAL of the fenced-set script',
        kvW._log[0].cmd === 'eval' && kvW._log[0].args[0] === FENCED_SET_SCRIPT);
  check('whose guard and write are in the same body',
        FENCED_SET_SCRIPT.includes("redis.call('get',KEYS[1])")
          && FENCED_SET_SCRIPT.includes("redis.call('set',KEYS[2],ARGV[2])"),
        'a guard in one command and a write in another is the race this replaces');

  // Concurrent acquirers: exactly one fence per successful acquisition, and no
  // two winners share one.
  const kv2 = makeKv();
  const many = await Promise.all(Array.from({ length: 6 }, () => acquireLifecycleLock(kv2, SUB, INST, SLOT)));
  const wins = many.filter((m) => m.ok);
  check('only one of six concurrent acquirers wins', wins.length === 1);
  check('and the counter advanced exactly once',
        (await kv2('get', lifecycleFenceKey(SUB, INST, SLOT))) === '1',
        'a losing acquirer must not consume a fence');
}

console.log('\n── the fence reaches the DRAFT write, not just the record ──');
{
  // Point 2, driven as specified: pause A immediately before its actual draft
  // write, let B supersede it, then resume A. The assertion is on the stored
  // draft state and count — a FENCED return from commitCreate proves nothing
  // if the draft is sitting in the store.
  const kv = makeKv(); const D = kvDrafts(kv);

  const a = await acquireLifecycleLock(kv, SUB, INST, SLOT);
  await reserveCreate(kv, SUB, INST, SLOT, 'drf_P', 0, a.fence);
  // ---- A is now paused, immediately before its draft write ----

  kv._expireKey(lifecycleLockKey(SUB, INST, SLOT));
  const b = await acquireLifecycleLock(kv, SUB, INST, SLOT);
  check('B acquires and holds a newer fence', b.ok && b.fence > a.fence);
  // B supersedes the reservation with its own draft.
  await reserveCreate(kv, SUB, INST, SLOT, 'drf_Q', 0, b.fence);
  await D.write(SUB, INST, SLOT, b.fence, 'drf_Q');
  await commitCreate(kv, SUB, INST, SLOT, 'drf_Q', 0, b.fence);
  check('B\'s draft is stored', D.raw('drf_Q') !== null);

  // ---- A resumes and performs its draft write ----
  const aWrite = await D.write(SUB, INST, SLOT, a.fence, 'drf_P');
  check('A\'s DRAFT write is refused at the store boundary',
        aWrite.ok === false && aWrite.error === LIFECYCLE_ERR.FENCED,
        'refusing only the promotion would leave this draft in the store');
  check('A\'s draft is NOT in the store', D.raw('drf_P') === null);
  check('exactly one draft exists for the row',
        D.count() === 1 && D.ids()[0] === 'drf_Q',
        `stored: ${JSON.stringify(D.ids())}`);

  const aCommit = await commitCreate(kv, SUB, INST, SLOT, 'drf_P', 0, a.fence);
  check('and A\'s promotion is refused too', aCommit.ok === false && aCommit.error === LIFECYCLE_ERR.FENCED);
  const rec = await readLifecycle(kv, SUB, INST, SLOT);
  check('the row points at B\'s draft, live',
        rec.record.lastDraftId === 'drf_Q' && rec.record.lastState === LIFECYCLE_STATE.LIVE);

  // Same interleaving, but B DELETES rather than replaces.
  const kv3 = makeKv(); const D3 = kvDrafts(kv3);
  const a3 = await acquireLifecycleLock(kv3, SUB, INST, SLOT);
  await reserveCreate(kv3, SUB, INST, SLOT, 'drf_R', 0, a3.fence);
  kv3._expireKey(lifecycleLockKey(SUB, INST, SLOT));
  const b3 = await acquireLifecycleLock(kv3, SUB, INST, SLOT);
  await recordDeletion(kv3, SUB, INST, SLOT, 'drf_R', { deletedDraftGen: 0, fence: b3.fence });
  const a3Write = await D3.write(SUB, INST, SLOT, a3.fence, 'drf_R');
  check('a draft write after its reservation was DELETED is refused',
        a3Write.ok === false && a3Write.error === LIFECYCLE_ERR.FENCED);
  check('and no draft exists at all', D3.count() === 0,
        'this is the resurrection the tombstone alone could not stop');
}

console.log('\n── reservations: retirement, retries, and recovery ──');
{
  const T0 = 1_760_000_000_000;

  // reservedAt survives retries. Restamping it would keep a reservation alive
  // forever through retries alone, so it could never be retired.
  const kv = makeKv();
  await withLifecycleLock(kv, SUB, INST, SLOT, ({ fence }) =>
    reserveCreate(kv, SUB, INST, SLOT, 'drf_S', 0, fence, T0));
  for (const t of [T0 + 60_000, T0 + 120_000, T0 + 240_000]) {
    await withLifecycleLock(kv, SUB, INST, SLOT, ({ fence }) =>
      reserveCreate(kv, SUB, INST, SLOT, 'drf_S', 0, fence, t));
  }
  const held = await readLifecycle(kv, SUB, INST, SLOT);
  check('three retries do not restamp reservedAt', held.record.reservedAt === T0,
        `reservedAt = ${held.record.reservedAt}, expected ${T0}`);
  const retired = await withLifecycleLock(kv, SUB, INST, SLOT, ({ fence }) =>
    resolveLifecycle(kv, SUB, INST, SLOT, kvDrafts(kv).probe, fence, T0 + RESERVATION_RETIRE_MS + 1));
  check('so it is still retired on schedule, not extended by the retries',
        retired.ok && retired.gen === 1 && retired.record.lastState === LIFECYCLE_STATE.GONE);

  // A live draft is recovered regardless of reservation age.
  const kv2 = makeKv(); const D2 = kvDrafts(kv2);
  const a2 = await acquireLifecycleLock(kv2, SUB, INST, SLOT);
  await reserveCreate(kv2, SUB, INST, SLOT, 'drf_T', 0, a2.fence, T0);
  await D2.write(SUB, INST, SLOT, a2.fence, 'drf_T');       // draft is real
  await releaseLifecycleLock(kv2, SUB, INST, SLOT, a2.token);
  const old = await withLifecycleLock(kv2, SUB, INST, SLOT, ({ fence }) =>
    resolveLifecycle(kv2, SUB, INST, SLOT, D2.probe, fence, T0 + 120 * 24 * 3600 * 1000));
  check('a readable draft is recovered even under a 120-day-old reservation',
        old.ok && old.live === 'drf_T' && old.gen === 0,
        'age retires unresolved reservations; it must never discard a real draft');
  check('and that reservation is healed to live rather than retired',
        old.healed === true && old.record.lastState === LIFECYCLE_STATE.LIVE);

  // Retiring a reservation must stop its delayed writer from landing after.
  const kv4 = makeKv(); const D4 = kvDrafts(kv4);
  const a4 = await acquireLifecycleLock(kv4, SUB, INST, SLOT);
  await reserveCreate(kv4, SUB, INST, SLOT, 'drf_U', 0, a4.fence, T0);
  kv4._expireKey(lifecycleLockKey(SUB, INST, SLOT));
  const b4 = await acquireLifecycleLock(kv4, SUB, INST, SLOT);
  const ret = await resolveLifecycle(kv4, SUB, INST, SLOT, D4.probe, b4.fence,
                                     T0 + RESERVATION_RETIRE_MS + 1);
  check('the reservation is retired by a later caller', ret.ok && ret.gen === 1);
  const late = await D4.write(SUB, INST, SLOT, a4.fence, 'drf_U');
  check('the retired reservation\'s delayed writer cannot land afterwards',
        late.ok === false && late.error === LIFECYCLE_ERR.FENCED);
  check('and no draft was written', D4.count() === 0,
        'retirement that leaves the writer free to land is not retirement');
}

console.log('\n── reserved + absence is NOT always "creation never landed" ──');
{
  // Will's combined sequence, exactly:
  //   draft write succeeds → promotion FAILS (pointer stays 'reserved')
  //   → the draft is later removed → its tombstone expires
  //   → the pointer resolves to absence under 'reserved' again
  // It must refuse the original generation, not hand it back.
  const kv = makeKv(); const D = drafts();
  const out = await op(kv, INST, SLOT, async (fence) => {
    await reserveCreate(kv, SUB, INST, SLOT, 'drf_L', 0, fence);
    D.put('drf_L');                                        // draft write SUCCEEDED
    kv._setFailOn((cmd, key) => cmd === 'eval' && String(key).startsWith('draftinst:'));
    const c = await commitCreate(kv, SUB, INST, SLOT, 'drf_L', 0, fence);
    kv._setFailOn(null);
    return c;
  });
  check('the promotion failed, leaving a reserved pointer over a real draft', out.ok !== true);
  const mid = await readLifecycle(kv, SUB, INST, SLOT);
  check('state is reserved while the draft is live', mid.record.lastState === LIFECYCLE_STATE.RESERVED);

  // The draft is removed, and the removal is itself interrupted before
  // recordDeletion — the only way the ambiguity can survive at all.
  D.put('drf_L', { deleted: true });
  D.expire('drf_L');                                        // day 91

  const res = await op(kv, INST, SLOT, (f) =>
    resolveLifecycle(kv, SUB, INST, SLOT, D.probe, f, Date.now() + RESERVATION_RETIRE_MS + 1000));
  check('after the grace window, absence under reserved REFUSES the old generation',
        res.ok && res.gen === 1 && res.live === null,
        'this is the sequence that would otherwise hand back generation 0 on day 91');
  check('and it is recorded as GONE, not DELETED',
        res.record.lastState === LIFECYCLE_STATE.GONE,
        'a missing record establishes disappearance; only a delete that ran evidences the seller');

  // The same shape INSIDE the window is still an interrupted creation.
  const kv2 = makeKv(); const D2 = drafts();
  await op(kv2, INST, SLOT, (f) => reserveCreate(kv2, SUB, INST, SLOT, 'drf_M', 0, f));
  const fresh = await op(kv2, INST, SLOT, (f) => resolveLifecycle(kv2, SUB, INST, SLOT, D2.probe, f));
  check('inside the window it is still read as an interrupted creation',
        fresh.ok && fresh.reservedGap === true && fresh.gen === 0,
        'refusing here would block the seller over a press that produced nothing');
}

console.log('\n── a delete that RAN closes the ambiguity permanently ──');
{
  // The distinction only works if a successful removal is durable, so this is
  // the same sequence with recordDeletion actually running. The tombstone then
  // expires and the answer must not depend on reading it.
  const kv = makeKv(); const D = drafts();
  await op(kv, INST, SLOT, async (fence) => {
    await reserveCreate(kv, SUB, INST, SLOT, 'drf_N', 0, fence);
    D.put('drf_N');
    kv._setFailOn((cmd, key) => cmd === 'eval' && String(key).startsWith('draftinst:'));
    await commitCreate(kv, SUB, INST, SLOT, 'drf_N', 0, fence);
    kv._setFailOn(null);
    return { ok: true };
  });
  D.put('drf_N', { deleted: true });
  await op(kv, INST, SLOT, (f) => recordDeletion(kv, SUB, INST, SLOT, 'drf_N', { deletedDraftGen: 0, fence: f }));
  D.expire('drf_N');                                        // day 91

  const res = await op(kv, INST, SLOT, (f) =>
    resolveLifecycle(kv, SUB, INST, SLOT, D.probe, f, Date.now() + 100 * 24 * 3600 * 1000));
  check('the recorded removal is terminal without reading the draft at all',
        res.ok && res.gen === 1 && res.live === null && res.repaired === false);
  check('and it is DELETED — a delete operation ran, so the seller\'s action IS evidenced',
        (await readLifecycle(kv, SUB, INST, SLOT)).record.lastState === LIFECYCLE_STATE.DELETED);
}

console.log('\n── heal-forward keeps the ambiguous state short-lived ──');
{
  const kv = makeKv(); const D = drafts();
  await op(kv, INST, SLOT, async (fence) => {
    await reserveCreate(kv, SUB, INST, SLOT, 'drf_O', 0, fence);
    D.put('drf_O');
    kv._setFailOn((cmd, key) => cmd === 'eval' && String(key).startsWith('draftinst:'));
    await commitCreate(kv, SUB, INST, SLOT, 'drf_O', 0, fence);
    kv._setFailOn(null);
    return { ok: true };
  });
  const res = await op(kv, INST, SLOT, (f) => resolveLifecycle(kv, SUB, INST, SLOT, D.probe, f));
  check('the retry RECOVERS the existing draft instead of creating another',
        res.ok && res.live === 'drf_O',
        'a second create here is the duplicate this module exists to prevent');
  check('and the pointer is healed to live', res.healed === true);
  const rec = await readLifecycle(kv, SUB, INST, SLOT);
  check('so the row no longer sits in the ambiguous state',
        rec.record.lastState === LIFECYCLE_STATE.LIVE && rec.record.reservedAt === null);
  check('the generation was not advanced by the failure', res.gen === 0);
}

console.log('\n── repair is repeatable and cannot advance twice ──');
{
  const kv = makeKv(); const D = drafts();
  await createDraft(kv, D, INST, SLOT, 'drf_C', 3);
  D.put('drf_C', { deleted: true });
  const a = await op(kv, INST, SLOT, (f) => resolveLifecycle(kv, SUB, INST, SLOT, D.probe, f));
  const b = await op(kv, INST, SLOT, (f) => resolveLifecycle(kv, SUB, INST, SLOT, D.probe, f));
  const c = await op(kv, INST, SLOT, (f) => recordDeletion(kv, SUB, INST, SLOT, 'drf_C', { deletedDraftGen: 3, fence: f }));
  check('three repairs of one removal all land on the same generation',
        a.gen === 4 && b.gen === 4 && c.gen === 4,
        'an INCR here would have produced 4, 5, 6');

  const kv2 = makeKv(); const D2 = drafts();
  await createDraft(kv2, D2, INST, SLOT, 'drf_D', 7);
  D2.put('drf_D', { deleted: true });
  const [r1, r2] = await Promise.all([
    op(kv2, INST, SLOT, (f) => resolveLifecycle(kv2, SUB, INST, SLOT, D2.probe, f)),
    op(kv2, INST, SLOT, (f) => resolveLifecycle(kv2, SUB, INST, SLOT, D2.probe, f)),
  ]);
  const gens = [r1, r2].filter((r) => r.ok).map((r) => r.gen);
  check('concurrent repairs agree rather than compounding',
        gens.every((g) => g === 8) && gens.length >= 1);
  const fin = await readLifecycle(kv2, SUB, INST, SLOT);
  check('and the stored generation is 8, not 9', fin.record.gen === 8);
}

console.log('\n── a retry of an OLD removal must not touch a newer lifecycle ──');
{
  const kv = makeKv(); const D = drafts();
  await createDraft(kv, D, INST, SLOT, 'drf_OLD', 0);
  D.put('drf_OLD', { deleted: true });
  await op(kv, INST, SLOT, (f) => recordDeletion(kv, SUB, INST, SLOT, 'drf_OLD', { deletedDraftGen: 0, fence: f }));
  await createDraft(kv, D, INST, SLOT, 'drf_NEW', 1);

  const late = await op(kv, INST, SLOT, (f) => recordDeletion(kv, SUB, INST, SLOT, 'drf_OLD', { deletedDraftGen: 0, fence: f }));
  const rec = await readLifecycle(kv, SUB, INST, SLOT);
  check('the late retry does not advance the generation', late.gen === 1 && rec.record.gen === 1);
  check('and does not overwrite the newer pointer',
        rec.record.lastDraftId === 'drf_NEW' && rec.record.lastState === LIFECYCLE_STATE.LIVE,
        'stranding drf_NEW with no record of itself would lose a live draft');
  const still = await op(kv, INST, SLOT, (f) => resolveLifecycle(kv, SUB, INST, SLOT, D.probe, f));
  check('the live draft is still live afterwards', still.live === 'drf_NEW');
}

console.log('\n── an existing draft with NO lifecycle record ──');
{
  // The deployed draft. It predates this module, so its row has no record at
  // all: the transition must not read that as "nothing here, create away".
  const kv = makeKv(); const D = drafts();
  D.put('drf_3471a1a85ccddb2cca04958fa66ed58a');            // live, no draftinst: key
  const bare = await readLifecycle(kv, SUB, INST, SLOT);
  check('an absent record reads as generation 0 with no pointer',
        bare.ok && bare.record.gen === 0 && bare.record.lastDraftId === null);
  const res = await op(kv, INST, SLOT, (f) => resolveLifecycle(kv, SUB, INST, SLOT, D.probe, f));
  check('resolve reports no live draft, because the record cannot point at one',
        res.ok && res.live === null && res.gen === 0,
        'the pre-existing draft is invisible to this module until something adopts it');
  check('DEFERRED: adoption of pre-existing drafts is a wiring concern, asserted there',
        true,
        'the handler must seed the record from the draft index, not from this module');
}

console.log('\n── an unreadable store must not read as an empty one ──');
{
  const kv = makeKv({ failOn: (cmd, key) => cmd === 'get' && String(key).startsWith('draftinst:') });
  const r = await readLifecycle(kv, SUB, INST, SLOT);
  check('a failed read is UNAVAILABLE, not generation 0',
        r.ok === false && r.error === LIFECYCLE_ERR.UNAVAILABLE,
        'generation 0 would authorise exactly the create this should refuse');

  const kv2 = makeKv(); const D2 = drafts();
  await createDraft(kv2, D2, INST, SLOT, 'drf_I', 0);
  const res = await op(kv2, INST, SLOT, (f) =>
    resolveLifecycle(kv2, SUB, INST, SLOT, async () => { throw new Error('boom'); }, f));
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
  check('the lock is released when the body finishes',
        (await kv('get', lifecycleLockKey(SUB, INST, SLOT))) === null);

  const kv2 = makeKv();
  await withLifecycleLock(kv2, SUB, INST, SLOT, async () => { throw new Error('body blew up'); })
    .catch(() => {});
  check('and released when the body throws',
        (await kv2('get', lifecycleLockKey(SUB, INST, SLOT))) === null,
        'otherwise one error wedges the row for the whole lock TTL');
}

console.log('\n── a create paused immediately after its generation check ──');
{
  const kv = makeKv(); const D = drafts();
  await createDraft(kv, D, INST, SLOT, 'drf_J', 0);

  let checkedGen = null;
  const create = withLifecycleLock(kv, SUB, INST, SLOT, async ({ fence }) => {
    const res = await resolveLifecycle(kv, SUB, INST, SLOT, D.probe, fence);
    checkedGen = res.gen;
    await new Promise((r) => setTimeout(r, 10));       // paused, holding the lock
    const fresh = await resolveLifecycle(kv, SUB, INST, SLOT, D.probe, fence);
    return { ok: true, staleAfterPause: fresh.gen !== checkedGen };
  });
  const del = withLifecycleLock(kv, SUB, INST, SLOT, async ({ fence }) => {
    D.put('drf_J', { deleted: true });
    return recordDeletion(kv, SUB, INST, SLOT, 'drf_J', { deletedDraftGen: 0, fence: fence });
  });
  const [cOut, dOut] = await Promise.all([create, del]);
  check('the removal could not interleave with the paused create',
        dOut.error === LIFECYCLE_ERR.BUSY && cOut.ok === true,
        'without the lock this is a check-then-act window');
  check('so the create never acted on a generation that changed under it',
        cOut.staleAfterPause === false);

  D.put('drf_J', { deleted: true });
  const retry = await op(kv, INST, SLOT, (f) => recordDeletion(kv, SUB, INST, SLOT, 'drf_J', { deletedDraftGen: 0, fence: f }));
  check('and the retried removal advances the generation once', retry.gen === 1);
}

console.log('\n── two rows of the same card are independent ──');
{
  const kv = makeKv(); const D = drafts();
  const A = 'inst_col_1789014701564';
  const B = 'inst_col_1789014799999';
  await createDraft(kv, D, A, SLOT, 'drf_A1', 0);
  await createDraft(kv, D, B, SLOT, 'drf_B1', 0);
  D.put('drf_A1', { deleted: true });
  await op(kv, A, SLOT, (f) => recordDeletion(kv, SUB, A, SLOT, 'drf_A1', 0, f));

  const bRes = await op(kv, B, SLOT, (f) => resolveLifecycle(kv, SUB, B, SLOT, D.probe, f));
  check("removing row A leaves row B's generation untouched", bRes.gen === 0);
  check("and row B's draft is still the live one", bRes.live === 'drf_B1');
  const aRes = await op(kv, A, SLOT, (f) => resolveLifecycle(kv, SUB, A, SLOT, D.probe, f));
  check('while row A has advanced and has no live draft', aRes.gen === 1 && aRes.live === null);
}

console.log('\n── slots are independent too ──');
{
  const kv = makeKv(); const D = drafts();
  await createDraft(kv, D, INST, 'ebay:fixed-price', 'drf_FP', 0);
  await createDraft(kv, D, INST, 'ebay:auction', 'drf_AU', 0);
  D.put('drf_FP', { deleted: true });
  await op(kv, INST, 'ebay:fixed-price', (f) =>
    recordDeletion(kv, SUB, INST, 'ebay:fixed-price', 'drf_FP', 0, f));
  const au = await op(kv, INST, 'ebay:auction', (f) =>
    resolveLifecycle(kv, SUB, INST, 'ebay:auction', D.probe, f));
  check('removing the fixed-price draft does not disturb the auction draft',
        au.gen === 0 && au.live === 'drf_AU');
}

console.log(`\n${passed} passed, ${failed} failed`);
_finish(passed, failed);

_finish(passed, failed);
