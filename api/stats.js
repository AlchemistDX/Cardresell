// /api/stats — Real search counter (Upstash KV)
//
// GET  /api/stats                    → returns { totalSearches, todaySearches, since }
// POST /api/stats  (internal only)   → increments the counters
//
// Keys:
//   stats:searches:total           lifetime search count
//   stats:searches:YYYY-MM-DD      per-day count (mostly for future analytics)
//
// The POST path is guarded by a shared secret so random clients can't
// inflate the counter. Server-side callers (scan.js, tcg-price.js, etc.)
// pass it as the x-stats-secret header. If STATS_INCR_SECRET is not set
// we fail open on writes (increment allowed) but never on reads — keeps
// dev/preview simple.

const BASELINE = 200;  // Honest dev-testing baseline (Will confirmed ~200 real
                       // searches during development). The endpoint returns
                       // max(kvTotal, BASELINE) so the counter never renders 0
                       // even if KV is unset/wiped.

function todayKey() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function kvGet(kvUrl, kvToken, key) {
  try {
    const r = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const d = await r.json();
    return d.result;
  } catch (e) { return null; }
}

async function kvIncr(kvUrl, kvToken, key) {
  try {
    const r = await fetch(`${kvUrl}/incr/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const d = await r.json();
    return d.result;
  } catch (e) { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-stats-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (req.method === 'GET') {
    // Public read — no auth needed. Cache at edge 60s so a viral moment
    // doesn't hammer KV. Client will still see the number tick over minute-by-minute.
    if (!kvUrl || !kvToken) {
      return res.status(200).json({ totalSearches: BASELINE, todaySearches: 0, since: 'baseline' });
    }
    const totalRaw = await kvGet(kvUrl, kvToken, 'stats:searches:total');
    const todayRaw = await kvGet(kvUrl, kvToken, `stats:searches:${todayKey()}`);
    const total = Math.max(parseInt(totalRaw) || 0, BASELINE);
    const today = parseInt(todayRaw) || 0;
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');
    return res.status(200).json({
      totalSearches: total,
      todaySearches: today,
      since: totalRaw ? 'kv' : 'baseline'
    });
  }

  if (req.method === 'POST') {
    // Two modes:
    //   ?action=reset&value=N  — admin reset, requires STATS_ADMIN_SECRET
    //   (default)              — increment, requires STATS_INCR_SECRET when set
    if (!kvUrl || !kvToken) {
      return res.status(503).json({ error: 'KV not configured' });
    }

    if (req.query.action === 'reset') {
      const adminSecret = process.env.STATS_ADMIN_SECRET;
      const sent = req.headers['x-stats-secret'] || '';
      if (!adminSecret || sent !== adminSecret) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      const value = parseInt(req.query.value || '0');
      if (!isFinite(value) || value < 0) return res.status(400).json({ error: 'bad value' });
      const setUrl = `${kvUrl}/set/${encodeURIComponent('stats:searches:total')}/${value}`;
      const r = await fetch(setUrl, { method: 'POST', headers: { Authorization: `Bearer ${kvToken}` } });
      const d = await r.json().catch(() => ({}));
      return res.status(200).json({ ok: true, set: value, kv: d });
    }

    // Server-to-server increment. Guarded by shared secret so client JS
    // can't inflate the counter by spamming this endpoint.
    const secret = process.env.STATS_INCR_SECRET;
    const sent   = req.headers['x-stats-secret'] || '';
    if (!secret || sent !== secret) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    // Fire both increments — total and today. Don't await in parallel to
    // avoid clobbering — Upstash INCR is atomic per-key.
    const totalAfter = await kvIncr(kvUrl, kvToken, 'stats:searches:total');
    const todayAfter = await kvIncr(kvUrl, kvToken, `stats:searches:${todayKey()}`);
    return res.status(200).json({
      totalSearches: parseInt(totalAfter) || 0,
      todaySearches: parseInt(todayAfter) || 0
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
