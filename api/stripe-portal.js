// /api/stripe-portal — Open Stripe Customer Portal for subscription management
// POST (no body needed)
// Authorization: Bearer <Firebase/Google ID token>  (REQUIRED)
// Returns: { url } — redirect user to this URL to manage/cancel subscription
//
// AUTH: email is derived from the verified token, NEVER from the body.
// Prevents an attacker from opening someone else's Stripe billing portal.

import { verifyTokenFlexible } from './_verifyToken.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── AUTH REQUIRED ──
  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!idToken) return res.status(401).json({ error: 'Authorization token required' });

  let userEmail = '';
  let userSub   = '';
  try {
    const info = await verifyTokenFlexible(idToken);
    userSub   = info?.uid   || '';
    userEmail = info?.email || '';
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // We need EITHER a verified email OR a verified uid to find the Stripe
  // customer. Some legacy tokens (Apple, phone, anonymous) verify OK but
  // have no email claim — in that case we fall back to uid metadata search.
  if ((!userEmail || !userEmail.includes('@')) && !userSub) {
    return res.status(401).json({ error: 'Sign in with Google first.' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(503).json({ error: 'Payments not configured.' });

  const origin     = (req.headers.origin || 'https://www.cardresell.org').replace(/\/$/, '');
  const returnUrl  = `${origin}/`;

  // Find the Stripe customer. Try in order until one matches:
  //   1. Customers with email == userEmail (fast path when email is present)
  //   2. Subscriptions with metadata['google_sub'] == userSub, then read
  //      their customer id (catches users whose Stripe email doesn't match
  //      their current Firebase email — e.g. after email change — or whose
  //      Firebase token has no email claim at all)
  //
  // We NEVER trust body.email or body.userId here — both userEmail and
  // userSub come from the verified token above, so this stays secure.
  async function stripeGet(path) {
    return fetch(`https://api.stripe.com/v1/${path}`, {
      headers: { 'Authorization': `Bearer ${stripeKey}` },
    });
  }

  try {
    let customer = null;

    // 1. Email search
    if (userEmail && userEmail.includes('@')) {
      const r = await stripeGet(`customers/search?query=email:'${encodeURIComponent(userEmail)}'&limit=1`);
      const d = await r.json();
      customer = d.data?.[0] || null;
    }

    // 2. Subscription metadata search on google_sub
    // Stripe's search index takes 1–10s to include new records, so this
    // works for anyone whose subscription is at least a few seconds old.
    if (!customer && userSub) {
      const r = await stripeGet(`subscriptions/search?query=metadata['google_sub']:'${encodeURIComponent(userSub)}'&limit=1`);
      const d = await r.json();
      const subCustomerId = d.data?.[0]?.customer;
      if (subCustomerId) {
        const cr = await stripeGet(`customers/${encodeURIComponent(subCustomerId)}`);
        if (cr.ok) customer = await cr.json();
      }
    }

    if (!customer) {
      return res.status(404).json({ error: 'No subscription found for this account.' });
    }

    // Create a billing portal session
    const portalParams = new URLSearchParams({
      customer:   customer.id,
      return_url: returnUrl,
    });

    const portalRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: portalParams.toString(),
    });

    if (!portalRes.ok) {
      const err = await portalRes.json();
      console.error('Portal error:', err);
      return res.status(502).json({ error: err.error?.message || 'Could not open billing portal.' });
    }

    const portal = await portalRes.json();
    return res.status(200).json({ url: portal.url });
  } catch(e) {
    console.error('Portal exception:', e);
    return res.status(500).json({ error: 'Could not open billing portal.' });
  }
}
