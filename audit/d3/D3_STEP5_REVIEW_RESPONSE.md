# D3 Step 5 — response to the fee breakdown review

**Commit:** `bc83222` — "D3 step 5 rev2: fee block onto the house disclosure vocabulary"
(step 5 itself was `f01b9ad`; the reviewer's packet had no SHA, which was my omission)
**Branch:** `phase1-block-d` · 63 outgoing commits · **nothing pushed, nothing deployed**
**Suite:** `draft-review-screen` **133 passed / 0 failed** (was 113/0)

---

## The finding the review circled but didn't name

Three of the review's items — B1 (unqualified headline), B2 (no freshness on
this screen), B3 (no provenance) — were written as three missing features. They
are one defect, and it is worse than three gaps.

`_platTileHtml` on the ranking surface has, since 2026-09-01, rendered:

- a **`Fee base (item)` / `(item + shipping)`** qualifier row,
- a **`Buyer sales tax (not modeled)` $0.00** row,
- a dated **Verified / Stale pill** reading `isFeeStale()` and linking to `/accuracy#fees`.

Step 5 built a fee block against the same fee model and invented its own
presentation for all three: "What you keep", one prose sentence, and no tax
disclosure. That is **rule 1's sixth occurrence** — and the step-5 write-up
claimed to have caught the sixth prospectively via the `_crSellerProfile()`
extraction. It caught *a* sixth. It shipped another in the same commit.

What makes this one different from the previous five is the direction of the
damage. Those could **drift** — two copies of a rule that might disagree later.
This duplicate was not a copy, it was a **reduction**, so it was wrong on
arrival:

| ranking surface disclosed | review screen disclosed |
| --- | --- |
| fee base, with an `(item)` qualifier | a prose sentence |
| buyer sales tax, `(not modeled)`, $0.00 | nothing |
| the schedule's stamped date, Verified/Stale | nothing |

A seller who reached the estimate through the ranking list could see the fee
schedule had expired. The same seller reaching the same number through Sell
could not.

**The generalisation, for the pattern file:** before building a disclosure,
grep for the disclosure. A second implementation of a *rule* drifts; a second
implementation of a *disclosure* starts out weaker, because it only carries the
caveats its author happened to think of — and no test can miss a caveat that was
never written down.

Filed as **instance 14** in `audit/PATTERN_ASSERTION_SURFACE.md`.

---

## Item-by-item

### B1 — qualify the headline · **accepted in substance, implemented differently**

The arithmetic the review checked is right: $184.99 − $24.51 − $0.40 = $160.08.

The suggested copy — "Estimated proceeds — item price only" — was not used, and
the reason is the same finding above: the app already has a vocabulary and
adding a third would repeat the mistake. Shipped:

- Heading: **`Estimated net`** + basis `item price only`
- Total row: **`Estimated net (item only)`**
- Note: *"An estimate, not a payout. Fees are charged on the item price only — a draft does not carry shipping yet, and buyer sales tax is not modelled."*

One label was deliberately **not** reused. The ranking surface's total says
**"Net after all deductions"**, and this screen does not model seller shipping,
so borrowing it would claim a completeness the number lacks. The *qualifier
mechanism* transfers; the label does not.

**On tax — the review is right, and I verified it against the source rather
than taking it.** eBay's published schedule confirms the final value fee is
charged on the total amount of the sale, and that total **includes sales tax**
([eBay selling fees](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822)).
So an estimate that silently omits tax is **understating the fee**, not merely
narrowing its scope — a materially different error from the shipping omission.

The same page also confirms our rates are correct: **13.25%** of the first
**$7,500** then **2.35%** above, and the per-order fee at **$0.30** for orders
of $10.00 or less, **$0.40** above. Those match the model's constants and tier
boundary exactly.

The engine still does not model tax, and should not: the rate is a function of a
buyer and a delivery address that do not exist while the card is a draft, so any
number we produced would be invention, which §5.5 forbids. The engine-wide
position (`"we do not model buyer-paid tax anywhere in this engine"`,
`js/core.7f9c03ad.js:6809`) holds. What changed is that the review screen now
**says so**, using the row the ranking surface already had.

That row is a deliberate exception to step 5's own "a zero in a table reads as a
fact" rule, and the exception is the parenthetical:

> **A zero is a claim; a zero next to "(not modeled)" is a disclosure.**

So the assertion is on the qualifier, not on the row. Shipping gets the opposite
treatment — no row at all — because shipping is both unmodelled *and* unknown in
value, whereas tax is a known-applicable dimension we are declining to estimate.

**Carried, not closed:** draft-scoped shipping inputs remain a Phase 1 handoff
requirement. A qualified subtotal is interim UI, not the frozen promise.

### B2 — fee freshness on this screen · **premise wrong, conclusion right, wired**

The review inferred from the second screenshot that the fees are outside the
45-day window while review shows an unqualified amount, and asked which state
that was. It was neither production nor a simulated clock: that screenshot was a
**hand-injected CSS demonstration** from the previous step, made to show the
stale banner's dead styling against its fixed styling. I shared it without
labelling it as injected. That is my error and it produced a false reading.

