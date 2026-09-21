// Local HTTP-response fixtures + actual private Redis/controller/store.
// No real credentials, Stripe calls, live API-shape or payment proof.
import { createHash } from 'node:crypto';
import { harness } from './_assert.mjs';
import { redisCommand as redis } from './_idRedis.mjs';
import { createMembershipBindingStore } from '../api/_membershipBindings.js';
import { createMembershipCheckoutController } from '../api/_membershipCheckout.js';
import { createMembershipStripeTransport, MEMBERSHIP_STRIPE_API_VERSION as VERSION } from '../api/_membershipStripe.js';
import { createMembershipCheckoutStripeTransport, MEMBERSHIP_CHECKOUT_RETURN_ORIGIN as ORIGIN,
  MEMBERSHIP_CHECKOUT_WRITE_LIMITS as LIMIT } from '../api/_membershipCheckoutStripe.js';
import { LAUNCH_PLANS, LAUNCH_PACKS } from '../api/_launchMembershipConfig.js';
const t = harness('membership-checkout-stripe');
const hash = v => createHash('sha256').update(v).digest('hex');
const KEY = 'sk_test_syntheticOnly', ACCOUNT = 'acct_synthetic';
const prices = { packs: {}, plans: {} };
for (const [group, catalog] of [['packs', LAUNCH_PACKS], ['plans', LAUNCH_PLANS]]) {
  for (const name of Object.keys(catalog)) if (name !== 'free') {
    prices[group][name] = { priceId: `price_${group}_${name}`, productId: `prod_${group}_${name}` };
  }
}
const coupons = { free: null, starter: null, casual: 'synthetic10', pro: 'synthetic15', business: 'synthetic25' };
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const reset = () => redis(['FLUSHDB']);
const snapshot = async () => JSON.stringify(await Promise.all((await redis(['KEYS', '*'])).sort()
  .map(async k => [k, await redis(['GET', k]), await redis(['PTTL', k])])) );
const store = createMembershipBindingStore({ execute: redis, accountId: ACCOUNT, livemode: false, priceMap: prices });
const intent = (name = 'one', extra = {}) => ({ intentId: hash(name), owner: 'syntheticOwner',
  customerId: 'cus_synthetic', kind: 'pack', plan: 'casual', packId: 'id_25', ...extra });
const config = extra => ({ apiKey: KEY, accountId: ACCOUNT, livemode: false, apiVersion: VERSION,
  bindings: store, priceMap: prices, couponMap: coupons, ...extra });
