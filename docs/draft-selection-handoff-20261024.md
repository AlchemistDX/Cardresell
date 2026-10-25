# Draft selection handoff — 2026-10-24

Follow-up to PR #115. This pass follows the selected card from the comparison panel through the real draft handler, storage and review screen.

## Corrected behavior

- New panel drafts capture the selected finish, grader and grade rather than the untouched catalogue object's slab fields. The catalogue object itself is not mutated. Stored-collection drafting continues to use the saved copy's details.
- The pricing condition is recorded as a separate comparison assumption. It does not assert the physical card's condition or populate eBay's condition descriptor. The review screen explains that the seller must check the actual card.
- Saved choices are visible beside the draft's price and remain unchanged when another card is viewed. Certificate numbers survive only when the selected grader and grade still match the original slab; changing the grade or choosing Raw removes the old certificate.
- Unavailable or pending graded quotes remain unpriced. Neither the raw-card price nor a previous grade's price is substituted. The seller can research sold listings or enter an asking price.
- A delayed grade response cannot change a subsequently loaded card. Graded research links use the selected card, set, finish and grade, with the existing recent-first sort; Magic searches no longer gain an unrelated Pokémon term.
- Loading a new copy creates a fresh scan-instance identity. Selection edits and retries within that copy retain the existing identity, so distinct copies do not collapse into one draft.

Existing drafts are not rewritten. Publishing gates, eBay scopes, fees and provider access are unchanged. This does not unlock individual automatic sold-history access.

## Evidence

The initial shipped-browser test reproduced 36 failing checks. The final test passes 58 checks at 390px and 1280px, using the real draft endpoint and isolated test storage. Review screenshots were inspected at both widths.

Seventeen focused suites passed on `core.94c35814.js`:

| Suite | Result |
| --- | ---: |
| draft-selection-handoff-browser | 58 checks |
| draft-review-screen | 422 checks |
| draft-price-integrity-browser | 48 checks |
| selling-selection-browser | 42 checks |
| grade-upside-identity | 12 checks |
| ebay-search-links-browser | 42 checks |
| sports-price-guard | 60 checks |
| scan-finish-browser | 223 checks |
| quick-pricing | 233 checks |
| collection-drafts-browser | 100 checks |
| customer-journey-browser | 170 checks |
| bulk-batch-draft | 126 checks |
| listing-packet-offline | 487 checks |
| asset-fingerprints | 254 checks |
| test-registry | 12 checks |
| grade-upload-single-draft-browser | Both viewport flows passed |
| photo-capture-lifecycle | 37 checks |

The older draft-review fixture was corrected to select the card through `setSelectedCard` and use that exact rendered object for its mocked eligibility approval; its assertions were retained. Production eligibility is still server checked, and draft creation still validates the submitted card.

All accounts, providers and writes used in tests were local fixtures. No customer drafts, paid scans, marketplace listings or sales were created. This was a focused pass, not a rerun of the entire suite. Existing Node module-type warnings remain.
