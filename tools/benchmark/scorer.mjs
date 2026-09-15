/* Benchmark scorer — work-order item 7.
 *
 * Replaces the scorer in scanner-benchmark-run.mjs, which had defects that
 * inflated accuracy rather than measuring it:
 *
 *   1. normalize() was `String(v).toLowerCase().replace(/[^a-z0-9]/g,'')`.
 *      Every Japanese name collapsed to the empty string, so two DIFFERENT
 *      Japanese cards compared EQUAL and every such scan graded correct.
 *      Demonstrated: normalize('リーフィア') === normalize('サンダース') === ''.
 *      It also folded 'Pokémon' to 'pokmon', silently dropping the accent.
 *   2. Identity was compared field-by-field with `|| !labeled`, so a missing
 *      label counted as agreement instead of an unscoreable row.
 *   3. Infrastructure faults (HTTP 5xx, auth expiry, file-not-found) landed in
 *      the same denominator as recognition results.
 *   4. top-3 was not restricted to three candidates.
 *   5. No manifest validation and no enforced scan cap.
 *
 * Pure module: no network, no filesystem. See scorer.test.mjs.
 */

'use strict';

export const SCAN_CAP = 50;

/** Unicode-preserving normalisation. NFKC + case-fold + collapse whitespace.
 *  Never strips non-ASCII: the character set IS part of the identity. */
export function normIdent(v) {
  if (v == null) return null;
  const s = String(v).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  return s === '' ? null : s;
}

