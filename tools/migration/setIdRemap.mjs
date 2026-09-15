/* Set-identity repair — work-order item 4.
 *
 * Produces a DRY-RUN mapping for every affected record. Writes nothing.
 *
 * Binding constraints from the work order:
 *   - No automatic quantity merging. Two records that would collide after
 *     remapping are reported as a collision for human decision, never summed.
 *   - Preserve physical-card instance IDs, quantities, purchase history,
 *     photos, and draft relationships. These are copied verbatim; only the
 *     set-identity fields and the derived SKU change.
 *   - Resolve ambiguous set codes using existing card IDs and other stored
 *     evidence, not by guessing.
 *   - Quarantine unresolved records instead of applying a best guess.
 *   - Demonstrate rerun safety (idempotence) and rollback before any write.
 *
 * The remap table is an explicit checked-in mapping. It is deliberately NOT a
 * regex: measured renames include `base6`->`lc`, `hsp`->`hgssp`,
 * `pgo`->`swsh10.5`, which share no derivable pattern with `sv1`->`sv01`.
 */

import { skuFor } from '../../api/_cardIdentity.js';

'use strict';

export const MIGRATION_VERSION = 1;

/** Outcome per record. */
export const OUTCOME = {
  UNCHANGED: 'unchanged',           // set id already current
  REMAPPED: 'remapped',             // resolved via the explicit table
  RESOLVED_BY_EVIDENCE: 'resolved_by_evidence', // table ambiguous, card id decided it
  QUARANTINED: 'quarantined',       // cannot resolve — left untouched
  COLLISION: 'collision',           // remap would collide with another record
};

/**
 * @param {object} opts
 *  @param {Record<string,string>} opts.renameMap   oldSetId -> newSetId (explicit)
 *  @param {string[]}              opts.absentSetIds sets with no target
 *  @param {Set<string>}           opts.knownTargetSetIds valid destination ids
 *  @param {Map<string,string>}    opts.cardIdToSetId  evidence: card id -> set id
 */
export function planMigration(records, opts = {}) {
  const renameMap = opts.renameMap || {};
  // Accept either bare ids or the audit's {id,name,total} records; a silently
  // mis-typed entry would otherwise make an absent set look merely unmapped.
  const absent = new Set((opts.absentSetIds || []).map((a) => String(a && typeof a === 'object' ? a.id : a)));
  const targets = opts.knownTargetSetIds || new Set(Object.values(renameMap));
  const cardEvidence = opts.cardIdToSetId || new Map();

  const rows = [];
  for (const r of records) {
    rows.push(planOne(r, { renameMap, absent, targets, cardEvidence }));
  }

  // Collision detection: after remapping, does any two DISTINCT instance rows
  // land on the same identity? Quantities are never merged automatically.
  const bySku = new Map();
  for (const row of rows) {
    if (row.outcome === OUTCOME.QUARANTINED) continue;
    const key = row.after && row.after.sku;
    if (!key) continue;
    if (!bySku.has(key)) bySku.set(key, []);
    bySku.get(key).push(row);
  }
  for (const [sku, group] of bySku) {
    if (group.length > 1) {
      for (const row of group) {
        row.outcome = OUTCOME.COLLISION;
        row.collision = {
          sku,
          instanceIds: group.map((g) => g.instanceId),
          quantities: group.map((g) => g.before.quantity),
          note: 'Two distinct instance rows would share one identity after remapping. Quantities are NOT summed. Requires an explicit human decision.',
        };
      }
    }
  }

  return { version: MIGRATION_VERSION, rows, summary: summarize(rows) };
}

function planOne(r, ctx) {
  const before = snapshot(r);
  const oldSetId = r.setId == null ? null : String(r.setId);

  const base = {
    instanceId: r.instanceId,
    before,
    // Everything below is carried verbatim. Listed explicitly so a reviewer can
    // see that nothing destructive is proposed.
    preserved: {
      instanceId: r.instanceId,
      quantity: r.quantity,
      purchaseHistory: r.purchaseHistory ?? null,
      photos: r.photos ?? null,
      draftIds: r.draftIds ?? null,
      acquiredAt: r.acquiredAt ?? null,
      costBasis: r.costBasis ?? null,
    },
  };

  if (!oldSetId) {
    return { ...base, outcome: OUTCOME.QUARANTINED, after: null,
      reason: 'record has no setId; nothing to resolve from' };
  }
  if (ctx.targets.has(oldSetId) && !(oldSetId in ctx.renameMap)) {
    return { ...base, outcome: OUTCOME.UNCHANGED, after: before,
      reason: 'setId is already a valid target id' };
  }
  if (ctx.absent.has(oldSetId)) {
    return { ...base, outcome: OUTCOME.QUARANTINED, after: null,
      reason: `set ${oldSetId} has no counterpart in the destination catalogue` };
  }

  const mapped = ctx.renameMap[oldSetId];
  if (mapped) {
    // Cross-check with stored card-id evidence where available.
    const ev = r.cardId != null ? ctx.cardEvidence.get(String(r.cardId)) : undefined;
    if (ev && ev !== mapped) {
      return { ...base, outcome: OUTCOME.QUARANTINED, after: null,
        reason: `remap table says ${oldSetId}->${mapped} but stored cardId ${r.cardId} belongs to ${ev}; conflicting evidence`,
        evidence: { tableTarget: mapped, cardIdTarget: ev } };
    }
    const after = { ...before, setId: mapped, sku: skuFor({ ...r, setId: mapped }) };
    return { ...base, outcome: OUTCOME.REMAPPED, after,
      reason: `explicit remap table: ${oldSetId} -> ${mapped}`,
      ...(ev ? { evidence: { confirmedByCardId: r.cardId } } : {}) };
  }

  // Not in the table. Try stored card-id evidence before giving up.
  const ev = r.cardId != null ? ctx.cardEvidence.get(String(r.cardId)) : undefined;
  if (ev) {
    const after = { ...before, setId: ev, sku: skuFor({ ...r, setId: ev }) };
    return { ...base, outcome: OUTCOME.RESOLVED_BY_EVIDENCE, after,
      reason: `setId ${oldSetId} absent from remap table; resolved to ${ev} from stored cardId ${r.cardId}`,
      evidence: { cardId: r.cardId, resolvedSetId: ev } };
  }

  return { ...base, outcome: OUTCOME.QUARANTINED, after: null,
    reason: `setId ${oldSetId} is not in the remap table and no stored evidence resolves it` };
}

