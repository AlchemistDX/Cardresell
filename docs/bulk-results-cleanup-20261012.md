# Bulk results cleanup — 2026-10-12

The owner’s two phone recordings confirmed scanning worked but showed a crowded summary and completion actions. Pack cost belongs at the start; card value should count up and remain visible during scanning.

## Changes

- Fixed total above a separately scrolling card list; compact count and explicit missing-price status. Opaque overlay keeps the underlying page from competing with results.
- Removed repeated cost and before-fee profit text from the running total. At completion, a selection becomes the main value; partial selections retain a small all-card subtotal. No price is inferred for unpriced cards.
- Save and Compare are the primary actions. Draft creation, review, and further scanning are under More actions. Top-right close remains available.
- Fixed a completion lifecycle bug: `_bulkResetBottomBarButtons` rebuilt an older footer and removed Compare selling. It now clones the action template and preserves the completion announcement.
- Add all to Collection uses the upfront pack cost, split per physical copy (including merged quantities), without a second cost-entry sheet. Blank, negative, and nonfinite costs default to zero.

- Failed identifications have no checkbox, cannot be toggled, are excluded by Select all, and any stale selection is removed. They can be removed explicitly. Identified but unpriced cards remain distinct from identification failures.
- Matching-card review lists every group instead of naming one pair while grouping all. It lives under More actions and explains that grouping keeps copies; accidental repeated scans must be removed. Game, language, finish and condition differences prevent merging, and incomplete catalogue identities remain separate.

## Verification

- Selling-plan browser suite: 186 checks, including actual completion/footer rebuild, total accumulation, selection, fixed summary, menu access, upfront cost allocation, all nine matching groups from a repeated nine-card page, conservative merge identity, and comparison across 320/390/844/1280 widths. Fee inputs are fixtures; provider requests are blocked.
- Bulk batch draft suite: 110 checks through shipped bundles, real queue and draft handlers with local provider/auth/store substitutes. Verified visible save action persists the upfront cost and does not open the cost sheet. No live provider credits or publishing.
- Existing flip/pack regression: 100 checks. Immutable asset fingerprints: 111 checks. Build release inspector passed.
- User photos and recordings remain outside the repository.
