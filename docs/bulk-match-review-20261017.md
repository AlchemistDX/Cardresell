# Bulk match review and recoverable Collection saves

October 17, 2026. Continues the owner's approved scanner and seller-workspace work. Release base: `90eb5bede51f6402ee31ad596f0e6332c183d3da` on `codex/profit-readiness`.

## Problem and resulting behavior

The ID service already returns `needsPicker`, offered candidates and a confirmation receipt for an ambiguous scan. Its convenience `card_name` is the first suggestion, not an accepted identity. Bulk Scan previously treated that field as success and could save or draft the suggestion without invoking the confirmation handler.

Bulk Scan now stages those results as **Match needs review**. They have no accepted name, market value, draft selection or Collection entry. The summary counts them separately from unidentified cards. The seller can compare their original photo with every offered name, set and number, select a printing, and explicitly confirm it for up to one ID credit. Neither opening the review nor choosing a candidate sends an acceptance request.

The client sends the exact offered candidate and server-issued receipt to the existing `/api/scan-debit-id` handler. Only an acknowledged, receipt-bound response containing the expected canonical card promotes the row. The first attempted request body is retained intact. Network failures, malformed replies and unknown outcomes offer **Retry same confirmation**; duplicate taps do not create parallel acceptance requests. The existing server receipt replays an accepted result without a second debit, in both the legacy and current membership billing routes.

The review sheet can be closed and reopened while the batch remains available. Before confirmation, **None of these match** opens a new-photo preview without scanning it. An explicit second action discloses the new scan's credit cost and preserves the same physical-copy IDs and seller metadata. A pending or unknown confirmation blocks removal, re-scanning and discarding that batch. A different account can start its own clean batch; a late response cannot update it. Known expiry or an unusable offer permits requesting fresh matches. A credit or authentication rejection leaves the photo and choice available for retry.

Confirmation preserves the physical-copy IDs, quantity, original photo and seller metadata already on the row. Condition and finish are not inferred as inspected. The selected name, set and number feed the existing shared Collection/draft mapper. Optional price data cannot replace that identity, and price/artwork are applied only when the returned set and number match the accepted printing. A missing exact price stays unknown. Seller-entered prices and stale batches are protected from late price responses. Confirmed Magic cards can seed the existing set-scoped printed-name recovery for other misses.

The review uses native modal focus behavior, text-node candidate labels, readable type and controls at least 44 pixels high. The old overlay keyboard handler now defers to an open native dialog so it does not close the underlying batch or steal its focus.

Saving a batch with unreviewed matches asks the seller to review or remove those rows first, since the existing post-save flow ends batch recovery. A failed local Collection write now returns before the success message or saved state. The photos and identified rows remain available to retry. Cloud sync continues to report its own outcome separately.

## Validation and limits

`tests/bulk-match-review-browser.mjs` runs the shipped app with actual scan and confirmation handlers and the production Lua on private Redis. It covers legacy and membership billing; all nine choices; explicit seventh-printing confirmation; cancellation; duplicate clicks; lost and malformed responses after a committed debit; exact-body replay; expired and malformed offers; exhausted credits; account and batch changes; token-refresh deadlines; wrong-printing prices; seller price edits; Magic cards; Collection cost/copy preservation; and a real browser storage-quota rejection followed by retry. Provider, authentication and catalogue boundaries are synthetic. No customer records or paid provider scans are used.

Additional release gates cover the existing single-card picker, billing atomicity and membership routes, binder catalogue recovery, Magic printed-name rescue, finish review, physical-copy identity, listing export and photo storage. `tests/run-all.sh --local` must pass before upload. Completion counts and deployed commit identities are recorded in the release PR after the gates finish.

The older billing atomicity gate also now runs in a fresh checkout: its shared-reference negative control is an explicit one-assignment mutation, replacing a reference to an unpublished local commit, and evidence files use a fresh temporary directory instead of a machine-specific home path. Existing financial, encoding and replay assertions are retained.

This release does not measure Ximilar accuracy on the owner's original binder photos or certify native iPhone behavior. It fixes how ambiguous results are reviewed and accepted. Pending choices and retries belong to the current in-memory batch; recovery after a full browser reload is not implemented here. The server's receipt retention remains the authority for how long a confirmation can be replayed.

## Remaining connected-selling requirements

The seller workspace, CSV import/export, per-copy records and listing-draft preparation are implemented. This release does not declare the full import-to-sale marketplace workflow complete. The deployed eBay operation handler still constructs its engine with `executionEnabled: false`, and the current connection flow requests read-only scopes. Live seller authorization, a unified copy-availability rule across every sale/export/publish path, explicit write-scope authorization and fee review, real Sandbox acceptance, and production sales reconciliation remain prerequisites for direct publishing. See `ebay-operation-recovery-20261015.md` and `seller-workspace-20261015.md` for the existing boundaries.

No eBay publication or account-setting changes are part of this release.
