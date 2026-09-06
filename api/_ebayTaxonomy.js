// /api/_ebayTaxonomy.js
// eBay Taxonomy lookups + trading-card listing constants.
//
// Every constant below was verified live against api.ebay.com on 2026-09-05
// with an application (client_credentials) token. Notably: Taxonomy accepts the
// APPLICATION token, so category and aspect resolution does NOT require the
// seller's user token. That means the whole listing-packet layer can be built
// and tested before any OAuth consent flow exists.
//
// Anything not verified is marked UNVERIFIED and must be confirmed before use.

import { getEbayAppToken, ebayHeaders } from './_ebayAuth.js';

const API_BASE       = 'https://api.ebay.com/commerce/taxonomy/v1';
const CACHE_TTL_SEC  = 6 * 60 * 60; // taxonomy shifts on the order of months
const CACHE_PREFIX   = 'ebay:taxo:';

// ── Verified category IDs (marketplace EBAY_US, category tree "0") ────────
// Each entry's `requiredAspects` was read from get_item_aspects_for_category
// on 2026-09-05. Every one of these categories requires exactly ONE aspect,
// and all three are derivable from data CardResell already extracts on scan.
export const CARD_CATEGORIES = {
  CCG: {
    id: '183454',
    label: 'Collectible Card Games > CCG Individual Cards',
    requiredAspects: ['Game'],       // e.g. "Pokémon TCG", "Magic: The Gathering"
    totalAspects: 35,
  },
  SPORTS: {
    id: '261328',
    label: 'Sports Trading Card Singles',
    requiredAspects: ['Sport'],      // e.g. "Basketball", "Baseball"
    totalAspects: 30,
  },
  NON_SPORT: {
    id: '183050',
    label: 'Non-Sport Trading Card Singles',
    requiredAspects: ['Franchise'],  // e.g. "Star Wars", "Garbage Pail Kids"
    totalAspects: 33,
  },
};

// Verified: get_default_category_tree_id?marketplace_id=EBAY_US
// → { categoryTreeId: "0", categoryTreeVersion: "134" }
export const US_CATEGORY_TREE_ID = '0';
export const VERIFIED_TREE_VERSION = '134';

// ── Condition IDs ─────────────────────────────────────────────────────────
// Mandatory on trading-card listings. Source: eBay Q4-2023 seller newsletter
// + MIP condition-descriptor user guide.
export const CONDITION = {
  GRADED:   '2750',
  UNGRADED: '4000',
};

// Condition DESCRIPTOR ids. These are distinct from aspects — grader, grade
// and cert number are NOT aspects on 183454 (confirmed: absent from its
// aspect list), they travel in the condition-descriptor block. Omitting a
// required descriptor makes the listing operation fail outright.
export const CONDITION_DESCRIPTOR = {
  PROFESSIONAL_GRADER:  '27501',
  GRADE:                '27502',
  CERT_NUMBER:          '27503',
  UNGRADED_CONDITION:   '40001',
};

// UNVERIFIED — the enumerated VALUE ids for each descriptor (which integer
// means "PSA", which means "10") have not been read from the API yet. They are
// required for a real publishOffer call. Resolve them via
// getItemConditionPolicies (Sell Metadata API, needs a user token) before
// Phase 3. Do not guess these; a wrong value id silently mislabels a slab.
export const DESCRIPTOR_VALUES_RESOLVED = false;

// CardResell's graders, in the order the scanner reports them. Mapping each to
// an eBay descriptor value id is the open task above.
export const SUPPORTED_GRADERS = ['PSA', 'BGS', 'CGC', 'SGC', 'TAG', 'ACE'];

// ── Redis cache (best-effort, mirrors api/ conventions) ───────────────────

async function kvGet(key) {
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const r = await fetch(`${url}/get/${encodeURIComponent(key)}`,
      { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    return d.result ? JSON.parse(d.result) : null;
  } catch { return null; }
}

async function kvSetEx(key, value, ttlSec) {
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(
      `${url}/setex/${encodeURIComponent(key)}/${ttlSec}/${encodeURIComponent(JSON.stringify(value))}`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
    );
  } catch { /* best-effort */ }
}

