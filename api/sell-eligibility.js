// /api/sell-eligibility — is this row far enough along to start a listing?
//
// ── Why this endpoint exists at all ──────────────────────────────────────────
//
// Nothing else in the app decides this. Both places a Sell entry point can
// appear ask THIS endpoint:
//
//   • the scan panel — renderCardDetails() calls applySellGate(card), one row;
//   • the Collection table — hydrateCollectionSellButtons(rows) calls
//     fetchSellStamps(rows), the whole visible page in one request.
//
// Both go through fetchSellStamps(), so there is ONE transport and one rule.
//
// CORRECTION (D1 second review). An earlier version of this comment said scan
// results were "stamped server-side on the way out (api/scan.js), so the Sell
// button on a fresh scan needs nothing from here." That was never true of the
// shipped code: api/scan.js does not import _sellEligibility and does not
// stamp anything, and the scan panel has always called this endpoint. The
// sentence described a design that was considered and dropped. It is recorded
// here rather than quietly deleted because a false description of a security
// boundary is worse than no description — anyone auditing the scan path would
// have gone looking for a stamp in scan.js and concluded the check was
// happening somewhere it was not. tests/sell-eligibility.mjs now fails if
// scan.js starts stamping without this comment being updated.
//
// Two transports calling one server-owned rule would be fine; two
// implementations of the rule would not. There is currently one of each.
//
// The Collection is the reason a request is needed at all: it renders from
// `loadPortData()` — localStorage, `cardsell_portfolio` — so those rows never
// passed through any server response and could not carry a stamp even if
// responses were stamped.
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
import { stampList } from './_sellEligibility.js';
import { kvFromEnv } from './_kv.js';
import { readLifecycle, LIFECYCLE_STATE } from './_draftLifecycle.js';

// One request covers a maxed-out Pro collection (500). Chunking is the
// client's problem above that, and it is told the limit rather than having the
// tail of its list silently dropped.
export const MAX_ROWS = 500;

// ── Draft state is OPT-IN and separately capped ─────────────────────────
//
// The stamps above are pure: they read client-supplied fields and touch no
// stored data, which is why 500 of them cost one request. A generation is a
// stored read PER ROW, so folding it into the default answer would turn a
// collection page render into 500 round trips to Upstash. The client only
// needs a generation for the row it is about to sell, so it asks for that row.
export const MAX_DRAFT_STATE_ROWS = 25;

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
  // Every position goes through the policy itself. No fallback object here:
  // a fallback is how a refusal loses its reason, and an unexplained missing
  // button is the one outcome this endpoint exists to make impossible.
  const stamps = stampList(rows);

  const draftState = await maybeDraftState(body, uid);

  return res.status(200).json({ stamps, count: stamps.length, draftState });
}

/**
 * Per-row draft lifecycle state, for the rows the client asked about.
 *
 * ── What this is FOR, and what it must never be trusted for ────────────────
 *
 * It is a CONVENIENCE. On a fresh page load the client has no memory of this
 * card's draft history — the Collection is localStorage and a deleted draft is
 * absent from the drafts list, so nothing else on the client can tell a row
 * that never had a draft from a row whose draft was deleted. Without this, a
 * seller who deleted a draft, reloaded, and pressed Sell again would send the
 * generation they no longer have (or none) and get an answer that does not
 * match what they see.
 *
 * It is NOT the enforcement point, and the split is deliberate and was
 * required: the create handler resolves the authoritative deletion state
 * itself before accepting a request. Correctness cannot depend on this having
 * run. If this endpoint is never called, every guarantee still holds; the
 * seller just gets a less informed first press.
 *
 * ── Unknown is reported as unknown ─────────────────────────────────────────
 *
 * A failed or unreadable lifecycle read returns `generation: null` with a
 * reason. It NEVER returns 0. Zero means "this row has never held a draft",
 * which is a claim, and a claim derived from a failed read is the exact shape
 * that would authorize recreating a draft the seller deleted. A client holding
 * `null` sends no generation, and the create handler then resolves the state
 * for itself — the slower path, and the safe one.
 */
async function maybeDraftState(body, uid) {
  const req = body && typeof body.draftState === 'object' && body.draftState
    ? body.draftState : null;
  if (!req) return null;

  const slot = typeof req.slot === 'string' ? req.slot.trim() : '';
  const ids = Array.isArray(req.instanceIds) ? req.instanceIds : [];
  if (!slot || !ids.length) {
    // Asked for, but not answerable as asked. Reported rather than omitted:
    // a silent omission would read to the client as "no drafts", which is a
    // claim this has not established. Rule 2.
    return { error: 'DRAFT_STATE_REQUEST_INCOMPLETE', slot: slot || null, rows: {} };
  }

  const kv = kvFromEnv();
  if (!kv) return { error: 'DRAFT_STATE_UNAVAILABLE', slot, rows: {} };

  const wanted = ids.slice(0, MAX_DRAFT_STATE_ROWS).map((v) => String(v).trim()).filter(Boolean);
  const rows = {};
  for (const instanceId of wanted) {
    try {
      const rec = await readLifecycle(kv, uid, instanceId, slot);
      if (!rec.ok) {
        rows[instanceId] = { generation: null, reason: rec.error || 'unreadable' };
        continue;
      }
      rows[instanceId] = {
        // The generation to send with the NEXT create for this row.
        generation: rec.record.gen,
        // Whether the row currently HOLDS a draft, by the lifecycle record's
        // own account. The client uses this to choose its wording — "Open
        // draft" vs "Start listing" — never to decide whether a create is
        // allowed. That decision is the handler's.
        live: rec.record.lastState === LIFECYCLE_STATE.LIVE,
        deleted: rec.record.lastState === LIFECYCLE_STATE.DELETED,
        draftId: rec.record.lastState === LIFECYCLE_STATE.LIVE ? (rec.record.lastDraftId || null) : null,
      };
    } catch (e) {
      rows[instanceId] = { generation: null, reason: String((e && e.message) || e) };
    }
  }
  return {
    slot,
    rows,
    // Said out loud when the request was longer than the cap, so a client that
    // over-asks does not read a short answer as "the rest have no drafts".
    truncated: wanted.length < ids.length,
    maxRows: MAX_DRAFT_STATE_ROWS,
  };
}
