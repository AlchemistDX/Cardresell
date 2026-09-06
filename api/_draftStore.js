import { readStoredPacket, PACKET_COMPAT } from './_listingPacket.js';
// api/_draftStore.js
//
// C1 — authoritative persistence for listing drafts.
//
// A draft is the answer to "how do I intend to sell this inventory instance?"
// It is NOT product identity (that is the SKU) and NOT the owned copy (that is
// the inventory instance). Those three stay separate here.
//
// Storage layout
// ──────────────
//   draft:<sub>:<draftId>              the authoritative record
//   draftrev:<sub>:<draftId>:<rev>     revision claim (NX) — concurrency control
//   instancedrafts:<sub>:<instanceId>  SET of draftIds  (from _inventoryInstance)
//   drafts:<sub>                       SET of draftIds  (from _draftIndex)
//
// The authoritative record is the record. Every index is derived and may be
// rebuilt from a scan; none of them is ever treated as proof on its own.

import { randomBytes } from 'crypto';

export const DRAFT_SCHEMA_VERSION = 1;

/**
 * A namespace RESERVED for synthetic test records, and reserved by us.
 *
 * The live-store harness writes into production KV, so it needs an owner id it
 * can never share with a real seller. It used `ktest-<random>` and justified
 * the safety with "a real Google sub is all digits" — which is true today and
 * is not ours to guarantee. Firebase uids are alphanumeric, and an identifier
 * format we do not control is a poor foundation for the one property that
 * keeps a test from deleting a customer's drafts.
 *
 * So the reservation is inverted: this prefix belongs to tests because the
 * application refuses it at the door (see api/drafts.js), not because we
 * expect our identity providers never to emit it. The safety proof is now a
 * statement about our own code.
 */
export const SYNTHETIC_TEST_PREFIX = 'ktest-';

export function isSyntheticTestSub(sub) {
  return typeof sub === 'string' && sub.startsWith(SYNTHETIC_TEST_PREFIX);
}

/** Retained after delete so a later read can prove non-active rather than absent. */
export const TOMBSTONE_TTL_SEC = 90 * 24 * 60 * 60;

/**
 * A storage-layer sanity bound, NOT a venue rule. eBay's 80-character limit is
 * eBay's, and the storage model is deliberately multi-venue — baking 80 in here
 * would mean discovering an eBay constraint in the generic persistence layer
 * the day Mercari (or a venue with a longer limit) is added.
 * Venue limits live in SLOT_RULES / validateDraftForSlot below.
 */
/**
 * ── OPERATION ID STABILITY (a client-side contract the server must enforce) ──
 *
 * Every "this is my own retry" protection here depends on the operation id
 * being STABLE across network retries. If the client mints a fresh id per HTTP
 * attempt, the protection disappears at exactly the moment it is needed — when
 * a response was lost and the client retries.
 *
 * So the operation id is NOT generated server-side per request. It is derived
 * from the caller's Idempotency-Key, which the client is required to hold
 * constant for the lifetime of one intended mutation. A request with no
 * Idempotency-Key on a mutating draft route is refused rather than assigned a
 * random id, because a random id is indistinguishable from a new operation.
 */
export const OPERATION_ID_SOURCE = 'idempotency-key';

export const TITLE_HARD_MAX = 500;

export const DRAFT_STATUS = {
  DRAFT:     'draft',      // editable, nothing published
  PUBLISHING: 'publishing', // handed to a venue, outcome unknown
  PUBLISHED: 'published',  // live at a venue
  DELETED:   'deleted',    // tombstoned
};

/** Statuses a seller may still freely edit. */
export const EDITABLE_STATUSES = [DRAFT_STATUS.DRAFT];

export const ERR = {
  NOT_FOUND:        'DRAFT_NOT_FOUND',
  DELETED:          'DRAFT_DELETED',
  REV_CONFLICT:     'DRAFT_REVISION_CONFLICT',
  REV_IN_FLIGHT:    'DRAFT_REVISION_IN_FLIGHT',
  REV_REQUIRED:     'DRAFT_REVISION_REQUIRED',
  NOT_EDITABLE:     'DRAFT_NOT_EDITABLE',
  SCHEMA_TOO_NEW:   'DRAFT_SCHEMA_TOO_NEW',
  UNREADABLE:       'DRAFT_RECORD_UNREADABLE',
  NOT_DISCARDABLE: 'DRAFT_NOT_DISCARDABLE',
  STORE_UNAVAILABLE:'DRAFT_STORE_UNAVAILABLE',
  FIELD_INVALID:    'DRAFT_FIELD_INVALID',
};

export function draftKey(googleSub, draftId) {
  return `draft:${googleSub}:${draftId}`;
}

export function revisionClaimKey(googleSub, draftId, rev) {
  return `draftrev:${googleSub}:${draftId}:${rev}`;
}

export function newDraftId() {
  return `drf_${randomBytes(16).toString('hex')}`;
}

/**
 * Per-slot publish requirements. The draft may be SAVED without satisfying
 * these — a seller mid-edit should not be blocked from persisting work — but it
 * cannot be handed to that venue until it does. Save rules and publish rules
 * are different rules, and conflating them is how apps lose drafts.
 */
