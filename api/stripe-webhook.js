// /api/stripe-webhook — Handle Stripe events
// Handles: Pro/Pro+ subscription + per-scan payments
//
// Monthly credit grants (Phase 1b):
//   On BOTH checkout.session.completed (first payment) AND
//   invoice.payment_succeeded (recurring renewals), we deposit tier-specific
//   credits into the user's KV pools:
//     - Pro:      +50 id_paid_left,  +20 paid_left
//     - Pro+:    +200 id_paid_left,  +75 paid_left
//   Rollover ceiling enforced: credits cap at 3 months' worth for Pro,
//   6 months' worth for Pro+. Excess grant is discarded (not stored).
//
// Idempotency: The Stripe event.id lock at the top of handler() prevents
// duplicate grants if Stripe retries the same webhook.

export const config = { api: { bodyParser: false } };

// Tier configuration — MUST stay in sync with TIER_CONFIG in api/pro-status.js
const TIER_CONFIG = {
  pro:      { monthlyIds: 50,  monthlyGrade: 20, ceilingMonths: 3 },
  pro_plus: { monthlyIds: 200, monthlyGrade: 75, ceilingMonths: 6 },
};

function tierFromPlan(plan) {
  if (plan === 'pro_plus_monthly' || plan === 'pro_plus_annual') return 'pro_plus';
  if (plan === 'pro_monthly'      || plan === 'pro_annual')      return 'pro';
  return null;
}

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
      } else if (obj.mode === 'subscription' || paymentType === 'pro_annual' || paymentType === 'pro_plus_annual') {
        const subscriptionId = obj.subscription || obj.id;
        const plan = obj.metadata?.plan || 'pro_monthly';
        await storeProUser(googleSub, email, subscriptionId, 'active', plan);
        // Grant initial month's credits on first checkout.
        await grantMonthlyCredits(googleSub, plan, obj.id);
      }
    }
  }

  // Recurring Pro/Pro+ invoice paid (monthly renewal) — grant monthly credits.
  // First-month grants happen in checkout.session.completed above; Stripe does
  // NOT re-fire invoice.payment_succeeded for the initial payment on new subs
  // (checkout.session.completed is fired instead), so there's no double-grant.
  if (type === 'invoice.payment_succeeded') {
    const obj = event.data.object;
    const googleSub = obj.metadata?.google_sub || obj.subscription_details?.metadata?.google_sub || null;
    const email = obj.customer_email || obj.customer_details?.email || '';
    const subscriptionId = obj.subscription || obj.id;
    if (googleSub) {
      // Fetch existing plan from KV so we know whether to grant Pro or Pro+.
      const plan = await getStoredPlan(googleSub);
      await storeProUser(googleSub, email, subscriptionId, 'active', plan || 'pro_monthly');
      if (plan) await grantMonthlyCredits(googleSub, plan, obj.id);
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

// Read the currently stored plan for a Pro user (used on invoice.payment_succeeded
// to know whether to grant Pro or Pro+ credits). Returns null if no active record.
async function getStoredPlan(googleSub) {
  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return null;
  try {
    const r = await fetch(`${kvUrl}/get/${encodeURIComponent(`pro:${googleSub}`)}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    const data = await r.json();
    if (data.result) {
      const record = JSON.parse(data.result);
      return record.plan || null;
    }
  } catch(e) { console.error('getStoredPlan error:', e); }
  return null;
}

// Grant a month's worth of ID scans + grade credits to a subscriber,
// enforcing the rollover ceiling (3 months for Pro, 6 for Pro+).
// The Stripe event.id lock at handler() top ensures this can't double-fire
// for the same invoice/checkout event.
async function grantMonthlyCredits(googleSub, plan, sourceEventId) {
  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) {
    console.log('MONTHLY_GRANT_NO_KV:', JSON.stringify({ googleSub, plan }));
    return;
  }

  const tier = tierFromPlan(plan);
  if (!tier) {
    console.log('MONTHLY_GRANT_UNKNOWN_PLAN:', plan);
    return;
  }
  const cfg = TIER_CONFIG[tier];
  const ceilingIds   = cfg.monthlyIds   * cfg.ceilingMonths; // Pro=150, Pro+=1200
  const ceilingGrade = cfg.monthlyGrade * cfg.ceilingMonths; // Pro=60,  Pro+=450

  try {
    const idKey    = `scans:${googleSub}:id_paid_left`;
    const gradeKey = `scans:${googleSub}:paid_left`;
    const curId    = await getKVInt(kvUrl, kvToken, idKey);
    const curGrade = await getKVInt(kvUrl, kvToken, gradeKey);

    // Top up to ceiling. If balance is ALREADY above ceiling (e.g. user bought
    // a big scan pack that pushed them over the monthly cap), leave the excess
    // alone — do not truncate purchased credits. Grant is capped so it can't
    // push above ceiling either.
    const nextId    = curId    >= ceilingIds   ? curId    : Math.min(ceilingIds,   curId    + cfg.monthlyIds);
    const nextGrade = curGrade >= ceilingGrade ? curGrade : Math.min(ceilingGrade, curGrade + cfg.monthlyGrade);
    const grantedId    = Math.max(0, nextId    - curId);
    const grantedGrade = Math.max(0, nextGrade - curGrade);

    await Promise.all([
      fetch(`${kvUrl}/set/${encodeURIComponent(idKey)}/${encodeURIComponent(String(nextId))}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken}` },
      }),
      fetch(`${kvUrl}/set/${encodeURIComponent(gradeKey)}/${encodeURIComponent(String(nextGrade))}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken}` },
      }),
    ]);

    // Audit trail for support/debugging. Not used programmatically.
    const stamp = new Date().toISOString().slice(0, 7); // YYYY-MM
    const auditKey = `credit_grants:${googleSub}:${stamp}`;
    const auditVal = JSON.stringify({
      tier, plan, grantedId, grantedGrade,
      newIdBalance: nextId, newGradeBalance: nextGrade,
      sourceEventId, at: new Date().toISOString(),
    });
    await fetch(`${kvUrl}/set/${encodeURIComponent(auditKey)}/${encodeURIComponent(auditVal)}/EX/7776000`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` },
    });

    console.log('MONTHLY_GRANT:', JSON.stringify({
      googleSub, plan, tier,
      granted: { id: grantedId, grade: grantedGrade },
      newBalance: { id: nextId, grade: nextGrade },
      ceiling: { id: ceilingIds, grade: ceilingGrade },
    }));
  } catch(e) {
    console.error('grantMonthlyCredits error:', e);
  }
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
