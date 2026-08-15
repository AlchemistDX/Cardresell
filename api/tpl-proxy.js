// api/tpl-proxy.js
// Server-side proxy for TCGPriceLookup — keeps the paid API key off the client.
//
// Client sends:  GET /api/tpl-proxy?path=/v1/cards/search&q=Pikachu&game=pokemon&limit=100
//                GET /api/tpl-proxy?path=/v1/cards/<id>
//                GET /api/tpl-proxy?path=/v1/cards/lookup&name=...&game=...
//
// We call:       GET https://api.tcgpricelookup.com<path>?<forwarded query>
// with header:   X-API-Key: process.env.CARDSELL_TPL_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const key = process.env.CARDSELL_TPL_KEY;
  if (!key) return res.status(500).json({ error: 'TPL not configured' });

  const path = req.query.path || '';
  // Path allow-list — only exact TPL v1 endpoints we use in the client
  const ALLOW = [
    /^\/v1\/cards\/search$/,
    /^\/v1\/cards\/lookup$/,
    /^\/v1\/cards\/[A-Za-z0-9_-]+$/,
  ];
  if (!ALLOW.some(re => re.test(path))) {
    return res.status(400).json({ error: 'path not allowed' });
  }

  // Forward all query params except `path`
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (k === 'path') continue;
    params.append(k, Array.isArray(v) ? v[0] : v);
  }

  const url = `https://api.tcgpricelookup.com${path}${params.toString() ? '?' + params.toString() : ''}`;

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { headers: { 'X-API-Key': key }, signal: ctrl.signal });
    clearTimeout(timeout);
    const body = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    // Cache TPL responses at the edge for 5 min — big cost saver
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    res.send(body);
  } catch (e) {
    res.status(502).json({ error: 'TPL upstream failed', detail: String(e?.message || e) });
  }
}
