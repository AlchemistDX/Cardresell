import assert from 'node:assert/strict';
import { createCutoverStatus } from '../api/membership-cutover-status.js';
import { guardLegacyCommand, membershipRouteMode, MEMBERSHIP_LEGACY_FENCE } from '../api/_membershipLegacyFence.js';
import { membershipPurchaseRuntime } from '../api/_membershipPurchaseRuntime.js';
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
const env = { VERCEL_ENV: 'production', MEMBERSHIP_CUTOVER_STATUS: 'enabled',
  MEMBERSHIP_CUTOVER_PAUSED: 'enabled', VERCEL_URL: 'synthetic.vercel.app',
  VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40), KV_REST_API_URL: 'https://synthetic.upstash.io' };
async function call(options = {}, request = {}) {
  const calls = [];
  const execute = options.execute || (async command => {
    calls.push(command);
    if (command[0] === 'TIME') return ['1790950000', '0'];
    assert.deepEqual(command, ['GET', MEMBERSHIP_LEGACY_FENCE]); return null;
  });
  const res = { statusCode: 0, payload: null, setHeader() {},
    status(code) { this.statusCode = code; return this; }, json(body) { this.payload = body; return this; } };
  await createCutoverStatus({ env: options.env || env, execute })({
    method: 'GET', headers: { host: 'www.cardresell.org' }, ...request,
  }, res);
  return { ...res, calls };
}
await test('canary reads TIME and fence only; credentials and endpoint never returned', async () => {
  const r = await call(); assert.equal(r.statusCode, 200); assert.equal(r.payload.datastoreAuthorization, 'accepted');
  assert.equal(r.payload.fence, 'absent'); assert.equal(r.payload.mutated, false);
  assert.equal(r.calls.length, 2);
  assert.equal(JSON.stringify(r.payload).includes('synthetic.upstash.io'), false);
});
await test('old credential rejection is distinguished from transient errors', async () => {
  for (const status of [401, 403, 500]) {
    const r = await call({ execute: async () => { throw Object.assign(Error('secret must never print'), { status }); } });
    assert.equal(r.statusCode, status === 500 ? 503 : 200);
    assert.equal(r.payload.datastoreAuthorization, status === 500 ? 'unconfirmed' : 'rejected');
    assert.equal(JSON.stringify(r.payload).includes('secret'), false);
  }
});
await test('canary refuses Preview, disabled mode, wrong host and non-GET without database access', async () => {
  for (const e of [{ ...env, VERCEL_ENV: 'preview' }, { ...env, MEMBERSHIP_CUTOVER_STATUS: '' }]) {
    const r = await call({ env: e }); assert.equal(r.statusCode, 404); assert.equal(r.calls.length, 0);
  }
  const wrong = await call({}, { headers: { host: 'evil.invalid' } });
  assert.equal(wrong.statusCode, 404); assert.equal(wrong.calls.length, 0);
  const post = await call({}, { method: 'POST' }); assert.equal(post.statusCode, 405); assert.equal(post.calls.length, 0);
});
await test('cutover blocks legacy mutations, new billing routes and purchase runtime before calls', async () => {
  const old = process.env.MEMBERSHIP_CUTOVER_PAUSED;
  process.env.MEMBERSHIP_CUTOVER_PAUSED = 'enabled';
  try {
    const get = ['GET', 'scans:owner:id_paid_left']; assert.equal(guardLegacyCommand(get), get);
    for (const command of [['SET', get[1], 1], ['INCR', get[1]], ['EVAL', 'return 1', 0]]) {
      assert.throws(() => guardLegacyCommand(command), /membership_cutover_paused/);
    }
    await assert.rejects(() => membershipRouteMode(async () => { throw Error('must not call database'); }), /membership_cutover_paused/);
    await assert.rejects(membershipPurchaseRuntime, /membership_cutover_paused/);
  } finally {
    if (old === undefined) delete process.env.MEMBERSHIP_CUTOVER_PAUSED; else process.env.MEMBERSHIP_CUTOVER_PAUSED = old;
  }
});
console.log(`${passed} passed, 0 failed`);
