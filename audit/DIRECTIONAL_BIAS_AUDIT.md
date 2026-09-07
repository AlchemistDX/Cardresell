# Directional bias audit — which way does each estimate err?

**Date:** 2026-09-07
**Prompted by:** two fee errors found within days of each other, both biased the
same way — the flat `$25` grading fee (T2.7) overstating upside on expensive
cards, and the residency misreading that would have applied a 10% discount to
sellers who cannot qualify. The question asked was not "is each estimate
correct" but **"when an estimate is wrong, which direction does it run?"**

That is a different audit from a correctness audit, and it finds different
things. An estimate can be individually defensible and still be part of a
systematic lean. What follows walks each number the seller sees.

## Verdict

**There is a systematic optimism lean, and it is concentrated in one function.**

`renderGradingUpside` (`js/core.7f9c03ad.js:11426`) contains **seven
simplifications. All seven overstate the seller's outcome. None run the other
way.**

### AMENDED 2026-09-07 — the mechanism, corrected

The original framing here was "seven independent choices landing on the same
side is not a coincidence." **That framing was wrong, and the correct one is
stronger.** They are not seven coin flips.

**Four of the seven are omissions** — the per-order fee, shipping, tax in the
base, and grader postage. In a net-of-costs calculation *an omission has only
one available direction*. Forgetting a cost always makes the number bigger.
Those four could not have leaned pessimistic had the author tried.

So the real sample is **three judgment calls plus four items that were never
free to run the other way**. This does not weaken the finding. It changes the
finding from a story about attention into a structural claim:

> **Any net-estimate surface built by simplification leans optimistic by
> construction.** Not because its author was careless or promotional, but
> because the failure mode of simplification in a net calculation is omission,
> and omission is unidirectional.

**The consequence is that the defense cannot be care.** Reviewing harder,
commenting better, or being more conservative by temperament does not fix a
one-directional failure mode; it only reduces how often it fires. The only
defense with the right shape is **BIAS-1**: every net surface routes through
`feeEbay`, so there is no second model to leave things out of. A second model
built by leaving things out has exactly one direction available to be wrong in.

Worse, it is a *second fee model*, which is explicitly on the do-not-do list.

## The second fee model

```js
const GRADING_FEE = 25;   // PSA value tier ~$25 all-in
const FEES_PCT    = 13;   // eBay + shipping typical
```

These two constants are hardcoded inside a render function. They do not consult
`feeEbay`, the venue fee table, the shipping inputs, or the tax handling. This
is rule 1 bitten again — one business behaviour (what does the seller net at a
venue) with a second implementation. **Bitten 8×.**

The two models disagree by far more than the nickel gate allows. §5.3 says fix
the function, and the gap is not a nickel:

**These figures are derived, and here is what from.** "actual net" assumes
**$5.00 shipping and 7% sales tax** — assumptions, not measurements, and the
dollar column inherits them. The direction and the beyond-the-nickel-gate
conclusion hold at any reasonable inputs, because both are driven by the
omissions rather than by the assumed magnitudes. But the original table printed
derived numbers without naming their inputs, which is the shape of the very
thing this document audits. Named now.

| raw comp | app shows net | actual net (ship $5.00, tax 7%) | overstated by | as % |
|---:|---:|---:|---:|---:|
| $20 | 17.40 | 11.06 | **+6.34** | +57.4% |
| $50 | 43.50 | 36.80 | **+6.70** | +18.2% |
| $100 | 87.00 | 79.71 | **+7.29** | +9.1% |
| $200 | 174.00 | 165.54 | **+8.46** | +5.1% |
| $400 | 348.00 | 337.18 | **+10.82** | +3.2% |
| $1,000 | 870.00 | 852.12 | **+17.88** | +2.1% |
| $2,500 | 2,175.00 | 2,139.45 | **+35.55** | +1.7% |

"actual net" applies what `feeEbay` implements — 13.25% to $7,500 on the total
*including shipping and tax*, plus the $0.40 per-order fee ([eBay selling
fees](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822))
— with $5.00 shipping and 7% tax. The error is worst proportionally on cheap
cards and worst absolutely on expensive ones. **It is beyond the nickel gate at
every price point tested.**

## The seven simplifications, each with its direction

| # | Simplification | Effect | Direction |
|---|---|---|---|
| 1 | `FEES_PCT` 13% vs eBay's 13.25% | understates fee | **optimistic** |
| 2 | no `$0.40` per-order fee | understates fee | **optimistic** |
| 3 | no shipping cost at all — despite the comment claiming "eBay + shipping" | omits a real cost | **optimistic** |
| 4 | sales tax absent from the fee base, though eBay's own worked example includes it | understates fee | **optimistic** |
| 5 | flat `$25` PSA fee, ignoring the declared-value cap | understates cost | **optimistic** |
| 6 | no ship-to-grader postage, return postage, or insurance | omits real costs | **optimistic** |
| 7 | `upsidePct = upsideNet / raw` — divides by the raw price, not by total capital invested (`raw + grading fee`) | inflates the ratio | **optimistic** |

