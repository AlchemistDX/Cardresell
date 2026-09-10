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
  attachPacket,
  deleteDraft,
  discardDraft,
  getDraft,
  putDraft,
  newDraftId,
  validateDraftForSlot,
  draftKey,
  readStoredDraft,
  SLOT_RULES,} from './_draftStore.js';

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

import {
  LIFECYCLE_ERR,
  LIFECYCLE_STATE,
  withLifecycleLock,
  resolveLifecycle,
  recordDeletion,
  reserveCreate,
  commitCreate,
  readLifecycle,
} from './_draftLifecycle.js';

export const SERVICE_ERR = {
  ...STORE_ERR,
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  // Raised by createDraft for a slot the registry does not define. It existed
  // unused until the ordering fix below gave it its only caller.
  SLOT_INVALID: 'DRAFT_SLOT_INVALID',
  DRAFT_CAP_REACHED: 'DRAFT_CAP_REACHED',
  // The client sent a generation that is no longer current for this
  // instance+slot row. Its create is a retry of an operation the seller has
  // since deleted, and it is refused rather than repaired: an automatic refresh
  // and retry here would resurrect the deleted draft, which is the whole point
  // of the generation.
  LIFECYCLE_STALE: 'DRAFT_GENERATION_STALE',
  // The row's state could not be established. Never downgraded to "empty":
  // absence that cannot be proven is not absence.
  LIFECYCLE_UNRESOLVED: 'DRAFT_LIFECYCLE_UNRESOLVED',
  LIFECYCLE_BUSY: 'DRAFT_LIFECYCLE_BUSY',
};

/**
 * The draft-state probe the lifecycle module reads through. Injected rather
 * than imported there, so the lifecycle module never depends on the store.
 *
 * Unreadable bytes count as PRESENT. They are a record that exists; reporting
 * them as absent would authorise a create that duplicates a draft which is
 * sitting right there. A store failure throws, which resolveLifecycle turns
 * into UNAVAILABLE rather than "no live draft".
 */
export function draftProbe(kv, googleSub) {
  return async (draftId) => {
    const read = await getDraft(kv, googleSub, draftId);
    if (read.ok) return { found: true, deleted: false };
    if (read.error === STORE_ERR.DELETED) return { found: true, deleted: true };
    if (read.error === STORE_ERR.NOT_FOUND) return { found: false, deleted: false };
    if (read.error === STORE_ERR.UNREADABLE) return { found: true, deleted: false };
    throw new Error(read.error || 'probe_failed');
  };
}

/**
 * Adopt a draft that predates the lifecycle record.
 *
 * A row with no record reads as generation 0 with nothing live, which is
 * correct for a genuinely new row and WRONG for a draft created before this
 * module shipped — it would authorise a second draft for an instance that
 * already has one. So before a first create on an unrecorded row, the existing
 * drafts are searched for one that already belongs to it.
 *
 * The index supplies candidates; the authoritative records establish their
 * state. And the lookup fails CLOSED: a degraded index, a failed listing or a
 * draft whose bytes will not parse all leave "this row is empty" unproven, and
 * an unproven absence is answered with a retryable refusal rather than a
 * silent generation 0.
 *
 * Cost: one index read plus one get per draft, and only on the first create
 * for an unrecorded row. Every subsequent create reads the record instead.
 */
async function adoptLegacyRow(kv, googleSub, instanceId, slot) {
  let idx;
  try {
    idx = await listDraftIds(googleSub, { detail: true });
  } catch {
    return { ok: false, error: SERVICE_ERR.LIFECYCLE_UNRESOLVED, evidence: 'index-read-failed' };
  }
  if (!idx || idx.ok === false || idx.degraded === true || idx.repairRequired === true) {
    // An incomplete index cannot show that this row has no draft.
    return { ok: false, error: SERVICE_ERR.LIFECYCLE_UNRESOLVED, evidence: 'index-incomplete' };
  }
  const ids = idx.draftIds || [];
  let unreadable = 0;
  for (const id of ids) {
    const read = await getDraft(kv, googleSub, id);
    if (read.ok) {
      const d = read.draft || {};
      if (String(d.instanceId) === String(instanceId) && String(d.slot) === String(slot)) {
        return { ok: true, adopted: id, draft: d };
      }
      continue;
    }
    if (read.error === STORE_ERR.DELETED || read.error === STORE_ERR.NOT_FOUND) continue;
    // Unreadable or unavailable: this id might be the row's draft.
    unreadable += 1;
  }
  if (unreadable > 0) {
    return { ok: false, error: SERVICE_ERR.LIFECYCLE_UNRESOLVED, evidence: `unreadable-${unreadable}` };
  }
  return { ok: true, adopted: null };
}

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

