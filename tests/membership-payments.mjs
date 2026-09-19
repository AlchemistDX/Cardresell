// Synthetic canonical Stripe objects + immutable server binding fixtures.
// Actual adapter and approved ledger execute against private local Redis.
// No Stripe requests, credentials or real auth; signature/auth provider
// verification is a dependency boundary, not proven by these fixtures.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { harness } from './_assert.mjs';
import { redisCommand as redis } from './_idRedis.mjs';
import { grantMembership, MEMBERSHIP_LEDGER_SCRIPT } from '../api/_membershipLedger.js';
import { createMembershipPaymentAdapter } from '../api/_membershipPayments.js';
import { LAUNCH_PLANS, LAUNCH_PACKS, quoteLaunchPack } from '../api/_launchMembershipConfig.js';

const t = harness('membership-payments');
const UID = 'syntheticPaymentOwner', ACCOUNT = 'acct_synthetic', CUSTOMER = 'cus_synthetic';
const SESSION = 'cs_test_synthetic', PAYMENT = 'pi_synthetic', SUB = 'sub_synthetic';
const idKey = `scans:${UID}:id_paid_left`, gradeKey = `scans:${UID}:paid_left`;
const now = Number((await redis(['TIME']))[0]);
const sha = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const raw = key => redis(['GET', key]);
const number = async key => Number(await raw(key));
const reset = () => redis(['FLUSHDB']); // isolated Unix-socket database only
const snapshot = async () => JSON.stringify(await Promise.all(
  (await redis(['KEYS', '*'])).sort().map(async key => [key, await raw(key), await redis(['PTTL', key])])));
const rejects = async (label, fn, code) => {
  try { await fn(); t.check(label, false, 'unexpected success'); }
  catch (error) { t.check(label, error.code === code, `actual code: ${error.code}`); }
};
const list = data => ({ object: 'list', has_more: false, data });

