// Shared tier resolution + grant table for CardResell subscription tiers.
//
// Tiers are stored in KV under `pro:<googleSub>` as JSON:
//   { email, subscriptionId, status: 'active'|'cancelled', plan?, tier?, updatedAt }
//
// - `tier`  — new field (2026-08-17+). One of: 'pro' | 'pro_max' | 'ultimate'.
//             Absent on legacy Pro records → default to 'pro' for back-compat.
// - `plan`  — legacy field (e.g. 'pro_monthly', 'pro_annual'). Retained for
//             observability but no longer drives credit grants.
//
// getUserTier() is the single source of truth for "what tier is this user on?"
// used by scan.js, scan-credits.js, and any future tier-gated endpoint.

export const TIER_BENEFITS = {
  free: {
    gradeGrant:    0,
    idGrant:       0,
    topupDiscount: 0,     // percent off top-ups
    couponId:      null,
  },
  pro: {
    gradeGrant:    10,
    idGrant:       20,
    topupDiscount: 10,
    couponId:      'PRO_TOPUP_10',
  },
  pro_max: {
    gradeGrant:    25,
    idGrant:       50,
    topupDiscount: 15,
    couponId:      'MAX_TOPUP_15',
  },
  ultimate: {
    gradeGrant:    60,
    idGrant:       150,
    topupDiscount: 25,
    couponId:      'ULTIMATE_TOPUP_25',
  },
};

// Map Stripe subscription price IDs → tier name.
// Populated from env vars so the same code works across preview/prod without a
// hardcoded price ID list.
export function priceIdToTier(priceId) {
  if (!priceId) return null;
  const map = {
    [process.env.STRIPE_PRICE_ID]:               'pro',
    [process.env.STRIPE_PRICE_ANNUAL_ID]:        'pro',
    [process.env.STRIPE_PRICE_PRO_MAX_MONTHLY]:  'pro_max',
    [process.env.STRIPE_PRICE_PRO_MAX_ANNUAL]:   'pro_max',
    [process.env.STRIPE_PRICE_ULTIMATE_MONTHLY]: 'ultimate',
    [process.env.STRIPE_PRICE_ULTIMATE_ANNUAL]:  'ultimate',
  };
  return map[priceId] || null;
}

// Resolve a user's current tier. Preferred fast path: KV lookup on
// pro:<googleSub>. Falls back to Stripe API by email when KV is unavailable
// or has no record for this user (parity with legacy checkProStatus flow).
//
// Returns: 'free' | 'pro' | 'pro_max' | 'ultimate'
export async function getUserTier(stripeKey, kvUrl, kvToken, googleSub, email) {
  // Fast path — KV
  if (kvUrl && kvToken && googleSub) {
    try {
      const r = await fetch(`${kvUrl}/get/${encodeURIComponent(`pro:${googleSub}`)}`, {
        headers: { Authorization: `Bearer ${kvToken}` },
      });
      const d = await r.json();
      if (d.result) {
        const rec = JSON.parse(d.result);
        if (rec.status === 'active') {
          // New records include `tier`. Legacy records don't — default to 'pro'.
          if (rec.tier && TIER_BENEFITS[rec.tier]) return rec.tier;
          return 'pro';
        }
      }
    } catch (e) { /* fall through */ }
  }

  // Fallback — hit Stripe. Look up latest active subscription for this email
  // and derive tier from its price ID. Slower but keeps things working if the
  // webhook hasn't yet written the KV record.
  if (!stripeKey || !email) return 'free';
  try {
    const custR = await fetch(
      `https://api.stripe.com/v1/customers/search?query=email:"${email}"&limit=1`,
      { headers: { Authorization: `Bearer ${stripeKey}` } }
    );
    if (!custR.ok) return 'free';
    const custD = await custR.json();
    const cust  = custD.data?.[0];
    if (!cust) return 'free';

    const subR = await fetch(
      `https://api.stripe.com/v1/subscriptions?customer=${cust.id}&status=active&limit=1`,
      { headers: { Authorization: `Bearer ${stripeKey}` } }
    );
    const subD = await subR.json();
    const sub  = subD.data?.[0];
    if (!sub) return 'free';

    // Prefer explicit metadata (set by our new checkout endpoint) →
    // then derive from price ID (works for legacy Pro subs).
    const metadataTier = sub.metadata?.tier;
    if (metadataTier && TIER_BENEFITS[metadataTier]) return metadataTier;

    const priceId = sub.items?.data?.[0]?.price?.id;
    return priceIdToTier(priceId) || 'pro'; // any active sub with unknown price → assume Pro
  } catch (e) {
    return 'free';
  }
}

// Convenience: returns true if the tier is any paid tier (used by legacy
// code paths that only care about paid-vs-free).
export function isPaidTier(tier) {
  return tier === 'pro' || tier === 'pro_max' || tier === 'ultimate';
}
