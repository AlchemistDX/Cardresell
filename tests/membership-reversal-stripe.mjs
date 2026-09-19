// Synthetic canonical API objects and native Response streams; actual private
// Redis immutable bindings/customer association. No external calls/credentials.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { harness } from './_assert.mjs';
import { redisCommand as redis } from './_idRedis.mjs';
import { createMembershipReversalStripe } from '../api/_membershipReversalStripe.js';
import { createMembershipBindingStore } from '../api/_membershipBindings.js';
import { createMembershipCustomers } from '../api/_membershipCustomer.js';
import { LAUNCH_PLANS, LAUNCH_PACKS } from '../api/_launchMembershipConfig.js';
import { MEMBERSHIP_STRIPE_API_VERSION } from '../api/_membershipStripe.js';

const t = harness('membership-reversal-stripe'), sha = x => createHash('sha256').update(x).digest('hex');
const UID = 'syntheticReversalOwner', ACCOUNT = 'acct_reversal', CUSTOMER = 'cus_reversal';
const PI = 'pi_reversal', CH = 'ch_reversal', SUB = 'sub_reversal', CS = 'cs_reversal', IN = 'in_reversal';
const KEY = 'sk_test_syntheticreversalnotacredential', clone = x => structuredClone(x);
const list = data => ({ object: 'list', has_more: false, data });
const snapshot = async () => JSON.stringify(await Promise.all((await redis(['KEYS', '*'])).sort()
  .map(async k => [k, await redis(['GET', k]), await redis(['PTTL', k])])));
const reject = async (label, fn, code) => {
  try { await fn(); t.check(label, false, 'unexpected success'); }
  catch (e) { t.check(label, code === undefined || e.code === code, `actual ${e.code}`); return e; }
};
async function fixture(kind = 'pack') {
  await redis(['FLUSHDB']); // this process's isolated Redis only
  const prices = { plans: {}, packs: {} };
  for (const [group, catalog] of [['plans', LAUNCH_PLANS], ['packs', LAUNCH_PACKS]]) {
    for (const name of Object.keys(catalog)) if (name !== 'free') {
      prices[group][name] = { priceId: `price_${group}_${name}`, productId: `prod_${group}_${name}` };
    }
  }
  const amount = kind === 'pack' ? 299 : 999;
  const customer = { object: 'customer', id: CUSTOMER, livemode: false };
  const customers = createMembershipCustomers({ execute: redis, accountId: ACCOUNT, livemode: false,
    allowCreate: async () => true, stripe: {
      retrieveAccount: async () => ({ object: 'account', id: ACCOUNT }),
      retrieveCustomer: async () => customer,
      createCustomer: async () => customer,
    } });
  await customers.ensure(UID);
  const bindings = createMembershipBindingStore({ execute: redis, accountId: ACCOUNT, livemode: false, priceMap: prices });
  const intent = { intentId: sha('reversal-origin'), owner: UID, customerId: CUSTOMER, kind,
    plan: kind === 'pack' ? 'free' : 'casual', packId: kind === 'pack' ? 'id_25' : null };
  await bindings.createIntent(intent);
  await bindings.bindSession({ intentId: intent.intentId, sessionId: CS });
  await bindings.bindSettlement({ intentId: intent.intentId, sessionId: CS,
    paymentId: kind === 'pack' ? PI : null, subscriptionId: kind === 'pack' ? null : SUB });
  const session = { object: 'checkout.session', id: CS, livemode: false, client_reference_id: intent.intentId,
    customer: CUSTOMER, status: 'complete', payment_status: 'paid', mode: kind === 'pack' ? 'payment' : 'subscription',
    payment_intent: kind === 'pack' ? PI : null, subscription: kind === 'pack' ? null : SUB,
    amount_total: amount, currency: 'usd', metadata: { owner: 'ignoredWrongOwner' } };
  const link = { object: 'invoice_payment', id: 'inpay_reversal', livemode: false, invoice: IN,
    payment: { type: 'payment_intent', payment_intent: PI }, status: 'paid' };
  const f = { calls: [], override: null, bindings, customers, data: {
    account: { object: 'account', id: ACCOUNT },
    'refunds/re_reversal': { object: 'refund', id: 're_reversal', charge: CH, payment_intent: PI,
      amount: 100, currency: 'usd', status: 'succeeded' }, // no required Refund.livemode
    'disputes/dp_reversal': { object: 'dispute', id: 'dp_reversal', livemode: false, charge: CH,
      payment_intent: PI, amount, currency: 'usd', status: 'needs_response' },
    ['charges/' + CH]: { object: 'charge', id: CH, livemode: false, customer: CUSTOMER, payment_intent: PI,
      paid: true, status: 'succeeded', amount, currency: 'usd', amount_refunded: 100, refunded: false },
    ['payment_intents/' + PI]: { object: 'payment_intent', id: PI, livemode: false, customer: CUSTOMER,
      latest_charge: CH, status: 'succeeded', amount, amount_received: amount, currency: 'usd' },
    ['customers/' + CUSTOMER]: customer,
    invoice_payments: list(kind === 'pack' ? [] : [link]),
    ['invoices/' + IN]: { object: 'invoice', id: IN, livemode: false, customer: CUSTOMER, currency: 'usd',
      parent: { type: 'subscription_details', subscription_details: { subscription: SUB } } },
    ['subscriptions/' + SUB]: { object: 'subscription', id: SUB, livemode: false, customer: CUSTOMER, status: 'canceled' },
    'checkout/sessions': list([session]),
    ['checkout/sessions/' + CS]: session,
  } };
  f.fetch = async (url, options) => {
    const parsed = new URL(url), route = parsed.pathname.slice(4);
    f.calls.push({ url, options, route, query: Object.fromEntries(parsed.searchParams) });
    if (f.override) {
      const override = await f.override(route, parsed.searchParams, options);
      if (override !== undefined) return override;
    }
    if (!Object.hasOwn(f.data, route)) throw new Error('unexpected synthetic path');
    return Response.json(clone(f.data[route]));
  };
  f.options = { apiKey: KEY, accountId: ACCOUNT, bindings, customers, fetchImpl: f.fetch };
  f.api = createMembershipReversalStripe(f.options);
  f.resolve = (eventType = 'refund.created', objectId = 're_reversal') => f.api.resolveReversalProvenance({ eventType, objectId });
  return f;
}

