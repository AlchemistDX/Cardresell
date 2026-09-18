// Actual crypto and byte streams; only in-memory HTTP response fixtures.
// No Stripe calls or credentials. Canonical object shapes are SYNTHETIC,
// not proof of the pinned live API: Dahlia Sandbox validation remains UNRUN.
import { createHmac, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { harness } from './_assert.mjs';
import { createMembershipStripeTransport, readMembershipWebhookBody,
  MEMBERSHIP_STRIPE_API_VERSION as VERSION, MEMBERSHIP_STRIPE_LIMITS as LIMITS } from '../api/_membershipStripe.js';
import { createMembershipPaymentAdapter } from '../api/_membershipPayments.js';
import { LAUNCH_PLANS, LAUNCH_PACKS, quoteLaunchPack } from '../api/_launchMembershipConfig.js';
import { redisCommand as redis } from './_idRedis.mjs';
import { grantMembership } from '../api/_membershipLedger.js';

const t = harness('membership-stripe');
const NOW = 1800000000, SECRET = 'whsec_syntheticSecretOnly', KEY = 'sk_test_syntheticOnly';
const ACCOUNT = 'acct_synthetic', SESSION = 'cs_synthetic', PAYMENT = 'pi_synthetic';
const clone = x => structuredClone(x);
const json = x => new Response(JSON.stringify(x), { headers: { 'content-type': 'application/json' } });
const evt = (more = {}) => ({ object: 'event', id: 'evt_synthetic', livemode: false,
  account: ACCOUNT, api_version: VERSION, created: NOW - 1000000, type: 'checkout.session.completed',
  data: { object: { object: 'checkout.session', id: SESSION } }, ...more });
const bytes = x => Buffer.from(JSON.stringify(x));
const signature = (body, time = NOW, secret = SECRET) => `t=${time},v1=${createHmac('sha256', secret).update(String(time) + '.').update(body).digest('hex')}`;
const config = extra => ({ apiKey: KEY, webhookSecret: SECRET, accountId: ACCOUNT, livemode: false,
  apiVersion: VERSION, nowSeconds: () => NOW, ...extra });
async function rejects(label, fn, code) {
  try { await fn(); t.check(label, false, 'unexpected success'); }
  catch (error) { t.check(label, error.code === code, `actual ${error.code}`);
    t.check(`${label} exposes only fixed error`, !JSON.stringify(error).includes(SECRET)
      && !JSON.stringify(error).includes(KEY) && !JSON.stringify(error).includes('private-upstream-detail')); }
}
function stream(chunks, headers = {}) {
  const req = Readable.from(chunks); req.headers = { 'content-type': 'application/json', ...headers }; return req;
}
function fixture(extra = {}) {
  const calls = [], routes = {};
  routes['/v1/account'] = { object: 'account', id: ACCOUNT };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const u = new URL(url), value = routes[u.pathname + u.search];
    if (typeof value === 'function') return value(url, init);
    if (value instanceof Response) return value;
    if (value === undefined) throw new Error('private-upstream-detail');
    return json(value);
  };
  return { routes, calls, client: createMembershipStripeTransport(config({ fetchImpl, ...extra })) };
}

