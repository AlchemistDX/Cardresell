// /api/pricecharting — PriceCharting graded pricing (Pokemon, MTG, sports, and more)
// GET ?name=Charizard+Base+Set&grade=PSA+10&game=pokemon
// Returns response contract compatible with /api/ebay-sold so the client can
// drop it in wherever it used the eBay endpoint:
//   { median, avg, low, high, count, confidence, confidenceScore,
//     confidenceReasons, source, productId, productName, consoleName,
//     url, fetchedAt, cacheAgeSec }
//
// 2026-08-19: Built as the emergency graded-pricing fix per
// qa/GRADED_PRICE_AUDIT_2026-08-19.md — eBay HTML scraping is 100% 403'd from
// Vercel IPs, so users see blank/insufficient prices on every graded card.
// PriceCharting is $49/mo (Legendary tier), covers Pokemon + MTG + YGO + sports.
//
// Env: PRICECHARTING_API_TOKEN — 40-char token from PriceCharting Subscription
// page → "API/Download". If unset, endpoint returns { source: 'unconfigured' }
// with insufficient confidence — the client already handles this gracefully.

const CACHE_TTL_SEC = 6 * 60 * 60; // 6 hours (PriceCharting refreshes daily)

async function getCached(kvUrl, kvToken, key) {
  if (!kvUrl || !kvToken) return null;
  try {
    const r = await fetch(`${kvUrl}/get/${encodeURIComponent('pc_cache:' + key)}`,
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
      `${kvUrl}/setex/${encodeURIComponent('pc_cache:' + key)}/${CACHE_TTL_SEC}/${encodeURIComponent(JSON.stringify(data))}`,
      { method: 'POST', headers: { Authorization: `Bearer ${kvToken}` } }
    );
  } catch(e) {}
}

// Pennies → dollars (integer cents to float, 2dp)
function p(cents) {
  if (cents == null || cents === '' || cents === 0) return null;
  const n = typeof cents === 'number' ? cents : parseInt(cents, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n) / 100;
}

// Map PriceCharting's opaque field names to card-grade prices.
// See pricecharting.com/api-documentation "JSON response fields".
function parsePcPrices(pc) {
  return {
    raw:        p(pc['loose-price']),         // Ungraded
    grade_7:    p(pc['cib-price']),           // "7 or 7.5"
    grade_8:    p(pc['new-price']),           // "8 or 8.5"
    grade_9:    p(pc['graded-price']),        // "9"
    grade_95:   p(pc['box-only-price']),      // "9.5"
    psa_10:     p(pc['manual-only-price']),   // PSA 10 specifically
    bgs_10:     p(pc['bgs-10-price']),
    cgc_10:     p(pc['condition-17-price']),
    sgc_10:     p(pc['condition-18-price']),
  };
}

// Given a grade string ("PSA 10", "BGS 9.5", "raw"), return the price key
// from parsePcPrices that best matches. Falls back with a widening ladder.
function priceKeyForGrade(gradeStr) {
  const s = String(gradeStr || '').trim().toLowerCase();
  if (!s || s === 'raw' || s === 'ungraded') return ['raw'];

  const m = s.match(/^(psa|bgs|cgc|sgc|ace|hga|gma)\s*(\d+(?:\.\d+)?)$/);
  if (!m) return ['raw'];
  const grader = m[1];
  const num    = parseFloat(m[2]);

  // 10s — try grader-specific first, then generic
  if (num === 10) {
    if (grader === 'psa') return ['psa_10', 'grade_9', 'grade_95'];
    if (grader === 'bgs') return ['bgs_10', 'psa_10', 'grade_95'];
    if (grader === 'cgc') return ['cgc_10', 'psa_10', 'grade_95'];
    if (grader === 'sgc') return ['sgc_10', 'psa_10', 'grade_95'];
    return ['psa_10', 'grade_95'];
  }
  if (num >= 9.5)  return ['grade_95', 'psa_10', 'grade_9'];
  if (num >= 9)    return ['grade_9', 'grade_95', 'grade_8'];
  if (num >= 8)    return ['grade_8', 'grade_9', 'grade_7'];
  if (num >= 7)    return ['grade_7', 'grade_8', 'raw'];
  return ['raw'];
}

// Confidence buckets — mirrored from /api/ebay-sold so client UI is consistent.
function confidenceForPc({ hasExactMatch, priceFound, gameMatches }) {
  const reasons = [];
  if (!priceFound) {
    return { confidence: 'insufficient', confidenceScore: 0,
             confidenceReasons: ['no PriceCharting price for that grade'] };
  }
  let score = 60; // baseline for a matched card with a price
  reasons.push('PriceCharting guide value');
  if (hasExactMatch) { score += 20; reasons.push('exact product match'); }
  if (gameMatches)   { score += 10; reasons.push('game confirmed'); }
  const tier = score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low';
  return { confidence: tier, confidenceScore: score, confidenceReasons: reasons };
}

