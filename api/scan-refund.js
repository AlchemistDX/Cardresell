import { verifyTokenFlexible } from './_verifyToken.js';

// POST /api/scan-refund
// Body: { scan_id, reason?: 'wrong_card' | 'glare' | 'other', note?: string }
// Auth: Bearer <google_id_token>
//
// Purpose: refund a scan credit when the user tells us the identification was
// wrong. The frontend surfaces this as a small "❌ Not my card — refund credit"
// link under the scan result. This complements the automatic refund path that
// already fires when the AI itself reports low/medium confidence with multiple
// candidates.
//
// Fraud controls:
//   - scan_id is opaque + short-TTL (1 hour) — you can't refund yesterday's scans
//   - Idempotent: refunding the same scan_id twice is a no-op
//   - Ownership check: the record's uid must match the caller's uid
//   - Rate limit: max 3 refunds per rolling 24 hours per uid
//   - All refunds logged for audit (scan_refund:{scan_id})
//
// Response: { success: true, credits_refunded: N, remaining_refunds_today: M }
//        or { error: '...', reason_code: '...' } on failure.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Auth ──
  const idToken   = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  const bodyEmail = req.body?.email || '';
  const bodySub   = req.body?.googleSub || '';

  let userEmail = bodyEmail;
  let googleSub = bodySub;

  if (idToken && idToken.length > 20) {
    try {
      const tokenInfo = await verifyTokenFlexible(idToken);
      googleSub = tokenInfo.uid   || googleSub;
      userEmail = tokenInfo.email || userEmail;
    } catch(e) { /* proceed with body values */ }
  }

  if (!userEmail) {
    return res.status(401).json({ error: 'Sign in with Google to request a refund.' });
  }

  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  const hasKV   = !!(kvUrl && kvToken);
  if (!hasKV) {
    return res.status(503).json({ error: 'Refund system temporarily unavailable. Please try again.' });
  }

  const uid = googleSub || userEmail;
  const { scan_id, reason, note } = req.body || {};

  if (!scan_id || typeof scan_id !== 'string' || scan_id.length < 8 || scan_id.length > 64) {
    return res.status(400).json({ error: 'Invalid scan_id.', reason_code: 'bad_scan_id' });
  }

  // ── 2. Load scan record ──
  const record = await getKVJson(kvUrl, kvToken, `scan:${scan_id}`);
  if (!record) {
    return res.status(404).json({
      error: 'This scan is no longer refundable — it may have already been refunded, or it expired (refunds are available for 1 hour after scanning).',
      reason_code: 'not_found',
    });
  }

  // ── 3. Ownership check ──
  if (record.uid !== uid) {
    return res.status(403).json({ error: 'This scan does not belong to your account.', reason_code: 'ownership' });
  }

  // ── 4. Idempotency: already refunded? ──
  const alreadyRefunded = await getKVJson(kvUrl, kvToken, `scan_refund:${scan_id}`);
  if (alreadyRefunded) {
    return res.status(200).json({
      success: true,
      alreadyRefunded: true,
      credits_refunded: 0,
      message: 'This scan was already refunded.',
    });
  }

  // ── 5. Rate limit: 3 refunds / 24h rolling ──
  const RATE_LIMIT   = 3;
  const RATE_WINDOW  = 24 * 60 * 60; // seconds
  const rateKey      = `scan_refund_count:${uid}`;
  const currentCount = await getKVInt(kvUrl, kvToken, rateKey);
  if (currentCount >= RATE_LIMIT) {
    return res.status(429).json({
      error: `You've hit today's refund cap (${RATE_LIMIT} per 24 hours). If a scan really was wrong, message support@cardresell.org and we'll sort it out.`,
      reason_code: 'rate_limited',
      cap: RATE_LIMIT,
    });
  }

  // ── 6. Refund the credit to the same bucket it was consumed from ──
  const { consumed_from, consumed_amount } = record;
  const amt = Math.max(1, Number(consumed_amount) || 1);

  try {
    if (consumed_from === 'id_paid_left') {
      const cur = await getKVInt(kvUrl, kvToken, `scans:${uid}:id_paid_left`);
      await setKV(kvUrl, kvToken, `scans:${uid}:id_paid_left`, cur + amt);
    } else if (consumed_from === 'paid_left') {
      const cur = await getKVInt(kvUrl, kvToken, `scans:${uid}:paid_left`);
      await setKV(kvUrl, kvToken, `scans:${uid}:paid_left`, cur + amt);
    } else if (consumed_from === 'free') {
      const stamp = getMonthStamp();
      const cur   = await getKVInt(kvUrl, kvToken, `scans:${uid}:free_used_${stamp}`);
      await setKV(kvUrl, kvToken, `scans:${uid}:free_used_${stamp}`, Math.max(0, cur - amt));
    } else {
      // Unknown source — refuse rather than credit a wrong bucket
      return res.status(500).json({ error: 'Refund source unknown — contact support.', reason_code: 'bad_source' });
    }
  } catch(e) {
    console.error('scan-refund credit restore failed:', e);
    return res.status(500).json({ error: 'Refund failed. Please try again.', reason_code: 'restore_failed' });
  }

  // ── 7. Log the refund for audit + fraud analysis ──
  const auditRecord = {
    scan_id,
    uid,
    email:            userEmail,
    reason:           reason || 'unspecified',
    note:             (note || '').toString().slice(0, 500),
    original_card:    record.card_name || '',
    original_confidence: record.confidence || '',
    original_quality: record.image_quality || '',
    consumed_from,
    refunded_amount:  amt,
    refunded_at:      Date.now(),
  };
  try {
    // Keep refund audit records for 30 days
    await setKVWithTTL(kvUrl, kvToken, `scan_refund:${scan_id}`, JSON.stringify(auditRecord), 30 * 24 * 3600);
    // Increment rate-limit counter with 24h TTL (Upstash SET+EX resets the window on new keys)
    const newCount = currentCount + 1;
    await setKVWithTTL(kvUrl, kvToken, rateKey, String(newCount), RATE_WINDOW);
    // Log line for offline aggregation
    console.log('SCAN_REFUND:', JSON.stringify({ scan_id, uid, reason, original_card: record.card_name, confidence: record.confidence }));
  } catch(e) { /* non-fatal */ }

  // ── 8. Delete the original scan record so it can't be refunded again ──
  try { await delKV(kvUrl, kvToken, `scan:${scan_id}`); } catch(e) {}

  return res.status(200).json({
    success: true,
    credits_refunded:       amt,
    remaining_refunds_today: Math.max(0, RATE_LIMIT - (currentCount + 1)),
  });
}

// ── KV helpers (mirror api/scan.js) ──
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
    const raw = d.result;
    if (raw === null || raw === undefined) return 0;
    if (typeof raw === 'string' && raw.startsWith('[')) {
      try { return parseInt(JSON.parse(raw)[0]) || 0; } catch(e) {}
    }
    return parseInt(raw) || 0;
  } catch(e) { return 0; }
}

async function getKVJson(kvUrl, kvToken, key) {
  try {
    const r = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const d = await r.json();
    if (!d.result) return null;
    try { return JSON.parse(d.result); } catch(e) { return null; }
  } catch(e) { return null; }
}

async function setKV(kvUrl, kvToken, key, value) {
  try {
    await fetch(`${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(String(value))}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` }
    });
  } catch(e) {}
}

async function setKVWithTTL(kvUrl, kvToken, key, value, ttlSeconds) {
  try {
    await fetch(`${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(String(value))}?EX=${ttlSeconds}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` }
    });
  } catch(e) {}
}

async function delKV(kvUrl, kvToken, key) {
  try {
    await fetch(`${kvUrl}/del/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` }
    });
  } catch(e) {}
}
