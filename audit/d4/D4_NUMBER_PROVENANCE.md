# D4 — Number provenance on the review screen

**Date:** 2026-09-08 · **Branch:** `phase1-block-d` · **Live bundle: `js/core.84f79a1f.js` (22,552 lines)**
**Suite:** `tests/draft-review-screen.mjs` — **316 passed, 0 failed** (301 at the first D4 commit, 268 before the block)

> **Closeout pass applied.** The three review items are implemented and are described
> in **§6**, which is the section to read for what changed after the first D4 commit:
> a price edit now re-attributes, the retrieval caption no longer claims a source
> published date, and every recoverable bundle generation is retained on disk with an
> assertion that enforces it. Line citations below that name `js/core.ced9f5eb.js`
> refer to the previous generation; that file is retained on disk, and the live bundle
> is `js/core.84f79a1f.js`.
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

A second sentence says whose clock the instant is (`data-basis-dating`). **As shipped in
the first D4 commit it switched on `datedBySource` and, in one arm, called the retrieval
instant "The source published this as-of date." That was wrong and is corrected — see
§6.2.** The caption is now unconditional: "This is when CardResell read the source. It is
not a date the source published." A source-published date is a separate row that renders
only from a recorded source instant, and no ingestion records one today.

The retrieval time is rendered **absolute**, and that is a choice rather than a
correctness rule. An earlier comment in `_reviewWhen` claimed a relative caption was the
same drift as re-deriving the stamp; it is not. "12 days ago" computed from a stored
absolute instant is a correct rendering of that instant. What was wrong in the earlier
defect was deriving the stored instant itself at rebuild time. The comment is corrected
in the live bundle; absolute stays because this screen is a pre-submit record a seller
may screenshot, where a fixed instant stays true afterwards.

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

`js/core.86000bf2.js` → `js/core.ced9f5eb.js` (generation 7) →
**`js/core.84f79a1f.js`** (generation 8, this closeout), single reference updated at
`index.html:3777`, both rows in `audit/BUNDLE_CITATION_MAP.md`,
`node tests/asset-fingerprints.mjs` **56/0**.

**Correction to what this section said.** Generation 7 was done with `git mv`, and this
section reported the removal of the old filename as if it were the method. It is not:
retained old assets are the method (`tests/_assetRefs.mjs` says so in its own header),
because a browser holding cached HTML still requests the old URL. Git recoverability
answers the citation question; only a file on disk answers the browser question.
`js/core.86000bf2.js` is restored with its committed bytes, and checking the rest of the
set found the same deletion had happened seven times in total. All seven are restored
and byte-verified — see §6.3.

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
- **The role is only as true as `priceSource`.** The staleness that made this dangerous
  — `applyEdit` never moving `priceSource`, so a hand-typed price kept the `comp` role —
  is **fixed** in this closeout (§6.1). What remains is the general limitation: any
  future write path that sets `priceSource` wrongly produces a wrong role here.
- **Nothing server-enforced.** Rendering is client-side; a modified client can display
  whatever it likes. This is the same explicit trust limitation accepted when Lane A was
  closed (bounded) at `da13bee`, not a new one.
- **`datedBySource` is trusted as stored, but it can no longer produce a false date.**
  A wrongly-set flag now only adds the sentence "The source dates its own data, but that
  date was not recorded with this quote". Nothing here cross-checks the flag; the
  correction is that the flag no longer relabels our retrieval instant (§6.2).
- **No source-published date is ever shown today.** The row exists and renders only from
  a recorded `sourcePublishedAt`; no ingestion writes that field
  (`api/_listingPacket.js` `stampPriceBasisReporting` does not emit it), so the row is
  currently unreachable in production. It is documented rather than removed so the next
  ingestion that does record one displays the source's own date instead of ours.
- **The `unknown` role is common, not exceptional.** Drafts created without a
  `priceSource` — including everything the harness's `httpInput()` produces — land there.
  The copy is honest about that, but it is not a small edge case.
- **No new suite floor.** SI-1 (a per-suite expected-assertion-count floor, so a
  truncated run fails instead of looking like a pass) is still **OPEN and not built**
  (`audit/SUITE_COVERAGE_INTERRUPTIONS.md`). The 316/0 above is a full run today; the
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

---

## 6. Closeout pass — the three review items

All three were accepted as stated. Nothing else was changed. Every citation below is
against the live bundle `js/core.84f79a1f.js` unless it names a server file.

