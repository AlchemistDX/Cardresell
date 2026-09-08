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
  // Format drift, and a DIFFERENT severity class from the rest of this table.
  // Every other code here reports a failure to STATE something. This one
  // exists because the old code accepted any truthy value, stamped it
  // `source: 'live'`, and in doing so SUPPRESSED TAXONOMY_VERSION_ASSUMED --
  // so an unvalidated string was treated as stronger evidence than the
  // verified constant, and the honest fallback was silenced by the dishonest
  // input. A malformed version now falls back and says both things.
  TAXONOMY_VERSION_UNPARSEABLE: 'TAXONOMY_VERSION_UNPARSEABLE',
  // NO_PRICE means what its name says: this draft has no price. It used to
  // test ctx.pricing -- the target-payout inversion result -- while carrying a
  // message telling the seller to set a target payout. Name, message and
  // trigger each described a different thing, and on a $250 comp-priced draft
  // with no inversion it rendered "No list price computed" beside a price.
  // Two conditions now, two names, neither claiming the other's meaning.
  NO_PRICE:                   'NO_PRICE',
  NO_TARGET_NET_PRICING:      'NO_TARGET_NET_PRICING',
  // The packet-level form of the SELLER_PRICED rule in _draftStore.js. A
  // stamped priceBasis is evidence about the MARKET; it is not the origin of a
  // number the seller typed. Attaching one silently would let the review screen
  // present a seller's own asking price as comp-derived.
  PRICE_BASIS_NOT_SOURCE_OF_PRICE: 'PRICE_BASIS_NOT_SOURCE_OF_PRICE',
  // ── The priceBasis normalizer's failure modes ────────────────────────────
  // Every one of these used to resolve to a silent null. Split absent from
  // unparseable throughout, for the same reason as the fee schedule: an
  // incomplete caller and a feed that changed shape want different responses,
  // and collapsing them sends someone to fix the wrong end.
  PRICE_BASIS_ABSENT:         'PRICE_BASIS_ABSENT',
  PRICE_BASIS_AGE_ABSENT:     'PRICE_BASIS_AGE_ABSENT',
  PRICE_BASIS_AGE_UNPARSEABLE:'PRICE_BASIS_AGE_UNPARSEABLE',
  PRICE_BASIS_INCOMPLETE:     'PRICE_BASIS_INCOMPLETE',
  PRICE_BASIS_DATING_UNPARSEABLE: 'PRICE_BASIS_DATING_UNPARSEABLE',
  // Split deliberately, and for the same reason `feeAudited` vs a live read is
  // split above: "nobody sent a fee-schedule date" and "someone sent one this
  // module could not read" are different events with different causes. Absent
  // is an incomplete caller. UNPARSEABLE is FORMAT DRIFT — the venue table
  // changed shape and this module did not hear about it — and folding it into
  // the absent case would hide the only signal that drift produces.
  FEE_SCHEDULE_DATE_ABSENT:      'FEE_SCHEDULE_DATE_ABSENT',
  FEE_SCHEDULE_DATE_UNPARSEABLE: 'FEE_SCHEDULE_DATE_UNPARSEABLE',
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
  // A readable packet of the right version that no longer describes the draft
  // it is attached to. Separate from INCOMPATIBLE on purpose: nothing is wrong
  // with the record, it is simply no longer current, and the two need
  // different messages to a seller ("refresh the app" vs "recompute").
  STALE:        'STALE',
};

/**
 * ── Which draft fields the packet is a function of ──────────────────────────
 *
 * Declared in the packet module rather than the store, because the packet is
 * the thing that depends on them: whoever adds a field to the packet is the
 * one who must add it here, in the file they are already editing.
 *
 * `price` is here because the packet carries `pricing.listPrice`; `title`
 * because it carries `title.text`. `quantity` and `notes` are deliberately
 * absent — the packet does not derive from them, and listing them would
 * invalidate packets on edits that cannot have changed a number.
 *
 * `priceSource` was added when the packet started raising
 * PRICE_BASIS_NOT_SOURCE_OF_PRICE, which reads it — so it passes the test in
 * the banner above `tests/draft-store.mjs`'s survival checks: would
 * `buildListingPacket()` produce different bytes? It would.
 *
 * It is here even though `applyEdit` cannot currently change `priceSource`.
 * Leaving it out would be safe only for as long as that stays true, which is
 * a coupling to another module's behaviour and exactly the assumption the
 * read-time fingerprint exists to stop making. The write site that makes
 * `priceSource` editable is one nobody has written yet.
 */
