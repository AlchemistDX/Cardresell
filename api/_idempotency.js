// api/_idempotency.js
//
// Retry safety for creates that mint a generated id.
//
// The scenario, ordinary rather than exotic on a phone:
//
//   1. the app posts "create inventory instance"
//   2. the server succeeds and writes inv_A
//   3. the response is lost — tunnel, backgrounded app, flaky LTE
//   4. the app retries
//   5. the server succeeds again and writes inv_B
//
// One user action, two records. The usual defence does not apply: instance ids
// are deliberately NON-deterministic, precisely so two indistinguishable raw
// copies can coexist, which means SKU deduplication structurally cannot tell an
// accidental duplicate from a real second copy. That ambiguity is by design at
// the identity layer, so it has to be resolved at the request layer.
//
// TWO RULES GOVERN THIS FILE, and an earlier revision violated both:
//
//   1. If idempotency cannot be ESTABLISHED for an operation that may duplicate
//      state, do not blindly repeat the side effect. "Store is down, do the
//      work anyway" is not a degraded guarantee — it is no guarantee, in
//      exactly the window where retries are most likely, since whatever broke
//      the store is probably also breaking responses.
//
//   2. Once a side effect MAY have happened, a retry must RECONCILE before
//      repeating it. reserve → work → record has a window: work succeeds, the
//      process dies before the result is recorded, the reservation expires, and
//      the retry cheerfully does it again.

const KEY_TTL_SEC = 24 * 60 * 60;   // longer than any plausible retry window

/**
 * What to do when idempotency cannot be established.
 *
 * FAIL_CLOSED  — refuse the operation. The user retries in a moment.
 * FAIL_OPEN    — proceed unprotected. Only for operations that are naturally
 *                idempotent or whose duplication is harmless and reversible.
 *
 * There is no scope in Phase 1 that earns FAIL_OPEN, and the constant exists
 * so a future one has to be argued for explicitly rather than inherited by
 * default.
 */
export const FAIL_POLICY = { FAIL_CLOSED: 'fail-closed', FAIL_OPEN: 'fail-open' };

/**
 * Per-scope policy. The reconcilable flag says whether a retry can look up
 * whether the side effect already landed — which is what makes fail-closed
 * cheap rather than punishing.
 */
export const SCOPE_POLICY = {
  'instance-create': { onStoreUnavailable: FAIL_POLICY.FAIL_CLOSED, reconcilable: true },
  'draft-create':    { onStoreUnavailable: FAIL_POLICY.FAIL_CLOSED, reconcilable: true },
  'instance-split':  { onStoreUnavailable: FAIL_POLICY.FAIL_CLOSED, reconcilable: true },
  // No exception, ever. A duplicate eBay listing is a real listing, visible to
  // real buyers, with a real second set of fees, which the seller then has to
  // find and end by hand. "We could not confirm whether this listing already
  // exists — try again shortly" is strictly better than publishing twice.
  'listing-publish': { onStoreUnavailable: FAIL_POLICY.FAIL_CLOSED, reconcilable: true },
};

export const IDEMPOTENT_SCOPES = Object.keys(SCOPE_POLICY);

export const IDEMPOTENCY_STATE = {
  FRESH:         'fresh',           // nothing recorded — the work ran
  IN_FLIGHT:     'in-flight',       // a concurrent attempt holds the key
  REPLAYED:      'replayed',        // completed before — stored result returned
  RECONCILED:    'reconciled',      // side effect already landed; recovered, not repeated
  UNAVAILABLE:   'unavailable',     // idempotency unestablishable — refused
};

/** User-facing copy for the refusal, so every caller says the same thing. */
export const UNAVAILABLE_MESSAGE =
  "We couldn't safely confirm whether this already went through. Try again in a moment.";

export function idempotencyKeyFor(googleSub, scope, key) {
  return `idem:${safePart(googleSub)}:${safePart(scope)}:${safePart(key)}`;
}

/**
 * The RESOURCE pointer — the thing that closes the crash window.
 *
 * Deterministic in the operation key, so a retry can ask "did this operation
 * already produce something?" without needing the lost response and without
 * scanning. This is a pointer to authoritative state, not a cache of a reply.
 */
export function resourcePointerKey(googleSub, scope, key) {
  return `idemresource:${safePart(googleSub)}:${safePart(scope)}:${safePart(key)}`;
}

function safePart(v) {
  const s = String(v ?? '');
  if (!s) throw new Error('IDEMPOTENCY_KEY_EMPTY');
  if (/[:\s]/.test(s)) throw new Error('IDEMPOTENCY_KEY_UNSAFE');
  return s;
}

/** A client-supplied key must be a real uuid, not whatever the caller felt like. */
export function validIdempotencyKey(v) {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());
}

export function policyFor(scope) {
  const p = SCOPE_POLICY[scope];
  if (!p) throw new Error('IDEMPOTENCY_SCOPE_UNKNOWN');
  return p;
}

/**
 * Run `work` at most once per (user, scope, key).
 *
 * `kv` is injected rather than imported so this stays testable without a live
 * store and cannot reach a different backend than its caller.
 *
 * `work` receives the operation key. Persist it on the created resource as
 * `createdByOperation` so the record itself carries the provenance, and the
 * pointer is a lookup rather than the only evidence.
 *
 * `reconcile` is optional but strongly encouraged: `async (operationKey) =>
 * resourceIdOrNull`. It answers "did this operation already land?" by reading
 * AUTHORITATIVE state. Without it a retry after a lost result record can only
 * refuse, since refusing is the safe half of the ambiguity.
 */