async function rejects(label, fn, code) {
  try { await fn(); t.check(label, false); }
  catch (e) {
    t.check(label, code ? e.code === code : typeof e.code === 'string', `actual ${e.code}`);
    t.check(`${label}: error sanitized`, !JSON.stringify(e).includes(KEY)
      && !JSON.stringify(e).includes('private-upstream') && !Object.hasOwn(e, 'cause'));
  }
}
function fixture(extra = {}) {
  const f = { calls: [], sessions: [], overrides: new Map(), created: [], losePost: false, ...extra };
  f.fetch = async (url, init) => {
    f.calls.push({ url, init }); const u = new URL(url), params = init.body ? new URLSearchParams(init.body) : null;
    const route = `${init.method} ${u.pathname}${u.search}`;
    if (f.overrides.has(route)) {
      const value = f.overrides.get(route);
      return typeof value === 'function' ? value(url, init) : value instanceof Response ? value : json(value);
    }
    if (u.pathname === '/v1/account') return json({ object: 'account', id: ACCOUNT });
    if (u.pathname === '/v1/customers/cus_synthetic') return json({ object: 'customer', id: 'cus_synthetic', livemode: false });
    if (u.pathname.startsWith('/v1/prices/')) {
      const priceId = u.pathname.split('/').at(-1);
      for (const [group, maps] of Object.entries(prices)) {
        const entry = Object.entries(maps).find(([, p]) => p.priceId === priceId);
        if (!entry) continue;
        const [name, p] = entry, pack = group === 'packs';
        return json({ object: 'price', id: priceId, livemode: false, active: true, product: p.productId,
          currency: 'usd', unit_amount: pack ? LAUNCH_PACKS[name].basePriceCents : LAUNCH_PLANS[name].monthlyPriceCents,
          type: pack ? 'one_time' : 'recurring', recurring: pack ? null : { interval: 'month', interval_count: 1 } });
      }
    }
    if (u.pathname.startsWith('/v1/coupons/')) {
      // Stripe omits this includable field unless explicitly requested.
      if (JSON.stringify(u.searchParams.getAll('expand[]')) !== JSON.stringify(['applies_to'])) {
        throw Error('coupon_product_expansion_required');
      }
      const id = u.pathname.split('/').at(-1), plan = Object.keys(coupons).find(p => coupons[p] === id);
      return json({ object: 'coupon', id, livemode: false, valid: true, duration: 'once',
        percent_off: LAUNCH_PLANS[plan].packDiscountPercent, amount_off: null, currency: null,
        applies_to: { products: Object.values(prices.packs).map(p => p.productId) } });
    }
    if (u.pathname === '/v1/checkout/sessions' && init.method === 'POST') {
      const order = await store.getIntent(params.get('client_reference_id'));
      const base = order.kind === 'pack' ? LAUNCH_PACKS[order.packId].basePriceCents : order.amountCents;
      const s = { object: 'checkout.session', id: `cs_${order.intentId}`, livemode: false,
        mode: params.get('mode'), customer: params.get('customer'), client_reference_id: order.intentId,
        metadata: { intent_id: order.intentId }, currency: 'usd', amount_total: order.amountCents,
        amount_subtotal: base, total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: base - order.amountCents },
        status: 'open', payment_status: 'unpaid', payment_intent: null, subscription: null,
        url: `https://checkout.stripe.com/c/pay/cs_${order.intentId}` };
      f.created.push(params); f.sessions.push(s);
      if (f.losePost) throw new Error('private-upstream after provider commit');
      return json(s);
    }
    if (u.pathname === '/v1/checkout/sessions') return json({ object: 'list', has_more: false, data: f.sessions });
    const match = /^\/v1\/checkout\/sessions\/([^/]+)(\/line_items)?$/.exec(u.pathname);
    if (match) {
      const session = f.sessions.find(s => s.id === match[1]);
      if (match[2]) {
        const order = await store.getIntent(session.client_reference_id);
        return json({ object: 'list', has_more: false, data: [{ id: 'li_synthetic', quantity: 1,
          currency: 'usd', amount_subtotal: session.amount_subtotal, amount_total: session.amount_total,
          price: { id: order.priceId } }] });
      }
      return json(session);
    }
    throw new Error('private-upstream unconfigured synthetic route');
  };
  f.client = extraConfig => createMembershipCheckoutStripeTransport(config({ fetchImpl: f.fetch, ...extraConfig }));
  f.postCount = () => f.calls.filter(c => c.init.method === 'POST').length;
  return f;
}

await t.section('All catalog selections derive exact fixed creation parameters', async () => {
  await reset(); let n = 0;
  for (const plan of Object.keys(LAUNCH_PLANS)) {
    for (const packId of Object.keys(LAUNCH_PACKS)) {
      const order = await store.createIntent(intent(`pack-${n++}`, { plan, packId }));
      const f = fixture(), before = await snapshot();
      const result = await f.client().createCheckout(order), p = f.created[0];
      t.check(`${plan}/${packId}: one saved-intent session`, result.id === `cs_${order.intentId}` && f.postCount() === 1);
      t.check(`${plan}/${packId}: exact pack and coupon mapping`, p.get('line_items[0][price]') === order.priceId
        && p.get('line_items[0][quantity]') === '1' && p.get('discounts[0][coupon]') === coupons[plan]);
      t.check(`${plan}/${packId}: trusted customer not email`, p.get('customer') === order.customerId
        && !p.has('customer_email') && !p.has('metadata[google_sub]') && !p.has('metadata[tier]'));
      t.check(`${plan}/${packId}: fixed URLs no legacy grant trigger`, p.get('success_url') === `${ORIGIN}/?membership_return=1&session_id={CHECKOUT_SESSION_ID}`
        && p.get('cancel_url') === `${ORIGIN}/?membership_cancel=1`);
      t.check(`${plan}/${packId}: transport changes zero Redis bytes`, before === await snapshot());
      for (const c of f.calls) {
        t.check(`${plan}/${packId}: fixed host/version/no redirects`, new URL(c.url).origin === 'https://api.stripe.com'
          && c.init.redirect === 'error' && c.init.headers['Stripe-Version'] === VERSION && c.init.signal instanceof AbortSignal);
      }
      const post = f.calls.find(c => c.init.method === 'POST');
      t.check(`${plan}/${packId}: stable server idempotency/no pricing override`, post.init.headers['Idempotency-Key'] === order.stripeIdempotencyKey
        && p.get('allow_promotion_codes') === 'false' && p.get('automatic_tax[enabled]') === 'false'
        && ![...p.keys()].some(k => k.startsWith('payment_method_types') || k.includes('price_data')));
    }
  }
  for (const plan of Object.keys(LAUNCH_PLANS).filter(p => p !== 'free')) {
    const order = await store.createIntent(intent(`sub-${plan}`, { kind: 'subscription', plan, packId: null }));
    const f = fixture(); await f.client().createCheckout(order); const p = f.created[0];
    t.check(`${plan}: monthly subscription without pack coupon`, p.get('mode') === 'subscription'
      && p.get('line_items[0][price]') === prices.plans[plan].priceId && !p.has('discounts[0][coupon]'));
    t.check(`${plan}: no migration/proration/trial instructions`, ![...p.keys()].some(k => /proration|trial|billing_cycle|schedule/.test(k)));
  }
});

