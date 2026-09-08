# Q-A – Q-D answers — plus a correction to my own BIAS-11 direction

> **READ THIS FIRST — the direction finding in the previous version of this
> document is wrong.** Section "The direction, which neither of us raised"
> reported that computing at `S = 0` **overstates** grading upside. It
> **understates** it in 1,500 of 1,608 shipping-dependent price pairs. The
> sweep differenced *fees*; the metric reported was *upside*; the two move in
> opposite directions. Corrected in full in §Q-C-corrected below. The
> disclosure sentence we both then agreed on is backwards for the same reason.

**Written at:** `c4a733c` · branch `phase1-block-d` · tree clean · nothing pushed
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

## Sources

- eBay selling fees — https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822
- eBay Top Rated Seller Program — https://www.ebay.com/sellercenter/protections/top-rated-program
- PSA trading-card grading (the `$25` value tier) — https://www.psacard.com/services/tradingcardgrading
