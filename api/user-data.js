import { verifyTokenFlexible } from './_verifyToken.js';
// /api/user-data — Cross-device sync for Portfolio + Flips
//
// GET  /api/user-data                  → { portfolio: [...], flips: [...], tombstones, serverUpdatedAt }
// POST /api/user-data { portfolio, flips, tombstones, clientUpdatedAt }
//                                       → { ok, serverUpdatedAt, resolved: 'client'|'server'|'merge' }
//
// The client stores its portfolio/flips as opaque arrays; we don't validate
// their shape. This lets us evolve the schema on the frontend without a
// backend deploy. Rows are capped by size so a rogue client can't blow up
// the KV row.
//
// Sync unions distinct IDs and uses explicit deletion tombstones. A bounded
// compare-and-set loop prevents overlapping snapshots from losing additions.
// Client snapshot timestamps retain the legacy same-ID conflict preference.
//
// Auth: Bearer <google_id_token>. Storage: KV key `userdata:<googleSub>`.

const MAX_BLOB_BYTES = 900_000;      // ~900KB — well under KV row cap
const RAW_RECORDS = new WeakMap();
const MAX_ITEMS      = 2000;         // sanity cap so we don't store nonsense

// Deletion tombstones (2026-09-04). _mergeById is a set union, and set union
// cannot express deletion: a client that removed a row sent a shorter array,
// we unioned the row back in from `existing`, and the client's next GET
// resurrected it. Clients now send { portfolio: {id: deletedAt}, flips: {...} }
// and we drop any row whose id is tombstoned unless the row's own updatedAt is
// newer than the deletedAt (that is a delete-then-re-add, which must survive).
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const MAX_TOMBSTONES   = MAX_ITEMS;                      // per collection

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

  if (!googleSub) return res.status(401).json({ error: 'Sign in required' });
  res.setHeader('Cache-Control', 'private, no-store');
  const key = `userdata:${googleSub}`;
  try {

  const duplicateIds = rows => {
    const seen = new Set();
    for (const row of rows) {
      if (!row || row.id == null) continue;
      const id = String(row.id); if (seen.has(id)) return true; seen.add(id);
    }
    return false;
  };

  // ── GET: pull latest ──
  if (req.method === 'GET') {
    const blob = await kvGet(kvUrl, kvToken, key);
    if (!blob) return res.status(200).json({ portfolio: [], flips: [], tombstones: { portfolio: {}, flips: {} }, serverUpdatedAt: 0 });
    const marks = _compactTombstones(blob.tombstones);
    return res.status(200).json({
      // Apply tombstones on read as well as write, so a row that predates this
      // change (or was written by an older client) still disappears.
      portfolio:        _applyTombstones(Array.isArray(blob.portfolio) ? blob.portfolio : [], marks.portfolio),
      flips:            _applyTombstones(Array.isArray(blob.flips)     ? blob.flips     : [], marks.flips),
      tombstones:       marks,
      serverUpdatedAt:  Number(blob.serverUpdatedAt)  || 0,
    });
  }

  // ── POST: push snapshot ──
  if (req.method === 'POST') {
    const body = req.body || {};
    if (!Array.isArray(body.portfolio) || !Array.isArray(body.flips))
      return res.status(400).json({ error: 'invalid_snapshot' });
    if (body.portfolio.length > MAX_ITEMS || body.flips.length > MAX_ITEMS)
      return res.status(413).json({ error: 'too_many_items', message: 'No data was discarded. Reduce the collection before retrying.' });
    if (duplicateIds(body.portfolio) || duplicateIds(body.flips))
      return res.status(409).json({ error: 'ambiguous_collection_ids', message: 'Some collection records share an ID. Export a backup and resolve the duplicate IDs before syncing. Nothing was discarded.' });
    const clientUpdatedAt = Number(body.clientUpdatedAt) || Date.now();
    // Retry a bounded compare-and-set conflict against a fresh snapshot.
    // Missing rows are not deletions: only explicit tombstones remove them.
    for (let attempt = 0; attempt < 4; attempt++) {
      const existing = await kvGet(kvUrl, kvToken, key);
      if (existing && (duplicateIds(existing.portfolio) || duplicateIds(existing.flips)))
        return res.status(409).json({ error: 'ambiguous_collection_ids', message: 'Cloud records share an ID. Export a backup and resolve the duplicate IDs before syncing. Nothing was discarded.' });
      const marks = _mergeTombstones(existing?.tombstones, body.tombstones);
      const preferIncoming = !existing || clientUpdatedAt >= Number(existing.serverUpdatedAt || 0);
      const portfolio = _applyTombstones(_mergeById(existing?.portfolio || [], body.portfolio, preferIncoming), marks.portfolio);
      const flips = _applyTombstones(_mergeById(existing?.flips || [], body.flips, preferIncoming), marks.flips);
      if (portfolio.length > MAX_ITEMS || flips.length > MAX_ITEMS)
        return res.status(413).json({ error: 'too_many_items', message: 'The combined collection exceeds the sync limit. Nothing was discarded.' });
      const payload = { portfolio, flips, tombstones: marks, serverUpdatedAt: Date.now() };
      const serialized = JSON.stringify(payload);
      if (Buffer.byteLength(serialized) > MAX_BLOB_BYTES)
        return res.status(413).json({ error: 'payload_too_large', message: 'Your collection exceeds the cloud sync size limit. It is still saved on this device.' });
      const wrote = await kvSet(kvUrl, kvToken, key, serialized, existing ? RAW_RECORDS.get(existing) : null);
      if (wrote) return res.status(200).json({ ok: true, ...payload, resolved: existing ? 'merge' : 'client' });
    }
    return res.status(409).json({ error: 'sync_conflict', message: 'Another device is updating your collection. Please retry sync.' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
  } catch {
    return res.status(503).json({ error: 'storage_unavailable', message: 'Cloud collection could not be confirmed. Your device data is unchanged. Please retry sync.' });
  }
}

// Union two arrays of {id, ...} rows by id. Later wins on conflict.
function _mergeById(a, b, preferIncoming = true) {
  const map = new Map();
  for (const row of (a || [])) if (row && row.id != null) map.set(String(row.id), row);
  for (const row of (b || [])) if (row && row.id != null && (preferIncoming || !map.has(String(row.id)))) map.set(String(row.id), row);
  return Array.from(map.values());
}

// Keep the LATEST deletedAt per id across both sides, then compact.
export function _mergeTombstones(a, b) {
  const out = { portfolio: {}, flips: {} };
  for (const kind of ['portfolio', 'flips']) {
    for (const m of [((a || {})[kind]) || {}, ((b || {})[kind]) || {}]) {
      if (!m || typeof m !== 'object') continue;
      for (const id of Object.keys(m)) {
        const at = Number(m[id]) || 0;
        if (at > (out[kind][id] || 0)) out[kind][id] = at;
      }
    }
  }
  return _compactTombstones(out);
}

// Expire old marks and cap the count so the KV blob can't grow unbounded.
export function _compactTombstones(t, nowMs) {
  const now = nowMs || Date.now();
  const out = { portfolio: {}, flips: {} };
  for (const kind of ['portfolio', 'flips']) {
    const src = (t && t[kind]) || {};
    if (!src || typeof src !== 'object') continue;
    let entries = Object.keys(src)
      .map(id => [id, Number(src[id]) || 0])
      .filter(([, at]) => at > 0 && (now - at) < TOMBSTONE_TTL_MS);
    if (entries.length > MAX_TOMBSTONES) {
      entries.sort((x, y) => y[1] - x[1]);
      entries = entries.slice(0, MAX_TOMBSTONES);
    }
    for (const [id, at] of entries) out[kind][id] = at;
  }
  return out;
}

// Drop rows the user deleted. A row survives only if it was re-added after
// the delete, evidenced by an updatedAt newer than the tombstone.
export function _applyTombstones(rows, marks) {
  if (!Array.isArray(rows)) return [];
  if (!marks || typeof marks !== 'object') return rows;
  return rows.filter(row => {
    if (!row || row.id == null) return false;
    const deletedAt = Number(marks[String(row.id)]) || 0;
    if (!deletedAt) return true;
    return (Number(row.updatedAt) || 0) > deletedAt;
  });
}

async function kvGet(kvUrl, kvToken, key) {
  const r = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${kvToken}` }
  });
  if (!r.ok) throw new Error('kv_read_failed');
  const d = await r.json();
  if (d.error || !Object.prototype.hasOwnProperty.call(d, 'result')) throw new Error('kv_read_failed');
  if (d.result === null) return null;
  const parsed = typeof d.result === 'string' ? JSON.parse(d.result) : d.result;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      !Array.isArray(parsed.portfolio) || !Array.isArray(parsed.flips)) throw new Error('kv_record_invalid');
  RAW_RECORDS.set(parsed, typeof d.result === 'string' ? d.result : JSON.stringify(d.result));
  return parsed;
}

async function kvSet(kvUrl, kvToken, key, serialized, expected) {
  const script = `local old = redis.call('GET', KEYS[1])
if ARGV[1] == 'absent' then
  if old then return 0 end
elseif old ~= ARGV[2] then return 0 end
redis.call('SET', KEYS[1], ARGV[3])
return 1`;
  const r = await fetch(kvUrl, {
    method: 'POST', headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['EVAL', script, 1, key, expected === null ? 'absent' : 'present', expected || '', serialized]),
  });
  if (!r.ok) throw new Error('kv_write_failed');
  const result = await r.json();
  if (result.error || ![0,1].includes(result.result)) throw new Error('kv_write_unconfirmed');
  return result.result === 1;
}
