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
  MEMBERSHIP_STRIPE_TEST_COUPONS: JSON.stringify({ free: null, starter: null, casual: 'coupon_10', pro: 'coupon_15', business: 'coupon_25' }),
  MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET: 'whsec_synthetic' };
let requests = 0;
const fetcher = async (url, options) => {
  requests++;
  assert.equal(options.method, 'GET');
  assert.equal(options.redirect, 'error');
  const parsed = new URL(url);
  if (parsed.pathname === '/v1/coupons') {
    assert.deepEqual(parsed.searchParams.getAll('expand[]'), ['data.applies_to']);
  }
  return new Response(JSON.stringify(objects[url.split('/v1/')[1].replace('&expand[]=data.applies_to', '')]), { status: 200 });
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
await test('missing configured coupons cannot pass deployment preflight', async () => {
  assert.equal((await membershipPreflight({ ...env, MEMBERSHIP_STRIPE_TEST_COUPONS: undefined }, fetcher)).status, 'FAIL');
});
await test('stale configured coupons cannot pass deployment preflight', async () => {
  assert.equal((await membershipPreflight({ ...env, MEMBERSHIP_STRIPE_TEST_COUPONS: '{}' }, fetcher)).status, 'FAIL');
});
const { default: handler } = await import('../api/membership-preflight.js');
Object.assign(process.env, env, { VERCEL_URL: 'synthetic-build.vercel.app',
  VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40), KV_REST_API_URL: 'https://synthetic.upstash.io',
  KV_REST_API_TOKEN: 'synthetic-not-a-credential' });
let datastoreStatus = 200;
globalThis.fetch = async (url, options) => {
  if (String(url).startsWith('https://synthetic.upstash.io')) {
    assert.deepEqual(JSON.parse(options.body), ['GET', 'membership:launch-v2:legacy_fence']);
    return Response.json({ result: null }, { status: datastoreStatus });
  }
  return fetcher(String(url), options);
};
async function invoke(host) {
  const res = { setHeader() {}, status(code) { this.code = code; return this; },
    json(body) { this.body = body; } };
  await handler({ method: 'GET', headers: { host } }, res);
  return res;
}
await test('immutable Preview exposes only safe deployment identity and read-only checks', async () => {
  const result = await invoke(process.env.VERCEL_URL);
  assert.equal(result.code, 200);
  assert.equal(result.body.deployment.commit, 'a'.repeat(40));
  assert.equal(result.body.writerReadiness.datastoreAuthorization, 'accepted');
  assert.equal(JSON.stringify(result.body).includes(process.env.KV_REST_API_TOKEN), false);
});
await test('stable Preview alias uses the same read-only deployment checks', async () => {
  assert.equal((await invoke('cardresell-membership-v2-preview.vercel.app')).code, 200);
});
await test('arbitrary host cannot access the deployed diagnostic', async () => {
  assert.equal((await invoke('attacker.vercel.app')).code, 404);
});
await test('Production cannot use immutable-host exception', async () => {
  process.env.VERCEL_ENV = 'production';
  assert.equal((await invoke(process.env.VERCEL_URL)).code, 404);
  process.env.VERCEL_ENV = 'preview';
});
await test('old deployment credential denial is distinguishable without returning secrets', async () => {
  datastoreStatus = 401;
  const result = await invoke(process.env.VERCEL_URL);
  assert.equal(result.body.writerReadiness.datastoreAuthorization, 'rejected');
  assert.equal(result.body.writerReadiness.datastoreReadable, false);
});
console.log(`${passed} passed, 0 failed`);
