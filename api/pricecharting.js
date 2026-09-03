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

// "silver prizm fast break" -> "Silver Prizm Fast Break". PriceCharting's
// brackets are already human-readable; we only fix the casing pcParallelOf
// lowercased, so the dropdown reads like the card does.
function titleCaseParallel(par) {
  return String(par || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
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
  if (g === 'sports' && /basketball|football|baseball|hockey|soccer|fleer|topps|panini|bowman|upper deck|donruss|score|leaf|pro set|action packed|stadium club|skybox/.test(c)) return true;
  return false;
}

// For sports specifically, reject wildly-wrong console matches like Funko POP,
// merch, toys, or non-sport-card items. PriceCharting has a HUGE catalog and
// "Tom Brady" alone hits POP figures with $12 raw prices — 3 orders of
// magnitude off from his rookie card. This is the guard rail.
function isSportsCategoryOk(consoleName) {
  const c = String(consoleName || '').toLowerCase();
  if (!c) return false;
  // Reject known bad matches
  const bad = /funko|pop\!|amiibo|figure|figurine|action figure|plush|comic|manga|dvd|blu-ray|game boy|nintendo|playstation|xbox|sega|atari|arcade|book|magazine|poster|jersey|autograph book/;
  if (bad.test(c)) return false;
  // 2026-09-03: entertainment/licensed sets ship under the SAME brand names as
  // sports cards -- "Marvel 2025 Topps Chrome", "Star Wars 2025 Topps Chrome",
  // "2019 Panini Fortnite", "2025 Bowman GPK NBA", "Topps Garbage Pail Kids x
  // MLB". The old brand-keyword check waved all of these through, so a Tom
  // Brady lookup could resolve to a Star Wars sketch card and report its $50 as
  // a Brady comp. Reject the franchise regardless of brand.
  const franchise = /marvel|star wars|garbage pail|\bgpk\b|fortnite|disney|pokemon|yu-gi-oh|magic the gathering|lorcana|one piece|wacky packages|mars attacks|stranger things|harry potter|halo|call of duty|minecraft|walking dead/;
  if (franchise.test(c)) return false;
  // Require positive signal of "sports card"
  const good = /card|fleer|topps|panini|bowman|upper deck|donruss|score|leaf|pro set|stadium club|skybox|prizm|select|optic|chrome|mosaic|contenders|hoops|absolute/;
  return good.test(c);
}

// Hard admission test for a sports candidate, applied BEFORE scoring.
// Scoring alone is a popularity contest -- it picks the least-bad row even when
// every row is wrong. These are the facts that must actually agree, and when
// nothing clears the bar we return no price rather than a confident wrong one.
function sportsCandidateAdmissible(prod, facets) {
  const pn = String(prod['product-name'] || '').toLowerCase();
  const cn = String(prod['console-name'] || '').toLowerCase();
  if (!isSportsCategoryOk(cn)) return false;

  // 1) The console must name the sport we're actually pricing. PriceCharting
  //    sports consoles read "1986 Fleer Basketball", "2000 Bowman Football".
  if (facets.sport) {
    const s = String(facets.sport).toLowerCase();
    if (/basketball|football|baseball|hockey|soccer/.test(s) && !cn.includes(s)) return false;
  }

  // 2) The release year must appear. A 1986 Fleer Jordan and a 2003 Fleer
  //    Jordan differ by ~100x, so a year mismatch is not a near miss.
  if (facets.year && !(cn + ' ' + pn).includes(String(facets.year))) return false;

  // 3) The player's surname must appear as a whole word in the product name.
  //    This is what separates "Michael Jordan" from "Michael B. Jordan".
  const tokens = String(facets.name || '').toLowerCase()
    .replace(/[^a-z\s.]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !/^(jr|sr|the|iii)\.?$/.test(t));
  if (tokens.length) {
    const surname = tokens[tokens.length - 1].replace(/\.$/, '');
    const esc = surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp('(^|[^a-z])' + esc + '([^a-z]|$)').test(pn)) return false;
  }
  return true;
}

