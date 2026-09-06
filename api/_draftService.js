// api/_draftService.js — C1 wiring: the four draft operations, composed.
//
// This module contains no new concurrency or idempotency design. It composes
// three finished pieces in the one order that keeps their guarantees:
//
//   _idempotency.js   one intended mutation happens at most once
//   _draftStore.js    the authoritative record, revisions, tombstones
//   _draftIndex.js    rebuildable secondary indexes
//
// The ordering rules that matter, all settled in earlier review rounds:
//
//   1. The AUTHORITATIVE RECORD is written before any index. An index entry
//      pointing at a record that does not exist is a phantom; a record missing
//      from an index is merely slow to find. Only one of those is recoverable
//      by reconciliation.
//
//   2. INDEX FAILURE NEVER REWRITES THE MEANING OF THE OPERATION. A saved
//      draft with a failed index write is `saved: true, degraded: true`, never
//      "create failed". Telling a seller their draft was not saved when it was
//      is worse than telling them it may take a moment to appear: the first
//      makes them redo work, the second makes them wait.
//
//   3. The IDEMPOTENT UNIT IS THE WHOLE CREATE, INCLUDING MINTING THE draftId.
//      If the id were minted outside runOnce, a lost response would produce a
//      second draft with a different id on retry — which is exactly the
//      duplicate that idempotency exists to prevent.
//
//   4. Every mutating operation's operation id is DERIVED FROM THE CALLER'S
//      IDEMPOTENCY KEY, never minted per HTTP attempt. See OPERATION_ID_SOURCE
//      in _draftStore.js.

import {
  ERR as STORE_ERR,
  DRAFT_STATUS,
  buildDraft,
  applyEdit,
  tombstone,
  getDraft,
  putDraft,
  newDraftId,
  validateDraftForSlot,
} from './_draftStore.js';

import {
  runOnce,
  SCOPES,
  selectMutation,
} from './_idempotency.js';

import {
  indexDraft,
  unindexDraft,
  listDraftIds,
  draftIdForSku,
} from './_draftIndex.js';

export const SERVICE_ERR = {
  ...STORE_ERR,
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  SLOT_INVALID: 'DRAFT_SLOT_INVALID',
};

/**
 * The operation id handed to the store's revision claims.
 *
 * Derived, not generated. The whole "this is my own retry" mechanism depends on
 * this value being identical across HTTP attempts of the same intended
 * mutation, and only the client knows when two attempts are the same intent.
 */
export function operationIdFor(scope, idempotencyKey) {
  if (!idempotencyKey || !String(idempotencyKey).trim()) {
    throw new Error(SERVICE_ERR.IDEMPOTENCY_KEY_REQUIRED);
  }
  return `${scope}:${String(idempotencyKey).trim().toLowerCase()}`;
}

/**
 * Attach a draft to its indexes.
 *
 * Returns index state; NEVER throws in a way that could be mistaken for the
 * save failing. `indexDraft` already reports per-step degradation, so this is
 * mostly about making a thrown transport error look like the same shape.
 */
async function attachIndexes(googleSub, draft) {
  try {
    const r = await indexDraft(googleSub, draft.sku, draft.draftId);
    return {
      indexed: !!r.ok,
      degraded: !!r.degraded,
      repairRequired: !!r.repairRequired,
      skuPointerLost: !!r.skuPointerLost,
      failed: r.failed || [],
      recovery: r.recovery || null,
    };
  } catch (e) {
    return {
      indexed: false,
      degraded: true,
      repairRequired: true,
      skuPointerLost: true,
      failed: [{ step: 'indexDraft', error: String((e && e.message) || e) }],
      recovery: 'reconcileDraftIndex',
    };
  }
}

/**
 * Detach a draft from its indexes.
 *
 * Same asymmetry, pointing the other way: the tombstone is the authoritative
 * statement that the draft is gone, and a stale index entry is prunable by
 * reconciliation because a tombstone is positive evidence of non-active. So a
 * failed unindex degrades the response and never fails the delete.
 */
async function detachIndexes(googleSub, draft) {
  try {
    await unindexDraft(googleSub, draft.sku, draft.draftId);
    return { unindexed: true, degraded: false, repairRequired: false, failed: [] };
  } catch (e) {
    return {
      unindexed: false,
      degraded: true,
      repairRequired: true,
      failed: [{ step: 'unindexDraft', error: String((e && e.message) || e) }],
      recovery: 'reconcileDraftIndex',
    };
  }
}

/**
 * CREATE — idempotent across the whole operation.
 *
 * `input` must already be normalized by the endpoint. The mutation fingerprint
 * is taken from the declared mutation fields only, so a cosmetic field cannot
 * make a genuine retry look like a new create, and a meaningful field cannot
 * quietly stop counting.
 */
