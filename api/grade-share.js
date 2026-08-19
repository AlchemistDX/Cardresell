// /api/grade-share
//
// GET  /api/grade-share?id=<id>       → HTML page with OG tags (public, no auth)
// POST /api/grade-share                → creates a share, returns { id, url }
//
// KV layout:
//   grade_share:<id>  →  { data, image, cardName, psa, isDeep, createdAt, ownerSub }
//     TTL: 90 days
//     data:    the grade result JSON (subgrades, centering, psa_distribution, etc)
//     image:   base64 front photo (data URL, jpeg)  — capped at ~600KB
//     ownerSub: optional Google sub of the creator (for future "delete my share")
//
// Public read is unauthed on purpose — the whole point is a shareable link.

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// ─── Nano-ID (10 chars, url-safe) ───────────────────────────────────────
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
function nanoid(len = 10) {
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

// ─── KV helpers ─────────────────────────────────────────────────────────
async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j || j.result == null) return null;
  try { return JSON.parse(j.result); } catch { return null; }
}
async function kvSetEx(key, val, ttlSec) {
  await fetch(`${KV_URL}/set/${encodeURIComponent(key)}?EX=${ttlSec}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(val),
  });
}

// ─── Optional auth (best-effort attach ownerSub) ────────────────────────
let _verifyTokenFlexible = null;
async function tryVerify(req) {
  try {
    if (!_verifyTokenFlexible) {
      const mod = require('./_verifyToken.js');
      _verifyTokenFlexible = mod.verifyTokenFlexible || mod.default || null;
    }
    if (!_verifyTokenFlexible) return null;
    return await _verifyTokenFlexible(req);
  } catch { return null; }
}

// ─── Helpers ─────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function gradeColor(psa) {
  return psa >= 9 ? '#4ade80' : psa >= 7 ? '#facc15' : psa >= 5 ? '#fb923c' : '#f87171';
}
function gradeLabel(psa) {
  if (psa >= 10) return 'GEM MINT';
  if (psa >= 9)  return 'MINT';
  if (psa >= 8)  return 'NEAR MINT-MINT';
  if (psa >= 7)  return 'NEAR MINT';
  if (psa >= 6)  return 'EXCELLENT-MINT';
  if (psa >= 5)  return 'EXCELLENT';
  return 'GRADED';
}

// ─── HTML page ───────────────────────────────────────────────────────────
function renderPage({ id, share, host }) {
  const data     = share.data || {};
  const psa      = share.psa || data.psa_estimate || 0;
  const name     = share.cardName || data.card_name || 'Trading card';
  const isDeep   = share.isDeep === true;
  const image    = share.image || '';        // data:image/jpeg;base64,...
  const label    = data.grade_label || gradeLabel(psa);
  const psaDist  = Array.isArray(data.psa_distribution) ? data.psa_distribution.slice(0, 3) : [];
  const eyeApp   = data.eye_appeal || '';
  const centLR   = data.centering_lr || '';
  const centTB   = data.centering_tb || '';
  const corners  = data.corners_desc || data.corners || '';
  const edges    = data.edges_desc   || data.edges   || '';
  const surface  = data.surface_desc || data.surface || '';
  const notes    = data.grade_notes || '';
  const limiting = data.limiting_factor || '';
  const col      = gradeColor(psa);

  // Absolute URL for OG image — has to be publicly fetchable, so we point
  // back at the share page itself with ?image=1 (returns the raw jpeg).
  const shareUrl = `https://${host}/grade/${id}`;
  const ogImage  = image ? `https://${host}/api/grade-share?id=${encodeURIComponent(id)}&image=1` : `https://${host}/logo.png`;
  const title    = `${name} — Est. PSA ${psa} · ${label}`;
  const desc     = isDeep
    ? `Deep Grade analysis: Centering ${centLR || '—'}, Corners ${corners || '—'}. Try it free at cardresell.org.`
    : `Estimated grade: PSA ${psa}. Grade your own cards free at cardresell.org.`;

  const distBar = psaDist.length > 0
    ? `<div class="dist">
         <div class="dist-label">PROBABILITY DISTRIBUTION</div>
         <div class="dist-bars">
           ${psaDist.map((d, i) => {
             const c = d.grade >= 9 ? '#4ade80' : d.grade >= 7 ? '#facc15' : d.grade >= 5 ? '#fb923c' : '#f87171';
             return `<div class="dist-bar" style="flex:${Math.max(0.4, d.pct/100)};background:${c}${i===0?'':'AA'}">
                       <div class="dist-grade">PSA ${d.grade}</div>
                       <div class="dist-pct">${d.pct}%</div>
                     </div>`;
           }).join('')}
         </div>
       </div>`
    : '';

  const subRow = (lab, val) => val
    ? `<div class="sub-row"><span class="sub-lab">${esc(lab)}</span><span class="sub-val">${esc(val)}</span></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">

<!-- Open Graph (Facebook, Discord, LinkedIn) -->
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(shareUrl)}">
<meta property="og:site_name" content="CardResell">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(ogImage)}">

<link rel="icon" type="image/png" href="/logo.png">

<style>
  :root { --gold: #eab308; --grade-col: ${col}; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: linear-gradient(180deg, #0a0f1c 0%, #0f172a 100%);
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    min-height: 100vh;
    padding: 1.2rem 1rem 3rem;
  }
  .wrap { max-width: 480px; margin: 0 auto; }
  .hdr {
    text-align: center;
    padding: .35rem 0 1rem;
    color: rgba(255,255,255,.55);
    font-size: .75rem;
    letter-spacing: .06em;
    font-weight: 700;
  }
  .brand { color: var(--gold); font-weight: 900; font-size: .95rem; letter-spacing: .01em; text-decoration: none; }
  .brand:hover { opacity: .8; }
  .card {
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 16px;
    padding: 1.1rem 1rem;
    margin-bottom: 1rem;
  }
  .photo {
    width: 100%;
    aspect-ratio: 5/7;
    max-width: 320px;
    margin: 0 auto .85rem;
    display: block;
    border-radius: 12px;
    object-fit: cover;
    background: rgba(255,255,255,.05);
    border: 1px solid rgba(255,255,255,.06);
  }
  .photo-fallback {
    width: 100%; max-width: 320px; aspect-ratio: 5/7;
    margin: 0 auto .85rem; display: flex; align-items: center; justify-content: center;
    background: rgba(255,255,255,.04); border: 1px dashed rgba(255,255,255,.15);
    border-radius: 12px; color: rgba(255,255,255,.35); font-size: .8rem;
  }
  .tier-badge {
    display: inline-block;
    font-size: .62rem;
    font-weight: 800;
    padding: .18rem .55rem;
    border-radius: 99px;
    letter-spacing: .05em;
    margin-bottom: .35rem;
    ${isDeep
      ? 'background: linear-gradient(135deg, var(--gold), #f59e0b); color: #000;'
      : 'background: rgba(255,255,255,.12); color: rgba(255,255,255,.75);'}
  }
  .grade {
    font-size: 2.5rem;
    font-weight: 900;
    color: var(--grade-col);
    line-height: 1;
    margin: .2rem 0 .1rem;
    text-align: center;
  }
  .grade-label {
    text-align: center;
    color: rgba(255,255,255,.65);
    font-size: .85rem;
    font-weight: 700;
    letter-spacing: .04em;
    margin-bottom: .3rem;
  }
  .card-name {
    text-align: center;
    color: rgba(255,255,255,.85);
    font-size: 1rem;
    font-weight: 700;
    margin-bottom: .85rem;
    padding: 0 .5rem;
  }
  .dist {
    padding: .55rem .65rem;
    background: rgba(255,255,255,.03);
    border: 1px solid rgba(255,255,255,.06);
    border-radius: 10px;
    margin-bottom: .75rem;
  }
  .dist-label {
    font-size: .58rem;
    font-weight: 800;
    letter-spacing: .06em;
    color: rgba(255,255,255,.5);
    margin-bottom: .4rem;
  }
  .dist-bars { display: flex; gap: .3rem; height: 32px; }
  .dist-bar {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    border-radius: 5px; min-width: 42px;
  }
  .dist-grade { font-size: .68rem; font-weight: 900; color: #000; line-height: 1; }
  .dist-pct   { font-size: .58rem; font-weight: 700; color: rgba(0,0,0,.7); line-height: 1; margin-top: .1rem; }
  .subgrades { padding: .5rem 0; }
  .sub-row {
    display: flex; justify-content: space-between; gap: .8rem;
    padding: .4rem 0; border-bottom: 1px solid rgba(255,255,255,.05);
    font-size: .8rem;
  }
  .sub-row:last-child { border-bottom: 0; }
  .sub-lab { color: rgba(255,255,255,.55); font-weight: 600; }
  .sub-val { color: rgba(255,255,255,.9); font-weight: 700; text-align: right; max-width: 60%; }
  .limiting {
    padding: .55rem .65rem;
    background: rgba(96,165,250,.08);
    border: 1px solid rgba(96,165,250,.22);
    border-radius: 10px;
    margin-top: .5rem;
    font-size: .75rem;
    color: rgba(255,255,255,.85);
    line-height: 1.4;
  }
  .limiting strong { color: #7ea8e8; font-weight: 800; letter-spacing: .04em; }
  .notes {
    margin-top: .5rem; padding: .5rem .65rem;
    background: rgba(255,255,255,.04); border-radius: 10px;
    font-size: .75rem; color: rgba(255,255,255,.7); line-height: 1.5;
  }
  .cta {
    display: block;
    width: 100%;
    padding: .85rem 1rem;
    background: var(--gold);
    color: #000;
    border: none;
    border-radius: 12px;
    font-weight: 900;
    font-size: 1rem;
    text-align: center;
    text-decoration: none;
    cursor: pointer;
    margin-top: 1.2rem;
  }
  .cta-sub {
    display: block; text-align: center;
    margin-top: .4rem;
    color: rgba(255,255,255,.45);
    font-size: .72rem;
    letter-spacing: .02em;
  }
  .disclaimer {
    text-align: center; margin-top: 1.5rem;
    color: rgba(255,255,255,.3); font-size: .65rem; line-height: 1.5;
    padding: 0 .5rem;
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="hdr">
      <a href="/" class="brand">CardResell</a>
      <div style="margin-top:.2rem">SHARED GRADE</div>
    </div>

    <div class="card">
      ${image
        ? `<img class="photo" src="${esc(image)}" alt="${esc(name)}" loading="eager">`
        : `<div class="photo-fallback">Photo unavailable</div>`}

      <div style="text-align:center">
        <span class="tier-badge">${isDeep ? '🔍 DEEP GRADE' : '⚡ QUICK GRADE'}</span>
      </div>
      <div class="grade">PSA ${esc(psa)}</div>
      <div class="grade-label">${esc(label)}</div>
      <div class="card-name">${esc(name)}</div>

      ${distBar}

      <div class="subgrades">
        ${subRow('Centering', (centLR || centTB) ? [centLR && ('L/R ' + centLR), centTB && ('T/B ' + centTB)].filter(Boolean).join(' · ') : data.centering)}
        ${subRow('Corners', corners)}
        ${subRow('Edges',   edges)}
        ${subRow('Surface', surface)}
        ${eyeApp ? subRow('Eye appeal', eyeApp) : ''}
      </div>

      ${limiting ? `<div class="limiting"><strong>LIMITING FACTOR</strong><br>${esc(limiting)}</div>` : ''}
      ${notes    ? `<div class="notes"><strong style="color:rgba(255,255,255,.85)">Grader notes: </strong>${esc(notes)}</div>` : ''}
    </div>

    <a href="/" class="cta">Grade your own card free →</a>
    <div class="cta-sub">Scan · AI grade · portfolio tracking</div>

    <div class="disclaimer">
      Estimated grade only — not a PSA/BGS/CGC certification.
      Actual submission may vary. Powered by CardResell AI.
    </div>
  </div>

  <script>
    // Track share views (fire-and-forget, no PII)
    try {
      if ('sendBeacon' in navigator) {
        navigator.sendBeacon('/api/grade-share?id=${encodeURIComponent(id)}&view=1', '');
      }
    } catch(e) {}
  </script>
</body>
</html>`;
}

// ─── Handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // ─── GET: render share page or serve OG image ──────────────────────
  if (req.method === 'GET') {
    const id = String(req.query?.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    if (!id) {
      res.status(400).setHeader('Content-Type', 'text/plain').send('Missing id');
      return;
    }

    const share = await kvGet(`grade_share:${id}`);
    if (!share) {
      res.status(404)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(`<!DOCTYPE html><html><head><title>Share not found</title>
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <style>body{background:#0a0f1c;color:#fff;font-family:-apple-system,system-ui;text-align:center;padding:3rem 1rem;font-size:.95rem}
          a{color:#eab308;font-weight:800;text-decoration:none}</style></head>
          <body><h1 style="font-size:1.4rem;margin-bottom:1rem">Share link expired or not found</h1>
          <p style="color:rgba(255,255,255,.6);margin-bottom:2rem">Shared grades are stored for 90 days.</p>
          <a href="/">Grade a card at CardResell →</a></body></html>`);
      return;
    }

    // ─── OG image: return the base64-decoded jpeg directly ───────
    if (req.query?.image === '1' || req.query?.image === 'true') {
      const img = share.image || '';
      const m = String(img).match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (!m) { res.status(404).send('No image'); return; }
      const buf = Buffer.from(m[2], 'base64');
      res.status(200)
        .setHeader('Content-Type', m[1])
        .setHeader('Cache-Control', 'public, max-age=604800, immutable')
        .send(buf);
      return;
    }

    // ─── View tracking (no-op body, fire-and-forget) ─────────────
    if (req.query?.view === '1') {
      // Bump a lifetime view counter; ignore errors.
      try {
        await fetch(`${KV_URL}/incr/grade_share_views:${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${KV_TOKEN}` },
        });
      } catch {}
      res.status(204).end();
      return;
    }

    const host = req.headers?.host || 'www.cardresell.org';
    res.status(200)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
      .send(renderPage({ id, share, host }));
    return;
  }

  // ─── POST: create a new share ──────────────────────────────────────
  if (req.method === 'POST') {
    if (!KV_URL || !KV_TOKEN) {
      res.status(500).json({ error: 'kv_not_configured' });
      return;
    }
    const body = req.body || {};
    const data = body.data;
    if (!data || typeof data !== 'object' || !data.psa_estimate) {
      res.status(400).json({ error: 'missing_grade_data' });
      return;
    }

    // Optional owner (best-effort — public shares don't require auth)
    let ownerSub = null;
    try {
      const verified = await tryVerify(req);
      ownerSub = verified?.googleSub || verified?.sub || null;
    } catch {}

    // Cap image at ~600KB base64 (~450KB jpeg)
    let image = String(body.image || '').trim();
    if (image && !/^data:image\/(jpeg|jpg|png|webp);base64,/.test(image)) image = '';
    if (image.length > 900_000) image = ''; // silent drop if too big — page still renders w/o photo

    // Strip anything sensitive from data blob before storing
    const safeData = { ...data };
    delete safeData.debug;
    delete safeData.openai_raw;
    delete safeData.image_hash;

    const record = {
      data: safeData,
      image,
      cardName: String(data.card_name || '').slice(0, 200),
      psa: Number(data.psa_estimate) || 0,
      isDeep: data.deepGrade === true || data.mode === 'deep',
      createdAt: Date.now(),
      ownerSub,
    };

    // Collision-avoid loop (nano-id has extremely low collision odds, but be safe)
    let id, attempts = 0;
    do {
      id = nanoid(10);
      attempts++;
      const exists = await kvGet(`grade_share:${id}`);
      if (!exists) break;
    } while (attempts < 5);

    if (attempts >= 5) {
      res.status(500).json({ error: 'id_collision' });
      return;
    }

    await kvSetEx(`grade_share:${id}`, record, 60 * 60 * 24 * 90); // 90 days

    const host = req.headers?.host || 'www.cardresell.org';
    res.status(200).json({
      id,
      url: `https://${host}/grade/${id}`,
    });
    return;
  }

  res.status(405).setHeader('Allow', 'GET, POST').json({ error: 'method_not_allowed' });
};