function snapshot(r) {
  return {
    setId: r.setId == null ? null : String(r.setId),
    cardId: r.cardId ?? null,
    number: r.number ?? null,
    name: r.name ?? null,
    quantity: r.quantity ?? null,
    sku: r.sku ?? skuFor(r),
  };
}

/** Deterministic identity string. Mirrors the SKU axes; the real minting lives
 *  in api/_cardIdentity.js and must be used in the applier. */
/* REMOVED — this was a re-implementation of the SKU format, and it was wrong.
 *
 * It emitted `CR|pokemon|en|base1|4|base|raw|` while the real generator
 * (api/_cardIdentity.js skuFor) emits `v2-<head>-<sha256 prefix>` built from
 * identityString(). A migration minting SKUs with this function would have
 * rewritten every touched record into a format no other part of the system
 * recognises — silently detaching drafts, packets and portfolio rows from their
 * cards. The migration now calls the production generator directly, so a change
 * to the SKU format cannot drift away from the migration.
 */
export function mintSku() {
  throw new Error(
    'mintSku was a wrong re-implementation of the SKU format and has been removed. ' +
    'Use skuFor from api/_cardIdentity.js — the production generator.'
  );
}

function summarize(rows) {
  const c = {};
  for (const r of rows) c[r.outcome] = (c[r.outcome] || 0) + 1;
  return {
    total: rows.length,
    byOutcome: c,
    willModify: rows.filter((r) => r.outcome === OUTCOME.REMAPPED || r.outcome === OUTCOME.RESOLVED_BY_EVIDENCE).length,
    quarantined: c[OUTCOME.QUARANTINED] || 0,
    collisions: c[OUTCOME.COLLISION] || 0,
    note: 'Dry run. No records were modified. Collisions and quarantines require explicit decisions before any applier runs.',
  };
}

/* ---------- rerun safety and rollback ------------------------------------- */

/**
 * Apply a plan to an in-memory record set, returning the new set plus an
 * inverse patch. Pure — the caller decides whether to persist.
 * Records in COLLISION or QUARANTINED state are never touched.
 */
export function applyPlan(records, plan) {
  const byId = new Map(records.map((r) => [String(r.instanceId), r]));
  const inverse = [];
  const applied = [];
  for (const row of plan.rows) {
    if (row.outcome !== OUTCOME.REMAPPED && row.outcome !== OUTCOME.RESOLVED_BY_EVIDENCE) continue;
    const rec = byId.get(String(row.instanceId));
    if (!rec) continue;
    // Record field PRESENCE, not just value: a record that had no sku must end
    // up with no sku after rollback, rather than a reconstructed one.
    inverse.push({
      instanceId: rec.instanceId,
      setId: rec.setId,
      hadSku: Object.prototype.hasOwnProperty.call(rec, 'sku'),
      sku: rec.sku,
      hadMigrationVersion: Object.prototype.hasOwnProperty.call(rec, 'migrationVersion'),
      migrationVersion: rec.migrationVersion,
    });
    byId.set(String(row.instanceId), {
      ...rec, setId: row.after.setId, sku: row.after.sku, migrationVersion: MIGRATION_VERSION,
    });
    applied.push(row.instanceId);
  }
  return { records: [...byId.values()], inverse, appliedCount: applied.length };
}

/** Restore from an inverse patch. */
export function rollback(records, inverse) {
  const byId = new Map(records.map((r) => [String(r.instanceId), r]));
  for (const inv of inverse) {
    const rec = byId.get(String(inv.instanceId));
    if (!rec) continue;
    const restored = { ...rec, setId: inv.setId };
    if (inv.hadSku) restored.sku = inv.sku;
    else delete restored.sku;
    if (inv.hadMigrationVersion) restored.migrationVersion = inv.migrationVersion;
    else delete restored.migrationVersion;
    byId.set(String(inv.instanceId), restored);
  }
  return [...byId.values()];
}
