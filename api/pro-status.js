import { verifyTokenFlexible } from './_verifyToken.js';
// /api/pro-status — Check Pro status + scan credits for a Google user
// GET (Authorization: Bearer <google_id_token>)
// Returns: { isPro, status, freeScansLeft, paidScansLeft, totalScansLeft, email }

// Per-tier monthly grants. Free tier grants require email verification
// (enforced above by grantEligible check). Kept in sync with api/_tier.js.
const TIER_GRADE_GRANT = { free: 1, pro: 15, pro_max: 40, ultimate: 100 };
const TIER_ID_GRANT    = { free: 5, pro: 30, pro_max: 80, ultimate: 250 };

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

  let isPro = false, proStatus = 'none', userTier = 'free';

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
        // Tier: new records include it explicitly; legacy records default to 'pro' when active.
        if (isPro) userTier = record.tier || 'pro';
      }
    } catch(e) { console.error('KV pro check error:', e); }
  }

  // 2. Fallback: check Stripe directly by email (only when KV missed).
  //
  // 2026-08-18: This path used to unconditionally overwrite `userTier` with
  // the Stripe price-derived tier, which caused a real bug: users on higher
  // grandfathered tiers (or god-mode grants) whose Stripe price didn't match
  // the current tier map would silently downgrade on any request where KV
  // path 1 didn't populate `isPro`. Now:
  //   - Only sets tier from Stripe when KV genuinely has no record.
  //   - Writes a `pro:{uid}` record back into KV so subsequent calls hit
  //     path 1 and stay consistent across devices.
  const kvHadRecord = (proStatus !== 'none');
  if (!isPro && !kvHadRecord && process.env.STRIPE_SECRET_KEY && userEmail) {
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
            const sub     = subData.data?.[0];
            isPro     = !!sub;
            proStatus = isPro ? 'active' : 'none';
            if (isPro) {
              // Derive tier from subscription metadata / price ID.
              const metaTier = sub.metadata?.tier;
              const priceId  = sub.items?.data?.[0]?.price?.id;
              const priceMap = {
                [process.env.STRIPE_PRICE_ID]:               'pro',
                [process.env.STRIPE_PRICE_ANNUAL_ID]:        'pro',
                [process.env.STRIPE_PRICE_PRO_MAX_MONTHLY]:  'pro_max',
                [process.env.STRIPE_PRICE_PRO_MAX_ANNUAL]:   'pro_max',
                [process.env.STRIPE_PRICE_ULTIMATE_MONTHLY]: 'ultimate',
                [process.env.STRIPE_PRICE_ULTIMATE_ANNUAL]:  'ultimate',
              };
              userTier = metaTier || priceMap[priceId] || 'pro';

              // Self-heal: write the pro:{uid} record so future calls hit KV
              // path 1 directly — keeps tier consistent across devices.
              if (kvUrl && kvToken) {
                const record = {
                  email: userEmail,
                  subscriptionId: sub.id,
                  status: 'active',
                  plan: metaTier ? `${metaTier}_${sub.items?.data?.[0]?.price?.recurring?.interval || 'monthly'}` : 'pro_monthly',
                  tier: userTier,
                  updatedAt: new Date().toISOString(),
                  note: 'auto-healed from Stripe fallback',
                };
                fetch(`${kvUrl}/set/${encodeURIComponent(`pro:${userSub}`)}`, {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${kvToken}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(JSON.stringify(record)),
                }).catch(() => {});
              }
            }
          }
        }
      }
    } catch(e) { console.error('Stripe fallback check error:', e); }
  }

  // 3. Get scan credits
  let freeScansLeft = 0, paidScansLeft = 0, freeScansUsed = 0, idPaidLeft = 0;
  let idFreeLeft = 0, idFreeUsed = 0;
  if (kvUrl && kvToken) {
    paidScansLeft = await getKVInt(kvUrl, kvToken, `scans:${userSub}:paid_left`);
    idPaidLeft    = await getKVInt(kvUrl, kvToken, `scans:${userSub}:id_paid_left`);

    // Grant buckets: paid tiers always get grants. Verified free users also
    // get a small recurring monthly grant (5 ID / 1 Grade). Unverified free
    // users get 0 — they must complete the email-verify flow first.
    // We compute emailVerified here so the grant check below can use it.
    let grantEligible = isPro;
    if (!grantEligible && userTier === 'free') {
      try {
        const vr = await fetch(`${kvUrl}/get/${encodeURIComponent(`email_verified:${userSub}`)}`, {
          headers: { Authorization: `Bearer ${kvToken}` },
        });
        if (vr.ok) {
          const vj = await vr.json().catch(() => null);
          if (vj && vj.result) grantEligible = true;
        }
      } catch(_) { /* fail closed */ }
    }

    if (grantEligible) {
      const stamp    = getMonthStamp();
      const gMonthly = TIER_GRADE_GRANT[userTier] || TIER_GRADE_GRANT.free || 0;
      const iMonthly = TIER_ID_GRANT[userTier]    || TIER_ID_GRANT.free    || 0;

      freeScansUsed   = await getKVInt(kvUrl, kvToken, `scans:${userSub}:free_used_${stamp}`);
      freeScansLeft   = Math.max(0, gMonthly - freeScansUsed);
      idFreeUsed      = await getKVInt(kvUrl, kvToken, `scans:${userSub}:id_free_used_${stamp}`);
      idFreeLeft      = Math.max(0, iMonthly - idFreeUsed);
    }

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

  return res.status(200).json({
    isPro,
    tier:   userTier,
    status: proStatus,
    email: userEmail,
    freeScansLeft,
    freeScansUsed,
    freeScansTotal: TIER_GRADE_GRANT[userTier] || 0,
    idFreeLeft,
    idFreeUsed,
    idFreeTotal: TIER_ID_GRANT[userTier] || 0,
    paidScansLeft,
    idPaidLeft,
    idCredits: idPaidLeft,
    totalScansLeft: freeScansLeft + paidScansLeft,
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
