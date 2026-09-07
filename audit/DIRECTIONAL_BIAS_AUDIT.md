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

`renderGradingUpside` (`js/core.7f9c03ad.js:11426`) contains **seven independent
simplifications. All seven overstate the seller's outcome. None run the other
way.** Seven independent choices landing on the same side is not a coincidence;
it is what a lean looks like.

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

| raw comp | app shows net | actual net | overstated by | as % |
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

Note #3 specifically. The comment says "eBay + shipping typical" while the code
applies a bare percentage and never subtracts shipping. **A comment asserting a
cost is included, over code that excludes it, is worse than no comment** — it
answers the reviewer's question wrongly and stops the check.

### On #5, stated to the limit of what is verified

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
- **BIAS-5** `GRADING_FEE = 25` is unsourced and uncapped. Needs a verified tier
  table, or the estimate needs to stop being a single number.
- **BIAS-6** The remaining estimate surfaces have not been walked this way yet:
  fallback pricing bands (comp ±15%), aggregator service-fee rows, the payout bar
  chart, and the `msProfitPreview` panel. **Absence of a finding there is absence
  of a check, not a clean result.**