export const SLOT_RULES = {
  'ebay:fixed-price': { titleMax: 80, requiresPrice: true,  allowsZeroPrice: false },
  'ebay:auction':     { titleMax: 80, requiresPrice: true,  allowsZeroPrice: false },
  'mercari:fixed-price':  { titleMax: 40, requiresPrice: true, allowsZeroPrice: false },
  'whatnot:auction':      { titleMax: 80, requiresPrice: true, allowsZeroPrice: true },
  'tcgplayer:fixed-price':{ titleMax: 200, requiresPrice: true, allowsZeroPrice: false },
};

/**
 * ── Severity: what blocks a handoff, and what merely gets said ────────────
 *
 * A single ok/not-ok answer forces every finding to be fatal, and the
 * predictable result is that genuinely useful advice gets dropped because
 * nobody wants a warning to stop a sale. So findings are tiered:
 *
 *   ERROR   the venue will reject this, or we would be sending something
 *           we know to be wrong. Blocks handoff. Not overridable.
 *   WARNING worth the seller's attention; they may proceed anyway.
 *   INFO    context, not a defect.
 *
 * ONLY ERROR blocks. That is the whole contract, and it is asserted in tests
 * rather than left to each call site to remember.
 */
/**
 * How a draft's price came to be. `packet` is implied by a stored quote
 * snapshot; these name the cases where there is no snapshot.
 */
export const PRICE_SOURCE = {
  SELLER: 'seller',   // the seller typed it
  COMP:   'comp',     // derived from comparable sales at save time
  VENUE:  'venue',    // carried over from an existing listing
};
export const PRICE_SOURCES = Object.values(PRICE_SOURCE);

export const SEVERITY = { ERROR: 'error', WARNING: 'warning', INFO: 'info' };

/** Only ERROR blocks a handoff. Nothing else may. */
export function blocks(severity) {
  return severity === SEVERITY.ERROR;
}

export const VIOLATION = {
  TITLE_TOO_LONG:  'SLOT_TITLE_TOO_LONG',
  PRICE_REQUIRED:  'SLOT_PRICE_REQUIRED',
  ZERO_PRICE:      'SLOT_ZERO_PRICE_NOT_ALLOWED',
  UNKNOWN_SLOT:    'SLOT_RULES_UNKNOWN',
  NO_PROVENANCE:   'DRAFT_NO_PRICE_PROVENANCE',
  SELLER_PRICED:   'DRAFT_PRICE_SELLER_ENTERED',
};

/**
 * The severity of each finding, declared in one place.
 *
 * A code with no entry here is treated as ERROR. That default is deliberate:
 * a new check added without a severity decision should stop a handoff and get
 * noticed, not sail through as an unread warning.
 */
export const VIOLATION_SEVERITY = {
  [VIOLATION.TITLE_TOO_LONG]: SEVERITY.ERROR,
  [VIOLATION.PRICE_REQUIRED]: SEVERITY.ERROR,
  [VIOLATION.ZERO_PRICE]:     SEVERITY.ERROR,
  [VIOLATION.UNKNOWN_SLOT]:   SEVERITY.ERROR,
  // Informational: the draft is perfectly listable, we just cannot show the
  // seller where its price came from. Blocking on this would refuse to list a
  // draft whose price the seller typed themselves.
  // ── Two different states, deliberately not one finding ─────────────────
  //
  // These started as a single INFO on "no saved quote", which quietly taught
  // the model that provenance means "came from our pricing engine". A price
  // the seller typed HAS provenance: the seller. It is a complete, defensible
  // answer to "where did this number come from", and the North Star commits
  // to every number being able to answer that.
  //
  // What is NOT fine is a persisted price whose origin nobody can name. That
  // is a data-quality defect, not a neutral fact, so it earns a WARNING — the
  // seller may still list, but the system stops pretending it knows something
  // it does not.
  [VIOLATION.SELLER_PRICED]:  SEVERITY.INFO,
  [VIOLATION.NO_PROVENANCE]:  SEVERITY.WARNING,
};

export function severityOf(code) {
  return VIOLATION_SEVERITY[code] || SEVERITY.ERROR;
}

/**
 * Seller-facing text for each finding.
 *
 * These live next to the codes rather than in the UI because the reason a
 * handoff was refused has to survive being read in a log, a test failure and
 * a support message — not only in the one screen that happened to render it.
 * `detail` stays machine-readable; this is the sentence.
 */
export function reasonMessage(code, ctx = {}) {
  switch (code) {
    case VIOLATION.TITLE_TOO_LONG:
      return `Title is ${ctx.length} characters; ${ctx.venue || 'this marketplace'} allows ${ctx.max}. Shorten it by ${Math.max(1, (ctx.length || 0) - (ctx.max || 0))}.`;
    case VIOLATION.PRICE_REQUIRED:
      return 'This listing needs a price before it can be sent.';
    case VIOLATION.ZERO_PRICE:
      return `A price of zero is not allowed for ${ctx.venue || 'this listing type'}.`;
    case VIOLATION.UNKNOWN_SLOT:
      return `CardResell does not know how to list to "${ctx.slot}" yet.`;
    case VIOLATION.SELLER_PRICED:
      return 'You set this price yourself.';
    case VIOLATION.NO_PROVENANCE:
      return 'This price has no saved quote attached, so the listing will not show where it came from.';
    default:
      return 'This draft cannot be listed yet.';
  }
}

/** The venue name in a slot key, for messages. `ebay:fixed-price` → `eBay`. */
const VENUE_LABEL = { ebay: 'eBay', mercari: 'Mercari', whatnot: 'Whatnot', tcgplayer: 'TCGplayer' };
function venueOf(slot) {
  const head = String(slot || '').split(':')[0];
  return VENUE_LABEL[head] || head || null;
}

