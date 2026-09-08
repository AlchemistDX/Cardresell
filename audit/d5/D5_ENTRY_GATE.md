# D5 entry gate — the eBay continuation control

**Date:** 2026-09-08 · **Branch:** `phase1-block-d` · **HEAD:** `5b17b4a` · **Live bundle:** `js/core.84f79a1f.js`
**Nothing built yet.** This is the evidence pass before writing the control, and it
changed what the control should be twice. **Not pushed, not deployed.**

Requirement (`audit/CARDRESELL_PLAN_AND_ROADMAP.md:559`): *"One-tap field copying and
eBay continuation; no publish control."* Copying shipped in D3. This gate is about the
continuation, and about one production defect found while establishing what
continuation can honestly mean.

---

## 1. The shipped sell link is dead

`_renderScanMissPanel` builds a companion sell link
(`js/core.84f79a1f.js:14723-14725`):

```
https://www.ebay.com/sell/listing?flow=startSell&presetNameSearchQuery=${ebayQ}
```

`audit/reviewer62/GROUP_D_ACCOUNT.md:141` called this "a genuine prefilled sell-flow
deep link", with the caveat at `:334` that it was never runtime-verified. It is now
verified, and the caveat was the important half.

**Observed, four times, from a clean browser:** that URL answers `307` and lands on
`https://www.ebay.com/sl/sell` — eBay's generic selling home page. The query string is
**dropped entirely**. Tested bare, and with our EPN parameters attached; same result
both ways. A seller who taps "list it anyway" today gets a marketing page and types
their card in from scratch.

**What is not established:** every probe was logged out, US site, from a cloud browser.
A signed-in seller could in principle be routed differently. The redirect happens
before any sign-in step, and the `ru=` parameter eBay builds for the challenge carries
the original URL rather than a rewritten one, so a routing difference by auth state
would be surprising — **but it is unverified, and it is the one thing a logged-in
device could check in about a minute.**

This is a live-site defect, not a D5 feature gap. It is filed here because D5 is where
it was found and because D5 must not copy the dead pattern into a second place.

## 2. What eBay's flow actually accepts, observed rather than guessed

The parameter name was not invented or looked up. eBay's own start page was driven:
`https://www.ebay.com/sl/prelist/suggest` → its "Tell us what you're selling" box →
Search. The URL **eBay itself produced**:

```
https://www.ebay.com/sl/prelist/identify
  ?title=Charizard+ex+223%2F197+Obsidian+Flames
  &caty=183454
  &catyIdPath[]=220&catyIdPath[]=2536&catyIdPath[]=183454
  &isUid=false&sr=sug&radixTrackingId=<uuid>
```

Reduced by testing, not by reading:

| Shape | Result |
|---|---|
| `?title=<query>` alone | Lands on **Find a match**, product-library picks correct |
| `?title=<query>&caty=183454` | Same, and the breadcrumb pins to *Toys & Hobbies › Collectible Card Games › CCG Individual Cards* |
| plus `mkcid/mkrid/campid/toolid/mkevt/customid` | Page renders normally; parameters are carried, not rejected |
| `catyIdPath[]`, `isUid`, `sr`, `radixTrackingId` | Not needed for the page to work — `radixTrackingId` is a per-session id we have no business minting |

So the honest deep link is **`title` plus `caty`**, and nothing else. `183454` is the
CCG Individual Cards category this codebase already uses for search
(`js/core.84f79a1f.js:14718`), so no new constant is introduced.

The page also offers **"Continue without match"**, which matters: a seed that fails to
match is not a dead end for the seller.

## 3. The matcher is not deterministic, and that decides the copy

Six cards, probed with and without our set name (12 loads):

| Seed | name + number | name + number + set |
|---|---|---|
| Charizard ex 223/197 · Obsidian Flames | **no picks** | matched |
| Umbreon ex 161/131 · Prismatic Evolutions | matched | matched |
| Pikachu ex 238/191 · Surging Sparks | matched | matched |
| Iono 254/193 · Paldea Evolved | matched | matched |
| Kyurem ex 165/086 · Black Bolt | matched | matched |
| Mew ex 232/165 · 151 | matched (to 205/165) | matched (to 205/165) |

