// api/_listingPacket.js — packet assembly + metadata stamp
//
// Phase 1, Block B5. Assembles identity (A1), title (B1), category and
// aspects (B2), condition (B3) and pricing (B4) into one packet, and stamps
// the five metadata fields.
//
// ── Why the stamp exists ──
// Not so we can trust an old packet's validity — validity is always
// recomputed. It's so "this draft looked different yesterday" becomes
// answerable instead of a guess. That matters more after Phase 3, when a
// packet may have produced a real live listing that a buyer is looking at.
//
// ── 🔴 The relative-age bug this file fixes ──
// `_basisMeta` in core.js carries `cacheAgeSec` — a RELATIVE age. Persist that
// into a draft and it freezes: read the draft three days later and it still
// claims "retrieved 3h ago". By the standing rule that is a stamped lie, and
// it is currently how the data is shaped. So every relative age is converted
// to an absolute `retrievedAt` ISO timestamp on the way in, and display age is
// computed at read time. `FORBIDDEN_AGE_KEYS` is exported so a test can walk
// the finished packet and prove none of them survived.

import { cardIdentity, hasSufficientIdentity } from './_cardIdentity.js';
import { buildListingTitle } from './_listingTitle.js';
import { buildConditionBlock, SEVERITY } from './_conditionDescriptors.js';
import {
  categoryForCard, buildRequiredAspects, CARD_CATEGORIES, VERIFIED_TREE_VERSION,
  ASPECT_SOURCE,
} from './_ebayTaxonomy.js';

/** Ours. Bump when the packet's own shape changes. */
export const PACKET_SCHEMA_VERSION = 1;

/**
 * Any of these keys inside a persisted packet is a bug: they encode "how long
 * ago" relative to a moment that is gone by the time anyone reads it.
 */
export const FORBIDDEN_AGE_KEYS = ['cacheAgeSec', 'ageSec', 'ageSeconds', 'secondsAgo', 'age'];

export const PACKET_CODES = {
  MISSING_FEE_MODEL_REVISION: 'MISSING_FEE_MODEL_REVISION',
  INSUFFICIENT_IDENTITY:      'INSUFFICIENT_IDENTITY',
  SLAB_WITHOUT_CERT:          'SLAB_WITHOUT_CERT',
  NO_CARD_NAME:               'NO_CARD_NAME',
  TITLE_BUDGET_EXCEEDED:      'TITLE_BUDGET_EXCEEDED',
  MISSING_REQUIRED_ASPECT:    'MISSING_REQUIRED_ASPECT',
  UNVERIFIED_ASPECT_VALUES:   'UNVERIFIED_ASPECT_VALUES',
  TAXONOMY_VERSION_ASSUMED:   'TAXONOMY_VERSION_ASSUMED',
  NO_PRICE:                   'NO_PRICE',
};

// ── C0 — schema version handling (Block C entry criterion) ────────────────
//
// packetSchemaVersion becomes real the moment packets are persisted. Until
// something READS it, a v1 packet parsed by v2 code is treated as current and
// silently mis-parsed — the worst available outcome, because it produces
// confident wrong prices rather than an error.
//
// Exactly four inputs, three outcomes, and "assume current" is not one of
// them:
//
//   equal to current   → CURRENT,      usable
//   older, known       → MIGRATED,     migrated forward, records the hop
//   newer than current → INCOMPATIBLE, record preserved, handoff refused
//   missing/malformed  → INCOMPATIBLE, treated as unknown, never as current
//
// Forward safety without destroying user data: an incompatible record is
// never rewritten or deleted, because the client that CAN read it may be one
// deploy away.

export const PACKET_COMPAT = {
  CURRENT:      'CURRENT',
  MIGRATED:     'MIGRATED',
  INCOMPATIBLE: 'INCOMPATIBLE',
};

/**
 * Registered forward migrations, keyed by the version being migrated FROM.
 * Each returns the packet at version key+1. Absent entry for an older version
 * means we cannot migrate it, so it is incompatible rather than assumed.
 *
 * Empty today because v1 is current — the table exists so that adding v2 is a
 * data change rather than a control-flow change.
 */
