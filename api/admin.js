// /api/admin.js
// Private admin stats endpoint — owner-only.
// GET  /api/admin              → { proUsers, newsletters, referrals, scanRevenue }
// GET  /api/admin?all=1        → adds allEmails[] (full subscriber list)
// POST /api/admin { action: 'restore_scan_credit', target_uid, amount } → restore a burned credit
//
// AUTH: Requires Authorization: Bearer <Firebase/Google ID token>.
// The token's uid must equal OWNER_SUB. `?sub=` query param is IGNORED (was spoofable).
// KV credentials are read from process.env (KV_REST_API_URL / KV_REST_API_TOKEN) — no hardcoded secrets.

import { verifyTokenFlexible } from './_verifyToken.js';

const OWNER_SUB = '111904685934190351595';
const KV_URL   = process.env.KV_REST_API_URL   || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '';

async function kv(cmd, ...args) {
  const res = await fetch(`${KV_URL}/${[cmd, ...args].map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const json = await res.json();
  return json.result;
}

async function requireOwner(req, res) {
  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!idToken) { res.status(401).json({ error: 'Authorization token required' }); return null; }
  try {
    const info = await verifyTokenFlexible(idToken);
    if (!info?.uid || info.uid !== OWNER_SUB) {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    }
    return info.uid;
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!KV_URL || !KV_TOKEN) return res.status(503).json({ error: 'Storage not configured' });

  // ── POST: owner-only admin actions ──
  if (req.method === 'POST') {
    const uid = await requireOwner(req, res);
    if (!uid) return;

    const { action, target_uid, amount } = req.body || {};

    // Restore N paid scan credits to a target user
    if (action === 'restore_scan_credit') {
      const target = String(target_uid || '').trim();
      const n = parseInt(amount) || 0;
      if (!target)       return res.status(400).json({ error: 'target_uid required' });
      if (!n || n < 1 || n > 100) return res.status(400).json({ error: 'amount must be 1..100' });

      const key = `scans:${target}:paid_left`;
      const cur = parseInt(await kv('GET', key) || '0', 10) || 0;
      const next = cur + n;
      await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(String(next))}`, {
        method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
      console.log(`ADMIN_RESTORE: uid=${target} +${n} paid_left ${cur}→${next} by owner`);
      return res.status(200).json({ success: true, target_uid: target, added: n, new_balance: next });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ── GET: owner-only stats ──
  const uid = await requireOwner(req, res);
  if (!uid) return;

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
