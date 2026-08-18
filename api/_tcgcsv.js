// api/_tcgcsv.js — Reliable TCGPlayer pricing via tcgcsv.com
// 2026-08-17: pokemontcg.io has been intermittently 500/502'ing (1/5 success in
// audit) and its embedded tcgplayer.prices are stale or missing for many new
// sets. tcgcsv.com mirrors the TCGPlayer catalog + live prices reliably and
// cheaply. This module resolves a card's precise TCGPlayer product + price.
//
// Data model (categoryId=3 = Pokemon):
//   GET /tcgplayer/3/groups                         → all 217 Pokemon sets
//   GET /tcgplayer/3/{groupId}/products             → all cards in a set
//   GET /tcgplayer/3/{groupId}/prices               → live prices for all products in a set
//
// Each product carries extendedData with clean {Number, Rarity}. Prices split
// by subTypeName: Normal | Holofoil | Reverse Holofoil.
//
// Cache strategy (Upstash KV):
//   tcgcsv:groups            → 24h TTL
//   tcgcsv:products:{gid}    → 6h TTL
//   tcgcsv:prices:{gid}      → 30min TTL (prices move fast)

const CACHE_TTL = {
  groups:   86400,   // 1 day
  products: 21600,   // 6 hours
  prices:    1800,   // 30 min
};

const BASE = 'https://tcgcsv.com/tcgplayer/3';
const UA = { 'User-Agent': 'Mozilla/5.0 (cardresell.org)' };

// ── KV helpers ────────────────────────────────────────────────
async function kvGet(kvUrl, kvToken, key) {
  if (!kvUrl || !kvToken) return null;
  try {
    const r = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
      signal: AbortSignal.timeout(3000),
    });
    const d = await r.json();
    if (d.result) return JSON.parse(d.result);
  } catch(e) {}
  return null;
}

async function kvSet(kvUrl, kvToken, key, value, ttl) {
  if (!kvUrl || !kvToken) return;
  try {
    await fetch(
      `${kvUrl}/setex/${encodeURIComponent(key)}/${ttl}/${encodeURIComponent(JSON.stringify(value))}`,
      { method: 'POST', headers: { Authorization: `Bearer ${kvToken}` }, signal: AbortSignal.timeout(3000) }
    );
  } catch(e) {}
}

// ── tcgcsv fetchers with cache ────────────────────────────────
export async function getGroups(kvUrl, kvToken) {
  const cached = await kvGet(kvUrl, kvToken, 'tcgcsv:groups');
  if (cached) return cached;
  const r = await fetch(`${BASE}/groups`, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`tcgcsv groups ${r.status}`);
  const j = await r.json();
  const groups = (j.results || []).map(g => ({
    groupId: g.groupId,
    name: g.name,
    abbreviation: g.abbreviation || '',
    publishedOn: g.publishedOn,
  }));
  await kvSet(kvUrl, kvToken, 'tcgcsv:groups', groups, CACHE_TTL.groups);
  return groups;
}

export async function getProducts(kvUrl, kvToken, groupId) {
  const key = `tcgcsv:products:${groupId}`;
  const cached = await kvGet(kvUrl, kvToken, key);
  if (cached) return cached;
  const r = await fetch(`${BASE}/${groupId}/products`, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`tcgcsv products ${groupId} ${r.status}`);
  const j = await r.json();
  // Slim down to what we need + reduce cache size
  const products = (j.results || []).map(p => {
    const ext = {};
    for (const e of (p.extendedData || [])) ext[e.name] = e.value;
    return {
      productId: p.productId,
      name: p.name,
      url: p.url,
      imageUrl: p.imageUrl,
      number: ext.Number || '',
      rarity: ext.Rarity || '',
    };
  });
  await kvSet(kvUrl, kvToken, key, products, CACHE_TTL.products);
  return products;
}

export async function getPrices(kvUrl, kvToken, groupId) {
  const key = `tcgcsv:prices:${groupId}`;
  const cached = await kvGet(kvUrl, kvToken, key);
  if (cached) return cached;
  const r = await fetch(`${BASE}/${groupId}/prices`, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`tcgcsv prices ${groupId} ${r.status}`);
  const j = await r.json();
  // Group by productId → { [subType]: {market, low, mid, high} }
  const byProduct = {};
  for (const p of (j.results || [])) {
    if (!byProduct[p.productId]) byProduct[p.productId] = {};
    byProduct[p.productId][p.subTypeName] = {
      market: p.marketPrice,
      low:    p.lowPrice,
      mid:    p.midPrice,
      high:   p.highPrice,
    };
  }
  await kvSet(kvUrl, kvToken, key, byProduct, CACHE_TTL.prices);
  return byProduct;
}

