# CardResell — Phase 1 To-Do

Live list of what is next. Keeps two tracks: the Block D path we are already on (top), and small survivors from the audits worth doing on the side (bottom). One place, not two.

Last update: 2026-09-06 after filing the D2.1 contract and the `94dc777` decision. Prior: the D2.1 + orientation question packets (`audit/d21/D21_AND_ORIENTATION_ANSWERS.md`). Prior update: reviewer-62 audit (`audit/reviewer62/REVIEWER_62_VERDICT.md`, commit `047d83e`).

---

## Track 1 — Block D (main path, resume here)

Status per `audit/CARDRESELL_PLAN_AND_ROADMAP.md` §6.2.

| Block | State | Next action |
|---|---|---|
| A–C | Implemented | — |
| D1 (Sell entry point) | Implemented | — |
| D2.0 (readiness consolidation) | Implemented | Do not add a second sufficiency formula. |
| **D2.1 (draft-list UI)** | **Next — resume here** | Resolve the summary/findings gap first (§6.3 of the roadmap doc), then build the All-drafts screen with stubs, paging, degraded/unavailable states, and 44×44 targets. Navigate by returned ID. |
| D3 (review screen) | Later in D | Render every missing field by server reason; fee breakdown reconciles to the cent. |
| D4 (number provenance) | Later in D | Provider, source URL, absolute retrieval time, fee revision, seller/manual attribution visible. |
| D5 (copy-ready handoff) | Later in D | One-tap field copying and eBay continuation; no publish control. |
| D6 (new-seller warning) | Later in D | Show before handoff when applicable; do not invent eligibility. |
| D7 (local photos) | Later in D | Ordered local photo state, validation, removal, cross-device limitation copy; no server upload. |

### D2.1 entry gate — CLOSED 2026-09-06

Pointer only. Full record: `audit/DECISION_SOURCE_DISAGREEMENT.md`.

The disclosure returns to the **card detail view**, in its own unit, and is **not in D2.1's
scope** — a drafts row shows a chosen price with provenance, not a live cross-source comparison,
so there is no comparison there to disagree about. Roadmap §3.4, §5.4, and the §12 checklist
item are corrected.

Two things were wrong in the way this gate was previously stated here, both worth knowing:
detection is **not** "still computed" — nothing calls `_sourceDisagreement`; and it is **not**
"tested" — the sole assertion was a regex over bundle text that would pass if the body were
`return null` (`tests/launch-audit-regressions.mjs:1664`, label now corrected).

### D2.1 blocker — RESOLVED 2026-09-06

The gap was real: `api/_draftService.js:493-512` summary rows carry identity, status, revision, title, price, quantity, timestamps, and `hasPacket`, but **not** `publishable` findings, so "Needs price" cannot be honestly derived from the list response alone.

**Decision: extend the summary with a small server-derived display state.** Evidence, from `audit/d21/D21_AND_ORIENTATION_ANSWERS.md` Section A:

- `validateDraftForSlot(draft, slot)` (`api/_draftStore.js:244`) is a **pure synchronous function over the already-read record** — no price-provider call, no network fetch, no third-party API, no env secret. Deriving state per row adds **one function call: zero extra KV reads, zero extra parses, zero new awaits, zero new failure modes.**
- It is **test-safe.** Every registered assertion touching summary shape is a *subset* check — no `Object.keys` equality, no deep-equal, no snapshot anywhere in `tests/`. Adding a field breaks nothing.
- The rejected alternatives: a per-draft client read costs **+25 HTTP requests, +25 KV reads and 25 full draft records on the wire** for a 25-row page, which is exactly the payload `summarize()` was written to avoid (`api/_draftService.js:508-513`). Shipping full findings couples the list wire format to the finding schema.

Still no client-side inference. The display state is server-derived or it does not exist.

### D2.1 spec — FILED

The contract is at **`audit/DRAFT_LIST_API_CONTRACT.md`** (commit `a6a15e7`, Amendment 1 merged
in `cbb5552`). It is written against the real field names and both open decisions are closed:
rows are not tappable in D2.1, and blocker copy is owned by the server, shipped as
`{ code, message }`. Filing it there closed the dangling reference at
`js/core.d9e1b484.js:18394`.

