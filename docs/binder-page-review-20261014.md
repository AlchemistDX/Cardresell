# Recoverable binder-page review — October 14, 2026

This follows the touch and alignment correction in PR #81. Multi-page review
had no previous-page action. A damaged JPEG in the middle of a batch disabled
Next, while the previous page's image remained visible. Taking a new camera
photo also discarded the whole batch instead of replacing the current page.

## Changes

- Previous page restores that page's layout, rotation, exact edge values, zoom,
  alignment anchor and individual checkboxes. Moving forward restores any page
  already reviewed. Editing a previous page replaces its saved selection;
  revisiting never appends duplicate cards.
- A visible page counter shows the selected count across the batch. The final
  confirmation keeps original page/row/column order and one credit per selected
  pocket, including after going backward and forward.
- A failed photo clears the old image and alignment controls. A failed first or
  middle page offers Skip this page. A failed last page still lets the user
  review cards selected earlier. A batch with no selected cards cannot submit.
- Retake this page replaces only the current photo; other pages and their
  reviews remain. Camera cancellation, capture and permission cleanup continue
  through the existing camera lifecycle.
- A JPEG/PNG/WebP with omitted MIME metadata can be opened by its extension,
  matching the main scanner's mobile-picker fallback. Decoding and all existing
  size/resolution checks still apply; a filename alone cannot make an invalid
  image usable.
- Restored status text describes the user's selected pockets, so manually
  unchecked cards are not incorrectly described as empty.

Only the active page keeps a full working canvas. Saved pages retain small
review settings and their selected JPEG files. Preview URLs and the old canvas
are released on navigation; history is cleared when the batch is closed or
replaced. Nothing is written to a new remote store.

## Verification

The before-fix reproduction used valid → damaged → valid JPEGs. Page 1 selected
seven cards. Page 2 then had Next disabled, no previous action, no crops and the
old image still visible. The same case now hides the old image and can either
return to page 1 or skip to page 3 without losing the earlier selection.

- Full shipped-page multipage suite: **57 checks passed**. Independently edited
  layouts, rotation, zoom, margins and selections; exact JPEG hashes before and
  after navigation; queue order and unique scan identities; damaged first,
  middle and last photos; entirely failed batches; omitted MIME metadata;
  replacement camera capture; cancelled page loads; clearing old history.
- Full shipped-page touch/mouse/keyboard suite: **131 checks passed** across
  portrait, landscape and desktop. The previous scrolling and alignment fixes
  remain covered.
- Binder camera/scan suite: **92 checks passed**, including rotation, manual
  edges, resolution boundaries and camera permission/capture cancellation.
- Native output minimum remains 400px with no upscaling. Provider calls and
  purchases are blocked in browser checks; no customer credits are spent.
- Mobile progress and navigation screenshots inspected. Referenced asset
  fingerprints: **167 checks passed**; release inspector and diff checks passed.

The multipage suite runs in the normal release runner. The separate required
interaction and camera/scan suites run before release as well. These tests
establish local review, crop integrity and credit-confirmation mechanics;
physical-iPhone camera/Safari behavior and recognition accuracy remain separate
acceptance work. There is no measured scan-speed or recognition-quality claim.

Active bundle: `js/binder.21099174.js`, built from `js/binder.js`. Previously
released immutable assets are retained.
