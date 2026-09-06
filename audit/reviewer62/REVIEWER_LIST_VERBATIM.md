# Reviewer list, verbatim (62 items)

Reviewer's framing: "A 10 means a flipper can trust the number, finish the job
in-app, and tell someone else to pay for it. Here's everything that's still
between 7.4 and that."

## Trust & numbers (the product thesis)

1. Comp confidence score, outlier trim, sample count, fetched-at timestamp (trust bundle designed, not live).
2. Stale-fee / verified pills on the homepage payout tile, not only Accuracy.
3. Seller-level overrides: eBay Top Rated, Basic vs Store, TCGPlayer Direct vs self-ship, Pro seller rate.
4. Custom shipping / label cost instead of a hidden $5 inbound assumption.
5. International buyer toggle that actually re-ranks (FX, VAT, de minimis, EIS).
6. Condition markdown on buylists (NM vs LP vs MP) as an input, not a footnote.
7. Graded vs raw as a first-class payout path with source labeled on the number (PriceCharting vs TCGPlayer vs eBay).
8. "This rank is reference-only" state when every venue is stale — exist in policy, must be unmissable in UI.
9. Public fee-bug log: "user reported X, we shipped Y on DATE."
10. Independent audit or at least a pinned "we were wrong, here's the delta" post.

## AI Grade

11. Published accuracy vs PSA/BGS/CGC (N cards, confusion matrix, "off by >=1 grade" rate).
12. Hard slab / case-glare detector that blocks or warns before burning a credit.
13. Lighting / crop quality gate (blur, angle, fingers, background).
14. Per-subgrade confidence (centering vs corners vs edges vs surface), not one magic number.
15. Deep Grade that fails closed when an edge photo is missing instead of guessing.
16. Side-by-side of "our estimate" vs "what you should write in the listing."
17. No "get it graded!" dark-pattern leftover after a high estimate (issue #11 still open on GitHub).

## ID Scan / Bulk

18. Proven bulk throughput: 20-50 cards, progress, pause, retry.
19. Instant refund and a visible "this one failed, credit returned" row per card.
20. CSV / clipboard export of ID + set + number + market + best venue + net.
21. Duplicate / same-card collapse in a bulk session.
22. Fallback when Ximilar misses (set code + collector number typed path).
23. JP vs EN language / stamp detection called out, not silent wrong ID.
24. Sports / non-TCG scan path that doesn't pretend it's a Pokemon index.

## Lookup & catalog

25. Empty state for non-Pokemon that isn't Charizard.
26. Printing / language / stamp / 1st Ed as unavoidable selectors, not buried.
27. Sold-comp drawer: last N sales, date, price, outlier tags.
28. Watchlist + price-drop alert per card, not a newsletter footer.
29. "Max buy" that includes grade fee, inbound ship, expected days-to-cash.
30. Sports cards as a real mode (player + year + set), not ToS-only.

## Flips / Collection / money

31. Cost basis = purchase + ship-in + fees + grade + supplies.
32. Realized vs unrealized P&L, by venue, by month.
33. Tax lot / CSV for a CPA.
34. Collection qty, condition, location (binder / slab / consigned).
35. Sync that isn't "hope localStorage survived this browser."
36. Flip cap on free is fine; logged-out collection looking empty is not a demo.

## Listing handoff (the job isn't done at the rank)

37. One-click copy: title, condition notes, suggested list, fee warning.
38. Deep links that prefill eBay / TCGPlayer where the APIs allow.
39. "List here" checklist per venue (photos required, ship-in, payout days).
40. Days-to-cash next to net payout (COMC != TCGPlayer != Whatnot).

## Auth, billing, credits

41. Sign-in besides Google (email magic link, Apple, passkeys).
42. Credit balance always visible without "Sign in to check."
43. In-app cancel / portal, not "email will@."
44. One pricing source of truth (live tiers vs leftover Ultimate spec in the repo).
45. Account delete button, not only a Privacy paragraph.
46. Failed-scan refund history the user can see.

## UX / platform

47. First session aha: ghosted 15-venue rank, not two near-tied free rows.
48. Mobile: scan/grade as a sticky bar; promo banner gone after dismiss.
49. One visual system (light app vs dark pricing).
50. Working PWA / add-to-home-screen called out for shop-floor use.
51. Keyboard + paste-image + camera permissions that don't fail silently.
52. Game-theme wallpaper is fine; first paint still Pokemon-coded — default game should follow last-used or geo/referrer, not always EN Pokeballs.

## Social proof & growth

53. Named testimonials with a real flip ("moved this card off eBay, kept $X").
54. Homepage search counter paired with outcomes, not vanity volume (~4k searches).
55. Public roadmap that matches production (no paused trust bundle vs marketed 15-venue certainty).
56. Support SLA in writing (Pro Max "priority email" is undefined).
57. Distinct brand vs cardresellai.com (UFC marketplace collision).
58. Status page for TCGPlayer / PriceCharting / Ximilar / OpenAI outages.

## Ops / risk

59. Second person who can refund a credit if you're offline.
60. Rate limits / abuse on scan APIs so one bad day doesn't kill margin.
61. Documented model providers so a policy change at OpenAI/Ximilar doesn't blank Grade.
62. Backup if TCGPlayer feed or eBay solds go dark.

## Reviewer's own "already counts, do not rebuild" list

Accuracy changelog, stale-fee rule, high-price clamp, failed-scan refunds,
free-forever + non-expiring credits, named operator, fee sources linked,
cross-border labels.

## Reviewer's proposed minimum set to "move into the 9s"

Items 1, 3-4, 11-12, 20, 37, 41, 47, 53.
