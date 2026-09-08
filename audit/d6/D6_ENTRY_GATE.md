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

**Copy sourced in §5 below.** Placement, wording review, and the presence test
remain.

## 5. Sourced: what eBay publishes, and the figure we are not going to stamp

Researched 2026-09-08 from eBay's own help pages. No account needed; both are
public.

### 5.1 The kinds, from the source

**Holds** — [eBay, "Payments on
hold"](https://www.ebay.com/help/selling/getting-paid/getting-paid-items-youve-sold/payments-hold?id=4816)
names three types: *transaction holds*, *payment dispute holds*, and *payout
holds*. On new sellers specifically it is not hedged — "New or infrequent
sellers **will** experience transaction holds while learning best selling
practices, becoming established, and building a strong selling history on eBay."
Holds are also described for open cases or disputes, restricted or suspended
accounts, high-priced items or unusual selling patterns, and Authenticity
Guarantee verification.

**Selling limits** — [eBay, "Selling
limits"](https://www.ebay.com/help/selling/listings/selling-limits?id=4107)
describes monthly limits reviewed and adjusted each month based on sales volume
and buyer feedback, with active and sold listings both counting. It separately
notes **category limits**: "New sellers in a particular category may have limits
on how much they can sell." Listings over the limit may be ended by eBay.

Both restrictions therefore apply to the seller *before* they finish listing,
which is what makes hand-off the right place to say so.

### 5.2 Where eBay tells the seller to look

- **Funds and hold status** — Seller Hub → **Payments** tab → **Summary** →
  Payments shows "Available, On hold and Processing funds"; the **All
  transactions** section shows a reason for each hold "and an estimated release
  date, where possible" ([eBay, "Using the Payments tab in Seller
  Hub"](https://www.ebay.com/help/selling/selling-tools/seller-hub/using-payments-tab-seller-hub?id=4798)).
- **Selling limits** — Seller Hub → **Overview** tab → **Monthly limits**
  ([eBay, "Selling limits"](https://www.ebay.com/help/selling/listings/selling-limits?id=4107)).

The seller's own account is the authority on whether either binds them. That is
the whole reason the warning points rather than predicts.

### 5.3 The figure, and why it is not in the copy

The holds page states: **"New sellers typically experience holds for up to 30
days, although sometimes it may be longer."**

That is a clean citation, from the primary source, correct as read today — and
it is exactly the sentence §3.1 rules out, found the same afternoon the rule was
written. It is recorded here and **stays out of the shipped copy.** eBay can
change it without notice, nothing on our side goes red when they do, and the app
would keep rendering a confident number that had quietly stopped being true.
Note that eBay hedges it twice in its own sentence ("typically", "sometimes it
may be longer") — reproducing it in our UI would strip the hedges and make our
version more definite than the source.

This is the concrete instance the sourcing rule was written for, and it lands on
the correct side only because the rule predated the citation.

### 5.4 Draft copy (wording not final)

> **New to selling on eBay?** New sellers can have payout holds and monthly
> selling limits on their account. Check your eBay account before you list —
> your limits and any funds on hold are shown in Seller Hub.

Every clause is either what eBay publishes about its own policy, or an
instruction the seller performs. No duration, no dollar amount, no claim about
this seller's standing. "Seller Hub" is named without the deep tab path, since
navigation moves more readily than the destination.

**Still open:** final wording, exact placement relative to the D5 check-the-card
imperative and the seed note, severity, and whether the two restriction kinds
read better as one sentence or two.

**Not decided here:** placement and severity.
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