export const PACKET_MIGRATIONS = {
  // 1: (packet) => ({ ...packet, packetSchemaVersion: 2, /* ... */ }),
};

/**
 * Read a stored packet safely. NEVER returns a packet it could not account
 * for the version of.
 *
 * Returns { status, packet, fromVersion, toVersion, migrationsApplied, reason,
 *           usable }.
 * `usable === false` means the caller must refuse handoff and preserve the
 * record untouched.
 */
export function readStoredPacket(stored, opts = {}) {
  const current = Number.isInteger(opts.currentVersion)
    ? opts.currentVersion
    : PACKET_SCHEMA_VERSION;

  const fail = (reason) => ({
    status: PACKET_COMPAT.INCOMPATIBLE,
    packet: stored ?? null,
    fromVersion: stored && typeof stored === 'object' ? stored.packetSchemaVersion ?? null : null,
    toVersion: current,
    migrationsApplied: [],
    reason,
    usable: false,
  });

  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return fail('PACKET_NOT_AN_OBJECT');
  }

  const raw = stored.packetSchemaVersion;
  // A version must be a real integer. `'1'`, `1.5`, null and undefined are all
  // unknown provenance, and unknown provenance is incompatible — not current.
  if (!Number.isInteger(raw)) return fail('PACKET_VERSION_MALFORMED');
  if (raw < 1) return fail('PACKET_VERSION_MALFORMED');

  if (raw === current) {
    return {
      status: PACKET_COMPAT.CURRENT,
      packet: stored,
      fromVersion: raw,
      toVersion: current,
      migrationsApplied: [],
      reason: null,
      usable: true,
    };
  }

  if (raw > current) {
    // Written by a newer deploy. Preserve it verbatim: the record is not
    // corrupt, this reader is simply behind.
    return fail('PACKET_VERSION_AHEAD_OF_READER');
  }

  // Older. Walk the migration table one step at a time; a single missing hop
  // makes the whole chain incompatible rather than partially applied.
  let working = stored;
  const applied = [];
  for (let v = raw; v < current; v += 1) {
    const step = PACKET_MIGRATIONS[v];
    if (typeof step !== 'function') {
      return {
        ...fail('PACKET_NO_MIGRATION_PATH'),
        fromVersion: raw,
        migrationsApplied: applied,
      };
    }
    working = step(working);
    if (!working || working.packetSchemaVersion !== v + 1) {
      return {
        ...fail('PACKET_MIGRATION_DID_NOT_ADVANCE_VERSION'),
        fromVersion: raw,
        migrationsApplied: applied,
      };
    }
    applied.push(`${v}->${v + 1}`);
  }

  return {
    status: PACKET_COMPAT.MIGRATED,
    packet: working,
    fromVersion: raw,
    toVersion: current,
    migrationsApplied: applied,
    reason: null,
    usable: true,
  };
}


/**
 * 'Sep 2026' → '2026-09'.
 *
 * PLATFORMS.ebay.verified is a human display string. The stamp needs something
 * sortable and machine-comparable. If the input is unparseable we return null
 * rather than a plausible-looking guess — an unknown verification date must
 * not masquerade as a known one.
 */
const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};
export function normalizeVerifiedStamp(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}$/.test(s)) return s;                      // already normalized
  const m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{4})$/);
  if (!m) return null;
  const mm = MONTHS[m[1].slice(0, 3).toLowerCase()];
  return mm ? `${m[2]}-${mm}` : null;
}

/**
 * Convert a `_basisMeta`-shaped object into a persistable price-basis stamp.
 *
 * The relative `cacheAgeSec` becomes an absolute `retrievedAt`. Nothing
 * relative comes out the other side. If there is no age information we emit
 * `retrievedAt: null` — an honest gap beats a fabricated timestamp.
 */
