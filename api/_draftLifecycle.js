// api/_draftLifecycle.js — one live draft per (seller, instance, slot), and a
// durable record of what happened to the last one.
//
// ── Why this module exists ───────────────────────────────────────────────────
//
// Idempotency records answer "have I seen THIS request before". They cannot
// answer "was the draft this request would create already deleted", because
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
// The obvious design reconstructs everything from tombstones: a deleted draft
// leaves one, so read it and refuse. But tombstones carry a 90-day retention
// TTL. On day 91 the tombstone is gone and a read returns NOT_FOUND, which is
// indistinguishable from "this draft never existed" — and "never existed" is
// exactly the answer that lets a create proceed. A protection reconstructed
// solely from expiring evidence expires with it.
//
// This record fixes that by remembering the POINTER durably. `lastDraftId` plus
// `lastState: 'live'` plus a read that finds nothing is positive evidence of
// deletion: something was there, we recorded it, it is gone. That inference
// survives the tombstone.
//
// ── Why 'reserved' is a distinct state ───────────────────────────────────────
//
// Without it, an interrupted CREATE and an expired tombstone look identical: a
// pointer to a draft that cannot be read. They need opposite answers — the
// interrupted create must be completable, the expired tombstone must be
// refused. So the pointer is written BEFORE the draft, in state 'reserved', and
// promoted to 'live' after. Absence under 'reserved' means the write never
// landed; absence under 'live' means it landed and was deleted.
//
// ── Why repair is a max, not an increment ────────────────────────────────────
//
// Repair has to be repeatable: it runs from create, from eligibility, and from
// concurrent callers, and an INCR in that position advances once per caller
// rather than once per deletion. So the deleted draft's own generation is
// persisted and repair sets `gen = max(gen, lastDraftGen + 1)`. Idempotent by
// construction, and monotonic: a retry of an OLD deletion computes a lower
// bound than a newer lifecycle already holds, so it cannot drag a live
// generation backwards or advance it a second time.

const RECORD_VERSION = 1;

// Long enough to cover a create or delete round trip, short enough that a
// crashed holder does not wedge the row. Single SET NX EX, so a process that
// dies mid-operation cannot leave a lock with no expiry.
export const LOCK_TTL_SEC = 15;

export const LIFECYCLE_STATE = {
  RESERVED: 'reserved',
  LIVE:     'live',
  DELETED:  'deleted',
};

export const LIFECYCLE_ERR = {
  BUSY:        'lifecycle-busy',        // another create/delete holds this row
  STALE_GEN:   'lifecycle-stale-gen',   // request names a superseded generation
  ALREADY_LIVE:'lifecycle-already-live',// a live draft already exists here
  UNAVAILABLE: 'lifecycle-unavailable', // storage would not answer
};

// ── Keys ────────────────────────────────────────────────────────────────────
//
// Scope is (sub, instanceId, slot). NOT the sku: two collection rows of the
// same card are different instances, and a shared counter would advance row B's
// generation when row A is deleted, minting an unseen key for B and producing a
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

