import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { redisCommand } from './_idRedis.mjs';
import { scrydexRequest, normalizeScrydexResponse } from '../api/_scrydexContract.js';
import { scrydexConfig, scrydexKeys, RESERVE, COMPLETE, scrydexKv } from '../api/_scrydexBudget.js';
import { createPokemonProviderHandler } from '../api/pokemon-provider.js';

let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
const kv = (...args) => redisCommand(args);
const now = Date.now();
const env = { SCRYDEX_ENABLED: '1', SCRYDEX_API_KEY: 'fixture-key', SCRYDEX_TEAM_ID: 'fixture-team',
  SCRYDEX_KV_SCOPE: 'isolated-test', SCRYDEX_WINDOW_START: new Date(now - 60000).toISOString(),
  SCRYDEX_WINDOW_END: new Date(now + 3600000).toISOString(), SCRYDEX_REQUEST_CAP: '3',
  SCRYDEX_USER_DAILY_CAP: '2', SCRYDEX_PILOT_UIDS: 'alice,bob', SCRYDEX_PRICES_ENABLED: '1' };
const config = scrydexConfig(env, now);
const card = { id: 'base1-4', name: 'Charizard', number: '4', printed_number: '4/102', language_code: 'EN',
  expansion: { id: 'base1', name: 'Base', printed_total: 102, total: 102, is_online_only: false },
  images: [{ type: 'front', small: 'https://images.scrydex.com/example', large: 'javascript:bad' }],
  variants: [{ name: 'unlimitedHolofoil', prices: [
    { type: 'raw', condition: 'NM', market: 123.5, currency: 'USD' },
    { type: 'raw', condition: 'LP', market: 4000, currency: 'JPY' },
    { type: 'graded', company: 'PSA', grade: '10', market: 2000, currency: 'USD', is_signed: true },
    { type: 'raw', condition: 'NM', market: '123.5', currency: 'USD' },
    { type: 'raw', condition: 'NM', market: null, currency: 'USD' },
    { type: 'mystery', market: 999, currency: 'USD' },
  ] }] };
const exact = scrydexRequest({ id: card.id, prices: '1' });
const normalized = normalizeScrydexResponse({ data: card }, exact, now).data[0];
check(normalized.id === card.id && normalized.printedNumber === '4/102', 'printing identity preserved');
check(normalized.images[0].large === '', 'non-HTTPS images excluded');
check(normalized.variants[0].prices.length === 3, 'invalid prices excluded without fabricating zero');
check(normalized.variants[0].prices[1].currency === 'JPY', 'Japanese price currency preserved');
check(normalized.variants[0].prices[2].type === 'graded' && normalized.variants[0].prices[2].isSigned, 'graded signed price distinct');
check(normalized.variants[0].prices[0].source === null && normalized.variants[0].prices[0].updatedAt === null, 'no invented marketplace or observation date');
check(!('tcgplayer' in normalized), 'no false legacy marketplace attribution');
for (const bad of [{ url: 'https://elsewhere' }, { id: '../secret' }, { id: 'x', name: 'y' },
  { name: 'Pika* OR *' }, { name: 'Pikachu', pageSize: '101' }, { name: ['Pikachu'] },
  { name: 'Pikachu', page: '0' }, { name: 'Pikachu', language: '*' }, { name: 'Pikachu', include: 'prices' }]) {
  assert.throws(() => scrydexRequest(bad)); checks++;
}
const page = scrydexRequest({ name: 'Pikachu', pageSize: '100', page: '2' });
check(new URL(page.url).searchParams.get('page_size') === '100', 'explicit provider page maximum');
check(normalizeScrydexResponse({ data: [], page: 2, page_size: 100, total_count: 201 }, page, now).nextPage === 3, 'pagination retained');
assert.throws(() => normalizeScrydexResponse({ data: { ...card, id: 'base1-5' } }, exact, now)); checks++;
assert.throws(() => normalizeScrydexResponse({ data: [card], page: 1, page_size: 100, total_count: 201 }, page, now)); checks++;
check(normalizeScrydexResponse({ data: card }, scrydexRequest({ id: card.id }), now).data[0].variants[0].prices.length === 0, 'price opt-in enforced on output');

