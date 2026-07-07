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

  // We need EITHER a verified email OR a verified uid. The verified uid is
  // sufficient because stripe-checkout writes metadata.google_sub={uid} on every
  // subscription, so we can find the customer by uid without trusting body email.
  if (!userSub && (!userEmail || !userEmail.includes('@'))) {
    return res.status(401).json({ error: 'Sign in with Google first.' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(503).json({ error: 'Payments not configured.' });

  const origin     = (req.headers.origin || 'https://www.cardresell.org').replace(/\/$/, '');
  const returnUrl  = `${origin}/`;

  // Escape single-quotes inside the Stripe search query value.
  const esc = (v) => String(v).replace(/'/g, "\\'");

  try {
    let customer = null;

    // 1) Prefer lookup by verified uid via Stripe customer metadata.google_sub.
    //    stripe-checkout.js writes this on every new subscription, so this is the
    //    strongest signal and avoids any dependence on the token carrying `email`.
    if (userSub) {
      const bySubRes = await fetch(
        `https://api.stripe.com/v1/customers/search?query=metadata['google_sub']:'${encodeURIComponent(esc(userSub))}'&limit=1`,
        { headers: { 'Authorization': `Bearer ${stripeKey}` } }
      );
      const bySubData = await bySubRes.json();
      customer = bySubData.data?.[0] || null;
    }

    // 2) Fallback: look up by verified email (older subscriptions created before
    //    metadata.google_sub was written, or Apple sign-in that carries email).
    if (!customer && userEmail && userEmail.includes('@')) {
      const byEmailRes = await fetch(
        `https://api.stripe.com/v1/customers/search?query=email:'${encodeURIComponent(esc(userEmail))}'&limit=1`,
        { headers: { 'Authorization': `Bearer ${stripeKey}` } }
      );
      const byEmailData = await byEmailRes.json();
      customer = byEmailData.data?.[0] || null;
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
