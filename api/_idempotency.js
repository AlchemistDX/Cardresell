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

import { createHash } from 'crypto';

const KEY_TTL_SEC = 24 * 60 * 60;   // longer than any plausible retry window

/**
 * ── The key identifies ONE INTENDED MUTATION, not a slot in a store ───────
 *
 * user + scope + key stops cross-user replay, which is necessary but not
 * sufficient. A client bug can send the same key with a different body:
 *
 *   1. Idempotency-Key: abc, quantity 5   -> created
 *   2. Idempotency-Key: abc, quantity 10  -> replayed the quantity-5 result
 *
 * The key was honoured and the seller was still lied to: they asked for ten
 * and got a success response describing five. For listing-publish it is worse
 * — reusing a key with a different price or title would silently return the
 * previous listing, so the seller believes they published a $400 card at $400
 * when the live listing says $40.
 *
 * So the stored attempt carries a fingerprint of the mutation-defining fields.
 * Same key + same fingerprint is a genuine retry. Same key + different
 * fingerprint is a client bug, and it gets refused rather than answered.
 */
export const FINGERPRINT_MISMATCH = 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST';

/**
 * Canonical JSON: keys sorted at every depth, so property order in the request
 * cannot change the fingerprint. Without this, two identical requests
 * serialized in different orders look like different mutations and every retry
 * from a rebuilt client object gets refused.
 */
export function canonicalize(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(',')}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(v[k])}`).join(',')}}`;
}

/** sha256 over the canonical form of the mutation-defining fields. */
export function requestFingerprint(request) {
  return createHash('sha256').update(canonicalize(request ?? null)).digest('hex').slice(0, 32);
}

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
/**
 * ── Fingerprint BUSINESS INTENT, not serialization quirks ─────────────────
 *
 * Fingerprinting the raw HTTP body makes these three different mutations:
 *
 *   { quantity: 5,   venue: 'ebay' }
 *   { quantity: '5', venue: 'ebay' }
 *   { quantity: 5,   venue: 'EBAY' }
 *
 * They are the same intended mutation, and if an endpoint accepts all three
 * then a client that switches serializers gets every retry refused — the
 * feature becomes worse than not having it. So the fingerprint is taken AFTER
 * parse/validate/normalize, over a DECLARED field set:
 *
 *   parse -> validate -> normalize -> select mutation fields -> fingerprint
 *
 * Declaring the fields per scope also means adding a field to a request body
 * cannot silently change the fingerprint of an unrelated mutation, and a
 * cosmetic field (client version, timestamp, request id) cannot make a genuine
 * retry look like a new operation.
 */
/**
 * Field kinds, because "normalized" means different things per field:
 *
 *   token  — a closed vocabulary that must be lowercase-canonical
 *            (venue, strategy, slot, condition)
 *   id     — an OPAQUE identifier whose casing is meaningful and must not be
 *            touched. Real SKUs look like `v2-XXX7473-592a391e7b472559`, so a
 *            blanket lowercase rule here would refuse every genuine retry.
 *   money  — a number of dollars, or null for unknown. Never a numeric string.
 *   count  — a non-negative integer. Never a numeric string.
 *   text   — free text (a title). Trimmed, casing is the seller's.
 */
export const MUTATION_FIELDS = {
  'instance-create': {
    sku: 'id', quantity: 'count', condition: 'token',
    totalAcquisitionCost: 'money', cert: 'id',
  },
  'draft-create': {
    // `sku` counts. A draft for a different card is a different mutation, and
    // omitting it would let one key create a draft for whichever card arrived
    // first and then replay that answer for a different card entirely.
    sku: 'id',
    instanceId: 'id', slot: 'token', price: 'money', title: 'text', strategy: 'token',
    // Counts, and is not optional. The same number recorded as a seller's
    // asking price and as a comp-derived price are two different claims about
    // where it came from, and D4 puts that claim on screen. Leaving it
    // undeclared did not make it ignored — it made every create D1 sends throw
    // MUTATION_FIELD_UNDECLARED, which no identity-level parity test could see.
    priceSource: 'token',
  },
  'instance-split': {
    instanceId: 'id', count: 'count', totalAcquisitionCost: 'money',
  },
  'listing-publish': {
    draftId: 'id', slot: 'token', price: 'money', title: 'text', quantity: 'count',
  },
};