await t.section('Exact raw-byte verification and signature header policy', async () => {
  const f = fixture(), body = Buffer.from('{\n "object":"event","id":"evt_bytes","livemode":false,"account":"acct_synthetic",'
    + `"api_version":"${VERSION}","text":"é","created":1\n}`);
  t.check('Exact whitespace and UTF8 raw bytes verified', f.client.verifyWebhook(body, signature(body)).text === 'é');
  t.check('Uint8Array byte view verified', f.client.verifyWebhook(new Uint8Array(body), signature(body)).id === 'evt_bytes');
  const good = signature(body).split('v1=')[1], bad = '0'.repeat(64);
  t.check('Multiple v1 accepts valid signature after invalid candidate', f.client.verifyWebhook(body, `t=${NOW},v1=${bad},v1=${good}`).id === 'evt_bytes');
  t.check('Valid signature first also accepted', f.client.verifyWebhook(body, `v1=${good},v1=${bad},t=${NOW}`).id === 'evt_bytes');
  t.check('Legacy signature field never authoritative', f.client.verifyWebhook(body, `v0=legacy,${signature(body)}`).id === 'evt_bytes');
  t.check('Timestamp lower boundary accepted', !!f.client.verifyWebhook(body, signature(body, NOW - 300)));
  t.check('Timestamp future boundary accepted', !!f.client.verifyWebhook(body, signature(body, NOW + 30)));
  for (const [label, raw, header] of [
    ['reserialized body', bytes(JSON.parse(body)), signature(body)],
    ['one changed raw byte', Buffer.concat([body, Buffer.from(' ')]), signature(body)],
    ['wrong secret', body, signature(body, NOW, 'whsec_otherSynthetic')],
    ['missing signature', body, undefined],
    ['missing timestamp', body, `v1=${good}`],
    ['missing v1', body, `t=${NOW},v0=${good}`],
    ['duplicate timestamps', body, `t=${NOW},t=${NOW},v1=${good}`],
    ['noninteger timestamp', body, `t=${NOW}.1,v1=${good}`],
    ['old delivery timestamp', body, signature(body, NOW - 301)],
    ['future delivery timestamp', body, signature(body, NOW + 31)],
    ['short v1', body, `t=${NOW},v1=ab`],
    ['malformed hex v1', body, `t=${NOW},v1=${'z'.repeat(64)}`],
    ['too many v1 candidates', body, `t=${NOW},` + Array(9).fill(`v1=${good}`).join(',')],
    ['empty body', Buffer.alloc(0), signature(Buffer.alloc(0))],
    ['oversized body', Buffer.alloc(LIMITS.bodyBytes + 1), 't=1,v1=' + bad],
    ['parsed JSON body', evt(), signature(bytes(evt()))],
  ]) await rejects(label, () => f.client.verifyWebhook(raw, header), 'invalid_signature');
  for (const [label, event, code] of [
    ['wrong event account', evt({ account: 'acct_wrong' }), 'account_mismatch'],
    ['wrong event mode', evt({ livemode: true }), 'mode_mismatch'],
    ['wrong event API version', evt({ api_version: '2026-08-26.preview' }), 'version_mismatch'],
    ['missing event API version', evt({ api_version: undefined }), 'version_mismatch'],
    ['malformed event ID', evt({ id: '' }), 'event_invalid'],
  ]) {
    const b = bytes(event); await rejects(label, () => f.client.verifyWebhook(b, signature(b)), code);
  }
  for (const b of [Buffer.from('nil'), Buffer.from([0xff, 0xfe])]) {
    await rejects('Signed malformed JSON/UTF8 rejected', () => f.client.verifyWebhook(b, signature(b)), 'event_invalid');
  }
  t.check('Signature verification performs zero retrievals', f.calls.length === 0);
  const clock = fixture({ nowSeconds: () => { throw new Error('private-upstream-detail'); } });
  await rejects('Clock failure sanitized', () => clock.client.verifyWebhook(body, signature(body)), 'invalid_signature');
});

await t.section('Raw body reader accepts bytes only and enforces bounds', async () => {
  const body = bytes(evt()), req = stream([body.subarray(0, 7), body.subarray(7)], { 'content-length': String(body.length) });
  t.check('Chunked raw reader preserves exact bytes', (await readMembershipWebhookBody(req)).equals(body));
  const parsed = stream([body]); parsed.body = evt();
  await rejects('Parsed body cannot be reconstructed', () => readMembershipWebhookBody(parsed), 'body_invalid');
  await rejects('String chunks are not raw bytes', () => readMembershipWebhookBody(stream(['decoded text'])), 'body_invalid');
  await rejects('Wrong content type', () => readMembershipWebhookBody(stream([body], { 'content-type': 'text/plain' })), 'body_invalid');
  await rejects('Compressed body not implicitly transformed', () => readMembershipWebhookBody(stream([body], { 'content-encoding': 'gzip' })), 'body_invalid');
  await rejects('Oversized declared length rejected before read', () => readMembershipWebhookBody(stream([body], { 'content-length': String(LIMITS.bodyBytes + 1) })), 'body_limit');
  await rejects('Oversized streamed payload', () => readMembershipWebhookBody(stream([Buffer.alloc(LIMITS.bodyBytes + 1)])), 'body_limit');
  await rejects('Truncated declared length', () => readMembershipWebhookBody(stream([body], { 'content-length': String(body.length + 1) })), 'body_invalid');
  await rejects('Empty body', () => readMembershipWebhookBody(stream([])), 'body_invalid');
  const failed = new Readable({ read() { this.destroy(new Error('private-upstream-detail')); } }); failed.headers = { 'content-type': 'application/json' };
  await rejects('Stream error sanitized', () => readMembershipWebhookBody(failed), 'body_invalid');
});

