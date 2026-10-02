// Operator-only executable. Not an HTTP handler or an ordinary build hook.
// inspect is read-only. apply/schedule require an exact armed commit plus
// externally verified completed backup and old-credential rejection evidence.
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { membershipEnvironment } from '../api/_membershipEnvironment.js';
import { membershipRedis } from '../api/_membershipLegacyFence.js';
import { createMembershipStripeTransport, MEMBERSHIP_STRIPE_API_VERSION } from '../api/_membershipStripe.js';
import { createMembershipLifecycleStripe } from '../api/_membershipLifecycleStripe.js';
import { createMembershipCustomerStripe } from '../api/_membershipCustomerStripe.js';
import { createMembershipCustomers } from '../api/_membershipCustomer.js';
import { createMembershipOwnerImport, readOwnerImport } from '../api/_membershipOwnerImport.js';
import { createMembershipOwnerMigration } from '../api/_membershipOwnerMigration.js';
import { grantMembership } from '../api/_membershipLedger.js';
import { reconcilePaidEnrollment } from '../api/_membershipPaidEnrollment.js';
import { createMembershipConsumption } from '../api/_membershipConsumption.js';
const sha = x => createHash('sha256').update(x).digest('hex');
const insist = (v, code) => { if (!v) throw Error(code); };
export const OWNER = 'fzUpcrXKDdQzGORl0bLQ6mTwML73';
export const PRODUCTION_DATABASE = 'dc621a30-497c-4851-a3c3-42a51309f094';
export const CUTOVER_KEY = 'membership:launch-v2:production_cutover:20261002';
export const authorization = Object.freeze({
  owner: OWNER, customerId: 'cus_UqILx52TtoCldY', subscriptionId: 'sub_1TqbkwFW2YZoedIZGKzsOLjn',
  priceId: 'price_1TnrRWFW2YZoedIZaXDoJWje', productId: 'prod_UnSMF2wjDyk5PX',
  periodStart: 1788798116, periodEnd: 1791390116,
  evidenceId: sha('owner-authorized-single-subscription-transition-20261002T133500Z'),
  approvedAt: 1790948100,
});
const INSTALL = `
local fence=redis.call('GET',KEYS[1]); local audit=redis.call('GET',KEYS[2])
if fence or audit then
 if fence=='1' and audit==ARGV[1] and redis.call('TTL',KEYS[1])==-1
   and redis.call('TTL',KEYS[2])==-1 then return 2 end
 return 0
end
redis.call('MSET',KEYS[1],'1',KEYS[2],ARGV[1]); return 1`;
export function validateProductionCutoverEvidence(value, commit) {
  insist(value?.version === 1 && value.environment === 'production'
    && value.providerDatabaseId === PRODUCTION_DATABASE && value.releaseCommit === commit
    && value.backup?.status === 'Completed' && typeof value.backup.name === 'string'
    && value.backup.name.length > 0
    && value.backup.evidence === 'owner-dashboard-report'
    && value.backup.completedAt === null
    && Number.isSafeInteger(value.backup.completionObservedAt)
    && value.backup.completionObservedAt >= authorization.approvedAt
    && value.rotation?.oldAuthorization === 'rejected'
    && [401, 403].includes(value.rotation.httpStatus)
    && /^dpl_[A-Za-z0-9]+$/.test(value.rotation.oldDeployment)
    && typeof value.rotation.evidenceId === 'string' && /^[a-f0-9]{64}$/.test(value.rotation.evidenceId),
  'production_backup_and_revocation_evidence_required');
  return JSON.stringify(value);
}
export async function transitionMembershipOwner({ stage = 'inspect', env = process.env,
  execute = membershipRedis, fetchImpl = fetch } = {}) {
  insist(['inspect', 'apply', 'schedule'].includes(stage), 'invalid_stage');
  insist(env.VERCEL_ENV === 'production', 'production_only');
  const config = membershipEnvironment(env, 'live');
  insist(config.accountId === 'acct_1Tno55FW2YZoedIZ', 'account_mismatch');
  const base = { ...config, livemode: true, fetchImpl, apiVersion: MEMBERSHIP_STRIPE_API_VERSION };
  const reader = createMembershipStripeTransport(base);
  const legacySubscription = Object.fromEntries(['owner', 'customerId', 'subscriptionId', 'priceId',
    'productId', 'periodStart', 'periodEnd'].map(k => [k, authorization[k]]));
  const commands = createMembershipLifecycleStripe({ ...base, execute, reader, legacySubscription });
  const stripe = { ...reader, ...commands };
  const snapshot = await stripe.retrieveLegacySubscriptionSnapshot(authorization.subscriptionId);
  insist(snapshot.customerId === authorization.customerId && snapshot.periodEnd === authorization.periodEnd,
    'legacy_renewal_changed');
  const raw = await execute(['GET', `pro:${OWNER}`]);
  const old = JSON.parse(raw);
  insist(old?.subscriptionId === authorization.subscriptionId && old.status === 'active', 'legacy_owner_mismatch');
  const imported = await readOwnerImport(execute, config.accountId, true, OWNER);
  if (stage === 'inspect') return { stage, mutated: false, legacyTier: old.tier || 'pro',
    subscriptionId: snapshot.subscriptionId, customerId: snapshot.customerId,
    currentPeriodStart: snapshot.periodStart, currentPeriodEnd: snapshot.periodEnd,
    schedulePresent: snapshot.scheduleId !== null, imported: !!imported,
    fence: await execute(['GET', 'membership:launch-v2:legacy_fence']),
    legacyDigest: sha(raw), backupRequired: true };
  const commit = env.MEMBERSHIP_OWNER_TRANSITION_COMMIT;
  insist(/^[a-f0-9]{40}$/.test(commit || '') && commit === env.VERCEL_GIT_COMMIT_SHA
    && env.MEMBERSHIP_PURCHASE_LIVE_MODE !== 'enabled'
    && env.MEMBERSHIP_CUTOVER_PAUSED === 'enabled', 'transition_not_armed_or_purchasing_active');
  let evidence; try { evidence = JSON.parse(env.MEMBERSHIP_OWNER_TRANSITION_EVIDENCE); } catch {}
  const cutover = validateProductionCutoverEvidence(evidence, commit);
  if (stage === 'apply') {
    const installed = await execute(['EVAL', INSTALL, 2,
      'membership:launch-v2:legacy_fence', CUTOVER_KEY, cutover]);
    insist([1, 2].includes(installed), 'cutover_conflict');
    await createMembershipOwnerImport({ execute, accountId: config.accountId, livemode: true,
      authorization, stripe, cutoverKey: CUTOVER_KEY, cutoverDigest: sha(cutover) })();
  } else insist(await execute(['GET', CUTOVER_KEY]) === cutover && imported, 'import_required_before_schedule');
  const current = await readOwnerImport(execute, config.accountId, true, OWNER);
  insist(current, 'import_readback_required');
  const customerStripe = createMembershipCustomerStripe({ ...base, reader });
  const customers = createMembershipCustomers({ execute, accountId: config.accountId, livemode: true,
    stripe: customerStripe, allowCreate: async () => false, authorizeExisting: async owner => {
      insist(owner === OWNER, 'owner_mismatch');
      return { owner, accountId: config.accountId, livemode: true,
        customerId: authorization.customerId, evidenceId: current.digest, approvedAt: current.data.importedAt * 1000 };
    } });
  await customers.bindAuditedExisting(OWNER);
  const consumption = createMembershipConsumption({ execute });
  const balances = {};
  for (const mode of ['identify', 'grade']) {
    const s = await consumption('snapshot', { owner: OWNER, mode, receipt: '0'.repeat(64), scan: 'operator-import-check' });
    insist(s.ok, 'import_consumption_readback_required');
    balances[mode] = { included: s.monthly, welcome: s.welcome, standing: s.purchased, total: s.remaining };
  }
  if (stage === 'apply') return { stage, status: 'imported_and_bound', newlyAwarded: { id: 0, grade: 0 }, balances };
  const migration = createMembershipOwnerMigration({ execute, accountId: config.accountId, livemode: true,
    authorization, customers, stripe, priceMap: config.priceMap, fulfill: async (kind, envelope) => {
      const result = await grantMembership(execute, kind, envelope);
      if (kind === 'period') await reconcilePaidEnrollment(execute, envelope.owner, envelope.subscriptionId);
      return result;
    } });
  return { stage, ...await migration.schedule({ owner: OWNER }), balances };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log('OWNER_TRANSITION ' + JSON.stringify(await transitionMembershipOwner({
    stage: process.argv[2] || 'inspect' }))); }
  catch (e) {
    console.error('OWNER_TRANSITION ' + (/^[a-z_]+$/.test(e?.message || '') ? e.message : 'unconfirmed'));
    process.exitCode = 1;
  }
}
