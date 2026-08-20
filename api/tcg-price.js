// /api/tcg-price — Reliable TCGplayer prices for any card
// GET ?name=Charizard&set=Base+Set&number=4&rarity=Holo+Rare
// Returns: { market, low, mid, high, source, productId, url, cardName, setName }
//
// 2026-08-16 rewrite: routes tcgcsv.com FIRST (source of truth for TCGplayer
// pricing — same underlying data, but as a static daily-refreshed catalog
// so we can search deterministically instead of relying on TCGplayer's
// flaky text-search endpoint). Falls back to TCGplayer live search only
// when tcgcsv can't resolve the card (e.g. brand-new sets not yet indexed).

import { resolveCardPrice, resolveCardByName, gameToCategoryId } from './_tcgcsv.js';

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
  const game   = (req.query.game   || 'pokemon').trim().toLowerCase();
  const categoryId = gameToCategoryId(game);

  if (!name) return res.status(400).json({ error: 'name required (or q= alias)' });

  // Cache key bumped v2→v3 to namespace by game (Lorcana "Belle" ≠ Pokemon "Belle")
  const cacheKey = `v3|${game}|${name}|${set}|${number}|${rarity}`.toLowerCase();
  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  const cached = await getCached(kvUrl, kvToken, cacheKey);
  if (cached) {
    _incrSearchStats(kvUrl, kvToken);
    const cacheAgeSec = cached.fetchedAt
      ? Math.round((Date.now() - new Date(cached.fetchedAt).getTime()) / 1000)
      : 0;
    return res.status(200).json({ ...cached, cached: true, cacheAgeSec });
  }

  // ── PRIMARY: tcgcsv.com catalog (deterministic; refreshed daily) ────────
  // Two paths:
  //   1. set provided → fast set-scoped resolve
  //   2. no set + non-MTG → name-only scan (used for bulk-scan Lorcana/OP/PokemonJP
  //      where the AI can't reliably read the set)
  try {
    let r = null;
    if (set) {
      r = await resolveCardPrice({
        kvUrl, kvToken, categoryId, game,
        setName: set,
        cardName: name,
        cardNumber: number,
        rarity: rarity,
      });
    }
    // Name-only fallback if set-scoped resolve missed or no set given.
    // Skip for MTG — too many sets (2000+); Scryfall handles MTG.
    if ((!r || !r.ok || r.market == null) && !set && categoryId !== 1) {
      r = await resolveCardByName({
        kvUrl, kvToken, categoryId, game,
        cardName: name,
        cardNumber: number,
        rarity: rarity,
        // Cap scan to stay under Vercel 10s timeout. Lorcana/OP catalogs are
        // small enough to scan 40; larger TCGs limited to 25.
        // Lorcana (71): only ~20 groups total — scan all.
        // One Piece (68): ~85 groups — scan all.
        // Pokemon JP (85): ~455 groups — scan 60 newest (older sets are niche).
        // Others (fallback): 40.
        maxGroupsToScan:
          categoryId === 71 ? 30 :
          categoryId === 68 ? 100 :
          categoryId === 85 ? 60 :
          40,
      });
    }

    // 2026-08-19: Guard against TCGplayer's $99,999 "no data" sentinel.
    // TCGplayer uses 99999 as a placeholder when a product has no active
    // listings / market data yet (common for brand-new sets before pricing
    // stabilizes). Passing it through as if it were a real market price
    // makes the app look broken — caught in bulk-scan test 2026-08-19
    // where a One Piece Luffy card showed "$99,999.00" as the market price.
    if (r && r.ok && r.market != null && !_isSentinelPrice(r.market)) {
      // 2026-08-19: Low-lister guard. TCGcsv's "market" field is the most
      // recent sale price, which can be distorted by a single ultra-low
      // lister ($0.01) even when the actual market range is much higher.
      // If market is dramatically below mid (< 25% of mid), prefer mid —
      // it's the median and is more representative of what the card sells
      // for. Caught in bulk-scan test 2026-08-19 where Lorcana Elsa
      // showed "$0.07" as market while mid was $0.15 and high was $2.29.
      let displayMarket = r.market;
      if (r.mid != null && r.mid > 0 && r.market < r.mid * 0.25) {
        displayMarket = r.mid;
      }
      const data = {
        market: displayMarket,
        low:    r.low  ?? (displayMarket * 0.85),
        mid:    r.mid  ?? displayMarket,
        high:   r.high ?? (displayMarket * 1.15),
        source: 'tcgcsv',
        game,
        categoryId: r.categoryId ?? categoryId,
        variant: r.variant,
        productId: r.product?.productId ?? null,
        cardName: r.product?.name ?? name,
        setName: r.product?.setName ?? set,
        imageUrl: r.imageUrl || null,
        url: r.tcgplayerUrl || (r.product?.productId ? `https://www.tcgplayer.com/product/${r.product.productId}` : null),
        fetchedAt: new Date().toISOString(),
        cacheAgeSec: 0,
      };
      await setCache(kvUrl, kvToken, cacheKey, data);
      _incrSearchStats(kvUrl, kvToken);
      return res.status(200).json(data);
    }
  } catch(e) {
    console.error('tcgcsv resolve error:', e.message);
  }

  // ── FREE-API FALLBACKS: Scryfall (MTG) / lorcana-api / YGOProDeck ─────
  // 2026-08-19: when tcgcsv misses on non-Pokemon, hit the game-native free API
  // so users get *some* price instead of an empty state.
  if (categoryId !== 3) {
    try {
      let fb = null;
      if (categoryId === 1) {
        fb = await priceFromScryfall({ name, set, number });
      } else if (categoryId === 71) {
        fb = await priceFromLorcanaApi({ name, set });
      } else if (categoryId === 2) {
        fb = await priceFromYgoprodeck({ name, number });
      }
      if (fb && fb.market != null) {
        const data = {
          market: fb.market,
          low:  fb.low  ?? (fb.market * 0.85),
          mid:  fb.mid  ?? fb.market,
          high: fb.high ?? (fb.market * 1.15),
          source: fb.source,
          game, categoryId,
          cardName: fb.cardName || name,
          setName:  fb.setName  || set,
          imageUrl: fb.imageUrl || null,
          url:      fb.url      || null,
          fetchedAt: new Date().toISOString(),
          cacheAgeSec: 0,
        };
        await setCache(kvUrl, kvToken, cacheKey, data);
        _incrSearchStats(kvUrl, kvToken);
        return res.status(200).json(data);
      }
    } catch(e) {
      console.error('free-api fallback error:', e.message);
    }
    _incrSearchStats(kvUrl, kvToken);
    return res.status(200).json({
      market: null, low: null, mid: null, high: null,
      source: 'tcgcsv', game, categoryId,
      reason: 'no_match',
    });
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
            // 2026-08-19: filter sentinels here too — mpapi returns 99999
            // for products TCGplayer indexes but hasn't priced.
            const bpm = best_price.marketPrice;
            const bpl = best_price.lowPrice;
            const bpi = best_price.midPrice;
            const bph = best_price.highPrice;
            if (bpm != null && !_isSentinelPrice(bpm)) market = bpm;
            if (bpl != null && !_isSentinelPrice(bpl)) low    = bpl;
            if (bpi != null && !_isSentinelPrice(bpi)) mid    = bpi;
            if (bph != null && !_isSentinelPrice(bph)) high   = bph;
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
      fetchedAt: new Date().toISOString(),
      cacheAgeSec: 0,
    };
    await setCache(kvUrl, kvToken, cacheKey, data);
    _incrSearchStats(kvUrl, kvToken);
    return res.status(200).json(data);

  } catch(e) {
    console.error('tcg-price error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// 2026-08-19: TCGplayer uses these sentinel values to mean "no data".
// Any of them appearing in a price field should be treated as null.
const _PRICE_SENTINELS = new Set([99999, 999999, 99999.99]);
function _isSentinelPrice(n) {
  if (n == null) return false;
  const v = Number(n);
  if (!Number.isFinite(v)) return false;
  return _PRICE_SENTINELS.has(v) || v >= 99999;
}

// ── Free-API price fallbacks (2026-08-19) ─────────────────────────────────
async function _timedFetch(url, ms = 4000) {
  try {
    const ac = new AbortController();
    const tt = setTimeout(() => ac.abort(), ms);
    const r = await fetch(url, { signal: ac.signal, headers: { 'user-agent': 'CardResell/1.0' } }).catch(() => null);
    clearTimeout(tt);
    if (!r || !r.ok) return null;
    return await r.json().catch(() => null);
  } catch(_) { return null; }
}

async function priceFromScryfall({ name, set, number }) {
  if (!name) return null;
  const setLc = String(set || '').trim().toLowerCase();
  const setCode = /^[a-z0-9]{3,6}$/.test(setLc) ? setLc : '';
  const num = String(number || '').replace(/[^A-Za-z0-9\-]/g, '').replace(/\/.*$/, '');

  let j = null;
  if (setCode && num)  j = await _timedFetch(`https://api.scryfall.com/cards/${encodeURIComponent(setCode)}/${encodeURIComponent(num)}`);
  if (!j && setCode)   j = await _timedFetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&set=${encodeURIComponent(setCode)}`);
  if (!j)              j = await _timedFetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`);
  if (!j)              j = await _timedFetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`);
  if (!j || !j.prices) return null;

  const usd     = parseFloat(j.prices.usd)      || null;
  const usdFoil = parseFloat(j.prices.usd_foil) || null;
  const market  = usd || usdFoil || null;
  if (market == null) return null;
  const img = j.image_uris?.normal || j.card_faces?.[0]?.image_uris?.normal || null;
  return {
    market, low: null, mid: null, high: null,
    source: 'scryfall',
    cardName: j.name,
    setName:  j.set_name,
    imageUrl: img,
    url:      j.purchase_uris?.tcgplayer || j.scryfall_uri || null,
  };
}

async function priceFromLorcanaApi({ name, set }) {
  if (!name) return null;
  const setId = String(set || '').trim();
  let list = null;
  if (setId) {
    list = await _timedFetch(`https://api.lorcana-api.com/cards/fetch?search=Name%3D${encodeURIComponent(name)}%3BSet_ID%3D${encodeURIComponent(setId)}`);
  }
  if (!list || !list.length) {
    list = await _timedFetch(`https://api.lorcana-api.com/cards/fetch?search=Name%3D${encodeURIComponent(name)}`);
  }
  if (!list || !list.length) {
    list = await _timedFetch(`https://api.lorcana-api.com/cards/fetch?search=Name~${encodeURIComponent(name)}`);
  }
  if (!list || !list.length) return null;
  const c = list[0];
  // lorcana-api returns Price + Price_Foil (in USD) on the /Prices endpoint,
  // but /fetch also embeds Price on many cards. Try both.
  let market = parseFloat(c.Price) || parseFloat(c.Price_Foil) || null;
  if (market == null && c.Unique_ID) {
    const p = await _timedFetch(`https://api.lorcana-api.com/prices/${encodeURIComponent(c.Unique_ID)}`);
    if (p) market = parseFloat(p.Price) || parseFloat(p.Price_Foil) || null;
  }
  if (market == null) return null;
  return {
    market, low: null, mid: null, high: null,
    source: 'lorcana-api',
    cardName: c.Name,
    setName:  c.Set_Name,
    imageUrl: c.Image || null,
    url:      null,
  };
}

