// Read-only TEST-account canonical reversal provenance. No credentials/config
// lookup, route activation, metadata/email identity, grant, release or clawback.
// Caller must already verify original webhook bytes; event fields are locators.
// Docs (actual Sandbox shape validation remains UNRUN):
// https://docs.stripe.com/api/invoice-payment/list?api-version=2026-08-26.dahlia
// nested payment[type]=payment_intent + payment[payment_intent] filter;
// https://docs.stripe.com/api/invoice-payment/object
// https://docs.stripe.com/api/refunds/object
// https://docs.stripe.com/api/disputes/object
// https://docs.stripe.com/api/charges/object
// https://docs.stripe.com/api/payment_intents/object
// https://docs.stripe.com/api/checkout/sessions/list
import { MEMBERSHIP_STRIPE_API_VERSION } from './_membershipStripe.js';
import { MEMBERSHIP_VERSION } from './_launchMembershipConfig.js';

const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const id = (x, p) => typeof x === 'string' && new RegExp(`^${p}_[A-Za-z0-9_]{1,180}$`).test(x);
const ref = x => typeof x === 'string' ? x : x?.id;
const uid = x => typeof x === 'string' && x.length > 0 && x.length <= 128 && !/[\u0000-\u0020\u007f]/.test(x);
const integer = x => Number.isSafeInteger(x) && x >= 0;
const positive = x => integer(x) && x > 0;
export class MembershipReversalStripeError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function insist(ok, code = 'reversal_provenance_invalid') {
  if (!ok) throw new MembershipReversalStripeError(code);
}
const EVENTS = Object.freeze({
  'refund.created': ['refund', 're', 'refunds'],
  'refund.updated': ['refund', 're', 'refunds'],
  'refund.failed': ['refund', 're', 'refunds'],
  'charge.refunded': ['charge', 'ch', 'charges'],
  'charge.dispute.created': ['dispute', 'dp', 'disputes'],
  'charge.dispute.updated': ['dispute', 'dp', 'disputes'],
  'charge.dispute.closed': ['dispute', 'dp', 'disputes'],
});

