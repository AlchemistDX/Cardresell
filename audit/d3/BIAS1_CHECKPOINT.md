# BIAS-1 Checkpoint — Fee Routing, Bundle Address, Suites Executed

**Branch** `phase1-block-d` · **HEAD** `ac6b88a` · **`origin/main`** `9aaf326` · **NOTHING PUSHED**
**Live bundle** `js/core.c5d0858b.js` (referenced once, `index.html:3732`)

Returning the four things asked for: the changed behaviour, the focused calculation cases,
the resulting bundle digest, and the suites actually executed. Then the corrections carried
forward, then what remains open.

---

## 1. The changed behaviour

`renderGradingUpside()` — the PSA grade ladder on the card detail surface — held its own
fee arithmetic:

```js
const GRADING_FEE = 25;   // PSA value tier ~$25 all-in
const FEES_PCT    = 13;   // eBay + shipping typical
...
const rawNet    = raw > 0 ? raw * (1 - FEES_PCT/100) : 0;
const gradedNet = g.price * (1 - FEES_PCT/100);
g.upsideNet     = gradedNet - rawNet - GRADING_FEE;
```

It now routes through the shared model:

```js
const _prof   = _crSellerProfile();
const _feeCtx = { ebayStore: _prof.ebayStore, ebayPromo: _prof.ebayPromo, trsEligible: false };
...
const rawNet    = raw > 0 ? netEbayForPrice(raw, _feeCtx) : 0;
const gradedNet = netEbayForPrice(g.price, _feeCtx);
g.upsideNet     = gradedNet - rawNet - GRADING_FEE;
```

`netEbayForPrice` is the same function behind the review screen's payout row and the
target-net bisection. **`FEES_PCT` is deleted, not re-tuned** — a second fee model that
still exists is still a second fee model, and that is the duplicate-implementation bug
that has bitten this repo nine times. The only surviving occurrence of the identifier is
the comment explaining its removal.

`trsEligible` is hard `false`, matching what `_reviewFeeCalc` does and for the same reason:
Top Rated Plus is a per-listing benefit while the profile answer is global. Here there is
not even a listing — it is a grade ladder — so nothing could carry a per-listing
confirmation. `ctx` receives a resolved boolean, not the raw `'yes'`/`'no'` string, which
would have silently dropped the discount.

### What this deliberately did NOT touch

| Item | Status | Why it is separate |
|---|---|---|
| **BIAS-3** conditional grade labels | open | The `sub:` labels are unchanged |
| **BIAS-5** grading-cost inputs | open | `GRADING_FEE = 25` still contradicts `api/grade-opportunity.js:44-52`; needs supported inputs and grading-only expenses |
| **BIAS-7 / BIAS-8** grader & price provenance | open | No grader is inherited from `syncKey`; `syncKey` is a lookup key, not a record of origin |

The new suite asserts `GRADING_FEE = 25` is **unchanged**, so it fails if a later pass
alters the grading fee while calling itself BIAS-1 work.

### Copy

The caption said `net after $25 fee + 13% sale fees`. After the routing there is no single
percentage to name — it varies with store subscription, value tier, the per-order step and
any promoted-listing rate. Keeping `13%` would have been stamping a lie. The rate is gone,
the `$25` stays, per the settled decision. It now reads `net after $25 grading fee and
eBay selling fees`.

This is the exception to *fix the function, not the label*: the label named a quantity the
fix removed from existence.

---

## 2. The focused calculation cases

`tests/grading-upside-fees.mjs` — **36 passed, 0 failed.** Registered as **slot 46 of 47**;
`tests/test-registry.mjs` 12/0 confirms registration and that the declared total equals the
number of invoked files.

It extracts `feeEbay`, `netEbayForPrice`, `_crSellerProfile` and `renderGradingUpside` out
of the **live** bundle and executes them. It does not grep for the absence of `FEES_PCT` —
a grep would pass against a build that reintroduced a flat rate under another name, which
is instance 1 of `PATTERN_ASSERTION_SURFACE.md`: an assertion that names a behaviour and
evidences a surface.

Numbers are read from `window._lastGradeLadder`, which the function already publishes for
its column-tap handler. That is production behaviour, not a test hook, so there is **no
test-only production global**, and it carries `upsideNet` at full precision — the
assertions compare cents, not the markup's rounded dollars.

Ten raw→graded pairs, chosen to straddle the two places a flat rate cannot follow the
model — the per-order fee step at a $10 order total, and the $7,500 value-tier boundary:

`(5, 40)` `(8, 12)` `(9.99, 60)` `(10, 45)` `(12, 500)` `(20, 120)` `(50, 400)` `(100, 1200)` `(400, 8000)` `(1000, 9000)`

