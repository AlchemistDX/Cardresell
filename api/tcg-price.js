// /api/tcg-price — Reliable TCGplayer prices for any card
// GET ?name=Charizard&set=Base+Set&number=4&rarity=Holo+Rare
// Returns: { market, low, mid, high, source, productId, url, cardName, cardNumber, setName }
//
// 2026-08-16 rewrite: routes tcgcsv.com FIRST (source of truth for TCGplayer
// pricing — same underlying data, but as a static daily-refreshed catalog
// so we can search deterministically instead of relying on TCGplayer's
// flaky text-search endpoint). Falls back to TCGplayer live search only
// when tcgcsv can't resolve the card (e.g. brand-new sets not yet indexed).

import { resolveCardPrice, resolveCardByName, gameToCategoryId, normalizeSetName } from './_tcgcsv.js';

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

  // Cache key bumped v5→v6 (2026-08-19). v4 caught the $99,999 sentinel,
  // v5 added mid-preference for low-lister distortion, v6 replaces both
  // with a trimmed-weighted-mean across low/market/mid/high so the
  // headline price is always a proper average of non-outlier sales.
  // 2026-09-03: bumped v6 -> v7 to invalidate every cached price at once.
  // The old cache holds prices for 1st Edition / Shadowless / wrong-set matches
  // written before the variant and set-mismatch fixes shipped. TTL is 30 min,
  // so without this bump we'd wait half an hour with wrong numbers on prod.
  // v9 (2026-09-03): headline selection changed -- the ask-blend fallback that
  // turned a $1,000 Market into a $19,800 headline is gone, and Pokemon
  // name-only lookups now refuse ambiguous printings. A code change does NOT
  // invalidate KV, so the key must move with the pricing logic or every cached
  // entry keeps serving the old, wrong number.
  //
  // v10 (2026-09-03, same day): 562149f closed a fallback loophole in the live
  // TCGplayer search that had allowed the resolver's rejected identities to be
  // resurrected -- so during the ~15 minutes between 592dd00 and 562149f a
  // handful of v9 entries got written by the still-broken path. Prod verify
  // caught "Iono" served as "Iono Premium Tournament Collection Display" at
  // $318.12 with cacheAgeSec 796 under the fresh v9 key. Rotate to v10 so the
  // 17-minute remainder of that TTL does not keep serving the bad number.
  const cacheKey = `v10|${game}|${name}|${set}|${number}|${rarity}`.toLowerCase();
  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  const cached = await getCached(kvUrl, kvToken, cacheKey);
  if (cached) {
    _incrSearchStats(kvUrl, kvToken);
    const cacheAgeSec = cached.fetchedAt
      ? Math.round((Date.now() - new Date(cached.fetchedAt).getTime()) / 1000)
      : 0;
    // 2026-08-30: clamp cached entries too — old cache values written before
    // the clamp landed still have outlandish highs. Applying on read too
    // eliminates the 4-6h stale-cache window without a full cache flush.
    const out = { ...cached, cached: true, cacheAgeSec };
    _clampHighPriceInPlace(out);
    return res.status(200).json(out);
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
      const rByName = await resolveCardByName({
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
      // 2026-09-03: an explicit refusal must not be papered over by the live
      // fuzzy fallback below. If the resolver saw several sets and said it
      // could not tell them apart, tell the caller so they can prompt for a
      // set instead of getting an arbitrary high-scoring fuzzy match.
      if (rByName && rByName.reason === 'ambiguous_printing') {
        const data = {
          market: null, low: null, mid: null, high: null,
          source: 'tcgcsv', game, categoryId,
          reason: 'ambiguous_printing',
          candidateCount: rByName.candidateCount,
          candidateGroups: rByName.candidateGroups,
          candidates: rByName.candidates,
          fetchedAt: new Date().toISOString(),
          cacheAgeSec: 0,
        };
        await setCache(kvUrl, kvToken, cacheKey, data);
        _incrSearchStats(kvUrl, kvToken);
        return res.status(200).json(data);
      }
      r = rByName;
    }

    // 2026-08-19: Guard against TCGplayer's $99,999 "no data" sentinel.
    // TCGplayer uses 99999 as a placeholder when a product has no active
    // listings / market data yet (common for brand-new sets before pricing
    // stabilizes). Passing it through as if it were a real market price
    // makes the app look broken — caught in bulk-scan test 2026-08-19
    // where a One Piece Luffy card showed "$99,999.00" as the market price.
    if (r && r.ok && r.market != null && !_isSentinelPrice(r.market)) {
      // 2026-08-19: Trimmed-mean pricing. TCGcsv gives us four price points
      // (low / market / mid / high). Any single one can mislead:
      //   • "market" (last-sale) gets dragged down by a single $0.01 lister
      //   • "low" is always the cheapest active listing (often a firesale)
      //   • "high" often reflects a holdout listing 10-100× above real value
      //   • "mid" (median) is stable but ignores recent movement
      // Solution: compute an average across the middle of the distribution.
      // Drop low if it's <30% of mid (outlier low-lister). Drop high if
      // it's >3× mid (outlier holdout). Weight mid ×2 since it IS the
      // median. This produces sensible headline prices across all TCGs:
      //   Elsa    (low $0.01 / mkt $0.07 / mid $0.15 / high $2.29) → $0.12
      //   Harpy   (low $0.02 / mkt $0.28 / mid $0.30 / high $3.98) → $0.29
      //   Normal  (low $1.00 / mkt $1.10 / mid $1.15 / high $1.30) → $1.14
      const displayMarket = _headlinePrice({
        low: r.low, market: r.market, mid: r.mid, high: r.high,
      });
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
        // 2026-09-03: echo the collector number the resolver actually matched.
        // It was parsed from extendedData all along but never returned, so the
        // price-integrity audit could not verify card identity on the
        // TCGplayer side -- every row scored "indeterminate" on number. An
        // audit that cannot see the number cannot tell a genuine source
        // disagreement from a printing substitution, which is the one
        // distinction it exists to make. Returning it costs nothing.
        cardNumber: r.product?.number || null,
        // 2026-09-03: prefer the resolver's real group name. products.json has
        // no setName field, so name-only lookups were returning an empty set.
        setName: r.groupName || r.product?.setName || set || null,
        imageUrl: r.imageUrl || null,
        url: r.tcgplayerUrl || (r.product?.productId ? `https://www.tcgplayer.com/product/${r.product.productId}` : null),
        fetchedAt: new Date().toISOString(),
        cacheAgeSec: 0,
      };
      const _div = _marketAskDivergence({ market: r.market, mid: r.mid });
      if (_div) data.marketAskDivergence = _div;
      _clampHighPriceInPlace(data);
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
        _clampHighPriceInPlace(data);
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

    // 2026-09-03: same identity discipline as the tcgcsv resolver -- a
    // name-only lookup must not resolve to a sealed collection or a differently
    // named card. "Iono" (name only, no set) came back as "Iono Premium
    // Tournament Collection Display" through this fuzzy path, because the
    // scorer awards +5 for a substring hit and +50 for a number substring,
    // with no equality gate anywhere.
    const _canon = v => String(v || '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/['\u2019\u02bc`]/g, '')
      .replace(/[^a-z0-9]+/gi, ' ')
      .trim()
      .toLowerCase();
    const _sealed = v => /\b(box|collection|bundle|tin|deck|pack|case|blister|display|elite trainer|etb|premium)\b/i.test(String(v || ''));
    const _targetCanon = _canon(name);

    const scored = results.map(r => {
      const productName = (r.productName || '').toLowerCase();
      const rSetName    = (r.setName || '').toLowerCase();
      // Filter first, score second. If a result cannot legitimately answer
      // the request, no scoring boost can rehabilitate it.
      if (categoryId === 3) {
        if (_sealed(r.productName)) return { r, score: -1 };
        // stripCollectorSuffix-style trim: "- 185/193" and "- 3/70 (#39 ...)"
        const pnStripped = productName.replace(/\s*-\s*\d+\/\d+.*$/, '');
        if (_canon(pnStripped) !== _targetCanon) return { r, score: -1 };
      }
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
    const passing = scored.filter(x => x.score > 0);
    if (!passing.length) {
      return res.status(200).json({
        market: null, low: null, mid: null, high: null,
        source: 'tcgplayer-live', count: 0, reason: 'no_valid_match',
      });
    }
    let best = passing[0].r;
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

    // 2026-09-03: honour the set the caller gave us.
    // TCGplayer's fuzzy search accepts &setName= but does not treat it as a
    // hard filter, so it will happily answer a modern-set query with a
    // vintage product. `name=Charizard&set=Evolving Skies` came back as
    // 'Base Set (Shadowless)' at $10,000 -- a real price for a card the user
    // does not own. If the caller named a set and the winner belongs to a
    // different one, report no match rather than a confident wrong number.
    if (set && best.setName && normalizeSetName(best.setName) !== normalizeSetName(set)) {
      return res.status(200).json({
        market: null, low: null, mid: null, high: null,
        source: 'tcgplayer-live', count: 0,
        reason: 'set_mismatch',
        requestedSet: set,
        matchedSet: best.setName,
      });
    }

    const data = {
      market, low, mid, high,
      source: 'tcgplayer-live',
      productId,
      cardName: best.productName,
      // The live search result carries no discrete number field -- TCGplayer
      // embeds the collector number in the product name ("Charizard - 4/102",
      // "Iono #185"). Parse it out so the response still reports an observable
      // number for identity auditing. Stays null when the name contains none;
      // a null reads as "could not verify", which is the truth here, and is
      // never scored as a match.
      // Allows an alphabetic prefix: Scarlet & Violet promos number as
      // "SV049/SV122", so a digits-only pattern silently missed every one.
      cardNumber: best.number
        || (/(?:^|[\s\-#])([A-Za-z]{0,3}\d+[a-z]?)\s*\/\s*[A-Za-z]{0,3}\d+/i.exec(String(best.productName || ''))?.[1])
        || (/#\s*([A-Za-z]{0,3}\d+[a-z]?)\b/.exec(String(best.productName || ''))?.[1])
        || null,
      setName: best.setName,
      url: productId ? `https://www.tcgplayer.com/product/${productId}` : null,
      fetchedAt: new Date().toISOString(),
      cacheAgeSec: 0,
    };
    _clampHighPriceInPlace(data);
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
// 2026-08-30: universal high-price clamp applied to every response path.
// TCGplayer/tcgcsv/Scryfall/etc.  highPrice fields are current-listing max,
// which includes sniper listings ($214k Mickey Mouse from a troll, $5000
// Mew from a scammer). Real users see the range and lose trust when High
// is 10-1000x Market. Clamp to 3x Market (or 3x Mid). Mutates data in
// place — caller returns immediately after so no aliasing concerns.
const _HIGH_CAP_MULT = 3.0;
function _clampHighPriceInPlace(data) {
  if (!data || typeof data !== 'object') return data;
  const anchor = data.market != null ? data.market : data.mid;
  if (anchor != null && anchor > 0 && data.high != null && data.high > anchor * _HIGH_CAP_MULT) {
    data.highRaw     = data.high;
    data.highClamped = true;
    data.high        = Math.round(anchor * _HIGH_CAP_MULT * 100) / 100;
  }
  return data;
}

const _PRICE_SENTINELS = new Set([99999, 999999, 99999.99]);
function _isSentinelPrice(n) {
  if (n == null) return false;
  const v = Number(n);
  if (!Number.isFinite(v)) return false;
  return _PRICE_SENTINELS.has(v) || v >= 99999;
}

// 2026-08-19: Trimmed-weighted mean across low/market/mid/high.
// Drops outliers on both tails then averages, weighting mid ×2 since
// it's the true median. Falls back to market when mid is unavailable.
// Returns a positive Number rounded to 2 decimal places, or null if
// there's no usable data.
// Headline price.
//
// 2026-09-03: market price is now the headline, not a blend.
//
// TCGplayer gives us four numbers, and they are not the same kind of thing:
//   marketPrice  -- derived from COMPLETED SALES. What the card actually sold for.
//   lowPrice     -- cheapest ACTIVE LISTING (an ask)
//   midPrice     -- median ACTIVE LISTING (an ask)
//   highPrice    -- dearest ACTIVE LISTING (an ask)
//
// The old headline averaged marketPrice together with the ask statistics,
// weighting mid double. That mixes units: it blends "what it sold for" with
// "what people are hoping to get". Any card with a thick tail of cheap asks
// gets dragged below its own sale price.
//
// Base Set 2 Charizard #4 (product 42479) is the worked example:
//   market $500.12   low $309.48   mid $444.99   high $3000
//   old headline = (444.99*2 + 500.12 + 309.48) / 4 = $424.90
// We published $424.90 for a card whose own last-sale figure was $500.12 --
// $75.22 under, on the exact card the audit started from. After eBay fees
// that understates the payout by about $65.
//
// So: publish the sale price. Keep the blend only as a fallback for when
// marketPrice is absent, and as a sanity valve when marketPrice is wildly
// out of line with the ask book (stale or erroneous).
//
// The ask statistics are not thrown away -- they now feed Quick Pricing,
// where an ask is exactly the right quantity to show.
function _headlinePrice({ low, market, mid, high }) {
  const num = (v) => {
    if (v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (_isSentinelPrice(n)) return null;
    return n;
  };
  const M = num(market);
  const D = num(mid);

  // No sale price to trust -- fall back to the blend.
  if (M == null) return _trimmedMean({ low, market, mid, high });

  // 2026-09-03 REMOVED: the "sanity valve" that fell back to the ask blend
  // whenever Market disagreed with the median ask by more than 3x.
  //
  // The valve assumed a big Market/ask gap means Market is stale or erroneous.
  // On thin vintage books the opposite is true: there ARE no recent sales, so a
  // few holdout asks sit far above the last real transaction, and the valve then
  // published those asks as if they were a sale price.
  //
  // Worked example, EX Dragon Frontiers Charizard Star #100 (product 84198).
  // TCGCSV for that product:
  //     marketPrice $1,000.00   low $18,500   mid $20,000   high $39,500
  // The valve fired, and the blend returned $19,800 -- a 1% undercut of the
  // median ASK. Production served $19,800 for a card whose only actual-sales
  // figure was $1,000. That is a 19.8x overstatement handed to a seller as a
  // valuation, and it is the single largest error this audit found.
  //
  // Market and asks are different quantities and one must never be relabelled
  // as the other. We publish the sale price when we have one. Where the two
  // disagree sharply we say so (see marketAskDivergence in the payload) instead
  // of quietly swapping in a number that answers a different question.
  //
  // The blend remains the fallback for when marketPrice is genuinely absent,
  // which is the one case where an ask is the best available signal.
  return Math.round(M * 100) / 100;
}

// Reports a sharp disagreement between the completed-sales Market and the
// median active ask. This used to silently rewrite the headline; now it is
// disclosed so the UI can warn instead of guessing which side is right.
// Deliberately returns null (not a thrown error) when either side is missing --
// absence of an ask book is not a divergence.
function _marketAskDivergence({ market, mid }) {
  const num = (v) => {
    if (v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (_isSentinelPrice(n)) return null;
    return n;
  };
  const M = num(market);
  const D = num(mid);
  if (M == null || D == null) return null;
  const ratio = M / D;
  if (ratio <= 3 && ratio >= 1 / 3) return null;
  return {
    market: Math.round(M * 100) / 100,
    medianAsk: Math.round(D * 100) / 100,
    ratio: Math.round(ratio * 1000) / 1000,
    // Which way the book leans, so copy does not have to recompute it.
    direction: ratio > 1 ? 'sales_above_asks' : 'asks_above_sales',
  };
}

function _trimmedMean({ low, market, mid, high }) {
  const num = (v) => {
    if (v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (_isSentinelPrice(n)) return null;
    return n;
  };
  const L = num(low);
  const M = num(market);
  const D = num(mid);   // median
  const H = num(high);

  // If we don't have a median, just fall back to market (or mid if that's
  // all we have). Can't do robust trimming without a center point.
  if (D == null) return M != null ? Math.round(M * 100) / 100 : null;

  // Build the weighted sample. mid always in with weight 2. market always
  // in with weight 1. low + high included only if within reasonable bands
  // around mid.
  const points = [{ v: D, w: 2 }];
  if (M != null) points.push({ v: M, w: 1 });
  // Drop low if it's < 30% of mid — that's a firesale/error listing.
  if (L != null && L >= D * 0.3) points.push({ v: L, w: 1 });
  // Drop high if it's > 3× mid — that's a holdout listing not real market.
  if (H != null && H <= D * 3) points.push({ v: H, w: 1 });

  const sumW = points.reduce((s, p) => s + p.w, 0);
  const sumV = points.reduce((s, p) => s + p.v * p.w, 0);
  if (sumW === 0) return null;
  return Math.round((sumV / sumW) * 100) / 100;
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
