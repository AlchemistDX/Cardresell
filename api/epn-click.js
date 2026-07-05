// /api/epn-click.js
// Debug telemetry for eBay Partner Network click tracking.
//
// POST /api/epn-click { url, source }
//   - source: 'ebay-comps' | 'ebay-buy' | 'ebay-sell' | 'ebay-sold' | 'view-comps' | 'other'
//   - Increments total click counter, records last-click timestamp,
//     and stores a rolling window of the last 100 clicks.
//   - Returns { ok:true, total, last }
//
// GET  /api/epn-click
//   - Returns { total, last, campid_seen, recent:[...last 20 entries] }
//   - Handy for confirming clicks fire before EPN's dashboard shows them.

const KV_URL   = process.env.KV_REST_API_URL   || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '';
const KEY_TOTAL  = 'epn:clicks:total';
const KEY_LAST   = 'epn:clicks:last';        // timestamp (ms)
const KEY_CAMPID = 'epn:clicks:campid_seen'; // last campid detected in URL
const KEY_LIST   = 'epn:clicks:recent';      // list of JSON entries (rolling)

async function kv(cmd, ...args) {
  if (!KV_URL || !KV_TOKEN) return null;
  const res = await fetch(`${KV_URL}/${[cmd, ...args].map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const json = await res.json().catch(() => ({}));
  return json.result;
}

function extractCampid(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get('campid') || '';
  } catch (e) { return ''; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!KV_URL || !KV_TOKEN)     return res.status(503).json({ error: 'Storage not configured' });

  if (req.method === 'POST') {
    let url = '', source = 'other';
    try {
      url    = String(req.body?.url    || '').slice(0, 500);
      source = String(req.body?.source || 'other').slice(0, 32);
    } catch (e) { return res.status(400).json({ error: 'Invalid body' }); }

    if (!url) return res.status(400).json({ error: 'url required' });

    const ts     = Date.now();
    const campid = extractCampid(url);
    const entry  = JSON.stringify({ ts, source, campid, url: url.slice(0, 300) });

    try {
      await kv('INCR', KEY_TOTAL);
      await kv('SET',  KEY_LAST, String(ts));
      if (campid) await kv('SET', KEY_CAMPID, campid);
      // LPUSH + LTRIM to keep the last 100 entries only
      await kv('LPUSH', KEY_LIST, entry);
      await kv('LTRIM', KEY_LIST, '0', '99');

      const total = await kv('GET', KEY_TOTAL);
      return res.status(200).json({ ok: true, total: Number(total) || 0, last: ts, campid });
    } catch (err) {
      console.error('epn-click POST error:', err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (req.method === 'GET') {
    try {
      const total     = await kv('GET', KEY_TOTAL);
      const last      = await kv('GET', KEY_LAST);
      const campid    = await kv('GET', KEY_CAMPID);
      const rawRecent = await kv('LRANGE', KEY_LIST, '0', '19');
      const recent = (Array.isArray(rawRecent) ? rawRecent : []).map(s => {
        try { return JSON.parse(s); } catch (e) { return { raw: s }; }
      });
      return res.status(200).json({
        total: Number(total) || 0,
        last:  last ? Number(last) : null,
        campid_seen: campid || null,
        recent
      });
    } catch (err) {
      console.error('epn-click GET error:', err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
