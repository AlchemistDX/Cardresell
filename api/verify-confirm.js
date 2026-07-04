import { verifyTokenFlexible } from './_verifyToken.js';

// /api/verify-confirm — Validate a 6-digit code and mark the user's email verified.
//
// POST { email: "someone@example.com", code: "123456" }
// Authorization: Bearer <firebase_id_token>
//
// Anti-abuse:
// - Bonus can only be granted once per uid  (signup_bonus:<uid>)
// - Bonus can only be granted once per email (email_bonus_claimed:<email>)
// - Attempts limited to 5 tries per code (verify_attempts:<uid>:<email>)

const MAX_ATTEMPTS = 5;
const ATTEMPT_TTL  = 10 * 60;

const kvUrl   = process.env.KV_REST_API_URL;
const kvToken = process.env.KV_REST_API_TOKEN;

async function kvSet(key, val, ttl) {
  const path = ttl
    ? `${kvUrl}/setex/${encodeURIComponent(key)}/${ttl}/${encodeURIComponent(String(val))}`
    : `${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(String(val))}`;
  return fetch(path, { method: 'POST', headers: { Authorization: `Bearer ${kvToken}` } });
}
async function kvGet(key) {
  const r = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${kvToken}` },
  });
  const d = await r.json();
  return d.result;
}
async function kvDel(key) {
  return fetch(`${kvUrl}/del/${encodeURIComponent(key)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${kvToken}` },
  });
}
async function kvIncr(key, ttl) {
  const r = await fetch(`${kvUrl}/incr/${encodeURIComponent(key)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${kvToken}` },
  });
  const d = await r.json();
  const count = parseInt(d.result || '0', 10);
  if (count === 1 && ttl) {
    await fetch(`${kvUrl}/expire/${encodeURIComponent(key)}/${ttl}`, {
      method: 'POST', headers: { Authorization: `Bearer ${kvToken}` },
    });
  }
  return count;
}

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

  let tokenInfo;
  try {
    tokenInfo = await verifyTokenFlexible(idToken);
  } catch(e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  const userSub = tokenInfo.uid || '';
  if (!userSub) return res.status(400).json({ error: 'Missing uid' });

  const email = normalizeEmail(req.body?.email);
  const code  = String(req.body?.code || '').trim();
  if (!email) return res.status(400).json({ error: 'Missing email' });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Code must be 6 digits' });

  if (!kvUrl || !kvToken) return res.status(500).json({ error: 'KV not configured' });

  // Attempt limit — protects against brute forcing the 6-digit code
  const attemptKey = `verify_attempts:${userSub}:${email}`;
  try {
    const attempts = await kvIncr(attemptKey, ATTEMPT_TTL);
    if (attempts > MAX_ATTEMPTS) {
      return res.status(429).json({ error: 'Too many attempts. Request a new code.' });
    }
  } catch(e) { /* non-fatal */ }

  // Fetch and check the code
  const codeKey = `verify_code:${userSub}:${email}`;
  let storedCode;
  try { storedCode = await kvGet(codeKey); }
  catch(e) { return res.status(500).json({ error: 'Could not read code' }); }

  if (!storedCode) return res.status(400).json({ error: 'Code expired. Request a new one.' });
  if (String(storedCode) !== code) return res.status(400).json({ error: 'Incorrect code' });

  // Code matches — burn it so it can't be reused
  await kvDel(codeKey);
  await kvDel(attemptKey);

  // Set the verified-override flag with the confirmed email
  const verifiedRecord = JSON.stringify({
    verifiedAt: new Date().toISOString(),
    email,
    via: 'code',
  });
  try {
    const setResp = await kvSet(`email_verified:${userSub}`, verifiedRecord);
    if (!setResp.ok) throw new Error('KV set failed');
  } catch(e) {
    console.error('verify-confirm KV set error:', e);
    return res.status(500).json({ error: 'Could not save verification' });
  }

  // Also track the current verified email so users can "change email" later:
  try { await kvSet(`verified_email:${userSub}`, email); } catch(e) {}

  // Bonus grant — must pass BOTH gates:
  //   1. signup_bonus:<uid> — same user can't re-claim after changing email
  //   2. email_bonus_claimed:<email> — same email can't bonus multiple accounts
  let bonusGranted = false;
  let bonusReason  = '';
  try {
    const userBonusKey  = `signup_bonus:${userSub}`;
    const emailBonusKey = `email_bonus_claimed:${email}`;
    const [userBonusRaw, emailBonusRaw] = await Promise.all([
      kvGet(userBonusKey),
      kvGet(emailBonusKey),
    ]);
    const userBonusGiven  = parseInt(userBonusRaw  || '0', 10);
    const emailBonusGiven = parseInt(emailBonusRaw || '0', 10);

    if (userBonusGiven) {
      bonusReason = 'already-granted-to-user';
    } else if (emailBonusGiven) {
      bonusReason = 'email-already-claimed';
    } else {
      // Grant: +10 ID scans, +1 AI Grade
      const getInt = async (k) => {
        const v = await kvGet(k);
        return parseInt(v || '0', 10) || 0;
      };
      const [idLeft, paidLeft] = await Promise.all([
        getInt(`scans:${userSub}:id_paid_left`),
        getInt(`scans:${userSub}:paid_left`),
      ]);
      const newIdLeft   = idLeft + 10;
      const newPaidLeft = paidLeft + 1;
      const [idRes, gradeRes] = await Promise.all([
        kvSet(`scans:${userSub}:id_paid_left`, newIdLeft),
        kvSet(`scans:${userSub}:paid_left`, newPaidLeft),
      ]);
      if (idRes.ok && gradeRes.ok) {
        await Promise.all([
          kvSet(userBonusKey, 1),
          kvSet(emailBonusKey, 1),
        ]);
        bonusGranted = true;
      } else {
        bonusReason = 'kv-write-failed';
      }
    }
  } catch(e) {
    console.error('verify-confirm bonus error:', e);
    bonusReason = 'error';
  }

  return res.status(200).json({
    ok: true,
    verified: true,
    email,
    bonusGranted,
    bonusReason,
    message: bonusGranted
      ? 'Verified. Sign-up bonus added: +10 ID scans, +1 AI Grade.'
      : (bonusReason === 'email-already-claimed'
          ? 'Verified. (That email already claimed a bonus on another account.)'
          : 'Verified.'),
  });
}
