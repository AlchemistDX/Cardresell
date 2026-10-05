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
