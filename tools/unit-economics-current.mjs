#!/usr/bin/env node
// Scenario planning, not realized profit. Canonical prices; no provider calls.
import { LAUNCH_PLANS, LAUNCH_PACKS, LAUNCH_WELCOME_CREDITS,
  LAUNCH_CREDIT_POLICY, quoteLaunchPack } from '../api/_launchMembershipConfig.js';
const fee = { processing: .029, fixed: .30, subscriptionBilling: .007 };
// Account invoice and offered 10K pack observed October 12, 2026. No pack bought.
// Public plan pricing differs; use the account evidence for this planning run.
const x = { monthlyFixed: 64, monthlyCredits: 100000, extraPackCost: 11, extraPackCredits: 10000, identify: 10, deepGrader: 100 };
// Small historical live sample; not an average or an upper bound. See Oct 7 handoff.
const ai = { quick: .017, deep: .03 };
const evidence = {
  reviewedOn: '2026-10-12',
  ximilarMonthly: 'Business 100K; August and September paid invoices $64 each',
  ximilarPack: 'Account offer: $11 for 10K prepaid credits, one-time purchase; no active packs',
  ximilarOperations: 'https://www.ximilar.com/pricing/#operations; ID 10 credits, card grade 100 credits',
  paymentFees: 'Four current-checkout charge balance transactions reconciled October 12: $14.71 gross, $1.62 processing fees, $13.09 net. Percentage inputs remain future-use assumptions, not a universal contracted rate.',
  subscriptionBilling: 'Separate October 5 Billing usage fee of $0.03 observed at account level; no direct invoice reference. Do not fold it into charge processing fees or silently assign it to a purchase.',
  openai: 'Historical small-sample assumptions, not current measured delivered-grade costs',
  unknowns: ['provider charges on failed/retried attempts', 'Ximilar exhaustion behavior',
    'other provider licenses and infrastructure', 'outstanding credit obligations',
    'actual delivered operations and free-user allocation'],
};
const centsAfterDiscount = (base, discount) => Math.floor((base * (100 - discount) + 50) / 100);
const net = (cents, subscription = false) => cents / 100 * (1 - fee.processing - (subscription ? fee.subscriptionBilling : 0)) - fee.fixed;
const round = n => Math.round(n * 10000) / 10000;
const scenarios = [
  { name: 'within_shared_monthly_quota', xRate: 0, idCalls: 1 },
  { name: 'extra_pack_two_identifications_per_operation', xRate: x.extraPackCost / x.extraPackCredits, idCalls: 2 },
];
// Enumerate whole operations: an odd Grade balance cannot buy half a Deep Grade.
// Select the most expensive redeemable mix under each scenario's assumptions.
function allowanceCost(idCredits, gradeCredits, scenario) {
  const idOperations = Math.floor(idCredits / LAUNCH_CREDIT_POLICY.idCost);
  let maximum = null;
  for (let deep = 0; deep <= Math.floor(gradeCredits / LAUNCH_CREDIT_POLICY.deepGradeCost); deep++) {
    const quick = Math.floor((gradeCredits - deep * LAUNCH_CREDIT_POLICY.deepGradeCost) / LAUNCH_CREDIT_POLICY.gradeCost);
    const ximilarCredits = (idOperations + quick + deep) * x.identify * scenario.idCalls + deep * x.deepGrader;
    const openaiCost = quick * ai.quick + deep * ai.deep;
    const variableCost = ximilarCredits * scenario.xRate + openaiCost;
    if (!maximum || variableCost > maximum.variableCost) {
      maximum = { idOperations, quickGrades: quick, deepGrades: deep, ximilarCredits,
        openaiCost, variableCost };
    }
  }
  return maximum;
}
const currentPacks = scenarios.flatMap(s => Object.keys(LAUNCH_PLANS).flatMap(plan =>
  Object.entries(LAUNCH_PACKS).map(([packId, pack]) => {
    const quote = quoteLaunchPack(packId, plan);
    const costs = allowanceCost(pack.kind === 'id' ? pack.credits : 0,
      pack.kind === 'grade' ? pack.credits : 0, s);
    const afterProcessing = net(quote.amountCents);
    return { scenario: s.name, plan, packId, price: quote.amountCents / 100,
      afterProcessing: round(afterProcessing), maximumModeledRedemptionCost: round(costs.variableCost),
      contributionBeforeFixedCosts: round(afterProcessing - costs.variableCost),
      contributionWith30PctRefundedAttempts: round(afterProcessing - costs.variableCost / .7) };
  })));
