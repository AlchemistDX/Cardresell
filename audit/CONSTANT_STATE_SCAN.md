# Scan — wire keys and findings that cannot currently vary

**Run once, 2026-09-06, on the suggestion that "any assertion whose condition can't currently
vary is reporting on the system's shape, not its content."**

The generalisation that prompted it: *a finding whose trigger is an unwired code path measures
the code path, not the data.* That sentence is not about provenance. It is about any value whose
domain has collapsed to one point, and `hasPacket` was unlikely to be the only one.

## Method

Two questions per candidate:

1. What is the complete set of values the **production** client can cause? Not what the type
   allows, and not what a test can construct — what `_crCreateDraft` actually sends
   (`js/core.7f9c03ad.js:18381-18400`) plus whatever server paths exist to change it later.
2. If that set has one element, does anything downstream present it as though it were
   informative?

The create body is the whole client-side input surface: `{ card, instanceId, slot, price,
priceSource, source }`. No `title`, `sku`, `quantity`, `notes`, or `packet`.

## Findings

| Key / finding | Production domain | Verdict |
|---|---|---|
| `hasPacket` | `{false}` | **Constant.** Nothing writes `packet`; `buildListingPacket()` has no production caller. Shipped with a comment justifying it as one cheap informative boolean. |
| `slot` | `{'ebay:fixed-price'}` | **Constant by decision.** `CR_D1_SLOT` (`:18316`) is the only Phase 1 client slot. Benign — the accepted decision says so, and the key is the extension point. |
| `quantity` | `{1}` | **Constant.** Client never sends it; store defaults to 1 (`api/_draftStore.js:466`). |
| `notes` | `{absent}` | **Constant.** Client never sends it. |
| `status` | `{'draft'}` | **Constant.** `DRAFT_STATUS` has four values, but `publishing`/`published` need a publish path and "no publish button before Phase 3" is binding. Deleted rows are refused at `api/_draftService.js:635`, not listed. |
| `priceSource` | `{'seller', 'comp', undefined}` | **Varies.** `'venue'` is defined but unreachable (no carry-over path yet). |
| `NO_PROVENANCE` detail `'unknown'` | ∅ | **Unreachable.** `draft.priceSource \|\| 'unknown'` (`:309`) can never take the fallback: the client omits `price` and `priceSource` together, so a priced draft always names a source. |
| `SELLER_PRICED`, `NO_PROVENANCE` | fire on every priced draft | **Constant in the other direction** — see `audit/OPEN_NONBLOCKING_NOT_ON_THE_WIRE.md`. |
| `rev`, `title`, `sku`, `price`, `createdAt`, `updatedAt`, `readiness` | vary | Fine. |

Most of these are harmless. A constant is only a defect when something **presents it as
information**, and `hasPacket` is the one that does — it ships with a comment explaining its
value, which is exactly the shape that survives review.

## What the scan actually caught first

Not a wire key. A fixture.

`tests/draft-readiness.mjs` built its no-provenance case as
`base({ priceSource: 'unknown', packet: undefined })`. Two independent defects:

1. **`packet: undefined` still writes the key.** The gate is
   `!Object.prototype.hasOwnProperty.call(draft, 'packet')` (`api/_draftStore.js:305`), and the
   object spread sets the property to `undefined` rather than omitting it. So the provenance
   branch was skipped entirely and **the fixture produced zero violations.** A case named
   `'no provenance'` asserted nothing about provenance for its whole life, and could not go red,
   because the only thing asserted of that row was that it carried a well-typed `readiness` —
   which it did.
2. **`'unknown'` and `'consensus'` are not price sources.** `PRICE_SOURCES` is
   `{seller, comp, venue}` (`:159-164`) and create refuses anything else (`:479-483`). The
   fixtures described drafts the store would never persist. Nothing failed, because
   `validateDraftForSlot` and `readinessOf` **read** `priceSource` without validating it — so an
   unpersistable value can sit in a fixture indefinitely.

Fixed: `base()` now uses `'comp'`; a `noPacket()` helper `delete`s the key; the no-provenance and
seller-priced cases are separate and reach their states. **Case 15 is the negative control on the
builder** — it asserts `noPacket()` removes the key, that `base({packet: undefined})` still has
it (the bug pinned as a fact rather than a comment), that each fixture raises the finding it is
named for, and that `base().priceSource` is one the store would accept.

## The pattern

**A fixture whose name asserts a condition it does not create is worse than a missing fixture,
because it reads as coverage.** The missing one is visible in a list; this one is invisible
everywhere except in the state it failed to build.

And the reason it was invisible is the same reason the constants are: **nothing downstream
distinguishes "this value is what it is" from "this value could not have been anything else."**
A test asserting `hasPacket === false` passes for the wrong reason. So does a fixture whose
condition never engaged.

**Where a value's domain has collapsed, say so at the definition.** A one-line comment recording
*why* it cannot vary and *what* would make it vary again is the difference between a constant
someone can reason about and a constant that quietly absorbs a test.

## Not done

- `hasPacket` keeps its comment, which now overstates the key. Left for the packet-wiring change
  that makes it true, so the fix and the claim land together rather than the comment being
  softened while the defect stays.
- `'venue'` as an unreachable enum member is fine — it is a declared vocabulary, not a reported
  value. Recorded so nobody "cleans it up".
- Only the draft wire was scanned. The scan sheet applies to any surface with a create path
  narrower than its schema; the fee/ranking surfaces have not been through it.