/** Card numbers: drop set size and leading zeros, keep alphabetic markers. */
export function normNumber(v) {
  if (v == null) return null;
  const s = String(v).normalize('NFKC').trim().toUpperCase();
  if (!s) return null;
  const head = s.split('/')[0];
  const m = head.match(/^([A-Z]*)0*(\d+)([A-Z]*)$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : head;
}

/**
 * Complete printing identity. All four axes must be present in the LABEL for a
 * row to be scoreable, and all four must match for the identity to be correct.
 * A missing label field makes the row unscoreable — never a free pass.
 */
export const IDENTITY_AXES = ['game', 'setCode', 'number', 'name'];

/* Axes that distinguish PRINTINGS of the same card. A Japanese 1st-edition
 * reverse-holo Pikachu and an English unlimited normal Pikachu share game, set,
 * number and name — comparing only those four graded them identical, which is
 * exactly the substitution the guarantee forbids and a large real price gap.
 *
 * These are scored "when applicable": if the LABEL specifies the axis, the
 * response must agree. A label that does not specify `finish` does not demand
 * one. But a response that OMITS an axis the label specifies cannot be credited
 * with matching it — silence is not agreement.
 */
export const PRINTING_AXES = ['language', 'edition', 'finish', 'variant', 'printingId'];
export const ALL_IDENTITY_AXES = [...IDENTITY_AXES, ...PRINTING_AXES];

export function identityKey(o) {
  if (!o) return null;
  const k = {
    game: normIdent(o.game),
    setCode: normIdent(o.setCode),
    number: normNumber(o.number),
    name: normIdent(o.name),
  };
  for (const a of PRINTING_AXES) k[a] = normIdent(o[a]);
  return k;
}

/** Printing axes the label specifies, and how the response compares on each. */
export function printingAxisReport(label, got) {
  const L = identityKey(label) || {};
  const G = identityKey(got) || {};
  const report = {};
  for (const a of PRINTING_AXES) {
    if (L[a] == null) continue;            // label does not constrain this axis
    report[a] = { expected: L[a], returned: G[a], agrees: G[a] != null && G[a] === L[a] };
  }
  return report;
}

export function labelIsComplete(label) {
  const k = identityKey(label);
  if (!k) return false;
  return IDENTITY_AXES.every((a) => k[a] != null);
}

/** Exact printing equality across every axis. */
export function identityMatches(label, actual) {
  const a = identityKey(label);
  const b = identityKey(actual);
  if (!a || !b) return false;
  if (!IDENTITY_AXES.every((x) => a[x] != null)) return false;
  if (!IDENTITY_AXES.every((x) => a[x] === b[x])) return false;
  // Every printing axis the label constrains must be positively agreed.
  for (const x of PRINTING_AXES) {
    if (a[x] == null) continue;
    if (b[x] !== a[x]) return false;       // includes b[x] == null: silence is not agreement
  }
  return true;
}

/* ---------- verdicts ------------------------------------------------------ */

export const VERDICT = {
  // recognition outcomes (enter accuracy denominators)
  CORRECT_EXACT: 'correct_exact',
  WRONG_EXACT: 'wrong_exact',                     // automatic exact match, wrong card
  CORRECT_IN_SHORTLIST: 'correct_in_shortlist',
  WRONG_SHORTLIST: 'wrong_shortlist',
  CORRECT_REFUSAL: 'correct_refusal',
  WRONG_REFUSAL: 'wrong_refusal',                 // refused a card it should have identified
  // non-recognition outcomes (excluded from accuracy, reported separately)
  INFRA_ERROR: 'infra_error',
  AUTH_FAILURE: 'auth_failure',
  UNSCOREABLE_LABEL: 'unscoreable_label',
  UNEXPECTED_STATE: 'unexpected_state',
  // decision-policy failure: the response chose an automatic identity where the
  // label says the image cannot distinguish the printings. Choosing the labelled
  // card by luck is still a policy failure — the seller was never asked.
  POLICY_AUTO_OVER_CONFIRM: 'policy_auto_over_confirm',
  // the label does not say what the correct decision was, so policy is unscoreable
  UNSCOREABLE_POLICY: 'unscoreable_policy',
};

const RECOGNITION_VERDICTS = new Set([
  VERDICT.CORRECT_EXACT, VERDICT.WRONG_EXACT, VERDICT.CORRECT_IN_SHORTLIST,
  VERDICT.WRONG_SHORTLIST, VERDICT.CORRECT_REFUSAL, VERDICT.WRONG_REFUSAL,
  // A policy failure IS a recognition outcome and belongs in the denominator:
  // excluding it would let a scanner improve its score by over-claiming.
  VERDICT.POLICY_AUTO_OVER_CONFIRM,
]);

const REFUSAL_STATES = new Set(['UNKNOWN_CARD', 'UNSUPPORTED_CARD', 'UNREADABLE_IMAGE']);
const MAX_SHORTLIST = 3;

/**
 * Grade one scan.
 * @param {object} record  manifest row: { photoPath, label, expectedEndState? }
 * @param {object} response { endState, printing, candidates, httpStatus, error }
 */
export function scoreOne(record, response) {
  const r = response || {};
  // Response identity field. The runner sent `identity` while this scorer read
  // `printing`, so a PERFECT scan graded wrong_exact and a wrong one could grade
  // correct by both being undefined. Accept either name, explicitly.
  const got = r.printing !== undefined ? r.printing : r.identity;

  // Infrastructure and auth first: these are not recognition results and must
  // never be graded as correct or incorrect identification.
  if (r.httpStatus === 401 || r.httpStatus === 403 || r.error === 'auth_expired') {
    return v(VERDICT.AUTH_FAILURE, 'authentication failed or expired', { httpStatus: r.httpStatus });
  }
  if (r.error === 'file_not_found') {
    return v(VERDICT.INFRA_ERROR, 'photo file missing from disk', { error: r.error });
  }
  if (r.httpStatus === 429) {
    return v(VERDICT.INFRA_ERROR, 'rate limited (HTTP 429) — not a recognition outcome', { httpStatus: 429 });
  }
  if (typeof r.httpStatus === 'number' && r.httpStatus >= 500) {
    return v(VERDICT.INFRA_ERROR, `server error HTTP ${r.httpStatus}`, { httpStatus: r.httpStatus });
  }
  if (r.endState === 'SOURCE_UNAVAILABLE') {
    return v(VERDICT.INFRA_ERROR, 'identity source unavailable', { endState: r.endState });
  }
  if (r.error) {
    return v(VERDICT.INFRA_ERROR, String(r.error), { error: r.error });
  }

  const label = record && record.label;
  const expectRefusal = !!(record && record.expectedEndState && REFUSAL_STATES.has(record.expectedEndState));

  if (!expectRefusal && !labelIsComplete(label)) {
    const k = identityKey(label) || {};
    return v(VERDICT.UNSCOREABLE_LABEL, 'label lacks a complete printing identity', {
      missing: IDENTITY_AXES.filter((a) => k[a] == null),
    });
  }

  switch (r.endState) {
    case 'EXACT_MATCH': {
      if (expectRefusal) {
        return v(VERDICT.WRONG_EXACT, 'named a printing for a card that should have been refused', { returned: got });
      }
      // Decision-policy check. If the label records that the image cannot
      // distinguish the printings, an automatic answer is wrong REGARDLESS of
      // which card it named: the seller was never given the choice. Picking the
      // labelled card by luck does not redeem the decision.
      if (record && record.expectedEndState === 'NEEDS_CONFIRMATION') {
        return v(VERDICT.POLICY_AUTO_OVER_CONFIRM,
          'answered automatically where the label requires seller confirmation', {
            namedLabelledCard: identityMatches(label, got),
            returned: identityKey(got),
            policyViolation: true,
          });
      }
      if (!record || !record.expectedEndState) {
        return v(VERDICT.UNSCOREABLE_POLICY,
          'label does not state the expected decision, so an automatic answer cannot be judged', {
            hint: 'set expectedEndState to EXACT_MATCH or NEEDS_CONFIRMATION on every label',
          });
      }
      const ok = identityMatches(label, got);
      return ok
        ? v(VERDICT.CORRECT_EXACT, 'automatic exact match on the labelled printing', {})
        : v(VERDICT.WRONG_EXACT, 'automatic exact match on the WRONG printing', {
            expected: identityKey(label), returned: identityKey(got),
            printingAxes: printingAxisReport(label, got),
          });
    }
    case 'NEEDS_CONFIRMATION': {
      if (expectRefusal) {
        return v(VERDICT.WRONG_SHORTLIST, 'offered candidates for a card that should have been refused', {});
      }
      if (!record || !record.expectedEndState) {
        return v(VERDICT.UNSCOREABLE_POLICY,
          'label does not state the expected decision, so confirmation cannot be judged', {});
      }
      const cands = Array.isArray(r.candidates) ? r.candidates : [];
      // top-3 is defined over exactly three candidates; anything beyond is not
      // a short list and cannot be credited.
      const considered = cands.slice(0, MAX_SHORTLIST);
      const hit = considered.some((c) => identityMatches(label, c));
      return hit
        ? v(VERDICT.CORRECT_IN_SHORTLIST, 'labelled printing present in the first three candidates', {
            shortlistSize: cands.length, overLimit: cands.length > MAX_SHORTLIST,
          })
        : v(VERDICT.WRONG_SHORTLIST, 'labelled printing absent from the first three candidates', {
            shortlistSize: cands.length, overLimit: cands.length > MAX_SHORTLIST,
            expected: identityKey(label),
          });
    }
    case 'UNKNOWN_CARD':
    case 'UNSUPPORTED_CARD':
    case 'UNREADABLE_IMAGE': {
      if (expectRefusal) {
        return r.endState === record.expectedEndState
          ? v(VERDICT.CORRECT_REFUSAL, 'refused as expected', { endState: r.endState })
          : v(VERDICT.UNEXPECTED_STATE, `expected ${record.expectedEndState}, got ${r.endState}`, {});
      }
      return v(VERDICT.WRONG_REFUSAL, 'refused a card that carries a complete label', {
        endState: r.endState, expected: identityKey(label),
      });
    }
    default:
      return v(VERDICT.UNEXPECTED_STATE, `unrecognised end state: ${String(r.endState)}`, { endState: r.endState });
  }
}

function v(verdict, reason, evidence) {
  return { verdict, reason, evidence: evidence || {}, isRecognition: RECOGNITION_VERDICTS.has(verdict) };
}

/* ---------- manifest validation and cap ---------------------------------- */

export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') errors.push('manifest is not an object');
  const rows = manifest && Array.isArray(manifest.records) ? manifest.records
    : Array.isArray(manifest) ? manifest : null;
  if (rows === null) errors.push('manifest has no records array');
  else if (rows.length === 0) errors.push('manifest is empty — refusing to report a benchmark over zero scans');
  if (rows) {
    rows.forEach((r, i) => {
      if (!r || !r.photoPath) errors.push(`record ${i}: missing photoPath`);
      const expectRefusal = r && r.expectedEndState && REFUSAL_STATES.has(r.expectedEndState);
      if (!expectRefusal && !labelIsComplete(r && r.label)) {
        const k = identityKey(r && r.label) || {};
        errors.push(`record ${i}: incomplete label (missing ${IDENTITY_AXES.filter((a) => k[a] == null).join(',') || 'label'})`);
      }
    });
  }
  return { ok: errors.length === 0, errors, count: rows ? rows.length : 0 };
}

