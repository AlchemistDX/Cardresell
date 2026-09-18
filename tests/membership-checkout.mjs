// Actual isolated Redis; synthetic auth/Stripe dependencies. No live claims.
import { createHash } from 'node:crypto';
import { harness } from './_assert.mjs';
import { redisCommand as redis } from './_idRedis.mjs';
import { createMembershipCheckoutController, MEMBERSHIP_CHECKOUT_SCRIPT } from '../api/_membershipCheckout.js';
import { createMembershipBindingStore } from '../api/_membershipBindings.js';
import { createMembershipPaymentAdapter } from '../api/_membershipPayments.js';
import { grantMembership } from '../api/_membershipLedger.js';
import { LAUNCH_PLANS, LAUNCH_PACKS } from '../api/_launchMembershipConfig.js';
const t = harness('membership-checkout');
const sha = x => createHash('sha256').update(x).digest('hex');
const prices = { packs: {}, plans: {} };
for (const [group, catalog] of [['packs', LAUNCH_PACKS], ['plans', LAUNCH_PLANS]]) {
  for (const name of Object.keys(catalog)) if (name !== 'free') {
    prices[group][name] = { priceId: `price_${group}_${name}`, productId: `prod_${group}_${name}` };
  }
}
const request = (name = 'one', extra = {}) => ({ requestId: sha(name), kind: 'pack', selection: 'id_25', ...extra });
const reset = () => redis(['FLUSHDB']); // process-owned, private Unix-socket DB
const all = () => redis(['KEYS', '*']);
const snapshot = async () => JSON.stringify(await Promise.all((await all()).sort()
  .map(async k => [k, await redis(['GET', k]), await redis(['PTTL', k])])) );
const operationKeys = async () => (await all()).filter(k => k.includes(':checkout:operation:'));
async function rejected(label, fn, code) {
  try { await fn(); t.check(label, false); }
  catch (e) { t.check(label, code ? e.code === code : !!e.code, `actual ${e.code}`); }
}
async function noWrite(label, fn, code) {
  const before = await snapshot();
  await rejected(label, fn, code);
  t.check(`${label}: stored bytes and TTL unchanged`, await snapshot() === before);
}
function fixture(options = {}) {
  const f = { calls: 0, recoveries: 0, authCalls: 0, contextCalls: 0, grants: 0,
    now: 1800000000000, sessions: new Map(), orders: new Map(), created: [], plan: 'casual',
    complete: false, ...options };
  f.store = createMembershipBindingStore({ execute: f.bindingExecute || redis,
    accountId: 'acct_synthetic', livemode: false, priceMap: prices });
  f.auth = async token => {
    f.authCalls++;
    if (token === 'invalid') throw new Error('synthetic invalid token');
    return { verified: token !== 'unverified', uid: token === 'other' ? 'otherOwner' : 'syntheticOwner' };
  };
  f.makeSession = order => {
    const base = order.kind === 'pack' ? LAUNCH_PACKS[order.packId].basePriceCents : LAUNCH_PLANS[order.plan].monthlyPriceCents;
    const session = { id: `cs_${order.intentId}`, object: 'checkout.session', livemode: false,
      client_reference_id: order.intentId, customer: order.customerId,
      mode: order.kind === 'pack' ? 'payment' : 'subscription', status: f.complete ? 'complete' : 'open',
      payment_status: f.complete ? 'paid' : 'unpaid', currency: 'usd', amount_total: order.amountCents,
      amount_subtotal: base, total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: base - order.amountCents },
      payment_intent: order.kind === 'pack' && f.complete ? `pi_${order.intentId}` : null,
      subscription: order.kind === 'subscription' && f.complete ? `sub_${order.intentId}` : null,
      url: `https://checkout.stripe.com/c/pay/cs_${order.intentId}` };
    f.orders.set(order.intentId, structuredClone(order)); f.sessions.set(session.id, session);
    return session;
  };
  f.stripe = {
    async createCheckout(order, opts) {
      f.calls++; f.created.push(structuredClone(order));
      t.check('External creation sees durable order first', (await f.store.inspectIntent(order.intentId)).state === 'intent_persisted');
      const stored = (await Promise.all((await operationKeys())
        .map(async k => JSON.parse(await redis(['GET', k])).data)))
        .find(r => r.input.intentId === order.intentId);
      t.check('External creation sees acknowledged durable claim', stored?.state === 'creation_claimed');
      t.check('Creation receives abort signal and stable provider key', opts.signal instanceof AbortSignal
        && order.stripeIdempotencyKey === `membership-launch-v2-${order.intentId}`);
      const found = f.makeSession(order);
      if (f.afterCreate) await f.afterCreate(order, opts);
      return { id: found.id };
    },
    async recoverCheckout(order) {
      f.recoveries++;
      if (f.recoveryResult !== undefined) return f.recoveryResult;
      return [...f.sessions.values()].find(s => s.client_reference_id === order.intentId)?.id || null;
    },
    async retrieveAccount() { return { object: 'account', id: 'acct_synthetic' }; },
    async retrieveCheckoutSession(sessionId) { return structuredClone(f.sessions.get(sessionId)); },
    async listCheckoutLineItems(sessionId) {
      const s = f.sessions.get(sessionId), o = f.orders.get(s.client_reference_id);
      return { object: 'list', has_more: false, data: [{ quantity: 1, currency: 'usd',
        amount_subtotal: s.amount_subtotal, amount_total: s.amount_total, price: { id: o.priceId } }] };
    },
    async retrievePrice(priceId) {
      const entry = Object.entries(prices.packs).find(([, p]) => p.priceId === priceId)
        || Object.entries(prices.plans).find(([, p]) => p.priceId === priceId);
      const [name, p] = entry, pack = Object.hasOwn(LAUNCH_PACKS, name);
      return { object: 'price', id: priceId, livemode: false, product: p.productId, currency: 'usd',
        unit_amount: pack ? LAUNCH_PACKS[name].basePriceCents : LAUNCH_PLANS[name].monthlyPriceCents,
        type: pack ? 'one_time' : 'recurring', recurring: pack ? null : { interval: 'month', interval_count: 1 } };
    },
  };
  f.controller = extra => createMembershipCheckoutController({
    execute: redis, bindings: f.store, authenticate: f.auth,
    resolveContext: async owner => { f.contextCalls++; return { owner, customerId: owner === 'otherOwner' ? 'cus_other' : 'cus_synthetic',
      plan: f.plan, newSubscriptionAllowed: true }; },
    stripe: f.stripe, accountId: 'acct_synthetic', livemode: false, now: () => f.now, ...extra,
  });
  f.call = (req = request(), extra = {}, token = 'valid') => f.controller(extra).checkout({ token, request: req });
  return f;
}

