# Grading Work — BIAS-3 Landed, BIAS-5 Sourced and Blocked on One Decision

**Branch** `phase1-block-d` · **HEAD** `0ecb234` · **`origin/main`** `9aaf326` · **NOTHING PUSHED**
**Live bundle** `js/core.259bdb88.js`, referenced once at `index.html:3732`

BIAS-1 is closed at `754b00d`; no further review cycle requested or sought. D3 stays closed.

---

## 1. BIAS-3 — conditional language per grade column · LANDED

**The defect.** Each grade column printed a dollar figure and a percentage with nothing
marking the condition. Six columns side by side read as six outcomes the seller was going
to get, rather than one outcome per hypothetical grade.

**The fix.** The condition is named **in the column**, next to the figure:

| Column | Condition label |
|---|---|
| Raw | `SELL AS-IS` |
| 7 / 8 / 9 / 9.5 / 10 | `IF 7` … `IF 10` |
| Column with no comp | **no label** |

The condition sits in the column deliberately. A caption at the bottom of the section does
not travel with the number a thumb is resting on.

**The condition is not a probability.** No grade distribution is published, no "likely 9"
hint, no weighting. The section caption now reads *"each figure assumes that grade — we
don't estimate the odds"*, and a check fails if any probability language (`% chance`,
`likely to grade`, `odds of`) ever appears in the rendered output.

**An unpriced column gets no condition label.** A missing comp is a data gap, not a
conditional outcome, and labelling it `IF 9` would imply a number was withheld for grading
reasons rather than because PriceCharting publishes nothing there.

**Headline.** Was `Best case: Any grader → $X net upside`. That asserted a grader for a
figure the feed does not break out below the 10 — a BIAS-7/8 leak in BIAS-3's surface. Now:
`Best case if it grades 10: $X net upside vs selling raw`. A check asserts the old
`Any grader` phrasing cannot return.

Label widths measured against the 74px column (≈64px inner): widest is `SELL AS-IS` at
≈51px. No wrapping.

---

## 2. BIAS-5 — the table cannot be made authoritative

You asked me to verify the server table's service assumptions and value basis before
treating it as authoritative. It fails on both, and on its numbers. Full sourcing in
`audit/GRADING_COST_BASIS.md`; the load-bearing findings:

**Its numbers match no published schedule.**

