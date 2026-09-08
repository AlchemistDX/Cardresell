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

## CURRENT FINDING (2026-09-07, third revision — read this, not the history below)

**The panel uses duplicate fee and grading-cost calculations. Its
incremental-upside error depends on both sale scenarios, the applicable fee
bands, the grader-cost assumptions, and expenses incurred only by the grading
option.**

That is the whole claim **for incremental upside**, and for that metric it is
deliberately not a direction, because the direction is not a property of the
panel — it is a property of the inputs.

### The two metrics have different answers, and conflating them makes BIAS-1 look optional

**Corrected 2026-09-07 after review.** "Not a direction" was written about
incremental upside and must not be read as "no lean," because it is too strong
for the net figures themselves.

| | metric | does an omitted cost have a direction? |
|---|---|---|
| **Net** (a single sale's proceeds) | `price − fees − costs` | **Yes — one available direction.** An omitted cost or an understated fee can only make net look better. Every omission here is optimistic, full stop. |
| **Incremental upside** (graded vs raw) | `gradedNet − rawNet − grading cost` | **No — input-dependent.** Errors on the two legs partially cancel; the sign depends on fee bands, grader cost, and which option incurs the expense. |

So the fee model's omissions **are** unidirectional on every net figure the app
shows — including the review screen's payout row and the calculator's net — and
only become sign-ambiguous once you difference two nets against each other.

**BIAS-1 is therefore not optional.** The duplicate fee model is
rule-1 wrong on code-health grounds regardless, but on the net figures it also
has a definite direction: optimistic. The sign ambiguity established earlier in
this document applies to the grading panel's headline upside number and nowhere
else.

## Method — what is admissible as a bias finding

Promoted here on 2026-09-07 from a single entry, because it is the test that
separates a bias finding from a design disagreement, and this document has been
wrong twice for want of stating it.

**Two admissibility tests. A finding must pass both.**

**1. Name the metric.** A direction is meaningless without the quantity it runs
against. Net and incremental upside give opposite answers for the same defect
(see the table above). *This is the test the first two revisions failed* — the
withdrawn seven-item headline asserted directions from mechanisms without
naming which metric they applied to, and BIAS-1 came out wrong as a result.
That was the stated reason for the withdrawal.

**2. Compare against a truth, not against an alternative design.** A bias is a
deviation from something that is the case. "The fee schedule charges on sales
tax and the model does not" is a truth: the page says so, the gap is $3.18, and
no design choice makes it not a gap. "The blend includes the low ask and a
mid/market average would not" is **not** a truth — it is a preference between two
defensible shapes, neither of which is the correct price.

A shape disagreement can be measured, can be consistent, can even be large, and
still not be a bias. Filing one as a bias smuggles in the answer to the design
question: to call the low ask's −11% pull a bias, you must already have decided
the low ask does not belong, which is the open question itself (T2.13).

**Where a candidate fails test 2, log it as a candidate with its direction
measured and its blocking decision named.** Do not put it in the table. When the
design question resolves, it either becomes a numbered bias with the measurement
already done, or it becomes evidence that the audit was looking in too narrow a
direction. Both outcomes are worth having; neither requires guessing now.

The two tests are independent. Test 1 catches a direction with no denominator.
Test 2 catches a direction with no referent. The seven were re-derived twice for
failing the first; the low-ask candidate below is the first one held out for the
second.

Everything below the line marked **HISTORICAL** is superseded and kept only to
show how the claim moved. In particular, the original headline — "seven
simplifications, all seven overstate, none run the other way" — **is withdrawn.**
It was wrong about the count, wrong about the mechanism, and wrong about which
term matters.

---

## HISTORICAL — superseded framings, kept for the record

**Superseded opening (2026-09-07, first pass):** "There is a systematic optimism
lean, and it is concentrated in one function. `renderGradingUpside`
(`js/core.7f9c03ad.js:11426`) contains seven simplifications. All seven overstate
the seller's outcome. None run the other way."

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

**Corrected 2026-09-07 after review. The table published here was wrong twice
over.** It is retained below the correction because the errors are instructive.

The published figures were generated by `P − 0.1325×(P+5)×1.07 − 0.40 − 5`,
which does two separate things wrong:

1. It charges the fee on $5 of buyer-paid shipping **and** subtracts $5 of seller
   postage, but never adds the buyer's $5 to revenue. Shipping was counted as a
   cost twice and as income never, so every "actual net" was **exactly $5 low**.
2. It multiplied the fee base by `1.07` for sales tax while the surrounding prose
   claimed the column "applies what `feeEbay` implements." **`feeEbay` has no tax
   parameter** — `feeEbay(price, shipCharge, ebayStore, ebayPromo, trsEligible)`,
   `total = price + shipCharge`. Tax in the fee base is a real eBay behaviour and
   a real gap in `feeEbay`, filed as **BIAS-9** below; it is not something
   `feeEbay` does, so the column described a model that does not exist here.

**Modeled proceeds under stated assumptions** — `feeEbay`-faithful, no store, not
Top Rated, no tax term, 13.25% on price + shipping charged, plus the per-order
fee. Two shipping arrangements shown separately, because the arrangement changes
the answer by more than the whole fee simplification does:

| raw comp | panel shows | A: buyer pays $5 ship, seller postage $5 | B: free shipping, seller postage $5 | over (A) | over (B) |
|---:|---:|---:|---:|---:|---:|
| $20 | 17.40 | 16.29 | 11.95 | +1.11 | +5.45 |
| $50 | 43.50 | 42.31 | 37.98 | +1.19 | +5.52 |
| $100 | 87.00 | 85.69 | 81.35 | +1.31 | +5.65 |
| $200 | 174.00 | 172.44 | 168.10 | +1.56 | +5.90 |
| $400 | 348.00 | 345.94 | 341.60 | +2.06 | +6.40 |
| $1,000 | 870.00 | 866.44 | 862.10 | +3.56 | +7.90 |
| $2,500 | 2,175.00 | 2,167.69 | 2,163.35 | +7.31 | +11.65 |

These are **modeled proceeds under the stated assumptions, not an observed
payout.** Shipping charged, seller postage cost, and the absence of a tax term
are named inputs, and the arrangement is a seller choice the panel never asks
about.

**The beyond-the-nickel-gate conclusion survives** — the smallest overstatement
in the corrected table is $1.11, which is 22× the gate. What did not survive is
every number I published, and the sentence asserting the conclusion "holds at any
reasonable inputs" was true while sitting directly above figures that were
wrong. Being right about the direction is not a licence to publish unchecked
magnitudes.

*Superseded, kept for the record — the original table, $5 low at every row and
carrying a tax term `feeEbay` does not implement: $20→11.06, $50→36.80,
$100→79.71, $200→165.54, $400→337.18, $1,000→852.12, $2,500→2,139.45.*

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

### 2026-09-07 — the directions, re-derived twice, and the metric named

First pass asserted directions from mechanisms and got BIAS-1 wrong. Second pass
split the seven into "four sign-fixed by construction, three
parameter-dependent." **Review then established that the second pass was also
wrong, because it never named which metric the direction applies to.** This is
the third pass and it names the metric first.

#### The widget's metric is a difference, and that changes everything

`core:11478-11486`:

```js
const rawNet = raw > 0 ? raw * (1 - FEES_PCT/100) : 0;
const gradedNet = g.price * (1 - FEES_PCT/100);
g.upsideNet = gradedNet - rawNet - GRADING_FEE;
```

The panel displays **incremental upside** — graded net minus raw net minus
grading cost — not a single sale's net. Both legs are computed with the *same*
`FEES_PCT`, and **neither leg models shipping, tax, or the per-order fee.** So an
omitted cost that lands identically on both legs **cancels exactly in the
difference.**

Verified numerically rather than argued. Holding raw $50 → PSA-10 $500 fixed and
varying the shipping arrangement:

| shipping charged / seller postage cost | modeled incremental upside |
|---|---:|
| $0 / $0 | 365.3750 |
| $5 / $5 | 365.3750 |
| $12 / $12 | 365.3750 |
| $5 / $9 (asymmetric) | 365.3750 |

Unchanged to four decimals, including the asymmetric case, because
`fee_g − fee_r = rate × ((graded + c) − (raw + c)) = rate × (graded − raw)` — the
shipping charge cancels out of the *difference* identically, whatever it is.

#### What that does to "four sign-fixed by construction"

**It refutes it, but my first replacement axis was also wrong.** Corrected again
after review.

Rows 2 and 3 — the per-order fee and the cost of shipping the sold card — fall on
**both** options. Whether you sell the card raw or sell it graded, you ship one
card and pay one per-order fee. Those cancel in the difference and contribute
**zero**.

**Row 6 does not cancel, and I was wrong to group it with them.** Ship-to-grader
postage, return postage and insurance are incurred **only by the grading
option**. Selling the existing raw card avoids them entirely. So row 6 belongs
with the grading-cost term, and on the incremental metric it is
**unconditionally optimistic** — a cost that lands on one leg only and is omitted
can only overstate the difference.

Measured, raw $50 → PSA-10 $500, internal $25 grading cost:

| additional grading postage | modeled incremental upside | panel | overstated by |
|---:|---:|---:|---:|
| $0 | 365.375 | 366.50 | +1.125 |
| $10 | 355.375 | 366.50 | +11.125 |
| $20 | 345.375 | 366.50 | **+21.125** |
| $35 | 330.375 | 366.50 | +36.125 |

At $20 of grading postage the panel's overstatement is **$21.125, not $1.125** —
the grading-only expense is an order of magnitude larger than the fee-rate term
it was mistakenly cancelled against.

**The correct axis is which option incurs the expense, not whether it is flat or
proportional.** Costs common to both options cancel; costs specific to one do
not. Flat-versus-proportional was a coincidence of the examples I picked.

Row 4 (tax absent from the fee base) also survives, on the separate ground that
it scales with the sale amount and the graded leg is the larger sale.

**And my "asymmetric" test was not asymmetric.** I applied shipping charged $5 /
cost $9 to *both* legs, so `(charge − cost)` was −$4 on each and cancelled — it
tested nothing. A genuine test varies the cost *between options*:

| raw postage / graded postage | modeled incremental upside |
|---|---:|
| $5 / $5 | 365.3750 |
| $5 / $9 | 361.3750 |

which differs by exactly the $4 postage delta, as it must.

#### The decomposition — sign corrected, exclusions stated

**Published with the grading term's sign reversed.** I wrote
`(25 − actual grading cost)`, which gives +7 for CGC while the table beside it
correctly showed −7. The table was right and the formula was wrong:

```
panel − model = (graded − raw) × (0.1325 − 0.13)  +  (modeled grading cost − 25)
```

CGC `18 − 25 = −7` · PSA at $200–499 raw `50 − 25 = +25` · PSA at $500+ raw
`100 − 25 = +75`. All three now agree with the table.

Also corrected: **"modeled" grading cost, not "actual."** `getGradingCost` is
this repository's own cost assumption. Nothing here establishes it matches any
grading service's published charges.

**This two-term form holds only under stated exclusions**, and it is not general:

- both sales inside the **same linear fee band** (no tier crossing),
- **equal per-order fees** on both legs,
- **no tax** in the fee base,
- **no unequal selling shipping**, and
- **no expenses incurred only by the grading option** (row 6).

Break any one and the two-term form is wrong.

| raw → graded | grader | panel | model | gap (unrounded) | rate term | grading term |
|---|---|---:|---:|---:|---:|---:|
| 20 → 60 | PSA | 9.80 | 9.70 | **+0.100** | +0.10 | 0 |
| 20 → 60 | CGC | 9.80 | 16.70 | **−6.900** | +0.10 | −7 |
| 50 → 500 | PSA | 366.50 | 365.375 | **+1.125** | +1.125 | 0 |
| 50 → 500 | CGC | 366.50 | 372.375 | **−5.875** | +1.125 | −7 |
| 200 → 2,000 | PSA | 1,541.00 | 1,511.50 | **+29.500** | +4.50 | +25 |
| 500 → 3,000 | PSA | 2,150.00 | 2,068.75 | **+81.250** | +6.25 | +75 |

**Unrounded, deliberately.** The previous version printed the $50 → $500 gap as
`+1.12`, which is what you get by subtracting the *displayed* 365.38 from 366.50.
The actual difference is **$1.125**. A difference between rounded columns is not
the rounded difference, and this document should not model the error it audits.

#### The fee term can flip the sign on its own — "only grading cost" is false

I claimed the grading term was the only one capable of reversing direction.
**Counterexample, with the grading cost held identical in both models so its
error is exactly zero:**

| | |
|---|---:|
| raw sale | $5,000 |
| graded sale | $10,000 |
| panel upside | $4,325.00 |
| canonical-model upside | $4,585.00 |
| **panel − model** | **−$260.00** |

The entire $260 comes from the fee calculation, because the graded leg crosses
the $7,500 boundary into the 2.35% band while the raw leg does not. Verified two
ways — the model difference and the closed form below both give exactly −260.00.

**The general fee contribution**, replacing the band-limited rate-delta term:

```
[canonical fee on graded sale − canonical fee on raw sale] − 13% × (graded − raw)
```

This also kills a claim I made one paragraph earlier: that an equal shipping
charge "cancels identically, whatever it is." It cancels **within a band**. Across
a boundary it does not — upside for $5,000 → $10,000 moves from 4,585.00 to
4,585.545 to 4,590.45 as the shipping charge goes $0 → $5 → $50.

#### Acceptance cases for the BIAS-1 / BIAS-5 fix (frozen here, to be encoded as tests)

The fix is not accepted on "routes through `feeEbay`." It is accepted on these
cases, which are the ones that broke the analysis above. Each must be a
registered assertion naming the behaviour and evidencing the rendered surface.

| # | case | why it exists |
|---|---|---|
| 1 | raw $50 → PSA-10 $500, no store, not TRS | baseline; rate term only |
| 2 | same, grader CGC | grading term **inverts** the sign |
| 3 | raw $500 → PSA $3,000 | grading term at its $75 maximum |
| 4 | **raw $5,000 → graded $10,000, grading cost equal** | **cross-tier: fee term alone flips the sign, −$260** |
| 5 | **raw postage $5 vs graded postage $9** | unequal cost between options must not cancel |
| 6 | **grading postage $20 added** | grading-only expense; overstatement $1.125 → $21.125 |
| 7 | Basic Store, and TRS, at $25 / $200 / $1,000 | profile crossovers at $61.54 / $37.21 / $21.22 |
| 8 | item total $8,000, default profile | single-sale crossover above $7,679.8122 |
| 9 | negative upside (graded comp below raw + costs) | ratio sign inversion, `core:11504` branch |
| 10 | unresolved grader column (`sub: 'Any grader'`) | number withheld, not defaulted — BIAS-7/8 |

Cases 4, 5 and 6 are the ones a "route it through the shared function" fix passes
while still being wrong, because none of them is a fee-rate problem.

#### What survives about dominance

**Narrowed.** "Grading cost dominates the fee term" is supported **within the
example range I selected** — raw comps of $20–$500 against graded comps below the
tier boundary, which is the common case for the cards this app indexes. It is
**not general**: the cross-tier counterexample above has a $260 fee-driven error
and zero grading error.

Both must be fixed, and neither fix substitutes for the other.

#### Row 1's default-profile claim, corrected again

I wrote that under the default profile the flat rate understates "at every price"
and "never crosses over." **Wrong, and self-inflicted:** I quoted the
`tierBoundary = 7500` line in the same paragraph. Above $7,500 the marginal rate
drops to 2.35%, so flat 13% eventually overstates.

By bisection on the forward function — never re-derived algebra:

| total | panel 13% | `feeEbay` model | panel − model |
|---:|---:|---:|---:|
| $7,500 | 975.00 | 994.15 | −19.15 |
| $7,679 | 998.27 | 998.36 | −0.09 |
| $7,680 | 998.40 | 998.38 | **+0.02** |
| $8,000 | 1,040.00 | 1,005.90 | **+34.10** |
| $10,000 | 1,300.00 | 1,052.90 | **+247.10** |

**Crossover at T = $7,679.8122.** Restated: optimistic under the default profile
for item totals below ~$7,680, pessimistic above it. The reviewer's independent
figures matched to the cent.

#### Revised standing

| row | on a single sale's net | on the widget's incremental upside |
|---|---|---|
| 1 — 13% vs profile rate | optimistic below ~$7,680 (default) | same, scaled by the spread; small term |
| 2 — no per-order fee | optimistic | **cancels — zero**, ±$0.10 at the $10 threshold |
| 3 — no shipping cost | optimistic | **cancels — zero** |
| 4 — tax absent from fee base | optimistic | optimistic (proportional, larger on graded leg) |
| 5 — flat $25 grading fee | optimistic for PSA; **pessimistic $7 for CGC/SGC** | **dominant term; sign varies by grader** |
| 6 — no grading postage | optimistic | **optimistic — grading-only cost, never cancels** |
| 7 — `upside / raw` ratio | optimistic while upside > 0 | inverts on losses, which `core:11504` renders |

**So: on the metric that is actually displayed, two of the seven contribute
nothing (rows 2 and 3, common to both options), row 6 is unconditionally
optimistic because it is grading-only, row 9's tax gap is optimistic because it
is proportional, row 1 can flip the sign by crossing a fee band, row 5 can flip
it by grader, and row 7 inverts on losses.** "Seven simplifications all leaning optimistic" was wrong about the
count, wrong about the mechanism, and wrong about which one matters.

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

## WITHDRAWN 2026-09-07 — "What the main fee path does right"

**This section was the worst thing in the document, and it was the part that said
things were fine.**

It claimed `feeEbay` was "the counter-example and genuinely not leaning," on the
strength of a rate "applied to a total that **includes shipping and tax** —
reproduced against eBay's own worked example." **The tax half of that is false**,
and it was the baseline the comparison table's net column was computed from — so
those dollar figures were not what `feeEbay` implements either.

`feeEbay(price, shipCharge, ebayStore, ebayPromo, trsEligible)` computes
`total = price + shipCharge` (`js/core.7f9c03ad.js:6792`). Shipping: in. Tax:
**no parameter at all.**

eBay's base, quoted from the raw page rather than a summary of it:

> "**total amount of the sale** includes the item price, any handling charges,
> any shipping costs collected from the buyer (some exceptions apply), sales tax,
> and any other applicable fees."

and both of eBay's own worked examples are explicitly tax-inclusive — "Since you
aren't charging the buyer for shipping or any other costs, **$424 is the total
amount of the sale (includes 6% sales tax)**" and "The total amount of the sale is
**$10,070 (includes 6% sales tax)**" ([eBay selling
fees](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822)).