// Very lightweight "does this console-name match the game we asked for" check.
// PriceCharting console-names look like "Pokemon Base Set", "Magic: The Gathering",
// "Yu-Gi-Oh", "Disney Lorcana", "1986 Fleer Basketball", etc.
function consoleMatchesGame(consoleName, game) {
  const c = String(consoleName || '').toLowerCase();
  const g = String(game || '').toLowerCase();
  if (!c || !g) return false;
  if (g === 'pokemon' && c.includes('pokemon')) return true;
  if ((g === 'mtg' || g === 'magic') && (c.includes('magic') || c.includes('mtg'))) return true;
  if (g === 'yugioh' && (c.includes('yu-gi-oh') || c.includes('yugioh'))) return true;
  if (g === 'lorcana' && c.includes('lorcana')) return true;
  if (g === 'onepiece' && (c.includes('one piece') || c.includes('onepiece'))) return true;
  if (g === 'sports' && /basketball|football|baseball|hockey|soccer|fleer|topps|panini|bowman|upper deck/.test(c)) return true;
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const name   = (req.query.name   || req.query.q || '').trim();
  const grade  = (req.query.grade  || '').trim();
  const game   = (req.query.game   || 'pokemon').trim().toLowerCase();
  const number = (req.query.number || '').trim();
  const setStr = (req.query.set    || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });

  const token = process.env.PRICECHARTING_API_TOKEN;
  const fetchedAt = new Date().toISOString();

  // Emergency stopgap: if the key isn't configured yet, return a graceful
  // "insufficient" so the client falls back to eBay/tcgcsv without a crash.
  if (!token) {
    return res.status(200).json({
      median: null, avg: null, low: null, high: null, count: 0,
      confidence: 'insufficient', confidenceScore: 0,
      confidenceReasons: ['PriceCharting not configured'],
      source: 'unconfigured', fetchedAt, cacheAgeSec: 0,
    });
  }

  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  const cacheKey = `v2|${game}|${name}|${setStr}|${number}|${grade}`.toLowerCase();

  const cached = await getCached(kvUrl, kvToken, cacheKey);
  if (cached && cached.fetchedAt) {
    const cacheAgeSec = Math.round((Date.now() - new Date(cached.fetchedAt).getTime()) / 1000);
    return res.status(200).json({ ...cached, cached: true, cacheAgeSec });
  }

  // Build query — PriceCharting fuzzy-matches, so we send name + set + number
  // + game hint. Card number is CRITICAL for sports ("Michael Jordan" alone
  // matches Funko POPs) and for TCGs with reprints across sets.
  const gameHint =
    game === 'pokemon'   ? 'pokemon' :
    game === 'mtg' || game === 'magic' ? 'magic' :
    game === 'yugioh'    ? 'yugioh' :
    game === 'lorcana'   ? 'lorcana' :
    game === 'onepiece'  ? 'one piece' :
    game === 'sports'    ? '' : // sports queries include year/brand already
    '';

  // For sports, the caller (frontend) usually passes name = "MJ 1986 Fleer"
  // already — don't re-append the year. For TCGs, set + number give PC the
  // extra signal it needs to pick the right printing.
  const qParts = [name];
  if (setStr && !name.toLowerCase().includes(setStr.toLowerCase())) qParts.push(setStr);
  if (number) qParts.push(String(number).replace(/^#/, ''));
  if (gameHint && !name.toLowerCase().includes(gameHint)) qParts.push(gameHint);
  const q = qParts.join(' ');
  const url = `https://www.pricecharting.com/api/product?t=${encodeURIComponent(token)}&q=${encodeURIComponent(q)}`;

  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(url, {
      headers: { 'User-Agent': 'CardResell/1.0', 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!r.ok) throw new Error(`PriceCharting returned ${r.status}`);
    const pc = await r.json();

    if (pc.status !== 'success' || !pc.id) {
      const data = {
        median: null, avg: null, low: null, high: null, count: 0,
        confidence: 'insufficient', confidenceScore: 0,
        confidenceReasons: ['no PriceCharting match'],
        source: 'pricecharting', fetchedAt, cacheAgeSec: 0,
      };
      await setCache(kvUrl, kvToken, cacheKey, data);
      return res.status(200).json(data);
    }

    const prices     = parsePcPrices(pc);
    const gameOk     = consoleMatchesGame(pc['console-name'], game);
    const keys       = priceKeyForGrade(grade);

    // Walk the widening ladder — return the first key with a price.
    let picked = null;
    let pickedKey = null;
    for (const k of keys) {
      if (prices[k] != null) { picked = prices[k]; pickedKey = k; break; }
    }

    const { confidence, confidenceScore, confidenceReasons } = confidenceForPc({
      hasExactMatch: true, priceFound: picked != null, gameMatches: gameOk,
    });

    if (picked == null) {
      const data = {
        median: null, avg: null, low: null, high: null, count: 0,
        confidence, confidenceScore, confidenceReasons,
        source: 'pricecharting', productId: pc.id, productName: pc['product-name'],
        consoleName: pc['console-name'],
        url: `https://www.pricecharting.com/game/${encodeURIComponent(pc.id)}`,
        prices, // all grade tiers PriceCharting returned, for the UI to render tabs
        fetchedAt, cacheAgeSec: 0,
      };
      await setCache(kvUrl, kvToken, cacheKey, data);
      return res.status(200).json(data);
    }

    // PriceCharting returns a single value per grade, not a comp list — so
    // median == avg == low == high, and count = 1 (they aggregate internally).
    const data = {
      median: picked, avg: picked, low: picked, high: picked, count: 1,
      confidence, confidenceScore, confidenceReasons,
      source: 'pricecharting', productId: pc.id, productName: pc['product-name'],
      consoleName: pc['console-name'], matchedPriceKey: pickedKey,
      url: `https://www.pricecharting.com/game/${encodeURIComponent(pc.id)}`,
      prices, // all grade tiers, so the client can render "Raw $12 · PSA 9 $45 · PSA 10 $180"
      fetchedAt, cacheAgeSec: 0,
    };
    await setCache(kvUrl, kvToken, cacheKey, data);
    return res.status(200).json(data);

  } catch(e) {
    console.error('pricecharting error:', e.message);
    return res.status(200).json({
      median: null, avg: null, low: null, high: null, count: 0,
      confidence: 'insufficient', confidenceScore: 0,
      confidenceReasons: [e.message || 'PriceCharting request failed'],
      source: 'pricecharting-error', fetchedAt, cacheAgeSec: 0,
    });
  }
}