await t.section('Pinned fixed-origin canonical retrieval and account/mode fence', async () => {
  const f = fixture();
  for (const [method, path, type, id] of [
    ['retrieveCheckoutSession', 'checkout/sessions', 'checkout.session', SESSION],
    ['retrievePaymentIntent', 'payment_intents', 'payment_intent', PAYMENT],
    ['retrieveInvoice', 'invoices', 'invoice', 'in_synthetic'],
    ['retrievePrice', 'prices', 'price', 'price_synthetic'],
    ['retrieveSubscription', 'subscriptions', 'subscription', 'sub_synthetic'],
  ]) {
    const query = method === 'retrieveInvoice' ? '?expand%5B%5D=amount_paid_off_stripe' : '';
    f.routes[`/v1/${path}/${id}${query}`] = { object: type, id, livemode: false, unchanged: { nested: null } };
    const result = await f.client[method](id);
    t.check(`${method} canonical object preserved`, result.id === id && result.unchanged.nested === null);
  }
  t.check('One coalesced account verification', f.calls.filter(c => c.url.endsWith('/account')).length === 1);
  t.check('All retrievals fixed HTTPS origin GET and redirects rejected', f.calls.every(c =>
    new URL(c.url).origin === 'https://api.stripe.com' && c.init.method === 'GET' && c.init.redirect === 'error'));
  t.check('Pinned API header on every request', f.calls.every(c => c.init.headers['Stripe-Version'] === VERSION));
  t.check('No per-request connected-account override', f.calls.every(c => !('Stripe-Account' in c.init.headers)));
  const invoiceCalls = f.calls.filter(c => new URL(c.url).pathname.startsWith('/v1/invoices/'));
  t.check('Invoice retrieval has exactly the fixed settlement expansion', invoiceCalls.length === 1
    && new URL(invoiceCalls[0].url).search === '?expand%5B%5D=amount_paid_off_stripe');
  await f.client.retrieveInvoice('in_synthetic', { expand: ['secret'], url: 'https://attacker.invalid' });
  t.check('Additional caller options cannot alter invoice URL', f.calls.at(-1).url === invoiceCalls[0].url);
  const beforeInvoice = f.calls.length;
  await rejects('Invoice ID cannot inject query', () => f.client.retrieveInvoice('in_synthetic?expand[]=secret'), 'invalid_reference');
  t.check('Malformed invoice ID never retrieves', f.calls.length === beforeInvoice);
  for (const id of ['https://other.invalid', 'cs_x?expand=all', 'cs_x/../account', 'cs_x\n', 'cs_']) {
    const count = f.calls.length;
    await rejects('Caller cannot supply URL/query/path ID', () => f.client.retrieveCheckoutSession(id), 'invalid_reference');
    t.check('Invalid ID never invokes transport', f.calls.length === count);
  }
  const wrong = fixture(); wrong.routes['/v1/account'].id = 'acct_other';
  await rejects('Wrong configured account', () => wrong.client.retrieveCheckoutSession(SESSION), 'account_mismatch');
  t.check('Account mismatch stops before object request', wrong.calls.length === 1);
  const mode = fixture(); mode.routes[`/v1/payment_intents/${PAYMENT}`] = { object: 'payment_intent', id: PAYMENT, livemode: true };
  await rejects('Canonical wrong mode rejected', () => mode.client.retrievePaymentIntent(PAYMENT), 'mode_mismatch');
  for (const bad of [{ apiVersion: undefined }, { apiVersion: '2026-08-26.preview' }, { apiKey: 'sk_live_syntheticOnly' },
    { apiKey: KEY + '\n' }, { webhookSecret: SECRET + '\n' }]) {
    await rejects('Unpinned/mismatched configuration refused', () => createMembershipStripeTransport(config(bad)), 'transport_configuration');
  }
});

