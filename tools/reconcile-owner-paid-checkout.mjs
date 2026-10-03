// Single observed owner payment. No charge, customer, subscription, or balance
// editing. Repair only a dropped null whose restoration proves the saved hash,
// then use the unchanged canonical payment verifier and exactly-once ledger.
import { createHash } from 'node:crypto';
import { createMembershipBindingStore } from '../api/_membershipBindings.js';
import { createMembershipStripeTransport, MEMBERSHIP_STRIPE_API_VERSION } from '../api/_membershipStripe.js';
import { createMembershipPaymentAdapter } from '../api/_membershipPayments.js';
import { createMembershipFulfillment } from '../api/_membershipFulfillment.js';
import { grantMembership } from '../api/_membershipLedger.js';
import { createMembershipConsumption } from '../api/_membershipConsumption.js';
const canonical = v => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const sha = v => createHash('sha256').update(v).digest('hex');
const insist = (v, code) => { if (!v) throw Error(code); };
export const OWNER_PAID_CHECKOUT = Object.freeze({
  owner: 'fzUpcrXKDdQzGORl0bLQ6mTwML73', accountId: 'acct_1Tno55FW2YZoedIZ',
  customerId: 'cus_UqILx52TtoCldY',
  sessionId: 'cs_live_a1mAUM0XNbKZScLoCwVcBaKlwDkPSTsRXTxntchUiar4MjmkK3CvLFGe1R',
  paymentId: 'pi_3UMGk4FW2YZoedIZ0bXziQGl',
  intentId: 'ae8adb21480d6492af94cbc9893f4642ec54188942a80f57e3f36b1a20de408b',
});
const REPAIR = `
if redis.call('GET',KEYS[1])~=ARGV[1] or redis.call('GET',KEYS[2])~=ARGV[2]
 or redis.call('EXISTS',KEYS[3])==1 then return 0 end
redis.call('MSET',KEYS[1],ARGV[3],KEYS[2],ARGV[4],KEYS[3],ARGV[5])
return 1`;
export async function repairOwnerPaidBinding({ execute, bindings, stripe, expected = OWNER_PAID_CHECKOUT, now = Date.now }) {
  const e = expected;
  const account = await stripe.retrieveAccount();
  insist(account.id === e.accountId, 'account_mismatch');
  const session = await stripe.retrieveCheckoutSession(e.sessionId);
  insist(session.object === 'checkout.session' && session.id === e.sessionId && session.livemode === true
    && session.customer === e.customerId && session.client_reference_id === e.intentId
    && session.status === 'complete' && session.payment_status === 'paid' && session.mode === 'payment'
    && session.subscription === null && session.payment_intent === e.paymentId
    && session.amount_total === 224 && session.amount_subtotal === 299 && session.currency === 'usd'
    && session.total_details?.amount_discount === 75 && session.total_details.amount_tax === 0
    && session.total_details.amount_shipping === 0, 'paid_session_mismatch');
  const order = await bindings.getIntent(e.intentId);
  insist(order.owner === e.owner && order.accountId === e.accountId && order.customerId === e.customerId
    && order.livemode === true && order.intentId === e.intentId && order.kind === 'pack'
    && order.packId === 'id_25' && order.amountCents === 224 && order.currency === 'usd'
    && order.quantity === 1, 'paid_order_mismatch');
  const payment = await stripe.retrievePaymentIntent(e.paymentId);
  insist(payment.object === 'payment_intent' && payment.id === e.paymentId && payment.livemode === true
    && payment.customer === e.customerId && payment.status === 'succeeded' && payment.currency === 'usd'
    && payment.amount === 224 && payment.amount_received === 224, 'paid_payment_mismatch');
  const price = await stripe.retrievePrice(order.priceId);
  const lines = await stripe.listCheckoutLineItems(e.sessionId);
  const line = lines?.data?.[0];
  insist(price.id === order.priceId && price.livemode === true && price.product === order.productId
    && price.unit_amount === 299 && price.currency === 'usd' && price.type === 'one_time'
    && price.recurring === null && lines.object === 'list' && lines.has_more === false
    && lines.data.length === 1 && line.quantity === 1 && line.currency === 'usd'
    && line.amount_subtotal === 299 && line.amount_total === 224
    && (typeof line.price === 'string' ? line.price : line.price?.id) === order.priceId, 'paid_product_mismatch');
  const data = { intentId: e.intentId, orderHash: sha(canonical(order)), owner: e.owner,
    customerId: e.customerId, accountId: e.accountId, livemode: true,
    sessionId: e.sessionId, paymentId: e.paymentId, subscriptionId: null };
  const scope = canonical({ accountId: e.accountId, livemode: true });
  const keys = [`membership:launch-v2:bindings:settlement:${e.intentId}`,
    `membership:launch-v2:bindings:payment_map:${sha(`${scope}:${e.paymentId}`)}`];
  const before = await Promise.all(keys.map(k => execute(['GET', k])));
  const after = ['settlement', 'payment_map'].map((kind, index) => {
    const stored = JSON.parse(before[index]);
    const expectedRecord = { version: 'launch-v2', kind, data, hash: sha(canonical(data)) };
    insist(stored?.hash === expectedRecord.hash, 'unproven_original_hash');
    const restored = structuredClone(stored);
    insist(restored.data?.subscriptionId === null || !Object.hasOwn(restored.data, 'subscriptionId'), 'unexpected_binding_value');
    restored.data.subscriptionId = null;
    insist(canonical(restored) === canonical(expectedRecord), 'unexpected_binding_damage');
    return canonical(expectedRecord);
  });
  if (before.every((raw, i) => canonical(JSON.parse(raw)) === after[i])) return { repaired: false, alreadyValid: true };
  const auditKey = `membership:launch-v2:repair:paid_binding_null:${sha(e.paymentId)}`;
  const audit = canonical({ version: 1, reason: 'proved_dropped_null', observedAt: now(), ...e,
    records: keys.map((key, i) => ({ key, before: before[i], after: after[i] })) });
  const result = await execute(['EVAL', REPAIR, 3, ...keys, auditKey, ...before, ...after, audit]);
  insist(result === 1, 'repair_cas_not_confirmed');
  return { repaired: true, auditPreserved: true };
}
export async function reconcileOwnerPaidCheckout({ execute, config, fetchImpl = fetch }) {
  const e = OWNER_PAID_CHECKOUT;
  insist(config.accountId === e.accountId, 'account_mismatch');
  const bindings = createMembershipBindingStore({ execute, ...config, livemode: true });
  const stripe = createMembershipStripeTransport({ ...config, livemode: true,
    apiVersion: MEMBERSHIP_STRIPE_API_VERSION, fetchImpl });
  const consume = createMembershipConsumption({ execute });
  const balance = async () => {
    const base = { owner: e.owner, receipt: '0'.repeat(64), scan: 'paid-reconciliation-balance' };
    const id = await consume('snapshot', base), grade = await consume('snapshot', { ...base, mode: 'grade' });
    return { id: id.remaining, grade: grade.remaining };
  };
  const before = await balance();
  const repair = await repairOwnerPaidBinding({ execute, bindings, stripe });
  const payments = createMembershipPaymentAdapter({ stripe, bindings, ...config, livemode: true,
    fulfill: (kind, envelope) => grantMembership(execute, kind, envelope) });
  const fulfillment = createMembershipFulfillment({ stripe, bindings, payments, ...config, livemode: true });
  const first = await fulfillment.checkoutReturn({ sessionId: e.sessionId, owner: e.owner });
  const after = await balance();
  const replay = await fulfillment.checkoutReturn({ sessionId: e.sessionId, owner: e.owner });
  const afterReplay = await balance();
  insist(first.status === 'fulfilled' && replay.status === 'fulfilled'
    && canonical(after) === canonical(afterReplay), 'fulfillment_not_confirmed');
  return { repair, before, after, afterReplay, fulfillment: first.status, replay: replay.status,
    paymentSubmitted: false, subscriptionChanged: false };
}