function fixture({ plan = 'casual', packId = 'id_25' } = {}) {
  const prices = { packs: {}, plans: {} }, priceObjects = {};
  for (const [group, catalog] of [['packs', LAUNCH_PACKS], ['plans', LAUNCH_PLANS]]) {
    for (const [key, config] of Object.entries(catalog)) {
      if (group === 'plans' && key === 'free') continue;
      const priceId = `price_${group}_${key}`, productId = `prod_${group}_${key}`;
      prices[group][key] = { priceId, productId };
      priceObjects[priceId] = {
        id: priceId, object: 'price', livemode: false, product: productId, currency: 'usd', active: true,
        unit_amount: group === 'packs' ? config.basePriceCents : config.monthlyPriceCents,
        type: group === 'packs' ? 'one_time' : 'recurring',
        recurring: group === 'packs' ? null : { interval: 'month', interval_count: 1 },
      };
    }
  }
  const quote = quoteLaunchPack(packId, plan);
  const order = {
    version: 'launch-v2', kind: 'pack', owner: UID, accountId: ACCOUNT, livemode: false,
    sessionId: SESSION, paymentId: PAYMENT, customerId: CUSTOMER, packId, planAtCheckout: plan,
    priceId: prices.packs[packId].priceId, quantity: 1, currency: 'usd', amountCents: quote.amountCents,
  };
  const session = {
    id: SESSION, object: 'checkout.session', livemode: false, mode: 'payment',
    status: 'complete', payment_status: 'paid', customer: CUSTOMER, subscription: null,
    currency: 'usd', amount_total: quote.amountCents, amount_subtotal: quote.basePriceCents,
    total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: quote.basePriceCents - quote.amountCents },
    payment_intent: PAYMENT, metadata: { google_sub: 'untrustedOther', tier: 'business', credits: '999999' },
  };
  const packLine = {
    quantity: 1, currency: 'usd', amount_subtotal: quote.basePriceCents, amount_total: quote.amountCents,
    price: { id: prices.packs[packId].priceId },
  };
  const payment = {
    id: PAYMENT, object: 'payment_intent', livemode: false, status: 'succeeded',
    currency: 'usd', amount: quote.amountCents, amount_received: quote.amountCents, customer: CUSTOMER,
  };
  const term = {
    version: 'launch-v2', kind: 'subscription', owner: UID, accountId: ACCOUNT, livemode: false,
    subscriptionId: SUB, customerId: CUSTOMER, plan, priceId: prices.plans[plan]?.priceId,
    effectiveFrom: now - 10000, effectiveUntil: null, currency: 'usd', amountCents: LAUNCH_PLANS[plan].monthlyPriceCents,
  };
  const amount = LAUNCH_PLANS[plan].monthlyPriceCents;
  const invoice = {
    id: 'in_synthetic', object: 'invoice', livemode: false, status: 'paid', amount_paid_off_stripe: 0,
    status_transitions: { paid_at: now - 25 }, billing_reason: 'subscription_cycle',
    parent: { type: 'subscription_details', subscription_details: { subscription: SUB } },
    customer: CUSTOMER, currency: 'usd', total: amount, amount_due: amount, amount_paid: amount, amount_remaining: 0,
    amount_overpaid: 0, amount_shipping: 0, starting_balance: 0, ending_balance: 0,
    pre_payment_credit_notes_amount: 0, post_payment_credit_notes_amount: 0,
    total_taxes: [], total_discount_amounts: [],
    metadata: { google_sub: 'metadataOther', tier: 'business' },
  };
  const invoiceLine = {
    object: 'line_item', livemode: false, quantity: 1, quantity_decimal: '1',
    parent: { type: 'subscription_item_details', subscription_item_details: {
      subscription: SUB, subscription_item: 'si_synthetic', proration: false } },
    currency: 'usd', amount, pricing: { type: 'price_details', unit_amount_decimal: String(amount),
      price_details: { price: prices.plans[plan]?.priceId, product: prices.plans[plan]?.productId } },
    taxes: [], discount_amounts: [], pretax_credit_amounts: [],
    period: { start: now - 100, end: now + 1000 },
  };
  const state = {
    account: { id: ACCOUNT, object: 'account' }, session, order, payment, packLines: list([packLine]),
    invoices: { [invoice.id]: invoice }, invoiceLines: { [invoice.id]: list([invoiceLine]) }, term,
    subscription: { id: SUB, object: 'subscription', livemode: false, customer: CUSTOMER, status: 'active' },
    prices: priceObjects, event: null, signaturesValid: true, calls: [], grants: [],
    throwAfterCommit: false, adapter: null, terms: null,
  };
  const record = (name, ...args) => { state.calls.push({ name, args }); };
  const stripe = {
    retrieveAccount: async () => { record('account'); return clone(state.account); },
    retrieveCheckoutSession: async key => { record('session', key); return clone(state.session); },
    listCheckoutLineItems: async key => { record('packLines', key); return clone(state.packLines); },
    retrievePaymentIntent: async key => { record('payment', key); return clone(state.payment); },
    retrieveInvoice: async key => { record('invoice', key); return clone(state.invoices[key]); },
    listInvoiceLines: async key => { record('invoiceLines', key); return clone(state.invoiceLines[key]); },
    retrievePrice: async key => { record('price', key); return clone(state.prices[key]); },
    retrieveSubscription: async key => { record('subscription', key); return clone(state.subscription); },
    verifyWebhook: async (bytes, signature) => {
      record('signature', bytes.byteLength);
      if (!state.signaturesValid || signature !== 'synthetic-signature') throw new Error('synthetic invalid signature');
      return clone(state.event);
    },
  };
  const bindings = {
    getCheckoutOrder: async key => { record('order', key); return clone(state.order); },
    getSubscriptionTerm: async (key, start) => {
      record('term', key, start); return clone(state.terms ? state.terms(start) : state.term);
    },
  };
  const fulfill = async (kind, envelope) => {
    state.grants.push({ kind, envelope: clone(envelope) });
    const result = await grantMembership(redis, kind, envelope);
    if (state.throwAfterCommit) { state.throwAfterCommit = false; throw new Error('synthetic loss after commit'); }
    return result;
  };
  state.dependencies = { stripe, bindings, fulfill, accountId: ACCOUNT, livemode: false, priceMap: prices };
  state.adapter = createMembershipPaymentAdapter(state.dependencies);
  state.returned = (more = {}) => state.adapter.checkoutReturn({ sessionId: SESSION, authenticatedOwner: UID, ...more });
  state.webhook = async (type, objectId, extras = {}) => {
    state.event = { id: 'evt_synthetic', object: 'event', livemode: false, account: ACCOUNT, type,
      data: { object: { id: objectId, object: type.startsWith('checkout.') ? 'checkout.session' : 'invoice',
        metadata: { google_sub: 'neverTrusted', tier: 'business' } } }, ...extras };
    return state.adapter.webhook({ rawBody: Buffer.from('synthetic signed bytes'), signature: 'synthetic-signature' });
  };
  return state;
}

console.log('Approved ledger Lua SHA256:', sha(MEMBERSHIP_LEDGER_SCRIPT));
t.check('additive late-grant hold ledger hash bridge', sha(MEMBERSHIP_LEDGER_SCRIPT)
  === 'a5ee5dbb5de02dd1724e8ddefa6b11cbfe3429f4bf8cb8963e109e3029a2164a');
t.check('prior permanent-credit Lua exact after removing only hold guard',
  sha(MEMBERSHIP_LEDGER_SCRIPT.replace(/-- LATE_GRANT_HOLD:[\s\S]*?-- END_LATE_GRANT_HOLD\n/, ''))
    === '950ce766d8b45dd90d84a1009ed8f49e00511b7142ca7594646dec056bb1019a');

await t.section('all server-bound pack quotes, never metadata authority', async () => {
  for (const plan of Object.keys(LAUNCH_PLANS)) {
    for (const packId of Object.keys(LAUNCH_PACKS)) {
      await reset();
      const f = fixture({ plan, packId }), quote = quoteLaunchPack(packId, plan);
      const result = await f.returned();
      t.check(`${plan}/${packId}: verified exact quote grants correct kind`,
        result.id_delta === (quote.kind === 'id' ? quote.credits : 0)
        && result.grade_delta === (quote.kind === 'grade' ? quote.credits : 0));
      t.check(`${plan}/${packId}: only server-bound owner/version/plan/amount reaches ledger`,
        f.grants.length === 1 && f.grants[0].envelope.owner === UID
        && f.grants[0].envelope.plan === plan && f.grants[0].envelope.amountCents === quote.amountCents);
    }
  }
});