async function taxonomyGet(path, params = {}, { cacheKey, ttl = CACHE_TTL_SEC } = {}) {
  if (cacheKey) {
    const hit = await kvGet(CACHE_PREFIX + cacheKey);
    if (hit) return hit;
  }

  const token = await getEbayAppToken();
  const qs = new URLSearchParams(params).toString();
  const url = `${API_BASE}${path}${qs ? '?' + qs : ''}`;

  const r = await fetch(url, { headers: ebayHeaders(token) });
  const text = await r.text();

  if (!r.ok) {
    const err = new Error(`eBay Taxonomy ${path} failed: HTTP ${r.status}`);
    err.code = 'EBAY_TAXONOMY_HTTP';
    err.status = r.status;
    err.body = text.slice(0, 400);
    throw err;
  }

  let json;
  try { json = JSON.parse(text); }
  catch {
    const err = new Error(`eBay Taxonomy ${path} returned non-JSON`);
    err.code = 'EBAY_TAXONOMY_PARSE';
    throw err;
  }

  if (cacheKey) await kvSetEx(CACHE_PREFIX + cacheKey, json, ttl);
  return json;
}

// ── Public API ────────────────────────────────────────────────────────────

/** Default category tree id for a marketplace. US is "0". */
export async function getDefaultCategoryTreeId(marketplaceId = 'EBAY_US') {
  const json = await taxonomyGet('/get_default_category_tree_id',
    { marketplace_id: marketplaceId },
    { cacheKey: `tree_id:${marketplaceId}` });
  return json;
}

/** Full aspect metadata for a category. */
export async function getItemAspectsForCategory(categoryId, treeId = US_CATEGORY_TREE_ID) {
  return taxonomyGet(`/category_tree/${treeId}/get_item_aspects_for_category`,
    { category_id: String(categoryId) },
    { cacheKey: `aspects:${treeId}:${categoryId}` });
}

/** Category subtree — useful for narrowing below the three top-level card nodes. */
export async function getCategorySubtree(categoryId, treeId = US_CATEGORY_TREE_ID) {
  return taxonomyGet(`/category_tree/${treeId}/get_category_subtree`,
    { category_id: String(categoryId) },
    { cacheKey: `subtree:${treeId}:${categoryId}` });
}

/**
 * Just the aspect names eBay marks required for a category — the minimum a
 * listing packet must satisfy. Falls back to the verified constants above if
 * the live call fails, so a Taxonomy outage can't block packet construction.
 */
export async function getRequiredAspectNames(categoryId, treeId = US_CATEGORY_TREE_ID) {
  try {
    const json = await getItemAspectsForCategory(categoryId, treeId);
    return (json.aspects || [])
      .filter(a => a?.aspectConstraint?.aspectRequired)
      .map(a => a.localizedAspectName);
  } catch (e) {
    const known = Object.values(CARD_CATEGORIES).find(c => c.id === String(categoryId));
    if (known) return [...known.requiredAspects];
    throw e;
  }
}

/**
 * Pick the eBay category for a scanned card. Pure + synchronous so it can be
 * unit-tested and reused client-side.
 *
 * Deliberately conservative: CCG is the default because it is CardResell's
 * dominant inventory (Pokémon), and a wrong category is a listing defect.
 */
export function categoryForCard(card = {}) {
  const hay = [card.game, card.franchise, card.sport, card.setName, card.set_name, card.category]
    .filter(Boolean).join(' ').toLowerCase();

  // `game: 'sports'` is this codebase's explicit sports marker. Without it
  // here, a sports card whose set name carries no brand keyword fell through
  // to CCG and then emitted the token "sports" into the Game aspect.
  if (String(card.game || '').toLowerCase() === 'sports' ||
      card.sport || card.player || card.playerName ||
      /\b(basketball|baseball|football|hockey|soccer|nba|nfl|mlb|nhl|fifa|topps|panini|prizm|donruss)\b/.test(hay)) {
    return CARD_CATEGORIES.SPORTS;
  }
  if (/\b(pokemon|pokémon|magic|mtg|yu-?gi-?oh|yugioh|lorcana|digimon|one piece|flesh and blood|weiss|cardfight|dragon ball)\b/.test(hay)) {
    return CARD_CATEGORIES.CCG;
  }
  if (/\b(star wars|marvel|garbage pail|topps chrome ufc|wwe|non-?sport)\b/.test(hay)) {
    return CARD_CATEGORIES.NON_SPORT;
  }
  return CARD_CATEGORIES.CCG;
}

/**
 * Map a scanned card onto the required aspect for its category.
 * Returns { categoryId, aspects, missing } — `missing` non-empty means the
 * packet is not yet listable and needs seller input.
 */
