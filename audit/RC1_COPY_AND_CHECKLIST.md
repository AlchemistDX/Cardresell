# RC-1 — comparison copy and release checklist

**Date:** 2026-09-09 · commit `15aa143`, branch `phase1-block-d`
Scope: the copy for the initial Phase 1 release, and the checklist of what
ships, what is deferred, and which gates are open. No deployment authorization
is claimed or implied.

---

## 0. Correction first — my §3 was wrong, and it changes the copy you specified

Your Q-RC-3 instruction was premised on my claim that net excludes shipping and
that shipping could therefore reorder the recommendation. **I checked the
client, and that claim is wrong in both halves.** I had grepped `api/` only and
generalised from an empty result.

**The ranking surface already models shipping in full.** `js/core.73a71fac.js:8549`
computes `netPayout = price + effectiveShipCharge − totalFees − p.sellerShip`,
where `effectiveShipCharge` is zeroed per venue when the venue keeps buyer
shipping (`:8547`, driven by `buyerShippingRevenue: false` on the venues that
do), and `sellerShip` is set per venue — `shipCost`, `0` for TCGplayer Direct
(`:8365`), `intlShipCost()` for the international venue (`:8460`). Both inputs
come from seller-entered fields (`:8323`). Its total row is labelled **"Net
after all deductions"** (`:9015`), and that label is accurate.

**Corrected wording (2026-09-09, review).** I wrote that shipping "cannot
reorder the recommendation." That is wrong as stated: shipping *can* affect
venue ordering — it plainly does, since venues differ in whether they keep buyer
shipping and in what postage costs. The accurate claim is narrower: **the
ranking already accounts for shipping, so the ordering it shows is not missing
that effect.** And the formula establishes the *shipping treatment*, not the
broader claim that every deduction is covered — tax remains unmodelled by
design, and two venues still lack a declared `feeBase`. Applying your "Estimated payout before shipping" label to
that surface would make a true number read as a qualified one. I have not
applied it there.

**The review screen already carries the qualification you asked for.** It renders
"Estimated net" with an "item price only" qualifier and a total row reading
**"Estimated net (item only)"** (`:21992-22028`). The code comment at `:21906`
records the reasoning explicitly: it cannot borrow "Net after all deductions"
"because it models seller shipping, and this screen does not, so borrowing that
label would claim a completeness the number lacks."

**What is actually true:** the item-only net belongs to the *connected-selling
review screen*, not to the comparison. `api/_listingPacket.js` has no shipping
term. The gap is narrower than I described and sits somewhere else — §1.

**Consequences for the RC doc:** §3 of `PHASE1_RELEASE_CANDIDATE.md` is
withdrawn. "Shipping economics" is not an unstarted feature; it is unmodelled in
one specific surface. Its RC-2 priority is a genuine question again, since the
surface where a seller picks a venue already has it.

---

## 1. The real residual risk, and the copy that addresses it

One product now shows a seller two different net figures for the same card:

| Surface | Number | Includes shipping? | Current label |
| --- | --- | --- | --- |
| Venue ranking / best-payout badge | `netPayout` | **Yes** — buyer revenue and seller cost, per venue | "Net after all deductions" |
| Connected-selling review screen | packet net | **No** | "Estimated net (item only)" |

Both labels are individually honest. **Neither tells the seller the two numbers
answer different questions**, so a seller who ranks eBay best at one figure and
then sees a different figure on the review screen has no way to know which is
the comparable one. That is the risk worth writing copy for — not a missing
qualifier, but an unexplained discrepancy between two qualified numbers.

### Proposed copy — review screen only

Placed on the review screen's fee block, adjacent to the existing "Estimated net
(item only)" total, reusing the established `review-fees-note` mechanism rather
than inventing a surface:

> **Not the same as the payout comparison.** This figure covers the item price
> only. The venue comparison also counts what the buyer pays for shipping and
> what postage costs you, so its number will differ. Use the comparison to
> choose where to sell.

Nothing changes on the ranking surface. Its label is correct.

**Not adopted, and why:** your "Estimated payout before shipping" wording with
"They may change which venue pays you most." The first half fits the review
screen but the second half is a claim about venue ordering, and the review
screen does not rank venues — the surface that does already includes shipping.
Saying it there would describe a defect the product does not have.

