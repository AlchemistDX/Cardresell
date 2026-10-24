# Draft price integrity follow-up — 2026-10-24

This release follows the selling-workflow audit in PR #114. It closes gaps between the price controls and the draft request; it does not change marketplace publishing permissions.

## Changes

- An explicitly entered zero cannot fall back to the market price. Starting a draft leaves the price unset for review, consistent with the warning shown in the comparison.
- A provider with only some condition quotes can recover after an unavailable condition. The missing quote displays “No quote for this condition”; returning to an available condition restores its quote.
- A Quick Pricing amount derived from the previous printing is cleared when the printing changes. Hand-entered asking prices remain unchanged. Condition strategy choices are reapplied only when a usable quote exists.
- Drafts capture price context and shipping before awaiting token refresh. Retries after an uncertain save continue to send the original payload.
- An eligibility response remains usable after a token refresh for the same account. Account switches and changed card renders still invalidate it.
- Quote ages are converted to an absolute timestamp when the basis is bound. Null, blank, invalid and overflowing ages remain unknown; creating a later draft cannot make the quote look newer.

## Verification

The new shipped-browser regression initially reproduced 24 failures at 390px and 1280px. The final suite passes 48 checks, including the same-account refresh, cross-account rejection and uncertain-save retry cases added during investigation. The missing-quote presentation was also inspected at both widths.

Fifteen focused suites passed on the candidate core `core.f7d23968.js`:

| Suite | Checks |
| --- | ---: |
| draft-price-integrity-browser | 48 |
| selling-selection-browser | 42 |
| quick-pricing | 233 |
| sell-eligibility | 113 |
| listing-packet-offline | 487 |
| draft-review-screen | 422 |
| bulk-batch-draft | 126 |
| customer-journey-browser | 170 |
| collection-drafts-browser | 100 |
| draft-generation-omission | 52 |
| draft-lifecycle | 83 |
| condition-applicability | 17 |
| scan-finish-browser | 223 |
| asset-fingerprints | 254 |
| test-registry | 12 |

Browser services and customer identities were local fixtures. Draft review and batch tests exercised the real handler/store code with isolated test storage. No production drafts, paid scans, listings or sales were created. The full suite was not rerun for this focused follow-up. Existing Node module-type warnings remain.

## Remaining sold-data limitation

Individual automatic eBay sold comps remain unavailable on the current production path. Seller OAuth does not itself grant access to the restricted Marketplace Insights API. The previous release's selection-aware sold research links and explicitly labelled provider averages remain available. No provider access restrictions were bypassed or new subscription started.

Reference: https://developer.ebay.com/api-docs/buy/static/ref-marketplace-supported.html (checked 2026-10-24).