// ── Set name normalization ────────────────────────────────────
// TCGPlayer prefixes many sets: "SV02: Paldea Evolved", "ME04: Chaos Rising",
// "SWSH06: Chilling Reign". User's scanner sends plain names like "Paldea
// Evolved". We normalize both sides to a comparable form.
export function normalizeSetName(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    // Strip common prefixes: "SV02:", "SWSH06:", "ME04:", "XY -"
    .replace(/^(sv|swsh|xy|bw|hgss|dp|sm|me|meg?)\d*\s*:?\s*/i, '')
    .replace(/^ex\s+/i, '')
    .replace(/^pop\s*\d*\s*/i, '')
    // Remove punctuation
    .replace(/[:\-–—&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Resolve set name → groupId ────────────────────────────────
// Strategy: score EVERY group, break ties smartly.
//   1. Exact TCGPlayer name match (case-insensitive)  → 1000
//   2. Exact normalized match                          → 800
//   3. Abbreviation exact match                        → 900
//   4. Substring match                                  → 400 + length bonus
//   5. "TG" number → prefer Trainer Gallery group      → +200
//   6. Prefer OLDER groupId when normalized ties       (Base Set 1999 beats SM Base Set)
export async function resolveGroupId(kvUrl, kvToken, userSetName, cardNumber) {
  if (!userSetName) return null;
  const groups = await getGroups(kvUrl, kvToken);
  const targetRaw = String(userSetName).toLowerCase().trim();
  const target = normalizeSetName(userSetName);
  if (!target) return null;

  const wantsTG = cardNumber && /^tg/i.test(String(cardNumber));

  const scored = groups.map(g => {
    const rawLo = g.name.toLowerCase();
    const n = normalizeSetName(g.name);
    let score = 0;
    let reason = '';

    if (rawLo === targetRaw)           { score = 1000; reason = 'exact_raw'; }
    else if (n === target)             { score = 800;  reason = 'exact_norm'; }
    else if (g.abbreviation && g.abbreviation.toLowerCase() === targetRaw) { score = 900; reason = 'abbr'; }
    else if (n.includes(target))       { score = 500 + Math.min(target.length, 50); reason = 'g_contains_target'; }
    else if (target.includes(n) && n.length >= 4) { score = 400 + Math.min(n.length, 50); reason = 'target_contains_g'; }

    // Trainer Gallery cards (TG01, TG28 etc.) belong to a distinct TCGPlayer group.
    if (wantsTG) {
      if (/trainer gallery/i.test(g.name)) score += 200;
      else if (score > 0) score -= 100; // demote non-TG groups when user has TG number
    } else {
      // If user gave a plain number, PREFER non-Trainer-Gallery version.
      if (/trainer gallery/i.test(g.name) && cardNumber) score -= 50;
    }

    // Modern (SV/ME) sets should NOT be picked when user says an old set name.
    // If normalized names match but one has "scarlet violet" prefix and target doesn't,
    // penalize the modern one so "Base Set" doesn't resolve to SV01/SM/XY variants.
    if (score >= 400 && score < 900) {
      // Tie-breaker: prefer OLDER groupId (lower groupId = older set)
      // Encoded as small fractional so it only breaks ties.
      score -= (g.groupId / 100000);
    }

    return { g, score, reason };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 400) return null;
  return best.g.groupId;
}

// ── Card number normalization ─────────────────────────────────
// TCGPlayer stores as "090/086", pokemontcg.io stores as "90".
export function normalizeNumber(n) {
  if (!n) return '';
  const s = String(n).split('/')[0].trim();
  return s.replace(/^0+/, '').toLowerCase();
}

// ── Rarity family match ───────────────────────────────────────
const SPECIAL_RARITY_KEYWORDS = [
  'illustration', 'special', 'secret', 'hyper', 'rainbow', 'gold', 'shiny',
  'ultra', 'full art', 'alt art', 'trainer gallery', 'radiant',
];

export function rarityScore(candRarity, targetRarity) {
  if (!targetRarity) return 0;
  const c = String(candRarity || '').toLowerCase();
  const t = String(targetRarity).toLowerCase();
  if (!c) return 0;
  if (c === t) return 100;
  // Family match (Illustration Rare vs Special Illustration Rare both contain "illustration")
  for (const kw of SPECIAL_RARITY_KEYWORDS) {
    if (t.includes(kw) && c.includes(kw)) return 70;
  }
  // Base family
  const bases = ['common', 'uncommon', 'rare'];
  if (bases.includes(t) && bases.includes(c)) return 50;
  return 0;
}

// ── Pick best product for (name, number, rarity) ──────────────
// Name is REQUIRED to match. Number and rarity refine but never override name.
export function pickProduct(products, targetName, targetNumber, targetRarity) {
  if (!products || !products.length) return null;
  const nameLo = String(targetName || '').toLowerCase().trim();
  const numTarget = normalizeNumber(targetNumber);

  // Tokenize target name: "Mewtwo ex" → ["mewtwo", "ex"]
  const targetTokens = nameLo.split(/[\s\-\/]+/).filter(t => t.length > 0);
  const targetHead = targetTokens[0] || '';

  const scored = products.map(p => {
    let nameScore = 0;
    const pName = String(p.name || '').toLowerCase();
    const pNum = normalizeNumber(p.number);
    // TCGPlayer names look like "Ampharos - 090/086" or "Mewtwo ex - 150/165"
    const namePart = pName.split(' - ')[0].trim();
    const nameParenStripped = namePart.replace(/\s*\([^)]*\)/g, '').trim(); // strip "(Alternate Art Secret)"
    const partTokens = nameParenStripped.split(/[\s\-\/]+/).filter(t => t.length > 0);

    if (!nameLo) {
      nameScore = 0;
    } else if (namePart === nameLo || nameParenStripped === nameLo) {
      nameScore = 100;
    } else {
      // Every target token must appear as a token in the product name-part.
      // This prevents "Mewtwo" matching "Mewtwo ex" and vice-versa.
      const allTokensPresent = targetTokens.every(t => partTokens.includes(t));
      const sameLength      = targetTokens.length === partTokens.length;
      if (allTokensPresent && sameLength) nameScore = 95;   // superset
      else if (allTokensPresent)          nameScore = 60;   // partial (e.g. target is "Mewtwo", product is "Mewtwo ex")
      else if (partTokens.includes(targetHead) && targetTokens.length === 1) nameScore = 55;
      else nameScore = 0;
    }

    // If name score is 0, reject outright (returned as -1 so we can filter).
    if (nameLo && nameScore === 0) return { p, score: -1 };

    let score = nameScore;
    // Number match — strong signal but never enough alone.
    if (numTarget && pNum === numTarget) score += 70;
    // Rarity match
    score += rarityScore(p.rarity, targetRarity) * 0.6; // up to 60
    return { p, score };
  }).filter(x => x.score > 0);

  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  // Require both a decent name match AND either a number or rarity signal.
  if (best.score < 70) return null;
  return best.p;
}

// ── Extract best price from a product's variant map ───────────
export function bestPriceForProduct(priceMap) {
  if (!priceMap) return { market: null, variant: null };
  // Prefer Holofoil > Normal > Reverse Holofoil (holofoil is typically the
  // primary printing for modern rare/IR/SIR; normal for older sets/commons)
  const order = ['Holofoil', 'Normal', 'Reverse Holofoil', '1st Edition Holofoil', '1st Edition Normal', 'Unlimited Holofoil'];
  for (const v of order) {
    const p = priceMap[v];
    if (p && (p.market > 0 || p.mid > 0)) {
      return {
        market: p.market ?? p.mid ?? null,
        low: p.low, mid: p.mid, high: p.high,
        variant: v.toLowerCase().replace(/\s+/g, ''),
        allVariants: priceMap,
      };
    }
  }
  // Fallback to first available
  for (const v of Object.keys(priceMap)) {
    const p = priceMap[v];
    if (p && (p.market > 0 || p.mid > 0)) {
      return {
        market: p.market ?? p.mid ?? null,
        low: p.low, mid: p.mid, high: p.high,
        variant: v.toLowerCase().replace(/\s+/g, ''),
        allVariants: priceMap,
      };
    }
  }
  return { market: null, variant: null };
}

// ── Public: resolve a card to a full price object ─────────────
export async function resolveCardPrice({ kvUrl, kvToken, setName, cardName, cardNumber, rarity }) {
  const groupId = await resolveGroupId(kvUrl, kvToken, setName, cardNumber);
  if (!groupId) return { ok: false, reason: 'no_group_match', setName };

  const [products, prices] = await Promise.all([
    getProducts(kvUrl, kvToken, groupId),
    getPrices(kvUrl, kvToken, groupId),
  ]);

  const product = pickProduct(products, cardName, cardNumber, rarity);
  if (!product) return { ok: false, reason: 'no_product_match', groupId };

  const priceMap = prices[product.productId] || null;
  const best = bestPriceForProduct(priceMap);

  return {
    ok: true,
    groupId,
    product,
    market: best.market,
    low: best.low,
    mid: best.mid,
    high: best.high,
    variant: best.variant,
    allVariants: best.allVariants,
    tcgplayerUrl: product.url || (product.productId ? `https://www.tcgplayer.com/product/${product.productId}` : null),
    imageUrl: product.imageUrl || null,
  };
}