/**
 * Internal game tokens are OUR routing keys, not venue vocabulary.
 *
 * `game: 'pokemonjp'` is how this codebase says "Japanese Pokémon printing".
 * It is not a string eBay has ever heard of, and passing it straight into the
 * `Game` aspect produced a packet that LOOKED copy-ready while carrying an
 * internal token into a constrained field.
 *
 * These labels are human-readable renderings for the seller to match against
 * the venue's own dropdown. They are explicitly NOT verified venue values —
 * eBay's allowed values for `Game` require getItemAspectsForCategory with a
 * user token, which is Phase 2. Anything mapped here is marked
 * `submissionReady: false` and must stay that way until those values are
 * fetched, not guessed.
 *
 * Japanese-ness deliberately does not appear here: it belongs in the Language
 * aspect, not in the name of the game.
 */
const INTERNAL_GAME_LABELS = {
  pokemon:   'Pokémon TCG',
  pokemonjp: 'Pokémon TCG',
  mtg:       'Magic: The Gathering',
  yugioh:    'Yu-Gi-Oh!',
  lorcana:   'Disney Lorcana',
  onepiece:  'One Piece Card Game',
};

/**
 * Shape of an internal routing key: all lowercase, no spaces or punctuation.
 * `pokemonjp` matches; `Pokémon TCG` does not. Used to tell a token we failed
 * to map from a display string a human actually typed, so a game we add to the
 * scanner but forget to add above degrades to "missing" instead of leaking.
 */
const INTERNAL_TOKEN_SHAPE = /^[a-z0-9]+$/;

/** Where an aspect value came from, which decides whether it may be submitted. */
export const ASPECT_SOURCE = {
  SELLER:   'seller-confirmed',
  MAPPED:   'internal-token-mapped',
  INFERRED: 'inferred',
  ABSENT:   'missing',
};

/** True only for values we have checked against the venue's own allowed list. */
export function aspectValueIsSubmissionReady() {
  // Phase 1 holds no verified aspect VALUES for any constrained aspect. This
  // is a function rather than a constant so Phase 2 can make it per-aspect
  // without every caller changing shape.
  return false;
}

/**
 * Map a scanned card onto the required aspect for its category.
 *
 * Returns { categoryId, aspects, missing, provenance, submissionReady }.
 * `missing` non-empty means the packet needs seller input. `submissionReady`
 * is false for the whole of Phase 1: these are display suggestions for a human
 * to match, never values to POST.
 */
export function buildRequiredAspects(card = {}) {
  const cat = categoryForCard(card);
  const aspects = {};
  const missing = [];
  const provenance = {};

  for (const name of cat.requiredAspects) {
    let value  = '';
    let source = ASPECT_SOURCE.ABSENT;

    if (name === 'Game') {
      const raw = card.game ? String(card.game) : '';
      const mapped = INTERNAL_GAME_LABELS[raw.toLowerCase()];
      if (mapped) {
        // An internal routing token. Render the human label, and record that
        // this value was translated by us rather than supplied by the seller.
        value = mapped;
        source = ASPECT_SOURCE.MAPPED;
      } else if (raw && INTERNAL_TOKEN_SHAPE.test(raw)) {
        // Looks like one of our routing keys but is not in the map — a game we
        // added to the scanner and forgot to add here. Emitting it would leak
        // the token; guessing a label would invent venue vocabulary. Report it
        // missing so the seller fills it in, which is honest and fixable.
        value = '';
        source = ASPECT_SOURCE.ABSENT;
      } else if (raw) {
        // A human-readable string, so it came from a form rather than routing.
        value = raw;
        source = ASPECT_SOURCE.SELLER;
      } else if (/pok[eé]mon/i.test(JSON.stringify(card))) {
        value = 'Pokémon TCG';
        source = ASPECT_SOURCE.INFERRED;
      }
    } else if (name === 'Sport') {
      value = card.sport || '';
      if (value) source = ASPECT_SOURCE.SELLER;
    } else if (name === 'Franchise') {
      value = card.franchise || '';
      if (value) source = ASPECT_SOURCE.SELLER;
    }

    if (value) {
      aspects[name] = [String(value)];
      provenance[name] = {
        value: String(value),
        source,
        // Every constrained aspect value is unverified in Phase 1, regardless
        // of how confident the source looks.
        submissionReady: aspectValueIsSubmissionReady(name, cat.id),
      };
    } else {
      missing.push(name);
      provenance[name] = { value: null, source: ASPECT_SOURCE.ABSENT, submissionReady: false };
    }
  }

  return {
    categoryId: cat.id,
    categoryLabel: cat.label,
    aspects,
    missing,
    provenance,
    submissionReady: false,
  };
}
