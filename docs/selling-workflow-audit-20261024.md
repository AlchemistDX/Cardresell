# Selling workflow audit — 2026-10-24

This pass follows a selected card through condition/printing/grade, sale-price assumptions, venue comparison, eBay research and existing draft handoff. It does not certify every feature or enable marketplace publishing.

## Changes

- Printing changes clear an earlier automatic price basis. Delayed pricing responses are scoped to the card, printing, grader, grade, condition and request generation. Refresh cannot overwrite a seller-entered sale price.
- Raw → Graded → Raw remembers the raw printing. Condition-specific provider prices are used directly instead of applying another condition discount.
- The comparison shows the selected identity and the actual sale price used. It explains the shared-price assumption: the ranking compares modeled fees and shipping, not expected marketplace demand.
- Main eBay links update with set, collector number, finish, condition or complete grader/grade. Saved-card research retains the stored grade and metadata. Known TCGs stay in TCG singles, sports in sports singles; searches show recently ended sales first. Research links are labeled as research.
- Nonpositive or nonfinite sale-price entries and negative shipping/cost inputs retract payout recommendations. A venue with an expired fee audit cannot become the winner when every enabled venue is stale.
- TCGplayer Direct cards at $2.49 or less now incur the 50% total fee only. Above that threshold the $1.12 item fee plus normal percentage fees apply. Direct buyer shipping is not seller revenue. Standard marketplace shipping commission remains outside the $75 item commission/Pro cap. The accuracy page and audit date were updated together.
- Existing TCGPriceLookup eBay averages retain their reported 1/7/30-day period and exact condition/grade context. They are labeled as vendor-reported averages, with unavailable sale counts, individual dates and shipping disclosed. They are never presented as a median or a list of verified comps.
- The sold-listing adapter now requires explicit valid sold dates and defaults to 30 days (7/90 also supported). It retains real listing IDs, removes duplicate IDs, and excludes undated/future/old results, lots/proxies, price ranges, non-USD amounts and obscured accepted-offer prices. Reviewable listing links show dates and item prices. Candidate matches never automatically replace the selected price. Provider access denials still trigger the shared cooldown.

## Verification

The broad local sweep covered all 147 registered suites. Two production-only paths were excluded: the opt-in live Redis suite and the live endpoint smoke suite. The latter includes production mutation endpoints and is replaced by targeted read-only release checks. An old raw-median-cache expectation and an audit-date expectation were updated to the corrected behavior; the dated-candidate rendering regression found by the new test was fixed and rerun.

The final focused pass runs 19 suites, including the shipped app at 390/1280 px, delayed response protection, manual price protection, condition quote selection, recent-sale parsing/rendering, venue fees, grade controls, saved-card links, scan-to-draft, customer navigation, listing packets, and asset fingerprints. Browser tests use synthetic accounts/providers; Redis tests use isolated local databases. No paid scans, live marketplace listings or customer record writes are used.

## Live boundary still open

Production eBay sold-search retrieval returned HTTP 403 during this audit (runtime event 2026-10-24T17:25:09.498Z). Connecting an eBay seller account does not establish access to market-wide completed-sale data. We have not established this application's Marketplace Insights entitlement. Automatic individual sold comps therefore remain unavailable in production until a permitted feed is available. Manual recent-sale research remains usable; aggregate averages appear only where the existing provider actually supplies them.

Publishing and automatic sales synchronization remain disabled. This release does not claim a live seller publication or an end-to-end marketplace sale was tested.

## Primary references checked

- [TCGplayer fee schedule](https://help.tcgplayer.com/hc/en-us/articles/201357836-TCGplayer-Fees) — low-value Direct fee replaces other charges; current seller tiers.
- [TCGplayer cap FAQ](https://help.tcgplayer.com/hc/en-us/articles/37531606328727-Marketplace-Fee-Cap-Increase-FAQ) — combined commission/Pro item cap.
- [TCGplayer fee examples](https://help.tcgplayer.com/hc/en-us/articles/360047732673-Fee-Calculation-Examples) — shipping commission is uncapped.
- [TCGplayer Direct June 18 change](https://seller.tcgplayer.com/blog/simpler-and-more-predictable-fees-coming-for-tcgplayer-direct-june-18) — per-item fees and removal of $0.30 Direct processing charge.
- [TCGPriceLookup API](https://tcgpricelookup.com/tcg-api) and [API reference](https://tcgpricelookup.com/docs/api-reference?endpoint=price-history) — reported eBay averaging windows.
- [eBay supported marketplaces/API access](https://developer.ebay.com/api-docs/buy/static/ref-marketplace-supported.html) — Marketplace Insights restricted availability.