export const PACKET_INPUT_FIELDS = ['price', 'priceSource', 'title'];

/**
 * A fingerprint of the draft inputs a packet was built from.
 *
 * ── Why a stored fingerprint instead of invalidating on edit ───────────────
 *
 * The obvious fix for a stale packet is to drop it in `applyEdit` when the
 * price changes. That fix is one write path wide. `applyEdit` is not the only
 * thing that can change a price — a migration, a repair script, a future
 * bulk-reprice, or simply the next edit path someone adds are all free to
 * write a draft record without knowing packets exist, and each one silently
 * reintroduces the same stale display.
 *
 * So staleness is DERIVED AT READ TIME by comparing the fingerprint stored
 * beside the packet against the draft as it actually is now. A write path
 * that has never heard of packets cannot defeat it: changing the price changes
 * the recomputed fingerprint, and the mismatch is what makes the packet
 * unusable. Nothing has to remember to invalidate.
 *
 * Absence is not agreement. A packet stored with no fingerprint at all cannot
 * be shown to still match, so it reads as stale rather than as current —
 * the same "unknown provenance is not current" rule the version check uses.
 */
export function packetInputFingerprint(draft = {}) {
  const parts = PACKET_INPUT_FIELDS.map((f) => {
    const v = draft ? draft[f] : undefined;
    // null and undefined are the same fact here (no value) and must fingerprint
    // identically, or a draft would read as stale merely for having been
    // rewritten by a path that omits an absent field instead of nulling it.
    if (v === null || v === undefined) return `${f}=\u0000`;
    return `${f}=${typeof v}:${String(v)}`;
  });
  return parts.join('|');
}

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
  // `YYYY-MM-DD`, which is the format the venue table actually uses. This was
  // NOT here when the client wiring was written against the docblock, and the
  // consequence was invisible rather than loud: `feeAuditedOn: '2026-09-01'`
  // matched neither branch, fell out as null, and nothing anywhere reported
  // it. A month is the granularity a fee schedule has, so the day is dropped
  // rather than carried — the stamp answers "which published schedule", not
  // "when did we look".
  const ymd = s.match(/^(\d{4}-\d{2})-\d{2}$/);
  if (ymd) return ymd[1];
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
  return stampPriceBasisReporting(basisMeta, nowMs).basis;
}

/**
 * The same normalizer, with its failure modes named instead of swallowed.
 *
 * `stampPriceBasis` above is a thin wrapper over this so the two cannot drift:
 * the parse rules live here once. Callers that only want the stamp keep the
 * old signature; `buildListingPacket` uses this one so a null can be reported
 * rather than rendering as an empty caption nobody can explain.
 *
 * These are not edge cases. The two SportsCardsPro basis assignments in the
 * bundle (`window._crBasis` at core:3326 and core:4845) set exactly
 * `{ value, low: null, mid: null, high: null, label }` -- no `cacheAgeSec`,
 * no `sourceUrl`, no `datedBySource`. Every sports-card price therefore
 * produces a basis with a label and nothing else, and the packet used to
 * record that as a clean stamp.
 *
 * (An earlier draft of this comment blamed PriceCharting. That was wrong and
 * is recorded here rather than quietly corrected: PriceCharting's gap is
 * `datedBySource: false` -- no publisher as-of date -- which the stamp
 * ALREADY handles honestly and which is a different failure from having no
 * retrieval time at all.)
 */