**Open for your call:** whether you still want a qualifier on the ranking
surface for the inputs a seller may leave at zero. If `shipCharge` and
`shipCost` are blank, "Net after all deductions" is arithmetically true but rests
on unentered assumptions. I have not written copy for that because I have not
established what the fields default to or whether the UI prompts for them.
**Unverified.**

---

## 2. Description and condition guidance — you were right to push

I called shipping the only item affecting product claims. That was also wrong,
for the reason you gave: if the interface promises a complete or ready-to-publish
listing, missing description and condition text is a broken promise.

**Checked the wording.** The entry control says **"Start a listing draft for this
card"** (`:20853-20854`), the failure toast says "Couldn't start the listing
draft" (`:20796`), and the screen is titled as a review of a draft. The packet
surface already states when a title was truncated for a venue and names what was
dropped (`:22574`).

**So the interface consistently promises a *draft*, not a finished listing.**
Nothing found claims completeness or readiness to publish. That makes shipping
RC-1 without description or condition text defensible on the wording that
exists — but it is now a constraint on RC-1, not an accident: **no RC-1 copy may
describe the output as complete, ready to publish, or ready to list.**

---

## 3. What ships in the Phase 1 initial release

Named as you asked — an initial release with deferred work visible, not a
silently smaller Phase 1.

**Included:**

| Item | State |
| --- | --- |
| D1 Sell entry point | Closed |
| D2 Draft creation, list API (frozen contract) | Closed |
| D3 Review screen, field rendering, fee breakdown | Closed |
| D4 Number provenance | Closed |
| D5 eBay continuation, verified signed-in | Closed |
| D6 New-seller and restriction guidance | Closed |
| D7 Browser-local listing photos | Closed |
| CH-3 R2 proxy contract validation | Built, tested, **in this deployment manifest** |
| CH-3 R3 cache-header correction | Built, tested, **in this deployment manifest** |
| §1 review-screen copy | **To write, pending your approval of the wording** |

**Deployment manifest:** the release deploys one commit carrying D1–D7 **and**
R2/R3 together. R2/R3 are not a separate deployment — they are part of what this
release ships, as you directed.

**Deferred, and visible:**

| Deferred item | Why | Reopened by |
| --- | --- | --- |
| Target-net user entry | Engine implemented and tested; entry surface deferred | Product decision |
| Shipping in the listing packet | Ranking surface already models it; packet does not | §1 discrepancy, if copy proves insufficient |
| Listing description text | Interface promises a draft, not a listing | Any copy claiming completeness |
| Condition guidance text | Same | Same |
| CH-3 R4 activation | **Inactive** — built, wired, no store injected | KV isolation |

Per Q-RC-1, the target-net record now reads **"engine implemented and tested;
user entry deferred."** I checked the original decision text and it states the
implementation state rather than a prohibition, so no prohibition is preserved.

---

## 4. Release gates — all open

| # | Gate | State |
| --- | --- | --- |
| G1 | Production KV isolated from nonproduction | **Open** |
| G2 | eBay Cert ID rotated at the provider, production-only | **Open** — owner action, needs Will's go |
| G3 | Verification token regenerated, production-only | **Open** |
| G4 | Exact live Phase 0 commit rebuilt with new configuration (**not** a promotion of an existing deployment) | **Open** |
| G5 | `node tools/verify-challenge.mjs` PASSES — READY is not proof | **Open** |
| G6 | eBay portal save and challenge completed | **Open** |
| G7 | `bash tools/run-ebay-live.sh` recorded and adjudicated | **Open** |
| G8 | Containment control verified (gates steps 11a–13) | **Open** |
| G9 | Release validation queue RV-1…RV-10 adjudicated, warnings and skips explicit | **Open** |
| G10 | §1 copy approved and implemented | **Closed** — implemented, pinned (§7) |
| G11 | **TPL paid key rotated** at the provider and stored non-plain | **Open** — owner action |
| G12 | **R4 activated**: `TPL_BUDGET_ENFORCE=1`, KV store bound, budget numbers set by Will | **Open** |

