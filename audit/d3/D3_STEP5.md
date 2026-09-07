# D3 Step 5 — The fee breakdown

Status: **done, local, unpushed.** `draft-review-screen` 113 passed / 0 failed.

The review screen now answers the question the seller actually opened it to ask: if I list
this at this price, what do I keep. Net headline, then a table that shows how the price got
there, always visible, no toggle.

## What it renders

```
WHAT YOU KEEP
$160.08

Item price                                    $184.99
Final Value Fee (13.25% trading cards)        −$24.51
Per-order fee                                  −$0.40
You keep                                      $160.08

Fees on the item price only. Shipping is not included, because a draft
does not carry one yet.
```

Checked by hand: 184.99 × 13.25% = 24.51, plus the $0.40 per-order fee (the order clears $10,
where the fee steps up from $0.30), leaves 160.08. The screen agrees to the cent.

## One fee model, and a test that says so

`feeEbay()` is the only thing in the codebase that knows eBay fee arithmetic and
`netEbayForPrice()` is the only thing that knows how the payout row combines it. The screen
calls both and formats what comes back. It does no arithmetic of its own beyond summing the
rows the model handed it.

That is asserted rather than claimed. One case pulls the rendered numbers out of the DOM and
compares them against `feeEbay` / `netEbayForPrice` called directly in the page:

- gross minus the fee rows equals the net row, to the cent
- the headline is the same number as the net row
- the rendered net equals the model called directly
- the fee rows are the model's own line items, **in its order**

The first of those is the one worth keeping. The rows come from `feeEbay` and the headline
comes from `netEbayForPrice` — two entry points into one model. If they ever disagree, the
model is wrong, and this fails here rather than a seller noticing the column does not add up.
Mutation-proved: routing the headline through a second computation (`price − fees × 0.97`)
fails both assertions.

## The seller profile now has exactly one reader

The ranking surface read `ebayStore` / `ebayPromo` / `ebayTopRated` inline at its own call
site. The review screen needs the same three values, so a second inline read here would have
been a second implementation of *what fee tier is this seller* — the duplicate-implementation
shape that has now bitten this codebase five times.

Added `_crSellerProfile()`, one reader, used by both. Defaults are the documented seller
default (no store, not Top Rated, no Promoted Listings, TCGplayer Level 1–4), and each default
is a value the select actually offers (`none`/`basic`, `no`/`yes`, `0`–`12`), so the fee engine
cannot be handed a tier that does not exist.

Asserted by moving the profile rather than by reading the code: flip Top Rated to yes,
re-paint, and the seller must keep strictly more of the same price while the gross does not
move. If the screen had hardcoded the defaults, that number would not move — mutation-proved,
it fails when the profile read is replaced with a literal.

Smoke-checked the surface I refactored: `calc()` runs clean, and the accessor tracks the select.

## Shipping is excluded, and that is stated, not zeroed

`shipCharge` and `shipCost` live on the scan surface and describe the card currently in hand.
A draft record carries no shipping field at all. Reading those inputs here would quietly
attribute the last scanned card's postage to an unrelated draft — the invented figure §5.5
refuses.

The codebase already draws this line and says why, in the comment on the profile keys: those
four selects "describe WHO the seller is, not what they are pricing, so they should outlive a
single scan." The profile outlives the scan and is safe to read. Shipping is scan-scoped and
is not. So the basis is the item price alone, and the screen says so in the surface rather
than only in a comment.

Three assertions hold that line: the note is present, it says shipping is not included, and it
says why. A fourth guards the failure that would look like compliance — **shipping must not
appear as a modelled row worth $0.00.** A zero in a table reads as a fact.

## No provenance column, and no header for one

The table is shaped to grow one: fixed row structure, one amount cell per row, asserted to be
uniform so a column can be added by widening the template and nothing else. It does not have
one today and does not advertise one.

Both non-blocking findings that would populate it fire on **every** priced draft right now,
because `buildListingPacket()` has no production caller — see
`audit/OPEN_NONBLOCKING_NOT_ON_THE_WIRE.md`. A column that says the same thing about every row
carries no information, and a header with nothing under it is a promise rather than a
disclosure. Asserted: no `th`, no `thead`, no header-classed element, and neither "Source" nor
"Provenance" appears anywhere in the breakdown.

## The unpriced draft keeps the table

Same rows, em-dashes instead of numbers, and a note that says add a price. An empty shape tells
the seller what adding a price will buy them; hiding it tells them nothing. Asserted that no
dollar amount appears anywhere in that state and that no fee rows were invented.

## Mutations run

| Mutation | Result |
|---|---|
| Headline routed through a second computation | 2 failures |
| A provenance column header added | 2 failures |
| The shipping limitation dropped from the note | 2 failures |
| Profile hardcoded to the defaults instead of read | 1 failure |
| Table hidden when unpriced | 6 failures |

Baseline restored to 113/0 after each.

## Suites

`draft-review-screen` **113/0** (was 80/0; still unregistered — step 6) · `draft-list-screen`
101/0 · `draft-focus` 56/0 · `draft-list-cap` 130/0. `asset-fingerprints` remains 14/1, held
red deliberately until D3 closes.

## Not done here

- `draft-review-screen.mjs` is still not in `tests/run-all.sh`. Step 6.
- The provenance column itself stays blocked until the packet is wired.
- Fees are modelled for `ebay:fixed-price` only; any other slot gets an honest refusal rather
  than eBay's numbers wearing another venue's name.
