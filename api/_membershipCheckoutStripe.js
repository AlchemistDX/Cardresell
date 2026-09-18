// DORMANT fixed Stripe Checkout WRITE + read-only discovery boundary.
// Not a route. Call only from the reviewed single-claim checkout controller.
// Existing canonical customers only; no provisioning, grants or term mutation.
// Synthetic offline fixtures do not prove real Dahlia/Sandbox write shapes.
import { MEMBERSHIP_STRIPE_API_VERSION } from './_membershipStripe.js';
import { MEMBERSHIP_VERSION, LAUNCH_PLANS, LAUNCH_PACKS, quoteLaunchPack } from './_launchMembershipConfig.js';

export const MEMBERSHIP_CHECKOUT_RETURN_ORIGIN = 'https://www.cardresell.org';
export const MEMBERSHIP_CHECKOUT_WRITE_LIMITS = Object.freeze({
  requestMs: 5000, operationMs: 15000, responseBytes: 2_000_000, pages: 3, sessions: 200,
});
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const id = (v, prefix) => typeof v === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9_]{1,180}$`).test(v);
const couponId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const canonical = v => JSON.stringify(v, (_, x) => object(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const ref = v => typeof v === 'string' ? v : object(v) ? v.id : null;
export class MembershipCheckoutStripeError extends Error {
  constructor(code) { super(code); this.name = 'MembershipCheckoutStripeError'; this.code = code; }
}
const insist = (value, code) => { if (!value) throw new MembershipCheckoutStripeError(code); };

export function createMembershipCheckoutStripeTransport({
  apiKey, accountId, livemode, apiVersion, bindings, priceMap, couponMap,
  fetchImpl = globalThis.fetch, operationTimeoutMs = MEMBERSHIP_CHECKOUT_WRITE_LIMITS.operationMs,
} = {}) {
  insist(id(accountId, 'acct') && typeof livemode === 'boolean'
    && typeof apiKey === 'string' && apiKey.length <= 512
    && new RegExp(`^(sk|rk)_${livemode ? 'live' : 'test'}_[A-Za-z0-9]+$`).test(apiKey)
    && apiVersion === MEMBERSHIP_STRIPE_API_VERSION && typeof fetchImpl === 'function'
    && object(bindings) && typeof bindings.getIntent === 'function'
    && Number.isInteger(operationTimeoutMs) && operationTimeoutMs >= 10 && operationTimeoutMs <= 30000,
  'write_configuration');
  let prices, coupons;
  try { prices = structuredClone(priceMap); coupons = structuredClone(couponMap); }
  catch { throw new MembershipCheckoutStripeError('write_configuration'); }
  insist(object(prices) && object(prices.packs) && object(prices.plans) && object(coupons), 'write_configuration');
  const seen = new Set();
  for (const [group, catalog] of [['packs', LAUNCH_PACKS], ['plans', LAUNCH_PLANS]]) {
    const names = Object.keys(catalog).filter(n => n !== 'free');
    insist(Object.keys(prices[group]).length === names.length, 'write_configuration');
    for (const name of names) {
      const p = prices[group][name];
      insist(object(p) && id(p.priceId, 'price') && id(p.productId, 'prod')
        && !seen.has(p.priceId), 'write_configuration');
      seen.add(p.priceId);
    }
  }
  insist(Object.keys(coupons).length === Object.keys(LAUNCH_PLANS).length, 'write_configuration');
  const discountIds = new Set();
  for (const [plan, config] of Object.entries(LAUNCH_PLANS)) {
    insist(Object.hasOwn(coupons, plan), 'write_configuration');
    if (!config.packDiscountPercent) insist(coupons[plan] === null, 'write_configuration');
    else {
      insist(couponId(coupons[plan]) && !discountIds.has(coupons[plan]), 'write_configuration');
      discountIds.add(coupons[plan]);
    }
  }
  const limit = MEMBERSHIP_CHECKOUT_WRITE_LIMITS;

  async function operation(order, options, task) {
    insist(object(options) && Object.keys(options).every(k => k === 'signal')
      && (options.signal === undefined || options.signal instanceof AbortSignal), 'write_options');
    const abort = new AbortController();
    let rejectStop, stopped = false;
    const stop = new Promise((_, reject) => { rejectStop = reject; });
    const cancel = code => {
      if (stopped) return;
      stopped = true; abort.abort();
      rejectStop(new MembershipCheckoutStripeError(code));
    };
    const upstreamAbort = () => cancel('transport_aborted');
    const timer = setTimeout(() => cancel('transport_timeout'), operationTimeoutMs);
    options.signal?.addEventListener('abort', upstreamAbort, { once: true });
    const step = async fn => {
      if (options.signal?.aborted) upstreamAbort();
      return Promise.race([stop, Promise.resolve().then(() => {
        insist(!stopped, 'transport_aborted'); return fn();
      })]);
    };
    const request = async (path, query = '', params = null, key = null) => {
      const url = `https://api.stripe.com/v1/${path}${query}`;
      let reader, requestTimer;
      try {
        requestTimer = setTimeout(() => cancel('transport_timeout'), limit.requestMs);
        const response = await step(() => fetchImpl(url, {
          method: params === null ? 'GET' : 'POST', redirect: 'error', signal: abort.signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Stripe-Version': apiVersion,
            Accept: 'application/json', 'Accept-Encoding': 'identity',
            ...(params === null ? {} : { 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': key }) },
          ...(params === null ? {} : { body: params.toString() }),
        }));
        insist(response && response.status === 200 && !response.redirected, 'transport_status');
        insist(!response.url || response.url === url, 'transport_response');
        const type = response.headers?.get('content-type'), encoding = response.headers?.get('content-encoding');
        insist(typeof type === 'string' && /^application\/json(?:\s*;.*)?$/i.test(type)
          && (encoding === null || encoding === 'identity'), 'transport_response');
        const length = response.headers.get('content-length');
        if (length !== null) insist(/^\d+$/.test(length) && Number.isSafeInteger(Number(length))
          && Number(length) <= limit.responseBytes, 'transport_limit');
        insist(response.body && typeof response.body.getReader === 'function', 'transport_response');
        reader = response.body.getReader();
        const chunks = []; let size = 0;
        while (true) {
          const item = await step(() => reader.read());
          if (item.done) break;
          insist(item.value instanceof Uint8Array, 'transport_response');
          size += item.value.byteLength;
          insist(size <= limit.responseBytes, 'transport_limit');
          chunks.push(Buffer.from(item.value));
        }
        insist(size > 0 && (length === null || Number(length) === size), 'transport_response');
        let value;
        try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
        catch { throw new MembershipCheckoutStripeError('transport_response'); }
        insist(object(value), 'transport_response');
        return value;
      } finally {
        clearTimeout(requestTimer);
        if (reader) reader.cancel().catch(() => {});
      }
    };
    try {
      insist(object(order) && typeof order.intentId === 'string' && /^[a-f0-9]{64}$/.test(order.intentId), 'order_invalid');
      // Reject forged/stale caller copies before any Stripe request. Metadata
      // cannot substitute for this validated durable server order.
      const saved = await step(() => bindings.getIntent(order.intentId));
      insist(object(saved) && canonical(saved) === canonical(order)
        && saved.version === MEMBERSHIP_VERSION && saved.accountId === accountId && saved.livemode === livemode
        && id(saved.customerId, 'cus') && ['pack', 'subscription'].includes(saved.kind)
        && saved.stripeIdempotencyKey === `membership-${MEMBERSHIP_VERSION}-${saved.intentId}`, 'order_mismatch');
      const mapping = saved.kind === 'pack' ? prices.packs[saved.packId] : prices.plans[saved.plan];
      insist(mapping && saved.priceId === mapping.priceId && saved.productId === mapping.productId
        && saved.currency === 'usd' && saved.quantity === 1, 'order_mismatch');
      const quoted = saved.kind === 'pack' ? quoteLaunchPack(saved.packId, saved.planAtCheckout)
        : { amountCents: LAUNCH_PLANS[saved.plan].monthlyPriceCents };
      insist(saved.amountCents === quoted.amountCents, 'order_mismatch');
      const account = await request('account');
      insist(account.object === 'account' && account.id === accountId, 'account_mismatch');
      return await task(structuredClone(saved), request);
    } catch (error) {
      abort.abort();
      if (error instanceof MembershipCheckoutStripeError) throw error;
      // No raw cause, error body, header, token, URL or customer data exported.
      throw new MembershipCheckoutStripeError('transport_unavailable');
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', upstreamAbort);
    }
  }
  const sessionReference = (session, order) => {
    insist(session.object === 'checkout.session' && id(session.id, 'cs') && session.livemode === livemode
      && ref(session.customer) === order.customerId && session.client_reference_id === order.intentId
      && session.mode === (order.kind === 'pack' ? 'payment' : 'subscription'), 'session_mismatch');
    return session.id;
  };
  return Object.freeze({
    async createCheckout(order, options = {}) {
      return operation(order, options, async (saved, request) => {
        const customer = await request(`customers/${encodeURIComponent(saved.customerId)}`);
        insist(customer.object === 'customer' && customer.id === saved.customerId
          && customer.livemode === livemode && customer.deleted !== true, 'customer_mismatch');
        const price = await request(`prices/${encodeURIComponent(saved.priceId)}`);
        const pack = saved.kind === 'pack', base = pack ? LAUNCH_PACKS[saved.packId].basePriceCents : saved.amountCents;
        insist(price.object === 'price' && price.id === saved.priceId && price.livemode === livemode && price.active === true
          && ref(price.product) === saved.productId && price.currency === 'usd' && price.unit_amount === base
          && (pack ? price.type === 'one_time' && price.recurring == null
            : price.type === 'recurring' && price.recurring?.interval === 'month' && price.recurring.interval_count === 1),
        'price_mismatch');
        const coupon = pack ? coupons[saved.planAtCheckout] : null;
        if (coupon !== null) {
          const actual = await request(`coupons/${encodeURIComponent(coupon)}`);
          const percent = LAUNCH_PLANS[saved.planAtCheckout].packDiscountPercent;
          // Require an explicit product restriction containing precisely launch
          // pack products. Never apply a customer-provided promotion code.
          const products = [...new Set(Object.values(prices.packs).map(p => p.productId))].sort();
          const applies = actual.applies_to?.products;
          insist(actual.object === 'coupon' && actual.id === coupon && actual.livemode === livemode
            && actual.valid === true && actual.percent_off === percent && actual.amount_off === null
            && actual.currency === null && actual.duration === 'once'
            && Array.isArray(applies) && canonical([...applies].sort()) === canonical(products), 'coupon_mismatch');
        }
        // New return flag deliberately does NOT trigger legacy credit writers.
        // Normal-client return integration is required before activation.
        const params = new URLSearchParams({
          mode: pack ? 'payment' : 'subscription', customer: saved.customerId,
          client_reference_id: saved.intentId, 'line_items[0][price]': saved.priceId,
          'line_items[0][quantity]': '1', 'payment_method_types[0]': 'card',
          'automatic_tax[enabled]': 'false', allow_promotion_codes: 'false',
          success_url: `${MEMBERSHIP_CHECKOUT_RETURN_ORIGIN}/?membership_return=1&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${MEMBERSHIP_CHECKOUT_RETURN_ORIGIN}/?membership_cancel=1`,
          'metadata[membership_version]': MEMBERSHIP_VERSION, 'metadata[intent_id]': saved.intentId,
        });
        if (coupon !== null) params.set('discounts[0][coupon]', coupon);
        const session = await request('checkout/sessions', '', params, saved.stripeIdempotencyKey);
        return { id: sessionReference(session, saved) };
        // No retries here: timeout/status/body failure may follow a committed
        // Stripe POST. Only the controller's read-only recovery can proceed.
      });
    },
    async recoverCheckout(order, options = {}) {
      return operation(order, options, async (saved, request) => {
        const seen = new Set(), found = new Set(); let after;
        for (let page = 0; page < limit.pages; page++) {
          const query = new URLSearchParams({ customer: saved.customerId, limit: '100' });
          if (after) query.set('starting_after', after);
          const list = await request('checkout/sessions', `?${query}`);
          insist(list.object === 'list' && typeof list.has_more === 'boolean'
            && Array.isArray(list.data) && list.data.length <= 100, 'discovery_invalid');
          for (const session of list.data) {
            insist(object(session) && session.object === 'checkout.session' && id(session.id, 'cs')
              && !seen.has(session.id) && session.livemode === livemode
              && ref(session.customer) === saved.customerId, 'discovery_invalid');
            seen.add(session.id);
            insist(seen.size <= limit.sessions, 'discovery_incomplete');
            // Explicit client_reference_id is only a locator. Full canonical
            // content/payment authority remains in the controller and adapter.
            if (session.client_reference_id === saved.intentId) found.add(sessionReference(session, saved));
          }
          insist(found.size <= 1, 'discovery_ambiguous');
          if (!list.has_more) return found.size ? [...found][0] : null;
          insist(list.data.length > 0, 'discovery_invalid');
          after = list.data.at(-1).id; // Never follow list.url/next links.
        }
        throw new MembershipCheckoutStripeError('discovery_incomplete');
      });
    },
  });
}
