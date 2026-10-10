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