export function stampPriceBasis(basisMeta, nowMs) {
  if (!basisMeta || typeof basisMeta !== 'object') return null;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();

  const age = Number(basisMeta.cacheAgeSec);
  const retrievedAt = Number.isFinite(age) && age >= 0
    ? new Date(now - age * 1000).toISOString()
    : null;

  const out = {
    label:         basisMeta.label || null,
    sourceUrl:     basisMeta.sourceUrl || null,
    // Whether the FEED gave us a real as-of date, or we only know when we
    // fetched it. PriceCharting publishes no as-of date; that distinction is
    // already surfaced in the UI and must survive into the packet.
    datedBySource: basisMeta.datedBySource === true,
    retrievedAt,
    low:           basisMeta.low  ?? null,
    mid:           basisMeta.mid  ?? null,
    high:          basisMeta.high ?? null,
    highClamped:   basisMeta.highClamped === true,
  };
  // Belt and braces: if a future _basisMeta grows another relative field,
  // this strips it rather than letting it ride along into storage.
  for (const k of FORBIDDEN_AGE_KEYS) delete out[k];
  return out;
}

// No price data predates this app, so a stamp older than this is corrupt
// input rather than very stale data.
const MIN_PLAUSIBLE_STAMP_MS = Date.UTC(2015, 0, 1);
// Tolerated clock skew between the writing machine and the reading one.
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

/**
 * Display age computed at READ time from the absolute stamp.
 *
 * Returns null rather than a plausible-looking string whenever the stamp
 * cannot be trusted. The failure mode this guards is specific: a numeric or
 * malformed value like `-1` used to reach Date.parse and come back as
 * "9379 days ago", and a stamp six hours in the future used to clamp to zero
 * and render as "just now" — telling the seller their price was fresh when we
 * had no idea how old it was. "Unknown" is the honest answer; a wrong age is
 * worse than a blank one because the seller prices against it.
 */
export function ageFromRetrievedAt(retrievedAt, nowMs) {
  // Must be a real timestamp string. Numbers, arrays and objects all coerce
  // into something Date.parse will happily interpret.
  if (typeof retrievedAt !== 'string' || !retrievedAt.trim()) return null;
  const t = Date.parse(retrievedAt);
  if (!Number.isFinite(t)) return null;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (t < MIN_PLAUSIBLE_STAMP_MS) return null;
  if (t - now > MAX_FUTURE_SKEW_MS) return null;
  const secs = Math.max(0, Math.round((now - t) / 1000));
  if (secs < 60)    return 'just now';
  if (secs < 3600)  return `${Math.round(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)} hr ago`;
  return `${Math.round(secs / 86400)} days ago`;
}

/**
 * Which aspect name carries "which printing is this" in each category.
 * Grounded in the real getItemAspectsForCategory response saved at
 * api/data/ebay_aspect_names_183454_261328_183050.json:
 *   CCG (183454)       has "Rarity", no "Parallel/Variety"
 *   Sports (261328)    has "Parallel/Variety", no "Rarity"
 *   Non-Sport (183050) has "Parallel/Variety", no "Rarity"
 * Sending "Rarity" to the sports category would be sending a field that does
 * not exist there.
 */
function variantAspectName(categoryId) {
  return categoryId === CARD_CATEGORIES.CCG.id ? 'Rarity' : 'Parallel/Variety';
}

/**
 * Optional aspects we can fill from data we actually hold. These are
 * DISPLAY SUGGESTIONS for the seller to match against the venue's own
 * dropdowns — not verified API values.
 *
 * We know the aspect NAMES are real (fetched from eBay). We do NOT know the
 * allowed VALUES for constrained aspects like `Game`, because that needs
 * getItemAspectsForCategory value enumerations we have not captured. Same rule
 * as the condition descriptors in B3: an unverified value is labelled
 * unverified, never presented as authoritative.
 */