await t.section('UID-bound persisted normal checkout and concurrent replay', async () => {
  await reset(); const f = fixture();
  const results = await Promise.all(Array.from({ length: 10 }, () => f.call()));
  t.check('Ten concurrent same requests create once', f.calls === 1);
  t.check('All replies honest ready or recoverable pending', results.every(r => ['checkout_ready', 'recovery_pending'].includes(r.status)));
  const saved = await snapshot(), response = await f.call();
  t.check('Same request reuses canonical hosted session', response.status === 'checkout_ready' && f.calls === 1);
  t.check('Replay preserves all stored bytes', saved === await snapshot());
  t.check('No billing keys created', !(await all()).some(k => k.startsWith('scans:')));
  t.check('No authoritative key has TTL', (await Promise.all((await all()).map(k => redis(['PTTL', k])))).every(n => n === -1));
  const record = JSON.parse(await redis(['GET', (await operationKeys())[0]])).data;
  t.check('Persisted server customer/quote inputs and single claim', record.state === 'creation_claimed'
    && record.input.owner === 'syntheticOwner' && record.input.plan === 'casual'
    && record.input.customerId === 'cus_synthetic' && /^[a-f0-9]{64}$/.test(record.input.intentId));
  f.plan = 'business';
  await f.call();
  t.check('Retry cannot reprice earlier immutable order', f.created[0].planAtCheckout === 'casual' && f.calls === 1);
  await noWrite('Same request changed pack', () => f.call(request('one', { selection: 'id_100' })), 'request_conflict');
  await f.call(request(), {}, 'other');
  t.check('Same idempotency token is separately scoped to verified owner', f.calls === 2 && f.created[1].owner === 'otherOwner');
});

await t.section('Authentication and client authority refusal', async () => {
  await reset(); const f = fixture();
  await noWrite('Invalid token', () => f.call(request(), {}, 'invalid'), 'checkout_unavailable');
  await noWrite('Unverified identity', () => f.call(request(), {}, 'unverified'), 'authentication_required');
  for (const uid of ['', 'bad uid', null]) {
    await noWrite('Malformed verified UID', () => f.call(request(), { authenticate: async () => ({ verified: true, uid }) }), 'authentication_required');
  }
  for (const field of ['owner', 'customerId', 'amountCents', 'priceId', 'plan', 'returnUrl', 'metadata']) {
    await noWrite(`Client ${field} refused`, () => f.call({ ...request(), [field]: 'untrusted' }), 'invalid_request');
  }
  for (const changes of [{ kind: 'annual' }, { selection: 'unknown' }, { requestId: 'nothex' },
    { kind: 'subscription', selection: 'free' }]) {
    await noWrite('Invalid selection/idempotency', () => f.call({ ...request(), ...changes }), 'invalid_request');
  }
  await noWrite('Server context must match authenticated UID', () => f.call(request(), {
    resolveContext: async () => ({ owner: 'otherOwner', customerId: 'cus_synthetic', plan: 'casual' }),
  }), 'checkout_not_authorized');
  t.check('Unauthorized requests made zero creation calls', f.calls === 0);
});