export async function createDraft(kv, googleSub, input, idempotencyKey) {
  const scope = SCOPES.DRAFT_CREATE;
  const operationId = operationIdFor(scope, idempotencyKey);
  const request = selectMutation(scope, input);

  return runOnce(kv, googleSub, scope, idempotencyKey, async () => {
    // The id is minted INSIDE the protected operation. A retry after a lost
    // response replays this result rather than reaching this line again.
    const draft = buildDraft({ ...input, draftId: newDraftId(), rev: 1 });

    const written = await putDraft(kv, googleSub, draft, operationId);
    if (!written.ok) {
      // A failed authoritative write is a real failure. Nothing is indexed,
      // because nothing exists to index.
      const err = new Error(written.error);
      err.detail = written;
      throw err;
    }

    const index = await attachIndexes(googleSub, written.draft);

    // `draftId` is at the TOP LEVEL deliberately: recordDone reads the resource
    // identity from there to write the pointer, and the pointer is what makes a
    // crashed create recoverable rather than duplicated.
    return {
      draftId: written.draft.draftId,
      saved: true,
      draft: written.draft,
      // Rule 2: index trouble is reported alongside a successful save.
      degraded: index.degraded,
      repairRequired: index.repairRequired,
      index,
      // Publish-readiness is informational at create time. A draft is allowed
      // to be saved incomplete; it is not allowed to be published incomplete.
      publishable: validateDraftForSlot(written.draft),
    };
  }, {
    // The fingerprint is derived by runOnce from `request`, which is the
    // VALIDATED CANONICAL MUTATION — not the raw body. Order is
    // parse -> validate -> normalize -> select mutation fields -> fingerprint.
    request,
    /**
     * Crash reconciliation: the pointer survived but the result record did not.
     * Read the authoritative record back and rebuild the same answer, rather
     * than reporting a failure for a create that succeeded.
     *
     * The pointer is the second argument, and it carries the resourceId. The
     * op key alone cannot name the draft — the draftId was minted inside the
     * protected operation, so the pointer is the only surviving link to it.
     */
    reconcile: async (_opKey, pointer) => {
      const resourceId = pointer && pointer.resourceId;
      if (!resourceId) return null;
      const cur = await getDraft(kv, googleSub, resourceId);
      if (!cur.ok) return null;
      return {
        draftId: cur.draft.draftId,
        saved: true,
        draft: cur.draft,
        reconciled: true,
        // Indexing state cannot be proven after a crash, so it is asserted as
        // unknown-and-repairable rather than assumed clean.
        degraded: true,
        repairRequired: true,
        index: { indexed: null, degraded: true, repairRequired: true, recovery: 'reconcileDraftIndex' },
        publishable: validateDraftForSlot(cur.draft),
      };
    },
  });
}

/** READ — authoritative record only. Indexes are never consulted for truth. */
export async function readDraft(kv, googleSub, draftId) {
  const cur = await getDraft(kv, googleSub, draftId);
  if (!cur.ok) return cur;
  return { ok: true, draft: cur.draft, publishable: validateDraftForSlot(cur.draft) };
}

/**
 * UPDATE — expected revision → claim → authoritative guard → write.
 *
 * Not idempotency-keyed: the expected revision already makes a replayed edit
 * either a no-op replay (own claim, already committed) or a conflict. The
 * revision IS the concurrency token here.
 */
export async function updateDraft(kv, googleSub, draftId, patch, expectedRev, idempotencyKey) {
  const operationId = operationIdFor('draft-update', idempotencyKey);

  const cur = await getDraft(kv, googleSub, draftId);
  if (!cur.ok) return cur;

  let next;
  try {
    next = applyEdit(cur.draft, patch, { expectedRev });
  } catch (e) {
    return { ok: false, error: e.message, current: cur.draft };
  }

  const written = await putDraft(kv, googleSub, next, operationId);
  if (!written.ok) return written;

  return {
    ok: true,
    draft: written.draft,
    replayed: !!written.replayedWrite,
    // An edit does not change draftId or sku, so no index write is required.
    // Re-indexing on every edit would multiply the failure surface for no gain.
    publishable: validateDraftForSlot(written.draft),
  };
}

/**
 * DELETE — expected revision → same guarded write path → tombstone → index
 * cleanup, in that order.
 */
export async function deleteDraftOp(kv, googleSub, draftId, expectedRev, idempotencyKey) {
  const operationId = operationIdFor('draft-delete', idempotencyKey);

  const cur = await getDraft(kv, googleSub, draftId);
  if (!cur.ok) {
    if (cur.error === STORE_ERR.DELETED) {
      // Already tombstoned. Idempotent success, and the index cleanup is
      // retried, because the previous attempt may be exactly what failed.
      const index = await detachIndexes(googleSub, cur.draft);
      return { ok: true, deleted: true, alreadyDeleted: true, draft: cur.draft, index,
               degraded: index.degraded, repairRequired: index.repairRequired };
    }
    return cur;
  }

  let stone;
  try {
    stone = tombstone(cur.draft, { expectedRev });
  } catch (e) {
    return { ok: false, error: e.message, current: cur.draft };
  }

  const written = await putDraft(kv, googleSub, stone, operationId);
  if (!written.ok) {
    // The record still stands. Indexes are deliberately untouched: unindexing a
    // draft that was NOT tombstoned would hide a live draft from its owner.
    return written;
  }

  const index = await detachIndexes(googleSub, stone);
  return {
    ok: true,
    deleted: true,
    alreadyDeleted: false,
    draft: stone,
    index,
    degraded: index.degraded,
    repairRequired: index.repairRequired,
  };
}

/**
 * LIST — index-backed, with the reconciliation rules already built in
 * `listDraftIds` (failed read ≠ absence, scan omission ≠ absence).
 */
export async function listDrafts(googleSub, opts = {}) {
  // Always the detailed shape here. A caller at the HTTP boundary has to be
  // able to answer 503 rather than "no drafts", and it cannot do that from a
  // bare array.
  return listDraftIds(googleSub, { ...opts, detail: true });
}

export { draftIdForSku, DRAFT_STATUS };
