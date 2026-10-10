import assert from 'node:assert/strict';
import { createPricingRequest, pricingCacheCommand } from '../api/_pricingRequest.js';
import handler from '../api/pricecharting.js';
import { readCoreBundle } from './_assetRefs.mjs';

const original = { fetch, setTimeout, clearTimeout, now: Date.now, warn: console.warn };
const priorEnv = Object.fromEntries(['PRICECHARTING_API_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN'].map(k => [k, process.env[k]]));
const timers = new Set(); let clock = 1791560000000, checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
try {
  globalThis.setTimeout = (fn, ms) => {
    const timer = { fn, ms }; timers.add(timer);
    if (ms <= 200) queueMicrotask(() => { timers.delete(timer); clock += ms; fn(); });
    return timer;
  };
  globalThis.clearTimeout = timer => timers.delete(timer);
  Date.now = () => clock; console.warn = () => {};
  const stalled = signal => new Promise((_, reject) => {
    check(timers.size === 1, 'deadline survives headers');
    signal.addEventListener('abort', () => reject(Object.assign(new Error('secret upstream URL'), { name: 'AbortError' })));
    const timer = [...timers][0]; clock += timer.ms; timer.fn();
  });
  const ok = () => ({ ok: true, status: 200, json: async () => ({ status: 'success', id: '123' }) });
  for (const status of [400, 401, 403, 404, 429, 500, 503]) {
    let calls = 0;
    const request = createPricingRequest({ fetchImpl: async () => { calls++; return { ok: false, status }; }, sleep: async ms => { clock += ms; } });
    await assert.rejects(request('https://provider.test/?token=private'));
    check(calls === (status >= 500 ? 2 : 1), 'only 5xx gets one bounded retry: ' + status);
    check(timers.size === 0, 'failure clears timer');
  }
  {
    let calls = 0;
    const request = createPricingRequest({ fetchImpl: async () => { calls++; return { ok: false, status: 503,
      headers: new Headers({ 'Retry-After': '60' }) }; } });
    await assert.rejects(request('https://provider.test/'));
    check(calls === 1 && timers.size === 0, 'server Retry-After prevents an immediate retry');
  }
  for (const stage of ['headers', 'body', 'parse', 'network']) {
    let calls = 0;
    const request = createPricingRequest({ fetchImpl: async (_, init) => {
      calls++;
      if (stage === 'headers') return stalled(init.signal);
      if (stage === 'network') throw new Error('https://provider.test/?token=SECRET');
      return { ok: true, json: () => stage === 'body' ? stalled(init.signal) : Promise.reject(new SyntaxError('SECRET')) };
    } });
    await assert.rejects(request('https://provider.test/'), error => !error.message.includes('SECRET') && !error.message.includes('https'));
    check(calls === 1 && timers.size === 0, stage + ' does not multiply requests or leak timers');
  }
  {
    let calls = 0;
    const request = createPricingRequest({ maxAttempts: 3, fetchImpl: async () => ++calls === 1 ? { ok: false, status: 503 } : ok(), sleep: async ms => { clock += ms; } });
    await request('a'); await request('b');
    await assert.rejects(request('c'), /lookup_budget_exhausted/);
    check(calls === 3, 'follow-up queries and retries share the call ceiling');
  }
  {
    let calls = 0;
    const request = createPricingRequest({ budgetMs: 1000, fetchImpl: async () => { calls++; clock += 1001; return ok(); } });
    await request('a'); await assert.rejects(request('b'), /lookup_budget_exhausted/);
    check(calls === 1, 'expired lookup cannot dispatch another identity query');
  }
  globalThis.fetch = async (_, init) => ({ ok: true, json: () => stalled(init.signal) });
  check(await pricingCacheCommand('https://kv.test', 'fixture', ['GET', 'key']) === null, 'cache body stall degrades within deadline');
  check(timers.size === 0, 'cache timeout timer cleared');

  process.env.PRICECHARTING_API_TOKEN = 'fixture-secret';
  process.env.KV_REST_API_URL = 'https://kv.test'; process.env.KV_REST_API_TOKEN = 'fixture';
  const kv = new Map(); let calls = 0, status = 200;
  globalThis.fetch = async (url, init) => {
    if (url === 'https://kv.test') {
      const [cmd, key, ttl, value] = JSON.parse(init.body);
      if (cmd === 'SETEX') kv.set(key, { value, until: clock + ttl * 1000 });
      const entry = kv.get(key);
      return { ok: true, json: async () => ({ result: cmd === 'SETEX' ? 'OK' : entry?.until > clock ? entry.value : null }) };
    }
    const u = new URL(url); check(['www.pricecharting.com', 'www.sportscardspro.com'].includes(u.hostname), 'only configured provider host');
    calls++;
    if (status !== 200) return { ok: false, status };
    return { ok: true, json: async () => u.pathname === '/api/products' ? { status: 'success', products: [] }
      : { status: 'success', id: u.searchParams.get('id') || '123', 'product-name': 'Pikachu #25', 'console-name': 'Pokemon Base Set', 'loose-price': 1000 } };
  };
  const invoke = async query => {
    let code, body;
    await handler({ method: 'GET', query }, { setHeader() {}, status(c) { code = c; return this; }, json(b) { body = b; } });
    check(timers.size === 0, 'route leaves no timers');
    return { code, body };
  };
  for (const query of [{ name: [] }, { name: 'x', sport: [] }, { name: 'x', brand: 'x'.repeat(101) }]) {
    check((await invoke(query)).code === 400, 'malformed query rejected');
  }
  check(calls === 0, 'invalid input costs no provider call');
  const base = { name: 'Michael Jordan', game: 'sports', variants: '1', year: '1986' };
  for (const facets of [{ sport: 'basketball', brand: 'Fleer' }, { sport: 'baseball', brand: 'Fleer' }, { sport: 'basketball', brand: 'Topps' }]) await invoke({ ...base, ...facets });
  check(calls === 3, 'sport and brand are separate cache identities');
  check((await invoke({ ...base, sport: 'basketball', brand: 'Fleer' })).body.cached === true && calls === 3, 'same facets reuse cache');
  await invoke({ name: 'a|b', set: 'c' }); await invoke({ name: 'a', set: 'b|c' });
  check(calls === 5, 'delimiter-containing fields cannot collide');
  for (const query of [{ pcid: '111' }, { name: 'Pikachu', number: '25' }, { ...base, name: 'Another player' }]) {
    status = 403; const before = calls;
    const first = (await invoke(query)).body, second = (await invoke(query)).body;
    check(first.source === 'pricecharting-error' && first.retryAfterSec === 60 && first.median === null, 'failure is explicit with no invented price');
    check(second.cached === true && calls === before + 1, 'each lookup mode caches denial without retry');
    clock += 61000; status = 200;
    check((await invoke(query)).body.source !== 'pricecharting-error' && calls === before + 2, 'each mode recovers after short cache expiry');
  }
  const { source } = readCoreBundle();
  const a = source.indexOf('  const pcP = fetch('), b = source.indexOf('\n  // Grade opportunity:', a);
  check(a > 0 && b > a, 'active browser pricing boundary found');
  const run = new Function('fetch', 'pcParams', '_clientController', source.slice(a, b) + '; return pcP;');
  let browserCalls = 0;
  const data = await run(async () => { browserCalls++; return { ok: true, json: async () => ({ source: 'pricecharting-error', retryAfterSec: 60 }) }; }, new URLSearchParams({ name: 'fixture' }), new AbortController());
  check(browserCalls === 1 && data.retryAfterSec === 60, 'browser does not repeat a server-cached failure');
} finally {
  Object.assign(globalThis, { fetch: original.fetch, setTimeout: original.setTimeout, clearTimeout: original.clearTimeout });
  Date.now = original.now; console.warn = original.warn;
  for (const [key, value] of Object.entries(priorEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
console.log(`pricing-request-budget: ${checks} passed, 0 failed -- SUITE COMPLETE, exit=0`);
