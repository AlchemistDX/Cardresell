// api/_cardIdentity.js — canonical card identity + deterministic SKU
//
// Phase 1, Block A1. Platform-neutral BY DESIGN.
//
// This answers one question: "is this the same card I already have?" It does
// NOT know anything about eBay, and must not. CardResell's goal is to be the
// seller's hub for every TCG across every venue — eBay is the first
// integration, not the destination. So identity is a property of the CARD,
// and per-venue packet builders (eBay, TCGplayer, Mercari, Whatnot, …) hang
// off this one identity. If identity were eBay-shaped, venue #2 would be a
// migration instead of an addition.
//
// Pure module: no I/O, no network, no env. Importable by offline tests.
//
// ── Input shape ──
// The real collection row written by core.js (see savePortData call site):
//   { id, updatedAt, card, set, buyPrice, currentValue, addedDate, estGrade,
//     img, number, tcgplayerUrl, grader, grade, game, cardType, setCode,
//     groundedId, rarity, isJapanese, cert? }
// We read: game, setCode, set, number, rarity, isJapanese, grader, grade, cert.
//
// ── Namespace versioning, not freezing ──
// Every SKU carries a `v1-` prefix. Normalization rules WILL need fixing one
// day (see the rarity caveat below). Freezing them is a promise that gets
// broken; versioning means v2 rules can ship without colliding with live v1
// listings, and the migration is explicit instead of silent.

import { createHash } from 'crypto';

export const IDENTITY_NAMESPACE = 'v1';

// Games as actually written by core.js. `pokemonjp` is not a separate game —
// it is Pokémon in Japanese, and it collapses to pokemon + language ja.
export const GAME_CODES = {
  pokemon:   'PKM',
  yugioh:    'YGO',
  mtg:       'MTG',
  lorcana:   'LOR',
  onepiece:  'OP',
  sports:    'SPT',
};

// Graders we recognize. Anything else is kept verbatim (normalized) rather
// than coerced — a grader we don't know about is not the same as no grader.
export const KNOWN_GRADERS = ['PSA', 'BGS', 'CGC', 'SGC', 'TAG', 'ACE'];

const HASH_HEX_CHARS = 16;  // 64 bits. See §Collision budget below.
const HEAD_MAX_CHARS = 20;

// ── Normalization primitives ────────────────────────────────────────────────

/** Lowercase, de-accent, strip punctuation, collapse whitespace. */
export function normalizeText(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // drop combining marks: Pokémon → Pokemon
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Normalize an identifier that contains numeric runs, so that sources which
 * zero-pad differently agree. "045/198" → "45/198", "SV045" → "sv45".
 *
 * Leading zeros are stripped by string surgery, NOT parseInt — a 12-digit
 * cert number would lose precision through a float.
 */
export function normalizeNumber(v) {
  const base = String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, '');
  return base.replace(/\d+/g, (run) => run.replace(/^0+(?=\d)/, ''));
}

// ── The two fields the codebase disagrees with itself about ─────────────────

/**
 * Language is stored TWICE today and the two copies can disagree:
 *   game: 'pokemonjp'   ← the JP card index sets this
 *   isJapanese: true    ← set from scan.js `data.is_japanese`
 *
 * Both derive from the same upstream signal, but nothing enforces that they
 * move together. If we read only one, the same physical card gets two
 * identities depending on which code path saved it.
 *
 * Rule: ANY Japanese signal means Japanese. Union, not precedence — it is
 * deterministic regardless of which field was populated, so both paths
 * converge on one identity.
 */
export function canonicalLanguage(row) {
  const g  = String(row?.game ?? '').toLowerCase().trim();
  // Union of every Japanese signal we accept, including an explicit language
  // field. There are two live save paths — one writes game:'pokemonjp', the
  // other writes game:'pokemon' + isJapanese:true — and they were producing
  // two SKUs for one card. A union resolves deterministically no matter how
  // many signals disagree: any Japanese signal wins, and an explicit
  // language:'en' cannot override a 'pokemonjp' game because the game field
  // describes the printing while `language` is often just a UI default.
  const explicit = String(row?.language ?? row?.lang ?? '').toLowerCase().trim();
  const jp = row?.isJapanese === true
          || row?.is_japanese === true
          || g === 'pokemonjp'
          || explicit === 'ja' || explicit === 'jp' || explicit === 'japanese';
  return jp ? 'ja' : 'en';
}