Measured, at the real clock:

```
PLATFORMS.ebay.verified = 'Sep 2026'
verifiedAgeDays -> 0        (anchor 2026-09-30 is still in the future)
isFeeStale('ebay') -> false
isFeeAmber('ebay') -> false
```

**The eBay fee schedule is fresh right now.** No seller is currently seeing an
unqualified estimate from an expired schedule.

The conclusion survives the correction anyway, because the gap was structural
rather than current: the review screen had no way to *become* qualified. It now
renders the same pill, reading the same `isFeeStale` / `isFeeAmber` and the same
`PLATFORMS[pid].verified`, linking to the same `/accuracy#fees`. No second
timer, no restated window — a re-verification moves both screens at once.

**How the coupling is proved.** A single-state check cannot distinguish a live
reading from a pill hardcoded to "fresh" — that is the constant-state problem
from step 4, and it applies to my own new assertion. So the test moves the
upstream value. The upstream value here is the **clock**, not the config:
`PLATFORMS` is a lexical `const`, unreachable as `window.PLATFORMS`, and
exposing it would have meant adding a production global that exists only for a
test. `verifiedAgeDays` measures the stamp against `Date.now()`, so the test
advances the browser clock 200 days and requires the screen to change its mind.
Real input, real rule, real config, bundle untouched.

Staleness qualifies the estimate; it does not delete it. An assertion requires
the number to survive the stale state.

### B3 — provenance · **accepted; the word bans are gone**

Two step-5 assertions were removed, and the review is right about why:

- *"the word Source does not appear"*
- *"the word Provenance does not appear"*

Both would have failed the moment the block legitimately named its fee source —
which is the direction it was already going. A word ban cannot tell a disclosure
from a column. Replaced with assertions that no header sits above a column that
does not exist, plus a check that no row carries a third cell a header could
describe.

**Still blocked, and I want to be exact about it rather than absorb the ask.**
The compact note the review proposes has three parts. Two shipped: the fee
source's verification date (the pill) and the seller assumptions (the fee-line
labels, which already name the rate and any Top Rated discount). The third —
per-*price* provenance, "seller-entered / verified reference / unverified" — is
blocked twice over, unchanged from the step 4 packet:

1. non-blocking findings are not reachable through `readiness`, and
2. `buildListingPacket()` (`api/_listingPacket.js:315`) has **no production caller**.

`hasPacket` (`api/_draftService.js:516`) is therefore constant-false. Wiring the
label before the data exists would produce a field that is honest only by
accident. **Packet wiring precedes any non-blocking wire-shape decision** is an
accepted decision and I am holding it. Owner: me; step: D4 entry, not D3.

Current finding codes, as requested: `SELLER_PRICED` = INFO
(`api/_draftStore.js:209`), `NO_PROVENANCE` = WARNING (`:210`), severities and
`blocks()` at `:166-170`. The review's constraint — absent prices must not
generate missing-price-provenance warnings, seller-entered stays informational —
already matches those severities.

### Top Rated · **half already correct, half genuinely open**

> "the per-order portion is not discounted"

Already true, and asserted. `feeEbay` applies the 10% to the FVF only; the
per-order fee is pushed separately, after. Anchored in
`tests/fee-truth-offline.mjs:347`:

```
eq('eBay Top Rated pays 13.25% less 10%', sum(trsItems), 13.25 * 0.9 + 0.40)
```

The `+ 0.40` sitting outside the `* 0.9` is the assertion. The rate signature
also publishes `13.25% −10% Top Rated` rather than a rounded 11.93%, because
11.925% does not survive 2dp rounding and the row must stay hand-rebuildable.

> "the benefit applies to qualifying listings, not automatically to every
> listing by a Top Rated seller"

