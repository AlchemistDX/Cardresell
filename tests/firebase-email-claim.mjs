// Actual route + cryptographic verifier; synthetic keys and in-memory HTTP
// responses only. No Firebase account, email, managed store or live grant.
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
globalThis.crypto ||= webcrypto;
process.env.KV_REST_API_URL = 'https://claim-fixture.upstash.io';
process.env.KV_REST_API_TOKEN = 'synthetic';
delete process.env.TURNSTILE_SECRET_KEY;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'claim-fixture' };
const now = Math.floor(Date.now() / 1000);
const claims = { sub: 'claim-owner', aud: 'cardresell-e0329',
  iss: 'https://securetoken.google.com/cardresell-e0329', iat: now, exp: now + 3600,
  email: 'fixture@example.invalid', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
const token = changes => {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = encode({ alg: 'RS256', kid: jwk.kid }) + '.' + encode({ ...claims, ...changes });
  return body + '.' + sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url');
};
let writes = [], failure = null;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  if (url.href === 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com') {
    return Response.json({ keys: [jwk] });
  }
  assert.equal(url.origin, 'https://claim-fixture.upstash.io');
  const args = url.pathname.slice(1).split('/').map(decodeURIComponent);
  if (args[0] === 'get') return Response.json({ result: '1' }); // Already claimed: no new credit award.
  writes.push(args);
  if (args[1]?.startsWith('email_verified:')) {
    if (failure === 'network') throw Error('synthetic transport failure');
    if (failure === 'http') return Response.json({ error: 'unavailable' }, { status: 503 });
    if (failure === 'redis') return Response.json({ error: 'synthetic Redis failure' });
    if (failure === 'missing') return Response.json({});
  }
  return Response.json({ result: 'OK' });
};
const { default: handler } = await import('../api/verify-claim-firebase.js');
async function invoke(changes = {}) {
  writes = [];
  const res = { setHeader() {}, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: 'POST', headers: { authorization: 'Bearer ' + token(changes) } }, res);
  return res;
}
let passed = 0;
for (const value of [false, undefined, 'true', 1]) {
  const result = await invoke({ email_verified: value });
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.code, 'not_verified');
  assert.ok(!writes.some(x => x[1]?.startsWith('email_verified:')));
  passed++;
}
for (let i = 0; i < 2; i++) {
  const result = await invoke();
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.verified, true);
  assert.equal(result.body.bonusGranted, false);
  const saved = writes.find(x => x[1] === 'email_verified:claim-owner');
  assert.equal(JSON.parse(saved[2]).email, 'fixture@example.invalid');
  assert.ok(!writes.some(x => /^(scans:|signup_bonus:|email_bonus_claimed:)/.test(x[1])));
  passed++;
}
for (failure of ['network', 'http', 'redis', 'missing']) {
  const result = await invoke();
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.code, 'verification_unavailable');
  assert.ok(!result.body.verified && !result.body.bonusGranted);
  passed++;
}
console.log(`Firebase email claim: ${passed} passed, 0 failed -- SUITE COMPLETE, exit=0`);
