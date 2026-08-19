# CardResell — Promote Grade Scan Over Third-Party Grading

**Feature spec · v1.0 · July 2026**

---

## 1. Problem Statement

After a user completes an **ID Scan**, CardResell currently surfaces a popup titled *"Get it officially graded!"* pushing them toward PSA, CGC, BGS, or SGC submission. This flow has three problems:

1. **It sends users out of the app.** Third-party grading is a 2–8 week, $15–$50+ commitment. Most users abandon the intent before submitting, and CardResell captures no revenue.
2. **It skips CardResell's own product.** Grade Scan — CardResell's in-app AI grade estimate — is the natural next question after "what is this card worth?" It answers *"what would it grade?"* in seconds, and it's already built.
3. **It's the wrong-sized offer for most cards.** Roughly 90% of scanned cards are low- to mid-value (like the Pidove #148/086 in the reference screenshot). Recommending PSA submission for a $2–$10 card is a mismatch users learn to ignore, which trains them to dismiss the popup entirely.

**Impact:** Lost Grade Scan credit revenue on every ID Scan, lower engagement per session, and a training effect that reduces trust in post-scan prompts.

---

## 2. Goals

**User goals**

- Answer the question users actually have next ("what condition/grade is this?") without leaving the app or waiting weeks.
- Right-size the recommendation to the card's value — cheap cards get an instant estimate, high-value cards get an official-grading path.

**Business goals**

- **Increase Grade Scan attach rate** from post-ID-Scan flow to **≥ 25%** of ID Scans within 60 days of launch (baseline TBD — instrument before ship).
- **Increase average credits spent per session by ≥ 30%** by converting an outbound handoff into an in-app purchase.
- **Preserve the official-grading referral path** for the small share of cards where it's genuinely the right recommendation (est. grade ≥ 9 AND estimated graded value ≥ $X threshold).

---

## 3. Non-Goals

- **Not replacing Grade Scan itself** — this is a promotion/placement change, not a change to how Grade Scan works.
- **Not removing PSA/CGC/BGS/SGC entirely** — official grading stays available, just repositioned as a data-driven follow-up rather than the default upsell.
- **Not changing pricing** for ID Scan or Grade Scan credits in this release.
- **Not building a grading-submission integration** (mail-in workflow, PSA API, etc.) — out of scope.
- **Not changing the Pro subscription offer** — the "CardResell PRO" banner behavior is untouched.

---

## 4. User Stories

**P0 — Core flow**

- As a **casual collector** who just scanned a card, I want to see what it would grade so I can decide whether it's worth sleeving/keeping, without committing to a weeks-long submission.
- As a **flipper on a budget**, I want an instant grade estimate for $0.50–$5 so I can price my listing accurately, without paying $25+ to PSA for a card worth $10.
- As a **user holding a genuinely high-value card**, I want CardResell to tell me *after* the grade estimate whether it's worth submitting to PSA/CGC — with the estimated grade and graded market value shown as the reason.

**P1 — Secondary**

- As a **returning user**, I want the graded scan result to live in the same card entry as the ID Scan, so my collection history stays clean.
- As a **user who dismisses the Grade Scan offer**, I want the option surfaced again later (e.g., on the card detail page) without being nagged inside the same session.

**Edge cases**

- User has 0 Grade Scan credits → prompt should show credit cost + a path to buy credits, not silently fail.
- Card fails Grade Scan (blurry photo, obstructed) → offer retake, don't fall back to the PSA popup.

---

## 5. Requirements

### P0 — Must have

| # | Requirement | Acceptance criteria |
|---|---|---|
| R1 | Replace the current "Get it officially graded!" popup with a **Grade Scan promotion** as the primary post-ID-Scan CTA. | **Given** an ID Scan completes successfully, **when** the result screen renders, **then** the primary popup shows "Want to see what it could grade?" with a single primary button "Run Grade Scan" and the credit cost displayed inline. |
| R2 | Grade Scan CTA must show credit cost and current credit balance before the user commits. | **Given** the Grade Scan promo popup is visible, **when** the user views the CTA, **then** they see "X credits" and "You have Y credits" (or "Buy credits" if Y = 0). |
| R3 | Graded scan result screen keeps the **same layout as the ID Scan result** (card name, set, HP, market price, etc.) and adds the estimated grade + subgrades (centering, corners, edges, surface). | **Given** a Grade Scan completes, **when** the result renders, **then** all ID Scan fields are preserved AND estimated grade + 4 subgrades are appended in a dedicated section. |
| R4 | The graded scan and the originating ID Scan must be **linked to the same card entry** in the user's history. | **Given** a user runs ID Scan then Grade Scan on the same card, **when** they view their scan history, **then** both results appear under one card entry with a toggle or tabbed view. |
| R5 | Third-party grading (PSA/CGC/BGS/SGC) buttons are **removed from the immediate post-ID-Scan popup** and relocated. | **Given** an ID Scan completes, **when** the popup renders, **then** no PSA/CGC/BGS/SGC buttons appear in the primary popup. |

### P1 — Should have