Nothing in the spec awaits a decision. The remaining D2.1 work is writing the code.

**Entry gate — closed 2026-09-06.** Decided: card detail view, own unit, not D2.1's scope.
Roadmap §3.4, §5.4, and the §12 checklist item corrected; the misleading test label corrected.
Record at `audit/DECISION_SOURCE_DISAGREEMENT.md`. **Nothing now stands between here and
writing the screen.**

---

## Track 2 — Audit survivors (side path)

All eight are small, all reduce a live truth or money defect, none is a rebuild. Pick any of these in a natural gap during D2.1 work — do not let them delay D2.1 itself.

Ordered by cost of leaving them broken, not by ease.

### T2.1 — Rename `📬 Price Drop Alerts`

- **Where:** `index.html:1646`.
- **Why:** the label promises a feature that does not exist. Rule 3 violation (do not stamp a lie).
- **Fix:** rename to what it actually is — a newsletter signup for launches/updates. One line.
- **Watch:** do not name it "Coming soon" if it is not on the roadmap.

### T2.2 — Reconcile pricing copy across index and pricing pages

- **Where:** `index.html:2941/2981/3004` say "save about 25%"; `pricing.html:210/233/413` say "3 months free". Different offers.
- **Why:** `pricing.html:256-259` already documents a prior incident where the site advertised unbuyable packs. This failure mode has bitten once. Rule 1 violation.
- **Fix:** decide which offer is real, use that string in both files, then extract the tier price/period strings to a single source of truth so a next edit cannot drift again.
- **Watch:** the retired Ultimate tier is on the do-not-touch list — do not revive it while consolidating.

### T2.3 — Refund the credit on `looksSlabbed`

- **Where:** `api/scan.js:2004-2008` detects a slab after the debit at `:785`. The comment openly says "we STILL return the grade (user paid for it)" (`:2002`). `refundCredits()` at `:956` is never called on that path.
- **Why:** user pays for a result the server itself labels non-actionable. Money defect. This is reviewer item 12, sharpened.
- **Fix:** call the existing `refundCredits()` in the slab branch, keep the honesty caps that follow. A few lines. One toast line client-side ("Slab detected — grade returned as reference, credit refunded.").
- **Watch:** do not add a second refund helper. Reuse `refundCredits()` per rule 1.

### T2.4 — Rate-limit the paid open proxies

- **Where:** `api/tpl-proxy.js:11-19` (unauthenticated open proxy in front of the paid TPL key, wildcard CORS), `api/pricecharting.js:439-444` (same shape).
- **Why:** anyone can bill our paid API quota from a browser console. The scan endpoints are actually the well-defended ones — this is the exposure.
- **Fix:** build **one** shared KV-counter rate-limit helper (pattern already in `api/scan-refund.js:91-101`). Apply it to both endpoints. Per-IP + per-hour cap.
- **Watch:** rule 1 — do not inline a second limiter in each endpoint. One helper, two call sites.

### T2.5 — Stop printing a fabricated ±15% band as observed

- **Where:** `api/tcg-price.js:290-295` synthesizes `low = market × 0.85` / `high = market × 1.15` on the fallback rung; `js/core.d9e1b484.js:1859-1870` renders it as a real range.
- **Why:** fires precisely when the primary feed is down — the moment the number deserves the least confidence gets a made-up spread. Rule 2 violation.
- **Fix:** two options — (a) drop `low`/`high` on the fallback rung entirely; (b) render them but label as "estimated range" and change the caption to reflect the source. Prefer (a) unless we have a downstream consumer that needs them.
- **Watch:** the existing fallback caption at `js/core.d9e1b484.js:2513-2543` correctly names the rung. Do not weaken that.

### T2.6 — Fix bulk `needsPicker` rendering as a confident ✓