**This one is real and I am not fixing it inside step 5.** The select is labelled
as seller status; the discount is a per-listing entitlement with handling-time
and returns conditions plus category exceptions
([eBay Top Rated Seller](https://export.ebay.com/en/growth/seller-performance/top-rated-seller/)).
Where they diverge we overstate the payout for a Top Rated seller whose listing
does not qualify.

It is **app-wide, not review-screen-scoped** — the ranking surface has read that
select the same way since before D3 — and the default is off
(`tests/fee-truth-offline.mjs:259` asserts eBay defaults to no store, not Top
Rated), so no seller is overstated unless they opted in. Logged as an open item
for a decision: relabel the control to listing eligibility, or keep status and
label the discount a seller-confirmed assumption. I did not want to change fee
semantics app-wide under a step-5 commit.

### Table semantics · **accepted**

`querySelectorAll('th, thead').length === 0` also banned `th scope="row"` — a
**row** header, which is not a column. Your instruction was *no column header*;
my assertion enforced *no table semantics*. Narrowed to `thead` and
column-scoped `th`; a future row header is now permitted. Old assertion text and
the reason are recorded inline in the test file, not only in the commit body.

The block still uses divs, so accessible row labels are available but not yet
taken — a real conversion, not a step-5 edit.

### Dark-theme legibility · **measured; you were right; not changed**

Taking "measure actual contrast before judging compliance" literally:

| pairing | ratio | AA 4.5:1 |
| --- | --- | --- |
| `--text-muted` `#6b6960` on light `#f2f1ed` | **4.87** | pass |
| `--text-muted` `#78766f` on dark surface `#21201a` | **3.59** | **fail** |
| `--text-muted` `#78766f` on dark bg `#111009` | **4.19** | **fail** |
| `--text` on dark surface | 10.80 | pass |
| `--orange` on `--orange-bg` (dark) | 6.59 | pass |

Nothing here is "large text" for WCAG — labels are `.9rem`, the note `.8rem` —
so 4.5:1 is the bar and the 3:1 allowance does not apply.

The failure is **not the fee block's**. `--text-muted` has **242 usages** and is
below AA on *both* dark backgrounds, so every muted label in the app fails in
dark mode and none fail in light. The fee breakdown only made it visible by
stacking five muted labels in a row.

**Not changed, and I want your call.** Lifting one token in the dark block
repaints 242 usages inside a step-5 fee commit, and some are on the do-not-touch
list. Minimum that clears AA on the tighter surface is `#8a887f` (4.59 / 5.36);
`#918f86` gives more headroom (5.04 / 5.88). Written up in
`audit/CSS_TOKEN_DEBT.md`.

### "eBay · Fixed price" display label · **declined, with the reason**

This conflicts with an accepted decision. The review screen shows the raw slot
exactly as the drafts list shows it; a friendlier label needs a client-side
venue copy table, which is on the do-not-do list, and the list would then
disagree with this screen — the same duplicate-vocabulary defect this whole
packet is about. If the friendly name is wanted it should be server-supplied
alongside the slot, which is a contract amendment, not a rendering change.

### Independent fee anchors · **already exist**

> "DOM-to-model equality proves correct wiring, not the fee schedule's accuracy."

Agreed, and this was already covered before step 5 — `tests/fee-truth-offline.mjs`,
59 checks, whose header states the point in almost your words:

> *"Expected values below are hand-computed from each venue's PUBLISHED fee
> schedule, NOT read back out of the app. That is deliberate: the previous
> harness compared the code against expectations derived from the same code, so
> it could never catch a wrong rate."*

It carries the source URLs, covers eBay specifically (`:251-259`, `:342-347`),
asserts the fee base is item + shipping + tax(0) (`:253`), the `13.25% + $0.40`
formula string (`:254`), the no-store / not-Top-Rated default (`:259`) and the
Top Rated arithmetic (`:347`). It passes. What is **not** yet covered: the $10
per-order boundary and the $7,500 tier boundary as explicit boundary cases.
Adding those in step 6.

---

## Step 6 — what I accept as closeout

Accepted from your list: register `draft-review-screen.mjs` in the runner;
resolve `asset-fingerprints` by re-deriving the hash rather than weakening the
guard; name the commit; report executed suites separately from skipped live
gates; verify the registered suite resolves the bundle `index.html` actually
loads.

On the intentional red — agreed it is not closure evidence, and it will not be
bypassed. It is held red because the bundle is renamed once, at the end of D3,
and the fingerprint test is what will prove the rename landed. Green before the
rename would mean the guard was not watching.

Also going in: the $10 and $7,500 boundary cases; a case proving another scanned
card's shipping cannot move this draft's estimate.

---

## Answers to the standing questions

- **Commit:** `bc83222`. Step 5 proper was `f01b9ad`.
- **Full-suite run:** not yet — `tests/run-all.sh` reaches production and is not
  run locally by standing instruction. Step 6 will report per-suite results from
  a clean checkpoint. Executed this round: `draft-review-screen` 133/0,
  `draft-list-screen` 101/0, `draft-focus` 56/0, `fee-truth-offline` pass.
  Not run: `ebay-live` (live gate, last known 18/19), `asset-fingerprints`
  (held red at 14/1).
- **Credential rotation:** **not done.** The Cert ID has not been rotated, the
  Vercel env var has not been updated in either environment, and the recovery
  ref still exists. The push gate stands: nothing is pushed before rotation.
  The five Vercel dashboard questions are still unanswered.
- **Deployment:** none, and none requested.

---

## Open, carried forward

- Top Rated discount may be a listing entitlement, not a seller attribute — app-wide, decision needed
- `--text-muted` below AA in dark across 242 usages — decision needed
- Packet wiring unbuilt, so `hasPacket` is constant-false and price provenance is unreachable
- Row headers available but not taken in the fee table
- `$10` and `$7,500` boundary cases not yet in `fee-truth-offline`
- `draft-review-screen.mjs` unregistered; citation-map tool unregistered
- Bundle rename outstanding as D3's closing action