/**
 * @returns {{
 *   ok: boolean, violations: Array<{code,field,detail,severity,blocking,message}>,
 *   blocking: Array<object>, errors: number, warnings: number, infos: number
 * }}
 *
 * `ok` means NO ERROR-severity finding — not "no findings at all". A draft
 * with three warnings and no errors is publishable, and saying otherwise would
 * make the warning tier pointless.
 */
export function validateDraftForSlot(draft, slot = draft && draft.slot) {
  const v = [];
  const venue = venueOf(slot);
  const push = (code, field, detail, ctx) => {
    const severity = severityOf(code);
    v.push({
      code, field, detail, severity,
      blocking: blocks(severity),
      message: reasonMessage(code, { venue, slot, ...ctx }),
    });
  };

  const rules = SLOT_RULES[slot];
  if (!rules) {
    push(VIOLATION.UNKNOWN_SLOT, 'slot', String(slot), { slot });
    return finish(v);
  }

  const title = (draft && draft.title) || '';
  if (title.length > rules.titleMax) {
    push(VIOLATION.TITLE_TOO_LONG, 'title', `${title.length} > ${rules.titleMax}`,
         { length: title.length, max: rules.titleMax });
  }
  const price = draft ? draft.price : undefined;
  if (rules.requiresPrice && (price === null || price === undefined)) {
    push(VIOLATION.PRICE_REQUIRED, 'price', 'missing');
  }
  if (!rules.allowsZeroPrice && price === 0) {
    push(VIOLATION.ZERO_PRICE, 'price', '0');
  }
  // Provenance is only a question once there IS a price.
  //
  // An unpriced draft used to collect NO_PROVENANCE ('unknown') on top of its
  // blocking PRICE_REQUIRED — two findings about one fact, and the second one
  // incoherent: there is no number, so nothing is claiming an origin it cannot
  // support. The review screen would have told the seller "add your price" and
  // "we cannot say where this price came from" about the same empty field.
  //
  // A missing price is an incomplete draft, which is an expected state for a
  // card with no available comp. It is not a data-quality defect. Absence is
  // represented by null/undefined, never by 0 — a zero price is a real number
  // that eBay refuses, and the slot rules refuse it as ZERO_PRICE rather than
  // mistaking it for absence.
  const hasPrice = draft && draft.price !== null && draft.price !== undefined;
  if (hasPrice && !Object.prototype.hasOwnProperty.call(draft, 'packet')) {
    if (draft.priceSource === PRICE_SOURCE.SELLER) {
      push(VIOLATION.SELLER_PRICED, 'price', PRICE_SOURCE.SELLER);
    } else {
      push(VIOLATION.NO_PROVENANCE, 'price', draft.priceSource || 'unknown');
    }
  }

  return finish(v);
}

function finish(v) {
  const blocking = v.filter((x) => x.blocking);
  return {
    // Publish-readiness. Warnings and info do not gate it.
    ok: blocking.length === 0,
    violations: v,
    blocking,
    errors:   v.filter((x) => x.severity === SEVERITY.ERROR).length,
    warnings: v.filter((x) => x.severity === SEVERITY.WARNING).length,
    infos:    v.filter((x) => x.severity === SEVERITY.INFO).length,
  };
}

// ── The WARNING tier is implemented but has no rules yet, on purpose ──────
//
// The obvious candidate is "this price came from a quote that is now stale",
// and it needs a threshold — how many hours before a saved quote stops being
// trustworthy. That is a product decision about real market behaviour, not a
// number to pick because the tier looked empty. The mechanism is here and
// tested; the first rule gets added when the threshold is decided.

// ── Reading ────────────────────────────────────────────────────────────────

/**
 * Interpret a stored record.
 *
 * A record written by a NEWER schema version is refused rather than
 * best-effort parsed. Reading it with old field semantics and then writing it
 * back would silently downgrade a seller's data — the failure mode where a
 * rollback quietly destroys fields the new version added. Refusing is
 * recoverable; a lossy write-back is not.
 */
