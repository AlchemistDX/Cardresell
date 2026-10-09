// /api/ebay-sold — Fetches eBay sold listings with sanity filtering + confidence scoring
// GET ?q=Charizard+PSA+10&grade=PSA+10&limit=10&tcgMarket=42.00
// Returns { count, rawCount, median, avg, low, high, trueLow, trueHigh,
//           outliersRemoved, confidence, confidenceScore, confidenceReasons,
//           fetchedAt, cacheAgeSec, items, searchUrl }
//
// 2026-08-17 rewrite: TRUST BUNDLE
//   - IQR 1.5x outlier trim (max 25% of comps removed)
//   - Sponsored / "Shop on eBay" / promo strip
//   - Grade word-boundary matching (PSA 10 requires literal "PSA 10", not just "PSA")
//   - Confidence tiers: high >=75, medium 50-74, low 25-49, insufficient <25
//   - Cross-source sanity: pass ?tcgMarket= to catch eBay-vs-TCG divergence
//   - fetchedAt + cacheAgeSec for staleness display

const CACHE_TTL_SEC = 15 * 60;
const COOLDOWN_KEY = 'provider-cooldown-v1';
let cooldownUntil = 0;

// Include response-body consumption in the deadline, not just headers.
async function readResponse(url, init, format, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw Object.assign(new Error('upstream_unavailable'), { status: response.status });
    }
    return await response[format]();
  } finally { clearTimeout(timer); }
}

async function getCached(kvUrl, kvToken, key) {
  if (!kvUrl || !kvToken) return null;
  try {
    const d = await readResponse(`${kvUrl}/get/${encodeURIComponent('ebay_cache:' + key)}`,
      { headers: { Authorization: `Bearer ${kvToken}` } }, 'json', 800);
    if (d.result) return JSON.parse(d.result);
  } catch(e) {}
  return null;
}

async function setCache(kvUrl, kvToken, key, data, ttl = CACHE_TTL_SEC) {
  if (!kvUrl || !kvToken) return;
  try {
    await readResponse(
      `${kvUrl}/setex/${encodeURIComponent('ebay_cache:' + key)}/${ttl}/${encodeURIComponent(JSON.stringify(data))}`,
      { method: 'POST', headers: { Authorization: `Bearer ${kvToken}` } }, 'json', 800
    );
  } catch(e) {}
}

// ── Statistical helpers ─────────────────────────────────────────────────
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  return sorted[base];
}

function median(sorted) {
  if (!sorted.length) return 0;
  const n = sorted.length;
  return n % 2 === 0 ? (sorted[n/2 - 1] + sorted[n/2]) / 2 : sorted[Math.floor(n/2)];
}

