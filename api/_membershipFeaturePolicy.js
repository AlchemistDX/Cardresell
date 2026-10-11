// Launch feature contract. Paid access follows the validated, paid-through
// allocation; neither a browser tier nor a scheduled future plan grants access.
// Legacy/audited account capabilities remain a separate compatibility path.
export const MEMBERSHIP_FEATURE_VERSION = 'seller-tools-v1';
export const MEMBERSHIP_PAID_FEATURES = Object.freeze({
  starter: Object.freeze({ bulkGrade: false }),
  casual: Object.freeze({ bulkGrade: false }),
  pro: Object.freeze({ bulkGrade: true }),
  business: Object.freeze({ bulkGrade: true }),
});
// 2026-10-09 owner decision: batch grading size per plan (cards per batch).
// Each card is still an ordinary, separately debited grade.
export const BULK_GRADE_CARD_LIMITS = Object.freeze({ pro: 10, business: 25 });

// 2026-10-10 owner decision: the reserved owner test account (willsep202, the
// single MEMBERSHIP_LIVE_OWNERS entry) gets Business FEATURES for testing.
// Features only: plan, subscription, credits, debits and Stripe are unchanged,
// and every scan/grade is still charged normally. Off unless
// MEMBERSHIP_OWNER_FEATURE_PLAN is exactly "business".
export function ownerFeaturePlan(owner, env = process.env) {
  if (env.MEMBERSHIP_OWNER_FEATURE_PLAN !== 'business' || typeof owner !== 'string' || !owner) return null;
  let owners;
  try { owners = JSON.parse(env.MEMBERSHIP_LIVE_OWNERS || '[]'); } catch { return null; }
  if (!Array.isArray(owners) || owners.length !== 1 || typeof owners[0] !== 'string' || !owners[0]) return null;
  return owner === owners[0] ? 'business' : null;
}
