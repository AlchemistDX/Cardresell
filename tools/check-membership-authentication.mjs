import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { createMembershipAuthenticator } from '../api/_membershipAuthentication.js';
import { createMembershipAccountRoutes } from '../api/_membershipAccountRoutes.js';
import { readFileSync } from 'node:fs';

// Private synthetic keys and a local public-key response only. No Firebase
// account, managed datastore, real token or production authentication bypass.
globalThis.crypto ||= webcrypto;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'synthetic-membership-key' };
const requests = [];
globalThis.fetch = async url => {
  requests.push(url);
  assert.equal(url, 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  return { ok: true, json: async () => ({ keys: [jwk] }) };
};
const seconds = Math.floor(Date.now() / 1000);
const base = { sub: 'firebase-owner-A', aud: 'cardresell-e0329',
  iss: 'https://securetoken.google.com/cardresell-e0329', exp: seconds + 3600,
  iat: seconds, email: 'same@example.invalid', email_verified: true,
  firebase: { sign_in_provider: 'google.com' } };
function token(changes = {}, header = {}) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = encode({ alg: 'RS256', kid: jwk.kid, ...header }) + '.' + encode({ ...base, ...changes });
  return body + '.' + sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url');
}
const authenticate = createMembershipAuthenticator();
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
const rejects = t => assert.rejects(() => authenticate(t), { code: 'authentication_required' });
await test('verified signed Firebase subject is the only returned identity', async () => {
  assert.deepEqual(await authenticate(token()), { uid: base.sub, verified: true, email: base.email });
});
await test('unverified signed Firebase account is rejected', () => rejects(token({ email_verified: false })));
await test('absent verification is rejected', () => rejects(token({ email_verified: undefined })));
await test('same email never merges two Firebase subjects', async () => {
  assert.equal((await authenticate(token({ sub: 'firebase-owner-B' }))).uid, 'firebase-owner-B');
});
await test('wrong audience is rejected without tokeninfo fallback', () => rejects(token({ aud: 'other' })));
await test('wrong issuer is rejected', () => rejects(token({ iss: 'https://accounts.google.com' })));
await test('expired token is rejected', () => rejects(token({ exp: seconds - 1 })));
await test('missing expiry is rejected', () => rejects(token({ exp: undefined })));
await test('nonnumeric expiry is rejected', () => rejects(token({ exp: String(seconds + 3600) })));
await test('missing issued-at is rejected', () => rejects(token({ iat: undefined })));
await test('future issued-at is rejected', () => rejects(token({ iat: seconds + 1000 })));
await test('unexpected JWT algorithm is rejected', () => rejects(token({}, { alg: 'none' })));
await test('numeric subject is rejected', () => rejects(token({ sub: 42 })));
await test('oversized subject is rejected', () => rejects(token({ sub: 'x'.repeat(129) })));
await test('signature tampering is rejected', async () => {
  const parts = token().split('.');
  parts[1] = Buffer.from(JSON.stringify({ ...base, sub: 'victim' })).toString('base64url');
  await rejects(parts.join('.'));
});
await test('unknown signing key fails closed', () => rejects(token({}, { kid: 'unknown' })));
await test('malformed token has sanitized failure', () => rejects('not-a-token'));
await test('rejected identity cannot trigger account reads, bootstrap or customer creation', async () => {
  let calls = 0;
  const forbidden = async () => { calls++; throw new Error('unexpected side effect'); };
  const routes = createMembershipAccountRoutes({ authenticate,
    customers: { get: forbidden, ensure: forbidden }, lifecycle: {}, fulfillment: {},
    commands: {}, balances: forbidden, bootstrap: forbidden });
  for (const method of ['GET', 'POST']) {
    const res = { setHeader() {}, status(n) { this.code = n; return this; }, json(body) { this.body = body; } };
    await routes.account({ method, headers: { authorization: 'Bearer ' + token({ email_verified: false }) },
      body: { action: 'associate' } }, res);
    assert.equal(res.code, 401);
  }
  assert.equal(calls, 0);
});
await test('runtime wires strict auth without flexible email mapping', async () => {
  const source = readFileSync(new URL('../api/_membershipPurchaseRuntime.js', import.meta.url), 'utf8');
  assert.match(source, /const authenticate = createMembershipAuthenticator\(\)/);
  assert.doesNotMatch(source, /verifyTokenFlexible/);
  assert.equal(requests.length, 1);
});
console.log(`${passed} passed, 0 failed`);