await t.section('Canonical pagination completeness and bounded failures', async () => {
  for (const [method, root, parent, prefix] of [
    ['listCheckoutLineItems', 'checkout/sessions', SESSION, 'li'],
    ['listInvoiceLines', 'invoices', 'in_synthetic', 'il'],
  ]) {
    const path = `/v1/${root}/${parent}/${prefix === 'li' ? 'line_items' : 'lines'}`;
    const f = fixture();
    f.routes[path + '?limit=100'] = { object: 'list', has_more: true, data: [{ id: `${prefix}_one` }], url: 'https://attacker.invalid' };
    f.routes[path + `?limit=100&starting_after=${prefix}_one`] = { object: 'list', has_more: false, data: [{ id: `${prefix}_two` }] };
    const list = await f.client[method](parent);
    t.check(`${method} returns complete accumulated list`, list.has_more === false && list.data.length === 2);
    t.check(`${method} never follows provider supplied URL`, f.calls.every(c => c.url.startsWith('https://api.stripe.com/v1/')));
    for (const [label, value, code] of [
      ['empty continuation', { object: 'list', has_more: true, data: [] }, 'transport_response'],
      ['missing completeness flag', { object: 'list', data: [] }, 'transport_response'],
      ['malformed cursor identity', { object: 'list', has_more: true, data: [{ id: 'bad/path' }] }, 'transport_response'],
    ]) {
      const bad = fixture(); bad.routes[path + '?limit=100'] = value;
      await rejects(`${method}: ${label}`, () => bad.client[method](parent), code);
    }
    const repeated = fixture();
    repeated.routes[path + '?limit=100'] = { object: 'list', has_more: true, data: [{ id: `${prefix}_one` }] };
    repeated.routes[path + `?limit=100&starting_after=${prefix}_one`] = { object: 'list', has_more: false, data: [{ id: `${prefix}_one` }] };
    await rejects(`${method}: duplicate pagination item`, () => repeated.client[method](parent), 'transport_response');
    const endless = fixture();
    for (let i = 0; i < 3; i++) endless.routes[path + `?limit=100${i ? `&starting_after=${prefix}_${i}` : ''}`]
      = { object: 'list', has_more: true, data: [{ id: `${prefix}_${i + 1}` }] };
    await rejects(`${method}: page cap never returned as complete`, () => endless.client[method](parent), 'transport_limit');
  }
});

await t.section('Transport errors, malformed responses, and sanitized outcomes', async () => {
  const cases = [
    ['HTTP error', () => new Response('private-upstream-detail', { status: 503 }), 'transport_status'],
    ['redirect status', () => new Response('', { status: 302, headers: { location: 'https://attacker.invalid' } }), 'transport_status'],
    ['non JSON body', () => new Response('nil', { headers: { 'content-type': 'application/json' } }), 'transport_response'],
    ['HTML response', () => new Response('<html>', { headers: { 'content-type': 'text/html' } }), 'transport_response'],
    ['too large declared body', () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(LIMITS.responseBytes + 1) } }), 'transport_limit'],
    ['response lost', () => { throw new Error(`private-upstream-detail ${KEY} ${SECRET}`); }, 'transport_unavailable'],
    ['already followed redirect', () => ({ status: 200, redirected: true }), 'transport_status'],
    ['different effective response URL', () => ({ status: 200, redirected: false, url: 'https://attacker.invalid' }), 'transport_response'],
    ['unexpected compressed response', () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } }), 'transport_response'],
    ['streamed oversize', () => new Response(new Uint8Array(LIMITS.responseBytes + 1), { headers: { 'content-type': 'application/json' } }), 'transport_limit'],
    ['malformed response UTF8', () => new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }), 'transport_response'],
    ['interrupted response body', () => new Response(new ReadableStream({ start(c) { c.error(new Error('private-upstream-detail')); } }),
      { headers: { 'content-type': 'application/json' } }), 'transport_unavailable'],
  ];
  for (const [label, fn, code] of cases) {
    const f = fixture(); f.routes['/v1/account'] = fn;
    await rejects(label, () => f.client.retrieveAccount(), code);
    t.check(`${label}: never automatically retried`, f.calls.length === 1);
  }
  // Real bounded timers, not shortened production limits. Run stalled body and
  // fetch concurrently so test wall time remains bounded to one timeout window.
  const stalled = new Readable({ read() {} }); stalled.headers = { 'content-type': 'application/json' };
  const f = fixture({ fetchImpl: () => new Promise(() => {}) });
  await Promise.all([
    rejects('Unresponsive fetch times out even if abort ignored', () => f.client.retrieveAccount(), 'transport_timeout'),
    rejects('Stalled raw body times out', () => readMembershipWebhookBody(stalled), 'body_timeout'),
  ]);
});

