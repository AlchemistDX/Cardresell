// tests/tpl-proxy-offline.mjs
// Offline tests for the TCGPriceLookup proxy contract [CH-3 / R2 + R3].
//
// The upstream is MOCKED. No request reaches api.tcgpricelookup.com, so this
// suite spends no paid quota — which is also the central assertion: a rejected
// request must make ZERO upstream calls.
//
// Context: api/tpl-proxy.js forwarded every query parameter it received to a
// paid provider, with no caller authentication and no usage limit. These tests
// pin the narrow fix and, just as importantly, pin what the fix does NOT claim.

import { completionGuard } from './_complete.mjs';
const { finish: _finish } = completionGuard('tpl-proxy-offline');

import { validateTplRequest, TPL_CONTRACT } from '../api/_tplContract.js';
import handler from '../api/tpl-proxy.js';

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

// ── A mock res that records what the handler did ──────────────────────────────
function mockRes() {
  const r = { statusCode: null, headers: {}, body: null, ended: false };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (o) => { r.body = o; r.ended = true; return r; };
  r.send = (b) => { r.body = b; r.ended = true; return r; };
  r.end = () => { r.ended = true; return r; };
  return r;
}

// ── The upstream mock: counts calls, never touches the network ────────────────
let upstreamCalls = [];
const realFetch = globalThis.fetch;
function installMock({ status = 200, body = '{"cards":[]}', ct = 'application/json' } = {}) {
  upstreamCalls = [];
  globalThis.fetch = async (url, opts) => {
    upstreamCalls.push({ url: String(url), headers: opts?.headers || {} });
    return {
      status,
      headers: { get: (h) => (h.toLowerCase() === 'content-type' ? ct : null) },
      text: async () => body,
    };
  };
}
function restoreFetch() { globalThis.fetch = realFetch; }

process.env.CARDSELL_TPL_KEY = 'test-key-not-a-real-credential';

async function call(query, mockOpts) {
  installMock(mockOpts);
  const res = mockRes();
  await handler({ method: 'GET', query }, res);
  return res;
}

console.log('\nTPL proxy contract [CH-3 / R2 + R3]');

// ── 1. Rejected requests cost NOTHING upstream ───────────────────────────────
// This is the assertion the whole fix exists for.
console.log('\nrejected requests make zero upstream calls');
{
  const cases = [
    ['unknown parameter',            { path: '/v1/cards/search', q: 'Pikachu', game: 'pokemon', _: '1759' }],
    ['unknown parameter (cache-bust shape)', { path: '/v1/cards/search', q: 'Pikachu', cb: Math.random() }],
    ['duplicate parameter',          { path: '/v1/cards/search', q: ['Pikachu', 'Charizard'] }],
    ['duplicate path',               { path: ['/v1/cards/search', '/v1/cards/search'], q: 'Pikachu' }],
    ['path not allowed',             { path: '/v1/admin/keys' }],
    ['lookup path (retired)',        { path: '/v1/cards/lookup', name: 'Pikachu', game: 'pokemon' }],
    ['missing required q',           { path: '/v1/cards/search', game: 'pokemon' }],
    ['limit out of range',           { path: '/v1/cards/search', q: 'Pikachu', limit: '5000' }],
    ['limit non-numeric',            { path: '/v1/cards/search', q: 'Pikachu', limit: 'all' }],
    ['game not a slug',              { path: '/v1/cards/search', q: 'Pikachu', game: 'Pokemon TCG!' }],
    ['empty q',                      { path: '/v1/cards/search', q: '' }],
    ['param on the id path',         { path: '/v1/cards/abc123', q: 'Pikachu' }],
    ['no path at all',               {}],
  ];
  for (const [label, query] of cases) {
    const res = await call(query);
    check(`${label} → 400, zero upstream calls`,
          res.statusCode === 400 && upstreamCalls.length === 0,
          `got status ${res.statusCode} and ${upstreamCalls.length} upstream call(s)`);
    check(`${label} → no-store`,
          res.headers['cache-control'] === 'no-store',
          `got ${res.headers['cache-control']}`);
  }
  restoreFetch();
}

