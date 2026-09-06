// api/_conditionDescriptors.js — condition + condition-descriptor block
//
// Phase 1, Block B3.
//
// ── The thing this file exists to NOT do ──
// eBay's condition descriptors are enumerated on BOTH sides. We know the
// descriptor NAME ids (27501 grader, 27502 grade, 27503 cert, 40001 ungraded
// condition) because they are published. We do NOT know the descriptor VALUE
// ids — the integer that means "PSA" in field 27501, or "10" in field 27502.
// Those come from getItemConditionPolicies, which requires a user access token
// we do not have until Phase 2.
//
// A guessed value id does not fail loudly. It succeeds and produces a listing
// that says the wrong grade. That is the single worst bug available in this
// product: a PSA 10 listed as a PSA 6 is a real financial loss for a real
// seller, caused by us inventing a number. So this module REFUSES to emit an
// API payload while DESCRIPTOR_VALUES_RESOLVED is false, and there is a test
// asserting the refusal.
//
// What it does emit is a human-readable handoff block. In Phase 1 nothing is
// submitted to any venue — the seller pastes into eBay's own form and picks
// the condition from eBay's own dropdown. Our job is to tell them exactly what
// to pick, not to pick it for them over an API we cannot yet address.

import {
  CONDITION, CONDITION_DESCRIPTOR, DESCRIPTOR_VALUES_RESOLVED, SUPPORTED_GRADERS,
} from './_ebayTaxonomy.js';

import { canonicalGrader, canonicalGrade, canonicalCert, isSlab } from './_cardIdentity.js';

/**
 * Validation codes. Severity follows Revision 4 of the Phase 1 checklist:
 * only ERROR blocks the handoff.
 *
 * UNRESOLVED_CONDITION_DESCRIPTOR is deliberately a WARNING in Phase 1. An
 * external review argued for ERROR. That would block every graded card — and
 * graded cards are the entire wedge — to guard against a submission Phase 1
 * never makes. It becomes an ERROR in Phase 2, when a payload is actually
 * sent and a wrong value id could reach a live listing.
 */
export const SEVERITY = { ERROR: 'ERROR', WARNING: 'WARNING', INFO: 'INFO' };

export const CONDITION_CODES = {
  UNRESOLVED_CONDITION_DESCRIPTOR: 'UNRESOLVED_CONDITION_DESCRIPTOR',
  UNSUPPORTED_GRADER:              'UNSUPPORTED_GRADER',
  MISSING_CERT_NUMBER:             'MISSING_CERT_NUMBER',
  RAW_CONDITION_SELLER_CHOICE:     'RAW_CONDITION_SELLER_CHOICE',
};

/**
 * Build the condition block for a card.
 *
 * Graded → condition 2750 ("Graded") plus descriptors 27501/27502/27503.
 * Raw    → condition 4000 ("Ungraded") plus descriptor 40001.
 *
 * `descriptors` here are LABELLED INTENTS, not API values: each carries the
 * descriptor name id we know and the human string the seller should select.
 * `apiReady` is false until value ids are resolved.
 */
