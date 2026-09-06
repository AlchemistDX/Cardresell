// ── Can this row start a listing draft? ──────────────────────────────────────
//
// One owner, because the alternative was going to be two.
//
// D1 says the Sell entry point "appears only when identity is sufficient to
// build a packet". The browser is the thing that has to decide whether to draw
// a button, and the rule lives in `hasSufficientIdentity()` on the server. The
// obvious shortcut is to write `if (game && set && number)` in core.js — four
// tokens, reads fine, and it is a SECOND implementation of identity
// sufficiency. This codebase has been bitten four times by exactly that shape
// (fee model, normalization, delete, authoritative draft record), and the
// second copy always looked too small to matter at the time.
//
// So the rule stays here, on the server, and the browser is told the ANSWER
// rather than the inputs. The button is drawn from a server stamp and from
// nothing else.
//
// One transport, deliberately. The first cut of this also stamped `sell` onto
// every scan and collection response, which is free and saves a round trip.
// It was reverted before shipping: the rendered Collection reads from
// localStorage, not from /api/collection, so response stamps would have
// covered only some rows and the UI would have needed BOTH a
// read-it-off-the-row path and an ask-the-server path. Two code paths to learn
// one answer is how they drift. Response-embedded stamps become the right
// optimization once the card object is threaded end to end; that is a Phase 2
// change, not a D1 one.
//
// The reasons are codes, not sentences, for the same reason draft violations
// are: copy changes without the machine reason changing, and a screen that
// shows a raw code is a screen that made the seller guess.

import { identityAxes, hasSufficientIdentity, identityFieldConflicts } from './_cardIdentity.js';

export const SELL_BLOCKED = {
  NO_GAME:   'SELL_NEEDS_GAME',
  NO_SET:    'SELL_NEEDS_SET',
  NO_NUMBER: 'SELL_NEEDS_NUMBER',
  NO_ROW:    'SELL_NEEDS_CARD',
  // Not a missing axis — a contradicted one. Two spellings of the same field
  // carrying different values is not something a seller can fix by adding
  // information, so it is reported separately and never mixed into the
  // "you still need X" list.
  CONFLICT:  'SELL_IDENTITY_CONFLICT',
};

/**
 * Which identity axes are missing, in the order a seller would fix them.
 *
 * Deliberately a LIST and not a count. "2 fields missing" makes the seller
 * hunt; "needs the set and the card number" is actionable. Same rule the
 * review screen follows for missing fields.
 */
export function missingIdentityAxes(row) {
  if (!row || typeof row !== 'object') return [SELL_BLOCKED.NO_ROW];
  // A contradiction outranks an absence. If two spellings of the card name
  // disagree, no amount of filling in the set number makes this listable, and
  // telling the seller to add a set number would be a lie about the problem.
  if (identityFieldConflicts(row).length) return [SELL_BLOCKED.CONFLICT];
  const a = identityAxes(row);
  const missing = [];
  if (!a.game || a.game === 'unknown') missing.push(SELL_BLOCKED.NO_GAME);
  if (!a.set) missing.push(SELL_BLOCKED.NO_SET);
  if (!a.number) missing.push(SELL_BLOCKED.NO_NUMBER);
  return missing;
}

/** Seller-facing sentence for a blocked axis. */
export function sellBlockedMessage(code) {
  switch (code) {
    case SELL_BLOCKED.NO_GAME:
      return 'We could not tell which game this card is from.';
    case SELL_BLOCKED.NO_SET:
      return 'We could not read the set this card belongs to.';
    case SELL_BLOCKED.NO_NUMBER:
      return 'We could not read the card number.';
    case SELL_BLOCKED.NO_ROW:
      return 'No card details to list.';
    case SELL_BLOCKED.CONFLICT:
      return "This card's details don't agree with each other. Re-scan it, or open it and correct the name, set and number.";
    default:
      // Never echo an unknown code at a seller. An unrecognised reason is a
      // bug in this module, and the seller should see a sentence either way.
      return 'This card needs a few more details before it can be listed.';
  }
}

/**
 * The stamp that travels with every row.
 *
 * `eligible` is the whole contract as far as the UI is concerned. `missing`
 * and `message` exist so an ineligible row can explain itself instead of the
 * button quietly not being there — a seller who scanned a card and sees no
 * Sell option should be told why, in the same place they were expecting the
 * button.
 *
 * Note it delegates the boolean to `hasSufficientIdentity` rather than
 * deriving it from `missing.length === 0`. Those two are the same today. If
 * they ever stop being the same, the packet builder's rule is the one that
 * matters, because it is the thing that will actually refuse — and this stamp
 * promising a button that the create then rejects is worse than no button.
 */
export function sellStamp(row) {
  // Conflict is checked here as well as inside missingIdentityAxes, because
  // `eligible` delegates to hasSufficientIdentity — which asks only whether the
  // axes are present, not whether they are contradicted. Without this line a
  // conflicted row would be stamped eligible with an empty missing list, and
  // the create would then refuse it. That is exactly the gate/create
  // disagreement this module exists to make impossible.
  const conflicted = identityFieldConflicts(row).length > 0;
  const eligible = !conflicted && hasSufficientIdentity(row);
  const missing  = eligible ? [] : missingIdentityAxes(row);
  return {
    eligible,
    missing,
    message: eligible ? null : sellBlockedMessage(missing[0]),
  };
}

/** Stamp a list of rows in place-safe fashion, returning new objects. */
export function stampRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => (r && typeof r === 'object' ? { ...r, sell: sellStamp(r) } : r));
}
