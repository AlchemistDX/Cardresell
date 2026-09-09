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
  return {
    max:         num(env.TPL_BUDGET_MAX,        BUDGET_DEFAULTS.max),
    windowSec:   num(env.TPL_BUDGET_WINDOW_SEC, BUDGET_DEFAULTS.windowSec),
    perIpMax:    num(env.TPL_PER_IP_MAX,        BUDGET_DEFAULTS.perIpMax),
    cacheTtlSec: num(env.TPL_CACHE_TTL_SEC,     BUDGET_DEFAULTS.cacheTtlSec),
    staleTtlSec: num(env.TPL_STALE_TTL_SEC,     BUDGET_DEFAULTS.staleTtlSec),
    // Explicit: is a real budget configured, or are we on placeholders?
    configured: env.TPL_BUDGET_MAX !== undefined,
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

  return { outcome: OUTCOME.RESERVED, key, config,
           reservation: { key: budgetKey, count } };
}

/** Release a reservation whose provider call never happened. Best effort. */
export async function releaseReservation(store, reservation) {
  if (!reservation) return;
  try { await store.decr(reservation.key); } catch { /* best effort */ }
}

/** Store a successful upstream body under the canonical key. */
export async function storeResult(store, key, value, config) {
  try {
    await store.setWithTtl(key, value, config.cacheTtlSec, config.staleTtlSec);
  } catch { /* caching is an optimisation; its failure is not the caller's problem */ }
}
