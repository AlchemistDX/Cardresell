// /api/stripe-id-checkout — One-time purchase of scan credit packs.
// Handles BOTH ID Scan packs and Grade Scan packs; the two flows are
// merged into one function because Vercel Hobby caps us at 12 API
// functions total. Branch on body.type.
//
// POST body: { type: 'id' | 'grade', tier, email?, userId?, name? }
//
// ID Scan tiers   ('10' | '50' | '100')  → success ?id_scan_paid=1
// Grade Scan tiers ('3'  | '10' | '25')  → success ?grade_pack_paid=1

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body    = req.body || {};
  const type    = String(body.type || 'id').toLowerCase(); // 'id' | 'grade'
  const tier    = String(body.tier || (type === 'grade' ? '3' : '10'));
  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();

  let userEmail = body.email  || '';
  let userSub   = body.userId || '';
  let userName  = body.name   || '';

  // Verify Google token — fall back to body email if the token is expired
  if (idToken && idToken.length > 20) {
    try {
      const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
      if (r.ok) {
        const info = await r.json();
        if (info.email) { userEmail = info.email; userSub = info.sub || userSub; userName = info.name || userName; }
      }
    } catch(e) { /* non-blocking */ }
  }

  if (!userEmail || !userEmail.includes('@')) {
    return res.status(401).json({ error: 'Sign in with Google first.' });
  }

  // Choose price map + success return URL based on pack type
  let priceMap, priceId, successFlag, metadataType, validTiersMsg;
  if (type === 'grade') {
    priceMap = {
      '3':  process.env.STRIPE_GRADE_SCAN_PRICE_3,
      '10': process.env.STRIPE_GRADE_SCAN_PRICE_10,
      '25': process.env.STRIPE_GRADE_SCAN_PRICE_25,
    };
    priceId = priceMap[tier];
    successFlag = 'grade_pack_paid';
    metadataType = 'grade_pack';
    validTiersMsg = 'Invalid tier. Choose 3, 10, or 25.';
  } else {
    priceMap = {
      '10':  process.env.STRIPE_ID_SCAN_PRICE_10,
      '50':  process.env.STRIPE_ID_SCAN_PRICE_50,
      '100': process.env.STRIPE_ID_SCAN_PRICE_100,
    };
    priceId = priceMap[tier];
    successFlag = 'id_scan_paid';
    metadataType = 'id_scan';
    validTiersMsg = 'Invalid tier. Choose 10, 50, or 100.';
  }

  if (!priceId) return res.status(400).json({ error: validTiersMsg });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(503).json({ error: 'Payments not configured.' });

  const origin  = (req.headers.origin || 'https://www.cardresell.org').replace(/\/$/, '');
  const success = `${origin}/?${successFlag}=1&tier=${tier}&session_id={CHECKOUT_SESSION_ID}`;
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
      'metadata[type]': metadataType,
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
      console.error(`${metadataType} checkout error:`, err);
      return res.status(502).json({ error: err.error?.message || 'Payment setup failed.' });
    }
    const session = await stripeRes.json();
    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch(e) {
    console.error(`${metadataType} checkout exception:`, e);
    return res.status(500).json({ error: 'Could not create checkout session.' });
  }
}
