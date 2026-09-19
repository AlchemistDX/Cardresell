import assert from 'node:assert/strict';
import { publicMembershipCatalogue, createMembershipPurchaseRoutes } from '../api/_membershipPurchaseRoutes.js';
import { createPurchaseContextResolver, purchaseContextKey, membershipPurchaseRuntime } from '../api/_membershipPurchaseRuntime.js';
let count = 0;
const check = (a, b) => { assert.deepEqual(a, b); count++; };
const invoke = async (handler, method, body, headers = {}) => {
  const res = { code: 200, status(n) { this.code = n; return this; }, setHeader() {},
    json(data) { this.data = data; return this; } };
  await handler({ method, body, headers }, res); return res;
};
for (const [plan, discount] of [['free',0],['starter',0],['casual',10],['pro',15],['business',25]]) {
  const c = publicMembershipCatalogue(plan);
  check(c.plans.map(p => p.monthlyPriceCents), [0,499,999,1999,4999]);
  check(c.plans.map(p => [p.idCredits,p.gradeCredits]), [[5,1],[25,5],[50,15],[250,40],[1000,100]]);
  check(c.creditsExpire, false);
  check(c.packs.length, 7);
  check(c.packs.every(p => p.discountPercent === discount
    && p.amountCents === Math.floor((p.basePriceCents * (100-discount)+50)/100)), true);
  check(c.plans.every(p => !('activeListings' in p) && !('photoStorageBytes' in p)), true);
}
let calls = 0, forwarded;
const routes = createMembershipPurchaseRoutes({
  authenticate: async token => ({ uid: 'owner', verified: token === 'valid' }),
  resolveContext: async owner => ({ owner, plan: 'casual', newSubscriptionAllowed: false }),
  controller: { checkout: async input => { calls++; forwarded = input; return { status: 'recovery_pending' }; } },
});
check((await invoke(routes.catalogue, 'GET')).data.packs[0].amountCents,299);
check((await invoke(routes.catalogue, 'GET', null, {authorization:'Bearer valid'})).data.packs[0].amountCents,269);
check((await invoke(routes.checkout, 'POST', {})).code,401);
check(calls,0);
const request = { requestId: 'a'.repeat(64), kind:'pack', selection:'id_25' };
check((await invoke(routes.checkout,'POST',request,{authorization:'Bearer valid'})).code,202);
check(forwarded, { token:'valid', request });
check((await invoke(routes.checkout, 'GET', request)).code,405);
let stored = { version:'launch-v2', owner:'owner', accountId:'acct_test', livemode:false, ready:true,
  customerId:'cus_test', plan:'free', subscriptionId:null, newSubscriptionAllowed:true, validUntil:2000 };
const resolve = createPurchaseContextResolver({ execute:async args => {
  check(args, ['GET',purchaseContextKey('acct_test','owner')]); return JSON.stringify(stored);
}, accountId:'acct_test', now:()=>1000 });
check((await resolve('owner')).plan,'free');
for (const delta of [{owner:'other'},{livemode:true},{validUntil:1000},{ready:false},
  {plan:'pro',newSubscriptionAllowed:true},{customerId:'bad'}]) {
  const saved=stored;stored={...stored,...delta};
  await assert.rejects(resolve('owner'));count++;stored=saved;
}
const previous=process.env.VERCEL_ENV;
process.env.VERCEL_ENV='production';
assert.throws(()=>membershipPurchaseRuntime(),/purchase_disabled/);count++;
if(previous===undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV=previous;
console.log(`membership-purchase-routes: ${count} passed, 0 failed`);
