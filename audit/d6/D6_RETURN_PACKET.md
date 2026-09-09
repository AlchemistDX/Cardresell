# D6 — The New-Seller Warning, Implemented

Branch `phase1-block-d`. Live bundle **`js/core.d5fcdced.js`** (renamed this
commit, `index.html:3833`). Nothing pushed, nothing deployed. Credential
rotation still gates pushing.

The requirement: *"Show before handoff when applicable; do not invent
eligibility"* (`audit/CARDRESELL_PLAN_AND_ROADMAP.md:560`,
`audit/TODO_PHASE1.md:22`). Reconciliation had it as not implemented
(`audit/PHASE1_RECONCILIATION_2026-09-08.md:99`). It is now implemented, with
the gate's decisions carried through unchanged.

---

## 1. What shipped

`_reviewSellLimitsHtml()` in the review screen's hand-off block, rendering one
muted note, last, with `data-sell-start-limits`:

> eBay can hold your payout and cap how much you list, and limits are reviewed
> monthly. New sellers will have transaction holds while they build selling
> history, and eBay can also hold funds on high-priced or unusual sales. Your
> selling limits and any funds on hold are shown in your eBay Seller Hub.

Exactly the copy the entry gate settled at §5.8. Nothing was reopened.

**Unconditional.** No trigger, because Phase 1 owns no signal that
discriminates "when applicable": the seller profile's defaults are
byte-identical to a deliberate "no store, not Top Rated" answer, so firing on
them would invent eligibility from a default, and `countDrafts() === 1` means
"first draft here" — the *expected* state of an established eBay seller's first
visit, so it would fire hardest at the sellers the note is not for. The reader
classifies themselves; the derivation is in `audit/d6/D6_ENTRY_GATE.md` §1–§3.

**Muted, and last.** It takes the default note styling and NOT
`data-packet-note-severity="WARNING"`. The D5 identity check keeps that, and
keeps first position. Two competing imperatives flatten each other, and the one
with a named number to compare and a wrong-card failure should win.

**One thing the gate did not cover: the no-deeplink branch.** When the builder
cannot produce a URL, the screen still sends the seller to eBay by hand. I
render the note there too. Withholding it would condition an account disclosure
on *our own builder's outcome*, which is not a difference in the seller's
situation. Single helper, two call sites, one implementation.

## 2. The rendered pass

Rendered at 1280×1100 in both themes and read on screen, which is what the gate
left open.

Computed styles confirm the intended relationship rather than assuming the
attribute produced it:

| line | light | dark |
|---|---|---|
| D5 identity check | `rgb(24,22,15)` — full `--text` | `rgb(212,210,204)` |
| seed note | `rgb(107,105,96)` — `--text-muted` | `rgb(145,143,134)` |
| **D6 note** | `rgb(107,105,96)` — muted | `rgb(145,143,134)` |

All three are 12.8px/400, so **colour alone carries the hierarchy**, and it does.

**One finding the rendered pass produced, and the fix.** On screen the D6 note
read as a *continuation of the seed paragraph* — same size, same muted colour,
same 6px gap, directly beneath a sentence that also mentions eBay. A reader
scanning the block would take it as more detail about the search seed rather
than as guidance about their own account.

Fixed with **spacing only**: `margin-top:14px` scoped to
`[data-sell-start-limits]` (`index.html:1170`). Deliberately not colour, weight
or a heading — any of those would put it back in competition with the identity
check, which §5.5(c) decided it must not win. Re-rendered: it now reads as its
own block, still visibly quieter than the check line.

## 3. The presence test

Ten assertions, added to the two existing hand-off sections so both branches are
covered by a real boot rather than a new fixture. They assert **behaviour**, not
that an element exists:

| assertion | what would break it |
|---|---|
| shown with no seller state declared | a trigger being added later |
| names the cap **and** that limits are reviewed monthly | dropping the cadence clause, leaving the cap reading permanent |
| carries eBay's definite verb about a **class** | softening to "new sellers can have" |
| covers the high-priced / unusual case | narrowing it to new sellers only |
| names where to look | describing the restriction without the destination |
| makes **no claim about this seller's standing** | "you are a new seller", "your account is new" |
| invents no duration, amount, or **direction** of change | "raised as you sell", "held for 21 days", a dollar figure |
| quieter than the identity check | promoting it to `WARNING` |
| sits last | reordering it above the seed or the check |
| still shown when no deeplink could be built | making it conditional on the builder |