export function readStoredDraft(stored) {
  if (stored === null || stored === undefined) {
    return { ok: false, error: ERR.NOT_FOUND, evidence: 'absent' };
  }
  let d = stored;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch { return { ok: false, error: ERR.UNREADABLE, evidence: 'unparseable' }; }
  }
  if (!d || typeof d !== 'object') {
    return { ok: false, error: ERR.UNREADABLE, evidence: 'not-an-object' };
  }
  const v = Number(d.schemaVersion);
  if (!Number.isInteger(v) || v < 1) {
    return { ok: false, error: ERR.UNREADABLE, evidence: 'no-schema-version' };
  }
  if (v > DRAFT_SCHEMA_VERSION) {
    return {
      ok: false, error: ERR.SCHEMA_TOO_NEW, evidence: `v${v}`,
      // Deliberately still surfaced: the caller may show "this draft was
      // edited by a newer version of CardResell" instead of "not found".
      exists: true, deleted: d.status === DRAFT_STATUS.DELETED,
    };
  }
  if (d.status === DRAFT_STATUS.DELETED) {
    // A tombstone is POSITIVE evidence of non-active, which is exactly what
    // index reconciliation is allowed to prune on. Absence is not.
    return { ok: false, error: ERR.DELETED, evidence: 'tombstone', exists: true, deleted: true, draft: d };
  }
  const result = { ok: true, draft: d };

  // ── A persisted packet is a SNAPSHOT, never the authority ────────────────
  //
  // The packet a seller saw when they drafted is worth keeping — it is the
  // provenance of the price they agreed to. But it is derived data: comps
  // move, fees change, and a packet written three weeks ago may no longer
  // describe reality.
  //
  // So the rule here is asymmetric on purpose:
  //   the DRAFT is authoritative and always readable;
  //   the PACKET is advisory and may be refused without taking the draft
  //   down with it.
  //
  // A packet written by a newer deploy, or one with no migration path, makes
  // `packetUsable:false` — the caller must recompute rather than show stale
  // numbers, and must never present an unmigrated packet as current. What it
  // must NOT do is turn "I can't read this snapshot" into "your draft is
  // gone".
  if (d.packet !== undefined && d.packet !== null) {
    const read = readStoredPacket(d.packet);
    result.packet       = read.usable ? read.packet : null;
    result.packetStatus = read.status;
    result.packetUsable = read.usable;
    if (!read.usable) {
      result.packetReason = read.reason;
      // Preserved verbatim, never rewritten or dropped: the client that CAN
      // read it may be one deploy away.
      result.packetRaw = d.packet;
    }
    if (read.migrationsApplied && read.migrationsApplied.length) {
      result.packetMigrations = read.migrationsApplied;
    }
  }

  return result;
}

// ── Building ───────────────────────────────────────────────────────────────

function requireString(v, field, { max = 500, allowEmpty = false } = {}) {
  if (typeof v !== 'string') throw new Error(`${ERR.FIELD_INVALID}:${field}:not-a-string`);
  const t = v.trim();
  if (!allowEmpty && !t) throw new Error(`${ERR.FIELD_INVALID}:${field}:empty`);
  if (t.length > max) throw new Error(`${ERR.FIELD_INVALID}:${field}:too-long`);
  return t;
}

function requireMoney(v, field, { allowNull = true } = {}) {
  if (v === null || v === undefined) {
    if (allowNull) return null;
    throw new Error(`${ERR.FIELD_INVALID}:${field}:required`);
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`${ERR.FIELD_INVALID}:${field}:not-a-finite-number`);
  }
  if (v < 0) throw new Error(`${ERR.FIELD_INVALID}:${field}:negative`);
  // Stored to the cent. Sub-cent prices are a rounding bug upstream, and
  // persisting them makes every later fee calculation disagree by a fraction.
  const cents = Math.round(v * 100);
  if (Math.abs(v * 100 - cents) > 1e-9) throw new Error(`${ERR.FIELD_INVALID}:${field}:sub-cent`);
  return cents / 100;
}

/**
 * Build a NEW draft record at revision 1.
 *
 * `slot` must already be canonical (see draftSlot in _inventoryInstance.js) —
 * this does not normalize, so there is exactly one normalization implementation
 * in the codebase rather than two that drift.
 */
export function buildDraft(input = {}) {
  const now = Date.now();
  const draft = {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    draftId:    input.draftId || newDraftId(),
    instanceId: requireString(input.instanceId, 'instanceId', { max: 64 }),
    sku:        requireString(input.sku, 'sku', { max: 128 }),
    slot:       requireString(input.slot, 'slot', { max: 64 }),
    status:     DRAFT_STATUS.DRAFT,
    rev:        1,
    title:      requireString(input.title, 'title', { max: TITLE_HARD_MAX }),
    // allowNull: a draft may exist before it has a price. Sell eligibility is
    // an identity question — we know WHICH card this is — so a card with no
    // available comp still gets a draft, and validateForSlot raises a blocking
    // PRICE_REQUIRED until the seller sets one on the review screen. That
    // validator already handled a null price; only this line was stricter than
    // the layer beneath it, which meant the entry point had to refuse the
    // create and strand exactly the cards that most need help.
    price:      requireMoney(input.price, 'price', { allowNull: true }),
    quantity:   Number.isInteger(input.quantity) && input.quantity > 0 ? input.quantity : 1,
    createdAt:  now,
    updatedAt:  now,
    // Provenance for the crash window: which idempotent operation made this.
    createdByOperation: input.createdByOperation || null,
  };
  if (input.notes !== undefined) draft.notes = requireString(input.notes, 'notes', { max: 4000, allowEmpty: true });
  // Optional provenance snapshot. Stored verbatim with whatever version it
  // declares — stamping our own version onto someone else's packet would
  // destroy the one fact that makes it safe to read later.
  // Where the price came from. A missing value is NOT defaulted to 'seller':
  // guessing provenance is exactly the failure the WARNING above exists to
  // surface, and a default would silence it on every draft.
  if (input.priceSource !== undefined && input.priceSource !== null) {
    if (!PRICE_SOURCES.includes(input.priceSource)) {
      throw new Error(`${ERR.FIELD_INVALID}:priceSource:unrecognised`);
    }
    draft.priceSource = input.priceSource;
  }
  if (input.packet !== undefined && input.packet !== null) {
    if (typeof input.packet !== 'object' || Array.isArray(input.packet)) {
      throw new Error(`${ERR.FIELD_INVALID}:packet:not-an-object`);
    }
    draft.packet = input.packet;
  }
  return draft;
}

/**
 * Apply an edit, returning the NEXT revision. Pure — persistence is separate,
 * so the conflict rules are testable without a store.
 */