await t.section('Actual verifier/transport plus approved adapter: no grant on unknown outcomes', async () => {
  const f = fixture(), quote = quoteLaunchPack('id_25', 'casual'), prices = { packs: {}, plans: {} };
  for (const [group, catalog] of [['packs', LAUNCH_PACKS], ['plans', LAUNCH_PLANS]]) {
    for (const name of Object.keys(catalog)) if (name !== 'free') prices[group][name] = { priceId: `price_${group}_${name}`, productId: `prod_${group}_${name}` };
  }
  const order = { version: 'launch-v2', kind: 'pack', owner: 'syntheticOwner', accountId: ACCOUNT, livemode: false,
    customerId: 'cus_synthetic', sessionId: SESSION, paymentId: PAYMENT, packId: 'id_25', planAtCheckout: 'casual',
    priceId: prices.packs.id_25.priceId, quantity: 1, currency: 'usd', amountCents: quote.amountCents };
  f.routes[`/v1/checkout/sessions/${SESSION}`] = { object: 'checkout.session', id: SESSION, livemode: false,
    mode: 'payment', status: 'complete', payment_status: 'paid', customer: order.customerId, subscription: null,
    currency: 'usd', amount_total: quote.amountCents, amount_subtotal: quote.basePriceCents, payment_intent: PAYMENT,
    total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: quote.basePriceCents - quote.amountCents } };
  f.routes[`/v1/checkout/sessions/${SESSION}/line_items?limit=100`] = { object: 'list', has_more: false,
    data: [{ id: 'li_synthetic', quantity: 1, currency: 'usd', amount_total: quote.amountCents,
      amount_subtotal: quote.basePriceCents, price: { id: order.priceId } }] };
  f.routes[`/v1/prices/${order.priceId}`] = { object: 'price', id: order.priceId, livemode: false,
    product: prices.packs.id_25.productId, currency: 'usd', unit_amount: quote.basePriceCents, type: 'one_time', recurring: null };
  f.routes[`/v1/payment_intents/${PAYMENT}`] = { object: 'payment_intent', id: PAYMENT, livemode: false,
    status: 'succeeded', currency: 'usd', amount: quote.amountCents, amount_received: quote.amountCents, customer: order.customerId };
  // Fulfillment spy: this slice proves no invocation on rejection, not credit
  // idempotency itself (already proven in approved ledger/adapter Redis suites).
  const grants = [];
  const adapter = createMembershipPaymentAdapter({ stripe: f.client,
    bindings: { getCheckoutOrder: async () => clone(order), getSubscriptionTerm: async () => null },
    fulfill: async (kind, data) => { grants.push({ kind, data }); return { accepted: true }; },
    accountId: ACCOUNT, livemode: false, priceMap: prices });
  let b = bytes(evt());
  await rejects('Bad HMAC stops before any retrieval or grant', () => adapter.webhook({ rawBody: b, signature: signature(b, NOW, 'wrong') }), 'invalid_signature');
  t.check('Invalid signature no retrieval or fulfillment', f.calls.length === 0 && grants.length === 0);
  await adapter.webhook({ rawBody: b, signature: signature(b) });
  t.check('Valid exact raw signed event reaches approved adapter', grants.length === 1 && grants[0].data.paymentId === PAYMENT);
  b = bytes(evt({ id: 'evt_earlier', created: NOW - 2000000 }));
  await adapter.webhook({ rawBody: b, signature: signature(b) });
  t.check('Out-of-order event age not used to suppress canonical replay', grants.length === 2
    && grants[0].data.paymentId === grants[1].data.paymentId);
  f.routes[`/v1/payment_intents/${PAYMENT}`] = () => { throw new Error('private-upstream-detail'); };
  const before = grants.length;
  await rejects('Unknown canonical response outcome does not fulfill', () => adapter.checkoutReturn({
    sessionId: SESSION, authenticatedOwner: order.owner,
  }), 'payment_unavailable');
  t.check('No grant on unknown retrieval', grants.length === before);
});

