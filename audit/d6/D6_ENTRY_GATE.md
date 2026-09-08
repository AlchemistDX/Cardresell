# D6 Entry Gate — the new-seller warning, and whether it can be conditional at all

**Written 2026-09-08, before any D6 code.** Branch `phase1-block-d`, tip
`d0e9665`, nothing pushed, nothing deployed.

The requirement, unchanged since the plan doc: *"Show before handoff when
applicable; do not invent eligibility"*
(`audit/CARDRESELL_PLAN_AND_ROADMAP.md:560`, `audit/TODO_PHASE1.md:22`).
Reconciliation confirms it is **not implemented** — the seller profile feeds fee
arithmetic and no pre-handoff restriction warning exists anywhere
(`audit/PHASE1_RECONCILIATION_2026-09-08.md:99`).

The whole gate is the phrase **"when applicable."** That is a claim about the
seller's eBay account state, and by `audit/PATTERN_DISCLOSURE_OWNERSHIP.md` it
is a *theirs* claim: if it stops being true, nothing on our side goes red. So
D6 must either derive its trigger from something CardResell owns, or ship with a
named check that can fail. For account state there is no runnable check — we
have no eBay account API in Phase 1 and no user OAuth. That leaves the first
option, and this document tests whether it exists.

## 1. Every signal CardResell actually owns, and what each one proves

### Candidate A — the declared seller profile

`SELLER_PROFILE_KEYS = ['tcgLevel', 'ebayStore', 'ebayTopRated', 'ebayPromo']`
(`js/core.a7e7422d.js:6083`), persisted to `localStorage` by
`saveSellerProfile()` (`:6309`) and restored by `loadSellerProfile()` (`:6320`).

**It cannot carry a warning trigger, and the reason is in the markup.** Neither
selector has an "unknown" or "not answered" option:

- `ebayStore` (`index.html:2529-2532`) — options are `No Store / Starter` and
  `Basic Store`. The **first is the default.**
- `ebayTopRated` (`:2546-2549`) — options are `No` and `Yes`. **`No` is the
  default.**

So the default state is byte-identical to a deliberate answer of "no store, not
Top Rated" — which is exactly the new-seller shape. A trigger reading those
values cannot distinguish *"I told you I am a starter seller"* from *"I have
never opened this panel."* Firing on it is not reading a declaration; it is
**inventing eligibility from a default**, which is the one thing the requirement
names. `loadSellerProfile` even rejects values the select does not offer
(`:6329-6332`), so there is no smuggling an `unknown` sentinel through storage
without changing the markup.

### Candidate B — our own draft history

`countDrafts(googleSub)` exists (`api/_draftIndex.js:478`) and is real,
server-side, per-account. `countDrafts() === 1` is a fact we own completely.

**But it does not mean what the warning needs it to mean.** It proves *this is
their first draft in CardResell* — not that they are new to eBay. A seller with
ten thousand completed eBay listings has `countDrafts() === 1` the first time
they use this app, and that is the **expected** case for every new signup with
an established account. A trigger on it would fire hardest at precisely the
sellers the warning does not apply to.

### Candidate C — recorded listing outcomes

`DRAFT_STATUS` defines `PUBLISHING` ("handed to a venue, outcome unknown") and
`PUBLISHED` ("live at a venue") (`api/_draftStore.js:73-78`).

**Both are unreachable in Phase 1.** `EDITABLE_STATUSES = [DRAFT_STATUS.DRAFT]`
(`:81`) and there is no publish path by design
(`audit/CARDRESELL_PLAN_AND_ROADMAP.md:661`), so no draft ever leaves `draft`
except to `deleted`. "This seller has no completed listings recorded here" is
therefore **true for every user, always** — a predicate with no discriminating
power. Recording it as a signal would be a constant dressed as a condition, the
`hasPacket` constant-false defect again.

Nor does the D5 hand-off help: `data-sell-start="ebay"` is an ordinary `<a>` to
eBay (`js/core.a7e7422d.js:22425`). Clicking it is not observed — no event
posts, no draft mutation, no counter. We do not know that a seller ever arrived
at eBay, let alone listed anything.

## 2. Finding

**There is no "ours" signal that discriminates new sellers.** A is a default
masquerading as an answer, B is right about our history and wrong about the
question, C is a constant. And the failure is two-directional, which matters
under the standing warning rule — *a warning that wrongly disappears is
invisible, one that wrongly appears is noise*: a profile-based trigger would
both fire for established sellers who never opened the panel **and** stay silent
for genuinely new sellers who ticked "Basic Store" while shopping for one.

## 3. Decision — the warning is unconditional, and says whose job the check is

D6 ships as **unconditional guidance at hand-off**, not a conditional warning.
This is the honest reading of "when applicable, do not invent eligibility":
**applicability becomes the seller's determination, and the copy tells them how
to make it.** We can say what eBay's restrictions are and where to look; we
cannot say whether they bind this account.

That satisfies the disclosure-ownership pattern with no exception row. Every
sentence is either a statement about eBay's published policy or an instruction
to the seller — and the instruction form is the one D5 already established
works: *check this before you continue*, with the place to check named.

It also costs nothing to be wrong about. An established seller reads one line
that does not apply and moves on. Under the conditional design, being wrong
means either accusing a veteran of being new or leaving a first-time seller to
discover a payout hold after a sale.

**Consequence, stated plainly:** D6 gets smaller, not larger. No trigger, no
eligibility model, no new state. The work is copy, placement, and a test that
the guidance is present at hand-off and cannot silently vanish.

### 3.1 The sourcing rule for the copy — and its ceiling

Settled on review, before the copy exists, because the temptation arrives with
the research: **name the kind of restriction and where to check it; never the
duration or the amount.**

- Maintainable: *"New sellers may have payout holds or selling limits. Check
  your eBay account before you list."* Keyed to eBay's published policy in the
  general, and to an instruction the seller performs.
- Not maintainable: *"Funds are held 21 days"*, *"your limit is 10 items or
  $500/month"*. eBay changes these without notice, **nothing on our side goes
  red when they do**, and the sentence rots while still rendering.

That is this pattern's own test applied to the copy the pattern's reasoning
produced. It holds even if a precise figure is findable and correctly sourced
today — sourcing establishes that a number was true when read, which is exactly
the property that does not survive.

**Not decided here:** the exact copy, and which eBay restrictions to name.
Naming specific holds or selling limits requires sourcing them from eBay's own
published pages — no invented day-ranges, no invented amounts, per the standing
rule. That is D6 step 1's research, and until it is sourced the copy stays
generic.

## 4. What would reopen this

Only a signal we own that actually discriminates. Two could exist later, neither
in Phase 1:

- **User OAuth against eBay** (Phase 2 gate) would let us read account standing
  from the venue itself — at which point the claim becomes *theirs but
  observable*, and a conditional warning ships with a real check behind it.
- **A recorded hand-off outcome**, if a publish path ever lands, would make
  `PUBLISHED` reachable and give candidate C discriminating power for repeat use
  — though still never for a seller's first listing, which is the case the
  warning is for.

Recorded so a future reader knows the unconditional design is a consequence of
Phase 1's instruments, not a preference.
