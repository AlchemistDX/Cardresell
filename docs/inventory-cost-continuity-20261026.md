# Purchase-cost continuity — 2026-10-26

Blank scan costs previously became $0 when saved to Collection. That made a card with an unknown purchase cost appear to have been free. The Collection detail popup also treated a missing value as break-even and omitted the minus sign from a loss.

## Changes

- Blank, skipped, and explicitly entered zero costs remain distinct. New Collection copies include purchase-cost metadata for the sale form.
- Upfront, pack-sheet, and per-card inputs reject negative/non-finite costs without losing the batch. Physical-copy expansion, partial saves, unknown allocations, and failed-storage retries preserve their existing safeguards.
- Unidentified copies retain their pack-cost share. The first successful allocation stays frozen; the selling planner uses the actual acknowledged cost of each saved row.
- Manual Collection entries also retain evidence of explicitly entered zero costs when opening Mark Sold.
- The Collection popup and portfolio table display unknown values without inventing gains. Known losses retain their minus sign. Portfolio gains exclude incomplete copies and explain the exclusion. Unknown gain rows sort after known gains.
- Cost explanations remain readable in both themes. Unrealized gains are labeled before selling expenses.

The existing sale-completeness and export logic now receives the correct input. No historical records are rewritten: an old zero may represent a genuinely free card.

## Verification

The new browser regression failed on the original shipped source and passes on the updated source. It uses the actual shipped page, local account-scoped persistence, reload, real CSV download, and Mark Sold/report handoff at 390px and 1280px. It verifies unknown versus zero, partial/recovered saves, invalid inputs, storage failure/retry, the frozen allocation, loss signs, missing values, and light/dark cost copy. External/API requests are blocked; no live customer, paid scan, or marketplace writes were performed.

All 17 focused suites completed successfully. The existing bulk workflow also covers 320px and landscape layouts. Syntax checks and git diff whitespace checks passed. The test evidence JSON records individual summaries and log hashes.

| Suite | Exit | Seconds |
| --- | ---: | ---: |
| inventory-cost-continuity-browser | 0 | 5.1 |
| bulk-workflow-browser | 0 | 16.1 |
| selling-plan-browser | 0 | 9.9 |
| selling-next-step-browser | 0 | 24.1 |
| scan-hygiene-2026-09-04 | 0 | 0.7 |
| majors-flip-and-pack-2026-09-04 | 0 | 0.2 |
| flip-report-browser | 0 | 17.1 |
| sale-recovery-browser | 0 | 5.4 |
| collection-export | 0 | 0.2 |
| scan-finish-browser | 0 | 14.9 |
| customer-journey-browser | 0 | 44.3 |
| entry-identity | 0 | 13.1 |
| listing-export-e2e | 0 | 2.1 |
| listing-photos | 0 | 44.1 |
| brand-ui-browser | 0 | 64.5 |
| asset-fingerprints | 0 | 1.3 |
| test-registry | 0 | 0.2 |

## Runtime assets

- `js/core.62122bf2.js` replaces the active reference to `js/core.1315d3d2.js`.
- `js/ui.0b956b73.js` replaces the active reference to `js/ui.4b94275c.js`.
- `js/selling-plan.9de9581d.js` is generated from maintained `js/selling-plan.js`.

Previously deployed immutable assets remain byte-for-byte unchanged. Although the new core/UI files are large immutable copies, semantic changes are confined to the cost save/display paths described above. The asset fingerprint gate validates the active references.

## Limits

This release does not establish scanner recognition accuracy or new eBay sold-comparable access. It does not change marketplace publishing, fees, or sales synchronization. It is a focused cost/workflow release, not a certification that every site feature is complete.
