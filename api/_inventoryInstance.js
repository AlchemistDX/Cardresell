// api/_inventoryInstance.js
//
// The layer that was missing, and whose absence made us push cert into the SKU.
//
//   SKU          product identity     deterministic     "a PSA 9 Base Set Charizard"
//   instance     physical ownership   GENERATED id      "the one in my binder, cert 84061234"
//   draft        selling intent       generated id      "I intend to sell that one, on eBay"
//
// Why the instance id is generated rather than derived:
//
// A seller can genuinely own two indistinguishable Near Mint raw copies. There
// is no function of card attributes that can tell those two physical objects
// apart, because the attributes are identical — that is what "indistinguishable"
// means. Any deterministic scheme therefore either collides them (the bug this
// layer exists to fix) or smuggles in something that is not a card attribute,
// like a counter or a timestamp, at which point it is a generated id wearing a
// disguise. So: generated, explicitly.
//
// The SKU stays deterministic for the opposite reason — two sellers scanning the
// same card anywhere must land on the same product, or cross-venue comps and
// payout comparison do not work at all.

import { randomUUID } from 'crypto';
import { skuFor, identityAxes, isSlab } from './_cardIdentity.js';

/** Schema version. Read through `readStoredInstance`, never trusted blindly. */
export const INSTANCE_SCHEMA_VERSION = 1;

/**
 * Quantity model: an instance is a LOT, not a single card.
 *
 * Card sellers hold multiples — a stack of eleven identical Near Mint commons
 * is one economic decision, not eleven. One-record-per-copy is cleaner in
 * theory and unusable in practice for bulk, which is most of the volume.
 *
 * The lot only holds together while every copy in it is materially the same:
 * same condition, same acquisition cost, same cert, same photos. The moment one
 * copy differs it must be split out — `splitInstance` below — because otherwise
 * the lot starts averaging over things that price differently, and averaging
 * away real differences is the one thing this codebase does not do.
 *
 * A slab lot is capped at 1 by construction: a cert number describes exactly
 * one physical slab, so a lot of five sharing a cert is a data error.
 */
export const MAX_LOT_QUANTITY = 5000;

export function instanceKey(googleSub, instanceId) {
  return `inv:${keyPart(googleSub)}:${keyPart(instanceId)}`;
}
export function instancePattern(googleSub) {
  return `inv:${keyPart(googleSub)}:*`;
}
/** All instances a seller holds of one product — answers "do I already own this?" */
export function skuInstancesKey(googleSub, sku) {
  return `skuinv:${keyPart(googleSub)}:${keyPart(sku)}`;
}
/*
 * REMOVED 2026-09-10: `instanceDraftsKey` / `instancedrafts:<sub>:<instanceId>`.
 *
 * It defined a key, documented it as the per-instance set of draftIds, and was
 * asserted by two tests — all of which only checked the string it returned. No
 * production code ever wrote or read it, so "the uniqueness constraint moves to
 * the instance" was a guarantee the storage layer advertised and the product
 * never enforced. That is the same failure shape as the D8 idempotency defect:
 * an assertion evidencing a surface nothing exercises.
 *
 * Deleted rather than wired. A duplicate is reachable today only by losing BOTH
 * 24-hour idempotency recovery records, and a new index is not the right answer
 * to that. If "one live draft per instance" becomes a product requirement, it
 * gets implemented and tested as that requirement, against the create path.
 */

/**
 * The slot a draft occupies within an instance.
 *
 * The slot IS the uniqueness boundary, so its normalization has to be
 * deterministic and total. If 'EBAY' and 'ebay' can both reach storage, they
 * become two logical slots holding two active drafts for one physical card —
 * the exact collision this layer was built to eliminate, reintroduced through
 * casing. So: canonicalize, then validate against a known set, and refuse
 * anything that is not exactly one canonical slot.
 */