- **Where:** `js/ui.6b3a528e.js:3188-3204` branches on `if (data.card_name)`. A response the server flagged for disambiguation renders as resolved with no picker.
- **Why:** correctness. A wrong ID silently priced is the exact failure this project is most exposed to. Single-scan handles it correctly.
- **Fix:** branch on the server's `needsPicker` flag before `card_name`. In bulk, a `needsPicker` row should render as "Pick correct match" with a picker action, not as ✓.
- **Watch:** verify the bulk refund path still works if the user cancels the picker — the credit was debited pre-scan and the picker confirms via `api/scan-debit-id.js`.

### T2.7 — Grading panel uses a flat $25 fee against our own tiers

- **Where:** `js/core.d9e1b484.js:10926` (`GRADING_FEE = 25`), applied `:10975`,
  printed to the seller `:11043`. Tier table: `api/grade-opportunity.js:44-52`.
- **Why:** our own server model says PSA is $50 over $200 raw and $100 over
  $500. **"Always toward grade it" is withdrawn — corrected 2026-09-07.** The
  flat $25 *overstates* CGC and SGC cost by $7 at every price, and on the
  panel's own incremental metric that is enough to flip the displayed upside
  pessimistic. Direction varies by grader; see the 2026-09-07 section of
  `audit/DIRECTIONAL_BIAS_AUDIT.md`. It is still a rule-2 inconsistency and
  still the **dominant** error term, an order of magnitude larger than the fee
  simplification.
- **Fix — this item now names all four things, not just the tier table:**
  1. **One fee implementation.** Route the panel through `feeEbay`; delete the
     second model. Rule 1.
  2. **One grader-cost policy owner.** Reuse `getGradingCost` rather than a
     local constant. Note what this does *not* buy: reuse removes duplication,
     it does **not** establish that the reused charges or thresholds match any
     grading service's published prices.
  3. **The comparison baseline.** The metric is graded **net** versus raw
     **net** under one consistent set of seller assumptions. Not graded net vs
     raw gross.
  4. **The cost inputs.** Shipping charged, seller postage, tax treatment and
     grader must be stated inputs. Shared fee arithmetic cannot supply a
     missing input, and reusing a function does not validate its data.
- **Watch:** `getGradingCost` thresholds are keyed on **raw price**. PSA's own
  service ladder is keyed on **maximum insured value** — a different rule with
  a different base. Verified structurally 2026-09-07: the PSA service page does
  publish a max-insured-value ladder ($500/$500/$500/$1,000/$1,500/$2,500/
  $5,000/$10,000). Do not treat a raw-price threshold as a declared-value cap.
- **Watch:** a grader default is an owner call, and per BIAS-7/8 the columns
  subtitled "Any grader" cannot carry a grader-specific cost at all — withhold
  the number there rather than pick a default for it.

**Citations verified 2026-09-06 at tip `95435b4`:**  `:10926` is `const GRADING_FEE = 25;   // PSA value tier ~$25 all-in`; `:10927` is `const FEES_PCT    = 13;   // eBay + shipping typical`; `:10975` is `g.upsideNet = gradedNet - rawNet - GRADING_FEE;`; `:11043` prints `net after $${GRADING_FEE} fee + ${FEES_PCT}% sale fees` to the seller. Server tiers at `api/grade-opportunity.js:48-51` are PSA `<200 → 25`, `<500 → 50`, else `100`, with `BGS 50`, `CGC 18`, `SGC 18`. The $25–75 overstatement and the one-directional bias are both confirmed.

### T2.8 — Shipped copy says "beta"

- **Where:** `api/verify-send.js:155` — `message: 'Email delivery is restricted during beta. Use the Firebase verification link instead — check your inbox after tapping Continue.'`
- **Why:** the product never says "beta." This string is returned in a `200` body on the email-verification fallback path and is rendered to the user, so it is live user-facing copy, not an internal comment. Verified as the **only** user-facing "beta" in shipped code — a repo-wide search across all `.js` and `.html` returns exactly this one hit.
- **Fix:** reword to the maintenance convention. Something like "Email delivery is temporarily unavailable. Use the Firebase verification link instead — check your inbox after tapping Continue." Use 🛠️ if a status affordance is wanted; never "beta."
- **Watch:** this is a server file, so it needs no bundle rename. Do not restate the cause — the 403 branch is specifically an unverified-sending-domain condition (`:151`), which is a configuration state, not a product stage.

