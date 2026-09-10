// api/_draftLifecycle.js — one live draft per (seller, instance, slot), and a
// durable record of what happened to the last one.
//
// ── Why this module exists ───────────────────────────────────────────────────
//
// Idempotency records answer "have I seen THIS request before". They cannot
// answer "was the draft this request would create already removed", because
// they expire: `idem:*` and `idemresource:*` carry KEY_TTL_SEC, so a request
// delayed past the window finds nothing recorded and proceeds as if new. Asking
// a 24-hour cache to provide indefinite protection is asking the wrong object.
//
// So the lifecycle of "the listing draft for this row in this venue slot" gets
// its own record, and that record has NO TTL. It is the durable half:
//
//   idem:*        ≤ 24 h   same request twice          → replay
//   draftinst:*   forever  a later request, older gen  → refused
//
// ── Why the tombstone is not enough ─────────────────────────────────────────
//
// The obvious design reconstructs everything from tombstones: a removed draft
// leaves one, so read it and refuse. But tombstones carry a 90-day retention
// TTL. On day 91 the tombstone is gone and a read returns NOT_FOUND, which is
// indistinguishable from "this draft never existed" — and "never existed" is
// exactly the answer that lets a create proceed. A protection reconstructed
// solely from expiring evidence expires with it.
//
// This record fixes that by remembering the POINTER durably.
//
// ── What the pointer actually proves ────────────────────────────────────────
//
// Careful with the wording here, because the earlier version of this comment
// overclaimed. `lastDraftId` + `lastState: 'live'` + a read that finds nothing
// establishes DISAPPEARANCE: something was there, we recorded it, it is no
// longer readable. It does NOT establish that the seller deleted it. Retention
// lapse, eviction, a partial restore and an operator error all produce the same
// observation.
//
// Refusing that generation is therefore a POLICY, chosen because the two
// possible errors are not symmetric: refusing a create the seller is entitled
// to costs them one extra press, while allowing one recreates a listing draft
// they may have deliberately removed. The record says "this generation is
// spent", not "the seller deleted it". Only `lastState: 'deleted'`, written by
// a delete operation that actually ran, is evidence of the seller's action.
//
// ── Why 'reserved' is a distinct state, and why it is time-bounded ──────────
//
// Without it, an interrupted CREATE and a disappeared draft look identical: a
// pointer to a draft that cannot be read. They need opposite answers — the
// interrupted create must be completable, the disappeared draft must be
// refused. So the pointer is written BEFORE the draft, in state 'reserved', and
// promoted to 'live' after.
//
// But 'reserved' alone is not enough, and the gap was in this module's first
// version. A create whose draft write SUCCEEDS and whose promotion FAILS
// leaves a real draft under a 'reserved' pointer. Delete that draft, let the
// tombstone expire, and the pointer resolves to absence-under-reserved again —
// so the state that means "nothing was ever written" would be read off a row
// where something was written and then removed, and the original generation
// would be handed back.
//
// Two things close it:
//
//   1. `reservedAt`, and a short grace window. An interrupted creation is
//      resolved in seconds; it is never 90 days old. Absence under 'reserved'
//      is read as an interrupted creation only INSIDE the window, and as a
//      disappearance outside it. The default outside the window is refusal,
//      which is the safe direction.
//   2. Heal-forward. Any resolve that finds the draft readable and live
//      promotes the pointer to 'live'. So a 'reserved' pointer over a real
//      draft is corrected the first time anything looks at the row, rather
//      than persisting until it becomes ambiguous.
//
// ── Why repair is a max, not an increment ────────────────────────────────────
//
// Repair has to be repeatable: it runs from create, from eligibility, and from
// concurrent callers, and an INCR in that position advances once per caller
// rather than once per removal. So the removed draft's own generation is
// persisted and repair sets `gen = max(gen, lastDraftGen + 1)`. Idempotent by
// construction, and monotonic: a retry of an OLD removal computes a lower bound
// than a newer lifecycle already holds, so it cannot drag a live generation
// backwards or advance it a second time.
//
// ── Why a lock is not sufficient on its own ─────────────────────────────────
//
// A lock with a TTL can expire while its owner is still running. Then:
//
//   A takes the lock and pauses → the lock expires → B takes it and changes the
//   row → A resumes and writes.
//
// A's write is stale by then, and no amount of care inside A prevents it: A
// cannot tell that time passed. So the lock is NOT the protection for writes.
// Every acquisition mints a monotonic FENCE, the fence is stored on the record,
// and a write carrying a fence lower than the record's is refused. An expired
// owner is fenced out by arithmetic rather than by hoping it noticed.
//
// Release is compare-and-delete in one command, so A resuming late cannot
// release B's lock either.

