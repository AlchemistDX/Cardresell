# Group B — AI Grade (reviewer items 11–17)

Scope: verified read-only against `/home/user/workspace/cardresell` on 2026-09-06.
Live bundle is `js/core.d9e1b484.js` (named at `index.html:3515`); `js/photo-qc.js`
is loaded as an inlined copy inside that bundle (`js/core.d9e1b484.js:16098-16362`)
and is also present as the unhashed source file. No tests were executed.

---

### Item 11 — Published accuracy vs PSA/BGS/CGC (N cards, confusion matrix, "off by ≥1 grade" rate)
**Verdict:** GAP-BLOCKED

**Evidence:**
- No grading-accuracy measurement exists anywhere in the repo. The only accuracy
  harness is card *identification*, not grading: `tools/scan_accuracy_harness.py:1-13`
  ("Runs pHash + dHash on every real user upload … reports the top-K matches from
  card-index.json"), and it contains no PSA/grade references at all.
- `qa/` holds a graded-**price** audit (`qa/GRADED_PRICE_AUDIT_2026-08-19.md`,
  `qa/graded_price_audit.js`, `qa/graded_price_audit_raw.json`) — dollar values, not
  grade-vs-slab comparisons. `tools/grade_price_audit.py` is likewise price work.
- The site already discloses the absence rather than faking a figure.
  `accuracy.html:194`: "**We don't claim \"within N points of PSA.\"** We haven't
  published a validation set yet. The roadmap is a 100-card gold-set audit (paired
  PSA slabs + our estimate) — when that ships, the results land on this page with the
  raw comparison, not marketing copy." Same disclosure on `pricing.html:371`.
- So the reviewer is right that no accuracy figure is published, and wrong to imply
  it is being hidden — it is explicitly labelled as not-yet-measured.

**If real, what it takes:** Measure first, publish second. A real answer needs a
physical paired dataset (N slabs with known PSA/BGS/CGC grades, each re-photographed
and run through `/api/scan` in grade mode), scored into a confusion matrix and an
"off by ≥1" rate, then rendered into the existing `accuracy.html#grading` section
(`accuracy.html:190-196`). No code change can produce the number.

**Rule conflict:** Rule 6 — the **Grade gold-set is on the explicit do-not-touch
list**, and the gold-set is exactly the artifact this item requires. Rule 2 also
binds: publishing any confusion matrix or "off by ≥1 grade" rate that is not derived
from an observed dataset would be an invented number. Safe alternative: run the
measurement out-of-repo (owner-authorized, Rule 7), keep `accuracy.html:194` exactly
as-is until the measured table exists, and then publish the raw comparison.

---

### Item 12 — Hard slab / case-glare detector that blocks or warns BEFORE burning a credit
**Verdict:** PARTIAL (the "before the credit" half is genuinely absent — the reviewer
is right on the crux)

**Evidence — where the debit falls:**
- Credit debit for grade mode happens in `/api/scan` at `api/scan.js:785` ("── 2.
  Check & consume scan credit(s) ──"), after the pre-debit validations at
  `api/scan.js:679-780` and before any model call.
- Slab detection is **server-side and post-debit**: `api/scan.js:2004-2008`
  (`let looksSlabbed = _ximilar_graded || is_slabbed || slabbed`), fed by the GPT
  grading prompt field at `api/scan.js:1446` ("is_slabbed: true if the card is inside
  a graded slab … rigid clear plastic outer shell with printed label header").
  The code states the decision outright at `api/scan.js:2002`: "If any signal fires,
  we **STILL return the grade (user paid for it)** but attach slab_warning".
- `refundCredits()` is never called on the slab path. Its call sites are
  `api/scan.js:984, 991, 1033, 1184, 1595, 1659, 2463, 2547` — identify misses,
  provider failure, low-confidence picker, and the catch-all `catch` at 2547. A
  slabbed grade scan is charged in full.
- What the user does get after paying: a slab banner (`api/scan.js:2162-2168`,
  message "This card looks like it's already in a graded slab. Grading results will
  be skewed by the plastic and label — trust the number on the slab, not this
  estimate."), rendered at `js/core.d9e1b484.js:14747-14770`, plus a hard
  through-plastic honesty cap (`api/scan.js:2215-2250`: confidence forced `low`,
  `worth_grading` forced false, `psa_estimate` capped at 8, eye appeal downgraded,
  distribution flattened). That behaviour is good and honest — it is simply late.

**Evidence — pre-credit glare handling is advisory only:**
- Grade capture goes through the live camera overlay (`js/core.d9e1b484.js:14209-14231`
  front, `14232-14249` back, `14266-14284` edges → `openLiveCameraCapture` at
  `js/ui.6b3a528e.js:617`). Its analyzer emits a single hint pill including glare:
  `js/ui.6b3a528e.js:821` — `hint = { id: 'glare', … 'Glare on the card — tilt slightly' }`
  (rendered by `_liveCapRenderQA`, `js/ui.6b3a528e.js:837`). The design note for the
  shared analyzer is explicit: "**Advisory: the shutter is never disabled.**"
  (`js/ui.6b3a528e.js:2035`). There is no slab/holder-shape detection at capture time
  at all — only a brightness/hot-pixel glare heuristic.
- The only pre-credit *warning* on the grade path is economic, not photographic:
  `js/core.d9e1b484.js:14071-14079` shows a `confirm()` — "Heads up — this raw card is
  ~$X. Even at PSA 10 the math shows about $Y profit after grading fees. Grade anyway?"
- `window.CardResellPhotoQC.check()` (`js/photo-qc.js:157-241`) is wired into the
  **ID scan only** (`js/core.d9e1b484.js:13335-13385`, the sole call site of
  `.check(`). No grade entry point calls it.

**If real, what it takes:** Add a client-side pre-submit slab/holder check in
`js/photo-qc.js` (a fourth gate: rectangular high-specular border + label band
detection on the front photo) and call it from `processGradeImage`
(`js/core.d9e1b484.js:14337`) before `submitGradeScan` — i.e. block on the client where
no credit has been spent. Cheaper and lower-risk alternative: keep the model as the
detector but make the slab case refundable server-side — call the existing
`refundCredits()` at `api/scan.js:956` when `looksSlabbed` is true and tell the user
"no credit used, re-scan raw." Both changes are confined to `js/photo-qc.js`,
`js/core.d9e1b484.js` and `api/scan.js`.

**Rule conflict:** none. (Reusing `refundCredits()` and `photo-qc.js` keeps one
implementation per behavior, satisfying Rule 1; a *second* slab detector in a new
module would violate it.)

---

### Item 13 — Lighting / crop quality gate (blur, angle, fingers, background)
**Verdict:** PARTIAL

**Evidence — what exists:**
- Pre-capture, advisory: the live-camera analyzer covers too dark (<42 mean luma),
  too bright (>220), glare (hot-pixel share >2%), blur (Laplacian variance <40) and
  "point the camera at your card" (`js/ui.6b3a528e.js:815-826`), debounced over two
  frames (`js/ui.6b3a528e.js:828-834`). Never blocking (`js/ui.6b3a528e.js:2035`).
- Pre-credit, blocking, but format-only on every grade entry point:
  `_validateScanFile` (`js/core.d9e1b484.js:13238-13255`: 15 MB cap, JPEG/PNG/WebP,
  explicit HEIC and PDF messages) is bound and branched in `processGradeImage`
  (`14341-14346`), `processGradeBack` (`14388-14393`) and `processGradeEdge`
  (`14466-14471`); `tests/scan-hygiene-2026-09-04.mjs:144-154` asserts that wiring
  for all four photo functions.
- Pre-credit, blocking, content-ish, **Deep Grade only**: duplicate-photo detection
  via middle-slice signature (`api/scan.js:729-763`, code `DUPLICATE_PHOTOS`) and a
  tiny-photo reject under ~8 KB (`api/scan.js:765-779`, code `PHOTOS_TOO_SMALL`).
  Both return 400 before line 785's debit.
- Post-credit, advisory: the model returns `confidence_drivers` from a fixed
  vocabulary that includes `blurry_photo`, `low_resolution`, `finger_covering_card`,
  `holder_glare`, `reflective_sleeve` (`api/scan.js:1445`), which the UI renders as
  "Confidence reduced by: …" (`js/core.d9e1b484.js:14810-14826`), and impairment
  drivers cap the estimate at 9 (`api/scan.js:2257-2272`).

**Evidence — what is genuinely absent:** the hard blur/low-res gate that exists for
ID scans (`js/photo-qc.js:38-39`, `MIN_SHORT_EDGE = 400`, `BLUR_THRESHOLD = 120`,
enforced at `js/core.d9e1b484.js:13341-13379`) is **not applied to grade photos**;
there is no angle/skew check anywhere; there is no finger or background check outside
the model's own post-hoc self-report; and Quick Grade's only server-side content check
is presence of front+back (`api/scan.js:774-780`).

**If real, what it takes:** call the existing `window.CardResellPhotoQC.check()` from
`processGradeImage` / `processGradeBack` / `processGradeEdge` with `skipDupe: true`
(edge close-ups legitimately look alike), reusing the same reject UI as
`js/core.d9e1b484.js:13346-13378`. Angle/skew can come from the bounds already
computed by `CardResellFastPath.detectCardBounds` (used at `js/photo-qc.js:202-219`).
No new module needed.

**Rule conflict:** none, provided the gate reuses `photo-qc.js` rather than adding a
parallel quality checker (Rule 1).

---

### Item 14 — Per-subgrade confidence (centering vs corners vs edges vs surface), not one magic number
**Verdict:** PARTIAL — and the reviewer's "one magic number" framing is materially wrong

**Evidence — four subgrades are produced and displayed:**
- Server builds a numeric subgrade object per pillar: `api/scan.js:1978-1986`
  (`subgrades = { centering, corners, edges, surface }`), overlaid with Ximilar's
  pixel-measured pillar scores when the CV grader runs (`api/scan.js:2056-2060`) and
  returned on the wire (`api/scan.js:2410-2412`).
- Centering is *measured*, not eyeballed: L/R and T/B ratios plus a server-computed
  `centering_ceiling` with a coherence pass that lets the ratios override the model
  (`api/scan.js:1960-1976`, `2100-2148`), surfaced as a per-axis PSA-zone meter in the
  UI (`js/core.d9e1b484.js:14828-14895`).
- UI renders four separate bars with per-pillar plain-English tips
  (`js/core.d9e1b484.js:14724-14746` `scoreBar` + `14663-14715` the four tip
  functions), and there is a "LIMITING FACTOR" block explaining which pillar caps the
  grade (`js/core.d9e1b484.js:14790-14795`). A "CV-VERIFIED · PIXEL-MEASURED GRADING"
  badge appears when Ximilar produced the numbers (`js/core.d9e1b484.js:14772-14779`).

**Evidence — what is genuinely absent:** *confidence* is a single global value, not
per-pillar. One `data.confidence` → one pill (`js/core.d9e1b484.js:14605-14611`,
"High/Moderate/Low confidence"), one probability distribution over overall PSA grade
(`js/core.d9e1b484.js:14780-14789`), and one flat list of reasons
(`js/core.d9e1b484.js:14810-14826`). Nothing maps `holder_glare` → "surface unreliable"
or `limited_edge_visibility` → "edges unreliable" at the pillar level.
Note also the deliberate choice at `js/core.d9e1b484.js:14727-14730`: "PSA does NOT
publish numeric sub-grades … **Never show a fake \"8.5/10\" sub-score**" — the numeric
subgrades exist internally but are shown as PSA-native descriptions plus a bar.

**If real, what it takes:** attach the existing driver vocabulary to pillars
server-side (a `subgrade_confidence: {centering, corners, edges, surface}` derived from
which photos were supplied and which drivers fired, e.g. `limited_edge_visibility` →
edges low, `single_photo_only`/`back_not_visible` → corners/surface low), then render
per-bar. Files: `api/scan.js` (near 2340-2415) and `js/core.d9e1b484.js` `scoreBar`.

**Rule conflict:** Rule 2 applies to the implementation — a per-pillar confidence must
be derived from observable inputs (photo coverage, drivers, CV vs GPT source) and
labelled as derived, not invented as a percentage.

---

### Item 15 — Deep Grade that fails closed when an edge photo is missing instead of guessing
**Verdict:** SHIPPED (with one scope caveat worth stating to the owner)

**Evidence:**
- Server refuses before any debit. `api/scan.js:711-716`: missing front or back →
  400 `"Deep Grade requires at least a front and back photo of the card."` with a
  `missingPhotos` array. `api/scan.js:720-725`: fewer than two edges → 400
  `` `Deep Grade needs 4–6 photos total (front, back, plus 2–4 edge close-ups). You provided ${totalPhotos}.` ``
  with `needsMoreEdges`. Both sit above the credit consumption block at
  `api/scan.js:785`, and the ordering is deliberate (`api/scan.js:705-707`: "enforce
  per-tier minimums BEFORE deducting any credits or spending money on OpenAI").
- The presence check for the front image was explicitly moved above the debit for this
  exact class of bug (`api/scan.js:679-685`: "Validate presence of imageBase64 BEFORE
  any credit debit. Previously the check lived at ~line 883 — AFTER the atomic DECR").
- Client fails closed twice over: the submit button is disabled until two edges are
  captured (`js/core.d9e1b484.js:14457`, disabled state "Add N more edge(s) to
  submit"), `submitDeepGrade()` re-checks (`js/core.d9e1b484.js:14494`,
  `showToast('Need at least 2 edge photos for Deep Grade')`), and `submitGradeScan`
  aborts on missing front/back (`js/core.d9e1b484.js:14508`, "Photos missing.
  Please start over."). `processGradeBack` also refuses if front is gone
  (`js/core.d9e1b484.js:14399`, "Front photo missing. Please start over.").
- It does not guess in the middle either: duplicate re-uploads of the same photo are
  rejected pre-debit (`api/scan.js:729-763`) rather than counted as distinct edges.

**Caveat for the owner:** "fails closed" is enforced against a **2-of-4** edge minimum,
not all four. A Deep Grade with only two edges proceeds, and the honest signal for the
unseen edges is the advisory `limited_edge_visibility` driver
(`api/scan.js:1445`, rendered `js/core.d9e1b484.js:14812-14826`) — which is explicitly
classed as product scope, not impairment, so it does not cap the grade
(`api/scan.js:2257-2272`). The UI copy matches the code ("Add edge photos — pick **at least 2**, up to 4",
`js/core.d9e1b484.js:14427`), so no Rule 3 problem — but a reader of the reviewer's item
should not conclude that all four edges are required.

**If real, what it takes:** n/a.

**Rule conflict:** none.

---

### Item 16 — Side-by-side of "our estimate" vs "what you should write in the listing"
**Verdict:** GAP (server-side ingredients exist and are tested; nothing is wired to the
grade result, and no such copy exists anywhere in the UI)

**Evidence:**
- No listing-copy string exists in the product. Searches for "write in the listing",
  "for your listing", "listing copy", "listing text", "paste this" across
  `index.html`, `js/core.d9e1b484.js`, `js/ui.6b3a528e.js` and `api/*.js` return
  nothing.
- The grade result panel ends at estimate + subgrades + probability + grading-upside +
  three navigation buttons (`js/core.d9e1b484.js:15033-15070`: "View PSA X price",
  "View Card", "Share this grade"). The share path posts to `/api/grade-share`
  (`js/core.d9e1b484.js:15121-15140`) and produces a public OG card
  (`api/grade-share.js:1-4`) — a brag graphic, not listing copy.
- The ingredients do exist server-side and are unit-tested: `buildConditionBlock`
  (`api/_conditionDescriptors.js:60`) and `conditionHandoffLines` are exercised by
  `tests/listing-packet-offline.mjs:18, 256-304`, and `buildListingPacket`
  (`api/_listingPacket.js:315`) assembles identity + aspects + condition + pricing.
  But `buildListingPacket` has exactly one occurrence in the whole repo — its own
  definition — so nothing calls it, and nothing in `js/` fetches it.
- Important constraint the reviewer could not see: the existing policy is that we do
  **not** convert our estimate into a condition claim. `api/_conditionDescriptors.js:64-70`:
  "Raw: we do not assert a condition. We have not inspected the card, and **our own
  estGrade is a scan heuristic, not a condition claim**" → note "Pick the card
  condition in the listing form. We do not guess condition on raw cards."

**If real, what it takes:** a "for your listing" block under the grade result that
reuses `conditionHandoffLines` / `buildConditionBlock` via a small read-only endpoint,
and prints the honest split: our estimate on the left; on the right the raw-card
condition wording the seller must choose themselves, the flaw sentences derived from
`limiting_factor` / `grade_notes` (`api/scan.js:2376-2415`), and an explicit "do not
write 'PSA 9' — this card is unslabbed". Files: `js/core.d9e1b484.js` (grade result
render, ~14900-15070), `api/_conditionDescriptors.js` / `api/_listingPacket.js`
(consumers only, no new logic).

**Rule conflict:** Rule 3 governs the copy — the listing side must never state or imply
a certified grade from an estimate, which is what `api/_conditionDescriptors.js:64-70`
already encodes. Rule 5's "no publish button before Phase 3" also applies: this must be
copy-to-clipboard handoff only, never a submit action. Neither blocks the item.

---

### Item 17 — No "get it graded!" dark-pattern leftover after a high estimate
**Verdict:** PARTIAL — the reviewer is right that the upsell survives the result; wrong
that nothing was cleaned up

**Evidence — what the code actually does (reporting code only; the GitHub issue was
not checked from here):**
- After every grade result the affiliate CTA is re-shown unconditionally:
  `js/core.d9e1b484.js:14940` — `showScanGradeCTA(data.card_name, '', psa);`. Inside
  `showScanGradeCTA` (`js/core.d9e1b484.js:13169-13197`) the `psa` argument is used
  only to decide the CTA is not suppressed; with `grader` empty the headline falls to
  the else branch at `13190`: `` `${cardName} — Get it officially graded!` ``. The
  static panel around it (`index.html:1820-1832`) reads: label "🏆 Get It Graded",
  sub-line "**Official grades unlock 2–5× higher resale value.**", and four affiliate
  buttons (PSA / CGC / BGS / SGC). None of it varies with the estimate — a PSA 4
  estimate, a low-confidence estimate, and a slabbed-card estimate all get
  "Get it officially graded!" plus the 2–5× claim.
- The worth-grading verdict directly above it *is* conditional and honest:
  `js/core.d9e1b484.js:14919-14937` shows "✓ Worth submitting for grading" + a PSA
  submission CTA only when `data.worth_grading`, else "May not be worth grading costs";
  and the server backstops that flag hard (`api/scan.js:2274-2286`: `worth_grading`
  forced false unless `psa_estimate >= 9` and confidence is not low; forced false
  outright for slabbed cards at `api/scan.js:2219-2220`). So the page can simultaneously
  say "May not be worth grading costs" and "Get it officially graded!" — that is the
  leftover.
- Real cleanup did happen elsewhere, and the owner should know it: the CTA is
  suppressed on unidentified scans (`js/core.d9e1b484.js:13171-13182`, "Never upsell a
  $-costing grade for a card we couldn't confidently identify"), the fabricated
  grade-opportunity tile is an unconditional no-op (`js/core.d9e1b484.js:2122-2124`,
  with `tests/launch-audit-regressions.mjs:807-827` asserting it stays withdrawn), and
  the PSA CTA carries no fake discount code (`js/core.d9e1b484.js:14920`, "no false
  promo — we don't have a PSA discount code").
- Separately, a paid-tier nudge fires 1.2 s after any estimate ≥ 8:
  `js/core.d9e1b484.js:14947-15010` — `trigger = 'quick_grade_high_free'` with copy
  `` `PSA ${psaNum}+ estimate on a Quick Grade. A Deep Grade uses 6 photos for a much
  tighter estimate — recommended before you submit.` `` → button "Upgrade for Deep
  Grade"; plus `quick_grade_high_pro` → "Upgrade to Pro Max". This is an upsell keyed
  to a *high* estimate, which is the same pattern the reviewer is objecting to, aimed
  at our own tiers rather than a grader.

**If real, what it takes:** gate the affiliate panel on the same `worth_grading` flag
the text above it already uses — pass it into `showScanGradeCTA`
(`js/core.d9e1b484.js:13169`) and hide the panel, or swap the headline to a neutral
"Where to submit, if you decide to" when `worth_grading` is false or confidence is low
or `slab_warning` is set. Also either source or delete the "2–5× higher resale value"
line at `index.html:1823`.

**Rule conflict:** Rule 3 (UI text must match what the code does) — "Get it officially
graded!" beside "May not be worth grading costs" is a mismatch. Rule 2 — the unsourced
"2–5× higher resale value" figure at `index.html:1823` is an unlabelled, unmeasured
number in the same panel. Note the item is otherwise partly a monetization judgment
(affiliate revenue vs. honesty), which is the owner's call, not a code fact.

---

## Group summary

**Counts per verdict:** SHIPPED 1 (15) · PARTIAL 4 (12, 13, 14, 17) · GAP 1 (16) ·
GAP-BLOCKED 1 (11) · WRONG 0 · NOT-CODE 0 · UNVERIFIABLE 0.

**Most worth doing first:**
1. **Item 12 — make the slab case not cost a credit.** The detector already exists and
   already forces an honest result (`api/scan.js:2004-2008`, `2215-2250`); the only
   defect is that the user pays for an estimate the server itself declares
   non-actionable and refuses to call worth grading. Calling the existing
   `refundCredits()` (`api/scan.js:956`) on `looksSlabbed` is a few lines and removes
   the sharpest trust complaint in this group.
2. **Item 17 — gate the "Get it officially graded!" panel on `worth_grading`.** A
   one-argument change at `js/core.d9e1b484.js:13169`/`14940` removes a live Rule 3
   contradiction on the same screen, and it also forces a decision on the unsourced
   "2–5× higher resale value" claim at `index.html:1823` (Rule 2).
3. **Item 13 — run the existing `photo-qc.js` gates on grade photos.** Grade photos
   cost 1–2 credits versus the ID scan's 1, yet ID scans get the hard blur/low-res gate
   and grade photos do not. Wiring the same module into `processGradeImage` /
   `processGradeBack` / `processGradeEdge` reuses one implementation (Rule 1) and needs
   no new thresholds.

**What the reviewer got materially wrong:**
- **Item 14's "one magic number" is not accurate.** Four pillars are produced and
  rendered separately, centering is pixel-measured with a PSA-zone meter and a
  server-enforced ceiling, and there is a probability distribution and a limiting-factor
  block. What is missing is per-pillar *confidence*, which is a narrower ask.
- **Item 15 is already built and already fails closed pre-debit** — on the server
  (`api/scan.js:711-725`) and twice on the client. The only nuance is that the required
  minimum is 2 of 4 edges, disclosed as such in the UI.
- **Item 11 is not a hidden number, it is a disclosed absence** (`accuracy.html:194`,
  `pricing.html:371`). The reviewer's fix cannot be shipped from code, and the artifact
  it needs (the Grade gold-set) is on the do-not-touch list.
- **Item 12's premise is half-satisfied in an unexpected place:** slab detection exists
  and is unusually strict about honesty, it is simply on the wrong side of the debit,
  and the pre-capture glare hint is advisory by explicit design
  (`js/ui.6b3a528e.js:2035`).
- Item 17 also has an in-house counterpart the reviewer did not mention: the ≥ PSA 8
  post-grade tier-upgrade nudge (`js/core.d9e1b484.js:14947-15010`).

**Known-but-out-of-scope:** the two grading-cost implementations (client
`renderGradingUpside` flat fee vs `api/grade-opportunity.js` tiered `getGradingCost`)
do not change any verdict above; the only touchpoint is that item 16's listing block
must read costs from one source if it ever quotes a fee (Rule 1).

**What I could not check, and why:**
- GitHub issue #11's state — no repository/issue access from here; the parent agent is
  checking it. Everything above is code-only.
- Whether the Ximilar CV grader currently returns pillar scores or slab hints in
  production (`api/_ximilar_grade.js`) — that is live provider behavior; it would be
  settled by one authorized non-production grade call with logging, which the method
  forbids here.
- I did not execute `tests/scan-hygiene-2026-09-04.mjs` or any other suite; test files
  are cited as source text only.
