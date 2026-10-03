import assert from 'node:assert/strict';
import { inspectMembershipPreview } from './inspect-membership-preview.mjs';
import { evidence, CUTOVER_AUDIT, CUTOVER_TIME } from './install-preview-writer-fence.mjs';
import { MEMBERSHIP_LEGACY_FENCE } from '../api/_membershipLegacyFence.js';
import { LAUNCH_PLANS, LAUNCH_PACKS } from '../api/_launchMembershipConfig.js';
const commit = 'a'.repeat(40);
const prices = { plans: {}, packs: {} };
for (const [group, catalogue] of [['plans', LAUNCH_PLANS], ['packs', LAUNCH_PACKS]]) {
  for (const name of Object.keys(catalogue).filter(x => x !== 'free')) {
    prices[group][name] = { priceId: 'price_' + name, productId: 'prod_' + name };
  }
}
const env = {
  VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: evidence.branch, VERCEL_GIT_COMMIT_SHA: commit,
  MEMBERSHIP_PREVIEW_INSPECT_COMMIT: commit, MEMBERSHIP_PURCHASE_TEST_MODE: 'enabled',
  MEMBERSHIP_STRIPE_TEST_KEY: 'rk_test_syntheticfixture', MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET: 'whsec_syntheticfixture',
  MEMBERSHIP_STRIPE_TEST_ACCOUNT: 'acct_1Tno55FW2YZoedIZ',
  MEMBERSHIP_STRIPE_TEST_RETURN_ORIGIN: 'https://cardresell-membership-v2-preview.vercel.app',
  MEMBERSHIP_STRIPE_TEST_PORTAL_CONFIGURATION: 'bpc_fixture',
  MEMBERSHIP_STRIPE_TEST_PRICES: JSON.stringify(prices),
  MEMBERSHIP_STRIPE_TEST_COUPONS: JSON.stringify({ free: null, starter: null, casual: 'c10', pro: 'c15', business: 'c25' }),
  MEMBERSHIP_TEST_NEW_CUSTOMER_OWNERS: JSON.stringify(['fzUpcrXKDdQzGORl0bLQ6mTwML73']),
  KV_REST_API_URL: 'https://synthetic-preview.upstash.io',
};
let calls = [], http = [];
const values = new Map([[MEMBERSHIP_LEGACY_FENCE, '1'], [CUTOVER_AUDIT, JSON.stringify({ ...evidence, releaseCommit: commit })],
  [CUTOVER_TIME, '1791060000']]);
const execute = async args => {
  calls.push(args[0]);
  assert.ok(['GET', 'MGET', 'TTL'].includes(args[0]), 'no Redis writes');
  return args[0] === 'MGET' ? args.slice(1).map(k => values.get(k) ?? null)
    : args[0] === 'TTL' ? -1 : values.get(args[1]) ?? null;
};
const fetchImpl = async (url, init) => {
  http.push(init.method); assert.equal(init.method, 'GET'); assert.equal(new URL(url).origin, 'https://api.stripe.com');
  return url.endsWith('/account') ? Response.json({ object: 'account', id: env.MEMBERSHIP_STRIPE_TEST_ACCOUNT })
    : url.includes('test_clocks') ? Response.json({ error: { message: 'secret not emitted' } }, { status: 403 })
    : Response.json({ data: [], has_more: false });
};
let count = 0;
async function test(name, fn) { await fn(); console.log('PASS ' + name); count++; }
await test('read-only cutover audit and absent enrollment are faithfully reported', async () => {
  const r = await inspectMembershipPreview({ env, execute, fetchImpl });
  assert.equal(r.datastore.cutoverAuditVerified, true); assert.equal(r.owner.enrollmentPresent, false);
  assert.equal(r.stripe.clocks.httpStatus, 403); assert.equal(r.stripe.clocks.available, false);
  assert.ok(!JSON.stringify(r).includes('syntheticfixture')); assert.ok(!JSON.stringify(r).includes('secret not emitted'));
});
for (const [name, change] of [
  ['production refused before I/O', { VERCEL_ENV: 'production' }],
  ['wrong branch refused before I/O', { VERCEL_GIT_COMMIT_REF: 'main' }],
  ['wrong commit refused before I/O', { MEMBERSHIP_PREVIEW_INSPECT_COMMIT: 'b'.repeat(40) }],
  ['live key refused before I/O', { MEMBERSHIP_STRIPE_TEST_KEY: 'rk_live_syntheticfixture' }],
  ['untrusted datastore refused before I/O', { KV_REST_API_URL: 'https://example.com' }],
  ['untrusted return origin refused before I/O', { MEMBERSHIP_STRIPE_TEST_RETURN_ORIGIN: 'https://other.vercel.app' }],
]) await test(name, async () => {
  const before = [calls.length, http.length];
  await assert.rejects(inspectMembershipPreview({ env: { ...env, ...change }, execute, fetchImpl }));
  assert.deepEqual([calls.length, http.length], before);
});
await test('changed audit refuses Stripe access', async () => {
  const raw = values.get(CUTOVER_AUDIT), n = http.length;
  values.set(CUTOVER_AUDIT, raw.replace('rejected', 'unknown'));
  await assert.rejects(inspectMembershipPreview({ env, execute, fetchImpl }), /preview_cutover_audit_invalid/);
  assert.equal(http.length, n); values.set(CUTOVER_AUDIT, raw);
});
await test('expiring fence refuses Stripe access', async () => {
  const n = http.length;
  await assert.rejects(inspectMembershipPreview({ env, execute: args => args[0] === 'TTL' ? 60 : execute(args), fetchImpl }),
    /preview_cutover_audit_expiring/);
  assert.equal(http.length, n);
});
console.log(`${count} passed, 0 failed`);