export async function runOnce(kv, googleSub, scope, key, work, opts = {}) {
  if (!validIdempotencyKey(key)) throw new Error('IDEMPOTENCY_KEY_INVALID');
  const policy   = policyFor(scope);
  const opKey    = key.trim().toLowerCase();
  const k        = idempotencyKeyFor(googleSub, scope, opKey);
  const resKey   = resourcePointerKey(googleSub, scope, opKey);
  const reconcile = typeof opts.reconcile === 'function' ? opts.reconcile : null;

  // ── 1. Read the attempt record. A read FAILURE is not "nothing recorded". ──
  let existing, storeReadable = true;
  try {
    existing = await kv('get', k);
  } catch {
    storeReadable = false;
  }

  if (storeReadable && existing) {
    const parsed = typeof existing === 'string' ? safeParse(existing) : existing;

    if (parsed && parsed.status === 'done') {
      return { state: IDEMPOTENCY_STATE.REPLAYED, result: parsed.result, replayed: true };
    }

    // in-flight: either a genuinely concurrent attempt, or the crash window —
    // work finished, process died before recording. Those are indistinguishable
    // from the marker alone, so reconcile against authoritative state instead of
    // guessing. Guessing here means either a duplicate or a false refusal.
    if (parsed && parsed.status === 'in-flight') {
      const landed = await tryReconcile(reconcile, opKey);
      if (landed) {
        await recordDone(kv, k, resKey, landed, opKey);
        return { state: IDEMPOTENCY_STATE.RECONCILED, result: landed, replayed: true };
      }
      return {
        state: IDEMPOTENCY_STATE.IN_FLIGHT, result: null, replayed: false,
        message: UNAVAILABLE_MESSAGE,
      };
    }
  }

  // ── 2. No usable attempt record. Before doing anything, ask whether the side
  //       effect already landed. This covers the reservation having expired
  //       after the work succeeded — the case that silently duplicates.
  const alreadyLanded = await tryReconcile(reconcile, opKey);
  if (alreadyLanded) {
    await recordDone(kv, k, resKey, alreadyLanded, opKey);
    return { state: IDEMPOTENCY_STATE.RECONCILED, result: alreadyLanded, replayed: true };
  }

  // Also check the pointer directly — cheaper than reconcile and survives a
  // lost result record on its own.
  if (storeReadable) {
    let pointer = null;
    try { pointer = await kv('get', resKey); } catch { pointer = null; }
    if (pointer) {
      const p = typeof pointer === 'string' ? safeParse(pointer) || { resourceId: pointer } : pointer;
      return { state: IDEMPOTENCY_STATE.RECONCILED, result: p, replayed: true };
    }
  }

  // ── 3. Reserve. If we cannot reserve, we cannot promise once-only. ──
  let reserved = false;
  if (storeReadable) {
    try {
      await kv('set', k, JSON.stringify({ status: 'in-flight', at: Date.now(), op: opKey }));
      await kv('expire', k, KEY_TTL_SEC);
      reserved = true;
    } catch { reserved = false; }
  }

  if (!reserved) {
    // THE RULE. Previously this fell through and did the work, which meant the
    // guarantee evaporated exactly when it was needed: whatever is breaking the
    // store is plausibly also breaking responses, so this is the high-retry
    // window, not the safe one.
    if (policy.onStoreUnavailable === FAIL_POLICY.FAIL_CLOSED) {
      return {
        state: IDEMPOTENCY_STATE.UNAVAILABLE, result: null, replayed: false,
        message: UNAVAILABLE_MESSAGE, retryable: true,
      };
    }
    // FAIL_OPEN is reachable only for a scope that explicitly opted in.
  }

  // ── 4. Do the work, then record. Failure releases the reservation, because
  //       refusing every retry for a day after one blip is its own outage.
  let result;
  try {
    result = await work(opKey);
  } catch (err) {
    if (reserved) { try { await kv('del', k); } catch {} }
    throw err;
  }

  await recordDone(kv, k, resKey, result, opKey);
  return { state: IDEMPOTENCY_STATE.FRESH, result, replayed: false };
}

async function tryReconcile(reconcile, opKey) {
  if (!reconcile) return null;
  try {
    const found = await reconcile(opKey);
    return found || null;
  } catch {
    // A failed reconcile is NO EVIDENCE, same rule as index pruning. It must
    // not be read as "the side effect did not happen".
    return null;
  }
}

/**
 * Record the result and the resource pointer. The pointer is written FIRST:
 * if only one of the two survives, the pointer is the one that makes a future
 * retry recoverable, whereas a result record without a pointer only helps
 * while it lives.
 */
async function recordDone(kv, k, resKey, result, opKey) {
  const resourceId = result && (result.instanceId || result.draftId || result.listingId || result.id);
  if (resourceId) {
    try {
      await kv('set', resKey, JSON.stringify({ resourceId, op: opKey, at: Date.now() }));
      await kv('expire', resKey, KEY_TTL_SEC);
    } catch { /* the reconcile hook is the backstop */ }
  }
  try {
    await kv('set', k, JSON.stringify({ status: 'done', at: Date.now(), result, op: opKey }));
    await kv('expire', k, KEY_TTL_SEC);
  } catch { /* work is done; failing to record only costs retry safety */ }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
