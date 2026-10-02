// Operator-only build migration. Not imported by any HTTP handler.
// An exact commit must be armed in branch-scoped Vercel configuration.
// A normal build, Production, or another branch cannot install the fence.
import { pathToFileURL } from 'node:url';
import { membershipRedis, MEMBERSHIP_LEGACY_FENCE } from '../api/_membershipLegacyFence.js';

export const CUTOVER_AUDIT = 'membership:launch-v2:preview_cutover:20261002';
export const CUTOVER_TIME = CUTOVER_AUDIT + ':installed_at';
export const evidence = Object.freeze({
  version: 1,
  environment: 'preview',
  branch: 'feature/launch-membership-v2',
  providerDatabaseId: 'b0de2137-6c5c-41b4-8af4-da80a70ce1c3',
  productionDatabaseId: 'dc621a30-497c-4851-a3c3-42a51309f094',
  isolationEvidence: 'owner-confirmed-provider-resource-ids-and-bindings',
  backup: {
    name: 'preview-before-membership-20261001', size: '25.53 KB',
    status: 'Completed', evidence: 'owner-dashboard-report',
    reportedAt: '2026-10-02T03:48:00Z',
  },
  developmentClients: {
    ownerReport: 'none-running', reportedAt: '2026-10-02T04:16:00Z',
    sandboxInspection: 'no-managed-datastore-development-writer-identified',
  },
  rotation: {
    evidence: 'owner-provider-reset-and-observed-old-credential-401-or-403',
    oldDeployment: 'dpl_AgLNx5wRZmR2QKLbLA9fMkfHqdfv',
    oldCommit: '9678ceb1c8e825fc0b4e5c602e2f4682f81d41c0',
    oldAuthorization: 'rejected',
    replacementDeployment: 'dpl_AB5jxLP69pDnX6apEySJnsShdzhg',
    replacementAuthorization: 'accepted',
    freshCredentialScope: 'sensitive-preview-only-feature/launch-membership-v2',
    productionBindings: 'unchanged',
  },
});

// Record the supplied evidence bytes exactly. No balances, enrollment, grants,
// subscriptions, or prior audit records are read, rewritten or deleted.
const INSTALL = `
local fence=redis.call('GET',KEYS[1])
local audit=redis.call('GET',KEYS[2])
local installed=redis.call('GET',KEYS[3])
if fence or audit or installed then
  if fence=='1' and audit==ARGV[1] and installed and string.match(installed,'^%d+$')
    and redis.call('TTL',KEYS[1])==-1 and redis.call('TTL',KEYS[2])==-1
    and redis.call('TTL',KEYS[3])==-1 then return 'replayed' end
  return 'conflict'
end
local now=redis.call('TIME')
redis.call('SET',KEYS[2],ARGV[1])
redis.call('SET',KEYS[3],now[1])
redis.call('SET',KEYS[1],'1')
return 'installed'
`;

export async function installPreviewWriterFence({ env = process.env, execute = membershipRedis } = {}) {
  const armed = env.MEMBERSHIP_PREVIEW_CUTOVER_COMMIT;
  if (!armed) return { status: 'not_armed' };
  if (env.VERCEL_ENV !== 'preview' || env.VERCEL_GIT_COMMIT_REF !== evidence.branch
    || !/^[a-f0-9]{40}$/.test(armed) || env.VERCEL_GIT_COMMIT_SHA !== armed
    || env.MEMBERSHIP_STRIPE_TEST_ACCOUNT !== 'acct_1Tno55FW2YZoedIZ'
    || env.MEMBERSHIP_STRIPE_TEST_RETURN_ORIGIN !== 'https://cardresell-membership-v2-preview.vercel.app'
    || env.MEMBERSHIP_PURCHASE_TEST_MODE === 'enabled'
    || env.MEMBERSHIP_BILLING_V2 === 'on') {
    throw Error('preview_cutover_scope_rejected');
  }
  const raw = JSON.stringify({ ...evidence, releaseCommit: armed });
  const result = await execute(['EVAL', INSTALL, 3, MEMBERSHIP_LEGACY_FENCE, CUTOVER_AUDIT, CUTOVER_TIME, raw]);
  if (!['installed', 'replayed'].includes(result)) throw Error('preview_cutover_conflict');
  // Unknown acknowledgments are not reset. A subsequent identical build may
  // reconcile only the exact durable audit and fence.
  const readback = await execute(['MGET', MEMBERSHIP_LEGACY_FENCE, CUTOVER_AUDIT, CUTOVER_TIME]);
  if (!Array.isArray(readback) || readback[0] !== '1' || readback[1] !== raw
    || !/^\d+$/.test(readback[2])) throw Error('preview_cutover_readback_pending');
  return { status: result, releaseCommit: armed, installedAt: Number(readback[2]) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log('Preview writer cutover: ' + JSON.stringify(await installPreviewWriterFence())); }
  catch { console.error('Preview writer cutover failed or is uncertain; keep purchasing disabled and reconcile the same commit.'); process.exitCode = 1; }
}
