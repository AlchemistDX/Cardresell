import { verifyTokenFlexible } from './_verifyToken.js';
// /api/collection — User card collection CRUD
//
// GET    /api/collection             → list all cards for authenticated user
// POST   /api/collection             → add card to collection (body: card entry)
// DELETE /api/collection?id=<id>     → remove card by generated id
//
// Auth: Bearer <google_id_token> header (verified via Google tokeninfo).
// Storage: single JSON blob per user at KV key `collection:<googleSub>`.
//
// Limits:
//   - Free users:  25 cards max
//   - Pro users:   500 cards max
// (Both are soft caps; returns 400 with a friendly error at the limit.)

const FREE_LIMIT = 25;
const PRO_LIMIT  = 500;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return res.status(503).json({ error: 'Storage unavailable' });

  // ── Auth ──
  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!idToken || idToken.length < 20) return res.status(401).json({ error: 'Sign in required' });

  let googleSub = '', userEmail = '';
  try {
    const tokenInfo = await verifyTokenFlexible(idToken);
    googleSub = tokenInfo.uid;
    userEmail = tokenInfo.email || '';
  } catch(e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const key = `collection:${googleSub}`;

  // ── GET: list collection ──
  if (req.method === 'GET') {
    const items = await readCollection(kvUrl, kvToken, key);
    const totalValue = items.reduce((sum, it) => sum + (Number(it.priceCurrent) || 0), 0);
    const totalAtAdd = items.reduce((sum, it) => sum + (Number(it.priceAtAdd)  || 0), 0);
    return res.status(200).json({
      items,
      count: items.length,
      totalValue: Math.round(totalValue * 100) / 100,
      totalAtAdd: Math.round(totalAtAdd * 100) / 100,
      delta:      Math.round((totalValue - totalAtAdd) * 100) / 100,
    });
  }

  // ── POST: add card ──
  if (req.method === 'POST') {
    const body = req.body || {};
    const {
      cardId, cardName, cardNumber, setName, image,
      variant, priceAtAdd, source, game
    } = body;

    if (!cardName) return res.status(400).json({ error: 'cardName required' });

    const items = await readCollection(kvUrl, kvToken, key);

    // Check Pro status for correct cap
    const isPro = await checkProStatus(kvUrl, kvToken, googleSub);
    const cap = isPro ? PRO_LIMIT : FREE_LIMIT;
    if (items.length >= cap) {
      return res.status(400).json({
        error: 'limit_reached',
        message: isPro
          ? `Collection cap is ${PRO_LIMIT} cards. Contact support if you need more.`
          : `Free plan holds up to ${FREE_LIMIT} cards. Upgrade to Pro for ${PRO_LIMIT}.`,
        cap, isPro,
      });
    }

    // Duplicate detection: same cardId + variant
    const entryId = `${cardId || cardName}|${variant || 'raw_nm'}`;
    if (items.some(it => it.id === entryId)) {
      return res.status(409).json({ error: 'duplicate', message: 'Already in your collection' });
    }

    const now = new Date().toISOString();
    const entry = {
      id: entryId,
      cardId:    cardId    || null,
      cardName:  String(cardName).slice(0, 200),
      cardNumber: cardNumber ? String(cardNumber).slice(0, 40) : null,
      setName:   setName   ? String(setName).slice(0, 200) : null,
      image:     image     ? String(image).slice(0, 500)   : null,
      variant:   variant   || 'raw_nm',
      priceAtAdd:  Number(priceAtAdd)  || 0,
      priceCurrent: Number(priceAtAdd) || 0,
      priceUpdatedAt: now,
      addedAt:  now,
      source:   source ? String(source).slice(0, 60) : null,
      game:     game   ? String(game).slice(0, 40)   : 'pokemon',
    };

    items.push(entry);
    await writeCollection(kvUrl, kvToken, key, items);
    return res.status(200).json({ ok: true, entry, count: items.length });
  }

  // ── PUT: bulk-sync entire collection (client-first sync path) ──
  // Body: { items: [...] } — the client's full localStorage portfolio array,
  // stored verbatim so the server acts as a device-agnostic backup.
  // Free tier is capped at 25 items, Pro/Pro+ at 500. Payload is size-capped
  // at 200 KB to prevent abuse.
  if (req.method === 'PUT') {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : null;
    if (!items) return res.status(400).json({ error: 'items array required' });

    // Size ceiling — reject payloads that would balloon KV storage.
    const serialized = JSON.stringify(items);
    if (serialized.length > 200 * 1024) {
      return res.status(413).json({ error: 'payload too large', max: '200KB' });
    }

    // Card-count cap based on Pro status.
    const isPro = await checkProStatus(kvUrl, kvToken, googleSub);
    const cap = isPro ? PRO_LIMIT : FREE_LIMIT;
    if (items.length > cap) {
      return res.status(400).json({
        error: 'limit_reached',
        message: isPro
          ? `Collection cap is ${PRO_LIMIT} cards. Contact support if you need more.`
          : `Free plan holds up to ${FREE_LIMIT} cards. Upgrade to Pro for ${PRO_LIMIT}.`,
        cap, isPro,
      });
    }

    await writeCollection(kvUrl, kvToken, key, items);
    return res.status(200).json({ ok: true, count: items.length });
  }

  // ── DELETE: remove card ──
  if (req.method === 'DELETE') {
    const id = req.query?.id || '';
    if (!id) return res.status(400).json({ error: 'id required' });
    const items = await readCollection(kvUrl, kvToken, key);
    const before = items.length;
    const filtered = items.filter(it => it.id !== id);
    if (filtered.length === before) {
      return res.status(404).json({ error: 'not_found' });
    }
    await writeCollection(kvUrl, kvToken, key, filtered);
    return res.status(200).json({ ok: true, count: filtered.length });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ── Helpers ──
async function readCollection(kvUrl, kvToken, key) {
  try {
    const r = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const d = await r.json();
    if (!d.result) return [];
    const parsed = typeof d.result === 'string' ? JSON.parse(d.result) : d.result;
    return Array.isArray(parsed) ? parsed : [];
  } catch(e) {
    console.warn('readCollection error:', e.message);
    return [];
  }
}

async function writeCollection(kvUrl, kvToken, key, items) {
  try {
    // Upstash REST: use POST /set/<key> with body containing the JSON string
    const body = JSON.stringify(items);
    await fetch(`${kvUrl}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${kvToken}`,
        'Content-Type': 'text/plain',
      },
      body,
    });
  } catch(e) {
    console.error('writeCollection error:', e.message);
  }
}


async function checkProStatus(kvUrl, kvToken, googleSub) {
  try {
    const r = await fetch(`${kvUrl}/get/${encodeURIComponent(`pro:${googleSub}`)}`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const d = await r.json();
    return !!d.result;
  } catch(e) { return false; }
}
