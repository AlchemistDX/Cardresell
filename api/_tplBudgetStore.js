/**
 * The PRODUCTION budget store for the TPL proxy (CH-3 / R4).
 *
 * R4 was built and tested against an injected mock. That proved the calling
 * path — which outcome each situation produces, what spends allowance, what
 * refunds — but it left the deployed function with NO store of its own. The
 * mock only ever arrives from a test, so on Vercel `_budgetStore` stayed null,
 * and once G12 turns enforcement on a null store means ENABLED_UNBOUND: every
 * uncached lookup would 503. Correct fail-closed behaviour, and a total outage.
 *
 * So the deployed function must initialize its own store. That is this file.
 *
 * ── Why not reuse a store from elsewhere ─────────────────────────────────────
 * `_draftIndex.js` and `_draftQuota.js` each hold a private `kv()` over the
 * same REST shape, with a comment on the second explaining why the duplication
 * is acceptable: it is TRANSPORT, not business behaviour, so it does not fall
 * under the one-behaviour-one-implementation rule. The same reasoning applies
 * here and is the reason this is a third copy of six lines rather than a shared
 * export that would couple three unrelated modules.
 *
 * What is NOT duplicated is the budget semantics. Windowing, per-IP counting,
 * exhaustion, refund eligibility and config validation all stay in
 * `_tplBudget.js`. This file is four methods over Upstash REST and nothing
 * else — it holds no policy, so there is no second implementation of the
 * spending rules to drift from the first.
 */

const KV_URL   = () => process.env.KV_REST_API_URL;
const KV_TOKEN = () => process.env.KV_REST_API_TOKEN;

/**
 * Read at CALL time, not at module load.
 *
 * `_draftQuota.js` captures `KV_REST_API_URL` into a module constant at import.
 * That is fine there and wrong here: this module is imported by an offline
 * suite that sets the variables per-case to exercise configured and
 * unconfigured paths in the same process. A module-load capture would freeze
 * whichever value existed when the import ran and make the unconfigured test
 * pass for the wrong reason.
 */
export function kvConfigured() {
  return Boolean(KV_URL() && KV_TOKEN());
}

async function kv(cmd, ...args) {
  if (!kvConfigured()) throw new Error('kv_unconfigured');
  const path = [cmd, ...args].map((a) => encodeURIComponent(String(a))).join('/');
  const res  = await fetch(`${KV_URL()}/${path}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN()}` },
  });
  if (!res.ok) throw new Error(`kv_${cmd}_failed:${res.status}`);
  const j = await res.json().catch(() => ({}));
  return j.result;
}

/**
 * The four methods `_tplBudget.js` calls, and nothing more.
 *
 * `incr` MUST be atomic, because the whole concurrency guarantee rests on it:
 * 25 simultaneous misses against a budget of 3 must yield exactly 3 upstream
 * calls. Section 3b of the offline suite proves that assertion is non-vacuous
 * by substituting a deliberately non-atomic store and watching it overspend.
 * Redis INCR is atomic server-side, which is why the counter is a counter and
 * not a read-modify-write of a JSON blob.
 *
 * The TTL is set only when INCR returns 1 — i.e. only by the request that
 * created the window. Re-setting it on every increment would slide the window
 * forward on each call and a busy key would never expire, quietly converting a
 * fixed window into a permanent one.
 */
export function createKvBudgetStore() {
  return {
    async get(key) {
      const raw = await kv('get', key);
      if (raw == null) return null;
      try {
        const parsed = JSON.parse(raw);
        // The stale/fresh distinction is the CALLER's, computed from the
        // stored timestamp. This store does not decide freshness; returning
        // the envelope unchanged keeps that judgement in one place.
        return parsed;
      } catch {
        // A corrupt entry is a cache miss, not a crash. Worst case is one
        // extra upstream call, which is metered like any other.
        return null;
      }
    },

    async setWithTtl(key, value, _cacheTtlSec, staleTtlSec) {
      // Stored for the STALE lifetime, not the fresh one. An entry past its
      // fresh window is still worth serving when the budget is exhausted or
      // the provider is down, and deleting it at the fresh boundary would
      // throw away the only thing that makes EXHAUSTED_STALE possible.
      await kv('set', key, JSON.stringify(value), 'ex', String(staleTtlSec));
    },

    async incr(key, windowSec) {
      const n = Number(await kv('incr', key));
      if (n === 1 && windowSec) {
        try { await kv('expire', key, String(windowSec)); } catch { /* see below */ }
      }
      return n;
    },

    async decr(key) {
      await kv('decr', key);
    },
  };
}

/*
 * A failed EXPIRE is swallowed, and that is a deliberate asymmetry.
 *
 * If EXPIRE fails the counter keeps its value beyond the intended window, so
 * the budget under-serves: it refuses calls it could have allowed. That errs
 * toward not spending. Throwing instead would surface as STORE_DOWN and refuse
 * the same calls anyway, having also lost the increment already recorded.
 *
 * The reverse asymmetry would be the bug: if a failed INCR were swallowed, the
 * budget would over-serve and spend real money uncounted. INCR failures
 * therefore propagate, and `reserveUpstream` turns them into STORE_DOWN.
 */
