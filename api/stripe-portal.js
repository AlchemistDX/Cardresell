// /api/stripe-portal — Open Stripe Customer Portal for subscription management
// POST body: { email, userId }
// Authorization: Bearer <google_id_token>
// Returns: { url } — redirect user to this URL to manage/cancel subscription

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body    = req.body || {};
  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();

  let userEmail = body.email || '';
  let userSub   = body.userId || '';

  // Verify token if present
  if (idToken && idToken.length > 20) {
    try {
      const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
      if (r.ok) {
        const info = await r.json();
        if (info.email) { userEmail = info.email; userSub = info.sub || userSub; }
      }
    } catch(e) { /* fall through */ }
  }

  if (!userEmail || !userEmail.includes('@')) {
    return res.status(401).json({ error: 'Sign in with Google first.' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(503).json({ error: 'Payments not configured.' });

  const origin     = (req.headers.origin || 'https://www.cardresell.org').replace(/\/$/, '');
  const returnUrl  = `${origin}/`;

  try {
    // Find existing Stripe customer by email
    const searchRes = await fetch(
      `https://api.stripe.com/v1/customers/search?query=email:'${encodeURIComponent(userEmail)}'&limit=1`,
      { headers: { 'Authorization': `Bearer ${stripeKey}` } }
    );
    const searchData = await searchRes.json();
    const customer   = searchData.data?.[0];

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
