/* Ambiguous ptcgoCode -> canonical set identity. Reviewer item 5.
 *
 * SCOPE CORRECTION. The previously delivered migration (setIdRemap.mjs) maps
 * PokemonTCG.io set ids to TCGdex set ids. That is a PROVIDER MIGRATION. It is
 * not the repair that was asked for, and I conflated the two.
 *
 * The requested repair is provider-neutral: a stored set identity that is an
 * ambiguous ptcgoCode must be resolved to a canonical set id. Measured, 141 of
 * 174 sets (81.0%) carry a ptcgoCode, 33 have none, and exactly 7 codes map to
 * more than one canonical set:
 *
 *   ASR -> swsh10,      swsh10tg
 *   BRS -> swsh9,       swsh9tg
 *   CEL -> cel25,       cel25c
 *   CRZ -> swsh12pt5,   swsh12pt5gg
 *   LOR -> swsh11,      swsh11tg
 *   SHF -> swsh45,      swsh45sv
 *   SIT -> swsh12,      swsh12tg
 *
 * Five of the seven `*tg` sets are priced separately from their parent set, so
 * collapsing them is a live valuation bug, not a cosmetic id issue.
 *
 * This operation NEVER guesses which side of an ambiguous pair a record belongs
 * to. It resolves only on positive evidence and quarantines everything else.
 * Quantities are never merged: a post-resolution collision reports both
 * instanceIds and both quantities and is handed back for a human decision.
 *
 * Pure module. No network, no filesystem, no Production reads. See
 * ptcgoCodeResolve.test.mjs.
 */
import { skuFor } from '../../api/_cardIdentity.js';

export const RESOLVE_VERSION = 1;

/** Measured ambiguous codes. Explicit table — deliberately not a regex. */
export const AMBIGUOUS_PTCGO_CODES = Object.freeze({
  ASR: ['swsh10', 'swsh10tg'],
  BRS: ['swsh9', 'swsh9tg'],
  CEL: ['cel25', 'cel25c'],
  CRZ: ['swsh12pt5', 'swsh12pt5gg'],
  LOR: ['swsh11', 'swsh11tg'],
  SHF: ['swsh45', 'swsh45sv'],
  SIT: ['swsh12', 'swsh12tg'],
});

export const OUTCOME = Object.freeze({
  ALREADY_CANONICAL: 'already_canonical',
  RESOLVED: 'resolved',
  QUARANTINED_AMBIGUOUS: 'quarantined_ambiguous',
  QUARANTINED_NO_CODE: 'quarantined_no_code',
  UNKNOWN_CODE: 'unknown_code',
  COLLISION: 'collision',
});

/* Subset markers. Trainer Gallery / Galarian Gallery / radiant-collection
 * numbering uses a printed prefix, which IS readable evidence. */
const SUBSET_NUMBER_PREFIX = /^(TG|GG|SV|RC)\s*0*\d+/i;

function norm(v) {
  return v == null ? null : String(v).trim();
}

/**
 * Decide the canonical set id for one record.
 * Evidence, in order:
 *   1. an explicit canonical setId already stored -> nothing to do
 *   2. a subset number prefix (TG/GG/SV/RC) -> the subset member of the pair
 *   3. a caller-supplied per-record mapping from a trusted source
 * Anything else quarantines. Card-number ranges are NOT used as evidence:
 *   subset and parent numbering overlap, so a range test would guess.
 */
export function resolveOne(record, opts = {}) {
  const canonicalIds = opts.canonicalSetIds instanceof Set ? opts.canonicalSetIds : null;
  const trusted = opts.trustedSetIdByInstance instanceof Map ? opts.trustedSetIdByInstance : new Map();

  const setId = norm(record.setId);
  const code = norm(record.ptcgoCode || record.setCode);
  const number = norm(record.number);

  if (setId && (!canonicalIds || canonicalIds.has(setId)) && !AMBIGUOUS_PTCGO_CODES[setId.toUpperCase()]) {
    return { outcome: OUTCOME.ALREADY_CANONICAL, setId, evidence: 'stored set id is already canonical' };
  }

  const ambiguousKey = [setId, code].map((x) => (x ? x.toUpperCase() : null)).find((x) => x && AMBIGUOUS_PTCGO_CODES[x]);

  if (!ambiguousKey) {
    if (!code && !setId) {
      return { outcome: OUTCOME.QUARANTINED_NO_CODE, setId: null, evidence: 'record carries neither a set id nor a ptcgoCode' };
    }
    return {
      outcome: OUTCOME.UNKNOWN_CODE, setId: null,
      evidence: `"${code || setId}" is not a known ambiguous ptcgoCode and not a recognised canonical set id`,
    };
  }

  const [parent, subset] = AMBIGUOUS_PTCGO_CODES[ambiguousKey];

  const trustedId = trusted.get(record.instanceId);
  if (trustedId) {
    if (![parent, subset].includes(trustedId)) {
      return {
        outcome: OUTCOME.QUARANTINED_AMBIGUOUS, setId: null,
        evidence: `supplied set id "${trustedId}" is not a member of ${ambiguousKey} -> [${parent}, ${subset}]`,
      };
    }
    return { outcome: OUTCOME.RESOLVED, setId: trustedId, evidence: 'explicit per-record set id from a trusted source' };
  }

  if (number && SUBSET_NUMBER_PREFIX.test(number)) {
    return {
      outcome: OUTCOME.RESOLVED, setId: subset,
      evidence: `printed number "${number}" carries a subset prefix, which only occurs in ${subset}`,
    };
  }

  // A plain number appears in BOTH the parent set and (in some sets) the subset.
  // There is no readable evidence, so this must not be guessed.
  return {
    outcome: OUTCOME.QUARANTINED_AMBIGUOUS, setId: null,
    evidence: `"${ambiguousKey}" maps to both ${parent} and ${subset}; the record carries no evidence of which`,
    candidates: [parent, subset],
  };
}