let calls = 0;
const provider = async (url, options) => {
  calls++;
  check(url.startsWith('https://api.scrydex.com/pokemon/v1/cards/'), 'fixed upstream');
  check(options.redirect === 'error' && options.headers['X-Team-ID'] === 'fixture-team', 'server credentials and redirect guard');
  return Response.json({ data: { ...card, id: new URL(url).pathname.split('/').pop() } });
};
const verify = async token => ({ uid: token, emailVerified: token !== 'unverified' });
async function invoke(query = { id: card.id }, user = 'alice', overrides = {}) {
  const handler = createPokemonProviderHandler({ env, verify, kv, fetchFn: provider, ...overrides });
  const res = { headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(n) { this.code=n; return this; }, json(body) { this.body=body; return this; } };
  await handler({ method: 'GET', query, headers: user ? { authorization: `Bearer ${user}` } : {} }, res);
  check(res.headers['Cache-Control'] === 'private, no-store', 'no shared authenticated HTTP caching');
  return res;
}
check((await invoke({}, 'alice', { env: {} })).body.reason === 'disabled', 'default off');
check((await invoke({}, null)).code === 401, 'anonymous blocked');
check((await invoke({}, 'outsider')).code === 403, 'pilot allowlist enforced');
check((await invoke({}, 'unverified')).code === 401, 'unverified blocked');
check((await invoke({ id: card.id, prices: '1' }, 'alice', { env: { ...env, SCRYDEX_PRICES_ENABLED: '0' } })).code === 403, 'prices require separate operator enablement');
check((await invoke()).body.reason === 'uninitialized' && calls === 0, 'missing budget never initializes itself');
await kv('SET', config.budgetKey, '0');
check((await invoke()).code === 200 && calls === 1, 'authenticated pilot lookup succeeds');
check((await invoke()).body.cached === true && calls === 1, 'repeat lookup uses shared cache');
check((await invoke({ id: 'base1-5' })).code === 200 && calls === 2, 'second distinct lookup');
check((await invoke({ id: 'base1-6' })).code === 429 && calls === 2, 'user daily limit enforced');
check((await invoke({ id: 'base1-6' }, 'bob')).code === 200 && calls === 3, 'second user admitted within aggregate cap');
check((await invoke({ id: 'base1-7' }, 'bob')).body.reason === 'budget' && calls === 3, 'global cap enforced');
check((await invoke()).body.cached === true && calls === 3, 'cache still usable at cap');
await kv('DEL', config.budgetKey);
check((await invoke({ id: 'base1-8' })).body.reason === 'uninitialized' && calls === 3, 'deleted budget does not refill');

// Real Lua concurrency, with fresh isolated state and one remaining allowance.
await kv('FLUSHDB'); await kv('SET', config.budgetKey, '2');
const contenders = await Promise.all(Array.from({ length: 20 }, (_, i) => {
  const k = scrydexKeys(config, scrydexRequest({ id: `base1-${i}` }), `user-${i}`, now);
  return kv('EVAL', RESERVE, 5, k.cache, k.lock, k.budget, k.user, k.cooldown, `token-${i}`, 3, 20, config.start, config.end);
}));
check(contenders.filter(r => r[0] === 'reserved').length === 1, '20 simultaneous requests cannot exceed last allowance');
check(await kv('GET', config.budgetKey) === '3', 'exact aggregate accounting');
await kv('FLUSHDB'); await kv('SET', config.budgetKey, '0');
const keys = scrydexKeys(config, exact, 'alice', now);
const reserve = token => kv('EVAL', RESERVE, 5, keys.cache, keys.lock, keys.budget, keys.user, keys.cooldown, token, 100, 100, config.start, config.end);
const same = await Promise.all(Array.from({ length: 20 }, (_,i) => reserve(String(i))));
check(same.filter(r => r[0] === 'reserved').length === 1 && same.filter(r => r[0] === 'busy').length === 19, 'cross-worker duplicate suppression');
check(await kv('EVAL', COMPLETE, 2, keys.lock, keys.cache, 'wrong-owner', 'bad', 86400) === 0, 'late/wrong worker cannot release lock or write cache');

