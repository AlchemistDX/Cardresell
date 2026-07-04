// /api/stripe-grade-checkout — One-time purchase of Grade Scan credits
// POST body: { tier: '5' | '20' | '50', email?, userId?, name? }
// Packs: 5 scans $2.49 | 20 scans $7.99 | 50 scans $14.99

import { verifyTokenFlexible } from './_verifyToken.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body    = req.body || {};
  const tier    = String(body.tier || '5'); // '5', '20', '50'
  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();

  let userEmail = body.email  || '';
  let userSub   = body.userId || '';
  let userName  = body.name   || '';

  // Verify Firebase or Google token — falls back to body values if verification fails
  if (idToken && idToken.length > 20) {
    try {
      const info = await verifyTokenFlexible(idToken);
      // Trust the verified uid regardless of whether email came through — legacy
      // Google-linked Firebase accounts can have info.email='' but a valid uid.
      // Losing the uid here means the Stripe webhook has no google_sub and
      // credits never get posted to the account.
      if (info.uid)   userSub   = info.uid;
      if (info.email) userEmail = info.email;
      if (info.name)  userName  = info.name;
    } catch(e) {}
  }

  if (!userEmail || !userEmail.includes('@')) {
    return res.status(401).json({ error: 'Sign in with Google first.' });
  }

  const priceMap = {
    '5':  process.env.STRIPE_GRADE_SCAN_PRICE_5,
    '20': process.env.STRIPE_GRADE_SCAN_PRICE_20,
    '50': process.env.STRIPE_GRADE_SCAN_PRICE_50,
  };
  const labelMap = {
    '5':  '5 Grade Scans — $2.49',
    '20': '20 Grade Scans — $7.99',
    '50': '50 Grade Scans — $14.99',
  };
  const creditsMap = { '5': 5, '20': 20, '50': 50 };
  const priceId = priceMap[tier];

  if (!priceId) return res.status(400).json({ error: 'Invalid tier. Choose 5, 20, or 50.' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(503).json({ error: 'Payments not configured.' });

  const origin  = (req.headers.origin || 'https://www.cardresell.org').replace(/\/$/, '');
  const success = `${origin}/?grade_scan_paid=1&tier=${tier}&session_id={CHECKOUT_SESSION_ID}`;
  const cancel  = `${origin}/`;

  try {
    const params = new URLSearchParams({
      mode: 'payment',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      success_url: success,
      cancel_url: cancel,
      customer_email: userEmail,
      'metadata[google_sub]': userSub,
      'metadata[user_name]': userName,
      'metadata[type]': 'grade_scan',
      'metadata[tier]': tier,
      'metadata[credits]': String(creditsMap[tier]),
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
      const err = await stripeRes.json();
      return res.status(502).json({ error: err.error?.message || 'Payment setup failed.' });
    }
    const session = await stripeRes.json();
    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch(e) {
    console.error('Grade scan checkout error:', e);
    return res.status(500).json({ error: 'Could not create checkout session.' });
  }
}
