# Seller workspace: inventory migration and eBay connection

October 15, 2026. Continues the owner's approved inventory-import and eBay-integration work. Release base: `f7d5bb203606eadf851635cba605e324572ab60e` on `codex/profit-readiness`. The repository's older `main` branch is not the production release line.

## This release

- Collection has an Import CSV action with column matching, validation, a preview and explicit confirmation. No writes occur during preview. Invalid rows prevent the entire import.
- Quantities become individual physical-copy records. Names, sets, numbers, games, raw condition, finish, cost, saved value, grading company/grade/certificate, acquired date, storage location and source SKU can be preserved. Empty costs, prices and conditions stay unknown. Imported prices are labelled estimates.
- Exact repeated normalized CSV rows are skipped by default. Existing CardResell Collection IDs are never overwritten. The separate new-purchases mode creates new copy IDs and requires the exported Collection ID column to be ignored.
- Known sold and deleted copy IDs are skipped, including the existing deletion history. New sales retain the original Collection ID and import key, preserving this relationship beyond deletion-marker retention while the sale remains in the log.
- Imports check collection, sale and deletion snapshots again before saving. Account changes cancel the dialog. Storage failures leave the preview available to retry. Existing account sync reports its own success or retry state separately from local save success.
- Collection statistics no longer treat missing costs as zero, use purchase cost as an invented market value, or show a negative row gain with a positive sign. Unknown amounts are excluded from estimated gains and explicitly counted.
- Export includes location, source SKU and imported-estimate provenance. Source SKUs are descriptive identifiers; they are not guaranteed unique across individual copies or reserved as marketplace SKUs.
- Optional eBay connection requests identity, seller-account and inventory read-only scopes. It verifies seller registration, US policies and enabled inventory locations. It cannot publish, modify or end a listing.
- OAuth state is single use, browser bound and account bound. Return from eBay requires confirmation under the initiating CardResell account. Tokens and account identity are encrypted on the server; browser storage never contains them. Disconnect invalidates in-flight authorization/refresh work. Signed eBay account-deletion notifications remove confirmed and pending connection records, and storage failures request delivery retry.

## Scope and limits

CSV only, USD amounts per physical card, up to 2 MB and 2,000 total collection copies, additionally bounded by the existing account-sync payload limit. Card identity and imported prices are not independently verified. Generic column mapping is not certification of every Collectr/TCGplayer/other-app export. External export samples still need validation.

This is append-only migration, not an inventory update or sale import. A changed external row or quantity can be treated as new inventory; the preview warns about matching printings. Keep CardResell Collection IDs for exported backups. Deleted-copy protection depends on retained deletion history or saved sales; it is not an indefinite import ledger. No cross-marketplace inventory synchronization is enabled.

## eBay activation dependency

Production configuration metadata inspected October 15: application ID, client secret and marketplace-deletion verification token exist. Seller redirect name, seller token key and the seller-connect feature flag are absent. No secret values were printed or changed. The connection button therefore stays hidden; CSV import works independently.

Before the owner-only live connection check:

1. In the existing eBay developer application's Production User Tokens settings, register an OAuth redirect name (RuName). Accepted callback: `https://www.cardresell.org/api/ebay-connect?action=callback`. Configure the decline return for the same handler and confirm the returned error/state format. Privacy policy: `https://www.cardresell.org/privacy.html`. Confirm the three requested scopes are available to this app.
2. Set `EBAY_SELLER_REDIRECT_NAME` to that actual RuName. Generate a new 32-byte cryptographically random `EBAY_SELLER_TOKEN_KEY` and store its 64-character hexadecimal encoding only as a protected server environment value. Do not paste it in chat, commit it, or reuse the eBay app secret. Rotation currently requires disconnect/reconnect; do not replace an active key without a migration plan.
3. Set `EBAY_SELLER_ORIGIN=https://www.cardresell.org`, `EBAY_SELLER_ENVIRONMENT=production`, and restrict `EBAY_SELLER_PILOT_UIDS` to the verified owner Firebase UID. Set `EBAY_SELLER_CONNECT_ENABLED=true` only after callback configuration. Rebuild for Production.
4. On Production, verify the real owner authorization, correct seller identity, explicit confirmation, setup checks and disconnect/reconnect. Use read-only checks; do not publish a real card for this connection test.
5. Confirm the existing marketplace-deletion subscription reaches the signed endpoint. Deletion handling is not optional after storing seller authorization data.

Sandbox uses separate `EBAY_SANDBOX_APP_ID`, `EBAY_SANDBOX_CERT_ID` and `EBAY_SANDBOX_SELLER_REDIRECT_NAME`. Do not reuse Production credentials in a sandbox. Local simulated OAuth tests establish code behavior, not real eBay account access.

The developer portal was signed out during this session. Its cloud-browser sign-in restriction prevented completing registration or a live connection; no sign-in or restriction bypass was attempted. The feature remains disabled.

## Verification before release

The full local gate passed: 128 registered suites, 125 executed, with the three explicit local-mode exclusions (real-store draft pass, production endpoint smoke and optional condition-applicability browser interaction). Focused checks included 87 importer assertions, 77 seller OAuth/token/deletion assertions, 26 seller-connection browser assertions, 17 CSV export assertions, 22 existing eBay-notification checks and 182 asset checks. The entry-identity suite also exercised a successful sale retaining source-copy identity, import key, location and SKU. Browser tests used isolated data; the final import preview was visually inspected at a 390-pixel viewport.

These checks do not certify a real seller import, real eBay authorization or native phone behavior. Production artifact and endpoint checks follow deployment.

## Remaining connected-selling milestones

1. Demonstrate a real seller connection and account setup with the configured application.
2. Draft-to-eBay payload mapping and recoverable submission review are implemented in the subsequent milestone documented in `ebay-submission-review-20261015.md`. Current metadata and seller-setting validation are covered by isolated tests; live account validation remains blocked. This review does not enable publication.
3. Publish/edit/end lifecycle together: durable per-copy SKU and offer mapping, explicit seller consent, version checks, idempotent operations and reconciliation after lost responses. The eBay Inventory API requires API-created listings to be revised through that API; shipping a publish button alone would leave an incomplete seller workflow.
4. Import sales using fulfillment permissions with seller reauthorization, durable order/line-item identities, cancellation/refund handling and preservation of actual-versus-unknown expenses. Reserve/remove the correct physical copy without duplicating sales.
5. Measure the complete import → prepare → list → sell → profit workflow on a small real seller batch before claiming it saves sellers time or supports automated cross-listing.

Official documentation checked October 15:

- https://developer.ebay.com/api-docs/sell/inventory/overview.html
- https://developer.ebay.com/develop/guides/sell/authorization
- https://developer.ebay.com/develop/guides/sell/marketplace-user-account-deletion

No customer messages, marketplace listing writes, purchases or paid provider scans are part of this release.
