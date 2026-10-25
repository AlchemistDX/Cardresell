# Evidence-based price ranges — 2026-10-25

The price chooser previously manufactured lower and higher asks by subtracting and adding 15% to a single source reference. That did not measure a market range. This release removes that fallback entirely.

## Result

- Price evidence shows Listed low and Listed high only when the selected condition has TCGplayer endpoints from the same source and a valid provider update within seven days. Mixed, undated, future-dated, stale, clamped and mismatched-condition endpoints remain ineligible.
- Listing prices are labeled as asks, not completed sale prices or sale-speed predictions. The provider reference is not described as a measured midpoint.
- When there is only one guide value or rolling sold average, the chooser offers that one reference and explains that highs and lows are unavailable. It draws no artificial range bar.
- Graded selections retain their separate published-value-by-grade ladder. Values from other grades never become low/high endpoints for the selected grade.
- Prices retain cents at every amount. Distinct one-cent endpoints cannot both be selected, and a rounded reference cannot hide the actual listed high. Large prices wrap as whole choices on narrow displays.
- The position bar ends at the reported endpoint, without an extra 8% upper padding or unsupported cheap/expensive colors.
- Endpoint selection updates the selling calculation and draft request. Condition changes use matching evidence and retract unavailable strategies; hand-entered prices are preserved.
- Visible help and the public accuracy page document these rules. The price-evidence source now has a reproducible immutable-asset builder and a source-parity gate.

## Validation

The complete local regression run passed: 165 executed suites across 167 registered slots. The live managed-Redis probe and production mutation smoke were intentionally skipped. The condition browser gate ran, and external service traffic was blocked during fixture tests.

Focused checks passed: quick pricing (235), price evidence and identity (40), and real-browser selling workflow (180). Browser coverage includes 320, 390 and 1280 pixel widths, light and dark themes, selected-condition changes, exact draft prices, hand-entered overrides, stale/undated evidence, graded averages, one-cent endpoints, five-digit amounts and no horizontal overflow. Screenshots were reviewed. Asset fingerprints (270), test registration (12), configured deployment inspection and whitespace validation passed.

The first full attempt was deliberately interrupted after an additional high-value mobile check found clipping with cents retained. The final complete run covers the responsive fix. Historic assertions requiring the retired percentage feature were replaced with evidence-only requirements; fee, source-provenance and selected-identity protections remain covered.

## Evidence and limits

The provider documentation describes TCGplayer low/mid/high as active listing statistics and eBay values as rolling averages: https://tcgpricelookup.com/tcg-api . An average does not establish individual-sale extrema.

A read-only production lookup of the current eBay sold feed returned `available:false`, `reason:provider_unavailable`, no candidates and null low/high on 2026-10-25. This release does not make that feed available or imply that the linked seller account grants market-wide sold-data access. Missing evidence stays visible. No provider restriction was bypassed.

These tests demonstrate selection, provenance gates and UI/API handoff using controlled data. They do not independently validate every provider quote or promise a realizable selling price. No seller listings or customer inventory were changed, and no paid recognition scans were run. Machine-readable evidence is in `evidence-price-ranges-20261025.json`.