Each is checked twice: the computed net matches `netEbayForPrice` to the cent, **and** that
figure reaches the markup. A number computed correctly and never rendered is not a fixed
surface.

Three assertions exist because of what is invisible on screen:

- The raw column renders the word `baseline`, not a figure. An error in
  `netEbayForPrice(raw)` would shift **every** other column while showing nothing itself.
  Its net is asserted directly, and the baseline implied by the PSA-10 column is asserted
  to equal `netEbayForPrice(raw)`.
- At least one case must render a figure the old flat arithmetic could not produce, so the
  suite cannot pass vacuously if the routing is reverted and the two happen to round alike.

The default profile is asserted to be no-store with no promo rate — the seller-profile
default this project settled on — so the suite measures the default seller rather than a
configuration invented by the test.

---

## 3. The effect, expressed against the boundary it can move

The ladder colours each column by a threshold on `upsideNet`: `> 5` green, `> -5` yellow,
otherwise red. That is the decision downstream of this number, so it is what the finding is
stated against rather than a raw magnitude.

Grid: 19 raw × 24 graded values, PriceCharting-plausible, keeping only pairs where the
graded comp exceeds raw. **300 pairs.**

| | |
|---|---|
| **Colour verdict changes** | **1 of 300** |
| The one change | raw $2 → $25: `−$4.99` yellow → `−$5.15` red |
| Old flat rate **optimistic** in | 261 pairs |
| Old flat rate **pessimistic** in | 38 pairs |
| Identical | 1 pair |

**Grid-invariant:** the single verdict change is a pair already sitting one cent from the
boundary; the correction moved it sixteen cents. No pair that was clearly green or clearly
red changed category. The fix is right on the merits and **near-invisible in the advice** —
the same shape BIAS-11 settled into.

**Grid-dependent, and reported as such:** the largest absolute divergence on this grid is
**$143.50** (raw $1,000 → $9,000). That is a property of the grid's upper corner, not of
the surface — a grid stopping at $2,000 would report a far smaller maximum. It is not a
headline.

### The direction is not uniform, and the reversal is structural

This is the part worth keeping. Optimistic in 261 pairs, **pessimistic in 38** — and the 38
are not scattered. Every one has a graded price of $8,000 or $9,000, and **no** optimistic
pair has a graded price at or above $7,500.

For a no-store seller `feeEbay` charges 13.25% up to a **$7,500** value tier and 2.35% on
the excess. Below the tier, a flat 13% understates the fee (13% < 13.25%, plus a per-order
fee the flat rate ignored entirely), so the old number overstated upside. Above the tier
the model charges 2.35% on the excess, so the model nets *more* and the old number
understated it.

> A flat rate could not have been tuned conservatively out of this. It errs in opposite
> directions on either side of a tier boundary, so any single percentage is optimistic
> below $7,500 and pessimistic above it. A threshold with two consumers cannot be tuned
> conservatively for both — here the two consumers are the two sides of eBay's own fee
> schedule. That is why this became a call into the model rather than a better constant,
> and why BIAS-1 was filed as a bias rather than an inaccuracy.

Source for the tier structure: [eBay selling fees](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822).
The separately-tracked gap — that eBay's "total amount of the sale" includes sales tax,
which `feeEbay` does not model — is **BIAS-10 / T2.9**, unchanged by this pass and still
due by 2026-09-21.

---

## 4. The resulting bundle digest

**`js/core.c5d0858b.js`** — `sha256[:8] = c5d0858b`, content-derived from the final bytes.
Referenced once, at `index.html:3732`. `node tests/asset-fingerprints.mjs` **15 passed, 0
failed**, run directly as authorized, both before and after.

Before the rename the guard went red exactly as it should:

```
FAIL js/core.24cd52cb.js is named after its own bytes (sha256[:8] = e2c783e2)
asset-fingerprints: 14 passed, 1 failed
```

That is the guard working, not something to work around.

`core.24cd52cb.js` is restored to its own bytes and retained at its old URL —
`vercel.json:47-48` serves `/js/*` immutable, so a client holding that URL must keep
getting the bytes it was promised. No `git mv` for a served bundle. All six bundles on disk
self-address.

**Two addresses were derived in this pass, and the first was discarded.** `e2c783e2`
carried an in-bundle comment citing `:6992` and `:19965`; the second number was wrong the
instant it was written, because the comment's own ~30 added lines shifted every line
beneath it. Both are now **symbol** citations, which cannot rot against the file they point
into. `e2c783e2` appears in no commit, no file and no reference — verified — so it carried
no immutability obligation and needed no retained copy.

### Citation mappings

Reported as **mappings resolved**, not citations verified. Measured both with and without
this pass's audit text, to check whether my own writing moved anything:

