# Advertising readiness — October 9, 2026

Rough readiness remains about 85% (qualitative). Public purchasing stays pilot-only. This record does not approve paid advertising.

## Completed today (engineering)

- Header membership control shows a tier badge for paid plans. The plans view shows a catalogue-only "next step up" panel. Business batch grading is 25 cards per batch (Pro 10).
- TCG Price Lookup aggregate limit is enforced in Production: `TPL_BUDGET_ENFORCE=1`, `TPL_BUDGET_MAX=400`, `TPL_BUDGET_WINDOW_SEC=3600`, `TPL_PER_IP_MAX=60` (at most 9,600 paid calls/day against the Pro plan's 10,000/day). Live check: a reordered repeat query returned `x-tpl-cache: hit`, which only occurs in enforcing mode. Over the limit, cached values are served labeled stale; otherwise the proxy returns 503 `budget_exhausted` rather than an empty result.
- Full-suite failures from the Oct 9 run were triaged. All were stale tests; none was an application defect:
  - Scan-hint escaping: the hint was already escaped inside a shared `_esc(...)` expression.
  - Social preview: `og:image`/`twitter:image` exist with a `?v=` cache key, and the 1200×630 image serves 200 live.
  - Legacy purchase routes: these are intentionally fenced, and the smoke test now requires 503.
  - Contrast sweep: the sanity floor was lowered from 200 to 180 after the single-row header; all AA checks pass.
  - Registry: 10 suites were registered with completion markers.
- `draft-review-screen` failed once (2 of 417) in a full run, then passed 3 of 3 alone and in the next full run with no app change. It is recorded as intermittent and still needs a root-cause fix.
- Final full run (commit 43ca589): 105 of 105 parts, 10,079 checks passed, 0 failed, "ALL CHECKS PASSED". Two parts skip by design: 27 needs the live production store, and 29 needs a local browser server (run separately: 17 of 17 passed).
- Welcome-credit daily cap is at its code default of 200 new accounts/day with 2 per IP. It is not set in Production. Owner may lower it for the first ad test.

## Remaining (owner)

1. iPhone camera acceptance (docs/camera-phone-acceptance-20261008.md, 6 checks, no paid scan).
2. Live Deep-to-Quick fallback acceptance, then the decision to open purchasing beyond the pilot list.
3. A fresh non-pilot account must sign up, verify email, receive welcome credits exactly once and reach checkout.
4. Resend plan decision. Free allows 100 emails/day, which caps email/password sign-ups at about 100/day.
5. Ximilar: confirm overage billing and the grader-job credit reply. 100K credits ≈ 660 first-month free users at full use.
6. Firebase $30/month: identify the billed service (sign-in alone is free under 50K MAU).
7. CardGrader.AI: cancel any remaining subscription. The key is unused.
8. Backup/restore: confirm Upstash backup availability on the current plan, and run one restore drill into an isolated database.

Prices, monthly allowances, discounts, accounts, credits and pilot admission were not changed.

## October 10 optimization pass (deployed dpl_HejMMQwMPuMoqMYhrdVoR2ATpqNz, commit b5edea5)

Cost
- Grade requests now send the ~14,600-character static rules first, then the per-request photo description, then the photos in the same order. Wording is unchanged. OpenAI can therefore cache the shared prefix at the cached-input rate. Expected effect: roughly $0.007 less per grade when the cache hits (about 3.5k tokens at $2.00 vs $0.10 per 1M). Hits are most likely in batches and back-to-back grades; isolated grades may miss after the cache expires. This is not yet measured: `cached_prompt_tokens` in PROVIDER_USAGE will show it after the next real grade.
- The paid Ximilar sports retry runs only after a TCG `no_match`, never after `no_card_detected` (an empty photo). This saves one paid call per empty-photo scan. The user's refund is unchanged.

Conversion
- When a scan or grade runs out of credits, the Shop now shows the next plan's monthly ID/Grade credits and price above the packs, with "Compare plans". Grade moments list Grade packs first. No per-unit or savings math is shown. The panel appears only when purchasing is enabled for the account.
- Fixed: reason ids containing digits (`grade_scan_402`, `id_scan_402`) were silently discarded.

Scan accuracy
- 7-day production data showed 44 TCG identify attempts: 21 success, 19 `low_confidence`, 4 `no_match`. Most came from a single burst on Oct 9. Ximilar match distance and second-candidate gap are now logged (numbers only) so the 0.55 low-confidence cutoff can be calibrated on real scans. Thresholds are not changed until there is data.
- First-visit Charizard demo now stops if any card is selected while it polls. Before, a scan or collection pick in that window could be replaced. This was also the cause of the intermittent draft-review test failure, which is fixed (8 of 8 clean runs).

Full suite at b5edea5: 109 of 109 parts, 10,127 checks passed, 0 failed.

## October 10 second pass (deployed dpl_Dn1ERH39YvmMUbsWgr7fasQbGeJC, commit 18cf2d4)

- Production logs (7 days) show no user-facing server errors. The 5xx responses are the intentionally fenced legacy purchase routes, which are hit by smoke checks. Error-level lines are Node `url.parse` deprecation notices plus the expected eBay sold-comp failures.
- Mobile landing measured against live with a throttled phone profile: LCP about 1.8 s and about 1 MB transferred, 438 KB of it the main bundle (brotli). Acceptable for an ad test. Splitting the bundle is a larger refactor and was deferred.
- Fixed: the ID-scan miss screen's "Search by name" focused a nonexistent `#cardSearchInput`, so it only closed the scanner. It now switches to Card Lookup and focuses the real search box (real-browser test at 390 px and 1280 px).
- Fixed: five "scroll to payout results" fallbacks named removed elements. Collection "View full card" and graded re-identify now fall back to `#resultsArea`.
- Shop telemetry: `membership_shop_open` and the checkout events now carry the trigger reason (a public label), so out-of-credit nudges can be measured against direct opens.
- Full suite at 18cf2d4: 110 of 110 parts, 10,140 checks passed, 0 failed.
- Owner live tests: CardResell-Live-Tests-2026-10-10.md (8 tests, no purchases).

## October 10 binder scan pass (deployed dpl_AbTax3Kut3a3botx7aRtykfNETPQ, commit abb05f8)

- Pockets are pre-selected by a free, local detail check, so no credits or provider calls are spent before confirmation. On 9 synthetic iPhone-size pages (real card art on dark, white and gray backings, with sleeve glare, blur and plain Energy cards), cards scored 21–54, empty pockets 0.6–5, and untrimmed corner pockets about 10. The threshold is 12. All 9 pages matched exactly. This has not been measured on real binder photos yet; see owner live test 9.
- Added Select all and Clear buttons, plus a "Looks empty" label on skipped pockets.
- Each pocket is cropped with a 4% inner margin, so a slightly off grid keeps the card corners.
- The working photo is capped at 12 MP by area. Previously 24 and 48 MP iPhone photos could exceed Safari's ~16.7 MP canvas limit and draw blank pockets.
- The last pocket layout is remembered.
- Tests: new binder-autoselect-browser (34 checks; fails on the old bundle). binder-scan-browser expectations were updated for the margin (46 checks). Full suite: 111 of 111 parts, 10,174 checks, 0 failed.
- Live Production check: on the 3×3 test page, 7 cards were ticked and 2 empty pockets skipped, with 0 scan calls and 0 page errors.

## October 10 binder scan, real-photo pass (deployed dpl_2MU89Xpgg6pwaE2VpnKPNnaqSSB8, commit 3ed7b8c)

- Input: 8 owner photos (IMG_4056–4070), each a single card in a toploader, 1500×2000. These were laid into binder pages at full iPhone size and at the shared size. Empty pockets were made from the real background texture in those photos. No real empty binder pocket has been photographed yet.
- Every real card was pre-selected. Textured empty pockets scored the same as cards on detail (fine detail 23.6–24.3 vs 16.9–31.3; the pale Cresselia full art was lowest). No simple local statistic separated them: tried detail, coarse detail, colour, brightness spread and how uneven the detail is. The check therefore stays one-sided: it skips only clearly smooth pockets. A textured empty pocket stays ticked, which costs at worst a refunded ID credit; a real card is never silently skipped.
- On-device artwork matcher, used as a stand-in for crop quality (the bulk scan itself uses the server identifier): full-size binder crops named the same 5 of 8 cards as the original photos. Shared-size crops (~520×693) named 4 of 8, losing Crocalor. Cresselia, Mantyke and Steelix were not named even from the originals.
- Fixed: the binder accepted pockets down to 200 px, but the bulk photo check rejects under 400 px, so pockets of 200–399 px were quoted and then failed as "Photo too small". The binder now applies the same 400 px minimum before quoting, and explains the fix: use the original photo, move closer, or choose fewer pockets.
- Added: advice to use the original camera-roll photo when pockets are under 700 px.
- Added: the instructions now ask the user to untick empty pockets too.
- Tests: binder-autoselect-browser now has 44 checks, including 2 real-photo pages. The previous bundle fails 4 of them. Full suite: 111 of 111 parts, 10,184 checks, 0 failed.

## October 10 binder auto-fit from a real page (deployed dpl_3HDbhr919v2FXAJYfNvGah3EKUUL, commit 78c7c57)

- Input: owner photo IMG_4652 (1500×2000). A real 9-pocket page on a couch, with the page filling about 82% of the width. Cards: Scovillain OBF 25, Relicanth Plasma Blast 24, Carracosta SCR 38, Heliolisk CRZ 50, Plusle Secret Wonders 36, Dubwool CRZ 122, Dwebble PAR 6, Venipede TWM 115, Froslass TWM 53.
- Catalogue: all 9 exact printings are present in card-index.json.
- Before the fix, the default full-photo grid cut across 2–4 cards per pocket. The on-device matcher named 0 of 9 and returned nonsense guesses, including Magic cards.
- Fix: the grid now auto-fits. It finds the band of columns and rows dense with printed detail, merges the normal gaps between pockets, and accepts the fit only when pockets come out portrait card-shaped (cell width/height 0.66–0.86). Otherwise it leaves the grid at 0, as before. A manual edge edit wins until a new photo or rotation.
- After the fix, the grid fits at 6/12/6/10. The matcher named 5 of 9 exact printings (Carracosta, Heliolisk, Dubwool, Dwebble, Venipede). Its misses were Scovillain (heavy holo glare), Relicanth, Plusle and Froslass. The matcher is diagnostic only; the bulk scan uses the server identifier, which has not been run on this page yet.
- Rejected approaches, for the record:
  - colour (the pink couch reads as colourful)
  - a periodic gap search (the text boxes inside cards repeat in a regular pattern)
  - card-sized blobs (couch folds merge into the cards)
- The auto-fit declines on synthetic pages with empty pockets in outer rows or columns. Those keep the manual grid.
- New tool: tools/binder-photo-eval.mjs runs any binder photo through the shipped flow locally and reports ticks, pocket sizes, the photo-quality result and matcher guesses, with no network.
- Tests: binder-autoselect-browser now has 53 checks, including the real page; the previous bundle fails the auto-fit checks. Full suite: 111 of 111 parts, 10,193 checks, 0 failed.
- Follow-up: the combined status message is long on a phone (about 7 lines) and could be shortened.

## October 10 owner live binder scan (screen recording) and fixes (commit 9f42a1f, dpl_2xeh8wowiJPScJ6pqgGjXUmQyc1F)

- Owner scanned the IMG_4652 page live (9 ID credits; 953 remaining afterwards). The server identifier named 8 of 9 exact printings: Scovillain OBF 25, Relicanth PLB 24, Heliolisk CRZ 50, Plusle SW 36, Dubwool CRZ 122, Dwebble PAR 6, Venipede TWM 115 and Froslass TWM 53. Carracosta SCR 38 failed, both on the first try and on "Retry same photo".
- Server logs: Carracosta's best match scored a distance of 0.552, just over the 0.55 acceptance limit, with a gap of 0.274 to the second match. The retry returned the identical score. The best guess's name is not logged, so whether it was Carracosta is unknown. Across 3 days only 15 scored lookups exist, so the threshold was not changed.
- Bug fixed, bulk pricing: rows were priced at the highest variant, so every row read "Reverse Holofoil" and commons were overvalued. Rows now use the identifier's foil reading ("Foil/Holo" or "Non-Foil", now returned as foil_hint). With no reading they use the base printing: Normal, else Holo. The highest price is no longer the default.
- Fixed, no wasted retry: a definite "not identified" answer hides "Retry same photo", because the same image returns the same score. The row says no credit was used and suggests scanning the card on its own.
- Not yet verified live: the server's foil_hint value on a real scan, which needs an owner scan.
- Follow-ups:
  - The single-card scan still defaults to Holo, then Reverse, then Normal. Its dropdown is visible.
  - Log the best-guess identity on low-confidence misses.
  - Shorten the binder status message.
- Tests: new bulk-variant-choice (22 checks; fails on the previous bundle). Full suite: 112 of 112 parts, 10,215 checks, 0 failed. One earlier run hit a draft-delete timing race that passes 113 of 113 on its own.

## October 10 several binder pages per batch (commit c464a36, dpl_4ZQKLkrcbTrDGC5Ee9Aq9Wcmc1Wj)

- Owner report: the second live scan of the page got all 9 cards. But picking two binder photos opened only one, because the input accepted a single file.
- Now the photo picker accepts up to 10 photos (extra photos beyond 10 are dropped, with a note).
- Pages are reviewed one at a time. Each page gets its own automatic grid fit and pre-ticked pockets, and its status starts "Page N of M." The button reads "Next page (N of M) · X cards so far", then "Review X cards · X ID credits" on the last page.
- Every ticked pocket from all pages goes into one bulk queue with a single credit confirmation. Nothing is sent before that confirmation.
- Pocket file names carry the page number (for example binder-page-2-row-1-col-3.jpg) when there are several pages. Single-page names are unchanged.
- Bulk ID has no plan batch cap; plan batch sizes (Business 25, Pro 10) apply to batch grading only. Credits still bound the scan.
- Tests: new binder-multipage-browser (24 checks). Full suite: 113 of 113 parts, 10,239 checks, 0 failed.
- Live check: two pages ran on www.cardresell.org with scan requests blocked. Page 1 was the real IMG_4652 page with 9 ticked; page 2 was a synthetic page with 7. The button showed "Review 16 cards · 16 ID credits", with 0 scan calls and 0 page errors.

## October 10 owner live two-page batch (screen recording) and fixes (commit 269036d, dpl_AWxwYqu11qeCS7dfX1evawdgDPhg)

- Owner picked 2 pages (Magic, Secrets of Strixhaven, 9 cards; and the Pokémon IMG_4652 page, 9 cards). The multi-page flow worked as built: page 1 of 2, "Next page", then one quote of 18 cards and 18 ID credits. The result was 12 of 18 identified: Pokémon 9 of 9; Magic 3 or 4 of 9 (Fields of Strife, Summoned Dromedary, Elite Interceptor // Rejoinder, plus possibly Killian's Confidence).
- Failure 1: the first 3 requests hung for about 13 s and failed with "Connection interrupted". The server logs show no /api/scan request before 02:24:09 UTC, so none arrived and no credit could have been taken. This is consistent with iPhone Safari reusing a stale keep-alive connection after the page sat idle during review.
  - Fix: one automatic retry after 0.9 s, with the same operation id. The server replays any existing result, so a retry cannot charge twice; a scan still in flight answers 202. Account-change checks run again before the retry. Two failures in a row still show the recoverable message.
- Failure 2: the header showed the previous batch's "Done!" while the new batch's first cards were identifying. Fix: the label and progress bar reset to "Scanning 0 of N…" before the workers start.
- Magic accuracy (the owner's Magic-only batch at 02:22–02:23 UTC): 5 of 9 accepted at match distances 0.42–0.55, and 4 rejected at 0.57–0.75. Pokémon typically scores 0.19–0.38, so the identifier matches Magic cards much less closely. Most of the recorded batch's provider lines are missing from the logs.
- Foil reading is in use: Scovillain, Carracosta and Froslass now show "Holofoil". Dubwool, Dwebble and Venipede still show "Reverse Holofoil" because the identifier read them as foil. Whether they really are reverse holos is not verified.
- Credits: the header showed 953 before and after both batches. Not investigated; it may reflect the monthly allowance being used first.
- Tests: scan-request-recovery now covers a single drop (retry succeeds, same operation id) and a double drop (exactly one retry). It fails on the previous file. bulk-variant-choice now has 23 checks. Full suite: 113 of 113 parts, 10,240 checks, 0 failed. Live: page and both assets byte-match; smoke 15 of 15.
