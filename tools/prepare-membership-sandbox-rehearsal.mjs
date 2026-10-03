// One explicitly named sandbox fixture, not a customer migration framework.
// No route imports this operator. Real owner identities and live mode are denied.
// A lost POST acknowledgment is permanently held for read-only reconciliation.
import { createHash } from 'node:crypto';
import { inspectMembershipPreview } from './inspect-membership-preview.mjs';
import { membershipEnvironment } from '../api/_membershipEnvironment.js';
import { membershipRedis } from '../api/_membershipLegacyFence.js';
const sha = value => createHash('sha256').update(value).digest('hex');
const PREFIX = 'membership:launch-v2:sandbox-rehearsal:20261003:';
const CAS = `if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end
redis.call('SET',KEYS[1],ARGV[2]);return 1`;
export async function prepareMembershipSandboxRehearsal({
  env = process.env, execute = membershipRedis, fetchImpl = fetch,
} = {}) {
  if (env.MEMBERSHIP_SANDBOX_REHEARSAL_COMMIT !== env.VERCEL_GIT_COMMIT_SHA
    || !/^[a-f0-9]{40}$/.test(env.MEMBERSHIP_SANDBOX_REHEARSAL_COMMIT || '')) throw Error('sandbox_rehearsal_scope');
  const inspected = await inspectMembershipPreview({ env: { ...env,
    MEMBERSHIP_PREVIEW_INSPECT_COMMIT: env.MEMBERSHIP_SANDBOX_REHEARSAL_COMMIT }, execute, fetchImpl });
  const config = membershipEnvironment(env, 'test');
  if (!inspected.datastore.cutoverAuditVerified || !inspected.datastore.distinctFromProduction) throw Error('sandbox_rehearsal_scope');
  const report = { environment: 'preview', livemode: false, commit: env.VERCEL_GIT_COMMIT_SHA,
    fixture: 'legacy-casual-20261003', ownerDataChanged: false, steps: [] };
  const request = async (path, body, idempotencyKey) => {
    const response = await fetchImpl('https://api.stripe.com/v1/' + path, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: 'Bearer ' + config.apiKey, 'Stripe-Version': '2026-08-26.dahlia',
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': idempotencyKey } : {}) },
      ...(body ? { body: new URLSearchParams(body).toString() } : {}),
    });
    if (!response.ok) return { httpStatus: response.status };
    return { httpStatus: response.status, data: await response.json() };
  };
  // Exact request bytes are retained server-side. Only allowlisted IDs/status
  // reach build logs; no raw Stripe bodies, payment secrets, or credentials.
  const create = async (name, path, body, objectType, idPrefix) => {
    const key = PREFIX + name;
    const binding = JSON.stringify({ accountId: config.accountId, livemode: false, path, body });
    let raw = await execute(['GET', key]);
    if (raw === null) {
      const claim = JSON.stringify({ binding, phase: 'claimed' });
      await execute(['SET', key, claim, 'NX']);
      raw = await execute(['GET', key]);
      if (raw !== claim) throw Error('sandbox_fixture_conflict');
      // SET NX alone cannot distinguish a lost response/concurrent winner.
      // A separate random lease is unnecessary: only its acknowledged winner
      // may POST; use exact result of a second fenced CAS claim below.
      const authority = sha(env.VERCEL_URL + ':' + name);
      const started = JSON.stringify({ binding, phase: 'executing', authority });
      const won = await execute(['EVAL', CAS, 1, key, raw, started]);
      if (won !== 1) throw Error('sandbox_fixture_pending');
      raw = started;
      let result;
      try { result = await request(path, body, 'cardresell-sandbox-20261003-' + name); }
      catch { throw Error('sandbox_fixture_pending'); }
      if (!result.data) {
        // 403 is a definitive permission denial, not evidence of a created
        // object. Keep the record; never reset an uncertain financial request.
        const phase = result.httpStatus === 403 ? 'permission_blocked' : 'unconfirmed';
        const next = JSON.stringify({ binding, phase, httpStatus: result.httpStatus });
        await execute(['EVAL', CAS, 1, key, raw, next]);
        report.steps.push({ name, status: phase, httpStatus: result.httpStatus });
        return null;
      }
      const x = result.data;
      if (x.object !== objectType || x.livemode !== false || typeof x.id !== 'string'
        || !x.id.startsWith(idPrefix)) throw Error('sandbox_fixture_canonical_mismatch');
      const next = JSON.stringify({ binding, phase: 'created', id: x.id });
      if (await execute(['EVAL', CAS, 1, key, raw, next]) !== 1) throw Error('sandbox_fixture_pending');
      raw = next;
    }
    const record = JSON.parse(raw);
    if (record.binding !== binding) throw Error('sandbox_fixture_conflict');
    if (record.phase !== 'created') {
      report.steps.push({ name, status: record.phase, ...(record.httpStatus ? { httpStatus: record.httpStatus } : {}) });
      return null;
    }
    const canonical = await request(path + '/' + encodeURIComponent(record.id));
    if (canonical.data?.id !== record.id || canonical.data.object !== objectType || canonical.data.livemode !== false) {
      throw Error('sandbox_fixture_canonical_mismatch');
    }
    report.steps.push({ name, status: 'created_and_read_back', id: record.id });
    return canonical.data;
  };
  // A separate legacy test product/price is required; never change a mapped
  // catalogue price or borrow the owner's live subscription for rehearsal.
  const product = await create('legacy-product', 'products', {
    name: 'CardResell legacy $9.99 migration rehearsal (sandbox only)',
    'metadata[cardresell_fixture]': 'legacy-casual-20261003',
  }, 'product', 'prod_');
  if (!product) return report;
  const price = await create('legacy-price', 'prices', {
    product: product.id, currency: 'usd', unit_amount: '999', 'recurring[interval]': 'month',
    'metadata[cardresell_fixture]': 'legacy-casual-20261003',
  }, 'price', 'price_');
  if (!price) return report;
  if (price.product !== product.id || price.unit_amount !== 999 || price.currency !== 'usd'
    || price.recurring?.interval !== 'month' || price.recurring.interval_count !== 1
    || price.id === config.priceMap.plans.casual.priceId) throw Error('sandbox_fixture_price_mismatch');
  report.status = 'legacy_test_price_ready';
  return report;
}
