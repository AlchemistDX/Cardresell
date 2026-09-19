// Synthetic canonical objects; actual private Redis, approved binding/payment/
// permanent-credit ledger and real raw-byte HMAC verifier. No external network.
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { harness } from './_assert.mjs';
import { redisCommand as redis } from './_idRedis.mjs';
import { createMembershipLifecycle, MEMBERSHIP_LIFECYCLE_CAS } from '../api/_membershipLifecycle.js';
import { createMembershipBindingStore } from '../api/_membershipBindings.js';
import { createMembershipPaymentAdapter } from '../api/_membershipPayments.js';
import { createMembershipStripeTransport, MEMBERSHIP_STRIPE_API_VERSION } from '../api/_membershipStripe.js';
import { grantMembership, membershipGrantHoldKey } from '../api/_membershipLedger.js';
import { LAUNCH_PLANS, LAUNCH_PACKS } from '../api/_launchMembershipConfig.js';

const t = harness('membership-lifecycle');
const sha = x => createHash('sha256').update(x).digest('hex');
const clone = x => structuredClone(x);
const UID = 'syntheticLifecycleOwner', CUSTOMER = 'cus_lifecycle', SUB = 'sub_lifecycle', ACCOUNT = 'acct_lifecycle';
const NOW = Number((await redis(['TIME']))[0]);
const SECRET = 'whsec_syntheticlocalnotacredential';
const list = data => ({ object: 'list', has_more: false, data });
const snapshot = async () => JSON.stringify(await Promise.all((await redis(['KEYS', '*'])).sort()
  .map(async k => [k, await redis(['GET', k]), await redis(['PTTL', k])])));
const reject = async (label, fn, code) => {
  try { await fn(); t.check(label, false, 'unexpected success'); }
  catch (e) { t.check(label, code === undefined || e.code === code, `actual ${e.code}: ${e.message}`); }
};
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function fixture({ bind = true, execute = redis } = {}) {
  await redis(['FLUSHDB']); // only this process's private socket database
  const priceMap = { plans: {}, packs: {} }, priceObjects = {};
  for (const [group, values] of [['plans', LAUNCH_PLANS], ['packs', LAUNCH_PACKS]]) {
    for (const [name, config] of Object.entries(values)) {
      if (name === 'free') continue;
      const priceId = `price_${group}_${name}`, productId = `prod_${group}_${name}`;
      priceMap[group][name] = { priceId, productId };
      priceObjects[priceId] = { id: priceId, object: 'price', livemode: false, product: productId, currency: 'usd',
        unit_amount: group === 'plans' ? config.monthlyPriceCents : config.basePriceCents,
        type: group === 'plans' ? 'recurring' : 'one_time',
        recurring: group === 'plans' ? { interval: 'month', interval_count: 1 } : null };
    }
  }
  const f = { networkCalls: 0, retrievals: 0, now: NOW, customers: new Map([[UID,
    { owner: UID, customerId: CUSTOMER, state: 'bound', accountId: ACCOUNT, livemode: false }]]),
  state: { subscriptionId: SUB, customerId: CUSTOMER, accountId: ACCOUNT, livemode: false,
    status: 'active', plan: 'casual', periodStart: NOW - 100, periodEnd: NOW + 1000,
    cancelAtPeriodEnd: false, scheduledChange: null }, invoices: {}, lines: {}, loseGrant: false };
  const verifier = createMembershipStripeTransport({ accountId: ACCOUNT, livemode: false,
    apiKey: 'sk_test_syntheticlocalnotacredential', webhookSecret: SECRET,
    apiVersion: MEMBERSHIP_STRIPE_API_VERSION, nowSeconds: () => NOW,
    fetchImpl: async () => { f.networkCalls++; throw new Error('network forbidden'); } });
  f.stripe = {
    verifyWebhook: verifier.verifyWebhook,
    retrieveAccount: async () => ({ object: 'account', id: ACCOUNT }),
    retrieveCheckoutSession: async () => clone(f.session),
    listCheckoutLineItems: async () => { throw new Error('not used'); },
    retrievePaymentIntent: async () => { throw new Error('not used'); },
    retrieveInvoice: async id => clone(f.invoices[id]),
    listInvoiceLines: async id => clone(f.lines[id]),
    retrievePrice: async id => clone(priceObjects[id]),
    retrieveSubscription: async id => ({ object: 'subscription', id, customer: CUSTOMER,
      livemode: false, status: f.state.status }),
    retrieveSubscriptionSnapshot: async () => { f.retrievals++; return clone(f.state); },
  };
  f.bindings = createMembershipBindingStore({ execute: redis, accountId: ACCOUNT, livemode: false, priceMap });
  const intent = { intentId: sha('lifecycle-origin'), kind: 'subscription', owner: UID,
    customerId: CUSTOMER, plan: 'casual', packId: null };
  await f.bindings.createIntent(intent);
  await f.bindings.bindSession({ intentId: intent.intentId, sessionId: 'cs_lifecycle' });
  await f.bindings.bindSettlement({ intentId: intent.intentId, sessionId: 'cs_lifecycle', subscriptionId: SUB });
  f.order = await f.bindings.getIntent(intent.intentId);
  f.session = { object: 'checkout.session', id: 'cs_lifecycle', livemode: false,
    mode: 'subscription', customer: CUSTOMER, subscription: SUB,
    client_reference_id: f.order.intentId, status: 'complete', payment_status: 'paid', invoice: null };
  const payments = createMembershipPaymentAdapter({ stripe: f.stripe, bindings: f.bindings,
    accountId: ACCOUNT, livemode: false, priceMap,
    fulfill: async (kind, envelope) => {
      const result = await grantMembership(redis, kind, envelope);
      if (f.loseGrant) { f.loseGrant = false; throw new Error('synthetic response lost after financial commit'); }
      return result;
    } });
  f.options = { execute, stripe: f.stripe, bindings: f.bindings, payments, accountId: ACCOUNT, livemode: false,
    priceMap, customers: { get: async owner => clone(f.customers.get(owner)) }, now: () => f.now };
  f.core = createMembershipLifecycle(f.options);
  f.checkout = () => f.core.checkout({ order: f.order, subscriptionId: SUB, sessionId: 'cs_lifecycle' });
  if (bind) await f.checkout();
  f.get = () => f.core.get({ owner: UID, subscriptionId: SUB });
  f.refresh = name => f.core.refresh({ owner: UID, subscriptionId: SUB, operationId: sha(name) });
  f.change = (name, plan) => f.core.requestChange({ owner: UID, subscriptionId: SUB, operationId: sha(name), plan });
  f.cancel = name => f.core.requestCancel({ owner: UID, subscriptionId: SUB, operationId: sha(name) });
  f.event = (type, data, eventId = 'evt_' + sha(type + JSON.stringify(data)).slice(0, 20), overrides = {}) => {
    const event = { object: 'event', id: eventId, type, data: { object: data },
      livemode: false, account: ACCOUNT, api_version: MEMBERSHIP_STRIPE_API_VERSION, created: NOW, ...overrides };
    const rawBody = Buffer.from(JSON.stringify(event));
    return { rawBody, signature: `t=${NOW},v1=${createHmac('sha256', SECRET).update(NOW + '.').update(rawBody).digest('hex')}` };
  };
  f.invoice = (invoiceId = 'in_lifecycle', { plan = 'casual', start = NOW - 100, end = NOW + 1000 } = {}) => {
    const amount = LAUNCH_PLANS[plan].monthlyPriceCents;
    f.invoices[invoiceId] = { id: invoiceId, object: 'invoice', livemode: false, status: 'paid',
      amount_paid_off_stripe: 0, amount_remaining: 0, status_transitions: { paid_at: NOW - 10 },
      billing_reason: 'subscription_cycle', parent: { type: 'subscription_details', subscription_details: { subscription: SUB } },
      customer: CUSTOMER, currency: 'usd', amount_paid: amount, amount_due: amount, total: amount,
      amount_overpaid: 0, amount_shipping: 0, starting_balance: 0, ending_balance: 0,
      pre_payment_credit_notes_amount: 0, post_payment_credit_notes_amount: 0,
      total_taxes: [], total_discount_amounts: [] };
    f.lines[invoiceId] = list([{ object: 'line_item', livemode: false, quantity: 1, quantity_decimal: '1',
      parent: { type: 'subscription_item_details', subscription_item_details: {
        subscription: SUB, subscription_item: 'si_lifecycle', proration: false } },
      period: { start, end }, currency: 'usd', amount,
      pricing: { type: 'price_details', price_details: {
        price: priceMap.plans[plan].priceId, product: priceMap.plans[plan].productId },
      unit_amount_decimal: String(amount) }, taxes: [], discount_amounts: [], pretax_credit_amounts: [] }]);
    return f.event('invoice.paid', { object: 'invoice', id: invoiceId });
  };
  return f;
}

