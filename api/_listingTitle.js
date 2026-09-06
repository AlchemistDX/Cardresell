// api/_listingTitle.js — listing title builder
//
// Phase 1, Block B1. Platform-neutral: 80 characters happens to be eBay's
// limit, but it is passed in rather than assumed, so a venue with a different
// cap reuses this whole module.
//
// The hard rule is NEVER TRUNCATE MID-TOKEN. A title cut to
// "Charizard ex Obsidian Flames #125 Double Ra" is worse than one that simply
// omits the rarity: the first looks broken and costs the seller credibility,
// the second reads as a deliberate, clean title. So this drops whole segments
// by priority instead of slicing a string at character 80.
//
// ── Why cert is NOT in the title ──
// A cert number is 8-9 characters of budget that no buyer searches for. It
// belongs in the structured condition descriptor (Block B3), where eBay
// actually indexes it and where the buyer's slab lookup expects it. Putting it
// in the title would push out the set name — a term buyers really do search.

import {
  cardIdentity, canonicalGrader, canonicalGrade, isSlab, canonicalLanguage,
} from './_cardIdentity.js';

export const DEFAULT_MAX_TITLE = 80;

/**
 * Drop order, cheapest loss first. Lower `priority` is offered budget first.
 *
 * This is priority-ordered FIRST FIT, not strict priority. Segments are
 * offered the remaining budget in priority order, and one that does not fit is
 * dropped — but a cheaper lower-priority segment may still fit afterwards.
 * That is deliberate: if a long set name cannot fit, spending the leftover
 * eight characters on "Holo Rare" gives the buyer more to match on than
 * leaving the title short. The guarantee is therefore "nothing is dropped that
 * would have fit", plus strict precedence for the top three below.
 *
 * The ordering is a claim about what a card buyer searches for, and the
 * ordering of the top three is the part that matters:
 *   1 name          — without it there is no listing
 *   2 grader+grade  — "PSA 10" is the single strongest search term on a slab
 *   3 number        — how collectors disambiguate reprints
 * Rarity and year rank below the set name because the set name is what gets
 * typed into the search box; rarity is usually inferable from the card itself.
 */
const PRIORITY = {
  name:      1,
  gradeTag:  2,
  number:    3,
  setName:   4,
  language:  5,
  year:      6,
  rarity:    7,
};

// Display order, independent of drop priority. This is the order a card
// person reads a title in, not the order we would sacrifice pieces.
const DISPLAY_ORDER = ['year', 'name', 'setName', 'number', 'rarity', 'language', 'gradeTag'];

/** Collapse whitespace and strip characters that break venue title validation. */
function clean(v) {
  return String(v ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    // Venues reject or mangle these in titles; they carry no search value.
    .replace(/[<>{}|\\^~[\]`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Trim a single over-long token run to a whole-word boundary.
 * Only ever applied to the name, and only when the name alone busts the cap.
 */
function clampWords(text, max) {
  if (text.length <= max) return text;
  const words = text.split(' ');
  let out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > max) break;
    out = next;
  }
  // A single word longer than the cap is the one case with no word boundary to
  // cut on. Hard-slice it, because emitting nothing would be worse.
  return out || text.slice(0, max);
}

/**
 * Year is only worth title budget on sports cards, where it is part of how
 * the product is named ("2023 Prizm"). On a Pokémon card the set name already
 * implies the year and the digits just crowd the title.
 */
function yearSegment(row, ident) {
  const y = clean(row?.year ?? row?.card_year);
  if (!y || !/^\d{4}$/.test(y)) return '';
  return ident.game === 'sports' ? y : '';
}

export function titleSegments(row = {}, opts = {}) {
  const ident = cardIdentity(row);
  const graded = isSlab(row);

  const numberRaw = clean(row?.number ?? row?.card_number);
  const segs = {
    year:     yearSegment(row, ident),
    name:     clean(ident.displayName),
    setName:  clean(ident.displaySetName),
    // Collectors write card numbers with a leading #. Keep the source's own
    // "125/197" form here — this is display, not identity, so do NOT feed it
    // through normalizeNumber and strip the zero padding printed on the card.
    number:   numberRaw ? (numberRaw.startsWith('#') ? numberRaw : `#${numberRaw}`) : '',
    rarity:   clean(row?.rarity),
    language: canonicalLanguage(row) === 'ja' ? 'Japanese' : '',
    gradeTag: graded ? clean(`${canonicalGrader(row)} ${canonicalGrade(row)}`) : '',
  };

  if (opts.includeRawCondition && !graded && segs.name) {
    // Raw cards say nothing about condition in the title on purpose: the
    // seller picks the real condition in the venue's own form (Phase 1 hands
    // off, it does not submit). Claiming "NM" here would be us asserting a
    // condition nobody inspected.
    segs.rawNote = '';
  }

  return segs;
}

/**
 * Build a title that fits `maxLength` without ever cutting a token in half.
 *
 * Returns the title plus exactly what was dropped and why, so the handoff
 * screen can tell the seller "rarity omitted, title full" rather than
 * silently shipping a thinner title than they expected.
 */
export function buildListingTitle(row = {}, opts = {}) {
  const max = Number(opts.maxLength) || DEFAULT_MAX_TITLE;
  const segs = titleSegments(row, opts);

  const present = Object.keys(PRIORITY)
    .filter((k) => segs[k])
    .sort((a, b) => PRIORITY[a] - PRIORITY[b]);

  if (!segs.name) {
    // No name means no title. Refuse rather than emit "#125 PSA 10", which
    // would look like a listing and sell nothing.
    return {
      title: '', length: 0, ok: false, reason: 'NO_CARD_NAME',
      included: [], dropped: present, maxLength: max,
    };
  }

  const included = [];
  const dropped = [];

  // The name may exceed the cap on its own; clamp it to whole words first so
  // the budget arithmetic below is honest.
  const nameBudget = clampWords(segs.name, max);
  const nameWasClamped = nameBudget !== segs.name;
  const working = { ...segs, name: nameBudget };

  const render = (keys) => DISPLAY_ORDER
    .filter((k) => keys.includes(k))
    .map((k) => working[k])
    .filter(Boolean)
    .join(' ');

  for (const key of present) {
    const candidate = [...included, key];
    if (render(candidate).length <= max) included.push(key);
    else dropped.push(key);
  }

  const title = render(included);

  return {
    title,
    length: title.length,
    // `ok` is about structural validity, not completeness. A title that had
    // to drop rarity is still a good title.
    ok: title.length > 0 && title.length <= max,
    maxLength: max,
    included,
    dropped,
    nameClamped: nameWasClamped,
    reason: dropped.length ? 'TITLE_BUDGET_EXCEEDED' : null,
  };
}
