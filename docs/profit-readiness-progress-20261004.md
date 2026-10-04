## Live account recovery, 2026-10-04 afternoon

Owner authorized a separate secondary live test account after Google security prevented access to the original billing account. Production pilot eligibility is an exact server-configured verified email; all customer, credit and subscription ownership remains keyed to the signed Firebase UID. The original owner/import and paid account are not rebound, reset or merged. Public audience remains closed.

Live logs on deployment G9rtZdWZ6xWKneTZSHLTgPz3wHL2 showed owner_not_allowed on catalogue plus repeated 503 pro-status/scan-credits responses. Saved email verification was read only after a successful balance snapshot, so a missing enrollment caused verification to disappear after reload. Recovery now returns authenticated verification even with unavailable balances; the client restores it before checking billing success, never invents zero balances, and ignores stale responses after an account change. Verification banners wait for that server status. Unavailable settings balances explicitly direct account setup/retry in Shop.

Code verification now checks the datastore acknowledgment, not HTTP status alone. New immutable core/auth assets preserve prior generations. The separate pilot must use normal Shop account setup; this enrolls its own free credits and does not charge a card. Checkout/payment acceptance remains pending.

Validation: focused membership gate completed all 37 invocations; authentication 30, enrollment flow 10, normal membership routes 71 checks passed. Four repeated normal verification attempts with missing enrollment remained at one 10-ID/1-Grade award while each subsequent status response retained verification. Eight repeated/concurrent pilot enrollments stayed at 15 ID/2 Grade total, with the existing paid enrollment byte-identical. Frontend/entitlement regression 78, auth integrity 96, asset fingerprints 97, Firebase claim 10 passed. These are isolated regression results, not authenticated live acceptance. Deploy with a Production rebuild and verify the live SHA; owner checks remain required.

# Latest live acceptance — October 4, 2026, 16:11 UTC

Owner used the secure browser sign-in prompt and chose Google. Live UI shows signed-in Will. Subscriptions returns generic billing 401. Production log for deployment dpl_EHAizvoHF4WtGZbqtJf4Sn6KQtez at 16:11:20 reports `MEMBERSHIP_AUTH_REJECTED owner_not_allowed`. This occurs after cryptographic identity and email authority have passed. The signed-in UID is not the reserved billing owner and Production is using owner-only admission. Do not repeat email verification or sign-in as a speculative fix. Do not rewrite owner bindings, migrate balances, or remove the audience gate to make this account pass. Establish with the owner whether this is the original purchasing account; then resolve the intended public launch separately from preservation of the original account. Public five-plan/seven-pack views are live and correct. No new charge was attempted.

# Live-only profit readiness — October 4, 2026

Owner direction: zero current users; prioritize the minimum reliable paid product and advertising readiness. All deployed acceptance uses www.cardresell.org. Preview is not a prerequisite or an owner action. Work from the current Production code and build with Production bindings.

Released source `3ecd4e776065ca063b20d796fa8ef34b453c3fed` (local `25d17df`, identical tree `177cad3a66ae0e3c066f6f3bacb36445fa97e8a5`). Production deployment `dpl_EHAizvoHF4WtGZbqtJf4Sn6KQtez` is READY, built using Production settings. Live index, unchanged sign-in and new shop asset match reviewed bytes. Catalogue returns five plans/seven packs; signed-out purchases remain disabled. Read-only cutover reports this commit, billing not paused, purchasing enabled, datastore authorization accepted, fence installed and no mutation. Live Shop displays all seven approved packs. Initial 5xx query through 16:02:39 UTC returned no matches; this is a short observation window. Existing owner sign-in is the next acceptance dependency; this browser is signed out.

Current slice: repair Firebase email-claim field mismatch (`emailVerified`), require confirmed persistence before reporting verification success, and direct verified identities missing email authority to the existing in-tab Verify email flow. Preserve pending-operation history; no automatic email send, credit rewrite or authentication bypass. Production sign-in and camera fixes remain intact.

Local verification: Firebase handler 10 cases, membership authentication 28 checks, storefront identity/recovery 129 checks passed. Focused membership gate passed all 37 invocations. Full regression gate passed all 73 slots (70 executed; three existing external/opt-in skips). These checks are synthetic and do not establish live email completion, charge acceptance or recognition accuracy.

Next live acceptance: verify current assets and public/billing read-only routes, then existing owner sign-in, verification if required, and account visibility. Reuse accepted purchase evidence; no extra real charge is authorized by this code change. Remaining profit work: supported card recognition evidence, provider failure/cost accounting, and a small measured seller pilot before advertising scale.

