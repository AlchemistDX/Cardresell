// ── RC-2 item 3: the listing description ───────────────────────────────────
//
// A description a seller pastes into a marketplace's description box. It is
// the only text in this packet a BUYER reads, which changes what may be in it.
//
// The rule is narrow and load-bearing: this module states recorded facts and
// nothing else. Everything a description is normally padded with -- condition
// adjectives, "authentic", "pack fresh", "ships in a toploader", "same-day
// dispatch" -- is a claim about a card nobody here has handled, or a promise
// nobody here can keep, made in the seller's name to a buyer who can hold them
// to it. A generated sentence that costs the seller a return, or an authenticity
// claim they never made, is worse for them than an empty description box.
//
// So there is no adjective vocabulary in this file, and no defaults. Every
// line traces to a field that was recorded, and a field that was not recorded
// produces no line rather than a plausible one.
//
// Two consequences worth naming, because they look like omissions:
//
//   * A RAW card gets no condition line. The seller's condition call is made in
//     the marketplace's own condition field, and this app does not hold it --
//     the pill on the pricing panel declares what condition a PRICE is quoted
//     at, which is a different question from what the seller warrants to a
//     buyer. Restating a pricing input as a listing declaration is exactly the
//     one-behaviour-two-meanings shape this codebase keeps getting caught by.
//     The omission is reported, not silent: see `omitted`.
//   * A GRADED card gets grader, grade and cert, because those are recorded
//     facts about the slab. They are still not OUR verification of it -- the
//     condition guidance says so to the seller in the same breath.
//
// The condition lines come from `conditionHandoffLines` rather than being
// formatted again here: one card-condition-to-text implementation, not two.

import { conditionHandoffLines } from './_conditionDescriptors.js';

export const DESCRIPTION_CODES = {
  DESCRIPTION_RAW_CONDITION_OMITTED: 'DESCRIPTION_RAW_CONDITION_OMITTED',
  DESCRIPTION_SPARSE:                'DESCRIPTION_SPARSE',
};

/**
 * Fields that may appear, in the order a reader expects them, each paired with
 * the aspect bag key that supplies it. Aspects are used as the source because
 * they are already the normalized, display-ready projection of the row --
 * "Pokémon TCG", not "pokemon"; "English", not "en" -- and re-deriving those
 * strings here would be a second implementation of the same mapping.
 */
const FIELD_ORDER = Object.freeze([
  ['Card Name',   'Card'],
  ['Set',         'Set'],
  ['Card Number', 'Card Number'],
  ['Rarity',      'Rarity'],
  ['Language',    'Language'],
  ['Game',        'Game'],
]);

const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

/**
 * Build the description block.
 *
 * @param parts.title      the packet's title block  ({ text })
 * @param parts.aspects    the packet's aspects block ({ required, optional })
 * @param parts.row        the row, for the condition block
 * @returns { text, lines, omitted, notes }
 */
export function buildListingDescription(parts = {}) {
  const notes = [];
  const omitted = [];
  const aspects = parts.aspects && typeof parts.aspects === 'object' ? parts.aspects : {};
  const bags = [aspects.required, aspects.optional]
    .filter((b) => b && typeof b === 'object');

  const pick = (name) => {
    for (const bag of bags) {
      if (!Object.prototype.hasOwnProperty.call(bag, name)) continue;
      const raw = bag[name];
      const vals = (Array.isArray(raw) ? raw : [raw]).map(clean).filter(Boolean);
      if (vals.length) return vals.join(', ');
    }
    return '';
  };

  const lines = [];
  for (const [aspectName, label] of FIELD_ORDER) {
    const v = pick(aspectName);
    if (v) lines.push(`${label}: ${v}`);
  }

  // Condition. Graded slabs carry recorded facts; raw cards carry the seller's
  // own call, which this app does not hold.
  const cond = parts.condition && typeof parts.condition === 'object' ? parts.condition : null;
  if (cond && cond.graded) {
    for (const l of conditionHandoffLines(parts.row || {})) {
      const c = clean(l);
      if (c) lines.push(c);
    }
  } else if (cond) {
    omitted.push('condition');
    notes.push({
      code: DESCRIPTION_CODES.DESCRIPTION_RAW_CONDITION_OMITTED,
      severity: 'INFO',
      // Scoped to what the DESCRIPTION does. That condition is the seller's
      // call, and where they make it, is said once by the condition guidance.
      message: 'The description leaves condition out. Add any wear you want to '
             + 'describe in your own words after pasting.',
    });
  }

  // A description of a card nobody has identified is not worth pasting. Said
  // plainly rather than shipped as a near-empty box the seller discovers later.
  //
  // Thinness is judged on the fields that say WHICH PRINTING this is -- set and
  // card number -- not on the line count. Counting lines would call a
  // description healthy on the strength of "Language: English" and "Game:
  // Pokémon TCG", which are defaults this app supplies rather than facts the
  // seller recorded, and the seller would get the reassurance without the card.
  const named = lines.some((l) => l.startsWith('Card: '));
  const identifying = lines.some((l) => l.startsWith('Set: ') || l.startsWith('Card Number: '));
  if (!named || !identifying) {
    notes.push({
      code: DESCRIPTION_CODES.DESCRIPTION_SPARSE,
      severity: 'WARNING',
      message: 'There is little recorded about this card, so the description is thin. '
             + 'Fill in the card details and refresh, or write the description yourself.',
    });
  }

  /* The heading restates the listing title above the structured lines.
     
     It IS redundant when the lines carry the identity, and a change removing it
     was written and then reverted on 2026-09-12 at the owner's direction: the
     reported defect was the fused, duplicated title ("#134 #134"), and the
     heading was not part of it. With the title corrected the heading reads
     "Ivysaur Mega Evolution #134/132 Illustration Rare" followed by the
     structured lines, which is repetitive but not awkward -- judged on the real
     post-fix export (ivysaur-post-fix.csv), not on a prediction of it.
     
     Presentation behaviour the defect did not require is left alone. If the
     redundancy is worth removing later it is its own change with its own
     before/after, not a passenger on an identity fix. */
  const heading = clean(parts.title && parts.title.text);
  const text = (heading ? [heading, '', ...lines] : lines).join('\n');

  return { text, lines, omitted, notes };
}
