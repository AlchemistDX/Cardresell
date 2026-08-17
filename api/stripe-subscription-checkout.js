// /api/stripe-subscription-checkout — Create Stripe Checkout for any subscription tier
// POST body: { email, userId, name?, tier: 'pro'|'pro_max'|'ultimate', interval: 'month'|'year' }
// Authorization: Bearer <firebase_or_google_id_token>  (optional)
//
// This is the new multi-tier subscription checkout endpoint. The legacy
// /api/stripe-checkout (Pro monthly) and /api/stripe-annual-checkout (Pro
// annual) remain for backwards compat with the existing frontend calls; this
// endpoint powers the new Pro Max + Ultimate purchase flows and any new UI
// that wants a single unified path.

import { verifyTokenFlexible } from './_verifyToken.js';

const TIER_PRICE_ENV = {
  pro: {
    month: 'STRIPE_PRICE_ID',            // legacy env var name for Pro monthly
    year:  'STRIPE_PRICE_ANNUAL_ID',     // legacy env var name for Pro annual
  },
  pro_max: {
    month: 'STRIPE_PRICE_PRO_MAX_MONTHLY',
    year:  'STRIPE_PRICE_PRO_MAX_ANNUAL',
  },
  ultimate: {
    month: 'STRIPE_PRICE_ULTIMATE_MONTHLY',
    year:  'STRIPE_PRICE_ULTIMATE_ANNUAL',
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body    = req.body || {};
  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();

  const tier     = String(body.tier || '').toLowerCase();
  const interval = String(body.interval || 'month').toLowerCase();

  const priceEnv = TIER_PRICE_ENV[tier]?.[interval];
  if (!priceEnv) {
    return res.status(400).json({ error: `Unknown tier/interval combo: ${tier}/${interval}` });
  }

  const priceId   = process.env[priceEnv];
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey || !priceId) {
    return res.status(503).json({ error: 'Payments not configured yet.' });
  }

  let userEmail = body.email || '';
  let userSub   = body.userId || '';
  let userName  = body.name || '';

  if (idToken && idToken.length > 20) {
    try {
      const info = await verifyTokenFlexible(idToken);
      if (info.uid)   userSub   = info.uid;
      if (info.email) userEmail = info.email;
      if (info.name)  userName  = info.name;
    } catch (e) { /* non-blocking */ }
  }

  if (!userEmail || !userEmail.includes('@')) {
    return res.status(401).json({ error: 'Sign in with Google first.' });
  }

  const origin  = (req.headers.origin || 'https://www.cardresell.org').replace(/\/$/, '');
  const success = `${origin}/?upgraded=1&tier=${tier}`;
  const cancel  = `${origin}/`;

  try {
    const params = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      success_url: success,
      cancel_url: cancel,
      customer_email: userEmail,
      'metadata[google_sub]': userSub,
      'metadata[user_name]': userName,
      'metadata[tier]': tier,
      'metadata[interval]': interval,
      'subscription_data[metadata][google_sub]': userSub,
      'subscription_data[metadata][tier]': tier,
      'subscription_data[metadata][interval]': interval,
    });

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!stripeRes.ok) {
      const err = await stripeRes.json().catch(() => ({}));
      console.error('Stripe error:', err);
      return res.status(502).json({ error: err.error?.message || 'Payment setup failed.' });
    }
    const session = await stripeRes.json();
    return res.status(200).json({ url: session.url, sessionId: session.id, tier, interval });
  } catch (e) {
    console.error('Subscription checkout exception:', e);
    return res.status(500).json({ error: 'Could not create checkout session.' });
  }
}
