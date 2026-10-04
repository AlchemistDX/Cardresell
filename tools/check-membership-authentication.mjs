import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { createMembershipAuthenticator } from '../api/_membershipAuthentication.js';
import { createMembershipPurchaseRoutes } from '../api/_membershipPurchaseRoutes.js';
import { createMembershipAccountRoutes } from '../api/_membershipAccountRoutes.js';
import { readFileSync } from 'node:fs';
import { readMembershipVerification } from '../api/_membershipVerification.js';

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
  assert.match(source, /const normalAuthenticate = createMembershipAuthenticator\(\{/);
  assert.match(source, /resolveVerification: uid => readMembershipVerification\(membershipRedis, uid\)/);
  assert.match(source, /const identity = await normalAuthenticate\(token\)/);
  assert.match(source, /livemode && !publicLaunch && !allowed\.includes\(identity\.uid\)/);
  assert.doesNotMatch(source, /verifyTokenFlexible/);
  assert.equal(requests.length, 1);
});
await test('rejection diagnostics contain fixed categories only, never raw token or errors', async () => {
  const events = [];
  const secret = 'private diagnostic sentinel';
  const auth = createMembershipAuthenticator({ verify: async () => { throw new Error(secret); },
    onReject: reason => events.push(reason) });
  await assert.rejects(() => auth(token()), { code: 'authentication_required' });
  assert.deepEqual(events, ['firebase_verification_failed']);
  assert.ok(!JSON.stringify(events).includes(secret));
});
await test('diagnostic callback failure cannot grant admission', async () => {
  const auth = createMembershipAuthenticator({ onReject: () => { throw Error('unavailable'); } });
  await assert.rejects(() => auth('not-a-token'), { code: 'authentication_required' });
});
await test('existing UID verification admits a signed account without rewriting Firebase claims or stored history', async () => {
  const raw = JSON.stringify({ verifiedAt: new Date((seconds - 3600) * 1000).toISOString() });
  const reads = [];
  const resolveVerification = uid => readMembershipVerification(async command => {
    reads.push(command); return command[1] === 'email_verified:' + base.sub ? raw : null;
  }, uid);
  const auth = createMembershipAuthenticator({ resolveVerification });
  const result = await auth(token({ email_verified: false }));
  assert.equal(result.uid, base.sub);
  assert.equal(result.verified, true);
  assert.equal(result.verificationSource, 'stored_account_verification');
  assert.deepEqual(reads, [['GET', 'email_verified:' + base.sub]]);
  await assert.rejects(() => auth(token({ sub: 'different-owner', email_verified: false })), { code: 'authentication_required' });
});
await test('saved verification cannot bypass signature, audience, expiry or subject validation', async () => {
  let reads = 0;
  const auth = createMembershipAuthenticator({ resolveVerification: async () => {
    reads++; return { verified: true, source: 'stored_account_verification' };
  } });
  for (const jwt of [token({ aud: 'wrong' }), token({ exp: seconds - 1 }), 'not-a-token',
    token({}, { kid: 'unknown' })]) await assert.rejects(() => auth(jwt), { code: 'authentication_required' });
  const parts = token().split('.');
  parts[1] = Buffer.from(JSON.stringify({ ...base, sub: 'victim', email_verified: false })).toString('base64url');
  await assert.rejects(() => auth(parts.join('.')), { code: 'authentication_required' });
  assert.equal(reads, 0);
});
await test('stored verification rejects missing malformed revoked and future records', async () => {
  for (const raw of [null, 'true', '1', '[]', '{}', '{', JSON.stringify({ verifiedAt: 'bad' }),
    JSON.stringify({ verifiedAt: new Date((seconds + 3600) * 1000).toISOString() }),
    JSON.stringify({ verifiedAt: new Date(seconds * 1000).toISOString(), verified: false })]) {
    assert.equal(await readMembershipVerification(async () => raw, base.sub), null);
  }
});
await test('stored verification lookup outage fails closed and cannot create financial side effects', async () => {
  const auth = createMembershipAuthenticator({ resolveVerification: async () => { throw Error('unavailable'); } });
  await assert.rejects(() => auth(token({ email_verified: false })), { code: 'authentication_required' });
});
await test('membership status restores the same saved verification read before response', async () => {
  const source = readFileSync(new URL('../api/pro-status.js', import.meta.url), 'utf8');
  assert.match(source, /await readMembershipVerification\(membershipRedis, userSub\)/);
  assert.match(source, /if \(saved\) \{ emailVerified = true/);
});
await test('email verification action is exposed only after verified identity and completed lookup', async () => {
  const auth = createMembershipAuthenticator({ resolveVerification: async () => null, onReject: () => {} });
  await assert.rejects(() => auth(token({ email_verified: false })), { code: 'authentication_required', action: 'verify_email' });
  for (const jwt of ['malformed', token({ aud: 'wrong' })]) {
    await assert.rejects(() => auth(jwt), error => error.code === 'authentication_required' && !error.action);
  }
  const outage = createMembershipAuthenticator({ resolveVerification: async () => { throw Error('outage'); }, onReject: () => {} });
  await assert.rejects(() => outage(token({ email_verified: false })), error => !error.action);
});
await test('catalogue and checkout retain 401 with only the fixed verification action and no side effects', async () => {
  let calls = 0;
  const routes = createMembershipPurchaseRoutes({ authenticate,
    resolveContext: async () => { calls++; }, controller: { checkout: async () => { calls++; } } });
  for (const [name, method] of [['catalogue', 'GET'], ['checkout', 'POST']]) {
    for (const jwt of [token({ email_verified: false }), 'malformed']) {
      const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
      await routes[name]({ method, headers: { authorization: 'Bearer ' + jwt }, body: {} }, res);
      assert.equal(res.code, 401);
      assert.deepEqual(res.body, { error: 'authentication_required', ...(jwt === 'malformed' ? {} : { action: 'verify_email' }) });
    }
  }
  assert.equal(calls, 0);
});
console.log(`${passed} passed, 0 failed`);
