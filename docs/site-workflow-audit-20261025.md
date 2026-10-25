# Site workflow audit — 2026-10-25

This continues the verified scanner release in PR120. The audit covers the local application suite and the separately registered browser, scanner, binder and billing release gates. It does not establish that every production defect is resolved.

## Fixes

Collection CSV exports now carry an explicit format version and use reversible spreadsheet escaping. Previously, a physical-copy ID such as `+copy-1` was exported with a protective apostrophe and imported as a different ID. Reimporting into the same collection could therefore create another physical copy or bypass the original copy's sold receipt. The importer now restores the original ID and literal text only for version-marked CardResell exports. Unmarked third-party CSV files keep their literal apostrophes. Formula-like text remains protected when opened in a spreadsheet.

Set codes now survive import, appear in the preview and reach each saved copy. Historical import receipts and permanently retired copy IDs remain recognized when an older file is reimported after this upgrade. Explicitly importing a new purchase remains available. Zero cost and unknown cost remain distinct.

Older CardResell exports cannot distinguish some literal apostrophes from protective escaping. Ambiguous rows stop with an actionable message requesting a current export; the importer does not guess a new physical-copy identity. Ordinary older exports remain supported.

Saved grade reports now refresh Firebase authentication, bind requests to the current account and put one deadline around token retrieval, the request and response decoding. A timeout releases the Save button and offers a safe retry with the same report ID. The browser test loses the response after the real local API saves the report, then retries and verifies that exactly one report exists. A mismatched Firebase user cannot receive the previous account's report.

Collection labels for held, sold and unavailable listing status now use the theme's readable text color, fixing insufficient contrast in light mode. Mobile screenshot review also found undersized saved-grade actions; Save, Close, navigation, download and delete controls now have at least 44px-high touch targets. On narrow phones, Collection's opened More menu now has its own row instead of overflowing the left edge of the screen. The existing brand/UI gate reproduced that defect at 320px.

## Test harness repairs

Several older tests no longer supplied the session or lifecycle helpers required by the shipped application. The audit repairs those fixtures without relaxing application safeguards: draft downloads include the authenticated UI owner and still call the real availability handler; scanner fixtures include the real cancellation helpers; selling-gate fixtures bind approval to the displayed card. A new stale-approval assertion rejects a different displayed card.

Older eBay link assertions expected an inline query string that has since moved to the shared selection builder. They now assert that shared wiring, while mobile and desktop browser checks verify the actual outgoing URLs preserve card number, printing and grade across the research links.

## Verification

**156 suites passed in the complete local runner, plus 43 additional release checks.** Two live-service slots were intentionally skipped; two historical billing scripts were blocked by unavailable historical fixtures and are not counted as passing. After the final mobile adjustments, the affected grade, fingerprint, contrast and brand checks passed again, including 978 brand/UI assertions. Detailed completion records and content hashes are in [site-workflow-audit-20261025.json](site-workflow-audit-20261025.json). Local Chromium, isolated Redis, real handlers and shipped assets exercise user workflows. Provider, authentication and payment boundaries use synthetic fixtures; external application traffic is blocked. No paid scans, production inventory changes, purchases or marketplace listing writes are part of these tests.

The normal runner also registers the two new regressions: collection CSV identity round trips and saved-grade authentication/deadline recovery. Existing browser cases cover the import preview and saved physical copies, lost grade-save replies, draft downloads, mobile controls and selected eBay research links. The configured build inspection and whitespace check are release gates.

Previously deployed content-addressed assets are retained. Only the entry document and newly hashed collection/import/export/grade-history and brand CSS assets change at runtime; the scanner core and API handlers are unchanged in this release.

## Remaining boundaries

- Original full-resolution labeled photos are still needed to measure live Ximilar exact-printing accuracy, especially Magic binder pages. Screenshot-based and synthetic tests establish workflow behavior, not live recognition rates.
- Linked eBay authorization alone does not establish market-wide sold-data access or seller publishing readiness. Existing unavailable-data states and disabled publishing/sync gates remain in place. No live seller listing or eBay CSV upload acceptance is claimed.
- The managed-Redis opt-in suite and production endpoint smoke are separate from the offline suite. Production checks for this release are read-only deployment/asset/auth-boundary checks.
- Two historical billing release scripts could not execute: `billing-release-scope.mjs` pins an unavailable `facc465` product snapshot and an older exact release layout; `billing-release-rollback.mjs` requires a separate historical rollback checkout absent here. They are reported as blocked, not passed. This release changes no billing API or scanner-core bytes; current billing atomicity, browser and membership checks run separately.
- The known runtime `DEP0169` deprecation warning remains unresolved. The initial Vercel error-group query returned this group; its aggregate count spans older deployments and is not presented as a count for the requested window. This release does not suppress it.
