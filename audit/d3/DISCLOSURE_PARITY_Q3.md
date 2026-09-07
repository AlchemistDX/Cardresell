# Q3 — Cross-surface disclosure parity

**Question:** do the surfaces that make money claims disclose *equivalent facts* —
not identical text — about how those numbers were derived?

**Status: first pass. One confirmed defect, two of my own false positives
corrected, one confirmed clean. Not complete.**

---

## Method note, before any finding

My first move was a keyword-presence table: regex per disclosure concept, one
column per surface. **That is the exact defect this repo's pattern catalogue is
about** — a regex hit is evidence about a surface, not about whether a fact is
disclosed. Two cells were wrong when checked against the actual sentences:

- **`pricing.html` "±15% band" → FALSE POSITIVE.** The `15%` on that page is the
  *top-up pack discount* for the Pro tier ("Top-up pack discount — 10% 15%").
  Nothing to do with the price band.
- **`accuracy.html` "tax" → matched, but not the fact I was testing for.** The
  hits are about eBay's FVF applying to item + shipping + tax, which is a
  different disclosure from "the payout excludes buyer sales tax."

Recorded because the table looked authoritative and was wrong in the direction
of *reassurance* — it showed parity where there is none. Every finding below is
from reading the rendered sentence, not from a match count.

---

## Finding Q3-A — the grading panel runs a second fee model, and discloses it

**Severity: high. This is BIAS-1, rule 1, and disclosure parity converging on one
block of code.**

`renderGradingUpside` (`js/core.7f9c03ad.js:11425+`) declares its own constants:

```js
const GRADING_FEE = 25;   // PSA value tier ~$25 all-in     (:11435)
const FEES_PCT    = 13;   // eBay + shipping typical        (:11436)
```

and captions its output (`:11552`):

> `net after $25 fee + 13% sale fees`

with the headline (`:11539`):

> `📈 Best case: <tier> → $<n> net upside vs raw sell`

The function **never calls `feeEbay`** — confirmed by extracting the function
body and searching it (`feeEbay: --`). So:

1. **Rule 1 violation.** One business behaviour — "what does eBay take" — has
   two implementations: the audited `PLATFORMS.ebay` model with
   `feeAuditedOn: '2026-09-01'` (`:5873`), and `FEES_PCT = 13`. A second fee
   model is on the do-not-do list. This is instance **9** of rule 1 being bitten.
2. **Disclosure parity failure, and the bad kind.** The panel is not silent about
   its basis — silence would be safer. It states a *specific, checkable* basis
   that **disagrees with the model every other surface uses**. A reader who
   compares the grading panel's "13% sale fees" against the fee table on
   `accuracy.html` finds two different numbers for the same venue, with no
   disclosure that they differ. Per the standing rule — cross-source
   disagreement is disclosed, never averaged away — this is worse than an
   omission, because it reads as precision.
3. **Both simplifications lean the same way.** This is the BIAS-1 mechanism with
   figures attached:
   - `GRADING_FEE = 25` is flat. The server tiers PSA by declared value
     (`api/grade-opportunity.js:44-52`): `<$200 → 25`, `<$500 → 50`,
     `else → 100`. So for any card at or above $200 the panel understates
     grading cost by **$25–$75**.
   - `FEES_PCT = 13` against an eBay FVF that applies to the **whole order**
     (item + shipping + tax) plus a per-order charge — the correction
     `accuracy.html` already makes in its own words.
   - Understating cost inflates upside. **Both errors push the number up**, on
     the panel whose entire purpose is to argue for paying to grade.

**Not fixed here.** The fix is BIAS-1 as already scoped — route through
`feeEbay`, and take the per-column grader question (BIAS-3 / -7 / -8) with it,
since the caption's `$25` is a PSA value-tier figure being applied to a column
subtitled `BGS/CGC`. Ordering stands: after D3.

**What is new** is that BIAS-1 is not only a directional-bias defect. It is a
rule-1 duplicate and a false-precision disclosure, so it cannot be closed by
adjusting a constant — only by deleting the second model.

---

## Finding Q3-B — `accuracy.html` never mentions the derived band

`accuracy.html` has a **Live pricing** section and a **Known limits** section,
and the app discloses the derived band in-flow, twice, well:

> "Estimated band. Comp is the displayed source value; Sell Now and Patient are
> calculated as 15% either side of it — **not observed sales.**"
> (`js/core.7f9c03ad.js:4290-4297`; slab variant at `:4259-4262`)

That copy is **correct and well-built**: the percentage is interpolated from
`_QP_DERIVED_SPREAD` (`:3859`, `= 0.15`) rather than typed into the string, so it
cannot stamp a stale number if the spread changes.

But `accuracy.html` — the page whose job is to document how prices are derived —
contains **zero** occurrences of `15%`, `patient`, `sell now`, `fallback`, or
`estimated band`. A user reading the methodology page cannot learn that a rung
exists where two of the three headline numbers are **arithmetic on the comp
rather than observed sales**.

**Equivalent-facts test: fails.** The in-app surface discloses a derivation the
methodology page does not record. This is a genuine parity gap, not a wording
difference.

**Proposed remedy — copy NOT yet written, wants your call, because this is
`accuracy.html`.** Two parts:

1. A short paragraph under **Live pricing** stating that when no listing spread
   is available, Sell Now and Patient are computed as a fixed percentage either
   side of the comp and are not observed sales.
2. **A parity guard, mandatory if the copy lands.** `accuracy.html` is static and
   may not gain a build step or a runtime fetch, so the percentage would be a
   literal in the page — exactly the "stamp" the standing rule warns about. The
   established answer is the Q2 pattern: extend `tests/accuracy-fee-parity.mjs`
   to assert the page's stated spread equals `_QP_DERIVED_SPREAD`, so the number
   is guarded rather than trusted. Without the guard, do not add the copy.

Deliberately not written yet: it is user-facing copy on the accuracy page, and
the rule is that the model changes first and the stamp second.

---

## Confirmed clean — the two fee surfaces

`accuracy.html`'s fee table and the review screen's fee breakdown are backed by
the same model and now hold a **bidirectional venue + date parity guard**:
`tests/accuracy-fee-parity.mjs`, **15/0**, all 15 venues agreeing at
`2026-09-01`. Separate markup for the two surfaces is an accepted decision; the
parity test is what closes the drift risk. Note the two surfaces are backed by
*two* tables — `PLATFORMS` (fee table) and `CROSS_BORDER` (cross-border table),
where one row groups four buylist venues, so **12 rows carry 15 venues**. Row
count is not venue count.

---

## Not yet walked

- The payout bar chart and `msProfitPreview` (BIAS-6 territory) — not inspected
  for disclosure basis.
- Aggregator service-fee rows.
- Whether the "estimate, not a guarantee" language on `pricing.html` and
  `about.html` is equivalent to the in-app disclosures or weaker.
- `_renderGradeOpportunity` (`:11400`-ish, separate from `renderGradingUpside`)
  uses estimate language but also never calls `feeEbay` — flagged, not analysed.

## Sources

- [eBay selling fees](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822)
- Server grading tiers: `api/grade-opportunity.js:44-52`
