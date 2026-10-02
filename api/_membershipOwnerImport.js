// Single-owner operator import. No HTTP caller can supply authority or evidence.
// Standing balances/markers/legacy records are compared, never rewritten.
import { createHash } from 'node:crypto';
import { membershipEnrollmentKey } from './_membershipConsumption.js';
import { membershipIncludedHistoryKey, membershipWelcomeKeys } from './_membershipLedger.js';
import { LEGACY_CONSUMPTION_PLANS } from './_membershipLegacyPlans.js';
const sha = x => createHash('sha256').update(x).digest('hex');
const prefix = 'membership:launch-v2:';
const insist = (v, code = 'owner_import_unavailable') => {
  if (!v) throw Object.assign(Error(code), { code });
};
const safeInt = n => Number.isSafeInteger(n) && n >= 0 && n <= 9007199254740990;
const counter = raw => {
  if (raw === null) return 0; // Exact preexisting handler semantics, current month only.
  insist(/^\d+$/.test(raw) && safeInt(Number(raw)), 'invalid_legacy_counter');
  return Number(raw);
};
export const ownerImportKey = (accountId, livemode, owner) => prefix + 'owner-import:' + sha(
  JSON.stringify([accountId, livemode, owner]));
function validateAuthorization(a) {
  insist(a && Object.keys(a).length === 9 && typeof a.owner === 'string' && a.owner.length > 0
    && a.owner.length <= 128 && !/[\s\u0000-\u001f\u007f]/.test(a.owner)
    && /^cus_[A-Za-z0-9_]+$/.test(a.customerId) && /^sub_[A-Za-z0-9_]+$/.test(a.subscriptionId)
    && /^price_[A-Za-z0-9_]+$/.test(a.priceId) && /^prod_[A-Za-z0-9_]+$/.test(a.productId)
    && [a.periodStart, a.periodEnd, a.approvedAt].every(safeInt)
    && a.periodStart > 0 && a.periodEnd > a.periodStart && a.approvedAt > 0
    && /^[a-f0-9]{64}$/.test(a.evidenceId), 'invalid_owner_authorization');
}
export async function readOwnerImport(execute, accountId, livemode, owner) {
  const raw = await execute(['GET', ownerImportKey(accountId, livemode, owner)]);
  if (raw === null) return null;
  let r; try { r = JSON.parse(raw); } catch { insist(false, 'owner_import_corrupt'); }
  insist(r?.version === 1 && r.accountId === accountId && r.livemode === livemode
    && r.authorization?.owner === owner && r.digest === sha(JSON.stringify(r.data)), 'owner_import_corrupt');
  validateAuthorization(r.authorization);
  insist(r.data?.authorizationDigest === sha(JSON.stringify(r.authorization))
    && Object.hasOwn(LEGACY_CONSUMPTION_PLANS, r.data.legacyPlan)
    && r.data.legacyPlan === 'legacy_' + r.data.legacyTier
    && safeInt(r.data.importedAt) && r.data.importedAt > 0, 'owner_import_corrupt');
  return r;
}
const CAS = `
if redis.call('GET',KEYS[1])~='1' or redis.call('TTL',KEYS[1])~=-1 then return 0 end
local p=cjson.decode(ARGV[1])
local now=tonumber(redis.call('TIME')[1])
if now<p.start or now>=p.finish then return 0 end
for i=2,#KEYS do
 local raw=redis.call('GET',KEYS[i]); local before=p.before[i-1]
 if (before==cjson.null and raw) or (before~=cjson.null and raw~=before) then return 0 end
end
for i=2,#KEYS do
 local value=p.after[i-1]
 if value~=cjson.null then redis.call('SET',KEYS[i],value) end
end
return 1`;
export function createMembershipOwnerImport({ execute, accountId, livemode, authorization,
  stripe, cutoverKey, cutoverDigest }) {
  insist(typeof execute === 'function' && /^acct_[A-Za-z0-9]+$/.test(accountId)
    && typeof livemode === 'boolean' && typeof stripe?.retrieveLegacySubscriptionSnapshot === 'function'
    && /^membership:launch-v2:[a-z0-9:_-]+$/.test(cutoverKey)
    && /^[a-f0-9]{64}$/.test(cutoverDigest));
  const a = structuredClone(authorization); validateAuthorization(a);
  return async function importOwner() {
    const prior = await readOwnerImport(execute, accountId, livemode, a.owner);
    if (prior) {
      insist(JSON.stringify(prior.authorization) === JSON.stringify(a), 'owner_import_conflict');
      // A replay never reinitializes used allocations or refills any source.
      const e = JSON.parse(await execute(['GET', membershipEnrollmentKey(a.owner)]));
      const history = JSON.parse(await execute(['GET', membershipIncludedHistoryKey(a.owner)]));
      insist(e?.owner === a.owner && e.plan === 'paid' && e.subscription === a.subscriptionId
        && history?.periods?.includes(prior.data.allocationKey), 'owner_import_corrupt');
      insist(await execute(['GET', 'membership:launch-v2:legacy_fence']) === '1', 'owner_import_corrupt');
      return { status: 'replayed', digest: prior.digest, newlyAwarded: { id: 0, grade: 0 } };
    }
    const snapshot = await stripe.retrieveLegacySubscriptionSnapshot(a.subscriptionId);
    insist(snapshot?.accountId === accountId && snapshot.livemode === livemode
      && snapshot.subscriptionId === a.subscriptionId && snapshot.customerId === a.customerId
      && snapshot.priceId === a.priceId && snapshot.productId === a.productId
      && snapshot.periodStart === a.periodStart && snapshot.periodEnd === a.periodEnd
      && snapshot.status === 'active' && snapshot.cancelAtPeriodEnd === false
      && snapshot.scheduleId === null && snapshot.scheduledChange === null, 'legacy_canonical_mismatch');
    const clock = await execute(['TIME']); const now = Number(clock?.[0]);
    insist(safeInt(now) && now >= a.periodStart && now < a.periodEnd && a.approvedAt <= now);
    const date = new Date(now * 1000);
    const monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
    const monthEnd = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000;
    // Existing handlers count UTC calendar-month use, not invoice-period use.
    const stamp = `${date.getUTCFullYear()}_${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const start = Math.max(a.periodStart, monthStart), finish = Math.min(a.periodEnd, monthEnd);
    // This bounded import cannot silently renew an old allowance before the
    // approved migration. October's known renewal lies within this month.
    insist(finish === a.periodEnd, 'legacy_spans_next_calendar_month');
    const welcome = membershipWelcomeKeys(a.owner);
    const observedKeys = [cutoverKey, `pro:${a.owner}`,
      `scans:${a.owner}:id_free_used_${stamp}`, `scans:${a.owner}:free_used_${stamp}`,
      `scans:${a.owner}:id_paid_left`, `scans:${a.owner}:paid_left`,
      `signup_bonus:${a.owner}`, welcome.id, welcome.grade];
    const observed = await Promise.all(observedKeys.map(k => execute(['GET', k])));
    insist(typeof observed[0] === 'string' && sha(observed[0]) === cutoverDigest, 'writer_cutover_required');
    const cutover = JSON.parse(observed[0]);
    insist(cutover.environment === (livemode ? 'production' : 'preview')
      && cutover.providerDatabaseId === (livemode ? 'dc621a30-497c-4851-a3c3-42a51309f094'
        : 'b0de2137-6c5c-41b4-8af4-da80a70ce1c3')
      && cutover.backup?.status === 'Completed' && cutover.rotation?.oldAuthorization === 'rejected',
    'writer_cutover_required');
    const legacy = JSON.parse(observed[1]);
    insist(legacy?.status === 'active' && legacy.subscriptionId === a.subscriptionId, 'legacy_owner_mismatch');
    const tier = legacy.tier || 'pro', plan = 'legacy_' + tier;
    insist(Object.hasOwn(LEGACY_CONSUMPTION_PLANS, plan), 'legacy_tier_unknown');
    const grants = LEGACY_CONSUMPTION_PLANS[plan];
    const idUsed = counter(observed[2]), gradeUsed = counter(observed[3]);
    [observed[4], observed[5], observed[7], observed[8]].forEach(counter);
    const allocationKey = prefix + 'period:' + sha(`${a.subscriptionId}:${start}`);
    const data = { authorizationDigest: sha(JSON.stringify(a)), importedAt: now,
      legacyTier: tier, legacyPlan: plan, allocationKey, cutoverDigest,
      observations: observedKeys.map((key, i) => ({ key, present: observed[i] !== null,
        sha256: observed[i] === null ? null : sha(observed[i]) })),
      sourceUsage: { id: idUsed, grade: gradeUsed },
      standingBalances: { id: observed[4], grade: observed[5] },
      importedRemaining: { id: Math.max(0, grants.idCredits - idUsed),
        grade: Math.max(0, grants.gradeCredits - gradeUsed) } };
    const digest = sha(JSON.stringify(data));
    const allocation = { version: 'launch-v2', owner: a.owner, subscription: a.subscriptionId,
      plan, start, finish, period_binding: digest, id_grant: grants.idCredits, grade_grant: grants.gradeCredits,
      id_used: Math.min(idUsed, grants.idCredits), grade_used: Math.min(gradeUsed, grants.gradeCredits),
      origin: 'audited-existing-calendar-allowance', importDigest: digest };
    const writes = [
      [membershipEnrollmentKey(a.owner), { version: 'launch-v2', owner: a.owner, verified: true,
        plan: 'paid', subscription: a.subscriptionId, capabilities: { bulkGrade: ['pro_max', 'ultimate'].includes(tier) } }],
      [membershipIncludedHistoryKey(a.owner), { version: 'launch-v2', owner: a.owner,
        policy: 'nonexpiring-v1', count: 1, periods: [allocationKey] }],
      [prefix + 'active:' + sha(a.owner), { version: 'launch-v2', owner: a.owner,
        subscription: a.subscriptionId, plan, start, finish, period_binding: digest }],
      [prefix + 'subscription:' + sha(a.subscriptionId), { version: 'launch-v2',
        owner: a.owner, subscription: a.subscriptionId }],
      [allocationKey, allocation],
      [ownerImportKey(accountId, livemode, a.owner), { version: 1, accountId, livemode,
        authorization: a, data, digest }],
    ];
    const priorWrites = await Promise.all(writes.map(([key]) => execute(['GET', key])));
    if (priorWrites.some(v => v !== null)) {
      // Another importer may have won; only its exact authority may replay.
      insist(await readOwnerImport(execute, accountId, livemode, a.owner), 'existing_authority_requires_review');
      return importOwner();
    }
    const keys = [prefix + 'legacy_fence', ...observedKeys, ...writes.map(([key]) => key)];
    const result = await execute(['EVAL', CAS, keys.length, ...keys, JSON.stringify({
      start, finish, before: [...observed, ...priorWrites],
      after: [...observed.map(() => null), ...writes.map(([, value]) => JSON.stringify(value))],
    })]);
    if (result !== 1) {
      insist(await readOwnerImport(execute, accountId, livemode, a.owner), 'owner_import_retry_required');
      return importOwner();
    }
    return { status: 'imported', digest, newlyAwarded: { id: 0, grade: 0 },
      preservedIncluded: data.importedRemaining };
  };
}
