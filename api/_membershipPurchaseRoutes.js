// Normal HTTP adapters. Dependencies are server-created, never browser-provided.
import { LAUNCH_PLANS, LAUNCH_PACKS, LAUNCH_WELCOME_CREDITS, quoteLaunchPack } from './_launchMembershipConfig.js';

import { membershipVenueAccess } from './_membershipVenuePolicy.js';

export function publicMembershipCatalogue(plan = 'free') {
  if (!Object.hasOwn(LAUNCH_PLANS, plan)) throw new Error('membership_context_unavailable');
  return {
    version: 'launch-v2', currency: 'usd', interval: 'month', creditsExpire: false,
    welcome: LAUNCH_WELCOME_CREDITS,
    plans: Object.entries(LAUNCH_PLANS).map(([id, p]) => ({
      id, name: id[0].toUpperCase() + id.slice(1), monthlyPriceCents: p.monthlyPriceCents,
      idCredits: p.idCredits, gradeCredits: p.gradeCredits,
      packDiscountPercent: p.packDiscountPercent, marketplaceCount: membershipVenueAccess(id).count,
    })),
    // Do not advertise unfinished quota/storage features through the shop.
    packs: Object.keys(LAUNCH_PACKS).map(id => quoteLaunchPack(id, plan)),
    currentPlan: plan,
  };
}

export function createMembershipPurchaseRoutes({ authenticate, resolveContext, controller, purchaseEnabled = true }) {
  async function identity(req) {
    const token = (req.headers?.authorization || '').replace(/^Bearer /, '').trim();
    if (!token) throw Object.assign(new Error('authentication_required'), { code: 'authentication_required' });
    const user = await authenticate(token);
    if (!user?.uid || user.verified !== true) throw Object.assign(new Error('authentication_required'), { code: 'authentication_required' });
    return { token, user };
  }
  return {
    async catalogue(req, res) {
      res.setHeader('Cache-Control', 'private, no-store');
      if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
      try {
        if (!req.headers?.authorization) return res.status(200).json(publicMembershipCatalogue());
        const { user } = await identity(req);
        const context = await resolveContext(user.uid);
        if (context?.owner !== user.uid) throw new Error('context_mismatch');
        return res.status(200).json({ ...publicMembershipCatalogue(context.plan),
          purchaseEnabled, newSubscriptionAllowed: purchaseEnabled && context.newSubscriptionAllowed === true });
      } catch (e) {
        const denied = ['authentication_required', 'membership_access_restricted'].includes(e.code);
        return res.status(e.code === 'authentication_required' ? 401 : e.code === 'membership_access_restricted' ? 403 : 503).json({
          error: denied ? e.code : 'membership_context_unavailable',
          ...(e.code === 'authentication_required' && e.action === 'verify_email' ? { action: 'verify_email' } : {}),
        });
      }
    },
    async checkout(req, res) {
      res.setHeader('Cache-Control', 'private, no-store');
      if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
      try {
        const { token } = await identity(req);
        // Exact request shape is enforced again by the reviewed controller.
        // Extra UID/tier/amount/discount/return-URL fields cannot become authority.
        const result = await controller.checkout({ token, request: req.body });
        return res.status(result.status === 'recovery_pending' ? 202 : 200).json(result);
      } catch (e) {
        const code = e.code;
        const status = code === 'authentication_required' ? 401
          : code === 'membership_access_restricted' ? 403 : code === 'invalid_request' ? 400
            : ['request_conflict', 'subscription_in_progress', 'checkout_not_authorized'].includes(code) ? 409 : 503;
        return res.status(status).json({ error: status === 503 ? 'checkout_unavailable' : code,
          ...(status === 401 && e.action === 'verify_email' ? { action: 'verify_email' } : {}) });
      }
    },
  };
}
