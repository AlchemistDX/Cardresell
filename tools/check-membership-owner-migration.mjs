import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { redisCommand as redis } from '../tests/_idRedis.mjs';
import { createMembershipOwnerMigration } from '../api/_membershipOwnerMigration.js';
import { createMembershipLifecycleStripe } from '../api/_membershipLifecycleStripe.js';
import { createMembershipStripeTransport, MEMBERSHIP_STRIPE_API_VERSION } from '../api/_membershipStripe.js';
import { grantMembership, membershipIncludedHistoryKey } from '../api/_membershipLedger.js';
import { LAUNCH_PLANS, LAUNCH_PACKS } from '../api/_launchMembershipConfig.js';
const sha = x => createHash('sha256').update(x).digest('hex');
const NOW = Number((await redis(['TIME']))[0]);
const secret = 'whsec_syntheticnotacredential';
const list = data => ({ object: 'list', data, has_more: false });
const copy = x => structuredClone(x);
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
async function fixture() {
  await redis(['FLUSHDB']); // this process's private Unix socket only
  const a = { owner: 'owner', customerId: 'cus_owner', subscriptionId: 'sub_legacy',
    priceId: 'price_legacy', productId: 'prod_legacy', periodStart: NOW - 10000, periodEnd: NOW - 100,
    evidenceId: sha('synthetic-audit'), approvedAt: NOW - 300 };
  const accountId = 'acct_test', priceMap = { plans: {}, packs: {} }, prices = {};
  for (const [group, configs] of [['plans', LAUNCH_PLANS], ['packs', LAUNCH_PACKS]]) {
    for (const [name, config] of Object.entries(configs)) {
      if (name === 'free') continue;
      const mapping = { priceId: `price_${name}`, productId: `prod_${name}` };
      priceMap[group][name] = mapping;
      prices[mapping.priceId] = { object: 'price', id: mapping.priceId, product: mapping.productId,
        livemode: false, currency: 'usd', unit_amount: group === 'plans' ? config.monthlyPriceCents : config.basePriceCents,
        type: group === 'plans' ? 'recurring' : 'one_time',
        recurring: group === 'plans' ? { interval: 'month', interval_count: 1 } : null };
    }
  }
  prices[a.priceId] = { ...copy(prices.price_casual), id: a.priceId, product: a.productId };
  const f = { now: NOW - 200, posts: [], schedules: {}, bills: {}, lines: {}, loseGrant: false, loseUpdate: false,
    customer: { owner: a.owner, customerId: a.customerId, accountId, livemode: false, state: 'bound' },
    subscription: { object: 'subscription', id: a.subscriptionId, customer: a.customerId, livemode: false,
      status: 'active', cancel_at_period_end: false, schedule: null, discounts: [], default_tax_rates: [],
      items: list([{ id: 'si_owner', price: a.priceId, quantity: 1,
        current_period_start: a.periodStart, current_period_end: a.periodEnd }]) } };
  const verifier = createMembershipStripeTransport({ apiKey: 'rk_test_syntheticnotacredential',
    accountId, livemode: false, webhookSecret: secret, apiVersion: MEMBERSHIP_STRIPE_API_VERSION,
    nowSeconds: () => NOW, fetchImpl: async () => { throw Error('network forbidden'); } });
  const reader = {
    retrieveAccount: async () => ({ object: 'account', id: accountId }),
    retrieveSubscription: async () => copy(f.subscription),
    retrievePrice: async id => copy(prices[id]),
    retrieveInvoice: async id => copy(f.bills[id]),
    listInvoiceLines: async id => copy(f.lines[id]),
    retrieveCheckoutSession: async () => { throw Error('not a checkout migration'); },
    listCheckoutLineItems: async () => { throw Error('not a checkout migration'); },
    retrievePaymentIntent: async () => { throw Error('not needed'); },
    verifyWebhook: verifier.verifyWebhook,
  };
  const transport = createMembershipLifecycleStripe({ execute: redis, reader, accountId, priceMap,
    apiKey: 'rk_test_syntheticnotacredential',
    legacySubscription: Object.fromEntries(['owner', 'customerId', 'subscriptionId', 'priceId', 'productId',
      'periodStart', 'periodEnd'].map(key => [key, a[key]])),
    fetchImpl: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/v1/account') return Response.json({ object: 'account', id: accountId });
      if (init.method === 'POST') {
        const p = Object.fromEntries(new URLSearchParams(init.body));
        f.posts.push({ path, body: p });
        if (path === '/v1/subscription_schedules') {
          assert.deepEqual(p, { from_subscription: a.subscriptionId });
          f.subscription.schedule = 'sub_sched_owner';
          f.schedules.sub_sched_owner = { object: 'subscription_schedule', id: 'sub_sched_owner',
            customer: a.customerId, subscription: a.subscriptionId, livemode: false, end_behavior: 'release', phases: [] };
          if (f.loseCreate) { f.loseCreate = false; throw Error('synthetic create response loss'); }
        } else {
          assert.equal(path, '/v1/subscription_schedules/sub_sched_owner');
          f.schedules.sub_sched_owner.phases = [0, 1].map(i => ({
            start_date: Number(p[`phases[${i}][start_date]`]),
            end_date: p[`phases[${i}][end_date]`] ? Number(p[`phases[${i}][end_date]`]) : undefined,
            proration_behavior: p[`phases[${i}][proration_behavior]`],
            items: [{ price: p[`phases[${i}][items][0][price]`], quantity: 1 }],
          }));
          if (f.tamperCurrent) f.schedules.sub_sched_owner.phases[0].end_date--;
          if (f.loseUpdate) { f.loseUpdate = false; throw Error('synthetic update response loss'); }
        }
      }
      return Response.json(copy(f.schedules[path.split('/').at(-1)] || f.schedules.sub_sched_owner));
    } });
  const options = { execute: redis, accountId, livemode: false, authorization: a,
    customers: { get: async () => copy(f.customer) }, stripe: { ...reader, ...transport }, priceMap,
    now: () => f.now, fulfill: async (kind, envelope) => {
      const result = await grantMembership(redis, kind, envelope);
      if (f.loseGrant) { f.loseGrant = false; throw Error('synthetic grant response loss'); }
      return result;
    } };
  const core = createMembershipOwnerMigration(options);
  await redis(['SET', 'membership:launch-v2:legacy_fence', '1']);
  await redis(['SET', 'scans:owner:id_paid_left', '87']);
  await redis(['SET', 'scans:owner:paid_left', '14']);
  await redis(['SET', 'pro:owner', '{"historical":[],"amount":999}']);
  const schedule = () => core.schedule({ owner: a.owner });
  function invoice(id = 'in_first', start = a.periodEnd, end = NOW + 2591900) {
    f.bills[id] = { object: 'invoice', id, livemode: false, status: 'paid', customer: a.customerId,
      amount_paid_off_stripe: 0, amount_remaining: 0, status_transitions: { paid_at: NOW - 20 },
      billing_reason: 'subscription_cycle', parent: { type: 'subscription_details',
        subscription_details: { subscription: a.subscriptionId } }, currency: 'usd', amount_paid: 999,
      amount_due: 999, total: 999, amount_overpaid: 0, amount_shipping: 0, starting_balance: 0, ending_balance: 0,
      pre_payment_credit_notes_amount: 0, post_payment_credit_notes_amount: 0, total_taxes: [], total_discount_amounts: [] };
    f.lines[id] = list([{ object: 'line_item', livemode: false, quantity: 1, quantity_decimal: '1',
      parent: { type: 'subscription_item_details', subscription_item_details: {
        subscription: a.subscriptionId, subscription_item: 'si_owner', proration: false } },
      period: { start, end }, currency: 'usd', amount: 999, pricing: { type: 'price_details',
        price_details: { price: 'price_casual', product: 'prod_casual' }, unit_amount_decimal: '999' },
      taxes: [], discount_amounts: [], pretax_credit_amounts: [] }]);
    const rawBody = Buffer.from(JSON.stringify({ object: 'event', id: 'evt_' + id, livemode: false,
      type: 'invoice.paid', data: { object: { object: 'invoice', id } }, created: NOW, api_version: MEMBERSHIP_STRIPE_API_VERSION }));
    return { rawBody, signature: `t=${NOW},v1=${createHmac('sha256', secret).update(NOW + '.').update(rawBody).digest('hex')}` };
  }
  return { ...f, f, a, core, options, schedule, invoice, prices, transport };
}
await test('live mode refuses before I/O', async () => {
  const x = await fixture(); assert.throws(() => createMembershipOwnerMigration({ ...x.options, livemode: true }));
});
await test('wrong owner cannot prepare or schedule', async () => {
  const x = await fixture(); await assert.rejects(() => x.core.schedule({ owner: 'other' }));
  assert.equal(x.f.posts.length, 0);
});
await test('conflicting association refuses before Stripe mutation', async () => {
  const x = await fixture(); x.f.customer.customerId = 'cus_other'; await assert.rejects(x.schedule);
  assert.equal(x.f.posts.length, 0);
});
await test('canonical legacy price amount is checked before any mutation', async () => {
  const x = await fixture(); x.prices.price_legacy.unit_amount = 1000; await assert.rejects(x.schedule);
  assert.equal(x.f.posts.length, 0);
});
await test('canonical legacy customer and actual renewal boundary cannot drift', async () => {
  const x = await fixture(); x.f.subscription.items.data[0].current_period_end++; await assert.rejects(x.schedule);
  assert.equal(x.f.posts.length, 0);
});
await test('target Casual price mismatch rejects before any schedule POST', async () => {
  const x = await fixture(); x.prices.price_casual.unit_amount = 1999;
  await assert.rejects(x.schedule); assert.equal(x.f.posts.length, 0);
});
await test('missing fence prevents schedule creation', async () => {
  const x = await fixture(); await redis(['DEL', 'membership:launch-v2:legacy_fence']);
  await assert.rejects(x.schedule); assert.equal(x.f.posts.length, 0);
});
await test('schedule preserves current price and paid-through period with no proration or grant', async () => {
  const x = await fixture(); assert.equal((await x.schedule()).status, 'confirmed');
  const update = x.f.posts[1].body;
  assert.equal(update['phases[0][items][0][price]'], 'price_legacy');
  assert.equal(update['phases[0][end_date]'], String(x.a.periodEnd));
  assert.equal(update['phases[1][start_date]'], String(x.a.periodEnd));
  assert.equal(update['phases[1][items][0][price]'], 'price_casual');
  assert.equal(update.proration_behavior, 'none');
  assert.equal(await redis(['GET', membershipIncludedHistoryKey('owner')]), null);
  assert.equal(await redis(['GET', 'scans:owner:id_paid_left']), '87');
  assert.equal(await redis(['GET', 'pro:owner']), '{"historical":[],"amount":999}');
  await x.schedule(); assert.equal(x.f.posts.length, 2);
});
await test('lost schedule-update response recovers through readback without a new POST', async () => {
  const x = await fixture(); x.f.loseUpdate = true; await assert.rejects(x.schedule);
  assert.equal((await x.schedule()).status, 'confirmed'); assert.equal(x.f.posts.length, 2);
});
await test('lost schedule-create response remains pending without repeating creation', async () => {
  const x = await fixture(); x.f.loseCreate = true; await assert.rejects(x.schedule);
  assert.equal((await x.schedule()).status, 'pending'); assert.equal(x.f.posts.length, 1);
});
await test('different canonical current phase cannot confirm the migration', async () => {
  const x = await fixture(); x.f.tamperCurrent = true; await assert.rejects(x.schedule);
  assert.equal(await redis(['GET', membershipIncludedHistoryKey('owner')]), null);
});
await test('transport rejects non-Casual or wrong-owner legacy command', async () => {
  const x = await fixture();
  await assert.rejects(() => x.transport.executeCommand({ owner: 'other', subscriptionId: 'sub_legacy',
    operationId: 'a'.repeat(64), kind: 'plan_change', plan: 'casual', phase: 'requested',
    effectiveAt: x.a.periodEnd, idempotencyKey: 'synthetic' }));
  assert.equal(x.f.posts.length, 0);
});
await test('invoice cannot grant before confirmed schedule authority', async () => {
  const x = await fixture(); x.f.now = NOW; const event = x.invoice();
  await assert.rejects(() => x.core.webhook(event)); assert.equal(await redis(['GET', membershipIncludedHistoryKey('owner')]), null);
});
await test('first Casual renewal grants 50 ID and 15 Grade once across signed duplicates and return recovery', async () => {
  const x = await fixture(); await x.schedule(); x.f.now = NOW; const event = x.invoice();
  await Promise.all(Array.from({ length: 6 }, () => x.core.webhook(event)));
  await x.core.invoiceRecovery({ invoiceId: 'in_first', authenticatedOwner: 'owner' });
  const history = JSON.parse(await redis(['GET', membershipIncludedHistoryKey('owner')]));
  assert.equal(history.count, 1);
  const period = JSON.parse(await redis(['GET', history.periods[0]]));
  assert.deepEqual([period.id_grant, period.grade_grant], [50, 15]);
  assert.equal(await redis(['GET', 'scans:owner:id_paid_left']), '87');
  assert.equal(await redis(['GET', 'scans:owner:paid_left']), '14');
});
await test('lost financial acknowledgment replays one grant', async () => {
  const x = await fixture(); await x.schedule(); x.f.now = NOW; x.f.loseGrant = true;
  const event = x.invoice(); await assert.rejects(() => x.core.webhook(event)); await x.core.webhook(event);
  assert.equal(JSON.parse(await redis(['GET', membershipIncludedHistoryKey('owner')])).count, 1);
});
await test('pre-boundary invoice cannot mint a midperiod Casual allocation', async () => {
  const x = await fixture(); await x.schedule(); x.f.now = NOW;
  await assert.rejects(() => x.core.webhook(x.invoice('in_early', x.a.periodStart, x.a.periodEnd)));
  assert.equal(await redis(['GET', membershipIncludedHistoryKey('owner')]), null);
});
await test('failed invoice and forged signature never grant', async () => {
  const x = await fixture(); await x.schedule(); x.f.now = NOW; const event = x.invoice();
  await assert.rejects(() => x.core.webhook({ ...event, signature: 'bad' }));
  x.f.bills.in_first.status = 'open'; await assert.rejects(() => x.core.webhook(event));
  assert.equal(await redis(['GET', membershipIncludedHistoryKey('owner')]), null);
});
await test('failed renewal can recover later exactly once', async () => {
  const x = await fixture(); await x.schedule(); x.f.now = NOW; const event = x.invoice();
  x.f.bills.in_first.status = 'open'; await assert.rejects(() => x.core.webhook(event));
  x.f.bills.in_first.status = 'paid'; await x.core.webhook(event); await x.core.webhook(event);
  assert.equal(JSON.parse(await redis(['GET', membershipIncludedHistoryKey('owner')])).count, 1);
});
await test('not-yet-started invoice cannot grant future allowances', async () => {
  const x = await fixture(); await x.schedule(); x.f.now = NOW;
  await assert.rejects(() => x.core.webhook(x.invoice('in_future', NOW + 10, NOW + 2592010)));
  assert.equal(await redis(['GET', membershipIncludedHistoryKey('owner')]), null);
});
await test('wrong authenticated owner and wrong canonical customer refuse delivery', async () => {
  const x = await fixture(); await x.schedule(); x.f.now = NOW; const event = x.invoice();
  await assert.rejects(() => x.core.invoiceRecovery({ invoiceId: 'in_first', authenticatedOwner: 'other' }));
  x.f.bills.in_first.customer = 'cus_other'; await assert.rejects(() => x.core.webhook(event));
  assert.equal(await redis(['GET', membershipIncludedHistoryKey('owner')]), null);
});
console.log(`${passed} passed, 0 failed`);
process.exit(0);
