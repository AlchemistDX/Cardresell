# Guided binder-page scanning — 2026-10-08

## Scope

Bulk ID Scan now offers a guided binder-page upload. Choose a 2×2, 3×3,
3×4, 4×3, or 4×4 pocket layout, rotate if needed, trim the outside background,
and review the individual crops. All pockets begin unchecked. Only selected
pockets enter the existing bulk credit-confirmation and scan/refund flow.
The quote remains one ID credit per selected pocket. Each selected physical
copy gets its own scan identity, including copies with identical artwork.

Cropping takes place in the browser; the original page is not submitted to
an identification provider. Crops are JPEG at quality 0.95, at most 1,400 pixels
on the longer side, without upscaling. Photos are limited to 25 MB and
50 megapixels and resized to at most 6,000 pixels before cropping. Crops below
200 pixels on either side are rejected. Closing or replacing a page invalidates
pending image work and releases preview URLs.

This is a manually aligned rectangular grid, not automatic pocket detection
or perspective correction. It identifies cards, not grades. A selected pocket
is not a verified card: the user must omit empty, obstructed, blurry, or
cut-off pockets. Sleeve glare and steep camera angles can still prevent an ID.
Real binder-page recognition accuracy and iPhone Safari acceptance remain
unmeasured; synthetic browser checks establish mechanics, not model accuracy.

Two existing regression issues were also corrected: the grading library
picker now advertises its supported formats rather than all image formats,
and its tips link uses the accessible gold text token.

## Verification

- `CR_CHROMIUM=/tmp/camera-review/chromium node tests/binder-scan-browser.mjs`:
  46 checks passed across 390×844 and 844×390. Real shipped DOM, image pipeline,
  and bulk handoff; synthetic colored pages; external requests blocked.
- Correct crop positions/pixels, resolution, rotation, margin adjustments,
  selection count, confirmation cost, separate physical identities, repeated
  handoff, cancellation during decode, unsupported input, and low resolution.
- Existing grade-upload/single-draft browser gate passed at both orientations.
- The 89-slot local runner completed. Two Redis-dependent suites could not start
  using Unix sockets on this host; both passed separately with the existing
  isolated TCP test mode (4 and 27 checks). All other executed suites passed;
  live/opt-in skips remain skips, not passes.
- No provider inference, purchases, or customer credit consumption in these tests.
- Browser suite is declared as a required separate release gate in test-registry.

## Phone acceptance checklist

1. Open Bulk ID Scan → Binder page · Guided. Upload a straight-on page with
   several known cards and at least one empty pocket.
2. Set the matching layout. Adjust grid edges until each preview includes one
   whole card. Rotate and verify the row/column positions if necessary.
3. Select three cards, leaving the empty pocket unchecked. Verify that both
   review and confirmation quote exactly three ID credits. Cancel first and
   verify the account balance has not changed.
4. Repeat and submit when ready. Verify the identity, set, collector number,
   and variant for each selected card; record mismatches separately from cards
   that were not identified. This step intentionally spends ID credits.
5. Test two copies of the same card: both should remain represented in the
   result quantity and any drafts. Try the existing collection/draft actions.
6. Try glare, an angled page, and a small image. A low-resolution crop must be
   rejected. For unreadable previews, skip the pocket and use a single-card photo.
7. Cancel while a page opens, then reopen the flow. No old previews or selections
   should return. Check portrait and landscape, including scrolling to confirmation.
