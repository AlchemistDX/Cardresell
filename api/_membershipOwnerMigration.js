// One audited owner/subscription in an explicit mode. This is not a general import
// engine and never fabricates a Checkout session or changes historical balances.
import { createHash } from 'node:crypto';
import { createMembershipPaymentAdapter } from './_membershipPayments.js';
const hash = value => createHash('sha256').update(value).digest('hex');
const insist = (ok, code = 'owner_migration_unavailable') => {
  if (!ok) throw Object.assign(Error(code), { code });
};
const CAS = `
if redis.call('GET',KEYS[1])~='1' then return 0 end
local prior=redis.call('GET',KEYS[2])
if (ARGV[1]=='null' and prior) or (ARGV[1]~='null' and prior~=ARGV[1]) then return 0 end
if #KEYS==3 and redis.call('GET',KEYS[3])~=ARGV[3] then return 0 end
redis.call('SET',KEYS[2],ARGV[2]); return 1`;
export function createMembershipOwnerMigration({ execute, accountId, livemode, authorization,
  customers, stripe, priceMap, fulfill, now = () => Math.floor(Date.now() / 1000) }) {
  insist(typeof livemode === 'boolean' && /^acct_[A-Za-z0-9]+$/.test(accountId)
    && typeof execute === 'function' && typeof fulfill === 'function', 'migration_configuration');
  const a = structuredClone(authorization);
  const fields = ['owner', 'customerId', 'subscriptionId', 'priceId', 'productId',
    'periodStart', 'periodEnd', 'evidenceId', 'approvedAt'];
  insist(a && Object.keys(a).length === fields.length && fields.every(k => Object.hasOwn(a, k))
    && typeof a.owner === 'string' && a.owner.length > 0 && a.owner.length <= 128
    && !/[\u0000-\u0020\u007f]/.test(a.owner)
    && /^cus_[A-Za-z0-9_]+$/.test(a.customerId) && /^sub_[A-Za-z0-9_]+$/.test(a.subscriptionId)
    && /^price_[A-Za-z0-9_]+$/.test(a.priceId) && /^prod_[A-Za-z0-9_]+$/.test(a.productId)
    && /^[a-f0-9]{64}$/.test(a.evidenceId)
    && [a.periodStart, a.periodEnd, a.approvedAt].every(Number.isSafeInteger)
    && a.periodStart > 0 && a.periodEnd > a.periodStart
    && a.approvedAt > 0 && a.approvedAt <= now(), 'invalid_legacy_authority');
  const prices = structuredClone(priceMap);
  const prefix = 'membership:launch-v2:owner-migration:' + hash(accountId + (livemode ? ':live:' : ':test:') + a.subscriptionId);
  const authority = JSON.stringify({ accountId, livemode, authorization: a, targetPlan: 'casual' });
  const operationId = hash(authority);
  const command = { owner: a.owner, subscriptionId: a.subscriptionId, operationId,
    kind: 'plan_change', plan: 'casual', effectiveAt: a.periodEnd, phase: 'requested',
    idempotencyKey: 'membership-owner-migration-' + operationId };
  const preservedPeriod = s => s?.accountId === accountId && s.livemode === livemode
    && s.subscriptionId === a.subscriptionId && s.customerId === a.customerId
    && s.status === 'active' && s.plan === 'legacy' && s.cancelAtPeriodEnd === false
    && s.periodStart === a.periodStart && s.periodEnd === a.periodEnd;
  const confirmedChange = s => s?.scheduledChange?.plan === 'casual'
    && s.scheduledChange.effectiveAt === a.periodEnd;
  async function ownership(owner) {
    insist(owner === a.owner, 'owner_mismatch');
    const bound = await customers.get(owner);
    insist(bound?.state === 'bound' && bound.owner === owner && bound.customerId === a.customerId
      && bound.accountId === accountId && bound.livemode === livemode, 'customer_mismatch');
  }
  async function read() {
    const raw = await execute(['GET', prefix]);
    if (raw === null) return { raw, data: null };
    let data; try { data = JSON.parse(raw); } catch { insist(false, 'migration_corrupt'); }
    insist(data?.version === 1 && data.authority === authority
      && ['prepared', 'confirmed'].includes(data.phase), 'migration_conflict');
    insist(Object.keys(data).length === (data.phase === 'prepared' ? 3 : 4)
      && (data.phase !== 'confirmed' || (preservedPeriod(data.snapshot) && confirmedChange(data.snapshot))),
    'migration_corrupt');
    return { raw, data };
  }
  async function confirmed() {
    await ownership(a.owner);
    const record = await read();
    insist(record.data?.phase === 'confirmed', 'migration_not_confirmed');
    return record;
  }
  async function schedule({ owner } = {}) {
    await ownership(owner);
    let record = await read();
    if (record.data?.phase === 'confirmed') return { status: 'confirmed', effectiveAt: a.periodEnd };
    insist(a.periodEnd > now(), 'legacy_boundary_passed');
    if (!record.data) {
      const snapshot = await stripe.retrieveLegacySubscriptionSnapshot(a.subscriptionId);
      insist(snapshot?.accountId === accountId && snapshot.livemode === livemode
        && snapshot.subscriptionId === a.subscriptionId && snapshot.customerId === a.customerId
        && snapshot.priceId === a.priceId && snapshot.productId === a.productId
        && snapshot.periodStart === a.periodStart && snapshot.periodEnd === a.periodEnd
        && snapshot.status === 'active' && snapshot.cancelAtPeriodEnd === false
        && snapshot.scheduledChange === null && snapshot.scheduleId === null, 'legacy_canonical_mismatch');
      const prepared = JSON.stringify({ version: 1, authority, phase: 'prepared' });
      await execute(['EVAL', CAS, 2, 'membership:launch-v2:legacy_fence', prefix, 'null', prepared]);
      record = await read();
      insist(record.data, 'migration_pending');
    }
    // The transport owns permanent, claim-before-POST execution identities.
    // Unknown outcomes never reset claims or create another subscription.
    await stripe.executeCommand(structuredClone(command));
    const snapshot = await stripe.retrieveSubscriptionSnapshot(a.subscriptionId);
    insist(preservedPeriod(snapshot), 'legacy_canonical_mismatch');
    if (!confirmedChange(snapshot)) {
      return { status: 'pending', effectiveAt: a.periodEnd };
    }
    const next = JSON.stringify({ version: 1, authority, phase: 'confirmed', snapshot });
    const ok = await execute(['EVAL', CAS, 2, 'membership:launch-v2:legacy_fence', prefix, record.raw, next]);
    if (ok !== 1) insist((await read()).data?.phase === 'confirmed', 'migration_pending');
    return { status: 'confirmed', effectiveAt: a.periodEnd };
  }
  const termKey = start => prefix + ':term:' + start;
  function term(start, end) {
    return { version: 'launch-v2', kind: 'subscription', owner: a.owner, customerId: a.customerId,
      accountId, livemode, subscriptionId: a.subscriptionId, plan: 'casual',
      currency: 'usd', amountCents: 999, ...prices.plans.casual,
      effectiveFrom: start, effectiveUntil: end };
  }
  async function getTerm(subscriptionId, start, provisional) {
    insist(subscriptionId === a.subscriptionId && Number.isSafeInteger(start)
      && start >= a.periodEnd && start <= now(), 'outside_authorized_term');
    await confirmed();
    const raw = await execute(['GET', termKey(start)]);
    if (raw === null) {
      insist(provisional, 'term_missing');
      return term(start, 4102444800);
    }
    let value; try { value = JSON.parse(raw); } catch { insist(false, 'migration_corrupt'); }
    insist(Number.isSafeInteger(value.effectiveUntil) && value.effectiveUntil > start
      && JSON.stringify(value) === JSON.stringify(term(start, value.effectiveUntil)), 'migration_corrupt');
    return value;
  }
  const adapter = (provisional, effect) => createMembershipPaymentAdapter({ accountId, livemode,
    priceMap: prices, stripe, fulfill: effect, bindings: {
      getCheckoutOrder: async () => { insist(false, 'migration_invoice_only'); },
      getSubscriptionTerm: (subscriptionId, start) => getTerm(subscriptionId, start, provisional),
    } });
  async function reconcile(input, recovery) {
    if (recovery) await ownership(input.authenticatedOwner);
    const dry = adapter(true, async (kind, envelope) => ({ kind, envelope }));
    const checked = await dry[recovery ? 'invoiceRecovery' : 'webhook'](input);
    insist(checked?.kind === 'period', 'migration_invoice_only');
    const e = checked.envelope;
    const record = await confirmed();
    const key = termKey(e.periodStart), prior = await execute(['GET', key]);
    const value = JSON.stringify(term(e.periodStart, e.periodEnd));
    if (prior !== null) insist(prior === value, 'term_conflict');
    else {
      const ok = await execute(['EVAL', CAS, 3, 'membership:launch-v2:legacy_fence', key, prefix,
        'null', value, record.raw]);
      if (ok !== 1) insist(await execute(['GET', key]) === value, 'migration_pending');
    }
    // Canonical verification runs again after the immutable finite term commits.
    // The existing invoice journal owns exactly-once grants, including response loss.
    return adapter(false, fulfill)[recovery ? 'invoiceRecovery' : 'webhook'](input);
  }
  return Object.freeze({ schedule,
    status: async () => {
      const r = await read();
      return { phase: r.data?.phase || 'authorized_not_scheduled', operationId, effectiveAt: a.periodEnd };
    },
    invoiceRecovery: input => reconcile(input, true),
    webhook: input => reconcile(input, false) });
}