// Whether a PriceCharting product name denotes a NON-DEFAULT printing.
//
// 2026-09-03, third pass. The first two versions of this were a list of
// premium printing names, and the list lost twice in a row. Version one
// caught only the "1st Edition" family, so 'Pikachu / Base Set / 58'
// stopped resolving to [1st Edition] and started resolving to
// [E3 Red Cheeks] at $682.50. Version two added E3 and a dozen friends, so
// the same query moved to [PokeTour 1999] at $198.89 -- against roughly $9
// for the copy in an ordinary binder. Every time we name the masks, the
// query slides to a mask we did not name.
//
// So stop enumerating. PriceCharting's own naming convention is the signal:
// the ordinary printing is bare ("Pikachu #58") and every variant carries a
// bracketed qualifier ("Pikachu [PokeTour 1999] #58"). The bracket IS the
// marker. Testing for the bracket covers every variant PriceCharting has
// today and every one it adds later, without us maintaining a vocabulary.
//
// This is deliberately broad: it also catches cheap variants like
// [Reverse Holo]. That is the correct behaviour -- the rule is not "avoid
// expensive printings", it is "give the caller the printing they asked for",
// and a caller who typed no qualifier is asking for the plain card.
const PC_VARIANT_RE = /\[[^\]]+\]/;

// Whether the CALLER asked for a variant. The user types free text, not
// PriceCharting's bracket convention, so here we do have to recognise
// wording. Under-matching is the safe direction: if we fail to spot that
// the user asked for a 1st Edition, we hand back the plain card and the
// number is low rather than wrong-by-20x.
const PC_ASKED_VARIANT_RE = /\b(1st edition|first edition|shadowless|no rarity|staff|prerelease|pre-release|e3|red cheeks|yellow cheeks|poketour|jumbo|misprint|error|gold star|crystal|autograph|signed|sample|demo|league|championship|winner|reverse holo|cosmos holo)\b/i;


// PriceCharting embeds the collector number in the product name as '#58'.
// Returns the number as a bare string, or null when the name carries none.
function pcNumberOf(productName) {
  const m = /#\s*([A-Za-z0-9]+)/.exec(String(productName || ''));
  return m ? m[1].toLowerCase().replace(/^0+/, '') : null;
}

// Loose equality for collector numbers. '097' and '97' are the same card;
// 'SV107' and '107' are not.
function pcNumberMatches(requested, candidateName) {
  const want = String(requested || '').trim().toLowerCase().replace(/^0+/, '');
  if (!want) return true;               // caller gave no number -- nothing to check
  const got = pcNumberOf(candidateName);
  if (got == null) return true;         // candidate carries no number -- can't disprove
  return got === want;
}

// Extract the bracketed parallel/variant qualifier from a PriceCharting product
// name. "Luka Doncic [Silver Prizm] #280" -> "silver prizm"; a bare
// "Luka Doncic #280" -> null (that IS the base card).
function pcParallelOf(productName) {
  const m = /\[([^\]]+)\]/.exec(String(productName || ''));
  return m ? m[1].trim().toLowerCase() : null;
}

// Sports parallels are where a lookup goes quietly, catastrophically wrong.
// 2018 Panini Prizm Luka #280 exists as the base card AND as [Silver Prizm],
// [Pink Ice Prizm], [White Sparkle Prizm], and ~35 more, spanning three orders
// of magnitude. The old code scored all of them identically -- every facet
// (player, year, brand, number, sport) matches on every one -- so the winner
// was whichever row PriceCharting happened to return first. That is how a
// Wembanyama [Silver] becomes a base-card price, or vice versa.
//
// Rules, in the honest direction:
//   * Caller named a parallel  -> the candidate's bracket must contain every
//     word of it. Nothing matches => refuse. Do NOT fall back to the base card,
//     because "Silver Prizm" priced as base is a wrong number, not a rough one.
//   * Caller named no parallel -> they mean the plain card. Keep only bare
//     (unbracketed) candidates. If the card exists ONLY as parallels we cannot
//     know which one they hold, so refuse rather than guess.
// Returns { keep, reason }. `keep` empty means "no price".
function _parNorm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).join(' ');
}

