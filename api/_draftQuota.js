// api/_draftQuota.js — the draft cap, as an atomic reservation
//
// ── Why this file exists ──────────────────────────────────────────────────
//
// The cap started as SCARD -> compare -> create, which is not a ceiling. Two
// requests at 499 both read 499, both pass the comparison, and both create.
// Twenty concurrent requests took a 500-cap account to 519 in a test that is
// now permanent. Idempotency does not help: those are twenty DISTINCT intents,
// and it is correct for twenty distinct intents to each attempt a create. Only
// a quota may stop them.
//
// So the reservation is atomic. INCR returns a different number to every
// caller, so exactly CAP callers can ever receive a number <= CAP. The
// comparison happens on a value nobody else can also have received, which is
// the whole difference between a counter and a ceiling.
//
// ── Why a counter and not the set itself ─────────────────────────────────
//
// The obvious alternative is SADD-then-SCARD-then-SREM-if-over. It does hold
// the ceiling, but it starves: if twenty SADDs land before any SCARD, every
// caller sees 519 and all twenty refuse, including the one that should have
// won the free slot. A counter hands out slot numbers instead, so the first
// caller gets the slot and the rest are refused.
//
// ── The counter is a gate, the set is the truth ──────────────────────────
//
// The index set remains authoritative for what a seller actually has. The
// counter only decides admission, and it can drift from the set:
//
//   * a process that dies between reserving and writing leaks a slot;
//   * a release that fails to reach the store leaks a slot;
//   * a seller who had drafts before this counter existed starts at zero.
//
// Drift in the permissive direction is bounded by the next reconcile. Drift in
// the RESTRICTIVE direction is the dangerous one — it silently locks a seller
// out below their real limit, and it accumulates. So a refusal is never final
// on the counter alone: it is re-checked against the set before the seller is
// told no. That is the one place truth overrides the gate.