await t.section('canonical PaymentIntent shared webhook/return replay and committed loss', async () => {
  await reset();
  const f = fixture();
  const responses = await Promise.all([
    f.webhook('checkout.session.completed', SESSION), ...Array.from({ length: 10 }, () => f.returned()),
  ]);
  t.check('eleven concurrent calls return one recorded result', responses.every(r => JSON.stringify(r) === JSON.stringify(responses[0])));
  t.check('one payment journal and one pack credited', await number(idKey) === 25
    && (await redis(['KEYS', 'membership:launch-v2:payment:*'])).length === 1);
  t.check('all paths use canonical PaymentIntent, not event/session metadata',
    f.grants.every(g => g.envelope.paymentId === PAYMENT && g.envelope.owner === UID));
  await reset();
  f.throwAfterCommit = true;
  await rejects('response loss remains unavailable after commit', () => f.returned(), 'payment_unavailable');
  t.check('response lost after one committed pack', await number(idKey) === 25);
  await f.webhook('checkout.session.async_payment_succeeded', SESSION);
  t.check('later successful webhook replays, no second grant', await number(idKey) === 25);
});

await t.section('delayed checkout settlement and failure/reordered events', async () => {
  await reset();
  const f = fixture();
  f.session.payment_status = 'unpaid'; f.payment.status = 'processing';
  await rejects('completed but unpaid checkout does not grant', () => f.webhook('checkout.session.completed', SESSION), 'payment_not_settled');
  t.check('unpaid checkout never calls ledger', f.grants.length === 0 && await number(idKey) === 0);
  const ignored = await f.webhook('checkout.session.async_payment_failed', SESSION);
  t.check('failure notification cannot grant/revoke balances', ignored.ignored && f.grants.length === 0);
  f.session.payment_status = 'paid'; f.payment.status = 'succeeded';
  await f.webhook('checkout.session.async_payment_succeeded', SESSION);
  t.check('delayed canonical successful settlement grants once', await number(idKey) === 25);
  await f.webhook('checkout.session.completed', SESSION);
  await f.webhook('checkout.session.async_payment_failed', SESSION);
  t.check('late completion/failure notifications never duplicate or erase', await number(idKey) === 25);
});

await t.section('durable PaymentIntent identity required on webhook and return', async () => {
  const paths = [
    ['return', f => f.returned()],
    ['completed webhook', f => f.webhook('checkout.session.completed', SESSION)],
    ['async success webhook', f => f.webhook('checkout.session.async_payment_succeeded', SESSION)],
  ];
  for (const [path, invoke] of paths) {
    for (const expanded of [false, true]) {
      await reset(); const f = fixture();
      if (expanded) f.session.payment_intent = { id: PAYMENT, object: 'payment_intent', status: 'not-trusted' };
      await invoke(f);
      t.check(`${path}: ${expanded ? 'expanded' : 'string'} canonical ID matches durable binding`,
        f.grants.length === 1 && f.grants[0].envelope.paymentId === f.order.paymentId && await number(idKey) === 25);
      t.check(`${path}: matching reference still retrieves canonical PaymentIntent`,
        f.calls.some(c => c.name === 'payment' && c.args[0] === PAYMENT));
    }
    const invalid = [
      ['missing durable ID', f => { delete f.order.paymentId; }, 'binding_invalid'],
      ['null durable ID', f => { f.order.paymentId = null; }, 'binding_invalid'],
      ['empty durable ID', f => { f.order.paymentId = ''; }, 'binding_invalid'],
      ['whitespace durable ID', f => { f.order.paymentId = ' pi_synthetic'; }, 'binding_invalid'],
      ['trailing newline durable ID', f => { f.order.paymentId = PAYMENT + '\n'; }, 'binding_invalid'],
      ['oversized durable ID', f => { f.order.paymentId = 'pi_' + 'x'.repeat(181); }, 'binding_invalid'],
      ['wrong prefix durable ID', f => { f.order.paymentId = 'cs_synthetic'; }, 'binding_invalid'],
      ['bare prefix durable ID', f => { f.order.paymentId = 'pi_'; }, 'binding_invalid'],
      ['object durable ID forbidden', f => { f.order.paymentId = { id: PAYMENT }; }, 'binding_invalid'],
      ['numeric durable ID forbidden', f => { f.order.paymentId = 123; }, 'binding_invalid'],
      ['different durable ID', f => { f.order.paymentId = 'pi_other'; }, 'payment_binding_mismatch'],
      ['different canonical string', f => { f.session.payment_intent = 'pi_other'; f.payment.id = 'pi_other'; }, 'payment_binding_mismatch'],
      ['different canonical expanded ID', f => { f.session.payment_intent = { id: 'pi_other' }; f.payment.id = 'pi_other'; }, 'payment_binding_mismatch'],
      ['malformed canonical expanded ID', f => { f.session.payment_intent = { id: '' }; }, 'invalid_reference'],
      ['malformed canonical string', f => { f.session.payment_intent = 'pi_bad/value'; }, 'invalid_reference'],
      ['matching noncanonical newline IDs', f => {
        f.order.paymentId = f.session.payment_intent = f.payment.id = PAYMENT + '\n';
      }, 'invalid_reference'],
    ];
    for (const [label, mutate, code] of invalid) {
      await reset(); await redis(['MSET', idKey, 41, gradeKey, 3]);
      const f = fixture(); mutate(f); const before = await snapshot();
      await rejects(`${path}: ${label}`, () => invoke(f), code);
      t.check(`${path}: ${label} no ledger calls or changed bytes`, f.grants.length === 0 && await snapshot() === before);
      t.check(`${path}: ${label} rejected before PaymentIntent retrieval`, !f.calls.some(c => c.name === 'payment'));
    }
  }
});