---

## Also open (not audit survivors, from prior notes)

- **PUSH GATE — do not push before the Cert ID is rotated.** `94dc777` is unreachable from `origin/main`, so the credential fragments exist only in unpushed history. The push is the publishing event. This is additive to the deploy-authorization rule below, not a replacement: rotation removes one blocker, it does not authorize a push. Recorded at `audit/DECISION_94dc777.md`.
- **eBay Cert ID rotation** — sha256[:12] `e3f0a0bc343d` was printed in plaintext in an earlier session. Rotation is mandatory and now gates the first push. Sequence, environment dependencies, and the 18/19-vs-19/19 distinction are in `audit/DECISION_94dc777.md`. Once rotated and verified, delete `refs/recovery/pre-scrub-c2366b2`. Do not use the unblock URL.
- **Commit `94dc777` — DECIDED, option A, keep the history** (2026-09-06). The message contains no full credential and no credential-shaped fragment; rewriting the branch (36 commits when the decision was taken, more since) would invalidate every stamp in the audit corpus to redact a fragment of a credential being retired anyway. Conditional on rotation actually happening. Full record at `audit/DECISION_94dc777.md`.
- **41 outgoing commits, nothing pushed.** `origin/main` = `9aaf326`. Verify with
  `git rev-list --count origin/main..HEAD`; a count is not pinned to a hash here because the
  edit that records it is itself one of the commits it counts. The parent of this edit was
  `f2ad902` at 40 outgoing.

  Since `cbb5552` (where this line last read 36): the `94dc777` decision record, the
  `readiness` server change, the test rename, Amendment 2 with the `focus` parameter, and the
  source-disagreement decision. **Two of those touched code** — `readinessOf` in
  `api/_draftService.js`, and `focus` across `api/_draftStore.js`, `api/_draftService.js`,
  `api/drafts.js`. Line numbers cited in the audit corpus for those three files may have
  shifted; every other file's citations remain valid. No deployment until you authorize it.

---

## Rules that keep biting

Listed once so a new reviewer or contributor cannot skip them:

1. One business behavior = one implementation.
2. Never display an invented number.
3. Do not stamp a lie.
4. `main` auto-deploys — every push needs its own fresh `confirm_action`.
5. **No collection of *marketplace* passwords** (`audit/CARDRESELL_PLAN_AND_ROADMAP.md:69`). Not breached. See the correction below.

### Correction — the "password breach" was a misreading, not a defect

An earlier note on this list claimed shipped code had already breached rule 5. **That was wrong, and the note was mine.** Checked against the code at tip `95435b4`:

- The binding rule at `audit/CARDRESELL_PLAN_AND_ROADMAP.md:69` reads **"No collection of marketplace passwords."** It sits in §1.3 directly alongside "No headless-browser listing automation," "No reading seller dashboards through DOM automation," and "No circumvention of a closed partner API" (`:70-72`). It is an anti-automation guardrail about **eBay / TCGplayer credentials**, not a rule against having our own account passwords.
- What ships is Firebase email+password auth for the user's **own CardResell account**: `signin.html:300` (sign-in), `:331`/`:337` (sign-up + confirm), `:360` (reset), wired to Firebase at `:382`, `:440-441`. That is a different thing from a marketplace credential.
- **No marketplace credential is collected anywhere.** A repo-wide search for eBay/TCGplayer password or login fields across all `.js` and `.html` returns nothing.
- **No server route ever receives a password.** `grep -rn "password" api/` returns exactly one hit, a comment at `api/verify-send.js:150`. Credentials go client-side to Firebase Auth; CardResell never stores or transports them.

**Conclusion: rule 5 is intact and nothing needs to be filed.** No numbered item, no owner decision. The parenthetical footnote was a misreading of "marketplace" as "any," and it propagated for several sessions unchallenged — worth noting as a reminder that an unsourced aside on a rules list is exactly where a false claim hides.

Do-not-touch: Ultimate (retired), Grade gold-set, Wallpaper, homepage feature-grid blurb.

## T2.9 — venue tax-treatment audit (BIAS-10)  [DONE 2026-09-08, ahead of the 2026-09-21 deadline]

