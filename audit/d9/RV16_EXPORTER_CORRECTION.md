# RV-16 — the exporter corrected against eBay's real template

**Date** 2026-09-10 · **Bundle** `js/core.ebc21977.js` (generation 21, from
`core.959a4a85.js`) · **Status** **upload PASSED 2026-09-10** for this file and account (see the RV-16 section)

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

## RV-16 — PASSED 2026-09-10 21:06, for this file and this account

**Reported by Will**, who ran the upload and read the resulting draft. I did not
observe it; this is his report, recorded as such.

**Exporter version that produced the accepted file:** generation 21,
`js/core.ebc21977.js`, served from Preview
`dpl_9J3HHDXTdMgez8kKCAmqk9DENMAP` (commit `e75700c`).

| What the upload showed | |
|---|---|
| Accepted | yes, via Seller Hub Reports upload |
| `Action` | `Draft` — **not published** |
| `Price` | `32.84` |
| `Quantity` | `1` |
| `Format` | `FixedPrice` |
| Title | carried through |
| Custom label (SKU) | populated |
| Description | carried through |
| Blank photo column | **no error** |

### The accepted file was the $32.84 draft, not the $2 card

Worth stating because it is easy to run together with the other result on this
date. The accepted row carries `Price=32.84`, which is the **comp-priced**
draft. The **$2 `priceSource: "seller"` card is a different draft** and its
file was not the one uploaded here.

So the two 2026-09-10 results cover different things and neither extends to the
other:

- **$2 seller-provenance** — passed, in **Redis on the deployed build**
  (`price: 2`, `priceSource: "seller"`, `rev: 1`). Nothing to do with eBay.
- **RV-16** — passed, as an **eBay upload of the $32.84 draft's file**. Nothing
  to do with provenance.

No manually-priced draft's CSV has been uploaded to eBay. There is no reason to
expect the price column to behave differently — it is the same code path and
the same column — but it has not been shown, and the pass should not be read as
covering it.

### The photo result, stated precisely

**eBay accepted an `Item photo URL` column present with a blank value.** That
is the whole of what was shown.

It does **not** establish that the generation-20 file's *omitted* column would
have been accepted. That file was refused, and the cause of the refusal was
never isolated — four differences were corrected at once. The blank column is
now a tested configuration; the omitted column remains an untested one that
happened to be part of a refused file.

### Scope of the pass

**This file, this account, this exporter version.** One row, one category
(`183454`), one condition-less Pokémon card, one seller account with Seller Hub
Reports access. It does not speak for multi-row files, other categories, graded
slabs, other accounts, or any later exporter change.

## Reference artifact — the accepted bytes, retained

`audit/d9/ebay-draft-v2-PKMLOSTORIGINTRAINER-280ab9265ca3153f.csv`

| | |
|---|---|
| sha256 | `761d5ac9be0c59adb593741feea1820079ae9b1fd93af127784dc5c0a4d2565a` |
| size | 1042 bytes |
| lines 0–4 vs eBay's template | **byte-identical** |
| header / row field count | 11 / 11 |
| line endings | CRLF only |

The card is **Charizard, Lost Origin Trainer Gallery TG03**, SKU
`v2-PKMLOSTORIGINTRAINER-280ab9265ca3153f`, category `183454`, `Price=32.84`,
quantity `1`, `Format=FixedPrice`, `UPC` / `Item photo URL` / `Condition ID`
all blank.

This supersedes an earlier note in this file saying the accepted bytes were not
in the repo. They are now, which matters: the reference is the file eBay took,
not a regenerated equivalent.

## Left as instructed

The eBay draft stays **unpublished**. No repeat upload.