/**
 * Fields carried on a validated create that are DERIVED, and therefore
 * deliberately excluded from the mutation identity.
 *
 * This exists so the undeclared-field guard can keep saying what it was built
 * to say. That guard is load-bearing — it is what caught `priceSource` being
 * silently absent from the fingerprint (see the note in 'draft-create' above),
 * and "just let unknown keys through" would throw that away. So a derived field
 * must be named here, in a table someone has to edit on purpose, rather than
 * slipping past.
 *
 * `packet` is derived and MUST NOT count, for a reason that is not stylistic:
 * a listing packet stamps `priceBasis.retrievedAt` from the clock at build
 * time. The identical request, retried three seconds later after a dropped
 * response, produces a packet whose bytes differ. If the packet counted toward
 * identity, that retry would fingerprint as a DIFFERENT mutation and be refused
 * as a key-reuse MISMATCH — turning ordinary network retry, the exact thing
 * idempotency exists to make safe, into a hard failure.
 *
 * Excluding it is also correct on the merits, not merely convenient. The packet
 * is a function of `card` (already represented by `sku`, which does count),
 * `price`, `title`, and the client's declared pricing context. Nothing a seller
 * could change to mean "a different draft" is visible only in the packet.
 */
export const DERIVED_FIELDS = {
  'draft-create': new Set(['packet']),
};

export const NOT_NORMALIZED = 'MUTATION_FIELD_NOT_NORMALIZED';
export const UNDECLARED_FIELD = 'MUTATION_FIELD_UNDECLARED';
export const DERIVED_AND_DECLARED = 'MUTATION_FIELD_DERIVED_AND_DECLARED';
const EMPTY_DERIVED = new Set();

/**
 * Refuse values that are clearly pre-normalization. Deliberately a REFUSAL and
 * not a coercion: coercing '5' to 5 here would be a second normalization
 * implementation living beside the endpoint's, and the two would drift. The
 * endpoint normalizes; this asserts that it did.
 */
function assertNormalized(field, kind, v) {
  if (v === undefined || v === null) return v;
  const fail = (why) => { throw new Error(`${NOT_NORMALIZED}:${field}:${why}`); };

  if (kind === 'count' || kind === 'money') {
    if (typeof v === 'string') fail('numeric-string');
    if (typeof v !== 'number' || !Number.isFinite(v)) fail('not-a-finite-number');
    if (kind === 'count' && (!Number.isInteger(v) || v < 0)) fail('not-a-non-negative-integer');
    if (kind === 'money' && v < 0) fail('negative-money');
    // Money is compared to the cent. 19.999 and 20.00 must not be two
    // different mutations when they are the same charge.
    if (kind === 'money' && Math.abs(v * 100 - Math.round(v * 100)) > 1e-9) fail('sub-cent-precision');
    return v;
  }

  if (typeof v !== 'string') fail('not-a-string');
  if (v !== v.trim()) fail('untrimmed');
  if (kind === 'token') {
    if (v === '') fail('empty');
    if (v !== v.toLowerCase()) fail('uncanonical-case');
    if (/\s/.test(v)) fail('whitespace-in-token');
  }
  return v;
}

/**
 * Select the declared mutation fields from ALREADY-VALIDATED input and
 * fingerprint exactly those. An undeclared field throws, because it means the
 * endpoint and this table disagree about what defines the mutation — the drift
 * that eventually produces a fingerprint blind to a meaningful change (price).
 */
export function selectMutation(scope, validated) {
  const spec = MUTATION_FIELDS[scope];
  if (!spec) throw new Error('IDEMPOTENCY_SCOPE_UNKNOWN');
  const v = validated || {};
  const derived = DERIVED_FIELDS[scope] || EMPTY_DERIVED;
  for (const k of Object.keys(v)) {
    // Derived fields are skipped, never fingerprinted. A field that is both
    // declared and derived is a contradiction — it would be counted and not
    // counted — so that is a hard error rather than a precedence rule.
    if (derived.has(k)) {
      if (k in spec) throw new Error(`${DERIVED_AND_DECLARED}:${scope}:${k}`);
      continue;
    }
    if (!(k in spec)) throw new Error(`${UNDECLARED_FIELD}:${scope}:${k}`);
  }
  const out = {};
  for (const f of Object.keys(spec)) {
    if (v[f] !== undefined) out[f] = assertNormalized(f, spec[f], v[f]);
  }
  return out;
}

