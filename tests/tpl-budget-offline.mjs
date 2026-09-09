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
import handler, { setBudgetStore, budgetStoreActive, budgetMode, BUDGET_MODE } from '../api/tpl-proxy.js';

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
const REQUIRE_USABLE = 'if this fails, check config.usable — an unusable config must block, not fall back';
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
  check('with nothing set, the config reports itself UNCONFIGURED', d.configured === false);
  check('unconfigured is also UNUSABLE', d.usable === false);
  check('placeholder defaults still populate the numbers',
        d.max === BUDGET_DEFAULTS.max && d.windowSec === BUDGET_DEFAULTS.windowSec,
        'the values exist for reporting; usable=false is what stops spending');

  const bad = budgetConfig({ TPL_BUDGET_MAX: 'lots', TPL_BUDGET_WINDOW_SEC: '-5' });
  check('garbage configuration is reported as invalid, naming the keys',
        bad.invalid.includes('TPL_BUDGET_MAX') && bad.invalid.includes('TPL_BUDGET_WINDOW_SEC'));
  check('garbage configuration is UNUSABLE, not silently placeheld',
        bad.usable === false,
        'garbage must not activate a placeholder spending limit');
  check('a NaN budget never reads as "no budget" (numbers stay sane)',
        bad.max === BUDGET_DEFAULTS.max && bad.windowSec === BUDGET_DEFAULTS.windowSec);

  const half = budgetConfig({ TPL_BUDGET_MAX: '100' });
  check('a budget with no window is incomplete, so UNUSABLE', half.usable === false);

  // 8b. The gate is ENFORCED, not merely reported.
  const s1 = mockStore();
  const unconf = await reserveUpstream({ store: s1, ...base, env: {} });
  check('unusable config → NOT_CONFIGURED, never RESERVED',
        unconf.outcome === OUTCOME.NOT_CONFIGURED, REQUIRE_USABLE);
  check('unusable config spent nothing at all',
        !s1.calls.some(([op]) => op === 'incr'));

  const s2 = mockStore();
  const g = await reserveUpstream({ store: s2, ...base, env: { TPL_BUDGET_MAX: 'lots', TPL_BUDGET_WINDOW_SEC: '60' } });
  check('garbage config → no paid call', g.outcome === OUTCOME.NOT_CONFIGURED);

  const s3 = mockStore();
  s3.entries[cacheKey(base.path, base.upstreamQuery)] = { value: { cards: [7] }, expired: true };
  const gs = await reserveUpstream({ store: s3, ...base, env: {} });
  check('unusable config with an expired entry → stale, explicitly flagged',
        gs.outcome === OUTCOME.NOT_CONFIGURED_STALE && gs.stale === true);
  const s4 = mockStore();
  s4.entries[cacheKey(base.path, base.upstreamQuery)] = { value: { cards: [8] }, expired: false };
  const gh = await reserveUpstream({ store: s4, ...base, env: {} });
  check('a FRESH cached value is still served with no config — reading is not spending',
        gh.outcome === OUTCOME.CACHE_HIT);
}

// ── 9. Release and store round-trip ──────────────────────────────────────────
console.log('\n9. reservation release and result storage');
{
  const store = mockStore();
  const r = await reserveUpstream({ store, ...base, env: ENV });
  const key = `tpl:budget:${Math.floor(base.now / 1000 / 60)}`;
  check('a reservation was taken', store.counters[key] === 1);
  check('the reservation is bound to its window',
        r.reservation.windowId === Math.floor(base.now / 1000 / 60)
        && r.reservation.windowSec === 60);

  // A call that STARTED is never refunded — it may have consumed quota.
  const kept = await releaseReservation(store, r.reservation, { started: true, now: base.now });
  check('a started call is NOT refunded, even if it failed',
        kept.refunded === false && kept.reason === 'call_may_have_consumed_quota',
        'a timeout or 5xx may still have cost provider quota');
  check('…and the counter is untouched by that attempt', store.counters[key] === 1);

  // Only a call that definitely never started.
  const back = await releaseReservation(store, r.reservation, { started: false, now: base.now });
  check('a call that definitely never started IS refunded', back.refunded === true);
  check('…and the counter reflects it', store.counters[key] === 0);

  // A late refund must not credit a later window.
  const store5 = mockStore();
  const late = await reserveUpstream({ store: store5, ...base, env: ENV });
  const nextWindowNow = base.now + 61_000;
  const lateKey = `tpl:budget:${Math.floor(nextWindowNow / 1000 / 60)}`;
  await reserveUpstream({ store: store5, path: '/v1/cards/search', upstreamQuery: Q({ q: 'later' }), now: nextWindowNow, env: ENV });
  check('the next window has its own counter at 1', store5.counters[lateKey] === 1);
  const rolled = await releaseReservation(store5, late.reservation, { started: false, now: nextWindowNow });
  check('a refund arriving after the window rolled is REFUSED',
        rolled.refunded === false && rolled.reason === 'window_rolled');
  check('…so the later window keeps its full allowance spent',
        store5.counters[lateKey] === 1,
        'a delayed refund must never hand a new window allowance the old one paid for');

  await storeResult(store, r.key, { cards: ['x'] }, r.config);
  const stored = await store.get(r.key);
  check('a stored result is retrievable under the canonical key',
        stored && stored.value.cards[0] === 'x');

  // Failures in the optional paths must not throw into the caller.
  const brittle = mockStore();
  brittle.setWithTtl = async () => { throw new Error('nope'); };
  brittle.decr = async () => { throw new Error('nope'); };
  let threw = false;
  try {
    await storeResult(brittle, 'k', {}, r.config);
    const res = await releaseReservation(brittle, { key: 'k' }, { started: false });
    check('a refund that hits a broken store reports it rather than claiming success',
          res.refunded === false && res.reason === 'store_error');
  } catch { threw = true; }
  check('cache-write and refund failures never throw into the request path', !threw);
}

