// Shared canonical return/webhook path. Browser session IDs and webhook payloads
// are locators only; durable orders plus fixed-account canonical retrieval own
// identity, price and grant authorization.
import { LAUNCH_PLANS, quoteLaunchPack } from './_launchMembershipConfig.js';
const ref = v => typeof v === 'string' ? v : v?.id;
const requireThat = (v, code) => { if (!v) throw Object.assign(new Error(code), { code }); };
export function createMembershipFulfillment({ stripe, bindings, payments, lifecycle, accountId, livemode }) {
  requireThat(livemode === false, 'test_only');
  async function checkout(sessionId, owner) {
    requireThat(/^cs_[A-Za-z0-9_]+$/.test(sessionId), 'invalid_session');
    const account = await stripe.retrieveAccount();
    requireThat(account?.id === accountId, 'account_mismatch');
    const session = await stripe.retrieveCheckoutSession(sessionId);
    requireThat(session?.object === 'checkout.session' && session.id === sessionId
      && session.livemode === false && /^[a-f0-9]{64}$/.test(session.client_reference_id), 'session_mismatch');
    const order = await bindings.getIntent(session.client_reference_id);
    requireThat(order && order.accountId === accountId && order.livemode === false
      && (owner === undefined || order.owner === owner), 'owner_mismatch');
    requireThat(ref(session.customer) === order.customerId
      && session.mode === (order.kind === 'pack' ? 'payment' : 'subscription'), 'session_mismatch');
    const base = order.kind === 'pack' ? quoteLaunchPack(order.packId, order.planAtCheckout).basePriceCents
      : LAUNCH_PLANS[order.plan].monthlyPriceCents;
    requireThat(session.currency === 'usd' && session.amount_subtotal === base
      && session.amount_total === order.amountCents && session.total_details?.amount_tax === 0
      && session.total_details?.amount_shipping === 0
      && session.total_details?.amount_discount === base - order.amountCents, 'amount_mismatch');
    const lines = await stripe.listCheckoutLineItems(sessionId);
    const line = lines?.data?.[0];
    requireThat(lines?.object === 'list' && lines.has_more === false && lines.data.length === 1
      && line.quantity === 1 && line.currency === 'usd' && line.amount_subtotal === base
      && line.amount_total === order.amountCents && ref(line.price) === order.priceId, 'line_mismatch');
    const price = await stripe.retrievePrice(order.priceId);
    requireThat(price?.object === 'price' && price.id === order.priceId && price.livemode === false
      && ref(price.product) === order.productId && price.currency === 'usd' && price.unit_amount === base
      && (order.kind === 'pack' ? price.type === 'one_time' && price.recurring == null
        : price.type === 'recurring' && price.recurring?.interval === 'month'
          && price.recurring.interval_count === 1), 'price_mismatch');
    requireThat(['open', 'expired', 'complete'].includes(session.status), 'session_mismatch');
    if (session.status !== 'complete' || session.payment_status !== 'paid') {
      return { status: session.status === 'expired' ? 'expired' : 'pending', sessionId };
    }
    const paymentId = ref(session.payment_intent), subscriptionId = ref(session.subscription);
    requireThat(order.kind === 'pack'
      ? /^pi_[A-Za-z0-9_]+$/.test(paymentId) && session.subscription === null
      : /^sub_[A-Za-z0-9_]+$/.test(subscriptionId) && session.payment_intent === null, 'settlement_mismatch');
    await bindings.bindSession({ intentId: order.intentId, sessionId });
    await bindings.bindSettlement({ intentId: order.intentId, sessionId,
      paymentId: order.kind === 'pack' ? paymentId : null,
      subscriptionId: order.kind === 'subscription' ? subscriptionId : null });
    if (order.kind === 'pack') {
      const grant = await payments.checkoutReturn({ sessionId, authenticatedOwner: order.owner });
      return { status: 'fulfilled', sessionId, kind: 'pack', grant };
    }
    const result = await lifecycle.checkout({ order, subscriptionId, sessionId });
    return { ...result, sessionId, kind: 'subscription' };
  }
  return Object.freeze({
    checkoutReturn: ({ sessionId, owner }) => {
      requireThat(typeof owner === 'string' && owner.length > 0, 'authentication_required');
      return checkout(sessionId, owner);
    },
    async webhook({ rawBody, signature }) {
      const event = await stripe.verifyWebhook(rawBody, signature);
      requireThat(event?.object === 'event' && /^evt_[A-Za-z0-9_]+$/.test(event.id)
        && event.livemode === false && (event.account == null || event.account === accountId), 'invalid_event');
      if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
        requireThat(event.data?.object?.object === 'checkout.session', 'invalid_event');
        return checkout(event.data.object.id);
      }
      return lifecycle.webhook({ rawBody, signature });
    },
  });
}