Rollback baseline: production deployment dpl_9Jp4RZbKqCx3chDpYs9VXpBq2keV, source 7520acb92685bfdaed64c746cf2dc012d3c82459. This direction supersedes earlier Preview-based acceptance instructions below.

---

# Photo capture reliability — October 4, 2026

Published as `7520acb92685bfdaed64c746cf2dc012d3c82459` (local commit `921b4e7`; identical tree `1219393ceaecb28649a45fa7ef9a3840c515e1b4`). Production deployment `dpl_9Jp4RZbKqCx3chDpYs9VXpBq2keV` is READY, built with Production settings in 43 seconds.

Post-deploy checks: live index, both new bundles and unchanged sign-in HTML match reviewed bytes exactly. Health, catalogue and read-only cutover status return 200; cutover identifies commit `7520acb`, purchasing enabled, billing not paused, database authorization accepted, fence installed and no mutation. No purchase or physical-camera acceptance was performed.

The initial post-release error-log sample through 14:28:43 UTC contains Node url.parse deprecation warnings and an upstream eBay sold-search 403 on a route returning HTTP 200. This is not a clean-log claim, and the cause/pre-existing status is unconfirmed. Track it in the next provider reliability investigation; no provider request policy was changed here.

- Single ID scan, grading front/back and edge capture now show short, task-specific photo instructions. No paid AI call powers this guidance.
- Camera sessions discard late permission results, play completions and photo callbacks after cancel or replacement. Obsolete streams stop; teardown clears the video source. Double shutter taps produce one capture, with retry available after encoding failure.
- Photo QC records only accepted photos in duplicate history. Small/blurry rejected images no longer poison a corrected retake. Intentional duplicate override remains available.
- Rejection copy describes similarity rather than claiming card identity, removes the uncalibrated sharpness score from user instructions, and states that no credit was used at this pre-request stage. Rejected-photo controls and temporary preview URLs are cleaned up.
- Actual index references new immutable core/UI assets; old assets retained unchanged. Authentication, billing routes, prices, ledger and recognition thresholds unchanged.

Verification: full repository gate passed with 72 slots (69 executed, three existing explicitly skipped slots); decoder 10, retake 8 and camera lifecycle 11 cases passed. Browser fixture passed all four capture modes at 390×844, 844×390 and 1280×900, with visible controls, readable guidance and working Cancel. Test runtime: isolated Redis 7.4.2, Chromium 153. Initial runs failed because the local browser runtime was missing; restored runtime and reran the complete gate successfully. The legacy syntax slot also referenced a former workspace path and initially skipped its two inputs internally; after restoring that test-only path, its eight inline script blocks passed with zero errors.

Limits: browser fixtures use mocked camera permission/streams; physical iPhone capture, provider recognition quality, catalog coverage, failed-provider charge reconciliation and measured 90% accuracy are not established by this slice. Do not advertise an accuracy percentage from these results.

Rollback baseline for this slice: live code `ccbe04757004104cfe7661f0acffe4c254516486`, deployment `dpl_RsDGG3A8GajJdcsiiDTcx87qoEdm`. The working live sign-in remains intact.

---

# Production release verified — October 4, 2026

This section supersedes the historical blockers below.

- Published commit: `ccbe04757004104cfe7661f0acffe4c254516486` on `codex/profit-readiness`. Remote tree exactly matches the locally verified tree `06b5b3d98dce07b5aba9b122e73f456840ef851a`.
- GitHub access fixed: owner approved connector installation 167822516, scoped to AlchemistDX/Cardresell only. Actual blob writes succeeded.
- Production deployment: `dpl_RsDGG3A8GajJdcsiiDTcx87qoEdm`, built with Production settings through Vercel dashboard after explicit owner approval. READY; build approximately 40 seconds.
- Live `www.cardresell.org` returned the exact reviewed index, new core bundle and unchanged sign-in HTML.
- Health and public catalogue returned 200. Five plans/seven packs retain approved prices and permanent-credit wording.
- Read-only cutover check reports the new commit, purchasing enabled, billing not paused, datastore authorization accepted and legacy fence installed. No data mutation was performed by that check.
- Signed-out live Shop shows separate ID/Scan and Grade sections. Close remains visible at the bottom of the scrolling dialog. Authenticated sign-in/payment and physical iPhone acceptance were not rerun.
- New deployment 5xx log query through 13:10 UTC returned no matches. This is a short post-deploy window, not proof of long-term error absence.
- Rollback target remains prior live `dpl_2t4ofvn9xokcfHNT3VA7oJtRo4i9` (source `98320d2`). Do not use the older default main branch as the live baseline.
- Outstanding: calibrated recognition/search accuracy, photo capture assistance, real subscription lifecycle acceptance and revenue/cost measurement. These deployment checks do not establish scanner accuracy or readiness for paid advertising.

