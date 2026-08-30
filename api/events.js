// /api/events.js
// Lightweight funnel-event logging to Upstash Redis.
// POST { name, props?, session_id? }  →  200 { ok: true }
// GET  ?admin=<key>&window=<hours>    →  aggregate counts per event
//
// Design goals:
//   1. Never break the app — swallow all errors, always return 200 on POST.
//   2. Bounded storage — daily counters + capped recent-event tail per name.
//   3. No auth on POST (anyone can log an event, matching web-analytics UX).
//   4. Simple GET dashboard gated by ANALYTICS_ADMIN_KEY env var.
//
// Key layout in Redis:
//   ev:count:YYYY-MM-DD:<name>          → INCR daily count
//   ev:count:YYYY-MM-DD:<name>:<prop>=<val>  → dimension buckets (small allowlist)
//   ev:recent:<name>                     → LPUSH+LTRIM last 100 event JSON blobs
//   ev:names                              → SADD known event names

const KV_URL   = process.env.KV_REST_API_URL   || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '';
const ADMIN_KEY = process.env.ANALYTICS_ADMIN_KEY || '';

// Whitelisted event names — anything else gets bucketed as 'other'.
// This prevents malicious floods of arbitrary event names.
const ALLOWED = new Set([
  // Funnel — top of funnel
  'page_view', 'search_results', 'search_zero_results',
  'example_card_tap', 'card_selected',
  // Scan & grade
  'scan_started', 'scan_completed', 'id_scan_completed', 'scan_miss', 'scan_refund',
  'grade_started', 'grade_completed', 'grade_callout_cta_click',
  'post_grade_prompt_shown', 'post_grade_prompt_click',
  // Payout ranking (NEW — 2026-08-30 ship)
  'payout_ranking_viewed', 'ranking_locked_row_clicked', 'share_ranking_click',
  // Upgrade funnel
  'pricing_modal_open', 'checkout_attempt', 'checkout_success', 'checkout_cancel',
  'cross_tcg_auto_switch', 'cross_tcg_auto_switch_declined',
  // Auth
  'signup_bonus', 'sign_in', 'sign_out',
  // Collection & flips
  'collection_add', 'flip_saved',
]);

// Only allowlisted prop keys/values get bucketed to prevent unbounded key growth.
const ALLOWED_PROP_KEYS = new Set(['plan', 'tier', 'trigger', 'game', 'source', 'psa']);

async function kv(cmd, ...args) {
  const path = [cmd, ...args].map(a => encodeURIComponent(String(a))).join('/');
  const res  = await fetch(`${KV_URL}/${path}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const j = await res.json().catch(() => ({}));
  return j.result;
}

function today() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function sanitizeName(raw) {
  const n = String(raw || '').trim().slice(0, 60).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!n) return null;
  return ALLOWED.has(n) ? n : 'other';
}

function sanitizeProps(props) {
  if (!props || typeof props !== 'object') return {};
  const out = {};
  for (const k of Object.keys(props)) {
    if (!ALLOWED_PROP_KEYS.has(k)) continue;
    const v = props[k];
    if (v === null || v === undefined) continue;
    // Coerce to short string. Bucket numbers into rough tiers.
    let s = String(v).slice(0, 40).toLowerCase().replace(/[^a-z0-9_\-\.]/g, '_');
    if (!s) continue;
    out[k] = s;
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!KV_URL || !KV_TOKEN) {
    // Silent OK so client analytics never breaks.
    return res.status(200).json({ ok: true, disabled: true });
  }

  // GET = admin dashboard
  if (req.method === 'GET') {
    const key = String(req.query.admin || '');
    if (!ADMIN_KEY || key !== ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
    const windowHours = Math.min(24 * 30, Math.max(1, parseInt(req.query.window || '168', 10)));
    const days = Math.ceil(windowHours / 24);
    const now = Date.now();
    const dates = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(now - i * 86400000);
      dates.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
    }
    const names = (await kv('smembers', 'ev:names')) || [];
    const rows = {};
    for (const n of names) {
      rows[n] = {};
      for (const d of dates) {
        const v = await kv('get', `ev:count:${d}:${n}`);
        if (v && Number(v) > 0) rows[n][d] = Number(v);
      }
    }
    return res.status(200).json({ window_hours: windowHours, days_covered: days, events: rows, tracked_names: names });
  }

  // POST = log event
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const name = sanitizeName(body.name);
    if (!name) return res.status(200).json({ ok: true }); // silently drop
    const props = sanitizeProps(body.props);
    const day = today();

    // Fire-and-forget INCRs. TTL 45 days on each counter (auto-cleanup).
    const INCR_TTL = 60 * 60 * 24 * 45;
    await kv('sadd', 'ev:names', name);
    await kv('incr', `ev:count:${day}:${name}`);
    await kv('expire', `ev:count:${day}:${name}`, INCR_TTL);

    for (const [pk, pv] of Object.entries(props)) {
      const dimKey = `ev:count:${day}:${name}:${pk}=${pv}`;
      await kv('incr', dimKey);
      await kv('expire', dimKey, INCR_TTL);
    }

    // Recent tail — capped at 100 per event for spot-checking payloads.
    const blob = JSON.stringify({ t: Date.now(), name, props }).slice(0, 500);
    await kv('lpush', `ev:recent:${name}`, blob);
    await kv('ltrim', `ev:recent:${name}`, 0, 99);
    await kv('expire', `ev:recent:${name}`, INCR_TTL);

    return res.status(200).json({ ok: true });
  } catch (e) {
    // Never break the client. Always OK.
    return res.status(200).json({ ok: true, err: 1 });
  }
}