export function applyEdit(current, patch = {}, opts = {}) {
  if (!current || typeof current !== 'object') throw new Error(ERR.NOT_FOUND);
  if (current.status === DRAFT_STATUS.DELETED) throw new Error(ERR.DELETED);
  if (!EDITABLE_STATUSES.includes(current.status)) throw new Error(ERR.NOT_EDITABLE);

  // The client must state which revision it edited. Without it, a seller
  // editing a stale copy silently overwrites an edit they never saw — the
  // classic lost update, and here it would be a wrong live price.
  const expected = opts.expectedRev;
  if (expected === undefined || expected === null) throw new Error(ERR.REV_REQUIRED);
  if (!Number.isInteger(expected)) throw new Error(`${ERR.FIELD_INVALID}:expectedRev:not-an-integer`);
  if (expected !== current.rev) throw new Error(ERR.REV_CONFLICT);

  const next = { ...current };
  if (patch.title !== undefined)    next.title    = requireString(patch.title, 'title', { max: TITLE_HARD_MAX });
  if (patch.price !== undefined)    next.price    = requireMoney(patch.price, 'price', { allowNull: false });
  if (patch.notes !== undefined)    next.notes    = requireString(patch.notes, 'notes', { max: 4000, allowEmpty: true });
  if (patch.quantity !== undefined) {
    if (!Number.isInteger(patch.quantity) || patch.quantity < 1) {
      throw new Error(`${ERR.FIELD_INVALID}:quantity:not-a-positive-integer`);
    }
    next.quantity = patch.quantity;
  }
  // Identity fields are NOT patchable. Changing the instance a draft belongs to
  // would move a listing to a different physical card while keeping its slot,
  // history and revision chain. That is a delete plus a create, not an edit.
  for (const frozen of ['draftId', 'instanceId', 'sku', 'slot', 'schemaVersion', 'createdAt']) {
    if (patch[frozen] !== undefined && patch[frozen] !== current[frozen]) {
      throw new Error(`${ERR.FIELD_INVALID}:${frozen}:immutable`);
    }
  }
  next.rev = current.rev + 1;
  next.updatedAt = Date.now();
  return next;
}

/** Turn a draft into a tombstone. Retained, not erased. */
export function tombstone(current, opts = {}) {
  if (!current || typeof current !== 'object') throw new Error(ERR.NOT_FOUND);

  // Deleting an ALREADY-deleted draft is idempotent regardless of revision.
  // The seller's intent is already satisfied and there is no unseen work left
  // to destroy, so a stale expectedRev here is harmless.
  if (current.status === DRAFT_STATUS.DELETED) return current;

  // Deletion is destructive, so it gets the SAME concurrency requirement as an
  // edit. Phone opens rev 4; desktop edits price to rev 5; phone taps Delete
  // still holding rev 4. Without this the phone destroys a version the seller
  // never saw.
  const expected = opts.expectedRev;
  if (expected === undefined || expected === null) throw new Error(ERR.REV_REQUIRED);
  if (!Number.isInteger(expected)) throw new Error(`${ERR.FIELD_INVALID}:expectedRev:not-an-integer`);
  if (expected !== current.rev) throw new Error(ERR.REV_CONFLICT);
  return {
    schemaVersion: current.schemaVersion,
    draftId:    current.draftId,
    instanceId: current.instanceId,
    sku:        current.sku,
    slot:       current.slot,
    status:     DRAFT_STATUS.DELETED,
    rev:        current.rev + 1,
    createdAt:  current.createdAt,
    deletedAt:  Date.now(),
    // Everything else is dropped on purpose: a tombstone exists to prove
    // non-active, not to be a backup of the seller's content.
  };
}

// ── Persistence ────────────────────────────────────────────────────────────
//
// Upstash REST has no compare-and-set. Read-then-write is a lost update: two
// concurrent edits both read rev 3, both write rev 4, one silently disappears.
//
// So a revision is CLAIMED before it is written, using SET NX, which is atomic:
//
//   SET draftrev:<sub>:<id>:<rev> <op> NX   ->  'OK' means the claim is mine
//                                              null means someone else has it
//
// Only the claim winner writes the record. The loser gets a conflict and
// re-reads, which is the honest outcome — the seller is shown the edit they
// did not have rather than having theirs vanish.
//
// The claim is also the idempotency anchor for a retry: re-claiming the SAME
// revision with the SAME operation id is recognised as this caller's own
// earlier attempt, so a retry after a lost response completes instead of
// dead-locking against its own claim.

/**
 * ── Claim keys are PROTOCOL STATE, not cache ──────────────────────────────
 *
 * Contract, stated explicitly because correctness now depends on it:
 *
 *  - A claim is created with SET NX and a TTL. It is a LEASE, not a lock held
 *    forever.
 *  - A claim proves only that one writer owns the ATTEMPT at a revision. It
 *    never proves the revision committed.
 *  - Claims are allowed to expire, and are allowed to be wiped entirely (an
 *    ops action, a flushed Redis, an eviction). Losing all claim keys must
 *    degrade concurrency detection, never correctness.
 *
 * Which forces the load-bearing invariant:
 *
 *    CLAIM OWNERSHIP IS NECESSARY TO ADVANCE A REVISION.
 *    IT IS NEVER SUFFICIENT IF THE AUTHORITATIVE RECORD IS NOT EXACTLY THE
 *    EXPECTED PREDECESSOR.
 *
 * So every write re-checks the authoritative record immediately before writing.
 * A stale client at rev 3 cannot write rev 4 just because a claim key vanished
 * while the record already moved to rev 5.
 */
