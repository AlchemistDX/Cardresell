# D5 entry gate — the eBay continuation control

**Date:** 2026-09-08 · **Branch:** `phase1-block-d` · **HEAD:** `5b17b4a` (gate) · **Live bundle at writing:** `js/core.84f79a1f.js` — now `js/core.7629ec69.js`, see §7
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

---

## 7. Closeout — the four decisions, taken, and what shipped

**Bundle:** the live bundle is now `js/core.7629ec69.js` (generation 9). Every
`84f79a1f` citation above still resolves: that file is **retained on disk** with
bytes matching its own name, per the retention rule generation 8 added, and
`audit/BUNDLE_CITATION_MAP.md` records the rename. Line numbers moved by roughly
+60 in the new generation; the symbol names below are the durable citation.

### 7.1 The decisions

| # | Question (§5) | Decision | Ground |
|---|---|---|---|
| 1 | EPN on the seller link | **Dropped — on this link only.** Buy-side links keep their tracking. | EPN pays on a **buyer's qualifying purchase** ([eBay Partner Network overview](https://listperfectly.com/selling/ebay-affiliate-program-the-ebay-partner-network-aka-epn/), [eBay Seller Center](https://www.ebay.com/sellercenter/growth/ebay-partner-network)). A seller opening a listing form is not a purchase, so there is no commissionable action to attribute. Tagging it anyway earns nothing and puts traffic of a kind the program does not describe under the account that does earn. |
| 2 | Seed = name + number + set | **Yes.** | §3: 6/6 matched with the set name, 5/6 without. The contradicting comment in our own code (`5684` in the old generation) was written about `/sch`, the buy-side search endpoint — two endpoints, two measured behaviours, and the builder says so in its own comment. |
| 3 | Show the seed on screen | **Yes.** | eBay answered `Mew ex 232/165` with a library match on `205/165`. A seller who can read the query they are being sent with can catch that on arrival; one who cannot, cannot. |
| 4 | Fix the dead scan-miss link now | **Yes, in this pass.** | One line once the shared builder exists. Leaving a known-dead link live next to a working one is the split this codebase keeps paying for. |

Decisions 1–4 were taken on the merits under the owner's standing instruction to
record such questions here and reserve interruptions for deploy authorization and
business/feature explanation. Decision 1 is the only one with a revenue edge, and
it is recorded here rather than assumed: it can be reversed by wrapping one call
in `buildEbayUrl`.

### 7.2 What shipped

**One builder pair, used by both callers** (Rule 1 — one behaviour, one implementation):

- `ebaySellSeed(parts)` — `js/core.7629ec69.js:5475`. Joins name, number, set.
  Strips a trailing `\d+/\d+` already glued to the name, so a catalogue row
  carrying `Charizard ex 223/197` does not produce the number twice.
- `buildEbaySellStartUrl(seed, categoryId)` — `:5494`. Returns
  `https://www.ebay.com/sl/prelist/identify?title=…` plus `&caty=…` when a
  category is supplied, and **`null` for an empty seed**. No EPN wrapper.

**Two surfaces:**

- **Scan miss** (`:14817`) — routes through the builder with category `183454`,
  and the CTA is now conditional on the builder returning a URL. Label changed
  from "List on eBay →" to "**Start a listing on eBay →**": we open a flow, we do
  not list.
- **Review screen** (`_reviewSellStart` `:22363`, `_reviewSellStartHtml` `:22385`,
  rendered at `:22327`) — gated on `packetUsable && !_reviewPacketBlocking().length`,
  the **same** two predicates as the copy row. Seed comes from the packet's own
  server-derived optional aspects (`api/_listingPacket.js` `buildOptionalAspects`),
  category from `pk.category.id` rather than a constant. The note names the seed,
  says eBay decides the match, and states that **nothing is listed or published
  until the seller does it there**. Empty seed → a `data-sell-start-absent` note
  instead of a link.
- **Styling** — `index.html:1161-1169`. A rule separates the continuation from the
  copy row on purpose: a fourth pill in that row would read as a fourth copy button.

**No publish control, no credential use, no server change.** The client builds a
URL and the seller clicks it.

### 7.3 Tests, and what they can honestly hold

`tests/deeplink-companions.js` — the assertion at the old line 52 pinned the dead
`presetNameSearchQuery` URL and was **rewritten with WAS/why lines in the file
itself**. That assertion was never false; the thing it asserted had stopped
working, which is the failure mode a source-regex suite cannot see. Replaced with
checks that no `ebay.com/sell/listing` URL is constructed anywhere, that each
builder is defined exactly once, that both callers reach eBay through them, that
the builder is not EPN-wrapped, and that it refuses an empty seed. 176/176.

