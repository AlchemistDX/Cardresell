import { verifyTokenFlexible } from './_verifyToken.js';

// /api/verify-send — Send a 6-digit verification code to any email
//
// POST { email: "someone@example.com" }
// Authorization: Bearer <firebase_id_token>
//
// - User must be signed in (any provider: google, apple, password, anonymous).
// - Any email address may be entered — not restricted to the token's email.
// - Rate limits: 5 sends per user per hour, 5 sends per email per hour.
// - Code is 6 digits, valid for 10 minutes.

const CODE_TTL_SEC     = 10 * 60;       // 10 minutes
const RATE_LIMIT_TTL   = 60 * 60;       // 1 hour
const MAX_SENDS_PER_HR = 5;

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
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
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
    console.error('verify-send token error:', e && e.message, 'tokenLen=', idToken.length);
    return res.status(401).json({ error: 'Invalid token', detail: (e && e.message) || 'unknown' });
  }
  const userSub = tokenInfo.uid || '';
  if (!userSub) return res.status(400).json({ error: 'Missing uid' });

  const email = normalizeEmail(req.body?.email);
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email' });

  if (!kvUrl || !kvToken) return res.status(500).json({ error: 'KV not configured' });

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return res.status(500).json({ error: 'Email transport not configured' });

  // Rate limits: per-user AND per-email
  try {
    const userHits = await kvIncr(`verify_rate:user:${userSub}`, RATE_LIMIT_TTL);
    if (userHits > MAX_SENDS_PER_HR) {
      return res.status(429).json({ error: 'Too many verification attempts. Try again in an hour.' });
    }
    const emailHits = await kvIncr(`verify_rate:email:${email}`, RATE_LIMIT_TTL);
    if (emailHits > MAX_SENDS_PER_HR) {
      return res.status(429).json({ error: 'Too many codes sent to that email. Try again in an hour.' });
    }
  } catch(e) { /* non-fatal — proceed */ }

  // Generate and store the code (keyed by uid + email so different emails don't collide)
  const code = genCode();
  const codeKey = `verify_code:${userSub}:${email}`;
  try {
    const setResp = await kvSet(codeKey, code, CODE_TTL_SEC);
    if (!setResp.ok) throw new Error('KV set failed');
  } catch(e) {
    console.error('verify-send KV error:', e);
    return res.status(500).json({ error: 'Could not save code. Try again.' });
  }

  // Send via Resend
  const displayName = tokenInfo.name || (email.split('@')[0]) || 'there';
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0a0a0a;color:#fff;border-radius:12px">
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:22px;font-weight:800;color:#d4af37;letter-spacing:-.5px">CardResell</div>
      </div>
      <div style="background:#111;border:1px solid #222;border-radius:10px;padding:20px;text-align:center">
        <div style="font-size:14px;color:#aaa;margin-bottom:8px">Your verification code</div>
        <div style="font-size:36px;font-weight:900;letter-spacing:8px;color:#d4af37;font-family:'SF Mono',Menlo,monospace">${code}</div>
        <div style="font-size:12px;color:#666;margin-top:12px">Expires in 10 minutes</div>
      </div>
      <div style="margin-top:20px;font-size:13px;color:#aaa;line-height:1.5">
        Hi ${displayName.replace(/[<>&"']/g, '')} — enter this code in the CardResell app to verify your email and unlock your <strong style="color:#d4af37">+10 ID scans and +1 AI Grade</strong> signup bonus.
      </div>
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid #222;font-size:11px;color:#555;text-align:center">
        Didn't request this? You can safely ignore this email.
      </div>
    </div>`;

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'CardResell <onboarding@resend.dev>',
        to: email,
        subject: `Your CardResell verification code: ${code}`,
        html,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error('Resend error:', resp.status, errText);
      return res.status(502).json({ error: 'Email send failed. Try again.' });
    }
  } catch(e) {
    console.error('verify-send fetch error:', e);
    return res.status(502).json({ error: 'Email send failed. Try again.' });
  }

  return res.status(200).json({ ok: true, email, ttlSeconds: CODE_TTL_SEC });
}
