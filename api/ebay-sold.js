// /api/ebay-sold — Sold-comp lookup (eBay Finding API decommissioned Feb 2025)
//
// Historical: this used to hit svcs.ebay.com/services/search/FindingService/v1
// (findCompletedItems). That API was killed Feb 5, 2025.
// Replacement (Marketplace Insights API) is limited-release + hard to get.
//
// Current behavior: return {count:0, items:[]} in 200 OK so the frontend
// gracefully falls back to its "View eBay sold →" link path (which uses
// buildEbayUrl() to attach our EPN campid, so we still monetize the click).
//
// Optional bonus: if EBAY_APP_ID + EBAY_CERT_ID are set, we hit Browse API to
// pull ACTIVE listings (not sold) as a secondary signal. Median of active
// listings is a rough upper-bound on sold prices — helpful when we have zero
// sold data. Returned as {activeCount, activeMedian} alongside count:0.
//
// GET ?q=Charizard+SWSH&grade=PSA+10&limit=15
// Returns: { count, avg, median, low, high, items[], activeCount?, activeMedian?, mode }

const BROWSE_API = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const OAUTH_URL  = 'https://api.ebay.com/identity/v1/oauth2/token';
const CACHE_TTL_SEC = 15 * 60;       // sold-comp cache
const TOKEN_TTL_SEC = 2 * 60 * 60;   // OAuth token lasts 2h; cache for 90 min to be safe
const TOKEN_KEY = 'ebay_oauth:app_token';

async function kvGet(kvUrl, kvToken, key) {
  if (!kvUrl || !kvToken) return null;
  try {
    const r = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`,
      { headers: { Authorization: `Bearer ${kvToken}` } });
    const d = await r.json();
    return d.result ? JSON.parse(d.result) : null;
  } catch(e) { return null; }
}

async function kvSetEx(kvUrl, kvToken, key, data, ttlSec) {
  if (!kvUrl || !kvToken) return;
  try {
    await fetch(`${kvUrl}/setex/${encodeURIComponent(key)}/${ttlSec}/${encodeURIComponent(JSON.stringify(data))}`,
      { method: 'POST', headers: { Authorization: `Bearer ${kvToken}` } });
  } catch(e) {}
}

async function getBrowseToken(kvUrl, kvToken) {
  const appId   = process.env.EBAY_APP_ID;
  const certId  = process.env.EBAY_CERT_ID;
  if (!appId || !certId) return null;

  // Cache first
  const cached = await kvGet(kvUrl, kvToken, TOKEN_KEY);
  if (cached && cached.token) return cached.token;

  try {
    const creds = Buffer.from(`${appId}:${certId}`).toString('base64');
    const body  = 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope');
    const r = await fetch(OAUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `Basic ${creds}`,
      },
      body,
    });
    if (!r.ok) {
      console.error('eBay OAuth error:', r.status, await r.text());
      return null;
    }
    const j = await r.json();
    if (!j.access_token) return null;
    // Cache for slightly less than the actual TTL
    const ttl = Math.min((j.expires_in || 7200) - 300, TOKEN_TTL_SEC);
    await kvSetEx(kvUrl, kvToken, TOKEN_KEY, { token: j.access_token }, ttl);
    return j.access_token;
  } catch(e) {
    console.error('eBay OAuth exception:', e);
    return null;
  }
}

async function fetchActiveListings(token, keywords, limit) {
  try {
    const url = new URL(BROWSE_API);
    url.searchParams.set('q', keywords);
    url.searchParams.set('limit', String(Math.min(limit, 50)));
    // Trading Cards category is 2536 (or use category_ids filter)
    url.searchParams.set('category_ids', '2536');

    const r = await fetch(url.toString(), {
      headers: {
        'Authorization':                  `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID':        'EBAY_US',
        'X-EBAY-C-ENDUSERCTX':            'contextualLocation=country=US,zip=34205',
      },
    });
    if (!r.ok) {
      console.error('eBay Browse API error:', r.status);
      return null;
    }
    const j = await r.json();
    const summaries = j.itemSummaries || [];
    const prices = summaries
      .map(it => parseFloat(it?.price?.value || '0'))
      .filter(p => p > 0)
      .sort((a, b) => a - b);
    if (!prices.length) return null;
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 === 0
      ? (prices[mid - 1] + prices[mid]) / 2
      : prices[mid];
    return {
      activeCount:  prices.length,
      activeMedian: Math.round(median * 100) / 100,
      activeLow:    prices[0],
      activeHigh:   prices[prices.length - 1],
    };
  } catch(e) {
    console.error('Browse API exception:', e);
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const q     = (req.query.q     || '').trim();
  const grade = (req.query.grade || '').trim();
  const limit = Math.min(parseInt(req.query.limit) || 15, 25);

  if (!q) return res.status(400).json({ error: 'q required' });

  const keywords = grade ? `${q} ${grade}` : q;
  const cacheKey = 'ebay_sold_v2:' + keywords.toLowerCase() + ':' + limit;

  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  // Check cache first
  const cached = await kvGet(kvUrl, kvToken, cacheKey);
  if (cached) return res.status(200).json({ ...cached, cached: true });

  // Try Browse API for active-listing signal (best-effort — sold data is not
  // accessible without Marketplace Insights API allowlist approval).
  const token = await getBrowseToken(kvUrl, kvToken);
  let activeStats = null;
  if (token) {
    activeStats = await fetchActiveListings(token, keywords, limit);
  }

  // Always return count:0 for the sold-comp fields so frontend falls back to
  // its "View eBay sold →" link path. If we have active-listing data, include
  // it as auxiliary signal (frontend can choose to surface or ignore).
  const data = {
    count:   0,
    avg:     null,
    median:  null,
    low:     null,
    high:    null,
    items:   [],
    mode:    'links_only',    // signal: sold-comp data unavailable, use link fallback
    reason:  'ebay_finding_api_deprecated_2025',
    ...(activeStats || {}),
  };

  await kvSetEx(kvUrl, kvToken, cacheKey, data, CACHE_TTL_SEC);
  return res.status(200).json(data);
}