await t.section('invalid pack/account/binding/payment envelopes yield no ledger writes', async () => {
  const cases = [
    ['wrong account client', f => { f.account.id = 'acct_other'; }, 'stripe_object_mismatch'],
    ['wrong session test/live mode', f => { f.session.livemode = true; }, 'mode_mismatch'],
    ['wrong Stripe object ID', f => { f.session.id = 'cs_wrong'; }, 'stripe_object_mismatch'],
    ['metadata without server order', f => { f.order = null; }, 'binding_missing'],
    ['stale server order version', f => { f.order.version = 'legacy'; }, 'binding_invalid'],
    ['wrong account order', f => { f.order.accountId = 'acct_other'; }, 'binding_invalid'],
    ['wrong mode order', f => { f.order.livemode = true; }, 'binding_invalid'],
    ['order points to other session', f => { f.order.sessionId = 'cs_wrong'; }, 'order_mismatch'],
    ['subscription checkout not pack', f => { f.session.mode = 'subscription'; }, 'payment_not_settled'],
    ['uncompleted checkout', f => { f.session.status = 'open'; }, 'payment_not_settled'],
    ['wrong customer session', f => { f.session.customer = 'cus_other'; }, 'customer_mismatch'],
    ['wrong pack binding', f => { f.order.packId = 'id_100'; }, 'binding_invalid'],
    ['unknown pack binding', f => { f.order.packId = '__proto__'; }, 'binding_invalid'],
    ['tampered quoted plan', f => { f.order.planAtCheckout = 'business'; }, 'binding_invalid'],
    ['tampered quoted amount', f => { f.order.amountCents = 1; }, 'binding_invalid'],
    ['session wrong currency', f => { f.session.currency = 'eur'; }, 'amount_mismatch'],
    ['session underpaid', f => { f.session.amount_total--; }, 'amount_mismatch'],
    ['session extra tax', f => { f.session.total_details.amount_tax = 1; }, 'amount_mismatch'],
    ['session wrong discount', f => { f.session.total_details.amount_discount++; }, 'amount_mismatch'],
    ['multiple lines', f => { f.packLines.data.push(clone(f.packLines.data[0])); }, 'unsupported_lines'],
    ['truncated lines', f => { f.packLines.has_more = true; }, 'unsupported_lines'],
    ['quantity two', f => { f.packLines.data[0].quantity = 2; }, 'line_mismatch'],
    ['wrong line price', f => { f.packLines.data[0].price.id = 'price_other'; }, 'price_mismatch'],
    ['wrong price product', f => { f.prices[f.order.priceId].product = 'prod_other'; }, 'price_mismatch'],
    ['wrong price test/live mode', f => { f.prices[f.order.priceId].livemode = true; }, 'mode_mismatch'],
    ['wrong price currency', f => { f.prices[f.order.priceId].currency = 'eur'; }, 'price_mismatch'],
    ['wrong base price', f => { f.prices[f.order.priceId].unit_amount++; }, 'price_mismatch'],
    ['recurring pack price', f => { f.prices[f.order.priceId].type = 'recurring'; }, 'price_mismatch'],
    ['missing PaymentIntent', f => { f.session.payment_intent = null; }, 'invalid_reference'],
    ['wrong PaymentIntent object', f => { f.payment.id = 'pi_other'; }, 'stripe_object_mismatch'],
    ['unsettled PaymentIntent', f => { f.payment.status = 'processing'; }, 'payment_mismatch'],
    ['partial amount received', f => { f.payment.amount_received--; }, 'payment_mismatch'],
    ['wrong payment customer', f => { f.payment.customer = 'cus_other'; }, 'payment_mismatch'],
  ];
  for (const [label, mutate, code] of cases) {
    await reset(); await redis(['MSET', idKey, 41, gradeKey, 3]);
    const f = fixture(); mutate(f); const before = await snapshot();
    await rejects(label, () => f.returned(), code);
    t.check(`${label}: zero ledger calls and unchanged bytes`, f.grants.length === 0 && await snapshot() === before);
  }
  await reset(); const f = fixture();
  await rejects('normal-auth owner mismatch fails', () => f.returned({ authenticatedOwner: 'anotherOwner' }), 'owner_mismatch');
  await rejects('return without authenticated owner fails', () => f.returned({ authenticatedOwner: undefined }), 'authentication_required');
  t.check('invalid auth never calls ledger', f.grants.length === 0);
});

