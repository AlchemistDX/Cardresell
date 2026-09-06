# Reviewer 62-Item List — Verdict Against the Actual Codebase

**Date:** 2026-09-06 · **Repo state:** branch `phase1-block-d`, tip `0ba1b60`, clean tree
**Method:** `audit/reviewer62/METHOD.md` · **List as received:** `audit/reviewer62/REVIEWER_LIST_VERBATIM.md`
**How this was produced:** five independent read-only verification passes, each told to cite `file:line` or return no verdict. Per-item evidence lives in `GROUP_A_TRUST.md`, `GROUP_B_GRADE.md`, `GROUP_C_SCAN.md`, `GROUP_D_ACCOUNT.md`, `GROUP_E_UX_OPS.md`. Nothing here was accepted on the reviewer's word or on mine.

---

## 1. The short version

The reviewer is a good reviewer. The list is specific, it is mostly aimed at the right thing (can a flipper trust the number and finish the job), and roughly two-thirds of the items describe something real.

But the list was written from **outside the app**, and that produces a systematic error: **the reviewer repeatedly reports as "missing" things that are built and shipped but not visible in the place they looked.** Eight items are already done. One is flatly wrong. Two cannot be done without either inventing a number or touching the do-not-touch list.

The more useful outcome is the other direction: **verification turned up ~10 defects the reviewer did not list, and several of them outrank most of the 62.** Three of those are live truth defects — text on the production site that is not true — which is the one category this project has a standing rule about.

### Verdict tally (62 of 62 items adjudicated)

| Verdict | Count | Meaning |
|---|---|---|
| SHIPPED | 8 | Already built and reachable by a user |
| PARTIAL | 38 | Real substance exists; a specific named piece is missing |
| GAP | 9 | Genuinely absent, and buildable |
| GAP-BLOCKED | 2 | Absent, and cannot be built without breaking a project rule |
| NOT-CODE | 4 | A business, staffing, legal, or marketing decision — no code answer |
| WRONG | 1 | The premise does not match the code |

PARTIAL dominating at 38/62 is not a fudge. It is the honest shape of the list: the reviewer saw a real weakness in most cases but misjudged how much of the work is already standing.

---

## 2. What the reviewer got materially wrong

These are worth reading carefully, because acting on them as written would mean **rebuilding something that already works**, or worse, adding a number the project deliberately refused to invent.

