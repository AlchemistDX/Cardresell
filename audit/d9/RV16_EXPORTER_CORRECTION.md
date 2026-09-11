# RV-16 — the exporter corrected against eBay's real template

**Date** 2026-09-10 · **Bundle** `js/core.ebc21977.js` (generation 21, from
`core.959a4a85.js`) · **Status** file verified locally, **upload UNVERIFIED**

## What happened

The generation-20 export was uploaded to a real eBay seller account and
**refused with a generic reading error**. Will then downloaded eBay's own
Create-Drafts template and compared. Four differences were found at once.

| | generation 20 emitted | eBay's template has |
|---|---|---|
| Action header | `Action` | `Action(SiteID=US\|Country=US\|Currency=USD\|Version=1193\|CC=UTF-8)` |
| Price header | `Start price` | `Price` |
| Metadata | none | four `#INFO` rows above the header |
| Photo column | omitted entirely | `Item photo URL` |
| Duration | `Duration` = `GTC` | no Duration column |

**Which difference caused the refusal is NOT established.** eBay returned a
generic reading error, not a field diagnosis, and all four were corrected
together. A successful re-upload will therefore show that the corrected file
works — it will **not** isolate the cause. Saying otherwise would be a
diagnosis we never made.

## The correction

The header and the four `#INFO` rows are now **eBay's own bytes**, read from
`eBay-draft-listing-template-Sep-10-2026-20-38-3.csv` and emitted verbatim.
They are deliberately not passed through `_csvField`: three contain commas and
one is already quoted, so re-quoting would alter bytes eBay wrote.

Verified on the generated file:

| Check | Result |
|---|---|
| Lines 0–4 vs eBay's template | **byte-identical** |
| Header field count | 11, matching eBay's |
| Our data-row field count | 11 |
| Line endings | CRLF only, no bare LF |
| UTF-8 round-trip | clean |
| Smart quotes | none |

eBay's example shoe row is replaced by the $2 card: `Draft`, SKU
`v2-PKMBASESETISOLATIONT-e933e08c9a63ebaf`, category `183454`, price `2.00`,
quantity `1`, `FixedPrice`.

## Design change, recorded explicitly

**The photo column was omitted; it is now present and blank.** This reverses
the generation-20 decision, which was deliberate and documented ("photo column
omitted" because a local file cannot travel in a CSV). The reversal stands on
eBay shipping `Item photo URL` in its own eleven columns: an absent column and
a blank column are not the same thing to a parser counting fields against its
header. The blank column claims nothing — the seller still attaches photos in
eBay's Drafts folder, and the panel still says so in words.

`UPC` and `Condition ID` are likewise **present and blank**, for the same
field-count reason. Condition stays unresolved on purpose:
`api/_conditionDescriptors.js` refuses to emit descriptor value ids because a
guessed one does not fail, it publishes the wrong grade.

**`Duration` is no longer emitted.** eBay's FixedPrice template has no such
column, so GTC is left to eBay's default instead of asserted by us.

## Tests

`tests/draft-card-actions-browser.mjs` — **88 passed, 0 failed**. Also
`test-registry` 12/0, `draft-lifecycle` 83/0.

**A test-harness bug was found and fixed, and the cause was established before
anything was changed.** Five assertions failed on the first run. The product
was not at fault: the suite's cell parser,
`row.match(/("([^"]|"")*"|[^,]*)/g).filter((_, n) => n % 2 === 0)`, silently
drops every field after the first **empty** one — on an 11-field row with three
blanks it returns 10 cells with all tail values shifted to `''`. It had passed
only because the old export contained no empty fields. Demonstrated in
isolation before editing. Replaced with a quote-aware split.

**Mutations run** (bundle restored byte-identical after each, fingerprint
re-checked):

| Mutation | Result |
|---|---|
| `#INFO` preamble not emitted | **87/1** — caught |
| UPC dropped from the row (10 fields vs 11 header) | **81/7** — caught |

## Still open

RV-16 remains **blocking**. The corrected file has not been uploaded. What the
upload must show: the row lands as a **draft and not a live listing**, and
title, start price, quantity, custom label/SKU and description survive, with no
error from the blank photo column.