### 6.1 A price edit re-attributes, and the basis survives as context

**The defect the review named:** a seller changes a comp-derived asking price, and D4
tells them that price "was derived from the market data below". The stale `priceSource`
had been harmless while nothing rendered it; D4 turned it into a visible false claim.

**Where it is fixed:** `applyEdit` in `api/_draftStore.js:641`, in the `patch.price`
branch — `if (next.price !== current.price) next.priceSource = PRICE_SOURCE.SELLER;`
(`api/_draftStore.js:679`). Three properties, each deliberate:

- **Compared after normalization.** `requireMoney` runs first, so `400` resubmitted as
  `400.00` is the same price and does not touch attribution. A form that round-trips its
  own value must not re-attribute a price nobody moved.
- **The basis is not dropped.** It remains a true record of what the market said when
  the draft was made, and beside a seller-set price it is exactly what the review screen
  calls *context*. Deleting a fact to fix a label would be the wrong repair.
- **One owner.** Both `updateDraft` (`api/_draftService.js:365`) and the store's own
  guarded path (`api/_draftStore.js:996`) come through `applyEdit`, so the rule lives in
  one place. A second copy would be the bug.

**The rebuild path needed no change and was verified rather than assumed:** the PATCH
handler's `rebuildPacket` closure carries the prior basis forward from the record and
passes `priceSource: next.priceSource` (`api/drafts.js:392`), which `updateDraft` invokes
before writing (`api/_draftService.js:389`), so the role flips on the
rebuilt packet. A client-supplied basis on rebuild is still refused
(`PRICING_CONTEXT_BASIS_NOT_BINDABLE`).

**Evidence.** Unit, at the edit owner (`tests/draft-store.mjs`): a changed price is
recorded seller-set (`:726`), a notes-only edit leaves attribution alone (`:737`),
title-only and quantity-only likewise, and a normalized no-op does **not** re-attribute
(`:751`). End to end through the real POST/PATCH handlers and a reload
(`tests/draft-review-screen.mjs:2193`): the screen stops saying "derived", says
"market context" with "you set this asking price yourself", still renders the preserved
label and retrieval instant, and the rebuilt packet documents the **new** price
(`:2226`). The control that keeps the rule from becoming "any edit means the seller set
it" is the notes-only case at `:2231`.