| # | Reviewer said | The code says |
|---|---|---|
| 1 | Trust bundle "designed but not live" | **It is live.** IQR outlier trim, confidence tier + score + reasons, comp count, `fetchedAt`/`cacheAgeSec` all compute (`api/ebay-sold.js:60-149`, `339-350`) and all render on the card view (`js/core.d9e1b484.js:1924-1958`, written at `:2691`). It looks absent because **eBay 403s Vercel's IPs**, so the comps that carry it usually never arrive. The stale `NEXT_UP_TRUST_BUNDLE.md:3` still says "Paused" and is the likely source of the reviewer's error. The work is fixing the 403, not building the bundle. |
| 2 | Stale/verified pills only on the Accuracy page | Already on **every payout tile** (`:7682-7693`), and stale venues are already barred from rank #1 (`:7270-7274`). Real remainder is narrow: the winner banner and rank strip carry no freshness mark. |
| 3 | Seller-level overrides missing | **SHIPPED.** Top Rated, Basic vs Store, TCGplayer Direct vs self-ship, Pro rate all exist as inputs. Drop from any minimum set. |
| 4 | "Hidden $5 inbound assumption" | Not hidden — it is a **labeled visible deduction line**, "Ship-in to vault (est.)" (`:6726-6731`, `:6741-6752`). Only *editability* is missing. |
| 6 | Condition markdown is "a footnote" | It is a **real input**. `getEffectivePrice()` multiplies the basis before every venue including buylists (`:4586-4601`, `:6873-6897`). Only per-venue buylist schedules are footnotes. |
| 8 | "Reference-only" exists in policy, needs to be in UI | **Already shipped UI** (`:7288-7290`). |
| 14 | Grade is "one magic number" | **Four pillars ship** — centering, corners, edges, surface (`api/scan.js:1978-1986`, Ximilar overlay `:2056-2060`), with centering pixel-measured against a PSA zone meter, plus a distribution and a named limiting factor. Missing piece is *per-pillar confidence*, which is a much smaller ask. |
| 15 | Deep Grade should fail closed on a missing edge photo | **Already fails closed, and pre-debit** — server 400s at `api/scan.js:711-725` before the debit at `:785`; client disables submit. Caveat: the minimum is 2 of 4 edges, and the UI says so. |
| 25 | Non-Pokemon empty state "is Charizard" | **WRONG.** Every game mode has its own empty state and placeholders (`js/core.d9e1b484.js:8015-8052`, `759-790`). Charizard appears only in the deliberate first-visit auto-example (`:714-745`, gated `:17956`) and a never-relabeled "Try Charizard →" CTA (`index.html:1728`). The CTA label is a fair nit; the claim is not. |
| 40 | Days-to-cash missing | **On screen** (`:7679-7680`). The *sell-through* number the reviewer implies is a deliberate refusal (`:6926-6947`, `index.html:2136`, `audit/SELL_VELOCITY_RESEARCH.md`). Adding it would be a regression, not a fix. |
| 41 | "Sign-in besides Google" | Premise wrong — **email+password already ships** (`signin.html:300,331,382`, `js/auth.5cf1cd22.js:81-84`). See §4, this one cuts two ways. |
| 43 | "In-app cancel, not email will@" | **Full Stripe portal ships** (`api/stripe-portal.js`, `:17464-17497`), two Pro-gated entry points. The only `mailto:will@` is `privacy.html:99`, and it is for *deletion* — which is item 45's problem, not 43's. |
| 44 | Live tiers vs leftover "Ultimate" spec | Half right, wrong half emphasized. The Ultimate spec (`NEXT_UP_TIER_EXPANSION.md`) is **not deployed** (no `.md` in the `vercel.json` whitelist), checkout rejects it (`api/stripe-subscription-checkout.js:62-66`), deep links remap honestly (`config:71-78`). That half is cosmetic. **The real defect is live pricing duplicated 4+ times and already drifted** — see §3. |
| 47 | "Two near-tied free rows" | Ghosted rank already exists, just **capped at 3 rows** (`:7344`). |
| 51 | Camera "fails silently" | It does not — it falls through to the native picker by design. **Paste-image genuinely does not exist**; that half stands. |

Two structural notes. Items **9 and 10** partly duplicate the reviewer's own "already counts, do not rebuild" credit for the accuracy changelog. And items **1, 27, 29** partly ask for numbers this project researched and deliberately declined to publish (gem-rate EV, sold-date on undated feeds, confidence without a sample) — those are refusals on the record, not oversights.

---

## 3. What the reviewer missed — and this is the part that matters

Ranked by whether it costs money, tells a user something untrue, or loses their data.

### 3.1 Live truth defects (violates "do not stamp a lie")

1. **`📬 Price Drop Alerts` is a newsletter signup.** `index.html:1646`. There is no price-drop alerting. The label promises a feature that does not exist. This is a rule-3 violation *today*, independent of whether watchlists ever ship (reviewer item 28). Cheapest fix on this entire page: rename it.
2. **"Official grades unlock 2–5× higher resale value."** `index.html:1823`. An unsourced multiplier presented as fact, sitting inside the grading upsell. Either source it or delete it.
3. **"Sign in with Google — it's free."** `index.html:2445` (and `:10904`). Email+password sign-in has shipped. The copy describes an auth system that is narrower than the real one.
4. **Live pricing is duplicated 4+ times and has already drifted.** `index.html:2941/2981/3004` say **"save about 25%"**; `pricing.html:210/233/413` say **"3 months free"**. Those are different offers. `pricing.html:256-259` documents a *prior incident where the site advertised unbuyable packs* — so this exact failure mode has already bitten once. This is a rule-1 violation (one behavior, one implementation) on the most consequential text on the site.
5. **The ±15% band is synthesized and printed as if observed.** `api/tcg-price.js:290-295` fabricates `low = market × 0.85` / `high = market × 1.15` on the fallback rung, and `js/core.d9e1b484.js:1859-1870` renders it as a real range. It fires **precisely when the primary feed is down** — the moment the number deserves the least confidence gets a made-up spread. Rule 2 violation.

