// /api/ebay-sold — Fetches eBay sold listings via public search page parsing
// GET ?q=Charizard+PSA+10&grade=PSA+10&limit=10
// No API key needed — reads eBay's public sold search results

const CACHE_TTL_SEC = 15 * 60;

async function getCached(kvUrl, kvToken, key) {
  if (!kvUrl || !kvToken) return null;
  try {
    const r = await fetch(`${kvUrl}/get/${encodeURIComponent('ebay_cache:' + key)}`,
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
      `${kvUrl}/setex/${encodeURIComponent('ebay_cache:' + key)}/${CACHE_TTL_SEC}/${encodeURIComponent(JSON.stringify(data))}`,
      { method: 'POST', headers: { Authorization: `Bearer ${kvToken}` } }
    );
  } catch(e) {}
}

function parsePrice(str) {
  if (!str) return 0;
  return parseFloat(String(str).replace(/[^0-9.]/g, '')) || 0;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const q     = (req.query.q     || '').trim();
  const grade = (req.query.grade || '').trim();
  const limit = Math.min(parseInt(req.query.limit) || 15, 50);
  if (!q) return res.status(400).json({ error: 'q required' });

  const keywords = grade ? `${q} ${grade}` : q;
  const cacheKey = keywords.toLowerCase() + ':' + limit;

  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  const cached = await getCached(kvUrl, kvToken, cacheKey);
  if (cached) return res.status(200).json({ ...cached, cached: true });

  try {
    // eBay public sold search — no auth needed
    const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keywords)}&LH_Complete=1&LH_Sold=1&LH_BIN=1&_sacat=2536&_ipg=${limit}`;

    // Cap eBay fetch at 8s. Without this, a slow eBay response can hang the
    // request for a minute+ and the user's card view stays stuck on
    // '⏳ Fetching eBay sold comps…'. AbortController triggers the catch
    // branch which shows the graceful fallback (View eBay sold → link).
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    let r;
    try {
      r = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!r.ok) {
      throw new Error(`eBay search returned ${r.status}`);
    }

    const html = await r.text();

    // Parse prices from eBay search results HTML
    // eBay uses class="s-item__price" for prices
    const priceMatches = html.match(/class="s-item__price"[^>]*>\s*\$?([\d,]+\.?\d*)/g) || [];
    const prices = priceMatches
      .map(m => {
        const match = m.match(/([\d,]+\.?\d*)/);
        return match ? parseFloat(match[1].replace(',', '')) : 0;
      })
      .filter(p => p > 0.5 && p < 50000);

    // Parse titles
    const titleMatches = html.match(/class="s-item__title"[^>]*>([^<]{5,100})/g) || [];
    const titles = titleMatches.map(m => m.replace(/class="s-item__title"[^>]*>/, '').trim());

    // Parse URLs
    const urlMatches = html.match(/href="(https:\/\/www\.ebay\.com\/itm\/[^"?]+)/g) || [];
    const urls = urlMatches.map(m => m.replace('href="', ''));

    const count = prices.length;
    const ebaySearchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keywords)}&LH_Complete=1&LH_Sold=1&LH_BIN=1&_sacat=2536`;

    if (count === 0) {
      const data = { count: 0, avg: null, median: null, low: null, high: null, items: [], searchUrl: ebaySearchUrl };
      await setCache(kvUrl, kvToken, cacheKey, data);
      return res.status(200).json(data);
    }

    const sorted = [...prices].sort((a, b) => a - b);
    const avg    = Math.round((sorted.reduce((s, p) => s + p, 0) / count) * 100) / 100;
    const median = count % 2 === 0
      ? Math.round((sorted[count/2-1] + sorted[count/2]) / 2 * 100) / 100
      : sorted[Math.floor(count/2)];

    const items = prices.slice(0, 8).map((price, i) => ({
      title: titles[i] || keywords,
      price,
      currency: 'USD',
      url: urls[i] || ebaySearchUrl,
      soldDate: '',
      imgUrl: '',
      itemId: String(i),
    }));

    const data = {
      count,
      avg,
      median,
      low: sorted[0],
      high: sorted[count - 1],
      items,
      searchUrl: ebaySearchUrl,
    };

    await setCache(kvUrl, kvToken, cacheKey, data);
    return res.status(200).json(data);

  } catch(e) {
    console.error('ebay-sold error:', e.message);
    // Return a graceful fallback with search link
    const ebaySearchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keywords)}&LH_Complete=1&LH_Sold=1&LH_BIN=1&_sacat=2536`;
    return res.status(200).json({
      count: 0, avg: null, median: null, low: null, high: null, items: [],
      searchUrl: ebaySearchUrl,
      message: 'View on eBay'
    });
  }
}