await t.section('canonical pack and invoice owner trace with actual immutable stores', async () => {
  for (const kind of ['pack', 'subscription']) {
    const f = await fixture(kind), before = await snapshot(), result = await f.resolve();
    t.check(`${kind}: exact original payment and complete invoice lookup`, result.paymentId === PI
      && result.invoiceId === (kind === 'pack' ? null : IN) && result.invoiceLookupComplete === true);
    t.check(`${kind}: canonical mode/customer verified, no owner metadata exported`, result.accountId === ACCOUNT
      && result.livemode === false && result.customerId === CUSTOMER && result.reason === 'refund_succeeded'
      && Object.keys(result).length === 9);
    t.check(`${kind}: canonical linkage and binding checks read-only`, before === await snapshot());
    t.check(`${kind}: all calls fixed host/pin/credential and GET/no redirect`, f.calls.every(c =>
      new URL(c.url).origin === 'https://api.stripe.com' && c.options.method === 'GET'
      && c.options.redirect === 'error' && c.options.headers.Authorization === `Bearer ${KEY}`
      && c.options.headers['Stripe-Version'] === MEMBERSHIP_STRIPE_API_VERSION
      && !Object.hasOwn(c.options.headers, 'Stripe-Account')));
    t.check(`${kind}: actual credential account verified first`, f.calls[0].route === 'account');
    const query = f.calls.find(c => c.route === 'invoice_payments').query;
    t.check(`${kind}: documented nested PI filter (no status truncation)`,
      query['payment[type]'] === 'payment_intent' && query['payment[payment_intent]'] === PI && !query.status);
    t.check(`${kind}: exact Checkout lookup filter`, f.calls.find(c => c.route === 'checkout/sessions').query[
      kind === 'pack' ? 'payment_intent' : 'subscription'] === (kind === 'pack' ? PI : SUB));
    t.check(`${kind}: duplicate lookup returns exact result without storage writes`,
      JSON.stringify(await f.resolve()) === JSON.stringify(result) && before === await snapshot());
  }
});

await t.section('canonical refund/dispute statuses and partial charge refunds', async () => {
  const f = await fixture();
  for (const [status, reason] of [['pending', 'refund_pending'], ['requires_action', 'refund_pending'],
    ['succeeded', 'refund_succeeded'], ['failed', 'refund_failed'], ['canceled', 'refund_canceled']]) {
    f.data['refunds/re_reversal'].status = status;
    t.check(`refund ${status} explicit sticky review reason`, (await f.resolve()).reason === reason);
  }
  for (const status of ['needs_response', 'under_review', 'warning_needs_response', 'warning_under_review',
    'lost', 'won', 'warning_closed', 'prevented']) {
    f.data['disputes/dp_reversal'].status = status;
    const reason = ['lost', 'won', 'warning_closed', 'prevented'].includes(status) ? 'dispute_closed' : 'dispute_open';
    t.check(`dispute ${status} explicit sticky review reason`, (await f.resolve('charge.dispute.closed', 'dp_reversal')).reason === reason);
  }
  t.check('partial refund with refunded:false is supported', (await f.resolve('charge.refunded', CH)).reason === 'charge_refunded');
  f.data['charges/' + CH].amount_refunded = 0;
  await reject('event name alone cannot prove refund', () => f.resolve('charge.refunded', CH), 'reversal_refund_unproven');
});