await t.section('signature, event-account and canonical retrieval boundaries', async () => {
  await reset(); const f = fixture();
  f.signaturesValid = false;
  await rejects('invalid signature rejects before retrieval', () => f.webhook('checkout.session.completed', SESSION), 'invalid_signature');
  t.check('signature denial makes no Stripe object retrieval or ledger call', f.calls.every(c => c.name === 'signature') && f.grants.length === 0);
  f.signaturesValid = true;
  await rejects('wrong webhook account rejects', () => f.webhook('checkout.session.completed', SESSION, { account: 'acct_other' }), 'account_mismatch');
  await rejects('wrong webhook livemode rejects', () => f.webhook('checkout.session.completed', SESSION, { livemode: true }), 'mode_mismatch');
  await rejects('unsigned parsed JSON is not raw signed bytes', () => f.adapter.webhook({ rawBody: {}, signature: 'synthetic-signature' }), 'invalid_signature');
  await rejects('wrong event object type rejects', () => f.webhook('checkout.session.completed', SESSION, { object: 'invoice' }), 'invalid_event');
  t.check('event failures leave ledger untouched', f.grants.length === 0 && await number(idKey) === 0);
  // Signed event snapshot says paid; canonical retrieval says unpaid. Only
  // retrieved state counts, never the embedded snapshot or metadata.
  f.session.payment_status = 'unpaid';
  await rejects('canonical current unpaid state overrides stale event snapshot', () =>
    f.webhook('checkout.session.completed', SESSION), 'payment_not_settled');
  const ignored = await f.webhook('customer.subscription.updated', SUB);
  t.check('subscription metadata event cannot itself grant period credits', ignored.ignored && f.grants.length === 0);
});

await t.section('paid invoice grants all plans and distinct invoice duplicate period', async () => {
  for (const plan of Object.keys(LAUNCH_PLANS).filter(p => p !== 'free')) {
    await reset(); const f = fixture({ plan });
    await f.webhook('invoice.payment_succeeded', 'in_synthetic');
    t.check(`${plan}: paid mapped monthly invoice grants configured allowance`, f.grants[0].envelope.plan === plan
      && f.grants[0].envelope.owner === UID
      && (await redis(['KEYS', 'membership:launch-v2:period:*'])).length === 1);
    const record = JSON.parse(await raw((await redis(['KEYS', 'membership:launch-v2:period:*']))[0]));
    t.check(`${plan}: configured ID/grade period allocation and no purchased change`,
      record.id_grant === LAUNCH_PLANS[plan].idCredits && record.grade_grant === LAUNCH_PLANS[plan].gradeCredits
      && await number(idKey) === 0 && await number(gradeKey) === 0);
  }
  await reset(); const f = fixture();
  const first = await f.webhook('invoice.payment_succeeded', 'in_synthetic');
  const replay = await f.webhook('invoice.paid', 'in_synthetic');
  t.check('two paid event types for same invoice replay exact result', JSON.stringify(first) === JSON.stringify(replay));
  f.invoices.in_second = { ...clone(f.invoices.in_synthetic), id: 'in_second' };
  f.invoiceLines.in_second = clone(f.invoiceLines.in_synthetic);
  const second = await f.webhook('invoice.paid', 'in_second');
  t.check('different invoice for same period does not allocate again', !second.granted
    && (await redis(['KEYS', 'membership:launch-v2:period:*'])).length === 1);
});

await t.section('failed renewal recovery, concurrent invoice delivery and response loss', async () => {
  await reset(); const f = fixture();
  f.invoices.in_synthetic.status = 'open';
  await f.webhook('invoice.payment_failed', 'in_synthetic');
  await rejects('stale paid event with canonical unpaid invoice cannot grant', () =>
    f.webhook('invoice.paid', 'in_synthetic'), 'payment_not_settled');
  t.check('failed renewal has no grant journal or allocation', f.grants.length === 0
    && (await redis(['KEYS', 'membership:launch-v2:*'])).length === 0);
  f.invoices.in_synthetic.status = 'paid';
  const responses = await Promise.all(Array.from({ length: 12 }, () =>
    f.webhook('invoice.payment_succeeded', 'in_synthetic')));
  t.check('twelve recovery deliveries return one exact historical result',
    responses.every(r => JSON.stringify(r) === JSON.stringify(responses[0])));
  t.check('recovered renewal creates one invoice journal and one allowance',
    (await redis(['KEYS', 'membership:launch-v2:invoice:*'])).length === 1
    && (await redis(['KEYS', 'membership:launch-v2:period:*'])).length === 1);
  await reset(); f.throwAfterCommit = true;
  await rejects('invoice response loss remains ambiguous', () =>
    f.webhook('invoice.paid', 'in_synthetic'), 'payment_unavailable');
  const afterCommit = await snapshot();
  await f.webhook('invoice.payment_succeeded', 'in_synthetic');
  t.check('invoice retry after committed response loss preserves exact records', await snapshot() === afterCommit);
});

