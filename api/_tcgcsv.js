// api/_tcgcsv.js — Reliable TCGPlayer pricing via tcgcsv.com
// 2026-08-17: pokemontcg.io has been intermittently 500/502'ing (1/5 success in
// audit) and its embedded tcgplayer.prices are stale or missing for many new
// sets. tcgcsv.com mirrors the TCGPlayer catalog + live prices reliably and
// cheaply. This module resolves a card's precise TCGPlayer product + price.
//
// 2026-08-18: generalized to accept categoryId so Lorcana, One Piece, MTG,
// YuGiOh, and Pokemon Japan share the same resolver. Backwards-compatible:
// omitting categoryId defaults to Pokemon (3).
//
// TCGPlayer category IDs:
//   1  = Magic
//   2  = YuGiOh
//   3  = Pokemon
//   68 = One Piece Card Game
//   71 = Lorcana TCG
//   85 = Pokemon Japan
//
// Cache strategy (Upstash KV) — namespaced by categoryId so games don't collide:
//   tcgcsv:{catId}:groups            → 24h TTL
//   tcgcsv:{catId}:products:{gid}    → 6h TTL
//   tcgcsv:{catId}:prices:{gid}      → 30min TTL

const CACHE_TTL = {
  groups:   86400,   // 1 day
  products: 21600,   // 6 hours
  prices:    1800,   // 30 min
};

const DEFAULT_CATEGORY = 3;
const BASE_ROOT = 'https://tcgcsv.com/tcgplayer';
const UA = { 'User-Agent': 'Mozilla/5.0 (cardresell.org)' };

export function gameToCategoryId(game) {
  const g = String(game || '').toLowerCase();
  if (g === 'mtg' || g === 'magic') return 1;
  if (g === 'yugioh' || g === 'ygo' || g === 'yu-gi-oh') return 2;
  if (g === 'pokemon' || g === '' || g === 'pkm') return 3;
  if (g === 'onepiece' || g === 'one_piece' || g === 'one piece') return 68;
  if (g === 'lorcana' || g === 'disney lorcana' || g === 'disney_lorcana') return 71;
  if (g === 'pokemonjp' || g === 'pokemon_jp' || g === 'pokemon japan') return 85;
  return 3;
}

function baseFor(categoryId) {
  return `${BASE_ROOT}/${categoryId || DEFAULT_CATEGORY}`;
}

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
// categoryId is optional; defaults to Pokemon for backwards-compat.
export async function getGroups(kvUrl, kvToken, categoryId) {
  const cat = categoryId || DEFAULT_CATEGORY;
  const key = `tcgcsv:${cat}:groups`;
  const cached = await kvGet(kvUrl, kvToken, key);
  if (cached) return cached;
  const r = await fetch(`${baseFor(cat)}/groups`, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`tcgcsv groups cat=${cat} ${r.status}`);
  const j = await r.json();
  const groups = (j.results || []).map(g => ({
    groupId: g.groupId,
    name: g.name,
    abbreviation: g.abbreviation || '',
    publishedOn: g.publishedOn,
  }));
  await kvSet(kvUrl, kvToken, key, groups, CACHE_TTL.groups);
  return groups;
}