| Table | Published | |
|---|---|---|
| PSA `$25` | Value **$32.99**; Value Bulk **$24.99** but Collectors Club-only, 20-card minimum per era ([PSA, effective 2026-02-10](https://www.psacard.com/info/submission-updates)) | unsupported for one card |
| BGS `$50` | $14.95 / $17.95 / $34.95 / $79.95 / $124.95 ([Beckett](https://beckett.com/grading)) | matches no level |
| CGC `$18` | $17 Bulk (25-card min) / $20 Economy / $55 / $100 ([CGC](http://www.cgccards.com/submit/services-fees/cgc-grading/)) | matches no level |
| SGC `$18` | SGC's page returned no readable schedule; trackers disagree ($15 vs $50, same band) | **Unverified — not asserted** |

**Its value basis is wrong, which matters more than the numbers.** The table buckets on
**raw price**. Every grader gates levels on **declared value with a ceiling** — PSA
$500/$1,000/$1,500/$2,500/$5,000/$10,000 ([PSA](https://www.psacard.com/services/tradingcardgrading)),
CGC $500/$1,000/$3,000/$10,000. A card raw at $150 projected to a $1,200 PSA 10 is bucketed
by the $150 and lands on a level whose ceiling its graded value exceeds. **The panel's own
headline number is the evidence that the cheap level does not apply.**

**Two service assumptions that make any derived cost non-firm:**
- **Beckett's two cheapest levels are not orderable** — Beckett's own page offers *Notify
  me* against Base and Standard, not an order action. $14.95 is not a price a seller can pay.
- **CGC can reprice you unilaterally** — "CGC will move the collectible to the appropriate
  higher tier and the additional charge will be the responsibility of the submitter." The
  submitter's declared value is not binding.

**Grading-only expenses, entirely unmodelled.** PSA return shipping **and** insurance is
**$19.00 per submission** for 1–8 cards at $1–$1,000 declared
([PSA postage](https://www.psacard.com/submissions/postage/)), $34.00 at $1,001–$5,000.
Inbound shipping and insurance are the submitter's. So the **single-card domestic floor is
$32.99 + $19.00 = $51.99** against an assumed **$25** — a gap **larger than the figure the
panel names**, running optimistic. Return shipping is per *submission*, so per-card cost
falls steeply with submission size: another input one scan cannot observe.

**Unverified join, declared explicitly.** PSA publishes prices on one page and ceilings on
another, and the ceilings page does not name the service levels. Mapping `$32.99 → $500`
requires joining on turnaround days; a third-party table claims $1,000 where PSA's own page
shows $500 on the 45-day row. **I am not asserting the price-to-ceiling mapping.**

### The $25 pin is gone, and demonstrably not blocking

The TEMPORARY assertion is **deleted**. Replacing it with agreement against the server table
would have established consistency with an unsupported table, so instead it asserts the
invariant that survives any decision: **the cost used in the arithmetic is the cost
disclosed to the seller.** A panel that computes with one number and prints another is
wrong at every value.

**Proof it no longer blocks the correction:** the suite was run against a simulated
`GRADING_FEE = 51.99`. **54 passed, 0 failed at both $25 and $51.99.** Every hand-derived
expectation keeps its eBay figures literal (2679.10, 87.25, 817.10 …) and reads only the
cost term from the constant, so the fee arithmetic remains an independent check while the
cost floats. The retired flat-13% fixture keeps a literal `25` with a note, because the old
panel really did subtract 25.

Also deleted: the constant was annotated `// PSA value tier ~$25 all-in`. It is neither the
value-tier price nor all-in. A new check fails if this surface ever claims "all-in" while
shipping is unmodelled — **that check is what caught the comment.**

### DECISION NEEDED — BIAS-5 cost basis

The value is left at `$25`, annotated unsupported, because choosing a replacement selects a
grader, service level, submission size and shipping assumption the app cannot observe.
Picking one silently would be *inventing an input to a cost model* — the BIAS-1 error at a
new address.

- **(a) Seller-set assumption with a disclosed default.** Grading cost becomes a profile
  field, defaulting to a sourced single-card PSA figure ($51.99), labelled as an assumption
  with its basis named. Honest, and the seller who submits 20 cards can correct it.
- **(b) Withhold the dollar upside; show the spread only.** Publish raw comp and graded comp
  and the eBay net for each, and stop subtracting a grading cost at all. Nothing unsupported
  is stated; the seller loses the single number they came for.
- **(c) Per-grader service-level model.** Implement declared-value gating against the
  published ceilings per grader. Most accurate, largest build, and still needs the
  unverified price-to-ceiling join resolved before it can be trusted.
- **(d) Keep $25, disclose it as a placeholder.** Cheapest, but the disclosure would have to
  say the figure is known to understate by roughly the figure itself.

My read: **(a)**, with **(b)** as the fallback if you'd rather state nothing than state an
assumption. (c) is the right end state but should not gate BIAS-3/7/8.

---

## 3. BIAS-7/8 — grader and price provenance · PARTIAL, NOT CLAIMED CLOSED

Landed here as a side effect of BIAS-3: the best-case headline no longer asserts
`Any grader`. The column subtitles were already corrected in an earlier pass — `Any grader`
for 7/8/9, `BGS/CGC` for 9.5, `PSA 10` for the 10, because PriceCharting only breaks out a
grader at the 10.

**Still open and not addressed this pass:**
- `syncKey` still carries `psa:7`, `psa:8`, `psa:9` for columns whose price is *any grader*.
  Per the standing decision this must **not** be read as the grader for the price — it is a
  UI selection default. The separation is by comment only; nothing enforces it.
- No test asserts that a grader-specific upside is withheld where the source cannot support
  one.
- Price provenance for each ladder column is not surfaced to the seller at all.

I'm not reporting BIAS-7/8 as closed on a headline change.

---

## 4. Q7, in full, as requested

From `audit/CARDRESELL_PLAN_AND_ROADMAP.md` §11 item 7 — the reviewer-challenge list, so it
is posed as an argument to win, not a menu:

> **7. Derived ±15% Quick Pricing band.** Is a symmetric estimate acceptable when measured
> spread is unavailable, or should the UI show only the comp?

**Context.** Quick Pricing shows a price range around a single comp. When no measured
bid/ask or sold-price spread is available, the band is *derived* by applying ±15% to the
comp. The 15% is not measured from anything — it is a fixed symmetric assumption, which
makes it the same class of object as BIAS-1's flat 13% and BIAS-5's flat $25: **an invented
input**.

**The choices as the roadmap frames them:**
- **(i) Keep the symmetric derived ±15% band.** Familiar UI, always renders a range. But the
  width is invented and the symmetry asserts that upside and downside risk are equal, which
  nothing measured supports.
- **(ii) Show only the comp when spread is unmeasured.** States only what is sourced.
  Loses the range, and a bare single price arguably reads as *more* precise than a band.
- **(iii) Third option not in the roadmap but available:** render the band only where a
  measured spread exists, and fall back to the bare comp where it does not — differing
  treatment across sources, which is what §12's "do not default unknown source freshness"
  principle would suggest.

**What blocks on it:** T2.10, Q3-F, T2.13. **Not** blocking the grading work above.

I have not resolved it and am not implying a preference is already recorded.

---

## 5. Preview configuration — noted, and not done

Understood and adopted: **the replacement production credential will not be placed into
Preview** while Preview's access boundaries are unverified. Each authorized runtime gets
updated according to its own intended environment and data access, decided per runtime
rather than by copying Production. **Rotation alone does not clear the hosting gate.**

This changes the recorded sequence: step 2 was "update the Vercel env var in both Production
and Preview". It is now Production only, with Preview treated as a separate authorization
requiring its own access-boundary determination first.

## 6. Suites

| Suite | Result |
|---|---|
| `tests/grading-upside-fees.mjs` (slot 46) | **54 passed, 0 failed** — and 54/0 at a simulated $51.99 |
| `tests/asset-fingerprints.mjs` | 15 passed, 0 failed |
| `tests/draft-review-screen.mjs` | 180 passed, 0 failed |
| `tests/quick-pricing.mjs` | 55 passed, 0 failed |
| `tests/accuracy-fee-parity.mjs` | 17 passed, 0 failed |
| `tests/review-fee-dl.mjs` | 15 passed, 0 failed |
| `tests/test-registry.mjs` | 12 passed, 0 failed |

All re-run after the final re-derivation. `tests/run-all.sh` not run. Not a
release-readiness claim.

## 7. Open

**BIAS-5** blocked on the cost-basis decision above · **BIAS-7/8** partial, listed openly ·
**BIAS-6** unwalked estimate surfaces · **BIAS-10 / T2.9** venue tax treatment by
**2026-09-21** · **T2.10 / Q3-F / T2.13** blocked on **Q7**.

**Gates all closed:** Cert ID rotation mandatory and not done · Production-only env update,
Preview pending its own determination · `EBAY_LIVE=1 node tests/ebay-live.mjs` at 19/19
required, currently 18/19 · then delete `refs/recovery/pre-scrub-c2366b2` · never the
unblock URL · credential-hygiene inventory labels and the partial commit-message disclosure
rewrite still owed before any push · history cleanup open.

~130 commits outgoing. Nothing pushed.