Deadline recorded HERE and not only in `audit/d3/DISCLOSURE_PARITY_Q3.md`, because
a date that lives only in an audit document is a date nobody greps.

**Outcome.** `taxOn` + `taxBasis` on all fifteen venues; one shared
`venueTaxNote(pid)`; the hardcoded line deleted. Disclosure went **1 of 15 → 9
of 15** (2 confirmed tax-inclusive, 7 unknown, suppressed on 6 confirmed zeros).
Per-venue tables, verbatim source quotes and the reasoning:
`audit/d3/TAX_TREATMENT_T2_9.md`. Restated publicly in a third table on
`accuracy.html`, which the parity suite now holds to the model bidirectionally
(34 checks, all five mutations confirmed to turn it red). Pattern instance 35.

The **Whatnot** correction is the finding worth carrying forward: its commission
excludes tax and its payment processing fee includes it, both on the same page.
A first pass read only the commission sentence and recorded a confirmed zero, so
`taxOn` is deliberately defined as "does **any** fee apply to a tax-inclusive
base", not "does the commission". That fact had been sitting in a code comment
above `feeWhatnot` since 2026-09-01 and changed nothing, because a comment is
not a field.

**Original statement of the defect, kept for the record:** `taxNote` is
hardcoded inside `feeEbay` (`js/core.7f9c03ad.js:6840`); eleven of twelve venues
consequently show a fee total with no tax disclosure, none of it a decision.
(That count was written against a twelve-venue set and was already stale at a
fifteen-venue one — the true ratio at closure was 14 of 15 undisclosed.) Full
analysis: `DISCLOSURE_PARITY_Q3.md` § Q3-E revised. Pattern instance 22.

Steps, citations first and publication last:

1. Re-read all fifteen published fee pages from **raw page text** (not a summary
   of one); record per venue whether commission applies to a tax-inclusive total.
2. `taxOn: true | false | 'unknown'` in each `PLATFORMS` entry. ~~bump
   `feeAuditedOn` in the same commit, because step 1 is a real re-audit.~~
   **CONTRADICTED THIS LIST'S OWN FOOTER and was resolved against it: NOT
   bumped.** Step 1 re-reads the pages but verifies only the *tax window* — not
   one rate, cap or tier was re-checked, and `feeAuditedOn` means "when did we
   last read the schedule". Bumping it would have stamped a re-verification that
   did not happen and reset the amber/stale clock by six weeks. All fifteen stay
   `'2026-09-01'`; the fee re-audit is still due (amber `2026-10-01`, stale
   `2026-10-16`). No `taxCheckedOn` field was added — one date, per the standing
   decision. Full reasoning: `TAX_TREATMENT_T2_9.md` § 17.
3. Derive `taxNote` from `taxOn`, delete the hardcoded line. **`'unknown'` renders
   the disclosure, never suppresses it.**
4. Extend `tests/accuracy-fee-parity.mjs`: every venue carries `taxOn`; `taxNote`
   set iff `taxOn !== false`.
5. Then, and only then, restate it on `accuracy.html`.

**Do not add a tax rate to any model** — no invented input to a fee model.
**Do not bump `feeAuditedOn` for a tax-only check.**

Ordering: this sat with the re-audit, after D3 closed, the bundle rename landed,
and BIAS-1 was implemented. The independent date existed so a slipped re-audit
could not silently carry it — and in the event it did not slip.

