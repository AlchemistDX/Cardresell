// Draft capacity is independent of scan credits and monthly creation meters.
import { LAUNCH_PLANS } from './_launchMembershipConfig.js';
import { membershipBalances, membershipRouteMode } from './_membershipRouteBilling.js';
export const DRAFT_BULK_LIMITS = Object.freeze({ free: 1, starter: 10, casual: 25, pro: 100, business: 500 });
export function draftPlanPolicy(plan) {
  if (!Object.hasOwn(LAUNCH_PLANS, plan)) throw Error('DRAFT_MEMBERSHIP_UNAVAILABLE');
  return { plan, activeLimit: LAUNCH_PLANS[plan].activeListings, bulkLimit: DRAFT_BULK_LIMITS[plan] };
}
export async function resolveDraftPlan(owner) {
  if (!await membershipRouteMode()) return { plan: 'legacy', activeLimit: 500, bulkLimit: 500 };
  const balance = await membershipBalances(owner);
  const legacy = { legacy_pro: 'casual', legacy_pro_max: 'pro', legacy_ultimate: 'business' };
  // Existing imported subscriptions retain at least their previously available capacity.
  if (Object.hasOwn(legacy, balance.tier)) return { ...draftPlanPolicy(legacy[balance.tier]), activeLimit: 500, bulkLimit: 500 };
  return draftPlanPolicy(balance.tier);
}
