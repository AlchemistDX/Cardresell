# Binder alignment and scrolling audit — October 14, 2026

The owner reported dead alignment buttons and a photo that trapped scrolling.
The failures were reproduced on the complete shipped app before changing it.

| Finding | Before | Correction |
| --- | --- | --- |
| Touch scrolling | Every canvas touch suppressed native scrolling; a swipe moved the photo. | Swipes scroll by default. Move photo enables one deliberate drag and automatically returns to scrolling on release. |
| Taps | Pointer-down discarded all crops and selected cards before any movement. | Taps and small hand jitter preserve crop files and selections. Only a real geometry change invalidates them. |
| Movement limits | At the full-photo fit, arrows appeared enabled, did nothing visually, and cleared selections. | Arrows show their directional limits. The hint explains when zoom is needed. A no-op keyboard movement also preserves selections. |
| Page jumps | Discarding crops collapsed the grid and shifted the scroll position. | Reserve crop-grid space while replacements encode, and retain the selection toolbar. |
| Zoom responsiveness | Encoding crops disabled the focused slider and movement controls. | Alignment remains responsive; stale crop renders are discarded using the existing generation fence. Submission stays blocked until the current crops finish. |
| Interrupted gestures | Cleanup depended on a narrow set of events. | Pointer release/cancel/capture loss, slider release/cancel/blur, window blur, visibility changes and section teardown finish or reset adjustment state. |
| Escape | The full app's document-capture handler closed the whole scanner before the photo handler ran. | Window capture cancels an active binder adjustment first when focus is inside it. |

Before the fix, one full-fit arrow click left margins at zero but changed four
selected cards to zero. Touching the zoomed photo reduced the review height from
2,113 to 1,497 pixels and removed those selections. A swipe then changed crop
margins while leaving the scroll position unchanged. After the fix, the same
tap and swipe preserve margins, crop URLs and selections, and the swipe changes
the review scroll position.

## Verification

- `tests/binder-interaction-browser.mjs`: **131 checks passed** with the full
  entry page and shipped assets at 390×844, 844×390 and 1440×1000. Native touch,
  mouse and keyboard inputs; all four arrows; no-op boundaries; native range
  dragging; scroll recovery; cancellation, capture loss, blur and Escape;
  deliberately delayed/reordered JPEG callbacks; reset; clear/select; reopening;
  original crop pixels, physical card order and bulk credit confirmation.
- `tests/binder-scan-browser.mjs`: **92 checks passed** across both phone
  orientations, including manual edges, rotation, camera capture/permission
  cancellation, replacement files, decode cancellation and resolution boundaries.
- `tests/run-all.sh --local`: **121 suites passed; 3 explicitly skipped**
  (live draft store, production smoke and opt-in condition pill). The runner's
  binder automatic-selection and multipage checks passed.
- Asset fingerprints: **167 checks passed**. Release inspector and
  `git diff --check` passed. Screenshots inspected at all three viewport sizes.
- Synthetic local images only; provider services blocked. No paid identification,
  purchases or customer credits used. The final JPEG still has to meet the
  existing 400px minimum without upscaling, and the bulk confirmation remains
  the spending boundary.

The new full-page suite is declared as a required separate binder release gate
in `tests/test-registry.mjs`. Run it with `CR_CHROMIUM=<binary> node
tests/binder-interaction-browser.mjs` alongside the existing binder scan suite.

This validates alignment, crop preparation and interaction mechanics. Physical
iPhone Safari acceptance, real-world recognition accuracy and poor-light card
identification are not established by these tests. A steeply angled binder
still needs a straighter photograph; the rectangular guide does not correct
perspective.

The release entry page references `js/binder.d3266e27.js`, built directly from
`js/binder.js`. Previously shipped immutable bundles remain intact.