await t.section('Exact crash windows and conservative recovery', async () => {
  for (const phase of ['prepare', 'claim']) {
    await reset(); const f = fixture(); let once = true;
    const execute = async args => {
      const result = await redis(args);
      if (once && args[0] === 'EVAL' && args[1] === MEMBERSHIP_CHECKOUT_SCRIPT && args[5] === phase) {
        once = false; throw new Error('synthetic committed response loss');
      }
      return result;
    };
    await rejected(`Lost ${phase} acknowledgement`, () => f.call(request(), { execute }), 'checkout_unavailable');
    t.check(`${phase} loss no external call`, f.calls === 0);
    const opBefore = JSON.parse(await redis(['GET', (await operationKeys())[0]])).data;
    const reply = await f.call();
    t.check(`${phase} retry retains original intent`, JSON.parse(await redis(['GET', (await operationKeys())[0]])).data.input.intentId === opBefore.input.intentId);
    t.check(`${phase} retry safe disposition`, phase === 'prepare' ? reply.status === 'checkout_ready' && f.calls === 1
      : reply.status === 'recovery_pending' && f.calls === 0);
  }
  await reset();
  const f = fixture({ complete: true, afterCreate: async () => { throw new Error('synthetic provider committed response loss'); } });
  await rejected('Provider committed response loss', () => f.call(), 'checkout_unavailable');
  f.afterCreate = null;
  const replay = await f.call();
  t.check('Canonical recovery binds original session without second POST', replay.status === 'payment_bound' && f.calls === 1);
  for (const action of ['intent', 'session', 'settlement']) {
    await reset(); let fail = true;
    const g = fixture({ complete: true, bindingExecute: async args => {
      const r = await redis(args);
      if (fail && args[0] === 'EVAL' && JSON.parse(args.at(-1)).action === action) {
        fail = false; throw new Error('synthetic binding committed response loss');
      }
      return r;
    } });
    await rejected(`Lost binding ${action} response`, () => g.call(), 'checkout_unavailable');
    const r = await g.call();
    t.check(`${action} exact binding recovery`, r.status === 'payment_bound' && g.calls === 1);
  }
});

await t.section('Canonical negative shapes never reach bindings/ledger', async () => {
  const mutations = [
    ['account', f => { f.stripe.retrieveAccount = async () => ({ object: 'account', id: 'acct_wrong' }); }],
    ...Object.entries({ livemode: true, customer: 'cus_wrong', client_reference_id: 'wrong', mode: 'subscription',
      currency: 'eur', amount_total: 1, amount_subtotal: 1, status: 'invented', payment_intent: 'pi_bad space',
      subscription: 'sub_wrong', url: 'https://checkout.stripe.com.attacker.test/c/pay/foo' })
      .map(([k, v]) => [k, f => { const get = f.stripe.retrieveCheckoutSession;
        f.stripe.retrieveCheckoutSession = async id => ({ ...await get(id), [k]: v }); }]),
    ['partial pagination', f => { const get = f.stripe.listCheckoutLineItems;
      f.stripe.listCheckoutLineItems = async id => ({ ...await get(id), has_more: true }); }],
    ['quantity', f => { const get = f.stripe.listCheckoutLineItems;
      f.stripe.listCheckoutLineItems = async id => { const v = await get(id); v.data[0].quantity = 2; return v; }; }],
    ['price product', f => { const get = f.stripe.retrievePrice;
      f.stripe.retrievePrice = async id => ({ ...await get(id), product: 'prod_wrong' }); }],
    ['price amount', f => { const get = f.stripe.retrievePrice;
      f.stripe.retrievePrice = async id => ({ ...await get(id), unit_amount: 1 }); }],
    ['tax', f => { const get = f.stripe.retrieveCheckoutSession;
      f.stripe.retrieveCheckoutSession = async id => { const v = await get(id); v.total_details.amount_tax = 1; return v; }; }],
    ['discount', f => { const get = f.stripe.retrieveCheckoutSession;
      f.stripe.retrieveCheckoutSession = async id => { const v = await get(id); v.total_details.amount_discount = 0; return v; }; }],
    ['line price', f => { const get = f.stripe.listCheckoutLineItems;
      f.stripe.listCheckoutLineItems = async id => { const v = await get(id); v.data[0].price.id = 'price_wrong'; return v; }; }],
  ];
  for (const [name, mutate] of mutations) {
    await reset(); const f = fixture(); mutate(f);
    await rejected(`Canonical ${name} rejected`, () => f.call());
    const op = JSON.parse(await redis(['GET', (await operationKeys())[0]])).data;
    t.check(`${name}: no session/settlement bound`, (await f.store.inspectIntent(op.input.intentId)).state === 'intent_persisted');
    t.check(`${name}: no credit mutation`, !(await all()).some(k => k.startsWith('scans:')));
    const before = await snapshot();
    await rejected(`${name}: repeated failure still no create`, () => f.call());
    t.check(`${name}: no retry mutation or second create`, before === await snapshot() && f.calls === (name === 'account' ? 0 : 1));
  }
});

