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

    // 1) BEST: read the KV pro:<uid> record we wrote at subscription time.
    //    It contains { email, subscriptionId, status, plan } for this exact uid,
    //    so it's authoritative even if the user later changed their signed-in
    //    email or the Firebase token no longer carries an email claim.
    let kvEmail = '';
    let kvSubId = '';
    const kvUrl   = process.env.KV_REST_API_URL;
    const kvToken = process.env.KV_REST_API_TOKEN;
    if (userSub && kvUrl && kvToken) {
      try {
        const kr = await fetch(`${kvUrl}/get/${encodeURIComponent(`pro:${userSub}`)}`,
          { headers: { 'Authorization': `Bearer ${kvToken}` } });
        const kd = await kr.json();
        if (kd.result) {
          const rec = JSON.parse(kd.result);
          kvEmail = rec.email || '';
          kvSubId = rec.subscriptionId || '';
        }
      } catch(e) { /* non-fatal */ }
    }

    // 1a) If we have a subscriptionId from KV, retrieve the subscription to get
    //     the exact customer — no search-index staleness, no email dependency.
    if (kvSubId) {
      try {
        const sr = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(kvSubId)}`,
          { headers: { 'Authorization': `Bearer ${stripeKey}` } });
        if (sr.ok) {
          const sd = await sr.json();
          if (sd.customer) {
            const cr = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(sd.customer)}`,
              { headers: { 'Authorization': `Bearer ${stripeKey}` } });
            if (cr.ok) customer = await cr.json();
          }
        }
      } catch(e) { /* non-fatal, fall through */ }
    }

    // 1b) If KV had an email (from subscription time), use it before touching the token email.
    if (!customer && kvEmail && kvEmail.includes('@')) {
      const kvEmailRes = await fetch(
        `https://api.stripe.com/v1/customers/search?query=email:'${encodeURIComponent(esc(kvEmail))}'&limit=1`,
        { headers: { 'Authorization': `Bearer ${stripeKey}` } }
      );
      const kvEmailData = await kvEmailRes.json();
      customer = kvEmailData.data?.[0] || null;
    }

    // 2) Fallback: lookup by verified uid via Stripe customer metadata.google_sub.
    if (!customer && userSub) {
      const bySubRes = await fetch(
        `https://api.stripe.com/v1/customers/search?query=metadata['google_sub']:'${encodeURIComponent(esc(userSub))}'&limit=1`,
        { headers: { 'Authorization': `Bearer ${stripeKey}` } }
      );
      const bySubData = await bySubRes.json();
      customer = bySubData.data?.[0] || null;
    }

    // 3) Last resort: lookup by the currently-verified token email.
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