export const CLAIM_TTL_SEC = 10 * 60;

/**
 * How long a claim is presumed genuinely in flight. Inside this window an
 * orphan is indistinguishable from a slow writer, so we refuse but mark the
 * refusal RETRYABLE rather than declaring a conflict that is not one.
 */
export const CLAIM_GRACE_MS = 30 * 1000;

export function takeoverKey(googleSub, draftId, rev) {
  return `drafttake:${googleSub}:${draftId}:${rev}`;
}

export const CLAIM_OUTCOME = {
  MINE:        'mine',          // fresh claim
  OWN_RETRY:   'own-retry',     // same operation retrying
  COMMITTED:   'committed',     // that revision already landed — real conflict
  IN_FLIGHT:   'in-flight',     // someone else, recently — retryable
  ORPHAN_TAKEN:'orphan-taken',  // stale claim, never committed, taken over
  ORPHAN_LOST: 'orphan-lost',   // another writer won the takeover race
  UNAVAILABLE: 'unavailable',
};

/**
 * Claim age is decided by a SERVER-generated timestamp only.
 *
 * If a client could supply the claim's `at`, clock skew or a hostile client
 * could make a brand-new claim look stale (inviting an immediate takeover of a
 * live writer) or an abandoned claim look young (blocking recovery for as long
 * as it liked). The timestamp is stamped inside claimRevision from this
 * process's clock and is never read from request input.
 *
 * A claim value with a missing or non-numeric timestamp is treated as
 * MAXIMALLY OLD, not as young. That is the safe direction: it permits recovery
 * of a claim written by an older build, and the authoritative-predecessor guard
 * still prevents an incorrect write from following the takeover.
 */
function parseClaim(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v;
  try { const p = JSON.parse(v); return p && typeof p === 'object' ? p : { op: String(v), at: 0 }; }
  catch { return { op: String(v), at: 0 }; }
}

/**
 * Claim the right to attempt `rev`.
 *
 * The orphan case review raised is real: a writer can claim rev 4 and die
 * before writing, leaving the record at rev 3 and rev 4 permanently claimed by
 * nobody. Resolution is deterministic:
 *
 *   holder is me                       -> own retry, proceed
 *   record already at >= rev           -> it committed, genuine conflict
 *   record < rev, claim is young       -> may still be in flight, retryable
 *   record < rev, claim is stale       -> orphan; take over via an NX takeover
 *                                         key so only one taker wins
 *
 * @param readRev async () => number|null   current authoritative revision
 */
export async function claimRevision(kv, googleSub, draftId, rev, operationId, readRev) {
  const key = revisionClaimKey(googleSub, draftId, rev);
  const op  = operationId || 'anon';
  const payload = JSON.stringify({ op, at: Date.now() });

  let res;
  try {
    res = await kv('set', key, payload, 'NX', 'EX', CLAIM_TTL_SEC);
  } catch {
    // Fail closed. An unclaimable revision must never be written optimistically:
    // that is exactly the lost update this mechanism exists to prevent.
    return { claimed: false, outcome: CLAIM_OUTCOME.UNAVAILABLE, error: ERR.STORE_UNAVAILABLE, retryable: true };
  }
  if (res === 'OK' || res === true) return { claimed: true, outcome: CLAIM_OUTCOME.MINE };

  let holder = null;
  try { holder = parseClaim(await kv('get', key)); } catch { holder = null; }

  // A FAILED read of the holder is not evidence about who owns it.
  if (!holder) {
    return { claimed: false, outcome: CLAIM_OUTCOME.UNAVAILABLE, error: ERR.STORE_UNAVAILABLE, retryable: true };
  }
  if (operationId && String(holder.op) === String(operationId)) {
    return { claimed: true, outcome: CLAIM_OUTCOME.OWN_RETRY, replayedClaim: true };
  }

  // Did the claim actually commit? The authoritative record decides, not the claim.
  let currentRev = null;
  if (typeof readRev === 'function') {
    try { currentRev = await readRev(); } catch { currentRev = undefined; }
  }
  if (currentRev === undefined) {
    return { claimed: false, outcome: CLAIM_OUTCOME.UNAVAILABLE, error: ERR.STORE_UNAVAILABLE, retryable: true };
  }
  if (currentRev !== null && currentRev >= rev) {
    return { claimed: false, outcome: CLAIM_OUTCOME.COMMITTED, error: ERR.REV_CONFLICT, retryable: false };
  }

  const age = Date.now() - (Number(holder.at) || 0);
  if (age < CLAIM_GRACE_MS) {
    // Genuinely might still be running. Refusing is right; calling it a
    // conflict is not, because nothing has conflicted yet.
    return {
      claimed: false, outcome: CLAIM_OUTCOME.IN_FLIGHT,
      error: ERR.REV_IN_FLIGHT, retryable: true, retryAfterMs: CLAIM_GRACE_MS - age,
    };
  }

  // Orphan. Exactly one taker may win, so the takeover is itself an NX claim.
  let took;
  try { took = await kv('set', takeoverKey(googleSub, draftId, rev), op, 'NX', 'EX', CLAIM_TTL_SEC); }
  catch { return { claimed: false, outcome: CLAIM_OUTCOME.UNAVAILABLE, error: ERR.STORE_UNAVAILABLE, retryable: true }; }
  if (took !== 'OK' && took !== true) {
    return { claimed: false, outcome: CLAIM_OUTCOME.ORPHAN_LOST, error: ERR.REV_CONFLICT, retryable: false };
  }
  try { await kv('set', key, payload); } catch { /* the takeover key is what matters */ }
  return { claimed: true, outcome: CLAIM_OUTCOME.ORPHAN_TAKEN, tookOverFrom: holder.op };
}

