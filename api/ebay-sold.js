// /api/ebay-sold — eBay Finding API: findCompletedItems
// GET ?q=Charizard+SWSH&grade=PSA+10&limit=10
// Returns: { avg, median, low, high, count, items[], cached }

const FINDING_API = 'https://svcs.ebay.com/services/search/FindingService/v1';
const CACHE = new Map(); // in-memory, resets per cold start — fine for Vercel
const CACHE_TTL = 15 * 60 * 1000; // 15 min

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const appId = process.env.EBAY_APP_ID;
  if (!appId) return res.status(503).json({ error: 'eBay API not configured' });

  const q     = (req.query.q     || '').trim();
  const grade = (req.query.grade || '').trim(); // e.g. "PSA 10"
  const limit = Math.min(parseInt(req.query.limit) || 15, 25);

  if (!q) return res.status(400).json({ error: 'q required' });

  // Build search keywords: card name + grade if provided
  const keywords = grade ? `${q} ${grade}` : q;
  const cacheKey = keywords.toLowerCase() + ':' + limit;

  // Check cache
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return res.status(200).json({ ...cached.data, cached: true });
  }

  try {
    const params = new URLSearchParams({
      'OPERATION-NAME':        'findCompletedItems',
      'SERVICE-VERSION':       '1.13.0',
      'SECURITY-APPNAME':      appId,
      'RESPONSE-DATA-FORMAT':  'JSON',
      'REST-PAYLOAD':          '',
      'keywords':              keywords,
      'categoryId':            '2536', // Trading Cards
      'itemFilter(0).name':    'SoldItemsOnly',
      'itemFilter(0).value':   'true',
      'itemFilter(1).name':    'ListingType',
      'itemFilter(1).value':   'FixedPrice',
      'sortOrder':             'EndTimeSoonest',
      'paginationInput.entriesPerPage': limit.toString(),
      'outputSelector':        'SellerInfo',
    });

    const r = await fetch(`${FINDING_API}?${params.toString()}`);
    if (!r.ok) {
      console.error('eBay Finding API error:', r.status, await r.text());
      return res.status(502).json({ error: 'eBay API error', status: r.status });
    }

    const raw = await r.json();
    const resp = raw?.findCompletedItemsResponse?.[0];
    const ack  = resp?.ack?.[0];

    if (ack !== 'Success' && ack !== 'Warning') {
      const errMsg = resp?.errorMessage?.[0]?.error?.[0]?.message?.[0] || ack;
      console.error('eBay ack error:', errMsg);
      return res.status(200).json({ error: errMsg, count: 0, items: [] });
    }

    const entries = resp?.searchResult?.[0]?.item || [];
    const items = entries.map(item => {
      const price = parseFloat(item?.sellingStatus?.[0]?.currentPrice?.[0]?.['__value__'] || '0');
      const currency = item?.sellingStatus?.[0]?.currentPrice?.[0]?.['@currencyId'] || 'USD';
      return {
        title:    item?.title?.[0] || '',
        price,
        currency,
        url:      item?.viewItemURL?.[0] || '',
        soldDate: item?.listingInfo?.[0]?.endTime?.[0] || '',
        imgUrl:   item?.galleryURL?.[0] || '',
        itemId:   item?.itemId?.[0] || '',
      };
    }).filter(i => i.price > 0);

    const prices = items.map(i => i.price).sort((a, b) => a - b);
    const count  = prices.length;

    if (count === 0) {
      const data = { count: 0, avg: null, median: null, low: null, high: null, items: [] };
      CACHE.set(cacheKey, { data, ts: Date.now() });
      return res.status(200).json(data);
    }

    const avg    = Math.round((prices.reduce((s, p) => s + p, 0) / count) * 100) / 100;
    const median = count % 2 === 0
      ? Math.round((prices[count / 2 - 1] + prices[count / 2]) / 2 * 100) / 100
      : prices[Math.floor(count / 2)];
    const low  = prices[0];
    const high = prices[count - 1];

    const data = { count, avg, median, low, high, items: items.slice(0, 8) };
    CACHE.set(cacheKey, { data, ts: Date.now() });
    return res.status(200).json(data);

  } catch (e) {
    console.error('ebay-sold error:', e);
    return res.status(500).json({ error: e.message });
  }
}