await t.section('Dahlia canonical HTTP fixtures through verifier, adapter and actual Redis ledger', async () => {
  await redis(['FLUSHDB']); // This process owns a private local Unix socket.
  const f = fixture(), prices = { packs: {}, plans: {} };
  for (const [group, catalog] of [['packs', LAUNCH_PACKS], ['plans', LAUNCH_PLANS]]) {
    for (const name of Object.keys(catalog)) if (name !== 'free') {
      prices[group][name] = { priceId: `price_${group}_${name}`, productId: `prod_${group}_${name}` };
    }
  }
  const time = Number((await redis(['TIME']))[0]), invoiceId = 'in_dahlia', subId = 'sub_dahlia';
  const owner = 'syntheticDahliaOwner', customer = 'cus_dahlia', mapping = prices.plans.casual;
  const billPath = `/v1/invoices/${invoiceId}?expand%5B%5D=amount_paid_off_stripe`;
  const linesPath = `/v1/invoices/${invoiceId}/lines?limit=100`;
  const invoice = { object: 'invoice', id: invoiceId, livemode: false, status: 'paid',
    amount_paid_off_stripe: 0, amount_remaining: 0, status_transitions: { paid_at: time - 10 },
    billing_reason: 'subscription_cycle', parent: { type: 'subscription_details',
      subscription_details: { subscription: subId } }, customer, currency: 'usd',
    amount_due: 999, amount_paid: 999, total: 999, amount_overpaid: 0, amount_shipping: 0,
    starting_balance: 0, ending_balance: 0, pre_payment_credit_notes_amount: 0, post_payment_credit_notes_amount: 0,
    total_taxes: [], total_discount_amounts: [] };
  const line = { id: 'il_dahlia', object: 'line_item', livemode: false, quantity: 1, quantity_decimal: '1',
    parent: { type: 'subscription_item_details', subscription_item_details: {
      subscription: subId, subscription_item: 'si_dahlia', proration: false } },
    pricing: { type: 'price_details', price_details: { price: mapping.priceId, product: mapping.productId },
      unit_amount_decimal: '999' }, period: { start: time - 100, end: time + 1000 },
    currency: 'usd', amount: 999, taxes: [], discount_amounts: [], pretax_credit_amounts: [] };
  const term = { version: 'launch-v2', kind: 'subscription', owner, accountId: ACCOUNT, livemode: false,
    subscriptionId: subId, customerId: customer, plan: 'casual', priceId: mapping.priceId, currency: 'usd',
    amountCents: 999, effectiveFrom: time - 1000, effectiveUntil: null };
  const restore = () => {
    f.routes[billPath] = clone(invoice);
    f.routes[linesPath] = { object: 'list', has_more: false, data: [clone(line)] };
  };
  restore();
  f.routes[`/v1/subscriptions/${subId}`] = { object: 'subscription', id: subId, livemode: false,
    customer, status: 'canceled', items: { object: 'list', has_more: false,
      data: [{ id: 'si_newer', current_period_start: time + 2000, current_period_end: time + 3000 }] } };
  f.routes[`/v1/prices/${mapping.priceId}`] = { object: 'price', id: mapping.priceId, livemode: false,
    product: mapping.productId, currency: 'usd', unit_amount: 999, type: 'recurring',
    recurring: { interval: 'month', interval_count: 1 } };
  const grants = []; let loseResponse = false;
  const adapter = createMembershipPaymentAdapter({ stripe: f.client, accountId: ACCOUNT, livemode: false,
    priceMap: prices, bindings: { getCheckoutOrder: async () => null, getSubscriptionTerm: async (id, start) => {
      t.check('Immutable term queried with historical canonical period', id === subId && start === line.period.start);
      return clone(term);
    } }, fulfill: async (kind, data) => {
      grants.push({ kind, data }); const result = await grantMembership(redis, kind, data);
      if (loseResponse) throw new Error('synthetic response loss after local commit'); return result;
    } });
  const deliver = (type = 'invoice.paid', eventId = 'evt_dahlia') => {
    // Event inline claims are intentionally stale and are never used as proof.
    const b = bytes(evt({ id: eventId, type, data: { object: { object: 'invoice', id: invoiceId,
      status: 'open', amount_paid_off_stripe: 999, parent: null } } }));
    return adapter.webhook({ rawBody: b, signature: signature(b) });
  };
  const first = await deliver();
  t.check('Canonical refetch, not event object/current subscription, grants historical period', first.granted
    && grants[0].data.periodStart === line.period.start && grants[0].data.plan === 'casual');
  const snapshot = async () => JSON.stringify(await Promise.all((await redis(['KEYS', '*'])).sort()
    .map(async key => [key, await redis(['GET', key])])));
  const once = await snapshot();
  const replies = await Promise.all(Array.from({ length: 8 }, (_, i) => deliver('invoice.payment_succeeded', `evt_dup${i}`)));
  t.check('Transport concurrent webhook retries preserve one invoice/period and exact bytes',
    replies.every(x => JSON.stringify(x) === JSON.stringify(first)) && await snapshot() === once);
  t.check('Both event types always refetch invoice with fixed expansion',
    f.calls.filter(c => c.url.endsWith(billPath)).length === 9);
  await redis(['FLUSHDB']); loseResponse = true;
  await rejects('Actual local ledger committed response loss remains unknown', () => deliver(), 'payment_unavailable');
  const afterCommit = await snapshot(); loseResponse = false;
  await deliver('invoice.payment_succeeded', 'evt_retry');
  t.check('Response-loss retry keeps one exact invoice/period', await snapshot() === afterCommit);
  const cases = [
    ['missing expanded amount', () => { delete f.routes[billPath].amount_paid_off_stripe; }, 'payment_not_settled'],
    ['string expanded amount', () => { f.routes[billPath].amount_paid_off_stripe = '0'; }, 'payment_not_settled'],
    ['partial off-Stripe payment', () => { f.routes[billPath].amount_paid_off_stripe = 1; }, 'payment_not_settled'],
    ['canonical unpaid despite event type', () => { f.routes[billPath].status = 'open'; }, 'payment_not_settled'],
    ['legacy paid flag mixed into invoice', () => { f.routes[billPath].paid = true; }, 'invoice_schema_mismatch'],
    ['credit-balance settlement', () => { f.routes[billPath].starting_balance = -1; }, 'unsupported_settlement'],
    ['fractional quantity hidden by integer truncation', () => { f.routes[linesPath].data[0].quantity_decimal = '1.1'; }, 'line_mismatch'],
    ['missing line pricing', () => { delete f.routes[linesPath].data[0].pricing; }, 'line_schema_mismatch'],
    ['incomplete pagination continuation unavailable', () => { f.routes[linesPath].has_more = true; }, 'payment_unavailable'],
    ['unknown invoice response', () => { f.routes[billPath] = () => { throw new Error('private-upstream-detail'); }; }, 'payment_unavailable'],
  ];
  for (const [label, mutate, code] of cases) {
    restore(); mutate(); const before = await snapshot(), count = grants.length;
    await rejects(label, () => deliver(), code);
    t.check(`${label}: zero fulfill calls and all ledger bytes unchanged`, grants.length === count && await snapshot() === before);
  }
});