const RECORD_VERSION = 1;

// Long enough to cover a create or delete round trip, short enough that a
// crashed holder does not wedge the row.
export const LOCK_TTL_SEC = 15;

// How long absence under 'reserved' is read as an interrupted creation. A
// creation interruption resolves within one request; this is generous by two
// orders of magnitude and still nowhere near the tombstone's 90 days.
export const RESERVED_GRACE_MS = 5 * 60 * 1000;

export const LIFECYCLE_STATE = {
  RESERVED: 'reserved',
  LIVE:     'live',
  DELETED:  'deleted',      // a delete operation ran: evidence of seller action
  GONE:     'gone',         // disappeared without a recorded delete
};

export const LIFECYCLE_ERR = {
  BUSY:         'lifecycle-busy',
  STALE_GEN:    'lifecycle-stale-gen',
  ALREADY_LIVE: 'lifecycle-already-live',
  FENCED:       'lifecycle-fenced',       // caller's lock lapsed; write refused
  UNAVAILABLE:  'lifecycle-unavailable',
};

// ── Keys ────────────────────────────────────────────────────────────────────
//
// Scope is (sub, instanceId, slot). NOT the sku: two collection rows of the
// same card are different instances, and a shared counter would advance row B's
// generation when row A is removed, minting an unseen key for B and producing a
// second live draft for B while B's first is still active. That is the duplicate
// this module exists to prevent, so the scope cannot be the thing that causes it.
//
// Both components are safe to embed: `instanceId` is required and length-capped
// on write (_draftStore.js:522) and immutable thereafter (_draftStore.js:695),
// and `slot` is drawn from the fixed SLOT_RULES table.

export function lifecycleKey(sub, instanceId, slot) {
  return `draftinst:${sub}:${instanceId}:${slot}`;
}
export function lifecycleLockKey(sub, instanceId, slot) {
  return `draftinstlock:${sub}:${instanceId}:${slot}`;
}
export function lifecycleFenceKey(sub, instanceId, slot) {
  return `draftinstfence:${sub}:${instanceId}:${slot}`;
}

function emptyRecord() {
  return {
    v: RECORD_VERSION,
    gen: 0,
    fence: 0,
    lastDraftId: null,
    lastDraftGen: null,
    lastState: null,
    reservedAt: null,
  };
}

function parseRecord(raw) {
  if (raw === null || raw === undefined) return emptyRecord();
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return null; }   // null = unreadable
  }
  if (!obj || typeof obj !== 'object') return null;
  const gen = Number(obj.gen);
  if (!Number.isInteger(gen) || gen < 0) return null;
  const fence = Number(obj.fence);
  // `Number(null)` is 0, and 0 is an integer — so a bare Number.isInteger()
  // coercion silently turns "no value" into a real one. That matters in both
  // nullable fields below: lastDraftGen 0 instead of null changes the repair
  // floor, and reservedAt 0 is a timestamp at the epoch, which would age every
  // fresh reservation out of the grace window instantly. Absence stays absent.
  const num = (x) => ((x === null || x === undefined || x === '' || !Number.isInteger(Number(x)))
    ? null : Number(x));
  return {
    v: Number(obj.v) || RECORD_VERSION,
    gen,
    fence: Number.isInteger(fence) && fence >= 0 ? fence : 0,
    lastDraftId: typeof obj.lastDraftId === 'string' ? obj.lastDraftId : null,
    lastDraftGen: num(obj.lastDraftGen),
    lastState: typeof obj.lastState === 'string' ? obj.lastState : null,
    reservedAt: num(obj.reservedAt),
  };
}