`tests/draft-review-screen.mjs` — five new behavioural sections, 334/334 (up from
329). They assert the URL **we build** and the gate we build it behind. The one
end-to-end behaviour they do establish is the negative one: clicking hands the
seller to eBay in a new tab (read off an **aborted** route, so nothing leaves the
machine) and **writes nothing** — no draft call, no publish call, no write of any
kind. That claim is scoped to writes on purpose: an earlier version asserted zero
`/api/*` traffic and failed on `GET /api/stats`, `POST /api/events` and
`GET /api/tpl-proxy`, page-level timers unrelated to this control. The recorded
claim is narrower and true rather than broad and quietly weakened later.

Gate parity is asserted as the two controls appearing and disappearing **together**
across withdrawn / blocking / absent / usable, not as the continuation's own
absence — which would pass even if the gates drifted apart in the other direction.

One envelope in the empty-seed section is **modified rather than generated**, and
says so in the test: the real producer cannot emit a usable packet with no card
name, but a client can meet one, and Rule 2 says the silent omission is the bug.

**What no test here establishes:** that eBay honours the URL. Nothing in this repo
can reach eBay. §1 and §2 are browser evidence with a date on them, and they will
rot the same way the last link did.

### 7.4 Suites run (individually, offline)

| suite | result |
|---|---|
| `draft-review-screen.mjs` | 334 passed, 0 failed |
| `deeplink-companions.js` | 176 checks, 0 failures |
| `draft-store.mjs` | 147 passed, 0 failed |
| `draft-crud-e2e.mjs` | 192 passed, 0 failed |
| `listing-packet-offline.mjs` | 232 passed, 0 failed |
| `launch-audit-regressions.mjs` | 438 passed, 0 failed |
| `asset-fingerprints.mjs` | 58 passed, 0 failed |

Visual QA: review screen at 1280px and 390px, light and dark. No wrapping, no
overflow, no low-contrast text; the continuation reads as one control with its
note, separated from the copy row.

`asset-fingerprints.mjs` failed once during this pass, correctly: the retained
`84f79a1f` had been copied **after** the edits, so it held bytes that hashed to
`7629ec69`. Restored from `HEAD`. A retained file under a name it does not match
is worse than an absent one, and the suite said so in those words.

### 7.5 Still open after D5

- **eBay's signed-in continuation behaviour is unverified.** All evidence is
  logged out.
- **No match rate is stated anywhere**, and none should be until the matcher stops
  answering two different ways to one identical request (§3).
- The control is a hand-off, not an integration. The end state — scan it, find its
  best venue, sign in, sell it — needs the venue's own API, which D5 does not touch.

**Push and deployment remain blocked.** The Cert ID rotation gate is unchanged and
gates pushing, not editing.

---

## 8. Review response — the instruction, the seed's real job, and two reclassifications

A review of §7 made four points. Three changed the code or this document's
classification of an open item; the fourth changed what is recorded about a
decision without changing the decision.

### 8.1 "eBay decides the match" was a description, not an instruction — fixed

The finding, in the reviewer's words: the note gave the seller the *means* to
catch a mismatch and never told them to look. `232/165 → 205/165` is the identity
failure the scanner exists to prevent, arriving at the last step — everything
upstream can be correct and a seller who accepts eBay's match unread has still
listed against a different collector number than the one they scanned.

Worse, the seed printed beside a process description reads as reassurance that
something was sent, which is the opposite of its purpose. It only works if the
seller knows it is theirs to compare against.

**Both surfaces now lead with an imperative, in its own element, above the seed:**

> **Check that eBay picked the right card before you continue.** Compare the
> collector number on eBay's match to **074/073**.
>
> We send eBay this search: **Charizard VMAX 074/073 Champions Path**. Their
> matcher decides what it matches, it does not always answer the same way twice,
> and their catalogue sometimes disagrees with ours. Nothing is listed or
> published until you do it there yourself.

The number is named on its own rather than asking the seller to eyeball a
five-word string, because the number is the axis the hand-off can lose. The line
carries `data-packet-note-severity="WARNING"`, so it renders at full text weight
rather than as muted secondary copy — a warning that reads as a footnote is a
warning nobody performs.

The scan-miss panel gets the same imperative and says why it is *weaker* there:
that panel renders **because identification failed**, so the seed is only what
the scan read.

Assertions changed accordingly (`tests/draft-review-screen.mjs`, 338/338). The
old check was satisfied by the word "opens" appearing anywhere in the note — it
would have passed the copy the review just rejected. It now requires the
imperative, requires it *first* in the block, requires the collector number in
it, and requires the non-muted severity. `tests/deeplink-companions.js` asserts
the instruction exists on **both** surfaces (178/178).

### 8.2 Decision 3 is reclassified: the seed is the honesty mechanism

§7.1 justified showing the seed as letting a seller catch a mismatch on arrival.
That is true and too small. With a matcher that answered two different ways to
one identical request, **the seed is the only artifact CardResell can be held
to.** Past the link we cannot describe eBay's behaviour, cannot promise its
result, and cannot detect its failure. What we can do is state exactly what we
sent, in the seller's presence, and tell them to check the answer.