await t.section('Configuration, durable order and canonical preconditions fail before POST', async () => {
  await reset(); const order = await store.createIntent(intent());
  for (const override of [{ apiVersion: '2026-08-26.preview' }, { livemode: true }, { accountId: 'wrong' },
    { apiKey: `${KEY}\n` }, { operationTimeoutMs: 0 }, { couponMap: {} }, { priceMap: {} },
    { couponMap: { ...coupons, free: 'discount' } }, { couponMap: { ...coupons, pro: coupons.casual } }]) {
    await rejects('Invalid fixed configuration', () => fixture().client(override), 'write_configuration');
  }
  const f = fixture();
  for (const change of [{ owner: 'other' }, { amountCents: 1 }, { customerId: 'cus_other' },
    { priceId: 'price_other' }, { stripeIdempotencyKey: 'client-key' }, { intentId: hash('missing') },
    { success_url: 'https://attacker.test' }]) {
    await rejects('Caller order alteration refused', () => f.client().createCheckout({ ...order, ...change }));
  }
  t.check('Invalid order caused zero HTTP calls', f.calls.length === 0);
  await rejects('Arbitrary request options refused', () => f.client().createCheckout(order, { url: 'https://attacker.test' }), 'write_options');
  const routes = [
    ['GET /v1/account', { object: 'account', id: 'acct_other' }, 'account_mismatch'],
    ['GET /v1/customers/cus_synthetic', { object: 'customer', id: 'cus_synthetic', deleted: true }, 'customer_mismatch'],
    ['GET /v1/customers/cus_synthetic', { object: 'customer', id: 'cus_synthetic', livemode: true }, 'customer_mismatch'],
    ['GET /v1/prices/price_packs_id_25', { object: 'price', id: 'price_packs_id_25', livemode: false, active: false }, 'price_mismatch'],
    ['GET /v1/coupons/synthetic10?expand[]=applies_to', { object: 'coupon', id: 'synthetic10', percent_off: 25 }, 'coupon_mismatch'],
  ];
  for (const [route, value, code] of routes) {
    const g = fixture(); g.overrides.set(route, value);
    await rejects(`Canonical precondition ${code}`, () => g.client().createCheckout(order), code);
    t.check('Invalid precondition zero external POST', g.postCount() === 0);
  }
  const coupon = { object: 'coupon', id: coupons.casual, livemode: false, valid: true, duration: 'once',
    percent_off: 10, amount_off: null, currency: null,
    applies_to: { products: Object.values(prices.packs).map(p => p.productId) } };
  for (const change of [{ valid: false }, { livemode: true }, { percent_off: 15 }, { amount_off: 1 },
    { currency: 'usd' }, { duration: 'forever' }, { applies_to: null },
    { applies_to: { products: [prices.packs.id_25.productId] } }]) {
    const g = fixture(); g.overrides.set('GET /v1/coupons/synthetic10?expand[]=applies_to', { ...coupon, ...change });
    await rejects('Invalid configured coupon cannot be silently skipped', () => g.client().createCheckout(order), 'coupon_mismatch');
    t.check('Coupon mismatch performs zero POST', g.postCount() === 0);
  }
});