An eighth, arguably the largest, is structural rather than arithmetic: the
model assumes **the target grade is achieved**. `upsideNet` for the PSA 10
column is the payoff *conditional on a 10*, presented next to a raw comp with no
probability attached. Grade risk is the dominant risk in the whole decision and
it is not represented at all.

**AMENDED — this was recorded as blocked. It is not blocked.** Fixing #1–#7
without it makes the number *more precisely wrong*, since a PSA 10 payoff with
no P(10) attached is not an estimate of anything a seller will experience. The
reasoning that filed it behind data was that supplying P(10) needs gem rates,
and publishing gem-rate EV is a refusal already on the record.

But the fix is not adding a probability. **It is labelling the column as
conditional** — what this pays *if it grades 10*, said in those words. That is
presentational, it is consistent with the refusal rather than blocked by it, and
it ships alongside the arithmetic fixes instead of waiting on data we have
decided not to publish. A conditional payoff labelled conditional is honest at
any level of data.

**SCOPE, checked before writing the words.** "If it grades 10" would be the
wrong label, because the panel does not render one column. It renders **six**
(`core:11452-11463`): Raw, 7, 8, 9, 9.5, 10. Each column already carries its own
grade assumption, so a single global label would replace one unstated assumption
with a *wrong stated* one on five of them. The label must be **per column** —
each column says what it pays if the card grades *that*. The Raw column is not
conditional at all and must not be labelled as if it were; it is the baseline
the other five are measured against.

Checking that also surfaced a defect the label would otherwise have papered
over. The `9.5` column's own subtitle is **`BGS/CGC`** — PriceCharting only
breaks out a grader at the 10, and the code comments say so explicitly. But
`GRADING_FEE = 25` is PSA's cheapest tier, and the server's table prices
`BGS 50` and `CGC 18`. **The 9.5 column applies a PSA fee to a grade it labels
as BGS/CGC.**

Recorded as **BIAS-7**, and it is the one item in this document that does *not*
lean optimistic in both branches: against BGS ($50) the flat $25 overstates
upside as usual, but against CGC ($18) it *understates* it. That is a genuine
counter-example to the lean — and it earns its place precisely because it is
one. It is a grader mismatch rather than an omission, which is exactly why it is
free to run either way. **It corroborates the mechanism: the omissions are
one-directional, the judgment calls are not.**

Note #3 specifically. The comment says "eBay + shipping typical" while the code
applies a bare percentage and never subtracts shipping. **A comment asserting a
cost is included, over code that excludes it, is worse than no comment** — it
answers the reviewer's question wrongly and stops the check.

### AMENDED — #5's provenance was understated, and T2.7 already had it right

The section below went to PSA's website to establish that a flat fee cannot be
right. **That was the wrong source to reach for, and it made the finding look
weaker than it is.** We do not need PSA's published prices to convict this
number, because **the app already disagrees with itself**:

```js
// api/grade-opportunity.js:44-52  — the SERVER's answer
function getGradingCost(rawPrice, grader = 'PSA') {
  if (grader === 'BGS') return 50;
  if (grader === 'CGC') return 18;
  if (grader === 'SGC') return 18;
  if (rawPrice < 200) return 25;
  if (rawPrice < 500) return 50;
  return 100;
}
```

So `GRADING_FEE = 25` is not "unsourced" as originally written here — it
**contradicts our own server's tier table**, which already grades cost by raw
price and by grader. The client hardcodes the cheapest cell of a table the
server already owns. That is a *third* duplicate implementation in this one
panel, and it makes the overstatement `$25–75` on expensive cards on our own
numbers, with no external citation required.

**T2.7 recorded all of this on 2026-09-06**, including the sentence
"One-directional bias, not just an inconsistency." The directional framing was
already on the record for this item. What this audit adds is not the observation
— it is that the item is **a class rather than an instance**, and that the class
is generated by omission rather than by judgment.

Correcting my own error in the same direction the document is about: reaching
for an external source for something already established internally made the
finding *look* newer and thinner than it was.

### On the PSA tier caps, stated to the limit of what is verified

