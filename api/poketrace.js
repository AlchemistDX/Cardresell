// /api/poketrace — PokeTrace proxy (keeps API key server-side)
// Docs: https://poketrace.com/developers
// Free tier: 250 req/day — raw condition pricing (NM/LP/MP/HP/DMG) from eBay + TCGPlayer
// Pro tier: graded PSA/BGS/CGC pricing (upgrade when ready)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.POKETRACE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'PokeTrace not configured' });

  const { q, id, market = 'US', limit = '8' } = req.query;

  const BASE = 'https://api.poketrace.com/v1';
  const headers = { 'X-API-Key': apiKey };

  try {
    let data;

    if (id) {
      // Fetch single card by PokeTrace ID
      const r = await fetch(`${BASE}/cards/${encodeURIComponent(id)}`, { headers });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        return res.status(r.status).json({ error: err.error || 'PokeTrace error' });
      }
      data = await r.json();
      return res.status(200).json(normalizeCard(data));
    }

    if (!q || q.length < 2) return res.status(400).json({ error: 'Query required' });

    // Search cards
    const url = `${BASE}/cards?search=${encodeURIComponent(q)}&market=${market}&limit=${Math.min(parseInt(limit) || 8, 20)}`;
    const r = await fetch(url, { headers });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(r.status).json({ error: err.error || 'PokeTrace error' });
    }

    const json = await r.json();
    const cards = (json.data || []).map(normalizeCard);
    return res.status(200).json({ cards, hasMore: json.hasMore || false });

  } catch (e) {
    console.error('PokeTrace proxy error:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function normalizeCard(c) {
  const prices = c.prices || {};
  const ebay = prices.ebay || {};
  const tcg = prices.tcgplayer || {};

  // Pull NM prices (best raw condition)
  const nm_ebay = ebay.NEAR_MINT || {};
  const nm_tcg = tcg.NEAR_MINT || {};

  // Build condition price table for display
  const conditionMap = {
    NEAR_MINT: 'Near Mint',
    LIGHTLY_PLAYED: 'Lightly Played',
    MODERATELY_PLAYED: 'Moderately Played',
    HEAVILY_PLAYED: 'Heavily Played',
    DAMAGED: 'Damaged',
  };

  const conditionPrices = {};
  for (const [key, label] of Object.entries(conditionMap)) {
    const e = ebay[key] || {};
    const t = tcg[key] || {};
    if (e.avg7d || e.avg || t.avg7d || t.avg) {
      conditionPrices[label] = {
        ebay_avg7d: e.avg7d ?? e.avg ?? null,
        ebay_low: e.low ?? null,
        ebay_high: e.high ?? null,
        ebay_sales: e.saleCount ?? null,
        tcg_avg: t.avg7d ?? t.avg ?? null,
        tcg_low: t.low ?? null,
      };
    }
  }

  // Graded prices (available on Pro plan)
  const graded = prices.graded || null;

  return {
    id: c.id,
    name: c.name,
    number: c.cardNumber,
    set: c.set?.name,
    setSlug: c.set?.slug,
    variant: c.variant,
    rarity: c.rarity,
    image: c.image,           // PokeTrace CDN image
    game: c.game,
    market: c.market,
    refs: c.refs || {},
    marketplaceUrls: c.marketplaceUrls || {},
    // Primary market price = eBay NM 7-day avg (most accurate sold comp)
    marketPrice: nm_ebay.avg7d ?? nm_ebay.avg ?? nm_tcg.avg7d ?? nm_tcg.avg ?? null,
    ebayNmAvg7d: nm_ebay.avg7d ?? nm_ebay.avg ?? null,
    tcgNmAvg: nm_tcg.avg7d ?? nm_tcg.avg ?? null,
    conditionPrices,
    graded,   // null on free tier, populated on Pro
    lastUpdated: c.lastUpdated,
    _source: 'poketrace',
  };
}
