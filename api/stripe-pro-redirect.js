// /api/stripe-pro-redirect — GET → 302 to Stripe checkout
// Called via hidden form submit (iOS Safari compatible — no popup blocking)
// ?plan=monthly|annual&email=x&uid=y&name=z

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { plan = 'monthly', email = '', uid = '', name = '' } = req.query;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (!email || !email.includes('@')) return res.status(302).setHeader('Location', '/?error=signin').end();
  if (!stripeKey) return res.status(302).setHeader('Location', '/?error=not_configured').end();

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
      headers: { 'Authorization': `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = await stripeRes.json();
    if (!stripeRes.ok || !data.url) {
      console.error('Stripe pro error:', data);
      return res.status(302).setHeader('Location', '/?error=stripe_error').end();
    }
    return res.status(302).setHeader('Location', data.url).end();
  } catch (e) {
    console.error('Pro redirect error:', e);
    return res.status(302).setHeader('Location', '/?error=network').end();
  }
}