### 3.2 Money and abuse

6. **`api/tpl-proxy.js` is an unauthenticated open proxy in front of a paid API key.** `:11-19` — wildcard CORS, no auth, no cache, no rate limit. There is a path allow-list, which limits *what* can be called, not *how often* or *by whom*. `api/pricecharting.js:439-444` spends a paid token under the same conditions. Anyone can bill this project's API quota from a browser console. Note the irony: the scan/grade endpoints the reviewer worried about (item 60) are **the best-defended part of the system** — token identity (`api/scan.js:645-652`), atomic pre-debit validation (`:679-687`, `:885-945`), Turnstile, IP throttle, email-verify gate. The exposure is on the endpoints nobody flagged.
7. **A slab is detected *after* the credit is spent, and is not refunded.** Debit at `api/scan.js:785`; slab detection at `:2004-2008`; the code openly says "we STILL return the grade (user paid for it)" (`:2002`). `refundCredits()` exists at `:956` and is never called on that path. The honesty caps afterward are strong (confidence→low, `worth_grading`→false, PSA capped at 8, `:2215-2250`) — so **the user pays for a result the server itself labels non-actionable.** This is reviewer item 12, but the refund angle is sharper than what they asked for.
8. **`photo-qc.js` guards the cheap scan and not the expensive one.** `window.CardResellPhotoQC.check()` has exactly one call site (`:13335-13385`), pre-`/api/scan`, failing closed with "No credit was used." **No grade entry point calls it** — grade photos get only `_validateScanFile` size/MIME checks (`:13238-13255`) and advisory camera hints where "the shutter is never disabled" (`js/ui.6b3a528e.js:2035`). Grade costs more credits than ID and has weaker input gating.

### 3.3 Data loss

9. **Anonymous flips and collection have no server copy at all.** `:16589-16594` early-returns without a session, while the Collection sign-in wall was deliberately removed (`:8976-8988`). A logged-out user builds a collection, clears browser data, and it is gone with no warning. Signed-in users are fine. This is reviewer item 35, and their instinct was correct.

### 3.4 Correctness

10. **Bulk renders a medium-confidence `needsPicker` response as a confident ✓ row.** `js/ui.6b3a528e.js:3188-3204` branches on `if (data.card_name)`, so a response the server flagged as needing disambiguation is displayed as resolved, with no picker. Single-scan handles this correctly. A wrong ID silently priced is the exact failure this project is most exposed to.
11. **`api/collection.js` is a second, orphaned server collection store** with different limits that no live client calls. Rule-1 violation, dormant.
12. **Two grading-cost implementations still coexist** — client `renderGradingUpside` flat `GRADING_FEE = 25` vs server tiered `getGradingCost()` in `api/grade-opportunity.js`. Already known and flagged in §8.4 of the roadmap doc; restated here because it is still live.

---

## 4. Two corrections to things I told you

I need to own both of these, because you are relying on my notes.

**(a) I said `_marketAskDivergence()` discloses sharp market/ask disagreement. It does not reach the user.** It is computed at `api/tcg-price.js:628-651` and **the client never reads it** — I grepped `marketAskDivergence` across the live bundle and got zero hits. Computed, serialized, discarded.

**(b) The cross-source disagreement disclosure is switched off, and my roadmap doc §3.4 describes it as active.** The comment at `js/core.d9e1b484.js:1912-1922` is explicit: *"Withdrawn 2026-09-04 at the owner's direction... Detection (`_sourceDisagreement`) is deliberately KEPT and still exercised by tests — only the render is withdrawn."* The comment even records the cost on purpose: when the two feeds disagree by more than 50%, the seller sees only the basis we picked, with no hint the other source says something very different.