await t.section('immutable association and checkout origin, no metadata identity', async () => {
  const f = await fixture({ bind: false });
  let before = await snapshot();
  await reject('wrong customer rejected', () => f.core.associate({ owner: UID, customerId: 'cus_wrong' }), 'customer_mismatch');
  t.check('wrong association writes nothing', before === await snapshot());
  const results = await Promise.all(Array.from({ length: 12 }, () => f.core.associate({ owner: UID, customerId: CUSTOMER })));
  t.check('concurrent association returns same owner', results.every(x => x.owner === UID));
  t.check('association has permanent records', (await redis(['KEYS', '*:lifecycle:*'])).length === 2);
  f.customers.set('otherOwner', { owner: 'otherOwner', customerId: CUSTOMER, state: 'bound' });
  before = await snapshot();
  await reject('same customer cannot be reassigned', () => f.core.associate({ owner: 'otherOwner', customerId: CUSTOMER }), 'association_corrupt');
  t.check('alias conflict bytes unchanged', before === await snapshot());
  await reject('altered checkout owner rejected', () => f.core.checkout({
    order: { ...f.order, owner: 'otherOwner' }, subscriptionId: SUB, sessionId: 'cs_lifecycle' }), 'origin_mismatch');
  t.check('checkout returns bound not paid', (await f.checkout()).status === 'subscription_bound');
  before = await snapshot();
  t.check('checkout replay exact status', (await f.checkout()).status === 'subscription_bound');
  await f.get();
  t.check('checkout replay and GET leave exact bytes unchanged', before === await snapshot());
  t.check('no invoice markers or credit grants', (await redis(['KEYS', 'membership:launch-v2:invoice:*'])).length === 0);
});