**The same query returned different results minutes apart.** `Kyurem ex 165/086` with
no set name returned *no* product-library picks on the first probe and matched on the
second, with no change to the request. Any "it matches N% of the time" claim from this
data would be a number invented from an unstable measurement, so none is stated.

Two things do follow:

- **Including our set name never hurt in any observed pair, and rescued one.** The
  older in-code comment that set names hurt (`js/core.84f79a1f.js:5684`) was about
  eBay's `/sch` **sold-comps search**, where over-constraining kills results. The
  prelist matcher is a different endpoint and behaved the other way. Both can be true;
  they are different systems and should not share a seed rule by analogy.
- **The control cannot promise a match.** "We'll fill in your listing" is not a claim
  this evidence supports even once, let alone reliably. What the link reliably does is
  open eBay's listing flow with the card details as the starting query.

Also observed: `Mew ex 232/165` matched to `205/165`. Our number and eBay's number
disagree, and eBay's matcher answered anyway with a **different card number**. The
seller must be able to see what they are being handed, which is an argument for the
seed text being visible rather than buried in an href.

## 4. What D5 is, given the above

A single link on the review screen, below the copy row, that opens eBay's listing flow
in a new tab with the card as the starting query. It records nothing, submits nothing,
and there is no publish control — unchanged, and it stays that way.

Constraints already binding, carried in:

- **One builder** (rule 1). The scan-miss panel and the review screen must call the
  same URL builder. Today the scan-miss URL is assembled inline; D5 extracts it and
  fixes it in one place rather than adding a second sell-link expression.
- **Server-derived seed.** The packet already carries `identity.displayName`,
  `identity.number` and `identity.displaySetName` (`api/_cardIdentity.js:444-467`), so
  the seed comes from the same identity the title and SKU come from. No new client-side
  card-name parsing.
- **Gated like the copy buttons.** `_reviewCopyPayload` refuses when the packet is
  unusable or carries a blocking finding (`js/core.84f79a1f.js:22074-22079`). A
  continuation control that stays live while copy is refused would hand the seller into
  eBay with the thing the finding names still wrong.
- **No automation.** A link the seller clicks. No headless listing, no DOM injection,
  no credentials.

## 5. Decisions this gate needs before any code

1. **EPN parameters on a seller-flow link — keep or drop?** They technically survive
   (§2). But EPN is a buyer-side program, and that a *seller* arriving at a listing
   flow is a commissionable event is **unverified**. This project's own standard —
   don't ship a claim the evidence doesn't carry — points at dropping them here and
   keeping them on buy-side links, where the commission model is the documented one.
   This is a revenue decision, so it is the owner's, not mine.
2. **Seed = name + number + set?** §3's evidence supports it and nothing observed
   argues against it for this endpoint. Confirm, because it contradicts a comment in
   our own code written about a different endpoint.
3. **Does the seed text show on screen?** Recommended yes, given the `232/165 → 205/165`
   observation: the seller sees the query they are being sent with, next to the link.
4. **Fix the scan-miss link in this pass, or file it separately?** It is a one-line
   change once the builder exists, and leaving a known-dead link live while shipping a
   working one next to it is the kind of split this codebase keeps paying for.

## 6. What this gate does NOT establish

- **Nothing about the signed-in experience.** Every observation is logged out. Whether
  a signed-in seller lands on the same identify screen, and whether the match quality
  differs with account context, is unverified from here.
- **Nothing about eBay's stability.** The legacy link worked well enough for someone to
  ship it and is dead now. Whatever D5 ships can die the same way, silently, because
  nothing in our suites can see eBay. Any test written for D5 asserts **the URL we
  build**, not that eBay honours it — and that limit belongs in the test's own words.
- **No rate, no percentage.** §3 explains why.
- **Nothing about other venues.** This is eBay only, which is the first integration,
  not the destination.
