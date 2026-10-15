#!/usr/bin/env node
// October 14, 2026 planning scenarios. Canonical offers, no provider calls.
// Not invoices, observed failure rates, or realized profit. Never change billing.
import { LAUNCH_PLANS, LAUNCH_PACKS, LAUNCH_WELCOME_CREDITS, quoteLaunchPack } from '../api/_launchMembershipConfig.js';

const fees = { processing: .029, fixed: .30, subscriptionBilling: .007 };
const ximilar = { monthlyFixed: 70, monthlyCredits: 100000, extraPackCost: 99,
  extraPackCredits: 100000, identify: 10, deepGrader: 100 };
// Upper end of the historical six-Quick sample's estimated average. Deep is
// a planning assumption: the retained Deep sample had a failed CV job.
const ai = { quick: .02310, deepAssumption: .04 };
const redemptionBudget = { perIdCredit: .03, perGradeCredit: .16 };
const round = n => Math.round(n * 10000) / 10000;
const net = (cents, subscription = false) => cents / 100 * (1 - fees.processing
  - (subscription ? fees.subscriptionBilling : 0)) - fees.fixed;
const rate = ximilar.extraPackCost / ximilar.extraPackCredits;
const scenarios = [
  { name: 'one_identification_all_quick', idCalls: 1, refundedIdFraction: 0, grade: 'quick' },
  { name: 'two_identifications_30pct_id_refunds_all_deep', idCalls: 2, refundedIdFraction: .3, grade: 'deep' },
  { name: 'same_id_stress_all_deep_fall_back_to_quick', idCalls: 2, refundedIdFraction: .3, grade: 'fallback' },
];
function units(s) {
  const gradeCreditsPerResult = s.grade === 'deep' ? 2 : 1;
  return {
    ximilarPerIdCredit: ximilar.identify * s.idCalls / (1 - s.refundedIdFraction),
    ximilarPerGradeCredit: (ximilar.identify * s.idCalls + (s.grade === 'quick' ? 0 : ximilar.deepGrader)) / gradeCreditsPerResult,
    aiPerGradeCredit: (s.grade === 'quick' ? ai.quick : ai.deepAssumption) / gradeCreditsPerResult,
  };
}
function usage(idCredits, gradeCredits, s) {
  const u = units(s);
  return { ximilarCredits: idCredits * u.ximilarPerIdCredit + gradeCredits * u.ximilarPerGradeCredit,
    openai: gradeCredits * u.aiPerGradeCredit };
}
function marginalRow(priceCents, idCredits, gradeCredits, subscription, s) {
  const use = usage(idCredits, gradeCredits, s);
  const variableCost = use.ximilarCredits * rate + use.openai;
  const contribution = net(priceCents, subscription) - variableCost;
  return { price: priceCents / 100, estimatedPaymentFees: round(priceCents / 100 - net(priceCents, subscription)),
    fullUseVariableCost: round(variableCost), contributionBeforeOtherCosts: round(contribution),
    contributionPercentOfGross: round(100 * contribution / (priceCents / 100)) };
}
const paid = Object.entries(LAUNCH_PLANS).filter(([, p]) => p.monthlyPriceCents > 0);
const plans = scenarios.flatMap(s => paid.map(([plan, p]) => ({ scenario: s.name, plan,
  ...marginalRow(p.monthlyPriceCents, p.idCredits, p.gradeCredits, true, s) })));
const packs = scenarios.flatMap(s => ['free', 'casual', 'pro', 'business'].flatMap(plan =>
  Object.keys(LAUNCH_PACKS).map(id => {
    const p = quoteLaunchPack(id, plan);
    return { scenario: s.name, plan, pack: id, credits: p.credits,
      ...marginalRow(p.amountCents, p.kind === 'id' ? p.credits : 0, p.kind === 'grade' ? p.credits : 0, false, s) };
  })));
