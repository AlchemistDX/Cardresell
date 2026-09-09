// api/tpl-proxy.js
// Server-side proxy for TCGPriceLookup — keeps the paid API key off the client.
//
// Client sends:  GET /api/tpl-proxy?path=/v1/cards/search&q=Pikachu&game=pokemon&limit=100
//                GET /api/tpl-proxy?path=/v1/cards/<id>
//                GET /api/tpl-proxy?path=/v1/cards/lookup&name=...&game=...
//
// We call:       GET https://api.tcgpricelookup.com<path>?<forwarded query>
// with header:   X-API-Key: process.env.CARDSELL_TPL_KEY

import { validateTplRequest } from './_tplContract.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const key = process.env.CARDSELL_TPL_KEY;
  if (!key) return res.status(500).json({ error: 'TPL not configured' });

  // 2026-09-09 [CH-3/R2]: validate against the client contract BEFORE spending
  // anything upstream. Replaces a forward-everything loop that sent any query
  // parameter it received to a PAID provider. See api/_tplContract.js for the
  // contract and for what this fix does NOT achieve: it closes the
  // unknown-parameter path; it does not eliminate cache bypass (Vercel keys on
  // the INCOMING url) and it does not bound spending (distinct valid requests
  // still reach the provider).
  const v = validateTplRequest(req.query);
  if (!v.ok) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(v.status).json(
      v.detail ? { error: v.error, detail: v.detail } : { error: v.error });
  }
  const { path, upstreamQuery } = v;
  const qs = upstreamQuery.toString();

  const url = `https://api.tcgpricelookup.com${path}${qs ? '?' + qs : ''}`;

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { headers: { 'X-API-Key': key }, signal: ctrl.signal });
    clearTimeout(timeout);
    const body = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    // 2026-09-09 [CH-3/R3]: cache SUCCESSES only. The previous unconditional
    // header asked the edge to cache failures too. Note the withdrawn claim:
    // this does NOT mean a dead key was previously served for five minutes —
    // Vercel's cacheable statuses exclude 401, 429 and 5xx, so most failures
    // were never cached whatever we asked for. no-store makes the intent
    // explicit and removes the dependency on that platform behaviour.
    if (r.status >= 200 && r.status < 300) {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }
    res.send(body);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'TPL upstream failed', detail: String(e?.message || e) });
  }
}
