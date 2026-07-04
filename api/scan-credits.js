// /api/scan-credits — Scan credit management
// GET  ?email=x&sub=y                           → returns { credits, isPro }  (public read-only)
// POST { action: 'verify_payment',   sessionId } → verify Stripe payment & grant credit  (auth required)
// POST { action: 'verify_id_payment',sessionId } → verify Stripe ID-scan payment          (auth required)
// POST { action: 'verify_grade_payment', sessionId } → verify grade scan payment          (auth required)
//
// SECURITY:
// - All POST verify_* actions require a valid Firebase/Google ID token in Authorization header.
// - uid is derived from the token, NEVER from the body — prevents credit-injection attacks.
// - The session's metadata.google_sub must match the token's uid.
// - Dead 'use', 'use_id', 'add' actions were removed — they were unauthenticated and never
//   called by any client; webhook grants credits directly via KV, not this endpoint.

import { verifyTokenFlexible } from './_verifyToken.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const kvUrl     = process.env.KV_REST_API_URL;
  const kvToken   = process.env.KV_REST_API_TOKEN;
  const hasKV     = !!(kvUrl && kvToken);

  // ── GET: return credit balance ──
  if (req.method === 'GET') {
    const email     = req.query?.email || '';
    const googleSub = req.query?.sub   || '';
    if (!email) return res.status(400).json({ error: 'email required' });

    const isPro = await checkProStatus(stripeKey, kvUrl, kvToken, googleSub, email);

    if (!hasKV) {
      // No KV: count credited Stripe sessions directly
      const paidCredits = await countStripeCredits(stripeKey, email, googleSub);
      const freeCredits = isPro ? 10 : 0; // can't track usage without KV, show as available
      return res.status(200).json({
        credits: paidCredits + freeCredits,
        isPro,
        paidCredits,
        freeCredits,
        kvAvailable: false,
      });
    }

    const key     = googleSub || email;
    const paid    = await getKVInt(kvUrl, kvToken, `scans:${key}:paid_left`);
    const idPaid  = await getKVInt(kvUrl, kvToken, `scans:${key}:id_paid_left`);
    const stamp   = getMonthStamp();
    const proFree = isPro
      ? Math.max(0, 10 - await getKVInt(kvUrl, kvToken, `scans:${key}:free_used_${stamp}`))
      : 0;
    return res.status(200).json({
      credits: paid + proFree,
      idCredits: idPaid,
      isPro,
      paidCredits: paid,
      freeCredits: proFree,
      kvAvailable: true,
    });
  }

  // ── POST ──
  if (req.method === 'POST') {
    const body = req.body || {};
    const { action, sessionId } = body;

    // ── AUTH REQUIRED: derive uid + email from verified token, NEVER trust body ──
    const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!idToken) return res.status(401).json({ error: 'Authorization token required' });

    let userSub = '';
    let userEmail = '';
    try {
      const tokenInfo = await verifyTokenFlexible(idToken);
      userSub   = tokenInfo.uid   || '';
      userEmail = tokenInfo.email || '';
    } catch (e) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (!userSub) return res.status(401).json({ error: 'Token missing uid' });

    // key is ALWAYS the verified uid — body values are ignored for identity
    const key   = userSub;
    const email = userEmail;

    // Helper: enforce that a Stripe session was issued to this exact user
    function sessionBelongsToUser(session) {
      const meta = session.metadata || {};
      const sessSub   = meta.google_sub || '';
      const sessEmail = (session.customer_email || '').toLowerCase();
      // Prefer google_sub match; fall back to email match if metadata missing
      if (sessSub) return sessSub === userSub;
      if (sessEmail && userEmail) return sessEmail === userEmail.toLowerCase();
      return false;
    }

    // ── verify_payment: Stripe session → grant 1 credit ──
    if (action === 'verify_payment') {
      if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
      if (!stripeKey) return res.status(503).json({ error: 'Payments not configured' });

      try {
        const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
          headers: { Authorization: `Bearer ${stripeKey}` }
        });
        if (!r.ok) return res.status(400).json({ error: 'Could not verify payment' });
        const session = await r.json();

        if (session.payment_status !== 'paid') {
          return res.status(400).json({ error: 'Payment not completed', status: session.payment_status });
        }
        if (session.metadata?.type !== 'graded_scan') {
          return res.status(400).json({ error: 'Not a scan payment' });
        }
        if (!sessionBelongsToUser(session)) {
          return res.status(403).json({ error: 'This payment does not belong to you' });
        }
        // Prevent double-credit
        if (session.metadata?.credited === 'true') {
          const currentCredits = hasKV ? await getKVInt(kvUrl, kvToken, `scans:${key}:paid_left`) : 1;
          return res.status(200).json({ success: true, alreadyCredited: true, credits: currentCredits });
        }

        // Mark as credited on the Stripe session (works with or without KV)
        await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${stripeKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: `metadata[credited]=true&metadata[credited_to]=${encodeURIComponent(key)}`
        });

        if (hasKV) {
          const current = await getKVInt(kvUrl, kvToken, `scans:${key}:paid_left`);
          await setKV(kvUrl, kvToken, `scans:${key}:paid_left`, current + 1);
          console.log('SCAN_CREDIT_GRANTED_KV:', JSON.stringify({ key, sessionId }));
          return res.status(200).json({ success: true, credits: current + 1 });
        } else {
          console.log('SCAN_CREDIT_GRANTED_STRIPE:', JSON.stringify({ key, sessionId }));
          return res.status(200).json({ success: true, credits: 1 });
        }
      } catch(e) {
        console.error('verify_payment error:', e);
        return res.status(500).json({ error: 'Verification failed: ' + e.message });
      }
    }

    // ── verify_id_payment: Stripe session → grant ID scan credits ──
    if (action === 'verify_id_payment') {
      if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
      if (!stripeKey) return res.status(503).json({ error: 'Payments not configured' });
      try {
        const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
          headers: { Authorization: `Bearer ${stripeKey}` }
        });
        if (!r.ok) return res.status(400).json({ error: 'Could not verify payment' });
        const session = await r.json();
        if (session.payment_status !== 'paid') return res.status(400).json({ error: 'Payment not completed' });
        if (session.metadata?.type !== 'id_scan') return res.status(400).json({ error: 'Not an ID scan payment' });
        if (!sessionBelongsToUser(session)) {
          return res.status(403).json({ error: 'This payment does not belong to you' });
        }
        if (session.metadata?.credited === 'true') {
          const cur = await getKVInt(kvUrl, kvToken, `scans:${key}:id_paid_left`);
          return res.status(200).json({ success: true, alreadyCredited: true, credits: cur });
        }
        const tierMap = { '10': 10, '50': 50, '100': 100 };
        const qty = tierMap[session.metadata?.tier] || 10;
        await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `metadata[credited]=true&metadata[credited_to]=${encodeURIComponent(key)}`
        });
        if (hasKV) {
          const current = await getKVInt(kvUrl, kvToken, `scans:${key}:id_paid_left`);
          await setKV(kvUrl, kvToken, `scans:${key}:id_paid_left`, current + qty);
          return res.status(200).json({ success: true, credits: current + qty, added: qty });
        }
        return res.status(200).json({ success: true, credits: qty, added: qty });
      } catch(e) {
        return res.status(500).json({ error: 'Verification failed: ' + e.message });
      }
    }

    // ── verify_grade_payment: Stripe session → grant grade scan credits ──
    if (action === 'verify_grade_payment') {
      if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
      if (!stripeKey) return res.status(503).json({ error: 'Payments not configured' });
      try {
        const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
          headers: { Authorization: `Bearer ${stripeKey}` }
        });
        if (!r.ok) return res.status(400).json({ error: 'Could not verify payment' });
        const session = await r.json();
        if (session.payment_status !== 'paid') return res.status(400).json({ error: 'Payment not completed' });
        if (session.metadata?.type !== 'grade_scan') return res.status(400).json({ error: 'Not a grade scan payment' });
        if (!sessionBelongsToUser(session)) {
          return res.status(403).json({ error: 'This payment does not belong to you' });
        }
        if (session.metadata?.credited === 'true') {
          const cur = await getKVInt(kvUrl, kvToken, `scans:${key}:paid_left`);
          return res.status(200).json({ success: true, alreadyCredited: true, credits: cur });
        }
        const tierMap = { '5': 5, '20': 20, '50': 50 };
        const qty = tierMap[session.metadata?.tier] || 5;
        await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `metadata[credited]=true&metadata[credited_to]=${encodeURIComponent(key)}`
        });
        if (hasKV) {
          const current = await getKVInt(kvUrl, kvToken, `scans:${key}:paid_left`);
          await setKV(kvUrl, kvToken, `scans:${key}:paid_left`, current + qty);
          return res.status(200).json({ success: true, credits: current + qty, added: qty });
        }
        return res.status(200).json({ success: true, credits: qty, added: qty });
      } catch(e) {
        return res.status(500).json({ error: 'Verification failed: ' + e.message });
      }
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).end();
}

