# Q3 disclosure-parity review — response

**Checkpoint:** `7198d49` at time of review; this response commits on top.
**Branch:** `phase1-block-d`. Nothing pushed, nothing deployed, no credentials touched.

**Summary: three corrections accepted, all three verified in code. One of them
overturns a claim I made, and the corrected version is a worse finding than the
one I wrote — the error does not lean, it changes sign inside a single widget.**

---

## 1. ACCEPTED and verified — "the fee error is not universally upward"

I claimed both simplifications always inflate upside. **That is false for three
of the four seller profiles.** `feeEbay` reads the profile:

```
Basic Store and above → 12.35%,  boundary $2,500
No store / Starter    → 13.25%,  boundary $7,500
if (trs) fvf *= 0.9
perOrder = total <= 10 ? 0.30 : 0.40
```

The panel's flat `13` ignores the profile entirely. Signed error of the panel's
fee against the model's, **negative = panel understates the fee = upside
inflated**:

| profile | $25 | $50 | $200 | $500 | $1000 | crossover |
|---|---|---|---|---|---|---|
| **default — no store, not TRS** | −0.46 | −0.53 | −0.90 | −1.65 | −2.90 | **never — always understates** |
| store, not TRS | −0.24 | −0.08 | +0.90 | +2.85 | +6.10 | T > $61.54 |
| no store, TRS | −0.13 | +0.14 | +1.75 | +4.97 | +10.35 | T > $37.21 |
| store + TRS | +0.07 | +0.54 | +3.37 | +9.02 | +18.45 | T > $21.22 |

So the reviewer's narrowing is right, with one qualification that matters: under
**the app's own default profile** — no store, not Top Rated, Level 1–4 — the flat
rate understates at *every* price and never crosses over, because the per-order
fee is additive and 13 < 13.25. The upward lean is real for the default seller
and disappears or reverses once a store or TRS status is set.

### The grading side also changes sign — a point the review did not make

`getGradingCost` (`api/grade-opportunity.js:44-52`) is grader-specific, not just
value-tiered: `BGS → 50`, `CGC → 18`, `SGC → 18`, PSA `<200 → 25`, `<500 → 50`,
else `100`. Panel flat `$25` minus model cost:

| grader | $25 | $50 | $200 | $500 | $1000 |
|---|---|---|---|---|---|
| PSA | 0 | 0 | **−25** | **−75** | **−75** |
| BGS | **−25** | −25 | −25 | −25 | −25 |
| CGC | **+7** | +7 | +7 | +7 | +7 |
| SGC | +7 | +7 | +7 | +7 | +7 |

**Combined, default profile:**

| grader | $25 | $50 | $200 | $500 | $1000 |
|---|---|---|---|---|---|
| PSA | −0.46 | −0.53 | −25.90 | −76.65 | **−77.90** |
| BGS | −25.46 | −25.52 | −25.90 | −26.65 | −27.90 |
| CGC | **+6.54** | +6.47 | +6.10 | +5.35 | +4.10 |
| SGC | +6.54 | +6.47 | +6.10 | +5.35 | +4.10 |

### The corrected finding is worse than the one I filed

"Consistently optimistic" is a *predictable* defect — a reader who knows the lean
can discount it. What the numbers actually show is that **the error changes sign
across the grader columns rendered side by side in the same panel**: at the
default profile a PSA column is inflated by up to $77.90 while the CGC column
next to it is *deflated* by ~$6. The panel's own caption — "net after $25 fee +
13% sale fees" — is applied to a column subtitled BGS/CGC, so a single stated
basis is simultaneously too low for one column and too high for another.

That kills the tempting shortcut of adjusting the constant, independently of
rule 1: **there is no constant that is right for all four columns.** Only routing
through `feeEbay` and `getGradingCost` closes it. Fix scope unchanged; the
justification is now arithmetic rather than directional.

## 2. ACCEPTED — the server tiers are our model, not evidence about PSA

I wrote "understates grading cost by $25–$75" as though `getGradingCost` were
ground truth. It is our own internal model. PSA per-card prices **did not
extract** from `psacard.com/pricing`, and `psacard.com/services/tradingcards` is
disallowed to fetching, so the magnitude against PSA's actual published charges
remains **Unverified** — already on record and I should not have written past it.

**Restated:** the panel disagrees with *this repository's own server model* by the
amounts tabled above. Whether either matches PSA's current charges is
Unverified. Everything in §1 is a same-repo consistency finding, which is
sufficient for rule 1 and for disclosure parity, and is not a claim about the
world.

Accepted without reservation: do not apply a PSA value-tier figure to BGS/CGC
columns, and an unknown cost should yield a qualified estimate or no upside
claim rather than an invented all-in figure.

## 3. ACCEPTED — the symmetry tripwire is weaker than I framed it

`api/tcg-price.js:241,243` are **independent** nullish fallbacks:

```js
low:  r.low  ?? (displayMarket * 0.85),
high: r.high ?? (displayMarket * 1.15),
```

so a range can be half real and half synthesized, and that mixed case is not
symmetric. Rounding can also break the ratio on a fully synthesized range, and a
genuine range can hit it. **Provenance is not inferable from arithmetic
resemblance** — withdrawn as a detection idea, not just downgraded.

Accepted direction: carry explicit per-endpoint origin metadata, or remove the
synthesized values on both paths. And accepted specifically: a green **Market
price** pill must not sit where it appears to verify adjacent derived values.
Also accepted as a distinct defect I had not separated — "provider supplied" must
not silently read as "observed sold prices," since upstream values may be asking
prices across conditions.

## 4. ACCEPTED — "when no listing spread is available" would have been a false claim

The reviewer flagged this as unevidenced. It is worse than unevidenced: it is
**wrong**. `_qpDerivedBand` (`core:3860`) gates only on a basis existing and comp
being finite and positive:

```js
if (!basis) return null;
… const comp = (basis.market != null && isFinite(basis.market) && basis.market > 0) ? basis.market * condMult : null;
if (comp == null) return null;
```

and `:3873-3883` records that it "applies to raw cards too, as of 2026-09-04,"
because the listing-spread alternative was **rejected on measurement** —
`basis.low/mid` are active-listing asks across all conditions, so Sell Now
undercut the cheapest ask, which on a Base Set Charizard was a $125
heavily-played copy.

So the band is not a fallback for a missing spread. It is the chosen mechanism,
and the spread-based one was tried and discarded. Copy saying "when no listing
spread is available" would have documented a branch that does not exist.

## 5. ACCEPTED — "confirmed clean" narrowed to the proof obtained

Rewritten. `tests/accuracy-fee-parity.mjs` **15/0** proves venue-set and
`feeAuditedOn` date parity between the two projections, in both directions,
including the grouped-buylist row (12 rows carrying 15 venues). It does **not**
prove equivalence of fee bases, tax treatment, discounts, shipping, or source
qualifications on the rendered surfaces. The heading now says what it proves.

## 6. Copy — accepting the reviewer's text, with the branch clause omitted

Adopted as proposed, and it needs no percentage-parity test because it carries no
literal:

> Sell Now and Patient are calculated pricing suggestions around the displayed
> Comp value, not observed sales or a measured market range. The in-app
> explanation shows the adjustment used. Source ranges, when available, are
> separate provider data and may describe asking prices rather than completed
> sales.

Two notes on landing it. The third sentence is contingent on Q3-C: as the code
stands, a source range may be *partly synthesized*, so that sentence would be
inaccurate today — it describes the post-fix state. **So the first two sentences
can land now and the third cannot**, which matches the reviewer's own
instruction to finalize the source-range sentence after Q3-C. Still unwritten
into the page for that reason, and because copy on `accuracy.html` is yours to
approve.

## 7. Requested evidence — what I can and cannot supply

- **Commit:** this response and the corrected findings commit on top of
  `7198d49`. Full local history is 82 commits ahead of `origin/main` at
  `9aaf326`. **Nothing pushed** — the push gate holds pending Cert ID rotation.
- **Before/after examples:** none to show for Q3-A or Q3-C. **Nothing was
  fixed** — both remain open exactly as filed. The only code changed under Q3 so
  far is nothing at all; §1–§5 are corrections to the audit, not to the app.
- **Executed vs skipped suite inventory:** not yet produced. It is a named
  remaining item and requires the clean-checkout run, which I have not done.
  Suites I have run and their current standing: `accuracy-fee-parity` 15/0 ·
  `test-registry` 12/0 · `minors-011-012-013` 106/106 · `contrast-tokens` 12/0 ·
  `trs-listing-scope` 60/0 · `draft-review-screen` 166/0 ·
  `listing-packet-offline` 153/0 · `asset-fingerprints` **14/1, held red**
  pending the end-of-D3 bundle rename. `tests/run-all.sh` **not run** — it
  reaches production.

## 8. Advertising — noted, not acted on

Recorded as the reviewer's position: a completed, deployed, tested Phase 1 can
support broader advertising, starting with a small seller pilot, advertising only
what the released build does, and correcting or withdrawing the grading/range
claims first. No promotional copy, pilot, or deployment is being prepared here,
and credential rotation, hosting checks and release validation remain open.

## Sources

- [eBay selling fees — final value fee basis and per-order charges](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822)
- [eBay Top Rated Seller Program](https://www.ebay.com/sellercenter/protections/top-rated-program)
- Internal models, not external evidence: `js/core.7f9c03ad.js` `feeEbay`;
  `api/grade-opportunity.js:44-52`.
- PSA published per-card pricing: **Unverified** — did not extract from
  [PSA pricing](https://www.psacard.com/pricing); services page disallowed to fetching.