**One existing assertion changed meaning, and it is recorded in the test.** A repriced
draft used to raise `NO_PROVENANCE`; it now raises `SELLER_PRICED`, because the origin of
the number is no longer unknown — the seller typed it. Both are warnings and both surface
on the same screen, so no disclosure disappeared. The old assertion text, the reason it
moved, and an explicit check that the draft did not fall silent between the two arms are
all in `tests/draft-store.mjs:697`; the service-path equivalent is
`tests/draft-crud-e2e.mjs:982`, which now evidences the behaviour ("the packet no longer
covers this price") rather than one code that used to carry it.

### 6.2 Retrieval time is labelled as our read, and a source date needs its own timestamp

**The defect the review named:** D4 read only `retrievedAt`, then sometimes captioned it
"The source published this as-of date." `datedBySource` is a boolean saying the feed
dates its data at all; nothing records **which** instant the feed published. The
displayed value was always ours.

**What it says now** (`js/core.84f79a1f.js:21968`), unconditionally: *"This is when
CardResell read the source. It is not a date the source published."* The row label
changed with it, from **Retrieved** to **Retrieved by CardResell**.

**A source-published date is now a separate row** (`:21976`,
`data-basis-source-published`), rendered only from a recorded `sourcePublishedAt` read at
`:21883`. **No ingestion writes that field today** —
`stampPriceBasisReporting` (`api/_listingPacket.js:421`) does not emit it, and the stored
basis carries only the boolean `datedBySource`. So the row is currently unreachable in
production, and that is stated here rather than hidden: it exists so the day something
records a real source instant, the screen shows the source's date instead of relabelling
ours. No value was invented to populate it.

**The gap is stated when the flag claims otherwise** (`:21980`,
`data-basis-source-dated="unrecorded"`): *"The source dates its own data, but that date
was not recorded with this quote."*

**The relative-vs-absolute point is accepted.** A relative age computed from a stored
absolute instant is a correct rendering of that instant and is not equivalent to
resetting the retrieval time; the earlier `_reviewWhen` comment equated the two and has
been rewritten (`js/core.84f79a1f.js:21842`). Absolute formatting stays, now justified by
what it is good for rather than by a false equivalence.

**Evidence.** `tests/draft-review-screen.mjs:2057` — the caption attributes the read to
CardResell and never carries the retired claim; no source-published row renders, and the
fixture is asserted to have no `sourcePublishedAt`. A new fixture
(`packetDatedBySource`, created through the real POST handler with `datedBySource: true`)
drives `:2184` — the gap sentence appears, the row still does not, and the retrieval
instant is not offered as the source's. The assertion that was rewritten records what it
used to assert and why, in the test file itself.

### 6.3 Retained bundles, asserted rather than remembered

**The defect the review named:** generation 7 used `git mv`, and §3 reported removing the
old filename as though that were the method. It is not. `tests/_assetRefs.mjs` states the
retention rule in its own header, and the reason is a browser holding cached HTML that
still requests `/js/core.86000bf2.js`. A passing fingerprint suite says checked names
match their bytes; it says nothing about whether an older required asset exists.

**Restored:** `js/core.86000bf2.js` from `c16d579`, bytes verified to hash to
`86000bf2`. Checking the whole recorded set rather than the one file the review named
found the same deletion had happened **seven times**: `2c7cf451` (`79dc1bd`), `34fb750c`
(`a8dc3d6`), `4c65092e` (`2ffb351`), `541c4c39` (`19cb94c`), `9fd82d6e` (`251f3a0`),
`c61a6ef9` (`0cc4477`) and `86000bf2`. All seven restored, each byte-verified against its
own name.

**Two generations cannot be restored, and one of them is a finding.**
`b7447fe5`, `fec7fb3a` and `611f4efe` appear in no commit. `69b38a85` is worse: it was
committed empty at `2ffb351` and committed at `fa4739b` with bytes that hash to
`75f9494e` — **a bundle whose name never matched its content in any commit**, which is
the exact defect `tests/asset-fingerprints.mjs` exists to prevent, sitting in history.
Restoring it would mean shipping a name that contradicts its bytes, so it is declared
unrecoverable by name and reason instead.

**The rule is now enforced** (`tests/asset-fingerprints.mjs:94`): the suite reads
`audit/BUNDLE_CITATION_MAP.md`, extracts every `core.<hash>` it names, and fails unless
each is on disk with bytes matching its name or listed in an `UNRECOVERABLE` map with a
stated reason. Deleting a retained bundle is now a red suite; excusing one is a
reviewable edit. `node tests/asset-fingerprints.mjs` — **56 passed, 0 failed** (15 before
this pass).

**Also corrected in `audit/BUNDLE_CITATION_MAP.md`:** its notes said no file with the
bytes of `4c65092e` or `9fd82d6e` survives to align against. Both were committed with
matching bytes and both are now on disk.

### 6.4 Suites run for this pass

Run individually, never through `tests/run-all.sh`:

| suite | result |
|---|---|
| `draft-review-screen` | **316 passed, 0 failed** (301 before) |
| `draft-store` | **147 passed, 0 failed** (135 before) |
| `draft-crud-e2e` | **192 passed, 0 failed** (190 before) |
| `asset-fingerprints` | **56 passed, 0 failed** (15 before) |
| `listing-packet-offline` | 232 passed, 0 failed |
| `draft-list-screen` | 101 passed, 0 failed |
| `quick-pricing` | 219 passed, 0 failed |
| `copy-truth-offline` | all checks passed |
| `launch-audit-regressions` | 438 passed, 0 failed |
| `sell-eligibility` | 113 passed, 0 failed |
| `sell-gate-ordering` | 38 passed, 0 failed |
| `draft-readiness` | PASS |
| `accuracy-fee-parity` | 41 passed, 0 failed |
| `review-fee-dl` | 21 passed, 0 failed |

**One unrelated flake was found and fixed, not silenced.** In the create-path binding
section of `draft-review-screen`, an assertion read `window._crBasis` **after** the click
returned, racing the create's success handler that clears it. It failed once, then passed
on a rerun without any change — the claim ("the global was populated when the body was
built, yet the basis did not reach the wire") was right, the evidence sampled the wrong
instant. The value is now captured in-page as the request leaves, via a fetch wrapper
installed by the test only. What it used to assert and why is recorded at the assertion.

**Visual QA:** the corrected block screenshotted at 1280px and 390px, light and dark, for
the comp, seller, edited, dated-flag, partial, hostile-URL and no-basis states.

**Still not pushed, still not deployed.** Cert ID rotation remains mandatory and undone.

---
