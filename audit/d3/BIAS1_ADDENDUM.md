# BIAS-1 Addendum — Profile Coverage, and a Withdrawn Claim

**Branch** `phase1-block-d` · **HEAD** `754b00d` · **`origin/main`** `9aaf326` · **NOTHING PUSHED**
**Live bundle** `js/core.040daa95.js` (referenced once, `index.html:3732`)

Supersedes §3 of `BIAS1_CHECKPOINT.md`. The fee routing, the content-derived filename,
live-bundle resolution, the scoped network claim and the date fixtures are accepted and not
reopened here.

---

## 1. The claim I got wrong

I wrote that the error direction reverses exactly at the **$7,500** tier boundary, and that
a flat rate therefore **could not be tuned conservatively**. Both are wrong. **Both are
withdrawn.**

The tier changes the *marginal* rate at $7,500. It does not change the sign of the
*accumulated* difference there, because this comparison is incremental — it subtracts a raw
net from a graded net and both sides carry their own fee. Your counterexample reproduces
against the live model to the cent:

| Raw → graded | Old panel | Corrected model | Old − corrected |
|---|---|---|---|
| $1,000 → $7,500 | $5,630.00 | $5,613.75 | **+$16.25** |
| $1,000 → $7,501 | $5,630.87 | $5,614.73 | **+$16.14** |
| $1,000 → $9,000 | $6,935.00 | $7,078.50 | **−$143.50** |

The old calculation stays optimistic at and just past $7,500. Sweeping for the actual sign
change confirms it depends on both prices:

| Raw | Graded price where old − corrected turns negative |
|---|---|
| $1 | $7,678 |
| $100 | $7,674 |
| $1,000 | $7,653 |
| $2,000 | $7,630 |
| $5,000 | $7,559 |

And the **profile moves it much more than the prices do.** A Basic Store seller pays a
12.35% base rate — *below* a flat 13% — so for that seller the old calculation was
**pessimistic almost everywhere**, with the crossover immediately above the raw price
($101 for a $100 raw), nowhere near a tier.

**Replaced with the supported claim, verbatim as you framed it:**

> A single flat percentage cannot reproduce the tiered fee schedule across these scenarios.
> Error direction depends on both sale amounts and the applicable profile.

*Cannot reproduce accurately* is established. *Cannot be made conservative* is a stronger,
different claim, was never tested, and is not asserted anywhere. A flat rate chosen low
enough might well be conservative across some stated range — I did not examine that and
nothing in this work answers it.

This is still sufficient reason to call the model rather than pick a better constant: there
is no single rate to pick, because the rate depends on store tier, both sale amounts, and
any promoted-listing campaign.

The same overgeneralization was sitting in the in-bundle comment. It is amended there too,
which is why the bundle was re-derived a second time.

## 2. The advice-impact conclusion, tied to its grid

The $2 → $25 pair is reproducible exactly: **−$4.99 → −$5.1475**, crossing yellow to red.

**"Only one verdict changed" and "near-invisible in the advice" are grid-dependent and are
now labelled as such.** They describe 300 pairs on the default profile. The frequency of
such movements across real customers is **unmeasured** — it would depend on the actual
joint distribution of raw and graded comps and on the mix of store subscriptions, none of
which I have. The grid result is reported as a grid result and carries no claim about
customer impact.

---

## 3. Profile-variation cases

`tests/grading-upside-fees.mjs` — **51 passed, 0 failed** (was 36). Still slot 46 of 47;
`test-registry` 12/0.

Every expectation below is **calculated independently from eBay's published schedule** and
written as a literal with the arithmetic shown in-test, not obtained by calling
`netEbayForPrice`. Comparing the renderer against the model proves wiring; these check that
the intended inputs actually arrived. They are fixtures — nothing reads them but the
assertion they sit in — so this is not a second fee model.

Schedule used: [eBay selling fees](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822)
— no store 13.25% to $7,500 then 2.35%; Basic Store and up 12.35% to $2,500 then 2.35%;
per-order $0.30 at or below a $10 order total, else $0.40; promoted listings charged on the
order total.

### Basic Store, including its different tier boundary

$3,000 is deliberately **above** the Basic Store boundary ($2,500) and **below** the
no-store one ($7,500), so the two profiles cannot agree unless the boundary itself was
applied — not merely the headline rate.

```
Basic Store, raw $100 -> PSA 10 $3,000
  graded fvf = 2500 x 0.1235 + 500 x 0.0235 = 308.75 + 11.75 = 320.50
  graded net = 3000 - 320.50 - 0.40                          = 2679.10
  raw    net = 100 - 12.35 - 0.40                            =   87.25
  upside                                                     = 2566.85
```

Asserted: **$2,566.85**. Default profile, same pair, independently: `3000 - 397.50 - 0.40 =
2602.10`, `100 - 13.25 - 0.40 = 86.35`, upside **$2,490.75**. The store setting moves the
ladder by **$76.10**, also asserted.

### Nonzero promotion, treated as an assumption

```
no store, 5% promo, raw $100 -> PSA 10 $1,000
  graded net = 1000 - 132.50 - 0.40 - 50.00 = 817.10
  raw    net = 100 - 13.25 - 0.40 - 5.00    =  81.35
  upside                                    = 710.75
```

