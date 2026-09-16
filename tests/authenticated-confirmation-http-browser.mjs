/**
 * OFFLINE authenticated HTTP + real picker acceptance.
 * Real production Firebase signature verifier, tier, scan/debit handlers, Lua,
 * HTTP server and shipped picker. Synthetic RSA issuer/JWKS, account, catalogue
 * and vision; browser session bootstrap is a fixture, NOT normal Firebase login.
 * No managed account, Safari, provider accuracy or Preview-isolation claim.
 */
import { register } from 'node:module';
import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { harness } from './_assert.mjs';
import { redisStore, redisRest } from './_idRedis.mjs';

register(new URL('./_authenticatedBillingLoader.mjs', import.meta.url));
globalThis.crypto ||= webcrypto;
process.env.KV_REST_API_URL = 'https://offline-auth-billing.invalid';
process.env.KV_REST_API_TOKEN = 'synthetic-not-a-credential';
process.env.XIMILAR_API_TOKEN = 'synthetic-not-a-credential';
// Only the isolated test process: no environment file is read or changed.
process.env.STRIPE_SECRET_KEY = '';
const scan = (await import('../api/scan.js')).default;
const debit = (await import('../api/scan-debit-id.js')).default;
const { check, done } = harness('authenticated-confirmation-http-browser');
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const EVIDENCE = process.env.CR_AUTH_HTTP_EVIDENCE || '/home/user/workspace/authenticated-confirmation-http-evidence';
mkdirSync(EVIDENCE, { recursive: true });
const UID = 'offline-authenticated-confirmation';
const EMAIL = 'offline-authenticated@example.test';
const stamp = new Date().toISOString().slice(0, 7).replace('-', '_');
const FREE = `scans:${UID}:id_free_used_${stamp}`, PAID = `scans:${UID}:id_paid_left`;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'offline-rsa', alg: 'RS256' };
function jwt(subject = UID) {
  const now = Math.floor(Date.now() / 1000);
  const enc = x => Buffer.from(JSON.stringify(x)).toString('base64url');
  const input = enc({ alg: 'RS256', kid: jwk.kid }) + '.' + enc({
    aud: 'cardresell-e0329', iss: 'https://securetoken.google.com/cardresell-e0329',
    sub: subject, email: subject === UID ? EMAIL : 'other-offline@example.test',
    email_verified: true, iat: now, exp: now + 3600,
    firebase: { sign_in_provider: 'password' },
  });
  return input + '.' + sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');
}
const token = jwt(); // Never write the JWT, signing key or auth headers to evidence.
const catalogue = Array.from({ length: 9 }, (_, i) => ({
  id: `set${i}-58`, name: 'Pikachu', number: '58', set: { id: `set${i}`, name: `set${i}` },
  rarity: 'Common', images: { small: '', large: '' },
  tcgplayer: { prices: { normal: { market: i + 1 } } },
}));
let store = redisStore(), commands = [], completed = [], attempts = [], blocked = [], jwksReads = 0;
const nativeFetch = globalThis.fetch;
let origin;
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(String(input?.url || input));
  if (u.origin === process.env.KV_REST_API_URL) return redisRest(input, init, commands);
  if (u.href === 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com') {
    jwksReads++; return Response.json({ keys: [jwk] });
  }
  if (u.hostname === 'oauth2.googleapis.com') return Response.json({ error: 'invalid_token' }, { status: 401 });
  if (u.hostname === 'api.pokemontcg.io') return Response.json({ data: catalogue });
  if (u.origin === origin) return nativeFetch(input, init);
  blocked.push(u.hostname); throw new Error('offline egress denied'); // no raw URLs/tokens
};
globalThis.__STUB = { ximilar: { cardInfo: { card_type: 'pokemon', card_name: 'Pikachu', card_number: '58' } } };
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/scan' || pathname === '/api/scan-debit-id') {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 100000) throw new Error('body_limit'); }
      const body = JSON.parse(raw || '{}');
      const record = { path: pathname, body, status: null };
      attempts.push(record);
      let status = 200;
      await (pathname === '/api/scan' ? scan : debit)({
        method: req.method, headers: req.headers, body,
      }, {
        setHeader: (k, v) => res.setHeader(k, v),
        status(n) { status = n; return this; },
        json(payload) {
          // Billing has completed before the actual HTTP response is sent.
          record.status = status; completed.push(record);
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload)); return this;
        },
      });
      return;
    }
    if (pathname.startsWith('/api/')) { res.writeHead(503); res.end('{}'); return; }
    const file = resolve(ROOT, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(ROOT + '/')) throw new Error('path');
    const content = readFileSync(file);
    res.setHeader('Content-Type', extname(file) === '.js' ? 'application/javascript' : 'text/html');
    res.end(content);
  } catch (_) { if (!res.headersSent) res.writeHead(500); res.end('{}'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
origin = `http://127.0.0.1:${server.address().port}`;
const post = async (path, body, auth = token) => {
  const r = await nativeFetch(origin + path, { method: 'POST', headers: {
    authorization: 'Bearer ' + auth, 'content-type': 'application/json',
  }, body: JSON.stringify(body) });
  return { status: r.status, payload: await r.json() };
};
const bodyFor = p => ({ confirmation_id: p.confirmation_id, candidate_set: p.candidate_set,
  scan_id: p.scan_id, mode: 'identify', candidate: p.identity_resolution.all_candidates[6] });
function reset() {
  store = redisStore(); commands = []; completed = []; attempts = [];
  // Real verified-free entitlement table: five monthly IDs, four already used.
  store.set(`email_verified:${UID}`, '1'); store.set(FREE, '4'); store.set(PAID, '1');
}
async function offer() {
  const r = await post('/api/scan', { mode: 'identify', mimeType: 'image/jpeg',
    imageBase64: Buffer.from('synthetic-jpeg').toString('base64') });
  check('real authenticated scan returns a full server-issued offer', r.status === 200
    && r.payload.needs_confirmation && r.payload.identity_resolution.all_candidates.length === 9);
  check('offer refunds original free bucket without touching paid', store.get(FREE) === '4' && store.get(PAID) === '1');
  return r.payload;
}
const { chromium, devices } = (await import('/home/user/node_modules/playwright/index.js')).default;
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
let dropOnce = false, lostCompletion = false, draftWrites = 0;
await context.route('**/*', async route => {
  const req = route.request(), u = new URL(req.url());
  const json = x => route.fulfill({ contentType: 'application/json', body: JSON.stringify(x) });
  if (u.origin === origin && u.pathname === '/api/scan-debit-id') {
    // Forward exactly once through real HTTP, await complete server response,
    // then suppress delivery. No automatic transport retry or module discard.
    const response = await route.fetch({ maxRetries: 0 });
    if (dropOnce) {
      dropOnce = false;
      lostCompletion = response.status() === 200 && completed.at(-1)?.status === 200
        && store.get(FREE) === '5';
      await response.dispose();
      return route.abort('failed');
    }
    return route.fulfill({ response });
  }
  if (u.hostname === 'api.pokemontcg.io') return json({ data: catalogue });
  if (u.origin === origin && u.pathname === '/api/pro-status') return json({ tier: 'free', isPro: false });
  if (u.origin === origin && u.pathname.startsWith('/api/')) {
    if (/draft/.test(u.pathname) && req.method() !== 'GET') draftWrites++;
    return json({ ok: false, data: [] });
  }
  if (u.origin === origin) return route.continue();
  return route.abort('blockedbyclient');
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
async function show(payload) {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window._renderIdentityConfirmation === 'function');
  await page.evaluate(({ payload, token, uid, email }) => {
    localStorage.clear();
    // Explicit OFFLINE browser session fixture; backend must verify its JWT.
    window.googleUser = { sub: uid, email }; window._googleIdToken = token;
    document.getElementById('scanOverlay').style.display = 'flex';
    _renderIdentityConfirmation(payload, document.getElementById('scanStatus'), document.getElementById('scanResult'), null);
  }, { payload, token, uid: UID, email: EMAIL });
}
const pick = async () => {
  await page.getByTestId('identity-more').click();
  await page.locator('[data-candidate-set="set6"]').click();
};
const settled = () => page.waitForFunction(() => window._scanCandidateDebitPending === false);
const noSuccess = () => page.evaluate(() =>
  !window._pendingIdScanCard && !window._lastIdentifiedCard
  && !localStorage.getItem('cr:lastCard:v1:ident')
  && document.getElementById('scanSuccessBadge').style.display === 'none');
const evidence = [];
const noStats = name => check(`${name}: zero successful scan records and stats writes`,
  !commands.some(c => /^(scan:|stats:searches:)/.test(c.key)));
try {
  reset();
  const invalid = await post('/api/scan', { mode: 'identify' }, token.slice(0, -12) + 'invalidXXXXX');
  check('tampered signature denied by real verifier over HTTP', invalid.status === 401);
  check('invalid authentication causes no billing command', !commands.some(c => c.cmd === 'eval'));
  reset();
  let p = await offer();
  check('normal verifier side effect is observed and owner-bound', store.get(`uid_by_email:${EMAIL}`) === UID);
  await show(p); await page.getByTestId('identity-cancel').click();
  check('cancel sends zero accept HTTP requests', !attempts.some(x => x.path === '/api/scan-debit-id'));
  check('cancel preserves free and paid balances and no success', store.get(FREE) === '4' && store.get(PAID) === '1' && await noSuccess());
  noStats('cancel');
  evidence.push({ name: 'cancel', freeDelta: 0, paidDelta: 0 });

  reset(); p = await offer(); await show(p);
  check('seventh identity absent from shortlist', await page.locator('[data-candidate-set="set6"]').count() === 0);
  await pick(); await settled();
  await page.waitForFunction(() => document.getElementById('cardMetaEl').textContent.includes('set6'));
  check('real picker accepted seventh identity using actual authenticated HTTP', /set6.*#58/.test(await page.locator('#cardMetaEl').textContent()));
  check('one free debit, no paid merge', store.get(FREE) === '5' && store.get(PAID) === '1');
  const acceptedBytes = store.get(`id_billing:${p.confirmation_id}`);
  check('acceptance produces exactly the offered accepted journal', JSON.parse(acceptedBytes).state === 'accepted');
  const replay = await Promise.all(Array.from({ length: 6 }, () => post('/api/scan-debit-id', bodyFor(p))));
  check('six concurrent authenticated duplicates replay one recorded result', replay.every(r => r.status === 200
    && r.payload.pickedCard.set_name === 'set6') && store.get(FREE) === '5' && store.get(PAID) === '1');
  check('duplicate replay preserves exact accepted journal bytes', store.get(`id_billing:${p.confirmation_id}`) === acceptedBytes);
  check('other valid signed owner cannot accept/replay receipt', (await post('/api/scan-debit-id', bodyFor(p), jwt('offline-other-owner'))).status === 409);
  noStats('accept and duplicates');
  await page.screenshot({ path: EVIDENCE + '/accepted-seventh.png' });
  evidence.push({ name: 'accept-and-concurrent-replay', freeDelta: -1, paidDelta: 0, duplicateResponses: 6 });

  reset(); p = await offer(); await show(p); dropOnce = true; await pick(); await settled();
  check('actual HTTP response suppressed only after server returned committed success', lostCompletion);
  check('lost response shows no success or persisted identity', await noSuccess());
  check('actual browser retry is visible', await page.getByTestId('identity-retry').isVisible());
  const first = attempts.filter(r => r.path === '/api/scan-debit-id');
  check('interceptor forwarded first request exactly once', first.length === 1);
  await page.getByTestId('identity-retry').click(); await settled();
  await page.waitForFunction(() => document.getElementById('scanOverlay').style.display === 'none'
    && document.getElementById('cardMetaEl').textContent.includes('set6'));
  const retry = attempts.filter(r => r.path === '/api/scan-debit-id');
  check('real retry sends byte-equivalent receipt and selection over HTTP', retry.length === 2
    && JSON.stringify(retry[0].body) === JSON.stringify(retry[1].body));
  check('HTTP loss then retry consumes only one free and zero paid credits', store.get(FREE) === '5' && store.get(PAID) === '1');
  check('retry resolves same seventh identity', /set6.*#58/.test(await page.locator('#cardMetaEl').textContent()));
  noStats('committed loss and retry');
  evidence.push({ name: 'committed-HTTP-loss-retry', freeDelta: -1, paidDelta: 0, attempts: retry.length });

  reset(); p = await offer(); store.set(FREE, '5'); store.set(PAID, '0'); await show(p);
  const pending = store.get(`id_billing:${p.confirmation_id}`);
  await pick(); await settled();
  check('actual depleted-entitlement HTTP request returns 402', completed.at(-1)?.status === 402);
  check('rejected debit preserves pending journal and depleted balances', store.get(`id_billing:${p.confirmation_id}`) === pending
    && store.get(FREE) === '5' && store.get(PAID) === '0');
  check('actual 402 produces no success, accepted persistence or draft write', await noSuccess() && draftWrites === 0);
  check('ambiguous confirmation creates zero successful scan records or stats', !commands.some(c => /^(scan:|stats:searches:)/.test(c.key)));
  check('real JWKS verification was exercised', jwksReads > 0);
  check('no unexpected server egress, including Stripe', blocked.length === 0);
  check('no browser exceptions', pageErrors.length === 0, pageErrors.join(' | '));
  evidence.push({ name: 'rejected-debit', status: 402, acceptedRecords: 0, successfulScanRecords: 0, statsWrites: 0, draftWrites });
  writeFileSync(EVIDENCE + '/evidence.json', JSON.stringify({
    scope: 'OFFLINE real signature verification + real handlers over HTTP + real picker; synthetic issuer/session/vision/catalogue; NOT managed normal-auth or physical Safari',
    cases: evidence, stripeRequests: 0, jwksReads, pageErrors,
  }, null, 2));
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
  globalThis.fetch = nativeFetch;
}
done();
