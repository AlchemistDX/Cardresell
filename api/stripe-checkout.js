// /api/stripe-checkout — Create Stripe Checkout for Pro subscription ($9.99/mo)
// Authorization: Bearer <firebase_or_google_id_token> (required)

import { verifyTokenFlexible } from './_verifyToken.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!idToken || idToken.length < 20) {
    return res.status(401).json({ error: 'Sign in with Google first.' });
  }
  let verified;
  try {
    verified = await verifyTokenFlexible(idToken);
  } catch (e) {
    return res.status(401).json({ error: 'Sign-in expired. Please sign in again.' });
  }
  const userEmail = verified?.email || '';
  const userSub   = verified?.uid || '';
  const userName  = verified?.name || '';

  // Must have an email to create a checkout session
  if (!userSub || !userEmail || !userEmail.includes('@')) {
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
