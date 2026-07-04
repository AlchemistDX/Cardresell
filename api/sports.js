// /api/sports — Sports card sold comp proxy
//
// eBay Finding API was decommissioned Feb 5, 2025. This endpoint now returns
// structured eBay sold-search URLs (link mode) — the frontend renders these as
// clickable "View sold" affiliate links, so every click still monetizes via
// eBay Partner Network.
//
// Response shape preserved for backwards compat:
//   { mode: 'links', results: [{ label, ebayUrl }, ...] }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { q, sport = 'Baseball', year = '', brand = '', grade = '' } = req.query;
  if (!q || q.length < 2) return res.status(400).json({ error: 'Query required' });

  const buildQuery = (extraGrade) => {
    const parts = [q, year, brand, extraGrade || (grade !== 'Raw/Ungraded' ? grade : ''), sport + ' card'].filter(Boolean);
    return parts.join(' ');
  };

  // Sports Trading Cards category: 212
  return res.status(200).json({
    mode: 'links',
    reason: 'ebay_finding_api_deprecated_2025',
    results: [
      { label: 'Raw / Ungraded', ebayUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(buildQuery(''))}&_sacat=212&LH_Sold=1&LH_Complete=1` },
      { label: 'PSA 10',         ebayUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(buildQuery('PSA 10'))}&_sacat=212&LH_Sold=1&LH_Complete=1` },
      { label: 'PSA 9',          ebayUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(buildQuery('PSA 9'))}&_sacat=212&LH_Sold=1&LH_Complete=1` },
      { label: 'PSA 8',          ebayUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(buildQuery('PSA 8'))}&_sacat=212&LH_Sold=1&LH_Complete=1` },
      { label: 'BGS 9.5',        ebayUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(buildQuery('BGS 9.5'))}&_sacat=212&LH_Sold=1&LH_Complete=1` },
    ],
  });
}