// ── Read ────────────────────────────────────────────────────────────────────
//
// An unreadable record is NOT an absent one. Treating "the store would not
// answer" as "generation 0, nothing here" would let a create through on exactly
// the failure it should refuse on.

export async function readLifecycle(kv, sub, instanceId, slot) {
  let raw;
  try {
    raw = await kv('get', lifecycleKey(sub, instanceId, slot));
  } catch {
    return { ok: false, error: LIFECYCLE_ERR.UNAVAILABLE };
  }
  const rec = parseRecord(raw);
  if (rec === null) return { ok: false, error: LIFECYCLE_ERR.UNAVAILABLE, unreadable: true };
  return { ok: true, record: rec };
}

/**
 * Every write goes through here, and every write is fenced. `fence` is the
 * value minted when the caller acquired the lock; a record already stamped with
 * a HIGHER fence belongs to a later owner, so this caller's lock lapsed and its
 * write is stale by definition.
 */
async function writeLifecycle(kv, sub, instanceId, slot, rec, fence) {
  if (!Number.isInteger(fence)) return { ok: false, error: LIFECYCLE_ERR.FENCED, reason: 'no-fence' };
  const cur = await readLifecycle(kv, sub, instanceId, slot);
  if (!cur.ok) return cur;
  if (cur.record.fence > fence) {
    return { ok: false, error: LIFECYCLE_ERR.FENCED, held: cur.record.fence, mine: fence };
  }
  try {
    await kv(
      'set', lifecycleKey(sub, instanceId, slot),
      JSON.stringify({ ...rec, v: RECORD_VERSION, fence }),
    );
    return { ok: true, record: { ...rec, fence } };
  } catch {
    return { ok: false, error: LIFECYCLE_ERR.UNAVAILABLE };
  }
}

// ── Lock, with a fence ──────────────────────────────────────────────────────
//
// A generation read followed by an unprotected write is a check-then-act race:
// a delete landing between the two leaves the create writing a draft against a
// generation that no longer exists. So every state transition for a row happens
// under this lock — create, delete, and repair alike. Repair is included
// deliberately: it writes, and an unlocked repair racing a delete can compute
// its max from a record the delete is mid-way through replacing.
//
// Losing the lock is BUSY and retryable, never a fallthrough. The precedent is
// the idempotency reservation, which learned this the hard way: a plain SET let
// three simultaneous creates each believe they were first.
//
// The fence is minted AFTER the lock is won, so fences are handed out in
// acquisition order and a later owner always holds a higher one.

export async function acquireLifecycleLock(kv, sub, instanceId, slot) {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  let won;
  try {
    won = await kv(
      'set', lifecycleLockKey(sub, instanceId, slot), token,
      'NX', 'EX', String(LOCK_TTL_SEC),
    );
  } catch {
    return { ok: false, error: LIFECYCLE_ERR.UNAVAILABLE };
  }
  if (won !== 'OK') return { ok: false, error: LIFECYCLE_ERR.BUSY, retryable: true };

  let fence;
  try {
    fence = Number(await kv('incr', lifecycleFenceKey(sub, instanceId, slot)));
  } catch {
    await releaseLifecycleLock(kv, sub, instanceId, slot, token);
    return { ok: false, error: LIFECYCLE_ERR.UNAVAILABLE };
  }
  if (!Number.isInteger(fence)) {
    await releaseLifecycleLock(kv, sub, instanceId, slot, token);
    return { ok: false, error: LIFECYCLE_ERR.UNAVAILABLE };
  }
  return { ok: true, token, fence };
}

