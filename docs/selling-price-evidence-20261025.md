# Selling workflow and price evidence — 2026-10-25

This pass follows a selected card through condition/finish/grade, price choices, marketplace comparison, recent-sale research, collection actions and listing-draft requests. It improves evidence handling; it does not measure real-world price prediction error or certify a live marketplace sale.

## Findings and changes

- The alternate graded lookup preferred a matching collector number before checking the card name. It also discarded denominators and could fall back to the rarest same-name card. It now requires matching name, collector number and the known set, rejects conflicting denominators and name symbols, and withholds ambiguous results. An explicit selected finish must match the provider variant. A changed card or selling selection invalidates an in-flight response before it can bind a catalog ID.
- The alternate graded lookup used the 30-day and 1-day sale averages as low/high endpoints. It now shares the main normalizer, retaining the actual averaging window and leaving endpoints absent. Provider update times travel with each quote; loading graded data does not refresh the age of earlier raw quotes.
- Fresh TCGplayer low/high values from one exact-condition block can drive the Lower ask / Reference / Upper ask choices. The reference is included only when it falls strictly between the endpoints; it is never described as the measured midpoint. Mixed-source, clamped, reversed, equal, missing or nonfinite endpoints are ineligible.
- An eligible asking range needs a valid, nonfuture provider update no more than seven days old. Seven days is a product freshness cutoff, not a statistically calibrated accuracy threshold. Older and undated endpoints remain labeled reference information and do not drive observed asking choices. A provider update is not an individual sale date.
- Without suitable endpoints, the existing ±15% choices remain explicitly calculated suggestions. They no longer imply faster sales or a patient-seller premium. A guide or rolling average does not establish a measured sale-price range.
- The headline and marketplace comparison distinguish the evidence from the asking price used for payouts. An unscoped low/mid/high feed cannot advertise an exact-condition range. Marketplace comparison continues to apply the same chosen price to each enabled venue; it compares modeled fees and shipping, not demand.
- A chosen asking strategy follows a new condition's supported quote. If that strategy disappears, its price and selection are cleared. Hand-entered prices are preserved. The selected price and condition reach the draft request unchanged.
- Compact labels, wrapping and 44-pixel-or-larger tested buttons keep the price choices usable at narrow mobile widths. The help panel describes both reported endpoints and calculated choices consistently.

## Workflow coverage

| Stage | Evidence in this pass |
| --- | --- |
| Selected card / printing | Exact-name, set, number, denominator, finish, ambiguity and delayed-response regressions |
| Condition / grade pricing | Independent condition quotes, no double condition discount, aggregate averages never used as endpoints |
| Price and venue choices | Reported endpoint choices, explicit calculated fallback, manual-price protection, venue changes preserve price |
| Recent eBay research | Same card, full collector number and condition retained; recently ended order retained; existing dated-candidate filtering regressions |
| Draft preparation | Real shipped browser sends the selected price and condition through the actual draft handler; synthetic API captures requests |
| Batch / collection | Existing scan-finish, batch preparation, collection-draft, selling-advice, selling-plan and customer-journey gates |
| Publication / completed sale | Not exercised; this release does not enable live listing publication or automatic sales synchronization |

## Verification

All 158 runnable checks in the 160-slot release runner passed. The two intentional skips are live Redis and the production mutation smoke suite. Ten additional focused gates passed (including the repeated asset-fingerprint gate); the final affected reruns also passed. The new rules have 37 assertions and the full selling-price browser flow has 84 assertions across three widths. Detailed results are recorded in the companion JSON. Tests use the shipped assets, local Chromium and isolated Redis where needed, with synthetic authentication/provider boundaries and external network blocked. No paid scans, live listings, purchases or customer-record writes are used.

The new price-evidence test was first run against the previous core and reproduced the unsafe graded matching and average-as-range behavior. The fixes are checked through pure evidence rules and the full browser flow at 320, 390 and 1280 pixels. Earlier source-based assertions that pinned the old labels/render calls were updated to check the new comparability and disclosure behavior; independent browser assertions verify the outcome.

## Remaining limitations

- Automatic individual eBay sold comps were unavailable in the preceding production audit; no new permitted data feed or account entitlement is established by this release. eBay's public documentation still says Marketplace Insights is restricted and not open to new users. Seller OAuth linking alone is not evidence of market-wide sold-data access.
- TCGPriceLookup rolling sold averages may be shown when supplied, but sale counts, individual dates and shipping are not supplied by the consumed aggregate. These are not independently verified matched transactions or a confidence interval.
- An asking low/high range is the spread of listed prices, not an expected sale range. Condition multipliers and ±15% choices remain estimates where no comparable quote exists.
- Strict matching can reduce quote availability when provider names, set labels or variants are incomplete. Missing evidence is preferable to using a different printing's price.
- Live scanner recognition accuracy and end-to-end marketplace publication/sale handling are outside this verification. The existing runtime `url.parse` deprecation remains outside this change.

## Primary documentation checked

- [TCGPriceLookup API](https://tcgpricelookup.com/tcg-api): condition price blocks, active-listing low/mid/high, rolling eBay averages, provider `updated_at`, and separate variant IDs.
- [eBay Buy API support](https://developer.ebay.com/api-docs/buy/static/ref-marketplace-supported.html): Marketplace Insights access restriction.