export function stampPriceBasisReporting(basisMeta, nowMs) {
  const findings = [];
  if (!basisMeta || typeof basisMeta !== 'object') {
    return { basis: null, findings: [{ code: PACKET_CODES.PRICE_BASIS_ABSENT }] };
  }
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();

  const rawAge = basisMeta.cacheAgeSec;
  const ageSupplied = rawAge !== null && rawAge !== undefined && String(rawAge).trim() !== '';
  const age = Number(rawAge);
  const ageUsable = ageSupplied && Number.isFinite(age) && age >= 0;
  const retrievedAt = ageUsable ? new Date(now - age * 1000).toISOString() : null;

  if (!ageSupplied)      findings.push({ code: PACKET_CODES.PRICE_BASIS_AGE_ABSENT });
  else if (!ageUsable)   findings.push({ code: PACKET_CODES.PRICE_BASIS_AGE_UNPARSEABLE });

  const missing = [];
  if (!basisMeta.label)     missing.push('label');
  if (!basisMeta.sourceUrl) missing.push('sourceUrl');
  if (missing.length) findings.push({ code: PACKET_CODES.PRICE_BASIS_INCOMPLETE, missing });

  // A non-boolean here used to read as "not dated by source", which is a
  // CLAIM about the feed rather than an admission that we could not tell.
  if (basisMeta.datedBySource !== undefined && basisMeta.datedBySource !== null
      && typeof basisMeta.datedBySource !== 'boolean') {
    findings.push({ code: PACKET_CODES.PRICE_BASIS_DATING_UNPARSEABLE });
  }

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
  return { basis: out, findings };
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
 *   feeScheduleVerified  'Sep 2026', '2026-09' or '2026-09-01', from
 *                        PLATFORMS.ebay.feeAuditedOn in core.js. NOT `.verified`
 *                        — this line said `.verified` for three commits and no
 *                        such field exists, so the one instruction available to
 *                        whoever wires a caller pointed at nothing.
 *   taxonomyTreeVersion  live-read version string, optional
 *   price                the draft's price, for the NO_PRICE condition. Read,
 *                        never copied into the packet: the draft record is the
 *                        authority on its own price, and a second stored copy
 *                        would need its own invalidation story.
 *   priceSource          'comp' | 'seller' | ..., for
 *                        PRICE_BASIS_NOT_SOURCE_OF_PRICE
 *   pricing              the listPriceForTargetNet result, optional. NOTE:
 *                        that function has no production caller (defined in
 *                        js/core.*.js, called only from tests), so in practice
 *                        this arrives absent and NO_TARGET_NET_PRICING fires.
 *                        See audit/TODO_PHASE1.md — never wired, not cut.
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

  // ── Live taxonomy version, validated before it is believed ──────────────
  // eBay's get_default_category_tree_id returns categoryTreeVersion as a
  // numeric string ("134"). Anything else is drift or a wiring mistake, and
  // must not be able to buy the 'live' label. Deliberately NOT widened into a
  // lenient parser: the point is to refuse what we cannot recognize, not to
  // salvage it.
  const rawTree       = ctx.taxonomyTreeVersion;
  const treeSupplied  = rawTree !== null && rawTree !== undefined
                        && String(rawTree).trim() !== '';
  const treeCandidate = treeSupplied ? String(rawTree).trim() : null;
  const treeVersionLive = (treeCandidate && /^\d+$/.test(treeCandidate)) ? treeCandidate : null;

  if (treeSupplied && treeVersionLive === null) {
    add(PACKET_CODES.TAXONOMY_VERSION_UNPARSEABLE, SEVERITY.WARNING,
        'A live taxonomy version was supplied but is not a recognizable eBay '
      + 'category tree version. Falling back to the verified constant.');
  }
  // The fallback notice fires whenever the constant is what got recorded --
  // including after a rejection above. These two are ALLOWED to co-occur, and
  // that is the fix: the previous code let a bad input suppress this one.
  if (!treeVersionLive) {
    add(PACKET_CODES.TAXONOMY_VERSION_ASSUMED, SEVERITY.INFO,
        `No live taxonomy version supplied; recording the last verified value `
      + `(${VERIFIED_TREE_VERSION}) and labelling it as such.`);
  }

  // Normalized before the metadata block so the two failure modes can be
  // reported. Unlike feeModelRevision this is NOT blocking: a listing is
  // publishable without knowing which month's fee schedule was audited, and
  // the number it would gate is already carried by feeModelRevision. It is
  // recorded loudly and allowed through.
  const rawSchedule       = ctx.feeScheduleVerified;
  const scheduleSupplied  = rawSchedule !== null && rawSchedule !== undefined
                            && String(rawSchedule).trim() !== '';
  const feeScheduleVerified = normalizeVerifiedStamp(rawSchedule);

  const metadata = {
    packetSchemaVersion: PACKET_SCHEMA_VERSION,
    taxonomyTreeVersion: treeVersionLive || VERIFIED_TREE_VERSION,
    // Never claim a live read we did not perform.
    taxonomyTreeVersionSource: treeVersionLive ? 'live' : 'verified-constant',
    feeModelRevision,
    feeScheduleVerified: feeScheduleVerified,
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

  // ── The draft's own price ────────────────────────────────────────────────
  // 0 is a PRICE. Some venues permit a zero-priced listing (see the slot rule
  // in _draftStore.js), so absence is the test here, not falsiness.
  const hasDraftPrice = ctx.price !== null && ctx.price !== undefined
                        && Number.isFinite(Number(ctx.price));
  if (!hasDraftPrice) {
    add(PACKET_CODES.NO_PRICE, SEVERITY.WARNING,
        'This draft has no price yet.');
  }

  // ── The target-payout inversion, named separately ───────────────────────
  // Non-blocking, and distinct from NO_PRICE: a seller can list a priced draft
  // without ever having asked "what list price nets me $X". Collapsing the two
  // is what produced "No list price computed" on a draft that had a price.
  if (!pricing || pricing.ok !== true || !(pricing.listPrice > 0)) {
    add(PACKET_CODES.NO_TARGET_NET_PRICING, SEVERITY.WARNING,
        'No target-payout price was computed for this draft.');
  }

  // ── A stamped basis is not the origin of a seller-typed price ───────────
  // Same asymmetry as SELLER_PRICED in _draftStore.js, one layer in. If the
  // seller typed the number, the basis stamped beside it is market CONTEXT,
  // not the number's provenance, and a review screen reading the packet must
  // not present the two as the same claim. Warned rather than stripped: the
  // basis is genuinely useful next to an asking price, and deleting evidence
  // to avoid mislabelling it is the wrong trade.
  const { basis: stampedBasis, findings: basisFindings } = stampPriceBasisReporting(ctx.basisMeta, now);

  for (const f of basisFindings) {
    // A seller who typed their own number owes no market basis, so its
    // absence is not a finding against them. A 'comp' or 'venue' price claims
    // one, and a claim with no evidence behind it is the thing worth saying.
    if (f.code === PACKET_CODES.PRICE_BASIS_ABSENT) {
      if (ctx.priceSource && ctx.priceSource !== 'seller') {
        add(f.code, SEVERITY.WARNING,
            `This price is recorded as '${ctx.priceSource}'-derived but no price basis was supplied.`);
      }
      continue;
    }
    if (f.code === PACKET_CODES.PRICE_BASIS_AGE_ABSENT) {
      add(f.code, SEVERITY.WARNING,
          'The price basis carries no retrieval time, so how old it is cannot be stated.');
    } else if (f.code === PACKET_CODES.PRICE_BASIS_AGE_UNPARSEABLE) {
      add(f.code, SEVERITY.WARNING,
          'The price basis carries a retrieval age that could not be read.');
    } else if (f.code === PACKET_CODES.PRICE_BASIS_INCOMPLETE) {
      add(f.code, SEVERITY.WARNING,
          `The price basis is missing ${f.missing.join(' and ')}.`, { missing: f.missing });
    } else if (f.code === PACKET_CODES.PRICE_BASIS_DATING_UNPARSEABLE) {
      add(f.code, SEVERITY.WARNING,
          'The price basis dating flag was not a boolean, so whether the source dated it is unknown.');
    }
  }

  if (stampedBasis && ctx.priceSource === 'seller') {
    add(PACKET_CODES.PRICE_BASIS_NOT_SOURCE_OF_PRICE, SEVERITY.WARNING,
        'The price basis shown is market context. This price was set by the seller, '
      + 'not derived from that basis.');
  }

  if (feeScheduleVerified === null) {
    if (scheduleSupplied) {
      // The alarming one. A value arrived and this module could not read it,
      // which means the format on the other side moved.
      add(PACKET_CODES.FEE_SCHEDULE_DATE_UNPARSEABLE, SEVERITY.WARNING,
          'Fee-schedule audit date was supplied in a format this packet cannot read.');
    } else {
      add(PACKET_CODES.FEE_SCHEDULE_DATE_ABSENT, SEVERITY.WARNING,
          'No fee-schedule audit date recorded for this packet.');
    }
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
    priceBasis: stampedBasis,
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