function filterSportsParallel(cands, wantParallel) {
  const want = String(wantParallel || '').trim().toLowerCase();
  if (want) {
    const wantN = _parNorm(want);
    const words = wantN.split(' ').filter(Boolean);

    // 1) Exact bracket match wins outright.
    const exact = cands.filter(p => _parNorm(pcParallelOf(p['product-name'])) === wantN);
    if (exact.length) return { keep: exact, reason: null };

    // 2) Supersets are NOT a match. A bracket that contains every word asked for
    //    but names more of them is a DIFFERENT card, usually a much rarer one:
    //    asking for [Silver Prizm] and being handed [Silver Prizm Fast Break]
    //    is the exact quiet mispricing this filter exists to prevent. Refuse,
    //    and name what PriceCharting actually has so the user can pick.
    //    Word match is per-token, not substring, so 'gold' cannot match
    //    'goldenrod'.
    const supersets = cands.filter(p => {
      const par = _parNorm(pcParallelOf(p['product-name']));
      if (!par) return false;
      const toks = par.split(' ');
      return words.every(w => toks.includes(w));
    });
    if (supersets.length) {
      const names = [...new Set(supersets.map(p => pcParallelOf(p['product-name'])).filter(Boolean))].slice(0, 6);
      return {
        keep: [],
        reason: `no exact '${want}' parallel -- PriceCharting lists ${names.join(', ')}; pick the exact one`,
      };
    }
    return { keep: [], reason: `no '${want}' parallel in PriceCharting for this card` };
  }
  const bare = cands.filter(p => !pcParallelOf(p['product-name']));
  if (bare.length) return { keep: bare, reason: null };
  const seen = [...new Set(cands.map(p => pcParallelOf(p['product-name'])).filter(Boolean))].slice(0, 6);
  return {
    keep: [],
    reason: `card exists only as parallels (${seen.join(', ')}) -- specify which one`,
  };
}

