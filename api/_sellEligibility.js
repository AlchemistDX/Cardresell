// ── Can this row start a listing draft? ──────────────────────────────────────
//
// One owner, because the alternative was going to be two.
//
// D1 says the Sell entry point "appears only when identity is sufficient to
// build a packet". The browser is the thing that has to decide whether to draw
// a button, and the rule lives in `identityReadiness()` on the server. The
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

// identityReadiness is the single owner of sufficiency. This module translates
// its neutral axis names into seller-facing reason codes and sentences, and
// decides nothing about readiness itself.
import { identityReadiness } from './_cardIdentity.js';

export const SELL_BLOCKED = {
  NO_GAME:   'SELL_NEEDS_GAME',
  NO_SET:    'SELL_NEEDS_SET',
  NO_NUMBER: 'SELL_NEEDS_NUMBER',
  // The title builder refuses a nameless card with NO_CARD_NAME, so a row with
  // a game, a set and a number but no name was being stamped eligible and then
  // refused at create — the exact dead button this module exists to prevent.
  // Identity sufficiency for a SKU and sufficiency to LIST are not the same
  // question: the SKU hashes the axes, the listing needs something to call the
  // card. This gate answers the second question.
  NO_NAME:   'SELL_NEEDS_CARD_NAME',
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
const AXIS_TO_CODE = Object.freeze({
  game:   SELL_BLOCKED.NO_GAME,
  set:    SELL_BLOCKED.NO_SET,
  number: SELL_BLOCKED.NO_NUMBER,
  name:   SELL_BLOCKED.NO_NAME,
});

export function missingIdentityAxes(row) {
  return sellReasons(identityReadiness(row));
}

/**
 * Translate a readiness result into seller-facing codes.
 *
 * Split out from missingIdentityAxes so a caller that already has a readiness
 * result does not have to recompute it just to get the codes — recomputation
 * is where two answers to one question come from.
 */
export function sellReasons(readiness) {
  if (readiness.noRow) return [SELL_BLOCKED.NO_ROW];
  // A contradiction outranks an absence. If two spellings of the card name
  // disagree, no amount of filling in the set number makes this listable, and
  // telling the seller to add a set number would be a lie about the problem.
  // This is a PRESENTATION decision, which is why it lives here and not in
  // identityReadiness: readiness reports both facts, this chooses what to say.
  if (readiness.conflicts.length) return [SELL_BLOCKED.CONFLICT];
  return readiness.missingAxes.map((axis) => AXIS_TO_CODE[axis]).filter(Boolean);
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
    case SELL_BLOCKED.NO_NAME:
      return 'We could not read this card\u2019s name.';
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
 * ONE readiness call, read two ways. `eligible` is `readiness.sufficient` and
 * `missing` is the same result translated into codes, so the boolean and the
 * list cannot contradict each other. Two earlier versions of this function
 * computed them separately: the first derived the boolean from
 * hasSufficientIdentity (which is how a nameless card was stamped eligible
 * with an empty missing list), the second derived it from `missing.length`,
 * which was correct but still left two functions that could drift apart.
 * Neither computes sufficiency any more — identityReadiness does.
 */
export function sellStamp(row) {
  const readiness = identityReadiness(row);
  const missing = sellReasons(readiness);
  return {
    eligible: readiness.sufficient,
    missing,
    message: readiness.sufficient ? null : sellBlockedMessage(missing[0]),
  };
}

/**
 * Stamp every position in a list, returning ONLY the stamps, positionally.
 *
 * This replaces an earlier `stampRows` that returned annotated rows and passed
 * non-objects (null, strings, numbers) straight through unstamped. Its only
 * caller then read `row.sell`, which for those positions was undefined, and
 * substituted `{eligible:false, missing:[], message:null}` — an unexplained
 * refusal. `sellStamp(null)` had the right answer all along
 * (SELL_NEEDS_CARD, "No card details to list."); the wrapper discarded it.
 *
 * So: no pass-through, no annotated rows, no second shape for the caller to
 * reinterpret. Malformed positions are stamped like anything else, because a
 * malformed row is a refusal WITH a reason, not an absence of one. Index i of
 * the output always describes index i of the input.
 */
export function stampList(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => sellStamp(r));
}