function stdev(arr, mean) {
  if (arr.length < 2) return 0;
  const variance = arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

// IQR outlier trim with a 25% max-removal floor.
// Card prices skew, so 1.5x IQR is aggressive enough to nail typos, signed cards,
// graded contamination in raw searches. Floor prevents eating a volatile card's real range.
function trimOutliers(prices) {
  const sorted = [...prices].sort((a, b) => a - b);
  const n = sorted.length;
  if (n < 4) return { kept: sorted, removed: 0, low: sorted[0], high: sorted[n - 1] };

  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  const med = median(sorted);

  // Hard guardrails vs the median (kills 1-cent typos + 4-figure signed-card comps)
  const hardLo = med * 0.30;
  const hardHi = med * 3.0;
  const finalLo = Math.max(lo, hardLo);
  const finalHi = Math.min(hi, hardHi);

  let kept = sorted.filter(p => p >= finalLo && p <= finalHi);
  let removed = n - kept.length;

  // Max-trim floor: never remove more than 25% of comps. If we did, walk it back
  // by keeping the closest-to-median outliers until we're at the 25% floor.
  const maxRemoval = Math.floor(n * 0.25);
  if (removed > maxRemoval) {
    const trimmed = sorted.filter(p => p < finalLo || p > finalHi);
    trimmed.sort((a, b) => Math.abs(a - med) - Math.abs(b - med));
    const toReadd = removed - maxRemoval;
    const readd = trimmed.slice(0, toReadd);
    kept = [...kept, ...readd].sort((a, b) => a - b);
    removed = n - kept.length;
  }

  return { kept, removed, low: kept[0], high: kept[kept.length - 1] };
}

// Confidence 0-100 (buckets: >=75 high, 50-74 medium, 25-49 low, <25 insufficient)
function scoreConfidence({ count, prices, med, outliersRemoved, tcgMarket }) {
  const reasons = [];
  let score = 0;

  // Volume: up to 40 points (5+ comps = ok, 10+ = strong, 20+ = max)
  const volPts = Math.min(count * 4, 40);
  score += volPts;
  reasons.push(`${count} comp${count === 1 ? '' : 's'}`);

  // Spread: up to 30 points (tighter = higher)
  if (count >= 2 && med > 0) {
    const sd = stdev(prices, prices.reduce((s, v) => s + v, 0) / prices.length);
    const cv = (sd / med) * 100; // coefficient of variation as %
    const spreadPts = Math.max(0, 30 - cv);
    score += spreadPts;
    if (cv <= 15) reasons.push(`tight spread ±${cv.toFixed(0)}%`);
    else if (cv <= 30) reasons.push(`moderate spread ±${cv.toFixed(0)}%`);
    else reasons.push(`wide spread ±${cv.toFixed(0)}%`);
  }

  // Outlier ratio: up to 15 points (clean list = higher)
  const outlierPct = count > 0 ? outliersRemoved / (count + outliersRemoved) : 0;
  const outlierPts = Math.max(0, 15 - outlierPct * 60);
  score += outlierPts;
  if (outliersRemoved > 0) reasons.push(`${outliersRemoved} outlier${outliersRemoved === 1 ? '' : 's'} filtered`);

  // Cross-source sanity: up to 15 points (matches TCG market = higher)
  if (tcgMarket && tcgMarket > 0 && med > 0) {
    const ratio = med / tcgMarket;
    if (ratio >= 0.5 && ratio <= 5) {
      score += 15;
    } else if (ratio >= 0.2 && ratio <= 10) {
      score += 7;
      reasons.push('eBay diverges from TCG market');
    } else {
      // Divergence >10x — probably wrong card matched
      reasons.push('eBay ≠ TCG price (verify)');
    }
  }

  score = Math.min(100, Math.round(score));

  let tier;
  if (count < 2) tier = 'insufficient';
  else if (score >= 75) tier = 'high';
  else if (score >= 50) tier = 'medium';
  else if (score >= 25) tier = 'low';
  else tier = 'insufficient';

  return { confidence: tier, confidenceScore: score, confidenceReasons: reasons };
}

function forRequest(cached, tcgMarket) {
  const { _prices, ...data } = cached;
  return Array.isArray(_prices) && _prices.length ? { ...data,
    ...scoreConfidence({ count: data.count, prices: _prices, med: data.median,
      outliersRemoved: data.outliersRemoved, tcgMarket }) } : data;
}

// ── Filters ─────────────────────────────────────────────────────────────
const PROMO_PATTERNS = [
  /shop on ebay/i,
  /sponsored/i,
  /related searches/i,
];

const GRADE_PATTERNS = {
  raw:   /\b(psa|bgs|cgc|sgc|ace|hga|gma)[\s-]*(gem|black|pristine|mint)?[\s-]*\d/i, // presence of any grader = NOT raw
};

// Word-boundary grade match. "PSA 10" requires the title to contain literal "PSA 10",
// "BGS 9.5" requires "BGS 9.5" (with optional decimals), etc.
function makeGradeMatcher(gradeStr) {
  if (!gradeStr) return null;
  const s = String(gradeStr).trim().toLowerCase();
  // Extract grader + number
  const m = s.match(/^(psa|bgs|cgc|sgc|ace|hga|gma)\s*(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const grader = m[1];
  const num = m[2];
  // Match "PSA 10", "PSA10", "PSA-10", "PSA  10"
  const re = new RegExp(`\\b${grader}[\\s\\-]*${num.replace('.', '\\.')}\\b(?!\\.\\d)`, 'i');
  return re;
}

function stripPromoTitle(title) {
  return PROMO_PATTERNS.some(p => p.test(title));
}

// ── Main handler ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const query = req.query || {};
  if (['q', 'grade', 'limit', 'tcgMarket'].some(key => query[key] != null && typeof query[key] !== 'string')) {
    return res.status(400).json({ error: 'Query parameters must be single values' });
  }
  const q = (query.q || '').trim();
  const grade = (query.grade || '').trim();
  const parsedLimit = Number.parseInt(query.limit, 10);
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 50)) : 15;
  const market = Number(query.tcgMarket);
  const tcgMarket = Number.isFinite(market) && market > 0 ? market : 0;
  if (!q) return res.status(400).json({ error: 'q required' });
  if (q.length > 200 || grade.length > 40) return res.status(400).json({ error: 'Query too long' });

  const keywords = grade ? `${q} ${grade}` : q;
  // Separate grade filtering from keywords. Confidence is recalculated using
  // this request's comparison price, so raw comps remain reusable across prices.
  const cacheKey = `v4|${JSON.stringify([q.toLowerCase(), grade.toLowerCase(), limit])}`;

  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  const cached = await getCached(kvUrl, kvToken, cacheKey);
  if (cached && cached.fetchedAt) {
    const cacheAgeSec = Math.round((Date.now() - new Date(cached.fetchedAt).getTime()) / 1000);
    if (cacheAgeSec >= 0 && cacheAgeSec < CACHE_TTL_SEC) {
      return res.status(200).json({ ...forRequest(cached, tcgMarket), cached: true, cacheAgeSec });
    }
  }

  const ebaySearchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keywords)}&LH_Complete=1&LH_Sold=1&LH_BIN=1&_sacat=2536`;
  const fetchedAt = new Date(Date.now()).toISOString();

  const emptyResp = (extra = {}) => ({
    count: 0, rawCount: 0, median: null, avg: null, low: null, high: null,
    trueLow: null, trueHigh: null, outliersRemoved: 0,
    confidence: 'insufficient', confidenceScore: 0, confidenceReasons: ['no comps found'],
    fetchedAt, cacheAgeSec: 0, items: [], searchUrl: ebaySearchUrl,
    ...extra,
  });

  const unavailable = () => emptyResp({ available: false, reason: 'provider_unavailable',
    confidenceReasons: ['sold comparisons temporarily unavailable'], message: 'View on eBay',
    retryAfterSec: Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 1000)) });
  if (cooldownUntil <= Date.now()) {
    const shared = await getCached(kvUrl, kvToken, COOLDOWN_KEY);
    if (Number.isFinite(shared?.until)) cooldownUntil = shared.until;
  }
  if (cooldownUntil > Date.now()) return res.status(200).json(unavailable());

  try {
    const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keywords)}&LH_Complete=1&LH_Sold=1&LH_BIN=1&_sacat=2536&_ipg=${limit}`;

    // Identify the service honestly. A denied request pauses future lookups;
    // it must not trigger attempts to evade the provider's access controls.
    const html = await readResponse(searchUrl, {
      headers: {
        'User-Agent': 'CardResell/1.0 (+https://cardresell.org)',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    }, 'text', 6000);
    if (/pardon our interruption|verify (?:that )?you(?:'re| are) human|robot check/i.test(html)) {
      throw Object.assign(new Error('upstream_unavailable'), { status: 403 });
    }

    // Parse each listing block so we can pair title+price+url and filter promos properly.
    // eBay wraps each result in <li class="s-item ...">, so we split on that boundary.
    const blocks = html.split(/<li[^>]*class="[^"]*s-item[^"]*"[^>]*>/i).slice(1); // drop pre-list junk

    const rawItems = [];
    for (const block of blocks) {
      const priceM = block.match(/class="s-item__price"[^>]*>[^<$]*\$?([\d,]+\.?\d*)/);
      if (!priceM) continue;
      const price = parseFloat(priceM[1].replace(/,/g, ''));
      if (!(price > 0.5 && price < 50000)) continue;

      const titleM = block.match(/class="s-item__title"[^>]*>(?:<span[^>]*>NEW LISTING<\/span>)?\s*([^<]{5,200})/);
      const title  = titleM ? titleM[1].replace(/&amp;/g, '&').trim() : '';
      if (!title) continue;
      if (stripPromoTitle(title)) continue;

      // Watch for eBay's "$8.50 to $12.99" ranges — parsePrice grabbed only the first, which is fine,
      // but drop any listing whose block also contains " to $" near the price (auction range = untrustworthy).
      if (/\$[\d.,]+\s+to\s+\$[\d.,]+/i.test(block.slice(0, 400))) continue;

      const urlM = block.match(/href="(https:\/\/www\.ebay\.com\/itm\/[^"?]+)/);
      const url  = urlM ? urlM[1] : ebaySearchUrl;

      rawItems.push({ title, price, url });
    }

    // Grade filtering: word-boundary match
    let filtered = rawItems;
    if (grade) {
      const matcher = makeGradeMatcher(grade);
      if (matcher) {
        filtered = filtered.filter(it => matcher.test(it.title));
      }
    } else {
      // Raw request — exclude anything that has a grader mention
      filtered = filtered.filter(it => !GRADE_PATTERNS.raw.test(it.title));
    }

    filtered = filtered.slice(0, limit);
    const rawCount = filtered.length;
    if (rawCount === 0) {
      const data = emptyResp();
      await setCache(kvUrl, kvToken, cacheKey, data);
      return res.status(200).json(data);
    }

    // Outlier trim
    const prices = filtered.map(it => it.price);
    const { kept, removed, low, high } = trimOutliers(prices);

    // If <2 comps survive, fall back to raw with low confidence
    let finalPrices = kept;
    let outliersRemoved = removed;
    if (kept.length < 2) {
      finalPrices = [...prices].sort((a, b) => a - b);
      outliersRemoved = 0;
    }

    const count = finalPrices.length;
    const sortedRaw = [...prices].sort((a, b) => a - b);
    const trueLow  = sortedRaw[0];
    const trueHigh = sortedRaw[sortedRaw.length - 1];

    const avg = Math.round((finalPrices.reduce((s, p) => s + p, 0) / count) * 100) / 100;
    const med = Math.round(median(finalPrices) * 100) / 100;

    const { confidence, confidenceScore, confidenceReasons } =
      scoreConfidence({ count, prices: finalPrices, med, outliersRemoved, tcgMarket });

    // Return the items closest to the median first (most representative comps),
    // capped at 8 for payload size
    const itemsWithDist = filtered
      .filter(it => finalPrices.includes(it.price))
      .map(it => ({ ...it, dist: Math.abs(it.price - med) }));
    itemsWithDist.sort((a, b) => a.dist - b.dist);
    const items = itemsWithDist.slice(0, 8).map(({ title, price, url }, i) => ({
      title, price, currency: 'USD', url, soldDate: '', imgUrl: '', itemId: String(i),
    }));

    const data = {
      count,
      rawCount,
      median: med,
      avg,
      low: kept.length >= 2 ? Math.round(low * 100) / 100 : trueLow,
      high: kept.length >= 2 ? Math.round(high * 100) / 100 : trueHigh,
      trueLow, trueHigh,
      outliersRemoved,
      confidence, confidenceScore, confidenceReasons,
      fetchedAt, cacheAgeSec: 0,
      items, searchUrl: ebaySearchUrl, _prices: finalPrices,
    };

    await setCache(kvUrl, kvToken, cacheKey, data);
    return res.status(200).json(forRequest(data, tcgMarket));

  } catch(e) {
    const seconds = [401, 403].includes(e.status) ? 900 : e.status === 429 ? 300 : 30;
    cooldownUntil = Date.now() + seconds * 1000;
    await setCache(kvUrl, kvToken, COOLDOWN_KEY, { until: cooldownUntil }, seconds);
    console.warn('ebay-sold unavailable:', e.status || (e.name === 'AbortError' ? 'timeout' : 'network'));
    return res.status(200).json(unavailable());
  }
}