## Historical checkpoint

# Profit-readiness implementation checkpoint

## Publication access — GitHub blocker resolved, deployment pending

Application/test fixes are committed locally as `b02702e` and `d66d4af` on `codex/profit-readiness`.

- On October 4, the owner approved installation of the ChatGPT Codex Connector for **AlchemistDX/Cardresell only**. GitHub installation 167822516 was verified; a real `create_blob` operation succeeded. The earlier 403 resulted from account authorization without a repository installation.
- CLI Git still has no saved credentials; publish through the authorized GitHub connector.
- Vercel CLI previously reported logged out. A supported Production build path is still required; do not promote a Preview build with test bindings.
- No API keys, database credentials, Stripe changes, additional purchase or Preview sign-in are requested.

The full local gate and isolated browser fixture passed before this publication attempt. Three existing external/opt-in slots remain skipped; no claim of finished real subscription lifecycle or scanner-accuracy acceptance is made.

## Latest update — test environment restored

The earlier browser/dependency blocker below is resolved. Installed isolated test dependencies, unpacked Chromium 153, and built Redis 7.4.2 from the official source. No managed database was used. Added an explicit password-protected loopback mode to the test-only Redis helper because Unix sockets are unavailable here. Fixed the scan-miss test's former-workspace absolute path.

Full local gate now passes: 71 slots total, 68 executed and three explicitly skipped external/opt-in slots. Shop fixture checks passed at 390×844 and 1280×900 for both views: seven packs/five plans, no horizontal overflow, Close reachable at the bottom, focus restored after closing. This remains desktop Chromium emulation, not a physical iPhone claim.

Also fixed request timer cleanup in recognition and grading wrappers. Eight mocked provider cases pass; no live provider requests or charges were made. These fixes do not establish scan accuracy.

Current release blocker: Vercel CLI reports logged out, and the connected tools exposed here do not provide deployment creation. Promotion alone would reuse Preview bindings, so it is not a safe substitute for a Production build. Production is unchanged. Continue independent readiness work while obtaining a supported authenticated deployment path.

Branch: `codex/profit-readiness`, based on live source `98320d2`.

## Implemented, not deployed

- Shop/Subscriptions header stays at the top of the scrolling dialog so Close remains reachable. The notice scrolls normally rather than competing with the header. Mobile spacing is explicit.
- Photo QC tries the image-element decoder when `createImageBitmap` rejects or throws. Both decoders must fail before reporting unreadable. Resolution, blur and duplicate decisions are unchanged. No claim of new format support or improved recognition accuracy is made.
- Updated the actual embedded QC code and emitted `core.68dc8d04.js`; retained the previous immutable asset. The membership JavaScript remains the live version.
- Added decoder regressions for canonical and shipped code and registered them in the repository runner.

## Verification

- Photo decoder: 10 cases passed, zero failures.
- Existing live-baseline Shop identity suite: 122 passed, zero failures.
- Asset fingerprints: 97 passed, zero failures.
- Updated test registry: 12 passed, zero failures.
- `git diff --check`: passed.
- Full local gate was attempted. It did NOT pass: 14 suites failed to complete because of unavailable dependencies (redis/acorn or hard-coded former-workspace Playwright paths). Three existing external/opt-in checks were explicitly skipped. The initially missing new-suite registration was corrected and its guard rerun successfully.
- Layout browser fixture is prepared outside the checkout. It could not launch: Chromium is absent. Playwright's Chromium installation attempted the provider download but received invalid/truncated archives and failed. No visual-pass claim is made.

## Release blocker

Restore a runnable Chromium and the existing test dependencies in this execution environment, then complete the full local gate and desktop/mobile layout checks. Do not skip the failed gate to deploy. No owner purchase, sign-in, credential change or new paid service is needed to resolve this tooling issue.

Production was not changed. Authentication code, ledger, balances, prices, billing behavior and cancellation were not modified. B02 authenticated acceptance and subscription lifecycle acceptance remain incomplete; the separate Preview verification-record issue is not fixed by this work.

Once verification is available, deploy only the tested bounded changes with the current live commit available for rollback; do not merge the unfinished Preview authentication branch wholesale. Advertising remains gated on demonstrated scanner/search reliability and the outstanding financial acceptance.
