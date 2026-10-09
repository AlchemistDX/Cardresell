import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import handler from '../api/tpl-proxy.js';

// Real sockets and the production eight-second timer. No provider credentials
// or provider calls. Both header stalls and body stalls must terminate.
process.env.CARDSELL_TPL_KEY = 'offline-fixture';
process.env.TPL_BUDGET_ENFORCE = '0';
const realFetch = globalThis.fetch;
const server = createServer((req, res) => {
  if (req.url === '/body') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"data":'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
globalThis.fetch = (url, options) => realFetch(`http://127.0.0.1:${server.address().port}/${new URL(url).searchParams.get('q')}`, options);
try {
  await Promise.all(['body', 'headers'].map(async q => {
    const res = { headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(n) { this.code=n; return this; }, json(v) { this.body=v; return this; }, send(v) { this.body=v; return this; } };
    const start = Date.now();
    await handler({ method: 'GET', query: { path: '/v1/cards/search', q, game: 'pokemon', limit: '20' } }, res);
    assert.equal(res.code, 502, q);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.ok(Date.now() - start < 11000, `${q} exceeded deadline`);
  }));
  console.log('TPL deadline: 6 checks passed against stalled headers and body.');
} finally {
  globalThis.fetch = realFetch;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
