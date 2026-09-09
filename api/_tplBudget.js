// api/_tplBudget.js
// [CH-3 / R4] Server-side cache + AGGREGATE spending allowance for the paid
// TCGPriceLookup upstream.
//
// WHY AGGREGATE, NOT PER-IP
//
// A per-IP cap bounds one address while any number of addresses spend in
// parallel, so it does not bound distributed usage at all. The primary control
// here is a GLOBAL allowance per time window; the per-IP cap is secondary,
// against a single noisy source.
//
// THE CONCURRENCY RULE
//
// Checking a counter and then calling the provider is a race: N concurrent
// requests all read "under budget" and all spend. The allowance is therefore
// RESERVED ATOMICALLY BEFORE the provider is called (INCR, then compare), never
// incremented after. A reservation that turns out unused is refunded on a
// best-effort basis; over-counting is the safe direction, under-counting is not.
//
// FAIL CLOSED
//
// If the counter store is unreachable or misbehaves, we cannot know what has
// been spent. No new paid call is permitted in that state. A cached value may
// still be served — reading a cache is not spending.
//
// NOT A PRODUCTION SPENDING LIMIT. The defaults below are placeholders chosen
// to be obviously provisional. The real budget and window are the owner's to
// set, from the provider's plan, via TPL_BUDGET_MAX / TPL_BUDGET_WINDOW_SEC.

export const BUDGET_DEFAULTS = {
  // Deliberately NOT tuned to any real plan — the owner sets these.
  max: 1000,
  windowSec: 3600,
  perIpMax: 60,
  cacheTtlSec: 6 * 60 * 60,   // mirrors api/pricecharting.js:18
  staleTtlSec: 24 * 60 * 60,  // how long an expired entry stays servable as stale
};

export function budgetConfig(env = process.env) {
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : d;
  };
  // A value that was SET but is unusable is a different thing from one that was
  // never set, and both are different from a good value. Garbage must never
  // silently fall through to a placeholder that then authorises spending.
  const bad = (v) => {
    if (v === undefined || v === null || v === '') return false;
    const n = Number(v);
    return !(Number.isFinite(n) && n > 0);
  };
  const invalid = ['TPL_BUDGET_MAX', 'TPL_BUDGET_WINDOW_SEC', 'TPL_PER_IP_MAX',
                   'TPL_CACHE_TTL_SEC', 'TPL_STALE_TTL_SEC'].filter((k) => bad(env[k]));

  const configured = env.TPL_BUDGET_MAX !== undefined
                     && env.TPL_BUDGET_WINDOW_SEC !== undefined;

  return {
    max:         num(env.TPL_BUDGET_MAX,        BUDGET_DEFAULTS.max),
    windowSec:   num(env.TPL_BUDGET_WINDOW_SEC, BUDGET_DEFAULTS.windowSec),
    perIpMax:    num(env.TPL_PER_IP_MAX,        BUDGET_DEFAULTS.perIpMax),
    cacheTtlSec: num(env.TPL_CACHE_TTL_SEC,     BUDGET_DEFAULTS.cacheTtlSec),
    staleTtlSec: num(env.TPL_STALE_TTL_SEC,     BUDGET_DEFAULTS.staleTtlSec),
    // Is a real budget configured, or are we on placeholders?
    configured,
    invalid,
    // The single flag the calling path enforces. `configured: false` is only
    // useful if something acts on it, so this is what reserveUpstream reads.
    usable: configured && invalid.length === 0,
  };
}

/**
 * Canonical cache key. Built from the CONTRACTED parameters in a fixed order,
 * so `?q=a&game=b` and `?game=b&q=a` are one entry. This is the reuse the edge
 * cache cannot give us: the edge keys on the incoming URL, we key on meaning.
 */
