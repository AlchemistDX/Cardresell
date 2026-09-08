# D4 — Number provenance on the review screen

**Date:** 2026-09-08 · **Branch:** `phase1-block-d` · **Live bundle: `js/core.ced9f5eb.js` (22,509 lines)**
**Suite:** `tests/draft-review-screen.mjs` — **301 passed, 0 failed** (was 268 before this block)
**Not pushed. Not deployed.** `origin/main` = `9aaf326`; local HEAD is 191 commits ahead of it as of the previous commit `c16d579`.

This document is self-contained: every claim below is bound to `file:line` in this
repository, and the "What this does NOT establish" section is part of the deliverable,
not an appendix.

---

## 1. What a seller now sees

Under the listing-details block, on a draft whose packet is usable, there is a
provenance block: a heading, one sentence saying what the market data *is* relative to
the price, a **Source** row and a **Retrieved** row.

Five behaviours, in the order the request stated them.

### 1.1 The stored source label, and a safely rendered link

`_reviewSafeSourceUrl(raw)` — `js/core.ced9f5eb.js:21820`.

```js
function _reviewSafeSourceUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u;
  try { u = new URL(raw.trim()); } catch (_) { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return u.href;
}
```

It is a parse-and-allowlist, not a pattern match: the URL is handed to `new URL()` and
only `http:`/`https:` survive. There is no blocklist of `javascript:`-like strings to
get around. The link renders with `rel="noopener noreferrer nofollow" target="_blank"`
(`:21921`).

The source row has **three** visible outcomes, and no fourth silent one
(`_reviewBasisHtml`, `js/core.ced9f5eb.js:21894`, source-row branch `:21918-21926`):

| stored state | what the seller sees |
|---|---|
| label + safe URL | the label, as a link (`data-basis-link`) |
| label + a URL that did not survive the parse | the label as plain text, plus *"Its stored link could not be opened safely, so it is not shown."* (`data-basis-link-rejected`) |
| label, no URL stored | the label, plus *"No link was recorded."* (`data-basis-link-absent`) |
| no label | *"Not recorded"* (`data-basis-source-absent`) |

The rejected-link case matters because the label is still true when the URL is not; the
alternative — dropping the whole row — would delete a fact we have in order to hide one
we cannot use.

### 1.2 Retrieval time from the stored absolute instant, and rebuilding does not make it look newer

`_reviewWhen(iso)` — `js/core.ced9f5eb.js:21830`. It formats `Date.parse` output through
`toLocaleString` and returns `null` on anything unparseable. It is deliberately
**absolute, never relative**: a "2h ago" caption re-read an hour later is the same drift
as re-deriving a stamp, one layer up.

The block reads **`priceBasis.retrievedAt` only** (`:21861`). It never reads
`metadata.generatedAt`. That is the display half of the server rule in
`stampPriceBasisReporting` (`api/_listingPacket.js:421`), which prefers the absolute
`retrievedAt` and strips relative age keys — so a rebuild that moves `generatedAt`
cannot move what the seller reads.

That is asserted directly, not inferred. Fixture `packetCompRebuilt`
(`tests/_draftListFixtures.mjs`) is produced by driving the **real PATCH handler** with
a `pricingContext` and no basis metadata; `generatedAt` moves, `retrievedAt` stays at
`2026-09-08T12:00:00.000Z`. Assertions: `tests/draft-review-screen.mjs:2015` (the
caption does not print the generation time), `:2031` (after a rebuild the rendered
retrieval time has not moved).

A second sentence distinguishes *who dated it* (`data-basis-dating`, `:21935`): either
"The source published this as-of date." or "This is when we read the source. The source
does not publish an as-of date of its own." PriceCharting only ever supports the second.

### 1.3 Market context beside a seller-entered price vs evidence that determined it

This is a role, derived from the draft's `priceSource` (`api/_draftStore.js:159` —
`seller | comp | venue`) in `_reviewBasis()` at `js/core.ced9f5eb.js:21851`:

| `priceSource` | role | heading | sentence |
|---|---|---|---|
| `comp`, `venue` | `determining` | Where this price came from | "This asking price was derived from the market data below." |
| `seller` | `context` | Market context for this price | "You set this asking price yourself. The market data below is context alongside it — it is not what the price was derived from." |
| absent / anything else | `unknown` | Market data recorded with this price | "This draft has no record of how its asking price was set, so we cannot say whether the market data below determined it or sits beside it." |

