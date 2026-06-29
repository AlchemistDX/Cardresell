// /api/sports — Sports card sold comp proxy
// Uses eBay Finding API (requires EBAY_APP_ID env var from eBay Developer Program)
// Falls back to returning structured search links if no key set

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { q, sport = 'Baseball', year = '', brand = '', grade = '' } = req.query;
  if (!q || q.length < 2) return res.status(400).json({ error: 'Query required' });

  const appId = process.env.EBAY_APP_ID;

  if (!appId) {
    // No eBay app ID yet — return structured search URLs the frontend can use
    const buildQuery = (extraGrade) => {
      const parts = [q, year, brand, extraGrade || (grade !== 'Raw/Ungraded' ? grade : ''), sport + ' card'].filter(Boolean);
      return parts.join(' ');
    };
    return res.status(200).json({
      mode: 'links',
      results: [
        { label: 'Raw / Ungraded', ebayUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(buildQuery(''))}&_sacat=212&LH_Sold=1&LH_Complete=1` },
        { label: 'PSA 10',         ebayUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(buildQuery('PSA 10'))}&_sacat=212&LH_Sold=1&LH_Complete=1` },
        { label: 'PSA 9',          ebayUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(buildQuery('PSA 9'))}&_sacat=212&LH_Sold=1&LH_Complete=1` },
        { label: 'PSA 8',          ebayUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(buildQuery('PSA 8'))}&_sacat=212&LH_Sold=1&LH_Complete=1` },
        { label: 'BGS 9.5',        ebayUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(buildQuery('BGS 9.5'))}&_sacat=212&LH_Sold=1&LH_Complete=1` },
      ],
    });
  }

  // eBay Finding API — completed/sold items
  try {
    const parts = [q, year, brand, grade !== 'Raw/Ungraded' ? grade : '', sport + ' card'].filter(Boolean);
    const keywords = parts.join(' ');
    const url = new URL('https://svcs.ebay.com/services/search/FindingService/v1');
    url.searchParams.set('OPERATION-NAME', 'findCompletedItems');
    url.searchParams.set('SERVICE-VERSION', '1.0.0');
    url.searchParams.set('SECURITY-APPNAME', appId);
    url.searchParams.set('RESPONSE-DATA-FORMAT', 'JSON');
    url.searchParams.set('keywords', keywords);
    url.searchParams.set('categoryId', '212'); // Sports Trading Cards
    url.searchParams.set('itemFilter(0).name', 'SoldItemsOnly');
    url.searchParams.set('itemFilter(0).value', 'true');
    url.searchParams.set('sortOrder', 'EndTimeSoonest');
    url.searchParams.set('paginationInput.entriesPerPage', '20');
    url.searchParams.set('outputSelector', 'SellerInfo');

    const r = await fetch(url.toString(), { headers: { 'User-Agent': 'CardResell/1.0' } });
    const data = await r.json();

    const items = data?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];
    if (!items.length) {
      return res.status(200).json({ mode: 'no_results', query: keywords, results: [] });
    }

    const sales = items.map(item => ({
      title:    item.title?.[0] || '',
      price:    parseFloat(item.sellingStatus?.[0]?.currentPrice?.[0]?.['__value__'] || 0),
      currency: item.sellingStatus?.[0]?.currentPrice?.[0]?.['@currencyId'] || 'USD',
      date:     item.listingInfo?.[0]?.endTime?.[0] || '',
      url:      item.viewItemURL?.[0] || '',
      img:      item.galleryURL?.[0] || '',
      condition: item.condition?.[0]?.conditionDisplayName?.[0] || '',
    })).filter(s => s.price > 0);

    // Calculate stats
    const prices = sales.map(s => s.price).sort((a, b) => a - b);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const low = prices[0];
    const high = prices[prices.length - 1];
    const median = prices[Math.floor(prices.length / 2)];

    return res.status(200).json({
      mode: 'data',
      query: keywords,
      stats: { avg: +avg.toFixed(2), low: +low.toFixed(2), high: +high.toFixed(2), median: +median.toFixed(2), count: sales.length },
      sales: sales.slice(0, 10),
    });
  } catch (err) {
    return res.status(500).json({ error: 'eBay API error', detail: err.message });
  }
}