/** Enforce the hard cap. Throws rather than silently truncating a request
 *  for more scans than authorised. */
export function enforceScanCap(requested, cap = SCAN_CAP) {
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error(`invalid scan count: ${requested}`);
  }
  if (requested > cap) {
    throw new Error(`requested ${requested} scans exceeds the authorised cap of ${cap}`);
  }
  return requested;
}

/* ---------- aggregation --------------------------------------------------- */

export function aggregate(scored) {
  const rows = Array.isArray(scored) ? scored : [];
  const counts = {};
  for (const s of rows) counts[s.verdict] = (counts[s.verdict] || 0) + 1;

  const recognition = rows.filter((s) => s.isRecognition);
  const identifiable = recognition.filter((s) => s.verdict !== VERDICT.CORRECT_REFUSAL);

  const top1 = counts[VERDICT.CORRECT_EXACT] || 0;
  const inList = counts[VERDICT.CORRECT_IN_SHORTLIST] || 0;
  const wrongExact = counts[VERDICT.WRONG_EXACT] || 0;
  const policyAuto = counts[VERDICT.POLICY_AUTO_OVER_CONFIRM] || 0;

  const den = identifiable.length;
  return {
    scansTotal: rows.length,
    recognitionScans: recognition.length,
    identifiableScans: den,
    // Excluded from every accuracy figure, reported so they cannot hide:
    infrastructureFailures: counts[VERDICT.INFRA_ERROR] || 0,
    authFailures: counts[VERDICT.AUTH_FAILURE] || 0,
    unscoreableLabels: counts[VERDICT.UNSCOREABLE_LABEL] || 0,
    unexpectedStates: counts[VERDICT.UNEXPECTED_STATE] || 0,
    unscoreablePolicy: counts[VERDICT.UNSCOREABLE_POLICY] || 0,
    // Automatic answers where the label required confirmation. Counted as
    // incorrect in top-1/top-3 and reported in its own right.
    policyAutoOverConfirm: policyAuto,
    policyAutoOverConfirmRate: den ? policyAuto / den : null,
    top1Accuracy: den ? top1 / den : null,
    top3Accuracy: den ? (top1 + inList) / den : null,
    // Every incorrect automatic exact match, counted. This is the guarantee-
    // critical number: a silent substitution.
    wrongHighConfidenceCount: wrongExact,
    wrongHighConfidenceRate: den ? wrongExact / den : null,
    wrongRefusals: counts[VERDICT.WRONG_REFUSAL] || 0,
    correctRefusals: counts[VERDICT.CORRECT_REFUSAL] || 0,
    countsByVerdict: counts,
    denominatorNote: 'Denominators are counted over EXPECTED LABELS: every row whose label states an identifiable expected decision. Accuracy denominators exclude infrastructure failures, auth failures and unscoreable labels. Refusal-expected rows are excluded from top-1/top-3 and scored separately.',
  };
}