**G11 and G12 are corrections, and the reason matters.** My previous version
said "R4 is not a gate" and listed ten gates. That was wrong in effect: with R4
inactive and no rotation item, the exposed paid key vanished from the visible
gate list entirely, so a reader working the checklist would have shipped without
ever confronting it. **Disabling R4 is a scope choice; it does not resolve CH-3's
cost exposure.** The key is still exposed and still paid for. R4 is not a gate on
*functioning*, but rotation and activation are gates on *the exposure*, and they
are now named where they cannot be missed.

---

## 5. R4 status in this release

Built, corrected against your two points, and wired to the proxy — but shipping
**inactive**.

- Unusable configuration now **blocks** the call rather than reporting itself:
  `usable = configured && no invalid keys`, and `reserveUpstream` returns
  `NOT_CONFIGURED` instead of `RESERVED`. Garbage never activates a placeholder.
  A fresh cached value is still served with no configuration, since reading is
  not spending.
- Refunds are narrowed on both axes you named. A call that left the process is
  never refunded — a timeout or 5xx may still have consumed provider quota. And
  a reservation carries its `windowId`, so a refund arriving after the window
  rolled is refused rather than crediting the new window with allowance the old
  one paid for. Both asserted.
- The calling path is exercised offline against an injected mock: cache hit
  spends nothing, reordered parameters hit one entry, exhaustion returns 503
  naming `budget_exhausted` rather than an empty 200, and an upstream timeout
  keeps its reservation.
- With no store injected the route behaves exactly as before R4. Activation
  needs G1 plus your budget numbers, which I am not inventing.

71 passed, 0 failed. No KV, no provider call, no quota consumed.

---

## 6. Decisions needed

1. **§1 copy** — approve, amend, or reject the review-screen wording.
2. **Ranking-surface qualifier** — do you want one for unentered shipping
   inputs? I would need to establish the field defaults first.
3. **RC-2 order** — with shipping already modelled in the ranking surface, is
   packet shipping still the top follow-on, or do condition guidance and
   description move ahead of it?

---

## 7. Implemented since the last packet

**Review-screen copy — your wording, verbatim** (`js/core.73a71fac.js:7652`,
rendered at `:22073`). Added to `FEE_DISCLOSURE` rather than typed inline, so it
cannot drift the way the tax copy did. Pinned by five assertions in
`tests/copy-truth-offline.mjs`: that it says what the estimate covers, that it
names the comparison as the shipping-inclusive surface, that it says **"may
differ"**, that it **never** says "will differ", and that it does not attribute
the discrepancy to shipping. All read comment-stripped source, so a comment
cannot satisfy them.

**Shipping-field defaults — checked, and one was invisible.** Established:

| State | Value used | Visible to the seller? |
| --- | --- | --- |
| Default on load | `0` | **Yes** — the field renders `value="0"` (`index.html:2509`, `:2515`) |
| Seller types `0` | `0` | **Yes** — they made the assumption by making it |
| Seller **clears** the field | `0` | **No** — field looks empty, ranking uses `0` |
| Saved value | **none exists** | n/a |

There is no persistence: nothing writes `shipCharge` or `shipCost` to
`localStorage`, so there is no saved state and every session starts at the
rendered `0`. "Blank" therefore only ever means the seller cleared it.

`parseFloat(v) || 0` collapsed all three states into one number. The arithmetic
was right — zero *is* the correct assumption absent an input — but the cleared
field made it silently. Blankness is now tracked separately from the value
(`:8350-8355`, read at `:8357-8358`) and stated beside the comparison it feeds (`:8720`): "Shipping: what the
buyer pays is blank, so this ranking assumes $0. Venues differ in how shipping
is treated, so entering it can change the order." An intentionally entered `0`
is **not** flagged. New style uses declared tokens only.

**R4 modes pinned separately** (`api/tpl-proxy.js`). Enablement is now explicit
and independent of binding:

| `TPL_BUDGET_ENFORCE` | Store | Mode | Behaviour |
| --- | --- | --- | --- |
| unset / `0` | none | `DISABLED` | Unmetered, by choice — pre-R4 behaviour |
| `1` | none | `ENABLED_UNBOUND` | **503 `budget_store_unbound`, no paid call** |
| `1` | bound | `ENFORCING` | Metered |

