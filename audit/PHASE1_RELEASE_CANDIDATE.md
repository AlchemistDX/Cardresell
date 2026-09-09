# Phase 1 — Release candidate scope

**Date:** 2026-09-09 · Purpose: turn the remaining Phase 1 seller work into a
release candidate instead of a growing list. Every state claim below is from
code at `0f78dfe`, branch `phase1-block-d`.

---

## 1. What is done and would ship

| Block | State |
| --- | --- |
| D1 Sell entry point | Closed |
| D2 Draft creation + list API | Closed, contract frozen |
| D3 Review screen, fields, fee breakdown | Closed |
| D4 Number provenance | Closed |
| D5 eBay continuation (single control) | Closed, verified signed-in |
| D6 New-seller / restriction guidance | Closed |
| D7 Browser-local listing photos | Closed |
| CH-3 R2 + R3 (proxy hardening) | Built, tested, **not deployed** |
| CH-3 R4 (cache + aggregate budget) | Built against mocks, **not wired** |

Suites: 51 registered slots, registry meta-test green.

---

## 2. The four open items, with their real code state

I checked rather than trusting the running list, and two of the four are not
what the list implies.

**Target-net wiring — engine built, no caller.** `listPriceForTargetNet` exists
and is tested (`tests/listing-packet-offline.mjs:366,399,450,461`), and
`api/_listingPacket.js:769-775` already handles both arms of a target-net
request. What is missing is only the surface that supplies `ctx.targetNet` —
`:761` records that it "has no caller outside tests".

**⚠ This contradicts a carried decision.** "`listPriceForTargetNet` NEVER WIRED"
sits in the do-not-reopen list, while "target-net wiring" sits in the open list.
Both cannot hold. **Owner decision needed** — see Q-RC-1.

**Shipping economics — not started.** There is **no** shipping logic anywhere in
`api/`: zero matches in `_listingPacket.js`. This is the item with the widest
blast radius, because it is the same gap as the open "net is item-price-only"
caveat. See §3.

**Listing description text — not started.** No `itemDescription` producer in
`api/`.

**Condition guidance text — not started.** No `conditionGuidance` producer in
`api/`.

---

## 3. The one item that changes what the product claims

Everything else on the list is additive. Shipping is not.

The product's premise is a **venue-neutral recommendation based on seller-specific
net**. Net today is **item-price-only**. Venues differ in who pays shipping, in
whether shipping is inside the fee base, and in whether it is inside the tax
base — the outgoing bundle already records two venues whose tax base "includes
buyer-paid shipping and sales tax" (`js/core.66c39922.js:6433,6479`) and one
whose 5% fee is "on merchandise only, NOT shipping" (`:6493`).

So shipping does not shift every payout by the same amount. **It can reorder
them** — which means it can change the recommendation itself, not just the
number beside it.

**This is the release-candidate question, and it is a business call, not an
engineering one:** does Phase 1 ship a recommendation that excludes shipping,
with the exclusion disclosed on the surface where the comparison is made? Or
does shipping become the last blocking item?

Both are defensible. Shipping-excluded-and-disclosed ships sooner and is honest,
but "best payout" means "best before shipping", and a seller acting on it can be
wrong. Blocking on shipping is correct but is the largest unbuilt item here.

---

## 4. Proposed release candidate

**RC-1 — ships Phase 1 on what exists.**

- In: D1–D7, plus a disclosure on the comparison surface stating that net
  excludes shipping.
- Out: target-net wiring, description text, condition guidance — all additive,
  none of them changes an existing number.
- Requires: the disclosure text, and Q-RC-1 resolved so the contradiction is not
  shipped as ambiguity.

**RC-2 — the follow-on**, in this order:

1. Shipping economics into the fee/tax base per venue, and the recommendation
   recomputed against it. Largest item; changes existing numbers, so it needs
   the same provenance discipline D4 established.
2. Condition guidance text — small, and it reduces returns.
3. Description text — small.
4. Target-net wiring, if Q-RC-1 says wire it.

Separately tracked, not part of either: CH-3 R1 (provider rotation), deployment
of R2/R3, wiring of R4, the eBay maintenance window, and the PriceCharting
review.

---

## 5. Questions

**Q-RC-1 — Is `listPriceForTargetNet` wired or not?** The two lists contradict
each other. My read: the engine is built and tested, so wiring it is a small
surface change — but it was explicitly decided against once, and I will not
quietly reverse that. Which stands?

**Q-RC-2 — RC-1 or RC-2 for Phase 1?** Ship shipping-excluded with disclosure,
or hold Phase 1 until shipping lands? My recommendation is **RC-1 with the
disclosure**, on the grounds that the exclusion is disclosable and the
alternative delays every finished block behind the largest unbuilt one — but
this is your call, since it decides what "best payout" means to a seller.

**Q-RC-3 — If RC-1, where does the disclosure sit?** The comparison surface is
where the decision is made, so that is where I would put it, matching the
disclosure-ownership pattern already established.

---

## 6. Status

Nothing pushed, nothing deployed, no credential rotated. This is a scope
proposal; no code changed for it.
