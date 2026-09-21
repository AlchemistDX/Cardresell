// Normal-route dispatch. OFF by default, and a durable fence also prevents
// rollback into legacy writers. No enrollment, flag changes, or Stripe calls.
import * as legacy from './_idBilling.js';
import { createMembershipConsumption, MembershipConsumptionError } from './_membershipConsumption.js';
import { membershipRedis, membershipRouteMode } from './_membershipLegacyFence.js';
import { grantMembership } from './_membershipLedger.js';
import { createMembershipFreeIssuance } from './_membershipFreeIssuance.js';
export { newIdReceipt, candidateHash, idBillingFailure } from './_idBilling.js';
export { membershipRouteMode } from './_membershipLegacyFence.js';

const consumeMembership = createMembershipConsumption({ execute: membershipRedis });
export const issueMembershipFree = createMembershipFreeIssuance({ execute: membershipRedis });
export async function membershipBilling(action, input) {
  if (['snapshot', 'renew_free'].includes(action)) {
    await issueMembershipFree(input?.owner);
  }
  return consumeMembership(action, input);
}
export async function idEntitlement(user) {
  return await membershipRouteMode() ? {} : legacy.idEntitlement(user);
}
export async function idBilling(action, input) {
  return await membershipRouteMode() ? membershipBilling(action, input) : legacy.idBilling(action, input);
}
export async function offerIdConfirmation(context, candidates, uncharged = false) {
  if (!await membershipRouteMode()) return legacy.offerIdConfirmation(context, candidates, uncharged);
  if (!Array.isArray(candidates)) throw new MembershipConsumptionError('invalid_candidates');
  const offered = candidates.map(c => ({ hash: legacy.candidateHash(c), card: legacy.canonicalPick(c, context.cardType) }));
  const candidate_set = legacy.candidateHash(offered.map(c => c.hash));
  const result = await membershipBilling('offer', { ...context, candidates: offered, candidate_set });
  if (!result.ok) throw new MembershipConsumptionError(result.code);
  return { confirmation_id: context.receipt, scan_id: context.scan, candidate_set, confirmation_expires_at: result.expires };
}
export async function claimIdRetry(context, retryOf) {
  if (!await membershipRouteMode()) return legacy.claimIdRetry(context, retryOf);
  const raw = await membershipRedis(['GET', `scan:${retryOf}`]);
  if (raw === null) return false;
  let prior;
  try { prior = JSON.parse(raw); } catch { throw new MembershipConsumptionError(); }
  const mode = context.mode || 'identify', cost = context.cost || 1;
  if (!prior || prior.uid !== context.owner || prior.billing_version !== 'launch-v2'
    || prior.mode !== mode || prior.consumed_amount !== cost || !/^[a-f0-9]{64}$/.test(prior.membership_receipt)) return false;
  const result = await membershipBilling('claim_retry', { owner: context.owner, mode, cost,
    bulkGrade: context.bulkGrade === true,
    receipt: prior.membership_receipt, scan: retryOf, retry_receipt: context.receipt, retry_scan: context.scan });
  if (!result.ok) throw new MembershipConsumptionError(result.code);
  return result.claimed === true;
}
export async function publishMembershipScan(context, record) {
  const result = await membershipBilling('publish', { ...context, scanRecord: record });
  if (!result.ok) throw new MembershipConsumptionError(result.code);
  return result;
}
export async function membershipWelcome(owner, email) {
  // Caller has completed normal server token/code verification.
  // The approved ledger replays its immutable original result. Distinguish that
  // from a NEW welcome award for the normal UI, in the same Redis operation.
  // Its Lua body and financial writes are not modified.
  let replayed;
  const result = await grantMembership(async command => {
    const script = "local prior=redis.call('EXISTS',KEYS[1])\nlocal function grant()\n"
      + command[1] + '\nend\nlocal response=grant()\nreturn {prior,response}';
    const raw = await membershipRedis([command[0], script, ...command.slice(2)]);
    if (!Array.isArray(raw) || ![0, 1].includes(raw[0]) || typeof raw[1] !== 'string') throw new MembershipConsumptionError();
    replayed = raw[0] === 1;
    return raw[1];
  }, 'welcome', { owner, email, verified: true });
  return { ...result, newlyGranted: result.granted && !replayed };
}
export async function membershipBalances(owner) {
  const context = { owner, receipt: '0'.repeat(64), scan: 'read-only-balance' };
  const id = await membershipBilling('snapshot', context);
  const grade = await membershipBilling('snapshot', { ...context, mode: 'grade' });
  if (!id.ok || !grade.ok) throw new MembershipConsumptionError('membership_not_ready');
  if (id.period_start !== grade.period_start || id.period_end !== grade.period_end
    || id.period_active !== grade.period_active || id.plan !== grade.plan
    || id.bulk_grade !== grade.bulk_grade) throw new MembershipConsumptionError();
  const tier = id.period_active ? id.plan : 'free';
  return { credits: grade.remaining, idCredits: id.remaining, paidCredits: grade.purchased,
    idPaidCredits: id.purchased, freeCredits: grade.monthly + grade.welcome,
    idFreeCredits: id.monthly + id.welcome, included: { id: id.monthly, grade: grade.monthly },
    welcome: { id: id.welcome, grade: grade.welcome }, purchased: { id: id.purchased, grade: grade.purchased },
    capabilities: { bulkGrade: id.bulk_grade },
    periodEnd: id.period_end, tier, isPro: tier !== 'free', entitlementStatus: id.period_active ? 'active' : 'expired',
    kvAvailable: true, billing_version: 'launch-v2' };
}