export async function getProducts(kvUrl, kvToken, groupId, categoryId) {
  const cat = categoryId || DEFAULT_CATEGORY;
  const key = `tcgcsv:${cat}:products:${groupId}`;
  const cached = await kvGet(kvUrl, kvToken, key);
  if (cached) return cached;
  const r = await fetch(`${baseFor(cat)}/${groupId}/products`, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`tcgcsv products ${groupId} cat=${cat} ${r.status}`);
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

export async function getPrices(kvUrl, kvToken, groupId, categoryId) {
  const cat = categoryId || DEFAULT_CATEGORY;
  const key = `tcgcsv:${cat}:prices:${groupId}`;
  const cached = await kvGet(kvUrl, kvToken, key);
  if (cached) return cached;
  const r = await fetch(`${baseFor(cat)}/${groupId}/prices`, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`tcgcsv prices ${groupId} cat=${cat} ${r.status}`);
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
export async function resolveGroupId(kvUrl, kvToken, userSetName, cardNumber, categoryId) {
  if (!userSetName) return null;
  const groups = await getGroups(kvUrl, kvToken, categoryId);
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

// 2026-08-19: YGO card numbers are SET-EN### (e.g. "LOB-EN001", "LOB-001",
// "MP24-EN123"). Return the normalized canonical form for comparison.
// Handles: strips locale (EN/DE/FR/SP/IT/PT/JP/KR/EU/AE/TC/SC), strips
// leading zeros in the numeric part, keeps set prefix. Returns lowercase.
export function normalizeYgoNumber(n) {
  if (!n) return '';
  const s = String(n).trim().toUpperCase();
  const m = s.match(/^([A-Z0-9]{2,6})-(?:EN|DE|FR|SP|IT|PT|JP|KR|EU|AE|TC|SC)?0*(\d+)$/i);
  if (m) return (m[1] + '-' + m[2]).toLowerCase();
  // Fallback: pull all alphanumeric, strip locale, strip leading zeros in tail
  const m2 = s.match(/^([A-Z0-9]{2,6})[\-\s]*(?:EN|DE|FR|SP|IT|PT|JP|KR|EU|AE|TC|SC)?0*(\d+)$/i);
  if (m2) return (m2[1] + '-' + m2[2]).toLowerCase();
  return s.toLowerCase();
}

// 2026-08-19: YGO group-name signals for penalizing promo/tournament/prize
// printings when a base-set printing exists. TCGcsv uses group names like
// "Yu-Gi-Oh Championship Series Prize Cards", "Ultimate Tournament Pack 1",
// "Mega-Tins 2024", "OTS Tournament Pack", "Ghosts From the Past", etc.
const YGO_PROMO_GROUP_PATTERNS = [
  /championship series/i, /world championship/i, /prize card/i, /ycs/i, /wcs/i,
  /tournament pack/i, /ots/i, /astral pack/i, /premium pack/i,
  /mega[- ]?tin/i, /mega tin/i, /tin \d/i,
  /promo/i, /giveaway/i, /jump/i, /shonen/i,
  /gold series/i, /gold pack/i, /ghosts from the past/i, /battle pack/i,
  /speed duel/i, /rush duel/i, /duel devastator/i,
  /special edition/i, /deluxe edition/i, /movie pack/i,
];
export function isYgoPromoGroup(groupName) {
  const s = String(groupName || '');
  return YGO_PROMO_GROUP_PATTERNS.some(re => re.test(s));
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
// Strip only the TRAILING " - N/M" collector-number suffix used by Pokemon
// (e.g. "Ampharos - 090/086"). Do NOT strip subtitles that are part of the
// card name (Lorcana "Elsa - Snow Queen", One Piece "Portgas.D.Ace - Fire").
function stripCollectorSuffix(name) {
  return String(name || '').replace(/\s+-\s+\d+[a-z]?\/\d+[a-z]?\s*(\([^)]*\))?\s*$/i, '').trim();
}

// 2026-08-19: added optional `game` param so YGO can apply stricter rules:
//   - exact card-name match only (no substring — "Dark Magician" must not
//     match "Dark Magician of Chaos")
//   - set-number must match when provided (LOB-001 must resolve to LOB-001,
//     not YCS 2025 Prize Card)
//   - promo/YCS/tin groups are penalized in resolveCardByName below
export function pickProduct(products, targetName, targetNumber, targetRarity, game) {
  if (!products || !products.length) return null;
  const nameLo = String(targetName || '').toLowerCase().trim();
  const isYgo = String(game || '').toLowerCase() === 'yugioh';
  const numTarget = isYgo
    ? normalizeYgoNumber(targetNumber)
    : normalizeNumber(targetNumber);

  // Tokenize target name: "Mewtwo ex" → ["mewtwo", "ex"]
  const targetTokens = nameLo.split(/[\s\-\/]+/).filter(t => t.length > 0);
  const targetHead = targetTokens[0] || '';

  const scored = products.map(p => {
    let nameScore = 0;
    const pNameRaw = String(p.name || '');
    const pCleanRaw = String(p.cleanName || '');
    const pName = pNameRaw.toLowerCase();
    const pClean = pCleanRaw.toLowerCase();
    const pNum = isYgo ? normalizeYgoNumber(p.number) : normalizeNumber(p.number);

    // Build candidate strings to match against:
    //   1. Full name (Lorcana "Elsa - Snow Queen" stays intact)
    //   2. Name with Pokemon collector-number suffix stripped ("Ampharos - 090/086" → "Ampharos")
    //   3. Name with parentheticals stripped ("(Alternate Art Secret)", "(Enchanted)", "(Parallel)")
    //   4. cleanName (tcgcsv-normalized, punctuation-free)
    const nameCollectorStripped = stripCollectorSuffix(pName);
    const nameParenStripped = nameCollectorStripped.replace(/\s*\([^)]*\)/g, '').trim();

    const candidates = [
      pName,
      nameCollectorStripped,
      nameParenStripped,
      pClean,
    ].filter(Boolean);

    if (!nameLo) {
      nameScore = 0;
    } else {
      // Exact match against any candidate
      const exactMatch = candidates.some(c => c === nameLo);
      if (exactMatch) {
        nameScore = 100;
      } else if (isYgo) {
        // 2026-08-19: YGO card names are canonical and short. Substring
        // matches almost always yield the wrong card ("Dark Magician" vs
        // "Dark Magician of Chaos" / "of Destruction" / "the Dragon Knight").
        // Require EXACT match against one of the candidates for YGO —
        // token-supersets and partial matches are rejected.
        nameScore = 0;
      } else {
        // Token-based scoring against the strongest candidate (paren-stripped)
        const partTokens = nameParenStripped.split(/[\s\-\/]+/).filter(t => t.length > 0);
        // Also token-check against cleanName tokens (handles "Monkey.D.Luffy" → ["monkey","d","luffy"])
        const cleanTokens = pClean.split(/[\s\-\/\.]+/).filter(t => t.length > 0);
        const targetCleanTokens = nameLo.split(/[\s\-\/\.]+/).filter(t => t.length > 0);

        const allInName  = targetTokens.every(t => partTokens.includes(t));
        const allInClean = targetCleanTokens.every(t => cleanTokens.includes(t));

        const sameLenName  = targetTokens.length === partTokens.length;
        const sameLenClean = targetCleanTokens.length === cleanTokens.length;

        if ((allInName && sameLenName) || (allInClean && sameLenClean)) nameScore = 95;      // full superset match
        else if (allInName || allInClean)                                nameScore = 60;      // partial — target subset of product
        else if (partTokens.includes(targetHead) && targetTokens.length === 1) nameScore = 55;
        else nameScore = 0;
      }
    }

    // If name score is 0, reject outright (returned as -1 so we can filter).
    if (nameLo && nameScore === 0) return { p, score: -1 };

    let score = nameScore;
    // Number match — strong signal but never enough alone.
    if (numTarget && pNum === numTarget) score += 70;
    // 2026-08-19: YGO — when we have a target number, REJECT products
    // whose number doesn't match. YGO reprints exist across many sets
    // (LOB-001, DPRP-EN006, SDK-001 all can be "Blue-Eyes White Dragon")
    // and the caller told us which one it is. Don't guess.
    if (isYgo && numTarget && pNum && pNum !== numTarget) return { p, score: -1 };
    // Rarity match
    score += rarityScore(p.rarity, targetRarity) * 0.6; // up to 60

    // Prefer base printings over variants when scoring is close.
    // Base cards score higher; "(Enchanted)", "(Cold Foil)", "(Parallel)",
    // "(Alternate Art)", "(Puzzle Insert)", "(Serial Numbered)", numeric
    // suffixes like "(007)" and "(OP12-020)" all get penalized so the plain
    // base printing ranks first when scoring is close.
    if (/\((enchanted|cold foil|parallel|alternate art|puzzle|iconic|epic|serial|serialized|foil)/i.test(pNameRaw)) {
      score -= 20;
    }
    // Also penalize product-code-only parentheticals like "(007)", "(OP12-020)"
    if (/\([A-Z0-9\-]{2,}\)\s*$/.test(pNameRaw)) {
      score -= 10;
    }

    return { p, score, hasPrice: false };
  }).filter(x => x.score > 0);

  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  // Require both a decent name match AND either a number or rarity signal.
  // Lowered from 70 to 60 because non-Pokemon TCGs often lack the rarity
  // signal in bulk-scan (AI can't reliably read Lorcana's Uncommon/Rare/etc).
  // Compensated by the parenthetical penalty above to filter out variants.
  if (best.score < 60) return null;
  return best.p;
}

// ── Extract best price from a product's variant map ───────────
export function bestPriceForProduct(priceMap) {
  if (!priceMap) return { market: null, variant: null };
  // Prefer Holofoil > Normal > Reverse Holofoil (holofoil is typically the
  // primary printing for modern rare/IR/SIR; normal for older sets/commons)
  //
  // 2026-09-03: Unlimited now outranks 1st Edition. It used to be the other
  // way round, which meant a vintage card with both printings on one product
  // record was always priced as 1st Edition. Neo Genesis Lugia #9 (product
  // 86903) carries both subtypes:
  //     1st Edition Holofoil  market $1085.03  low $2999.99  mid $7750.00
  //     Unlimited Holofoil    market  $518.99  low  $498.74  mid  $535.91
  // We returned $5,917 for it -- roughly 15x an unlimited copy. 1st Edition
  // is a scarce, separately-identifiable printing: assuming it is the
  // opposite of conservative, and it is the assumption that overstates.
  // Unlimited is the safe default; a 1st Edition owner knows they have one
  // and can say so.
  const order = [
    'Holofoil', 'Normal', 'Reverse Holofoil',
    'Unlimited Holofoil', 'Unlimited Normal',
    'Foil', 'Cold Foil', 'Rainbow Foil',
    // Premium printings last -- only reached when nothing else is priced.
    '1st Edition Holofoil', '1st Edition Normal',
  ];
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
  // Fallback to first available. Sort premium printings to the back here too,
  // so an unrecognised subtype name can't reintroduce the 1st Edition bias
  // that the ordered list above exists to prevent.
  const _premium = /1st edition|shadowless|first edition|staff|prerelease/i;
  const fallbackKeys = Object.keys(priceMap)
    .sort((a, b) => (_premium.test(a) ? 1 : 0) - (_premium.test(b) ? 1 : 0));
  for (const v of fallbackKeys) {
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
export async function resolveCardPrice({ kvUrl, kvToken, setName, cardName, cardNumber, rarity, categoryId, game }) {
  const cat = categoryId || gameToCategoryId(game);
  const groupId = await resolveGroupId(kvUrl, kvToken, setName, cardNumber, cat);
  if (!groupId) return { ok: false, reason: 'no_group_match', setName, categoryId: cat };

  const [products, prices] = await Promise.all([
    getProducts(kvUrl, kvToken, groupId, cat),
    getPrices(kvUrl, kvToken, groupId, cat),
  ]);

  const product = pickProduct(products, cardName, cardNumber, rarity, game);
  if (!product) return { ok: false, reason: 'no_product_match', groupId, categoryId: cat };

  const priceMap = prices[product.productId] || null;
  const best = bestPriceForProduct(priceMap);

  return {
    ok: true,
    categoryId: cat,
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

// ── Public: name-only resolver (no set required) ──────────────
// Scans recent groups in the category. Used for bulk-scan when the AI
// returns a card name but no set. Batched Promise.allSettled + cap.
export async function resolveCardByName({ kvUrl, kvToken, cardName, cardNumber, rarity, categoryId, game, maxGroupsToScan }) {
  const cat = categoryId || gameToCategoryId(game);
  if (!cardName) return { ok: false, reason: 'no_name', categoryId: cat };

  const groups = await getGroups(kvUrl, kvToken, cat);
  if (!groups?.length) return { ok: false, reason: 'no_groups', categoryId: cat };

  const scanLimit = maxGroupsToScan || 40;
  const isYgo = String(game || '').toLowerCase() === 'yugioh' || cat === 2;
  const sortedGroups = [...groups]
    .sort((a, b) => (b.groupId || 0) - (a.groupId || 0))
    .slice(0, scanLimit);

  // Instead of stopping at the FIRST group with a match, collect ALL matches
  // across all scanned groups, then pick the one with the highest live market
  // price. This prevents falling into a promo/serialized/no-price variant when
  // a priced base printing exists in a different set.
  const batchSize = 8;
  const allMatches = []; // { product, groupId }
  for (let i = 0; i < sortedGroups.length; i += batchSize) {
    const batch = sortedGroups.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(g => getProducts(kvUrl, kvToken, g.groupId, cat).then(products => ({ groupId: g.groupId, products })))
    );
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const product = pickProduct(r.value.products, cardName, cardNumber, rarity, game);
      if (product) {
        // 2026-08-19: attach group name so YGO promo penalty can look it up
        const groupMeta = groups.find(g => g.groupId === r.value.groupId);
        allMatches.push({ product, groupId: r.value.groupId, groupName: groupMeta?.name || '' });
      }
    }
    // Early exit: once we have >=5 candidates, we probably have enough to pick a good one.
    if (allMatches.length >= 5) break;
  }

  if (!allMatches.length) return { ok: false, reason: 'no_product_match', categoryId: cat };

  // Fetch prices for each candidate's group in parallel, pick highest-market card.
  const uniqueGroupIds = [...new Set(allMatches.map(m => m.groupId))];
  const priceMapsByGroup = {};
  await Promise.allSettled(uniqueGroupIds.map(gid =>
    getPrices(kvUrl, kvToken, gid, cat).then(prices => { priceMapsByGroup[gid] = prices; })
  ));

  // 2026-08-19: YGO ranking is DIFFERENT than Pokemon.
  //   Pokemon: pick highest-market variant (holo/special > base).
  //   YGO:     pick BASE-set printing over promo/YCS/tin. Highest
  //            market on YGO usually means YCS prize card ($5000+) or
  //            Mega-Tin promo, not the actual card in the user's hand.
  //            We use a composite score = market_price - promo_penalty
  //            so a $50 base printing beats a $5000 tournament prize.
  let bestMatch = null;
  let bestGroupId = null;
  let bestScore = -Infinity;
  for (const { product, groupId, groupName } of allMatches) {
    const priceMap = priceMapsByGroup[groupId]?.[product.productId] || null;
    const bp = bestPriceForProduct(priceMap);
    const marketVal = bp?.market ?? 0;

    let composite = marketVal;
    if (isYgo) {
      // Heavy penalty for prize/YCS/WCS (usually $100-$5000+ collectibles).
      // Moderate penalty for tins/OTS/tournament packs.
      // The goal: unless the user's card IS a prize card (they'd know), the
      // base-set printing wins.
      if (isYgoPromoGroup(groupName)) {
        // Heavier hit for prize/WCS/YCS cards specifically
        if (/prize card|championship series|world championship|wcs|ycs/i.test(groupName)) {
          composite = marketVal - 10000;
        } else {
          composite = marketVal - 500;
        }
      }
    }

    if (composite > bestScore) {
      bestScore = composite;
      bestMatch = product;
      bestGroupId = groupId;
    }
  }

  // Fallback: if nothing had a price, at least return the first structural match.
  if (!bestMatch) {
    bestMatch = allMatches[0].product;
    bestGroupId = allMatches[0].groupId;
  }

  const priceMap = priceMapsByGroup[bestGroupId]?.[bestMatch.productId] || null;
  const best = bestPriceForProduct(priceMap);

  return {
    ok: true,
    categoryId: cat,
    groupId: bestGroupId,
    product: bestMatch,
    market: best.market,
    low: best.low,
    mid: best.mid,
    high: best.high,
    variant: best.variant,
    allVariants: best.allVariants,
    tcgplayerUrl: bestMatch.url || (bestMatch.productId ? `https://www.tcgplayer.com/product/${bestMatch.productId}` : null),
    imageUrl: bestMatch.imageUrl || null,
  };
}
