# Unit economics planning model — 2026-10-05 (evening)

Label: `planning_estimate_not_invoices_or_profit`. Regenerate with `node tools/unit-economics.mjs`.
Production remains on source 3f0c21a / dpl_7SiiTJd2mh8dcZkroqZLFB6f5hCs; this commit is docs/tooling only.

## Status of the live provider sample

Production logs from 23:15Z through ~23:45Z show only the two anonymous route checks (`/api/scan` 405 and 401). No signed-in scan and no `PROVIDER_USAGE` line yet. The pending sample (one ID Scan + one Quick Grade on cartoonclipscentral23) is still open; the figures below are NOT measured.

## Verified inputs

- Production `ENABLE_XIMILAR_GRADER` = `deep_only` (value class read 2026-10-05; not changed). Quick Grade = GPT grade + Ximilar identify; Deep Grade adds the 100-credit Ximilar grader.
- Code paths (api/scan.js): ID Scan is Ximilar-only (TCG, then sport on no_match/no_card) and never reaches GPT; misses/provider failures refund the user credit but the provider call is still paid. Grade calls Ximilar identify only after GPT succeeds. Grade cost 1 (Quick) / 2 (Deep).
- Ximilar list prices (ximilar.com/pricing): identify TCG/sports card 10 credits; "Grade a card" 100; Business 100K = $69/mo; extra credit packs $99/100k. Collectibles requires Business 100K or higher (docs.ximilar.com/collectibles/recognition). Actual subscribed plan not verified.
- OpenAI list prices (developers.openai.com/api/docs/pricing): gpt-5 $1.25 in / $10 out per 1M; gpt-4o $2.50 / $10. gpt-5 high-detail image = 70 + 140 per 512px tile; client compresses to 1000px so a card image ≈ 630 tokens.
- Stripe: 2.9% + $0.30 per domestic card charge; Billing 0.7% on subscription volume.
- Catalogue (live /api/membership-catalogue): unchanged from handoff; welcome 10 ID / 1 Grade; credits do not expire.

## Assumptions (replace with measured PROVIDER_USAGE)

Prompt text 4k–7k tokens; Quick output 1.5k–4k (cap 4000), Deep 2.5k–5k (cap 5000); high case adds a failed gpt-5 attempt plus gpt-4o fallback and a TCG→sport double identify.

## Results

Per operation (USD): ID Scan $0.007–0.020; refunded ID miss $0.014–0.020 (no revenue); Quick Grade $0.029–0.096; Deep Grade $0.111–0.216.

Packs at worst-case cost: margin 45%–81% (lowest = 1000-ID pack with Business 25% discount, $0.036 net/credit vs $0.020 cost). Grade packs 67%–80%.

Subscriptions at full allowance use and worst-case cost: Starter 77%, Casual 72%, Pro 51%, Business 36% ($17.28/mo). Free user: ≈$0.51 first month (welcome + monthly), ≈$0.21 later months, worst case.

Fixed monthly cost not covered by this model: Ximilar plan minimum ($69 if Business 100K), Vercel plan, Redis/KV, R2, domain. Rough break-even on a ~$100/mo fixed base ≈ 29 fully-used Starter subscriptions, or fewer lightly-used ones.

## Risks found

1. `gpt-5-2025-08-07` (the snapshot behind `gpt-5`) is deprecated with API shutdown on 2026-12-11 (developers.openai.com/api/docs/deprecations; replacement gpt-5.6-sol, price not stated there). After that, Quick/Deep Grade would hit the gpt-4o fallback on every request (two calls, ~2x input cost, different quality). A measured model migration is needed before Dec 11; do not swap models without a grading regression set.
2. Free welcome grants have no daily/global cap when `MEMBERSHIP_LIVE_AUDIENCE=public`. Worst-case exposure ≈ $0.51 per new verified Google account. Turnstile guards only the email-verification claim route. Decide a cap or accept the exposure before public admission.
3. Refunded misses cost money without revenue: at a 30% miss rate, effective ID cost rises ~40%. Still margin-positive at list prices, but must be measured.
4. Resend domain status could not be read from this sandbox (network timeout to api.resend.com); sender verification remains open.

## Next acceptance

Run the pending live sample, export the window, `node tools/provider-usage-report.mjs`, replace the token assumptions, and reconcile against the Ximilar dashboard credit counter and OpenAI usage page for the same window.

## Follow-up — Business allowance and grade-model replacement (2026-10-05 ~20:00 EDT)

