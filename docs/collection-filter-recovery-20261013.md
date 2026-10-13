# Collection filter recovery

October 13, 2026

Collection search and saved-value filters previously left an unexplained empty table when no rows matched. Add a no-matches message and a Clear filters action that resets search and value together, retains explicit selections, and returns keyboard focus to search. Disable Select visible when no cards are shown and Clear selection when nothing is selected. Expose result counts as a polite status update for assistive technology.

Verified with controlled browser fixtures at 390px and 1280px:
- Collection/draft preparation: 94 checks passed, including 22 new checks for empty results, hidden selections, reset, keyboard focus and inactive controls. Existing uncertain-request recovery, capacity and account isolation coverage passes.
- Complete shipped-asset customer journey: 104 checks passed.
- Asset references and fingerprints: 157 checks passed.

This changes only local Collection controls and presentation. It does not modify account data, billing, prices, credits, draft APIs, or advertising campaigns.

## Release verification

Released to production as commit `6f2cae704c29a9e2c0120b94a4878773705c70d4`, deployment `dpl_GWpakMbDjArvUoNm4xzrsNmDbxXA`, and merged in PR #62. The release preserves the already-live upstream account-grant implementation (`adf0977`); this change does not configure or claim any grant.

Live browser check at https://www.cardresell.org/ used the two pre-existing browser-only QA cards: select both, apply search and Under $5 filters until no rows match, then Clear filters. The live page displayed the no-match explanation and both hidden selections, restored both cards with both selections intact, reset the value filter and search, and returned focus to search. Screenshot: `collection-filter-live-20261013.jpg`.

After incorporating the upstream change, the 104-check customer journey still passed. Isolated account-grant (38), credit-ledger (281), owner-feature (28), and draft-plan capacity (69) checks also passed. Redis checks used the harness's authenticated loopback fallback because Unix sockets were unavailable in this test environment. No production account or credit operations were performed.
