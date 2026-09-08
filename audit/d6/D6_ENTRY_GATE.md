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

### 5.5 Three copy decisions, taken deliberately

Raised on review 2026-09-08, before the rendered-screen pass, because each was
about to be inherited rather than chosen.

**(a) The verb: "will", not "can" — but about the class, never the reader.**

The draft in §5.4 said new sellers "can have" payout holds. eBay says they
**will** experience transaction holds, unhedged. That is the one clause where
the draft *softened a definite source statement*, which is the opposite of the
§5.3 error and just as much a divergence from the source. Both directions are
the same defect: our sentence should carry the source's confidence, no more and
no less.

The reason the draft flinched is real — we cannot confirm this seller is new
(§1, §2). But that is an argument about **whose standing we assert**, not about
**how confident eBay's policy is**. Both are satisfied by keeping the definite
verb and making the subject the class:

- Refused: *"You will have holds"* — a claim about this seller's standing, which
  §2 says we cannot make.
- Refused: *"New sellers can have holds"* — weaker than the source, so we
  understate a restriction the seller will actually meet.
- **Adopted:** *"New sellers will have transaction holds…"* — a statement about
  eBay's published treatment of a class, at the source's confidence, leaving the
  reader to place themselves in it or not.

**(b) Drop the self-selection opener.**

"New to selling on eBay?" was doing in copy exactly what the gate refused to do
in code: conditioning the content on the seller's standing. It is more honest
than a code trigger, because the seller does the classifying — but it produces
the same miss. An established seller stops reading at the question mark, and
**the holds content is not new-seller-only.** Per §5.1, eBay also holds funds for
high-priced items and unusual selling patterns. **A graded card can be both**,
and this app exists to sell graded cards, so that clause is squarely on-topic for
the experienced seller the opener just dismissed.

So the copy addresses everyone — which is what §3 decided anyway. The opener was
a conditional smuggled back in at the sentence level.

**(c) Lower visual weight than the check-the-card line.**

Both are instructions, but they are not the same kind, and they arrive at the
same moment:

| | D5 check line | D6 guidance |
|---|---|---|
| Where | on the screen you are about to see | elsewhere, in the seller's account |
| When | now, before continuing | before listing, at the seller's pace |
| Specificity | a named number to compare (`074/073`) | a kind of restriction to look up |
| Failure if ignored | wrong card listed | a surprise later, recoverable |

Two competing imperatives flatten each other, and the one with a specific number
and an immediate failure mode should win. **D6 therefore takes the default note
styling — muted (`--text-muted`, `index.html:1159`) — and NOT
`data-packet-note-severity="WARNING"`, which the D5 check line uses to take full
`--text` weight (`:1160`).** No new severity value is needed; the existing
default already means "quieter than a warning."

Order within the block: the D5 check imperative stays first, the seed note
second, D6 last — furthest from the click, since it is the only one of the three
that is not about this specific hand-off.

### 5.6 Revised draft copy

> eBay can hold your payout and cap how much you list. New sellers will have
> transaction holds while they build selling history, and eBay can also hold
> funds on high-priced or unusual sales. Your selling limits and any funds on
> hold are shown in your eBay Seller Hub.

Clause by clause: sentence 1 is eBay's published policy in general; sentence 2
carries the source's definite verb about a class and adds the non-new-seller
case that makes it relevant to everyone; sentence 3 is an instruction with the
destination named. No duration, no amount, no claim about this reader.

### 5.7 The limit is not permanent — say so, but not the way it wants to be said

Raised on review: sentence 1 says eBay can "cap how much you list" and nothing
says what happens next, so it reads as a harder ceiling than it is. Correct, and
the omission is a misleading-by-silence, not merely a gap: a permanent-sounding
cap is a reason not to bother listing at all.

**Decision: add it, in seven words, with a neutral verb.**

The obvious phrasing is "and raises it as you sell" — and **that phrasing is not
supportable.** The source says limits are "reviewed every month and adjusted
automatically" based on sales volume and buyer feedback ([eBay, "Selling
limits"](https://www.ebay.com/help/selling/listings/selling-limits?id=4107)).
Adjusted, not raised. eBay guarantees a review cadence, not a direction, and the
same inputs that raise a limit can lower it. "Raises it as you sell" would be an
unsupported directional claim about someone else's process — the §5.3 defect
again, wearing a friendlier face, and this time it would be *our* invention
rather than a figure we copied.

So the clause states the cadence and stops: **"limits are reviewed monthly."**
That carries the whole point — the cap is not permanent, something happens on a
known schedule — without promising which way it moves. A seller who wants the
direction has the destination named in sentence 3.

Cost check, since §5.5(c) just made this note quiet: seven words on a
three-sentence muted note. Worth it. The alternative is a sentence that
discourages the action the screen exists to encourage.

### 5.8 Copy as it stands for the rendered pass

> eBay can hold your payout and cap how much you list, and limits are reviewed
> monthly. New sellers will have transaction holds while they build selling
> history, and eBay can also hold funds on high-priced or unusual sales. Your
> selling limits and any funds on hold are shown in your eBay Seller Hub.

**Still open:** wording review against the rendered screen, and the presence
test.
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