That was your call and the code documents it properly. But **`CARDRESELL_PLAN_AND_ROADMAP.md` §3.4 currently tells a new reviewer that disclosure fires.** That needs correcting before the doc goes to anyone else, or the next reviewer audits against behavior that is turned off. Two disclosures, both dark: one withdrawn by decision, one never wired. Combined, that is the largest live trust regression found in this pass — and neither was on the reviewer's list.

**Question for you:** the divergence signal was withdrawn because it fired on homepage cards and read as a defect in the app rather than a fact about the feeds. That reasoning is sound for the homepage. Does it also hold on the **card detail view**, where the seller is deciding what to price? The detection is still live and still tested, so routing it *only* to the detail view is a small change, not a rebuild.

---

## 5. Your reviewer's proposed minimum set, assessed

They proposed: **1, 3–4, 11–12, 20, 37, 41, 47, 53.** Ten items. Here is what each actually costs.

| # | Their ask | Verdict | What it really means |
|---|---|---|---|
| 1 | Trust bundle live | PARTIAL, premise wrong | **Not a build.** Fix the eBay 403 and the bundle appears. Different, harder, and not a UI task. |
| 3 | Seller overrides | **SHIPPED** | Remove from the set. |
| 4 | Custom shipping cost | PARTIAL | Small and real: make the labeled $5 line editable. |
| 11 | Publish grade accuracy vs PSA | **GAP-BLOCKED** | Cannot be done. Zero grading-accuracy data exists in the repo; the only harness (`tools/scan_accuracy_harness.py`) is card-ID pHash. Measuring requires the **Grade gold-set, which is do-not-touch**, and publishing a figure without measuring breaks rule 2. `accuracy.html:194` already discloses the absence honestly. Remove from the set — or reopen the gold-set decision deliberately. |
| 12 | Slab detector before the credit | PARTIAL, **keep** | The best item on their list. See §3.2 #7. |
| 20 | CSV export | PARTIAL | Four CSV exports exist; **none from Bulk ID Scan**, which is where it matters. Real. |
| 37 | One-click copy | **GAP, keep** | Packet exists server-side (`api/_listingPacket.js`); the seller gets only an opaque draft id (`:18392-18395`). One read endpoint + three buttons. Highest value-per-hour on the list. |
| 41 | Sign-in besides Google | PARTIAL, premise wrong | Password already ships. Magic link / Apple / passkeys genuinely absent. **Rule 5 ("no password collection") does not block this** — passwordless methods collect no passwords. Also: rule 5 is *already breached by shipped code*, which you should decide about consciously. |
| 47 | Ghosted 15-venue rank | PARTIAL | Exists, capped at 3 (`:7344`). Raising a cap. |
| 53 | Named testimonials | **NOT-CODE** | Needs real customers saying real things. Yours, not buildable. |

**Net: of their ten, one is shipped, one is blocked, one is not code, and two rest on a wrong premise.** Five survive as written, and only two (12, 37) are both high-value and cleanly actionable.

---

## 6. What I would actually do first

Ordered by consequence per unit of work, drawing on both lists. Note that **five of the top six are things the reviewer did not raise.**