Measured against those two examples:

| eBay's own example | eBay bills | `feeEbay` as called | fee understated |
|---|---:|---:|---:|
| $400 item, no shipping charged, 6% tax → total $424 | 56.58 | 53.40 | **3.18** |
| total $10,070 incl 6% tax → item 9,500 | 1,054.55 | 1,041.15 | **13.39** |

$3.18 on a $400 sale is **64× the nickel gate**. "Reproduced against eBay's own
worked example" is true only if a **tax-inclusive total was passed in as
`price`** — in which case the operator supplied the tax and the function never
did.

**And the direction runs the same way as everything else.** Omitting tax from the
base understates the fee, which overstates net. So the function this audit held
up as the honest one leans optimistic too — less than the grading panel, but in
the same direction. That is a stronger finding than anything in the withdrawn
headline, and it survived in the section least likely to be re-checked precisely
because that section said things were fine.

Filed as **BIAS-9**.

### The live screen was already right — the audit was the thing that was wrong

The obvious next worry is that D3 step 5's fee breakdown, whose whole selling
point is that the arithmetic can be checked, is now precisely wrong. **It is not,
and the code says why:**

- `_reviewFeeCalc()` calls `feeEbay(price, 0, ...)` — shipping charge **hard
  zero** on this screen — so the heading's `item price only` basis is *true* here
  (`js/core.7f9c03ad.js:19991`, `:20006`).