Copy lives in `_REVIEW_BASIS_ROLE` (`:21873`). **There is no default role.** A missing
`priceSource` is `unknown` and says so, because defaulting either way invents a claim
about how the seller set their price. `httpInput()` in the harness sends no
`priceSource`, so `unknown` is a real state, not a defensive branch.

This is the display counterpart of the server's `PRICE_BASIS_NOT_SOURCE_OF_PRICE`
warning (`api/_listingPacket.js:814`); both surfaces now say the same thing, and the
screenshot check confirmed they read consistently together rather than as two
contradicting sentences.

### 1.4 Unavailable source or retrieval information is stated

Every row is a value **or an explicit statement of absence**; the function will not
print a row it cannot substantiate. Two levels:

- **No basis at all** on an otherwise usable packet (`:21903-21915`): "No price source
  was recorded with these listing details." And if the draft calls its price
  `comp`-derived or `venue`-derived, a second clause — "so it should have one" — plus a
  `data-basis-unsupported` attribute. A seller-typed price owes no basis; a
  comp-derived one does, and that asymmetry is now on screen.
- **Partial basis** — label only, which is the real SportsCardsPro shape: label shown,
  "No link was recorded.", "No retrieval time recorded", and **no** as-of sentence for a
  time we do not have (`tests/draft-review-screen.mjs:2079`, `:2081`, `:2084`).

`_reviewBasis()` returns `null` rather than an object of nulls, precisely so a caller
cannot render an empty block and count it as disclosure (doc comment `:21843-21850`).

### 1.5 The display clears when the packet becomes unusable

`_reviewBasisHtml()` returns `''` when `_reviewState.packetUsable` is false (`:21895`),
and it is wired into the **usable branch only** of `_reviewPacketHtml` (`:22189`).
Asserted at `tests/draft-review-screen.mjs:2112` (no block), `:2114` (no source label
survives on screen), `:2116` (no retrieval instant survives on screen) — the last two
search the rendered text, not just the block, so a leak elsewhere would fail.

### 1.6 The refresh label

Already correct and left alone: `#reviewRefreshBtn` renders **"Refresh listing
details"**, and "Refreshing…" while busy (`js/core.ced9f5eb.js:22117`). It rebuilds the
packet without fetching new market data — `_reviewRefreshPacket` sends
`pricingContext: _crPricingContext({basis:null})`. Asserted at
`tests/draft-review-screen.mjs:2131`, and `:2133` asserts the label does not promise a
new price or quote.

---

## 2. The tests, and the negative control

New section: **"a seller can see where the price came from, after a reload"** —
`tests/draft-review-screen.mjs:1988`. It reloads the page against a stubbed
`/api/drafts` read and reads the block back out of the DOM through a `basisOf(page)`
extractor, so every assertion evidences the rendered surface, not the source text.

Six new fixtures in `tests/_draftListFixtures.mjs`, all generated **through the real
POST/PATCH handlers** rather than hand-written: `packetSellerPriced`,
`packetCompPriced`, `packetCompRebuilt`, `packetHostileUrl` (stores
`javascript:alert(document.domain)` **unsanitized on purpose**, so the client is the
thing under test), `packetPartialBasis`, `packetNoBasis`.

**Negative control.** Assertions were checked to fail when the behaviour is removed —
three mutations, restored from `/tmp/core.d4.bak` after each:

| mutation | result |
|---|---|
| `_reviewSafeSourceUrl` returns `raw.trim()`, and the caption sources `metadata.generatedAt` | **294 passed, 7 failed** — the hostile-URL, stored-instant and rebuild-did-not-move assertions all failed |
| role hard-coded to `determining` | **298 passed, 3 failed** — the seller/context assertions failed |

Element structure is not behaviour; a suite that passes with the behaviour deleted would
have proved only that a `div` exists.