export async function createDraft(kv, googleSub, input, idempotencyKey, opts = {}) {
  const scope = SCOPES.DRAFT_CREATE;

  // ── An unsupported slot is refused BEFORE anything is recorded ──────────
  //
  // Previously a draft for an unknown slot was persisted, indexed, and counted
  // against the seller's cap, and only became a blocking SLOT_RULES_UNKNOWN at
  // publish time. That spends a quota slot on a draft that can never publish,
  // and it writes an idempotency record — so a corrected retry on the same key
  // replayed the bad draft instead of creating the right one.
  //
  // The rule itself is NOT duplicated here: the slot registry in _draftStore
  // remains its only definition, and this asks it rather than restating it.
  // What is enforced here is ORDERING — refusal precedes every side effect:
  // no quota reservation, no idempotency record, no index mutation, no write.
  if (!Object.prototype.hasOwnProperty.call(SLOT_RULES, String(input && input.slot))) {
    const err = new Error(SERVICE_ERR.SLOT_INVALID);
    err.detail = {
      error: SERVICE_ERR.SLOT_INVALID,
      slot: (input && input.slot) || null,
      supported: Object.keys(SLOT_RULES),
      retryable: false,
    };
    throw err;
  }

  const operationId = operationIdFor(scope, idempotencyKey);
  const request = selectMutation(scope, input);

  const instanceId = String((input && input.instanceId) || '');
  const slotName = String((input && input.slot) || '');
  // The generation the client was told by sell-eligibility. `null` means the
  // client did not send one — accepted, but then it earns no protection
  // against its own stale retry, which is why the client always sends it.
  //
  // It arrives in `opts`, NOT in `input`, and the distinction is load-bearing.
  // `input` is the mutation, and every field of it is fingerprinted for
  // idempotency; a generation folded in there would make a retry that merely
  // carried a refreshed generation look like a DIFFERENT mutation on the same
  // key, answering 409 MISMATCH where the truthful answer is 410 Gone. A
  // precondition belongs beside the request, not inside it.
  const sentGen = (opts && opts.generation !== undefined && opts.generation !== null)
    ? Number(opts.generation) : null;

  const lifecycleFail = (code, detail) => {
    const err = new Error(code);
    err.detail = { error: code, code, ...detail };
    return err;
  };

  return runOnce(kv, googleSub, scope, idempotencyKey, async () => {
    // ── The row's state is resolved HERE, by the create itself ────────────
    //
    // Not by eligibility. Eligibility may repair the row for convenience, but
    // correctness cannot depend on it having run: a client that skips it, or
    // whose eligibility call raced a delete on another device, still must not
    // be able to recreate a deleted draft. So the authoritative state is read
    // under the lock, by the handler that is about to write.
    const outcome = await withLifecycleLock(kv, googleSub, instanceId, slotName, async ({ fence }) => {
      const rec0 = await readLifecycle(kv, googleSub, instanceId, slotName);
      if (!rec0.ok) {
        throw lifecycleFail(SERVICE_ERR.LIFECYCLE_UNRESOLVED, { evidence: 'record-read-failed', retryable: true });
      }

      // ── Legacy adoption ────────────────────────────────────────────────
      // An unrecorded row reads as generation 0 with nothing live. That is
      // right for a new row and wrong for a draft that predates this record,
      // so the existing drafts decide which it is. Fails closed.
      if (!rec0.record.lastDraftId && rec0.record.gen === 0) {
        const legacy = await adoptLegacyRow(kv, googleSub, instanceId, slotName);
        if (!legacy.ok) {
          throw lifecycleFail(legacy.error, { evidence: legacy.evidence, retryable: true });
        }
        if (legacy.adopted) {
          // Seed the record so every later create reads it instead of scanning,
          // and so a delete of this draft spends generation 0 properly.
          const seed = await reserveCreate(kv, googleSub, instanceId, slotName, legacy.adopted, 0, fence);
          if (seed.ok) await commitCreate(kv, googleSub, instanceId, slotName, legacy.adopted, 0, fence);
          return { existing: legacy.adopted, draft: legacy.draft, generation: 0, adopted: true };
        }
      }

      const resolved = await resolveLifecycle(
        kv, googleSub, instanceId, slotName, draftProbe(kv, googleSub), fence,
      );
      if (!resolved.ok) {
        const code = resolved.error === LIFECYCLE_ERR.UNAVAILABLE
          ? SERVICE_ERR.LIFECYCLE_UNRESOLVED : resolved.error;
        throw lifecycleFail(code, { evidence: 'resolve-failed', retryable: true });
      }

      // Already has a live draft. Returning it is not a second create: two
      // taps that generate two different idempotency keys must still leave the
      // seller with one draft for the row.
      if (resolved.live) {
        const cur = await getDraft(kv, googleSub, resolved.live);
        return {
          existing: resolved.live,
          draft: cur.ok ? cur.draft : null,
          generation: resolved.gen,
          adopted: false,
        };
      }

      // The generation the client believed is no longer current: something
      // terminal happened to this row since it asked. Refused, not repaired.
      if (sentGen !== null && sentGen !== resolved.gen) {
        throw lifecycleFail(SERVICE_ERR.LIFECYCLE_STALE, {
          sentGeneration: sentGen,
          generation: resolved.gen,
          lastState: resolved.record.lastState,
          retryable: false,
        });
      }

      return await createUnderFence({
        kv, googleSub, input, operationId, instanceId, slotName,
        generation: resolved.gen, fence,
      });
    });

    if (outcome && outcome.ok === false && outcome.error === LIFECYCLE_ERR.BUSY) {
      // Another writer holds this row. Retryable and short-lived; the lock
      // expires in seconds.
      throw lifecycleFail(SERVICE_ERR.LIFECYCLE_BUSY, { retryable: true });
    }
    if (outcome && outcome.ok === false) {
      throw lifecycleFail(SERVICE_ERR.LIFECYCLE_UNRESOLVED, { evidence: 'lock-unavailable', retryable: true });
    }
    if (outcome && outcome.existing) {
      return {
        draftId: outcome.existing,
        saved: true,
        draft: outcome.draft,
        generation: outcome.generation,
        existing: true,
        adoptedExisting: !!outcome.adopted,
        degraded: false,
        repairRequired: false,
        index: null,
        validation: outcome.draft ? validateDraftForSlot(outcome.draft) : null,
        capRemaining: null,
      };
    }
    return outcome;
  }, {
    request,
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
        validation: validateDraftForSlot(cur.draft),
      };
    },
  });
}

