// DORMANT server-only adapter. No live route imports, credentials, fetch,
// checkout creation, subscription changes or migration. Inject one account-
// scoped Stripe client, trusted immutable server bindings and the ledger.
// Signature verification and authenticatedOwner must come from the real server
// auth boundaries. Stripe metadata is NEVER entitlement/order authority.
import { MEMBERSHIP_VERSION, LAUNCH_PLANS, LAUNCH_PACKS, quoteLaunchPack } from './_launchMembershipConfig.js';

export class MembershipPaymentError extends Error {
  constructor(code, cause) {
    super(code, cause === undefined ? undefined : { cause });
    this.code = code;
  }
}
const deny = code => { throw new MembershipPaymentError(code); };
const requireThat = (condition, code) => { if (!condition) deny(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uid = value => typeof value === 'string' && value.length > 0 && value.length <= 128
  && !/[\u0000-\u0020\u007f]/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const id = (value, kind) => typeof value === 'string'
  && new RegExp(`^${kind}_[A-Za-z0-9_]{1,180}$`).test(value);
const ref = value => typeof value === 'string' ? value : object(value) ? value.id : null;
const copy = value => {
  try { return structuredClone(value); } catch (cause) { throw new MembershipPaymentError('binding_invalid', cause); }
};
function stripeObject(value, type, expectedId, livemode) {
  requireThat(object(value) && value.object === type && value.id === expectedId, 'stripe_object_mismatch');
  if (livemode !== undefined) requireThat(value.livemode === livemode, 'mode_mismatch');
  return value;
}
function singleLine(list) {
  requireThat(object(list) && list.object === 'list' && list.has_more === false
    && Array.isArray(list.data) && list.data.length === 1 && object(list.data[0]), 'unsupported_lines');
  return list.data[0];
}
const lacks = (value, fields) => fields.every(field => !Object.hasOwn(value, field));
// Nullable documented arrays must be explicitly present. Unknown/missing
// adjustment information is not implicitly a zero adjustment.
const noAdjustments = (value, fields) => fields.every(field => Object.hasOwn(value, field)
  && (value[field] === null || (Array.isArray(value[field]) && value[field].length === 0)));
const exactDecimal = (value, whole) => typeof value === 'string'
  && new RegExp(`^${whole}(?:\\.0{1,12})?$`).test(value) && value === value.trim();

// Mapping is server configuration, NOT an object read from checkout metadata.
// Require an unambiguous map of all launch prices to configured products.
function validatePriceMap(map) {
  requireThat(object(map) && object(map.packs) && object(map.plans), 'price_map_invalid');
  const seen = new Set();
  for (const [group, names] of [
    ['packs', Object.keys(LAUNCH_PACKS)],
    ['plans', Object.keys(LAUNCH_PLANS).filter(name => name !== 'free')],
  ]) {
    requireThat(Object.keys(map[group]).length === names.length, 'price_map_invalid');
    for (const name of names) {
      const entry = map[group][name];
      requireThat(object(entry) && id(entry.priceId, 'price') && id(entry.productId, 'prod')
        && !seen.has(entry.priceId), 'price_map_invalid');
      seen.add(entry.priceId);
    }
  }
}

export function createMembershipPaymentAdapter({
  stripe, bindings, fulfill, accountId, livemode, priceMap,
}) {
  requireThat(id(accountId, 'acct') && typeof livemode === 'boolean', 'adapter_configuration');
  const methods = ['retrieveAccount', 'retrieveCheckoutSession', 'listCheckoutLineItems',
    'retrievePaymentIntent', 'retrieveInvoice', 'listInvoiceLines', 'retrievePrice',
    'retrieveSubscription', 'verifyWebhook'];
  requireThat(object(stripe) && methods.every(name => typeof stripe[name] === 'function')
    && object(bindings) && typeof bindings.getCheckoutOrder === 'function'
    && typeof bindings.getSubscriptionTerm === 'function' && typeof fulfill === 'function', 'adapter_configuration');
  const prices = copy(priceMap);
  validatePriceMap(prices);
  const invoke = async (fn, ...args) => {
    try { return await fn(...args); }
    catch (cause) {
      if (cause instanceof MembershipPaymentError) throw cause;
      throw new MembershipPaymentError('payment_unavailable', cause);
    }
  };
  // All retrievals MUST use the same fixed account/mode client; no per-request
  // Stripe-Account override. Account provenance is not inferred from metadata.
  async function account() {
    const actual = await invoke(stripe.retrieveAccount);
    stripeObject(actual, 'account', accountId);
  }
  function bound(record) {
    requireThat(object(record), 'binding_missing');
    requireThat(record.version === MEMBERSHIP_VERSION && uid(record.owner)
      && record.accountId === accountId && record.livemode === livemode
      && id(record.customerId, 'cus'), 'binding_invalid');
  }
  async function price(priceId, mapping, recurring, amount) {
    requireThat(priceId === mapping.priceId, 'price_mismatch');
    const p = stripeObject(await invoke(stripe.retrievePrice, priceId), 'price', priceId, livemode);
    requireThat(ref(p.product) === mapping.productId && p.currency === 'usd'
      && p.unit_amount === amount, 'price_mismatch');
    if (recurring) {
      requireThat(p.type === 'recurring' && object(p.recurring)
        && p.recurring.interval === 'month' && p.recurring.interval_count === 1, 'interval_mismatch');
    } else {
      requireThat(p.type === 'one_time' && p.recurring == null, 'price_mismatch');
    }
    // Archived prices can still identify paid historical transactions. Do not
    // confuse catalog active-for-sale status with settlement validity.
  }
  async function checkout(sessionId, authenticatedOwner) {
    requireThat(id(sessionId, 'cs'), 'invalid_reference');
    if (authenticatedOwner !== undefined) requireThat(uid(authenticatedOwner), 'authentication_required');
    await account();
    const session = stripeObject(await invoke(stripe.retrieveCheckoutSession, sessionId),
      'checkout.session', sessionId, livemode);
    const order = copy(await invoke(bindings.getCheckoutOrder, sessionId));
    bound(order);
    requireThat(order.sessionId === sessionId && order.kind === 'pack', 'order_mismatch');
    if (authenticatedOwner !== undefined) requireThat(order.owner === authenticatedOwner, 'owner_mismatch');
    requireThat(session.mode === 'payment' && session.status === 'complete'
      && session.payment_status === 'paid', 'payment_not_settled');
    requireThat(ref(session.customer) === order.customerId && session.subscription == null, 'customer_mismatch');
    requireThat(Object.hasOwn(LAUNCH_PACKS, order.packId), 'binding_invalid');
    let quote;
    try { quote = quoteLaunchPack(order.packId, order.planAtCheckout); }
    catch { deny('binding_invalid'); }
    requireThat(order.currency === quote.currency && order.amountCents === quote.amountCents
      && order.quantity === 1 && order.priceId === prices.packs[order.packId].priceId, 'binding_invalid');
    requireThat(session.currency === quote.currency && session.amount_total === quote.amountCents
      && session.amount_subtotal === quote.basePriceCents, 'amount_mismatch');
    // Bounded launch contract: one pack, exact configured discount, no tax or
    // shipping additions. Anything else needs an explicitly reviewed policy.
    requireThat(object(session.total_details) && session.total_details.amount_tax === 0
      && session.total_details.amount_shipping === 0
      && session.total_details.amount_discount === quote.basePriceCents - quote.amountCents, 'amount_mismatch');
    const line = singleLine(await invoke(stripe.listCheckoutLineItems, sessionId));
    requireThat(line.quantity === 1 && line.currency === quote.currency
      && line.amount_subtotal === quote.basePriceCents && line.amount_total === quote.amountCents,
    'line_mismatch');
    await price(ref(line.price), prices.packs[order.packId], false, quote.basePriceCents);
    const paymentId = ref(session.payment_intent);
    requireThat(id(paymentId, 'pi') && paymentId === paymentId.trim(), 'invalid_reference');
    // The canonical Stripe reference must be the same immutable server-bound
    // payment, not merely another paid intent with matching customer/amount.
    requireThat(id(order.paymentId, 'pi') && order.paymentId === order.paymentId.trim(), 'binding_invalid');
    requireThat(paymentId === order.paymentId, 'payment_binding_mismatch');
    const payment = stripeObject(await invoke(stripe.retrievePaymentIntent, paymentId),
      'payment_intent', paymentId, livemode);
    requireThat(payment.status === 'succeeded' && payment.currency === quote.currency
      && payment.amount === quote.amountCents && payment.amount_received === quote.amountCents
      && ref(payment.customer) === order.customerId, 'payment_mismatch');
    return invoke(fulfill, 'pack', {
      owner: order.owner, paymentId, packId: order.packId, plan: order.planAtCheckout,
      currency: quote.currency, amountCents: quote.amountCents, paid: true,
    });
  }
  async function invoice(invoiceId) {
    requireThat(id(invoiceId, 'in'), 'invalid_reference');
    await account();
    // Explicit 2026-08-26.dahlia contract; no legacy/mixed-schema fallback.
    // See MEMBERSHIP_DAHLIA_CONTRACT.json. Always refetch canonical settlement.
    const bill = stripeObject(await invoke(stripe.retrieveInvoice, invoiceId), 'invoice', invoiceId, livemode);
    requireThat(lacks(bill, ['subscription', 'subscription_details', 'subscription_proration_date',
      'quote', 'paid', 'paid_out_of_band', 'payment_intent', 'charge']), 'invoice_schema_mismatch');
    requireThat(bill.status === 'paid' && bill.amount_paid_off_stripe === 0
      && bill.amount_remaining === 0 && integer(bill.status_transitions?.paid_at)
      && bill.status_transitions.paid_at > 0, 'payment_not_settled');
    requireThat(['subscription_create', 'subscription_cycle'].includes(bill.billing_reason), 'unsupported_invoice');
    requireThat(object(bill.parent) && bill.parent.type === 'subscription_details'
      && bill.parent.quote_details == null && object(bill.parent.subscription_details), 'invoice_schema_mismatch');
    const subscriptionId = ref(bill.parent.subscription_details.subscription);
    requireThat(id(subscriptionId, 'sub'), 'invalid_reference');
    const line = singleLine(await invoke(stripe.listInvoiceLines, invoiceId));
    requireThat(lacks(line, ['type', 'subscription', 'subscription_item', 'invoice_item',
      'proration', 'proration_details', 'price', 'plan']), 'line_schema_mismatch');
    requireThat(line.object === 'line_item' && line.livemode === livemode
      && object(line.parent) && line.parent.type === 'subscription_item_details'
      && line.parent.invoice_item_details == null && object(line.parent.subscription_item_details),
    'line_schema_mismatch');
    const detail = line.parent.subscription_item_details;
    requireThat(detail.proration === false && line.quantity === 1 && exactDecimal(line.quantity_decimal, 1)
      && detail.subscription === subscriptionId && id(detail.subscription_item, 'si') && object(line.period)
      && integer(line.period.start) && integer(line.period.end)
      && line.period.end > line.period.start, 'line_mismatch');
    requireThat(object(line.pricing) && line.pricing.type === 'price_details'
      && object(line.pricing.price_details), 'line_schema_mismatch');
    const term = copy(await invoke(bindings.getSubscriptionTerm, subscriptionId, line.period.start));
    bound(term);
    requireThat(term.subscriptionId === subscriptionId && term.kind === 'subscription'
      && Object.hasOwn(prices.plans, term.plan) && term.priceId === prices.plans[term.plan].priceId,
    'binding_invalid');
    // Effective-term authority comes from an immutable server order/schedule,
    // not current subscription metadata/tier. This preserves historical paid
    // invoices after later plan changes and prevents early migration grants.
    requireThat(integer(term.effectiveFrom)
      && (term.effectiveUntil === null || (integer(term.effectiveUntil) && term.effectiveUntil > term.effectiveFrom)),
    'binding_invalid');
    requireThat(line.period.start >= term.effectiveFrom
      && (term.effectiveUntil === null || line.period.end <= term.effectiveUntil), 'outside_authorized_term');
    const expected = LAUNCH_PLANS[term.plan].monthlyPriceCents;
    requireThat(term.currency === 'usd' && term.amountCents === expected
      && bill.currency === 'usd' && line.currency === 'usd'
      && bill.amount_paid === expected && bill.amount_due === expected && bill.total === expected
      && line.amount === expected, 'amount_mismatch');
    // Deliberately narrow full-price paid renewal policy: no tax, discount,
    // customer-credit/debit, credit-note, shipping or overpayment settlement.
    // Reject compensating adjustments even when the final total happens to match.
    requireThat(['amount_overpaid', 'amount_shipping', 'starting_balance', 'ending_balance',
      'pre_payment_credit_notes_amount', 'post_payment_credit_notes_amount'].every(field => bill[field] === 0)
      && noAdjustments(bill, ['total_taxes', 'total_discount_amounts'])
      && noAdjustments(line, ['taxes', 'discount_amounts', 'pretax_credit_amounts']),
    'unsupported_settlement');
    requireThat(line.pricing.price_details.product === prices.plans[term.plan].productId
      && exactDecimal(line.pricing.unit_amount_decimal, expected), 'price_mismatch');
    requireThat(ref(bill.customer) === term.customerId, 'customer_mismatch');
    const subscription = stripeObject(await invoke(stripe.retrieveSubscription, subscriptionId),
      'subscription', subscriptionId, livemode);
    requireThat(ref(subscription.customer) === term.customerId, 'customer_mismatch');
    // Never require current status/price to match a historical paid invoice:
    // a subsequent failed renewal/cancellation must not invalidate paid proof.
    await price(ref(line.pricing.price_details.price), prices.plans[term.plan], true, expected);
    return invoke(fulfill, 'period', {
      owner: term.owner, invoiceId, subscriptionId, plan: term.plan,
      periodStart: line.period.start, periodEnd: line.period.end,
      currency: 'usd', amountCents: expected, paid: true,
    });
  }
  return Object.freeze({
    // authenticatedOwner is derived by the existing normal auth verifier in a
    // future route; never req.body.owner or metadata.google_sub.
    async checkoutReturn({ sessionId, authenticatedOwner } = {}) {
      requireThat(uid(authenticatedOwner), 'authentication_required');
      return checkout(sessionId, authenticatedOwner);
    },
    async webhook({ rawBody, signature } = {}) {
      requireThat((Buffer.isBuffer(rawBody) || rawBody instanceof Uint8Array)
        && rawBody.byteLength > 0 && rawBody.byteLength <= 1_000_000
        && typeof signature === 'string' && signature.length > 0 && signature.length <= 4096, 'invalid_signature');
      let event;
      try { event = await stripe.verifyWebhook(rawBody, signature); }
      catch (cause) { throw new MembershipPaymentError('invalid_signature', cause); }
      requireThat(object(event) && event.object === 'event' && id(event.id, 'evt'), 'invalid_event');
      requireThat(event.livemode === livemode, 'mode_mismatch');
      requireThat(event.account == null || event.account === accountId, 'account_mismatch');
      if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
        requireThat(event.data?.object?.object === 'checkout.session', 'invalid_event');
        return checkout(event.data.object.id);
      }
      if (['invoice.paid', 'invoice.payment_succeeded'].includes(event.type)) {
        requireThat(event.data?.object?.object === 'invoice', 'invalid_event');
        return invoice(event.data.object.id);
      }
      // No event marker, balance change, revocation or tier inference here.
      return Object.freeze({ ignored: true });
    },
  });
}
