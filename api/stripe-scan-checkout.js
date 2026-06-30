// /api/stripe-scan-checkout — Create a Stripe Checkout session for a single $1.50 graded scan
// Called with: POST (Authorization: Bearer <google_id_token>)
// Returns: { url } — redirect user to Stripe checkout

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 1. Verify Google ID token
  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!idToken) return res.status(401).json({ error: 'Sign in with Google first.' });

  let userEmail, userSub, userName;
  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
    if (!r.ok) return res.status(401).json({ error: 'Invalid Google session.' });
    const info = await r.json();
    const expectedClientId = '971593505703-6feq3nn7p9580krori6r157rfm5tp88l.apps.googleusercontent.com';
    if (info.aud !== expectedClientId) return res.status(401).json({ error: 'Unauthorized.' });
    userEmail = info.email;
    userSub   = info.sub;
    userName  = info.name || '';
  } catch(e) {
    return res.status(401).json({ error: 'Could not verify sign-in.' });
  }

  const stripeKey   = process.env.STRIPE_SECRET_KEY;
  const scanPriceId = process.env.STRIPE_SCAN_PRICE_ID;
  if (!stripeKey || !scanPriceId) return res.status(503).json({ error: 'Payments not configured yet.' });

  const origin     = req.headers.origin || 'https://cardresell.org';
  const successUrl = `${origin}/?scan_paid=1`;
  const cancelUrl  = `${origin}/`;

  try {
    const params = new URLSearchParams({
      mode: 'payment',
      'line_items[0][price]': scanPriceId,
      'line_items[0][quantity]': '1',
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: userEmail,
      'metadata[google_sub]': userSub,
      'metadata[user_name]': userName,
      'metadata[type]': 'graded_scan',
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
      console.error('Stripe scan checkout error:', err);
      return res.status(502).json({ error: err.error?.message || 'Payment setup failed.' });
    }

    const session = await stripeRes.json();
    return res.status(200).json({ url: session.url, sessionId: session.id });

  } catch(e) {
    console.error('Scan checkout error:', e);
    return res.status(500).json({ error: 'Could not create checkout session.' });
  }
}
