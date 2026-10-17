# Bulk seller workflow continuity

Continues the owner's request that the seller workflow be smooth and understandable. Base: `847e02529255786a20ef18234e8da000f68a2d2b` on `codex/profit-readiness`.

## Problems addressed

The old completion screen hid Review Drafts under More actions and destroyed the scan batch when opening drafts. Closing and reopening Bulk Scan also discarded work. Saving a partly identified batch marked the entire batch finished, disabling the unresolved cards' recovery controls; repeating the save could create duplicate inventory. View Collection could reopen the Drafts section because it restored the last collection tab.

## Resulting journey

- The completion screen states how many physical cards can be saved and how many still need identification. It offers the next review directly, and disables saving when no accepted card is available.
- Sellers can save accepted cards while leaving misses and unconfirmed choices available. Only a successful local write marks a row saved. A repeated save skips those rows. Saved rows direct edits to Collection, and stop participating in new scan-draft selection or duplicate grouping.
- The upfront pack cost is split across every physical card in the batch, including unresolved cards. After the first successful save, the per-copy share stays fixed for later recovered cards; the full pack cost is not applied again. Removing an unresolved card leaves its share outside Collection rather than silently reallocating costs already saved. Individual inventory costs remain editable in Collection.
- Review Drafts appears directly after drafts exist. It opens the existing Drafts screen and retains the batch, photos, selections, receipt choices and retry state. View saved cards explicitly opens Cards. Back to Bulk Scan restores the prior screen.
- Closing the bulk screen retains scanned and queued work in the current tab. Scanning can finish in the background; pending draft requests and uncertain confirmation outcomes must settle before leaving. Opening Bulk Scan resumes the existing account's batch. A different account cannot save or adopt the earlier batch.
- Start new batch accurately names a reset. Unsaved rows and queued photos require an explicit discard decision. Saved inventory and drafts are retained. The default choice keeps the current batch.
- Selection and return controls have 44-pixel touch targets. Short viewports use one scroll surface so controls cannot be clipped below the screen.

The existing receipt-bound confirmation, server draft idempotency, cloud-sync reporting and marketplace publication boundaries remain authoritative. Partial saves never accept an uncertain identity or send an extra identification request. The client-only saved-row marker is not included in inventory records.

## Evidence and limits

`tests/bulk-workflow-browser.mjs` exercises the shipped app and real browser storage at 320, 390, 844 and 1280 pixel widths. It covers partial-save recovery, physical-copy counts and cost allocation, repeated-save protection, storage rejection, draft and inventory navigation, queued-photo retention, account changes, visible touch controls and reachable actions in landscape. Post-scan rows, auth and service responses are synthetic. Existing bulk confirmation, catalogue recovery, Magic recovery, finish, draft integration and full regression gates remain required. Counts and deployed identities are recorded in the release PR.

Retention is within this tab's current session; a full reload does not restore an unfinished scan batch. Saved inventory and account drafts use their existing persistence. This change does not validate recognition accuracy on the owner's original photos or native iPhone camera behavior. Direct eBay publishing and sales reconciliation remain unfinished; no marketplace writes or paid provider scans are used for this release.

## Release checkpoint

Implementation and test commit: `def9aadb57daed72c6f0dd033fb422c9cbaab095`, tree `21c0b2e3c3565ca9ead0f77dc4660d59ae432bd2`. The final documentation checkpoint changes only this note.

Completed local release gates:

- Workflow: 164 checks across the four viewports.
- Bulk receipt confirmation: 398; catalogue lookup recovery: 88; Magic printed-name recovery: 43; finish review: 223.
- Full regression: 144 registered slots, 141 executed, three declared exclusions; final run reports ALL CHECKS PASSED. Exclusions are the real-store draft pass, production smoke in local mode, and optional condition-pill browser interaction.
- Two old test assumptions were updated without removing their behavioral coverage: the finish gate now restores a separate unsaved fixture after testing persistence, and the accessibility gate evaluates both the new recoverable Escape closer and its loading fallback. The initial full run failed only the old exact-source closer assertion; the complete rerun passed.

Publication is blocked, not completed. The GitHub plugin is installed and enabled, but the blob-upload attempt stalled and both repository metadata and release-PR reads timed out. A normal Git push failed because this checkout has no configured push credentials. No feature ref, PR, preview, or production deployment was created by this release attempt. Do not describe these changes as live.

Next release steps: restore working GitHub access; publish the committed branch `codex/workflow-20261017`; open a PR against `codex/profit-readiness`; verify preview and exact commit status; merge; deploy the merge SHA to the existing production Vercel project; verify the live assets, authorization boundaries and runtime logs. The current application assets are `js/ui.d6a39a2e.js`, `js/core.532e8d96.js`, `js/bulk-match-review.c2c8db30.js` and `js/bulk-workflow.8b3b6278.js`. Retain older immutable assets.
