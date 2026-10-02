// Explicitly activated, environment-isolated composition.
// No fallback to legacy secrets, prices, email search or client tier claims.
import { createHash } from 'node:crypto';
import { createMembershipAuthenticator } from './_membershipAuthentication.js';
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
import { membershipBalances, issueMembershipFree } from './_membershipRouteBilling.js';
import { reconcilePaidEnrollment } from './_membershipPaidEnrollment.js';
import { createMembershipReversalStripe } from './_membershipReversalStripe.js';
import { createMembershipBootstrap } from './_membershipBootstrap.js';
import { membershipEnvironment } from './_membershipEnvironment.js';
import { createMembershipEnrollmentProvisioner } from './_membershipEnrollmentProvisioner.js';
import { createMembershipEnrollmentFlow } from './_membershipEnrollmentFlow.js';

export function purchaseContextKey(accountId, owner, livemode = false) {
  if (typeof livemode !== 'boolean') throw new Error('context_unavailable');
  return 'membership:launch-v2:purchase_context:' +
    createHash('sha256').update(JSON.stringify([accountId, livemode, owner])).digest('hex');
}
export function createPurchaseContextResolver({ execute, accountId, livemode = false, now = Date.now }) {
  if (typeof livemode !== 'boolean') throw new Error('context_unavailable');
  return async owner => {
    const raw = await execute(['GET', purchaseContextKey(accountId, owner, livemode)]);
    let record;
    try { record = JSON.parse(raw); } catch { throw new Error('context_unavailable'); }
    if (!record || record.version !== 'launch-v2' || record.owner !== owner
      || record.accountId !== accountId || record.livemode !== livemode || record.ready !== true
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
  const livemode = process.env.VERCEL_ENV === 'production';
  if (process.env[livemode ? 'MEMBERSHIP_PURCHASE_LIVE_MODE' : 'MEMBERSHIP_PURCHASE_TEST_MODE'] !== 'enabled') {
    throw new Error('purchase_disabled');
  }
  const { apiKey, accountId, priceMap, couponMap, webhookSecret, returnOrigin, portalConfiguration } =
    membershipEnvironment(process.env, livemode ? 'live' : 'test');
  const base = { apiKey, accountId, livemode, apiVersion: MEMBERSHIP_STRIPE_API_VERSION };
  const bindings = createMembershipBindingStore({ execute: membershipRedis, accountId, livemode, priceMap });
  const reader = createMembershipStripeTransport({ ...base, webhookSecret });
  const writer = createMembershipCheckoutStripeTransport({ ...base, bindings, priceMap, couponMap, returnOrigin });
  const allowed = JSON.parse(process.env[livemode ? 'MEMBERSHIP_LIVE_OWNERS' : 'MEMBERSHIP_TEST_NEW_CUSTOMER_OWNERS'] || '[]');
  if (!Array.isArray(allowed) || allowed.some(x => typeof x !== 'string' || !x)) throw new Error('test_owners_invalid');
  if (livemode && allowed.length !== 1) throw new Error('owner_pilot_required');
  const customerStripe = createMembershipCustomerStripe({ apiKey, accountId, reader, returnOrigin, livemode, portalConfiguration });
  const customers = createMembershipCustomers({ execute: membershipRedis, stripe: customerStripe,
    accountId, livemode, allowCreate: async owner => allowed.includes(owner) });
  const provisionEnrollment = createMembershipEnrollmentProvisioner({
    execute: membershipRedis, accountId, environment: process.env.VERCEL_ENV, allowedOwners: allowed, livemode,
  });
  const auditedBootstrap = createMembershipBootstrap({ execute: membershipRedis, accountId, livemode });
  const bootstrap = createMembershipEnrollmentFlow({ execute: membershipRedis,
    provision: provisionEnrollment, bootstrap: auditedBootstrap, issueFree: issueMembershipFree });
  const commands = createMembershipLifecycleStripe({ execute: membershipRedis, reader, apiKey, accountId, priceMap, livemode });
  const reversals = createMembershipReversalStripe({ apiKey, accountId, bindings, customers, livemode });
  const stripe = { ...reader, ...commands, ...reversals };
  const payments = createMembershipPaymentAdapter({ stripe, bindings, accountId, livemode, priceMap,
    fulfill: async (kind, envelope) => {
      if (kind === 'period') await issueMembershipFree(envelope.owner);
      const result = await grantMembership(membershipRedis, kind, envelope);
      if (kind === 'period') await reconcilePaidEnrollment(membershipRedis, envelope.owner, envelope.subscriptionId);
      return result;
    } });
  const lifecycle = createMembershipLifecycle({ execute: membershipRedis, customers, bindings, stripe,
    payments, priceMap, accountId, livemode });
  const fulfillment = createMembershipFulfillment({ stripe, bindings, payments, lifecycle, accountId, livemode });
  const normalAuthenticate = createMembershipAuthenticator();
  const authenticate = async token => {
    const identity = await normalAuthenticate(token);
    if (livemode && !allowed.includes(identity.uid)) throw Object.assign(Error('authentication_required'), { code: 'authentication_required' });
    return identity;
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
    authenticate, resolveContext, stripe: { ...reader, ...writer }, accountId, livemode });
  return { ...createMembershipPurchaseRoutes({ authenticate, resolveContext, controller }),
    ...createMembershipAccountRoutes({ authenticate, customers, lifecycle, fulfillment, commands,
      balances: membershipBalances, portal: customerStripe.createPortal, bootstrap, scheduleChanges: false }) };
}