await t.section('Frozen approved modules and inactive source scope', async () => {
  const hashes = {
    '../api/_membershipPayments.js': 'd1a7d809bb437ca5549c2fbc3b0bb559916c20413ffae9551df1063ef5f3e54a',
    '../api/_membershipBindings.js': '3fff2c8200c7127a814c5c8433fddd7301241826e86359b041e1abb3dbf9d8be',
    '../api/_membershipLedger.js': '0307633fd5078810d28ac20e63cec1996bd8e4630da2008f4545ad3d21b44044',
    '../api/_launchMembershipConfig.js': '513dcfa7f82a343c304d25bb192368e96076e5ad0677e98bbe5a5e67a799b0a5',
    '../api/_idBilling.js': '8421956233263237dbb941e154b8a8ab315db49bd3ee16c089ccb6d894238a1a',
  };
  for (const [file, expected] of Object.entries(hashes)) t.check(`Approved ${file} unchanged`,
    createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex') === expected);
  const source = readFileSync(new URL('../api/_membershipStripe.js', import.meta.url), 'utf8');
  t.check('Transport has no environment access or logging', !/process\.env|console\./.test(source));
  t.check('No mutating HTTP methods', !/method:\s*['"](POST|PATCH|DELETE|PUT)/.test(source));
});
t.done();