// ── 10. The proxy calling path, exercised against the injected mock ─────────
// Production KV isolation blocks LIVE integration. It does not block preparing
// and exercising the path that will use it, so this covers the wiring itself.
console.log('\n10. proxy calling path (injected mock store, no provider, no KV)');
{
  const mkRes = () => {
    const r = { headers: {}, code: null, body: null, sent: null };
    r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.send = (b) => { r.sent = b; return r; };
    r.end = () => r;
    return r;
  };
  const mkReq = (q) => ({ method: 'GET', query: q, headers: { 'x-forwarded-for': '5.5.5.5' } });
  const query = { path: '/v1/cards/search', q: 'Pikachu', game: 'pokemon', limit: '20' };

  check('the control is INACTIVE with no store injected', budgetStoreActive() === false);

  const realFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls++;
    return { status: 200, headers: { get: () => 'application/json' },
             text: async () => JSON.stringify({ cards: ['from upstream'] }) };
  };
  process.env.CARDSELL_TPL_KEY = 'test-key-not-real';

  try {
    // (a) A miss under a usable budget calls upstream once and caches it.
    process.env.TPL_BUDGET_ENFORCE = '1';
    process.env.TPL_BUDGET_MAX = '2';
    process.env.TPL_BUDGET_WINDOW_SEC = '3600';
    const store = mockStore();
    setBudgetStore(store);
    check('the control is ACTIVE once a store is injected', budgetStoreActive() === true);

    const res1 = mkRes();
    await handler(mkReq(query), res1);
    check('a miss reaches the provider once', upstreamCalls === 1);
    check('the miss returns 200', res1.code === 200);

    // (b) The same query again is a cache hit that spends nothing.
    const res2 = mkRes();
    await handler(mkReq({ ...query, limit: '20' }), res2);
    check('the second identical request does NOT reach the provider', upstreamCalls === 1);
    check('it is served from cache', res2.headers['x-tpl-cache'] === 'hit');

    // (c) Param order is the same entry — the reuse the edge cache cannot do.
    const res3 = mkRes();
    await handler(mkReq({ limit: '20', game: 'pokemon', q: 'Pikachu', path: '/v1/cards/search' }), res3);
    check('reordered parameters hit the SAME cache entry', upstreamCalls === 1,
          'the edge keys on the incoming URL; we key on meaning');

    // (d) Exhaustion is a clear unavailable response, not an empty success.
    const before = upstreamCalls;
    let last = null;
    for (let i = 0; i < 6; i++) {
      last = mkRes();
      await handler(mkReq({ ...query, q: `distinct${i}` }), last);
    }
    check('a budget of 2 permits at most 2 further provider calls',
          upstreamCalls - before <= 2, `got ${upstreamCalls - before}`);
    check('exhaustion returns 503, not an empty 200', last.code === 503);
    check('…and names the reason rather than looking like "no such card"',
          last.body && last.body.reason === 'budget_exhausted');

    // (e) No usable configuration → no paid call through the route either.
    delete process.env.TPL_BUDGET_MAX;
    delete process.env.TPL_BUDGET_WINDOW_SEC;
    const store2 = mockStore();
    setBudgetStore(store2);
    const atCall = upstreamCalls;
    const res5 = mkRes();
    await handler(mkReq({ ...query, q: 'Charizard' }), res5);
    check('unconfigured budget → the route makes NO provider call',
          upstreamCalls === atCall);
    check('…and says why', res5.code === 503 && res5.body.reason === 'budget_not_configured');

    // (f) An upstream failure does NOT refund — the call may have cost quota.
    process.env.TPL_BUDGET_MAX = '5';
    process.env.TPL_BUDGET_WINDOW_SEC = '3600';
    const store3 = mockStore();
    setBudgetStore(store3);
    globalThis.fetch = async () => { throw new Error('upstream timeout'); };
    const res6 = mkRes();
    await handler(mkReq({ ...query, q: 'Blastoise' }), res6);
    check('an upstream timeout returns 502', res6.code === 502);
    const counter = Object.entries(store3.counters).find(([k]) => k.startsWith('tpl:budget:'));
    check('the failed call is still COUNTED against the budget',
          counter && counter[1] === 1,
          'a provider that times out may still have charged us');
    check('no refund was attempted for a call that had already left',
          !store3.calls.some(([op]) => op === 'decr'));
  } finally {
    globalThis.fetch = realFetch;
    setBudgetStore(null);
    delete process.env.CARDSELL_TPL_KEY;
    delete process.env.TPL_BUDGET_MAX;
    delete process.env.TPL_BUDGET_WINDOW_SEC;
    delete process.env.TPL_BUDGET_ENFORCE;
  }
  check('the store is released again after the suite', budgetStoreActive() === false);
}