The direction check is deliberate: the source says limits are "reviewed every
month and adjusted automatically" ([eBay, "Selling
limits"](https://www.ebay.com/help/selling/listings/selling-limits?id=4107)) —
adjusted, not raised. A future edit to the friendlier phrasing now fails.

`draft-review-screen`: **355 passed, 0 failed** (was 345).

## 4. The bundle rename

The edit changed the bundle's bytes, so `asset-fingerprints` went red exactly as
it should: **`core.3f83abec.js` → `core.d5fcdced.js`**, `index.html:3833`
updated, the retired file restored byte-identical from `HEAD`, both hashes
re-verified against their names. 64/0.

Citations: the insert is at ~22646, so everything above it is unshifted —
including every citation from the basis-loss work (`loadCardUI :3556`, the
startup timer `:20252`, `_crPricingContext :20687`, `_reviewBasisHtml :22262`).
I re-checked `:20252` in the live file and it still reads the 400ms
`setTimeout`. Recorded in `audit/BUNDLE_CITATION_MAP.md`.
`audit/d7/basis-loss-trace.json` keeps `3f83abec` — a captured artifact is not
renamed to match a later generation.

## 5. What D6 does not do

- **It does not warn a specific seller.** It states eBay's published treatment
  of a class. Anyone reading it who is not new gets a sentence about
  high-priced and unusual sales, which is on-topic for graded cards.
- **It names no holds, limits, durations or amounts.** Generic by decision until
  sourced from eBay's own pages; no invented day-ranges.
- **It is on the review screen's hand-off block only.** See Q-D6-2.
- **It is not verified on Safari or iOS.** Headless Chromium only, like the rest.

## 6. Questions

**Q-D6-1 — Is the copy closed?** It is the gate's §5.8 wording, now read on the
rendered screen and unchanged by that pass except for spacing. If you want a
clause added or cut, this is the moment; the assertions are keyed to the
clauses, so a wording change is a test change too.

**Q-D6-2 — Should the note appear anywhere other than the review screen?** It is
currently on the review hand-off block, which is the only place we hand a seller
to eBay. If a future surface links out (the panel's 🛠️ path, a Collection row),
does the note follow the link or stay on review? My inclination: it follows the
link, since the reason for showing it is the hand-off, not the screen.

**Q-D6-3 — Anything owed on the copy's sourcing?** Sentence 2 leans on eBay's
holds pages and sentence 1's cadence clause on "Selling limits" (id=4107). The
note itself names no page. Should the rendered note cite eBay, or is naming
Seller Hub as the destination enough?

**Still open from before, unanswered: Q1–Q6 in
`audit/PRICECHARTING_PERMISSION.md`**, of which Q1 (making three source labels
clickable) is a yes/no.

## 7. Status

- D7: closed. Basis loss: resolved test-setup race; same-card retention tracked
  in `audit/RELEASE_VALIDATION_QUEUE.md`; production clearing unchanged.
- **D6: implemented, rendered-pass done, presence test built.** Subject to
  Q-D6-1.
- Suites, each run individually to completion against `core.d5fcdced.js`:
  `draft-review-screen` 355/0 · `asset-fingerprints` 64/0 ·
  `launch-audit-regressions` 438/0 · `test-registry` 12/0 · `draft-store` 147/0 ·
  `listing-photos` 92/0 · `decision-restatements` 33/0 · `draft-crud-e2e` 192/0 ·
  `listing-packet-offline` 232/0 · `deeplink-companions` 178/0.
- Outstanding: D5 signed-in continuation checks, D6 questions above, release
  validation, credential rotation, two rotation-gating dashboard answers, SI-1,
  PriceCharting Q1–Q6. **No Phase 1 percentage is claimed. Nothing pushed,
  nothing deployed.**