/**
 * The create itself, holding the lock and the fence.
 *
 * The pointer is written BEFORE the draft, as `reserved`, and promoted after.
 * That ordering is what makes a crashed create recoverable: a reservation with
 * no draft is an interrupted attempt, whereas a draft with no pointer is
 * invisible to every later create and gets duplicated.
 */
async function createUnderFence({
  kv, googleSub, input, operationId, instanceId, slotName, generation, fence,
}) {
  {
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

    // The POINTER first, as `reserved`. A reservation with no draft is a
    // recoverable interrupted attempt; a draft with no pointer is invisible to
    // every later create and gets duplicated.
    const res = await reserveCreate(kv, googleSub, instanceId, slotName, draft.draftId, generation, fence);
    if (!res.ok) {
      if (reserved) await releaseDraftSlot(googleSub);
      const err = new Error(res.error === LIFECYCLE_ERR.FENCED
        ? STORE_ERR.FENCED : SERVICE_ERR.LIFECYCLE_UNRESOLVED);
      err.detail = { ...res, error: err.message, code: err.message, retryable: res.error !== LIFECYCLE_ERR.FENCED };
      throw err;
    }

    let written;
    try {
      // The fence travels to the store, where the guard and the write are one
      // command. Checking it here and then writing would be the race.
      written = await putDraft(kv, googleSub, draft, operationId, { instanceId, slot: slotName, fence });
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

    // Promote the pointer to `live`. A failure here leaves it `reserved` over a
    // real draft, which the next resolve heals forward — the draft is not lost.
    const promoted = await commitCreate(
      kv, googleSub, instanceId, slotName, written.draft.draftId, generation, fence,
    );

    const index = await attachIndexes(googleSub, written.draft);

    // `draftId` is at the TOP LEVEL deliberately: recordDone reads the resource
    // identity from there to write the pointer, and the pointer is what makes a
    // crashed create recoverable rather than duplicated.
    return {
      draftId: written.draft.draftId,
      saved: true,
      draft: written.draft,
      generation,
      // The generation the client should send with its NEXT create for this
      // row, which is this one until something terminal happens.
      lifecyclePromoted: promoted.ok === true,
      // Rule 2: index trouble is reported alongside a successful save.
      degraded: index.degraded,
      repairRequired: index.repairRequired,
      index,
      // Publish-readiness is informational at create time. A draft is allowed
      // to be saved incomplete; it is not allowed to be published incomplete.
      //
      // Named `validation`, not `publishable`: it is the whole validator result
      // (ok, violations, blocking, counts), and an adjective-named field holding
      // an object gets read as a boolean. `if (body.publishable)` was true for a
      // draft with two blocking errors. See audit/DECISION_D3_ENTRY.md.
      validation: validateDraftForSlot(written.draft),
      // What the seller has room for after this save. `null` when the count
      // could not be read — the UI says nothing rather than guessing.
      // The reservation already counts this draft, so remaining is measured
      // from it directly. `null` when the gate could not be read — the UI says
      // nothing rather than guessing.
      capRemaining: reserved && Number.isFinite(cap.count)
        ? Math.max(0, DRAFT_CAP - cap.count)
        : null,
    };
  }
}

/** READ — authoritative record only. Indexes are never consulted for truth. */
export async function readDraft(kv, googleSub, draftId) {
  const cur = await getDraft(kv, googleSub, draftId);
  if (!cur.ok) return cur;

  // DELIBERATE, NOT AN OVERSIGHT: getDraft resolves five packet fields here —
  // packet, packetStatus, packetUsable, packetReason, packetRaw — and this
  // return drops all five. It looks exactly like a bug, and the next person to
  // notice will be tempted to spread `...cur` and "restore" the forwarding.
  //
  // Do not, yet. buildListingPacket() has no production caller, api/drafts.js
  // does not forward these, and the client bundle has no consumer for them.
  // Forwarding them now ships a serialised field that nothing produces and
  // nothing reads — the failure mode this repo already has an open item for,
  // and one that is much harder to remove later than to not add.
  //
  // Producer, forwarding and consumer land together, so the field arrives with
  // something that reads it. Until then the honest response shape is the one
  // whose every field has a reader. See audit/d3/LANE_A_STEP1_PACKET.md §5.
  // ── The packet envelope, now that there is a consumer ─────────────────
  // The note above described the state where forwarding these would ship a
  // field nothing read. That state has ended: the producer runs on create and
  // on rebuild, api/drafts.js forwards this envelope, and the review screen
  // reads it. So four of the five fields are forwarded.
  //
  // `packetRaw` is NOT, and that is not an oversight either. It is the
  // unvalidated stored bytes, kept for internal diagnosis of a record that
  // failed to read; putting it on a seller-facing response would make an
  // unreadable packet's contents renderable by any client willing to ignore
  // packetUsable.
  return {
    ok: true,
    draft: cur.draft,
    validation: validateDraftForSlot(cur.draft),
    readiness: readinessOf(cur.draft),
    packet:       cur.packet,
    packetStatus: cur.packetStatus,
    packetUsable: cur.packetUsable,
    packetReason: cur.packetReason,
  };
}

/**
 * UPDATE — expected revision → claim → authoritative guard → write.
 *
 * Not idempotency-keyed: the expected revision already makes a replayed edit
 * either a no-op replay (own claim, already committed) or a conflict. The
 * revision IS the concurrency token here.
 */
export async function updateDraft(kv, googleSub, draftId, patch, expectedRev, idempotencyKey, rebuildPacket) {
  const operationId = operationIdFor('draft-update', idempotencyKey);

  const cur = await getDraft(kv, googleSub, draftId);
  if (!cur.ok) return cur;

  let next;
  try {
    next = applyEdit(cur.draft, patch, { expectedRev });
  } catch (e) {
    return { ok: false, error: e.message, current: cur.draft };
  }

  // ── The packet rebuild, and why it lives HERE ──────────────────────────
  // Between applyEdit and putDraft, on the POST-EDIT record. Both halves of
  // that placement are load-bearing.
  //
  // Post-edit, because the whole point is that the packet describes the draft
  // that will be stored. Building from `cur.draft` would reproduce the defect
  // this lane opened with: a packet that documents a price the seller just
  // changed away from.
  //
  // Before putDraft, because putDraft's claimRevision(next.rev) IS the
  // conditional write. A concurrent edit that lands first takes the revision,
  // this claim fails REV_CONFLICT, and the rebuilt packet is discarded
  // unwritten -- which is the reviewer's race: a rebuild started before a
  // newer edit must not attach obsolete output. Nothing extra is needed
  // because the packet rides the same record as the edit, under one claim.
  // There is deliberately no `await` between the build and the claim.
  if (typeof rebuildPacket === 'function') {
    let built;
    try {
      built = rebuildPacket(next);
    } catch (e) {
      return { ok: false, error: e.message, current: cur.draft };
    }
    next = attachPacket(next, built);
  }

  const written = await putDraft(kv, googleSub, next, operationId);
  if (!written.ok) return written;

  return {
    ok: true,
    draft: written.draft,
    replayed: !!written.replayedWrite,
    // An edit does not change draftId or sku, so no index write is required.
    // Re-indexing on every edit would multiply the failure surface for no gain.
    validation: validateDraftForSlot(written.draft),
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
  // ── The row identity, read before the tombstone ─────────────────────────
  //
  // The lifecycle record is keyed by (instanceId, slot), and only the draft
  // knows which row it belongs to. So the record is read first — and if the
  // draft cannot be read at all, there is no row to record against. That case
  // is handled by the discard path below and by resolveLifecycle's
  // disappearance rule, not by guessing an instanceId.
  const pre = await getDraft(kv, googleSub, draftId);
  const row = pre.ok && pre.draft
    ? { instanceId: String(pre.draft.instanceId || ''), slot: String(pre.draft.slot || '') }
    : null;

  if (!row) {
    return await deleteWithoutRow(kv, googleSub, draftId, expectedRev, operationId);
  }

  const outcome = await withLifecycleLock(kv, googleSub, row.instanceId, row.slot, async ({ fence }) =>
    finishDelete(kv, googleSub, draftId, expectedRev, operationId, row, fence));
  if (outcome && outcome.ok === false && outcome.error === LIFECYCLE_ERR.BUSY) {
    return { ok: false, error: SERVICE_ERR.LIFECYCLE_BUSY, retryable: true };
  }
  return outcome;
}

/**
 * Delete for a draft whose record cannot be read, so its row is unknown.
 *
 * No lifecycle write happens here — there is no key to write. The row is not
 * left wrong, though: the record still points at this draft, and the next
 * resolve finds it missing and refuses that generation under the disappearance
 * rule. What is NOT claimed is that the seller deleted it; the record says GONE.
 */
async function deleteWithoutRow(kv, googleSub, draftId, expectedRev, operationId) {
  return await finishDelete(kv, googleSub, draftId, expectedRev, operationId, null, null);
}

async function finishDelete(kv, googleSub, draftId, expectedRev, operationId, row, fence) {
  const fenceCtx = row && Number.isFinite(fence)
    ? { instanceId: row.instanceId, slot: row.slot, fence } : null;

  // The TOMBSTONE write is fenced too. It is a mutation of the draft record
  // like any other, and an unfenced destructive write is the one path where a
  // lapsed owner could undo a newer owner's work.
  let out = await deleteDraft(kv, googleSub, draftId, expectedRev, operationId, fenceCtx);
  let discarded = false;

  if (!out.ok && out.error === STORE_ERR.FENCED) {
    // A newer owner holds this row. The delete is refused rather than retried:
    // the draft this operation meant to delete is not the draft that is there.
    return { ok: false, error: STORE_ERR.FENCED, retryable: false, held: out.held, mine: out.mine };
  }

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

  // ── Spend the generation, AFTER the tombstone ─────────────────────────
  //
  // Order matters and this is the only correct one. Recording the deletion
  // first would refuse the seller's own pending retry while the draft was
  // still live — a draft they can see and cannot recreate. Recording after
  // means the window is the opposite way round: for a moment the draft is
  // tombstoned and the old generation is still current, and a retry landing
  // in that window is caught by the fenced write instead, because it does not
  // hold this fence.
  //
  // A failure here is reported, not swallowed, but it does not fail the
  // delete: the tombstone is already authoritative, and resolveLifecycle's
  // "was live, now unreadable" rule refuses the old generation anyway.
  let lifecycle = { recorded: false, reason: 'no-row' };
  if (row) {
    // The signature is (kv, sub, instanceId, slot, draftId, deletedDraftGen,
    // fence). `deletedDraftGen` is passed as null ON PURPOSE: recordDeletion
    // derives it from the record itself (lastDraftId === draftId ?
    // lastDraftGen : null), which is the only place that knows which
    // generation this draft was created at. Passing `fence` here — a number,
    // so it type-checks — was an argument-position bug that left the fence
    // undefined, so the fenced write refused with 'no-fence' and the deletion
    // was never recorded. Nothing failed loudly: resolveLifecycle's
    // disappearance rule repaired the row on the next read, so the seller saw
    // correct behaviour while the durable record stayed wrong.
    const rec = await recordDeletion(
      kv, googleSub, row.instanceId, row.slot, draftId, null, fence,
    );
    lifecycle = rec.ok
      ? { recorded: true, generation: rec.gen }
      : { recorded: false, reason: rec.error };
  }

  return {
    ...out,
    index,
    quota: slot,
    lifecycle,
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
    readiness: readinessOf(draft),
  };
}

// Publish-readiness for one row, derived from the validator and nothing else.
//
// There is no second eligibility formula here, and there must never be. The
// list screen and the review screen have to agree about whether a draft can be
// listed; the only way to guarantee that is for both to read the same function.
// `ok` and `blocking` come straight from validateDraftForSlot -- this maps them
// into a wire shape, it does not recompute them.
//
// `field` ships too, and it is NOT the same kind of key as the three that stay
// behind. `severity` and `blocking` are constant across the whole array by
// construction, and `detail` is an internal diagnostic; those three are
// genuinely redundant on the wire. `field` varies per element and is derivable
// from nothing else the client receives -- the only way to reconstruct it
// client-side is a code->field table, which is a rule-1 duplication of a fact
// this function already holds. The review screen groups blockers under the
// field each one concerns, so it needs the association, and the server is the
// one place that should own it.
//
// `message` ships next to `code` because the server already owns this copy.
// reasonMessage() has specific text for all four blocking codes, and
// SLOT_TITLE_TOO_LONG's is computed ("Shorten it by N"), which a client-side
// copy table cannot reproduce without duplicating the length arithmetic. A
// client that authors its own strings for these codes is a rule-1 duplication
// of a business message. Render what the server sends.
export function readinessOf(draft) {
  const v = validateDraftForSlot(draft);
  return {
    publishable: v.ok,
    blockers: v.blocking.map((x) => ({ code: x.code, field: x.field, message: x.message })),
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

  // `focus` answers "which page is this draft on" in one request.
  //
  // Draft ids are random (`newDraftId`), so a new draft's position in the
  // sorted order is uniformly distributed. A client that renders page 1 and
  // looks for the id it just created finds it 25/N of the time -- 5% at the
  // 500 cap. The alternative the client would otherwise reach for is paging
  // forward until the id turns up, which is up to 20 sequential authenticated
  // requests before first paint, and unbounded in principle because the cap
  // can be exceeded under concurrency (see the 519 note above).
  //
  // The offset is free: `ordered` is already in hand.
  //
  // A -1 is not an error. The id may be legitimately absent because the create
  // resolved through the reconcile path and the index has not caught up -- the
  // draft is saved either way. Serving page 1 with a null offset lets the
  // screen say "saved, may take a moment" instead of "not found".
  let focusOffset = null;
  if (typeof opts.focus === 'string' && opts.focus) {
    const at = ordered.indexOf(opts.focus);
    if (at >= 0) {
      focusOffset = at;
      // Align to a limit boundary so the page served is a page the cursor
      // contract could also have produced. An unaligned window would make
      // `nextCursor` describe a walk that skips rows.
      start = Math.floor(at / limit) * limit;
    } else {
      start = 0;
    }
  }
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
    // Found/not-found signal plus a diagnostic. NOT row arithmetic: a row can
    // be tombstoned between the index write and the hydration read, in which
    // case this is a real offset and the row is still absent from `rows`. The
    // screen matches on draftId and treats any absence the same way.
    focusOffset,
  };
}

export { draftIdForSku, DRAFT_STATUS };
