// Configuration validation only. Does not activate purchases or perform I/O.
// Live configuration can be prepared without enabling the test-only runtime.
import { LAUNCH_PLANS, LAUNCH_PACKS } from './_launchMembershipConfig.js';
const fail = () => { throw Error('membership_environment_invalid'); };
const object = x => x && typeof x === 'object' && !Array.isArray(x);
export function membershipEnvironment(env, mode = 'test') {
  if (!['test', 'live'].includes(mode)) fail();
  const live = mode === 'live', prefix = 'MEMBERSHIP_STRIPE_' + (live ? 'LIVE_' : 'TEST_');
  if (env.VERCEL_ENV !== (live ? 'production' : 'preview')) fail();
  if (live && env.MEMBERSHIP_PURCHASE_TEST_MODE === 'enabled') fail();
  if (!live && env.MEMBERSHIP_PURCHASE_TEST_MODE !== 'enabled') fail();
  const apiKey = env[prefix + 'KEY'], webhookSecret = env[prefix + 'WEBHOOK_SECRET'];
  if (typeof apiKey !== 'string' || !new RegExp(`^rk_${mode}_[A-Za-z0-9]{8,500}$`).test(apiKey)
    || typeof webhookSecret !== 'string' || !/^whsec_[A-Za-z0-9]{8,500}$/.test(webhookSecret)) fail();
  const accountId = env[prefix + 'ACCOUNT'], returnOrigin = env[prefix + 'RETURN_ORIGIN'];
  const portalConfiguration = env[prefix + 'PORTAL_CONFIGURATION'];
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId) || !/^bpc_[A-Za-z0-9]+$/.test(portalConfiguration)) fail();
  let origin, prices, coupons;
  try { origin = new URL(returnOrigin); prices = JSON.parse(env[prefix + 'PRICES']); coupons = JSON.parse(env[prefix + 'COUPONS']); }
  catch { fail(); }
  if (origin.protocol !== 'https:' || origin.origin !== returnOrigin || origin.port
    || origin.username || origin.password) fail();
  const productionOrigin = ['https://www.cardresell.org', 'https://cardresell.org'].includes(returnOrigin);
  if (productionOrigin !== live || !object(prices) || !object(coupons)) fail();
  const seen = new Set();
  for (const [group, catalogue] of [['plans', LAUNCH_PLANS], ['packs', LAUNCH_PACKS]]) {
    const names = Object.keys(catalogue).filter(x => x !== 'free');
    if (!object(prices[group]) || Object.keys(prices[group]).length !== names.length) fail();
    for (const name of names) {
      const p = prices[group][name];
      if (!p || !/^price_[A-Za-z0-9_]+$/.test(p.priceId)
        || !/^prod_[A-Za-z0-9_]+$/.test(p.productId) || seen.has(p.priceId)) fail();
      seen.add(p.priceId);
    }
  }
  if (Object.keys(coupons).length !== Object.keys(LAUNCH_PLANS).length) fail();
  const discountIds = new Set();
  for (const [name, plan] of Object.entries(LAUNCH_PLANS)) {
    if (!plan.packDiscountPercent) { if (coupons[name] !== null) fail(); }
    else {
      if (typeof coupons[name] !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(coupons[name])
        || discountIds.has(coupons[name])) fail();
      discountIds.add(coupons[name]);
    }
  }
  // A format-valid price ID doesn't prove Stripe mode, account or catalogue
  // contents. Canonical transport validation remains mandatory at execution.
  return { apiKey, webhookSecret, accountId, returnOrigin, portalConfiguration,
    priceMap: prices, couponMap: coupons, livemode: live };
}
