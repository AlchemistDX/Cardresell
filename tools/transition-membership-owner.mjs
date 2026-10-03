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
import { grantMembership, membershipIncludedHistoryKey, membershipWelcomeKeys } from '../api/_membershipLedger.js';
import { reconcilePaidEnrollment } from '../api/_membershipPaidEnrollment.js';
import { createMembershipConsumption, membershipEnrollmentKey } from '../api/_membershipConsumption.js';
import { readMembershipVerification } from '../api/_membershipVerification.js';
import { inspectMembershipCheckout } from './inspect-membership-checkout.mjs';
import { reconcileOwnerPaidCheckout } from './reconcile-owner-paid-checkout.mjs';
const sha = x => createHash('sha256').update(x).digest('hex');
const insist = (v, code) => { if (!v) throw Error(code); };
export const OWNER = 'fzUpcrXKDdQzGORl0bLQ6mTwML73';
export const PRODUCTION_DATABASE = 'dc621a30-497c-4851-a3c3-42a51309f094';
// Observed from the old Production deployment before/after provider rotation.
// This is an endpoint-origin digest, never a credential digest.
export const PRODUCTION_ENDPOINT_DIGEST = '40dfd723a1c95ebf3a938caa2bf54cd041d9850e4a979f64a1a1ee995a53069b';
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
    && value.rotation.datastoreEndpointDigest === PRODUCTION_ENDPOINT_DIGEST
    && [401, 403].includes(value.rotation.httpStatus)
    && /^dpl_[A-Za-z0-9]+$/.test(value.rotation.oldDeployment)
    && typeof value.rotation.evidenceId === 'string' && /^[a-f0-9]{64}$/.test(value.rotation.evidenceId),
  'production_backup_and_revocation_evidence_required');
  return JSON.stringify(value);
}
async function inspectImportComparisons(execute) {
  const clock = await execute(['TIME']), now = Number(clock[0]), date = new Date(now * 1000);
  const stamp = `${date.getUTCFullYear()}_${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  const start = Math.max(authorization.periodStart, Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000);
  const welcome = membershipWelcomeKeys(OWNER);
  const keys = [CUTOVER_KEY, `pro:${OWNER}`, `scans:${OWNER}:id_free_used_${stamp}`,
    `scans:${OWNER}:free_used_${stamp}`, `scans:${OWNER}:id_paid_left`, `scans:${OWNER}:paid_left`,
    `signup_bonus:${OWNER}`, welcome.id, welcome.grade, membershipEnrollmentKey(OWNER),
    membershipIncludedHistoryKey(OWNER), 'membership:launch-v2:active:' + sha(OWNER),
    'membership:launch-v2:subscription:' + sha(authorization.subscriptionId),
    'membership:launch-v2:period:' + sha(`${authorization.subscriptionId}:${start}`)];
  const observed = await Promise.all(keys.map(key => execute(['GET', key])));
  const script = `
local p=cjson.decode(ARGV[1]); local rows={}
for i,key in ipairs(KEYS) do
 local raw=redis.call('GET',key); local before=p[i]
 local matches=not ((not before.exists and raw) or (before.exists and raw~=before.value))
 table.insert(rows,{slot=i,redisType=type(raw),expectedPresent=before.exists,matches=matches})
end
return cjson.encode({rows=rows,fence=redis.call('GET','membership:launch-v2:legacy_fence'),
 fenceTTL=redis.call('TTL','membership:launch-v2:legacy_fence')})`;
  return JSON.parse(await execute(['EVAL', script, keys.length, ...keys,
    JSON.stringify(observed.map(value => ({ exists: value !== null, value: value ?? '' })))]));
}
async function inspectVerification(execute) {
  const raw = await execute(['GET', `email_verified:${OWNER}`]);
  const alias = await execute(['GET', `verified_email:${OWNER}`]);
  let record; try { record = JSON.parse(raw); } catch {}
  return { present: raw !== null, rawType: typeof raw,
    recordType: record === null ? 'null' : Array.isArray(record) ? 'array' : typeof record,
    via: ['code', 'firebase_link'].includes(record?.via) ? record.via : 'unrecognized',
    validTimestamp: typeof record?.verifiedAt === 'string' && Number.isFinite(Date.parse(record.verifiedAt)),
    hasEmail: typeof record?.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email),
    aliasPresent: alias !== null, aliasMatches: typeof record?.email === 'string' && alias === record.email,
    acceptedByMembershipReader: !!await readMembershipVerification(execute, OWNER),
    mutated: false };
}
export async function transitionMembershipOwner({ stage = 'inspect', env = process.env,
  execute = membershipRedis, fetchImpl = fetch } = {}) {
  insist(['inspect', 'apply', 'schedule'].includes(stage), 'invalid_stage');
  insist(env.VERCEL_ENV === 'production', 'production_only');
  let endpoint;
  try { endpoint = new URL(env.KV_REST_API_URL); } catch {}
  insist(endpoint?.protocol === 'https:' && !endpoint.username && !endpoint.password
    && !endpoint.port && endpoint.pathname === '/' && !endpoint.search && !endpoint.hash
    && sha(endpoint.origin) === PRODUCTION_ENDPOINT_DIGEST, 'production_datastore_mismatch');
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
  const recoverCheckout = env.MEMBERSHIP_OWNER_CHECKOUT_RECOVERY === 'enabled';
  if (recoverCheckout) insist(stage === 'inspect' && /^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA || '')
    && env.MEMBERSHIP_OWNER_CHECKOUT_RECOVERY_COMMIT === env.VERCEL_GIT_COMMIT_SHA
    && imported?.authorization.owner === OWNER, 'checkout_recovery_not_armed');
  let paidReconciliation;
  if (env.MEMBERSHIP_OWNER_PAID_RECONCILE === 'enabled') {
    insist(stage === 'inspect' && /^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA || '')
      && env.MEMBERSHIP_OWNER_PAID_RECONCILE_COMMIT === env.VERCEL_GIT_COMMIT_SHA
      && env.MEMBERSHIP_PURCHASE_LIVE_MODE === 'disabled' && imported?.authorization.owner === OWNER,
    'paid_reconciliation_not_armed');
    paidReconciliation = await reconcileOwnerPaidCheckout({ execute, config, fetchImpl });
  }
  if (stage === 'inspect') return { stage, mutated: !!paidReconciliation, legacyTier: old.tier || 'pro',
    subscriptionId: snapshot.subscriptionId, customerId: snapshot.customerId,
    currentPeriodStart: snapshot.periodStart, currentPeriodEnd: snapshot.periodEnd,
    schedulePresent: snapshot.scheduleId !== null, imported: !!imported,
    fence: await execute(['GET', 'membership:launch-v2:legacy_fence']),
    legacyDigest: sha(raw), backupRequired: true,
    importComparisonReadOnly: await inspectImportComparisons(execute),
    verificationReadOnly: await inspectVerification(execute),
    checkoutInspection: await inspectMembershipCheckout({ execute, config, owner: OWNER, fetchImpl, recover: recoverCheckout }),
    paidReconciliation };
  const commit = env.MEMBERSHIP_OWNER_TRANSITION_COMMIT;
  insist(/^[a-f0-9]{40}$/.test(commit || '') && commit === env.VERCEL_GIT_COMMIT_SHA
    && env.MEMBERSHIP_PURCHASE_LIVE_MODE !== 'enabled'
    && env.MEMBERSHIP_CUTOVER_PAUSED === 'enabled', 'transition_not_armed_or_purchasing_active');
  let evidence; try { evidence = JSON.parse(env.MEMBERSHIP_OWNER_TRANSITION_EVIDENCE); } catch {}
  const cutover = validateProductionCutoverEvidence(evidence, evidence?.releaseCommit);
  // Bounded correction bridge: the failed first import installed this receipt
  // but no owner authority. Keep those exact historical bytes; never replace
  // them with a fabricated new rotation or backup record.
  insist(evidence.releaseCommit === commit || (evidence.releaseCommit === '7b1e0fd93e21b84c763fade15b5014612faacedd'
    && await execute(['GET', CUTOVER_KEY]) === cutover), 'cutover_commit_bridge_unconfirmed');
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