await t.section('canonical post-claim ordering and durable duplicate response', async () => {
  const f = await fixture(), gate = deferred(), entered = deferred();
  f.stripe.retrieveSubscriptionSnapshot = async () => { f.retrievals++; entered.resolve(); await gate.promise; return clone(f.state); };
  const first = f.refresh('first');
  await entered.promise;
  const duplicate = await f.refresh('first'), other = await f.refresh('second');
  t.check('concurrent same and distinct events return pending', duplicate.status === 'pending' && other.status === 'pending');
  t.check('only one canonical read while claim active', f.retrievals === 1);
  gate.resolve();
  const result = await first, before = await snapshot();
  t.check('successful refresh recorded', result.status === 'refreshed' && result.revision === 1);
  t.check('exact durable replay', JSON.stringify(result) === JSON.stringify(await f.refresh('first')));
  t.check('completed replay no reread/no rewrite', f.retrievals === 1 && await snapshot() === before);
  f.state.status = 'past_due';
  await f.core.webhook(f.event('customer.subscription.updated', { object: 'subscription', id: SUB }, 'evt_old', { created: NOW - 9999 }));
  t.check('old webhook triggers current canonical state not old payload', (await f.get()).snapshot.status === 'past_due');
  t.check('event timestamp never used as state revision', (await f.get()).revision === 2);
});

await t.section('unknown read outcome, explicit reconciliation and old-worker fencing', async () => {
  const f = await fixture(), gate = deferred(), entered = deferred();
  let reads = 0;
  f.stripe.retrieveSubscriptionSnapshot = async () => {
    reads++; if (reads === 1) { entered.resolve(); await gate.promise; return { ...f.state, status: 'past_due' }; }
    return clone(f.state);
  };
  const old = f.refresh('race'); await entered.promise;
  const recovery = await f.core.reconcile({ owner: UID, subscriptionId: SUB, operationId: sha('race') });
  gate.resolve();
  t.check('new canonical read commits before old worker', recovery.status === 'refreshed');
  t.check('late old worker explicitly superseded', (await old).status === 'superseded');
  t.check('late response cannot overwrite active with past_due', (await f.get()).snapshot.status === 'active');
  f.stripe.retrieveSubscriptionSnapshot = async () => { throw new Error('synthetic transport loss'); };
  await reject('retrieval loss reported unknown', () => f.refresh('unknown'), 'canonical_outcome_unknown');
  t.check('unknown remains durable pending', (await f.refresh('unknown')).status === 'pending');
  const restarted = createMembershipLifecycle(f.options);
  t.check('restart cannot implicitly re-run pending read', (await restarted.refresh({
    owner: UID, subscriptionId: SUB, operationId: sha('unknown') })).status === 'pending');
  f.stripe.retrieveSubscriptionSnapshot = async () => clone(f.state);
  t.check('explicit recovery resolves pending', (await restarted.reconcile({
    owner: UID, subscriptionId: SUB, operationId: sha('unknown') })).status === 'refreshed');
});

await t.section('next-renewal change and cancel preserve all financial bytes', async () => {
  const f = await fixture();
  await redis(['SET', `scans:${UID}:id_paid_left`, '137']);
  await f.refresh('initial');
  const command = await f.change('change', 'pro');
  t.check('command scheduled exactly next boundary', command.effectiveAt === NOW + 1000 && command.phase === 'requested');
  t.check('stable Stripe idempotency key returned', command.idempotencyKey === (await f.change('change', 'pro')).idempotencyKey);
  await reject('same operation different target rejected', () => f.change('change', 'business'), 'operation_conflict');
  await reject('unconfirmed change cannot be replaced', () => f.cancel('cancel'), 'change_pending');
  t.check('unconfirmed plan does not authorize future term', (await f.get()).transitions.length === 1);
  f.state.scheduledChange = { plan: 'pro', effectiveAt: NOW + 1000 };
  await f.refresh('confirmed');
  t.check('canonical schedule readback confirms authorized transition', (await f.get()).transitions.length === 2
    && (await f.get()).command.phase === 'confirmed');
  t.check('confirmation leaves current paid plan unchanged', (await f.get()).snapshot.plan === 'casual');
  f.state = { ...f.state, plan: 'pro', periodStart: NOW + 1000, periodEnd: NOW + 2000, scheduledChange: null };
  f.now = NOW + 1100;
  await f.refresh('new-period');
  const cancel = await f.cancel('cancel');
  t.check('cancel is end-of-paid-period intent, no immediate cancellation', cancel.effectiveAt === NOW + 2000);
  f.state.cancelAtPeriodEnd = true;
  await f.refresh('cancel-confirmed');
  t.check('cancellation readback confirmed but status stays active', (await f.get()).command.phase === 'confirmed'
    && (await f.get()).snapshot.status === 'active');
  t.check('purchased credits untouched by all lifecycle transitions', await redis(['GET', `scans:${UID}:id_paid_left`]) === '137');
  t.check('no period created from active status/schedule/cancel', (await redis(['KEYS', 'membership:launch-v2:period:*'])).length === 0);
  f.state.periodStart = NOW - 100;
  await reject('canonical period regression fails closed', () => f.refresh('stale'), 'canonical_regression');
});

