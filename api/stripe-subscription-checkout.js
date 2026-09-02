// /api/stripe-subscription-checkout — Create Stripe Checkout for any subscription tier
// POST body: { tier: 'pro'|'pro_max'|'ultimate', interval: 'month'|'year' }
// Authorization: Bearer <firebase_or_google_id_token>  (REQUIRED)
//
// 2026-09-01 [SECURITY]: Identity is now derived ONLY from a verified Firebase/
// Google ID token. Previously the endpoint accepted { email, userId } from the
// request body and swallowed token verification failures, letting a caller
// mint a Checkout Session whose success webhook would grant Pro to any
// google_sub they typed. Body values are ignored for identity; only the
// verified token's uid/email/name are used.
//
// This is the new multi-tier subscription checkout endpoint. The legacy
// /api/stripe-checkout (Pro monthly) and /api/stripe-annual-checkout (Pro
// annual) remain for backwards compat with the existing frontend calls; this
// endpoint powers the new Pro Max + Ultimate purchase flows and any new UI
// that wants a single unified path.

import { verifyTokenFlexible } from './_verifyToken.js';

// Fallback hardcoded price IDs (for tiers without env vars — mirrors legacy annual endpoint pattern)
const PRICE_FALLBACK = {
  pro:      { month: null, year: 'price_1TosPSFW2YZoedIZ5e0abG3y' }, // Pro annual $89.99/yr (legacy hardcoded)
  pro_max:  { month: null, year: null },
  ultimate: { month: null, year: null },
};

const TIER_PRICE_ENV = {
  pro: {
    month: 'STRIPE_PRICE_ID',            // legacy env var name for Pro monthly
    year:  'STRIPE_PRICE_ANNUAL_ID',     // legacy env var name for Pro annual (fallback covers this)
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

// Normalize interval aliases: 'monthly'/'m' -> 'month', 'annual'/'yearly'/'yr'/'y' -> 'year'
function normalizeInterval(raw) {
  const v = String(raw || '').toLowerCase().trim();
  if (['month', 'monthly', 'mo', 'm'].includes(v)) return 'month';
  if (['year', 'yearly', 'annual', 'annually', 'yr', 'y'].includes(v)) return 'year';
  return v;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body    = req.body || {};
  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();

  const tier     = String(body.tier || '').toLowerCase();
  const interval = normalizeInterval(body.interval);
  if (tier === 'ultimate') {
    return res.status(400).json({
      error: 'plan_retired',
      message: 'Ultimate was retired. Choose Pro or Pro Max.',
    });
  }

  const priceEnv = TIER_PRICE_ENV[tier]?.[interval];
  if (!priceEnv) {
    return res.status(400).json({ error: `Unknown tier/interval combo: ${tier}/${interval}` });
  }

  const priceId   = process.env[priceEnv] || PRICE_FALLBACK[tier]?.[interval] || null;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey || !priceId) {
    console.error(`Missing price config: tier=${tier} interval=${interval} env=${priceEnv} envVal=${!!process.env[priceEnv]} fallback=${!!PRICE_FALLBACK[tier]?.[interval]}`);
    return res.status(503).json({ error: 'Payments not configured yet.' });
  }

  // Identity MUST come from a verified token. Fail closed on any missing
  // or invalid token — do NOT fall back to body-supplied email/uid.
  if (!idToken || idToken.length < 20) {
    return res.status(401).json({ error: 'Sign in with Google first.' });
  }
  let verified;
  try {
    verified = await verifyTokenFlexible(idToken);
  } catch (e) {
    console.error('SUBSCRIPTION_CHECKOUT_TOKEN_INVALID:', e && e.message);
    return res.status(401).json({ error: 'Sign-in expired. Please sign in again.' });
  }
  if (!verified || !verified.uid) {
    return res.status(401).json({ error: 'Sign-in expired. Please sign in again.' });
  }
  const userSub   = verified.uid;
  const userEmail = verified.email || '';
  const userName  = verified.name  || '';
  // 2026-09-02 (CR-023): we used to 401 here when the token carried no email.
  // That refused the sale outright, and for no safety benefit: entitlement is
  // keyed on metadata[google_sub] (the Firebase uid), never on the email, and
  // the webhook reads customer_details.email -- which Stripe Checkout fills in
  // from whatever the buyer types. customer_email is only a prefill. So when
  // we have no email, omit the prefill and let Stripe collect it, rather than
  // telling a paying user their account is broken.

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
      'metadata[google_sub]': userSub,
      'metadata[user_name]': userName,
      'metadata[tier]': tier,
      'metadata[interval]': interval,
      'subscription_data[metadata][google_sub]': userSub,
      'subscription_data[metadata][tier]': tier,
      'subscription_data[metadata][interval]': interval,
    });
    // Prefill the buyer's email only when we actually know it; an empty
    // customer_email is rejected by Stripe as a malformed address.
    if (userEmail && userEmail.includes('@')) params.set('customer_email', userEmail);

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
