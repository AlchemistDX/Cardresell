# Rapid Scan parity — October 9, 2026

## Findings and changes

Rapid Scan had retained the old 96×134 brightness/blur heuristic, immediate green “Looks good” state, 1920×1440 camera request, full-sensor JPEG capture and incomplete async cleanup. Single ID and Grade had already moved to outline-aware, card-scoped guidance, neutral advice, higher-resolution capture and session guards.

The live guidance code is now shared, parameterized by camera prefix. Each camera retains independent session, worker, canvas, debounce and sharpness state. Both face-capture paths use the same outline/reflection/focus advice and 500-ms sampling, with three observations before a new instruction. Grade edge photos retain edge-specific advice. No missing warning is presented as a guarantee of sharpness or grading accuracy.

Rapid Scan requests the same ideal 3840×2880 rear-camera mode (actual hardware support varies), captures the visible video area with the same extra margin, and uses JPEG quality 0.92. Single ID and bulk ID still use their existing matching 1200-pixel/0.90 identification payload preparation; grading keeps its purpose-specific higher-detail preparation. Existing iOS hardware-zoom disablement applies to both camera flows.

The camera now invalidates pending permission, playback, guidance-worker and JPEG callbacks on close or mode change. Late streams stop; stale photos cannot enter another queue. Repeated shutter taps during JPEG encoding create only one photo, and Review waits for encoding. Leaving Rapid Scan clears the preview, tracks, timer, worker, resize handlers and zoom listeners. Single-camera playback errors now reach its existing native fallback instead of being silently ignored.

The live camera fills the overlay without the duplicate bulk header. Portrait layout separates instructions, guide, thumbnails and controls; short landscape layouts move controls beside the guide. Review opens the existing credit-confirmation screen. Capture and review alone make no paid requests. The per-photo scanUid survives the handoff.

## Scanner coverage

| Flow | Capture guidance | Before paid identification |
|---|---|---|
| Single ID | Shared live face guidance; native fallback | Existing saved-photo quality check |
| Rapid Scan | Same live face guidance and capture geometry | Same saved-photo quality checker through bulk queue |
| Bulk photo upload | Existing photo upload | Same saved-photo quality checker through bulk queue |
| Binder page | Existing crop/pocket review, not a single-card live guide | Same saved-photo quality checker for each selected crop |
| Quick / Deep Grade | Shared face guidance; distinct edge instructions | Existing Grade photo review and billing flow |
| Bulk Grade | Existing ordered uploaded photo sets and review | Existing Grade processing; no native batch-camera loop claimed |

The bulk ID queue previously skipped the Single ID saved-photo quality check. It now checks decode/resolution/focus before compression or a provider request. Duplicate-photo detection is skipped deliberately because separate physical copies in a stack are valid. Invalid/unreadable/rejected photos show that no ID credit was used, and do not offer an ineffective retry of a known rejected image. A missing or throwing checker fails closed. Closing/replacing the queue or switching accounts during preparation prevents a new paid request; requests already dispatched retain the existing durable recovery behavior. The generic retry label now says “Retry same photo” rather than promising every failure has a free retry.

The server identification, exact-printing checks, plan authority and credit/refund rules are unchanged. Existing shared scan-request recovery still supplies durable operation IDs and current authentication.

## Verification

- Rapid Scan: 88 browser checks across 320×568, 390×844, 844×390 and 1280×800; synthetic real MediaStreams, actual JPEG encoding, visible geometry, review handoff, repeated taps, pending capture, cancel/reopen races, stopped tracks and no API calls before confirmation.
- Shared guidance: 14 real-worker/canvas scenarios, identical dark/blank/soft/sharp/reflection/bright transitions for single capture and Rapid Scan, with separate session state.
- Existing camera lifecycle: 37; grade capture resolution: 28; binder browser: 46.
- New bulk photo preflight: 14 checks for rejected photos, checker faults, legitimate duplicate copies, queue replacement, account switch and cancellation during compression; synthetic provider only.
- Existing scan-request recovery, repeated input reset, bulk misfire (21), copy truth (224), asset fingerprints (107), syntax and release checks pass.

Mobile screenshots were reviewed. Synthetic capture tests do not replace the existing physical iPhone acceptance, naturally occurring live Deep-to-Quick fallback acceptance, provider accuracy benchmark or advertising gates. No real customer credits or paid provider calls were used in this validation.
