import assert from 'node:assert/strict';
import { membershipEnvironment } from '../api/_membershipEnvironment.js';
import { LAUNCH_PLANS, LAUNCH_PACKS } from '../api/_launchMembershipConfig.js';
let n = 0;
const prices = { plans: {}, packs: {} };
for (const [group, catalogue] of [['plans', LAUNCH_PLANS], ['packs', LAUNCH_PACKS]])
  for (const name of Object.keys(catalogue).filter(x => x !== 'free'))
    prices[group][name] = { priceId: 'price_' + name, productId: 'prod_' + name };
const make = mode => {
  const p = `MEMBERSHIP_STRIPE_${mode.toUpperCase()}_`;
  return { VERCEL_ENV: mode === 'test' ? 'preview' : 'production',
    MEMBERSHIP_PURCHASE_TEST_MODE: mode === 'test' ? 'enabled' : 'disabled',
    [p+'KEY']: `rk_${mode}_syntheticOnly`, [p+'WEBHOOK_SECRET']: 'whsec_syntheticOnly',
    [p+'ACCOUNT']: 'acct_synthetic', [p+'PORTAL_CONFIGURATION']: 'bpc_synthetic',
    [p+'RETURN_ORIGIN']: mode === 'test' ? 'https://preview.example' : 'https://www.cardresell.org',
    [p+'PRICES']: JSON.stringify(prices),
    [p+'COUPONS']: JSON.stringify({ free: null, starter: null, casual: 'coupon10', pro: 'coupon15', business: 'coupon25' }) };
};
for (const mode of ['test', 'live']) {
  const env=make(mode), p=`MEMBERSHIP_STRIPE_${mode.toUpperCase()}_`;
  assert.equal(membershipEnvironment(env, mode).livemode, mode==='live'); n++;
  for (const change of [
    { VERCEL_ENV: 'development' }, { [p+'KEY']: `rk_${mode==='test'?'live':'test'}_syntheticOnly` },
    { [p+'KEY']: `sk_${mode}_syntheticOnly` }, { [p+'RETURN_ORIGIN']: 'https://attacker.example/path' },
    { [p+'RETURN_ORIGIN']: mode==='test'?'https://www.cardresell.org':'https://preview.example' },
    { [p+'PRICES']: '{}' }, { [p+'COUPONS']: '{}' }, { [p+'WEBHOOK_SECRET']: '' },
  ]) { assert.throws(()=>membershipEnvironment({...env,...change},mode)); n++; }
}
assert.throws(()=>membershipEnvironment({...make('live'),MEMBERSHIP_PURCHASE_TEST_MODE:'enabled'},'live')); n++;
console.log(`membership-environment: ${n} passed, 0 failed`);
