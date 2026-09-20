import assert from 'node:assert/strict';
import { membershipPreflight } from '../api/_membershipPreflight.js';
import { LAUNCH_PLANS, LAUNCH_PACKS } from '../api/_launchMembershipConfig.js';
const map = { plans: {}, packs: {} }, objects = {};
for (const [group, catalogue] of [['plans', LAUNCH_PLANS], ['packs', LAUNCH_PACKS]]) {
  for (const [name, c] of Object.entries(catalogue)) {
    if (name === 'free') continue;
    map[group][name] = { priceId: 'price_' + name, productId: 'prod_' + name };
    objects['prices/price_' + name] = { object: 'price', id: 'price_' + name, product: 'prod_' + name,
      active: true, livemode: false, currency: 'usd',
      unit_amount: group === 'plans' ? c.monthlyPriceCents : c.basePriceCents,
      type: group === 'plans' ? 'recurring' : 'one_time',
      recurring: group === 'plans' ? { interval: 'month', interval_count: 1 } : null };
    objects['products/prod_' + name] = { object: 'product', id: 'prod_' + name, active: true, livemode: false };
  }
}
objects.account = { object: 'account', id: 'acct_test' };
objects['coupons?limit=100'] = { object: 'list', has_more: false, data: [10, 15, 25].map(percent => ({
  object: 'coupon', id: 'coupon_' + percent, valid: true, livemode: false,
  percent_off: percent, amount_off: null, currency: null, duration: 'once',
  applies_to: { products: Object.values(map.packs).map(p => p.productId) },
})) };
objects['billing_portal/configurations/bpc_test'] = { object: 'billing_portal.configuration',
  id: 'bpc_test', active: true, livemode: false, features: {
    payment_method_update: { enabled: true }, invoice_history: { enabled: true },
    subscription_cancel: { enabled: true, mode: 'at_period_end' }, subscription_update: { enabled: false },
  } };
const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature/launch-membership-v2',
  MEMBERSHIP_STRIPE_TEST_KEY: 'rk_test_synthetic', MEMBERSHIP_STRIPE_TEST_ACCOUNT: 'acct_test',
  MEMBERSHIP_STRIPE_TEST_PRICES: JSON.stringify(map), MEMBERSHIP_STRIPE_TEST_PORTAL_CONFIGURATION: 'bpc_test',
  MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET: 'whsec_synthetic' };
let requests = 0;
const fetcher = async (url, options) => {
  requests++;
  assert.equal(options.method, 'GET');
  assert.equal(options.redirect, 'error');
  return new Response(JSON.stringify(objects[url.split('/v1/')[1]]), { status: 200 });
};
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
await test('canonical catalogue and Portal', async () => assert.equal((await membershipPreflight(env, fetcher)).status, 'PASS'));
await test('Production performs no request', async () => {
  const before = requests;
  assert.equal((await membershipPreflight({ ...env, VERCEL_ENV: 'production' }, fetcher)).status, 'DISABLED');
  assert.equal(requests, before);
});
await test('wrong branch performs no request', async () => {
  const before = requests;
  assert.equal((await membershipPreflight({ ...env, VERCEL_GIT_COMMIT_REF: 'main' }, fetcher)).status, 'DISABLED');
  assert.equal(requests, before);
});
await test('live key rejected', async () => assert.equal((await membershipPreflight({ ...env, MEMBERSHIP_STRIPE_TEST_KEY: 'rk_live_secret' }, fetcher)).status, 'FAIL'));
await test('wrong account rejected', async () => assert.equal((await membershipPreflight({ ...env, MEMBERSHIP_STRIPE_TEST_ACCOUNT: 'acct_wrong' }, fetcher)).status, 'FAIL'));
await test('wrong price rejected', async () => {
  objects['prices/price_starter'].unit_amount++;
  assert.equal((await membershipPreflight(env, fetcher)).status, 'FAIL');
  objects['prices/price_starter'].unit_amount--;
});
await test('ambiguous coupon rejected', async () => {
  objects['coupons?limit=100'].data.push({ ...objects['coupons?limit=100'].data[0], id: 'duplicate' });
  assert.equal((await membershipPreflight(env, fetcher)).status, 'FAIL');
  objects['coupons?limit=100'].data.pop();
});
await test('transport errors do not reveal credentials', async () => {
  const r = await membershipPreflight(env, async () => { throw Error(env.MEMBERSHIP_STRIPE_TEST_KEY); });
  assert.equal(r.status, 'FAIL');
  assert.equal(JSON.stringify(r).includes(env.MEMBERSHIP_STRIPE_TEST_KEY), false);
});
console.log(`${passed} passed, 0 failed`);
