# Seller workflow walkthrough — 2026-10-26

The public production walkthrough and isolated seller scenarios found issues in card selection, Collection saving, and closed-panel accessibility. This release fixes those issues. It does not claim that every external marketplace or recognition provider is operational.

## Changes

- Search results distinguish catalogue finishes in both grid and list layouts. The selected card also shows its finish. Search tiles stay compact when there are few results, with readable finish labels on the dark search surface.
- A provider name such as `TCGPlayer Live` cannot become a card finish or enter an eBay research query. The fallback quote is labelled `Base-printing reference`.
- Condition-based provider prices retain their catalogue finish in research, Collection, and draft handoff. Raw provider variant identity remains separate from its readable label, including normal/non-foil matching.
- A delayed successful or failed fallback price request cannot overwrite a different card's printing options.
- Saving from the lookup panel retains the chosen finish and pricing assumptions. Those assumptions do not become a claim that the physical card's condition was inspected.
- A blank acquisition cost remains unknown in Collection; an explicitly entered zero remains zero.
- Closed settings, scan gates, and the photo guide no longer expose invisible controls to keyboard or accessibility navigation.

## Walkthrough evidence

| Seller step | Boundary exercised | Result |
| --- | --- | --- |
| Search and choose a printing | Live public catalogue; local provider-shaped API fixtures | Finish ambiguity reproduced live; corrected display, identity and research handoff verified locally |
| Select condition and selling priority | Live public UI; isolated calculator and draft tests | Least-work priority recommends preparing an eBay draft; selected finish and price assumptions remain consistent |
| Research a price | Live public UI; isolated race and evidence tests | Provider source labels excluded from query; stale responses rejected; unavailable sold data stays unavailable |
| Save to Collection | Isolated real-browser storage, reload and account scenarios | Blank cost, finish, price assumptions, storage failure and account boundaries checked |
| Import inventory | Local browser → API → local Redis and recovery suites | Reviewed import, quantities, cost treatment and interruption recovery checked |
| Scan and binder preparation | Isolated real-browser, canvas and worker scenarios | Batch review, uncertain-match review, finish selection, replacement-photo races and binder interactions checked |
| Prepare listing drafts and photos | Local API/service fixtures and browser IndexedDB | Physical-copy handoff, batch capacity, account ownership, photo storage and retry behavior checked |
| Connect eBay and continue selling | Live signed-out routes; isolated seller connection/review suites | Sign-in return flow and configuration states checked; enabled workflow ends at reviewed CSV export |
| Record sales and recover work | Local browser/API/Redis suites | Saved-sale correction, duplicate/conflict handling and backup recovery checked |
| Account, subscriptions and public pages | Live public UI; synthetic account and billing boundaries | Sign-in gates, subscription catalogue, mobile layouts and keyboard behavior checked; no purchase |

## Verification

- `bash tests/run-all.sh --local`: 165 executed suites passed; 2 explicitly skipped live mutation suites out of 167 registered slots.
- 20 additional suites passed, including customer journey (221 checks), brand/UI (978), binder scan (184), binder interaction (131), listing photos (171), scan finish (223), bulk match review (446), and bulk workflow (188).
- Customer journey covers 320, 390 and 1280px widths. Brand/UI also covers 844px landscape and both themes. Screenshot inspection caught and corrected low-contrast finish labels before release.
- The contrast sweep explicitly opens the newly hidden panels so it still measures them. It passes 16 assertions and measures 200 light-theme / 204 dark-theme token nodes without reducing its coverage floor.
- Test fixtures were brought into line with existing product behavior: open the optional payout comparison before interacting with it; await settings visibility; supply a synthetic authenticated draft owner and a matching draft response identity. Product authentication and identity guards remain intact.
- `git diff --check` and `node tools/membership-release-inspect.mjs` passed.
- Machine-readable suite summaries and asset/log hashes are in `full-user-walkthrough-20261026.json`.

## Limits and remaining work

Recent eBay sold comparisons were unavailable during the live walkthrough. This release does not restore that feed or fabricate price ranges. A live seller connection is not evidence that direct publishing or automatic sales synchronization is enabled; both remain disabled in the current product.

The automated external-service boundaries use synthetic accounts and provider responses. No paid scan, purchase, live listing publication, or customer inventory mutation was performed. Local Redis checks do not replace a managed-production-store mutation test.

Physical Magic/binder recognition accuracy has not been measured by this run. The old screenshots show symptoms but are not a labelled, original-resolution evaluation set. A real-photo provider evaluation remains necessary before making an accuracy claim.

Existing local Node module-type warnings and the previously observed production `DEP0169` warning remain outside this frontend correction. Deployment identity, asset-byte checks and post-release observations are recorded after this commit, rather than asserted in advance.
