// Bounded operator remedy for the observed Oct 2 discounted Checkout rejection.
// Not a route, normal build task, auth harness, new order, or financial grant.
// Same saved Stripe key only, within 23h of its original claim (Stripe retains
// idempotent results >=24h). Discovery first. Never reset or replace a claim.
import { createHash } from 'node:crypto';
const canonical = value => JSON.stringify(value, (_, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const sha = value => createHash('sha256').update(value).digest('hex');
const insist = (v, code) => { if (!v) throw Error(code); };
export async function recoverOwnerCheckout({ raw, owner, accountId, expectedCreatedAt, bindings, stripe, now }) {
  const sealed = JSON.parse(raw), r = sealed?.data;
  insist(r && sealed.hash === sha(canonical(r)) && r.version === 'launch-v2'
    && r.owner === owner && r.accountId === accountId && r.livemode === true
    && r.kind === 'pack' && r.selection === 'id_25' && r.state === 'creation_claimed'
    && r.createdAt === expectedCreatedAt && Number.isSafeInteger(r.claimedAt)
    && r.claimedAt >= r.createdAt && r.input?.owner === owner && r.input.kind === 'pack'
    && r.input.packId === 'id_25', 'owner_checkout_evidence_mismatch');
  const order = await bindings.getIntent(r.input.intentId);
  insist(order.owner === owner && order.accountId === accountId && order.livemode === true
    && order.kind === 'pack' && order.packId === 'id_25' && order.amountCents === 224
    && order.customerId === r.input.customerId && order.intentId === r.input.intentId
    && order.stripeIdempotencyKey === `membership-launch-v2-${order.intentId}`,
  'owner_checkout_order_mismatch');
  const found = await stripe.recoverCheckout(order);
  let sessionId = found;
  if (!sessionId) {
    const time = await now();
    insist(Number.isSafeInteger(time) && time >= r.claimedAt && time - r.createdAt < 23 * 60 * 60 * 1000,
      'idempotency_recovery_window_closed');
    // Retry the same provider business operation, never a fresh key. Stripe
    // rejects changed parameters if a previous execution was already stored.
    const created = await stripe.createCheckout(order);
    sessionId = created.id;
  }
  const s = await stripe.retrieveCheckoutSession(sessionId);
  insist(s.object === 'checkout.session' && s.id === sessionId && s.livemode === true
    && s.customer === order.customerId && s.client_reference_id === order.intentId
    && s.mode === 'payment' && s.status === 'open' && s.payment_status === 'unpaid'
    && s.amount_total === 224 && s.amount_subtotal === 299 && s.currency === 'usd'
    && s.total_details?.amount_discount === 75 && s.total_details.amount_tax === 0
    && s.total_details.amount_shipping === 0, 'owner_checkout_readback_mismatch');
  return { status: 'checkout_ready', sessionId, amountCents: 224,
    recoveredExisting: !!found, paymentSubmitted: false, creditsGranted: false, ledgerMutated: false };
}