await kv('FLUSHDB'); await kv('SET', config.budgetKey, '0');
check((await invoke({}, 'alice', { kv: async () => { throw new Error('offline'); } })).code === 400, 'invalid query refused before storage');
check((await invoke({ id: card.id }, 'alice', { kv: async () => { throw new Error('offline'); } })).body.reason === 'storage', 'storage outage fails closed');
check((await invoke({ id: card.id }, 'alice', { fetchFn: async () => new Response('', { status: 429 }) })).code === 502, 'provider throttle is not empty successful search');
check(await kv('GET', config.budgetKey) === '1', 'uncertain/failed provider call retains allowance');
check((await invoke({ id: 'base1-5' })).body.reason === 'cooldown', 'provider throttle pauses new paid calls');
await kv('DEL', keys.cooldown);
await kv('SET', config.budgetKey, 'bad');
check((await invoke()).body.reason === 'uninitialized', 'corrupt budget fails closed');
check((await invoke({}, 'alice', { env: { ...env, SCRYDEX_WINDOW_END: new Date(now - 1).toISOString() } })).body.reason === 'configuration', 'expired pilot window blocks');
check(scrydexKv({ KV_REST_API_URL: 'general', KV_REST_API_TOKEN: 'general' }) === null, 'no implicit shared database fallback');

await kv('FLUSHDB'); await kv('SET', config.budgetKey, '0');
let uncertainCalls = 0;
const lostReservation = async (...args) => {
  const result = await kv(...args);
  if (args[0] === 'EVAL' && args[1] === RESERVE) throw new Error('lost reservation response');
  return result;
};
check((await invoke({ id: card.id }, 'alice', { kv: lostReservation, fetchFn: async () => { uncertainCalls++; } })).body.reason === 'storage', 'lost reservation reply blocks provider call');
check(uncertainCalls === 0 && await kv('GET', config.budgetKey) === '1', 'ambiguous Redis commit cannot spend twice');
await kv('FLUSHDB'); await kv('SET', config.budgetKey, '0');
check((await invoke({ id: card.id }, 'alice', { fetchFn: async () => Response.json({ data: { ...card, id: 'wrong-printing' } }) })).code === 502, 'wrong printing rejected through actual handler');
const noPriceKeys = scrydexKeys(config, scrydexRequest({ id: card.id }), 'alice', now);
check(await kv('GET', noPriceKeys.cache) === null, 'malformed provider identity never cached');
await kv('FLUSHDB'); await kv('SET', config.budgetKey, '0');
check((await invoke({ id: card.id }, 'alice', { kv: async (...args) => {
  if (args[0] === 'EVAL' && args[1] === COMPLETE) throw new Error('cache write failed');
  return kv(...args);
} })).code === 200, 'cache write failure preserves successful result without repeat paid request');
check(await kv('GET', config.budgetKey) === '1', 'cache failure retains consumed allowance');

// Real transport: headers arrive but JSON never finishes; deadline must abort
// the body rather than merely covering connection establishment.
await kv('FLUSHDB'); await kv('SET', config.budgetKey, '0');
const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"data":'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const started = Date.now();
  const result = await invoke({ id: card.id }, 'alice', { timeoutMs: 80,
    fetchFn: (_url, options) => fetch(`http://127.0.0.1:${server.address().port}`, options) });
  check(result.code === 502 && Date.now() - started < 1500, 'stalled response body deadline');
  check(await kv('GET', config.budgetKey) === '1', 'timeout never refunds uncertain provider request');
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
console.log(`Scrydex pilot: ${checks} checks passed; isolated Redis and local HTTP only.`);
process.exit(0);