const budgetedPlans = paid.map(([plan, p]) => {
  const budget = p.idCredits * redemptionBudget.perIdCredit + p.gradeCredits * redemptionBudget.perGradeCredit;
  const remaining = net(p.monthlyPriceCents, true) - budget;
  return { plan, price: p.monthlyPriceCents / 100, redemptionBudget: round(budget),
    remainingBeforeOtherCosts: round(remaining), percentOfGross: round(100 * remaining / (p.monthlyPriceCents / 100)) };
});
// Company scenarios count the $70 once and charge extra blocks only beyond the
// shared 100k quota. They do NOT add the marginal allocations above again.
const mixes = [
  { name: '10_pro_plus_100_monthly_free', accounts: { pro: 10, free: 100 }, welcome: 0 },
  { name: '10_pro_plus_100_new_free', accounts: { pro: 10, free: 100 }, welcome: 100 },
  { name: '50_pro_plus_250_monthly_free', accounts: { pro: 50, free: 250 }, welcome: 0 },
  { name: '10_business_plus_100_monthly_free', accounts: { business: 10, free: 100 }, welcome: 0 },
];
const company = scenarios.flatMap(s => mixes.map(mix => {
  let revenue = 0, paymentNet = 0, idCredits = mix.welcome * LAUNCH_WELCOME_CREDITS.idCredits,
    gradeCredits = mix.welcome * LAUNCH_WELCOME_CREDITS.gradeCredits;
  for (const [id, count] of Object.entries(mix.accounts)) {
    const p = LAUNCH_PLANS[id];
    revenue += count * p.monthlyPriceCents / 100;
    if (p.monthlyPriceCents) paymentNet += count * net(p.monthlyPriceCents, true);
    idCredits += count * p.idCredits; gradeCredits += count * p.gradeCredits;
  }
  const use = usage(idCredits, gradeCredits, s);
  const extraCredits = Math.max(0, use.ximilarCredits - ximilar.monthlyCredits);
  const extraPacks = Math.ceil(extraCredits / ximilar.extraPackCredits);
  const xCash = ximilar.monthlyFixed + extraPacks * ximilar.extraPackCost;
  return { scenario: s.name, mix: mix.name, grossBillings: round(revenue),
    estimatedPaymentFees: round(revenue - paymentNet), ximilarCredits: round(use.ximilarCredits),
    openaiEstimate: round(use.openai), ximilarCashWithNoPackCarryIn: xCash,
    extra100kPacks: extraPacks, extraPackCreditsRemaining: round(extraPacks * ximilar.extraPackCredits - extraCredits),
    cashRemainingBeforeOtherCosts: round(paymentNet - use.openai - xCash) };
}));
console.log(JSON.stringify({ label: 'planning_scenarios_not_invoices_or_profit', asOf: '2026-10-14',
  assumptions: { fees, ximilar, ai, redemptionBudget, fullAllowanceUse: true,
    sources: ['https://www.ximilar.com/pricing/', 'https://stripe.com/pricing/local-payment-methods', 'https://stripe.com/billing/pricing'],
    notes: [
      'Ximilar $70 is owner-confirmed; public 100k list price is $69. Use $70 for budgeting.',
      'All marginal rows use the $99/100k incremental rate; do not subtract the $70 again from those rows.',
      'Company cash rows count the $70 once and buy whole 100k packs, with no carry-in. Unused pack credits remain available for later usage.',
      'Hypothetical 30% refunded ID attempts cost provider credits but do not consume customer credits. This is not the observed miss rate.',
      'Deep fallback stress budgets the full 100-credit CV job even when it fails, with one customer Grade credit charged. Actual failed-job billing is unverified.',
      'Quick AI input is a historical six-attempt estimated average upper endpoint, not a ceiling. Deep AI cost is an assumption, not a successful-Deep benchmark.',
      'Extra OpenAI fallback calls, fully refunded grade attempts, payment refunds/disputes, non-domestic cards, taxes, data feeds, infrastructure, support and acquisition are excluded.',
      'Provider subscription credits expire monthly; customer credits do not. Model full future redemption separately from current cash margin.',
      'The redemption budget is a planning sensitivity, not an accounting valuation or a guaranteed maximum cost.',
    ] }, scenarios: scenarios.map(s => ({ ...s, units: units(s) })), plans, packs, budgetedPlans, company }, null, 2));
