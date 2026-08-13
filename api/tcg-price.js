// /api/tcg-price — Live TCGPlayer prices for any card including new sets
// GET ?name=Charizard&set=Ascended+Heroes&number=294
// Returns: { market, low, mid, high, source }

const CACHE_TTL_SEC = 30 * 60; // 30 min

async function getCached(kvUrl, kvToken, key) {
  if (!kvUrl || !kvToken) return null;
  try {
    const r = await fetch(`${kvUrl}/get/${encodeURIComponent('tcgprice:' + key)}`,
      { headers: { Authorization: `Bearer ${kvToken}` } });
    const d = await r.json();
    if (d.result) return JSON.parse(d.result);
  } catch(e) {}
  return null;
}

async function setCache(kvUrl, kvToken, key, data) {
  if (!kvUrl || !kvToken) return;
  try {
    await fetch(
      `${kvUrl}/setex/${encodeURIComponent('tcgprice:' + key)}/${CACHE_TTL_SEC}/${encodeURIComponent(JSON.stringify(data))}`,
      { method: 'POST', headers: { Authorization: `Bearer ${kvToken}` } }
    );
  } catch(e) {}
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Accept both ?name= (canonical) and ?q= (legacy shorthand)
  const name   = (req.query.name || req.query.q || '').trim();
  const set    = (req.query.set    || '').trim();
  const number = (req.query.number || '').trim();

  if (!name) return res.status(400).json({ error: 'name required (or q= alias)' });

  const cacheKey = `${name}|${set}|${number}`.toLowerCase();
  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  const cached = await getCached(kvUrl, kvToken, cacheKey);
  if (cached) return res.status(200).json({ ...cached, cached: true });

  try {
    // Search TCGPlayer for the card
    const searchBody = {
      algorithm: 'sales_synonym_v2',
      from: 0,
      size: 10,
      filters: {
        // Don't hard-filter on setName — TCGplayer uses prefixed names like
        // "ME04: Chaos Rising" not "Chaos Rising". We rank by set match below
        // to pick the right card instead of dropping results.
        term: { productLineName: ['pokemon'] },
        range: {},
        match: {}
      },
      listingSearch: {
        filters: { term: {}, range: { quantity: { gte: 1 } }, exclude: { channelExclusion: 0 } },
        context: { cart: {} }
      },
      context: { cart: {}, shippingCountry: 'US' },
      settings: { useFuzzySearch: true, didYouMean: {} },
      sort: {}
    };

    const searchUrl = `https://mp-search-api.tcgplayer.com/v1/search/request?q=${encodeURIComponent(name)}&productLineName=pokemon&page=0&pageSize=10&channel=0${set ? `&setName=${encodeURIComponent(set)}` : ''}`;

    const sr = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Content-Type': 'application/json',
        'Origin': 'https://www.tcgplayer.com',
        'Referer': 'https://www.tcgplayer.com/',
      },
      body: JSON.stringify(searchBody)
    });

    if (!sr.ok) throw new Error(`TCGPlayer search ${sr.status}`);

    const sdata = await sr.json();
    const results = sdata?.results?.[0]?.results || [];

    if (results.length === 0) {
      return res.status(200).json({ market: null, low: null, mid: null, high: null, source: 'tcgplayer', count: 0 });
    }

    // Score each result — prefer set match, then number match, then name match
    const setLower = set.toLowerCase();
    const nameLower = name.toLowerCase();
    const numClean = number ? number.replace(/^0+/, '') : '';
    const scored = results.map(r => {
      const productName = (r.productName || '').toLowerCase();
      const rSetName    = (r.setName || '').toLowerCase();
      let score = 0;
      // Set match — huge weight (prevents "Charizard + set=Chaos Rising" matching a random tin)
      if (setLower && rSetName.includes(setLower)) score += 100;
      // Number match
      if (numClean && (productName.includes(`${numClean}/`) || productName.includes(`- ${numClean}`) || productName.includes(`#${numClean}`))) {
        score += 50;
      }
      // Name is present (tiebreaker)
      if (productName.startsWith(nameLower)) score += 10;
      else if (productName.includes(nameLower)) score += 5;
      return { r, score };
    });
    scored.sort((a, b) => b.score - a.score);
    let best = scored[0].r;

    const productId = best.productId ? Math.round(best.productId) : null;
    let market = best.marketPrice || null;
    let low = best.lowPrice || null;
    let mid = best.midPrice || null;
    let high = best.highPrice || null;

    // If we have a productId, get detailed prices
    if (productId) {
      try {
        const pr = await fetch(`https://mpapi.tcgplayer.com/v2/product/${productId}/pricepoints?includeDirectSales=false`, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Origin': 'https://www.tcgplayer.com' }
        });
        if (pr.ok) {
          const prices = await pr.json();
          // Find holofoil or normal printing
          const holofoil = prices.find(p => p.printingType === 'Holofoil' || p.printingType === 'Foil');
          const normal = prices.find(p => p.printingType === 'Normal');
          const best_price = holofoil || normal || prices[0];
          if (best_price) {
            market = best_price.marketPrice || market;
            low = best_price.listedMedianPrice || low;
          }
        }
      } catch(e) {}
    }

    const data = {
      market,
      low,
      mid,
      high,
      source: 'tcgplayer',
      productId,
      cardName: best.productName,
      setName: best.setName,
      url: productId ? `https://www.tcgplayer.com/product/${productId}` : null,
    };

    await setCache(kvUrl, kvToken, cacheKey, data);
    return res.status(200).json(data);

  } catch(e) {
    console.error('tcg-price error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
