// Build-only, read-only inspection. No HTTP route, authentication substitute,
// credential export, customer creation, database write, or financial effect.
import { createHash } from 'node:crypto';
import { membershipEnvironment } from '../api/_membershipEnvironment.js';
import { membershipRedis, MEMBERSHIP_LEGACY_FENCE } from '../api/_membershipLegacyFence.js';
import { membershipEnrollmentKey } from '../api/_membershipConsumption.js';
import { createMembershipCustomers } from '../api/_membershipCustomer.js';
import { CUTOVER_AUDIT, CUTOVER_TIME, evidence } from './install-preview-writer-fence.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const PRODUCTION_ENDPOINT_HASH = '40dfd723a1c95ebf3a938caa2bf54cd041d9850e4a979f64a1a1ee995a53069b';
export async function inspectMembershipPreview({
  env = process.env, execute = membershipRedis, fetchImpl = fetch,
} = {}) {
  if (env.VERCEL_ENV !== 'preview' || env.VERCEL_GIT_COMMIT_REF !== evidence.branch
    || !/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA || '')
    || env.MEMBERSHIP_PREVIEW_INSPECT_COMMIT !== env.VERCEL_GIT_COMMIT_SHA) throw Error('preview_inspect_scope');
  // Validate the credentials/catalogue independently of purchase activation.
  // This copied object never reaches a route or changes the deployment flag.
  const config = membershipEnvironment({ ...env, MEMBERSHIP_PURCHASE_TEST_MODE: 'enabled' }, 'test');
  if (config.accountId !== 'acct_1Tno55FW2YZoedIZ'
    || config.returnOrigin !== 'https://cardresell-membership-v2-preview.vercel.app') throw Error('preview_inspect_scope');
  let endpoint;
  try { endpoint = new URL(env.KV_REST_API_URL); } catch { throw Error('preview_datastore_invalid'); }
  if (endpoint.protocol !== 'https:' || !/^[a-z0-9-]+\.upstash\.io$/.test(endpoint.hostname)
    || endpoint.username || endpoint.password || endpoint.port || endpoint.pathname !== '/'
    || endpoint.search || endpoint.hash) throw Error('preview_datastore_invalid');
  const endpointHash = hash(endpoint.origin);
  if (endpointHash === PRODUCTION_ENDPOINT_HASH) throw Error('preview_production_datastore_collision');
  const read = async args => {
    if (!['GET', 'MGET', 'TTL'].includes(args[0])) throw Error('readonly_inspection');
    return execute(args);
  };
  const [fence, rawAudit, installed] = await read(['MGET', MEMBERSHIP_LEGACY_FENCE, CUTOVER_AUDIT, CUTOVER_TIME]);
  let audit;
  try { audit = JSON.parse(rawAudit); } catch { throw Error('preview_cutover_audit_invalid'); }
  if (fence !== '1' || !/^\d+$/.test(installed || '') || !audit
    || !/^[a-f0-9]{40}$/.test(audit.releaseCommit || '')
    || JSON.stringify(audit) !== JSON.stringify({ ...evidence, releaseCommit: audit.releaseCommit })) {
    throw Error('preview_cutover_audit_invalid');
  }
  for (const key of [MEMBERSHIP_LEGACY_FENCE, CUTOVER_AUDIT, CUTOVER_TIME]) {
    if (await read(['TTL', key]) !== -1) throw Error('preview_cutover_audit_expiring');
  }
  const get = async path => {
    const response = await fetchImpl('https://api.stripe.com/v1/' + path, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Authorization: 'Bearer ' + config.apiKey, 'Stripe-Version': '2026-08-26.dahlia' },
    });
    if (!response.ok) return { httpStatus: response.status, available: false };
    const data = await response.json();
    return { httpStatus: response.status, available: true, data };
  };
  const account = await get('account');
  if (!account.available || account.data?.id !== config.accountId || account.data.object !== 'account') {
    throw Error('preview_stripe_account_unconfirmed');
  }
  const owners = JSON.parse(env.MEMBERSHIP_TEST_NEW_CUSTOMER_OWNERS || '[]');
  if (!Array.isArray(owners) || owners.length !== 1 || owners[0] !== 'fzUpcrXKDdQzGORl0bLQ6mTwML73') {
    throw Error('preview_owner_scope');
  }
  const customers = createMembershipCustomers({ execute: read, accountId: config.accountId,
    livemode: false, allowCreate: async () => false });
  const customer = await customers.get(owners[0]);
  const rawEnrollment = await read(['GET', membershipEnrollmentKey(owners[0])]);
  let enrollment = null;
  if (rawEnrollment !== null) {
    try { enrollment = JSON.parse(rawEnrollment); } catch { throw Error('preview_enrollment_invalid'); }
    if (enrollment?.owner !== owners[0] || enrollment.version !== 'launch-v2') throw Error('preview_enrollment_invalid');
  }
  const clocks = await get('test_helpers/test_clocks?limit=10');
  const prices = await get('prices?limit=100&active=true');
  const endpoints = await get('webhook_endpoints?limit=100');
  const result = {
    commit: env.VERCEL_GIT_COMMIT_SHA, environment: 'preview', branch: evidence.branch,
    purchasingEnabled: env.MEMBERSHIP_PURCHASE_TEST_MODE === 'enabled',
    datastore: { endpointHash, distinctFromProduction: true, cutoverAuditVerified: true,
      providerDatabaseId: audit.providerDatabaseId, cutoverCommit: audit.releaseCommit,
      installedAt: Number(installed), permanentFence: true },
    owner: { enrollmentPresent: !!enrollment, plan: enrollment?.plan ?? null,
      verified: enrollment?.verified === true, customerState: customer?.state ?? 'absent',
      customerId: customer?.customerId ?? null },
    stripe: {
      accountId: config.accountId, livemode: false,
      clocks: { httpStatus: clocks.httpStatus, available: clocks.available,
        items: (clocks.data?.data || []).map(x => ({ id: x.id, status: x.status, frozenTime: x.frozen_time })) },
      prices: { httpStatus: prices.httpStatus, hasMore: prices.data?.has_more ?? null,
        legacyMonthly999Candidates: (prices.data?.data || []).filter(x => x.livemode === false
          && x.unit_amount === 999 && x.currency === 'usd' && x.recurring?.interval === 'month'
          && x.recurring.interval_count === 1 && x.id !== config.priceMap.plans.casual.priceId)
          .map(x => ({ id: x.id, productId: x.product })) },
      webhooks: { httpStatus: endpoints.httpStatus,
        items: (endpoints.data?.data || []).map(x => ({ id: x.id, livemode: x.livemode,
          status: x.status, url: x.url, apiVersion: x.api_version, events: x.enabled_events })) },
    },
  };
  return result;
}