await t.section('real signed invoice path validates before term then real atomic grant', async () => {
  const f = await fixture(), input = f.invoice();
  const first = await f.core.processWebhook(input);
  t.check('actual payment validator and ledger grant correct Casual credits', first.id_delta === 50 && first.grade_delta === 15);
  const term = await f.bindings.getSubscriptionTerm(SUB, NOW - 100);
  t.check('immutable term exact invoice interval and origin', term.effectiveFrom === NOW - 100
    && term.effectiveUntil === NOW + 1000 && term.originIntentId === f.order.intentId);
  const before = await snapshot();
  const replay = await f.core.processWebhook(input);
  t.check('same paid invoice replay exact result', JSON.stringify(first) === JSON.stringify(replay));
  t.check('invoice duplicate changes no bytes', before === await snapshot());
  const duplicateBusiness = f.invoice('in_duplicatePeriod');
  t.check('different invoice same paid period adds zero', (await f.core.processWebhook(duplicateBusiness)).id_delta === 0);
  t.check('one allocation retained', (await redis(['KEYS', 'membership:launch-v2:period:*'])).length === 1);
  t.check('actual signature verification required no network invoked', f.networkCalls === 0);
});

await t.section('authenticated invoice recovery and actual checkout reconciliation', async () => {
  const f = await fixture(), signed = f.invoice();
  f.session.invoice = { id: 'in_lifecycle', object: 'invoice' };
  const result = await f.checkout();
  t.check('checkout return fulfills canonical paid invoice', result.status === 'fulfilled'
    && result.grant.id_delta === 50 && result.grant.grade_delta === 15);
  const before = await snapshot();
  t.check('return retry has exact original grant', JSON.stringify((await f.checkout()).grant) === JSON.stringify(result.grant));
  t.check('signed webhook after return shares same business journal',
    JSON.stringify(await f.core.webhook(signed)) === JSON.stringify(result.grant) && await snapshot() === before);
  await reject('direct lifecycle recovery wrong owner rejected', () => f.core.invoiceRecovery({
    owner: 'anotherOwner', subscriptionId: SUB, invoiceId: 'in_lifecycle' }), 'customer_unbound');
  await reject('recovery requires verified owner', () => f.core.invoiceRecovery({
    subscriptionId: SUB, invoiceId: 'in_lifecycle' }), 'authentication_required');
  t.check('recovery authentication failures preserve bytes', before === await snapshot());
  const g = await fixture(), input = g.invoice();
  g.session.invoice = 'in_lifecycle'; g.invoices.in_lifecycle.amount_paid--;
  const unchanged = await snapshot();
  await reject('paid-looking checkout cannot override wrong canonical amount', () => g.checkout());
  t.check('rejected checkout recovery no terms or grants', await snapshot() === unchanged);
  g.invoices.in_lifecycle.amount_paid++;
  g.loseGrant = true;
  await reject('checkout response loss after actual financial commit is explicit', () => g.checkout(), 'payment_unavailable');
  const postCommit = await snapshot();
  t.check('checkout retry recovers one grant after committed loss', (await g.checkout()).grant.id_delta === 50
    && await snapshot() === postCommit);
  t.check('webhook then recovery remains idempotent', (await g.core.webhook(input)).id_delta === 50
    && await snapshot() === postCommit);
});

await t.section('legacy migration is audited Preview staging, never fabricated origin', async () => {
  const f = await fixture({ bind: false });
  const envelope = { authorizationId: sha('audited-legacy-approval'), owner: UID, customerId: CUSTOMER,
    subscriptionId: SUB, accountId: ACCOUNT, livemode: false, legacyPriceId: 'price_legacy',
    targetPlan: 'casual', effectiveAt: NOW + 10000, approvedAt: NOW - 10,
    noImmediateCharge: true, noMidperiodGrant: true };
  f.stripe.retrieveLegacySubscriptionSnapshot = async () => ({ subscriptionId: SUB, customerId: CUSTOMER,
    accountId: ACCOUNT, livemode: false, priceId: 'price_legacy', periodEnd: NOW + 10000, status: 'active' });
  const core = createMembershipLifecycle({ ...f.options,
    verifyLegacyAuthorization: async value => JSON.stringify(value) === JSON.stringify(envelope) });
  const before = await snapshot();
  await reject('no audit authority means no staging', () => f.core.stageLegacyMigration(envelope), 'legacy_preview_only');
  await reject('tampered target denied by server audit authority', () => core.stageLegacyMigration({
    ...envelope, targetPlan: 'pro' }), 'legacy_authorization_denied');
  t.check('unauthorized legacy requests do not write', before === await snapshot());
  const result = await core.stageLegacyMigration(envelope);
  t.check('approved migration explicitly not scheduled and not imported', result.disposition === 'preview_only_not_scheduled'
    && result.bindingImport === false && result.financialMutation === false);
  const saved = await snapshot();
  t.check('audited staging replay exact and immutable', JSON.stringify(result) === JSON.stringify(await core.stageLegacyMigration(envelope))
    && saved === await snapshot());
  t.check('staging never fabricates a normal lifecycle subscription', (await redis(['KEYS', '*:lifecycle:*:subscription:*'])).length === 0);
  t.check('staging grants no paid periods', (await redis(['KEYS', 'membership:launch-v2:period:*'])).length === 0);
});

