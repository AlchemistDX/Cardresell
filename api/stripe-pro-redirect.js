// /api/stripe-pro-redirect — returns JSON with Stripe checkout URL (iOS Safari compatible)
// Called as: /api/stripe-pro-redirect?plan=monthly|annual&email=x&uid=y&name=z
// Returns: { url: "https://checkout.stripe.com/..." } or { error: "..." }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { plan = 'monthly', email = '', uid = '', name = '' } = req.query;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'signin_required' });
  }
  if (!stripeKey) {
    return res.status(500).json({ error: 'not_configured' });
  }

  const priceId = plan === 'annual'
    ? process.env.STRIPE_ANNUAL_PRICE_ID || 'price_1TosPSFW2YZoedIZ5e0abG3y'
    : process.env.STRIPE_MONTHLY_PRICE_ID || 'price_1TnrRWFW2YZoedIZaXDoJWje';

  const origin  = 'https://www.cardresell.org';
  const success = `${origin}/?pro=1&plan=${plan}&session_id={CHECKOUT_SESSION_ID}`;
  const cancel  = `${origin}/`;

  try {
    const params = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      success_url: success,
      cancel_url: cancel,
      customer_email: email,
      'metadata[google_sub]': uid,
      'metadata[user_name]': name,
      'metadata[plan]': plan,
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
      console.error('Stripe error:', data);
      return res.status(500).json({ error: 'stripe_error', detail: data?.error?.message });
    }
    return res.status(200).json({ url: data.url });
  } catch (e) {
    console.error('Pro redirect error:', e);
    return res.status(500).json({ error: 'network_error' });
  }
}