// Compare-and-delete in ONE command. A separate GET then DEL is a race: the
// lock can expire between them and be re-acquired by another caller, and the
// DEL then frees a lock this caller does not hold — handing the row to a third
// caller while the second is still working.
const UNLOCK_SCRIPT =
  "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";

export async function releaseLifecycleLock(kv, sub, instanceId, slot, token) {
  try {
    return await kv('eval', UNLOCK_SCRIPT, '1', lifecycleLockKey(sub, instanceId, slot), token);
  } catch {
    // Could not release. The lock expires on its own, and correctness does not
    // depend on this call: writes are fenced, so a stale owner cannot commit
    // regardless of who holds the lock key.
    return 0;
  }
}

/**
 * Run `fn({ fence, token })` holding the row lock. `fn` must do its reads
 * INSIDE the critical section — a value read before the lock was taken is
 * exactly the stale value the lock exists to prevent acting on — and must pass
 * `fence` to every write.
 */
export async function withLifecycleLock(kv, sub, instanceId, slot, fn) {
  const got = await acquireLifecycleLock(kv, sub, instanceId, slot);
  if (!got.ok) return got;
  try {
    return await fn({ fence: got.fence, token: got.token });
  } finally {
    await releaseLifecycleLock(kv, sub, instanceId, slot, got.token);
  }
}

// ── Resolve, and repair while we are here ───────────────────────────────────
//
// THE HOLE THIS CLOSES. Comparing the request's generation against the stored
// generation is not sufficient, because the stored generation can be wrong in
// the one direction that matters:
//
//   1. delete writes the tombstone, then stops before advancing the generation
//   2. the idempotency records expire
//   3. an old create arrives, with no eligibility read in between
//   4. its generation still equals the stored generation — the comparison PASSES
//
// Eligibility-side repair does not save this: nothing guarantees it ran. So the
// create path resolves the authoritative state itself, from the draft record,
// and repairs as a side effect. Eligibility may call this too, for the seller's
// convenience, but correctness does not depend on it having done so.
//
// `readDraftRaw(draftId)` must return `{ found, deleted }`. Injected rather
// than imported so this module does not depend on the store's HTTP-shaped error
// vocabulary, and so the interruption cases are testable without Redis.
export async function resolveLifecycle(kv, sub, instanceId, slot, readDraftRaw, fence, now = Date.now()) {
  const r = await readLifecycle(kv, sub, instanceId, slot);
  if (!r.ok) return r;
  const rec = r.record;

  // Nothing has ever happened here, or the last thing that happened is already
  // recorded as terminal. Either way the stored generation is correct.
  if (!rec.lastDraftId
      || rec.lastState === LIFECYCLE_STATE.DELETED
      || rec.lastState === LIFECYCLE_STATE.GONE) {
    return { ok: true, record: rec, gen: rec.gen, live: null, repaired: false };
  }

  let probe;
  try {
    probe = await readDraftRaw(rec.lastDraftId);
  } catch {
    // Could not establish the draft's state. Refusing to guess: reporting
    // "no live draft" here would authorise a create that duplicates a draft we
    // simply failed to read.
    return { ok: false, error: LIFECYCLE_ERR.UNAVAILABLE };
  }

  const { found, deleted } = probe || {};

  // ── The draft is there and live ──────────────────────────────────────────
  if (found && !deleted) {
    // Heal forward. A 'reserved' pointer over a real draft is a promotion that
    // failed, and leaving it reserved is what makes absence ambiguous later.
    // Fixing it the first time anything looks at the row keeps the ambiguous
    // state short-lived rather than indefinite.
    if (rec.lastState === LIFECYCLE_STATE.RESERVED && Number.isInteger(fence)) {
      const promoted = { ...rec, lastState: LIFECYCLE_STATE.LIVE, reservedAt: null };
      const w = await writeLifecycle(kv, sub, instanceId, slot, promoted, fence);
      if (w.ok) return { ok: true, record: w.record, gen: rec.gen, live: rec.lastDraftId, healed: true };
      if (w.error === LIFECYCLE_ERR.FENCED) return w;
      // Could not persist the promotion; the observation still stands.
    }
    return { ok: true, record: rec, gen: rec.gen, live: rec.lastDraftId, repaired: false };
  }

  // ── The draft is tombstoned: a delete ran ────────────────────────────────
  if (found && deleted) {
    return advance(kv, sub, instanceId, slot, rec, LIFECYCLE_STATE.DELETED, fence);
  }

  // ── The draft is not readable at all ─────────────────────────────────────
  //
  // Absence under 'reserved' is an interrupted creation ONLY inside the grace
  // window. Outside it, the ambiguity Will identified applies: a draft may have
  // been written under a reserved pointer, then removed, then had its tombstone
  // expire — which lands here looking identical to a create that never wrote
  // anything. The two are indistinguishable from this observation, so the
  // window decides, and outside it the answer is refusal.
  if (rec.lastState === LIFECYCLE_STATE.RESERVED) {
    const age = rec.reservedAt === null ? Infinity : now - rec.reservedAt;
    if (age <= RESERVED_GRACE_MS) {
      return { ok: true, record: rec, gen: rec.gen, live: null, reservedGap: true, repaired: false };
    }
    // Stale reservation. Not evidence of a seller deletion, so it is recorded
    // as GONE rather than DELETED, and the generation is spent either way.
    return advance(kv, sub, instanceId, slot, rec, LIFECYCLE_STATE.GONE, fence);
  }

  // Was 'live', now unreadable. Disappearance — which may be a removal whose
  // tombstone has expired, or may be eviction or loss. Refusing this generation
  // is the policy; claiming the seller deleted it is not supported here.
  return advance(kv, sub, instanceId, slot, rec, LIFECYCLE_STATE.GONE, fence);
}