await t.section('renewal ordering and lost grant response preserve permanent lots', async () => {
  const f = await fixture();
  const recent = f.invoice('in_recent', { start: NOW - 100, end: NOW + 1000 });
  f.loseGrant = true;
  await reject('response lost after real ledger commit', () => f.core.processWebhook(recent), 'payment_unavailable');
  t.check('invoice marker exists despite lost response', (await redis(['KEYS', 'membership:launch-v2:invoice:*'])).length === 1);
  await f.core.processWebhook(recent);
  const older = f.invoice('in_older', { start: NOW - 2000, end: NOW - 100 });
  await f.core.processWebhook(older);
  const periodKeys = await redis(['KEYS', 'membership:launch-v2:period:*']);
  const lots = await Promise.all(periodKeys.map(async k => JSON.parse(await redis(['GET', k]))));
  t.check('older paid period issued without deleting newer lot', lots.length === 2 && lots.every(x => x.id_grant === 50));
  t.check('older and newer credits remain permanent', (await Promise.all(periodKeys.map(k => redis(['TTL', k])))).every(x => x === -1));
  const pointer = JSON.parse(await redis(['GET', (await redis(['KEYS', 'membership:launch-v2:active:*']))[0]]));
  t.check('out-of-order older invoice cannot regress active pointer', pointer.start === NOW - 100);
  const before = await snapshot();
  await Promise.all(Array.from({ length: 8 }, () => f.core.processWebhook(recent)));
  t.check('concurrent replays leave all credit/history bytes unchanged', await snapshot() === before);
});

await t.section('invalid settlement signature and canonical data cannot create terms or grants', async () => {
  const cases = [
    ['unpaid', f => { f.invoices.in_lifecycle.status = 'open'; }],
    ['missing settlement expansion', f => { delete f.invoices.in_lifecycle.amount_paid_off_stripe; }],
    ['wrong amount', f => { f.invoices.in_lifecycle.amount_paid--; }],
    ['wrong customer', f => { f.invoices.in_lifecycle.customer = 'cus_other'; }],
    ['partial lines', f => { f.lines.in_lifecycle.has_more = true; }],
    ['wrong recurring price', f => { f.lines.in_lifecycle.data[0].pricing.price_details.price = 'price_wrong'; }],
    ['fractional quantity', f => { f.lines.in_lifecycle.data[0].quantity_decimal = '1.5'; }],
    ['tax adjustments', f => { f.invoices.in_lifecycle.total_taxes = [{ amount: 1 }]; }],
  ];
  for (const [name, mutate] of cases) {
    const f = await fixture(), input = f.invoice(); mutate(f);
    const before = await snapshot();
    await reject(name + ' rejected', () => f.core.processWebhook(input));
    t.check(name + ' no term/financial/state writes', before === await snapshot());
  }
  const f = await fixture(), input = f.invoice(), before = await snapshot();
  await reject('tampered raw signed bytes rejected', () => f.core.processWebhook({
    ...input, rawBody: Buffer.concat([input.rawBody, Buffer.from(' ')]) }), 'invalid_signature');
  await reject('decoded event is not accepted in place of signature', () => f.core.webhook(JSON.parse(input.rawBody)), 'invalid_signature');
  await reject('wrong account signed event rejected', () => f.core.processWebhook(f.event('invoice.paid',
    { object: 'invoice', id: 'in_lifecycle' }, 'evt_wrong', { account: 'acct_other' })), 'invalid_signature');
  t.check('all authentication failures no writes', before === await snapshot());
});

await t.section('confirmed schedule controls next paid price, never event metadata', async () => {
  const f = await fixture();
  f.now = NOW - 500;
  f.state.periodStart = NOW - 1000; f.state.periodEnd = NOW - 100;
  await f.refresh('prior-period');
  await f.change('authorized-next', 'pro');
  const newInvoice = f.invoice('in_changed', { plan: 'pro', start: NOW - 100, end: NOW + 1000 });
  const before = await snapshot();
  await reject('requested but unconfirmed higher plan cannot grant', () => f.core.processWebhook(newInvoice));
  t.check('unconfirmed invoice writes no term or allocation', await snapshot() === before);
  f.state.scheduledChange = { plan: 'pro', effectiveAt: NOW - 100 };
  await f.refresh('confirmed-next');
  const result = await f.core.processWebhook(newInvoice);
  t.check('confirmed Pro paid invoice issues 250/40 only at canonical period', result.id_delta === 250 && result.grade_delta === 40);
  const old = f.invoice('in_delayedCasual', { start: NOW - 1000, end: NOW - 100 });
  t.check('delayed old Casual invoice retains historical price authority', (await f.core.processWebhook(old)).id_delta === 50);
  const state = await f.get();
  t.check('historical grants do not rewrite requested transition or snapshot', state.transitions.length === 2
    && state.snapshot.plan === 'casual' && state.command.phase === 'confirmed');
  const failed = f.invoice('in_failedNext', { plan: 'pro', start: NOW + 1000, end: NOW + 2000 });
  f.invoices.in_failedNext.status = 'open'; f.invoices.in_failedNext.amount_paid = 0;
  const captured = await snapshot();
  await reject('failed next renewal never mints credits', () => f.core.processWebhook(failed));
  t.check('failed next invoice leaves every byte unchanged', await snapshot() === captured);
});