await t.section('invoice failures and unpaid/annual/prorated/mismatched objects never write', async () => {
  const cases = [
    ['invoice unpaid', f => { f.invoices.in_synthetic.status = 'uncollectible'; }, 'payment_not_settled'],
    ['invoice open', f => { f.invoices.in_synthetic.status = 'open'; }, 'payment_not_settled'],
    ['out-of-band invoice', f => { f.invoices.in_synthetic.amount_paid_off_stripe = 999; }, 'payment_not_settled'],
    ['remaining amount', f => { f.invoices.in_synthetic.amount_remaining = 1; }, 'payment_not_settled'],
    ['no paid timestamp', f => { f.invoices.in_synthetic.status_transitions = {}; }, 'payment_not_settled'],
    ['update invoice not renewal', f => { f.invoices.in_synthetic.billing_reason = 'subscription_update'; }, 'unsupported_invoice'],
    ['wrong canonical invoice account mode', f => { f.invoices.in_synthetic.livemode = true; }, 'mode_mismatch'],
    ['missing invoice parent', f => { delete f.invoices.in_synthetic.parent; }, 'invoice_schema_mismatch'],
    ['invoice line prorated', f => { f.invoiceLines.in_synthetic.data[0].parent.subscription_item_details.proration = true; }, 'line_mismatch'],
    ['invoice line quantity two', f => { f.invoiceLines.in_synthetic.data[0].quantity = 2; }, 'line_mismatch'],
    ['invoice line foreign subscription', f => { f.invoiceLines.in_synthetic.data[0].parent.subscription_item_details.subscription = 'sub_other'; }, 'line_mismatch'],
    ['missing term despite metadata', f => { f.term = null; }, 'binding_missing'],
    ['legacy term version', f => { f.term.version = 'legacy'; }, 'binding_invalid'],
    ['wrong term owner customer binding', f => { f.term.customerId = 'cus_other'; }, 'customer_mismatch'],
    ['wrong term account', f => { f.term.accountId = 'acct_other'; }, 'binding_invalid'],
    ['wrong term plan', f => { f.term.plan = 'pro'; }, 'binding_invalid'],
    ['term not yet effective', f => { f.term.effectiveFrom = now + 100; }, 'outside_authorized_term'],
    ['term ends inside invoice period', f => { f.term.effectiveUntil = now + 10; }, 'outside_authorized_term'],
    ['partial invoice payment', f => { f.invoices.in_synthetic.amount_paid--; }, 'amount_mismatch'],
    ['wrong invoice currency', f => { f.invoices.in_synthetic.currency = 'eur'; }, 'amount_mismatch'],
    ['zero dollar invoice', f => { f.invoices.in_synthetic.amount_paid = 0; }, 'amount_mismatch'],
    ['wrong canonical subscription customer', f => { f.subscription.customer = 'cus_other'; }, 'customer_mismatch'],
    ['unmapped invoice price', f => { f.invoiceLines.in_synthetic.data[0].pricing.price_details.price = 'price_unknown'; }, 'price_mismatch'],
    ['annual recurring price', f => { f.prices[f.term.priceId].recurring.interval = 'year'; }, 'interval_mismatch'],
    ['two-month interval', f => { f.prices[f.term.priceId].recurring.interval_count = 2; }, 'interval_mismatch'],
    ['wrong recurring price amount', f => { f.prices[f.term.priceId].unit_amount++; }, 'price_mismatch'],
  ];
  for (const [label, mutate, code] of cases) {
    await reset(); await redis(['MSET', idKey, 9, gradeKey, 6]);
    const f = fixture(); mutate(f); const before = await snapshot();
    await rejects(label, () => f.webhook('invoice.paid', 'in_synthetic'), code);
    t.check(`${label}: zero ledger calls and no storage mutation`, f.grants.length === 0 && await snapshot() === before);
  }
});