// ── 2. The real client contract still works, unchanged ───────────────────────
// Derived from BOTH clients: production 9aaf326e7 ships js/core.569ff536.js,
// HEAD ships js/core.73a71fac.js. Checking one bundle was an earlier error —
// 66c39922 is outgoing, not deployed.
console.log('\nboth clients\' real call shapes still pass');
{
  const real = [
    ['search limit=100 (both clients)', { path: '/v1/cards/search', q: 'Pikachu', game: 'pokemon', limit: '100' }],
    ['search limit=20 (both clients)',  { path: '/v1/cards/search', q: 'Charizard', game: 'pokemon', limit: '20' }],
    ['card by id (both clients)',       { path: '/v1/cards/abc_123-XY' }],
    ['search without limit',            { path: '/v1/cards/search', q: 'Mew', game: 'pokemon' }],
    ['search without game',             { path: '/v1/cards/search', q: 'Mew' }],
  ];
  for (const [label, query] of real) {
    const res = await call(query);
    check(`${label} → 200, exactly one upstream call`,
          res.statusCode === 200 && upstreamCalls.length === 1,
          `got status ${res.statusCode} and ${upstreamCalls.length} upstream call(s)`);
  }
  restoreFetch();
}

// ── 3. The key travels in a header, never in the URL ─────────────────────────
console.log('\nkey handling');
{
  const res = await call({ path: '/v1/cards/search', q: 'Pikachu', game: 'pokemon', limit: '100' });
  check('exactly one upstream call was made', upstreamCalls.length === 1);
  const c = upstreamCalls[0] || { url: '', headers: {} };
  check('the key is sent as the X-API-Key header',
        c.headers['X-API-Key'] === process.env.CARDSELL_TPL_KEY);
  check('the key never appears in the upstream URL',
        !c.url.includes(process.env.CARDSELL_TPL_KEY),
        'a key in a URL lands in provider logs and in any intermediary');
  check('the upstream URL carries only contracted params',
        c.url === 'https://api.tcgpricelookup.com/v1/cards/search?q=Pikachu&game=pokemon&limit=100',
        `got ${c.url}`);
  restoreFetch();
}

// ── 4. R3 — successes cache, failures do not ─────────────────────────────────
console.log('\nR3: only successes are cacheable');
{
  const ok = await call({ path: '/v1/cards/search', q: 'Pikachu' }, { status: 200 });
  check('200 → public, s-maxage=300',
        String(ok.headers['cache-control']).includes('s-maxage=300'),
        `got ${ok.headers['cache-control']}`);
  restoreFetch();

  for (const status of [400, 401, 404, 429, 500, 503]) {
    const bad = await call({ path: '/v1/cards/search', q: 'Pikachu' }, { status });
    check(`upstream ${status} → no-store`,
          bad.headers['cache-control'] === 'no-store',
          `got ${bad.headers['cache-control']}`);
    check(`upstream ${status} → status passed through`, bad.statusCode === status);
    restoreFetch();
  }
}

// ── 5. Upstream throw → 502, no-store, no key in the body ───────────────────
console.log('\nupstream failure');
{
  upstreamCalls = [];
  globalThis.fetch = async () => { throw new Error('socket hang up'); };
  const res = mockRes();
  await handler({ method: 'GET', query: { path: '/v1/cards/search', q: 'Pikachu' } }, res);
  check('throw → 502', res.statusCode === 502);
  check('throw → no-store', res.headers['cache-control'] === 'no-store');
  check('the key is not in the error body',
        !JSON.stringify(res.body || {}).includes(process.env.CARDSELL_TPL_KEY));
  restoreFetch();
}

// ── 6. Missing configuration fails closed, without calling upstream ─────────
console.log('\nconfiguration');
{
  const saved = process.env.CARDSELL_TPL_KEY;
  delete process.env.CARDSELL_TPL_KEY;
  installMock();
  const res = mockRes();
  await handler({ method: 'GET', query: { path: '/v1/cards/search', q: 'Pikachu' } }, res);
  check('no key configured → 500, zero upstream calls',
        res.statusCode === 500 && upstreamCalls.length === 0);
  process.env.CARDSELL_TPL_KEY = saved;
  restoreFetch();
}