Eleven assertions, section 11 of `tests/tpl-budget-offline.mjs`. The one that
matters: with enforcement on and no store, the provider `fetch` counter does not
move. An operator who turned the control on is entitled to assume it is on, so a
missing binding fails closed instead of restoring the unmetered path — the worst
possible response to a misconfigured control, because nothing would look wrong.
`budget_store_unbound` is distinct from `budget_exhausted` so a
misconfiguration cannot read as a spent budget.

---

## 8. Release validation — results

Fourteen suites, run individually (never `run-all.sh`).

| Suite | Result |
| --- | --- |
| `tpl-budget-offline` | **82 passed, 0 failed** (was 71; +11 mode cases) |
| `tpl-proxy-offline` | 65 passed, 0 failed |
| `draft-review-screen` | 370 passed, 0 failed |
| `listing-packet-offline` | 232 passed, 0 failed |
| `review-fee-dl` | 21 passed, 0 failed |
| `copy-truth-offline` | all passed (+12 new) |
| `payout-honesty` | 32 passed, 0 failed |
| `accuracy-fee-parity` | 41 passed, 0 failed |
| `fee-truth-offline` | **was FAILING before this work** — see below |
| `contrast-tokens` | 12 passed, 0 failed |
| `decision-restatements` | 34 passed, 0 failed |
| `asset-fingerprints` | **70 passed, 0 failed** after two forced repairs |
| `test-registry` | 12 passed, 0 failed |

### Two findings, neither caused by the RC-1 edits

**1. `fee-truth-offline` was already red.** I confirmed by stashing my changes
and re-running: it failed identically at `HEAD`. So it has been failing for at
least one commit and was reported as green somewhere it should not have been.

It failed on its **evidence, not its behaviour**. The assertion pinned the two
vocabulary reads as adjacent template interpolations within 120 characters. The
disclosure was later refactored into `venueTaxNote(pid)` (`:6873`), which reads
the same fields and returns a `{label, qualifier}` pair for every surface — a
*stronger* version of what the assertion wanted, and it broke the assertion.
Rewritten per the standing pattern: the helper reads the shared vocabulary, the
ranking path takes its note from the helper (`:8605`), and each literal string
occurs exactly once, so a surface that starts restating the copy fails. Now
green on behaviour rather than on shape.

**2. Bundle rename forced, twice.** Editing the bundle invalidated its
content-addressed name. `js/core.66c39922.js` → **`js/core.73a71fac.js`**, with
references updated in `index.html`, `api/_tplContract.js`,
`tests/tpl-proxy-offline.mjs`, `tests/draft-review-screen.mjs`. My first attempt
used `git mv`, which *removed* the retired bundle — the suite caught it and I
restored the retired bytes from `HEAD`. Retired bundles stay on disk because
audit documents cite line numbers in them.

**Not run and still outstanding:** `draft-kv-live` and `ebay-live` (both need
live credentials and the closed gates), and RV-1…RV-10 remain unadjudicated as a
set. The headless-Chromium-only coverage limit is unchanged, so Q-D5-5 is still
unexercised on desktop.

---

## 9. Outstanding owner actions — only you can do these

1. **Rotate the TPL paid key** at the provider; store it non-`plain`. Exposed now (G11).
2. **Rotate the eBay Cert ID** and **regenerate the verification token**, production-only (G2, G3).
3. **Isolate production KV** from nonproduction (G1) — also unblocks R4.
4. **Set the R4 budget numbers.** `BUDGET_DEFAULTS` (1000/hr, 60/IP) are placeholders I invented as shape, not policy. I will not guess your spend ceiling.
5. **Authorize the deployment.** ~235 commits outgoing; pushing `main` auto-deploys.
6. **Decide RC-2 order.** Recorded as: packet shipping carrying the seller's existing assumptions into the draft, then condition guidance, then description text. Target-net entry stays deferred.

## 10. Decisions taken this round — recorded, not reopened

- Ranking relabel **withdrawn** at your instruction; ranking and packet
  calculations stay distinct until they share inputs.
- Review copy: your shorter wording, adopted verbatim.
- Shipping defaults: bounded implementation check, done — the blank case was the
  live one.
- RC-2 order: packet shipping → condition guidance → description text.

Nothing pushed, nothing deployed, no credential rotated. Nothing here was taken
as authorization for either.
