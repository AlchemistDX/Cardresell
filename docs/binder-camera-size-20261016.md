# Larger binder camera framing

The reported iPhone screenshots show a square camera feed letterboxed inside
a portrait stage. The old guide used 80% of the sensor height and retained a
0.72 card aspect ratio. A 3-by-3 guide therefore occupied only 57.6% of the
square image's displayed width, despite available space around it.

The camera now fits a page-shaped preview to the available stage. Each pocket
retains the same card proportions; the guide leaves 3% framing room on each
edge. Square, portrait and landscape camera feeds are centered and cropped
inside that preview. The existing resize handlers refit it when the screen or
sensor dimensions change. The shutter and Cancel remain outside the preview.

Capture uses the same native source rectangle that the preview displays. The
review grid retains the 3% margins, so enlarging the guide does not shift which
card lands in each pocket. Capture does not upscale the camera image. Existing
canvas limits, crop resolution checks, pocket selection, credit confirmation,
retakes and camera cleanup still apply.

## Verification

`tests/binder-scan-browser.mjs` exercises the shipped styles and binder asset,
real video/canvas/JPEG capture, pocket review and bulk confirmation. Only the
camera device boundary uses synthetic streams. Coverage includes:

- All five pocket layouts with square, portrait and landscape sensor frames.
- Viewport rotation and live sensor dimension changes.
- Short portrait viewports (390 by 650 and 320 by 568), with a 3-by-3 guide at
  least 80% of screen width and both capture controls visible.
- Captured JPEG center pixels matching the corresponding visible guide cells.
- Native resolution, failed capture retry, in-flight capture resize, late camera
  permission results, keyboard focus, cancellation and track cleanup.

`tests/binder-interaction-browser.mjs` covers the full shipped page at phone
portrait, phone landscape and desktop sizes, including touch scrolling,
alignment controls, crop races and bulk handoff. The local regression runner,
identity, listing export, listing photo and membership release gates run before
publishing. Production verification includes the exact new binder asset hash.

The automated camera checks run in Chromium; they do not claim a physical
iPhone camera or Safari hardware test. No paid identification request is needed
to validate the framing and capture path.