/** Read the authoritative record. Distinguishes absent / tombstoned / unreadable. */
export async function getDraft(kv, googleSub, draftId) {
  let raw;
  try {
    raw = await kv('get', draftKey(googleSub, draftId));
  } catch {
    // Never report "not found" on a failed read. Downstream, absence is a
    // licence to prune an index entry or to create a duplicate.
    return { ok: false, error: ERR.STORE_UNAVAILABLE, evidence: 'read-failed', retryable: true };
  }
  return readStoredDraft(raw);
}

/**
 * Persist a draft at its own `rev`, claiming that revision first.
 * `operationId` makes the write retry-safe.
 */
export async function putDraft(kv, googleSub, draft, operationId) {
  const readRev = async () => {
    const cur = await getDraft(kv, googleSub, draft.draftId);
    if (cur.ok) return cur.draft.rev;
    if (cur.error === ERR.DELETED) return cur.draft.rev;
    if (cur.error === ERR.NOT_FOUND) return null;
    throw new Error(cur.error);
  };

  // A tombstone is checked BEFORE anything else. Refusing with "revision
  // conflict" would invite the client to re-read and retry at a higher
  // revision, which is precisely the resurrection we are preventing.
  const pre = await getDraft(kv, googleSub, draft.draftId);
  if (!pre.ok && pre.error === ERR.DELETED && draft.status !== DRAFT_STATUS.DELETED) {
    return { ok: false, error: ERR.DELETED, current: pre.draft, retryable: false };
  }

  const claim = await claimRevision(kv, googleSub, draft.draftId, draft.rev, operationId, readRev);
  if (!claim.claimed) {
    // Every refusal must arrive with the evidence that justifies it. A bare
    // "someone else changed this" is not actionable — the UI cannot show the
    // seller the edit they did not have, so it cannot offer them a choice. The
    // live-store race exposed this: the loser was refused correctly and told
    // nothing about what it lost to.
    //
    // The read is best-effort on purpose. Failing to fetch evidence must not
    // turn a correct refusal into an error.
    if (claim.error === ERR.REV_CONFLICT) {
      const fresh = await getDraft(kv, googleSub, draft.draftId);
      if (fresh.ok) return { ok: false, ...claim, current: fresh.draft, evidence: 'claim-committed' };
      if (fresh.error === ERR.DELETED && fresh.draft) {
        return { ok: false, ...claim, current: fresh.draft, evidence: 'deleted-while-writing' };
      }
    }
    return { ok: false, ...claim };
  }

  // My own claim, and the record is already AT that revision: this operation
  // already committed and lost the response. Replaying its own write as a
  // conflict would tell a successful caller it failed.
  if (claim.outcome === CLAIM_OUTCOME.OWN_RETRY) {
    const mine = await getDraft(kv, googleSub, draft.draftId);
    if (mine.ok && mine.draft.rev === draft.rev) {
      return { ok: true, draft: mine.draft, replayedClaim: true, replayedWrite: true,
               claimOutcome: claim.outcome };
    }
  }

  // ── The guard. Ownership is necessary, never sufficient. ────────────────
  // Re-read the authoritative record immediately before writing, so a lost or
  // manually cleared claim key cannot let a stale writer advance a revision.
  const cur = await getDraft(kv, googleSub, draft.draftId);
  if (!cur.ok) {
    if (cur.error === ERR.DELETED) {
      // No stale write may resurrect a tombstone. Deletion is a decision the
      // seller made; a slow client must not undo it by arriving late.
      return { ok: false, error: ERR.DELETED, current: cur.draft, retryable: false };
    }
    if (cur.error === ERR.NOT_FOUND) {
      if (draft.rev !== 1) {
        return { ok: false, error: ERR.REV_CONFLICT, evidence: 'record-absent', retryable: false };
      }
    } else {
      return { ok: false, error: cur.error, retryable: cur.retryable };
    }
  } else if (cur.draft.rev !== draft.rev - 1) {
    return { ok: false, error: ERR.REV_CONFLICT, current: cur.draft, evidence: `authoritative-rev-${cur.draft.rev}` };
  }

  try {
    await kv('set', draftKey(googleSub, draft.draftId), JSON.stringify(draft));
  } catch {
    return { ok: false, error: ERR.STORE_UNAVAILABLE, retryable: true, claimHeld: true };
  }
  return { ok: true, draft, replayedClaim: !!claim.replayedClaim, claimOutcome: claim.outcome };
}

/**
 * Read → edit → write, with the revision the client actually saw.
 * Returns the conflicting current record on conflict so the UI can show it.
 */
