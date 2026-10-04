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
import { createMembershipBootstrap, membershipBootstrapAuditKey } from './_membershipBootstrap.js';
import { membershipEnvironment } from './_membershipEnvironment.js';
import { createMembershipEnrollmentProvisioner } from './_membershipEnrollmentProvisioner.js';
import { createMembershipEnrollmentFlow } from './_membershipEnrollmentFlow.js';
import { readOwnerImport } from './_membershipOwnerImport.js';
import { createMembershipOwnerMigration } from './_membershipOwnerMigration.js';
import { createMembershipOwnerLifecycle } from './_membershipOwnerLifecycle.js';
import { LEGACY_DISCOUNT_PLAN } from './_membershipLegacyPlans.js';
import { membershipEnrollmentKey } from './_membershipConsumption.js';
import { readMembershipVerification } from './_membershipVerification.js';
import { membershipPreviewAuthDiagnostics } from './_membershipPreviewAuthDiagnostics.js';

export function membershipSubscriptionAdmission(owner, enrollment, state, importedOwner = false) {
  if (enrollment?.version !== 'launch-v2' || enrollment.owner !== owner || enrollment.verified !== true
    || !['free', 'paid'].includes(enrollment.plan)) throw Error('enrollment_unavailable');
  if (enrollment.plan === 'paid' && (!state.subscriptionId || state.subscriptionId !== enrollment.subscription)) {
    throw Error('subscription_authority_missing');
  }
  return !importedOwner && enrollment.plan === 'free' && !state.subscriptionId;
}

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
export async function membershipPurchaseRuntime() {
  if (process.env.MEMBERSHIP_CUTOVER_PAUSED === 'enabled') throw Error('membership_cutover_paused');
  const livemode = process.env.VERCEL_ENV === 'production';
  const purchaseEnabled = process.env[livemode ? 'MEMBERSHIP_PURCHASE_LIVE_MODE' : 'MEMBERSHIP_PURCHASE_TEST_MODE'] === 'enabled';
  if (!purchaseEnabled && !(livemode && process.env.MEMBERSHIP_SERVICING_LIVE_MODE === 'enabled')) {
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
  const audience = process.env.MEMBERSHIP_LIVE_AUDIENCE || 'owner';
  if (livemode && !['owner', 'public'].includes(audience)) throw Error('invalid_live_audience');
  const publicLaunch = livemode && audience === 'public';
  const reservedOwner = livemode ? allowed[0] : null;
  const imported = allowed.length === 1 ? await readOwnerImport(membershipRedis, accountId, livemode, allowed[0]) : null;
  const customerStripe = createMembershipCustomerStripe({ apiKey, accountId, reader, returnOrigin, livemode, portalConfiguration });
  const customerStore = createMembershipCustomers({ execute: membershipRedis, stripe: customerStripe,
    accountId, livemode, allowCreate: async owner => {
      if (owner === reservedOwner || owner === imported?.authorization.owner) return false;
      if (!publicLaunch && !allowed.includes(owner)) return false;
      if (!livemode) return true;
      const [e, audit] = await Promise.all([membershipEnrollmentKey(owner), membershipBootstrapAuditKey(owner)]
        .map(async key => JSON.parse(await membershipRedis(['GET', key]))));
      return e?.owner === owner && e.verified === true && e.plan === 'free'
        && audit?.owner === owner && audit.accountId === accountId && audit.livemode === true;
    },
    authorizeExisting: async owner => {
      if (owner !== imported?.authorization.owner) throw Error('existing_binding_not_authorized');
      return { owner, accountId, livemode, customerId: imported.authorization.customerId,
        evidenceId: imported.digest, approvedAt: imported.data.importedAt * 1000 };
    } });
  const customers = { ...customerStore, ensure: owner => owner === imported?.authorization.owner
    ? customerStore.bindAuditedExisting(owner) : customerStore.ensure(owner) };
  const provisionEnrollment = createMembershipEnrollmentProvisioner({
    execute: membershipRedis, accountId, environment: process.env.VERCEL_ENV, allowedOwners: allowed, livemode,
    allowNewOwners: publicLaunch,
  });
  const auditedBootstrap = createMembershipBootstrap({ execute: membershipRedis, accountId, livemode });
  const freeBootstrap = createMembershipEnrollmentFlow({ execute: membershipRedis,
    provision: provisionEnrollment, bootstrap: auditedBootstrap, issueFree: issueMembershipFree });
  const bootstrap = async (owner, identity) => {
    if (owner === reservedOwner && !imported) throw Error('owner_import_required');
    if (owner !== imported?.authorization.owner) return freeBootstrap(owner, identity);
    if (identity?.uid !== owner || identity.verified !== true) throw Error('authentication_required');
    await membershipBalances(owner); // Imported authority must be usable; never issue another welcome award.
    return { status: 'paid_preserved' };
  };
  const legacySubscription = imported ? Object.fromEntries(['owner', 'customerId', 'subscriptionId',
    'priceId', 'productId', 'periodStart', 'periodEnd'].map(k => [k, imported.authorization[k]])) : null;
  const commands = createMembershipLifecycleStripe({ execute: membershipRedis, reader, apiKey, accountId, priceMap, livemode, legacySubscription });
  const reversals = createMembershipReversalStripe({ apiKey, accountId, bindings, customers, livemode,
    getAuditedSubscriptionOwner: async input => {
      if (!imported || input.subscriptionId !== imported.authorization.subscriptionId) return null;
      if (input.customerId !== imported.authorization.customerId) throw Error('owner_mismatch');
      return { ...input, owner: imported.authorization.owner, evidenceId: imported.digest };
    } });
  const stripe = { ...reader, ...commands, ...reversals };
  const payments = createMembershipPaymentAdapter({ stripe, bindings, accountId, livemode, priceMap,
    fulfill: async (kind, envelope) => {
      if (kind === 'period') await issueMembershipFree(envelope.owner);
      const result = await grantMembership(membershipRedis, kind, envelope);
      if (kind === 'period') await reconcilePaidEnrollment(membershipRedis, envelope.owner, envelope.subscriptionId);
      return result;
    } });
  const normalLifecycle = createMembershipLifecycle({ execute: membershipRedis, customers, bindings, stripe,
    payments, priceMap, accountId, livemode });
  const migration = imported ? createMembershipOwnerMigration({ execute: membershipRedis, accountId, livemode,
    authorization: imported.authorization, customers, stripe, priceMap,
    fulfill: async (kind, envelope) => {
      const result = await grantMembership(membershipRedis, kind, envelope);
      if (kind === 'period') await reconcilePaidEnrollment(membershipRedis, envelope.owner, envelope.subscriptionId);
      return result;
    } }) : null;
  const lifecycle = imported ? createMembershipOwnerLifecycle({ normal: normalLifecycle, imported,
    customers, stripe, migration, execute: membershipRedis }) : normalLifecycle;
  const fulfillment = createMembershipFulfillment({ stripe, bindings, payments, lifecycle, accountId, livemode });
  const authDiagnostic = membershipPreviewAuthDiagnostics(process.env);
  const normalAuthenticate = createMembershipAuthenticator({
    onDiagnostic: authDiagnostic,
    resolveVerification: uid => readMembershipVerification(membershipRedis, uid, Date.now(), authDiagnostic),
  });
  const authenticate = async token => {
    const identity = await normalAuthenticate(token);
    if (livemode && !publicLaunch && !allowed.includes(identity.uid)) {
      console.warn('MEMBERSHIP_AUTH_REJECTED', 'owner_not_allowed');
      throw Object.assign(Error('authentication_required'), { code: 'authentication_required' });
    }
    if (!livemode) authDiagnostic('preview_identity_authorized');
    return identity;
  };
  const resolveContext = async owner => {
    const customer = await customers.get(owner);
    if (customer?.state !== 'bound') throw new Error('customer_association_required');
    const state = await lifecycle.get({ owner });
    // Even a first purchase requires an audited, usable consumption authority.
    // An allowlisted customer is not itself evidence of completed enrollment.
    const balance = await membershipBalances(owner);
    const legacyOwner = owner === imported?.authorization.owner;
    const enrollment = JSON.parse(await membershipRedis(['GET', membershipEnrollmentKey(owner)]));
    const admitted = membershipSubscriptionAdmission(owner, enrollment, state, legacyOwner);
    if (!Object.hasOwn(LAUNCH_PLANS, balance.tier) && !(legacyOwner && balance.tier === imported.data.legacyPlan)) throw new Error('benefits_unavailable');
    let plan = 'free';
    if (state.subscriptionId) {
      // Only the paid ledger, never an active-looking Stripe snapshot, grants
      // commercial benefits. Unavailable authority disables checkout.
      plan = legacyOwner && balance.tier === imported.data.legacyPlan
        ? LEGACY_DISCOUNT_PLAN[imported.data.legacyTier] : balance.tier;
    }
    return { owner, customerId: customer.customerId, plan,
      newSubscriptionAllowed: admitted && (publicLaunch || allowed.includes(owner)) };
  };
  const controller = createMembershipCheckoutController({ execute: membershipRedis, bindings,
    authenticate, resolveContext, stripe: { ...reader, ...writer }, accountId, livemode,
    allowNewPurchases: purchaseEnabled });
  const purchases = createMembershipPurchaseRoutes({ authenticate, resolveContext, controller, purchaseEnabled });
  return { ...purchases,
    ...createMembershipAccountRoutes({ authenticate, customers, lifecycle, fulfillment, commands,
      balances: membershipBalances, portal: customerStripe.createPortal, bootstrap, scheduleChanges: false }) };
}
