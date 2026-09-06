// api/_idempotency.js
//
// Retry safety for creates that mint a generated id.
//
// The scenario, which is ordinary rather than exotic on a phone:
//
//   1. the app posts "create inventory instance"
//   2. the server succeeds and writes inv_A
//   3. the response is lost — tunnel, backgrounded app, flaky LTE
//   4. the app retries
//   5. the server succeeds again and writes inv_B
//
// One user action, two records. And the usual defence does not apply here:
// instance ids are deliberately NON-deterministic, precisely so two
// indistinguishable raw copies can coexist, which means SKU deduplication
// cannot tell an accidental duplicate from a real second copy. That ambiguity
// is by design at the identity layer, so it has to be resolved at the request
// layer instead.
//
// So the client supplies the identity of the ATTEMPT:
//
//   Idempotency-Key: <uuid>
//
// and a retry returns the original result rather than performing the work
// again. Cheap to establish before any writes go live; expensive afterwards,
// because by then the duplicates already exist and nobody can tell which
// pairs were real.

const KEY_TTL_SEC = 24 * 60 * 60;   // longer than any plausible retry window

export function idempotencyKeyFor(googleSub, scope, key) {
  const parts = [googleSub, scope, key].map((v) => {
    const s = String(v ?? '');
    if (!s) throw new Error('IDEMPOTENCY_KEY_EMPTY');
    if (/[:\s]/.test(s)) throw new Error('IDEMPOTENCY_KEY_UNSAFE');
    return s;
  });
  return `idem:${parts[0]}:${parts[1]}:${parts[2]}`;
}

/** A client-supplied key must be a real uuid, not whatever the caller felt like. */
export function validIdempotencyKey(v) {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());
}

export const IDEMPOTENCY_STATE = {
  FRESH:      'fresh',        // nothing recorded — do the work
  IN_FLIGHT:  'in-flight',    // a concurrent attempt holds the key
  REPLAYED:   'replayed',     // completed before — return the stored result
};

/**
 * Run `work` at most once per (user, scope, key).
 *
 * `kv` is injected rather than imported so this stays testable without a live
 * store, and so it cannot accidentally reach a different backend than the
 * caller's.
 *
 * Ordering matters and is deliberate:
 *
 *   - the reservation is written BEFORE the work, so a crash mid-work leaves a
 *     reservation rather than a silent duplicate on retry
 *   - the result is recorded AFTER the work succeeds, so a failed attempt can
 *     be retried rather than replaying an error forever
 *   - a failure RELEASES the reservation, because refusing every retry after
 *     one transient failure is its own outage
 */
export async function runOnce(kv, googleSub, scope, key, work) {
  if (!validIdempotencyKey(key)) throw new Error('IDEMPOTENCY_KEY_INVALID');
  const k = idempotencyKeyFor(googleSub, scope, key.trim().toLowerCase());

  let existing = null;
  try { existing = await kv('get', k); } catch { existing = null; }

  if (existing) {
    const parsed = typeof existing === 'string' ? safeParse(existing) : existing;
    if (parsed && parsed.status === 'done') {
      return { state: IDEMPOTENCY_STATE.REPLAYED, result: parsed.result, replayed: true };
    }
    if (parsed && parsed.status === 'in-flight') {
      // Do NOT run the work concurrently. Returning a retryable signal is
      // honest; racing two creates is the bug we are here to prevent.
      return { state: IDEMPOTENCY_STATE.IN_FLIGHT, result: null, replayed: false };
    }
  }

  // Reserve. Best effort: if the store is unavailable we still do the work
  // rather than refusing to save the seller's card, and accept that a lost
  // response in that window can duplicate — degraded, not broken.
  try {
    await kv('set', k, JSON.stringify({ status: 'in-flight', at: Date.now() }));
    await kv('expire', k, KEY_TTL_SEC);
  } catch { /* proceed unreserved */ }

  let result;
  try {
    result = await work();
  } catch (err) {
    try { await kv('del', k); } catch {}
    throw err;
  }

  try {
    await kv('set', k, JSON.stringify({ status: 'done', at: Date.now(), result }));
    await kv('expire', k, KEY_TTL_SEC);
  } catch { /* the work is done; failing to record it only costs retry safety */ }

  return { state: IDEMPOTENCY_STATE.FRESH, result, replayed: false };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * Creates that MUST be idempotent before they go live. Named here so the list
 * is reviewable in one place rather than rediscovered per endpoint.
 */
export const IDEMPOTENT_SCOPES = [
  'instance-create',
  'draft-create',
  'instance-split',
  'listing-publish',   // Phase 3, and the most expensive one to get wrong
];
