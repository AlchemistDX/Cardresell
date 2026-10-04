import { readMembershipAccountEmail } from '../api/_membershipAccountEmail.js';
import { createMembershipLivePilot } from '../api/_membershipLivePilot.js';
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
await test('pilot admits only exact provider-verified email and keeps token UID', async () => {
  const pilot = createMembershipLivePilot('["same@example.invalid"]');
  const a = await authenticate(token()), b = await authenticate(token({ sub: 'separate-owner' }));
  assert.equal(pilot(a), true); assert.equal(pilot(b), true);
  assert.notEqual(a.uid, b.uid);
  assert.equal(pilot(await authenticate(token({ email: 'SAME@EXAMPLE.INVALID' }))), true);
  for (const email of ['other@example.invalid', 'same+alias@example.invalid', 's.ame@example.invalid']) {
    assert.equal(pilot(await authenticate(token({ email }))), false);
  }
  assert.equal(createMembershipLivePilot()(a), false);
  assert.equal(pilot({ ...a, verified: false }), false);
  assert.equal(pilot({ ...a, uid: '' }), false);
  const stored = createMembershipAuthenticator({ resolveVerification: async () => ({ verified: true, source: 'stored_account_verification' }) });
  assert.equal(pilot(await stored(token({ email_verified: false }))), false);
});
await test('malformed pilot configuration fails closed', async () => {
  for (const raw of ['null', '{}', '[1]', '["bad"]', '[" same@example.invalid"]', JSON.stringify(Array(6).fill('a@example.invalid'))]) {
    assert.throws(() => createMembershipLivePilot(raw));
  }
});
await test('exact UID-saved email proof admits matching pilot account through billing routes', async () => {
  const pilot = createMembershipLivePilot('["same@example.invalid"]');
  const records = new Map([[base.sub, JSON.stringify({ verifiedAt: new Date((seconds - 60) * 1000).toISOString(),
    email: base.email, via: 'code' })]]);
  const auth = createMembershipAuthenticator({ resolveVerification: uid => readMembershipVerification(
    async () => records.get(uid) ?? null, uid) });
  const admitted = async jwt => {
    const identity = await auth(jwt);
    if (!pilot(identity)) throw Object.assign(Error(), { code: 'membership_access_restricted' });
    return identity;
  };
  const jwt = token({ email_verified: false });
  const identity = await admitted(jwt);
  assert.equal(identity.uid, base.sub);
  assert.equal(identity.authenticatedEmail, base.email);
  assert.equal(identity.verificationEmail, base.email);
  assert.equal(pilot(await auth(token({ email_verified: false, email: 'SAME@EXAMPLE.INVALID' }))), true);
  let bootstrapIdentity, customerOwner, calls = 0;
  const routes = createMembershipAccountRoutes({ authenticate: admitted,
    bootstrap: async (uid, identity) => { bootstrapIdentity = identity; assert.equal(uid, base.sub); },
    customers: { ensure: async uid => { customerOwner = uid; return { state: 'bound', customerId: 'cus_separate' }; } },
    lifecycle: { associate: async input => { calls++; assert.equal(input.owner, base.sub); } } });
  const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await routes.account({ method: 'POST', headers: { authorization: 'Bearer ' + jwt }, body: { action: 'associate' } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.status, 'associated');
  assert.equal(bootstrapIdentity.uid, base.sub); assert.equal(customerOwner, base.sub); assert.equal(calls, 1);
  await assert.rejects(() => admitted(token({ sub: 'other-uid', email_verified: false })), { code: 'authentication_required' });
  assert.equal(pilot(await auth(token({ email: 'different@example.invalid', email_verified: false }))), false);
  records.set(base.sub, JSON.stringify({ verifiedAt: new Date((seconds - 60) * 1000).toISOString(), email: 'different@example.invalid', via: 'code' }));
  assert.equal(pilot(await auth(jwt)), false);
  records.set(base.sub, JSON.stringify({ verifiedAt: new Date((seconds - 60) * 1000).toISOString() }));
  assert.equal(pilot(await auth(jwt)), false);
  records.set(base.sub, JSON.stringify({ verifiedAt: new Date((seconds - 60) * 1000).toISOString(), email: base.email, verified: false }));
  await assert.rejects(() => admitted(jwt), { code: 'authentication_required' });
});
await test('billing access denial is a 403 with no authentication retry or financial calls', async () => {
  let calls = 0;
  const authenticate = async () => { throw Object.assign(Error(), { code: 'membership_access_restricted' }); };
  const purchase = createMembershipPurchaseRoutes({ authenticate, resolveContext: async () => { calls++; },
    controller: { checkout: async () => { calls++; } } });
  const account = createMembershipAccountRoutes({ authenticate, bootstrap: async () => { calls++; } });
  for (const [handler, method] of [[purchase.catalogue, 'GET'], [purchase.checkout, 'POST'],
    [account.account, 'GET'], [account.account, 'POST']]) {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await handler({ method, headers: { authorization: 'Bearer synthetic' }, body: { action: 'associate' } }, res);
    assert.equal(res.code, 403); assert.equal(res.body.error, 'membership_access_restricted');
    assert.equal(res.body.action, undefined);
  }
  assert.equal(calls, 0);
});
await test('legacy missing email is recovered from UID-matched Firebase record before pilot admission', async () => {
  const pilot = createMembershipLivePilot('["same@example.invalid"]');
  const missing = token({ email: undefined, email_verified: false });
  let lookups = 0;
  const auth = createMembershipAuthenticator({
    resolveVerification: async uid => uid === base.sub ? { verified: true, source: 'stored_account_verification', email: base.email } : null,
    resolveAccountEmail: (jwt, uid) => readMembershipAccountEmail(jwt, uid, async (url, options) => {
      lookups++;
      assert.equal(JSON.parse(options.body).idToken, missing);
      assert.match(url, /^https:\/\/identitytoolkit.googleapis.com\/v1\/accounts:lookup\?key=/);
      return { ok: true, json: async () => ({ users: [{ localId: base.sub, providerUserInfo: [{ providerId: 'google.com', email: base.email }] }] }) };
    }),
  });
  const identity = await auth(missing);
  assert.equal(identity.uid, base.sub); assert.equal(identity.authenticatedEmail, base.email);
  assert.equal(pilot(identity), true); assert.equal(lookups, 1);
  await auth(token({ email_verified: false })); assert.equal(lookups, 1);
  await assert.rejects(() => auth(token({ sub: 'other', email: undefined, email_verified: false })));
  assert.equal(lookups, 1);
});
await test('account lookup rejects wrong UID, disabled account, ambiguous provider emails and outage', async () => {
  const read = users => readMembershipAccountEmail('synthetic', base.sub, async () => ({ ok: true, json: async () => ({ users }) }));
  for (const users of [[], [{ localId: 'other', email: base.email }], [{ localId: base.sub, disabled: true, email: base.email }]]) {
    await assert.rejects(() => read(users), /account_email_unavailable/);
  }
  assert.equal(await read([{ localId: base.sub, providerUserInfo: [{ providerId: 'password', email: base.email }] }]), null);
  assert.equal(await read([{ localId: base.sub, providerUserInfo: [
    { providerId: 'google.com', email: base.email }, { providerId: 'google.com', email: 'other@example.invalid' }] }]), null);
  assert.equal(await read([{ localId: base.sub, email: 'other@example.invalid', providerUserInfo: [{ providerId: 'google.com', email: base.email }] }]), 'other@example.invalid');
  await assert.rejects(() => readMembershipAccountEmail('synthetic', base.sub, async () => ({ ok: false })), /account_email_unavailable/);
  const auth = createMembershipAuthenticator({ resolveVerification: async () => ({ verified: true, source: 'stored_account_verification', email: base.email }),
    resolveAccountEmail: async () => { throw Error('upstream'); }, onReject() {} });
  await assert.rejects(() => auth(token({ email: undefined, email_verified: false })), { code: 'authentication_required' });
});
console.log(`${passed} passed, 0 failed`);
