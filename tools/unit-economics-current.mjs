#!/usr/bin/env node
// Scenario planning, not realized profit. Canonical prices; no provider calls.
import { LAUNCH_PLANS, LAUNCH_PACKS } from '../api/_launchMembershipConfig.js';
const fee = { processing: .029, fixed: .30, subscriptionBilling: .007 };
const x = { monthlyFixed: 69, monthlyCredits: 100000, extraPackCost: 99, extraPackCredits: 100000, identify: 10, deepGrader: 100 };
// Small historical live sample; not an average or an upper bound. See Oct 7 handoff.
const ai = { quick: .017, deep: .03 };
const centsAfterDiscount = (base, discount) => Math.floor((base * (100 - discount) + 50) / 100);
const net = (cents, subscription = false) => cents / 100 * (1 - fee.processing - (subscription ? fee.subscriptionBilling : 0)) - fee.fixed;
const round = n => Math.round(n * 10000) / 10000;
const scenarios = [
  { name: 'within_shared_monthly_quota', xRate: 0, idCalls: 1 },
  { name: 'extra_pack_two_identifications_per_operation', xRate: x.extraPackCost / x.extraPackCredits, idCalls: 2 },
];
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
console.log(JSON.stringify({ label:'scenario_estimates_not_invoices_or_profit', assumptions:{ fee,x,ai, fullAllowanceUse:true, deepGraderOnlyOnDeep:true, fixedCostsNotAllocated:true, notes:'Shared $69 quota overhead counted once at company level. Extra-pack scenario prices incremental credits, not the quota twice. Larger Ximilar packs/plans may be cheaper. Excludes other infrastructure, support, tax, disputes, payment refunds, and AI fallback/retry costs. Credit refunds still consume provider resources. 30% sensitivity is hypothetical, not observed. Non-expiring credits can be redeemed in later months.' }, plans,packs },null,2));
