# CardResell: customer workflow readiness

Reviewed October 13, 2026. This is the application workflow pass requested by
the owner, covering a new visitor finding a card, deciding how to sell it,
saving inventory, preparing drafts and returning later. It does not launch ads.

**Release status:** implemented locally on `feat/advertising-workflow-polish`,
on top of the earlier search/Collection improvements in `56bfce6`. Not pushed
or deployed. Production was last inspected at `ca463a5`.

## Improvements prepared for release

| Friction | Result after this batch |
| --- | --- |
| Sign-in loses the task | Drafts returns to Drafts; ID and Grade return to the appropriate chooser; Collection draft preparation returns to Collection. The header uses the current section. |
| Sign-in return erases other URL context | Consume only the allowlisted `next` parameter, retaining campaign, return parameters and fragments. Existing same-origin destination restrictions remain. |
| A task resume could start work unexpectedly | Resuming opens a screen or chooser. It does not start the camera, submit a paid scan, create a draft or start checkout. |
| Saving gives no clear completion/next step | Show a named save confirmation and a direct View Collection button. Anonymous saves explicitly say they are on this device. The button opens Cards even if Drafts was the last section. |
| A known $0 becomes missing | Preserve zero as a seller-entered value. Empty current value remains unknown; negative/invalid Collection amounts stay in the form for correction. |
| Save forms can carry previous inputs | Clear entry fields when opening a new entry. Closing after success uses the same cleanup as cancellation. |
| Closed dialogs remain keyboard targets | Closed modal overlays leave layout and focus navigation. The save dialog receives focus, traps Tab, supports Escape and restores focus to its opener. Fields have associated labels; status toasts are announced. |
| Prepare drafts is a dead end while signed out | The selected-card action explicitly offers sign-in and retains the Collection destination. Selection itself is not promised to survive an account change. |
| Retry cloud sync appears before a failure | Show recovery only after a reported cloud error; hide it while syncing and after the server confirms a save. Local save and cloud confirmation remain distinct. |

This includes the previously prepared search request reuse, stale-result
protection, truthful provider errors, Collection value filters, visible/hidden
selection counts and one-read batch lookup described in
`advertising-workflow-review-20261013.md`.

## Verification

Tests use the shipped entry document and its current fingerprinted assets.
Synthetic provider/account services are isolated; these checks do not spend
customer credits or place orders.

| Boundary or journey | Evidence |
| --- | --- |
| Search → selected card → low-value advice → save → Collection → reload | New full-app browser journey: 90 checks passed across 390px and 1280px, including invalid costs, zero-value persistence, focus and cancellation. |
| Signed-out action → sign-in destination → resumed screen | Same journey covers all six allowed destinations, rejection of unsafe redirects, one-time parameter consumption, preserved campaign context, and no automatic camera/scan/grade operation. Actual Firebase credential entry was not repeated. |
| Local data → cloud request → failure → retry → confirmation | Real sync client against controlled 503/success responses; one retry request, accurate device-only feedback, and removal of the recovery control after confirmation. This is not a new cross-device production test. |
| Navigation, plans and responsive UI | 642 checks passed across 320px, 390px, 844px landscape and 1280px, in light and dark themes. Mobile Collection screenshot inspected. |
| Collection selection → prepare drafts | 72 browser checks passed, including account boundaries, ambiguous identity refusal, limits and retry behavior. |
| Draft selection → delete | 30 browser checks passed, including confirmation/cancellation and preservation of other drafts. |
| Selling guidance and preferences | 63 checks passed, including under-$5 boundaries, shipping preferences, missing values and changing costs. |
| Grade photo selection → validation → submission → draft handoff | Quick/Deep upload and single-draft browser suite passed at phone portrait/landscape sizes; synthetic photos, camera and services. No physical-phone or paid-grade test repeated. |
| Membership sign-in and purchase boundaries | 256 identity/checkout checks passed, including account changes and recovery. No real payment was submitted. |
| Contrast | 14 checks passed in both themes. Dialogs are explicitly opened in the fixture so their labels remain measured after closed dialogs leave layout; the 180-node coverage floor was retained. |
| Asset safety and configured build | 117 asset checks passed; `npm run vercel-build` and whitespace validation passed. Previously shipped immutable assets remain available. |
| Current public production APIs | 18 checks: 17 passed, one degraded, zero failed. Automatic eBay sold comps remain unavailable. This is a check of the current production release, not of the unpublished client changes. |

The grade/shop browser fixture was updated to open the current collapsed Plan
details and check current Business copy. The first regression run exposed the
contrast fixture's reliance on closed dialogs having layout; explicitly opening
them restored coverage without weakening its assertions.

The final 119-slot regression run passed: **116 suites executed successfully;
three optional checks were skipped** (real-store validation, the runner’s
production HTTP probe, and the separately gated condition-pill interaction).
The production public HTTP probe was run separately as shown above. Skipped
checks are not passes. The final run completed after the contrast-fixture
correction.

## Advertising readiness decision

The local workflow is ready for the owner's release review. The remaining
release step is to publish this exact tested batch and check the deployed
search, save, sign-in-return and Collection/draft paths. Local tests cannot
certify unpublished behavior on the public site.

The earlier automatic approval review rejected publishing without explicit
owner authorization. This review and the implementation are prepared before
requesting that final approval. No push, production deployment, campaign or
company email was initiated in this pass.

Keep the public promise focused on supported behavior: identifying/researching
cards, comparing **estimated** selling outcomes, considering low-value lots,
and preparing drafts for review/export. A draft/export is not a published
marketplace listing; automated eBay sold data remains degraded.

Existing release work already includes selected draft deletion, expanded
venues, bulk shipment comparisons, preference-based selling advice, mobile
subscriptions and campaign attribution. Provider permissions are already
confirmed by the owner and are not a reopened gate. Prior backup/restore and
physical-phone/payment evidence should be evaluated from their original
records, rather than silently marked as retested here.

## Further efficiency work

The completed request-sharing and batch-index changes remove repeated work in
common seller actions. The large shared JavaScript bundle remains a separate
performance opportunity; this pass does not claim measured mobile load-time
improvement or bundle-size reduction. Splitting that bundle needs a measured
load-order/cached-client change, not an unverified rewrite during release QA.

Follow the first advertising cohort through completed useful actions, with QA
traffic excluded. Reconcile actual billed provider usage before increasing
spend; event counts and a local browser pass are not evidence of unit economics.
No ad budget is approved or spent by this review.
