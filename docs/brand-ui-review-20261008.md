# CardResell logo and UI review — 2026-10-08

## Approved identity

The owner requested a diagonal split: trading card on one side, cash on the
other, conveying a place to sell cards. The first card/cash version used a
mountain-and-sun image placeholder; the owner asked for a less photographic
card. The approved revision uses a collectible-card star and two detail lines.
Gold and emerald retain the app's gold identity while making resale explicit.

Generated using the built-in image-generation tool. Final edit prompt:

> Refine this CardResell logo. Keep the same overall rounded card shape, diagonal
> slash, golden yellow trading-card half, and emerald green cash half with dollar
> sign. Change ONLY the gold half's interior design: remove the mountain and sun
> photo/image placeholder entirely. Replace it with a bold simple four-point
> collectible-card star emblem centered in the remaining upper-left card area,
> with two restrained short horizontal card-stat lines underneath. It should
> instantly read as a collectible trading card, never a photograph or image-file
> icon. Clean, minimal, professional flat geometric logo, solid colors, smooth
> crisp edges, clean transparent negative space with no stray colored speckles.
> Preserve actual transparent background, no text or mockup.

Master: `assets/brand/cardresell-card-cash-master.png`. Web header uses a 128px
WebP derivative (about 7 KB). PNG favicon, touch, install icons and a padded
maskable icon are in the same directory. Sharp only resized/encoded deployment
derivatives; the approved artwork was not redesigned. The wordmark remains
live text for readability. Existing published assets are retained.

## Verified improvements

- Phone header separates identity/account from subscriptions/shop/settings/theme.
  Visible controls have separate 44px targets instead of overlapping invisible
  hit areas. Both themes remain accessible on phones.
- Logo applied to the app and all seven standalone HTML pages; favicon, touch
  icon and manifest references updated. Static build/routes include the assets.
- Decorative game backgrounds removed to reduce visual noise around card data.
- Main tabs fit 320px screens. Active navigation/search text is dark on gold.
- Grading photo-tip descriptions and titles use readable theme colors.
- Scan menu tabs expose selection and support arrows/Home/End. Escape closes
  the menu and restores focus to the visible opener.
- Scan-menu and bulk close targets enlarged. Grading close button no longer
  stays over the upload title while scrolling.
- Mobile form text avoids tiny inputs; constrained modal inputs prevent overflow.
- Accuracy tables scroll inside labeled, keyboard-focusable regions rather than
  forcing the entire phone page wider. Public-page navigation wraps cleanly.
- Reduced-motion preference disables decorative animation/transitions.
- Failed-scan banner no longer guarantees an instant refund; it describes
  eligible failed scans and retains the refund-policy link.

## Verification and limits

- `tests/brand-ui-browser.mjs`: 174 checks passed. Full shipped local app,
  light/dark themes, 320×740 / 390×844 / 844×390 / 1280×900. Header layout,
  logo loading, main navigation, scan tab keyboard behavior/focus, photo tips,
  collection, drafts, flips, shop, Deep Grade upload and binder review.
- Seven standalone pages (about, accuracy, contact, pricing, privacy, terms,
  sign-in): mobile overflow and logo checks; screenshots reviewed.
- `tests/run-all.sh --local`: passed using existing isolated TCP Redis mode.
  Any opt-in/live suites remain skipped rather than counted as passed.
- Existing grading-upload/single-draft browser gate passed in portrait/landscape.
- Binder browser gate: 46 passed. Fingerprint and registry checks passed.
- Services/account state are synthetic; no provider calls, customer scans,
  purchases, real credit charges, or actual seller listings were submitted.
- These are UI/regression checks, not evidence of scanner accuracy, catalogue
  completeness or live checkout acceptance. Physical iPhone Safari and actual
  camera acceptance still require device testing.

## Short phone acceptance list

1. Refresh the site; confirm the card/cash logo and separate header controls.
2. Switch dark/light themes. Open Settings, Collection, Drafts and My Flips.
3. Open ID and Grade menus; verify the selected tab and close button.
4. Open photo tips, then Quick/Deep upload. Confirm clear text, reachable close,
   and that photo replacement/cancellation preserve the expected flow.
5. Open Binder page and review a photo without submitting a paid scan.
6. Open Subscriptions and Shop; verify plan/pack information and close normally.
7. Check About, Accuracy and Contact; tables should scroll within the page.