PSA's service levels are capped by **maximum insured value**, with the cheapest
tiers capped at **$500** and higher caps at $1,000 / $1,500 / $2,500 / $5,000 /
$10,000 ([PSA pricing](https://www.psacard.com/pricing)). So a flat fee can only
be valid up to a declared value; above it, a more expensive tier is mandatory.
That confirms the *direction* of T2.7.

**The per-card prices did not extract from that page** — every price cell came
back "Not stated on the page", and `psacard.com/services/tradingcards` is
disallowed to fetching. So the *magnitude* of the overstatement above the cap is
**Unverified** and is deliberately not quantified here. Per the standing rule, a
number that cannot be sourced does not get stamped, and the `$25` currently in
the code is itself unsourced (`// PSA value tier ~$25 all-in`, with a `~`).

## What the main fee path does right

`feeEbay` is the counter-example and it is genuinely not leaning:

- 13.25% to $7,500 then 2.35%, applied to a total that **includes shipping and
  tax** — reproduced against eBay's own worked example.
- The `$0.40` per-order fee is present and correctly **excluded** from the TRS
  discount base (now pinned by five assertions, one naming the four cents).
- The TRS discount is now **withheld by default** and released only on a
  recorded per-listing confirmation — that is a pessimistic default, which is
  the correct direction for an unverified benefit.
- Cross-source disagreement is disclosed rather than averaged.

So the project's core arithmetic is honest. **The lean lives in the surfaces
that were built to be persuasive** — the grading-upside panel is a pitch
surface, and it is the one that drifted.

## The pattern worth keeping

**Ask which way an estimate errs, not just whether it errs.** A correctness
audit clears each number one at a time and cannot see a lean; every one of these
seven is individually defensible as "a rough estimate". The lean is only visible
when you line the directions up in a column.

**Corollary on rule 1 and parity, which is where this started.** A parity
assertion defends a shared mistake as energetically as a shared truth, and
consolidating to a single owner produces the same property *by design* — one
implementation is one place to be wrong with no second opinion. So the single
owner's assertions must bind to the **external source**, not to internal
consistency. `feeEbay` is trustworthy because it now names eBay's actual
clauses; `renderGradingUpside` names nothing and cites nothing, and that is
exactly why it drifted 57%.

**And a lean is more dangerous than an error.** An error is a bug and gets
fixed. A consistent lean reads as marketing rather than arithmetic, and it
attacks the one thing this project trades on. Two data points were enough to
justify the check; the check found seven more.

## Open, not fixed here

Nothing in this document has been changed in code. Recorded as findings:

- **BIAS-1** `renderGradingUpside` is a second fee model. Must consult
  `feeEbay` rather than re-deriving. Rule 1, bitten 8×.
- **BIAS-2** The `13%` comment claims shipping is included and the code excludes
  it. Fix the code, and do not fix the comment alone.
- **BIAS-3** Grade risk is unrepresented — a conditional payoff is displayed as
  an expected one.
- **BIAS-4** `upsidePct` denominator excludes invested grading fee.
- **BIAS-5** `GRADING_FEE = 25` contradicts the server's own `getGradingCost`
  tier table (`api/grade-opportunity.js:44-52`). The fix is the tier table, and
  it needs a stated grader default — an owner call. **This is the one BIAS item
  that T2.7's existing fix line actually covers.**
- **BIAS-7** The `9.5` column is labelled `BGS/CGC` but is charged PSA's flat
  `$25`. Overstates against BGS `$50`, understates against CGC `$18`. Must be
  resolved before any per-column conditional label ships, or the label states a
  grader the fee contradicts.

- **BIAS-6** Remaining estimate surfaces not yet walked for direction:
  aggregator service-fee rows, the payout bar chart, and the `msProfitPreview`
  panel. **Absence of a finding there is absence of a check, not a clean
  result.** The fourth surface, the ±15% band, is resolved — see below.

## Bookkeeping corrections to `TODO_PHASE1.md`

**T2.7's fix line understates the work by a lot.** It reads:

> **Fix:** extract the tier table to one shared place; point the live panel at
> it. Collapses the dormant duplication as a side effect.

That fix closes **BIAS-5 only**. The panel's fee model is not a side effect of
the tier table; it is the larger half. T2.7's own *Watch* line spotted it — "the
panel's flat 13% fee assumption doesn't come from the real fee calculator
either. Same fix, ride it along" — but "ride it along" is the wrong size for
routing an entire surface through `feeEbay`. **T2.7's fix line needs rewriting
to name BIAS-1 as the primary work and the tier table as the secondary.**

Also: T2.7's citations point at `js/core.d9e1b484.js`, a **retired** bundle. Live
offsets differ; re-derive through `tools/bundle-citation-map.mjs` before acting
on them.

## T2.5 — the ±15% band, option (a), condition discharged

The decision is **(a) drop `low`/`high` on the fallback rung entirely**. T2.5
made (a) conditional — *"prefer (a) unless we have a downstream consumer that
needs them"* — so the condition had to be discharged, not assumed. It was:

Consumers exist. `low`/`high` flow into the range string
(`core:1911`, `core:1990`), into `_basisMeta` (`core:2513`), into
`renderTrustLine` (`core:2266`), and into `_clampHigh` (`core:1758`). Every
render site is already null-guarded (`low != null && high != null`), so they
degrade to not rendering a range — which is precisely the intent of (a).

The one that needed real thought is `_clampHigh`, because dropping a value a
guard reads is how an early return hides a guard. It does not apply here, and
the reason is arithmetic rather than inspection: `_clampHigh` fires only when
`high > market × 3`, while the synthesized band is `market × 1.15`. **1.15 is
never greater than 3**, so the clamp is *structurally unreachable* on the
fallback rung today. Removing the synthesized band removes nothing the clamp was
doing. Option (a) is safe.

Worth noting what that means on its own: a belt-and-suspenders clamp added on
2026-08-30 cannot fire on the rung where the data is least trustworthy. It is
not wrong, but it is not protection there either.
