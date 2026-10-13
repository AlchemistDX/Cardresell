# Collection filter recovery

October 13, 2026

Collection search and saved-value filters previously left an unexplained empty table when no rows matched. Add a no-matches message and a Clear filters action that resets search and value together, retains explicit selections, and returns keyboard focus to search. Disable Select visible when no cards are shown and Clear selection when nothing is selected. Expose result counts as a polite status update for assistive technology.

Verified with controlled browser fixtures at 390px and 1280px:
- Collection/draft preparation: 94 checks passed, including 22 new checks for empty results, hidden selections, reset, keyboard focus and inactive controls. Existing uncertain-request recovery, capacity and account isolation coverage passes.
- Complete shipped-asset customer journey: 104 checks passed.
- Asset references and fingerprints: 157 checks passed.

This changes only local Collection controls and presentation. It does not modify account data, billing, prices, credits, draft APIs, or advertising campaigns.