// Count paid scan credits from Stripe (fallback when no KV)
// Searches checkout sessions by google_sub in metadata — reliable for all checkout types
async function countStripeCredits(stripeKey, email, googleSub) {
  if (!stripeKey) return 0;
  try {
    // Use Stripe Search API to find sessions credited to this user's google_sub
    const queries = [];
    if (googleSub) {
      queries.push(
        `https://api.stripe.com/v1/checkout/sessions/search?query=metadata[%27google_sub%27]:%27${encodeURIComponent(googleSub)}%27+AND+metadata[%27credited%27]:%27true%27&limit=25`
      );
    }
    if (email) {
      queries.push(
        `https://api.stripe.com/v1/checkout/sessions/search?query=metadata[%27credited%27]:%27true%27+AND+customer_email:%27${encodeURIComponent(email)}%27&limit=25`
      );
    }
    const sessionIds = new Set();
    let count = 0;
    for (const url of queries) {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${stripeKey}` } });
      if (!r.ok) continue;
      const data = await r.json();
      for (const s of (data.data || [])) {
        if (!sessionIds.has(s.id) &&
            s.payment_status === 'paid' &&
            s.metadata?.type === 'graded_scan' &&
            s.metadata?.credited === 'true') {
          sessionIds.add(s.id);
          count++;
        }
      }
    }
    return count;
  } catch(e) { return 0; }
}

async function checkProStatus(stripeKey, kvUrl, kvToken, googleSub, email) {
  // KV first
  if (kvUrl && kvToken && googleSub) {
    try {
      const r = await fetch(`${kvUrl}/get/${encodeURIComponent(`pro:${googleSub}`)}`, {
        headers: { Authorization: `Bearer ${kvToken}` }
      });
      const d = await r.json();
      if (d.result) {
        const rec = JSON.parse(d.result);
        if (rec.status === 'active') return true;
      }
    } catch(e) {}
  }
  // Stripe fallback
  if (!stripeKey || !email) return false;
  try {
    const r = await fetch(
      `https://api.stripe.com/v1/customers/search?query=email:"${email}"&limit=1`,
      { headers: { Authorization: `Bearer ${stripeKey}` } }
    );
    if (!r.ok) return false;
    const d = await r.json();
    const cust = d.data?.[0];
    if (!cust) return false;
    const subR = await fetch(
      `https://api.stripe.com/v1/subscriptions?customer=${cust.id}&status=active&limit=1`,
      { headers: { Authorization: `Bearer ${stripeKey}` } }
    );
    const subD = await subR.json();
    return (subD.data?.length || 0) > 0;
  } catch(e) { return false; }
}

function getMonthStamp() {
  const d = new Date();
  return `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function getKVInt(kvUrl, kvToken, key) {
  try {
    const r = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const d = await r.json();
    // Upstash returns result as string — parse it
    const raw = d.result;
    if (raw === null || raw === undefined) return 0;
    // Handle case where value was accidentally stored as JSON array string
    if (typeof raw === 'string' && raw.startsWith('[')) {
      try { return parseInt(JSON.parse(raw)[0]) || 0; } catch(e) {}
    }
    return parseInt(raw) || 0;
  } catch(e) { return 0; }
}

async function setKV(kvUrl, kvToken, key, value) {
  try {
    // Upstash REST: POST /set/key with value as plain string in body array
    await fetch(`${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(String(value))}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` }
    });
  } catch(e) {}
}

async function incrKV(kvUrl, kvToken, key) {
  try {
    await fetch(`${kvUrl}/incr/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` }
    });
  } catch(e) {}
}
