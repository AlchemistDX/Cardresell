# Binder crop resolution correction — October 12, 2026

The owner's 1179 × 1478 nine-card photo was rejected before crop review.
The grid checked the unpadded cell width against the photo-QC 400px minimum,
although the JPEG actually submitted includes an existing 4% margin. In addition,
automatic fitting chose margins of 6%, 1%, 2%, 3%, making the actual crops too
small even after correcting that mismatch.

The binder now validates the final rounded, padded and size-capped JPEG
dimensions. If automatic trimming fails that same limit but the full-photo grid
passes, it falls back to the full photo and explicitly asks the user to check
that each box contains one whole card. Manual adjustments are never overridden.
The 400px minimum, blur check, overlap, no-upscaling rule, credit confirmation,
and provider/billing paths are unchanged. Genuinely undersized crops still block.

## Verification

- Reproduced the failure before the fix with a synthetic 1179px-wide 3×3 page.
- Binder browser suite: 64 checks across portrait and landscape, including the
  private owner image supplied through `CR_BINDER_REGRESSION_PHOTO`. The image
  is not committed. Nine previews, nine unique physical scan identities, correct
  nine-credit quote, cancellation and zero provider requests were verified.
- Owner JPEG outputs are 409 or 424px wide, 512 or 532px high. All nine passed
  the existing local photo-QC resolution and blur checks in both orientations.
- A 1152px synthetic page produces 399px corner outputs and remains blocked.
- Multipage: 24 checks; automatic selection: 53; bulk photo preflight: 14;
  immutable asset fingerprints: 109. Build inspector passed.

This verifies preparation and local quality checks, not recognition accuracy,
set/variant matching, provider inference or physical-iPhone Safari acceptance.
No credits were spent in these checks. The old immutable bundle remains intact;
the entry page references `binder.d49de77b.js`.