// Score one PriceCharting sports candidate against the facets we actually know.
// Year is weighted highest: a 1986 Fleer Jordan and a 2003 Fleer Jordan are
// different cards with a 100x price gap, so landing on the wrong year is worse
// than landing on a slightly different parallel.
function scoreSportsCandidate(prod, facets) {
  const pn  = String(prod['product-name'] || '').toLowerCase();
  const cn  = String(prod['console-name'] || '').toLowerCase();
  const hay = pn + ' ' + cn;
  let score = 0;
  if (facets.year  && hay.includes(String(facets.year).toLowerCase()))  score += 40;
  if (facets.brand && hay.includes(String(facets.brand).toLowerCase())) score += 25;
  if (facets.sport && cn.includes(String(facets.sport).toLowerCase()))  score += 15;
  if (facets.number) {
    const n = String(facets.number).replace(/^#/, '').toLowerCase();
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (n && new RegExp('#' + esc + '(\\b|$)').test(pn)) score += 30;
  }
  const tokens = String(facets.name || '').toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (tokens.length) {
    const hits = tokens.filter(t => pn.includes(t)).length;
    score += Math.round((hits / tokens.length) * 20);
  }
  return score;
}

// Build the standard price payload from a fully-fetched PriceCharting product.
// Used by the pcid path so a directly-selected product returns exactly the same
// shape the resolver path returns -- the client must not need to care which
// route produced the number.
function buildPricePayload(pc, { reasons, source, grade, fetchedAt }) {
  const prices = parsePcPrices(pc);
  const ladder = priceKeyForGrade(grade);
  let pickedKey = null, picked = null;
  for (const k of ladder) {
    if (prices[k] != null) { pickedKey = k; picked = prices[k]; break; }
  }
  return {
    median: picked, avg: picked, low: picked, high: picked,
    count: picked == null ? 0 : 1,
    confidence: picked == null ? 'insufficient' : 'high',
    confidenceScore: picked == null ? 0 : 20,
    confidenceReasons: picked == null
      ? ['PriceCharting has no value for that grade on this product']
      : reasons,
    source,
    productId: pc.id,
    productName: pc['product-name'],
    consoleName: pc['console-name'],
    matchedPriceKey: pickedKey,
    parallel: pcParallelOf(pc['product-name']),
    url: `https://www.pricecharting.com/game/${encodeURIComponent(pc.id)}`,
    prices,
    fetchedAt, cacheAgeSec: 0,
  };
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
  const year   = (req.query.year   || '').trim();
  const sport  = (req.query.sport  || '').trim();
  const brand  = (req.query.brand  || '').trim();
  const parallel = (req.query.parallel || '').trim();
  // Sports parallels cannot be typed reliably -- "Silver" is both [Silver Prizm]
  // and [Silver Prizm Fast Break], and the matcher (correctly) refuses that
  // ambiguity. So the UI asks PriceCharting which parallels this card actually
  // has and lets the user pick one, exactly like the Pokemon printing dropdown.
  //   variants=1 -> list the real parallels for this card (1 upstream call)
  //   pcid=<id>  -> price that exact product, no re-resolution, no ambiguity
  const wantVariants = req.query.variants === '1' || req.query.variants === 'true';
  const pcid = (req.query.pcid || '').trim();
  if (!name && !pcid) return res.status(400).json({ error: 'name required' });

  const token = process.env.PRICECHARTING_API_TOKEN;

  // 2026-09-03: PriceCharting serves its guides from TWO hosts, and this was
  // the entire reason sports pricing returned nothing, ever.
  //
  //   pricecharting.com   -> video games, Pokemon/TCG, comics, coins, Funko
  //   sportscardspro.com  -> the sports-card guide (sister site, same account,
  //                          same 40-char token, documented same API paths)
  //
  // Every sports lookup queried the pricecharting.com host, whose catalog holds
  // no sports cards at all. The candidate list came back as Funko POP figures,
  // Garbage Pail Kids and Marvel inserts; the category guard correctly rejected
  // all of them; the endpoint returned a null price. The guard was right and the
  // scoring was right -- we were asking the wrong catalog.
  //
  // Verified 2026-09-03 with the docs' public demo token:
  //   pricecharting.com/api/products?q=1986+fleer+jordan
  //     -> 100 products, ZERO sports categories
  //   sportscardspro.com/api/products?q=1986+fleer+jordan
  //     -> "Basketball Cards 1986 Fleer" / "Michael Jordan #57" as hit #1
  //
  // Display links stay on pricecharting.com: /game/<id> 301-redirects to the
  // right public page for sports ids too, and sportscardspro.com 403s bots.
  const PC_HOST = (game === 'sports')
    ? 'https://www.sportscardspro.com'
    : 'https://www.pricecharting.com';
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
  // 2026-09-03: v2 -> v3 to invalidate cached [1st Edition] matches written
  // before the premium-printing correction shipped.
  // 2026-09-03: v5 -> v6. The sports host fix changes the answer for every
  // sports key (cached nulls would otherwise mask it), and `parallel` is new.
  // 2026-09-03: v6 -> v7. The parallel matcher no longer accepts a superset
  // bracket ([Silver Prizm Fast Break] for "Silver Prizm"), so every cached
  // sports answer written under the old matcher may name the wrong card. Code
  // changes do not invalidate KV on their own -- the key must move with them.
  const cacheKey = `v7|${game}|${name}|${setStr}|${number}|${year}|${grade}|${parallel}|${pcid}|${wantVariants ? 'L' : ''}`.toLowerCase();

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

  // Build query. For SPORTS, year + brand + sport are critical to avoid
  // wildly-wrong matches like Tom Brady → Funko POP NFL. For TCGs, set +
  // number give PC enough signal to pick the right printing.
  const qParts = [];
  if (game === 'sports') {
    // Prepend year to bias PC search toward that release year first
    if (year && !name.includes(year)) qParts.push(year);
    if (brand && !name.toLowerCase().includes(brand.toLowerCase())) qParts.push(brand);
    qParts.push(name);
    if (setStr && !name.toLowerCase().includes(setStr.toLowerCase())) qParts.push(setStr);
    if (number) qParts.push(String(number).replace(/^#/, ''));
    if (sport && !name.toLowerCase().includes(sport.toLowerCase())) qParts.push(sport);
  } else {
    qParts.push(name);
    if (setStr && !name.toLowerCase().includes(setStr.toLowerCase())) qParts.push(setStr);
    if (number) qParts.push(String(number).replace(/^#/, ''));
    if (gameHint && !name.toLowerCase().includes(gameHint)) qParts.push(gameHint);
  }
  const q = qParts.join(' ');
  const url = `${PC_HOST}/api/product?t=${encodeURIComponent(token)}&q=${encodeURIComponent(q)}`;

  // 2026-08-30: retry with backoff on transient PC upstream failures.
  // Root cause found in grade_price_audit_2026-08-30: at even 4 req/s the PC
  // upstream returns 429/5xx or times out for ~40% of requests. The data IS
  // there — cards that returned {source:'pricecharting-error'} succeeded when
  // retried individually. So retry 2x with 400ms + 900ms backoff before
  // giving up, and use 12s per-attempt timeout (was 8s).
  async function fetchPcWithRetry(u) {
    const backoffs = [0, 400, 900]; // 3 attempts total
    let lastErr = null;
    for (let i = 0; i < backoffs.length; i++) {
      if (backoffs[i]) await new Promise(r => setTimeout(r, backoffs[i]));
      try {
        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), 12000);
        const resp = await fetch(u, {
          headers: { 'User-Agent': 'CardResell/1.0', 'Accept': 'application/json' },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (resp.ok) return await resp.json();
        // 5xx and 429 are retryable; 4xx (except 429) are not
        if (resp.status !== 429 && resp.status < 500) {
          throw new Error(`PriceCharting returned ${resp.status}`);
        }
        lastErr = new Error(`PriceCharting returned ${resp.status} (attempt ${i+1})`);
      } catch(e) {
        // AbortError, network, JSON parse — all retryable
        lastErr = e;
      }
    }
    throw lastErr || new Error('PriceCharting failed after retries');
  }

  // SPORTS resolution. PriceCharting's single-best-match endpoint reliably
  // lands on Funko POP figures for player-name queries ("Tom Brady" -> Funko
  // POP NFL, "Michael Jordan" -> POP Basketball), which the category guard then
  // correctly rejected -- so every sports lookup returned a null price. Ask the
  // plural endpoint for the full candidate list instead, drop everything that
  // isn't a real sports-card category, and score the survivors on the facets we
  // know. Then re-fetch the winner by id, because the plural endpoint does not
  // return price fields.
  async function resolveSportsProduct(query, facets) {
    const listUrl = `${PC_HOST}/api/products?t=${encodeURIComponent(token)}&q=${encodeURIComponent(query)}`;
    const list = await fetchPcWithRetry(listUrl);
    const products = Array.isArray(list && list.products) ? list.products : [];
    const seen = [...new Set(products.map(p => p['console-name']).filter(Boolean))].slice(0, 12);
    const ok = products.filter(p => sportsCandidateAdmissible(p, facets));
    if (!ok.length) return { product: null, seen };

    // Parallel discipline BEFORE scoring. Every facet we score on is identical
    // across a card's parallels, so scoring cannot separate them -- it would
    // just return whichever row came back first.
    const par = filterSportsParallel(ok, facets.parallel);
    if (!par.keep.length) {
      return { product: null, seen, parallelReason: par.reason };
    }
    const pool = par.keep;
    pool.sort((a, b) => scoreSportsCandidate(b, facets) - scoreSportsCandidate(a, facets));
    const best = pool[0];
    if (!best || !best.id) return { product: null, seen };
    const byId = await fetchPcWithRetry(
      `${PC_HOST}/api/product?t=${encodeURIComponent(token)}&id=${encodeURIComponent(best.id)}`
    );
    const full = (byId && byId.status === 'success' && byId.id) ? byId : null;
    return {
      product: full, seen, candidateCount: pool.length,
      matchedParallel: pcParallelOf(best['product-name']),
    };
  }

  // ---- Mode: price one exact product by PriceCharting id ------------------
  // The variant dropdown already knows precisely which product the user picked,
  // so re-running fuzzy resolution here could only introduce error.
  if (pcid) {
    try {
      const byId = await fetchPcWithRetry(
        `${PC_HOST}/api/product?t=${encodeURIComponent(token)}&id=${encodeURIComponent(pcid)}`
      );
      const full = (byId && byId.status === 'success' && byId.id) ? byId : null;
      if (!full) {
        const data = {
          median: null, confidence: 'insufficient', confidenceScore: 0,
          confidenceReasons: ['PriceCharting has no product with that id'],
          source: game === 'sports' ? 'sportscardspro' : 'pricecharting',
          fetchedAt, cacheAgeSec: 0,
        };
        await setCache(kvUrl, kvToken, cacheKey, data);
        return res.status(200).json(data);
      }
      const data = buildPricePayload(full, {
        reasons: ['PriceCharting guide value', 'exact product selected'],
        source: game === 'sports' ? 'sportscardspro' : 'pricecharting',
        grade, fetchedAt,
      });
      await setCache(kvUrl, kvToken, cacheKey, data);
      return res.status(200).json(data);
    } catch (e) {
      return res.status(200).json({
        median: null, confidence: 'insufficient', confidenceScore: 0,
        confidenceReasons: ['pricecharting-error'], source: 'pricecharting-error',
        fetchedAt, cacheAgeSec: 0,
      });
    }
  }

  // ---- Mode: list the parallels this card actually has ---------------------
  // One upstream call. No prices: PriceCharting's plural endpoint does not
  // return price fields, and pricing every parallel would cost one call per
  // row at 1 req/sec. The UI prices the row the user selects, via pcid.
  if (wantVariants && game === 'sports') {
    try {
      const listUrl = `${PC_HOST}/api/products?t=${encodeURIComponent(token)}&q=${encodeURIComponent(q)}`;
      const list = await fetchPcWithRetry(listUrl);
      const products = Array.isArray(list && list.products) ? list.products : [];
      const facets = { name, year, brand, number, sport };
      const ok = products.filter(p => sportsCandidateAdmissible(p, facets));
      const seenIds = new Set();
      const variants = [];
      for (const prod of ok) {
        if (!prod.id || seenIds.has(prod.id)) continue;
        seenIds.add(prod.id);
        const par = pcParallelOf(prod['product-name']);
        variants.push({
          id: String(prod.id),
          parallel: par,                          // null == the base card
          label: par ? titleCaseParallel(par) : 'Base card',
          productName: prod['product-name'] || '',
          consoleName: prod['console-name'] || '',
        });
      }
      // Base card first, then parallels alphabetically -- a stable order the
      // user can scan, rather than PriceCharting's arbitrary row order.
      variants.sort((a, b) => {
        if (!a.parallel && b.parallel) return -1;
        if (a.parallel && !b.parallel) return 1;
        return String(a.label).localeCompare(String(b.label));
      });
      const data = {
        mode: 'variants', variants, count: variants.length,
        source: 'sportscardspro',
        candidateConsoles: [...new Set(products.map(p => p['console-name']).filter(Boolean))].slice(0, 12),
        fetchedAt, cacheAgeSec: 0,
      };
      await setCache(kvUrl, kvToken, cacheKey, data);
      return res.status(200).json(data);
    } catch (e) {
      return res.status(200).json({
        mode: 'variants', variants: [], count: 0,
        source: 'pricecharting-error', fetchedAt, cacheAgeSec: 0,
      });
    }
  }

  try {
    let pc;
    if (game === 'sports') {
      const resolved = await resolveSportsProduct(q, { name, year, brand, number, sport, parallel });
      pc = resolved.product;
      if (!pc) {
        const data = {
          median: null, avg: null, low: null, high: null, count: 0,
          confidence: 'insufficient', confidenceScore: 0,
          confidenceReasons: [resolved.parallelReason || 'no sports-card match on PriceCharting'],
          source: 'sportscardspro',
          candidateConsoles: resolved.seen,
          parallelRefused: !!resolved.parallelReason,
          fetchedAt, cacheAgeSec: 0,
        };
        await setCache(kvUrl, kvToken, cacheKey, data);
        return res.status(200).json(data);
      }
    } else {
      pc = await fetchPcWithRetry(url);

      // 2026-09-03: premium-printing correction.
      // PriceCharting's single-best-match endpoint ranks the scarce printing
      // first for vintage queries. "Pikachu / Base Set / 58" resolved to
      // 'Pikachu [1st Edition] #58' at $177.50 while the unlimited copy the
      // user almost certainly owns trades near $9. 'Mewtwo / Base Set / 10'
      // resolved to '[1st Edition]' at $808.90. Both looked like our two price
      // sources disagreeing by ~95%; in fact each was pricing a different card.
      //
      // If the caller did not ask for a premium printing but the match is one,
      // ask the plural endpoint for the full candidate list and prefer a
      // plain printing. Falls through to the original match when no plain
      // candidate exists (genuinely 1st-Edition-only products).
      // Two independent reasons to re-resolve:
      //   a) the match is a premium printing the caller did not ask for
      //   b) the match's collector number is not the one we asked for
      // (b) was missed by the first pass and is its own bug: 'Rayquaza /
      // EX Deoxys / 97' resolved to 'Rayquaza EX #102', a different card in
      // the same set, and we reported the disagreement as a price spread.
      const askedPremium = PC_ASKED_VARIANT_RE.test(`${name} ${setStr}`);
      const matchIsPremium = pc && pc.status === 'success' &&
        PC_VARIANT_RE.test(pc['product-name'] || '');
      const matchWrongNumber = pc && pc.status === 'success' &&
        !pcNumberMatches(number, pc['product-name']);
      if (pc && pc.status === 'success' &&
          ((!askedPremium && matchIsPremium) || matchWrongNumber)) {
        try {
          const listUrl = `${PC_HOST}/api/products?t=${encodeURIComponent(token)}&q=${encodeURIComponent(q)}`;
          const list = await fetchPcWithRetry(listUrl);
          const cands = Array.isArray(list && list.products) ? list.products : [];
          // Same set, right number, and -- unless the caller asked for a
          // premium printing -- a plain one. Number is the hard filter; a
          // candidate with the wrong number is a different card, not a
          // different printing, so it can never be the answer.
          const sameConsole = (p) =>
            String(p['console-name'] || '').toLowerCase() ===
            String(pc['console-name'] || '').toLowerCase();
          const plain = cands.find(p =>
            sameConsole(p) &&
            pcNumberMatches(number, p['product-name']) &&
            (askedPremium || !PC_VARIANT_RE.test(p['product-name'] || ''))
          ) || (matchWrongNumber ? cands.find(p =>
            sameConsole(p) && pcNumberMatches(number, p['product-name'])
          ) : null);
          if (plain && plain.id) {
            const byId = await fetchPcWithRetry(
              `${PC_HOST}/api/product?t=${encodeURIComponent(token)}&id=${encodeURIComponent(plain.id)}`
            );
            if (byId && byId.status === 'success' && byId.id) {
              pc = byId;
              pc._premiumCorrected = true;
              if (matchWrongNumber) pc._numberCorrected = true;
            }
          }
        } catch (e) { /* keep the original match rather than failing the lookup */ }
      }
    }

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

    // SPORTS category guard — reject matches that landed on Funko POP, plush,
    // figures, videogames, etc. Return "no match" instead of a wrong price.
    if (game === 'sports' && !isSportsCategoryOk(pc['console-name'])) {
      const data = {
        median: null, avg: null, low: null, high: null, count: 0,
        confidence: 'insufficient', confidenceScore: 0,
        confidenceReasons: [`sports category mismatch: '${pc['console-name']}'`],
        source: 'pricecharting',
        rejectedProductName: pc['product-name'],
        rejectedConsoleName: pc['console-name'],
        fetchedAt, cacheAgeSec: 0,
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
      // 2026-09-03: sports values come from the sportscardspro guide, not the
      // pricecharting one. Reporting 'pricecharting' here mislabeled every
      // sports success -- the caption told the user to verify on a site that
      // does not list the card.
      source: game === 'sports' ? 'sportscardspro' : 'pricecharting',
      productId: pc.id, productName: pc['product-name'],
      consoleName: pc['console-name'], matchedPriceKey: pickedKey,
      parallel: pcParallelOf(pc['product-name']),
      url: `https://www.pricecharting.com/game/${encodeURIComponent(pc.id)}`,
      prices, // all grade tiers, so the client can render "Raw $12 · PSA 9 $45 · PSA 10 $180"
      fetchedAt, cacheAgeSec: 0,
    };
    await setCache(kvUrl, kvToken, cacheKey, data);
    return res.status(200).json(data);

  } catch(e) {
    console.error('pricecharting error:', e.message);
    // 2026-08-30: cache the ERROR briefly so a hot burst of requests for the
    // same card doesn't hammer PC. 60s is short enough that a transient PC
    // outage doesn't pin bad data in KV for 6h, but long enough to dedupe
    // simultaneous scan retries. Successful results still get the full 6h TTL.
    const errData = {
      median: null, avg: null, low: null, high: null, count: 0,
      confidence: 'insufficient', confidenceScore: 0,
      confidenceReasons: [e.message || 'PriceCharting request failed'],
      source: 'pricecharting-error', fetchedAt, cacheAgeSec: 0,
    };
    // Short-TTL cache for errors only
    if (kvUrl && kvToken) {
      try {
        await fetch(
          `${kvUrl}/setex/${encodeURIComponent('pc_cache:' + cacheKey)}/60/${encodeURIComponent(JSON.stringify(errData))}`,
          { method: 'POST', headers: { Authorization: `Bearer ${kvToken}` } }
        );
      } catch(_) {}
    }
    return res.status(200).json(errData);
  }
}
