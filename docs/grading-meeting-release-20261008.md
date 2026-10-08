# Grading meeting preparation — 2026-10-08

Baseline: production `d9b32962642fe145775a065f111057d0ab7f68a2`.

## Product changes

- Choose valid final centering evidence before applying the grade ceiling.
  A stale model-estimated ceiling no longer survives replacement by valid CV
  ratios. This corrects ordering; it does not change PSA threshold policy or
  calibrate the underlying models.
- Report centering provenance independently from CV-job success: measured,
  mixed, model_estimated or unknown, with per-axis provenance in the response.
  Partial/invalid CV ratios cannot label model estimates as fully measured.
- Reject blank, boolean, out-of-range and nonnumeric CV grades. Ratios must
  represent plausible percentages rather than arbitrary number fragments.
- Reconcile grade weights after all grade caps, combine duplicate buckets and
  normalize to 100. Withhold an invalid or contradictory distribution.
- Remove the misleading CV-VERIFIED wording. State that the CV step completed;
  explicitly identify percentages as uncalibrated AI weights.
- Publish immutable `core.cee58f73.js`; retain the previous bundle intact.

## Meeting and scoring materials

- `docs/card-shop-test-sheet-20261008.html`: printable 15-card recording sheet.
- `docs/card-shop-grading-test-20261008.md`: blind test protocol and record schema.
- `tools/score-grade-benchmark.mjs`: offline scoring; separates certified/shop
  references, graders, Quick/Deep and raw/slabbed captures. First attempts count
  toward agreement; repeats measure consistency. Keeps errors and exclusions.

## Validation

- Full local gate: 87 slots, 84 executed successfully, three explicitly skipped
  (managed-store opt-in, production smoke under --local, condition-pill opt-in).
- Separate full scan-handler suite: 40 passed, including stale centering-cap
  replacement and partial/no-ratio provenance through the production handler.
- Grading evidence/benchmark 48, async grader 32, grade upside 12, capture budget
  28, asset fingerprints 101. These overlap the full-gate totals.
- Bulk browser fixture: 96 passed, including actual successful fixture scans,
  batch selection, draft creation, retries, copies and cap refusal.
- Repaired four existing test completion markers and supplied the stable signed
  fixture user expected by scan-request in the bulk browser test. No auth or
  ownership check was weakened in production.
- Printable sheet rendered in Chromium: 15 rows, no horizontal overflow at
  1200px. Syntax, release inspection and whitespace checks passed.
- No customer credits, paid provider scans, purchases or account changes.

## Production observations and limits

Before deployment, health/catalogue/cutover endpoints returned 200. Cutover
confirmed baseline commit, purchasing enabled, billing not paused, accepted
datastore authorization, installed fence and no mutation.

Existing production logs include upstream eBay sold-search 403 responses and
Node url.parse deprecation warnings on price routes. This release does not fix
the upstream restriction. Catalog expansion, instant-match printing ambiguity,
real-phone acceptance and calibration remain open. Overall readiness stays
approximately 85%; this is a planning estimate, not measured accuracy.

Camera-guide work stays paused and pilot admission stays in place. Do not claim
the grader is perfected or publish an accuracy percentage from regression tests.