// ── 7. Method restriction ────────────────────────────────────────────────────
console.log('\nmethod restriction');
{
  installMock();
  const post = mockRes();
  await handler({ method: 'POST', query: { path: '/v1/cards/search', q: 'Pikachu' } }, post);
  check('POST → 405, zero upstream calls',
        post.statusCode === 405 && upstreamCalls.length === 0);

  const opt = mockRes();
  await handler({ method: 'OPTIONS', query: {} }, opt);
  check('OPTIONS → 200 preflight, zero upstream calls',
        opt.statusCode === 200 && upstreamCalls.length === 0);
  restoreFetch();
}

// ── 8. What this fix does NOT claim ─────────────────────────────────────────
// Pinned as tests so the overstatement cannot quietly return to the codebase.
console.log('\nthe fix\'s limits, pinned');
{
  // The lookup endpoint's PARAMETERISED form is gone: /v1/cards/lookup used to
  // be its own allow-list entry and is called by neither client. But the bare
  // string still matches the opaque-id pattern — an id and the literal
  // "lookup" are indistinguishable to us, since TPL ids are opaque. So the
  // honest claim is narrower: lookup can no longer be called WITH parameters,
  // which is the only way it was useful.
  check('lookup has no parameterised entry left',
        !TPL_CONTRACT.some((e) => e.match.test('/v1/cards/lookup')
                               && Object.keys(e.params).length > 0));
  check('lookup WITH parameters is rejected',
        validateTplRequest({ path: '/v1/cards/lookup', name: 'Pikachu' }).ok === false);

  // DOCUMENTS CURRENT BEHAVIOUR — this is not a requirement to preserve.
  // Today two different valid queries are two upstream calls, because R2
  // closes the unknown-parameter path without bounding spending and cannot
  // eliminate cache bypass (Vercel keys dynamic responses on the INCOMING
  // request URL). When R4 is wired in, the correct assertions become canonical
  // cache REUSE and budget ENFORCEMENT — see tests/tpl-budget-offline.mjs,
  // which already covers both — and this check should be replaced, not
  // defended.
  installMock();
  await handler({ method: 'GET', query: { path: '/v1/cards/search', q: 'Pikachu' } }, mockRes());
  await handler({ method: 'GET', query: { path: '/v1/cards/search', q: 'Charizard' } }, mockRes());
  check('today, distinct VALID queries each reach the provider (R2 does not bound spending)',
        upstreamCalls.length === 2,
        'if this reads 1, caching arrived — replace this check with R4 reuse/enforcement assertions rather than restoring it');
  restoreFetch();
}

// ── 9. Contract-level unit checks ───────────────────────────────────────────
console.log('\nvalidator units');
{
  const good = validateTplRequest({ path: '/v1/cards/search', q: 'Pikachu', limit: '100' });
  check('valid request returns ok with an upstream query',
        good.ok === true && good.upstreamQuery.get('q') === 'Pikachu');
  check('`path` is never forwarded upstream',
        good.ok === true && !good.upstreamQuery.has('path'));
  const dup = validateTplRequest({ path: '/v1/cards/search', q: ['a', 'b'] });
  check('duplicates are rejected, not collapsed to the first value',
        dup.ok === false && dup.error === 'duplicate parameter');
  check('limit=1 and limit=100 are both accepted (boundaries)',
        validateTplRequest({ path: '/v1/cards/search', q: 'a', limit: '1' }).ok === true &&
        validateTplRequest({ path: '/v1/cards/search', q: 'a', limit: '100' }).ok === true);
  check('limit=0 and limit=101 are rejected (boundaries)',
        validateTplRequest({ path: '/v1/cards/search', q: 'a', limit: '0' }).ok === false &&
        validateTplRequest({ path: '/v1/cards/search', q: 'a', limit: '101' }).ok === false);
  check('a 200-char q is accepted, 201 rejected',
        validateTplRequest({ path: '/v1/cards/search', q: 'x'.repeat(200) }).ok === true &&
        validateTplRequest({ path: '/v1/cards/search', q: 'x'.repeat(201) }).ok === false);
  check('a path-traversal shape is rejected',
        validateTplRequest({ path: '/v1/cards/../../admin' }).ok === false);
  check('a non-object query does not throw',
        validateTplRequest(undefined).ok === false);
}

console.log(`\n${passed} passed, ${failed} failed`);
_finish(passed, failed);

_finish(passed, failed);
