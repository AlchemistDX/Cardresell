// api/tpl-proxy.js
// Server-side proxy for TCGPriceLookup — keeps the paid API key off the client.
//
// Client sends:  GET /api/tpl-proxy?path=/v1/cards/search&q=Pikachu&game=pokemon&limit=100
//                GET /api/tpl-proxy?path=/v1/cards/<id>
//                GET /api/tpl-proxy?path=/v1/cards/lookup&name=...&game=...
//
// We call:       GET https://api.tcgpricelookup.com<path>?<forwarded query>
// with header:   X-API-Key: process.env.CARDSELL_TPL_KEY

import { validateTplRequest } from './_tplContract.js';
import {
  reserveUpstream, releaseReservation, storeResult, OUTCOME,
} from './_tplBudget.js';

// 2026-09-09 [CH-3/R4]: the budget store is INJECTED, never constructed here.
// Production KV is deliberately not bound: it is shared with nonproduction and
// is not isolated yet. With no store injected the control is INACTIVE and this
// route behaves exactly as it did before R4 — which is the honest state to ship
// in, rather than a control that looks present and enforces nothing.
//
// Isolating KV is therefore the only remaining step for LIVE integration; the
// calling path below is complete and exercised offline against a mock.
// Named without a test-only marker on purpose: this is the PRODUCTION binding
// seam. When KV is isolated, production calls the same setter with a KV-backed
// store. The tests use it because it is the real wiring point, not because it
// exists for them.
let _budgetStore = null;
export function setBudgetStore(store) { _budgetStore = store; }
export function budgetStoreActive() { return _budgetStore !== null; }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const key = process.env.CARDSELL_TPL_KEY;
  if (!key) return res.status(500).json({ error: 'TPL not configured' });

  // 2026-09-09 [CH-3/R2]: validate against the client contract BEFORE spending
  // anything upstream. Replaces a forward-everything loop that sent any query
  // parameter it received to a PAID provider. See api/_tplContract.js for the
  // contract and for what this fix does NOT achieve: it closes the
  // unknown-parameter path; it does not eliminate cache bypass (Vercel keys on
  // the INCOMING url) and it does not bound spending (distinct valid requests
  // still reach the provider).
  const v = validateTplRequest(req.query);
  if (!v.ok) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(v.status).json(
      v.detail ? { error: v.error, detail: v.detail } : { error: v.error });
  }
  const { path, upstreamQuery } = v;
  const qs = upstreamQuery.toString();

  const url = `https://api.tcgpricelookup.com${path}${qs ? '?' + qs : ''}`;

  // ── R4: cache and aggregate spending allowance ────────────────────────────
  // Inactive when no store is injected. When active, NOTHING below reaches the
  // provider without a reservation taken first.
  let reservation = null;
  let budgetKeyForResult = null;
  let budgetConfigForResult = null;
  if (_budgetStore) {
    const ip = (req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || null;
    const r4 = await reserveUpstream({ store: _budgetStore, path, upstreamQuery, ip });

    if (r4.outcome === OUTCOME.CACHE_HIT) {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
      res.setHeader('X-TPL-Cache', 'hit');
      return res.status(200).json(r4.cached);
    }

    // Every non-reserved outcome that HAS a usable value serves it, explicitly
    // labelled stale. A stale answer the caller can identify beats both a lie
    // and a blank.
    if (r4.stale && r4.cached) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-TPL-Cache', 'stale');
      res.setHeader('X-TPL-Stale-Reason', r4.outcome);
      return res.status(200).json(r4.cached);
    }

    if (r4.outcome !== OUTCOME.RESERVED) {
      // No value, and no allowance to buy one. Say so plainly rather than
      // returning an empty success that reads as "no such card".
      res.setHeader('Cache-Control', 'no-store');
      const unavailable = {
        [OUTCOME.EXHAUSTED]:       ['Lookup temporarily unavailable', 'budget_exhausted'],
        [OUTCOME.PER_IP]:          ['Too many lookups from this address', 'per_ip_limit'],
        [OUTCOME.STORE_DOWN]:      ['Lookup temporarily unavailable', 'budget_store_unavailable'],
        [OUTCOME.NOT_CONFIGURED]:  ['Lookup temporarily unavailable', 'budget_not_configured'],
      }[r4.outcome] || ['Lookup temporarily unavailable', r4.outcome];
      const status = r4.outcome === OUTCOME.PER_IP ? 429 : 503;
      return res.status(status).json({ error: unavailable[0], reason: unavailable[1] });
    }

    reservation = r4.reservation;
    budgetKeyForResult = r4.key;
    budgetConfigForResult = r4.config;
  }

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { headers: { 'X-API-Key': key }, signal: ctrl.signal });
    clearTimeout(timeout);
    const body = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    // 2026-09-09 [CH-3/R3]: cache SUCCESSES only. The previous unconditional
    // header asked the edge to cache failures too. Note the withdrawn claim:
    // this does NOT mean a dead key was previously served for five minutes —
    // Vercel's cacheable statuses exclude 401, 429 and 5xx, so most failures
    // were never cached whatever we asked for. no-store makes the intent
    // explicit and removes the dependency on that platform behaviour.
    if (r.status >= 200 && r.status < 300) {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
      if (_budgetStore && budgetKeyForResult) {
        try {
          await storeResult(_budgetStore, budgetKeyForResult, JSON.parse(body),
                            budgetConfigForResult);
        } catch { /* an unparseable body is not cacheable; not the caller's problem */ }
      }
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }
    res.send(body);
  } catch (e) {
    // NO REFUND. The request left this process, so the provider may already
    // have counted it — a timeout or a 5xx tells us nothing about what was
    // consumed upstream. Refunding here would let a failing provider silently
    // reset our own accounting, which is the opposite of a spending control.
    if (reservation) await releaseReservation(_budgetStore, reservation, { started: true });
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'TPL upstream failed', detail: String(e?.message || e) });
  }
}
