// /api/stripe-scan-checkout — One-time $1.50 per graded scan
// POST body: { email, userId, name? }

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

  // Try Google token — fall back to body email if expired
  if (idToken && idToken.length > 20) {
    try {
      const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
      if (r.ok) {
        const info = await r.json();
        if (info.email) {
          userEmail = info.email;
          userSub   = info.sub || userSub;
          userName  = info.name || userName;
        }
      }
    } catch(e) { /* fall through */ }
  }

  if (!userEmail || !userEmail.includes('@')) {
    return res.status(401).json({ error: 'Sign in with Google first.' });
  }

  const stripeKey  = process.env.STRIPE_SECRET_KEY;
  const scanPriceId = process.env.STRIPE_SCAN_PRICE_ID;
  if (!stripeKey || !scanPriceId) return res.status(503).json({ error: 'Payments not configured yet.' });

  const origin  = (req.headers.origin || 'https://www.cardresell.org').replace(/\/$/, '');
  const success = `${origin}/?scan_paid=1&session_id={CHECKOUT_SESSION_ID}`;
  const cancel  = `${origin}/`;

  try {
    const params = new URLSearchParams({
      mode: 'payment',
      'line_items[0][price]': scanPriceId,
      'line_items[0][quantity]': '1',
      success_url: success,
      cancel_url: cancel,
      customer_email: userEmail,
      'metadata[google_sub]': userSub,
      'metadata[user_name]': userName,
      'metadata[type]': 'graded_scan',
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
      console.error('Stripe scan error:', err);
      return res.status(502).json({ error: err.error?.message || 'Payment setup failed.' });
    }
    const session = await stripeRes.json();
    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch(e) {
    console.error('Scan checkout exception:', e);
    return res.status(500).json({ error: 'Could not create checkout session.' });
  }
}
