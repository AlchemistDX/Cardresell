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

## Live Deep Grade acceptance (2026-10-06 16:17–16:22Z, willsep202, Seize the Spoils SOS #129)

- Ximilar async grader worked live: `card_grade deep_grade success http=201` in 37.4 s (second scan), result rendered "CV-VERIFIED". GPT (gpt-6.1-sol) 14.7 s, 9,523 prompt / 559 completion tokens (~$0.025 at list). Ximilar identify 1.7 s.
- Fresh card → PSA 7 (Ximilar T/B 66/34 centering ceiling); bent card → PSA 3. Same card measured T/B 66/34 then 60/40 across the two sessions: centering from angled 1000 px phone photos is noisy; do not market it as precise.
- Bugs found and fixed: grade label stayed "Mint" on a server-lowered PSA 7; limiting factor still explained the model's pre-correction grade; grading-upside priced a name-only PriceCharting match (Secret Lair foil #2556, $4.97) instead of SOS #129 (~$0.40) because it ignored the grade response's set/number; "View PSA 1 price" on a PSA 3. Server now refuses to call a name-only TCG match "exact product match" (cache v10).

## Grading capture resolution (2026-10-07, source 533dd1b, Production dpl_26Rv5ZYk1zBcGXZmMLWFSQ4du4X8)

Audit correction: grading photos were scaled to 1000 px on the LONG side (~715 px short side), not 1000 px short side. Ximilar's grader recommends ~2000 px short side, unedited. The client card-bounds crop is found on a 256 px preview with a 4 px margin, so it can clip ~16 px of physical edge on a 12 MP photo — a plausible contributor to centering noise (66/34 vs 60/40 on the same card), not established.

Change (client only, core.9e0c00ba.js): Deep Grade front/back 2800 px long side (~2000 short), q0.88, 3% crop margin, ≤1.45 MB base64 each with quality-then-size fallback; Quick Grade 1600 px (≥768 short side for GPT high detail), ≤700 KB; edges 1200 px, ≤250 KB. Worst-case Deep body ≈ 3.9 MB (< 4.5 MB Vercel limit). ID scan capture unchanged. Simulated-canvas suite grade-capture-resolution 12/0.

Expected side effects to measure live: higher OpenAI image tokens per grade (larger front/back tiles), longer upload on mobile data, possibly different Ximilar job time. Acceptance: repeat Deep Grades of one physical card should give closer centering readings than 66/34 vs 60/40; no 413 errors.
