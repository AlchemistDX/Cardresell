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
// Every SKU carries a `v2-` prefix. Normalization rules WILL need fixing one
// day (see the rarity caveat below). Freezing them is a promise that gets
// broken; versioning means v2 rules can ship without colliding with live v1
// listings, and the migration is explicit instead of silent.

import { createHash } from 'crypto';

/**
 * Bumped v1 -> v2 when the cert number moved OUT of the SKU and onto the
 * inventory instance. Every slab SKU changes as a result, so the namespace
 * changes with it — a silent hash change that quietly re-keys inventory is
 * exactly the kind of thing that is impossible to debug six months later.
 * Nothing is persisted yet (no KV store, nothing deployed), so this costs
 * nothing today and would have been expensive after the first saved draft.
 */
export const IDENTITY_NAMESPACE = 'v2';

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
    // NO cert. A cert number identifies a physical slab, not a product. Two
    // PSA 9 copies of the same card are the same sellable thing — same comps,
    // same venue category, same payout math — and the whole product is
    // comparing payouts for a product across venues. Keeping cert here made
    // every slab its own product class, which would have fragmented pricing
    // per slab. Cert now lives on the inventory instance, where the physical
    // copy is actually modelled.
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
 *   v2-PKM SV4 245-<16 hex>
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
 * Is this PRODUCT identity complete?
 *
 * Note what this deliberately no longer asks: whether we can tell one physical
 * copy from another. The SKU cannot answer that for anything, and pretending
 * it could for slabs was the flaw.
 *
 * A cert-less PSA 9 is a perfectly complete product identity — "PSA 9 Charizard
 * Base Set 4" is exactly the thing whose payout we compare across venues. What
 * a missing cert costs us is a better LISTING (eBay's Certification Number
 * descriptor) and buyer trust, not the ability to identify the product. So a
 * missing cert is a listing-quality warning, raised by the packet, and not an
 * identity failure that blocks a handoff.
 *
 * Distinguishing two physical copies is the inventory instance's job, and it
 * uses a generated id precisely because no function of card attributes can
 * separate two indistinguishable raw copies. See `api/_inventoryInstance.js`.
 */
export function identityCompleteness(row) {
  const axes    = identityAxes(row);
  const slab    = isSlab(row);
  const missing = [];
  if (!axes.game || axes.game === 'unknown') missing.push('game');
  if (!axes.set)    missing.push('set');
  if (!axes.number) missing.push('number');
  if (slab) {
    // Grader and grade ARE product identity: a PSA 9 and a PSA 10 of the same
    // card are different products with different comps. The cert is not.
    if (!axes.grader) missing.push('grader');
    if (!axes.grade)  missing.push('grade');
  }
  return {
    complete: missing.length === 0,
    missing,
    // Still surfaced, because the listing wants it and a slab without one is
    // worth a warning — it is just no longer part of identity.
    certKnown: slab ? !!axes.cert : false,
    certRecommended: slab,
    /**
     * Always false, for every card, by design. The SKU is a product class.
     * Uniformly false is more honest than a flag that was true only for
     * certified slabs and invited callers to use the SKU as an instance key.
     */
    identifiesOnePhysicalCopy: false,
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
    certKnown:                 comp.certKnown,
    certRecommended:           comp.certRecommended,
    // Always false. Distinguishing physical copies is the inventory
    // instance's job — see api/_inventoryInstance.js. Kept explicit so no
    // caller can mistake a product SKU for a per-copy key.
    identifiesOnePhysicalCopy: comp.identifiesOnePhysicalCopy,
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

/**
 * ── SKU identity is NOT valuation identity ───────────────────────────────
 *
 * Condition is deliberately outside the SKU, so a Near Mint and a heavily
 * played raw Charizard share one product SKU. They must never share a price.
 *
 * That is a footgun sitting in plain sight: `priceCache[sku]` reads perfectly
 * naturally and would serve an NM valuation to an HP copy — a wrong number that
 * looks completely authoritative, which is the failure mode this codebase keeps
 * designing against. So the distinction is a named function with its own key
 * space rather than a convention someone has to remember.
 *
 *   product identity   → what thing is this?        → skuFor()
 *   valuation identity → what is THIS COPY worth?   → valuationKeyFor()
 *
 * For a slab the grade already lives in the SKU, so the two collapse — but the
 * key is still produced through this function, so no caller has to know which
 * case it is holding.
 */
export function valuationKeyFor(row, opts = {}) {
  const sku  = skuFor(row);
  const slab = isSlab(row);

  if (slab) {
    // The grade IS the condition, and it is already an identity axis.
    return `${sku}|graded`;
  }

  const condition = String(opts.condition ?? row?.condition ?? '')
    .trim().toLowerCase().replace(/\s+/g, '-');
  if (!condition) {
    // No silent default. An unpriced-because-unknown-condition raw card is a
    // question for the seller, not a guess with a dollar sign in front of it.
    throw new Error('VALUATION_CONDITION_REQUIRED');
  }
  // Pricing source belongs in the key too: the same copy carries different
  // comps on different venues, and mixing them in one cache is how a TCGplayer
  // number ends up presented as an eBay payout.
  const source = String(opts.source ?? 'any').trim().toLowerCase();
  return `${sku}|${condition}|${source}`;
}

/**
 * True when two rows are the same product but must be valued separately.
 * Useful in tests and assertions; cheap enough to call in a guard.
 */
export function sameProductDifferentValue(a, b, optsA = {}, optsB = {}) {
  return skuFor(a) === skuFor(b) && valuationKeyFor(a, optsA) !== valuationKeyFor(b, optsB);
}
