// /api/sell-eligibility — is this row far enough along to start a listing?
//
// ── Why this endpoint exists at all ──────────────────────────────────────────
//
// Scan results are stamped server-side on the way out (api/scan.js), so the
// Sell button on a fresh scan needs nothing from here. The Collection view is
// the awkward case: it renders from `loadPortData()`, which is localStorage —
// `cardsell_portfolio` — so those rows never passed through a server response
// and carry no stamp.
//
// That leaves three options and only one of them is acceptable:
//
//   1. Write `if (game && set && number)` in core.js. Four tokens, reads fine,
//      and it is a second implementation of identity sufficiency. This repo has
//      been bitten four times by exactly that shape and every one of them
//      looked this harmless.
//   2. Migrate the Collection to the server. Correct eventually, not a D1
//      change, and it would put a storage migration inside a UI block.
//   3. Ask the server for the answer. Forty lines, one rule, no drift.
//
// So: three.
//
// ── Why it requires a token ─────────────────────────────────────────────────
//
// The computation itself is harmless — it reads client-supplied fields and
// returns booleans, touching no stored data. Auth is here because the ANSWER is
// only actionable when signed in: creating a draft needs a verified sub, so a
// Sell button drawn for an anonymous visitor is a button that cannot work.
// Refusing here means the anonymous Collection view (which is deliberately
// allowed to render) simply has no Sell entry point, which is the correct
// outcome rather than a coincidental one.

import { verifyTokenFlexible } from './_verifyToken.js';
import { stampRows } from './_sellEligibility.js';

// One request covers a maxed-out Pro collection (500). Chunking is the
// client's problem above that, and it is told the limit rather than having the
// tail of its list silently dropped.
export const MAX_ROWS = 500;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  // Pure function of the request body — but the body is user card data, so it
  // stays out of shared caches.
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ error: 'Sign in to list a card.' });
  }

  // `info.uid` is the field, matching api/drafts.js. _verifyToken deliberately
  // never returns the Google sub, so reading `.sub` here would silently 401
  // every signed-in seller.
  let uid;
  try {
    const info = await verifyTokenFlexible(token);
    uid = info && info.uid;
  } catch {
    uid = null;
  }
  if (!uid) {
    return res.status(401).json({ error: 'Session expired. Sign in again.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const rows = body.rows;
  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'rows must be an array.', code: 'ROWS_REQUIRED' });
  }
  if (rows.length > MAX_ROWS) {
    // Refuse rather than truncate. A truncated answer would leave the tail of
    // the collection with no Sell button and no reason given, which reads as
    // "those cards can't be sold".
    return res.status(400).json({
      error: `Too many rows in one request (max ${MAX_ROWS}).`,
      code:  'ROWS_TOO_MANY',
      maxRows: MAX_ROWS,
    });
  }

  // Positional: stamps[i] describes rows[i]. The client holds the rows; sending
  // them back would double the payload for no gain, and echoing user card data
  // is a habit worth not forming.
  const stamps = stampRows(rows).map((r) => (r && r.sell) || { eligible: false, missing: [], message: null });

  return res.status(200).json({ stamps, count: stamps.length });
}
