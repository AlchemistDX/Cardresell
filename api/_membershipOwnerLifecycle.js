// Runtime adapter for the ONE imported owner. It never fabricates Checkout
// lineage, creates a subscription, schedules from a browser action, or grants
// before a canonically paid Casual renewal.
import { createHash } from 'node:crypto';
const sha = x => createHash('sha256').update(x).digest('hex');
const ref = x => typeof x === 'string' ? x : x?.id;
const insist = v => { if (!v) throw Object.assign(Error('owner_reconciliation_required'), { code: 'owner_reconciliation_required' }); };
export function createMembershipOwnerLifecycle({ normal, imported, customers, stripe, migration, execute }) {
  const { authorization: a, accountId, livemode } = imported;
  const prefix = 'membership:launch-v2:owner-event:' + sha(JSON.stringify([accountId, livemode, a.owner])) + ':';
  async function bound() {
    const c = await customers.get(a.owner);
    insist(c?.state === 'bound' && c.owner === a.owner && c.customerId === a.customerId
      && c.accountId === accountId && c.livemode === livemode);
  }
  async function snapshot() {
    await bound();
    const s = await stripe.retrieveSubscriptionSnapshot(a.subscriptionId);
    insist(s?.accountId === accountId && s.livemode === livemode
      && s.customerId === a.customerId && s.subscriptionId === a.subscriptionId);
    return s;
  }
  async function get(input) {
    if (input.owner !== a.owner) return normal.get(input);
    const s = await snapshot(), m = await migration.status();
    return { owner: a.owner, customerId: a.customerId, subscriptionId: a.subscriptionId,
      snapshot: s, migration: m, claim: null,
      command: m.phase === 'confirmed' ? { operationId: m.operationId, kind: 'plan_change',
        plan: 'casual', effectiveAt: m.effectiveAt, phase: 'confirmed' } : null };
  }
  async function refresh(input) {
    if (input.owner !== a.owner) return normal.refresh(input);
    insist(input.subscriptionId === a.subscriptionId);
    return { status: 'refreshed', state: await get(input) };
  }
  async function observe(event, result) {
    const key = prefix + sha(event.id);
    // Observation identity is immutable. Different canonical status on a retry
    // may still reconcile a paid invoice, but cannot rewrite prior evidence.
    const record = JSON.stringify({ version: 1, eventId: event.id, eventType: event.type,
      objectId: event.data.object.id, result });
    const won = await execute(['SET', key, record, 'NX']);
    if (won !== 'OK') {
      const prior = JSON.parse(await execute(['GET', key]));
      insist(prior?.version === 1 && prior.eventId === event.id && prior.eventType === event.type
        && prior.objectId === event.data.object.id);
    }
    return result;
  }
  async function webhook(input) {
    const event = await stripe.verifyWebhook(input.rawBody, input.signature);
    insist(event?.object === 'event' && /^evt_[A-Za-z0-9_]+$/.test(event.id)
      && event.livemode === livemode && (event.account == null || event.account === accountId));
    if (['invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed', 'invoice.payment_action_required'].includes(event.type)) {
      insist(event.data?.object?.object === 'invoice' && /^in_[A-Za-z0-9_]+$/.test(event.data.object.id));
      const invoice = await stripe.retrieveInvoice(event.data.object.id);
      insist(invoice?.object === 'invoice' && invoice.id === event.data.object.id && invoice.livemode === livemode);
      const sub = ref(invoice.parent?.subscription_details?.subscription);
      if (sub !== a.subscriptionId) return normal.webhook(input);
      await bound();
      insist(ref(invoice.customer) === a.customerId && invoice.currency === 'usd');
      const account = await stripe.retrieveAccount(); insist(account?.id === accountId);
      if (invoice.status !== 'paid') {
        await snapshot();
        return observe(event, { status: 'observed', creditsGranted: false, reason: 'invoice_not_paid' });
      }
      const lines = await stripe.listInvoiceLines(invoice.id);
      insist(lines?.object === 'list' && lines.has_more === false && lines.data?.length === 1);
      const line = lines.data[0];
      if (line.period?.start < a.periodEnd) {
        // Historical invoice already belonged to the legacy system. No new
        // financial marker or allowance is invented for it.
        insist(ref(line.pricing?.price_details?.price) === a.priceId
          && ref(line.pricing?.price_details?.product) === a.productId
          && line.period.end <= a.periodEnd && line.currency === 'usd' && line.quantity === 1);
        return observe(event, { status: 'observed', creditsGranted: false, reason: 'pre_migration_invoice' });
      }
      // Full canonical invoice verification and one ledger journal are shared
      // with recovery, including a late payment_failed event after payment.
      const grant = await migration.invoiceRecovery({ invoiceId: invoice.id, authenticatedOwner: a.owner });
      return observe(event, { status: 'fulfilled', kind: 'subscription', grant });
    }
    if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)
      && event.data?.object?.id === a.subscriptionId) {
      insist(event.data.object.object === 'subscription');
      const s = await snapshot();
      return observe(event, { status: 'observed', creditsGranted: false, subscriptionStatus: s.status });
    }
    return normal.webhook(input); // Pack refunds/disputes retain the reviewed hold protocol.
  }
  return Object.freeze({ ...normal, get, refresh, reconcile: refresh, webhook,
    associate: async input => {
      if (input.owner !== a.owner) return normal.associate(input);
      insist(input.customerId === a.customerId); await bound();
      return { owner: a.owner, customerId: a.customerId, subscriptionId: a.subscriptionId };
    } });
}
