// /api/scan-credits — Get and update free graded scan credits for a Pro user
// GET  → returns { freeScansUsed, freeScansTotal, freeScansLeft, isPro }
// POST { action: 'use' } → decrements free scan count, returns updated state
// POST { action: 'add', amount: N } → adds paid scans (called after webhook confirms payment)

const FREE_SCANS_PER_MONTH = 5;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Verify Google ID token
  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!idToken) return res.status(401).json({ error: 'Not signed in.' });

  let userSub, userEmail;
  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
    if (!r.ok) return res.status(401).json({ error: 'Invalid session.' });
    const info = await r.json();
    const expectedClientId = '971593505703-6feq3nn7p9580krori6r157rfm5tp88l.apps.googleusercontent.com';
    if (info.aud !== expectedClientId) return res.status(401).json({ error: 'Unauthorized.' });
    userSub   = info.sub;
    userEmail = info.email;
  } catch(e) {
    return res.status(401).json({ error: 'Could not verify sign-in.' });
  }

  const kvUrl   = process.env.VERCEL_KV_REST_API_URL;
  const kvToken = process.env.VERCEL_KV_REST_API_TOKEN;

  // Check Pro status
  const proRecord = await getKV(kvUrl, kvToken, `pro:${userSub}`);
  const isPro = proRecord?.status === 'active';

  // Get current month key — resets automatically each month
  const monthKey = `scans:${userSub}:${getMonthStamp()}`;

  if (req.method === 'GET') {
    const freeScansUsed = await getKVInt(kvUrl, kvToken, monthKey + ':free_used');
    const paidScansLeft = await getKVInt(kvUrl, kvToken, `scans:${userSub}:paid_left`);
    const freeScansLeft = Math.max(0, FREE_SCANS_PER_MONTH - freeScansUsed);

    return res.status(200).json({
      isPro,
      freeScansUsed,
      freeScansTotal: FREE_SCANS_PER_MONTH,
      freeScansLeft,
      paidScansLeft,
      totalScansLeft: freeScansLeft + paidScansLeft,
    });
  }

  if (req.method === 'POST') {
    const { action, amount } = req.body || {};

    if (action === 'use') {
      // Use a free scan (called when scan starts)
      const freeScansUsed = await getKVInt(kvUrl, kvToken, monthKey + ':free_used');
      const paidScansLeft = await getKVInt(kvUrl, kvToken, `scans:${userSub}:paid_left`);
      const freeScansLeft = Math.max(0, FREE_SCANS_PER_MONTH - freeScansUsed);

      if (freeScansLeft > 0) {
        // Use a free scan
        await incrKV(kvUrl, kvToken, monthKey + ':free_used');
        // Set expiry to end of next month so it auto-cleans
        await expireKV(kvUrl, kvToken, monthKey + ':free_used', 60 * 60 * 24 * 62);
        return res.status(200).json({
          success: true,
          charged: false,
          freeScansLeft: freeScansLeft - 1,
          paidScansLeft,
          message: `Free scan used. ${freeScansLeft - 1} free scans remaining this month.`,
        });
      } else if (paidScansLeft > 0) {
        // Use a paid scan credit
        await decrKV(kvUrl, kvToken, `scans:${userSub}:paid_left`);
        return res.status(200).json({
          success: true,
          charged: false,
          usedPaid: true,
          freeScansLeft: 0,
          paidScansLeft: paidScansLeft - 1,
          message: `Paid scan credit used. ${paidScansLeft - 1} paid scans remaining.`,
        });
      } else {
        // No scans left — needs to pay
        return res.status(402).json({
          success: false,
          needsPayment: true,
          freeScansLeft: 0,
          paidScansLeft: 0,
          message: 'No scans remaining. Purchase a scan for $1.50.',
        });
      }
    }

    if (action === 'add') {
      // Add paid scan credits (called after successful Stripe payment)
      const n = parseInt(amount) || 1;
      const current = await getKVInt(kvUrl, kvToken, `scans:${userSub}:paid_left`);
      await setKV(kvUrl, kvToken, `scans:${userSub}:paid_left`, current + n);
      return res.status(200).json({ success: true, paidScansLeft: current + n });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  }

  return res.status(405).end();
}

function getMonthStamp() {
  const d = new Date();
  return `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function getKV(kvUrl, kvToken, key) {
  if (!kvUrl || !kvToken) return null;
  try {
    const r = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    const data = await r.json();
    if (data.result) return JSON.parse(data.result);
  } catch(e) {}
  return null;
}

async function getKVInt(kvUrl, kvToken, key) {
  if (!kvUrl || !kvToken) return 0;
  try {
    const r = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    const data = await r.json();
    return parseInt(data.result) || 0;
  } catch(e) { return 0; }
}

async function setKV(kvUrl, kvToken, key, value) {
  if (!kvUrl || !kvToken) return;
  try {
    await fetch(`${kvUrl}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([String(value)]),
    });
  } catch(e) {}
}

async function incrKV(kvUrl, kvToken, key) {
  if (!kvUrl || !kvToken) return;
  try {
    await fetch(`${kvUrl}/incr/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` },
    });
  } catch(e) {}
}

async function decrKV(kvUrl, kvToken, key) {
  if (!kvUrl || !kvToken) return;
  try {
    await fetch(`${kvUrl}/decr/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` },
    });
  } catch(e) {}
}

async function expireKV(kvUrl, kvToken, key, seconds) {
  if (!kvUrl || !kvToken) return;
  try {
    await fetch(`${kvUrl}/expire/${encodeURIComponent(key)}/${seconds}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` },
    });
  } catch(e) {}
}
