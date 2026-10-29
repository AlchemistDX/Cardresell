# Workflow fixes — 29 October 2026

Follow-up to the live user audit. The changes address the five remaining draft/reset findings; broad related search suggestions remain a lower-priority refinement.

## Changes

- Draft navigation automatically advances past deleted-only pages, following server cursors without changing or deleting stored data. Automatic traversal is bounded to 12 pages, stops for repeated/non-advancing cursors, and is cancelled by account/navigation changes. Focused reads retain their exact-page behavior. If no rows are found, the page explains continuation instead of rendering blank.
- The Drafts badge uses the same active usage count as the heading. Exhausted history with zero active drafts renders the empty state.
- The selling action now says **Create eBay draft**. Existing idempotent creation/reuse remains intact.
- Draft estimates use the shared eBay net calculation with complete shipping assumptions recorded in the draft packet. Missing, partial or unreadable shipping remains excluded and explicitly labelled. Default zeros remain labelled unconfirmed. Review never borrows the currently selected card's shipping inputs. Per-listing discount eligibility remains withheld, and current seller fee/tax assumptions remain disclosed.
- Direct catalogue price selections now carry their provider, selected pricing choice, condition/finish, reported asking endpoints and available source date into draft pricing context. This fallback is restricted to the matching card in hand. An eBay aggregate is not attributed to TCGplayer; an unavailable date or source URL is not invented. Rebuilds with explicit null basis do not borrow current-card data.
- Clearing a card invalidates pending image generations, detaches image handlers and removes the image source. Late image recovery cannot replace the empty-card placeholder.

## Verification

Targeted isolated browser checks: core values 93; draft reads 56; draft price integrity 54; selling next step 243; draft review 422. All passed. Tests cover narrow and desktop widths, deleted-only pages, cursor loops, all-deleted history, account switching, late image callbacks, chosen asking-price provenance, foreign-card exclusion and recorded-shipping net math.

The first new provenance fixture failed because it retained the prior Lightly Played selection and reused the same set/number identity for its supposedly different card. The fixture now selects Near Mint and uses a different card number; production matching rules were not weakened.

Full 176-entry release runner: ALL CHECKS PASSED, exit 0, 424 seconds, with live/conditional gates skipped. Tested index and core SHA-256 hashes match the release files. Live verification of the first release confirmed all three active drafts are accessible, badge and heading both show 3, the existing Greninja draft estimates $0.00 after its recorded $1 postage, and switching card types clears the previous card image. No additional production draft was created.

That live review found a legacy saved packet note contradicting the shipping-inclusive estimate. The follow-up renders that note consistently when complete recorded shipping is included, without changing historical packet data, and adds a regression assertion. Final 176-entry runner passed with exit 0 in 416.7 seconds (live/conditional gates skipped). Tested core and index hashes matched the shipped files. Production commit e7c3249b903b9dfd9ab52138df7ade6879aa6c04, deployment dpl_GanoUnimVbeMSphEVpVCWaeMFA8j, reached READY on cardresell.org and www.cardresell.org. The live browser loaded core.39b02d90.js. Reopening the existing Greninja draft confirmed the $0.00 net after $1 recorded postage and the corrected legacy shipping note. Draft pagination and the 3-active count were rechecked. The help guide opens and exposes the Seller Hub Reports upload link and its reopen/dismiss controls. No additional drafts or listings were created.

## Limits

No additional production drafts, inventory edits, purchases or eBay listings are needed for verification. The single Greninja test draft from the earlier audit remains. Physical iPhone camera scanning, checkout/payment and eBay CSV upload acceptance remain separate acceptance checks. This release does not add eBay sold-data entitlement or direct publishing.
