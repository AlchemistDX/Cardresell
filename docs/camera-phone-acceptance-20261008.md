# Camera phone acceptance — October 8, 2026

Scope: front/back camera hints and existing capture/retake behavior. Pilot stays on. No purchases or submitted grading requests are needed for this checklist.

Before starting: fully close the CardResell tab, reopen https://www.cardresell.org, and open the Deep Grade camera. Hold each test scene steady for at least 2–3 seconds; hints require three consecutive observations. Do not use a Preview URL.

1. Clear card: on an evenly lit plain surface, fit all four corners inside the guide. Expect a neutral manual-check message, not a green quality guarantee. Persistent softness warnings on readable text fail this check.
2. Blurry card: move close enough that small text is unreadable and hold still. Expect a softness warning. Move back until text is sharp; the warning should clear.
3. Covered/dark lens: cover the lens fully for 3 seconds. Expect “View is too dark” guidance. Uncover it; the warning should clear. No tape needed.
4. Glare: tilt the card under a light so a bright patch hides details, hold, then remove the reflection. Expect reflection/bright-light guidance, then clearing. A bright background alone must not be described as a confirmed reflection on the card; general lighting advice is possible when no outline is found.
5. Framing and movement: move the card partly outside the guide, then center it. Guidance must not claim a good capture or keep an obsolete movement instruction. Some scenes will retain manual framing guidance because geometric detection is uncertain.
6. Capture and retake: capture the front and back, replace only the front, and confirm the back is retained. Check the edge-photo guidance and capture one edge. Stop before submitting the grade; cancel and reopen the camera twice. The feed must remain live, with no stuck shutter or duplicated capture. On iPhone/iPad the zoom slider is intentionally absent to avoid the reported hardware freeze.

Send one screen recording, approximate time and failed test numbers. If “Live checks unavailable” appears, include it in the recording. No additional paid scan is required.

## Engineering evidence

Baseline production: 00ba491 (confirmed through the production alias on October 8). The October 8 recording showed generic hints while the scene varied. Code inspection found that focus, featureless-frame and darkness checks ran only for a usable card-outline candidate. Losing geometry therefore suppressed those checks.

Fix: sample the guide even without an outline and describe uncertain results as view-level warnings. Only localized scores are attached to card capture metadata. Darkness/overexposure take priority. Analysis exceptions or a missing helper get explicit manual-check guidance. Hint stabilization now tracks both identity and text, so switching from a located card to an uncertain view cannot keep stale card-specific wording. Shutter remains advisory/unblocked. iOS hardware zoom remains disabled.

Validation: camera lifecycle 37 cases; capture resolution 28; decoder 10; retake history 8; mobile accessibility 178; asset fingerprints 101. A separate real Chromium integration exercises the shipped QA functions, renderer, canvas and same-origin worker in seven scenes (dark, featureless, soft, sharp, reflection, overexposed, recovery), with no page errors and no provider calls. Syntax and diff checks passed.

Recording replay: 32 guide crops at 2 frames/second. At 3.0/3.5 seconds, mean luminance was 2/1 and focus was unmeasurable: the new helper returns darkness advice. At 5.0/5.5 seconds, focus scores were 17.6/20.1 and advice was neutral. Multiple visibly soft intervals return softness advice. These are compressed screen pixels, not raw phone-camera calibration; physical-phone acceptance is still required. Short scenes may not persist long enough for the three-observation debounce.

No server, account, credit-ledger, pilot or image-upload changes. Readiness stays approximately 85% pending acceptance. Release identity and production status are reported separately after deployment.
