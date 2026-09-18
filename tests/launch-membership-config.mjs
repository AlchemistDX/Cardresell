import assert from 'node:assert/strict';
import {
  LAUNCH_PLANS, LAUNCH_PACKS, LAUNCH_CREDIT_POLICY,
  quoteLaunchPack, DIRECT_SUPPORT_COPY,
} from '../api/_launchMembershipConfig.js';

let checks = 0;
function equal(actual, expected) { assert.deepEqual(actual, expected); checks++; }
const columns = [
  'monthlyPriceCents', 'idCredits', 'gradeCredits', 'packDiscountPercent',
  'activeListings', 'newListings', 'photoStorageBytes',
];
const expected = {
  free: [0, 10, 1, 0, 5, 10, 100000000],
  starter: [499, 25, 5, 0, 25, 100, 500000000],
  casual: [999, 50, 15, 10, 100, 300, 2000000000],
  pro: [1999, 250, 40, 15, 500, 1500, 10000000000],
  business: [4999, 1000, 100, 25, 2000, 6000, 50000000000],
};
equal(Object.keys(LAUNCH_PLANS), Object.keys(expected));
for (const [name, row] of Object.entries(expected)) {
  equal(columns.map(key => LAUNCH_PLANS[name][key]), row);
  equal(LAUNCH_PLANS[name].exportMonthlyQuota, null);
  equal(LAUNCH_PLANS[name].directSupport, ['pro', 'business'].includes(name));
  equal(Object.isFrozen(LAUNCH_PLANS[name]), true);
}
const prices = {
  id_25: [299, 299, 269, 254, 224],
  id_100: [999, 999, 899, 849, 749],
  id_500: [2999, 2999, 2699, 2549, 2249],
  id_1000: [4999, 4999, 4499, 4249, 3749],
  grade_10: [599, 599, 539, 509, 449],
  grade_25: [1299, 1299, 1169, 1104, 974],
  grade_50: [2299, 2299, 2069, 1954, 1724],
};
equal(Object.keys(LAUNCH_PACKS), Object.keys(prices));
for (const [packId, amounts] of Object.entries(prices)) {
  Object.keys(expected).forEach((tier, index) =>
    equal(quoteLaunchPack(packId, tier).amountCents, amounts[index]));
}
for (const invalid of ['__proto__', 'constructor', 'toString', '', null, 'PRO']) {
  assert.throws(() => quoteLaunchPack(invalid, 'free'), /unknown_pack/); checks++;
  assert.throws(() => quoteLaunchPack('id_25', invalid), /unknown_plan/); checks++;
}
equal(LAUNCH_CREDIT_POLICY.consumeOrder, ['included', 'purchased']);
equal(LAUNCH_CREDIT_POLICY.freeGrant, 'once_per_eligible_account');
equal(LAUNCH_CREDIT_POLICY.paidGrant, 'once_per_successfully_paid_subscription_period');
equal(LAUNCH_CREDIT_POLICY.purchasedExpiry, null);
equal(LAUNCH_CREDIT_POLICY.includedRollover, false);
equal(LAUNCH_CREDIT_POLICY.planChangeTiming, 'next_renewal');
equal([LAUNCH_CREDIT_POLICY.idCost, LAUNCH_CREDIT_POLICY.gradeCost,
  LAUNCH_CREDIT_POLICY.deepGradeCost], [1, 1, 2]);
equal(DIRECT_SUPPORT_COPY,
  'Direct support by call or text. Response within 24 hours.');
console.log(`${checks} passed, 0 failed; configuration only, not activation or live payment proof.`);