await t.section('wrong credential account and canonical broken link fail before provenance', async () => {
  const cases = [
    ['actual credential account', f => { f.data.account.id = 'acct_wrong'; }, 'reversal_canonical_mismatch'],
    ['live charge', f => { f.data['charges/' + CH].livemode = true; }, 'reversal_canonical_mismatch'],
    ['live payment', f => { f.data['payment_intents/' + PI].livemode = true; }, 'reversal_canonical_mismatch'],
    ['refund payment mismatch', f => { f.data['refunds/re_reversal'].payment_intent = 'pi_wrong'; }, 'reversal_link_mismatch'],
    ['refund customer mismatch', f => { f.data['refunds/re_reversal'].customer = 'cus_wrong'; }, 'reversal_customer_mismatch'],
    ['different PI customer', f => { f.data['payment_intents/' + PI].customer = 'cus_other'; }, 'reversal_payment_mismatch'],
    ['different latest charge', f => { f.data['payment_intents/' + PI].latest_charge = 'ch_other'; }, 'reversal_payment_mismatch'],
    ['deleted customer', f => { f.data['customers/' + CUSTOMER].deleted = true; }, 'reversal_canonical_mismatch'],
    ['missing durable origin locator', f => { delete f.data['checkout/sessions/' + CS].client_reference_id; }, 'reversal_checkout_invalid'],
    ['unpaid session', f => { f.data['checkout/sessions/' + CS].payment_status = 'unpaid'; }, 'reversal_checkout_invalid'],
    ['unrecognized refund status', f => { f.data['refunds/re_reversal'].status = 'invented'; }, 'reversal_status_invalid'],
  ];
  for (const [name, mutate, code] of cases) {
    const f = await fixture(); mutate(f); const before = await snapshot();
    await reject(name + ' rejected', () => f.resolve(), code);
    t.check(name + ' no storage changes', await snapshot() === before);
    if (name === 'actual credential account') t.check('wrong account stops before reading any financial object', f.calls.length === 1);
  }
  const f = await fixture(), before = await snapshot();
  const wrongBindings = createMembershipReversalStripe({ ...f.options, bindings: {
    inspectIntent: async intent => ({ ...await f.bindings.inspectIntent(intent), paymentId: 'pi_wrong' }),
  } });
  await reject('durable PI differs from canonical checkout', () => wrongBindings.resolveReversalProvenance({
    eventType: 'refund.created', objectId: 're_reversal' }), 'reversal_origin_mismatch');
  const wrongOwner = createMembershipReversalStripe({ ...f.options, customers: {
    get: async owner => ({ ...await f.customers.get(owner), owner: 'otherOwner' }),
  } });
  await reject('customer association must match exact durable owner', () => wrongOwner.resolveReversalProvenance({
    eventType: 'refund.created', objectId: 're_reversal' }), 'reversal_owner_mismatch');
  t.check('binding and owner failures read-only', await snapshot() === before);
});

