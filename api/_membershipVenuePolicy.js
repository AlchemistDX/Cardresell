// Marketplace comparison access is separate from credit allowances and bulk grading.
// These internal bundle names preserve the existing venue sets, including legacy owners.
const bundles = Object.freeze({
  free: Object.freeze({ tier: 'free', count: 2 }),
  pro: Object.freeze({ tier: 'pro', count: 9 }),
  pro_max: Object.freeze({ tier: 'pro_max', count: 15 }),
});
const planBundles = Object.freeze({
  free: 'free', starter: 'free', casual: 'pro', pro: 'pro_max', business: 'pro_max',
  legacy_pro: 'pro', legacy_pro_max: 'pro_max', legacy_ultimate: 'pro_max',
});
export function membershipVenueAccess(plan) {
  return bundles[Object.hasOwn(planBundles, plan) ? planBundles[plan] : 'free'];
}
