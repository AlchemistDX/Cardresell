// /api/stripe-annual-checkout — Create Stripe checkout for annual Pro plan ($89.99/yr)
// POST body: { email, userId } — Authorization: Bearer <idToken> (optional, verified if present)
// Returns: { url } — redirect to Stripe checkout
//
// AUTH: prefer verified Firebase/Google token when present, but fall back to body
// email/userId so expired-token users can still check out (matches stripe-checkout.js).

import { verifyTokenFlexible } from './_verifyToken.js';

const ANNUAL_PRICE_ID = 'price_1TosPSFW2YZoedIZ5e0abG3y'; // $89.99/yr

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(503).json({ error: 'Payments not configured' });

  const body = req.body || {};
  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();

  let googleSub = body.userId || body.googleSub || '';
  let email     = body.email  || '';

  // Try token verify (non-blocking) — overwrite with verified values if present
  if (idToken && idToken.length > 20) {
    try {
      const info = await verifyTokenFlexible(idToken);
      if (info?.uid)   googleSub = info.uid;
      if (info?.email) email     = info.email;
    } catch (e) { /* fall through to body values */ }
  }

  if (!email || !email.includes('@')) {
    return res.status(401).json({ error: 'Sign in with Google first.' });
  }

  const origin = req.headers.origin || 'https://www.cardresell.org';

  try {
    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('line_items[0][price]', ANNUAL_PRICE_ID);
    params.append('line_items[0][quantity]', '1');
    params.append('customer_email', email);
    params.append('success_url', `${origin}/?annual_success=1&session_id={CHECKOUT_SESSION_ID}`);
    params.append('cancel_url',  `${origin}/?annual_cancelled=1`);
    params.append('subscription_data[metadata][google_sub]', googleSub);
    params.append('subscription_data[metadata][plan]', 'pro_annual');
    params.append('metadata[google_sub]', googleSub);
    params.append('metadata[type]', 'pro_annual');
    // Show savings vs monthly
    params.append('custom_text[submit][message]', 'Save $30 vs monthly — billed once per year. Cancel anytime.');

    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!r.ok) {
      const err = await r.json();
      console.error('Stripe annual checkout error:', err);
      return res.status(500).json({ error: err?.error?.message || 'Checkout failed' });
    }

    const session = await r.json();
    return res.status(200).json({ url: session.url });
  } catch(e) {
    console.error('stripe-annual-checkout error:', e);
    return res.status(500).json({ error: e.message });
  }
}
