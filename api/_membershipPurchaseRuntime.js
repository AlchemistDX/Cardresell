// Test-mode-only composition until real normal-site acceptance passes.
// No fallback to legacy secrets, prices, email search or client tier claims.
import { createHash } from 'node:crypto';
import { verifyTokenFlexible } from './_verifyToken.js';
import { membershipRedis } from './_membershipLegacyFence.js';
import { createMembershipBindingStore } from './_membershipBindings.js';
import { createMembershipCheckoutController } from './_membershipCheckout.js';
import { createMembershipCheckoutStripeTransport } from './_membershipCheckoutStripe.js';
import { createMembershipStripeTransport, MEMBERSHIP_STRIPE_API_VERSION } from './_membershipStripe.js';
import { createMembershipPurchaseRoutes } from './_membershipPurchaseRoutes.js';
import { LAUNCH_PLANS } from './_launchMembershipConfig.js';
import { createMembershipCustomers } from './_membershipCustomer.js';
import { createMembershipCustomerStripe } from './_membershipCustomerStripe.js';
import { createMembershipLifecycleStripe } from './_membershipLifecycleStripe.js';
import { createMembershipLifecycle } from './_membershipLifecycle.js';
import { createMembershipPaymentAdapter } from './_membershipPayments.js';
import { createMembershipFulfillment } from './_membershipFulfillment.js';
import { createMembershipAccountRoutes } from './_membershipAccountRoutes.js';
import { grantMembership } from './_membershipLedger.js';
import { membershipBalances } from './_membershipRouteBilling.js';
import { reconcilePaidEnrollment } from './_membershipPaidEnrollment.js';
import { createMembershipReversalStripe } from './_membershipReversalStripe.js';

export function purchaseContextKey(accountId, owner) {
  return 'membership:launch-v2:purchase_context:' +
    createHash('sha256').update(JSON.stringify([accountId, false, owner])).digest('hex');
}
export function createPurchaseContextResolver({ execute, accountId, now = Date.now }) {
  return async owner => {
    const raw = await execute(['GET', purchaseContextKey(accountId, owner)]);
    let record;
    try { record = JSON.parse(raw); } catch { throw new Error('context_unavailable'); }
    if (!record || record.version !== 'launch-v2' || record.owner !== owner
      || record.accountId !== accountId || record.livemode !== false || record.ready !== true
      || !/^cus_[A-Za-z0-9_]+$/.test(record.customerId)
      || !Object.hasOwn(LAUNCH_PLANS, record.plan)
      || !Number.isSafeInteger(record.validUntil) || record.validUntil <= now()
      || typeof record.newSubscriptionAllowed !== 'boolean'
      || (record.newSubscriptionAllowed && (record.plan !== 'free' || record.subscriptionId !== null))) {
      throw new Error('context_unavailable');
    }
    return { owner, customerId: record.customerId, plan: record.plan,
      newSubscriptionAllowed: record.newSubscriptionAllowed };
  };
}
export function membershipPurchaseRuntime() {
  if (process.env.MEMBERSHIP_PURCHASE_TEST_MODE !== 'enabled'
    || process.env.VERCEL_ENV === 'production') throw new Error('purchase_disabled');
  const apiKey = process.env.MEMBERSHIP_STRIPE_TEST_KEY;
  const accountId = process.env.MEMBERSHIP_STRIPE_TEST_ACCOUNT;
  const priceMap = JSON.parse(process.env.MEMBERSHIP_STRIPE_TEST_PRICES || 'null');
  const couponMap = JSON.parse(process.env.MEMBERSHIP_STRIPE_TEST_COUPONS || 'null');
  const webhookSecret = process.env.MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET;
  const base = { apiKey, accountId, livemode: false, apiVersion: MEMBERSHIP_STRIPE_API_VERSION };
  const bindings = createMembershipBindingStore({ execute: membershipRedis, accountId, livemode: false, priceMap });
  const reader = createMembershipStripeTransport({ ...base, webhookSecret });
  const returnOrigin = process.env.MEMBERSHIP_STRIPE_TEST_RETURN_ORIGIN;
  if (!returnOrigin || ['https://www.cardresell.org', 'https://cardresell.org'].includes(returnOrigin)) {
    throw new Error('test_preview_origin_required');
  }
  const writer = createMembershipCheckoutStripeTransport({ ...base, bindings, priceMap, couponMap, returnOrigin });
  const allowed = JSON.parse(process.env.MEMBERSHIP_TEST_NEW_CUSTOMER_OWNERS || '[]');
  if (!Array.isArray(allowed) || allowed.some(x => typeof x !== 'string' || !x)) throw new Error('test_owners_invalid');
  const customerStripe = createMembershipCustomerStripe({ apiKey, accountId, reader, returnOrigin,
    portalConfiguration: process.env.MEMBERSHIP_STRIPE_TEST_PORTAL_CONFIGURATION });
  const customers = createMembershipCustomers({ execute: membershipRedis, stripe: customerStripe,
    accountId, livemode: false, allowCreate: async owner => allowed.includes(owner) });
  const commands = createMembershipLifecycleStripe({ execute: membershipRedis, reader, apiKey, accountId, priceMap });
  const reversals = createMembershipReversalStripe({ apiKey, accountId, bindings, customers });
  const stripe = { ...reader, ...commands, ...reversals };
  const payments = createMembershipPaymentAdapter({ stripe, bindings, accountId, livemode: false, priceMap,
    fulfill: async (kind, envelope) => {
      const result = await grantMembership(membershipRedis, kind, envelope);
      if (kind === 'period') await reconcilePaidEnrollment(membershipRedis, envelope.owner, envelope.subscriptionId);
      return result;
    } });
  const lifecycle = createMembershipLifecycle({ execute: membershipRedis, customers, bindings, stripe,
    payments, priceMap, accountId, livemode: false });
  const fulfillment = createMembershipFulfillment({ stripe, bindings, payments, lifecycle, accountId, livemode: false });
  const authenticate = async token => {
    try {
      const user = await verifyTokenFlexible(token);
      if (!user?.uid) throw new Error();
      return { uid: user.uid, verified: true };
    } catch { throw Object.assign(new Error('authentication_required'), { code: 'authentication_required' }); }
  };
  const resolveContext = async owner => {
    const customer = await customers.get(owner);
    if (customer?.state !== 'bound') throw new Error('customer_association_required');
    const state = await lifecycle.get({ owner });
    // Even a first purchase requires an audited, usable consumption authority.
    // An allowlisted customer is not itself evidence of completed enrollment.
    const balance = await membershipBalances(owner);
    if (!Object.hasOwn(LAUNCH_PLANS, balance.tier)) throw new Error('benefits_unavailable');
    let plan = 'free';
    if (state.subscriptionId) {
      // Only the paid ledger, never an active-looking Stripe snapshot, grants
      // commercial benefits. Unavailable authority disables checkout.
      plan = balance.tier;
    }
    return { owner, customerId: customer.customerId, plan,
      newSubscriptionAllowed: !state.subscriptionId && allowed.includes(owner) };
  };
  const controller = createMembershipCheckoutController({ execute: membershipRedis, bindings,
    authenticate, resolveContext, stripe: { ...reader, ...writer }, accountId, livemode: false });
  return { ...createMembershipPurchaseRoutes({ authenticate, resolveContext, controller }),
    ...createMembershipAccountRoutes({ authenticate, customers, lifecycle, fulfillment, commands,
      balances: membershipBalances, portal: customerStripe.createPortal, scheduleChanges: false }) };
}