/** The fingerprint an endpoint should pass, taken over validated input. */
export function mutationFingerprint(scope, validated) {
  return requestFingerprint(selectMutation(scope, validated));
}

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

/** Named scopes, so a caller cannot typo a string into IDEMPOTENCY_SCOPE_UNKNOWN. */
export const SCOPES = {
  INSTANCE_CREATE: 'instance-create',
  DRAFT_CREATE:    'draft-create',
  INSTANCE_SPLIT:  'instance-split',
  LISTING_PUBLISH: 'listing-publish',
};

export const IDEMPOTENCY_STATE = {
  FRESH:         'fresh',           // nothing recorded — the work ran
  IN_FLIGHT:     'in-flight',       // a concurrent attempt holds the key
  REPLAYED:      'replayed',        // completed before — stored result returned
  RECONCILED:    'reconciled',      // side effect already landed; recovered, not repeated
  UNAVAILABLE:   'unavailable',     // idempotency unestablishable — refused
  MISMATCH:      'mismatch',        // key reused for a DIFFERENT mutation — refused
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
  // The fingerprint is REQUIRED for every scope. An operation with no declared
  // request body cannot be distinguished from a different operation reusing the
  // key, which is the whole point of having one.
  if (opts.request === undefined) throw new Error('IDEMPOTENCY_REQUEST_REQUIRED');
  const fingerprint = requestFingerprint(opts.request);

  // ── 1. Read the attempt record. A read FAILURE is not "nothing recorded". ──
  let existing, storeReadable = true;
  try {
    existing = await kv('get', k);
  } catch {
    storeReadable = false;
  }

  if (storeReadable && existing) {
    const parsed = typeof existing === 'string' ? safeParse(existing) : existing;

    // Fingerprint is checked BEFORE anything is replayed or reconciled. A
    // mismatch means this is not a retry of that operation at all, so neither
    // the stored result nor the resource pointer is a valid answer to it.
    if (parsed && parsed.fingerprint && parsed.fingerprint !== fingerprint) {
      return {
        state: IDEMPOTENCY_STATE.MISMATCH, result: null, replayed: false,
        error: FINGERPRINT_MISMATCH, retryable: false,
        message: 'This request reuses a key from a different operation.',
      };
    }

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
        await recordDone(kv, k, resKey, landed, opKey, fingerprint);
        return { state: IDEMPOTENCY_STATE.RECONCILED, result: landed, replayed: true };
      }
      return {
        state: IDEMPOTENCY_STATE.IN_FLIGHT, result: null, replayed: false,
        message: UNAVAILABLE_MESSAGE,
      };
    }
  }

  // ── 2. No usable attempt record. Before doing ANYTHING — including asking
  //       reconcile — check the resource pointer, because the pointer carries
  //       the fingerprint of the operation that created the resource and
  //       reconcile does not.
  //
  //       Order matters and this was a real bug: reconcile ran first, so a
  //       mismatched retry got the OLD resource back, and recordDone then
  //       rewrote the attempt record with the NEW fingerprint pointing at the
  //       OLD resource — corrupting the evidence permanently, so even the
  //       honest retry afterwards was answered wrongly. A refusal has to happen
  //       before any write, not after.
  let pointerParsed = null;
  if (storeReadable) {
    let pointer = null;
    try { pointer = await kv('get', resKey); } catch { pointer = null; }
    if (pointer) {
      pointerParsed = typeof pointer === 'string'
        ? safeParse(pointer) || { resourceId: pointer } : pointer;
      if (pointerParsed.fingerprint && pointerParsed.fingerprint !== fingerprint) {
        return {
          state: IDEMPOTENCY_STATE.MISMATCH, result: null, replayed: false,
          error: FINGERPRINT_MISMATCH, retryable: false,
          message: 'This request reuses a key from a different operation.',
        };
      }
    }
  }

  //       Now it is safe to ask whether the side effect already landed. This
  //       covers the reservation having expired after the work succeeded — the
  //       case that silently duplicates.
  // The reconcile hook receives the pointer as well as the op key. Review asked
  // that the original fingerprint be available on every recovery path, and the
  // pointer is where it lives: a hook that can see { resourceId, fingerprint }
  // can rebuild the answer from the authoritative record instead of guessing.
  const alreadyLanded = await tryReconcile(reconcile, opKey, pointerParsed);
  if (alreadyLanded) {
    await recordDone(kv, k, resKey, alreadyLanded, opKey, fingerprint);
    return { state: IDEMPOTENCY_STATE.RECONCILED, result: alreadyLanded, replayed: true };
  }

  if (pointerParsed) {
    return { state: IDEMPOTENCY_STATE.RECONCILED, result: pointerParsed, replayed: true };
  }

  // ── 3. Reserve, and reserve EXCLUSIVELY. ──
  //
  // This was a plain SET, and a plain SET is not a reservation — it is an
  // announcement. Three simultaneous creates each read "nothing recorded",
  // each overwrote the marker, and each did the work: three drafts from one
  // idempotency key. The live-store pass caught it; the in-memory suite never
  // did, because it only ever retried sequentially.
  //
  // NX makes the reservation the same kind of object as a revision claim:
  // exactly one caller can hold it, and everyone else is told who does.
  // Single command, so a crash cannot leave a marker with no expiry.
  let reserved = false;
  let reserveFailed = false;
  if (storeReadable) {
    try {
      const won = await kv(
        'set', k,
        JSON.stringify({ status: 'in-flight', at: Date.now(), op: opKey, fingerprint }),
        'NX', 'EX', KEY_TTL_SEC,
      );
      reserved = won === 'OK';
    } catch { reserveFailed = true; }
  }

  // Lost the reservation race. Someone else is doing, or already did, this
  // exact operation. Re-read their record rather than guessing — between the
  // failed NX and now it may already have completed.
  if (!reserved && !reserveFailed && storeReadable) {
    let holder = null;
    try { holder = await kv('get', k); } catch { holder = null; }
    const h = typeof holder === 'string' ? safeParse(holder) : holder;

    if (h && h.fingerprint && h.fingerprint !== fingerprint) {
      return {
        state: IDEMPOTENCY_STATE.MISMATCH, result: null, replayed: false,
        error: FINGERPRINT_MISMATCH, retryable: false,
        message: 'This request reuses a key from a different operation.',
      };
    }
    if (h && h.status === 'done') {
      return { state: IDEMPOTENCY_STATE.REPLAYED, result: h.result, replayed: true };
    }
    // Still in flight, or the holder record vanished between the NX and the
    // read. Either way this caller must NOT proceed to do the work: the whole
    // point of losing the race is that someone else has it.
    return {
      state: IDEMPOTENCY_STATE.IN_FLIGHT, result: null, replayed: false,
      message: UNAVAILABLE_MESSAGE, retryable: true,
    };
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

  await recordDone(kv, k, resKey, result, opKey, fingerprint);
  return { state: IDEMPOTENCY_STATE.FRESH, result, replayed: false };
}

async function tryReconcile(reconcile, opKey, pointer) {
  if (!reconcile) return null;
  try {
    const found = await reconcile(opKey, pointer || null);
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
async function recordDone(kv, k, resKey, result, opKey, fingerprint) {
  const resourceId = result && (result.instanceId || result.draftId || result.listingId || result.id);
  if (resourceId) {
    try {
      await kv('set', resKey, JSON.stringify({ resourceId, op: opKey, at: Date.now(), fingerprint }));
      await kv('expire', resKey, KEY_TTL_SEC);
    } catch { /* the reconcile hook is the backstop */ }
  }
  try {
    await kv('set', k, JSON.stringify({ status: 'done', at: Date.now(), result, op: opKey, fingerprint }));
    await kv('expire', k, KEY_TTL_SEC);
  } catch { /* work is done; failing to record only costs retry safety */ }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
