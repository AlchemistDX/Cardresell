// /api/pro-status — Check Pro status + scan credits for a Google user
// GET (Authorization: Bearer <google_id_token>)
// Returns: { isPro, status, freeScansLeft, paidScansLeft, totalScansLeft, email }

const FREE_SCANS_PER_MONTH    = 10; // Grade scans/mo for Pro
const FREE_ID_SCANS_PER_MONTH = 20; // Card Lookup scans/mo for Pro

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!idToken) return res.status(200).json({ isPro: false, status: 'none', freeScansLeft: 0, paidScansLeft: 0 });

  let userSub, userEmail;
  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
    if (!r.ok) return res.status(200).json({ isPro: false, status: 'none', freeScansLeft: 0, paidScansLeft: 0 });
    const info = await r.json();
    if (info.aud !== '971593505703-6feq3nn7p9580krori6r157rfm5tp88l.apps.googleusercontent.com')
      return res.status(200).json({ isPro: false, status: 'none', freeScansLeft: 0, paidScansLeft: 0 });
    userSub   = info.sub;
    userEmail = info.email;
  } catch(e) {
    return res.status(200).json({ isPro: false, status: 'none', freeScansLeft: 0, paidScansLeft: 0 });
  }

  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  let isPro = false, proStatus = 'none';

  // 1. Check KV for Pro status
  if (kvUrl && kvToken) {
    try {
      const r = await fetch(`${kvUrl}/get/${encodeURIComponent(`pro:${userSub}`)}`, {
        headers: { Authorization: `Bearer ${kvToken}` },
      });
      const data = await r.json();
      if (data.result) {
        const record = JSON.parse(data.result);
        isPro      = record.status === 'active';
        proStatus  = record.status;
      }
    } catch(e) { console.error('KV pro check error:', e); }
  }

  // 2. Fallback: check Stripe directly by email
  if (!isPro && process.env.STRIPE_SECRET_KEY && userEmail) {
    try {
      const custRes = await fetch(
        `https://api.stripe.com/v1/customers/search?query=email:'${encodeURIComponent(userEmail)}'&limit=1`,
        { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } }
      );
      if (custRes.ok) {
        const custData = await custRes.json();
        const customer = custData.data?.[0];
        if (customer) {
          const subRes = await fetch(
            `https://api.stripe.com/v1/subscriptions?customer=${customer.id}&status=active&limit=1`,
            { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } }
          );
          if (subRes.ok) {
            const subData = await subRes.json();
            isPro     = (subData.data?.length || 0) > 0;
            proStatus = isPro ? 'active' : 'none';
          }
        }
      }
    } catch(e) { console.error('Stripe fallback check error:', e); }
  }

  // 3. Get scan credits — always fetch paid credits; free credits only for Pro
  let freeScansLeft = 0, paidScansLeft = 0, freeScansUsed = 0, idPaidLeft = 0;
  let idFreeScansLeft = 0, idFreeScansUsed = 0;
  if (kvUrl && kvToken) {
    // Always check paid credits (any user who bought a scan)
    paidScansLeft = await getKVInt(kvUrl, kvToken, `scans:${userSub}:paid_left`);
    idPaidLeft    = await getKVInt(kvUrl, kvToken, `scans:${userSub}:id_paid_left`);
    if (isPro) {
      const stamp    = getMonthStamp();
      freeScansUsed = await getKVInt(kvUrl, kvToken, `scans:${userSub}:free_used_${stamp}`);
      freeScansLeft = Math.max(0, FREE_SCANS_PER_MONTH - freeScansUsed);
      idFreeScansUsed = await getKVInt(kvUrl, kvToken, `scans:${userSub}:id_free_used_${stamp}`);
      idFreeScansLeft = Math.max(0, FREE_ID_SCANS_PER_MONTH - idFreeScansUsed);
    }
  } else if (isPro) {
    // No KV — give full free allowance
    freeScansLeft   = FREE_SCANS_PER_MONTH;
    idFreeScansLeft = FREE_ID_SCANS_PER_MONTH;
  }

  return res.status(200).json({
    isPro,
    status: proStatus,
    email: userEmail,
    freeScansLeft,
    freeScansUsed,
    freeScansTotal: FREE_SCANS_PER_MONTH,
    paidScansLeft,
    idPaidLeft,
    idFreeScansLeft,
    idFreeScansUsed,
    idFreeScansTotal: FREE_ID_SCANS_PER_MONTH,
    totalScansLeft:   freeScansLeft + paidScansLeft,
    totalIdScansLeft: idFreeScansLeft + idPaidLeft,
  });
}

function getMonthStamp() {
  const d = new Date();
  return `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function getKVInt(kvUrl, kvToken, key) {
  try {
    const r = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    const data = await r.json();
    return parseInt(data.result) || 0;
  } catch(e) { return 0; }
}
