// /api/scan-credits — Scan credit management
// GET  ?email=x&sub=y  → returns { credits, isPro }
// POST { action: 'use', email, googleSub }         → use a credit
// POST { action: 'verify_payment', sessionId, email, googleSub } → verify Stripe payment & grant credit
// POST { action: 'add', email, googleSub, amount } → add credits (webhook)

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
    const { action, email, googleSub, sessionId, amount } = body;
    const key = googleSub || email;

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

    // ── use: decrement a credit before scanning ──
    if (action === 'use') {
      if (!hasKV) {
        // Without KV: verify user has at least 1 Stripe credit then allow
        const paid = await countStripeCredits(stripeKey, email, googleSub);
        if (paid < 1) {
          const isPro = await checkProStatus(stripeKey, kvUrl, kvToken, googleSub, email);
          if (!isPro) return res.status(402).json({ success: false, needsPayment: true, credits: 0 });
        }
        return res.status(200).json({ success: true, credits: paid });
      }

      const isPro    = await checkProStatus(stripeKey, kvUrl, kvToken, googleSub, email);
      const stamp    = getMonthStamp();
      const monthKey = `scans:${key}:free_used_${stamp}`;
      const freeUsed = await getKVInt(kvUrl, kvToken, monthKey);
      const freeLeft = isPro ? Math.max(0, 10 - freeUsed) : 0;
      const paid     = await getKVInt(kvUrl, kvToken, `scans:${key}:paid_left`);

      if (freeLeft > 0) {
        await incrKV(kvUrl, kvToken, monthKey);
        return res.status(200).json({ success: true, charged: false, credits: freeLeft - 1 + paid });
      } else if (paid > 0) {
        await setKV(kvUrl, kvToken, `scans:${key}:paid_left`, paid - 1);
        return res.status(200).json({ success: true, charged: false, usedPaid: true, credits: paid - 1 });
      } else {
        return res.status(402).json({ success: false, needsPayment: true, credits: 0 });
      }
    }

    // ── use_id: decrement an ID scan credit ──
    if (action === 'use_id') {
      if (!hasKV) return res.status(402).json({ success: false, needsPayment: true, credits: 0 });
      const idPaid = await getKVInt(kvUrl, kvToken, `scans:${key}:id_paid_left`);
      if (idPaid > 0) {
        await setKV(kvUrl, kvToken, `scans:${key}:id_paid_left`, idPaid - 1);
        return res.status(200).json({ success: true, credits: idPaid - 1 });
      }
      return res.status(402).json({ success: false, needsPayment: true, credits: 0 });
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

    // ── add: grant credits (called by webhook) ──
    if (action === 'add') {
      const n = parseInt(amount) || 1;
      if (hasKV) {
        const current = await getKVInt(kvUrl, kvToken, `scans:${key}:paid_left`);
        await setKV(kvUrl, kvToken, `scans:${key}:paid_left`, current + n);
        return res.status(200).json({ success: true, credits: current + n });
      }
      return res.status(200).json({ success: true, credits: n });
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