/**
 * Venue -> the strategies that venue actually supports.
 *
 * Validating venue and strategy INDEPENDENTLY would accept
 * mercari + auction — both tokens individually valid, the pair meaningless.
 * Since the slot is a uniqueness boundary, an impossible slot is a real
 * inventory bug: a draft could occupy a slot nothing can ever publish to, and
 * the instance would look like it already has a listing in progress.
 *
 * Not a Phase 1 blocker, since admission refuses everything except eBay
 * anyway, but the contract is cheap to get right while the function is new.
 */
export const SUPPORTED_SLOTS = {
  ebay:       ['fixed-price', 'auction'],
  mercari:    ['fixed-price'],
  whatnot:    ['auction'],
  tcgplayer:  ['fixed-price'],
};

export const VENUES = Object.keys(SUPPORTED_SLOTS);
export const STRATEGIES = [...new Set(Object.values(SUPPORTED_SLOTS).flat())];

function canonicalToken(v) {
  return String(v ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

export function draftSlot(venue, strategy = 'fixed-price') {
  const v = canonicalToken(venue);
  const st = canonicalToken(strategy);
  if (!v) throw new Error('SLOT_VENUE_EMPTY');
  if (!st) throw new Error('SLOT_STRATEGY_EMPTY');
  if (!VENUES.includes(v)) throw new Error('SLOT_VENUE_UNKNOWN');
  if (!STRATEGIES.includes(st)) throw new Error('SLOT_STRATEGY_UNKNOWN');
  // The PAIR has to be possible, not just each token individually.
  if (!SUPPORTED_SLOTS[v].includes(st)) throw new Error('SLOT_STRATEGY_UNSUPPORTED_FOR_VENUE');
  // Belt and braces: the slot is a key component, so it must never carry a
  // delimiter that could shift the meaning of the key it lands in.
  const slot = `${v}:${st}`;
  if (slot.split(':').length !== 2) throw new Error('SLOT_UNSAFE');
  return slot;
}

/** True when a string is already exactly the canonical form of itself. */
export function isCanonicalSlot(slot) {
  if (typeof slot !== 'string' || !slot) return false;
  const parts = slot.split(':');
  if (parts.length !== 2) return false;
  try { return draftSlot(parts[0], parts[1]) === slot; } catch { return false; }
}

/** Venues Phase 1 can actually hand off to. Deliberately short and honest. */
export const PHASE1_VENUES = ['ebay'];

/**
 * Phase 1 business rule, applied above the plural storage shape.
 * Returns a refusal reason or null.
 */
export function phase1DraftAdmission(existingSlots, venue, strategy = 'fixed-price') {
  let slot;
  try {
    slot = draftSlot(venue, strategy);   // validates and canonicalizes
  } catch (e) {
    return e.message;                    // SLOT_VENUE_UNKNOWN, SLOT_VENUE_EMPTY, ...
  }
  const v = slot.split(':')[0];
  if (!PHASE1_VENUES.includes(v)) return 'VENUE_NOT_SUPPORTED_IN_PHASE_1';
  // Compare canonical against canonical. A non-canonical entry already in the
  // set is a corrupted index, not a near-miss to be tolerated.
  const existing = (existingSlots || []).map((x) => (isCanonicalSlot(x) ? x : null));
  if (existing.includes(slot)) return 'ACTIVE_DRAFT_EXISTS_FOR_SLOT';
  return null;
}

/** Reject delimiters rather than escaping them — an id is ours to generate. */
function keyPart(v) {
  const s = String(v ?? '');
  if (!s) throw new Error('INSTANCE_KEY_EMPTY');
  if (/[:\s*]/.test(s)) throw new Error('INSTANCE_KEY_UNSAFE');
  return s;
}

export function newInstanceId() {
  return `inv_${randomUUID().replace(/-/g, '')}`;
}

const CONDITIONS = new Set([
  'gem-mint', 'mint', 'near-mint', 'lightly-played',
  'moderately-played', 'heavily-played', 'damaged',
]);

/**
 * Build an ownership record.
 *
 * Refuses rather than guesses. An instance with an invented condition or an
 * unparseable cost is worse than no instance: it prices wrongly and looks
 * deliberate, which is the failure mode this codebase keeps designing against.
 */
export function buildInstance(row, opts = {}) {
  const sku  = skuFor(row);
  const axes = identityAxes(row);
  const slab = isSlab(row);

  const condition = normalizeCondition(opts.condition, slab);
  if (!condition) throw new Error('INSTANCE_CONDITION_UNKNOWN');

  const quantity = normalizeQuantity(opts.quantity, slab);
  // Named TOTAL, and it is the total for the whole lot. "acquisitionCost: 25"
  // on a lot of 11 is unanswerable — $25 each or $25 for all of them? — and
  // that ambiguity would silently poison every profit figure My Flips shows.
  // Storing lot total + quantity also preserves the actual transaction, so
  // per-unit is derived rather than the other way round.
  const cost = normalizeCost(
    opts.totalAcquisitionCost !== undefined ? opts.totalAcquisitionCost : opts.acquisitionCost,
  );
  if (opts.acquisitionCost !== undefined && opts.totalAcquisitionCost === undefined
      && normalizeQuantity(opts.quantity, slab) > 1) {
    // Refuse the ambiguous shape outright rather than pick a meaning for it.
    throw new Error('INSTANCE_COST_AMBIGUOUS_USE_TOTAL');
  }

  return {
    schemaVersion: INSTANCE_SCHEMA_VERSION,
    instanceId: opts.instanceId || newInstanceId(),
    sku,
    // Denormalized so an instance is readable without a second lookup, and so
    // a SKU namespace bump does not orphan the ownership record.
    card: {
      game: axes.game, language: axes.language, set: axes.set,
      number: axes.number, variant: axes.variant,
      grader: axes.grader || null, grade: axes.grade || null,
      name: row?.card || row?.name || null,
    },
    // Cert lives HERE. This is the physical slab, so this is where the number
    // that identifies a physical slab belongs.
    cert: slab ? (axes.cert || null) : null,
    condition,
    quantity,
    totalAcquisitionCost: cost,
    photos: [],            // paths only, and not before Phase 3
    notes: typeof opts.notes === 'string' ? opts.notes.slice(0, 2000) : '',
    createdAt: new Date().toISOString(),
  };
}

function normalizeCondition(v, slab) {
  if (slab) return 'graded';            // the grade IS the condition
  const s = String(v ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  return CONDITIONS.has(s) ? s : null;
}

function normalizeQuantity(v, slab) {
  if (v === undefined || v === null || v === '') return 1;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new Error('INSTANCE_QUANTITY_INVALID');
  }
  // A cert describes one slab. A lot of five sharing it is a data error, not a
  // quantity — catch it here rather than listing five copies of one card.
  if (slab && v !== 1) throw new Error('INSTANCE_SLAB_QUANTITY_MUST_BE_ONE');
  if (v > MAX_LOT_QUANTITY) throw new Error('INSTANCE_QUANTITY_TOO_LARGE');
  return v;
}

/** Per-unit cost, derived. Null propagates — an unknown basis is not zero. */
export function unitAcquisitionCost(instance) {
  const total = instance?.totalAcquisitionCost;
  const qty   = instance?.quantity;
  if (total === null || total === undefined) return null;
  if (!Number.isInteger(qty) || qty < 1) return null;
  return Math.round((total / qty) * 100) / 100;
}

/** Strict: `Number(null) === 0` must never become a real acquisition cost. */
function normalizeCost(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new Error('INSTANCE_COST_INVALID');
  }
  return Math.round(v * 100) / 100;
}

/**
 * Split copies out of a lot when one differs materially.
 *
 * Deliberately minimal for Phase 1 — the schema has to make this possible
 * later, which is the actual requirement. Returns both records; the caller
 * persists them together or not at all.
 */
export function splitInstance(instance, count, changes = {}) {
  if (!instance || typeof instance !== 'object') throw new Error('INSTANCE_NOT_AN_OBJECT');
  if (!Number.isInteger(count) || count < 1) throw new Error('SPLIT_COUNT_INVALID');
  // Checked before the quantity guard so a slab reports the specific reason.
  // A slab lot is always 1, so the generic "would empty the lot" would fire
  // first and tell the caller the wrong thing about an unsplittable object.
  if (instance.cert || instance.condition === 'graded') {
    throw new Error('SPLIT_SLAB_NOT_SPLITTABLE');
  }
  if (!Number.isInteger(instance.quantity) || instance.quantity < 1) {
    throw new Error('SPLIT_SOURCE_QUANTITY_INVALID');
  }
  if (count >= instance.quantity) throw new Error('SPLIT_WOULD_EMPTY_LOT');

  const qty = instance.quantity;

  /**
   * Cost basis is CONSERVED across a split. Splitting a lot is not an economic
   * event — no money moved — so the money must not change. Once My Flips
   * computes real profit, a split that quietly created or destroyed basis
   * would show up as phantom profit or phantom loss on a card the seller never
   * traded.
   *
   * Done in integer cents, and the remainder is derived by SUBTRACTION rather
   * than by rounding the other side independently. Two independent roundings
   * of $100 / 3 give $33.33 and $66.67 only by luck; subtraction is exact by
   * construction for every input.
   */
  const total = instance.totalAcquisitionCost;
  let splitCost = null, remainderCost = null;
  if ((total === null || total === undefined) && changes.totalAcquisitionCost !== undefined) {
    // Refuse rather than quietly discard it. You cannot allocate a share of a
    // basis that was never recorded, and silently dropping a number the seller
    // typed is how a cost basis goes missing without anyone noticing.
    throw new Error('SPLIT_COST_ALLOCATION_WITHOUT_BASIS');
  }
  if (total !== null && total !== undefined) {
    const totalCents = Math.round(total * 100);
    let splitCents;
    if (changes.totalAcquisitionCost !== undefined) {
      // Manual allocation is allowed, but it must still add up.
      const manual = normalizeCost(changes.totalAcquisitionCost);
      if (manual === null) throw new Error('SPLIT_COST_ALLOCATION_INVALID');
      splitCents = Math.round(manual * 100);
      if (splitCents > totalCents) throw new Error('SPLIT_COST_EXCEEDS_BASIS');
    } else {
      splitCents = Math.round((totalCents * count) / qty);
    }
    const remainderCents = totalCents - splitCents;
    if (remainderCents < 0) throw new Error('SPLIT_COST_EXCEEDS_BASIS');
    splitCost     = splitCents / 100;
    remainderCost = remainderCents / 100;
    // Conservation is asserted, not assumed. If this ever trips, the bug is
    // here and not in the seller's arithmetic.
    if (splitCents + remainderCents !== totalCents) {
      throw new Error('SPLIT_COST_NOT_CONSERVED');
    }
  }

  const remainder = {
    ...instance,
    quantity: qty - count,
    totalAcquisitionCost: remainderCost,
  };
  const split = {
    ...instance,
    instanceId: newInstanceId(),
    quantity: count,
    totalAcquisitionCost: splitCost,
    createdAt: new Date().toISOString(),
    ...(changes.condition
      ? { condition: normalizeCondition(changes.condition, false) || instance.condition }
      : {}),
  };
  return { remainder, split };
}

/**
 * Read a stored instance. Same discipline as `readStoredPacket`: an unknown
 * version is preserved and refused, never assumed current.
 */
export function readStoredInstance(stored) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return { status: 'incompatible', usable: false, reason: 'INSTANCE_NOT_AN_OBJECT', instance: stored };
  }
  const v = stored.schemaVersion;
  if (!Number.isInteger(v) || v < 1) {
    return { status: 'incompatible', usable: false, reason: 'INSTANCE_VERSION_MALFORMED', instance: stored };
  }
  if (v > INSTANCE_SCHEMA_VERSION) {
    return { status: 'incompatible', usable: false, reason: 'INSTANCE_VERSION_AHEAD_OF_READER', instance: stored };
  }
  if (v < INSTANCE_SCHEMA_VERSION) {
    return { status: 'incompatible', usable: false, reason: 'INSTANCE_NO_MIGRATION_PATH', instance: stored };
  }
  return { status: 'current', usable: true, reason: null, instance: stored };
}