export function buildConditionBlock(row = {}) {
  const graded = isSlab(row);
  const notes = [];

  if (!graded) {
    // Raw: we do not assert a condition. We have not inspected the card, and
    // our own estGrade is a scan heuristic, not a condition claim.
    notes.push({
      code: CONDITION_CODES.RAW_CONDITION_SELLER_CHOICE,
      severity: SEVERITY.INFO,
      message: 'Pick the card condition in the listing form. We do not guess condition on raw cards.',
      descriptorNameId: CONDITION_DESCRIPTOR.UNGRADED_CONDITION,
    });

    return {
      graded: false,
      conditionId: CONDITION.UNGRADED,
      conditionLabel: 'Ungraded',
      descriptors: [
        {
          nameId: CONDITION_DESCRIPTOR.UNGRADED_CONDITION,
          name: 'Card Condition',
          intendedValue: null,          // seller's choice, never ours
          valueId: null,
          resolved: false,
        },
      ],
      apiReady: false,
      notes,
    };
  }

  const grader = canonicalGrader(row);
  const grade  = canonicalGrade(row);
  const cert   = canonicalCert(row);

  if (!SUPPORTED_GRADERS.includes(grader)) {
    // An unrecognized grader is not a reason to silently pretend it is PSA.
    notes.push({
      code: CONDITION_CODES.UNSUPPORTED_GRADER,
      severity: SEVERITY.WARNING,
      message: `"${grader}" is not one of the graders eBay enumerates `
             + `(${SUPPORTED_GRADERS.join(', ')}). List it, but set the grader field by hand.`,
      grader,
    });
  }

  if (!cert) {
    notes.push({
      code: CONDITION_CODES.MISSING_CERT_NUMBER,
      severity: SEVERITY.WARNING,
      message: 'No cert number on this slab. Buyers use it to verify the grade, '
             + 'and without it two identical grades cannot be told apart.',
      descriptorNameId: CONDITION_DESCRIPTOR.CERT_NUMBER,
    });
  }

  const descriptors = [
    {
      nameId: CONDITION_DESCRIPTOR.PROFESSIONAL_GRADER,
      name: 'Professional Grader',
      intendedValue: grader,
      valueId: null,
      resolved: false,
    },
    {
      nameId: CONDITION_DESCRIPTOR.GRADE,
      name: 'Grade',
      intendedValue: grade,
      valueId: null,
      resolved: false,
    },
  ];

  // Cert is free text on eBay's side rather than an enumerated value, but we
  // still only include it when we actually have one.
  if (cert) {
    descriptors.push({
      nameId: CONDITION_DESCRIPTOR.CERT_NUMBER,
      name: 'Certification Number',
      intendedValue: cert,
      valueId: cert,        // free text — no enumeration to resolve
      resolved: true,
    });
  }

  if (!DESCRIPTOR_VALUES_RESOLVED) {
    notes.push({
      code: CONDITION_CODES.UNRESOLVED_CONDITION_DESCRIPTOR,
      severity: SEVERITY.WARNING,   // ERROR from Phase 2 — see header
      message: 'Grader and grade value ids are not resolved yet. Select them from '
             + 'the listing form\'s own dropdowns; do not type them.',
      unresolved: [
        CONDITION_DESCRIPTOR.PROFESSIONAL_GRADER,
        CONDITION_DESCRIPTOR.GRADE,
      ],
    });
  }

  return {
    graded: true,
    conditionId: CONDITION.GRADED,
    conditionLabel: 'Graded',
    grader,
    grade,
    cert: cert || null,
    descriptors,
    // Only true when every enumerated descriptor has a real value id.
    apiReady: DESCRIPTOR_VALUES_RESOLVED && descriptors.every((d) => d.resolved),
    notes,
  };
}

/**
 * The API payload form — the one that must refuse.
 *
 * Returns { ok: false, ... } rather than throwing, so a caller that forgets to
 * check gets a falsy `ok` and an empty payload instead of an exception it might
 * catch and ignore. There is no code path here that fabricates a value id.
 */
export function buildConditionPayload(row = {}) {
  const block = buildConditionBlock(row);

  const unresolved = block.descriptors.filter((d) => !d.resolved);
  if (unresolved.length) {
    return {
      ok: false,
      payload: null,
      refusedBecause: CONDITION_CODES.UNRESOLVED_CONDITION_DESCRIPTOR,
      unresolvedNameIds: unresolved.map((d) => d.nameId),
      message: 'Refusing to emit a condition payload with unresolved descriptor value ids. '
             + 'Resolve them via getItemConditionPolicies (needs a user token, Phase 2). '
             + 'A guessed value id would publish a wrong grade, which fails silently.',
    };
  }

  return {
    ok: true,
    payload: {
      condition: block.conditionId,
      conditionDescriptors: block.descriptors.map((d) => ({
        name: d.nameId,
        values: [{ value: d.valueId }],
      })),
    },
  };
}

/** Human-readable handoff lines for the Phase 1 copy-and-paste screen. */
export function conditionHandoffLines(row = {}) {
  const b = buildConditionBlock(row);
  if (!b.graded) return ['Condition: Ungraded — choose the condition yourself in the listing form'];
  return [
    `Condition: Graded`,
    `Professional Grader: ${b.grader}`,
    `Grade: ${b.grade}`,
    ...(b.cert ? [`Certification Number: ${b.cert}`] : []),
  ];
}