await t.section('Read-only complete discovery: locator is never grant authority', async () => {
  await reset(); const order = await store.createIntent(intent()), f = fixture();
  await f.client().createCheckout(order); f.calls.length = 0;
  t.check('Exact durable intent located', await f.client().recoverCheckout(order) === `cs_${order.intentId}`);
  t.check('Recovery sends GET only', f.calls.every(c => c.init.method === 'GET' && c.init.body === undefined
    && c.init.headers['Idempotency-Key'] === undefined));
  f.sessions[0].client_reference_id = 'unrelated'; f.sessions[0].metadata = { intent_id: order.intentId, credits: '99999' };
  t.check('Metadata alone cannot identify checkout', await f.client().recoverCheckout(order) === null);
  f.sessions[0].client_reference_id = order.intentId;
  f.sessions.push({ ...f.sessions[0], id: 'cs_duplicate' });
  await rejects('Two canonical intent matches ambiguous', () => f.client().recoverCheckout(order), 'discovery_ambiguous');
  f.sessions.pop(); f.sessions[0].livemode = true;
  await rejects('Wrong-mode list refused', () => f.client().recoverCheckout(order), 'discovery_invalid');
  f.sessions[0].livemode = false; f.sessions[0].customer = 'cus_other';
  await rejects('Wrong-customer list refused', () => f.client().recoverCheckout(order), 'discovery_invalid');

  const g = fixture(), root = 'GET /v1/checkout/sessions?customer=cus_synthetic&limit=100';
  const entry = (id, wanted = false) => ({ object: 'checkout.session', id, livemode: false,
    customer: 'cus_synthetic', client_reference_id: wanted ? order.intentId : 'other', mode: 'payment' });
  g.overrides.set(root, { object: 'list', has_more: true, url: 'https://attacker.test', data: [entry('cs_first', true)] });
  g.overrides.set(`${root}&starting_after=cs_first`, { object: 'list', has_more: false, data: [entry('cs_second')] });
  t.check('Candidate returned only after complete next page', await g.client().recoverCheckout(order) === 'cs_first');
  t.check('Provider next URL ignored; cursor derived from validated ID', g.calls.every(c => new URL(c.url).origin === 'https://api.stripe.com'));
  g.overrides.set(`${root}&starting_after=cs_first`, { object: 'list', has_more: true, data: [entry('cs_second')] });
  g.overrides.set(`${root}&starting_after=cs_second`, { object: 'list', has_more: true, data: [entry('cs_third')] });
  await rejects('Page limit never returns early candidate', () => g.client().recoverCheckout(order), 'discovery_incomplete');
  g.overrides.set(`${root}&starting_after=cs_first`, { object: 'list', has_more: false, data: [entry('cs_first')] });
  await rejects('Repeated session ID across pages refused', () => g.client().recoverCheckout(order), 'discovery_invalid');
  g.overrides.set(root, { object: 'list', has_more: true, data: [] });
  await rejects('Empty continuation page refused', () => g.client().recoverCheckout(order), 'discovery_invalid');
  g.overrides.set(root, { object: 'list', has_more: true, data: Array.from({ length: 100 }, (_, n) => entry(`cs_a${n}`, n === 0)) });
  g.overrides.set(`${root}&starting_after=cs_a99`, { object: 'list', has_more: true,
    data: Array.from({ length: 100 }, (_, n) => entry(`cs_b${n}`)) });
  g.overrides.set(`${root}&starting_after=cs_b99`, { object: 'list', has_more: false, data: [entry('cs_limit')] });
  await rejects('Total discovery limit never hides unexamined duplicates', () => g.client().recoverCheckout(order), 'discovery_incomplete');
});

