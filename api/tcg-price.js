// /api/tcg-price — Reliable TCGplayer prices for any card
// GET ?name=Charizard&set=Base+Set&number=4&rarity=Holo+Rare
// Returns: { market, low, mid, high, source, productId, url, cardName, setName }
//
// 2026-08-16 rewrite: routes tcgcsv.com FIRST (source of truth for TCGplayer
// pricing — same underlying data, but as a static daily-refreshed catalog
// so we can search deterministically instead of relying on TCGplayer's
// flaky text-search endpoint). Falls back to TCGplayer live search only
// when tcgcsv can't resolve the card (e.g. brand-new sets not yet indexed).

import { resolveCardPrice } from './_tcgcsv.js';

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
  const rarity = (req.query.rarity || '').trim();

  if (!name) return res.status(400).json({ error: 'name required (or q= alias)' });

  // Cache key includes 'v2' so the tcgcsv rewrite invalidates stale 'tcgplayer' entries
  const cacheKey = `v2|${name}|${set}|${number}|${rarity}`.toLowerCase();
  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  const cached = await getCached(kvUrl, kvToken, cacheKey);
  if (cached) {
    _incrSearchStats(kvUrl, kvToken);
    return res.status(200).json({ ...cached, cached: true });
  }

  // ── PRIMARY: tcgcsv.com catalog (deterministic; refreshed daily) ────────
  try {
    if (set) {
      const r = await resolveCardPrice({
        kvUrl, kvToken,
        setName: set,
        cardName: name,
        cardNumber: number,
        rarity: rarity,
      });
      if (r.ok && r.market != null) {
        const data = {
          market: r.market,
          low:    r.low  ?? (r.market * 0.85),
          mid:    r.mid  ?? r.market,
          high:   r.high ?? (r.market * 1.15),
          source: 'tcgcsv',
          variant: r.variant,
          productId: r.product?.productId ?? null,
          cardName: r.product?.name ?? name,
          setName: r.product?.setName ?? set,
          url: r.product?.productId ? `https://www.tcgplayer.com/product/${r.product.productId}` : null,
        };
        await setCache(kvUrl, kvToken, cacheKey, data);
        _incrSearchStats(kvUrl, kvToken);
        return res.status(200).json(data);
      }
    }
  } catch(e) {
    console.error('tcgcsv resolve error:', e.message);
  }

  // ── FALLBACK: live TCGplayer search ─────────────────────────────────────
  // Used when tcgcsv can't resolve (missing set, brand-new release,
  // or ambiguous name). Same scoring logic as the previous version.
  try {
    const searchBody = {
      algorithm: 'sales_synonym_v2',
      from: 0,
      size: 10,
      filters: { term: { productLineName: ['pokemon'] }, range: {}, match: {} },
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
    if (!sr.ok) throw new Error(`TCGplayer search ${sr.status}`);
    const sdata = await sr.json();
    const results = sdata?.results?.[0]?.results || [];
    if (results.length === 0) {
      return res.status(200).json({ market: null, low: null, mid: null, high: null, source: 'tcgplayer', count: 0 });
    }

    const setLower  = set.toLowerCase();
    const nameLower = name.toLowerCase();
    const rarityLo  = rarity.toLowerCase();
    const numClean  = number ? number.replace(/^0+/, '') : '';
    const specialKeywords = ['illustration', 'special', 'secret', 'hyper', 'rainbow', 'ultra', 'full art', 'alt art', 'gold', 'shiny', 'v-max', 'vstar', 'v union', 'trainer gallery'];
    const isSpecial = specialKeywords.some(kw => rarityLo.includes(kw));

    const scored = results.map(r => {
      const productName = (r.productName || '').toLowerCase();
      const rSetName    = (r.setName || '').toLowerCase();
      let score = 0;
      if (setLower && rSetName.includes(setLower)) score += 100;
      if (isSpecial) {
        for (const kw of specialKeywords) {
          if (rarityLo.includes(kw) && productName.includes(kw)) { score += 80; break; }
        }
        if (numClean && productName.includes(`${numClean}/`)) score += 60;
      } else if (rarityLo && (rarityLo === 'common' || rarityLo === 'uncommon' || rarityLo === 'rare')) {
        for (const kw of specialKeywords) {
          if (productName.includes(kw)) { score -= 40; break; }
        }
      }
      if (numClean && (productName.includes(`${numClean}/`) || productName.includes(`- ${numClean}`) || productName.includes(`#${numClean}`))) {
        score += 50;
      }
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
    if (productId) {
      try {
        const pr = await fetch(`https://mpapi.tcgplayer.com/v2/product/${productId}/pricepoints?includeDirectSales=false`, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Origin': 'https://www.tcgplayer.com' }
        });
        if (pr.ok) {
          const prices = await pr.json();
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

    const data = {
      market, low, mid, high,
      source: 'tcgplayer-live',
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

// ── Search-counter increment (fire-and-forget) ──────────────────────────
function _todayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}
function _incrSearchStats(kvUrl, kvToken) {
  if (!kvUrl || !kvToken) return;
  fetch(`${kvUrl}/incr/${encodeURIComponent('stats:searches:total')}`, {
    method: 'POST', headers: { Authorization: `Bearer ${kvToken}` }
  }).catch(() => {});
  fetch(`${kvUrl}/incr/${encodeURIComponent('stats:searches:' + _todayKey())}`, {
    method: 'POST', headers: { Authorization: `Bearer ${kvToken}` }
  }).catch(() => {});
}