async function priceFromYgoprodeck({ name, number }) {
  const rawNum = String(number || '').trim();
  const passcode = /^\d{5,10}$/.test(rawNum) ? rawNum : '';
  let card = null;

  if (passcode) {
    const j = await _timedFetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${encodeURIComponent(passcode)}`);
    card = j?.data?.[0] || null;
  }
  if (!card && name) {
    const j = await _timedFetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?name=${encodeURIComponent(name)}`)
           || await _timedFetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(name)}&num=5&offset=0`);
    card = j?.data?.[0] || null;
  }
  if (!card) return null;

  const p = card.card_prices?.[0] || {};
  const tcg = parseFloat(p.tcgplayer_price) || null;
  const eb  = parseFloat(p.ebay_price)      || null;
  const cm  = parseFloat(p.cardmarket_price) || null;
  const az  = parseFloat(p.amazon_price)    || null;
  const market = tcg || eb || cm || az || null;
  if (market == null) return null;

  return {
    market,
    low:  Math.min(...[tcg, eb, cm, az].filter(v => v != null)) || null,
    high: Math.max(...[tcg, eb, cm, az].filter(v => v != null)) || null,
    mid:  market,
    source: 'ygoprodeck',
    cardName: card.name,
    setName:  card.card_sets?.[0]?.set_name || '',
    imageUrl: card.card_images?.[0]?.image_url || null,
    url:      null,
  };
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