await t.section('Dependency failure, ambiguous recovery, expanded IDs and exact serialization', async () => {
  await reset(); const f = fixture();
  await noWrite('Store unavailable before any preparation', () => f.call(request(), {
    execute: async () => { throw new Error('synthetic store unavailable'); },
  }), 'checkout_unavailable');
  t.check('Store failure never invokes external creation', f.calls === 0);
  await noWrite('Invalid serialization fails before Redis mutation', async () => {
    const stringify = JSON.stringify;
    JSON.stringify = function (value, ...args) {
      return value?.data?.state === 'prepared' && value.hash ? 'nil' : stringify.call(JSON, value, ...args);
    };
    try { await f.call(); } finally { JSON.stringify = stringify; }
  }, 'checkout_corrupt');
  await noWrite('Invalid clock prevents preparation', () => f.call(request(), { now: () => NaN }), 'checkout_clock');
  // A claim remains consumed despite an unrecognized create response.
  f.stripe.createCheckout = async () => { f.calls++; return { id: 'not_session' }; };
  await rejected('Malformed creation response remains uncertain', () => f.call(), 'canonical_reference_invalid');
  f.recoveryResult = [];
  await noWrite('Ambiguous recovery cannot bind', () => f.call(), 'canonical_reference_invalid');
  f.recoveryResult = null;
  const before = await snapshot();
  t.check('Unknown recovery stays pending without resetting claim', (await f.call()).status === 'recovery_pending'
    && f.calls === 1 && before === await snapshot());
  f.now += 86400000 * 30;
  t.check('Past any provider idempotency window still no second POST', (await f.call()).status === 'recovery_pending' && f.calls === 1);

  await reset(); const g = fixture({ complete: true });
  const get = g.stripe.retrieveCheckoutSession;
  g.stripe.retrieveCheckoutSession = async id => {
    const s = await get(id);
    return { ...s, customer: { id: s.customer }, payment_intent: { id: s.payment_intent } };
  };
  t.check('Canonical expanded customer/payment references accepted', (await g.call()).status === 'payment_bound');
  const order = g.created[0];
  g.stripe.retrieveCheckoutSession = async id => ({ ...await get(id), payment_intent: 'pi_conflicting' });
  await noWrite('Canonical payment cannot replace durable payment binding', () => g.call(), 'checkout_unavailable');
  t.check('Original canonical PI remains intact', (await g.store.inspectIntent(order.intentId)).paymentId === `pi_${order.intentId}`);
});

