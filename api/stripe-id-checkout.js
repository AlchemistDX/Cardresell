// /api/stripe-id-checkout — One-time purchase of ID scan credits
// POST body: { tier: '10' | '40' | '80', email?, userId?, name? }

import { verifyTokenFlexible } from './_verifyToken.js';
import { getUserTier, TIER_BENEFITS } from './_tier.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body    = req.body || {};
  const tier    = String(body.tier || '10'); // '10', '50', '100'
  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();

  // 2026-09-01 [SECURITY]: identity must come from a verified token only.
  // Do not accept body-supplied email/userId. Fail closed on missing/invalid
  // tokens so caller-controlled google_sub can't reach the Stripe webhook.
  if (!idToken || idToken.length < 20) {
    return res.status(401).json({ error: 'Sign in with Google first.' });
  }
  let verified;
  try {
    verified = await verifyTokenFlexible(idToken);
  } catch (e) {
    console.error('ID_CHECKOUT_TOKEN_INVALID:', e && e.message);
    return res.status(401).json({ error: 'Sign-in expired. Please sign in again.' });
  }
  if (!verified || !verified.uid) {
    return res.status(401).json({ error: 'Sign-in expired. Please sign in again.' });
  }
  const userSub   = verified.uid;
  const userEmail = verified.email || '';
  const userName  = verified.name  || '';
  if (!userEmail || !userEmail.includes('@')) {
    return res.status(401).json({ error: 'Your Google account is missing an email. Please sign in again with a Google account that exposes email.' });
  }

  const priceMap = {
    '10':  process.env.STRIPE_ID_SCAN_PRICE_10,
    '50':  process.env.STRIPE_ID_SCAN_PRICE_50,
    '100': process.env.STRIPE_ID_SCAN_PRICE_100,
  };
  const labelMap = { '10': '10 ID Scans — $1.99', '50': '50 ID Scans — $7.99', '100': '100 ID Scans — $12.99' };
  const priceId  = priceMap[tier];

  if (!priceId) return res.status(400).json({ error: 'Invalid tier. Choose 10, 50, or 100.' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(503).json({ error: 'Payments not configured.' });

  const origin  = (req.headers.origin || 'https://www.cardresell.org').replace(/\/$/, '');
  const success = `${origin}/?id_scan_paid=1&tier=${tier}&session_id={CHECKOUT_SESSION_ID}`;
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
      'metadata[type]': 'id_scan',
      'metadata[tier]': tier,
    });

    // Look up user's subscription tier so we can auto-apply their top-up coupon.
    let couponId = null;
    try {
      const userTier  = await getUserTier(stripeKey, process.env.KV_REST_API_URL, process.env.KV_REST_API_TOKEN, userSub, userEmail);
      const tierPerks = TIER_BENEFITS[userTier] || TIER_BENEFITS.free;
      if (tierPerks.couponId) couponId = tierPerks.couponId;
    } catch (e) { /* non-blocking */ }
    if (couponId) params.append('discounts[0][coupon]', couponId);

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
    console.error('ID scan checkout error:', e);
    return res.status(500).json({ error: 'Could not create checkout session.' });
  }
}