export function cacheKey(path, upstreamQuery) {
  const parts = [...upstreamQuery.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`);
  return `tpl:${path}${parts.length ? '?' + parts.join('&') : ''}`;
}

export const OUTCOME = {
  CACHE_HIT: 'cache_hit',
  RESERVED: 'reserved',
  EXHAUSTED_STALE: 'exhausted_stale',
  EXHAUSTED: 'exhausted',
  PER_IP: 'per_ip',
  STORE_DOWN_STALE: 'store_down_stale',
  STORE_DOWN: 'store_down',
  // Missing or unusable configuration. Treated exactly like an exhausted
  // budget: never a paid call. An unset limit is not an unlimited one.
  NOT_CONFIGURED_STALE: 'not_configured_stale',
  NOT_CONFIGURED: 'not_configured',
};

/**
 * Decide whether this request may reach the paid provider.
 *
 * `store` is the injectable counter/cache interface (mocked in tests, KV in
 * production — deliberately not bound to KV here, since production KV is out of
 * scope until it is isolated):
 *   get(key)                      -> {value, expired} | null
 *   setWithTtl(key, value, ttl)   -> void
 *   incr(key, ttlSec)             -> number   (ATOMIC; returns the new count)
 *   decr(key)                     -> void     (best-effort refund)
 *
 * @returns {{outcome: string, cached?: any, stale?: boolean, key: string,
 *            reservation?: {key: string, count: number}, config: object}}
 */
export async function reserveUpstream({ store, path, upstreamQuery, ip, now = Date.now(), env }) {
  const config = budgetConfig(env);
  const key = cacheKey(path, upstreamQuery);

  // 1. A cache read is never spending, so it is attempted first and its
  //    failure is never fatal.
  let entry = null;
  try {
    entry = await store.get(key);
  } catch {
    entry = null;
  }
  if (entry && !entry.expired) {
    return { outcome: OUTCOME.CACHE_HIT, cached: entry.value, key, config };
  }

  // 1b. GATE: no usable configuration, no paid call.
  // A cached hit above is already served — reading what we have costs nothing.
  // But an unset or garbage budget must not authorise a NEW purchase against a
  // placeholder. This is what makes `configured` more than a label.
  if (!config.usable) {
    return entry
      ? { outcome: OUTCOME.NOT_CONFIGURED_STALE, cached: entry.value, stale: true, key, config }
      : { outcome: OUTCOME.NOT_CONFIGURED, key, config };
  }

  const windowId = Math.floor(now / 1000 / config.windowSec);
  const budgetKey = `tpl:budget:${windowId}`;

  // 2. Per-IP secondary control. Its own failure is treated the same as the
  //    aggregate's: unknown spend means no new spend.
  if (ip) {
    const ipKey = `tpl:ip:${windowId}:${ip}`;
    let ipCount;
    try {
      ipCount = await store.incr(ipKey, config.windowSec);
    } catch {
      return entry
        ? { outcome: OUTCOME.STORE_DOWN_STALE, cached: entry.value, stale: true, key, config }
        : { outcome: OUTCOME.STORE_DOWN, key, config };
    }
    if (ipCount > config.perIpMax) {
      return entry
        ? { outcome: OUTCOME.EXHAUSTED_STALE, cached: entry.value, stale: true, key, config }
        : { outcome: OUTCOME.PER_IP, key, config };
    }
  }

  // 3. AGGREGATE allowance, reserved atomically BEFORE the call. INCR-then-
  //    compare, so concurrent misses cannot all pass a stale read.
  let count;
  try {
    count = await store.incr(budgetKey, config.windowSec);
  } catch {
    return entry
      ? { outcome: OUTCOME.STORE_DOWN_STALE, cached: entry.value, stale: true, key, config }
      : { outcome: OUTCOME.STORE_DOWN, key, config };
  }

  if (typeof count !== 'number' || !Number.isFinite(count)) {
    // A store that answers but not with a count is a store we cannot trust.
    return entry
      ? { outcome: OUTCOME.STORE_DOWN_STALE, cached: entry.value, stale: true, key, config }
      : { outcome: OUTCOME.STORE_DOWN, key, config };
  }

  if (count > config.max) {
    // Over budget. The reservation we just took is refunded so the counter
    // reflects permitted calls rather than attempts.
    try { await store.decr(budgetKey); } catch { /* best effort */ }
    return entry
      ? { outcome: OUTCOME.EXHAUSTED_STALE, cached: entry.value, stale: true, key, config }
      : { outcome: OUTCOME.EXHAUSTED, key, config };
  }

  // The reservation is bound to the window it was taken in. A refund that
  // arrives after the window rolls must not be applied to the NEXT window's
  // counter — that would hand the new window free allowance paid for by the
  // old one.
  return { outcome: OUTCOME.RESERVED, key, config,
           reservation: { key: budgetKey, count, windowId, windowSec: config.windowSec } };
}

/**
 * Refund a reservation for a call that DEFINITELY never started.
 *
 * Two rules, both of them about not under-counting real spending:
 *
 *   1. Only a call that never reached the provider may be refunded. A timeout
 *      or an upstream 5xx may still have consumed provider quota — the request
 *      left, and we cannot see what it cost. Refunding those would let a
 *      failing upstream silently reset our own accounting. So the caller must
 *      say so explicitly via `{ started: false }`; anything else is kept.
 *   2. The refund only applies inside the reservation's own window. Once the
 *      window has rolled, `reservation.key` names a counter that is no longer
 *      the live one, and decrementing it would either be a no-op or, worse,
 *      credit a later window with allowance the earlier one spent.
 *
 * @returns {{refunded: boolean, reason?: string}} — reported, not silent, so a
 *          caller (and a test) can tell a kept reservation from a refunded one.
 */
export async function releaseReservation(store, reservation, { started = true, now = Date.now() } = {}) {
  if (!reservation) return { refunded: false, reason: 'no_reservation' };

  if (started) return { refunded: false, reason: 'call_may_have_consumed_quota' };

  if (reservation.windowSec) {
    const nowWindow = Math.floor(now / 1000 / reservation.windowSec);
    if (nowWindow !== reservation.windowId) {
      return { refunded: false, reason: 'window_rolled' };
    }
  }

  try {
    await store.decr(reservation.key);
    return { refunded: true };
  } catch {
    return { refunded: false, reason: 'store_error' };
  }
}

/** Store a successful upstream body under the canonical key. */
export async function storeResult(store, key, value, config) {
  try {
    await store.setWithTtl(key, value, config.cacheTtlSec, config.staleTtlSec);
  } catch { /* caching is an optimisation; its failure is not the caller's problem */ }
}
