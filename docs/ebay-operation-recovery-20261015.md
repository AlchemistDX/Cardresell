# eBay operation reservations and recovery

Release base: `0bb3ab5ae803fc9b7d1fbce00e72d1d4db4cef40` on `codex/profit-readiness`. Continues submission review with permanent per-copy plans, an operation state machine, and recovery UI. This is an implementation milestone, **not activation of live eBay listing writes**.

## Available workflow and execution boundary

**Drafts → eBay listing operations** opens the account's saved operation list, including operations whose original draft no longer exists. From an eBay draft's readiness review, **Listing plan and recovery** opens that physical copy. A connected seller with a fresh complete review can separately confirm **Save listing plan**. The server rechecks the draft, metadata, selling terms and hosted photos before saving; it sends no listing request to eBay. Reload saved status recovers a lost save acknowledgement. Cancellation needs fresh confirmation and is available only for an unsent plan, even after disconnecting.

The deployed handler always constructs with `executionEnabled:false`; no environment flag or client request can turn on preparation, publication, repricing or ending. Existing OAuth still requests only read scopes and creates no `grantedScopes` write authority. The browser offers no live mutation controls. The production connection prerequisites documented in `seller-workspace-20261015.md` remain unresolved, so actual seller plan creation and recovery against eBay have **not** been demonstrated in Production.

The internal engine implements and tests Inventory API inventory creation, one unpublished offer, fee review, publication, price-only revision and withdrawal against an isolated simulated provider. Its execution dependency is injected only by tests. A separate release is required before enabling it, with verified scope-bound reauthorization, authoritative physical-inventory/sale checks, and a full per-listing approval UI. This dependency injection is not a deployment switch.

## Durable ownership and recovery rules

- One key per environment, verified CardResell UID and physical instance ID: `ebaylisting:v1:<environment>:<hash(uid)>:<hash(instanceId)>`. A new draft generation cannot bypass an existing reservation for that instance. The printing SKU is never used as a physical-copy identity.
- Versioned records hold exact payload and fingerprint, draft bytes fingerprint/revision, review revision, connection/account binding, selected photo metadata, offer/listing IDs, current asking price, pending operation and the last 30 state transitions. Completed mutation transitions preserve their approval time, payload fingerprint and fee fingerprint or new price. Tokens are never stored in these records or browser storage.
- A journal record and its owner/account indexes commit atomically with source-byte comparisons. Index types are checked before writes. Owner index is bounded to 500 saved copy records; account cleanup index to 2,000. Records and reservations have no automatic TTL. Cancelled plans can be replaced by a newly reviewed plan for the same copy; they also count toward the bounded index until replaced.
- The pending operation is saved **before** the single outbound mutation. There is no expiring worker lease, retry loop or background replay. A lost Redis acknowledgement prevents sending. A lost provider acknowledgement leaves the request pending.
- Recovery makes provider reads only. It confirms the exact SKU, owner-bound offer mapping, marketplace, format and relevant payload. Missing, unreadable, duplicate, paginated, mismatching or contradictory provider results leave the copy held. An absence response does not prove that a delayed write cannot still arrive. Some uncertain operations therefore require support and remain blocked indefinitely; this release has no force-release action.
- Inventory preparation refuses an existing SKU rather than replacing unrelated inventory. Offer creation will not repeat after an ambiguous response. Recovering a single matching unpublished offer establishes its durable mapping. A second marketplace/format offer for the same SKU is also treated as a conflict.
- A listing fee estimate is requested for one unpublished offer, validated as USD, shown by fee type, and bound to publication approval. It expires after five minutes and is fetched again before publication. An empty, warning-bearing or invalid estimate is unknown, never a zero fee. These are expected listing fees, not actual sales expenses or profit.
- Repricing uses `bulkUpdatePriceQuantity` with **price only**. It sends no quantity and checks the per-item result as well as provider readback. Full inventory/offer replacement is deliberately not used for price edits. Other listing-field editing is not implemented.
- Ending uses `withdrawOffer`; it preserves the offer/listing relationship. Even a confirmed unpublished offer keeps its copy held until order and inventory reconciliation exists. Sold, inactive or on-hold listings cannot be repriced or automatically replenished.
- Account switches hide former seller payload, offer/listing IDs and fee data. Same-account reauthorization can recover pending outcomes, using current connection bytes for CAS. Draft edits/deletion, disconnect and expired credentials never release a possibly live copy. Operations remain addressable independently of the draft.
- Verified eBay account deletion erases the plan's eBay account, payload, photo metadata, offer/listing IDs, fees and history. A minimal CardResell instance hold remains. Account deletion is not proof of listing withdrawal. Cleanup checks the account binding to avoid erasing a replacement plan belonging to another seller.

## Important limits before activation

These reservations govern the direct-eBay operation store. The existing browser Collection, manual listing exports and outside marketplaces do not yet consult them. Availability is still a seller attestation in the review, not an authoritative cross-channel inventory check. Before live activation, add server-owned copy availability and sales/cancellation reconciliation, guard manual and direct listing paths consistently, complete scope reauthorization and explicit fee-aware mutation controls, then verify the real eBay Sandbox flow before an owner-scoped Production pilot. No real listings, paid scans, purchases, credits or subscriptions were changed by this release.

The existing sold-price feed outage is separate from seller OAuth and remains documented in `ebay-sold-availability-20261012.md`. No eBay sign-in workaround, impersonation or proxy was attempted.

## Verification

The operation server suite exercises the actual handler, Redis Lua scripts, submission builders and Inventory API adapter against isolated official response shapes: complete lifecycle, lost acknowledgements for every mutation, late writes, concurrent tabs, schema preservation, source races, fee changes, missing photos, sold copies, reconnects and deletion cleanup. The browser suite exercises browser → actual API handler → Redis at 390 and 1280 pixels, including lost-save recovery, confirmation, cancellation, pending-state recovery, account changes and overflow. The mobile recovery screenshot was visually inspected.

The full local release gate passed: 133 registered suites, 130 executed, and three existing explicit local exclusions. The operation suite passed 94 assertions; the browser suite passed 30; asset parity passed 202. The membership build gate and whitespace checks also passed. Production artifact and anonymous-boundary checks are recorded in the PR after deployment. Local simulated eBay writes are not live seller acceptance tests.

## Official contracts checked October 15, 2026

- https://developer.ebay.com/api-docs/sell/static/inventory/managing-offers.html
- https://developer.ebay.com/api-docs/sell/static/inventory/expected-listing-fees.html
- https://developer.ebay.com/api-docs/sell/static/inventory/bulk-updates.html
- https://developer.ebay.com/api-docs/master/sell/inventory/openapi/3/sell_inventory_v1_oas3.json

The downloaded official schema was used for request and response field names. `getListingFees` reports summaries by marketplace; requesting exactly one offer binds this estimate to that offer. `withdrawOffer` keeps the unpublished offer. No claim of provider idempotency is assumed for offer creation or publication.
