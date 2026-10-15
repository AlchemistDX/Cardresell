# eBay submission review

Release base: `d36f34b7f50c75060283c3ed6288f6fe6ddc9b61` on `codex/profit-readiness`. Continues the approved seller-workspace work. This milestone prepares and checks an Inventory API payload; it performs **no eBay listing mutations** and does not request additional seller scopes.

## Seller workflow

Open a saved eBay fixed-price draft and choose **Check direct eBay readiness**. The review identifies the exact physical copy and shows missing information. Unconfigured accounts can save this blocked preparation check and keep using manual exports.

When the existing read-only seller connection is available, **Load current eBay requirements** retrieves the category tree version, item-specific constraints, condition descriptors, seller registration, business policies and inventory locations. The seller chooses the condition, policies, location and hosted card photos, confirms availability and reviews the details. **Check and save review** fetches the requirements again and refuses changed metadata or policy details. It saves either a blocked report or the fully assembled candidate payload. A passed preparation check explicitly says publishing is not enabled.

The browser restores selections for the same account, draft revision and seller connection. It requires fresh confirmations after reopening and clears the details confirmation after any field change. Local recovery holds at most 50 recent reviews per account; stale entries are pruned when saving. A failed local save is visible; server saving remains available. Server checkpoints last 30 days. **Reload saved review** recovers a server save whose response was lost. Another tab cannot overwrite a checkpoint without reading its revision first.

## Validation and storage boundaries

- US marketplace, USD cents, fixed-price, quantity one. Other slots, lots, missing prices, stale/incompatible packets and unavailable copies fail the review. Copy availability is seller-confirmed; this stage does not establish a server inventory reservation or detect outside sales.
- The marketplace SKU derives from environment, verified Firebase UID and physical instance ID. It differs from the printing SKU. It remains the same when that physical copy is drafted again. No offer/listing mapping exists until the subsequent lifecycle milestone.
- Existing manual-export packets remain unchanged. Their unverified human condition labels are never passed as numeric eBay values. Current Metadata API IDs are checked for mode, cardinality, required dependencies and value applicability. Slab grade, grader and certificate must agree with the saved slab. Unknown label formats block preparation rather than guessing an ID.
- Item specifics follow current Taxonomy API required, selection-only, cardinality, length and dependency constraints. Unsupported advanced formats fail closed. Unsupported saved optional aspect names are explicitly disclosed as omitted. Seller changes to item specifics require confirmation; this does not independently authenticate a card.
- Policies must belong to the connected seller and US marketplace. An enabled location needs an address. Calculated shipping is blocked until package dimensions and weight are implemented. Policy terms govern an eventual listing; draft shipping/profit assumptions do not change them. Actual eBay fees, selling limits and regulatory eligibility are not certified by this check.
- Photo IDs and hashes identify existing hosted photos. The server recomputes each object key from its authenticated owner, draft, photo and hash and verifies the object's existence, size and type. Browser-supplied URLs and keys are never fetched or trusted. Catalogue references are excluded from the browser's photo manifest. No photo is uploaded or renewed by this review. Photo existence is checked at that moment and must be checked again before any future listing write.
- Candidate descriptions escape saved card text before eBay can interpret it as HTML. Inventory `condition` uses `LIKE_NEW` for graded and `USED_VERY_GOOD` for ungraded cards; descriptor values are string IDs and certificates use `additionalInfo`. Offers carry quantity one, GTC, explicitly selected policies/location and `includeCatalogProductDetails:false`.
- All routes require verified ownership. POST also requires the configured app origin. Provider reads are bounded and review checks are rate-limited. The atomic Redis checkpoint compares draft bytes, previous checkpoint bytes and current connection bytes; disconnect, draft deletion/edit, and concurrent review changes win over delayed work.
- Read-only category metadata uses an application token in the configured eBay environment. Seller-specific settings use the existing encrypted seller token. No token, secret or authorization code enters the review response, browser journal, checkpoint or logs.
- Saved review freshness lasts ten minutes and is invalidated by draft/connection changes. The report is evidence of a check, **not seller consent to publish**. An account-deletion notification erases associated checkpoints using a separate bounded index. A checkpoint subsequently replaced under another eBay account is protected from the former account's deletion.

## Activation and remaining lifecycle

The production connection prerequisites and the cloud-browser sign-in restriction documented in `seller-workspace-20261015.md` remain unresolved. No eBay settings or credentials were changed for this release. Real seller authorization and live metadata access have not been demonstrated.

Before enabling direct listing mutations, implement and verify all of the following together:

1. Explicit write-scope reauthorization bound to the actual granted scope; a rollout flag must not turn an older read-only connection into write authorization.
2. Durable per-copy reservations and seller/account/environment-bound inventory/offer/listing mappings. Prevent draft deletion or changed inventory from silently freeing a potentially live copy.
3. Versioned, per-listing seller approval of the exact current payload and fees. Recheck photos, metadata, inventory availability and connection immediately before sending.
4. Publish, edit and end operations with durable sent-before-request journals. Recover lost responses with eBay reads; never blindly replay offer creation when the first result is ambiguous. Unknown or contradictory states must remain held for recovery.
5. Fulfillment permissions and order-line import, cancellations/refunds, and actual-versus-unknown expense reconciliation before claiming sales synchronization or actual marketplace profit.

## Verification

Focused server suite: 105 assertions using real local Redis, real draft/packet builders and simulated official eBay response shapes. It covers raw/slab payloads, dependency rules, grade/certificate mismatches, foreign policies, photo ownership, no provider writes, stale drafts, concurrent tabs, disconnects, lost save acknowledgements and deletion cleanup.

Focused browser suite: 32 assertions at 390 and 1280 pixels. It exercises browser → actual review handler → Redis → response, explicit selections, truthful disabled publishing, reload recovery, confirmation invalidation, request failure, account changes and overflow. The mobile dialog was visually inspected. These are isolated fixtures, not real seller acceptance tests or live eBay publishing.

The full local release gate passed: 131 registered suites, 128 executed, with the explicit local exclusions for real-store draft persistence, Production endpoint smoke and optional condition-applicability browser interaction. The final asset gate passed 196 assertions after adding source/bundle parity for the new module; it was rerun separately because the full gate had already passed that early slot. All later new review suites used the final implementation. Production artifact checks are recorded in the release PR after deployment. No real account inventory, entitlements, payments, credits or marketplace listings were modified during tests.

## Official sources checked October 15, 2026

- https://developer.ebay.com/api-docs/sell/static/inventory/publishing-offers.html
- https://developer.ebay.com/api-docs/sell/static/inventory/managing-offers.html
- https://developer.ebay.com/api-docs/sell/static/metadata/condition-id-values.html
- https://developer.ebay.com/api-docs/master/sell/metadata/openapi/3/sell_metadata_v1_oas3.json
- https://developer.ebay.com/api-docs/master/commerce/taxonomy/openapi/3/commerce_taxonomy_v1_oas3.json
- https://developer.ebay.com/api-docs/master/sell/inventory/openapi/3/sell_inventory_v1_oas3.json

The OpenAPI schemas were retrieved directly from eBay and used to check exact field names and request shapes. No generated or third-party SDK mapping substitutes for those definitions.