**Regression, all suites run individually** (`tests/run-all.sh` not run):
`asset-fingerprints` 15/0 · `draft-review-screen` 301/0 · `draft-list-screen` 101/0 ·
`draft-crud-e2e` 190/0 · `quick-pricing` 219/0 · `copy-truth-offline` ALL PASSED ·
`launch-audit-regressions` 438/0 · `listing-packet-offline` 232/0 · `draft-store` 135/0 ·
`sell-eligibility` 113/0 · `sell-gate-ordering` 38/0 · `draft-readiness` PASS ·
`accuracy-fee-parity` 41/0 · `review-fee-dl` 21/0.

**Visual check.** The block was screenshotted at 1280px and 390px, light and dark, on
five fixtures (comp, seller, partial, hostile, no-basis). No wrap, overflow or
contrast defects; the rejected-link and absent-time sentences fit inline on mobile.

---

## 3. Bundle generation

`js/core.86000bf2.js` → **`js/core.ced9f5eb.js`** via `git mv`, single reference updated
at `index.html:3777`, **generation 7** row added to `audit/BUNDLE_CITATION_MAP.md`,
`node tests/asset-fingerprints.mjs` 15/0. `86000bf2` **was** committed (`c16d579`), so
older citations naming it stay alignable via `git show c16d579:js/core.86000bf2.js`.

**Naming hazard, recorded not fixed:** `_reviewBasisRow` (`:21581`) is unrelated to this
block — it is the fee-panel row helper, where "basis" means the *item-price-only*
qualifier. Two unrelated senses of "basis" now sit ~250 lines apart. Not a duplicate
implementation, so not a rule-1 violation; still a citation trap.

CSS: `.review-packet-basis` plus four companion rules at `index.html:1154-1158`, using
**existing tokens only** — no new undeclared token was introduced (four undeclared ones,
`--accent`, `--danger`, `--surface-1`, `--text-dim`, remain open from earlier work).
No new production global was added.

---

## 4. What this does NOT establish

- **Nothing about whether the stored number is right.** This block shows what the packet
  recorded and when it was read. It does not verify the price against the source, and a
  wrong number with an honest label will render as confidently as a right one.
- **Nothing about coverage across venues.** The listing/review path is eBay only
  (`CR_D1_SLOT='ebay:fixed-price'`). Provenance is not proven on any other venue,
  because no other venue reaches this screen.
- **`applyEdit` still never updates `priceSource`** (open item, pre-existing). So a
  seller who edits a comp-derived price by hand keeps the `comp` role, and the block will
  call their typed price derived. The role is only as true as `priceSource`, and that
  field has a known staleness bug this block does not fix.
- **Nothing server-enforced.** Rendering is client-side; a modified client can display
  whatever it likes. This is the same explicit trust limitation accepted when Lane A was
  closed (bounded) at `da13bee`, not a new one.
- **`datedBySource` is trusted as stored.** If a future ingestion sets it wrongly, the
  block will print "The source published this as-of date." for a date the source never
  published. Nothing here cross-checks the flag.
- **The `unknown` role is common, not exceptional.** Drafts created without a
  `priceSource` — including everything the harness's `httpInput()` produces — land there.
  The copy is honest about that, but it is not a small edge case.
- **No new suite floor.** SI-1 (a per-suite expected-assertion-count floor, so a
  truncated run fails instead of looking like a pass) is still **OPEN and not built**
  (`audit/SUITE_COVERAGE_INTERRUPTIONS.md`). The 301/0 above is a full run today; the
  mechanism that would prove any future run was not truncated does not exist yet.
- **Not deployed, not pushed.** The push gate still stands: the Cert ID rotation is
  mandatory and not done, and `EBAY_LIVE=1 node tests/ebay-live.mjs` is 18/19.

---

## 5. Reconciliation correction folded in

While screenshotting, one earlier claim was found wrong and corrected in
`audit/PHASE1_RECONCILIATION_2026-09-08.md` §7.1: **expected net is not missing — it is
already on the review screen** as `Estimated net (item only)`
(`js/core.ced9f5eb.js:21664`, qualifier mechanism documented `:21560`), rendered from the
shipped forward fee function. §2's "absent" reading was reasoning from packet
membership, which is exactly the error §7.2 corrects. The genuine remaining gap is
narrower: the net is **item-price-only**, because buyer-paid shipping and sales tax are
not recorded on the draft.
