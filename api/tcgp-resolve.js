// /api/tcgp-resolve.js
// Resolves a PokemonTCG.io tcgplayer redirect URL to a TCGplayer product ID.
//
// Input:  ?url=https://prices.pokemontcg.io/tcgplayer/xy1-1
// Output: 200 { productId: "90324" }
//         404 { productId: "" }        (not resolvable)
//         400 { error: "..." }         (bad request)
//
// We follow redirects server-side (the client can't, because CORS on
// prices.pokemontcg.io + Scrydex's affiliate redirect masks the final
// tcgplayer.com/product/<id> URL). Cached at the CDN for 30 days since
// product IDs never change.
//
// This exists purely so we can route users through OUR TCGplayer Impact
// affiliate ID (7445683) instead of Scrydex's (4944541) when we send them
// to a card's product page.

const KV_URL   = process.env.KV_REST_API_URL   || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '';

async function kv(cmd, ...args) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const res = await fetch(`${KV_URL}/${[cmd, ...args].map(encodeURIComponent).join('/')}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const json = await res.json();
    return json.result;
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const url = String(req.query.url || '');

  // Whitelist: only resolve PokemonTCG.io tcgplayer redirects. Anything else
  // could be an SSRF vector.
  if (!url.startsWith('https://prices.pokemontcg.io/tcgplayer/')) {
    return res.status(400).json({ error: 'Only prices.pokemontcg.io/tcgplayer/ URLs are supported' });
  }

  // Extract the tcg-slug identifier (xy1-1, sv3pt5-197, etc.) for KV cache key
  const slug = url.split('/tcgplayer/')[1] || '';
  if (!slug || !/^[a-z0-9]+-[a-z0-9]+$/i.test(slug)) {
    return res.status(400).json({ error: 'Invalid tcgplayer slug' });
  }

  const kvKey = `tcgp-pid:${slug}`;

  // Fast path: KV cache lookup (30-day TTL)
  const cached = await kv('GET', kvKey);
  if (cached && /^\d+$/.test(cached)) {
    // Client + CDN caching — product IDs never change so cache aggressively
    res.setHeader('Cache-Control', 'public, s-maxage=2592000, max-age=86400, immutable');
    return res.status(200).json({ productId: cached, cached: true });
  }

  // Slow path: follow the redirect chain and extract product ID from final URL
  try {
    const r = await fetch(url, { redirect: 'follow' });
    const finalUrl = r.url || '';
    // Match tcgplayer.com/product/<numeric-id>
    const m = finalUrl.match(/tcgplayer\.com\/product\/(\d+)/);
    const productId = m ? m[1] : '';

    if (productId) {
      // Cache for 30 days
      await kv('SET', kvKey, productId, 'EX', '2592000');
      res.setHeader('Cache-Control', 'public, s-maxage=2592000, max-age=86400, immutable');
      return res.status(200).json({ productId, cached: false });
    }
    return res.status(404).json({ productId: '' });
  } catch (err) {
    console.warn('tcgp-resolve error:', err && err.message);
    return res.status(502).json({ error: 'Upstream fetch failed' });
  }
}
