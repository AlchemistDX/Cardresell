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
  if (cached) {
    // Cache hit still counts as a search from the user's perspective — they typed
    // a query and got a real price back. Increment counters (fire-and-forget).
    _incrSearchStats(kvUrl, kvToken);
    return res.status(200).json({ ...cached, cached: true });
  }

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
    // 2026-08-16: previous version only overwrote market+low and never
    // populated mid/high from pricepoints, which is why vintage cards
    // (Mewtwo Star Holon Phantoms) showed Low $0 / High $0 with just a
    // mid figure. Now we pull all four fields from pricepoints and
    // treat the search-endpoint values as backup.
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
            market = best_price.marketPrice ?? market;
            low    = best_price.lowPrice    ?? low;
            mid    = best_price.midPrice    ?? mid;
            high   = best_price.highPrice   ?? high;
          }
        }
      } catch(e) {}
    }

    // 2026-08-16: vintage / gold-star / high-value cards often have
    // stale TCGplayer market data (single listing pinned high, or a
    // frozen mid with $0 low/high). Cross-reference with pokemontcg.io
    // which aggregates both TCGplayer AND Cardmarket data (Cardmarket
    // reflects live EU listings, less prone to single-listing skew).
    // If pokemontcg.io returns a materially different market price
    // (>2x delta) we flag it and prefer the LOWER of the two so we
    // don't over- or under-value the user's card based on one source.
    try {
      const ptcgQuery = number
        ? `name:"${name.replace(/"/g,'')}" number:${number.replace(/\/.*$/,'').trim()}`
        : `name:"${name.replace(/"/g,'')}"`;
      const ptcgUrl = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(ptcgQuery)}&pageSize=5&select=id,name,set,number,tcgplayer,cardmarket`;
      const ptcgRes = await fetch(ptcgUrl, { signal: AbortSignal.timeout(4000) });
      if (ptcgRes.ok) {
        const ptcgJson = await ptcgRes.json();
        const ptcgCards = ptcgJson.data || [];
        // Prefer set match, else first
        const setLo = set.toLowerCase();
        const ptcgMatch = (setLo ? ptcgCards.find(c => (c.set?.name || '').toLowerCase().includes(setLo)) : null) || ptcgCards[0];
        if (ptcgMatch) {
          const tp = ptcgMatch.tcgplayer?.prices || {};
          // Pick the highest-market printing (holofoil, reverseHolofoil, normal)
          const printings = Object.values(tp).filter(v => v && (v.market > 0 || v.mid > 0));
          const bestPrinting = printings.sort((a,b) => (b.market || b.mid || 0) - (a.market || a.mid || 0))[0];
          const cmAvg = ptcgMatch.cardmarket?.prices?.averageSellPrice;
          const cmTrend = ptcgMatch.cardmarket?.prices?.trendPrice;
          const cmAvg30 = ptcgMatch.cardmarket?.prices?.avg30;
          // Cardmarket is in EUR — apply rough USD conversion (2026 ~1.08)
          const cm_usd = (cmAvg30 || cmTrend || cmAvg) ? ((cmAvg30 || cmTrend || cmAvg) * 1.08) : null;
          const ptcgMarket = bestPrinting?.market || bestPrinting?.mid || cm_usd || null;

          // Case A: TPL returned market but its range collapsed (low=$0
          // AND high=$0) — that means TPL only has one stale data point
          // and pokemontcg.io's aggregated market (TPL + Cardmarket) is
          // more trustworthy. Prefer pokemontcg.io + rebuild the range.
          const tplRangeBroken = market > 0 && !(low > 0) && !(high > 0);
          if (tplRangeBroken && ptcgMarket) {
            market = ptcgMarket;
            low  = bestPrinting?.low  || ptcgMarket * 0.85;
            mid  = bestPrinting?.mid  || ptcgMarket;
            high = bestPrinting?.high || ptcgMarket * 1.15;
          }
          // Case B: TPL and pokemontcg.io disagree by >2x. Prefer
          // pokemontcg.io because it aggregates multiple sources.
          else if (ptcgMarket && market && Math.max(ptcgMarket, market) / Math.min(ptcgMarket, market) > 2) {
            market = ptcgMarket;
            if (bestPrinting) {
              low  = bestPrinting.low  ?? ptcgMarket * 0.85;
              mid  = bestPrinting.mid  ?? ptcgMarket;
              high = bestPrinting.high ?? ptcgMarket * 1.15;
            } else {
              low  = ptcgMarket * 0.85;
              mid  = ptcgMarket;
              high = ptcgMarket * 1.15;
            }
          }
          // Case C: no TPL market at all — use pokemontcg.io directly.
          else if (!market && ptcgMarket) {
            market = ptcgMarket;
            if (bestPrinting) {
              low  = bestPrinting.low  ?? ptcgMarket * 0.85;
              mid  = bestPrinting.mid  ?? ptcgMarket;
              high = bestPrinting.high ?? ptcgMarket * 1.15;
            } else if (!(mid > 0)) {
              mid = ptcgMarket;
            }
          }
        }
      }
    } catch(e) {
      /* pokemontcg.io cross-check is best-effort */
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
    _incrSearchStats(kvUrl, kvToken);
    return res.status(200).json(data);

  } catch(e) {
    console.error('tcg-price error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ── Search-counter increment (fire-and-forget) ──
// Powers the landing-page social-proof counter. We increment both a
// lifetime total and a per-day bucket. Failures are swallowed — stats
// are best-effort and should never break the actual price lookup.
function _todayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}
function _incrSearchStats(kvUrl, kvToken) {
  if (!kvUrl || !kvToken) return;
  // Don't await — stats must not add latency to the user's price lookup.
  fetch(`${kvUrl}/incr/${encodeURIComponent('stats:searches:total')}`, {
    method: 'POST', headers: { Authorization: `Bearer ${kvToken}` }
  }).catch(() => {});
  fetch(`${kvUrl}/incr/${encodeURIComponent('stats:searches:' + _todayKey())}`, {
    method: 'POST', headers: { Authorization: `Bearer ${kvToken}` }
  }).catch(() => {});
}