// ── 11. The two inactive modes are not the same thing ───────────────────────
// "No store" was doing double duty: deliberately off, and on-but-broken. The
// second must never fall back to the unmetered path, because that silently
// restores the exposure R4 exists to close and nothing looks wrong.
console.log('\n11. disabled vs enabled-but-unbound');
{
  const mkRes = () => {
    const r = { headers: {}, code: null, body: null, sent: null };
    r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.send = (b) => { r.sent = b; return r; };
    r.end = () => r;
    return r;
  };
  const req = { method: 'GET', headers: {},
                query: { path: '/v1/cards/search', q: 'Pikachu', game: 'pokemon', limit: '20' } };

  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { status: 200, headers: { get: () => 'application/json' },
             text: async () => JSON.stringify({ cards: [] }) };
  };
  process.env.CARDSELL_TPL_KEY = 'test-key-not-real';

  try {
    // CASE A — DISABLED. Off by choice: the pre-R4 unmetered path, documented.
    setBudgetStore(null);
    delete process.env.TPL_BUDGET_ENFORCE;
    check('unset enforcement with no store → DISABLED', budgetMode() === BUDGET_MODE.DISABLED);
    const before = calls;
    const resA = mkRes();
    await handler(req, resA);
    check('DISABLED passes the call through, exactly as before R4',
          calls === before + 1 && resA.code === 200,
          'this is the accepted scope choice, not a defect');

    // Explicit '0' is the same choice, said out loud.
    process.env.TPL_BUDGET_ENFORCE = '0';
    check("an explicit '0' is also DISABLED", budgetMode() === BUDGET_MODE.DISABLED);

    // CASE B — ENABLED BUT UNBOUND. On, with no store. Must block.
    process.env.TPL_BUDGET_ENFORCE = '1';
    setBudgetStore(null);
    check('enforcement on with no store → ENABLED_UNBOUND',
          budgetMode() === BUDGET_MODE.ENABLED_UNBOUND);
    const before2 = calls;
    const resB = mkRes();
    await handler(req, resB);
    check('ENABLED_UNBOUND makes NO paid call', calls === before2,
          'a missing binding must never silently restore the unmetered path');
    check('…and returns 503 rather than a result', resB.code === 503);
    check('…naming the unbound store specifically, not a generic outage',
          resB.body && resB.body.reason === 'budget_store_unbound',
          'the operator must be able to tell a misconfiguration from an exhausted budget');
    check('…and is never cached', resB.headers['cache-control'] === 'no-store');

    // The two absences must be DISTINGUISHABLE, which is the whole point.
    check('disabled and unbound are different reasons, not one shrug',
          BUDGET_MODE.DISABLED !== BUDGET_MODE.ENABLED_UNBOUND);

    // CASE C — bound and enforcing.
    process.env.TPL_BUDGET_MAX = '5';
    process.env.TPL_BUDGET_WINDOW_SEC = '3600';
    setBudgetStore(mockStore());
    check('enforcement on with a store → ENFORCING', budgetMode() === BUDGET_MODE.ENFORCING);
    const before3 = calls;
    const resC = mkRes();
    await handler(req, resC);
    check('ENFORCING permits a metered call', calls === before3 + 1 && resC.code === 200);
  } finally {
    globalThis.fetch = realFetch;
    setBudgetStore(null);
    delete process.env.CARDSELL_TPL_KEY;
    delete process.env.TPL_BUDGET_ENFORCE;
    delete process.env.TPL_BUDGET_MAX;
    delete process.env.TPL_BUDGET_WINDOW_SEC;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