import { draftsKey, storageAvailable } from './_draftIndex.js';

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// Same path-encoded REST shape the index uses. Deliberately a private copy
// rather than a shared export: the index's helper is its own internal detail,
// and exporting it would make every future change to it a cross-module
// concern. Six lines duplicated is cheaper than that coupling — and this is
// transport, not business behaviour, so it does not fall under the one-
// behaviour-one-implementation rule that the fee model and normalization do.
async function kv(cmd, ...args) {
  if (!storageAvailable()) throw new Error('kv_unconfigured');
  const path = [cmd, ...args].map((a) => encodeURIComponent(String(a))).join('/');
  const res  = await fetch(`${KV_URL}/${path}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!res.ok) throw new Error(`kv_${cmd}_failed:${res.status}`);
  const j = await res.json().catch(() => ({}));
  return j.result;
}

/**
 * The per-seller ceiling on ACTIVE drafts.
 *
 * 500, not the 200 in earlier Phase 1 planning. Recorded in the phase
 * checklist as the source of truth; a number that lives only in code is a
 * number the plan disagrees with.
 */
export const DRAFT_CAP = 500;

export function quotaKey(googleSub) {
  return `draftquota:${googleSub}`;
}

/**
 * How long the gate is trusted before it is re-checked against the index.
 *
 * The counter can drift DOWNWARD as well as upward — an evicted key, a draft
 * written by a path that predates this file, a restored backup. Upward drift
 * is loud (a seller is refused and the refusal path reconciles immediately).
 * Downward drift is silent: the cap simply stops enforcing, and nothing
 * complains, which is the worse of the two.
 *
 * So the gate carries an expiry marker. One extra round trip per seller per
 * hour is a cheap price for a guardrail that is actually load-bearing, and it
 * mirrors the reconcile interval the draft index already uses.
 */
export const QUOTA_VERIFY_INTERVAL_SEC = 60 * 60;

export function quotaFreshKey(googleSub) {
  return `draftquotafresh:${googleSub}`;
}

export const QUOTA = {
  RESERVED: 'reserved',       // a slot is held; the caller must release it if the create fails
  AT_CAP: 'at-cap',           // refused, and confirmed against the index
  UNAVAILABLE: 'unavailable', // the store could not be asked — fails OPEN
};

/**
 * Seed the counter for a seller who has drafts but no counter.
 *
 * Without this, an existing seller's first create after deploy would INCR a
 * missing key to 1 and the cap would effectively not exist for them.
 *
 * SET ... NX makes the seed a race nobody loses badly: if two callers both
 * find the key absent and both compute the same size from the index, only one
 * write lands and both then INCR from the same base.
 */
async function seedIfAbsent(googleSub) {
  const key = quotaKey(googleSub);
  const existing = await kv('get', key);
  if (existing !== null && existing !== undefined) return;
  let size = 0;
  try {
    size = Number(await kv('scard', draftsKey(googleSub))) || 0;
  } catch {
    // Could not measure. Seeding 0 here would hand a seller with 400 drafts a
    // fresh 500, so refuse to seed and let the caller fail open instead — an
    // unenforced cap for one request beats a wrong baseline that persists.
    throw new Error('QUOTA_SEED_UNMEASURABLE');
  }
  await kv('set', key, String(size), 'NX');
}

/**
 * Re-derive the gate from the index if it has not been checked recently.
 *
 * Deliberately silent on failure: this is a periodic correction, not a
 * precondition. If the index cannot be read, the existing counter is still the
 * best answer available, and refusing the create instead would punish a seller
 * for a maintenance step they did not ask for.
 */
async function verifyIfStale(googleSub) {
  const freshKey = quotaFreshKey(googleSub);
  try {
    const fresh = await kv('get', freshKey);
    if (fresh) return { verified: false, reason: 'fresh' };
  } catch {
    return { verified: false, reason: 'unreadable' };
  }
  try {
    const actual = Number(await kv('scard', draftsKey(googleSub)));
    if (!Number.isFinite(actual)) return { verified: false, reason: 'uncountable' };
    await kv('set', quotaKey(googleSub), String(actual));
    await kv('set', freshKey, '1', 'EX', String(QUOTA_VERIFY_INTERVAL_SEC));
    return { verified: true, count: actual };
  } catch {
    return { verified: false, reason: 'write-failed' };
  }
}

/**
 * Reserve one draft slot.
 *
 * @returns {{state:string, count:number|null, cap:number, known:boolean}}
 *
 * On RESERVED the caller OWNS a slot and must call `releaseDraftSlot` if the
 * create does not end up persisting a record.
 */
export async function reserveDraftSlot(googleSub, opts = {}) {
  const key = quotaKey(googleSub);
  const cap = Number.isInteger(opts.cap) ? opts.cap : DRAFT_CAP;

  let n;
  try {
    await verifyIfStale(googleSub);
    await seedIfAbsent(googleSub);
    n = Number(await kv('incr', key));
  } catch {
    // ── Fails OPEN, deliberately ──
    // Refusing to save a real draft because a counter was unreachable trades a
    // certain loss (the seller's work) for a hypothetical one (an index one
    // over its limit). The cap is a guardrail against unbounded growth, not a
    // correctness invariant worth losing data to defend.
    return { state: QUOTA.UNAVAILABLE, count: null, cap, known: false };
  }

  if (!Number.isFinite(n)) {
    return { state: QUOTA.UNAVAILABLE, count: null, cap, known: false };
  }

  if (n <= cap) {
    return { state: QUOTA.RESERVED, count: n, cap, known: true };
  }

  // ── Over the gate ────────────────────────────────────────────────────
  //
  // Give the slot back first, so a refusal never leaves the leak that caused
  // it.
  try { await kv('decr', key); } catch { /* the periodic verify is the backstop */ }

  // ── Why this does NOT re-check the index and grant ───────────────────
  //
  // The obvious next move is: ask SCARD, and if the seller really has room,
  // let them through. It is wrong, and it was measured to be wrong. During a
  // burst of concurrent creates the winners hold reservations whose records
  // are not written yet, so SCARD legitimately reads BELOW the counter. A
  // loser that trusts SCARD repairs the gate down to a number that has
  // forgotten the in-flight winners and lets itself in. Twenty concurrent
  // creates against one free slot produced 501 drafts that way — better than
  // the 519 of the original count-and-compare, but still not a ceiling.
  //
  // A disagreement between the counter and the index is therefore NOT
  // evidence of room. It is evidence the gate needs re-deriving at a moment
  // when nothing is in flight. So the refusal stands, and the gate is marked
  // stale so the NEXT reservation re-derives it from the index.
  //
  // The cost is one spurious refusal for a seller whose gate has genuinely
  // leaked: they are told no once, and their next attempt succeeds. That is
  // the right trade against a ceiling that does not hold.
  let actual = null;
  try {
    actual = Number(await kv('scard', draftsKey(googleSub)));
    if (Number.isFinite(actual) && actual < cap) {
      await kv('del', quotaFreshKey(googleSub));
      return { state: QUOTA.AT_CAP, count: actual, cap, known: true, staleGate: true };
    }
  } catch {
    // Cannot confirm. The counter says full and nothing contradicts it.
    return { state: QUOTA.AT_CAP, count: n - 1, cap, known: false };
  }

  return { state: QUOTA.AT_CAP, count: Number.isFinite(actual) ? actual : n - 1, cap, known: true };
}

/**
 * Give a reserved slot back.
 *
 * Called when a create that reserved a slot did not persist a record, and when
 * a draft is deleted. Never throws: a failed release costs a leaked slot,
 * which the reconcile in `reserveDraftSlot` repairs. Turning that into a
 * failed delete would be strictly worse.
 */
export async function releaseDraftSlot(googleSub) {
  try {
    const n = Number(await kv('decr', quotaKey(googleSub)));
    // A negative counter can only come from drift (a release without a
    // matching reservation). Clamping keeps the next seeded baseline sane;
    // leaving it negative would silently hand out extra slots later.
    if (Number.isFinite(n) && n < 0) {
      try { await kv('set', quotaKey(googleSub), '0'); } catch {}
      return { released: true, count: 0, clamped: true };
    }
    return { released: true, count: Number.isFinite(n) ? n : null };
  } catch {
    return { released: false, count: null, leaked: true };
  }
}

/** Current gate value, for display. `null` when it cannot be read. */
export async function quotaCount(googleSub) {
  try {
    const raw = await kv('get', quotaKey(googleSub));
    if (raw === null || raw === undefined) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Force the gate back into agreement with the index. */
export async function syncQuota(googleSub) {
  try {
    const actual = Number(await kv('scard', draftsKey(googleSub)));
    if (!Number.isFinite(actual)) return { synced: false };
    await kv('set', quotaKey(googleSub), String(actual));
    return { synced: true, count: actual };
  } catch {
    return { synced: false };
  }
}