/** `pokemonjp` collapses to `pokemon`; language carries the Japanese-ness. */
export function canonicalGame(row) {
  const g = String(row?.game ?? '').toLowerCase().trim();
  if (g === 'pokemonjp') return 'pokemon';
  if (g) return g;
  // core.js also writes `cardType`, which mirrors game except for pokemonjp.
  const ct = String(row?.cardType ?? '').toLowerCase().trim();
  return ct || 'unknown';
}

// ── Slab identity ───────────────────────────────────────────────────────────

/**
 * A slab is a specific physical object. Two PSA 9 copies of the same card are
 * two different items that sell separately, and the cert number is the only
 * thing that distinguishes them.
 *
 * `cert` was not captured anywhere in the codebase before Phase 1 — the saved
 * row had grader and grade only. Without it, a reseller holding duplicates got
 * ONE identity for TWO cards. It is optional here so pre-existing rows still
 * resolve, but when present it is part of the identity.
 */
export function isSlab(row) {
  const grader = normalizeText(row?.grader);
  const grade  = String(row?.grade ?? '').trim();
  return !!(grader && grade);
}

export function canonicalGrader(row) {
  const raw = String(row?.grader ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!raw) return '';
  const hit = KNOWN_GRADERS.find((g) => g === raw);
  return hit || raw;   // unknown grader kept, never coerced to a known one
}

/** Grades are numeric-ish but arrive as "10", "9.5", "10 ", 9. Normalize the shape. */
export function canonicalGrade(row) {
  const raw = String(row?.grade ?? '').trim();
  if (!raw) return '';
  const n = Number(raw);
  if (Number.isFinite(n)) {
    // 10 → "10", 9.50 → "9.5", 9 → "9". Stable across "9.0" vs "9".
    return String(n);
  }
  return normalizeText(raw).replace(/\s+/g, '');
}

