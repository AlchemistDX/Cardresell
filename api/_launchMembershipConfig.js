// Versioned launch contract. Not activated until checkout, ledgers, quotas,
// migration, and Stripe test-mode verification have passed their release gate.
// All monetary values are integer USD cents; storage uses decimal bytes.
export const MEMBERSHIP_VERSION = 'launch-v2';

const plan = (monthlyPriceCents, idCredits, gradeCredits, packDiscountPercent,
  activeListings, newListings, photoStorageBytes, directSupport = false) =>
  Object.freeze({
    monthlyPriceCents, idCredits, gradeCredits, packDiscountPercent,
    activeListings, newListings, photoStorageBytes, directSupport,
    exportMonthlyQuota: null,
  });

export const LAUNCH_PLANS = Object.freeze({
  free: plan(0, 5, 1, 0, 5, 10, 100_000_000),
  starter: plan(499, 25, 5, 0, 25, 100, 500_000_000),
  casual: plan(999, 50, 15, 10, 100, 300, 2_000_000_000),
  pro: plan(1999, 250, 40, 15, 500, 1500, 10_000_000_000, true),
  business: plan(4999, 1000, 100, 25, 2000, 6000, 50_000_000_000, true),
});

const pack = (kind, credits, basePriceCents) =>
  Object.freeze({ kind, credits, basePriceCents });

export const LAUNCH_PACKS = Object.freeze({
  id_25: pack('id', 25, 299),
  id_100: pack('id', 100, 999),
  id_500: pack('id', 500, 2999),
  id_1000: pack('id', 1000, 4999),
  grade_10: pack('grade', 10, 599),
  grade_25: pack('grade', 25, 1299),
  grade_50: pack('grade', 50, 2299),
});

export const LAUNCH_WELCOME_CREDITS = Object.freeze({ idCredits: 10, gradeCredits: 1 });

export const LAUNCH_CREDIT_POLICY = Object.freeze({
  idCost: 1,
  gradeCost: 1,
  deepGradeCost: 2,
  welcomeGrant: 'once_per_verified_eligible_account',
  freeGrant: 'once_per_calendar_month_utc',
  paidGrant: 'once_per_successfully_paid_subscription_period',
  consumeOrder: Object.freeze(['included', 'purchased']),
  includedConsumeOrder: Object.freeze(['monthly', 'welcome']),
  includedRollover: false,
  purchasedExpiry: null,
  planChangeTiming: 'next_renewal',
  cancellationBenefits: 'through_paid_through_date',
  freeListingPeriod: 'calendar_month_utc',
  paidListingPeriod: 'subscription_billing_period',
});

export const DIRECT_SUPPORT_COPY =
  'Direct support by call or text. Response within 24 hours.';

function own(object, key) {
  return typeof key === 'string' && Object.hasOwn(object, key);
}

// Caller must pass a server-resolved plan. This helper is not authentication
// or entitlement resolution and must never be wired to a client-supplied tier.
export function quoteLaunchPack(packId, serverResolvedPlan) {
  if (!own(LAUNCH_PACKS, packId)) throw new Error('unknown_pack');
  if (!own(LAUNCH_PLANS, serverResolvedPlan)) throw new Error('unknown_plan');
  const selected = LAUNCH_PACKS[packId];
  const discountPercent = LAUNCH_PLANS[serverResolvedPlan].packDiscountPercent;
  // Integer half-up rounding, avoiding floating-point dollar calculations.
  const amountCents = Math.floor(
    (selected.basePriceCents * (100 - discountPercent) + 50) / 100,
  );
  return Object.freeze({
    version: MEMBERSHIP_VERSION, currency: 'usd', packId,
    ...selected, discountPercent, amountCents,
  });
}
