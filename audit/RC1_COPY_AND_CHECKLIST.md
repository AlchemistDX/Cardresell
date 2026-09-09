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

**The ranking surface already models shipping in full.** `js/core.66c39922.js:8549`
computes `netPayout = price + effectiveShipCharge − totalFees − p.sellerShip`,
where `effectiveShipCharge` is zeroed per venue when the venue keeps buyer
shipping (`:8547`, driven by `buyerShippingRevenue: false` on the venues that
do), and `sellerShip` is set per venue — `shipCost`, `0` for TCGplayer Direct
(`:8365`), `intlShipCost()` for the international venue (`:8460`). Both inputs
come from seller-entered fields (`:8323`). Its total row is labelled **"Net
after all deductions"** (`:9015`), and that label is accurate.

**So shipping cannot reorder the recommendation, because the recommendation
already includes it.** Applying your "Estimated payout before shipping" label to
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
| G10 | §1 copy approved and implemented | **Open** |

R4 is **not** a gate. It is inactive in this release and marked so.

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

Nothing pushed, nothing deployed, no credential rotated.