function buildOptionalAspects(row, ident, categoryId) {
  const a = {};
  const put = (k, v) => { const s = String(v ?? '').trim(); if (s) a[k] = [s]; };

  put('Card Name',   ident.displayName);
  put('Card Number', row?.number ?? row?.card_number);
  put('Set',         ident.displaySetName);
  put(variantAspectName(categoryId), row?.rarity);
  put('Language',    ident.language === 'ja' ? 'Japanese' : 'English');
  return a;
}

/**
 * Assemble the packet. Synchronous and pure — no network, no storage — so it
 * is testable offline and so a draft save never depends on eBay being up.
 *
 * `ctx` must carry:
 *   feeModelRevision     integer from core.js FEE_MODEL_REVISION (required)
 *   feeScheduleVerified  'Sep 2026' or '2026-09' (from PLATFORMS.ebay.verified)
 *   taxonomyTreeVersion  live-read version string, optional
 *   pricing              the listPriceForTargetNet result, optional
 *   basisMeta            _basisMeta-shaped price basis, optional
 *   now                  ms epoch, for deterministic tests
 */
export function buildListingPacket(row = {}, ctx = {}) {
  const now   = Number.isFinite(ctx.now) ? ctx.now : Date.now();
  const notes = [];
  const add   = (code, severity, message, extra = {}) =>
    notes.push({ code, severity, message, ...extra });

  const ident = cardIdentity(row);
  const title = buildListingTitle(row, { maxLength: ctx.maxTitleLength });
  const cat   = categoryForCard({ ...row, setName: ident.displaySetName });
  const req   = buildRequiredAspects({ ...row, setName: ident.displaySetName });
  const cond  = buildConditionBlock(row);

  // ── The five metadata fields ────────────────────────────────────────────
  // feeModelRevision is REQUIRED and deliberately not defaulted. The single
  // source of truth is FEE_MODEL_REVISION in core.js, and duplicating a
  // fallback here would let the two drift silently — which is exactly the
  // ambiguity this field exists to remove. A missing value is an ERROR, not a
  // zero.
  const feeModelRevision = Number.isInteger(ctx.feeModelRevision) ? ctx.feeModelRevision : null;
  if (feeModelRevision === null) {
    add(PACKET_CODES.MISSING_FEE_MODEL_REVISION, SEVERITY.ERROR,
        'No feeModelRevision supplied. Pass FEE_MODEL_REVISION from core.js — '
      + 'a packet that cannot say which fee logic priced it is permanently ambiguous.');
  }

  const treeVersionLive = ctx.taxonomyTreeVersion ? String(ctx.taxonomyTreeVersion) : null;
  if (!treeVersionLive) {
    add(PACKET_CODES.TAXONOMY_VERSION_ASSUMED, SEVERITY.INFO,
        `No live taxonomy version supplied; recording the last verified value `
      + `(${VERIFIED_TREE_VERSION}) and labelling it as such.`);
  }

  const metadata = {
    packetSchemaVersion: PACKET_SCHEMA_VERSION,
    taxonomyTreeVersion: treeVersionLive || VERIFIED_TREE_VERSION,
    // Never claim a live read we did not perform.
    taxonomyTreeVersionSource: treeVersionLive ? 'live' : 'verified-constant',
    feeModelRevision,
    feeScheduleVerified: normalizeVerifiedStamp(ctx.feeScheduleVerified),
    generatedAt: new Date(now).toISOString(),
  };

  // ── Validation ──────────────────────────────────────────────────────────
  if (!hasSufficientIdentity(row)) {
    add(PACKET_CODES.INSUFFICIENT_IDENTITY, SEVERITY.ERROR,
        'Need at least game, set and card number to build a listing.');
  }
  // A graded card with no cert is not a uniquely identified item. It can still
  // be listed — plenty of sellers omit the cert — but it must not pass as
  // countable inventory, because two of them share one SKU and the second
  // draft would silently replace the first. WARNING, not ERROR: the seller is
  // allowed to proceed, they just do not get instance-level tracking.
  if (ident.graded && !ident.certKnown) {
    add(PACKET_CODES.SLAB_WITHOUT_CERT, SEVERITY.WARNING,
        'Graded card has no cert number. Add it from the slab label so this '
      + 'copy is tracked separately from other copies of the same card.');
  }
  if (!title.ok && title.reason === 'NO_CARD_NAME') {
    add(PACKET_CODES.NO_CARD_NAME, SEVERITY.ERROR, 'No card name — cannot build a title.');
  } else if (title.dropped.length) {
    add(PACKET_CODES.TITLE_BUDGET_EXCEEDED, SEVERITY.INFO,
        `Title hit the ${title.maxLength}-character limit; omitted ${title.dropped.join(', ')}.`,
        { dropped: title.dropped });
  }
  for (const name of req.missing) {
    add(PACKET_CODES.MISSING_REQUIRED_ASPECT, SEVERITY.WARNING,
        `"${name}" is required by ${req.categoryLabel} and we could not fill it. `
      + 'Set it in the listing form.', { aspect: name });
  }
  // Which values we translated from an internal routing token, as opposed to
  // ones the seller actually supplied. `game: 'pokemonjp'` is our key, not
  // eBay vocabulary, and a packet that renders it without saying so looks
  // copy-ready when it is not.
  const mappedAspects = Object.entries(req.provenance || {})
    .filter(([, p]) => p.source === ASPECT_SOURCE.MAPPED || p.source === ASPECT_SOURCE.INFERRED)
    .map(([name]) => name);
  add(PACKET_CODES.UNVERIFIED_ASPECT_VALUES, SEVERITY.WARNING,
      'Aspect values are our display suggestions, not verified venue values. '
    + 'Match them against the listing form\'s own dropdowns.'
    + (mappedAspects.length
        ? ` We filled ${mappedAspects.join(', ')} from our own catalogue rather than `
          + "the venue's list, so confirm it before submitting."
        : ''),
      { mappedAspects, submissionReady: false });

  const pricing = ctx.pricing || null;
  if (!pricing || pricing.ok !== true || !(pricing.listPrice > 0)) {
    add(PACKET_CODES.NO_PRICE, SEVERITY.WARNING,
        'No list price computed. Set a target payout to get one.');
  }

  notes.push(...cond.notes);

  const blocking = notes.filter((n) => n.severity === SEVERITY.ERROR);

  return {
    sku: ident.sku,
    identity: ident,
    title: { text: title.title, length: title.length, dropped: title.dropped },
    category: { id: cat.id, label: cat.label },
    aspects: {
      required: req.aspects,
      missingRequired: req.missing,
      optional: buildOptionalAspects(row, ident, cat.id),
      // Provenance per aspect, so a consumer can tell a seller-supplied value
      // from one we translated. Phase 2 replaces this with fetched values.
      provenance: req.provenance || {},
      valuesVerified: false,
      // Explicit and separate from valuesVerified: nothing in a Phase 1 packet
      // may be POSTed to a venue as-is. A copy-ready packet is not a
      // submission-ready one.
      submissionReady: false,
    },
    condition: cond,
    pricing: pricing
      ? {
          listPrice:   pricing.listPrice,
          targetNet:   pricing.targetNet,
          achievedNet: pricing.achievedNet,
          // Report what the price really nets, never the requested figure.
          exact:       pricing.exact === true,
          delta:       pricing.delta,
        }
      : null,
    priceBasis: stampPriceBasis(ctx.basisMeta, now),
    metadata,
    notes,
    // C7 severity tiers: only ERROR blocks the handoff.
    blocked: blocking.length > 0,
    blockingCodes: blocking.map((n) => n.code),
  };
}

/** Deep-walk a packet and return every forbidden relative-age key path found. */
export function findRelativeAgeKeys(node, path = '$', found = []) {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    node.forEach((v, i) => findRelativeAgeKeys(v, `${path}[${i}]`, found));
    return found;
  }
  for (const [k, v] of Object.entries(node)) {
    if (FORBIDDEN_AGE_KEYS.includes(k)) found.push(`${path}.${k}`);
    findRelativeAgeKeys(v, `${path}.${k}`, found);
  }
  return found;
}