await t.section('Dahlia strict settlement, schema and decimal quantity regression', async () => {
  const cases = [];
  for (const value of [undefined, null, '0', false, -1, 0.5, 1, NaN, Infinity]) {
    cases.push([`off-Stripe amount ${String(value)}`, f => {
      if (value === undefined) delete f.invoices.in_synthetic.amount_paid_off_stripe;
      else f.invoices.in_synthetic.amount_paid_off_stripe = value;
    }, 'payment_not_settled']);
  }
  for (const field of ['paid', 'paid_out_of_band', 'subscription', 'subscription_details',
    'subscription_proration_date', 'quote', 'payment_intent', 'charge']) {
    cases.push([`mixed invoice field ${field}`, f => { f.invoices.in_synthetic[field] = null; }, 'invoice_schema_mismatch']);
  }
  for (const field of ['type', 'price', 'plan', 'subscription', 'subscription_item', 'invoice_item',
    'proration', 'proration_details']) {
    cases.push([`mixed line field ${field}`, f => { f.invoiceLines.in_synthetic.data[0][field] = null; }, 'line_schema_mismatch']);
  }
  for (const value of [undefined, null, 1, '', '1.5', '1e0', '01', '+1', ' 1', '1\n', '1.',
    '1.0000000000001', '1.0000000000000', '0.999999999999']) {
    cases.push([`decimal quantity ${JSON.stringify(value)}`, f => {
      if (value === undefined) delete f.invoiceLines.in_synthetic.data[0].quantity_decimal;
      else f.invoiceLines.in_synthetic.data[0].quantity_decimal = value;
    }, 'line_mismatch']);
  }
  for (const value of [undefined, null, '1', 0, 1.5, 2]) {
    cases.push([`conflicting integer quantity ${String(value)}`, f => {
      f.invoiceLines.in_synthetic.data[0].quantity = value;
    }, 'line_mismatch']);
  }
  for (const field of ['amount_overpaid', 'amount_shipping', 'starting_balance', 'ending_balance',
    'pre_payment_credit_notes_amount', 'post_payment_credit_notes_amount']) {
    for (const value of [1, undefined, null, '0']) {
      cases.push([`settlement ${field} ${String(value)}`, f => {
        f.invoices.in_synthetic[field] = value;
      }, 'unsupported_settlement']);
    }
  }
  for (const [target, fields] of [['invoice', ['total_taxes', 'total_discount_amounts']],
    ['line', ['taxes', 'discount_amounts', 'pretax_credit_amounts']]]) {
    for (const field of fields) for (const value of [undefined, {}, [{ amount: 0 }], [{ amount: 100 }]]) {
      cases.push([`adjustment ${target}.${field} ${JSON.stringify(value)}`, f => {
        const o = target === 'invoice' ? f.invoices.in_synthetic : f.invoiceLines.in_synthetic.data[0];
        if (value === undefined) delete o[field]; else o[field] = value;
      }, 'unsupported_settlement']);
    }
  }
  cases.push(
    ['legacy-only invoice', f => { delete f.invoices.in_synthetic.parent; f.invoices.in_synthetic.subscription = SUB; }, 'invoice_schema_mismatch'],
    ['wrong invoice discriminator', f => { f.invoices.in_synthetic.parent.type = 'quote_details'; }, 'invoice_schema_mismatch'],
    ['conflicting invoice parent', f => { f.invoices.in_synthetic.parent.quote_details = { quote: 'qt_other' }; }, 'invoice_schema_mismatch'],
    ['missing subscription reference', f => { delete f.invoices.in_synthetic.parent.subscription_details.subscription; }, 'invalid_reference'],
    ['legacy-only line', f => { const l = f.invoiceLines.in_synthetic.data[0]; delete l.parent; l.type = 'subscription'; }, 'line_schema_mismatch'],
    ['foreign line mode', f => { f.invoiceLines.in_synthetic.data[0].livemode = true; }, 'line_schema_mismatch'],
    ['wrong line object', f => { f.invoiceLines.in_synthetic.data[0].object = 'invoiceitem'; }, 'line_schema_mismatch'],
    ['wrong line parent discriminator', f => { f.invoiceLines.in_synthetic.data[0].parent.type = 'invoice_item_details'; }, 'line_schema_mismatch'],
    ['conflicting line parent', f => { f.invoiceLines.in_synthetic.data[0].parent.invoice_item_details = {}; }, 'line_schema_mismatch'],
    ['missing subscription item', f => { delete f.invoiceLines.in_synthetic.data[0].parent.subscription_item_details.subscription_item; }, 'line_mismatch'],
    ['null line subscription', f => { f.invoiceLines.in_synthetic.data[0].parent.subscription_item_details.subscription = null; }, 'line_mismatch'],
    ['missing pricing', f => { delete f.invoiceLines.in_synthetic.data[0].pricing; }, 'line_schema_mismatch'],
    ['unknown pricing variant', f => { f.invoiceLines.in_synthetic.data[0].pricing.type = 'other'; }, 'line_schema_mismatch'],
    ['null price details', f => { f.invoiceLines.in_synthetic.data[0].pricing.price_details = null; }, 'line_schema_mismatch'],
    ['wrong direct product', f => { f.invoiceLines.in_synthetic.data[0].pricing.price_details.product = 'prod_other'; }, 'price_mismatch'],
    ['malformed decimal unit amount', f => { f.invoiceLines.in_synthetic.data[0].pricing.unit_amount_decimal = '9.99e2'; }, 'price_mismatch'],
    ['incomplete invoice lines', f => { f.invoiceLines.in_synthetic.has_more = true; }, 'unsupported_lines'],
    ['multiple invoice lines', f => { f.invoiceLines.in_synthetic.data.push(clone(f.invoiceLines.in_synthetic.data[0])); }, 'unsupported_lines'],
  );
  for (const [label, mutate, code] of cases) {
    await reset(); await redis(['MSET', idKey, 9, gradeKey, 6]);
    const f = fixture(); mutate(f); const before = await snapshot();
    await rejects(label, () => f.webhook('invoice.paid', 'in_synthetic'), code);
    t.check(`${label}: no ledger calls, all Redis bytes unchanged`, f.grants.length === 0 && await snapshot() === before);
  }
  for (const decimal of ['1', '1.0', '1.000000000000']) {
    await reset(); const f = fixture(), l = f.invoiceLines.in_synthetic.data[0];
    l.quantity_decimal = decimal; l.pricing.unit_amount_decimal = '999.000000000000';
    l.pricing.price_details.price = { id: f.term.priceId, object: 'price' };
    f.invoices.in_synthetic.parent.subscription_details.subscription = { id: SUB, object: 'subscription' };
    for (const key of ['total_taxes', 'total_discount_amounts']) f.invoices.in_synthetic[key] = null;
    for (const key of ['taxes', 'discount_amounts', 'pretax_credit_amounts']) l[key] = null;
    const result = await f.webhook('invoice.paid', 'in_synthetic');
    t.check(`Exact decimal ${decimal}, documented expanded references and nullable adjustments accepted`, result.granted);
  }
});