1. **Rename `📬 Price Drop Alerts`.** One line. Removes a live lie. (§3.1 #1)
2. **Fix the pricing-copy drift between `index.html` and `pricing.html`, then de-duplicate to one source.** This already caused an incident once. (§3.1 #4)
3. **Refund the credit when `looksSlabbed`.** A few lines using the existing `refundCredits()`. Touches user money. (= their item 12)
4. **Rate-limit `tpl-proxy` and `pricecharting`.** Reuse the KV counter pattern already in `api/scan-refund.js:91-101` — and implement it **once**, as a shared helper, per rule 1. (§3.2 #6)
5. **Delete the synthesized ±15% band, or label it as derived.** Do not print a fabricated range as an observed one. (§3.1 #5)
6. **Fix the bulk `needsPicker` branch** so an ambiguous result cannot render as a confident ✓. (§3.4 #10)
7. **Add copy buttons for the listing packet.** (= their item 37, and their best structural instinct)
8. **Warn anonymous users that their collection is browser-only**, or restore a save prompt. (= their item 35)
9. **One line of copy on failed bulk rows** — "credit returned." The refund is already correct server-side; the user just cannot see it. (= their item 19)
10. **Correct §3.4 of the roadmap doc** before it goes to another reviewer, and decide the detail-view divergence question in §4.

Items 1, 2, 5, and 9 are all copy or a few lines. Items 3, 4, and 6 are small and touch money or correctness. Nothing in this top ten is a rebuild.

---

## 7. Standing constraints this list has to respect

Restated because several reviewer items brush against them:

- **Never display an invented number.** Kills items 11, most of 27, the grade-fee half of 29, and the sell-through half of 40. It is also why §3.1 #5 is a defect rather than a feature.
- **One business behavior = exactly one implementation.** Any fix to items 44 or 60 must land as a single shared implementation, not a second one. This project has been bitten four times.
- **Do-not-touch:** Ultimate (retired), Grade gold-set, Wallpaper, homepage feature-grid blurb. Item 44's remedy is to *archive* `NEXT_UP_TIER_EXPANSION.md` under a "RETIRED — do not implement" header, never to revive it. Item 52 concerns the default `activeGame` (`:480-481`, `index.html:1484`), which is **not** the protected wallpaper layer (`index.html:152-232`) — a distinction worth keeping straight before anyone edits.
- **No deployment until you authorize it.** Everything above is analysis; nothing has been changed.
- Item 59 has a code constraint the reviewer could not see: `api/admin.js:13,29` hard-wires refund authority to a single uid, so delegating it needs an allow-list change **plus a deploy**, which is on hold.

---

## 8. Where the evidence lives

| File | Items | Lines |
|---|---|---|
| `audit/reviewer62/GROUP_A_TRUST.md` | 1–10, 27, 29 | 638 |
| `audit/reviewer62/GROUP_B_GRADE.md` | 11–17 | 373 |
| `audit/reviewer62/GROUP_C_SCAN.md` | 18–26, 28, 30 | 579 |
| `audit/reviewer62/GROUP_D_ACCOUNT.md` | 31–46 | 335 |
| `audit/reviewer62/GROUP_E_UX_OPS.md` | 47–62 | 731 |
| `audit/reviewer62/METHOD.md` | verification rules + verdict vocabulary | 102 |
| `audit/reviewer62/REVIEWER_LIST_VERBATIM.md` | the list as received | 107 |

Every item in every group file carries a `file:line` citation or an explicit statement that no evidence was found. The stale bundle `js/core.569ff536.js` was never cited. No tests were run and no production endpoint was called during verification.

### On the GitHub issue in item 17

The reviewer claimed issue **#11** is still open. **It is** — "Grade Scan Promotion — replace 'Get it officially graded!' popup", opened 2026-07-01, labels `enhancement`, `area:scan`, `area:grade`, `sprint`. It is the **only** open issue in `AlchemistDX/Cardresell`.

Two things they could not have known:

- **The issue's own spec would create the pattern they are objecting to.** Fix step 4 reads: *"Only surface PSA/CGC/BGS/SGC after the Grade Scan — and only conditionally, if estimated grade ≥ 9 AND estimated graded value ≥ $50."* That is a grading upsell gated on a **high estimate** — precisely reviewer item 17's complaint. Its success metrics include *"Avg. credits spent per session +30%."* So closing #11 as written does not resolve item 17; it ships it. **These two inputs are in direct conflict and you have to pick.** My read: the issue's conditional gate is actually the more defensible design *because* it is conditional — the live behavior is worse than either proposal, since `showScanGradeCTA()` at `:14940` re-shows the panel after **every** result, so "Get it officially graded!" (`:13190`) can sit directly beneath "May not be worth grading costs" (`:14937`). Gating on `worth_grading` is the fix, and it satisfies both readings.
- **The spec the issue links to does not exist.** `cardresell_grade_scan_promotion_spec.md` is not in the repo, so the issue's acceptance criteria ("see P0 requirements R1–R5") point at nothing. Anyone who picks up #11 will be blocked immediately.
