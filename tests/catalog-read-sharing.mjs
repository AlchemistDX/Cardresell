import assert from 'node:assert/strict';
import { getGroups, getProducts, getPrices } from '../api/_tcgcsv.js';

const original = globalThis.fetch;
let checks = 0, providerCalls = 0, reads = 0, writes = 0, mode = 'ok';
const cache = new Map();
const check = (ok, label) => { assert.ok(ok, label); checks++; };
const rows = path => path.endsWith('/groups') ? [{ groupId: 4, name: 'Base Set', abbreviation: 'BS' }]
  : path.endsWith('/products') ? [{ productId: 7, name: 'Pikachu', extendedData: [{ name: 'Number', value: '25' }] }]
  : [{ productId: 7, subTypeName: 'Normal', marketPrice: 10, lowPrice: 9, midPrice: 11, highPrice: 12 }];
try {
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    if (u.hostname.endsWith('.test')) {
      check(u.pathname === '/' && u.search === '' && init.method === 'POST', 'cache data is in POST body, not URL');
      const [command, key, ttl, value] = JSON.parse(init.body);
      const scoped = url + init.headers.Authorization + key;
      if (command === 'GET') reads++;
      if (command === 'SETEX') { writes++; if (mode !== 'cache_down') cache.set(scoped, value); check(ttl > 0, 'cache TTL retained'); }
      return { ok: true, json: async () => mode === 'cache_down' ? { error: 'offline' }
        : { result: command === 'GET' ? cache.get(scoped) || null : 'OK' } };
    }
    check(u.hostname === 'tcgcsv.com', 'only catalog provider called');
    providerCalls++;
    if (mode === 'network') throw new Error('synthetic network failure');
    return { ok: true, json: async () => mode === 'malformed' ? { error: 'not catalog data' }
      : { results: mode === 'large' ? Array.from({ length: 1000 }, (_, i) => ({ productId: i + 1, name: 'Synthetic card '.repeat(12) })) : rows(u.pathname) } };
  };
  for (const [read, mutate, unaffected] of [
    [() => getGroups('https://kv.test', 'fixture', 3), r => { r[0].name = 'changed'; }, r => r[0].name === 'Base Set'],
    [() => getProducts('https://kv.test', 'fixture', 4, 3), r => { r[0].number = 'changed'; }, r => r[0].number === '25'],
    [() => getPrices('https://kv.test', 'fixture', 4, 3), r => { r[7].Normal.market = 999; }, r => r[7].Normal.market === 10],
  ]) {
    cache.clear(); providerCalls = reads = writes = 0;
    const results = await Promise.all(Array.from({ length: 20 }, read));
    check(providerCalls === 1 && reads === 1 && writes === 1, '20 simultaneous reads share one cache lookup/download/write');
    mutate(results[0]); check(unaffected(results[1]), 'caller mutation cannot contaminate another scan');
    check(unaffected(await read()) && providerCalls === 1, 'later read uses persistent cache, not mutated caller state');
  }
  for (const failure of ['network', 'malformed']) {
    cache.clear(); providerCalls = reads = writes = 0; mode = failure;
    const result = await Promise.allSettled(Array.from({ length: 20 }, () => getProducts('https://kv.test', 'fixture', 50, 3)));
    check(result.every(r => r.status === 'rejected') && providerCalls === 1 && writes === 0, failure + ' is shared but never cached as an empty catalog');
    mode = 'ok'; check((await getProducts('https://kv.test', 'fixture', 50, 3)).length === 1 && providerCalls === 2, 'failed shared request is removed and can recover');
  }
  cache.clear(); providerCalls = 0;
  await Promise.all([
    getProducts('https://kv.test', 'fixture', 4, 3), getProducts('https://kv.test', 'other', 4, 3),
    getProducts('https://other.test', 'fixture', 4, 3), getProducts('https://kv.test', 'fixture', 5, 3),
    getProducts('https://kv.test', 'fixture', 4, 1),
  ]);
  check(providerCalls === 5, 'credentials, cache environment, category and set remain separate');
  mode = 'large'; cache.clear();
  const large = await getProducts('https://kv.test', 'fixture', 100, 3);
  check(large.length === 1000 && [...cache.values()][0].length > 100000, 'large product payload is cacheable without an oversized URL');
  mode = 'cache_down'; providerCalls = 0;
  check((await getProducts('https://kv.test', 'fixture', 101, 3)).length === 1, 'cache failure does not discard usable provider data');
  check((await getProducts('https://kv.test', 'fixture', 101, 3)).length === 1 && providerCalls === 2, 'no indefinite in-memory success cache hides outages or stale data');
  mode = 'ok'; providerCalls = 0;
  await Promise.all(Array.from({ length: 140 }, (_, i) => getProducts('', '', 1000 + i, 3)));
  check(providerCalls === 140, 'bounded sharing table does not deny unrelated lookups at capacity');
} finally { globalThis.fetch = original; }
console.log(`catalog-read-sharing: ${checks} passed, 0 failed`);