await t.section('bounded canonical timeout and concurrent first invoice', async () => {
  const f = await fixture();
  let signal;
  f.stripe.retrieveSubscriptionSnapshot = async (_, options) => {
    signal = options.signal; return new Promise(() => {});
  };
  const bounded = createMembershipLifecycle({ ...f.options, canonicalTimeoutMs: 100 });
  await reject('canonical timeout is unknown not false success', () => bounded.refresh({
    owner: UID, subscriptionId: SUB, operationId: sha('timeout') }), 'canonical_outcome_unknown');
  t.check('abort propagated to canonical transport', signal.aborted === true);
  t.check('timeout does not release durable claim', (await f.get()).claim.operationId === sha('timeout'));
  const g = await fixture(), event = g.invoice();
  const replies = await Promise.allSettled(Array.from({ length: 8 }, () => g.core.processWebhook(event)));
  t.check('concurrent first invoice returns fulfilled or explicit retry error, not duplicate lots',
    replies.some(x => x.status === 'fulfilled')
      && (await redis(['KEYS', 'membership:launch-v2:period:*'])).length === 1
      && (await redis(['KEYS', 'membership:launch-v2:invoice:*'])).length === 1);
  const keys = await redis(['KEYS', 'membership:launch-v2:period:*']);
  t.check('first-fulfillment concurrency issues exactly 50 ID', JSON.parse(await redis(['GET', keys[0]])).id_grant === 50);
  t.check('all conflicted callers can safely replay canonical business ID', (await g.core.processWebhook(event)).id_delta === 50);
});

await t.section('payment failure and reversal are not grant or erasure authority', async () => {
  const f = await fixture(), paid = f.invoice();
  await f.core.processWebhook(paid);
  await redis(['SET', `scans:${UID}:paid_left`, '81']);
  const financialKeys = [...await redis(['KEYS', 'membership:launch-v2:period:*']),
    ...await redis(['KEYS', 'membership:launch-v2:invoice:*']), `scans:${UID}:paid_left`];
  const balances = () => Promise.all(financialKeys.map(k => redis(['GET', k])));
  const before = JSON.stringify(await balances());
  f.state.status = 'past_due';
  const failed = f.event('invoice.payment_failed', { object: 'invoice', id: 'in_lifecycle' });
  await f.core.processWebhook(failed);
  t.check('failed renewal reflects canonical status without grant', (await f.get()).snapshot.status === 'past_due');
  for (const [type, object, id] of [['charge.refunded', 'charge', 'ch_review'],
    ['refund.created', 'refund', 're_review'], ['charge.dispute.created', 'dispute', 'dp_review']]) {
    const event = f.event(type, { object, id });
    const result = await f.core.processWebhook(event), saved = await snapshot();
    t.check(type + ' explicitly review required', result.disposition === 'review_required' && result.financialMutation === false);
    t.check(type + ' replay exact disposition', JSON.stringify(result) === JSON.stringify(await f.core.processWebhook(event)));
    t.check(type + ' duplicate no rewrite', await snapshot() === saved);
  }
  t.check('failed payment/refund/dispute preserve all permanent credits and invoices', before === JSON.stringify(await balances()));
});

