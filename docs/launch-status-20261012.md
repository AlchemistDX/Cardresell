# Current launch status — October 12, 2026

This dated status supersedes pending phone/payment/public-admission entries in
older readiness notes. Historical results remain historical; this is not a
percentage readiness score or a claim that every feature has been accepted.

## Completed evidence

- Owner reports physical-phone testing and payment fulfillment completed.
  These are owner-confirmed results, not a second independently executed test.
- Public verified-customer admission is deployed. Independent live checks
  observed the previously blocked verified account receive its existing
  included credits plus one verification bonus; balances survived reload.
  Checkout opened successfully without an additional purchase. An existing
  paid account retained its balances.
- PR #34 fixed draft creation's derived-title idempotency mismatch. A live
  draft survived reload and retry without creating a second draft.
- PR #35 fixed saved-card hydration overriding the user's selected screen and
  clarified that passing draft checks still requires listing review.
- PR #36 distinguishes unavailable eBay sold data from a successful empty
  search and retains a manual research link. Automatic sold data is still
  unavailable; a guide price is not proof of individual recent sales.

## This release

Remove the SCG Ship + Sell warning incorrectly attached to eBay. Replace
unsupported Mana Pool/Cardsphere cheapest-fee claims with language asking
sellers to compare net proceeds, shipping and cash-out costs. Cover both the
venue descriptions and the separate Mana Pool recommendation text.

Client asset: `js/core.dbba091a.js`. Previous immutable asset retained.
Fee arithmetic and published fee-audit dates are unchanged. No new fee audit
is claimed. Local verification: fee truth 122, accuracy/fee parity 41,
asset fingerprints 109 and test registry 12 checks; build inspection passed.
The first asset-check invocation used a nonexistent filename; rerunning the
actual registered `tests/asset-fingerprints.mjs` passed.

## Remaining evidence before broad paid acquisition

| Work | Next action | Completion evidence |
| --- | --- | --- |
| Data rights and unit costs | Confirm the existing pricing-provider plan, commercial display/cache rights and actual billed usage; reconcile retry costs and configured ceilings | Current entitlement confirmation, invoice reconciliation and bounded exposure per successful scan/lookup |
| Hosted recovery | Confirm backup retention and restore to an isolated disposable database | Measured recovery time, snapshot age, expiry/ledger/ownership checks and reconciliation procedure; the prepared procedure alone is not completion |
| Acquisition measurement | Trace a tagged QA journey through existing events and reconcile with authoritative fulfilled-payment records | Campaign events linked to fulfillment without treating browser checkout events as revenue |
| Advertising claims | Review intended campaign text against the deployed release and known limits | No claim of automatic marketplace publishing, guaranteed grade/profit or reliable automatic eBay sold records |

The first follow-up is current pricing-provider entitlement and cost evidence,
then hosted recovery and campaign reconciliation. Do not repeat completed
owner phone/payment tests unless a relevant change or new failure warrants it.
An isolated preview store remains a prerequisite for releasing the broader
foundation work in draft PR #33; that work is not part of this small release.

## Sold-data route decision

Research checked October 12, 2026. These are provider-published capabilities,
not evidence of our account's entitlement, accuracy or latency.

| Route | Suitable use | Constraint and next action |
| --- | --- | --- |
| Existing TCG Price Lookup | Condition/grade-specific aggregate eBay sold averages | Keep aggregates distinct from dated individual sales. Confirm current commercial rights first: its pricing page lists Pro at $49.99/month, while its FAQ still lists Trader at $14.99/month with different allowances. Do not infer our plan from either page. |
| Card Hedge | Candidate for individual comparable sales | Its `sales-by-search` endpoint requires commercial access, supports exact grade and up to 20 recent records, and exposes incomplete coverage. Request a quote and sample covering our games/variants before choosing it. No subscription or paid request made. |
| eBay Marketplace Insights | Potential direct route only if already entitled | Official documentation says access is restricted and closed to new users. Existing Browse app authentication does not establish this entitlement or seller authorization. |
| PriceCharting Prices API | Current guide values | Published documentation excludes historical prices and sales from this API; it is not a replacement transaction feed. |

Evaluate any prospective feed with a fixed, manually checked set including
raw/graded cards, similar names, alternate printings, foils and thin markets.
Require sale date, source/record identity, currency, shipping treatment,
condition/grade, match evidence and honest partial/unavailable status. Reject
ambiguous matches rather than filling gaps with unrelated sales. Confirm
customer display, caching, attribution and export permissions in writing;
measure coverage, wrong-match rate, latency and cost before integration.

No new provider was connected, bought or contacted. No marketplace access
restriction was bypassed. Seller listing authorization remains a separate
workflow from obtaining market-wide sold data.

Sources:
- https://tcgpricelookup.com/pricing
- https://tcgpricelookup.com/faq
- https://api.cardhedger.com/docs
- https://developer.ebay.com/api-docs/buy/static/ref-marketplace-supported.html
- https://www.pricecharting.com/api-documentation
