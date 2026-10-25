# Selling priority and draft handoff — 2026-10-25

The selling goal used to update a small advice box while the dominant payout table stayed unchanged. “Least work” ignored CardResell’s eBay workflow. This release makes the chosen priority the primary recommendation and collapses numerical fee comparisons by default.

## Result

- “Least work in CardResell” prioritizes eBay draft review and CSV export. eBay remains available under the other shipping-compatible goals, even when a different venue has a higher modeled payout.
- Highest payout uses enabled, applicable venues with current fee schedules. Quick cash guidance requests real buyer offers without claiming an unverified sale speed. No-shipping and local preferences are respected.
- Single-card draft preparation uses the existing approval and idempotency flow, preserving selected printing, condition, asking price, provenance and physical-copy identity. Old selection or account callbacks cannot continue.
- Collection planning opens the existing reviewed batch for exactly the selected inventory copies. Scan planning returns exactly the selected rows and quantities to finish review. Neither action automatically publishes listings.
- Planning price edits remain estimates. The next review uses saved source prices and explains this distinction; inventory is not silently overwritten.
- The existing eBay connection dialog provides authoritative status. A connection is not presented as direct publishing or sales synchronization.

## Validation

The complete local regression run passed: 165 executed suites across 167 registered slots. The live managed-Redis probe and production mutation smoke were intentionally skipped. The condition browser gate ran. External service traffic was blocked; browser/API/Redis fixtures were local.

The new browser gate passed 114 checks at 320, 390 and 1280 pixels, including all priorities, selected-copy handoff, disabled eBay fee comparisons, same-user new sessions, stale inventory, scan quantities, missing prices, and no seller writes. Additional selling advice (65), selling plan (186), selection (48), customer journey (170), fee disclosure (47), and buyer-tax (75) checks passed. Existing fee amounts were not changed to make tests pass.

Mobile and desktop screenshots were reviewed in light and dark themes. The main eBay action is ahead of the expandable explanations. Asset fingerprints, source parity, test registration, configured deployment inspection, and whitespace checks passed. Machine-readable evidence is in `selling-next-step-20261025.json`.

## Release limits

This update changes the selling recommendation and preparation workflow. It does not enable direct eBay publication or automatic sales synchronization, promise marketplace demand, or change recognition and pricing providers. Existing buyer-program data was preserved from the previously shipped selling-plan asset while restoring parity with its maintained source.
