// /api/stripe-webhook — Handle Stripe events
// Handles: Pro/Pro Max/Ultimate subscriptions + per-scan payments

import { priceIdToTier } from './_tier.js';

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
  const eventId = event.id;
  console.log('Stripe webhook:', type, eventId);

  // ── Idempotency guard ──
  // Stripe may re-deliver the same event on retry (e.g. after signing-secret rotation
  // or transient 5xx). Setting a KV key with NX ensures each event.id is processed
  // exactly once. If the key already exists we ACK 200 and return without side effects.
  const alreadyProcessed = await markEventProcessed(eventId, type);
  if (alreadyProcessed) {
    console.log('DUPLICATE_WEBHOOK_IGNORED:', eventId, type);
    return res.status(200).json({ received: true, duplicate: true });
  }

  // Pro subscription checkout OR per-scan payment
  if (type === 'checkout.session.completed') {
    const obj = event.data.object;
    const googleSub  = obj.metadata?.google_sub || null;
    const email      = obj.customer_email || obj.customer_details?.email || '';
    const paymentType = obj.metadata?.type || '';

    if (googleSub) {
      if (paymentType === 'grade_scan') {
        // Grade scan pack — credit based on tier.
        // New tiers: 10 / 25 / 50. Old tiers (5, 15, 20, 40) kept for any in-flight
        // checkout sessions created before the 2026-08-17 price switch.
        const tierMap = { '10': 10, '25': 25, '50': 50, '5': 5, '15': 15, '20': 20, '40': 40 };
        const qty = tierMap[obj.metadata?.tier] || parseInt(obj.metadata?.credits) || 10;
        await addPaidScanCredit(googleSub, qty, 'graded');
        console.log('GRADE_SCAN_CREDIT_ADDED:', JSON.stringify({ googleSub, email, qty }));
      } else if (paymentType === 'graded_scan') {
        // Legacy single-scan payment — add 1 credit (backward compat)
        await addPaidScanCredit(googleSub, 1, 'graded');
        console.log('GRADED_SCAN_CREDIT_ADDED_LEGACY:', JSON.stringify({ googleSub, email }));
      } else if (paymentType === 'id_scan') {
        // ID scan bundle — credit based on tier.
        // New tiers: 10 / 50 / 100. Old tiers (40, 80) kept for any in-flight
        // checkout sessions created before the 2026-08-17 price switch.
        const tierMap = { '10': 10, '50': 50, '100': 100, '40': 40, '80': 80 };
        const qty = tierMap[obj.metadata?.tier] || 10;
        await addPaidScanCredit(googleSub, qty, 'id');
        console.log('ID_SCAN_CREDIT_ADDED:', JSON.stringify({ googleSub, email, qty }));
      } else if (obj.mode === 'subscription' || paymentType === 'pro_annual') {
        const subscriptionId = obj.subscription || obj.id;
        const plan = obj.metadata?.plan || 'pro_monthly';
        // Tier detection: prefer explicit metadata (set by new subscription
        // checkout), otherwise fall back to 'pro' (legacy checkout endpoints).
        const tier = obj.metadata?.tier || 'pro';
        await storeProUser(googleSub, email, subscriptionId, 'active', plan, tier);
      }
    }
  }

  // Recurring Pro invoice paid
  if (type === 'invoice.payment_succeeded') {
    const obj = event.data.object;
    const googleSub = obj.metadata?.google_sub || obj.subscription_details?.metadata?.google_sub || null;
    const email = obj.customer_email || obj.customer_details?.email || '';
    const subscriptionId = obj.subscription || obj.id;
    // Tier detection on invoice: prefer subscription metadata, then derive
    // from price ID on the invoice line, else undefined (keeps existing tier).
    const tier = obj.subscription_details?.metadata?.tier
              || priceIdToTier(obj.lines?.data?.[0]?.price?.id)
              || undefined;
    if (googleSub) await storeProUser(googleSub, email, subscriptionId, 'active', undefined, tier);
  }

  // Subscription created or updated — tier can change on upgrade/downgrade
  if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
    const obj = event.data.object;
    const googleSub = obj.metadata?.google_sub || null;
    const priceId   = obj.items?.data?.[0]?.price?.id;
    const tier      = obj.metadata?.tier || priceIdToTier(priceId) || undefined;
    if (googleSub && obj.status === 'active') {
      await storeProUser(googleSub, '', obj.id, 'active', undefined, tier);
    }
  }

  // Subscription cancelled or payment failed
  if (type === 'customer.subscription.deleted' || type === 'invoice.payment_failed') {
    const obj = event.data.object;
    const googleSub = obj.metadata?.google_sub || null;
    if (googleSub) await storeProUser(googleSub, '', obj.id, 'cancelled');
  }

  return res.status(200).json({ received: true });
}

// Returns true if this event.id was already processed (should be ignored).
// Uses Upstash Redis SETNX so the check-and-set is atomic — no race between
// concurrent deliveries. Key TTL is 30 days (Stripe retries for 3 days max).
async function markEventProcessed(eventId, type) {
  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken || !eventId) return false; // fail-open: don't break webhook if KV is down
  try {
    const key = `stripe_evt:${eventId}`;
    const val = JSON.stringify({ type, at: new Date().toISOString() });
    // Upstash Redis REST: SET key value EX <seconds> NX — path-segment form.
    // Returns { result: 'OK' } on first write, { result: null } if the key already exists.
    const r = await fetch(`${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(val)}/EX/2592000/NX`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    const data = await r.json();
    return data.result === null;
  } catch(e) {
    console.error('KV idempotency check error:', e);
    return false; // fail-open
  }
}

// Stores a subscription record in KV. Preserves existing fields on updates so
// partial calls (e.g. invoice.payment_succeeded without email or tier) don't
// blow away previously-set values.
async function storeProUser(googleSub, email, subscriptionId, status, plan, tier) {
  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (kvUrl && kvToken) {
    try {
      const key = `pro:${googleSub}`;

      // Read existing record to preserve fields not passed in this call.
      let existing = {};
      try {
        const g = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
          headers: { Authorization: `Bearer ${kvToken}` },
        });
        const gd = await g.json();
        if (gd.result) existing = JSON.parse(gd.result);
      } catch (e) { /* ignore, treat as new */ }

      const rec = {
        email:          email          || existing.email          || '',
        subscriptionId: subscriptionId || existing.subscriptionId || '',
        status,
        plan:           plan           || existing.plan           || 'pro_monthly',
        tier:           tier           || existing.tier           || 'pro',
        updatedAt:      new Date().toISOString(),
      };
      await fetch(`${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(rec))}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken}` },
      });
    } catch(e) { console.error('KV store error:', e); }
  } else {
    console.log('PRO_USER:', JSON.stringify({ googleSub, email, subscriptionId, status, plan, tier }));
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
