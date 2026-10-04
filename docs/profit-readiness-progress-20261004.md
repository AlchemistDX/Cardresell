# Photo capture reliability — October 4, 2026

Implemented and locally verified; publication/deployment status will be recorded after delivery.

- Single ID scan, grading front/back and edge capture now show short, task-specific photo instructions. No paid AI call powers this guidance.
- Camera sessions discard late permission results, play completions and photo callbacks after cancel or replacement. Obsolete streams stop; teardown clears the video source. Double shutter taps produce one capture, with retry available after encoding failure.
- Photo QC records only accepted photos in duplicate history. Small/blurry rejected images no longer poison a corrected retake. Intentional duplicate override remains available.
- Rejection copy describes similarity rather than claiming card identity, removes the uncalibrated sharpness score from user instructions, and states that no credit was used at this pre-request stage. Rejected-photo controls and temporary preview URLs are cleaned up.
- Actual index references new immutable core/UI assets; old assets retained unchanged. Authentication, billing routes, prices, ledger and recognition thresholds unchanged.

Verification: full repository gate passed with 72 slots (69 executed, three existing explicitly skipped slots); decoder 10, retake 8 and camera lifecycle 11 cases passed. Browser fixture passed all four capture modes at 390×844, 844×390 and 1280×900, with visible controls, readable guidance and working Cancel. Test runtime: isolated Redis 7.4.2, Chromium 153. Initial runs failed because the local browser runtime was missing; restored runtime and reran the complete gate successfully.

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
