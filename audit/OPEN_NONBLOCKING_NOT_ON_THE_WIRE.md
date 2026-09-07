# Open decision — non-blocking findings cannot reach the client

**Raised 2026-09-06 (D3 step 4). Surfaced deliberately, not fixed.**
**Corrected 2026-09-06 on review — see "Two corrections to the original filing".**

## The gap

`readinessOf` maps `v.blocking` and nothing else. `v.blocking` is exactly the ERROR set, because
`blocks(severity)` returns true only for `SEVERITY.ERROR` (`api/_draftStore.js:165-170`).

Two findings are non-blocking (`api/_draftStore.js:209-210`):

| Code | Severity | Fires when |
|---|---|---|
| `DRAFT_PRICE_SELLER_ENTERED` | **INFO** | priced, no `packet` key, `priceSource === 'seller'` |
| `DRAFT_NO_PRICE_PROVENANCE` | **WARNING** | priced, no `packet` key, any other `priceSource` |

Neither is in `v.blocking`, so neither appears in `readiness.blockers`. And §2.9 says clients read
`readiness` and **only** `readiness`. Both statements are correct and deliberate. Together they
mean the review screen **cannot render a provenance notice today**, and no client can, by
construction.

## Two corrections to the original filing

1. **`DRAFT_NO_PRICE_PROVENANCE` is WARNING, not INFO.** The first version of this document, the
   step 4 packet, and the working notes all called both findings INFO. Only `SELLER_PRICED` is.
   The conclusion is unchanged — only ERROR blocks, so both are equally invisible to the client —
   but the severity matters a great deal for what widening the wire would *say*, which is the
   substance of correction 2.
2. **The wire is the second problem, not the first.** Raised on review and confirmed in code.

## Why the wire must not be widened first

The trigger is `hasPrice && !Object.prototype.hasOwnProperty.call(draft, 'packet')`
(`api/_draftStore.js:304-311`). So the question is: what writes `packet`?

- `draft.packet` is set **only** from `input.packet` (`api/_draftStore.js:485-489`).
- `buildListingPacket()` (`api/_listingPacket.js:315`) has **no production caller**. Every
  reference outside its own definition is in `tests/listing-packet-offline.mjs`.
- The client never sends one: `packet` appears **three times** in the entire 19,348-line bundle,
  none of them in a create body.

Therefore **no draft in production carries a packet**, so every priced draft raises exactly one
of the two findings, always, and never neither. Provenance is being inferred from packet
presence, and packet presence is an unwired code path.

Widening the wire today would put a provenance notice on **every priced draft in the app**. And
because `NO_PROVENANCE` is a WARNING, the notice would not merely be noisy — it would assert a
data-quality defect that does not exist. The system would tell a seller "we cannot say where this
price came from" about a price that came from consensus, when the only missing thing is a
snapshot nobody writes. That is stamping a lie, and the fact that the copy is technically true of
the stored row does not rescue it.

**A finding whose trigger is an unwired code path measures the code path, not the data.**

## Consequence for step 5

Step 5's fee breakdown is blocked **twice over, by the same root cause**:

1. The provenance data does not cross the wire (this document).
2. Even if it did, it would say the same thing about every draft, so the column would carry no
   information.

So the accepted decision — "a table that can grow a provenance column" — stands as a *shape*
decision only. Step 5 builds the table and states the limitation. It must not write a column
header, and must not imply the column is one query away, because it is two changes away and the
first one is `buildListingPacket` wiring.

Related, and worth noting because it is the same defect one layer out: `summarize()` already
ships `hasPacket` on the list wire (`api/_draftService.js:516`), with a comment explaining that
whether a snapshot exists is worth one boolean. It is — but **that boolean is `false` for every
row in production**, for exactly the reason above. A wire key that cannot currently vary is
carrying no information either.

## Ordering

1. **Wire `buildListingPacket` into the create path.** Until then, provenance findings measure
   an unwired path. Owner: D4, or wherever packet persistence lands.
2. **Then** decide the non-blocking wire shape, with real varying data to look at.

## The wire-shape options, unchosen

1. **A sibling key.** `readiness.notices: [{code, field, message}]`, same shape, different
   severity class. Keeps `blockers` honest and `publishable` unambiguous. Costs a wire key and
   an amendment.
2. **A severity field on each entry** and rename the array. Most general, largest breaking
   change, and it re-opens the "severity is redundant on the wire" argument — which Amendment 6
   established was sound for `severity` specifically, and which `tests/draft-readiness.mjs`
   case 14 now asserts mechanically rather than trusting.
3. **Leave it closed.** Provenance never reaches the client; the provenance column is dropped
   from the plan rather than left as a promise. This should be a real candidate, not the default
   that happens by inaction.

No option is chosen, and none should be until step 1 of the ordering above is done.

## Priority raised: marketAskDivergence is the stated justification for a removal

Previously logged as "computed, serialized, asserted by two tests, read by
nobody." `api/tcg-price.js:640-662` makes it more than an unwired field: it is
the named replacement for the sanity valve removed on 2026-09-03 — *"Where the
two disagree sharply we say so (see marketAskDivergence in the payload) instead
of quietly swapping in a number that answers a different question."*

The valve was live and firing. Its replacement has never reached a seller. The
comment's own worked case (EX Dragon Frontiers Charizard Star #100, product
84198: market $1,000 against low $18,500 / mid $20,000 / high $39,500) now
serves the correct $1,000 with no indication that the ask book says ~20x more.

Scope check, so this is not overstated: the valve fired at >3x and the guard
fires at >3x both directions, so coverage of the valve's trigger is 1:1. The
substitution was sound in design. Only half of it shipped.

See `audit/d3/DISCLOSURE_PARITY_Q3.md` for the measured direction split (the
guard's coverage is anticorrelated with the floor-inversion defect, 13 of 417 —
a separate argument for wiring it, and the weaker of the two).