- `items.taxNote = true` **unconditionally** (`:6840`), so the breakdown always
  renders a **`Buyer sales tax (not estimated) — `** row (`:8156`,
  `FEE_DISCLOSURE.taxQualifier`). Not a guard that can go unreached.
- `FEE_DISCLOSURE.estimateNote` (`:6879`, rendered `:20014`) already states the
  broader base and the direction, verbatim: *"This estimate calculates fees on
  the item price only. eBay charges its fee on the total sale, which includes
  buyer-paid shipping and buyer sales tax, so your actual proceeds may be
  lower."*

So the breakdown reconciles to the cent against a base it names on its face, and
discloses both exclusions plus the direction of the resulting error. **BIAS-9
does not block D3.**

**The sharpest part of this whole episode:** the app's disclosure copy was
correct about tax the entire time, and this audit contradicted it — and then
cited the contradiction as proof the function was unbiased. A check that reads
the code but not the code's own user-facing claims is not a check.

I also went looking for a live copy defect here, expecting `estimateNote`'s
"item price only" to be false wherever a seller charges shipping. **It is not a
defect:** that string is rendered at exactly one call site, the review screen,
where `shipCharge` is hard zero. The comparison surface uses the dynamic
`feeBaseLabel` (`item` / `item + shipping`, `:6839`) instead. Recording the
negative result so the next reader does not re-open it.