const freeAllowances = [
  { grant: 'welcome_once', ...LAUNCH_WELCOME_CREDITS },
  { grant: 'free_calendar_month', idCredits: LAUNCH_PLANS.free.idCredits, gradeCredits: LAUNCH_PLANS.free.gradeCredits },
  { grant: 'welcome_plus_one_free_month', idCredits: LAUNCH_WELCOME_CREDITS.idCredits + LAUNCH_PLANS.free.idCredits,
    gradeCredits: LAUNCH_WELCOME_CREDITS.gradeCredits + LAUNCH_PLANS.free.gradeCredits },
];
const freeUserExposure = scenarios.flatMap(s => freeAllowances.map(grant => {
  const costs = allowanceCost(grant.idCredits, grant.gradeCredits, s);
  return { scenario: s.name, ...grant, ...costs,
    variableCost: round(costs.variableCost),
    costFor100FullyRedeemingAccounts: round(costs.variableCost * 100),
    costFor100With30PctRefundedAttempts: round(costs.variableCost * 100 / .7),
    // Pack purchases are indivisible. This illustration assumes no remaining
    // included or prepaid balance and no other users sharing the new packs.
    prepaidCashFor100FromZeroBalance: s.xRate === 0 ? null : round(
      Math.ceil(costs.ximilarCredits * 100 / x.extraPackCredits) * x.extraPackCost + costs.openaiCost * 100),
  };
}));
const plans = scenarios.flatMap(s => Object.entries(LAUNCH_PLANS).filter(([,p]) => p.monthlyPriceCents).map(([id,p]) => {
  const idCost = x.identify * s.idCalls * s.xRate;
  const gradeCreditCost = Math.max(ai.quick + idCost, (ai.deep + idCost + x.deepGrader * s.xRate) / 2);
  const cost = p.idCredits * idCost + p.gradeCredits * gradeCreditCost;
  const contribution = net(p.monthlyPriceCents, true) - cost;
  return { scenario: s.name, plan: id, monthlyPrice: p.monthlyPriceCents/100, fullAllowanceVariableCost: round(cost), contributionBeforeFixedCosts: round(contribution), contributionPctOfRevenue: round(100 * contribution / (p.monthlyPriceCents/100)) };
}));
const packs = [25,20,15].map(discount => {
  const p = LAUNCH_PACKS.id_1000, cents = centsAfterDiscount(p.basePriceCents, discount);
  const twoIdCost = p.credits * 2 * x.identify * x.extraPackCost / x.extraPackCredits;
  return { businessDiscountProposal: discount, price: cents/100, afterProcessing: round(net(cents)), contributionWithTwoIdCalls: round(net(cents)-twoIdCost), contributionWithTwoIdCallsAnd30PctRefundedAttempts: round(net(cents)-twoIdCost/.7) };
});
console.log(JSON.stringify({ label:'scenario_estimates_not_invoices_or_profit', evidence, assumptions:{ fee,x,ai, fullAllowanceUse:true, deepGraderOnlyOnDeep:true, fixedCostsNotAllocated:true, notes:'Shared $64 quota overhead counted once at company level; zero within-quota variable cost does not mean scans are free. Quota is shared by every user and operation. Extra-pack scenario assumes a separately approved purchase at the observed 10K pack rate; no automatic overage purchase or charge is established. Larger pack rates remain unverified. Excludes other infrastructure, support, tax, disputes, payment refunds, and AI fallback/retry costs. Credit refunds still consume provider resources. 30% sensitivity is hypothetical, not observed; it assumes every refunded attempt costs as much as a delivered operation. Non-expiring credits can be redeemed in later months. Free-user rows are alternative grant scopes, not additive; 100 accounts is a scale illustration, not a forecast or enforced signup cap. Account period boundaries, old balances and additional paid packs can increase exposure. Maximum modeled cost is only across grade-mode mixes at the supplied rates, not a guaranteed spending ceiling.' }, plans,packs,currentPacks,freeUserExposure },null,2));