await t.section('corruption, serialization and post-commit response loss', async () => {
  const f = await fixture(), ownerKey = (await redis(['KEYS', '*:lifecycle:*:owner:*']))[0];
  await redis(['SET', ownerKey, 'nil']);
  const before = await snapshot();
  await reject('malformed durable state fails closed', () => f.get(), 'lifecycle_corrupt');
  t.check('malformed bytes are not silently repaired', before === await snapshot());
  await reject('CAS rejects malformed output before any mutation', () => redis(['EVAL', MEMBERSHIP_LIFECYCLE_CAS, 2,
    'syntheticCAS1', 'syntheticCAS2', JSON.stringify([{ before: false, after: '{"ok":true}' }, { before: false, after: 'nil' }])]));
  t.check('first valid write not committed before second invalid output', await redis(['GET', 'syntheticCAS1']) === null);
  let lose = false;
  const g = await fixture({ execute: async args => {
    const r = await redis(args);
    if (lose && args[0] === 'EVAL') { lose = false; throw new Error('synthetic lost Redis response'); }
    return r;
  } });
  await g.refresh('ready'); lose = true;
  await reject('durable command response can be lost', () => g.change('lostCommand', 'pro'));
  const stored = (await g.get()).command;
  t.check('retry returns same durable command without second execution', (await g.change('lostCommand', 'pro')).idempotencyKey === stored.idempotencyKey);
  t.check('commands never execute Stripe writes themselves', g.networkCalls === 0);
  const source = readFileSync(new URL('../api/_membershipLifecycle.js', import.meta.url), 'utf8');
  t.check('no direct fetch/env/live configuration or enrollment changes', !/\bfetch\s*\(|process\.env|membershipEnrollmentKey/.test(source));
});

await t.section('canonical refund provenance atomically fences late original grants, never claws back', async () => {
  const f = await fixture(), paid = f.invoice();
  const refund = f.event('refund.created', { object: 'refund', id: 're_fence' });
  f.stripe.resolveReversalProvenance = async () => ({ accountId: ACCOUNT, livemode: false,
    objectType: 'refund', objectId: 're_fence', customerId: CUSTOMER, paymentId: 'pi_fence',
    invoiceId: 'in_lifecycle', invoiceLookupComplete: true, reason: 'refund_succeeded' });
  const held = await f.core.webhook(refund);
  t.check('canonical refund installs exact invoice and payment holds', held.lateGrantExclusion === 'installed'
    && await redis(['EXISTS', membershipGrantHoldKey('pack', 'pi_fence')]) === 1
    && await redis(['EXISTS', membershipGrantHoldKey('period', 'in_lifecycle')]) === 1);
  await reject('late paid invoice cannot grant through signed webhook', () => f.core.webhook(paid), 'payment_unavailable');
  await reject('late invoice recovery cannot bypass hold', () => f.core.invoiceRecovery({
    owner: UID, subscriptionId: SUB, invoiceId: 'in_lifecycle' }), 'payment_unavailable');
  t.check('held invoice has no financial marker or period allocation',
    (await redis(['KEYS', 'membership:launch-v2:invoice:*'])).length === 0
    && (await redis(['KEYS', 'membership:launch-v2:period:*'])).length === 0);
  await reject('original pack PaymentIntent also blocked', () => grantMembership(redis, 'pack', {
    owner: UID, paymentId: 'pi_fence', packId: 'id_25', plan: 'free', currency: 'usd', amountCents: 299, paid: true,
  }), 'grant_held');
  t.check('unrelated pack still fulfilled', (await grantMembership(redis, 'pack', {
    owner: UID, paymentId: 'pi_unrelated', packId: 'id_25', plan: 'free', currency: 'usd', amountCents: 299, paid: true,
  })).id_delta === 25);
  const saved = await snapshot();
  t.check('same refund event replay exact and read-only', JSON.stringify(await f.core.webhook(refund)) === JSON.stringify(held)
    && saved === await snapshot());
  await redis(['DEL', membershipGrantHoldKey('period', 'in_lifecycle')]);
  const damaged = await snapshot();
  await reject('retained hold receipt missing hold authority is corruption', () => f.core.webhook(refund), 'hold_corrupt');
  t.check('missing authority not silently reconstructed', damaged === await snapshot());
});

await t.section('postgrant disputes preserve exact financial bytes and sticky holds', async () => {
  const f = await fixture(), paid = f.invoice(), original = await f.core.webhook(paid);
  const event = f.event('charge.dispute.created', { object: 'dispute', id: 'dp_fence' });
  f.stripe.resolveReversalProvenance = async () => ({ accountId: ACCOUNT, livemode: false,
    objectType: 'dispute', objectId: 'dp_fence', customerId: CUSTOMER, paymentId: 'pi_disputed',
    invoiceId: 'in_lifecycle', invoiceLookupComplete: true, reason: 'dispute_open' });
  const financialKeys = [...await redis(['KEYS', 'membership:launch-v2:period:*']),
    ...await redis(['KEYS', 'membership:launch-v2:invoice:*'])];
  const before = JSON.stringify(await Promise.all(financialKeys.map(k => redis(['GET', k]))));
  await f.core.webhook(event);
  t.check('post-grant dispute preserves every original period/journal byte',
    before === JSON.stringify(await Promise.all(financialKeys.map(k => redis(['GET', k])))));
  t.check('existing invoice replay still exact after hold', JSON.stringify(original) === JSON.stringify(await f.core.webhook(paid)));
  const closed = f.event('charge.dispute.closed', { object: 'dispute', id: 'dp_fence' });
  const old = f.stripe.resolveReversalProvenance;
  f.stripe.resolveReversalProvenance = async () => ({ ...await old(), reason: 'dispute_closed' });
  await f.core.webhook(closed);
  t.check('closed dispute cannot auto-release hold', await redis(['EXISTS', membershipGrantHoldKey('period', 'in_lifecycle')]) === 1);
});

await t.section('invalid reversal provenance and lost hold response fail safely', async () => {
  const f = await fixture();
  const event = f.event('charge.refunded', { object: 'charge', id: 'ch_fence' });
  const valid = { accountId: ACCOUNT, livemode: false, objectType: 'charge', objectId: 'ch_fence',
    customerId: CUSTOMER, paymentId: 'pi_fence', invoiceId: null, invoiceLookupComplete: true, reason: 'charge_refunded' };
  for (const override of [{ accountId: 'acct_wrong' }, { invoiceLookupComplete: false },
    { paymentId: null }, { objectId: 'ch_other' }, { livemode: true }]) {
    f.stripe.resolveReversalProvenance = async () => ({ ...valid, ...override });
    const before = await snapshot();
    await reject('invalid canonical linkage never reports installed hold', () => f.core.webhook(event), 'reversal_provenance_incomplete');
    t.check('invalid linkage cannot mutate any key', before === await snapshot());
  }
  f.stripe.resolveReversalProvenance = async () => { throw new Error('synthetic canonical outcome unknown'); };
  await reject('unknown provenance explicitly unavailable', () => f.core.webhook(event), 'reversal_provenance_unavailable');
  f.stripe.resolveReversalProvenance = async () => valid;
  let loss = true;
  const core = createMembershipLifecycle({ ...f.options, execute: async args => {
    const result = await redis(args);
    if (args[0] === 'EVAL' && loss) { loss = false; throw new Error('lost installed hold response'); }
    return result;
  } });
  await reject('response loss after atomic hold remains an error', () => core.webhook(event));
  const installed = await snapshot();
  t.check('retry proves preserved installed hold without re-executing financial action',
    (await core.webhook(event)).lateGrantExclusion === 'installed' && installed === await snapshot());
});

await t.section('verified webhook retries recover unknown canonical reads without financial work', async () => {
  for (const type of ['customer.subscription.updated', 'invoice.payment_failed', 'invoice.payment_action_required']) {
    const f = await fixture();
    f.invoice();
    const event = f.event(type, type.startsWith('invoice.')
      ? { object: 'invoice', id: 'in_lifecycle' } : { object: 'subscription', id: SUB });
    const retrieve = f.stripe.retrieveSubscriptionSnapshot;
    f.stripe.retrieveSubscriptionSnapshot = async () => { throw new Error('synthetic canonical response loss'); };
    await reject(`${type}: first unknown remains error`, () => f.core.webhook(event), 'canonical_outcome_unknown');
    const failed = await f.get();
    t.check(`${type}: durable claim retained`, failed.claim !== null && failed.revision === 0);
    f.stripe.retrieveSubscriptionSnapshot = retrieve;
    f.state.status = 'past_due';
    const restarted = createMembershipLifecycle(f.options);
    const result = await restarted.webhook(event);
    t.check(`${type}: same signed retry after restart recovers`, result.status === 'refreshed'
      && result.snapshot.status === 'past_due' && (await f.get()).claim === null);
    const before = await snapshot(), calls = f.retrievals;
    t.check(`${type}: completed retry exact result`, JSON.stringify(await restarted.webhook(event)) === JSON.stringify(result));
    t.check(`${type}: completed replay no writes or canonical fetch`, before === await snapshot() && calls === f.retrievals);
    t.check(`${type}: no grants or financial counters`, (await redis(['KEYS', '*']))
      .every(k => !k.startsWith('id_credits:') && !k.startsWith('grade_credits:')
        && !k.startsWith('membership:launch-v2:invoice:')));
  }
});

await t.section('verified reconciliation fences stale readers and gives distinct events a fresh read', async () => {
  for (const sameEvent of [true, false]) {
    const f = await fixture(), entered = deferred(), gate = deferred();
    const event = f.event('customer.subscription.updated', { object: 'subscription', id: SUB }, 'evt_stalled');
    const next = sameEvent ? event
      : f.event('customer.subscription.updated', { object: 'subscription', id: SUB }, 'evt_newer');
    const stale = clone(f.state);
    f.stripe.retrieveSubscriptionSnapshot = async () => {
      const call = ++f.retrievals;
      if (call === 1) { entered.resolve(); await gate.promise; return stale; }
      return { ...clone(f.state), status: call === 2 ? 'past_due' : 'unpaid' };
    };
    const old = f.core.webhook(event); await entered.promise;
    const recovered = await f.core.webhook(next);
    t.check(`${sameEvent ? 'same' : 'distinct'} event commits recovered observation`, recovered.status === 'refreshed'
      && recovered.snapshot.status === (sameEvent ? 'past_due' : 'unpaid'));
    t.check('bounded read count including distinct-event fresh read', f.retrievals === (sameEvent ? 2 : 3));
    const before = await snapshot();
    gate.resolve();
    t.check('old still-running reader is superseded', (await old).status === 'superseded');
    t.check('stale worker cannot overwrite state or operation receipt', before === await snapshot());
    const calls = f.retrievals;
    await f.core.webhook(event); await f.core.webhook(next);
    t.check('both completed event receipts replay without further reads', calls === f.retrievals
      && before === await snapshot());
  }
});

await t.section('repeated read failure stays bounded; unsigned input cannot reconcile', async () => {
  const f = await fixture();
  const event = f.event('customer.subscription.updated', { object: 'subscription', id: SUB }, 'evt_retryfailure');
  f.stripe.retrieveSubscriptionSnapshot = async () => { f.retrievals++; throw new Error('read unavailable'); };
  for (let attempt = 1; attempt <= 3; attempt++) {
    await reject('unknown retry remains error, not success', () => f.core.webhook(event), 'canonical_outcome_unknown');
    t.check('at most one failed canonical read per same-event invocation', f.retrievals === attempt);
    t.check('claim remains durable with no committed snapshot', (await f.get()).snapshot === null);
  }
  const before = await snapshot();
  await reject('bad signature cannot recover claim', () => f.core.webhook({ ...event, signature: 'bad' }), 'invalid_signature');
  t.check('bad signature leaves claim bytes and read count untouched', before === await snapshot() && f.retrievals === 3);
});

await t.section('webhook response loss after snapshot commit replays without another read', async () => {
  const f = await fixture(); let writes = 0;
  const core = createMembershipLifecycle({ ...f.options, execute: async args => {
    const result = await redis(args);
    if (args[0] === 'EVAL' && ++writes === 2) throw new Error('synthetic post-commit response loss');
    return result;
  } });
  const event = f.event('customer.subscription.updated', { object: 'subscription', id: SUB }, 'evt_snapshotloss');
  await reject('post-commit transport loss is not reported as successful response', () => core.webhook(event));
  const before = await snapshot(), calls = f.retrievals;
  const result = await createMembershipLifecycle(f.options).webhook(event);
  t.check('restart recovers completed snapshot result', result.status === 'refreshed' && result.revision === 1);
  t.check('post-commit recovery no mutation or second read', before === await snapshot() && f.retrievals === calls);
});

t.done();
