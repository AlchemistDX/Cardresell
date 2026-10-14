# External review follow-up

Reviewed October 13, 2026, America/New_York (October 14 UTC).
Baseline: production commit `0fd0b7626aaead4441a250c92a7d3b0a1cf8c88f`.

## Confirmed and addressed in this release

- Replace retired pilot-only language on Pricing with sign-in/account-verification requirements and account-specific purchase availability. The public-admission release and owner payment acceptance are recorded in `launch-status-20261012.md`; this pass does not repeat a purchase.
- Describe 15 ranked fee models plus 3 whole-shipment bulk workflows, rather than conflating the two counts. Document Full Grip, Meta TCG and Card Conduit separately from the 15-row fee table.
- Correct the TCGcsv attribution and remove the claim that reliable automatic eBay sold records are available. Add TCGcsv, PriceCharting and SportsCardsPro footer credits. Credits do not themselves establish a licence; prior owner-confirmed permissions remain recorded separately.
- Label calculated suggestions “Sell Now −15%” and “Patient +15%” without changing their arithmetic. These are scenarios, not measured sold-price percentiles or speed predictions.
- Move historical technical entries to `/changelog`, retaining the complete history and adding its static route and sitemap entry. Keep the accuracy page focused on current methodology and limits.
- Normalize public-page links to canonical extensionless paths. Update credit names and AI casing. Correct the Terms description of fee verification dates and available selling workflows without changing billing/refund provisions.
- Clarify buylist ratios as modelling assumptions, not measured averages or actual buyer offers.

## Fee-source evidence

Only the following five model/page stamps move to October 13, 2026. These are source reviews, not confirmations sent by the companies. Arithmetic is unchanged; existing cash-out minimum and rounding/model limitations are not certified away.

| Venue | Primary source read | Confirmed scope |
| --- | --- | --- |
| Cardsphere | https://www.cardsphere.com/terms | 3% transfer fee; personal PayPal cash-out 10% or $10 minimum. Alternative 8%/$8 business transfer has country eligibility and is not the app's US default. |
| Card Kingdom | https://www.cardkingdom.com/purchasing/how_to_sell and https://www.cardkingdom.com/sellcart | Direct buylist, condition-dependent offers, published 30% store-credit bonus. The app's 50% retail ratio is an assumption. |
| Star City Games | https://sellyourcards.starcitygames.com/getstarted | Sell List/in-person no service fee; Ship + Sell 10%, or 5% over $10,000; up to 30% store-credit bonus. The app models sorted Sell List. |
| CardNexus | https://help.cardnexus.com/articles/9938652-fee-structure-overview | North America seller commission 8% on item subtotal plus shipping. |
| TCG Bulk | https://tcgbulk.com/page/terms-of-service | Default service fee 10%, subject to the accepted submission; optional shipment protection may be 3.5% where offered. |

Cardmarket returned 403, including its game-specific fee URL. Search-index content still shows 5%, cap 100 EUR/GBP and 3% conversion, but that is not a successful current source read. CoolStuffInc's sell-list and full-service URLs returned general shop content; older indexed results cannot justify a new stamp. Both retain September 1. Obtain a current fee page or written confirmation. Existing age-based ranking guardrails remain intact.

## Claims that need qualification

| Review item | Current evidence / next step |
| --- | --- |
| Payment fulfillment | Owner-confirmed earlier; verified customer admission and checkout opening independently checked. No new payment test performed here. |
| Admin exposure | Server verifies bearer identity against the owner. Anonymous production `/api/admin` returned 401 in this pass. A visible label is not an authorization bypass. |
| robots.txt / sitemap | Both returned HTTP 200 with appropriate content types. Search Console indexing is not established by that check. |
| Gemini's referral-only positioning | Incomplete: current product also has paid monthly plans, scan/grade credits, collection and draft workflows. |
| Japanese Pokémon research-only claim | Incomplete: the batch pricing code includes a Japanese catalogue route. Actual coverage remains card-dependent. |
| eBay import acceptance | Still requires a real Seller Hub results report for a current exported draft file. Existing preflight tests do not prove marketplace acceptance; prior browser sign-in was blocked. |
| AI grade validation | No published labelled gold-set results found. Need paired card images and independently known grades, a frozen evaluation method, and results that include failures. Changing a point to a range alone does not validate it. |
| eBay tax estimate | Buyer-tax fee-base gap remains disclosed. A user-entered assumption is a future calculator change requiring fee-base/boundary validation, not a claim solved by copy edits. |
| Business-plan unit economics | Reconcile actual provider invoices and retry/deep-grade usage; credit arithmetic alone does not establish margin. |
| Pricing simplification, SEO landing pages, business/legal structure | Proposals requiring their own evidence and scope. No price, entitlement, legal entity, liability or subscription-policy change in this release. |

## Validation

Fee/page parity and quick-pricing checks passed during development. Complete regression, browser layout, deployment and live evidence are recorded on the release PR. No email, seller listing publication, paid campaign, or customer mutation was performed.