await t.section('Response bounds, no redirects/retries, abort and whole-operation timeouts', async () => {
  await reset(); const order = await store.createIntent(intent());
  for (const [name, response, code] of [
    ['redirect', new Response('', { status: 302 }), 'transport_status'],
    ['provider rejection', new Response('private-upstream', { status: 400 }), 'transport_status'],
    ['malformed JSON', new Response('nil', { headers: { 'content-type': 'application/json' } }), 'transport_response'],
    ['non-JSON body', new Response('private-upstream'), 'transport_response'],
    ['invalid UTF8', new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }), 'transport_response'],
    ['oversized declared body', new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(LIMIT.responseBytes + 1) } }), 'transport_limit'],
    ['oversized actual body', new Response('x'.repeat(LIMIT.responseBytes + 1), { headers: { 'content-type': 'application/json' } }), 'transport_limit'],
    ['wrong actual length', new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '1' } }), 'transport_response'],
    ['compressed body refused', new Response('{}', { headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } }), 'transport_response'],
  ]) {
    const f = fixture(); f.overrides.set('POST /v1/checkout/sessions', response);
    await rejects(name, () => f.client().createCheckout(order), code);
    t.check(`${name}: never retries POST`, f.postCount() === 1);
  }
  const f = fixture(); let signal;
  f.overrides.set('POST /v1/checkout/sessions', async (url, init) => { signal = init.signal; return new Promise(() => {}); });
  await rejects('Whole operation bounded during unknown POST', () => f.client({ operationTimeoutMs: 30 }).createCheckout(order), 'transport_timeout');
  t.check('Timed-out request signal aborted without retry', signal?.aborted && f.postCount() === 1);
  const g = fixture(), abort = new AbortController(); abort.abort();
  await rejects('Already canceled before any work', () => g.client().createCheckout(order, { signal: abort.signal }), 'transport_aborted');
  t.check('Pre-abort performs zero HTTP calls', g.calls.length === 0);
  const h = fixture(), mid = new AbortController();
  h.overrides.set('GET /v1/account', async (url, init) => {
    setTimeout(() => mid.abort(), 5); return new Promise(() => {});
  });
  await rejects('Caller abort propagated while waiting', () => h.client().createCheckout(order, { signal: mid.signal }), 'transport_aborted');
  t.check('Caller abort stops all subsequent work', h.calls.length === 1 && h.calls[0].init.signal.aborted);
  const delayed = fixture();
  const delay = value => async () => { await new Promise(resolve => setTimeout(resolve, 25)); return json(value); };
  delayed.overrides.set('GET /v1/account', delay({ object: 'account', id: ACCOUNT }));
  delayed.overrides.set('GET /v1/customers/cus_synthetic', delay({ object: 'customer', id: 'cus_synthetic', livemode: false }));
  await rejects('Whole budget spans successive successful requests', () => delayed.client({ operationTimeoutMs: 40 }).createCheckout(order), 'transport_timeout');
  t.check('Whole budget prevents later price/coupon/POST work', delayed.calls.length === 2 && delayed.postCount() === 0);
  const streamed = fixture();
  streamed.overrides.set('GET /v1/account', new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('{')); // never completes
  } }), { headers: { 'content-type': 'application/json' } }));
  await rejects('Stalled response stream is bounded', () => streamed.client({ operationTimeoutMs: 20 }).recoverCheckout(order), 'transport_timeout');
  t.check('Stream timeout never starts discovery or POST', streamed.calls.length === 1);
});

await t.section('Exact frozen controller recovers lost POST response through real new HTTP transport', async () => {
  await reset(); const f = fixture({ losePost: true });
  const read = createMembershipStripeTransport({ apiKey: KEY, webhookSecret: 'whsec_syntheticOnly',
    accountId: ACCOUNT, livemode: false, apiVersion: VERSION, fetchImpl: f.fetch });
  const controller = createMembershipCheckoutController({
    execute: redis, bindings: store, authenticate: async () => ({ verified: true, uid: 'syntheticOwner' }),
    resolveContext: async owner => ({ owner, customerId: 'cus_synthetic', plan: 'casual', newSubscriptionAllowed: false }),
    stripe: { ...read, ...f.client() }, accountId: ACCOUNT, livemode: false,
  });
  const input = { token: 'synthetic-auth', request: { requestId: hash('controller'), kind: 'pack', selection: 'id_25' } };
  try { await controller.checkout(input); t.check('Lost POST outcome surfaces unavailable', false); }
  catch (error) { t.check('Lost POST outcome surfaces unavailable', error.code === 'checkout_unavailable'); }
  const before = await snapshot(); f.losePost = false;
  const reply = await controller.checkout(input);
  t.check('Read-only recovery delivers same hosted session', reply.status === 'checkout_ready' && reply.sessionId === f.sessions[0].id);
  t.check('Controller never sends a second creation POST', f.postCount() === 1);
  t.check('Recovery binds but never grants credits', !(await redis(['KEYS', '*'])).some(k => k.startsWith('scans:')));
  const bound = await snapshot(); await controller.checkout(input);
  t.check('Bound replay leaves durable bytes unchanged', bound === await snapshot() && before !== bound);
});
t.done();
