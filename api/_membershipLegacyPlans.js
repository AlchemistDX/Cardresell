// Consumption-only definitions for an audited existing allowance. Never expose
// these as products or use them to issue a new subscription renewal.
import { TIER_BENEFITS } from './_tier.js';
export const LEGACY_CONSUMPTION_PLANS = Object.freeze(Object.fromEntries(
  ['pro', 'pro_max', 'ultimate'].map(tier => ['legacy_' + tier, Object.freeze({
    idCredits: TIER_BENEFITS[tier].idGrant,
    gradeCredits: TIER_BENEFITS[tier].gradeGrant,
  })])));
// Discount continuity only, not a mapping of feature capabilities or allowances.
export const LEGACY_DISCOUNT_PLAN = Object.freeze({ pro: 'casual', pro_max: 'pro', ultimate: 'business' });
