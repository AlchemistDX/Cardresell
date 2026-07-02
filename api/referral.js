// /api/referral — Dedicated referral endpoint
// GET  ?action=code&sub=<googleSub>          → get or generate referral code for user
// POST { action: 'claim', newUserSub, refCode } → claim a referral (called on first sign-in)
// POST { action: 'stats', sub }               → get referral count + total credits earned

const REFERRAL_REWARD = 5; // ID scan credits awarded to both parties

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

async function setKV(kvUrl, kvToken, key, value) {
  await fetch(`${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(String(value))}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${kvToken}` }
  });
}

function makeRefCode(sub) {
  // Deterministic 8-char code from Google sub
  return sub.replace(/\D/g, '').slice(0, 8).padEnd(8, '0');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return res.status(503).json({ error: 'Storage unavailable' });

  // ── GET: return user's referral code + stats ──
  if (req.method === 'GET') {
    const sub    = (req.query?.sub || '').trim();
    const action = (req.query?.action || 'code').trim();
    if (!sub) return res.status(400).json({ error: 'sub required' });

    const code    = makeRefCode(sub);
    const refKey  = `ref:${code}`;

    // Register code if not yet stored
    const existing = await fetch(`${kvUrl}/get/${encodeURIComponent(refKey)}`,
      { headers: { Authorization: `Bearer ${kvToken}` } });
    const exData = await existing.json();
    if (!exData.result) {
      await setKV(kvUrl, kvToken, refKey, sub);
    }

    if (action === 'stats') {
      const count   = await getKVInt(kvUrl, kvToken, `ref_count:${sub}`);
      const earned  = count * REFERRAL_REWARD;
      return res.status(200).json({ code, referralCount: count, creditsEarned: earned });
    }

    return res.status(200).json({ code });
  }

  // ── POST ──
  if (req.method === 'POST') {
    const { action, newUserSub, refCode } = req.body || {};

    // ── claim: new user redeems a referral code ──
    if (action === 'claim') {
      if (!newUserSub || !refCode) return res.status(400).json({ error: 'newUserSub and refCode required' });

      const claimKey = `ref_claimed:${newUserSub}`;
      const alreadyClaimed = await getKVInt(kvUrl, kvToken, claimKey);
      if (alreadyClaimed) return res.status(200).json({ success: false, reason: 'already_claimed' });

      // Look up owner
      const ownerRes  = await fetch(`${kvUrl}/get/${encodeURIComponent(`ref:${refCode}`)}`,
        { headers: { Authorization: `Bearer ${kvToken}` } });
      const ownerData = await ownerRes.json();
      const ownerSub  = ownerData.result;

      if (!ownerSub || ownerSub === newUserSub) {
        return res.status(200).json({ success: false, reason: 'invalid_code' });
      }

      // Credit both users
      const ownerIdKey  = `scans:${ownerSub}:id_paid_left`;
      const newUserKey  = `scans:${newUserSub}:id_paid_left`;
      const ownerCur    = await getKVInt(kvUrl, kvToken, ownerIdKey);
      const newUserCur  = await getKVInt(kvUrl, kvToken, newUserKey);
      const ownerCount  = await getKVInt(kvUrl, kvToken, `ref_count:${ownerSub}`);

      await Promise.all([
        setKV(kvUrl, kvToken, ownerIdKey,            ownerCur + REFERRAL_REWARD),
        setKV(kvUrl, kvToken, newUserKey,            newUserCur + REFERRAL_REWARD),
        setKV(kvUrl, kvToken, claimKey,              1),
        setKV(kvUrl, kvToken, `ref_count:${ownerSub}`, ownerCount + 1),
      ]);

      console.log(`REFERRAL_CLAIMED: code=${refCode} owner=${ownerSub} newUser=${newUserSub} +${REFERRAL_REWARD} each`);
      return res.status(200).json({ success: true, creditsAwarded: REFERRAL_REWARD });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).end();
}