await t.section('complete pagination, invoice relationship and ambiguity controls', async () => {
  const f = await fixture('subscription'), row = f.data.invoice_payments.data[0];
  f.override = async (route, query) => {
    if (route === 'invoice_payments') return Response.json(query.has('starting_after')
      ? list([{ ...row, id: 'inpay_second' }]) : { ...list([row]), has_more: true });
  };
  t.check('two pages same canonical invoice accepted after complete lookup', (await f.resolve()).invoiceId === IN);
  t.check('pagination uses server-observed last item ID', f.calls.some(c => c.query.starting_after === row.id));
  f.override = async route => route === 'invoice_payments'
    ? Response.json({ ...list([]), has_more: true }) : undefined;
  await reject('empty incomplete page cannot imply no invoice', () => f.resolve(), 'reversal_pagination_invalid');
  f.override = async (route, query) => route === 'invoice_payments'
    ? Response.json({ ...list([{ ...row, id: 'inpay_' + (query.get('starting_after') || 'first') + 'x' }]), has_more: true })
    : undefined;
  await reject('page limit cannot return partial provenance', () => f.resolve(), 'reversal_pagination_incomplete');
  f.override = null;
  f.data.invoice_payments.data.push({ ...row, id: 'inpay_other', invoice: 'in_other' });
  await reject('PI allocated to multiple invoices is explicitly ambiguous', () => f.resolve(), 'reversal_invoice_ambiguous');
  f.data.invoice_payments.data = [{ ...row, payment: { type: 'payment_intent', payment_intent: 'pi_other' } }];
  await reject('server list item must actually match PI filter', () => f.resolve(), 'reversal_invoice_link_invalid');
  f.data.invoice_payments = list([row]); f.data['invoices/' + IN].customer = 'cus_other';
  await reject('invoice customer exact canonical match', () => f.resolve(), 'reversal_invoice_mismatch');
  f.data['invoices/' + IN].customer = CUSTOMER; f.data['invoices/' + IN].subscription = SUB;
  await reject('legacy mixed invoice schema rejected', () => f.resolve(), 'reversal_invoice_mismatch');
  delete f.data['invoices/' + IN].subscription;
  f.data['checkout/sessions'].data.push({ ...f.data['checkout/sessions/' + CS], id: 'cs_second' });
  await reject('multiple Checkout origins fail rather than choose arbitrary owner', () => f.resolve(), 'reversal_origin_ambiguous');
});

await t.section('transport errors, bounded whole operation and no secret leakage', async () => {
  for (const [name, response, expected] of [
    ['redirect', new Response('', { status: 302, headers: { location: 'https://other.test' } }), 'reversal_transport_response'],
    ['non-JSON', new Response('private provider error', { status: 200, headers: { 'content-type': 'text/plain' } }), 'reversal_transport_response'],
    ['malformed JSON', new Response('{bad', { headers: { 'content-type': 'application/json' } }), 'reversal_transport_response'],
    ['too large advertised body', new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '9999999' } }), 'reversal_transport_limit'],
  ]) {
    const f = await fixture(); f.override = async () => response;
    await reject(name + ' fails closed', () => f.resolve(), expected);
  }
  const f = await fixture(), before = await snapshot();
  f.override = async () => { throw new Error('provider body secret:' + KEY); };
  const error = await reject('lost canonical response yields sanitized unavailable', () => f.resolve(), 'reversal_transport_unavailable');
  t.check('no credential/raw body/cause exported', !JSON.stringify(error).includes(KEY) && !error.cause
    && !error.message.includes('provider'));
  t.check('transport loss writes nothing', before === await snapshot());
  let observedSignal;
  const hung = createMembershipReversalStripe({ ...f.options, operationTimeoutMs: 100,
    fetchImpl: async (_, options) => { observedSignal = options.signal; return new Promise(() => {}); } });
  await reject('whole operation times out even if fetch ignores abort', () => hung.resolveReversalProvenance({
    eventType: 'refund.created', objectId: 're_reversal' }), 'reversal_deadline');
  t.check('timeout abort propagated', observedSignal.aborted);
  let canceled = false;
  const hungBody = createMembershipReversalStripe({ ...f.options, operationTimeoutMs: 100,
    fetchImpl: async () => new Response(new ReadableStream({ cancel() { canceled = true; } }),
      { headers: { 'content-type': 'application/json' } }) });
  await reject('whole deadline covers hung response stream', () => hungBody.resolveReversalProvenance({
    eventType: 'refund.created', objectId: 're_reversal' }), 'reversal_deadline');
  t.check('hung stream actively canceled', canceled);
});

await t.section('configuration and locators cannot redirect requests or use live mode', async () => {
  const f = await fixture();
  for (const change of [{ apiKey: 'sk_live_unusable' }, { livemode: true }, { accountId: 'acct_x/../wrong' }]) {
    await reject('invalid fixed test configuration', async () => createMembershipReversalStripe({
      ...f.options, ...change }), 'reversal_configuration');
  }
  for (const objectId of ['https://other.test', 're_x?expand=x', 're_x/../../account', ' re_x', 're_x#y']) {
    await reject('invalid locator fails before network', () => f.resolve('refund.created', objectId), 'reversal_reference_invalid');
  }
  await reject('unsupported event cannot select arbitrary endpoint', () => f.resolve('account.updated', 'acct_x'), 'reversal_event_unsupported');
  t.check('no requests from invalid config/locators', f.calls.length === 0);
  const source = readFileSync(new URL('../api/_membershipReversalStripe.js', import.meta.url), 'utf8');
  t.check('no metadata/email/environment identity or write commands',
    !/\.metadata\b|\.email\b|process\.env|method:\s*['"]POST|redis\.call|execute\(/.test(source));
});

t.done();