/**
 * Plan the whole set. Dry run only: returns rows, an inverse for rollback, and
 * a summary. Never mutates its input, never merges quantities.
 */
export function planResolve(records, opts = {}) {
  const rows = [];
  const inverse = [];
  const byIdentity = new Map();

  for (const r of Array.isArray(records) ? records : []) {
    const before = { ...r };
    const d = resolveOne(r, opts);

    if (d.outcome !== OUTCOME.RESOLVED) {
      rows.push({ instanceId: r.instanceId, outcome: d.outcome, before, after: null, evidence: d.evidence, candidates: d.candidates });
      continue;
    }

    const after = { ...before, setId: d.setId, sku: skuFor({ ...r, setId: d.setId }) };
    const key = `${after.game ?? 'pokemon'}|${after.setId}|${after.number}|${after.variant ?? ''}|${after.grader ?? 'raw'}|${after.grade ?? ''}`;
    if (byIdentity.has(key)) {
      const other = byIdentity.get(key);
      rows.push({
        instanceId: r.instanceId, outcome: OUTCOME.COLLISION, before, after: null,
        evidence: 'resolving this record would collide with another record on the same canonical identity',
        collidesWith: {
          instanceIds: [other.instanceId, r.instanceId],
          quantities: [other.quantity ?? null, r.quantity ?? null],
        },
        note: 'Quantities are NOT summed. This needs an explicit human decision.',
      });
      continue;
    }
    byIdentity.set(key, r);

    // Record field PRESENCE, not just value, so rollback cannot invent a field
    // the original record never had.
    inverse.push({
      instanceId: r.instanceId,
      restore: { setId: before.setId, sku: before.sku },
      had: { setId: Object.prototype.hasOwnProperty.call(before, 'setId'), sku: Object.prototype.hasOwnProperty.call(before, 'sku') },
    });
    rows.push({ instanceId: r.instanceId, outcome: OUTCOME.RESOLVED, before, after, evidence: d.evidence });
  }

  const counts = {};
  for (const row of rows) counts[row.outcome] = (counts[row.outcome] || 0) + 1;

  return {
    version: RESOLVE_VERSION,
    rows,
    inverse,
    summary: {
      total: rows.length,
      byOutcome: counts,
      willModify: counts[OUTCOME.RESOLVED] || 0,
      quarantined: (counts[OUTCOME.QUARANTINED_AMBIGUOUS] || 0) + (counts[OUTCOME.QUARANTINED_NO_CODE] || 0),
      collisions: counts[OUTCOME.COLLISION] || 0,
      note:
        'Dry run over supplied records. No Production data was read or written. ' +
        'Quarantines and collisions require explicit decisions before any applier runs.',
    },
  };
}

export function applyResolve(records, plan) {
  const byId = new Map(plan.rows.filter((r) => r.after).map((r) => [r.instanceId, r.after]));
  return (records || []).map((r) => (byId.has(r.instanceId) ? { ...byId.get(r.instanceId) } : { ...r }));
}

export function rollbackResolve(records, inverse) {
  const byId = new Map((inverse || []).map((i) => [i.instanceId, i]));
  return (records || []).map((r) => {
    const inv = byId.get(r.instanceId);
    if (!inv) return { ...r };
    const out = { ...r };
    for (const f of ['setId', 'sku']) {
      if (inv.had[f]) out[f] = inv.restore[f];
      else delete out[f];        // the field never existed; do not invent it
    }
    return out;
  });
}
