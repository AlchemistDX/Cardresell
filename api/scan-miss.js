// /api/scan-miss.js
// Logs scan-to-search misses (cards the scanner identified but PokemonTCG.io
// couldn't confidently match). Fire-and-forget from the client — helps us
// see WHICH cards keep missing so we can prioritize eBay Browse API for
// the sets that need it most (Chaos Rising, other new releases, etc).
//
// POST { name, number, setName, rarity, ua, at } → 204 (always, unless malformed)
//
// Storage layout:
//   scan-miss:<sha1-of-name-number-set>  → JSON payload + counter (30-day TTL)
//   scan-miss:index                      → ZADD sorted set of miss keys, score = last-seen ts
//
// Non-authenticated: this is anonymous usage telemetry. No PII beyond the
// scan payload the user's own device sent. We hard-cap all string fields
// so a malicious client can't fill our KV with garbage.

const KV_URL   = process.env.KV_REST_API_URL   || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '';

// 30-day retention on individual miss records
const TTL_SECONDS = 30 * 24 * 60 * 60;

async function kv(cmd, ...args) {
  const res = await fetch(`${KV_URL}/${[cmd, ...args].map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const json = await res.json();
  return json.result;
}

// Tiny non-crypto hash — good enough for grouping same-card misses together.
// SHA-1 would need crypto module + async; djb2 is 4 lines and deterministic.
function hashKey(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function clip(s, max) {
  return String(s == null ? '' : s).slice(0, max);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Storage not configured → silently accept (logging must never break the UI)
  if (!KV_URL || !KV_TOKEN) return res.status(204).end();

  let body = {};
  try {
    body = req.body || {};
    if (typeof body === 'string') body = JSON.parse(body);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid body' });
  }

  const payload = {
    name:    clip(body.name,    120),
    number:  clip(body.number,   40),
    setName: clip(body.setName, 120),
    rarity:  clip(body.rarity,   60),
    ua:      clip(body.ua,      200),
    at:      Number.isFinite(body.at) ? body.at : Date.now(),
    // 2026-09-03: total-recognition-failure fields. The client's
    // "Card not recognized" branch has no name/number by definition — that is
    // exactly the failure we most need to see — so these carry the diagnosis.
    reason:       clip(body.reason,       40),
    scanReason:   clip(body.scanReason,  120),
    retakeHint:   clip(body.retakeHint,  160),
    modelUsed:    clip(body.modelUsed,    40),
    fpBestGuess:  clip(body.fpBestGuess, 120),
    fpBestId:     clip(body.fpBestId,     40),
    game:         clip(body.game,         20),
    fpBestDist:   Number.isFinite(body.fpBestDist)   ? body.fpBestDist   : null,
    fpSecondDist: Number.isFinite(body.fpSecondDist) ? body.fpSecondDist : null,
  };

  // 2026-09-03: previously this required name || number, which silently
  // discarded every total-recognition failure. A payload carrying only a
  // `reason` is now valid and is the highest-signal record we get.
  if (!payload.name && !payload.number && !payload.reason) {
    // Nothing to log
    return res.status(204).end();
  }

  try {
    // 2026-09-03: unrecognized misses have no name/number, so keying on those
    // alone would collapse every total failure in the product into a single
    // record. Fold the fastpath's best guess + reason in so distinct cards
    // stay distinct while true repeats of the same card still dedup.
    const dedupKey = payload.name || payload.number
      ? `${payload.name.toLowerCase()}|${payload.number}|${payload.setName.toLowerCase()}`
      : `${payload.reason}|${payload.fpBestId}|${payload.game}`;
    const key      = `scan-miss:${hashKey(dedupKey)}`;

    // Store the payload (overwrites if same card scanned again — we care
    // about coverage, not per-hit history)
    await kv('SET', key, JSON.stringify(payload), 'EX', String(TTL_SECONDS));

    // Bump counter in a companion key so we know how many times this same
    // miss has been logged
    await kv('INCR', `${key}:count`);
    await kv('EXPIRE', `${key}:count`, String(TTL_SECONDS));

    // Add to a sorted index so we can list top misses by recency
    await kv('ZADD', 'scan-miss:index', String(payload.at), key);

    return res.status(204).end();
  } catch (err) {
    // Never surface storage errors to the client — logging is best-effort
    console.warn('scan-miss log error:', err && err.message);
    return res.status(204).end();
  }
}