| # | Requirement | Acceptance criteria |
|---|---|---|
| R6 | After a Grade Scan completes, **conditionally** surface a "Consider official grading" secondary prompt — only if estimated grade ≥ 9 AND estimated graded market value ≥ configurable threshold (default $50). | **Given** a Grade Scan result with grade ≥ 9 and graded value ≥ $50, **when** the result screen renders, **then** a secondary card appears below the grade result offering PSA/CGC/BGS/SGC with the reason ("Est. PSA 9 · ~$120 graded value"). Otherwise no third-party grading prompt is shown. |
| R7 | Persistent access to third-party grading options from the **card detail page** (not the immediate popup) for users who want it regardless of grade. | **Given** a user is on a card detail page, **when** they scroll or open an actions menu, **then** "Submit to PSA/CGC/BGS/SGC" is accessible. |
| R8 | Instrumentation: track ID-Scan → Grade-Scan conversion rate, popup dismissal rate, and downstream third-party click-through rate. | Analytics events fire on: popup shown, Grade Scan started, Grade Scan completed, secondary PSA prompt shown, PSA option tapped, popup dismissed. |

### P2 — Could have

| # | Requirement |
|---|---|
| R9 | "Skip this time" option that dismisses the Grade Scan promo for the current session only. |
| R10 | A/B test the promo copy (see Section 8 for variants). |
| R11 | Show a small teaser of what a Grade Scan result looks like (blurred sample) inside the promo popup for first-time users. |

### Won't have (this release)

- PSA/CGC/BGS/SGC in-app submission workflow.
- Bulk Grade Scan across multiple scanned cards.
- Grade Scan history export.

---

## 6. Success Metrics

**Leading indicators (measure daily, first 30 days)**

| Metric | Target | Method |
|---|---|---|
| Grade Scan attach rate after ID Scan | ≥ 25% | Event funnel: `id_scan_complete` → `grade_scan_start` |
| Popup dismissal rate | ≤ 40% | `promo_dismissed` / `promo_shown` |
| Grade Scan completion rate (started → finished) | ≥ 85% | `grade_scan_complete` / `grade_scan_start` |
| Credit purchase rate for users with 0 credits at popup | ≥ 10% | `credit_purchase` within 5 min of promo shown |

**Lagging indicators (measure at 60 & 90 days)**

| Metric | Target | Method |
|---|---|---|
| Avg. credits spent per session | +30% vs. baseline | Compare to 30-day pre-launch baseline |
| Third-party grading CTR (from new conditional prompt) | ≥ 8% when shown | Instrumented as R8 |
| 7-day retention of new users who complete both scans | Baseline + 5pp | Cohort analysis |
| Support tickets about "how do I grade this?" | ↓ 25% | Support tag audit |

**Baseline requirement:** Instrument current PSA popup click-through and dismissal rates for **≥ 14 days before ship** so post-launch comparisons are honest.

---

## 7. Open Questions

| # | Question | Owner | Blocking? |
|---|---|---|---|
| Q1 | What's the exact graded-value threshold that justifies the conditional PSA prompt? Default $50 is a guess. | PM + Data | Non-blocking (start at $50, tune post-launch) |
| Q2 | Do we keep affiliate/referral revenue from PSA/CGC/BGS/SGC links? If yes, the conditional-prompt design matters more for revenue accounting. | PM + Biz | Non-blocking |
| Q3 | Should Grade Scan credits be discounted (or free) when triggered directly from an ID Scan, to reduce friction? | PM + Growth | Blocking for pricing decision |
| Q4 | For the linked scan history (R4), do we let users **replace** an old Grade Scan with a rescan, or do all attempts persist? | Design | Non-blocking |
| Q5 | Grade Scan accuracy claim — do we have internal data to back "AI grade estimate" language, or should copy be more hedged ("estimated grade")? | PM + Legal | Blocking for copy sign-off |

---

## 8. Popup Copy Variants (for A/B test — R10)

All three variants replace the current "🏆 GET IT GRADED · Pidove — Get it officially graded! · Official grades unlock 2–5× higher resale value." popup.

### Variant A — Curiosity-led (recommended default)

> 🔍 **Want to see what it could grade?**
>
> Get an instant AI grade estimate for **Pidove** — centering, corners, edges, and surface analyzed in seconds.
>
> **[ Run Grade Scan · 4 credits ]**
> You have 12 credits
>
> ↓ *Small link:* Planning to submit to PSA/CGC? See options

### Variant B — Value-led

> 💰 **See its graded value first**
>
> A Grade Scan estimates what **Pidove** would be worth if graded — before you spend $25+ sending it to PSA.
>
> **[ Run Grade Scan · 4 credits ]**
> You have 12 credits
>
> ↓ *Small link:* Skip to official grading

### Variant C — Direct / minimal

> **Estimate its grade?**
>
> Instant AI analysis of centering, corners, edges, surface.
>
> **[ Run Grade Scan · 4 credits ]** &nbsp;&nbsp; [ Not now ]
>
> ↓ *Small link:* Submit to PSA/CGC/BGS/SGC

**Recommended default:** Variant A. Leads with the question the user actually has ("what would it grade?"), which is the strongest hook. Variant B tests whether framing against PSA's cost drives more conversions. Variant C tests whether shorter copy converts better on low-battery / hurried sessions.

---

## 9. Rollout Plan

1. **Week 0** — Instrument baseline (current PSA popup CTR, dismissal, downstream conversion).
2. **Week 1–2** — Build R1–R5 (P0). Internal QA on iOS + Android.
3. **Week 3** — Ship to 10% of users. Monitor Grade Scan attach rate + revenue per session daily.
4. **Week 4** — If attach rate ≥ 20% and no regression in retention, ramp to 50%.
5. **Week 5** — Full rollout. Begin A/B test of copy variants (R10).
6. **Week 6–8** — Ship P1 (R6–R8). Tune conditional-PSA threshold based on data.

---

*End of spec.*
