# Optional eBay buyer-tax assumption — 2026-10-14

Adds an optional rate in Advanced options. Default is **Not estimated**; an explicit 0% is a separate, disclosed assumption. The rate applies to eBay estimates during the current visit and is not saved in the seller profile or draft packet. Reload resets it. No jurisdiction or buyer address is inferred.

The fee model applies the selected rate to item price plus buyer-paid shipping. The resulting tax enters the final value fee tiers, per-order threshold, and selected Promoted Listings fee. Seller revenue remains item price plus buyer-paid shipping. The buyer tax is metadata, not a fee deduction or seller income. Estimates retain full precision internally and round for display; actual checkout tax, shipping exceptions, and settlement rounding can differ.

The same rate reaches venue ranking, bulk lot-versus-singles comparisons, the maximum buy target derived from that ranking, target-net inversion, and the shared grading fee calculation. Draft review uses the current visit's rate with its existing item-only scope; draft shipping remains separately disclosed and excluded. Grading comparisons and CSV exports include the rate disclosure. Other venues and the separate manually entered percentage calculator retain their existing behavior.

Fee model revision increases from 1 to 2. The frozen fee grid now includes unknown, explicit-zero and 8% scenarios. Committed immutable assets remain available under their previous names.

## Worked check

For a $100 item, $5 buyer shipping, $4 seller postage, 8% assumed buyer tax, no Store, and 5% promoted rate:

- Estimated buyer tax: $8.40; fee base: $113.40.
- Final value fee: $15.0255; per-order fee: $0.40; promoted fee: $5.67.
- Estimated net: $100 + $5 − $15.0255 − $0.40 − $5.67 − $4 = $79.9045 (displayed $79.90).

## Sources re-read

- [eBay selling fees](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822): tax-inclusive sale total, per-order threshold, trading-card tiers.
- [eBay general campaign strategy](https://www.ebay.com/help/selling/ebay-advertising/promoted-listings/general-campaign-strategy?id=4164): promoted fee uses total sale amount including tax and shipping.

## Release validation

- Monetary regressions cover unknown versus zero, tax-inclusive shipping, promotions, both Store tiers, Top Rated Plus scope, per-order boundary, invalid inverse inputs, and lowest-cent target pricing.
- Browser regression exercises the shipped input event, actual ranking, buy target, grading recalculation, export disclosure, draft fee rendering, other-venue isolation and reload behavior at 320, 390 and 1280 px in both themes.
- Full local regression runner is the required pre-push gate. Tests use synthetic data and local service fixtures; no paid scans, customer writes or marketplace listings.
