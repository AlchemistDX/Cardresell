import { verifyTokenFlexible } from './_verifyToken.js';
// /api/user-data — Cross-device sync for Portfolio + Flips
//
// GET  /api/user-data                  → { portfolio: [...], flips: [...], serverUpdatedAt }
// POST /api/user-data { portfolio, flips, clientUpdatedAt }
//                                       → { ok, serverUpdatedAt, resolved: 'client'|'server'|'merge' }
//
// The client stores its portfolio/flips as opaque arrays; we don't validate
// their shape. This lets us evolve the schema on the frontend without a
// backend deploy. Rows are capped by size so a rogue client can't blow up
// the KV row.
//
// Conflict handling (2026-08-19): if two devices race, we take the payload
// whose `clientUpdatedAt` is newest. If the client didn't send that field,
// we treat the POST as authoritative (opt-out of merge). Callers should
// send `clientUpdatedAt: Date.now()` on every save.
//
// Auth: Bearer <google_id_token>. Storage: KV key `userdata:<googleSub>`.

const MAX_BLOB_BYTES = 900_000;      // ~900KB — well under KV row cap
const MAX_ITEMS      = 2000;         // sanity cap so we don't store nonsense

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return res.status(503).json({ error: 'Storage unavailable' });

  // ── Auth ──
  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!idToken || idToken.length < 20) return res.status(401).json({ error: 'Sign in required' });

  let googleSub = '';
  try {
    const tokenInfo = await verifyTokenFlexible(idToken);
    googleSub = tokenInfo.uid;
  } catch(e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const key = `userdata:${googleSub}`;

  // ── GET: pull latest ──
  if (req.method === 'GET') {
    const blob = await kvGet(kvUrl, kvToken, key);
    if (!blob) return res.status(200).json({ portfolio: [], flips: [], serverUpdatedAt: 0 });
    return res.status(200).json({
      portfolio:        Array.isArray(blob.portfolio) ? blob.portfolio : [],
      flips:            Array.isArray(blob.flips)     ? blob.flips     : [],
      serverUpdatedAt:  Number(blob.serverUpdatedAt)  || 0,
    });
  }

  // ── POST: push snapshot ──
  if (req.method === 'POST') {
    const body = req.body || {};
    const portfolio        = Array.isArray(body.portfolio) ? body.portfolio.slice(0, MAX_ITEMS) : [];
    const flips            = Array.isArray(body.flips)     ? body.flips.slice(0, MAX_ITEMS)     : [];
    const clientUpdatedAt  = Number(body.clientUpdatedAt) || Date.now();

    // Last-write-wins by clientUpdatedAt. Compare against the server's
    // recorded timestamp; if the incoming is older, we still accept the
    // union (client just came online after a stale save).
    const existing = await kvGet(kvUrl, kvToken, key);
    const serverUpdatedAt = existing ? Number(existing.serverUpdatedAt) || 0 : 0;

    let finalPortfolio = portfolio;
    let finalFlips     = flips;
    let resolved       = 'client';

    if (existing && clientUpdatedAt < serverUpdatedAt) {
      // Client is behind — server keeps its data, but we take any NEW
      // ids the client has (last-write union). This handles the case
      // where a client that was offline for a while finally syncs and
      // has added cards locally that the server never saw.
      finalPortfolio = _mergeById(existing.portfolio || [], portfolio);
      finalFlips     = _mergeById(existing.flips     || [], flips);
      resolved       = 'merge';
    } else if (existing) {
      resolved = 'client'; // client is newer, its snapshot wins
    }

    const nowMs = Date.now();
    const payload = {
      portfolio: finalPortfolio,
      flips:     finalFlips,
      serverUpdatedAt: nowMs,
    };

    const serialized = JSON.stringify(payload);
    if (serialized.length > MAX_BLOB_BYTES) {
      return res.status(413).json({
        error: 'payload_too_large',
        message: `Your data is ${(serialized.length / 1024).toFixed(0)}KB, which exceeds the ${(MAX_BLOB_BYTES / 1024).toFixed(0)}KB sync limit. Consider archiving old flips.`,
      });
    }

    try {
      await kvSet(kvUrl, kvToken, key, serialized);
    } catch (e) {
      console.error('user-data save failed:', e.message);
      return res.status(502).json({ error: 'save_failed', message: 'Could not save your data. Please retry.' });
    }
    return res.status(200).json({
      ok: true,
      serverUpdatedAt: nowMs,
      resolved,
      portfolio: finalPortfolio,
      flips:     finalFlips,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// Union two arrays of {id, ...} rows by id. Later wins on conflict.
function _mergeById(a, b) {
  const map = new Map();
  for (const row of (a || [])) if (row && row.id != null) map.set(String(row.id), row);
  for (const row of (b || [])) if (row && row.id != null) map.set(String(row.id), row);
  return Array.from(map.values());
}

async function kvGet(kvUrl, kvToken, key) {
  try {
    const r = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const d = await r.json();
    if (!d.result) return null;
    const parsed = typeof d.result === 'string' ? JSON.parse(d.result) : d.result;
    return parsed;
  } catch(e) {
    console.warn('user-data kvGet error:', e.message);
    return null;
  }
}

async function kvSet(kvUrl, kvToken, key, serialized) {
  const r = await fetch(`${kvUrl}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kvToken}`,
      'Content-Type': 'text/plain',
    },
    body: serialized,
  });
  if (!r.ok) throw new Error(`kv_write_failed:${r.status}`);
}
