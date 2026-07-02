// /api/admin.js
// Private admin stats endpoint — only Will's Google sub may call it.
// GET /api/admin?sub=<googleSub> → { proUsers, newsletters, referrals, scanRevenue }
// GET /api/admin?sub=<googleSub>&all=1 → adds allEmails[] (full subscriber list)

const KV_URL   = 'https://patient-dragon-155704.upstash.io';
const KV_TOKEN = 'gQAAAAAAAmA4AAIgcDIxZjgwYWU3ODEzOTM0NjdmYjlmZTNjZDE1MzExMjEwZQ';
const OWNER_SUB = '111904685934190351595';

async function kv(cmd, ...args) {
  const res = await fetch(`${KV_URL}/${[cmd, ...args].map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const json = await res.json();
  return json.result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sub = req.query?.sub || '';
  if (sub !== OWNER_SUB) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    // ── Newsletter subscribers ──
    const newsletterCount = await kv('ZCARD', 'newsletter:all');
    // Get most recent 10 emails
    const recentEmails = await kv('ZREVRANGE', 'newsletter:all', '0', '9');
    // If ?all=1, fetch the full subscriber list for CSV export
    const allEmails = req.query?.all === '1'
      ? (await kv('ZREVRANGE', 'newsletter:all', '0', '-1') || [])
      : undefined;

    // ── Referral stats ──
    // Scan ref_count keys using SCAN (pattern ref_count:*)
    // Simpler: sum all ref_count values via SCAN
    let totalReferrals = 0;
    let cursor = '0';
    const refKeys = [];
    do {
      const scanRes = await fetch(`${KV_URL}/scan/${cursor}/match/${encodeURIComponent('ref_count:*')}/count/100`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      }).then(r => r.json());
      cursor = scanRes.result?.[0] || '0';
      const keys = scanRes.result?.[1] || [];
      refKeys.push(...keys);
    } while (cursor !== '0');

    for (const k of refKeys) {
      const val = await kv('GET', k);
      totalReferrals += parseInt(val || '0', 10);
    }

    // ── Pro user scan — count pro:{sub} keys with isPro=true ──
    // We SCAN for pro:* keys and check isPro field
    let proUsers = 0;
    let proAnnual = 0;
    let proMonthly = 0;
    cursor = '0';
    const proKeys = [];
    do {
      const scanRes = await fetch(`${KV_URL}/scan/${cursor}/match/${encodeURIComponent('pro:*')}/count/200`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      }).then(r => r.json());
      cursor = scanRes.result?.[0] || '0';
      const keys = scanRes.result?.[1] || [];
      proKeys.push(...keys);
    } while (cursor !== '0');

    for (const k of proKeys) {
      try {
        const raw = await kv('GET', k);
        if (!raw) continue;
        const data = JSON.parse(raw);
        if (data.isPro) {
          proUsers++;
          if (data.plan === 'pro_annual') proAnnual++;
          else proMonthly++;
        }
      } catch(e) {}
    }

    // ── Scan credit revenue estimate (grade packs sold via webhook counts) ──
    // We don't track transaction count directly but we can count signup_bonus keys as proxy for signups
    let totalSignups = 0;
    cursor = '0';
    do {
      const scanRes = await fetch(`${KV_URL}/scan/${cursor}/match/${encodeURIComponent('signup_bonus:*')}/count/200`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      }).then(r => r.json());
      cursor = scanRes.result?.[0] || '0';
      totalSignups += (scanRes.result?.[1] || []).length;
    } while (cursor !== '0');

    // Revenue estimate: pro monthly + annual + known scan pack pricing (rough)
    const revenueEstimate = (proMonthly * 9.99) + (proAnnual * 89.99);

    return res.status(200).json({
      proUsers,
      proMonthly,
      proAnnual,
      newsletterCount: newsletterCount || 0,
      recentEmails: recentEmails || [],
      ...(allEmails !== undefined ? { allEmails } : {}),
      totalReferrals,
      totalSignups,
      revenueEstimate: revenueEstimate.toFixed(2),
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Admin error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
