# Camera-roll grading, single-scan drafts and plan benefits

## Changes

- Quick and Deep Grade ask Take photo / Upload photo once per session. Upload opens one checklist: Front/Back for Quick; Front/Back/Top/Bottom/Left/Right for Deep. Slots open the library directly, accept any order and show replaceable thumbnails. Uploads use the existing resolution/body budgets and validation; iOS HEIC files still require JPEG export if the picker does not convert them.
- Quick Grade reviews front/back with replacement controls and an explicit 1-credit submit. Deep retains its existing explicit submit and minimum two edge views (four recommended).
- Successful single ID scans retain the result screen and offer Create draft. This uses the same card mapper, server validation, idempotent draft creation and local scan-photo attachment as bulk drafts. No condition or price is invented. Each scan gets a separate copy identity; repeated taps/retries retain it.
- Subscription cards explain intended use, payout-comparison access and pack discounts. Starter has Free's venue tools; Business has Pro's venue tools. Dormant storage quotas, unverified support promises and grading-accuracy upgrades are not advertised.

## Verification

- Isolated browser checks at 390×844 and 844×390: camera/file choice, cancellation, repeated uploads, front/back review, four edge assignments, explicit submission, draft retries/double-click guard, different physical copies and successful draft navigation.
- Real compression functions and DOM; synthetic camera, grade and draft services. No vendor scans or customer credits.
- Existing grade capture resolution suite: 28 checks passed.
- Existing membership shop identity suite: 201 checks passed.
- Existing draft store suite: 147 checks passed.
- Subscription browser rendering uses the real public catalogue and checks all five plans and horizontal overflow.

## Phone acceptance

1. Open Quick Grade → Upload photo. Pick a camera-app front photo, then a back photo. Verify no charge until Submit Quick Grade.
2. Replace either photo; cancel a photo picker and reopen it. Verify the correct photo remains assigned.
3. Open Deep Grade. Upload front, back, top, bottom, left and right individually. Add the slots in any order and replace one. Verify no repeated source-choice popup.
4. Try an unsupported or unreadable file. Verify a clear error and no grading request.
5. Run a single ID scan. Confirm the identity, tap Create draft, and check its details/photo in draft review. Enter condition and price yourself. Nothing should publish automatically.
6. Retry the same draft request after a simulated failure in a test environment; verify one draft. A separate scan of another copy should be separate.
7. Open Subscriptions on your phone. Verify all five plan cards, their benefits and prices are readable; compare Casual's expanded venues and Pro/Business's full set.

These tests do not establish grading accuracy, catalogue parity, real iOS picker behavior or production billing correctness.