So decision 3 is not a UX nicety and must not be reversed as one. Removing the
seed from the screen would leave the feature making an identity claim it has no
means to support. Recorded here so a future tidy-up of "extra text under the
button" meets this paragraph first.

### 8.3 Signed-in behaviour is on the critical path — reclassified from footnote

§6 and §7.5 listed this as a qualifier. It is not: **every probe was logged out
and every real seller is signed in.** If eBay routes a signed-in seller
differently — Seller Hub, a restored draft, a different identify screen — then
the note naming the exact search describes something they never see, and §8.1's
instruction asks them to compare against a screen that is not in front of them.
That invalidates the feature's central claim rather than qualifying it.

**What indirect evidence exists** (indirect, and it does not close the question):
sellers report that listing creation now forces them to
`https://www.ebay.com/sl/prelist/suggest?sr=cubstart` ([eBay community thread](https://community.ebay.com/forum/selling-57920/topic/ebay-once-again-forcing-simplified-view-for-listing-creation-without-thinking-about-consequences-446013/)),
and creating a listing requires being signed in — so the `/sl/prelist/` family is
the signed-in seller path, and eBay's own account of the flow describes a catalog
match step feeding the listing page ([eBay Innovation Stories](https://innovation.ebayinc.com/stories/ebays-new-feature-lets-you-list-items-in-seconds/)).
That makes it *likely* `identify` is reachable signed in. It says nothing about
whether the `title` and `caty` parameters survive for a signed-in seller, which
is the part that matters, and the last link died precisely by dropping a query.

**Why I cannot close it from here.** A signed-in probe needs a real eBay seller
account. This project does not collect marketplace passwords and the cloud
browser has no logins, so the only instrument is the owner's own signed-in
browser. That is a five-minute check and it is the highest-value one left in D5:

1. Signed in to eBay, open
   `https://www.ebay.com/sl/prelist/identify?title=Charizard%20VMAX%20074%2F073%20Champions%20Path&caty=183454`
2. Does the identify/match screen appear, and does it show that search rather
   than an empty box or a restored draft?
3. Is the collector number on the offered match the one in the URL?
4. **After landing, is the query still in the address bar?** Added on review, and
   free once step 1 is done. If eBay strips or rewrites `title`/`caty` on a
   signed-in redirect, that is **the same failure mode as the dead scan-miss
   link** — a query dropped in transit — and it is visible in the same session
   without extra work. It is also the failure that §8.1's instruction cannot
   survive: a seller told to compare against a number we sent, on a screen that
   never received it, has been given a task they cannot perform.

**Status: Unverified — see `audit/d5/D5_SIGNED_IN_VERIFICATION.md` (2026-09-08)
for the logged-out baseline, the failed attempt to run this in the owner's
browser, and the pre-committed consequence for each outcome.** No claim in this document or in the shipped copy asserts
signed-in behaviour, and the shipped copy is written to survive being wrong about
it — it says what we send and tells the seller to check what arrives, neither of
which depends on which screen eBay chooses. That is the distinction worth
naming, because it decides which disclosures are safe to ship against an
unverified boundary: **a disclosure keyed to our own behaviour holds whatever the
other side does; one keyed to theirs is a claim we cannot maintain.** Every line
of the shipped copy is the first kind, with the single exception step 4 above
tests — the instruction assumes the query arrives, which is our behaviour only
up to the redirect.

Neither AI reviewer can close this either: no browser, no eBay session, and
driving the owner's browser is not available to them. It is the owner's to run.

The general form of this is now recorded as
`audit/PATTERN_DISCLOSURE_OWNERSHIP.md`, with every user-facing disclosure in
the app sorted by whose behaviour makes it true. Step 4 above is the remedy that
pattern prescribes for the single exception.

### 8.4 EPN — the load-bearing argument is compliance, not revenue

§7.1 gave two arguments for dropping EPN on the seller link and treated them as
one. They reverse differently, and the review is right that this matters:

| argument | if it turns out to be wrong | reversibility |
|---|---|---|
| **Revenue:** a seller opening a listing form is not a commissionable action, so tracking earns nothing | the tag would earn something | makes the tag *optional*, not forbidden — a recalculation, reversible |
| **Compliance:** tagging non-purchase seller traffic puts traffic of a kind the program does not describe under the account that does earn | the tag would be permitted | **load-bearing** — this is the one that forbids it |

**The compliance argument is the one holding the decision up.** "Reversible in
one line" is a statement about the code, not about the authority to make the
change: reversing it requires the program-terms question answered — is
seller-flow traffic under an EPN campaign acceptable to the program — not a
revenue recalculation. Recorded so this does not later read as reversible on a
whim.

### 8.5 What changed on disk in this pass

Bundle generation 10, `7629ec69` → new fingerprint, previous generation retained
on disk. Copy changes in `_reviewSellStartHtml` and `_renderScanMissPanel`;
assertions in `tests/draft-review-screen.mjs` and `tests/deeplink-companions.js`.
No server change, no publish path, and push and deployment remain blocked.
