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
  deleteDraft,
  discardDraft,
  getDraft,
  putDraft,
  newDraftId,
  validateDraftForSlot,
  draftKey,
  readStoredDraft,
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
  countDrafts,
} from './_draftIndex.js';

import { reserveDraftSlot, releaseDraftSlot, DRAFT_CAP, QUOTA } from './_draftQuota.js';

export const SERVICE_ERR = {
  ...STORE_ERR,
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  SLOT_INVALID: 'DRAFT_SLOT_INVALID',
  DRAFT_CAP_REACHED: 'DRAFT_CAP_REACHED',
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
/**
 * ── The per-seller draft cap ──────────────────────────────────────────────
 *
 * Why a cap exists at all: the draft index is a single set per seller, read
 * whole on every list. Without a ceiling, a seller who bulk-scans a box and
 * abandons the drafts makes their own list screen slower every day, and the
 * cost lands on them rather than on whoever wrote the loop.
 *
 * It is deliberately generous. This is a guardrail against unbounded growth,
 * not a paywall, and Phase 4's bulk flow will need room to work.
 *
 * ── Why the check is a reservation and not a count ───────────────────────
 *
 * The first implementation read the count and compared it. That is not a
 * ceiling. Two requests at 499 both read 499, both pass, both create; twenty
 * concurrent requests took a 500-cap seller to 519 in a test that is now
 * permanent. The comparison has to happen on a number no other caller can
 * also have received, which is what an atomic reservation gives.
 *
 * The mechanism lives in `_draftQuota.js` and this module does not
 * second-guess it: one business behaviour, one implementation.
 */
export { DRAFT_CAP };

export async function createDraft(kv, googleSub, input, idempotencyKey) {
  const scope = SCOPES.DRAFT_CREATE;
  const operationId = operationIdFor(scope, idempotencyKey);
  const request = selectMutation(scope, input);

  return runOnce(kv, googleSub, scope, idempotencyKey, async () => {
    // ── The cap is checked HERE, inside the protected operation ───────────
    //
    // Placement is the whole correctness argument. A retry of a create that
    // already succeeded replays the recorded result without ever entering
    // this body, so a seller sitting exactly at the cap can still recover a
    // lost response for the draft they already have. Checking the cap at the
    // HTTP boundary instead would turn a network retry into a refusal for
    // work that was already done — the exact failure idempotency exists to
    // prevent, reintroduced by a quota check.
    // Atomic: INCR hands every caller a different number, so exactly
    // DRAFT_CAP callers can ever receive one at or below the cap.
    const cap = await reserveDraftSlot(googleSub);
    if (cap.state === QUOTA.AT_CAP) {
      const err = new Error(SERVICE_ERR.DRAFT_CAP_REACHED);
      err.detail = { error: SERVICE_ERR.DRAFT_CAP_REACHED, count: cap.count, cap: DRAFT_CAP, retryable: false };
      throw err;
    }
    const reserved = cap.state === QUOTA.RESERVED;

    // The id is minted INSIDE the protected operation. A retry after a lost
    // response replays this result rather than reaching this line again.
    const draft = buildDraft({ ...input, draftId: newDraftId(), rev: 1 });

    let written;
    try {
      written = await putDraft(kv, googleSub, draft, operationId);
    } catch (e) {
      // A slot held by a create that never persisted is a leak, and leaks
      // accumulate into a seller locked out below their real limit.
      if (reserved) await releaseDraftSlot(googleSub);
      throw e;
    }
    if (!written.ok) {
      // A failed authoritative write is a real failure. Nothing is indexed,
      // because nothing exists to index.
      if (reserved) await releaseDraftSlot(googleSub);
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
      // What the seller has room for after this save. `null` when the count
      // could not be read — the UI says nothing rather than guessing.
      // The reservation already counts this draft, so remaining is measured
      // from it directly. `null` when the gate could not be read — the UI says
      // nothing rather than guessing.
      capRemaining: reserved && Number.isFinite(cap.count)
        ? Math.max(0, DRAFT_CAP - cap.count)
        : null,
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

  // Delegate the WRITE to the store. This used to be reimplemented here —
  // read, tombstone, putDraft — and the copy silently omitted the retention
  // TTL, so every tombstone written through the service was permanent while
  // every tombstone written through the store expired at 90 days. The live
  // store is what showed it: ttl = -1. Two implementations of one rule is the
  // bug, not the missing line.
  let out = await deleteDraft(kv, googleSub, draftId, expectedRev, operationId);
  let discarded = false;

  // ── Delete must also work on rows nothing can read ────────────────────
  //
  // The list shows rows it could not hydrate rather than pretending they are
  // gone. That is the right call, but it hands the seller a row with no
  // working action unless delete can finish the job: a normal delete reads the
  // record to check `expectedRev`, and bytes that will not parse have no
  // revision to check.
  //
  // So this is ONE delete with a fallback, not a second Discard button. The
  // seller's intent is identical either way, and a separate operation would be
  // a second implementation of "remove this draft" — the exact shape of bug
  // that has already cost this codebase four regressions.
  //
  // The revision requirement is waived only where no revision exists to
  // protect. `discardDraft` enforces that itself: it refuses a healthy record,
  // so this cannot become a route around a concurrent edit.
  if (!out.ok && (out.error === STORE_ERR.UNREADABLE || out.error === STORE_ERR.NOT_FOUND)) {
    // A NOT_FOUND id that is not in this seller's index is simply not theirs
    // and stays a 404. Only an id the index still advertises earns cleanup —
    // otherwise any unknown id would report a successful delete.
    let advertised = true;
    if (out.error === STORE_ERR.NOT_FOUND) {
      try {
        const idx = await listDraftIds(googleSub, { detail: true });
        const ids = idx.draftIds || [];
        // A degraded index cannot prove absence, and refusing cleanup on an
        // unprovable absence is how the dead row becomes permanent. Cleanup
        // of an entry the index does not list is harmless: there is no record
        // to destroy and the srem is a no-op.
        advertised = ids.includes(draftId) || idx.degraded === true;
      } catch { advertised = false; }
    }
    if (advertised) {
      const dis = await discardDraft(kv, googleSub, draftId, operationId);
      if (dis.ok) {
        // Carry enough of a record for index detach. There is no sku to clean
        // up because there was nothing readable to take one from; the periodic
        // reconcile clears any dangling pointer.
        out = { ...dis, draft: dis.draft || { draftId }, deleted: true };
        discarded = true;
      } else {
        return dis;
      }
    }
  }

  if (!out.ok) {
    // The record still stands. Indexes are deliberately untouched: unindexing
    // a draft that was NOT tombstoned would hide a live draft from its owner.
    return out;
  }

  // The tombstone is authoritative whatever happens next. Index cleanup is a
  // cache eviction, and a cache eviction cannot un-delete anything — so its
  // failure downgrades the response to degraded, never to failed. A repeated
  // delete retries exactly this step, because it may be what failed.
  const index = await detachIndexes(googleSub, out.draft);

  // ── Give the slot back ────────────────────────────────────────────────
  //
  // A cap that only ever counts up is a cap that ratchets: delete 500 drafts
  // and you still cannot save a 501st. The release is best-effort and never
  // fails the delete — the tombstone is already authoritative, and a leaked
  // slot is repaired by the reconcile inside the next reservation, whereas a
  // failed delete would be a real loss of control for the seller.
  //
  // Released exactly once per draft. A repeated delete DOES reach here — the
  // store reports an already-tombstoned draft as ok:true so the caller sees a
  // successful delete either way — so the release is gated on the store's
  // `alreadyDeleted` flag rather than on ok. Without that gate, deleting the
  // same draft twice hands back two slots and the cap drifts loose one
  // double-click at a time.
  const slot = out.alreadyDeleted === true
    ? { released: false, count: null, reason: 'already-deleted' }
    : await releaseDraftSlot(googleSub);

  return {
    ...out,
    index,
    quota: slot,
    discarded,
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


// ── LIST, HYDRATED ────────────────────────────────────────────────────────
//
// Block D's draft list needs more than ids: a seller scanning the screen has
// to recognise the card without opening it. So this hydrates each id into a
// summary.
//
// Three rules, each one earned the hard way elsewhere in this file:
//
// 1. A record we could not READ is not a record that does not EXIST.
//    The id came from the index or from a scan of authoritative storage, so
//    something is there. Dropping it because the read failed would render as
//    "that draft is gone" — the same lie `listDraftIds` refuses to tell about
//    the list as a whole, told one row at a time instead. Unreadable rows are
//    returned as stubs carrying their reason, and the screen shows a row it
//    cannot summarise rather than silently showing one fewer draft.
//
// 2. Tombstones are dropped, and that is not the same decision.
//    A tombstone is POSITIVE evidence the seller deleted it. Omitting it is
//    reporting what they asked for.
//
// 3. Reads are bounded and paged. An unbounded fan-out over a seller's whole
//    index is a request that gets slower the more they use the product.

export const LIST_PAGE_DEFAULT = 25;
export const LIST_PAGE_MAX = 100;
export const LIST_READ_CONCURRENCY = 8;

export const SUMMARY_UNREADABLE = 'unreadable';

/** Reasons a row can appear in the list without a usable summary. */
export const ROW_REASON = {
  UNREADABLE: 'DRAFT_UNREADABLE',       // stored bytes are not a draft we can parse
  SCHEMA_TOO_NEW: 'DRAFT_SCHEMA_TOO_NEW', // written by a newer CardResell
  READ_FAILED: 'DRAFT_READ_FAILED',     // store call itself failed
  VANISHED: 'DRAFT_VANISHED',           // indexed, but the record is positively absent
};

function summarize(draft) {
  return {
    draftId: draft.draftId,
    sku: draft.sku,
    instanceId: draft.instanceId,
    slot: draft.slot,
    status: draft.status,
    rev: draft.rev,
    title: draft.title,
    price: draft.price,
    quantity: draft.quantity,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    // Deliberately NOT the packet. A list of 25 drafts must not ship 25
    // pricing snapshots to render one line of text each; the review screen
    // fetches the full draft when the seller opens it. Whether a snapshot
    // exists is worth one boolean, because the row can say "priced from a
    // saved quote" without carrying the quote.
    hasPacket: Object.prototype.hasOwnProperty.call(draft, 'packet'),
  };
}

async function mapLimited(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Hydrated, paged draft list.
 *
 * Returns { rows, count, total, nextCursor, source, degraded, unavailable }.
 * `total` counts ids known to the index; `count` counts rows on this page.
 */
export async function listDraftSummaries(kv, googleSub, opts = {}) {
  const listed = await listDraftIds(googleSub, { detail: true });
  if (listed.unavailable) {
    return { rows: [], count: 0, total: 0, nextCursor: null, source: null, degraded: true, unavailable: true, retryable: true };
  }

  const ids = Array.isArray(listed.draftIds) ? listed.draftIds : [];

  let limit = Number(opts.limit);
  if (!Number.isInteger(limit) || limit < 1) limit = LIST_PAGE_DEFAULT;
  if (limit > LIST_PAGE_MAX) limit = LIST_PAGE_MAX;

  // Cursor is an offset into a STABLE id order, not into the freshness order
  // the rows are eventually sorted by. Paging over "most recently updated"
  // would skip or repeat rows as the seller edits between pages; paging over
  // sorted ids cannot. The visible ordering is applied per page afterwards.
  const ordered = [...ids].sort();
  let start = Number(opts.cursor);
  if (!Number.isInteger(start) || start < 0) start = 0;
  const slice = ordered.slice(start, start + limit);
  const end = start + slice.length;

  const rows = await mapLimited(slice, LIST_READ_CONCURRENCY, async (id) => {
    let raw;
    try {
      raw = await kv('get', draftKey(googleSub, id));
    } catch {
      return { draftId: id, summary: null, reason: ROW_REASON.READ_FAILED, retryable: true };
    }
    const read = readStoredDraft(raw);
    if (read.ok) return { draftId: id, summary: summarize(read.draft) };

    if (read.error === STORE_ERR.DELETED) return null;           // rule 2
    if (read.error === STORE_ERR.NOT_FOUND) {
      return { draftId: id, summary: null, reason: ROW_REASON.VANISHED, retryable: false };
    }
    if (read.error === STORE_ERR.SCHEMA_TOO_NEW) {
      return { draftId: id, summary: null, reason: ROW_REASON.SCHEMA_TOO_NEW, retryable: false };
    }
    return { draftId: id, summary: null, reason: ROW_REASON.UNREADABLE, retryable: false };
  });

  const kept = rows.filter((r) => r !== null);

  // Newest activity first, and unsummarisable rows sort last rather than
  // being ordered by a timestamp they do not have.
  kept.sort((a, b) => {
    if (a.summary && b.summary) return (b.summary.updatedAt || 0) - (a.summary.updatedAt || 0);
    if (a.summary) return -1;
    if (b.summary) return 1;
    return String(a.draftId).localeCompare(String(b.draftId));
  });

  return {
    rows: kept,
    count: kept.length,
    total: ordered.length,
    // A cursor is offered only while stable ids remain. `count` can be lower
    // than the page size because tombstones were dropped — that is not the
    // end of the list, so the cursor must come from the id slice, never from
    // how many rows survived hydration.
    nextCursor: end < ordered.length ? end : null,
    source: listed.source || null,
    degraded: !!listed.degraded,
    unavailable: false,
  };
}

export { draftIdForSku, DRAFT_STATUS };
