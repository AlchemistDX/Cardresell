import assert from 'node:assert/strict';

const original = { fetch, setTimeout, clearTimeout, warn: console.warn, now: Date.now,
  kvUrl: process.env.KV_REST_API_URL, kvToken: process.env.KV_REST_API_TOKEN };
let cases = 0, clock = 1791560000000, calls = 0, behavior = 'success';
const kv = new Map(), timers = new Set();
const html = Array.from({ length: 12 }, (_, i) => `<li class="s-item"><span class="s-item__title">Fixture card ${i}</span><span class="s-item__price">$10.00</span><a href="https://www.ebay.com/itm/${i}"></a></li>`).join('');
let sequence = 0;
const fresh = async () => (await import(`../api/ebay-sold.js?fixture=${sequence++}`)).default;
async function invoke(handler, query = { q: 'Fixture card' }) {
  let status, body;
  const res = { setHeader() {}, status(s) { status = s; return this; }, json(b) { body = b; }, end() {} };
  await handler({ method: 'GET', query }, res);
  assert.equal(timers.size, 0, 'all timers cleared');
  return { status, body };
}
try {
  process.env.KV_REST_API_URL = 'https://kv.example.test'; process.env.KV_REST_API_TOKEN = 'fixture';
  Date.now = () => clock; console.warn = () => {};
  globalThis.setTimeout = fn => { const t = { fn }; timers.add(t); return t; };
  globalThis.clearTimeout = t => timers.delete(t);
  const stalled = signal => new Promise((_, reject) => {
    assert.equal(timers.size, 1);
    signal.addEventListener('abort', () => reject(Object.assign(new Error('fixture'), { name: 'AbortError' })));
    [...timers][0].fn();
  });
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    if (u.hostname === 'kv.example.test') {
      if (behavior === 'kv_stall') return { ok: true, json: () => stalled(init.signal) };
      const [cmd, key, ttl, value] = u.pathname.slice(1).split('/').map(decodeURIComponent);
      if (cmd === 'setex') kv.set(key, { value, until: clock + Number(ttl) * 1000 });
      const entry = kv.get(key);
      return { ok: true, json: async () => ({ result: cmd === 'setex' ? 'OK' : entry?.until > clock ? entry.value : null }) };
    }
    assert.equal(u.hostname, 'www.ebay.com'); calls++;
    assert.equal(init.headers['User-Agent'], 'CardResell/1.0 (+https://cardresell.org)');
    if (behavior === 'challenge') return { ok: true, text: async () => '<h1>Pardon our interruption</h1>' };
    if (behavior === 'grades') return { ok: true, text: async () => ['PSA-9', 'PSA  9', 'PSA 9.5', 'Raw card']
      .map(t => `<li class="s-item"><span class="s-item__title">Fixture ${t}</span><span class="s-item__price">$10.00</span></li>`).join('') };
    if (behavior === 'body_stall') return { ok: true, text: () => stalled(init.signal) };
    if (behavior === '403' || behavior === '429') return { ok: false, status: Number(behavior) };
    if (behavior === 'network') throw new Error('private upstream message');
    return { ok: true, text: async () => html };
  };
  let handler = await fresh();
  for (const query of [{ q: ['a', 'b'] }, { q: 'a', grade: [] }, { q: 'a', limit: [] }, { q: 'x'.repeat(201) }, {}]) {
    assert.equal((await invoke(handler, query)).status, 400); cases++;
  }
  assert.equal(calls, 0);
  const first = (await invoke(handler, { q: 'Fixture card', tcgMarket: '10' })).body;
  const second = (await invoke(handler, { q: 'Fixture card', tcgMarket: '1000' })).body;
  assert.equal(calls, 1, 'reuse comps rather than paying latency for each comparison price');
  assert.equal(second.cached, true);
  assert.equal(first.confidenceScore - second.confidenceScore, 15, 'confidence must use the current market comparison');
  assert.ok(!('_prices' in first) && !('_prices' in second)); cases++;
  assert.equal((await invoke(handler, { q: 'clamped', limit: '-10' })).body.count, 1); cases++;
  const beforeGrade = calls;
  await invoke(handler, { q: 'Fixture card PSA 10' });
  const graded = (await invoke(handler, { q: 'Fixture card', grade: 'PSA 10' })).body;
  assert.equal(calls - beforeGrade, 2, 'raw/grade filters must not share a cache entry');
  assert.equal(graded.count, 0); cases++;
  behavior = 'grades';
  assert.equal((await invoke(handler, { q: 'grade filtering', grade: 'PSA 9' })).body.count, 2, 'PSA 9 excludes PSA 9.5; accepts spaces/hyphen');
  assert.equal((await invoke(handler, { q: 'grade filtering' })).body.count, 1, 'raw comps exclude hyphenated slabs');
  cases++;
  for (const [failure, seconds] of [['403', 900], ['challenge', 900], ['429', 300], ['network', 30], ['body_stall', 30]]) {
    clock += 1000000; kv.clear(); handler = await fresh(); behavior = failure;
    const before = calls;
    const failed = (await invoke(handler)).body;
    assert.equal(failed.available, false);
    assert.equal(failed.median, null);
    assert.equal(failed.retryAfterSec, seconds);
    assert.match(failed.confidenceReasons[0], /unavailable/);
    assert.ok(failed.searchUrl.startsWith('https://www.ebay.com/'));
    assert.ok(!('error' in failed));
    await invoke(handler, { q: 'another card' });
    await invoke(await fresh(), { q: 'third card' });
    assert.equal(calls - before, 1, 'cooldown covers different cards and cold instances');
    clock += seconds * 1000 + 1; behavior = 'success';
    assert.equal((await invoke(handler)).body.count, 12);
    assert.equal(calls - before, 2, 'retry resumes after bounded cooldown'); cases++;
  }
  clock += 1000000; behavior = 'kv_stall'; handler = await fresh();
  assert.equal((await invoke(handler)).body.count, 12, 'cache body timeout cannot hang pricing'); cases++;
} finally {
  Object.assign(globalThis, { fetch: original.fetch, setTimeout: original.setTimeout, clearTimeout: original.clearTimeout });
  Date.now = original.now; console.warn = original.warn;
  for (const [key, value] of [['KV_REST_API_URL', original.kvUrl], ['KV_REST_API_TOKEN', original.kvToken]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
console.log(`ebay-sold-resilience: ${cases} passed, 0 failed`);
