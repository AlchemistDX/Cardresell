// /api/stripe-id-checkout — One-time purchase of ID scan credits
// POST body: { tier: '10' | '50' | '100', email?, userId?, name? }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body    = req.body || {};
  const tier    = String(body.tier || '10'); // '10', '50', '100'
  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();

  let userEmail = body.email  || '';
  let userSub   = body.userId || '';
  let userName  = body.name   || '';

  // Verify Google token
  if (idToken && idToken.length > 20) {
    try {
      const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
      if (r.ok) {
        const info = await r.json();
        if (info.email) { userEmail = info.email; userSub = info.sub || userSub; userName = info.name || userName; }
      }
    } catch(e) {}
  }

  if (!userEmail || !userEmail.includes('@')) {
    return res.status(401).json({ error: 'Sign in with Google first.' });
  }

  const priceMap = {
    '10':  process.env.STRIPE_ID_SCAN_PRICE_10,
    '50':  process.env.STRIPE_ID_SCAN_PRICE_50,
    '100': process.env.STRIPE_ID_SCAN_PRICE_100,
  };
  const labelMap = { '10': '10 ID Scans — $1', '50': '50 ID Scans — $5', '100': '100 ID Scans — $9' };
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
