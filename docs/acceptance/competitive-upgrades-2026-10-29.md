# Competitive upgrades — 29 October 2026

## Changes

Search now distinguishes matching query name/set/collector terms from broader suggestions in the full results grid and list. Matching rows come first by default; broader candidates remain visible and selectable. Explicit price sorting is preserved. Base Set 2 is not labelled as a Base Set match, and a related card name does not inherit an exact-name match. This is a text-match aid, not proof of the physical finish. No extra questionnaire, scan or provider lookup is introduced.

Provider usage reporting previously discarded the newer card OCR, OCR-read and slab-identification operations. The report now shares the observer's operation list and includes those attempts, failures, image counts, median and p95 duration. Unknown tokens/images stay unknown. Durations describe individual provider attempts, not end-to-end user latency. No billed credit or dollar amount is invented.

The public accuracy page now publishes the dated eight-card / 16-attempt major-game identity acceptance, with original versus reduced-quality results, the transformation recipe, image hashes, tested commit and limitations. It explicitly separates finish, grade-price availability and the unresolved non-major-game examples. Photos are not redistributed. The stale summary in the internal case manifest is retained under a superseded label and replaced by the final recorded results. The public report describes the earlier tested build, not a fresh scan of this release.

The competitive work plan has been reconciled with these changes. A seller-pilot procedure and proposed thresholds are prepared in seller-pilot-protocol-2026-10-29.md; no participants have been contacted.

## Verification

- Targeted shipped-renderer search checks: 70 passed, zero failed, across 390px and 1280px grid/list views. Includes stable identity selection after reordering, explicit price sort, fallback disclosure, no-result/error distinction and duplicate-request prevention.
- Provider timers/usage: 41 passed, zero failed, including each previously omitted operation, duplicate log events, unknown fields and timing aggregates.
- Accuracy/fee parity: 50 passed, zero failed; rerun after the page date/navigation update.
- Full 176-entry release runner: exit 0, ALL CHECKS PASSED, 408.475 seconds. Real-store credentials and production HTTP smoke were explicitly skipped; condition browser interaction was enabled and passed 17 checks. This is not a real purchase, real Seller Hub import or physical-device test.
- Existing integrated suites passed, including collection import 102, collection export 17, eBay listing review 114 plus 42 browser checks, eBay listing operations 94 plus 42 browser checks, and selling selection 150.
- Local and sandbox file hashes match. No production inventory, drafts, purchases or marketplace listings were created for this release.

## Release

Application commit: `02f31e0dcab0c46f1c515cb218c1792fd9e0fc2e`; final table presentation commit: `41fec9a5854d7a562749000c24c0a40a185d0308`.
Initial production deployment: `dpl_7X7vnefEErNTHu8i5sTjGHe7PbA2`; final presentation deployment: `dpl_2t6U2G8o33SHNbbc1ucSrPKrAoui`.

| File | SHA-256 |
|---|---|
| index.html | 305cd8a37ac25e512e56269f0bb69f27093e386d38833b06033534b377eae740 |
| js/ui.759878a1.js | 759878a1c72733cde3f394a9f88bb5a79e7a7e6fba8ab957fff10325e9e61762 |
| accuracy.html | 207932df065fdcd3db0317ba94792cf05c11789c482f861a3b5890c6d62f036c |

## What remains open

These upgrades do not make the entire competitive plan complete. The remaining gates require evidence or account capabilities not supplied by this code change:

1. Actual Seller Hub CSV acceptance and the intended seller's policy/location readiness. Reviewed publishing machinery is covered by fixtures but is not advertised as enabled automatic publishing.
2. Physical iPhone Safari camera, permission retry, rotation, background/resume and poor-network acceptance, plus an actual second-device inventory journey.
3. Current provider usage/billing exports and the TPL plan's history entitlement. Do not double-count fixed allowances as marginal usage; history and market-wide individual sold transactions are not silently unlocked by OAuth.
4. A broader independently labelled photo sample and independent seller pilot. Development regression photos do not establish population accuracy or retention.

Earlier owner payment evidence remains valid for its scope. This release does not require another purchase merely to repeat it. No keys/passwords, recruitment messages, advertising spend or live marketplace publication are needed to inspect these changes.

## Production observations

The deployed app loaded `/js/ui.759878a1.js`. Searching “Charizard Base Set” returned 100 candidates, with one matching result first: Base Set #004/102. Base Set 2 and the other printings carried “Broader suggestion” labels. The Business account comparison restored without clicking Calculate. Screenshot: [search result labels](screenshots/search-upgrade-2026-10-29.jpg).

The public accuracy route displayed the dated 16-attempt record and manifest link. Visual review identified missing table spacing; the final follow-up reuses the existing responsive table wrapper/styles. Targeted parity remained 50/50, and isolated 390px/1280px browser checks confirmed all eight card rows and no document-width overflow.

Five error-level runtime records on the initial deployment were inspected in the bounded post-deploy window. All were Node DEP0169 url.parse startup deprecations; no application exception appeared in that sample. This does not establish future uptime.

Final deployment reached READY on both production domains. Reloading the public accuracy route confirmed the styled, horizontally scrollable results region with all eight rows. Screenshot: [published identity evidence](screenshots/evidence-upgrade-2026-10-29.jpg).