await t.section('Corruption, serialization, expiry and subscription admission', async () => {
  for (const corrupt of ['nil', '{}', 'null', '[]', '{"data":null,"hash":"bad"}']) {
    await reset(); const f = fixture(); await f.call();
    const key = (await operationKeys())[0]; await redis(['SET', key, corrupt]);
    await noWrite(`Corrupt operation ${corrupt}`, () => f.call(), 'checkout_corrupt');
    t.check('Corrupt operation never recreates', f.calls === 1);
  }
  await reset(); const f = fixture(); let stopped = true;
  await rejected('Interrupt after preparation before order', () => f.call(request(), { bindings: {
    ...f.store, createIntent: async (...args) => { if (stopped) throw new Error('synthetic stop'); return f.store.createIntent(...args); },
  } }), 'checkout_unavailable');
  stopped = false; f.now += 300001;
  const before = await snapshot(), expired = await f.call();
  t.check('Expired unclaimed quote read-only refusal', expired.status === 'expired' && f.calls === 0 && before === await snapshot());
  await reset(); const g = fixture({ complete: true });
  const req = request('sub', { kind: 'subscription', selection: 'casual' });
  const replies = await Promise.allSettled([g.call(req), g.call(request('sub2', { kind: 'subscription', selection: 'pro' }))]);
  t.check('Concurrent distinct subscription intent exactly one admitted', replies.filter(r => r.status === 'fulfilled').length === 1 && g.calls === 1);
  t.check('Losing subscription rejected, not silently remapped', replies.some(r => r.reason?.code === 'subscription_in_progress'));
  t.check('Subscription binding does not grant or invent term', !(await all()).some(k => k.startsWith('scans:') || k.includes(':bindings:term:')));
  const op = JSON.parse(await redis(['GET', (await operationKeys())[0]])).data;
  const winner = { requestId: op.requestId, kind: op.kind, selection: op.selection };
  const subGate = (await all()).find(k => k.includes(':checkout:subscription:'));
  await redis(['DEL', subGate]);
  await noWrite('Missing initialized subscription admission is corruption', () => g.call(winner), 'checkout_corrupt');
  // The converse must not implicitly repair missing operation authority either.
  await reset(); const h = fixture({ complete: true }); await h.call(req);
  const key = (await operationKeys())[0]; await redis(['DEL', key]);
  await noWrite('Missing subscription operation with retained admission fails closed', () => h.call(req), 'checkout_unavailable');
  t.check('Lost operation does not create another subscription', h.calls === 1);
});

await t.section('Whole operation timeout does not continue a late provider result', async () => {
  await reset();
  let release, signaled;
  const held = new Promise(r => { release = r; });
  const f = fixture({ afterCreate: async (order, options) => { signaled = options.signal; await held; } });
  await rejected('Bounded deadline after external creation', () => f.call(request(), { operationTimeoutMs: 40 }), 'checkout_timeout');
  t.check('Timeout abort signal fired', signaled?.aborted === true);
  release(); await new Promise(r => setTimeout(r, 10));
  t.check('Late result did not bind or grant', (await f.store.inspectIntent(f.created[0].intentId)).state === 'intent_persisted');
  f.afterCreate = null;
  t.check('Next request recovers same external session', (await f.call()).status === 'checkout_ready' && f.calls === 1);
  await reset(); const g = fixture();
  let finishAuth;
  const authWait = new Promise(resolve => { finishAuth = resolve; });
  await rejected('Deadline also bounds authentication', () => g.call(request(), {
    operationTimeoutMs: 20, authenticate: () => authWait,
  }), 'checkout_timeout');
  finishAuth({ uid: 'syntheticOwner', verified: true });
  await new Promise(r => setTimeout(r, 5));
  t.check('Late authentication cannot start storage or Stripe work', (await all()).length === 0 && g.calls === 0);
});

await t.section('Approved payment adapter fulfills recovered binding exactly once', async () => {
  await reset(); const f = fixture({ complete: true });
  const reply = await f.call(), order = f.created[0];
  const stripe = { ...f.stripe,
    retrievePaymentIntent: async id => ({ object: 'payment_intent', id, livemode: false,
      status: 'succeeded', currency: 'usd', amount: order.amountCents, amount_received: order.amountCents, customer: order.customerId }),
    retrieveInvoice: async () => { throw new Error('not used'); },
    listInvoiceLines: async () => { throw new Error('not used'); },
    retrieveSubscription: async () => { throw new Error('not used'); },
    verifyWebhook: async () => ({ id: 'evt_synthetic', object: 'event', livemode: false,
      account: 'acct_synthetic', type: 'checkout.session.completed', data: { object: { object: 'checkout.session', id: reply.sessionId } } }),
  };
  const adapter = createMembershipPaymentAdapter({ stripe, bindings: f.store,
    fulfill: (kind, envelope) => grantMembership(redis, kind, envelope),
    accountId: 'acct_synthetic', livemode: false, priceMap: prices });
  await Promise.all([adapter.checkoutReturn({ sessionId: reply.sessionId, authenticatedOwner: order.owner }),
    adapter.webhook({ rawBody: Buffer.from('synthetic'), signature: 'synthetic' })]);
  t.check('Return/webhook race grants exactly one pack', await redis(['GET', `scans:${order.owner}:id_paid_left`]) === '25');
  const before = await snapshot(); await f.call();
  await adapter.checkoutReturn({ sessionId: reply.sessionId, authenticatedOwner: order.owner });
  t.check('Controller and payment replay preserve balances and journals', before === await snapshot());
  await noWrite('Different authenticated owner cannot collect payment', () => adapter.checkoutReturn({
    sessionId: reply.sessionId, authenticatedOwner: 'otherOwner' }), 'owner_mismatch');
});
t.done();
