import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { redisCommand as execute } from '../tests/_idRedis.mjs';
import { createMembershipBindingStore } from '../api/_membershipBindings.js';
import { createMembershipPaymentAdapter } from '../api/_membershipPayments.js';
import { grantMembership } from '../api/_membershipLedger.js';
import { LAUNCH_PLANS, LAUNCH_PACKS } from '../api/_launchMembershipConfig.js';
import { repairOwnerPaidBinding, OWNER_PAID_CHECKOUT as e } from './reconcile-owner-paid-checkout.mjs';
const canonical = v => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const sha = x => createHash('sha256').update(x).digest('hex');
const priceMap = { packs: {}, plans: {} };
for (const [group, catalogue] of [['packs', LAUNCH_PACKS], ['plans', LAUNCH_PLANS]]) {
  for (const name of Object.keys(catalogue).filter(x => x !== 'free')) {
    priceMap[group][name] = { priceId: `price_${group}_${name}`, productId: `prod_${group}_${name}` };
  }
}
const bindings = createMembershipBindingStore({ execute, accountId: e.accountId, livemode: true, priceMap });
let passed = 0;
const check = (name, value) => { assert.ok(value, name); console.log('PASS ' + name); passed++; };
const scope = canonical({ accountId: e.accountId, livemode: true });
const keys = [`membership:launch-v2:bindings:settlement:${e.intentId}`,
  `membership:launch-v2:bindings:payment_map:${sha(`${scope}:${e.paymentId}`)}`];
const snapshot = async () => JSON.stringify(await Promise.all((await execute(['KEYS', '*'])).sort()
  .map(async k => [k, await execute(['GET', k])]))); // private process-owned Redis
async function fixture() {
  await execute(['FLUSHDB']);
  const order = await bindings.createIntent({ intentId: e.intentId, kind: 'pack', owner: e.owner,
    customerId: e.customerId, plan: 'business', packId: 'id_25' });
  await bindings.bindSession({ intentId: e.intentId, sessionId: e.sessionId });
  await bindings.bindSettlement({ intentId: e.intentId, sessionId: e.sessionId, paymentId: e.paymentId });
  const originals = await Promise.all(keys.map(k => execute(['GET', k])));
  for (const [i, key] of keys.entries()) {
    const r = JSON.parse(originals[i]); delete r.data.subscriptionId;
    await execute(['SET', key, JSON.stringify(r)]);
  }
  const session = { object: 'checkout.session', id: e.sessionId, livemode: true, customer: e.customerId,
    client_reference_id: e.intentId, status: 'complete', payment_status: 'paid', mode: 'payment',
    subscription: null, payment_intent: e.paymentId, amount_total: 224, amount_subtotal: 299, currency: 'usd',
    total_details: { amount_discount: 75, amount_tax: 0, amount_shipping: 0 } };
  const stripe = {
    retrieveAccount: async () => ({ id: e.accountId, object: 'account' }),
    retrieveCheckoutSession: async () => structuredClone(session),
    retrievePaymentIntent: async () => ({ object: 'payment_intent', id: e.paymentId, livemode: true,
      customer: e.customerId, status: 'succeeded', currency: 'usd', amount: 224, amount_received: 224 }),
    retrievePrice: async () => ({ object: 'price', id: order.priceId, product: order.productId,
      livemode: true, unit_amount: 299, currency: 'usd', type: 'one_time', recurring: null }),
    listCheckoutLineItems: async () => ({ object: 'list', has_more: false, data: [{ quantity: 1,
      currency: 'usd', amount_subtotal: 299, amount_total: 224, price: order.priceId }] }),
    retrieveInvoice: async () => null, listInvoiceLines: async () => null,
    retrieveSubscription: async () => null, verifyWebhook: async () => null,
  };
  return { originals, stripe, args: { execute, bindings, stripe, now: () => 1791030000000 } };
}
const f = await fixture();
await assert.rejects(() => bindings.getCheckoutOrder(e.sessionId));
check('Original dropped-null failure reproduced', true);
check('Proved records repaired with audit', (await repairOwnerPaidBinding(f.args)).auditPreserved);
check('Exact original signed records restored', (await Promise.all(keys.map(k => execute(['GET', k]))))
  .every((raw, i) => canonical(JSON.parse(raw)) === canonical(JSON.parse(f.originals[i]))));
check('Normal binding verifier accepts restored records', (await bindings.getCheckoutOrder(e.sessionId)).paymentId === e.paymentId);
const audit = (await execute(['KEYS', 'membership:launch-v2:repair:*']))[0];
const auditValue = JSON.parse(await execute(['GET', audit]));
check('Audit retains before and after bytes', auditValue.records.every(r =>
  !Object.hasOwn(JSON.parse(r.before).data, 'subscriptionId') && JSON.parse(r.after).data.subscriptionId === null));
const once = await snapshot();
check('Repair replay does not rewrite records or audit', (await repairOwnerPaidBinding(f.args)).alreadyValid && await snapshot() === once);
await execute(['MSET', `scans:${e.owner}:id_paid_left`, '928', `scans:${e.owner}:paid_left`, '991']);
const payments = createMembershipPaymentAdapter({ stripe: f.stripe, bindings, accountId: e.accountId,
  livemode: true, priceMap, fulfill: (kind, value) => grantMembership(execute, kind, value) });
await payments.checkoutReturn({ sessionId: e.sessionId, authenticatedOwner: e.owner });
const granted = await snapshot();
await payments.checkoutReturn({ sessionId: e.sessionId, authenticatedOwner: e.owner });
check('Canonical verifier grants 25 ID exactly once', await execute(['GET', `scans:${e.owner}:id_paid_left`]) === '953' && await snapshot() === granted);
check('Grade standing balance preserved', await execute(['GET', `scans:${e.owner}:paid_left`]) === '991');
for (const [name, change] of [
  ['wrong account', f => { f.stripe.retrieveAccount = async () => ({ id: 'acct_other' }); }],
  ['unpaid session', f => { const read = f.stripe.retrieveCheckoutSession; f.stripe.retrieveCheckoutSession = async () => ({ ...await read(), payment_status: 'unpaid' }); }],
  ['wrong customer', f => { const read = f.stripe.retrievePaymentIntent; f.stripe.retrievePaymentIntent = async () => ({ ...await read(), customer: 'cus_other' }); }],
  ['wrong amount', f => { const read = f.stripe.retrievePaymentIntent; f.stripe.retrievePaymentIntent = async () => ({ ...await read(), amount_received: 223 }); }],
]) {
  const g = await fixture(); change(g); const before = await snapshot();
  await assert.rejects(() => repairOwnerPaidBinding(g.args));
  check(name + ' cannot mutate any record', await snapshot() === before);
}
const g = await fixture();
const damaged = JSON.parse(await execute(['GET', keys[0]])); damaged.data.owner = 'different';
await execute(['SET', keys[0], JSON.stringify(damaged)]);
const before = await snapshot();
await assert.rejects(() => repairOwnerPaidBinding(g.args));
check('Damage beyond proven null loss cannot be repaired', await snapshot() === before);
console.log(`${passed} passed, 0 failed`);
process.exit(0); // private Redis child is cleaned by the fixture's exit hook
