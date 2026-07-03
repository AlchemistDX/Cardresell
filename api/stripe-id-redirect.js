// /api/stripe-id-redirect — returns JSON with Stripe checkout URL (iOS Safari compatible)
// Called as: /api/stripe-id-redirect?tier=10|50|100&uid=xxx&email=yyy&name=zzz
// Returns: { url: "https://checkout.stripe.com/..." } or { error: "..." }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { tier = '10', email = '', uid = '', name = '' } = req.query;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'signin_required' });
  }

  const priceMap = {
    '10':  process.env.STRIPE_ID_SCAN_PRICE_10,
    '50':  process.env.STRIPE_ID_SCAN_PRICE_50,
    '100': process.env.STRIPE_ID_SCAN_PRICE_100,
  };
  const priceId = priceMap[String(tier)];

  if (!priceId) return res.status(400).json({ error: 'invalid_tier' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(500).json({ error: 'not_configured' });

  const origin  = 'https://www.cardresell.org';
  const success = `${origin}/?id_scan_paid=1&tier=${tier}&session_id={CHECKOUT_SESSION_ID}`;
  const cancel  = `${origin}/`;

  try {
    const params = new URLSearchParams({
      mode: 'payment',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      success_url: success,
      cancel_url: cancel,
      customer_email: email,
      'metadata[google_sub]': uid,
      'metadata[user_name]': name,
      'metadata[type]': 'id_scan',
      'metadata[tier]': String(tier),
    });

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await stripeRes.json();
    if (!stripeRes.ok || !data.url) {
      console.error('Stripe ID error:', data);
      return res.status(500).json({ error: 'stripe_error', detail: data?.error?.message });
    }
    return res.status(200).json({ url: data.url });
  } catch (e) {
    console.error('ID redirect error:', e);
    return res.status(500).json({ error: 'network_error' });
  }
}