async function advance(kv, sub, instanceId, slot, rec, terminalState, fence) {
  const floor = (rec.lastDraftGen === null ? rec.gen : rec.lastDraftGen) + 1;
  const nextGen = Math.max(rec.gen, floor);
  const next = { ...rec, gen: nextGen, lastState: terminalState, reservedAt: null };

  if (!Number.isInteger(fence)) {
    // Read-only caller (no lock held). The conclusion is what matters and is
    // returned; the repair is left to a caller that holds the lock.
    return { ok: true, record: next, gen: nextGen, live: null, repaired: true, persisted: false };
  }
  const w = await writeLifecycle(kv, sub, instanceId, slot, next, fence);
  if (!w.ok) {
    if (w.error === LIFECYCLE_ERR.FENCED) return w;
    // The repair did not persist, but the conclusion stands and is what the
    // caller must act on: this generation is spent. The next resolve retries
    // the write.
    return { ok: true, record: next, gen: nextGen, live: null, repaired: true, persisted: false };
  }
  return { ok: true, record: w.record, gen: nextGen, live: null, repaired: true, persisted: true };
}

// ── Removal ─────────────────────────────────────────────────────────────────
//
// Ordering is fixed and only one order is safe: the tombstone is written FIRST,
// by the caller, and this runs after. Advancing the generation before the
// tombstone means a delete that then FAILS leaves a bumped generation, so the
// next create mints an unseen key and produces a second live draft while the
// first is still there. Tombstone-first fails toward blocked;
// generation-first fails toward duplicated. Blocked self-heals through
// `resolveLifecycle`; duplicated does not self-heal at all.
//
// This is also the write that closes the reserved/absence ambiguity for good:
// a delete that RAN leaves `lastState: 'deleted'`, which resolve treats as
// terminal without needing to read the draft at all. So the ambiguity survives
// only where the delete was itself interrupted, and there the grace window
// decides.
//
// `deletedDraftGen` is the generation the removed draft was CREATED at, which
// is why it is persisted on create. Advancing to `max(gen, thatGen + 1)` makes
// this safe to call twice, safe to call concurrently, and safe to call late.
export async function recordDeletion(kv, sub, instanceId, slot, draftId, deletedDraftGen, fence) {
  const r = await readLifecycle(kv, sub, instanceId, slot);
  if (!r.ok) return r;
  const rec = r.record;

  const known = Number.isInteger(deletedDraftGen)
    ? deletedDraftGen
    : (rec.lastDraftId === draftId ? rec.lastDraftGen : null);

  const floor = (known === null ? rec.gen : known) + 1;
  const nextGen = Math.max(rec.gen, floor);

  // Only move the pointer if this removal is about the draft the pointer
  // names. An older draft's removal must not overwrite a newer lifecycle's
  // pointer — that would strand the newer draft with no record of itself.
  const pointerIsThis = rec.lastDraftId === draftId || rec.lastDraftId === null;

  const next = pointerIsThis
    ? { ...rec, gen: nextGen, lastDraftId: draftId, lastDraftGen: known,
        lastState: LIFECYCLE_STATE.DELETED, reservedAt: null }
    : { ...rec, gen: nextGen };

  const w = await writeLifecycle(kv, sub, instanceId, slot, next, fence);
  if (!w.ok) return { ...w, gen: nextGen };
  return { ok: true, record: w.record, gen: nextGen, advanced: nextGen !== rec.gen };
}

