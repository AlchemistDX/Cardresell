import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { redisCommand as redis } from './_idRedis.mjs';
import { createEbaySellerConsent } from '../api/_ebaySellerConsent.js';

let checks = 0;
const check = (name, actual, expected) => {
  assert.deepEqual(actual, expected, name); checks++; console.log('✓ ' + name);
};
const rejects = async (name, action, code) => {
  await assert.rejects(action, { code }, name); checks++; console.log('✓ ' + name);
};
const config = { environment: 'sandbox', clientId: 'test-client', ruName: 'test-RuName' };
const owner = { ownerId: 'test-owner', sessionNonce: randomBytes(32).toString('base64url') };
const adapter = createEbaySellerConsent({ command: redis, config });
const stateOf = result => new URL(result.authorizationUrl).searchParams.get('state');
const keyOf = state => 'ebay:seller:consent:v1:' + createHash('sha256').update(state).digest('hex');
const fresh = async () => stateOf(await adapter.begin(owner));

try {
  const result = await adapter.begin(owner), url = new URL(result.authorizationUrl);
  const state = stateOf(result), key = keyOf(state);
  check('fixed sandbox consent host', url.origin + url.pathname, 'https://auth.sandbox.ebay.com/oauth2/authorize');
  check('RuName and minimum inventory scope', [...url.searchParams.keys()].sort(), ['client_id','redirect_uri','response_type','scope','state']);
  check('eBay registered redirect name', url.searchParams.get('redirect_uri'), config.ruName);
  check('seller inventory scope', url.searchParams.get('scope'), 'https://api.ebay.com/oauth/api_scope/sell.inventory');
  check('authorization code grant', url.searchParams.get('response_type'), 'code');
  check('state carries 256 random bits', Buffer.from(state, 'base64url').length, 32);
  check('ten-minute intent TTL', result.expiresInSeconds, 600);
  const ttl = await redis(['PTTL', key]);
  check('Redis enforces TTL', ttl > 0 && ttl <= 600000, true);
  const stored = await redis(['GET', key]);
  check('no raw identity or browser/OAuth secrets in store', [owner.ownerId, owner.sessionNonce, state].some(v => stored.includes(v) || key.includes(v)), false);
  check('only a versioned binding digest is stored', Object.keys(JSON.parse(stored)).sort(), ['binding','v']);
  await rejects('wrong owner cannot claim', () => adapter.consume({ ...owner, ownerId: 'other' }, state), 'INVALID_CONSENT_STATE');
  await rejects('another browser cannot claim', () => adapter.consume({ ...owner, sessionNonce: randomBytes(32).toString('base64url') }, state), 'INVALID_CONSENT_STATE');
  check('failed ownership checks preserve original intent', await redis(['GET', key]), stored);
  for (const change of [{ environment: 'production' }, { clientId: 'changed' }, { ruName: 'changed' }]) {
    const other = createEbaySellerConsent({ command: redis, config: { ...config, ...change } });
    await rejects('config binding rejects ' + Object.keys(change)[0], () => other.consume(owner, state), 'INVALID_CONSENT_STATE');
  }
  const claim = await adapter.consume(owner, state);
  check('valid owner claims sandbox configuration', claim.environment, 'sandbox');
  check('successful claim deletes intent', await redis(['GET', key]), null);
  await rejects('state replay refused', () => adapter.consume(owner, state), 'INVALID_CONSENT_STATE');

  const concurrent = await fresh();
  const replies = await Promise.allSettled(Array.from({ length: 20 }, () => adapter.consume(owner, concurrent)));
  check('20 concurrent callbacks have exactly one winner', replies.filter(r => r.status === 'fulfilled').length, 1);
  check('all losing callbacks refuse exchange', replies.filter(r => r.status === 'rejected').every(r => r.reason.code === 'INVALID_CONSENT_STATE'), true);

  for (const mode of ['expired', 'corrupt', 'persistent', 'excess-ttl']) {
    const s = await fresh(), k = keyOf(s);
    if (mode === 'expired') await redis(['PEXPIRE', k, '-1']);
    if (mode === 'corrupt') await redis(['SET', k, '{broken', 'EX', 600]);
    if (mode === 'persistent') await redis(['PERSIST', k]);
    if (mode === 'excess-ttl') await redis(['EXPIRE', k, 900]);
    const before = await redis(['GET', k]);
    await rejects(mode + ' record refuses exchange', () => adapter.consume(owner, s), 'INVALID_CONSENT_STATE');
    check(mode + ' refusal preserves bytes', await redis(['GET', k]), before);
  }
  for (const state of ['', '../bad', null, 'a'.repeat(1000)]) {
    await rejects('invalid state shape', () => adapter.consume(owner, state), 'INVALID_CONSENT_STATE');
  }
  let calls = 0;
  const noStore = createEbaySellerConsent({ command: async () => { calls++; throw Error('secret-provider-error'); }, config });
  await rejects('missing auth context fails before storage', () => noStore.begin({ ownerId: owner.ownerId }), 'INVALID_CONTEXT');
  check('invalid context makes no store request', calls, 0);
  await rejects('store outage blocks redirect and scrubs error', () => noStore.begin(owner), 'CONSENT_STORE_UNAVAILABLE');
  for (const response of [null, { result: 'OK' }, 'unexpected']) {
    const broken = createEbaySellerConsent({ command: async () => response, config });
    await rejects('nonconfirmed write never redirects', () => broken.begin(owner), 'CONSENT_STORE_UNAVAILABLE');
  }
  const uncertain = await fresh();
  const lost = createEbaySellerConsent({ command: async args => { await redis(args); throw Error('lost response'); }, config });
  await rejects('lost consume response never permits exchange', () => lost.consume(owner, uncertain), 'CONSENT_STORE_UNAVAILABLE');
  await rejects('lost response does not make consumed state reusable', () => adapter.consume(owner, uncertain), 'INVALID_CONSENT_STATE');
  const beforeKeys = await redis(['KEYS', 'ebay:seller:consent:v1:*']);
  await rejects('lost write response never redirects', () => lost.begin(owner), 'CONSENT_STORE_UNAVAILABLE');
  const afterKeys = await redis(['KEYS', 'ebay:seller:consent:v1:*']);
  const orphan = afterKeys.filter(k => !beforeKeys.includes(k));
  check('ambiguous write leaves one expiring intent', orphan.length, 1);
  check('orphan expires without callback', (await redis(['PTTL', orphan[0]])) > 0, true);

  const states = await Promise.all(Array.from({ length: 25 }, fresh));
  check('independent starts never reuse state', new Set(states).size, 25);
  const mutable = { ...config };
  const pinned = createEbaySellerConsent({ command: redis, config: mutable });
  mutable.environment = 'production';
  check('caller config mutation cannot change destination', new URL((await pinned.begin(owner)).authorizationUrl).hostname, 'auth.sandbox.ebay.com');
  const production = createEbaySellerConsent({ command: redis, config: { ...config, environment: 'production' } });
  check('production has fixed separate host', new URL((await production.begin(owner)).authorizationUrl).hostname, 'auth.ebay.com');
  for (const bad of [{ environment: 'evil' }, { environment: '__proto__' }, { ruName: 'https://evil.test' }, { clientId: ' client ' }]) {
    assert.throws(() => createEbaySellerConsent({ command: redis, config: { ...config, ...bad } }), { code: 'INVALID_CONFIG' });
    checks++;
  }
  console.log(`SUITE COMPLETE: ebay-seller-consent.mjs: ${checks} passed, 0 failed`);
  process.exit(0);
} catch (error) { console.error(error); process.exit(1); }
