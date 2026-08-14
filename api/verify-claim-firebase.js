import { verifyTokenFlexible } from './_verifyToken.js';

// /api/verify-claim-firebase — Grant sign-up bonus after user clicked the
// Firebase email-verification link. Reads the fresh Firebase ID token's
// email_verified claim; if true, grants the same +10 ID / +1 Grade bonus
// with the same one-per-account + one-per-email gates as /api/verify-confirm.
//
// POST (body ignored)
// Authorization: Bearer <firebase_id_token>  (must be freshly refreshed
//   after the user clicks the verification link so email_verified=true)

const kvUrl   = process.env.KV_REST_API_URL;
const kvToken = process.env.KV_REST_API_TOKEN;

async function kvSet(key, val) {
  return fetch(`${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(String(val))}`,
    { method: 'POST', headers: { Authorization: `Bearer ${kvToken}` } });
}
async function kvGet(key) {
  const r = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${kvToken}` } });
  const d = await r.json();
  return d.result;
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

  // ---- Cloudflare Turnstile bot check (2026-08-14) ---------------------
  // Extra fraud layer for the signup-bonus grant. If TURNSTILE_SECRET_KEY
  // is set in env, require a valid token from the /claim-scans button. If
  // not set, we soft-skip (dev/local), so this is safe to deploy before
  // the env var is populated — protection kicks in the moment you add the
  // key in the Vercel dashboard.
  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  if (turnstileSecret) {
    const body = (req.body && typeof req.body === 'object') ? req.body : (() => { try { return JSON.parse(req.body || '{}'); } catch(e) { return {}; } })();
    const tsToken = body.turnstileToken || req.headers['x-turnstile-token'];
    if (!tsToken) {
      return res.status(400).json({ error: 'Bot check failed', code: 'no_turnstile_token' });
    }
    try {
      const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: turnstileSecret,
          response: String(tsToken),
          // Best-effort remote IP (Vercel proxies via x-forwarded-for)
          remoteip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim(),
        }),
      });
      const verifyJson = await verifyRes.json();
      if (!verifyJson.success) {
        return res.status(400).json({
          error: 'Bot check failed',
          code: 'turnstile_rejected',
          codes: verifyJson['error-codes'] || [],
        });
      }
    } catch(e) {
      // If Cloudflare itself is unreachable, fail closed — attackers could
      // otherwise nullify Turnstile by DoS-ing challenges.cloudflare.com
      // paths. Real users retry.
      return res.status(503).json({ error: 'Bot check unavailable, try again', code: 'turnstile_unreachable' });
    }
  }
  // ---------------------------------------------------------------------

  let tokenInfo;
  try {
    tokenInfo = await verifyTokenFlexible(idToken);
  } catch(e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  const userSub = tokenInfo.uid || '';
  const email   = normalizeEmail(tokenInfo.email);
  if (!userSub) return res.status(400).json({ error: 'Missing uid' });
  if (!email)   return res.status(400).json({ error: 'Missing email on token' });

  // Require Firebase to have marked the email verified. If false, the user
  // hasn't clicked the link yet (or their token is stale — the frontend must
  // call user.getIdToken(true) AFTER the click to refresh the claim).
  if (!tokenInfo.email_verified) {
    return res.status(400).json({
      error: 'Email not yet verified. Tap the link in your inbox, then try again.',
      code: 'not_verified',
    });
  }

  if (!kvUrl || !kvToken) return res.status(500).json({ error: 'KV not configured' });

  // Set the verified-override flag with the confirmed email
  try {
    await kvSet(`email_verified:${userSub}`, JSON.stringify({
      verifiedAt: new Date().toISOString(),
      email,
      via: 'firebase_link',
    }));
    await kvSet(`verified_email:${userSub}`, email);
  } catch(e) { /* non-fatal */ }

  // Bonus grant — same gates as /api/verify-confirm
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
      const getInt = async (k) => {
        const v = await kvGet(k);
        return parseInt(v || '0', 10) || 0;
      };
      const [idLeft, paidLeft] = await Promise.all([
        getInt(`scans:${userSub}:id_paid_left`),
        getInt(`scans:${userSub}:paid_left`),
      ]);
      const [idRes, gradeRes] = await Promise.all([
        kvSet(`scans:${userSub}:id_paid_left`, idLeft + 10),
        kvSet(`scans:${userSub}:paid_left`,    paidLeft + 1),
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
    console.error('verify-claim-firebase bonus error:', e);
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