| Bundle | Mappings |
|---|---|
| `core.c5d0858b.js` (live) | 20,257 lines |
| `core.24cd52cb.js` | 17 / 17 resolve |
| `core.7f9c03ad.js` | 42 / 42 resolve |
| `core.8bd8277a.js` | 1 / 1 resolve |
| `core.d9e1b484.js` | 6,597 / 6,628 resolve |
| **Unresolved total** | **31**, all `d9e1b484`, all pre-existing |

Identical in both states, so nothing in this pass moved a citation. An earlier note in this
session recorded 6598 / 30; **that figure is not reproducible and is withdrawn rather than
defended.**

The tool still cannot detect a wrong bundle *name*, only a wrong line — the deferred
finding stands. Per your instruction, that comparison is not a failure rule and no tooling
change was made.

---

## 5. Suites actually executed

| Suite | Result |
|---|---|
| `tests/grading-upside-fees.mjs` (new, slot 46) | **36 passed, 0 failed** |
| `tests/asset-fingerprints.mjs` | 15 passed, 0 failed |
| `tests/draft-review-screen.mjs` | 180 passed, 0 failed |
| `tests/quick-pricing.mjs` | 55 passed, 0 failed |
| `tests/accuracy-fee-parity.mjs` | 17 passed, 0 failed |
| `tests/review-fee-dl.mjs` | 15 passed, 0 failed |
| `tests/test-registry.mjs` | 12 passed, 0 failed |

All seven re-run **after** the final re-derivation, against `c5d0858b`. None needed
editing to follow the rename — each resolves the bundle from `index.html` through
`_assetRefs.mjs`. The one textual mention of `24cd52cb` remaining in `tests/` is inside a
historical comment describing the prior rename, which is correct to leave.

`tests/run-all.sh` was **not** run, per the standing instruction. The prior inventory
stands as recorded: **41 suites passed at `09fc203`; carried forward to `431da85` through
two documentation-only commits.** That distinguishes execution from exclusion and **does
not establish release readiness.** This checkpoint does not either.

---

## 6. Your three corrections, carried forward

**Credential claim scoped.** The execution decision rests on **inspection of suite
behaviour** — which suites reach the network and which do not. Unset credentials do not
prove network isolation: they remove those credential paths, and do not prevent
unauthenticated requests or credentials loaded from elsewhere. The claim is now made only
about the inspection.

**Immutability.** Understood as retaining the original bytes at old URLs for this
transition, not retaining every asset forever. No retention-policy change requested or
made. Recorded that way.

**Date arithmetic — independent fixture built, and it was warranted.** The staleness helper
had come to depend on the function it tests. Seven cases now compute expected values from
explicit dates in-test, with real-reader cases driving absolute browser time via
`page.clock.setFixedTime`. `draft-review-screen` went 169 → **180 passed, 0 failed**.

I checked for existing coverage first rather than adding a duplicate suite: none existed.
`accuracy-fee-parity.mjs:92` only asserts every venue carries a stamp;
`copy-truth-offline.mjs:406,420` only assert the reader name appears and that there are 15
stamps. Nothing tested the arithmetic.

**The "seven" explained — the rounding rule is floor on UTC-elapsed.** `feeAuditAgeDays`
anchors at `Date.UTC(y, m-1, d)` of the stamp and returns
`Math.floor((Date.now() - anchor) / 86400000)`. All 15 venues are stamped `2026-09-01`. At
10:07 PM EDT the instant is `2026-09-08T02:07Z`, so elapsed is 7.0885 days → **7**. At
10:00 AM EDT the same day it returns **6**. "Six calendar days" and "age 7" are both
correct readings of the same stamp at different instants; the discrepancy was the missing
timestamp, not an arithmetic error.

---

## 7. Still open — this checkpoint clears none of them

**The push gate is binding and unchanged.** Do not push before the Cert ID is rotated,
full stop, under either option. It gates pushing only, not local editing. Sequence: rotate
in the eBay portal → update the Vercel env var in **both** Production and Preview → confirm
`EBAY_LIVE=1 node tests/ebay-live.mjs` at 19/19 (currently 18/19) → **then** delete
`refs/recovery/pre-scrub-c2366b2` → never use the unblock URL. **Rotation is mandatory and
not done.**

Also open: credential-hygiene work (inventory labels; the earlier partial commit-message
disclosure still needs rewriting before any push), history cleanup, the five Vercel
dashboard questions, BIAS-3 / BIAS-5 / BIAS-7 / BIAS-8 each needing their own acceptance
evidence, BIAS-6's unwalked estimate surfaces, BIAS-10 / T2.9 by 2026-09-21, and
T2.10 / Q3-F / T2.13 which are still waiting on the **Q7 decision**.

~126 commits outgoing. Nothing pushed.
