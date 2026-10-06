# Scan accuracy plan — Stage 1 progress (2026-10-06)

Source plan: CardResell-Scan-Accuracy-and-Photo-Assistant-Plan-2026-10-06.

## Done (commit on codex/profit-readiness, rebuilt for Production)

1. **Ximilar grader migrated to the async job API.** Ximilar's docs (https://docs.ximilar.com/collectibles/card-grading, read 2026-10-06) state the synchronous `card-grader/v2/*` endpoints are retired. Production had `ENABLE_XIMILAR_GRADER=deep_only` and still called the sync URL, so Deep Grade's CV step was very likely failing and silently falling back to GPT pillars (`cv_source: 'gpt'`). Now: one `POST /account/v2/request/` (type card-grader, endpoint grade, front+back), bounded polling of `GET /account/v2/request/<id>`, single 55 s end-to-end budget with per-request 12 s timeouts that also cover body reads, no resubmission on ambiguous submit/poll, no raw provider payload in failure results. Job id logged for reconciliation. Live acceptance still requires one real Deep Grade (2 Grade credits). The sandbox egress proxy blocks credentialed calls to Ximilar, so the live endpoint was not exercised from here.
2. **Poor visibility no longer lowers the grade.** Removed "worst-case interpretation" and "lower confidence AND lower the grade" rules; added "CANNOT INSPECT IS NOT DAMAGE". Through-plastic: confidence low, worth_grading false, PSA 10 blocked (Gem Mint unverifiable), but the forced cap at 8 (prompt + server) is removed. Removed the unsupported "5–10% of submissions" population rate. Blind slab re-test (gpt-6.1-sol, same 3 crops): before 8/8/8, after 9/9/9 vs true 9/10/9 (MAE 1.33 → 0.33). n=3 — not calibration.
3. **"Measured" only when measured.** Reconciled limiting-factor text says "Estimated centering" unless Ximilar CV supplied it; new `centering_source` field (`measured` | `model_estimated`).
4. **Unmeasured image quality reports `unknown`,** not `ok`.

## Audited, not changed (needs a measured design)

- Grading photos are compressed to a 1000 px long edge in the client; ID uses 1200 px. Raising this blindly risks the Vercel 4.5 MB request body limit (Deep Grade sends up to 6 images as base64 JSON). Proper fix = direct private upload of originals (expiring), then server-side delivery renditions. Ximilar recommends ≥2000 px short side for grading.
- Deep Grade still bills normally when the CV step fails and GPT pillars are used. Policy decision needed (partial refund or explicit "CV unavailable" disclosure).