function emptyRecord() {
  return {
    v: RECORD_VERSION,
    gen: 0,
    lastDraftId: null,
    lastDraftGen: null,
    lastState: null,
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
  return {
    v: Number(obj.v) || RECORD_VERSION,
    gen,
    lastDraftId: typeof obj.lastDraftId === 'string' ? obj.lastDraftId : null,
    lastDraftGen: Number.isInteger(Number(obj.lastDraftGen)) ? Number(obj.lastDraftGen) : null,
    lastState: typeof obj.lastState === 'string' ? obj.lastState : null,
  };
}

// ── Read ────────────────────────────────────────────────────────────────────
//
// An unreadable record is NOT an absent one. Treating "the store would not
// answer" as "generation 0, nothing here" would let a create through on exactly
// the failure it should refuse on, so the two are separated at the boundary and
// the caller decides.

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

async function writeLifecycle(kv, sub, instanceId, slot, rec) {
  try {
    await kv('set', lifecycleKey(sub, instanceId, slot), JSON.stringify({ ...rec, v: RECORD_VERSION }));
    return { ok: true };
  } catch {
    return { ok: false, error: LIFECYCLE_ERR.UNAVAILABLE };
  }
}

// ── Lock ────────────────────────────────────────────────────────────────────
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

export async function acquireLifecycleLock(kv, sub, instanceId, slot, token) {
  try {
    const won = await kv(
      'set', lifecycleLockKey(sub, instanceId, slot),
      JSON.stringify({ token, at: Date.now() }),
      'NX', 'EX', String(LOCK_TTL_SEC),
    );
    return won === 'OK';
  } catch {
    return false;
  }
}

export async function releaseLifecycleLock(kv, sub, instanceId, slot) {
  try { await kv('del', lifecycleLockKey(sub, instanceId, slot)); } catch { /* expires anyway */ }
}

/**
 * Run `fn` holding the row lock. `fn` receives nothing and is expected to do
 * its own reads INSIDE the critical section — a value read before the lock was
 * taken is exactly the stale value the lock exists to prevent acting on.
 */
export async function withLifecycleLock(kv, sub, instanceId, slot, fn) {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const got = await acquireLifecycleLock(kv, sub, instanceId, slot, token);
  if (!got) return { ok: false, error: LIFECYCLE_ERR.BUSY, retryable: true };
  try {
    return await fn();
  } finally {
    await releaseLifecycleLock(kv, sub, instanceId, slot);
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
// create path resolves the authoritative deletion state itself, from the draft
// record, and repairs as a side effect. Eligibility may call this too, for the
// seller's convenience, but correctness does not depend on it having done so.
//
// `readDraftRaw(draftId)` must return `{ found, deleted }`. Injected rather
// than imported so this module does not depend on the store's HTTP-shaped
// error vocabulary, and so the interruption cases are testable without Redis.
export async function resolveLifecycle(kv, sub, instanceId, slot, readDraftRaw) {
  const r = await readLifecycle(kv, sub, instanceId, slot);
  if (!r.ok) return r;
  const rec = r.record;

  // Nothing has ever happened here, or the last thing that happened was a
  // recorded deletion. Either way the stored generation is already correct.
  if (!rec.lastDraftId || rec.lastState === LIFECYCLE_STATE.DELETED) {
    return { ok: true, record: rec, gen: rec.gen, live: null, repaired: false };
  }

  let probe;
  try {
    probe = await readDraftRaw(rec.lastDraftId);
  } catch {
    // Could not establish the draft's state. Refusing to guess: reporting
    // "no live draft" here would authorise a create that duplicates a draft
    // we simply failed to read.
    return { ok: false, error: LIFECYCLE_ERR.UNAVAILABLE };
  }

  const { found, deleted } = probe || {};

  // A live draft is still there. Not a repair — a fact the caller needs.
  if (found && !deleted) {
    return { ok: true, record: rec, gen: rec.gen, live: rec.lastDraftId, repaired: false };
  }

  // Interrupted CREATE: the pointer was reserved but the draft write never
  // landed. This generation is still the current one and is still usable —
  // the seller's press produced nothing, so it has not been consumed.
  if (!found && rec.lastState === LIFECYCLE_STATE.RESERVED) {
    return { ok: true, record: rec, gen: rec.gen, live: null, reservedGap: true, repaired: false };
  }

  // Deleted — either the tombstone says so, or the pointer was 'live' and the
  // record is gone, which after 90 days is what a deletion looks like once its
  // tombstone has expired. Both are deletions; repair the generation.
  const floor = (rec.lastDraftGen === null ? rec.gen : rec.lastDraftGen) + 1;
  const nextGen = Math.max(rec.gen, floor);

  if (nextGen === rec.gen && rec.lastState === LIFECYCLE_STATE.DELETED) {
    return { ok: true, record: rec, gen: rec.gen, live: null, repaired: false };
  }

  const repaired = { ...rec, gen: nextGen, lastState: LIFECYCLE_STATE.DELETED };
  const w = await writeLifecycle(kv, sub, instanceId, slot, repaired);
  if (!w.ok) {
    // The repair did not persist, but the conclusion stands and is what the
    // caller must act on: this generation is spent. Returning the repaired
    // value with `persisted: false` refuses the stale create now and lets the
    // next resolve try the write again.
    return { ok: true, record: repaired, gen: nextGen, live: null, repaired: true, persisted: false };
  }
  return { ok: true, record: repaired, gen: nextGen, live: null, repaired: true, persisted: true };
}

// ── Deletion ────────────────────────────────────────────────────────────────
//
// Ordering is fixed and only one order is safe: the tombstone is written FIRST,
// by the caller, and this runs after. Advancing the generation before the
// tombstone means a delete that then FAILS leaves a bumped generation, so the
// next create mints an unseen key and produces a second live draft while the
// first is still there. Tombstone-first fails toward blocked; generation-first
// fails toward duplicated. Blocked self-heals through `resolveLifecycle`;
// duplicated does not self-heal at all.
//
// `deletedDraftGen` is the generation the deleted draft was CREATED at, which
// is why it is persisted on create. Advancing to `max(gen, thatGen + 1)` makes
// this safe to call twice, safe to call concurrently, and safe to call late:
// a retry of an old deletion computes a bound a newer lifecycle already
// exceeds, so it cannot advance a generation a second time.
export async function recordDeletion(kv, sub, instanceId, slot, draftId, deletedDraftGen) {
  const r = await readLifecycle(kv, sub, instanceId, slot);
  if (!r.ok) return r;
  const rec = r.record;

  const known = Number.isInteger(deletedDraftGen)
    ? deletedDraftGen
    : (rec.lastDraftId === draftId ? rec.lastDraftGen : null);

  const floor = (known === null ? rec.gen : known) + 1;
  const nextGen = Math.max(rec.gen, floor);

  // Only move the pointer if this deletion is about the draft the pointer
  // names. An older draft's deletion must not overwrite a newer lifecycle's
  // pointer — that would strand the newer draft with no record of itself.
  const pointerIsThis = rec.lastDraftId === draftId || rec.lastDraftId === null;

  const next = pointerIsThis
    ? { ...rec, gen: nextGen, lastDraftId: draftId, lastDraftGen: known, lastState: LIFECYCLE_STATE.DELETED }
    : { ...rec, gen: nextGen };

  const w = await writeLifecycle(kv, sub, instanceId, slot, next);
  if (!w.ok) return { ok: false, error: LIFECYCLE_ERR.UNAVAILABLE, gen: nextGen };
  return { ok: true, record: next, gen: nextGen, advanced: nextGen !== rec.gen };
}

// ── Creation, in two writes ─────────────────────────────────────────────────
//
// `reserveCreate` writes the pointer before the draft exists; `commitCreate`
// promotes it once the draft is durable. The gap between them is the
// 'reserved' state, and it is the reason a missing draft can be told apart
// from a deleted one.
//
// If the draft write succeeds and `commitCreate` fails, the pointer stays
// 'reserved' while the draft is real. `resolveLifecycle` reads that draft,
// finds it LIVE, and reports it as the live draft — so the retry recovers the
// existing draft instead of creating another. That is the partial-creation
// case, and it is handled by the probe rather than by a repair.
export async function reserveCreate(kv, sub, instanceId, slot, draftId, gen) {
  const r = await readLifecycle(kv, sub, instanceId, slot);
  if (!r.ok) return r;
  const next = {
    ...r.record,
    gen,
    lastDraftId: draftId,
    lastDraftGen: gen,
    lastState: LIFECYCLE_STATE.RESERVED,
  };
  const w = await writeLifecycle(kv, sub, instanceId, slot, next);
  if (!w.ok) return w;
  return { ok: true, record: next };
}

export async function commitCreate(kv, sub, instanceId, slot, draftId, gen) {
  const r = await readLifecycle(kv, sub, instanceId, slot);
  if (!r.ok) return r;
  // Do not promote someone else's pointer. If the row moved on while this
  // create was in flight, the reservation this would confirm is not ours.
  if (r.record.lastDraftId !== draftId) {
    return { ok: true, record: r.record, superseded: true };
  }
  const next = { ...r.record, gen, lastDraftId: draftId, lastDraftGen: gen, lastState: LIFECYCLE_STATE.LIVE };
  const w = await writeLifecycle(kv, sub, instanceId, slot, next);
  if (!w.ok) return w;
  return { ok: true, record: next };
}