export function canonicalCert(row) {
  const v = row?.cert ?? row?.certNumber ?? row?.cert_number ?? '';
  return normalizeNumber(v).replace(/\//g, '');
}

// ── Identity ────────────────────────────────────────────────────────────────

/**
 * Ordered identity axes. Order is part of the contract — changing it changes
 * every SKU, which is exactly why the namespace is versioned.
 *
 * `variant` uses `rarity`, because there is no parallel/variant field in the
 * data model and rarity is the field doing that job today (it is the
 * most-read field in core.js).
 *
 * ⚠ KNOWN LIMITATION: rarity strings are not canonical across our sources.
 * "Special Illustration Rare" and "SIR" normalize differently and would split
 * one card into two identities. Normalization here handles case, spacing,
 * punctuation and accents — not synonyms. We are not inventing a synonym table
 * we cannot verify against every source. When real split-identity cases show
 * up in the data, the fix ships as the `v2` namespace with a stated migration.
 */
export function identityAxes(row) {
  const slab = isSlab(row);
  return {
    game:     canonicalGame(row),
    language: canonicalLanguage(row),
    // setCode is the stable machine identifier; the display name is a fallback.
    set:      normalizeNumber(row?.setCode) || normalizeText(row?.set ?? row?.set_name),
    number:   normalizeNumber(row?.number ?? row?.card_number),
    variant:  normalizeText(row?.rarity),
    grader:   slab ? canonicalGrader(row) : '',
    grade:    slab ? canonicalGrade(row)  : '',
    cert:     slab ? canonicalCert(row)   : '',
  };
}

/**
 * The exact string that gets hashed. Stable field order, pipe-delimited, with
 * empty axes preserved as empty segments so that a missing field can never
 * shift the meaning of the next one.
 */
export function identityString(row) {
  const a = identityAxes(row);
  return [
    IDENTITY_NAMESPACE,
    a.game,
    a.language,
    a.set,
    a.number,
    a.variant,
    a.grader || 'raw',
    a.grade,
    a.cert,
  ].join('|');
}

/**
 * Human-readable head, so a SKU is debuggable at a glance without decoding a
 * hash. Bounded and sanitized: uppercase alphanumerics only.
 */
function skuHead(axes) {
  const code = GAME_CODES[axes.game] || 'XXX';
  const body = `${code}${axes.set}${axes.number}`
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return body.slice(0, HEAD_MAX_CHARS) || code;
}

/**
 * Deterministic SKU.
 *
 *   v1-PKM SV4 245-<16 hex>
 *   └┬┘ └──────┬─────┘ └─┬─┘
 *    │         │         └── sha256 of the full identity string
 *    │         └──────────── readable head (game + set + number)
 *    └────────────────────── namespace version
 *
 * Total length is bounded at 3 + 20 + 1 + 16 = 40 characters, which stays
 * comfortably inside the SKU length limits every venue we care about imposes.
 * The head is for humans and is deliberately NOT unique on its own; the hash
 * carries all identity, including axes the head omits (language, variant,
 * grader, grade, cert).
 *
 * Collision budget: 16 hex chars = 64 bits. At 10 million distinct identities
 * the birthday probability of any collision is on the order of 3e-6. If that
 * ever stops being acceptable, widen the hash under a `v2-` namespace.
 */
export function skuFor(row) {
  const axes = identityAxes(row);
  const hash = createHash('sha256').update(identityString(row), 'utf8')
    .digest('hex').slice(0, HASH_HEX_CHARS);
  return `${IDENTITY_NAMESPACE}-${skuHead(axes)}-${hash}`;
}

/**
 * The canonical card record. This is what drafts, packets and (later) venue
 * listings all key off. Deliberately carries no venue fields.
 */
/**
 * Is this identity complete, and does it describe a distinguishable physical
 * instance?
 *
 * These are two different questions and conflating them loses money:
 *
 *   `complete`                — do we have every axis that applies to this
 *                               card? A slab without a cert is INCOMPLETE.
 *   `instanceDistinguishable` — does the SKU identify one physical object?
 *                               Two raw Charizards of the same print are
 *                               genuinely fungible and SHOULD share a SKU.
 *                               Two PSA 9s are not: they have different certs,
 *                               different scratches, and one may already be
 *                               listed. Without a cert they collapse into one
 *                               SKU, and the second draft silently overwrites
 *                               the first.
 *
 * So a raw card is complete-but-not-distinguishable by design, while a
 * cert-less slab is neither, and callers must be able to tell those apart
 * rather than seeing one "valid" boolean.
 */
export function identityCompleteness(row) {
  const axes    = identityAxes(row);
  const slab    = isSlab(row);
  const missing = [];
  if (!axes.game || axes.game === 'unknown') missing.push('game');
  if (!axes.set)    missing.push('set');
  if (!axes.number) missing.push('number');
  if (slab) {
    if (!axes.grader) missing.push('grader');
    if (!axes.grade)  missing.push('grade');
    if (!axes.cert)   missing.push('cert');
  }
  return {
    complete: missing.length === 0,
    missing,
    certKnown: slab ? !!axes.cert : false,
    // Only a certified slab is one identifiable object. Raw cards are
    // fungible, so `false` here is correct and expected for them.
    instanceDistinguishable: slab && !!axes.cert,
  };
}

export function cardIdentity(row) {
  const axes = identityAxes(row);
  const comp = identityCompleteness(row);
  return {
    sku:            skuFor(row),
    namespace:      IDENTITY_NAMESPACE,
    graded:         isSlab(row),
    ...axes,
    // Never let a cert-less slab pass as uniquely identified inventory.
    certKnown:               comp.certKnown,
    instanceDistinguishable: comp.instanceDistinguishable,
    identityComplete:        comp.complete,
    missingAxes:             comp.missing,
    // Display-only. NOT part of identity — a renamed card is the same card,
    // and card names vary across our sources more than any other field.
    displayName:    String(row?.card ?? row?.card_name ?? '').trim(),
    displaySetName: String(row?.set  ?? row?.set_name  ?? '').trim(),
  };
}

/** True when there is enough identity to build anything at all. */
export function hasSufficientIdentity(row) {
  const a = identityAxes(row);
  return !!(a.game && a.game !== 'unknown' && a.set && a.number);
}
