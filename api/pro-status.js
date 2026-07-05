import { verifyTokenFlexible } from './_verifyToken.js';
// /api/pro-status — Check Pro status + scan credits for a Google user
// GET (Authorization: Bearer <google_id_token>)
// Returns: { isPro, tier, status, paidScansLeft, idPaidLeft, totalScansLeft, email }
//
// tier: 'free' | 'pro' | 'pro_plus'
//   Derived from record.plan on the KV pro:<uid> record:
//     - 'pro_monthly' / 'pro_annual'           → tier='pro'
//     - 'pro_plus_monthly' / 'pro_plus_annual' → tier='pro_plus'
//     - anything else / not-active             → tier='free'
//
// LEGACY FIELDS (kept for backwards-compat with older frontend builds):
//   freeScansLeft / freeScansUsed / freeScansTotal — always 0/0/0 now.
//   The old "10 free grade scans per month for Pro" system was removed and
//   replaced with unified rollover credits granted on billing anniversary
//   by the monthly-grant cron (see api/pro-monthly-grant.js).

// Kept for backwards-compat with any frontend still reading these fields.
// Do NOT re-enable the old monthly-free-scan path — Pro users now get their
// monthly allowance deposited into paid_left / id_paid_left directly.
const FREE_SCANS_PER_MONTH = 0;

// Tier configuration — used by /api/pro-monthly-grant to determine monthly
// grant amounts and rollover ceilings. Kept here so pro-status can also
// report the caps to the frontend if we ever want to show them.
const TIER_CONFIG = {
  free:     { monthlyIds: 0,   monthlyGrade: 0,  ceilingMonths: 0 },
  pro:      { monthlyIds: 50,  monthlyGrade: 20, ceilingMonths: 3 },
  pro_plus: { monthlyIds: 200, monthlyGrade: 75, ceilingMonths: 6 },
};

function tierFromPlan(plan) {
  if (plan === 'pro_plus_monthly' || plan === 'pro_plus_annual') return 'pro_plus';
  if (plan === 'pro_monthly'      || plan === 'pro_annual')      return 'pro';
  return 'free';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!idToken) return res.status(200).json({ isPro: false, status: 'none', freeScansLeft: 0, paidScansLeft: 0 });

  // ── FIXED: declare userSub, userEmail, emailVerified at function scope, assign inside try ──
  let userSub = '';
  let userEmail = '';
  let emailVerified = false;
  let signInProvider = '';
  let verifiedEmail = '';
  try {
    const tokenInfo = await verifyTokenFlexible(idToken);
    userSub        = tokenInfo.uid   || '';
    userEmail      = tokenInfo.email || '';
    emailVerified  = !!tokenInfo.emailVerified;
    signInProvider = tokenInfo.provider || '';
  } catch(e) {
    return res.status(200).json({ isPro: false, status: 'none', freeScansLeft: 0, paidScansLeft: 0, emailVerified: false });
  }

  if (!userSub) {
    return res.status(200).json({ isPro: false, status: 'none', freeScansLeft: 0, paidScansLeft: 0 });
  }

  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  let isPro = false, proStatus = 'none', proPlan = '', tier = 'free';

  // 1. Check KV for Pro status + plan (plan is used to derive tier)
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
        proPlan    = record.plan || '';
        if (isPro) tier = tierFromPlan(proPlan);
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
  // NOTE: Monthly Pro/Pro+ allowances are deposited directly into paid_left
  // and id_paid_left by /api/pro-monthly-grant on billing anniversary — no
  // separate "free monthly" pool anymore. Legacy freeScans* fields stay 0.
  let freeScansLeft = 0, paidScansLeft = 0, freeScansUsed = 0, idPaidLeft = 0;
  if (kvUrl && kvToken) {
    paidScansLeft = await getKVInt(kvUrl, kvToken, `scans:${userSub}:paid_left`);
    idPaidLeft    = await getKVInt(kvUrl, kvToken, `scans:${userSub}:id_paid_left`);

    // 3b. Check KV email_verified:<uid> override — universal verify flow.
    //     Bonus grant is handled EXCLUSIVELY by /api/verify-confirm (which enforces
    //     both per-account and per-email one-time gates). This endpoint only READS
    //     the verified state so the frontend can hide the verify banner.
    if (!emailVerified) {
      try {
        const vr = await fetch(`${kvUrl}/get/${encodeURIComponent(`email_verified:${userSub}`)}`, {
          headers: { Authorization: `Bearer ${kvToken}` },
        });
        const vd = await vr.json();
        if (vd.result) emailVerified = true;
      } catch(e) { /* non-fatal */ }
    }

    // 3c. Expose which email address was verified (for "Change email" UI).
    try {
      const er = await fetch(`${kvUrl}/get/${encodeURIComponent(`verified_email:${userSub}`)}`, {
        headers: { Authorization: `Bearer ${kvToken}` },
      });
      const ed = await er.json();
      if (ed.result) verifiedEmail = String(ed.result).replace(/^"|"$/g, '');
    } catch(e) { /* non-fatal */ }
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

  const tierCfg = TIER_CONFIG[tier];

  return res.status(200).json({
    isPro,
    tier,                    // 'free' | 'pro' | 'pro_plus' — NEW
    plan: proPlan,           // raw plan string from Stripe metadata — NEW
    status: proStatus,
    email: userEmail,
    // Legacy fields — always 0 now, kept for old frontend builds.
    freeScansLeft,
    freeScansUsed,
    freeScansTotal: FREE_SCANS_PER_MONTH,
    // Actual credit balances.
    paidScansLeft,
    idPaidLeft,
    idCredits: idPaidLeft,
    totalScansLeft: freeScansLeft + paidScansLeft,
    // Tier config exposed so frontend can show "X of Y left" if desired.
    tierMonthlyGradeCredits: tierCfg.monthlyGrade,
    tierMonthlyIdScans:      tierCfg.monthlyIds,
    tierCeilingMonths:       tierCfg.ceilingMonths,
    refCode,
    refRewarded,
    emailVerified,
    verifiedEmail,
    signInProvider,
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