// ── Creation, in two writes ─────────────────────────────────────────────────
//
// `reserveCreate` writes the pointer before the draft exists; `commitCreate`
// promotes it once the draft is durable. The gap between them is the
// 'reserved' state.
//
// If the draft write succeeds and `commitCreate` fails, the pointer stays
// 'reserved' while the draft is real. `resolveLifecycle` reads that draft,
// finds it live, reports it as the live draft — so the retry recovers the
// existing draft instead of creating another — and heals the pointer forward so
// the row does not sit in the ambiguous state.
export async function reserveCreate(kv, sub, instanceId, slot, draftId, gen, fence, now = Date.now()) {
  const r = await readLifecycle(kv, sub, instanceId, slot);
  if (!r.ok) return r;
  const next = {
    ...r.record,
    gen,
    lastDraftId: draftId,
    lastDraftGen: gen,
    lastState: LIFECYCLE_STATE.RESERVED,
    reservedAt: now,
  };
  const w = await writeLifecycle(kv, sub, instanceId, slot, next, fence);
  if (!w.ok) return w;
  return { ok: true, record: w.record };
}

export async function commitCreate(kv, sub, instanceId, slot, draftId, gen, fence) {
  const r = await readLifecycle(kv, sub, instanceId, slot);
  if (!r.ok) return r;
  // The fence is a precondition on the whole operation, not merely on the
  // write. Checking it only at write time let a lapsed owner short-circuit
  // below and receive ok:true — and a caller reading that as success would
  // report a promotion that never happened.
  if (r.record.fence > fence) {
    return { ok: false, error: LIFECYCLE_ERR.FENCED, held: r.record.fence, mine: fence };
  }
  // Do not promote someone else's pointer. If the row moved on while this
  // create was in flight, the reservation this would confirm is not ours.
  if (r.record.lastDraftId !== draftId) {
    return { ok: true, record: r.record, superseded: true };
  }
  const next = {
    ...r.record, gen, lastDraftId: draftId, lastDraftGen: gen,
    lastState: LIFECYCLE_STATE.LIVE, reservedAt: null,
  };
  const w = await writeLifecycle(kv, sub, instanceId, slot, next, fence);
  if (!w.ok) return w;
  return { ok: true, record: w.record };
}