export async function editDraft(kv, googleSub, draftId, patch, expectedRev, operationId) {
  const read = await getDraft(kv, googleSub, draftId);
  if (!read.ok) return { ok: false, error: read.error, evidence: read.evidence, retryable: read.retryable };
  let next;
  try {
    next = applyEdit(read.draft, patch, { expectedRev });
  } catch (e) {
    const conflict = e.message === ERR.REV_CONFLICT;
    return { ok: false, error: e.message, current: conflict ? read.draft : undefined };
  }
  const written = await putDraft(kv, googleSub, next, operationId);
  if (!written.ok && written.error === ERR.REV_CONFLICT) {
    // Lost the claim race: another writer took this revision between our read
    // and our claim. Re-read so the caller reports the winning state.
    const fresh = await getDraft(kv, googleSub, draftId);
    return { ok: false, error: ERR.REV_CONFLICT, current: fresh.ok ? fresh.draft : undefined };
  }
  return written;
}

/** Soft-delete. The record stays as a tombstone; the indexes are the caller's job. */
export async function deleteDraft(kv, googleSub, draftId, expectedRev, operationId) {
  const read = await getDraft(kv, googleSub, draftId);
  if (!read.ok) {
    // Deleting an already-deleted draft succeeds. Delete is idempotent by
    // nature and a seller pressing delete twice is not an error.
    if (read.error === ERR.DELETED) return { ok: true, alreadyDeleted: true, draft: read.draft };
    return { ok: false, error: read.error, retryable: read.retryable };
  }
  let stone;
  try {
    stone = tombstone(read.draft, { expectedRev });
  } catch (e) {
    return { ok: false, error: e.message, current: read.draft };
  }
  // Route the tombstone write through putDraft so it inherits the claim, the
  // orphan rules and the authoritative-predecessor guard. A delete that skipped
  // those would be the one destructive path without them.
  const written = await putDraft(kv, googleSub, stone, operationId);
  if (!written.ok) {
    if (written.error === ERR.REV_CONFLICT) {
      const fresh = await getDraft(kv, googleSub, draftId);
      return { ok: false, error: ERR.REV_CONFLICT, current: fresh.ok ? fresh.draft : written.current };
    }
    return written;
  }
  try { await kv('expire', draftKey(googleSub, draftId), TOMBSTONE_TTL_SEC); } catch { /* retention only */ }
  return { ok: true, draft: stone, deleted: true, alreadyDeleted: false };
}

/**
 * ── Discard: the escape hatch for a row that cannot be read ───────────────
 *
 * The list deliberately shows rows it could not hydrate, because the index
 * saying a draft exists is not permission to render it as gone. That choice
 * creates an obligation: a row the seller can SEE must be a row the seller can
 * RESOLVE. Otherwise an unreadable draft is visible forever, counts against
 * the cap, and has no button that works — the worst outcome of the three.
 *
 * The normal delete cannot do this. It reads the record to check `expectedRev`
 * before tombstoning, and there is no revision to read in bytes that will not
 * parse.
 *
 * So discard skips the revision check — and is therefore restricted to
 * precisely the cases where no revision exists to protect:
 *
 *   UNREADABLE  the bytes do not parse, or carry no schema version. Nothing
 *               is being destroyed that anything could have read.
 *   NOT_FOUND   indexed but no record. Pure index cleanup.
 *
 * It REFUSES a healthy draft, because otherwise it is a way to delete someone
 * else's concurrent edit by calling the other endpoint. It also refuses
 * SCHEMA_TOO_NEW: that record is not damaged, it is newer than this deploy,
 * and destroying data a newer build understands because an older build cannot
 * read it is the single most destructive thing this module could do. The
 * seller's own newer client can delete it normally.
 */
export const DISCARDABLE = [ERR.UNREADABLE, ERR.NOT_FOUND];

export async function discardDraft(kv, googleSub, draftId, operationId) {
  let raw;
  try {
    raw = await kv('get', draftKey(googleSub, draftId));
  } catch {
    return { ok: false, error: ERR.STORE_UNAVAILABLE, evidence: 'read-failed', retryable: true };
  }

  const read = readStoredDraft(raw);

  if (read.ok) {
    return { ok: false, error: ERR.NOT_DISCARDABLE, evidence: 'readable', retryable: false };
  }
  if (read.error === ERR.DELETED) {
    // Already resolved. Idempotent, and reported as such so the caller does
    // not release a quota slot for a draft that never held one.
    return { ok: true, alreadyDeleted: true, discarded: false };
  }
  if (!DISCARDABLE.includes(read.error)) {
    return { ok: false, error: read.error, evidence: read.evidence, retryable: !!read.retryable };
  }

  // An index entry with no record behind it needs no tombstone: there is
  // nothing to suppress. Writing one would invent a deletion that never
  // happened and hold a key for 90 days to say so.
  if (read.error === ERR.NOT_FOUND) {
    return { ok: true, discarded: true, tombstoned: false, reason: ERR.NOT_FOUND };
  }

  // A tombstone IS written for unreadable bytes, because the corrupt record
  // is still sitting at that key. Without it the next read finds the same
  // garbage and the row returns to the list.
  const stone = {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    draftId,
    status:    DRAFT_STATUS.DELETED,
    rev:       1,
    deletedAt: Date.now(),
    // Recorded so a later investigation can tell a seller-initiated delete
    // from a record this system could not read and gave up on.
    discardedUnreadable: true,
    discardedByOperation: operationId || null,
  };

  try {
    await kv('set', draftKey(googleSub, draftId), JSON.stringify(stone), 'EX', String(TOMBSTONE_TTL_SEC));
  } catch {
    return { ok: false, error: ERR.STORE_UNAVAILABLE, evidence: 'tombstone-write-failed', retryable: true };
  }

  return { ok: true, discarded: true, tombstoned: true, draft: stone, reason: ERR.UNREADABLE };
}
