// /api/payout-og
//
// GET /api/payout-og?card=<name>&venues=<v1:pay,v2:pay,v3:pay,...>
//
// Returns a 1200×630 SVG social share image showing the payout ranking for a card.
// Vercel serves SVG directly with Content-Type: image/svg+xml — Twitter/Discord/
// Facebook OG previews all render it as the card thumbnail without needing a
// PNG rasterizer (which would require @vercel/og or Puppeteer, both heavier).
//
// Query params:
//   card    (required)  URL-encoded card name — e.g. "Charizard ex #234"
//   venues  (required)  Comma-separated "name:netPayout" pairs, sorted by caller.
//                       Up to 5 venues rendered. Example:
//                         venues=Fanatics%20Collect:84.12,eBay:71.05,TCGplayer:68.30
//   price   (optional)  Sale-price context — shown as small caption
//
// Cache: 1 hour public — cheap enough to recompute, prevents CDN edge storms.
//
// No auth, no DB writes. This endpoint exists ONLY to give users a
// share-worthy image they can post to Reddit/Discord/Twitter for CardResell
// distribution.

// Emoji lookup mirrors PLATFORMS[].emoji in index.html
const EMOJI = {
  'ebay': '🛒', 'tcgplayer': '🔵', 'poshmark': '👗',
  'comc': '🃏', 'fanatics collect': '💎', 'whatnot': '📡',
  'mercari': '🛍️', 'mana pool': '🔮', 'cardsphere': '🎯',
  'cardmarket': '🌐', 'card kingdom': '👑', 'coolstuffinc': '💪',
  'star city games': '⭐', 'cardnexus': '🌌', 'tcg bulk': '📊',
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmt(n) {
  if (typeof n !== 'number' || isNaN(n)) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function emojiFor(name) {
  return EMOJI[String(name).toLowerCase()] || '💰';
}

export default function handler(req, res) {
  const card   = String(req.query.card || 'Your card').slice(0, 80);
  const price  = req.query.price ? Number(req.query.price) : null;
  const raw    = String(req.query.venues || '').trim();

  if (!raw) {
    res.status(400).json({ error: 'venues query param required, format: name:pay,name:pay,...' });
    return;
  }

  // Parse "Name:pay,Name:pay,..."
  const venues = raw.split(',').slice(0, 5).map(part => {
    const idx = part.lastIndexOf(':');
    if (idx < 1) return null;
    const name = decodeURIComponent(part.slice(0, idx)).trim();
    const pay  = Number(part.slice(idx + 1));
    if (!name || isNaN(pay)) return null;
    return { name, pay };
  }).filter(Boolean);

  if (venues.length < 2) {
    res.status(400).json({ error: 'need at least 2 valid venues' });
    return;
  }

  const best = venues[0].pay;
  const rowH = 68;
  const rowsY0 = 250;

  // Row rendering — bar width scales to venue.pay / best.
  const rows = venues.map((v, i) => {
    const y = rowsY0 + i * rowH;
    const barW = Math.max(80, (v.pay / best) * 720);
    const barColor = i === 0 ? '#4ade80' : (i === 1 ? '#c47a00' : '#71717a');
    const nameColor = i === 0 ? '#4ade80' : '#eeeeee';
    return `
      <g transform="translate(80,${y})">
        <text x="0" y="24" font-family="DM Sans, -apple-system, sans-serif" font-size="26" font-weight="700" fill="#a1a1aa">#${i + 1}</text>
        <text x="60" y="24" font-size="30" fill="#eee">${emojiFor(v.name)}</text>
        <text x="110" y="24" font-family="DM Sans, -apple-system, sans-serif" font-size="26" font-weight="800" fill="${nameColor}">${esc(v.name)}</text>
        <rect x="380" y="8" width="720" height="20" rx="10" fill="#1c1c1f" />
        <rect x="380" y="8" width="${barW}" height="20" rx="10" fill="${barColor}" />
        <text x="1100" y="24" font-family="DM Mono, monospace" font-size="28" font-weight="600" fill="${nameColor}" text-anchor="end">${esc(fmt(v.pay))}</text>
      </g>`;
  }).join('');

  const winner = venues[0];
  const spread = venues[venues.length - 1].pay;
  const deltaStr = fmt(best - spread);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0a0a0b"/>
      <stop offset="1" stop-color="#141416"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#c47a00"/>
      <stop offset="1" stop-color="#e5a13a"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- header -->
  <text x="80" y="88" font-family="DM Sans, -apple-system, sans-serif" font-size="20" font-weight="800" letter-spacing="4" fill="url(#gold)">CARDRESELL · WHERE DO I SELL THIS?</text>
  <text x="80" y="140" font-family="DM Sans, -apple-system, sans-serif" font-size="42" font-weight="900" fill="#eee">${esc(card)}</text>
  <text x="80" y="180" font-family="DM Sans, -apple-system, sans-serif" font-size="22" fill="#a1a1aa">Net payout after fees ${price ? `· list price ${esc(fmt(price))}` : ''}</text>

  <!-- ranking rows -->
  ${rows}

  <!-- footer -->
  <line x1="80" y1="560" x2="1120" y2="560" stroke="#2a2a2e" stroke-width="1"/>
  <text x="80" y="595" font-family="DM Sans, -apple-system, sans-serif" font-size="20" fill="#a1a1aa">
    Winner keeps <tspan fill="#4ade80" font-weight="700">${esc(deltaStr)} more</tspan> than the worst-paying venue
  </text>
  <text x="1120" y="595" font-family="DM Sans, -apple-system, sans-serif" font-size="20" font-weight="700" fill="#c47a00" text-anchor="end">cardresell.org</text>
</svg>`;

  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.status(200).send(svg);
}
