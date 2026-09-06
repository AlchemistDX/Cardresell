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
/**
 * The uniqueness constraint moves here from the SKU.
 *
 * One active draft per INSTANCE, not per SKU. That single change fixes raw
 * duplicates and graded duplicates with the same mechanism, instead of fixing
 * graded ones by inflating the SKU and leaving raw ones broken.
 */
export function instanceDraftKey(googleSub, instanceId) {
  return `instancedraft:${keyPart(googleSub)}:${keyPart(instanceId)}`;
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
  const cost     = normalizeCost(opts.acquisitionCost);

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
    acquisitionCost: cost,
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
  if (count >= instance.quantity) throw new Error('SPLIT_WOULD_EMPTY_LOT');

  const remainder = { ...instance, quantity: instance.quantity - count };
  const split = {
    ...instance,
    instanceId: newInstanceId(),
    quantity: count,
    createdAt: new Date().toISOString(),
    ...(changes.condition
      ? { condition: normalizeCondition(changes.condition, false) || instance.condition }
      : {}),
    ...(changes.acquisitionCost !== undefined
      ? { acquisitionCost: normalizeCost(changes.acquisitionCost) }
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
