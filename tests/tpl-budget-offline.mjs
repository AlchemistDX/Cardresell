// tests/tpl-budget-offline.mjs
// [CH-3 / R4] Offline tests for the TPL cache + aggregate spending allowance.
//
// The store is MOCKED and the provider is never called. This suite spends no
// paid quota and touches no KV — production KV remains out of scope until it is
// isolated. Live integration is deliberately NOT tested here.
//
// The acceptance cases, as set by the reviewer:
//   1. Cache hits consume no upstream allowance.
//   2. Concurrent misses cannot exceed the aggregate allowance; the allowance
//      is reserved atomically BEFORE the provider is called.
//   3. Counter/storage failure permits no new paid call.
//   4. Exhaustion returns an explicitly stale result where appropriate, or a
//      clear unavailable response.
//   5. Budget and window are configurable, and no production spending limit is
//      invented.

import {
  reserveUpstream, releaseReservation, storeResult,
  budgetConfig, cacheKey, OUTCOME, BUDGET_DEFAULTS,
} from '../api/_tplBudget.js';

let passed = 0, failed = 0;
function check(name, cond, hint = '') {
  if (cond && typeof cond.then === 'function') {
    failed++;
    console.log(`  FAIL ${name}\n       → TEST_API_MISUSE: a Promise is not a truth value; await it`);
    return;
  }
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${hint ? `\n       → ${hint}` : ''}`); }
}

// ── A mock store with a genuinely atomic INCR ────────────────────────────────
// Node runs this on one thread, so `counters[k] = (counters[k]||0)+1` inside a
// single async function IS atomic with respect to other awaits. That models
// Redis INCR correctly. A deliberately NON-atomic variant is used later to
// prove the test can actually detect the race.
function mockStore(opts = {}) {
  const s = {
    counters: {}, entries: {}, calls: [],
    failIncr: opts.failIncr || false,
    failGet: opts.failGet || false,
    incrReturns: opts.incrReturns,
  };
  s.get = async (k) => {
    s.calls.push(['get', k]);
    if (s.failGet) throw new Error('store unreachable');
    return s.entries[k] || null;
  };
  s.setWithTtl = async (k, v) => { s.calls.push(['set', k]); s.entries[k] = { value: v, expired: false }; };
  s.incr = async (k) => {
    s.calls.push(['incr', k]);
    if (s.failIncr) throw new Error('store unreachable');
    s.counters[k] = (s.counters[k] || 0) + 1;
    return s.incrReturns !== undefined ? s.incrReturns : s.counters[k];
  };
  s.decr = async (k) => { s.calls.push(['decr', k]); s.counters[k] = (s.counters[k] || 0) - 1; };
  return s;
}

const Q = (obj) => new URLSearchParams(obj);
const ENV = { TPL_BUDGET_MAX: '3', TPL_BUDGET_WINDOW_SEC: '60', TPL_PER_IP_MAX: '2' };
const base = { path: '/v1/cards/search', upstreamQuery: Q({ q: 'Pikachu' }), now: 1_000_000_000_000 };

console.log('\nTPL budget + cache [CH-3 / R4]');

// ── 1. Cache hits consume no upstream allowance ──────────────────────────────
console.log('\n1. cache hits consume no allowance');
{
  const store = mockStore();
  const key = cacheKey(base.path, base.upstreamQuery);
  store.entries[key] = { value: { cards: [] }, expired: false };

  const r = await reserveUpstream({ store, ...base, ip: '1.1.1.1', env: ENV });
  check('a fresh cache entry is a CACHE_HIT', r.outcome === OUTCOME.CACHE_HIT);
  check('the cached value is returned', !!r.cached);
  check('NO counter was incremented on a hit',
        !store.calls.some(([op]) => op === 'incr'),
        `calls: ${JSON.stringify(store.calls)}`);
  check('a hit is not marked stale', !r.stale);

  // Hits must not consume allowance even under repetition.
  for (let i = 0; i < 50; i++) await reserveUpstream({ store, ...base, ip: '1.1.1.1', env: ENV });
  check('50 more hits still spend nothing',
        Object.keys(store.counters).length === 0);
}

// ── 2. Canonical key: param order does not create a second entry ─────────────
console.log('\n2. canonical cache key');
{
  const a = cacheKey('/v1/cards/search', Q({ q: 'Pikachu', game: 'pokemon', limit: '20' }));
  const b = cacheKey('/v1/cards/search', Q({ limit: '20', game: 'pokemon', q: 'Pikachu' }));
  check('parameter order does not change the key', a === b, `${a} !== ${b}`);
  check('different values do change the key',
        cacheKey('/v1/cards/search', Q({ q: 'Pikachu' })) !==
        cacheKey('/v1/cards/search', Q({ q: 'Charizard' })));
  check('different paths change the key',
        cacheKey('/v1/cards/abc', Q({})) !== cacheKey('/v1/cards/xyz', Q({})));
}

// ── 3. Concurrent misses cannot exceed the aggregate allowance ───────────────
console.log('\n3. concurrent misses cannot exceed the allowance');
{
  const store = mockStore();
  // 25 simultaneous misses against a budget of 3.
  const results = await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      reserveUpstream({ store, path: '/v1/cards/search',
                        upstreamQuery: Q({ q: `card${i}` }), now: base.now, env: ENV })));
  const reserved = results.filter((r) => r.outcome === OUTCOME.RESERVED);
  check('exactly 3 of 25 concurrent misses were allowed to spend',
        reserved.length === 3, `got ${reserved.length}`);
  check('the remaining 22 are EXHAUSTED, not silently allowed',
        results.filter((r) => r.outcome === OUTCOME.EXHAUSTED).length === 22);
  check('every reservation carries a distinct count',
        new Set(reserved.map((r) => r.reservation.count)).size === 3);
  check('the counter never records more than the budget',
        Math.max(...Object.values(store.counters)) <= 3);
}

// ── 3b. The test can actually detect a race ──────────────────────────────────
// A check-then-increment store must FAIL the same assertion. Without this, test
// 3 might be passing because nothing is concurrent rather than because the
// reservation is atomic.
console.log('\n3b. the concurrency test is not vacuous');
{
  const racy = mockStore();
  racy.incr = async (k) => {
    const cur = racy.counters[k] || 0;
    await new Promise((r) => setImmediate(r)); // yield: the classic read-then-write gap
    racy.counters[k] = cur + 1;
    return cur + 1;
  };
  const results = await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      reserveUpstream({ store: racy, path: '/v1/cards/search',
                        upstreamQuery: Q({ q: `card${i}` }), now: base.now, env: ENV })));
  const over = results.filter((r) => r.outcome === OUTCOME.RESERVED).length;
  check('a NON-atomic store overspends, proving the assertion has teeth',
        over > 3, `a check-then-set store allowed ${over}; if this is ≤3 the test proves nothing`);
}

// ── 4. Store failure permits no new paid call ────────────────────────────────
console.log('\n4. storage failure permits no new paid call');
{
  const down = mockStore({ failIncr: true });
  const r = await reserveUpstream({ store: down, ...base, ip: '1.1.1.1', env: ENV });
  check('counter unreachable → never RESERVED', r.outcome !== OUTCOME.RESERVED);
  check('counter unreachable → STORE_DOWN', r.outcome === OUTCOME.STORE_DOWN);

  // Same, but a cached (expired) value exists: serving stale is not spending.
  const down2 = mockStore({ failIncr: true });
  down2.entries[cacheKey(base.path, base.upstreamQuery)] = { value: { cards: [1] }, expired: true };
  const r2 = await reserveUpstream({ store: down2, ...base, ip: '1.1.1.1', env: ENV });
  check('counter unreachable with a stale entry → STORE_DOWN_STALE',
        r2.outcome === OUTCOME.STORE_DOWN_STALE);
  check('the stale value is served and marked stale', !!r2.cached && r2.stale === true);
  check('serving stale still did not reserve', !r2.reservation);

  // A store that answers with garbage is also a store we cannot trust.
  const garbage = mockStore({ incrReturns: 'yes' });
  const r3 = await reserveUpstream({ store: garbage, ...base, env: ENV });
  check('a non-numeric counter reply → no paid call', r3.outcome === OUTCOME.STORE_DOWN);

  // A failing cache READ must not block a call — reading is not spending.
  const noRead = mockStore({ failGet: true });
  const r4 = await reserveUpstream({ store: noRead, ...base, env: ENV });
  check('a failing cache READ still permits a reserved call',
        r4.outcome === OUTCOME.RESERVED,
        'a cache read failure is not a spending risk and must not fail closed');
}

// ── 5. Exhaustion: stale where possible, clear unavailability otherwise ──────
console.log('\n5. exhaustion behaviour');
{
  const store = mockStore();
  store.counters[`tpl:budget:${Math.floor(base.now / 1000 / 60)}`] = 3; // at budget

  const noCache = await reserveUpstream({ store, ...base, env: ENV });
  check('exhausted with no cached value → EXHAUSTED (clear unavailability)',
        noCache.outcome === OUTCOME.EXHAUSTED);
  check('exhausted → no reservation handed out', !noCache.reservation);

  const store2 = mockStore();
  store2.counters[`tpl:budget:${Math.floor(base.now / 1000 / 60)}`] = 3;
  store2.entries[cacheKey(base.path, base.upstreamQuery)] = { value: { cards: [2] }, expired: true };
  const withStale = await reserveUpstream({ store: store2, ...base, env: ENV });
  check('exhausted with an expired entry → EXHAUSTED_STALE',
        withStale.outcome === OUTCOME.EXHAUSTED_STALE);
  check('the stale result is flagged stale, not passed off as fresh',
        withStale.stale === true && !!withStale.cached);

  check('an over-budget attempt refunds its reservation',
        store2.calls.some(([op]) => op === 'decr'),
        'the counter should count permitted calls, not attempts');
}

// ── 6. Per-IP is secondary, and does not substitute for the aggregate ────────
console.log('\n6. per-IP is the secondary control');
{
  const store = mockStore();
  const a1 = await reserveUpstream({ store, path: '/v1/cards/search', upstreamQuery: Q({ q: 'a' }), now: base.now, ip: '9.9.9.9', env: ENV });
  const a2 = await reserveUpstream({ store, path: '/v1/cards/search', upstreamQuery: Q({ q: 'b' }), now: base.now, ip: '9.9.9.9', env: ENV });
  const a3 = await reserveUpstream({ store, path: '/v1/cards/search', upstreamQuery: Q({ q: 'c' }), now: base.now, ip: '9.9.9.9', env: ENV });
  check('one IP is cut off at its own cap (2)',
        a1.outcome === OUTCOME.RESERVED && a2.outcome === OUTCOME.RESERVED && a3.outcome === OUTCOME.PER_IP);

  // The point of the aggregate: many IPs, each under its own cap, still bounded.
  const store2 = mockStore();
  const many = await Promise.all(Array.from({ length: 30 }, (_, i) =>
    reserveUpstream({ store: store2, path: '/v1/cards/search',
                      upstreamQuery: Q({ q: `q${i}` }), now: base.now,
                      ip: `10.0.0.${i}`, env: ENV })));
  check('30 DISTINCT IPs, each within the per-IP cap, are still bounded by the aggregate',
        many.filter((r) => r.outcome === OUTCOME.RESERVED).length === 3,
        'this is precisely what a per-IP cap alone cannot do');
}

// ── 7. Windows roll ──────────────────────────────────────────────────────────
console.log('\n7. the allowance is per window');
{
  const store = mockStore();
  const spend = (now) => reserveUpstream({ store, path: '/v1/cards/search', upstreamQuery: Q({ q: String(Math.random()) }), now, env: ENV });
  for (let i = 0; i < 3; i++) await spend(base.now);
  const blocked = await spend(base.now);
  check('the fourth call in a window is refused', blocked.outcome === OUTCOME.EXHAUSTED);
  const nextWindow = await spend(base.now + 61_000);
  check('the next window starts a fresh allowance', nextWindow.outcome === OUTCOME.RESERVED);
}

// ── 8. Configurable, and no production limit invented ────────────────────────
console.log('\n8. configuration');
{
  const c = budgetConfig({ TPL_BUDGET_MAX: '77', TPL_BUDGET_WINDOW_SEC: '120', TPL_PER_IP_MAX: '5' });
  check('budget, window and per-IP cap are all configurable',
        c.max === 77 && c.windowSec === 120 && c.perIpMax === 5);
  check('a configured budget is flagged configured', c.configured === true);

  const d = budgetConfig({});
  check('with nothing set, the config reports itself UNCONFIGURED',
        d.configured === false,
        'the defaults are placeholders, not a production spending limit');
  check('placeholder defaults are used rather than guessed from a plan',
        d.max === BUDGET_DEFAULTS.max && d.windowSec === BUDGET_DEFAULTS.windowSec);

  const bad = budgetConfig({ TPL_BUDGET_MAX: 'lots', TPL_BUDGET_WINDOW_SEC: '-5' });
  check('garbage configuration falls back to defaults rather than 0 or NaN',
        bad.max === BUDGET_DEFAULTS.max && bad.windowSec === BUDGET_DEFAULTS.windowSec,
        'a NaN budget must never read as "no budget"');
}

// ── 9. Release and store round-trip ──────────────────────────────────────────
console.log('\n9. reservation release and result storage');
{
  const store = mockStore();
  const r = await reserveUpstream({ store, ...base, env: ENV });
  const key = `tpl:budget:${Math.floor(base.now / 1000 / 60)}`;
  check('a reservation was taken', store.counters[key] === 1);
  await releaseReservation(store, r.reservation);
  check('releasing an unused reservation refunds it', store.counters[key] === 0);

  await storeResult(store, r.key, { cards: ['x'] }, r.config);
  const back = await store.get(r.key);
  check('a stored result is retrievable under the canonical key',
        back && back.value.cards[0] === 'x');

  // Failures in the optional paths must not throw into the caller.
  const brittle = mockStore();
  brittle.setWithTtl = async () => { throw new Error('nope'); };
  brittle.decr = async () => { throw new Error('nope'); };
  let threw = false;
  try {
    await storeResult(brittle, 'k', {}, r.config);
    await releaseReservation(brittle, { key: 'k' });
  } catch { threw = true; }
  check('cache-write and refund failures never throw into the request path', !threw);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
