# Open decision — INFO findings cannot reach the client

**Raised 2026-09-06 (D3 step 4). Surfaced deliberately, not fixed.**

## The gap

`readinessOf` maps `v.blocking` and nothing else. `v.blocking` is exactly the ERROR set, because
`blocks(severity)` returns true only for `SEVERITY.ERROR` (`api/_draftStore.js:165-170`).

Two findings are INFO severity:

- `DRAFT_NO_PRICE_PROVENANCE`
- `DRAFT_PRICE_SELLER_ENTERED`

Neither is blocking, so neither appears in `readiness.blockers`. And §2.9 of the contract says
clients read `readiness` and **only** `readiness`. Both statements are correct and deliberate.
Together they mean the review screen **cannot render a provenance notice today**, and no client
can, by construction.

## Why this is not a bug to quietly fix

Widening `readinessOf` to include INFO would be a one-line change and the wrong instinct. The
name of the field is `blockers`. Putting non-blocking findings in it makes the key a lie, and
`readiness.publishable` would then be `true` alongside a non-empty `blockers` array — which is
the exact ambiguity the two-field shape was chosen to avoid. Several existing assertions treat
"blockers non-empty" and "not publishable" as the same fact.

So this is a shape decision, and it belongs to whoever owns the surface that first needs it.

## Where it lands

- **D3 step 5** (fee breakdown) is the first place it bites. The accepted decision is "a table
  that can grow a provenance column." It can grow the column; it cannot currently fill it,
  because the data to fill it does not cross the wire. Step 5 should build the table and state
  this plainly rather than implying the column is one query away.
- **D4** is where the decision should actually be taken.

## The options, unchosen

1. **A sibling key.** `readiness.notices: [{code, field, message}]`, same shape, different
   severity class. Keeps `blockers` honest and `publishable` unambiguous. Costs a wire key and
   an amendment.
2. **A severity field on each entry** and rename the array. Most general, largest breaking
   change, and it re-opens the "severity is redundant on the wire" argument — which Amendment 6
   established was sound for `severity` specifically.
3. **Leave it closed.** Provenance never reaches the client; the fee table's provenance column
   is dropped from the plan rather than left as a promise. Cheapest and honest, and it should
   be a real candidate rather than the default that happens by inaction.

No option is chosen. Recording it here so that step 5 does not silently pick one by writing a
column header, and so the absence is a decision on the record instead of an oversight.