Asserted: **$710.75**, against **$755.75** with no promo — a **$45.00** gap, the promo
charged on both sides. The setting is an **assumption**: nothing here knows whether the
seller will run a campaign on this card, and the ladder makes no claim that they will. What
is asserted is only that the stated setting is applied where stated. Also asserted that the
rate is read as the number `5`, not concatenated as a string.

### No Top Rated discount can reach this ladder

Three profiles — `ebayTopRated: 'yes'`, `ebayTrsListing: 'yes'`, and both — each asserted
identical to the undiscounted ladder. Top Rated Plus is a per-listing benefit and there is
no listing here at all, so nothing could carry a per-listing confirmation.

Plus a **non-vacuity** check, because those three would pass against a model with no TRS
support whatsoever: the discount must be *capable* of moving the number. `1000` → fvf
`132.50` → ×0.9 → `119.25`, so net rises by exactly **$13.25**, asserted.

### `netEbayForPrice` actually consumes the fields supplied

You were right that placing `trsEligible: false` in an object proves nothing about whether
it is read. Each field is probed twice — real key, then a misspelled twin, which must
behave as if the field were omitted:

| Probe | Result |
|---|---|
| `ebayStore: 'basic'` | moves the net |
| `ebay_store: 'basic'` | identical to omitted |
| `ebayPromo: 5` | moves the net |
| `ebayPromoPct: 5` | identical to omitted |
| `trsEligible: true` | moves the net |
| `trsEligable: true` | identical to omitted |
| `trsEligible: 'yes'` | **identical to omitted** |

The misspellings behaving as omissions is what establishes the real keys are the ones read.
The last row is worth keeping: `'yes'` is truthy in JavaScript but fails `=== true`, so an
unresolved string **silently drops the discount** rather than raising anything. That is why
the routing resolves a boolean before building the context.

---

## 4. The $25 assertion is now explicitly temporary

Agreed — it must not become a standing requirement blocking BIAS-5. Retagged in the source:

```
/* TEMPORARY -- REMOVE WHEN BIAS-5 LANDS. ...
   This asserts a KNOWN DEFECT is still present. Its only purpose is to
   document THIS pass's isolation ...
   $25 is wrong. It contradicts the server's tier table in
   api/grade-opportunity.js:44-52. This assertion must NOT become a standing
   requirement that blocks BIAS-5 from correcting it. When BIAS-5 lands,
   DELETE this check and replace it with the supported-cost behaviour checks:
   costs sourced from the tier table, and grading-only expenses accounted
   separately. A test that pins a defect in place outlives its purpose the
   moment the defect is scheduled for repair. */
T.check('TEMPORARY (BIAS-1 isolation only): the $25 grading fee is unchanged', ...)
```

---

## 5. Bundle address and suites executed

**`js/core.040daa95.js`** — `sha256[:8] = 040daa95`, content-derived from final bytes,
referenced once at `index.html:3732`. Two addresses in this pass: `c5d0858b` was committed
in `ac6b88a`, so it is **retained at its own bytes** under `vercel.json`'s immutable policy.
All seven bundles on disk self-address.

| Suite | Result |
|---|---|
| `tests/grading-upside-fees.mjs` (slot 46) | **51 passed, 0 failed** |
| `tests/asset-fingerprints.mjs` | 15 passed, 0 failed |
| `tests/draft-review-screen.mjs` | 180 passed, 0 failed |
| `tests/quick-pricing.mjs` | 55 passed, 0 failed |
| `tests/accuracy-fee-parity.mjs` | 17 passed, 0 failed |
| `tests/review-fee-dl.mjs` | 15 passed, 0 failed |
| `tests/test-registry.mjs` | 12 passed, 0 failed |

All re-run **after** the final re-derivation. These seven are evidence for **this**
checkpoint. The 41-suite inventory remains evidence for **its** earlier revision — 41
passed at `09fc203`, carried to `431da85` through two documentation-only commits.
`tests/run-all.sh` was not run. Neither figure establishes release readiness.

Citation mappings resolved: 31 unresolved, all `d9e1b484`, all pre-existing and unchanged
by this pass.

---

## 6. Open

**BIAS-3** conditional labels · **BIAS-5** supported grading costs and grading-only
expenses · **BIAS-7 / BIAS-8** grader and price provenance, no grader inherited from
`syncKey` — each needs its own evidence. **BIAS-6** unwalked estimate surfaces.
**BIAS-10 / T2.9** venue tax treatment by **2026-09-21**. **T2.10 / Q3-F / T2.13** still
waiting on the **Q7 decision**.

**The push and deployment gates remain closed.** Cert ID rotation is mandatory and not
done: rotate in the eBay portal → update the Vercel env var in **both** Production and
Preview → `EBAY_LIVE=1 node tests/ebay-live.mjs` at 19/19 (currently 18/19) → **then**
delete `refs/recovery/pre-scrub-c2366b2` → never use the unblock URL. Credential-hygiene
work is open, including rewriting the earlier partial commit-message disclosure before any
push.

~128 commits outgoing. Nothing pushed.
