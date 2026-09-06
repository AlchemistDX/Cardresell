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

/** Retained after delete so a later read can prove non-active rather than absent. */
export const TOMBSTONE_TTL_SEC = 90 * 24 * 60 * 60;

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
  REV_REQUIRED:     'DRAFT_REVISION_REQUIRED',
  NOT_EDITABLE:     'DRAFT_NOT_EDITABLE',
  SCHEMA_TOO_NEW:   'DRAFT_SCHEMA_TOO_NEW',
  UNREADABLE:       'DRAFT_RECORD_UNREADABLE',
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
  return { ok: true, draft: d };
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
    title:      requireString(input.title, 'title', { max: 80 }),
    price:      requireMoney(input.price, 'price', { allowNull: false }),
    quantity:   Number.isInteger(input.quantity) && input.quantity > 0 ? input.quantity : 1,
    createdAt:  now,
    updatedAt:  now,
    // Provenance for the crash window: which idempotent operation made this.
    createdByOperation: input.createdByOperation || null,
  };
  if (input.notes !== undefined) draft.notes = requireString(input.notes, 'notes', { max: 4000, allowEmpty: true });
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
  if (patch.title !== undefined)    next.title    = requireString(patch.title, 'title', { max: 80 });
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
  if (current.status === DRAFT_STATUS.DELETED) return current;   // idempotent
  const expected = opts.expectedRev;
  if (expected !== undefined && expected !== null && expected !== current.rev) {
    throw new Error(ERR.REV_CONFLICT);
  }
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

export const CLAIM_TTL_SEC = 10 * 60;

/**
 * @param kv async (cmd, ...args) => value   — thin Upstash command wrapper
 */
export async function claimRevision(kv, googleSub, draftId, rev, operationId) {
  const key = revisionClaimKey(googleSub, draftId, rev);
  const op  = operationId || 'anon';
  let res;
  try {
    res = await kv('set', key, op, 'NX', 'EX', CLAIM_TTL_SEC);
  } catch {
    // Fail closed. An unclaimable revision must not be written optimistically:
    // that is exactly the lost update this mechanism exists to prevent.
    return { claimed: false, error: ERR.STORE_UNAVAILABLE, retryable: true };
  }
  if (res === 'OK' || res === true) return { claimed: true, mine: true };

  // Someone holds it. If it is our own operation retrying, it is ours.
  let holder = null;
  try { holder = await kv('get', key); } catch { holder = null; }
  if (holder && operationId && String(holder) === String(operationId)) {
    return { claimed: true, mine: true, replayedClaim: true };
  }
  // A FAILED read of the holder is not evidence that it is not ours, so this
  // is a refusal, not a takeover.
  return { claimed: false, error: ERR.REV_CONFLICT, retryable: false, holder: holder ? true : null };
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
  const claim = await claimRevision(kv, googleSub, draft.draftId, draft.rev, operationId);
  if (!claim.claimed) return { ok: false, ...claim };
  try {
    await kv('set', draftKey(googleSub, draft.draftId), JSON.stringify(draft));
  } catch {
    return { ok: false, error: ERR.STORE_UNAVAILABLE, retryable: true, claimHeld: true };
  }
  return { ok: true, draft, replayedClaim: !!claim.replayedClaim };
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
  const claim = await claimRevision(kv, googleSub, draftId, stone.rev, operationId);
  if (!claim.claimed) return { ok: false, ...claim };
  try {
    await kv('set', draftKey(googleSub, draftId), JSON.stringify(stone));
    await kv('expire', draftKey(googleSub, draftId), TOMBSTONE_TTL_SEC);
  } catch {
    return { ok: false, error: ERR.STORE_UNAVAILABLE, retryable: true };
  }
  return { ok: true, draft: stone, deleted: true };
}