Business now includes 750 ID / 100 Grade monthly at $49.99 (was 1000 ID). Safe only because no Business subscriber exists (pilot purchases: willsep200 Starter only); the consumption script rejects an active period whose stored grant differs from the plan amount. Shipped on Production dpl_DnZVh3EA3KS6ABUqEpyzmuafdsfr (source afa4772); live catalogue and /pricing show 750. Business full-use worst-case margin rises from 36% to ~46%. Stripe product description text for Business, if it mentions credit amounts, must be updated in the Stripe dashboard (not visible from this workspace).

Grade model: `gpt-5-2025-08-07` shuts down 2026-12-11. `api/_gradeModel.js` makes the primary grade model an allowlisted setting, `GRADE_MODEL_PRIMARY` (unset = gpt-5, behavior unchanged); the gpt-4o fallback is kept. Reasoning parameters now apply to gpt-5.x and gpt-6.x names (the old `startsWith('gpt-5')` check would have silently dropped them for gpt-6 models). Telemetry labels the candidates.

`tools/grade-model-eval.mjs` sends the SHIPPED grade prompt (read from api/scan.js at runtime) to candidate models. First run: 3 pokemontcg.io digital reference scans, front only, Quick Grade, one call per model:

| Model | Est. cost / Quick Grade (GPT part) | Latency | Parsed | Behaviour on digital scans |
|---|---|---|---|---|
| gpt-5 (current) | $0.010–0.017 | 10–21 s | 3/3 | Confident PSA 9–10 |
| gpt-6.1-sol | $0.015 | 13–18 s | 3/3 | PSA 8, low confidence; flagged images as digital references, not physical photos |
| gpt-5.6-terra | $0.016–0.019 | 8–13 s | 3/3 | PSA 8–9, low |
| gpt-5.6-sol | $0.031–0.032 | 10–12 s | 3/3 | PSA 7–10, mixed |
| gpt-6-luna | $0.0008 | 9–10 s | 3/3 | PSA 7–10, mixed |

This is a compatibility and cost check, not accuracy: digital scans have no true physical grade. Leading candidate: gpt-6.1-sol (same $10/M output as gpt-5, $2 vs $1.25/M input, most honest about missing evidence). Acceptance needs real phone photos of cards with known PSA/CGC/BGS results, front+back, run through both models before switching.

## Known-grade evaluation and Production switch (2026-10-05 ~20:15 EDT)

User supplied phone photos (front+back) of three PSA slabs: Mega Lucario ex MEG 077 (PSA 9), Exeggutor AR M1L 066 JP (PSA 10), Geeta SIR OBF 226 (PSA 9). Photos are not committed. Blind run: card cropped from the slab with the label removed, compressed to 1000 px like the client, shipped Quick Grade prompt, 2 runs per model. As-uploaded run: full slab photos, 1 run.

| | gpt-5 | gpt-6.1-sol | gpt-5.6-terra |
|---|---|---|---|
| Blind predictions (18 total) | 8,8 / 8,8 / 8,8 | 8,8 / 8,8 / 8,8 | 8,8 / 8,8 / 8,8 |
| Exact vs PSA | 0/6 | 0/6 | 0/6 |
| Mean abs. error | 1.33 | 1.33 | 1.33 |
| Confidence | low ×6 | low ×6 | low ×6 |
| Slab label read (as-uploaded) | 3/3 correct | 3/3 correct | — |
| GPT cost / grade (front+back) | $0.013–0.018 | $0.015–0.017 | $0.017–0.021 |
| Latency | 11–18 s | 12–17 s | 7–13 s |

Findings: (1) gpt-6.1-sol reproduces gpt-5 behaviour exactly on this set (same grades, same slab reading) at ~10% higher GPT cost, fewer output tokens and tighter repeat distributions. (2) The grade itself collapses to "PSA 8, low confidence" for every card when surface/corner evidence is limited (through-slab plastic). It cannot separate a PSA 10 from a PSA 9 here and under-grades by 1–2. This is a prompt/calibration issue shared by all models, not a model-choice issue, and must be fixed before grading accuracy is advertised. Through-slab photos understate raw-card evidence; raw pre-submission photos with returned grades are the right benchmark.

Production switch: `GRADE_MODEL_PRIMARY=gpt-6.1-sol` added (Production), deployment dpl_2gcp8nqs2KGMoHJKhbzKzi8Kbwjd rebuilt from the same source 5084a8b with Production settings. gpt-4o fallback unchanged. Revert = remove the variable and redeploy. Live acceptance requires one signed-in Quick Grade with a PROVIDER_USAGE line showing model gpt-6.1-sol.
