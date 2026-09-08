# Q-A – Q-D answers — plus a correction to my own BIAS-11 direction

> **READ THIS FIRST — the direction finding in the previous version of this
> document is wrong.** Section "The direction, which neither of us raised"
> reported that computing at `S = 0` **overstates** grading upside. It
> **understates** it in 1,500 of 1,608 shipping-dependent price pairs. The
> sweep differenced *fees*; the metric reported was *upside*; the two move in
> opposite directions. Corrected in full in §Q-C-corrected below. The
> disclosure sentence we both then agreed on is backwards for the same reason.
> **Second correction:** the `$11.00` worst case in that correction was itself an
> artifact of sampling a `$100` shipping charge. See §Q-C-revised again.

**Written at:** `a90dd9c` · branch `phase1-block-d` · tree clean · nothing pushed
**Answering:** your "Answers — D3 Step 5 review questions Q-A through Q-D", written against tip `59a971f`
**Tip drift:** `59a971f` → `c4a733c` is four commits, all documentation. No code
changed between your tip and this one, so nothing you read is stale. Stating it
because instance 25 is the entry that says a packet's accuracy does not survive
by itself.

**This document is self-contained.** Every function body your answer depends on
is quoted in full below, so nothing here requires repo access.

**Headline: Q-A, Q-B and Q-D adopted as written. Q-C's central insight is
correct and closes BIAS-1, but two of its three caveats are wrong — the per-order
fee does not cancel, and the tier break is more reachable than $7,500. Both are
now measured.**

---

## Q-C — the cancellation is real, and the residual is larger than costed

### What we verified

Your algebra assumes `f(P, S) = r·(P + S) + c`. Here is the actual function,
quoted in full:

```js
function feeEbay(price, shipCharge, ebayStore, ebayPromo, trsEligible) {
  const total = price + shipCharge;
  const isBasicPlus = ebayStore === 'basic';
  const baseRate    = isBasicPlus ? 0.1235 : 0.1325;
  const tierBoundary = isBasicPlus ? 2500 : 7500;
  let fvf = 0;
  if (total <= tierBoundary) fvf = total * baseRate;
  else                       fvf = tierBoundary * baseRate + (total - tierBoundary) * 0.0235;
  const trs = trsEligible === true;
  if (trs) fvf *= 0.9;
  /* ...label construction... */
  const perOrder = total <= 10 ? 0.30 : 0.40;
  items.push({ l: 'Per-order fee', a: perOrder, f: `$${perOrder.toFixed(2)}` });
  if (ebayPromo > 0) items.push({ l: `Promoted Listings (${ebayPromo}%)`, a: total * ebayPromo / 100, f: `${ebayPromo}%` });
  items.feeBase      = total;
  items.feeBaseLabel = shipCharge > 0 ? 'item + shipping' : 'item';
  items.taxNote      = true;
  return items;
}
```

And the panel is genuinely incremental, which is the precondition your argument
needs (`js/core.7f9c03ad.js`, inside `renderGradingUpside`):

```js
const rawNet    = raw > 0 ? raw * (1 - FEES_PCT/100) : 0;
const gradedNet = g.price * (1 - FEES_PCT/100);
g.upsideNet     = gradedNet - rawNet - GRADING_FEE;
g.upsidePct     = raw > 0 ? (g.upsideNet / raw) * 100 : 0;
```

**Confirmed:** `upsideNet` and `upsidePct` are the only figures rendered. No
absolute net reaches the DOM, so your caveat 3 does not apply to this surface as
built — there is no absolute claim here needing the item-only disclosure. The
caption does assert a method (`net after $25 fee + 13% sale fees`), which becomes
wrong the moment we route through the real model, and we will rewrite it from the
model rather than by hand.

### Where you are right

`fvf` is linear in `total` within a tier, and the promo term is linear in
`total`. For both, `S` cancels exactly in the difference. We executed the real
function to confirm rather than trusting the algebra — differences computed at
`S ∈ {0, 5, 10, 20}`, no store, no promo, TRS off:

| graded | raw | incremental at `S=0` | across `S ∈ {0,5,10,20}` | max deviation |
|---|---|---|---|---|
| $80 | $12 | 9.0100 | 9.01, 9.01, 9.01, 9.01 | **$0.00** |
| $300 | $25 | 36.4375 | 36.44 ×4 | **$0.00** |
| $2,600 | $30 | 340.5250 | 340.52–340.53 | **$0.00** |

**In the ordinary case the cancellation is exact, not approximate.** That closes
BIAS-1 with no invented input, and it is a better outcome than any of our four
options. Adopted.

### Where you are wrong — the per-order fee does not cancel

`perOrder = total <= 10 ? 0.30 : 0.40` is a **step function of `total`**, not the
constant `c` your derivation treats it as. When the two legs straddle $10, `S`
determines which side the raw leg lands on and the term survives:

| graded | raw | incremental at `S=0` | across `S ∈ {0,5,10,20}` | max deviation |
|---|---|---|---|---|
| $80 | $6 | 9.9050 | 9.91, 9.81, 9.81, 9.80 | **$0.10** |

A raw card at $6 with $5 shipping clears $10; the same card at `S=0` does not.
The graded leg never moves. So the difference carries a $0.10 term that depends
on `S`.

**$0.10 is two nickels, and this project's standing rule is that anything off by
more than a nickel gets fixed in the function rather than labelled.** So this is
not a footnote. It is also not rare in the opposite direction of your framing:
raw cards under $10 are the *most common* case in a trading-card catalog, and
they are exactly the population where grading upside is most often consulted.

### Where you are right but under-scoped — the tier break

You cited the $7,500 boundary. The boundary is **store-dependent**: `$7,500` with
no store, **`$2,500` for Basic Store and above**. Our default seller profile is
no-store, but Basic Store is a real setting, and $2,500 is very reachable for a
graded card:

| store | graded | raw | at `S=0` | across `S` | max deviation |
|---|---|---|---|---|---|
| basic | $2,600 | $30 | 307.39 | 307.39, 306.89, 305.39, 292.39 | **$15.00** |
| basic | $2,400 | $30 | 292.69 | 292.69 ×3, 287.69 | **$5.00** |
| none | $9,000 | $40 | 1,023.70 | 1023.70 → 1021.52 | **$2.18** |

`$15.00` is three hundred times the nickel gate.

### The direction, which neither of us raised

Every deviation above runs the same way: **the figure computed at `S = 0` is the
highest one.** Larger shipping charges reduce the true incremental upside, so
computing at `S = 0` **overstates the benefit of grading** in every case where
the cancellation fails.

That makes this a directional finding, not just a precision one, and it leans the
same way as the seven already in the bias audit — toward the optimistic side of
the seller's decision. Being filed as a new bias item rather than as a rounding
note, because a bounded error with a consistent sign is a bias.

### What we will build

1. Route `renderGradingUpside` through `feeEbay` twice at `S = 0`, taking the
   difference. Deletes `FEES_PCT` and the second fee implementation, closing
   BIAS-1 and rule-1's ninth violation.
2. **Assert the two conditions rather than assuming them away.** A registered
   test that fails when `raw <= 10` or when either leg crosses the profile's tier
   boundary, so the cases where cancellation fails are detected, not discovered.
3. Rewrite the caption from the model. `$25` stays (it is a real PSA value-tier
   figure); `13%` goes, because the model computes the rate.
4. **Open question we are not deciding alone** — see below.

### Q-C follow-up · what should the panel do when cancellation fails?

For `raw <= 10` the true figure is `S`-dependent within a $0.10 band. For the
tier-crossing case the band reaches $15. Options:

1. Show the `S = 0` figure and disclose the direction ("assumes no shipping
   charge; a shipping charge reduces this"). Honest, and it is a disclosure on
   the most-consulted case rather than an edge.
2. Withhold the figure when the condition fires. Correct, and it removes the
   number for most low-value raw cards — Appendix-B collision again, and this
   time on the common path rather than the edge.
3. Compute the band and show it as a range.
4. Ask for shipping on this surface.

**We lean (1) for the `$0.10` band and (3) for the tier case**, on the grounds
that a $0.10 ambiguity is honestly described in words while a $15 one is not. We
would rather hear that this is inconsistent than pick uniformly and be quietly
wrong at one end.

---

## Q-A — adopted as written

`<dt>` present with a stated non-value for withheld; no pair at all for
never-had. Adopted, including the generalisation to the whole class: **suppressed
is present-with-stated-absence, never-had is absent.**

The reason this is the right answer and ours were not: all three of our options
treated the distinction as a copy problem. It is a structural one, and `<dl>` can
carry it because `<dt>`/`<dd>` separates "this term exists" from "here is its
value" — which a flex row cannot. That is also why the collision appeared in the
first place, so the fix and the diagnosis are the same object.

Confirmed your point about Q7: `Not shown — see note` asserts that we are not
showing a number, not *why* the book is inverted. That is what was blocked, and it
is no longer blocked. **T2.14 becomes closable inside D3.**

Being explicit about one thing we will not do: the note marker's target text
still has to say something, and if the only honest sentence turns out to require
the Q7 decision, we will ship the `<dt>`/`<dd>` structure with a marker whose
note says only what we can defend, and leave T2.14 open rather than backfill it
with reasoning we have not settled. The structure is the part that closes.

## Q-B — adopted, with the negative control

Regex, anchored to markup we control, plus a floor assertion on what was parsed.
Adopted exactly.

Your `src="js/` reference is the argument that settles it: we have twice shipped
a guard where a parse failure produced two empty sets and a green comparison. So
the guard asserts a row count and a known-venue presence **before** comparing,
and a parse regression fails loudly rather than passing vacuously. That also
resolves our `data-venue` temptation — we were about to breach the
no-test-affordances-in-production rule to buy robustness we can get from a
negative control instead.

The table is 15 venue rows, one `<tr>` per line. The guard will pin 15 and a
named venue.

## Q-D — adopted, and the cost objection was ours to make badly

`git stash` the fix, run red, `stash pop`. Assertion-first for new behaviour.
Mutation only where neither route applies. Scope: all new assertions.

We costed this against mutation testing because mutation testing is what we
happened to do once, which is the same error as costing a decision against the
option in front of you rather than against the truth. Both your routes cost one
command.

Also accepted: the practice has more than one instance, it has never been a
requirement, and the evidence for it is the twenty-three instances rather than
the one. Being written up as a **standing requirement** with both routes and the
mutation exception named.

## §4b — accepted

The packet header carries the tip. This document does, including the drift from
your tip to ours and a statement that no code moved between them. Detectable
rather than only explainable, as you said.

---

## Status change from this exchange

| item | before | after |
|---|---|---|
| BIAS-1 (second fee implementation) | blocked on an input we refused to invent | **unblocked, building** |
| BIAS-3, -7, -8 | downstream of BIAS-1 | close with it |
| T2.14 (withheld vs never-had) | open, blocked on Q7 | **closable in D3, structurally** |
| Static-date parity guard | approach undecided | **decided: regex + negative control** |
| Assertion-fallibility practice | applied once, unstated | **becoming a requirement** |
| New: `S = 0` overstates grading upside | not known | **filed as a bias item** |

**Revised build order:** parity guard → `<dl>` conversion incl. T2.14 → fee-row
visual re-verify → bundle rename (D3 closes) → BIAS-1 with the Q-C follow-up
answered.

BIAS-1 moves after the rename because it edits `js/core.7f9c03ad.js`, and any
edit after the rename invalidates the new hash and every citation pointing at it.

---

---

## Q-C-corrected — the direction was inverted, and the copy we agreed on is backwards

You wrote that the direction finding "matters most" and "passes both
admissibility tests." It fails the second one, and the reason is my error.

### The mechanical error

The sweep computed `sum(feeEbay(G, S)) - sum(feeEbay(R, S))` — a **fee**
difference. The panel renders

```
upsideNet = (G - fees(G)) - (R - fees(R)) - GRADING_FEE
          = (G - R) - feeDiff - GRADING_FEE
```

`upsideNet` moves **opposite** to `feeDiff`. "`S = 0` yields the highest figure"
was true of what I measured and false of what I reported. Every number in the
table was correctly computed and correctly labelled as a fee difference; the
sentence drawing the conclusion silently switched metric.

### Corrected sweep, on the rendered field

2 store settings × 3 promo rates × TRS on/off × 20×20 price pairs × 7 shipping
charges, evaluating `upsideNet` through the real `feeEbay`:

| behaviour of `upsideNet` | price pairs |
|---|---|
| `S = 0` is the **minimum** — **understates** upside (conservative) | **1,500** |
| `S = 0` is the **maximum** — overstates upside (optimistic) | 108 |
| no dependence on `S` (cancellation exact) | 672 |
| mixed | 0 |

**The sign is not consistent, so it is not admissible as a bias with a single
lean.** Dominantly conservative with a bounded optimistic minority. Filed that
way, with both directions stated.

The optimistic 108 are fully characterised: **all** have graded price `<= $10`,
**all** have `upsideNet@0` negative (least-negative `-18.78`), maximum
overstatement **$0.10** — cards where the panel already reports that grading
destroys roughly the grading fee.

Conservative-side magnitude: **$0.10** for all graded prices `<= $300`; up to
**$11.00** for tier-crossers. For the population a seller actually consults, the
deviation is a dime in either direction.

### This changes the answer to your follow-up

We converged on (1) for both bands with *"assumes no shipping charge; a shipping
charge reduces this."* **That sentence is false in 1,500 of the 1,608
`S`-dependent pairs** — a shipping charge *increases* the figure.

Your reasoning for (1) over (3) still holds and I am not reopening it: a range
communicates our uncertainty about an input the seller knows rather than
uncertainty about the world, and the midpoint reads as an estimate. What changes
is the directional half of the sentence, because no direction holds universally:

> Assumes no shipping charge collected from the buyer.

Assumption stated, no direction claimed, nothing stamped that a sweep can
falsify. If you want a direction in the copy, the only defensible one is scoped —
"slightly increases this for most cards" — and I would rather not, because "most"
would be carrying 108 counterexamples and a tier boundary.

### What survives unchanged

The cancellation itself, which was the substance of your answer. `S` cancels
exactly for the FVF and promo terms; the residual is the `$10` per-order step and
the store-dependent tier boundary. BIAS-1 is still unblocked, still needs no
invented input, and the fix is still exact in the ordinary case. **Only the sign
of the residual was wrong.**

### Filed as instance 26

*A derived quantity was measured and the conclusion was stated about a different
quantity.* The part worth your attention: the write-up named its metric, which is
what this audit already requires, and still reported the wrong direction —
because naming the metric and *computing* the named metric are different
requirements and only the first was written down. New standing requirement: a
directional claim must be produced by evaluating the expression that reaches the
screen, not an input to it.

Third occurrence of a wrong bias direction in this corpus. The class: direction
is derived last, from a quantity computed for another purpose, and it is the one
field with no independent check.

**And it cleared review.** You endorsed it and singled it out. That is not a
complaint, it is the finding: confident presentation with correct numbers
attached is what review validates against, so an inverted sign is close to
invisible to it. If you have a cheap check for direction specifically, I would
take it — I now have three instances and no defence.


---

## Q-C-revised again — your advice-invariance point generalises, and my $11 was an artifact

Three of your four items are installed verbatim. The fourth turned out to be
stronger than you stated it, and testing it caught one more bad number of mine.

### Your point generalises past the 108

You noted the optimistic pairs all sit where `upsideNet@0` is already negative,
so the overstatement cannot change the advice. Correct — and it is not confined
to those 108. `renderGradingUpside` renders three verdicts: `upsideNet > 5`
(green, plus the "Best case" line), `> -5` (yellow), else red. Across **all
1,704** shipping-dependent price pairs at every sampled shipping charge:

> **pairs where shipping changes the seller-facing verdict: 0**

Not rare — zero. **The panel's advice does not depend on the shipping charge
anywhere in the sampled space.** That is a better bound than any dollar figure,
because it is a property of the rendered output measured against its own
thresholds rather than a magnitude that moves with what you sample.

### Which exposed that my `$11.00` was an artifact

Testing verdict-crossing meant varying the shipping grid, and the split moved:

| shipping grid sampled | understates | overstates | no dependence | max understatement |
|---|---|---|---|---|
| `$0`–`$20` (realistic) | 1,500 | 108 | 672 | **$2.28** |
| `$0`–`$100` | 1,500 | 108 | 672 | $11.00 |
| `$0`–`$500` | 1,596 | 108 | 576 | $54.60 |

**The `$11.00` I quoted came from sampling a `$100` shipping charge on a trading
card.** Retracted. Grid-invariant across all three: the 108 optimistic pairs, the
`$0.10` overstatement, all optimistic pairs having graded price `<= $10`, and
zero mixed-direction pairs. Everything else needs its grid quoted with it.

At realistic shipping, graded price `<= $300`: **deviation `<= $0.10` in either
direction.** All prices: **`<= $2.28`**.

So the corrected finding is smaller than the corrected version claimed. Third
revision of one entry; the audit keeps all three, because two of the three
versions were shared before being right.

### The checks, installed

1. **Producer-side, two calls** — a directional claim is produced by evaluating
   the *rendered* expression at both endpoints, both numbers quoted inline.
   Adopted verbatim, and the two-point pair for this claim now sits in the entry.
2. **A direction cannot be carried across a subtraction** — count inversions
   between the measured and claimed quantity; odd means the inherited sign is
   wrong, and counting at all means re-evaluate the output instead. Filed as the
   structural rule, with your framing that the count is the smell rather than the
   fix.
3. **Reviewer-side noun match** — does the conclusion sentence use the same noun
   as the column header? Mine said "incremental fee difference" above and "the
   figure" below.

**I think (3) is the one that will actually hold.** (1) and (2) are producer
discipline, so they fail precisely when the producer is confident — which is the
state that produced all three wrong directions. (3) is a text comparison
performed while reading, needs no recomputation, and the mismatch was visible in
the shared document with no repo access. It is the only one of the three that
does not depend on the person most likely to be wrong.

### On your accounting

Taking it, with one amendment: the noun mismatch was in the document, so it was
findable from the artifact you had. But the join was also the part I presented
with the most confidence and the least shown work — the tables had columns and
grids, and the sentence connecting them had neither. **A reviewer re-deriving
every join is a reviewer redoing the work; the fix is that the producer shows the
join, which is exactly what check (1) forces.** That is why I would not describe
this as a review failure with a producer contribution. It is a producer failure
with a review layer that could not have been expected to absorb it.

### Where this leaves BIAS-1

Unchanged and unblocked. `S` cancels exactly for the FVF and promo terms; the
residual is the `$10` per-order step and the store-dependent tier boundary; the
residual never changes the rendered verdict; the copy states the assumption with
no direction. **Building next, in the order already agreed** — parity guard, then
the `<dl>` conversion with T2.14, then the visual re-verify, then the rename, and
BIAS-1 after it because it edits the bundle.

## Sources

- eBay selling fees — https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822
- eBay Top Rated Seller Program — https://www.ebay.com/sellercenter/protections/top-rated-program
- PSA trading-card grading (the `$25` value tier) — https://www.psacard.com/services/tradingcardgrading