**Still open, and NOT closed by T2.9** (BIAS-10's other half): `feeBase` /
`feeBaseLabel` are still emitted by only 2 of 15 venues, so the *fee base* row
has the same single-venue shape the *tax* row just had. Split-basis venues
(Whatnot, TCGplayer) cannot yet express *which component* the tax-inclusive base
belongs to. `Buyer sales tax` is also the wrong noun for Cardmarket's VAT. TCG
Bulk's vendor-side fee base and Poshmark's fee base remain unconfirmed —
Poshmark's fee policy page was unreachable across five URLs and is recorded as
`unstated` rather than inferred.

### T2.10 — Observed-centre band inverts against the ask median (Q3-C residue)

`low = 0.85 × market` is derived from the **sales** book; `mid` is the median
**active ask**. They render as an ordered triple. `low > mid` whenever
`market > 1.1765 × mid`. Measured: upstream `mid 100 / market 300` publishes
`low $255.00` beside `mid $100.00`.

Undisclosed band is `1.176 × mid < market ≤ 3.0 × mid`, because
`_marketAskDivergence` (`api/tcg-price.js:672`) returns `null` at `ratio <= 3`
(`:683`) — the guard bounds the region the defect lives in, for the third time
with the constant `3.0` (pattern instance 23).

Not an arithmetic fix: a smaller multiplier moves the threshold, it does not
remove it. Three numbers from two different books have no ordering. **This is
roadmap Q7's evidence** (`audit/CARDRESELL_PLAN_AND_ROADMAP.md:847`, item 7) and
Q7 is an open reviewer question — needs a decision, not a patch.

Q3-C closed the derived-centre mechanism only. **Do not read Q3-C as "the
inversion is fixed".**

### T2.11 — _HIGH_CAP_MULT has two consumers and one constant

`_HIGH_CAP_MULT = 3.0` (`api/tcg-price.js:563`) both clamps the displayed `high`
(`:567-570`) and gates the high ask into `_trimmedMean` (`H <= D * 3`, `:719`).
Conservative for the display is the harmful direction for the blend.

Measured over 13,638 real products (`tools/threshold-distribution.mjs`):

- clamp fires on **88.2%** of the catalog — it is the normal path, not an
  outlier guard
- **22.2%** are clamped while below the 10x harm the code's own comment cites
- **6.9%** sit in the 1.53x-3.0x blend inversion band

Origin: `005b683` set it below the smallest observed offender (5.7x). No healthy
distribution was sampled. Not tunable — raising it shrinks the over-clamp and
grows the inversion band. **Needs two constants, each chosen against its own
distribution**, plus a comment at each naming its single consumer.

Pattern instance 23, root-cause section.

### T2.12 — the blend is majority-ask and was specified as "sales"

`5382861` titled the blend "avg of non-outlier sales" and recorded the motivating
feedback as averages "across non-outlier sales". Of its four inputs only `market`
is sales-derived; `low`/`mid`/`high` are the active ask book. Measured over
13,638 products, `mid` alone carries **55.1%** of all weight and the composition
is `mid+market` **46.85%** of the time.

`api/tcg-price.js:641-660` (2026-09-03) states: "Market and asks are different
quantities and one must never be relabelled as the other." The blend predates
that comment by three weeks and is named in the terms it rules out. Never
reconciled.

Also: the high ask enters only **11.81%** of the time, but the origin commit's
five worked examples admit it in **2 of 5 (40%)**, and both are its tidy-book
cases. The weighting was validated at ~3.4x the real admission rate.

**Not a request to change the arithmetic.** The question is what the headline is
called and what is disclosed about its composition. Pairs with T2.11 (two
consumers, one constant) and with `marketBasis`, which now names this branch
`'ask_blend'` on the wire.

### T2.13 — is a four-point trimmed mean the right SHAPE for a usually-three-point statistic?

Raised as: with `mid` at 55.1% of weight and the high ask excluded 88.2% of the
time, is the function really a mid/market average wearing a four-point costume?

**Measured, and the clean version of that is wrong.** Comparing the live blend
against a two-point `(mid*2 + market)/3` over 13,638 products:

| | |
|---|---|
| median gap | 2.71% |
| p75 / p90 / p95 | 13.97% / 18.45% / 20.13% |
| agree within 1% | 48.4% |
| absolute gap over $0.05 | **44.4%** of products |
| max gap | $24,091 |

So it does **not** collapse to two points. The reason is the low ask, which is
admitted **52.18%** of the time — the vestigial term is the *high* ask, not the
ask book generally. The honest description of the shape is a **mid-anchored
average that usually includes the low ask and rarely the high one**, i.e. three
points about half the time and two points the other half.

**The two trim gates are asymmetric in both admission and effect:**

| gate | admits | own effect on the headline | consistent direction |
|---|---|---|---|
| `L >= mid * 0.3` | 52.18% | median **-11.01%** | pulls DOWN in 97.3% |
| `H <= mid * 3` | 11.81% | median **+18.65%** | pulls UP in 96.7% |

Net of the asymmetry: the four-point blend sits **below** the two-point centre in
41.8% of products and above in 10.6%, mean shift **-3.99%**.

**The real question, restated.** Not "are the weights right" but: the two gates
were written as one symmetric idea ("drop firesales, drop holdouts") and they are
not symmetric in practice — one is the common path with a downward pull, the
other is rare with a larger upward pull. Nothing in the code or the origin commit
says they behave differently. Pairs with T2.11: same failure of a symmetric-
looking pair of constants having asymmetric consequences.

**Not a request to change the arithmetic.** Deciding this needs a view on whether
the low ask belongs in a headline at all, which is Q7-adjacent. Do not resolve
unilaterally.

#### T2.13 — the answer is not free either way, and the commit must say so

Whoever resolves T2.13 should know this before choosing, because one option will
look like the thing this audit has spent two weeks correcting.

Excluding the low ask **raises** the published headline by a mean ~3.99% (it pulls
down a median 11.01% where admitted, in 97.3% of cases). A higher headline raises
every net estimate downstream — the review screen's payout row, the calculator's
net, both legs of the grading panel. So the option that is arguably more honest
about what a headline price means is also the option that moves published numbers
in the **optimistic** direction, which is the exact direction
`DIRECTIONAL_BIAS_AUDIT.md` exists to correct.

**That is not a reason to choose the other way.** A shift that follows from a
justified change to what the number *means* is not the same defect as a fee that
was left out, and treating them as the same would make every correction
unmakeable in one direction. But the resemblance is real and someone will notice
it in the diff.

**So: whichever way this resolves, the commit states the direction and magnitude
of the resulting shift explicitly, and says why it is not BIAS-n.** Do not let
that reasoning live only in this file. A reviewer meeting a +4% headline shift
with no explanation will read it as the regression this audit was written to
catch, and they will be reading it correctly on the evidence available to them.

Applies symmetrically: keeping the low ask means the headline stays ~4% below a
mid/market centre permanently, and *that* needs stating too, since nothing
currently discloses that the published price is trimmed downward at all.

### T2.14 — CLOSED 2026-09-08 — the withheld floor row is indistinguishable from having no floor data

**Closed.** The reviewer supplied copy that discloses the withholding without
explaining its cause, which is what let this close ahead of T2.10 (naming *why*
the provider and the book disagree is still that item's subject and still open).

Shipped in `js/core.1eea628c.js`: when `basis.low != null && _lowExceedsAsk` the
ladder renders

```
Provider low (not used)                    —
Not used in this comparison because it exceeds Market price.
```

The value is an em dash, so no figure is printed and nothing can be read as a
price. The reference is named when it has a visible row of its own (`Market
price`) and stays generic — "the comparison reference" — when the reference is
`mid`, which has no row in this ladder and so has no label the seller can see.
When `basis.low == null` the row is **omitted entirely**, so absence still reads
as absence.

Two assertions were retired with CHANGED-FROM records in
`tests/quick-pricing.mjs`; both asserted `label(...) === null`, i.e. that the row
vanishes, which was the defect rather than the fix. Both had passed for the
entire time the hole was open because each checked one state in isolation. The
replacements assert the two states **against each other**, plus that no price is
printed, that condition (2) still fires on observed endpoints, and that the copy
names no cause (`/invert|wrong|incorrect|error|fabricat|stale|bad data/i` must
not match).

`.qp-row` gained `flex-wrap:wrap` and a `.qp-row-note` rule using `--text-muted`
rather than `--text-faint`, the latter having already been too low-contrast for
the footnote it was raised out of. Rendered at 420px: no overflow, no mid-word
break, the dashed `.qp-row + .qp-row` separator is preserved because the note
sits *inside* the row.

**Still unverified:** actual screen-reader announcement of the row and its note.
The note is visible text in document order, but element presence alone does not
establish a usable announcement, and no screen reader has been run.

Original entry follows.


Found by the D3 visual pass on `9a3c7ac`, not by any assertion. All 20
width/theme/state combinations render correctly — no overflow, no wrapping, the
dotted leader self-adjusts (497px vs 494px across the two label lengths, floor is
`min-width:1rem` and the narrowest observed was 45px), and the withheld case
leaves no orphan separator because `.qp-row + .qp-row` is sibling-scoped with no
`nth-child` anywhere.

The defect is what the correct rendering means. Compare two states:

| state | what the seller sees |
|---|---|
| low endpoint absent upstream | `Market price  $96.00  TCGPlayer market` |
| low endpoint present, above the median ask, withheld by condition (2) | `Market price  $300.00  TCGPlayer market` |

Identical layout. The seller cannot tell "we have no floor for this card" from
"we have a floor and judged it untrustworthy". **We know which case we are in and
we do not say.**

This is the same shape as instance 24: a suppression justified by a judgement the
user never sees. Condition (2) is still correct — a floor above an observed ask
is not a floor, and printing it was the worse option. But "withhold rather than
relabel" was accepted here on the strength of matching the server's behaviour,
and the server's version has the same gap (Q3-B decided the copy omits the
numeric spread, which is a different question from whether the omission is
announced at all).

**Not fixing this unilaterally.** Any disclosure copy here asserts something
about why the book is inverted, and that is T2.10's subject, which needs a Q7
decision. What is recorded is that the fix as shipped converts a visible
mislabel into an invisible omission, that this is an improvement and not a
closure, and that anyone reading `9a3c7ac` as "the Lowest-listing row is now
honest" is reading it too generously.

**Surface identified, 2026-09-08.** The open item is the **Quick Pricing ladder
floor row**, and it is a different surface from the review-screen withheld-discount
fee row, which was completed and is not reopened here.

- **Where:** the ladder row assembly in `renderQuickPricing`, live bundle
  `js/core.8e031c8f.js`, at the guard
  `if (basis.low != null && !_lowExceedsAsk) { rows.push([_lowIsObserved ? 'Lowest listing' : 'Estimated low', ...]) }`.
- **Rendered element:** the `.qp-row` carrying key `Lowest listing` inside `#qpRows`.
- **The collapse:** two distinct states both fall through the same `if` and emit
  no row — `basis.low == null` (upstream sent no floor) and
  `basis.low != null && _lowExceedsAsk` (we have a floor and the tripwire
  distrusts it). The DOM is byte-identical in both.

**Q7 did not close this, and made the two states diverge somewhere else.** The
new `_CR_NO_RANGE_NOTE` is emitted off `_crMeasuredRange`, which reads the
low/high *range*, not this ladder row. So:

| state | range line | ladder floor row |
|---|---|---|
| no floor upstream | note shown (`low-only` / `no-endpoints`) | absent |
| floor present, distrusted by `_lowExceedsAsk` | range may RENDER normally | absent |

The second row is the awkward one: after Q7 a distrusted floor can sit inside a
rendering measured range while being suppressed from the ladder beneath it. That
is not a regression Q7 introduced — the suppression predates it — but it means
"Q7 shipped a disclosure" must not be read as "T2.14 is disclosed."

Still **not fixed unilaterally**, for the reason already recorded: the copy would
assert something about why the book is inverted. What changed today is only that
the surface is named, so the fix has somewhere to land.

**Cross-reference:** recorded as instance **22c** in
`audit/PATTERN_ASSERTION_SURFACE.md`, and the withhold-rather-than-relabel rule
now carries a mandatory rider there — withholding is only complete once the
withheld state is distinguishable from the never-had-it state.

**On the commit record:** `9a3c7ac`'s message does not carry this caveat and has
not been reworded, because the hash is already cited in T2.14 and in the instance
1 addendum, and a reword changes the hash those citations point at. The caveat
instead sits in the code at the render site, which is where a reader who greps
this row actually lands, and in the title of the follow-up commit.

Detection note, generalisable: this was invisible to nine passing behavioural
assertions because every one of them checks a single state in isolation. The
defect is in the **collision between two states**, which only a side-by-side
render shows. Worth asking of any withhold-on-condition fix: does the withheld
state look different from the never-had-it state?
