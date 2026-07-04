// /api/stripe-checkout — Create Stripe Checkout for Pro subscription ($4.99/mo)
// POST body: { email, userId, name? }
// Authorization: Bearer <firebase_or_google_id_token>  (optional — used if present, falls back to body email)

import { verifyTokenFlexible } from './_verifyToken.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();

  let userEmail = body.email || '';
  let userSub   = body.userId || '';
  let userName  = body.name || '';

  // Try to verify via Firebase or Google token if present — but fall back to body email if token is expired
  if (idToken && idToken.length > 20) {
    try {
      const info = await verifyTokenFlexible(idToken);
      // Trust the verified uid even when email is empty (legacy Google-linked
      // Firebase accounts can be missing top-level email but still have a valid uid).
      if (info.uid)   userSub   = info.uid;
      if (info.email) userEmail = info.email;
      if (info.name)  userName  = info.name;
      // If token is expired or invalid, we still continue with body email below
    } catch(e) { /* non-blocking — fall through to body email */ }
  }

  // Must have an email to create a checkout session
  if (!userEmail || !userEmail.includes('@')) {
    return res.status(401).json({ error: 'Sign in with Google first.' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const priceId   = process.env.STRIPE_PRICE_ID;
  if (!stripeKey || !priceId) return res.status(503).json({ error: 'Payments not configured yet.' });

  const origin  = (req.headers.origin || 'https://www.cardresell.org').replace(/\/$/, '');
  const success = `${origin}/?pro=1`;
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
      'subscription_data[metadata][google_sub]': userSub,
    });

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString(),
    });

    if (!stripeRes.ok) {
      const err = await stripeRes.json();
      console.error('Stripe error:', err);
      return res.status(502).json({ error: err.error?.message || 'Payment setup failed.' });
    }
    const session = await stripeRes.json();
    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch(e) {
    console.error('Checkout exception:', e);
    return res.status(500).json({ error: 'Could not create checkout session.' });
  }
}