await t.section('late/reordered paid invoices and next-renewal migration fence', async () => {
  await reset(); const f = fixture();
  await f.webhook('invoice.paid', 'in_synthetic');
  const activeKey = (await redis(['KEYS', 'membership:launch-v2:active:*']))[0], active = await raw(activeKey);
  f.invoices.in_old = { ...clone(f.invoices.in_synthetic), id: 'in_old' };
  f.invoiceLines.in_old = clone(f.invoiceLines.in_synthetic);
  f.invoiceLines.in_old.data[0].period = { start: now - 1000, end: now - 100 };
  f.subscription.status = 'canceled';
  const old = await f.webhook('invoice.paid', 'in_old');
  t.check('paid historical invoice remains valid after current cancellation', old.granted && !old.active);
  t.check('older invoice cannot replace newer active period', await raw(activeKey) === active);
  await f.webhook('invoice.payment_failed', 'in_synthetic');
  t.check('late failure event cannot erase already granted paid period', await raw(activeKey) === active);

  await reset(); const migration = fixture({ plan: 'casual' });
  // Explicit owner-authorized date, not a guess about the exact live renewal
  // timestamp. The activation integration must bind the actual Stripe epoch.
  const oct7 = Date.parse('2026-10-07T00:00:00Z') / 1000;
  migration.term.effectiveFrom = oct7;
  const before = await snapshot();
  await rejects('Casual scheduled term cannot grant before October 7', () =>
    migration.webhook('invoice.paid', 'in_synthetic'), 'outside_authorized_term');
  t.check('migration fence leaves purchased/history untouched and makes no grant call',
    migration.grants.length === 0 && await snapshot() === before);
  // Generic effective-boundary test in synthetic current time; not a claimed
  // live October 7 execution or customer migration.
  migration.term.effectiveFrom = now - 100;
  const current = await migration.webhook('invoice.paid', 'in_synthetic');
  t.check('term becomes eligible exactly at its server-authorized boundary', current.active && current.id_delta === 50);
});

await t.section('dependency failure, price-map guard and dormant scope', async () => {
  await reset(); const f = fixture();
  f.dependencies.stripe.retrievePaymentIntent = async () => { throw new Error('synthetic transport failure'); };
  await rejects('retrieval failure cannot call ledger', () => f.returned(), 'payment_unavailable');
  t.check('failed lookup no ledger mutation', f.grants.length === 0 && await number(idKey) === 0);
  const bad = fixture();
  bad.dependencies.priceMap.plans.casual.priceId = bad.dependencies.priceMap.packs.id_25.priceId;
  await rejects('ambiguous configured price mapping rejected', async () => createMembershipPaymentAdapter(bad.dependencies), 'price_map_invalid');
  const incomplete = fixture(); delete incomplete.dependencies.priceMap.packs.id_25;
  await rejects('incomplete catalog price mapping rejected', async () => createMembershipPaymentAdapter(incomplete.dependencies), 'price_map_invalid');
  const source = readFileSync(new URL('../api/_membershipPayments.js', import.meta.url), 'utf8');
  t.check('adapter has no fetch, environment reads or Stripe mutations',
    !/\bfetch\s*\(|process\.env|subscriptions\.update|checkout\.sessions\.create/.test(source));
  t.check('adapter never reads metadata as authority', !/\.metadata\b/.test(source));
  t.check('additive hold ledger file explicitly hash-pinned', sha(readFileSync(new URL('../api/_membershipLedger.js', import.meta.url)))
    === 'e068c0013c06cfeb2084295f50c03a94f768ba2d93705dc6fe3d9df8dbc528cb');
});

await t.section('authenticated canonical invoice recovery shares signed-webhook verifier', async () => {
  await reset();
  const f = fixture();
  const recovery = (more = {}) => f.adapter.invoiceRecovery({
    invoiceId: 'in_synthetic', authenticatedOwner: UID, ...more,
  });
  const before = await snapshot();
  await rejects('invoice recovery rejects absent auth', () => recovery({ authenticatedOwner: undefined }), 'authentication_required');
  await rejects('invoice recovery checks trusted term owner', () => recovery({ authenticatedOwner: 'otherOwner' }), 'owner_mismatch');
  t.check('auth rejection cannot invoke ledger or change bytes', f.grants.length === 0 && before === await snapshot());
  const first = await recovery(), committed = await snapshot();
  t.check('recovery issues canonical invoice once', first.id_delta === 50 && first.grade_delta === 15);
  const signed = await f.webhook('invoice.paid', 'in_synthetic');
  t.check('webhook/recovery canonical business-ID replay equal', JSON.stringify(first) === JSON.stringify(signed)
    && committed === await snapshot());
  t.check('recovery does not fabricate or verify a signature', f.calls.filter(x => x.name === 'signature').length === 1);
  await reset();
  const bad = fixture(); bad.invoices.in_synthetic.status = 'open';
  await rejects('recovery uses same unpaid rejection', () => bad.adapter.invoiceRecovery({
    invoiceId: 'in_synthetic', authenticatedOwner: UID }), 'payment_not_settled');
  t.check('unpaid recovery zero ledger calls', bad.grants.length === 0);
  const lost = fixture(); lost.throwAfterCommit = true;
  await rejects('recovery after commit loss returns unavailable', () => lost.adapter.invoiceRecovery({
    invoiceId: 'in_synthetic', authenticatedOwner: UID }), 'payment_unavailable');
  const saved = await snapshot();
  await lost.adapter.invoiceRecovery({ invoiceId: 'in_synthetic', authenticatedOwner: UID });
  t.check('recovery retry after loss preserves original financial bytes', saved === await snapshot());
});

t.done();
