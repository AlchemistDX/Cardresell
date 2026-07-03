import { verifyTokenFlexible } from './_verifyToken.js';
// /api/pro-status — Check Pro status + scan credits for a Google user
// GET (Authorization: Bearer <google_id_token>)
// Returns: { isPro, status, freeScansLeft, paidScansLeft, totalScansLeft, email }

const FREE_SCANS_PER_MONTH = 10;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!idToken) return res.status(200).json({ isPro: false, status: 'none', freeScansLeft: 0, paidScansLeft: 0 });

  // ── FIXED: declare userSub and userEmail at function scope, assign inside try ──
  let userSub = '';
  let userEmail = '';
  try {
    const tokenInfo = await verifyTokenFlexible(idToken);
    userSub   = tokenInfo.uid   || '';
    userEmail = tokenInfo.email || '';
  } catch(e) {
    return res.status(200).json({ isPro: false, status: 'none', freeScansLeft: 0, paidScansLeft: 0 });
  }

  if (!userSub) {
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

  // 3. Get scan credits
  let freeScansLeft = 0, paidScansLeft = 0, freeScansUsed = 0, idPaidLeft = 0, isNewSignup = false;
  if (kvUrl && kvToken) {
    paidScansLeft = await getKVInt(kvUrl, kvToken, `scans:${userSub}:paid_left`);
    idPaidLeft    = await getKVInt(kvUrl, kvToken, `scans:${userSub}:id_paid_left`);
    if (isPro) {
      const monthKey = `scans:${userSub}:free_used_${getMonthStamp()}`;
      freeScansUsed = await getKVInt(kvUrl, kvToken, monthKey);
      freeScansLeft = Math.max(0, FREE_SCANS_PER_MONTH - freeScansUsed);
    }

    // 4. Sign-up bonus — gift 10 ID credits + 1 Grader credit on first sign-in ever
    const bonusKey   = `signup_bonus:${userSub}`;
    const bonusGiven = await getKVInt(kvUrl, kvToken, bonusKey);
    if (!bonusGiven) {
      try {
        const newIdLeft   = idPaidLeft + 10;
        const newPaidLeft = paidScansLeft + 1;
        const kvSet = (key, val) => fetch(
          `${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(String(val))}`,
          { method: 'POST', headers: { Authorization: `Bearer ${kvToken}` } }
        );
        const [idRes, gradeRes] = await Promise.all([
          kvSet(`scans:${userSub}:id_paid_left`, newIdLeft),
          kvSet(`scans:${userSub}:paid_left`, newPaidLeft),
        ]);
        if (idRes.ok && gradeRes.ok) {
          await kvSet(bonusKey, 1);
          idPaidLeft    = newIdLeft;
          paidScansLeft = newPaidLeft;
          isNewSignup   = true;
          console.log(`Sign-up bonus granted to ${userSub}: 10 ID + 1 Grade`);
        }
      } catch(e) { console.error('Sign-up bonus error:', e); }
    }
  } else if (isPro) {
    freeScansLeft = FREE_SCANS_PER_MONTH;
  }

  // 5. Referral code (deterministic)
  const refCode = userSub.replace(/\D/g, '').slice(0, 8) || userSub.slice(0, 8);
  const refKey  = `ref:${refCode}`;

  if (kvUrl && kvToken) {
    try {
      const existing = await fetch(`${kvUrl}/get/${encodeURIComponent(refKey)}`,
        { headers: { Authorization: `Bearer ${kvToken}` } });
      const exData = await existing.json();
      if (!exData.result) {
        await fetch(
          `${kvUrl}/set/${encodeURIComponent(refKey)}/${encodeURIComponent(userSub)}`,
          { method: 'POST', headers: { Authorization: `Bearer ${kvToken}` } }
        );
      }
    } catch(e) { console.error('Ref code register error:', e); }
  }

  // 6. Incoming referral claim
  let refRewarded = false;
  const incomingRef = (req.query?.ref || '').trim().slice(0, 16);
  if (incomingRef && kvUrl && kvToken) {
    const claimKey = `ref_claimed:${userSub}`;
    try {
      const claimed = await getKVInt(kvUrl, kvToken, claimKey);
      if (!claimed) {
        const ownerRes  = await fetch(`${kvUrl}/get/${encodeURIComponent(`ref:${incomingRef}`)}`,
          { headers: { Authorization: `Bearer ${kvToken}` } });
        const ownerData = await ownerRes.json();
        const ownerSub  = ownerData.result;
        if (ownerSub && ownerSub !== userSub) {
          const kvSet = (key, val) => fetch(
            `${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(String(val))}`,
            { method: 'POST', headers: { Authorization: `Bearer ${kvToken}` } }
          );
          const ownerCurrent = await getKVInt(kvUrl, kvToken, `scans:${ownerSub}:id_paid_left`);
          await Promise.all([
            kvSet(`scans:${ownerSub}:id_paid_left`, ownerCurrent + 5),
            kvSet(`scans:${userSub}:id_paid_left`,  idPaidLeft + 5),
            kvSet(claimKey, 1),
          ]);
          idPaidLeft  += 5;
          refRewarded  = true;
          console.log(`Referral: ${incomingRef} → owner ${ownerSub} +5, new user ${userSub} +5`);
        }
      }
    } catch(e) { console.error('Ref claim error:', e); }
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
    idCredits: idPaidLeft,
    totalScansLeft: freeScansLeft + paidScansLeft,
    refCode,
    refRewarded,
    isNewSignup,
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
