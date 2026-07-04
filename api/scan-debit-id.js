import { verifyTokenFlexible } from './_verifyToken.js';

// /api/scan-debit-id — Deduct 1 ID scan credit after user confirms a candidate
// pick from the low-confidence scan picker. The main /api/scan endpoint refunds
// the credit when it returns candidates; this endpoint re-consumes it once the
// user has actually chosen an answer.
//
// POST { pickedCard: { card_name, card_number, ... } }  — pickedCard is echoed
//   back for the client; the server just does the debit and returns remaining.
// Authorization: Bearer <firebase_id_token>
// Returns: { ok: true, remaining: <int> }  |  { ok: false, error, needsPayment? }

const kvUrl   = process.env.KV_REST_API_URL;
const kvToken = process.env.KV_REST_API_TOKEN;

async function kvGetInt(key) {
  try {
    const r = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
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
async function kvSet(key, val) {
  return fetch(`${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(String(val))}`,
    { method: 'POST', headers: { Authorization: `Bearer ${kvToken}` } });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!idToken || idToken.length < 20) {
    return res.status(401).json({ ok: false, error: 'Sign in required.' });
  }

  let tokenInfo;
  try {
    tokenInfo = await verifyTokenFlexible(idToken);
  } catch(e) {
    return res.status(401).json({ ok: false, error: 'Invalid session. Sign in again.' });
  }
  const key = tokenInfo.uid || tokenInfo.email;
  if (!key) return res.status(401).json({ ok: false, error: 'No user identity.' });

  if (!kvUrl || !kvToken) {
    // KV not configured — treat as pass-through so local dev doesn't break.
    return res.status(200).json({ ok: true, remaining: 0, kv: false });
  }

  const cur = await kvGetInt(`scans:${key}:id_paid_left`);
  if (cur <= 0) {
    return res.status(402).json({ ok: false, error: 'No ID scan credits remaining.', needsPayment: true });
  }
  await kvSet(`scans:${key}:id_paid_left`, cur - 1);
  return res.status(200).json({ ok: true, remaining: cur - 1 });
}
