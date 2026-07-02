// /api/stripe-webhook — Handle Stripe events
// Handles: Pro subscription + per-scan payments

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return res.status(503).json({ error: 'Webhook not configured.' });

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = await verifyStripeSignature(rawBody, sig, webhookSecret);
  } catch(e) {
    console.error('Webhook signature failed:', e.message);
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  const type = event.type;
  console.log('Stripe webhook:', type);

  // Pro subscription checkout OR per-scan payment
  if (type === 'checkout.session.completed') {
    const obj = event.data.object;
    const googleSub  = obj.metadata?.google_sub || null;
    const email      = obj.customer_email || obj.customer_details?.email || '';
    const paymentType = obj.metadata?.type || '';

    if (googleSub) {
      if (paymentType === 'grade_scan') {
        // Grade scan pack — credit based on tier (5, 20, or 50)
        const tierMap = { '5': 5, '20': 20, '50': 50 };
        const qty = tierMap[obj.metadata?.tier] || parseInt(obj.metadata?.credits) || 5;
        await addPaidScanCredit(googleSub, qty, 'graded');
        console.log('GRADE_SCAN_CREDIT_ADDED:', JSON.stringify({ googleSub, email, qty }));
      } else if (paymentType === 'graded_scan') {
        // Legacy single-scan payment — add 1 credit (backward compat)
        await addPaidScanCredit(googleSub, 1, 'graded');
        console.log('GRADED_SCAN_CREDIT_ADDED_LEGACY:', JSON.stringify({ googleSub, email }));
      } else if (paymentType === 'id_scan') {
        // ID scan bundle — credit based on tier
        const tierMap = { '10': 10, '50': 50, '100': 100 };
        const qty = tierMap[obj.metadata?.tier] || 10;
        await addPaidScanCredit(googleSub, qty, 'id');
        console.log('ID_SCAN_CREDIT_ADDED:', JSON.stringify({ googleSub, email, qty }));
      } else if (obj.mode === 'subscription' || paymentType === 'pro_annual') {
        const subscriptionId = obj.subscription || obj.id;
        const plan = obj.metadata?.plan || 'pro_monthly';
        await storeProUser(googleSub, email, subscriptionId, 'active', plan);
      }
    }
  }

  // Recurring Pro invoice paid
  if (type === 'invoice.payment_succeeded') {
    const obj = event.data.object;
    const googleSub = obj.metadata?.google_sub || obj.subscription_details?.metadata?.google_sub || null;
    const email = obj.customer_email || obj.customer_details?.email || '';
    const subscriptionId = obj.subscription || obj.id;
    if (googleSub) await storeProUser(googleSub, email, subscriptionId, 'active');
  }

  // Subscription cancelled or payment failed
  if (type === 'customer.subscription.deleted' || type === 'invoice.payment_failed') {
    const obj = event.data.object;
    const googleSub = obj.metadata?.google_sub || null;
    if (googleSub) await storeProUser(googleSub, '', obj.id, 'cancelled');
  }

  return res.status(200).json({ received: true });
}

async function storeProUser(googleSub, email, subscriptionId, status, plan = 'pro_monthly') {
  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (kvUrl && kvToken) {
    try {
      const key = `pro:${googleSub}`;
      const val = JSON.stringify({ email, subscriptionId, status, plan, updatedAt: new Date().toISOString() });
      await fetch(`${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(val)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken}` },
      });
    } catch(e) { console.error('KV store error:', e); }
  } else {
    console.log('PRO_USER:', JSON.stringify({ googleSub, email, subscriptionId, status }));
  }
}

async function addPaidScanCredit(googleSub, amount, type = 'graded') {
  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) {
    console.log('SCAN_CREDIT:', JSON.stringify({ googleSub, amount, type }));
    return;
  }
  try {
    // graded scans: scans:{sub}:paid_left   id scans: scans:{sub}:id_paid_left
    const key     = type === 'id' ? `scans:${googleSub}:id_paid_left` : `scans:${googleSub}:paid_left`;
    const current = await getKVInt(kvUrl, kvToken, key);
    await fetch(`${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(String(current + amount))}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` },
    });
  } catch(e) { console.error('KV scan credit error:', e); }
}

async function getKVInt(kvUrl, kvToken, key) {
  try {
    const r = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    const data = await r.json();
    const raw = data.result;
    if (raw === null || raw === undefined) return 0;
    if (typeof raw === 'string' && raw.startsWith('[')) {
      try { return parseInt(JSON.parse(raw)[0]) || 0; } catch(e) {}
    }
    return parseInt(raw) || 0;
  } catch(e) { return 0; }
}

async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader) throw new Error('No Stripe-Signature header');
  const parts      = Object.fromEntries(sigHeader.split(',').map(p => { const [k,...v] = p.split('='); return [k, v.join('=')]; }));
  const timestamp  = parts.t;
  const signatures = sigHeader.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  const signedPayload = `${timestamp}.${payload.toString()}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const expected = Buffer.from(sigBuf).toString('hex');

  if (!signatures.some(s => s === expected)) throw new Error('Signature mismatch');
  if (Math.floor(Date.now() / 1000) - parseInt(timestamp) > 300) throw new Error('Timestamp too old');

  return JSON.parse(payload.toString());
}