export function createMembershipReversalStripe({
  apiKey, accountId, livemode = false, bindings, customers,
  fetchImpl = globalThis.fetch, operationTimeoutMs = 10000,
} = {}) {
  insist(livemode === false && typeof apiKey === 'string' && /^(?:sk|rk)_test_[A-Za-z0-9]{8,500}$/.test(apiKey)
    && id(accountId, 'acct') && typeof fetchImpl === 'function'
    && typeof bindings?.inspectIntent === 'function' && typeof customers?.get === 'function'
    && Number.isSafeInteger(operationTimeoutMs) && operationTimeoutMs >= 100 && operationTimeoutMs <= 30000,
  'reversal_configuration');

  async function resolveReversalProvenance({ eventType, objectId } = {}) {
    insist(Object.hasOwn(EVENTS, eventType), 'reversal_event_unsupported');
    const [type, prefix, endpoint] = EVENTS[eventType];
    insist(id(objectId, prefix), 'reversal_reference_invalid');
    const abort = new AbortController();
    let timer, expired = false, requests = 0;
    const active = () => insist(!expired && !abort.signal.aborted, 'reversal_deadline');
    async function request(path, query = {}) {
      active();
      insist(++requests <= 20, 'reversal_request_limit');
      // path and query are exclusively constructed in closed operations below.
      const suffix = new URLSearchParams(query).toString();
      const url = `https://api.stripe.com/v1/${path}${suffix ? '?' + suffix : ''}`;
      const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: abort.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Stripe-Version': MEMBERSHIP_STRIPE_API_VERSION } });
      active();
      insist(response?.status === 200 && !response.redirected && (!response.url || response.url === url)
        && /^application\/json\b/i.test(response.headers?.get('content-type') || ''), 'reversal_transport_response');
      const length = response.headers.get('content-length');
      insist(length === null || (/^\d+$/.test(length) && Number.isSafeInteger(Number(length))
        && Number(length) > 0 && Number(length) <= 2000000), 'reversal_transport_limit');
      insist(typeof response.body?.getReader === 'function', 'reversal_transport_response');
      const reader = response.body.getReader(), chunks = [];
      const cancel = () => { reader.cancel().catch(() => {}); };
      abort.signal.addEventListener('abort', cancel, { once: true });
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read(); active();
          if (part.done) break;
          insist(part.value instanceof Uint8Array, 'reversal_transport_response');
          bytes += part.value.byteLength;
          insist(bytes <= 2000000, 'reversal_transport_limit');
          chunks.push(Buffer.from(part.value));
        }
      } finally { abort.signal.removeEventListener('abort', cancel); cancel(); }
      insist(bytes > 0 && (length === null || bytes === Number(length)), 'reversal_transport_response');
      let value;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { throw new MembershipReversalStripeError('reversal_transport_response'); }
      insist(object(value), 'reversal_transport_response');
      return value;
    }
    function canonical(value, objectType, expectedId, requireMode = true) {
      insist(object(value) && value.object === objectType && value.id === expectedId
        && !value.deleted && (requireMode ? value.livemode === false
          : (!Object.hasOwn(value, 'livemode') || value.livemode === false)), 'reversal_canonical_mismatch');
      return value;
    }
    async function completeList(path, query, itemType, itemPrefix) {
      const rows = [], seen = new Set();
      let cursor;
      for (let page = 0; page < 3; page++) {
        const list = await request(path, { ...query, limit: '100', ...(cursor ? { starting_after: cursor } : {}) });
        insist(list.object === 'list' && Array.isArray(list.data) && typeof list.has_more === 'boolean'
          && list.data.length <= 100, 'reversal_pagination_invalid');
        for (const row of list.data) {
          insist(id(row?.id, itemPrefix) && !seen.has(row.id), 'reversal_pagination_invalid');
          canonical(row, itemType, row.id);
          rows.push(row); seen.add(row.id);
        }
        insist(rows.length <= 200, 'reversal_pagination_limit');
        if (!list.has_more) return rows;
        insist(list.data.length > 0, 'reversal_pagination_invalid');
        cursor = list.data.at(-1).id;
      }
      throw new MembershipReversalStripeError('reversal_pagination_incomplete');
    }
    async function work() {
      // Actual supplied credential is verified here, not by an injected reader
      // or a configured account ID assertion. No Stripe-Account override.
      const account = await request('account');
      canonical(account, 'account', accountId, false);
      const reversal = canonical(await request(`${endpoint}/${objectId}`), type, objectId, type !== 'refund');
      // Refund has no required livemode field in this API schema. Its fixed
      // account + re-fetched charge and PaymentIntent provide mode authority.
      let reason;
      if (type === 'refund') {
        const reasons = { pending: 'refund_pending', requires_action: 'refund_pending', succeeded: 'refund_succeeded',
          failed: 'refund_failed', canceled: 'refund_canceled' };
        insist(Object.hasOwn(reasons, reversal.status), 'reversal_status_invalid');
        reason = reasons[reversal.status];
      } else if (type === 'dispute') {
        insist(['needs_response', 'under_review', 'warning_needs_response', 'warning_under_review',
          'lost', 'won', 'warning_closed', 'prevented'].includes(reversal.status), 'reversal_status_invalid');
        reason = ['lost', 'won', 'warning_closed', 'prevented'].includes(reversal.status) ? 'dispute_closed' : 'dispute_open';
      } else reason = 'charge_refunded';
      const chargeId = type === 'charge' ? objectId : ref(reversal.charge);
      insist(id(chargeId, 'ch'), 'reversal_reference_invalid');
      const charge = type === 'charge' ? reversal
        : canonical(await request(`charges/${chargeId}`), 'charge', chargeId);
      const paymentId = ref(charge.payment_intent), customerId = ref(charge.customer);
      insist(id(paymentId, 'pi') && id(customerId, 'cus') && charge.status === 'succeeded'
        && charge.paid === true && charge.currency === 'usd' && positive(charge.amount), 'reversal_charge_invalid');
      if (type !== 'charge') {
        insist(ref(reversal.payment_intent) === paymentId && positive(reversal.amount)
          && reversal.amount <= charge.amount && reversal.currency === charge.currency, 'reversal_link_mismatch');
        if (reversal.customer != null) insist(ref(reversal.customer) === customerId, 'reversal_customer_mismatch');
      } else {
        insist(positive(charge.amount_refunded) && charge.amount_refunded <= charge.amount
          && typeof charge.refunded === 'boolean', 'reversal_refund_unproven');
      }
      const payment = canonical(await request(`payment_intents/${paymentId}`), 'payment_intent', paymentId);
      insist(payment.status === 'succeeded' && ref(payment.customer) === customerId
        && ref(payment.latest_charge) === chargeId && payment.currency === charge.currency
        && payment.amount === charge.amount && payment.amount_received === charge.amount, 'reversal_payment_mismatch');
      canonical(await request(`customers/${customerId}`), 'customer', customerId);
      const links = await completeList('invoice_payments',
        { 'payment[type]': 'payment_intent', 'payment[payment_intent]': paymentId }, 'invoice_payment', 'inpay');
      const invoices = new Set();
      for (const link of links) {
        insist(link.payment?.type === 'payment_intent' && ref(link.payment.payment_intent) === paymentId
          && id(ref(link.invoice), 'in') && ['paid', 'open', 'canceled'].includes(link.status), 'reversal_invoice_link_invalid');
        invoices.add(ref(link.invoice));
      }
      // A single PI applied to multiple invoices is deliberately unsupported;
      // returning only one would falsely claim a complete financial fence.
      insist(invoices.size <= 1, 'reversal_invoice_ambiguous');
      const invoiceId = invoices.size ? [...invoices][0] : null;
      let subscriptionId = null;
      if (invoiceId !== null) {
        const invoice = canonical(await request(`invoices/${invoiceId}`), 'invoice', invoiceId);
        insist(ref(invoice.customer) === customerId && invoice.currency === 'usd'
          && invoice.parent?.type === 'subscription_details'
          && !Object.hasOwn(invoice, 'subscription'), 'reversal_invoice_mismatch');
        subscriptionId = ref(invoice.parent.subscription_details?.subscription);
        insist(id(subscriptionId, 'sub'), 'reversal_reference_invalid');
        const subscription = canonical(await request(`subscriptions/${subscriptionId}`), 'subscription', subscriptionId);
        insist(ref(subscription.customer) === customerId, 'reversal_customer_mismatch');
      }
      const sessions = await completeList('checkout/sessions', invoiceId === null
        ? { payment_intent: paymentId } : { subscription: subscriptionId }, 'checkout.session', 'cs');
      insist(sessions.length === 1, 'reversal_origin_ambiguous');
      const session = canonical(await request(`checkout/sessions/${sessions[0].id}`), 'checkout.session', sessions[0].id);
      insist(session.status === 'complete' && session.payment_status === 'paid'
        && ref(session.customer) === customerId && /^[a-f0-9]{64}$/.test(session.client_reference_id), 'reversal_checkout_invalid');
      const origin = await bindings.inspectIntent(session.client_reference_id); active();
      const order = origin?.order;
      insist(origin?.state === 'canonical_bound' && origin.sessionId === session.id && object(order)
        && order.version === MEMBERSHIP_VERSION && order.intentId === session.client_reference_id
        && order.accountId === accountId && order.livemode === false && uid(order.owner)
        && order.customerId === customerId, 'reversal_origin_unbound');
      if (invoiceId === null) {
        insist(order.kind === 'pack' && session.mode === 'payment' && session.subscription === null
          && ref(session.payment_intent) === paymentId && origin.paymentId === paymentId
          && origin.subscriptionId === null && order.amountCents === payment.amount
          && session.amount_total === order.amountCents && session.currency === 'usd', 'reversal_origin_mismatch');
      } else {
        // Historical subscription origin proves owner, not current price/plan.
        // A valid later plan change must not be mistaken for another owner.
        insist(order.kind === 'subscription' && session.mode === 'subscription' && session.payment_intent === null
          && ref(session.subscription) === subscriptionId && origin.subscriptionId === subscriptionId
          && origin.paymentId === null, 'reversal_origin_mismatch');
      }
      const association = await customers.get(order.owner); active();
      insist(association?.state === 'bound' && association.owner === order.owner
        && association.customerId === customerId && association.accountId === accountId
        && association.livemode === false, 'reversal_owner_mismatch');
      return { accountId, livemode: false, objectType: type, objectId, customerId, paymentId, invoiceId,
        invoiceLookupComplete: true, reason };
    }
    try {
      return await Promise.race([work(), new Promise((_, reject) => {
        timer = setTimeout(() => { expired = true; abort.abort();
          reject(new MembershipReversalStripeError('reversal_deadline')); }, operationTimeoutMs);
      })]);
    } catch (error) {
      abort.abort();
      if (error instanceof MembershipReversalStripeError) throw error;
      // No raw errors, response bodies, credential-bearing URLs or secret cause.
      throw new MembershipReversalStripeError('reversal_transport_unavailable');
    } finally { clearTimeout(timer); }
  }
  return Object.freeze({ resolveReversalProvenance });
}