### What is genuinely still true about `feeEbay`

Kept, because it is separately verified and the withdrawal above does not touch it:

- 13.25% to $7,500 then 2.35%, applied to a total that **includes buyer-paid
  shipping** — shipping only, tax excluded, per the above.
- The `$0.40` per-order fee is present and correctly **excluded** from the TRS
  discount base (now pinned by five assertions, one naming the four cents).
- The TRS discount is now **withheld by default** and released only on a
  recorded per-listing confirmation — that is a pessimistic default, which is
  the correct direction for an unverified benefit.
- Cross-source disagreement is disclosed rather than averaged.

So the project's core arithmetic is honest **about fees it models, and it does
not model tax.** **The lean lives in the surfaces
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
- **BIAS-4** `upsidePct` denominator excludes invested grading fee. **Scope
  corrected 2026-09-07:** before changing the denominator, define the metric.
  `upside / raw` is a defensible *uplift relative to raw value*; it is not
  automatically ROI, and true ROI needs a matching profit numerator over
  acquisition plus relevant costs — not merely raw comp plus grading fee. Prefer
  dollar upside until the percentage is defined. Test positive, zero and
  negative outcomes; a negative ratio alone does not establish directional bias.
- **BIAS-9** *(filed 2026-09-07, previously mis-cited as BIAS-4)* Sales tax is
  absent from `feeEbay`'s fee base. `feeEbay(price, shipCharge, ebayStore,
  ebayPromo, trsEligible)` computes `total = price + shipCharge` and takes **no
  tax parameter**. eBay's published fee base does include buyer-paid tax subject
  to its exceptions. Any earlier statement in this document that the canonical
  function includes tax is **wrong** — it does not, and packets saying buyer tax
  was not modeled were correct. Demonstrate the actual tax input and the
  resulting fee before claiming otherwise.

  **Measured against eBay's own worked examples: fee understated by $3.18 on
  their $400 example (64× the nickel gate) and $13.39 on their $10,070 example.**
  Direction: understates fee, so **overstates net — optimistic.**

  **This one probably cannot be fixed by modelling it, and that is the finding.**
  Sales tax is a function of the buyer and the ship-to state, and a draft has
  neither. There is no honest tax number available at draft time, and inventing a
  rate would be exactly the stamped-invented-number failure this project already
  has a rule against. So the permanent correct position is the one the code
  already takes: **the fee estimate is a lower bound on the fee, hence an upper
  bound on net, and it says so.** What was missing was not a calculation. It was
  this audit reading its own app's disclosure before calling the function
  unbiased.
- **BIAS-10** *(filed 2026-09-07)* The tax disclosure BIAS-9 relies on exists on
  **one venue of twelve.** `taxNote` is set only by `feeEbay`; `feeBase` /
  `feeBaseLabel` only by `feeEbay` and `feeTCGPlayer`. Both rows are conditional
  at the render (`js/core.7f9c03ad.js:8154-8155`), so ten venues show a fee total
  with **no stated base and no tax note.** The venue ranking is therefore
  computed on bases that omit a real cost everywhere while disclosing it in one
  place.
  Measured at $400 / 6% tax: order is unchanged, but the omission is
  **proportional to fee rate** — Poshmark flattered $4.80, Fanatics $1.44 —
  compressing the apparent cheap-vs-expensive spread by up to **$3.36**, and the
  **eBay ↔ TCGplayer gap is $0.10 against a $3.18 per-venue effect (32×)**. Order
  survives only because those two are flattered equally, which is an accident of
  their near-identical rates.
  **The uniformity assumption is verified for exactly one venue.**
  **BIAS-10 is a MAGNITUDE bias, not a ranking bug** — order-survival was the
  reassuring result and it should not lead. The finding is that the omission
  scales with fee rate, so it always flatters the more expensive venue more and
  compresses the very gap the product exists to report. Full write-up, the
  one-date stamp decision, and the five-step sequenced remedy:
  `audit/d3/DISCLOSURE_PARITY_Q3.md` § Q3-E revised.
- **Binding rule established here:** **no invented input to a fee model.** Not
  the narrower "no invented tax rate" — an invented fee input propagates into
  every venue simultaneously and silently, so it cannot surface as an outlier. It
  moves the whole board and looks like consistency. Gaps of this kind close by
  disclosure and citation, never by modelling.
- **BIAS-5** `GRADING_FEE = 25` contradicts the server's own `getGradingCost`
  tier table (`api/grade-opportunity.js:44-52`). The fix is the tier table, and
  it needs a stated grader default — an owner call. **This is the one BIAS item
  that T2.7's existing fix line actually covers.**
- **BIAS-7** The `9.5` column is labelled `BGS/CGC` but is charged PSA's flat
  `$25`. Overstates against BGS `$50`, understates against CGC `$18`. Must be
  resolved before any per-column conditional label ships, or the label states a
  grader the fee contradicts.

- **BIAS-8** *(the trap BIAS-5's fix walks into)* When the tier table lands, the
  panel must ask "which grader" in order to price a fee. **A concrete grader is
  already sitting in each column — and it is not an answer to that question.**

  ```js
  { key:'grade_7',  sub:'Any grader', syncKey:'psa:7'   }
  { key:'grade_8',  sub:'Any grader', syncKey:'psa:8'   }
  { key:'grade_9',  sub:'Any grader', syncKey:'psa:9'   }
  { key:'grade_95', sub:'BGS/CGC',    syncKey:'bgs:9.5' }
  ```

  The comment directly above these lines already draws the distinction and was
  written to protect it: *"syncKey still picks a concrete grader for the UI to
  switch to — that is a selection default, not a claim about the price."*

  A fee lookup keyed off `syncKey` is the obvious implementation and it is
  wrong. It silently converts a documented **selection default** into an
  unstated **price claim**, on four columns at once — charging PSA rates to
  three columns whose own subtitle says "Any grader", and BGS `$50` to a column
  whose subtitle says "BGS/CGC". The result looks *more* precise than today's
  flat `$25` while asserting something the feed does not support. PriceCharting
  only breaks out a grader at the 10; below that the number is "graded N by a
  grading company", so **no per-column grader fee is derivable from the feed at
  all** for grades 7 through 9.5.

  The 9.5 column is the sharpest case because it is genuinely two graders at two
  prices sharing one cell (`BGS 50` vs `CGC 18`, a 2.8× spread). It either
  splits, or it names which grader its fee assumes. **A single grader default
  silently picks one and the column will look precise.**

  Decide this when the tier table goes in, not after. The safe shapes are: state
  the assumed grader in the caption per column; or show a fee range where the
  grader is unresolved; or withhold the upside number on columns whose grader the
  feed does not name — which is the same "withhold until confirmed" direction
  already taken for the TRS discount, and the only one of the three that does not
  invent precision.

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

## 2026-09-07 — a candidate that runs OPPOSITE to the seven, and why it is not yet filed as one

All seven simplifications above are optimistic on the audit's metric (net
proceeds = `price − fees − costs`): an omitted cost or understated fee can only
make net look better.

The headline blend's trim gates run the other way. Measured over 13,638 products
(`tools/threshold-distribution.mjs`, and see T2.13):

- the low-ask gate admits **52.18%** of the time and pulls the headline down a
  median **11.01%**, in the same direction **97.3%** of the time
- the high-ask gate admits **11.81%** and pulls up a median **18.65%**
- net: the blend sits below a `(mid*2 + market)/3` centre in **41.8%** of
  products, above in 10.6%, mean shift **−3.99%**

A lower headline price lowers net, so this is **pessimistic** on the audit's
metric — the first term found that leans against the other seven.

**It is deliberately NOT added to the table of seven.** Those directions are
measured against a truth: a fee that exists and is omitted. This one is measured
against an *alternative shape*, and `(mid*2 + market)/3` is not the truth either.
Calling a −3.99% shift a bias would be asserting that the low ask does not belong
in the headline, which is exactly the unresolved question in T2.13.

What can be said without deciding that: **the two gates are not symmetric, they
were written as though they were, and their net effect on the published number
has never been stated anywhere.** If T2.13 resolves toward excluding the low ask,
this becomes BIAS-11 with a direction already measured. If it resolves the other
way, the finding is that the seven-item table was incomplete in a direction the
audit had not looked for, which is worth knowing either way.


## BIAS-11 — REVISED TWICE. Grid-dependent, advice-invariant, bounded at a dime

**Revision history, kept deliberately.** v1 (`47579c5`) reported the direction as
optimistic — wrong, fee difference measured, upside reported. v2 (`2af5184`)
corrected the direction to conservative and quoted a `$11.00` worst case. **v3
(this) retracts the `$11.00`**: it came from sampling a `$100` shipping charge,
which no card seller levies. Three versions of one entry, and only the third is
quotable.

### The measured result

Sweep: 2 store settings × 3 promo rates × TRS on/off × 20×20 price pairs
(`G > R`), `upsideNet` evaluated through the real `feeEbay`.

**Grid-invariant facts** (identical at every shipping grid tested):

| fact | value |
|---|---|
| optimistic (`S = 0` overstates) price pairs | **108** |
| max overstatement | **$0.10** |
| all optimistic pairs have graded price | **`<= $10`** |
| all optimistic pairs have `upsideNet@0` | **negative** (least-negative `-18.78`) |
| pairs with mixed / unbounded direction | **0** |
| **pairs where shipping changes the seller-facing verdict** | **0 of 1,704** |

**Grid-dependent facts** — quote only with the grid attached:

| shipping grid sampled | understates | overstates | no dependence | max understatement |
|---|---|---|---|---|
| `$0`–`$20` (realistic for cards) | 1,500 | 108 | 672 | **$2.28** |
| `$0`–`$100` | 1,500 | 108 | 672 | $11.00 |
| `$0`–`$500` | 1,596 | 108 | 576 | $54.60 |

**The realistic row is the one that describes the product.** Raw cards ship in a
plain envelope; graded slabs ship boxed. `$0`–`$20` spans both. Within it:

- graded price `<= $300` — the population the panel is actually consulted for —
  **deviation `<= $0.10` in either direction**
- all graded prices — **`<= $2.28`**

### Direction

**Dominantly conservative** (understates upside), with a bounded optimistic
minority of 108 pairs. **The sign is not consistent, so this is not admissible as
a bias with a single lean** and is recorded as a directional item with both
directions stated.

### Advice-invariance — the finding that bounds it properly

`renderGradingUpside` renders three verdicts: `upsideNet > 5` (green, plus the
"Best case" line), `> -5` (yellow), else red ("may not pencil out"). Across
**all 1,704** shipping-dependent price pairs, at every sampled shipping charge,
**the verdict never changes**. Not "rarely" — zero.

For the optimistic 108 this is doubly true: every one already renders red, so the
`$0.10` overstatement is applied to a number that is already telling the seller
not to grade the card.

**Why this is the right bound rather than the dollar figure.** The magnitude is
grid-dependent and the direction is mixed, so neither is a stable summary. The
verdict crossing is neither: it is a property of the rendered output against its
own thresholds, and it holds at every grid tested. **The panel's advice does not
depend on the shipping charge anywhere in the sampled space.**

### Consequence for copy

No directional claim is stampable. Final copy:

> Assumes no shipping charge collected from the buyer.

**Status:** open pending the BIAS-1 implementation. Direction corrected,
magnitude re-bounded, advice-invariance established.
