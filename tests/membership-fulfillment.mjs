// Synthetic canonical Stripe + real HMAC and private Redis. No external calls.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { redisCommand as execute } from './_idRedis.mjs';
import { createMembershipBindingStore } from '../api/_membershipBindings.js';
import { createMembershipPaymentAdapter } from '../api/_membershipPayments.js';
import { createMembershipFulfillment } from '../api/_membershipFulfillment.js';
import { createMembershipStripeTransport, MEMBERSHIP_STRIPE_API_VERSION } from '../api/_membershipStripe.js';
import { grantMembership } from '../api/_membershipLedger.js';
import { LAUNCH_PLANS, LAUNCH_PACKS } from '../api/_launchMembershipConfig.js';
let passed = 0;
const check = x => { assert.ok(x); passed++; };
const rejects = async fn => { await assert.rejects(fn); passed++; };
await execute(['FLUSHDB']);
const accountId = 'acct_fixture', secret = 'whsec_syntheticintegrationsecret', now = Math.floor(Date.now()/1000);
const priceMap = { plans: {}, packs: {} }, prices = {};
for (const [group, config] of [['plans', LAUNCH_PLANS], ['packs', LAUNCH_PACKS]]) {
  for (const [name, p] of Object.entries(config)) if (name !== 'free') {
    const priceId = `price_${group}_${name}`, productId = `prod_${group}_${name}`;
    priceMap[group][name] = { priceId, productId };
    prices[priceId] = { object: 'price', id: priceId, product: productId, livemode: false,
      currency: 'usd', unit_amount: group === 'plans' ? p.monthlyPriceCents : p.basePriceCents,
      type: group === 'plans' ? 'recurring' : 'one_time',
      recurring: group === 'plans' ? { interval: 'month', interval_count: 1 } : null };
  }
}
const bindings = createMembershipBindingStore({ execute, accountId, livemode: false, priceMap });
const intentId = 'a'.repeat(64);
await bindings.createIntent({ intentId, kind: 'pack', owner: 'fixtureOwner',
  customerId: 'cus_fixture', packId: 'id_25', plan: 'free' });
let session = { object: 'checkout.session', id: 'cs_fixture', livemode: false, client_reference_id: intentId,
  customer: 'cus_fixture', mode: 'payment', currency: 'usd', amount_subtotal: 299, amount_total: 299,
  total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
  status: 'complete', payment_status: 'paid', payment_intent: 'pi_fixture', subscription: null };
const verifier = createMembershipStripeTransport({ apiKey: 'sk_test_synthetic', webhookSecret: secret, accountId,
  livemode: false, apiVersion: MEMBERSHIP_STRIPE_API_VERSION, nowSeconds: () => now,
  fetchImpl: async () => { throw Error('network forbidden'); } });
const stripe = { verifyWebhook: verifier.verifyWebhook,
  retrieveAccount: async () => ({ object: 'account', id: accountId }),
  retrieveCheckoutSession: async () => structuredClone(session),
  listCheckoutLineItems: async () => ({ object: 'list', has_more: false, data: [{
    quantity: 1, currency: 'usd', amount_subtotal: 299, amount_total: 299, price: 'price_packs_id_25' }] }),
  retrievePrice: async id => structuredClone(prices[id]),
  retrievePaymentIntent: async id => ({ object: 'payment_intent', id, livemode: false, customer: 'cus_fixture',
    status: 'succeeded', currency: 'usd', amount: 299, amount_received: 299 }),
  retrieveInvoice: async () => { throw Error('unused'); }, listInvoiceLines: async () => { throw Error('unused'); },
  retrieveSubscription: async () => { throw Error('unused'); },
};
let lost = false;
const payments = createMembershipPaymentAdapter({ stripe, bindings, accountId, livemode: false, priceMap,
  fulfill: async (kind, input) => { const r = await grantMembership(execute, kind, input);
    if (lost) { lost = false; throw Error('committed response lost'); } return r; } });
const fulfillment = createMembershipFulfillment({ stripe, bindings, payments, lifecycle: {}, accountId, livemode: false });
const event = { object: 'event', id: 'evt_fixture', type: 'checkout.session.completed', livemode: false,
  account: accountId, api_version: MEMBERSHIP_STRIPE_API_VERSION, data: { object: { object: 'checkout.session', id: 'cs_fixture' } } };
const rawBody = Buffer.from(JSON.stringify(event));
const signature = `t=${now},v1=${createHmac('sha256', secret).update(now + '.').update(rawBody).digest('hex')}`;
const returned = () => fulfillment.checkoutReturn({ sessionId: 'cs_fixture', owner: 'fixtureOwner' });
const before = JSON.stringify(await execute(['KEYS', '*']));
await rejects(() => fulfillment.checkoutReturn({ sessionId: 'cs_fixture', owner: 'otherOwner' }));
check(JSON.stringify(await execute(['KEYS', '*'])) === before);
await rejects(() => fulfillment.webhook({ rawBody, signature: 'invalid' }));
session.status = 'open'; session.payment_status = 'unpaid';
check((await returned()).status === 'pending');
check(JSON.stringify(await execute(['KEYS', '*'])) === before);
session.status = 'complete'; session.payment_status = 'paid';
lost = true;
await rejects(returned);
const results = await Promise.all(Array.from({ length: 20 }, (_, i) => i % 2 ? returned()
  : fulfillment.webhook({ rawBody, signature })));
check(results.every(r => r.status === 'fulfilled'));
// All replies contain the same committed business result. Canonical PI identity
// converges on one durable ledger grant despite webhook/return concurrency.
check(results.every(r => r.grant.id_delta === 25 && r.grant.owner === 'fixtureOwner'));
const keys = (await execute(['KEYS', '*'])).sort();
check(await execute(['GET', 'scans:fixtureOwner:id_paid_left']) === '25');
const snapshot = async () => JSON.stringify(await Promise.all(keys.map(async k => [k, await execute(['GET', k])])));
const settled = await snapshot();
await returned(); check(await snapshot() === settled);
session.payment_intent = 'pi_wrong';
await rejects(returned); check(await snapshot() === settled);
console.log(`membership-fulfillment: ${passed} passed, 0 failed`);
process.exit(0);
