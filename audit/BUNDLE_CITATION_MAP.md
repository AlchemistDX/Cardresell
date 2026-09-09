# Bundle citation map

**2026-09-09:** `js/core.66c39922.js` is **retired** (retained on disk; audit
documents cite its line numbers). Live bundle on branch is **`js/core.e9f21f4e.js`** (was `js/core.73a71fac.js`, then `core.176e4a56.js`, both retired 2026-09-09 by the RV-13 fix).
Forced by the RC-1 review copy and the blank-shipping note.
 — retired generations → live

**Live bundle: `js/core.3f83abec.js` (23,261 lines).** New work cites that hash.

> ### Generation 12 — the listing-photo screen
>
> | # | from → to | commit | what moved |
> |---|---|---|---|
> | 12 | `ea2f03c4` → `3f83abec` | *(this commit)* | D7 photo UI on the review screen: add through a real picker, reorder as a store-side operation (`photosMove` takes an id and a direction, never an order array), remove, a missing-photo tile distinct from the empty line, the browser-local limitation rendered outside the grid/empty branch so no state can hide it, decode validation calling the scan path's `_validateScanFile` for format and HEIC guidance, and a partial-batch line attributing the 12-photo cap to CardResell rather than to eBay. Two UI defects fixed while testing: `busy` was not released on a throw (dead Add button, no error shown), and `input.value = ''` before reading `input.files` emptied the live list. |
>
> **`ea2f03c4` is retained on disk**, copied rather than moved.

> ### Generation 11 — local listing photos
>
> | # | from → to | commit | what moved |
> |---|---|---|---|
> | 11 | `a7e7422d` → `ea2f03c4` | *(this commit)* | D7: an IndexedDB listing-photo store. Manifest and blobs are separate object stores in one database, written in one transaction; success is the transaction's `complete` event, never a request's `success`; the manifest is read and rewritten inside the write transaction so two tabs cannot overwrite each other; a manifest entry with missing bytes renders an explicit unavailable state; failure copy names only a cause the error establishes. See `audit/d7/D7_ENTRY_GATE.md` §6. |
>
> **`a7e7422d` is retained on disk** with bytes matching its own name — copied
> back after a `git mv`, which is the generation-8 mistake and was caught here
> by `tests/asset-fingerprints.mjs` rather than by review.

> ### Generation 10 — the instruction to look
>
> | # | from → to | commit | what moved |
> |---|---|---|---|
> | 10 | `7629ec69` → `a7e7422d` | *(this commit)* | D5 review response: both eBay continuation surfaces now lead with an imperative — "Check that eBay picked the right card before you continue" — in its own non-muted element above the seed, naming the collector number to compare against. See `audit/d5/D5_ENTRY_GATE.md` §8. |
>
> **`7629ec69` is retained on disk** with bytes matching its own name.

> ### Generation 9 — the eBay continuation control
>
> | # | from → to | commit | what moved |
> |---|---|---|---|
> | 9 | `84f79a1f` → `7629ec69` | *(this commit)* | D5: two shared builders (`ebaySellSeed`, `buildEbaySellStartUrl`) replace the dead `sell/listing?flow=startSell` deep link; the scan-miss CTA routes through them and is withheld when the seed is empty; the review screen gains a continuation link behind the same gate as the copy row, showing the seed it sends. |
>
> **`84f79a1f` is retained on disk** — copied, not `git mv`d, which is the
> mistake generation 8 documents. Bytes verified against its own name by
> `tests/asset-fingerprints.mjs`.

> ### Generation 8, and a retention rule that had been quietly broken
>
> | # | from → to | commit | what moved |
> |---|---|---|---|
> | 8 | `ced9f5eb` → `84f79a1f` | *(this commit)* | D4 closeout: the retrieval caption is unconditional and attributed to CardResell, a source-published row renders only from a recorded source instant, an unrecorded source date is stated as a gap, and the `_reviewWhen` doc comment stops equating a relative age with re-deriving the stamp. |
>
> **`ced9f5eb` is retained on disk, and so is every other recoverable
> generation this file names.** The D4 rename used `git mv`, which removed
> `js/core.86000bf2.js` from the working tree. A review caught it and named the
> distinction this map had been blurring: git recoverability answers the
> *citation* question — what did that line say then — but only a file on disk
> answers the *browser* question, whether `GET /js/core.86000bf2.js` returns
> 200 for a client holding cached HTML. `tests/asset-fingerprints.mjs` passed
> throughout, because it only checks the assets `index.html` references today.
>
> Checking the whole set rather than the one file the review named found the
> same deletion had happened **seven times**. All seven are restored from the
> commit that carried them, bytes verified against their own names:
>
> | generation | restored from | bytes hash to its name |
> |---|---|---|
> | `2c7cf451` | `79dc1bd` | yes |
> | `34fb750c` | `a8dc3d6` | yes |
> | `4c65092e` | `2ffb351` | yes |
> | `541c4c39` | `19cb94c` | yes |
> | `9fd82d6e` | `251f3a0` | yes |
> | `c61a6ef9` | `0cc4477` | yes |
> | `86000bf2` | `c16d579` | yes |
>
> **Two corrections to what this file said below.** The notes on generations
> naming `4c65092e` and `9fd82d6e` say no file with those bytes survives to
> align against. That was wrong: both were committed with matching bytes
> (`2ffb351`, `251f3a0`) and both are now on disk. What was true of them is
> true only of `69b38a85` and `b7447fe5`.
>
> **`69b38a85` cannot be restored, and the reason is worse than absence.** It
> was committed empty at `2ffb351`, then committed at `fa4739b` with bytes that
> hash to `75f9494e` — a name that never matched its content in any commit,
> which is the exact defect the fingerprint suite exists to prevent, sitting in
> history. It is declared unrecoverable by name in the suite rather than
> restored under a name it would contradict. Same for `b7447fe5`, `fec7fb3a`
> and `611f4efe`, which no commit contains at all.
>
> **The rule is now enforced, not remembered.** `tests/asset-fingerprints.mjs`
> reads this file, extracts every `core.<hash>` it names, and fails unless each
> one is on disk with bytes matching its name or listed in the suite's
> `UNRECOVERABLE` map with a reason. Deleting a retained bundle is now a red
> suite; excusing one is a reviewable edit.

> ### Four generations this file did not record when they happened
>
> Between the T2.9 rev2 pass and 2026-09-08 the bundle was renamed four times
> and **this map was not updated for three of them.** Recording it late is
> worse than recording it on the day and better than leaving the header
> pointing at a hash that has not been live since 2026-09-08 morning:
>
> | # | from → to | commit | what moved |
> |---|---|---|---|
> | 1 | `59d4b1ab` → `9f0f6b30` | `5228494` | T2.9 rev3 corrections, TRS gate, capture reduction. **Recorded here late.** |
> | 2 | `9f0f6b30` → `541c4c39` | `19cb94c` | T2.10 midBasis preservation, derived-centre labels. **Recorded here late.** |
> | 3 | `541c4c39` → `fec7fb3a` | *(never committed under this name)* | The Lane A client work. Renamed, then the file changed again before the commit, so **no committed tree ever contained `fec7fb3a`** — do not cite it. |
> | 4 | `541c4c39` → `34fb750c` | `a8dc3d6` | The same Lane A client work as landed: pricingContext builder, review-screen packet arms, refresh path. |
> | 5 | `34fb750c` → `c61a6ef9` | *(this commit)* | Lane A three-question close: `_reviewPacketBlocking`, the `details-blocked` verdict arm, the `DRAFT_REVISION_CONFLICT` re-read, and the copy refusal for a blocked packet. **Recorded on the day.** |
> | 7 | `86000bf2` → `ced9f5eb` | *(this commit)* | D4 price provenance on the review screen: `_reviewSafeSourceUrl`, `_reviewWhen`, `_reviewBasis`, `_REVIEW_BASIS_ROLE`, `_reviewBasisHtml`, wired into the usable-packet arm of `_reviewPacketHtml`. `86000bf2` WAS committed (`c16d579`), so a citation naming it can be aligned by `git show c16d579:js/core.86000bf2.js`. |
> | 6 | `c61a6ef9` → `86000bf2` | *(this commit)* | The create-path basis binding: `_crBindBasis`, `_crPricingContext` requiring a card and a matching `cardKey`, and the three read paths stamping on the way in. |
>
> **Generation 5 passed through a second naming hazard.** The rename ran twice
> in one session: `34fb750c` → `611f4efe` (the code fixes) → `c61a6ef9` (the
> comment corrections that followed them). `611f4efe` was a valid fingerprint
> of a real file for part of one session and appears in no commit, so — like
> `fec7fb3a` — **never cite it.** Only `c61a6ef9` is committed.
>
> **Generation 6 was renamed once, cleanly.** `c61a6ef9` WAS committed (`ffa735d`),
> so unlike generations 1-4 a file with those bytes survives in git and a
> citation naming it can be aligned by `git show ffa735d:js/core.c61a6ef9.js`.
> Its line numbers hold up to `_crBindBasis`, which was inserted immediately
> before `_crPricingContext`; everything after that point in `86000bf2` sits
> about 40 lines lower.
>
> Generations 1 and 2 were in-place edits under the old name before the rename,
> so — same as every prior generation in the tables below — **no file with
> those bytes survives to align line numbers against.** They are not added to
> the retired-generation tables for that reason, and a citation naming
> `59d4b1ab` or `9f0f6b30` cannot be mechanically re-derived; it has to be
> re-grepped by symbol against the live hash.
>
> **Generation 4 joins them.** `34fb750c` was also edited in place before it
> was renamed onward to `c61a6ef9`, so no file with `34fb750c` bytes survives
> either,
> and it gets no retired-generation table for the same reason. A citation
> naming `34fb750c` has to be re-grepped by symbol against `c61a6ef9`. The
> symbols involved are listed in generation 5's row; everything else in that
> generation is byte-identical and its line numbers are unchanged up to the
> first edit point.
>
> **Generation 3 is a naming hazard, not a generation.** `fec7fb3a` was a valid
> fingerprint of a real intermediate file for the length of one work session
> and appears in no commit. Anything citing it is citing a file that was never
> version-controlled.

> **`2c7cf451` was renamed to `59d4b1ab` on 2026-09-08 by the T2.9 review pass,
> and it is NOT in the retired-generation tables below** — same reason as its
> predecessors: the edit was in place, so no file with those bytes survives to
> align against. The pass reclassified four venues' `taxOn`/`taxBasis`, turned
> `venueTaxNote` into a state-returning helper, split `FEE_DISCLOSURE.estimateNote`
> into `estimateStem` plus a new `venueEstimateNote(pid)`, and added four
> per-venue fields (`taxNoun`, `taxBaseName`, `taxBaseIncludes`,
> `taxBaseFeeName`). 138 lines net.
>
> **Concrete consequence:** the insertions land in two regions — inside
> `PLATFORMS` (~6,290–6,345) and around `venueTaxNote`/`FEE_DISCLOSURE`
> (~6,730–7,460). A citation naming `2c7cf451` **below ~6,290** now points high
> against live, by roughly 12 lines between there and the helper block and by
> roughly 138 lines below it. The **first** T2.9 return packet cited `2c7cf451`;
> this revision re-derives every citation against `59d4b1ab` directly, so the
> drift affects the superseded packet only.
>
> **Unresolved count re-derived by running `tools/bundle-citation-map.mjs` after
> the rename: still 109** (108 `d9e1b484`, 1 `8e031c8f`) — unchanged, because the
> insertions landed in regions no retired citation points at. Re-ran the
> artifact; did not re-implement its query.

> **`9fd82d6e` was live for one commit and is NOT in the retired-generation
> tables either.** T2.9 landed on it, then a follow-up removed the D3 review
> screen's duplicate sales-tax row (eight lines: a docblock and one ternary),
> which changed its bytes and its name a second time in the same sitting:
> `4c65092e` → `9fd82d6e` → `2c7cf451`. The T2.9 return packet cites `9fd82d6e`
> because it was written against it; those citations sit **above** the review
> screen at ~21,190, and the follow-up inserted only at that point, so every
> T2.9 citation below ~6,247 and above ~21,190 still resolves at the same line
> against `2c7cf451`. The eight inserted lines shift only citations at or below
> `_reviewFeesHtml`. **Unresolved count re-derived by running the tool again
> after this rename: still 109.**
`24cd52cb` joined the retired set at the BIAS-6 rename on 2026-09-08 (commit
`fa4739b`); `7f9c03ad` joined it at the D3 closeout rename on 2026-09-07.

> **`4c65092e` was renamed to `9fd82d6e` by T2.9 on 2026-09-08, and — like
> `69b38a85` before it — it is NOT in the retired-generation tables below,
> because no file with those bytes survives to align against.** T2.9 edited it
> in place (a `taxOn`/`taxBasis` docblock, fifteen field lines, the `venueTaxNote`
> helper, one deleted statement), which changed its bytes and therefore its
> name. The tool now reports `9fd82d6e` as live because it derives the name from
> `index.html` rather than from this file.
>
> **Concrete consequence, stated rather than left implicit:** the T2.9 insertions
> land at the head of `PLATFORMS`, so a citation naming `4c65092e` at a line
> **below ~6247** now points roughly **75 lines high** against live, and there is
> no `4c65092e` snapshot for the verifier to measure that offset from. Citations
> written during the BIAS-6 work name exactly that bundle. Per the standing
> decision this is drift, not rot: a named bundle differing from live is not a
> failure rule, no broad historical cleanup is being run, and citations
> introduced by T2.9 cite `9fd82d6e` directly. What is new here is only that the
> offset is now recorded instead of inferred.
>
> **Unresolved count re-derived with the tool after the rename: still 109**
> (108 `d9e1b484`, 1 `8e031c8f`) — unchanged, because the T2.9 insertions landed
> in a region no retired citation points at. Re-derived by running
> `tools/bundle-citation-map.mjs`, not by re-implementing its query.

`69b38a85` was live for less than a day and is **not** in the retired-generation
tables below: the BIAS-6 review corrections edited it in place, which changed
its bytes and therefore its name, twice in one sitting
(`69b38a85` → `b7447fe5` → `4c65092e`). No citation in the corpus targets either
intermediate name; anything written against `69b38a85` during that window was
rewritten to `4c65092e` before commit.

> **Unresolved count moved 72 → 109 at the BIAS-6 rename, and that is drift, not
> rot.** The BIAS-6 corrections inserted roughly 1,000 lines into the live
> bundle, so 37 further `d9e1b484` citations now map onto a line whose content
> shifted. Nothing about the retired bundles changed; what changed is the
> target they are aligned against. Per the standing decision, a named bundle
> differing from live is **not** a failure rule, and no broad historical
> citation cleanup is being run. Citations introduced by the BIAS-6 work cite
> `4c65092e` directly.
>
> **Re-derived 2026-09-08 after the review corrections: still 109.** The
> corrections added roughly 60 more lines but did not move the count, because
> they landed in regions no retired citation points at. 108 of the 109 are
> `d9e1b484` (6,520 of 6,628 resolve); the remaining one is `8e031c8f`.

> **The offset tables below are a convenience cache and are now one generation
> stale.** `tools/bundle-citation-map.mjs` derives the live name from
> `index.html`, so running it is always correct; the stamped intervals here were
> measured against `7f9c03ad` as live. Re-derive rather than trust a number in
> this file — that is the rule this file's own tool header states, and the
> reason the tool exists.

> **The verifier cannot detect a wrong bundle NAME, only a wrong line.** It
> assumes a citation naming bundle X was written against X's bytes and aligns
> X→live accordingly. During D3, documents cited `core.7f9c03ad.js` with line
> numbers taken from the *working tree*, which the rename has now published as
> `core.24cd52cb.js` while `7f9c03ad.js` was frozen back to its own original
> bytes. Those citations name a file whose bytes never contained what they
> cite, and the tool reports them as resolving — it maps a line the author
> never read onto a line they never meant. All 18 name-level `7f9c03ad`
> citations differ in content between retired and live at the cited line. Two
> were adjudicated at closeout; **the other 16 are an open finding** (see the
> closeout packet). `42/42 citations resolve` is a statement about arithmetic,
> not about authorship.

The corpus does not. 408 line-citations point at `core.d9e1b484.js` and exactly **one** points
at `core.8bd8277a.js`, so reading almost any existing audit document means translating from the
oldest generation. This table is that translation, direct — never composed through the
intermediate generations.

## Why direct, not chained

Each rename produced its own offset map, so the mechanical route from a `d9e1b484` citation to
a live line is `d9e1b484 → 8bd8277a → 7f9c03ad`. That composition is tolerable at two hops and
unusable at five, and every hop is a place to make an arithmetic error silently. Each retired
generation is therefore diffed **straight against the live bundle**.

Composition was checked against measurement here, and agreed. That is a reason to trust the
tables, not a reason to keep composing by hand.

## `core.d9e1b484.js` (18,526 lines) → `core.7f9c03ad.js`

Four constant-offset intervals. **No deleted lines** — every line in `d9e1b484` has a
byte-identical counterpart in the live bundle.

| `d9e1b484` lines | Add | Notes |
|---|---|---|
| 1 – 8,116 | **+0** | everything up to `switchView` is untouched |
| 8,117 – 8,121 | **+2** | `switchView` view-handle declarations |
| 8,122 – 8,136 | **+4** | `switchView` display resets |
| 8,137 – 18,526 | **+18** | the rest of the bundle, including all of `api`-adjacent client code |

Anything at or below 18,527 in the live bundle is new since `d9e1b484` — the D2.1 drafts screen
and the D3 review screen — and has no `d9e1b484` address at all.

## `core.8bd8277a.js` (19,001 lines)

**No longer tabulated — and the reason is worth more than the table was.**

This document originally carried a five-interval table for `8bd8277a`. **It went stale one
commit later.** D3 step 3 inserted lines inside the region that table described, and the true
alignment is now nine intervals. Nothing announced that; the table simply became wrong while
continuing to look authoritative.

`d9e1b484`'s table survived the same commit unchanged, because every D3 insertion lands below
the last line `d9e1b484` has an address for. So one stamped table aged and one did not, in the
same edit, for reasons no reader could infer from either.

That is the whole argument for cache-versus-source-of-truth, demonstrated on this page rather
than asserted. `8bd8277a` has **one** line-citation in the corpus, so the table was never
earning its keep. Derive it:

```
node tools/bundle-citation-map.mjs 8bd8277a <line>
```

## `core.569ff536.js` (17,723 lines)

**Not tabulated.** Zero line-citations in the corpus. Its alignment to live is 25 intervals
with a genuine gap — a line that survives in no form — so a table would be both long and
misleading. If a citation to it ever appears, derive it on demand:

```
node tools/bundle-citation-map.mjs 569ff536 <line>
```

## The tables above are a cache. This is the source of truth

```
node tools/bundle-citation-map.mjs              # verify every corpus citation resolves
node tools/bundle-citation-map.mjs d9e1b484 8120  # translate one, mid-read
```

A hand-maintained offset table is a **derived value stamped into a document**, which is the
failure that produced `BUNDLE_RENAME_7f9c03ad.md` §"The expected name was wrong": a hash named
in advance of the derivation, executed later on trust. A table that ages is the same shape,
slower. So the derivation ships as a runnable check, and the table is a convenience that the
check can contradict.

The tool discovers the live bundle from the single `<script defer src>` in `index.html` rather
than taking it as a constant, so the next rename needs **no edit here** — the tables go stale
and the tool does not.

## Verified 2026-09-06 (re-verified after D3 step 3)

`6,629 / 6,629` cited lines are byte-identical at their mapped position, across all
`audit/**/*.md` and `tests/*.mjs`.

Three mutations confirm the check can fail:

| | Mutation | Caught by |
|---|---|---|
| M1a | citation to an out-of-range line (`:99999`) | "do not resolve", exit 1 |
| M1b | mutate one live line that a real citation points at | that citation reported by file and line |
| M2 | two `core.*.js` script tags in `index.html` | throws, refuses to guess which is live |

Two independent implementations were used deliberately: Python `difflib` opcodes and, in the
tool, unique-line anchoring with outward run extension. They produce identical intervals for
both tabulated generations.

## `core.3f83abec.js` (23,261 lines) → `core.d5fcdced.js` (retired 2026-09-08)

Retired by the D6 note: `_reviewSellLimitsHtml` and its two call sites were added
inside `_reviewSellStartHtml`, around line 22646. Everything **above** that point
is unshifted, which covers every bundle citation written during the basis-loss
investigation — `loadCardUI` (`:3556`), the startup restore timer (`:20252`),
`_crPricingContext` (`:20687`), `_crBindBasis` (`:20658`), `_reviewBasisHtml`
(`:22262`). Verified: `:20252` still reads the 400ms `setTimeout` on
`_restoreLastLoadedCard` in the live file.

Citations at or below ~22646 shift by the inserted block and must be re-grepped
rather than carried over. Documents written against `3f83abec` keep that name;
this row is the mapping. `audit/d7/basis-loss-trace.json` records
`3f83abec` because that is the bundle the trace was captured from — a captured
artifact is not renamed to match a later generation.

## `core.d5fcdced.js` → `core.fa9c358d.js` (retired 2026-09-08, same day)

A short-lived generation: `d5fcdced` carried the D6 note for one commit before
the closeout amendments (verb weakened to "can face", two help links added)
changed the same function's bytes again. Both edits are inside
`_reviewSellLimitsHtml` at ~22646, so **every citation above that point is
unshifted across both renames** — `loadCardUI :3556`, the startup timer
`:20252`, `_crPricingContext :20687`, `_reviewBasisHtml :22262`. Re-verified:
`:20252` still reads the 400ms `setTimeout` in `core.fa9c358d.js`.

## `core.fa9c358d.js` → `core.66c39922.js` (retired 2026-09-08)

The withdrawn variability claim changed the seed note and its comment inside
`_reviewSellStartHtml` at ~22728. Every citation above that point is unshifted:
`loadCardUI :3556`, the startup timer `:20252`, `_crPricingContext :20687`,
`_reviewBasisHtml :22262`. Re-verified `:20252` in `core.66c39922.js`.

Three live generations in one session — `d5fcdced`, `fa9c358d`, `66c39922` —
each retired byte-identical. When restoring a retired file, take it from **the
commit that shipped it**, not from `HEAD`: `HEAD` already carries the newer
bytes under the older name, and `asset-fingerprints` catches the mismatch.

## Not claimed

- **This does not verify that a citation is still *apt*.** It proves the cited line's bytes are
  unchanged and reachable. A citation can resolve perfectly and still point at code whose
  meaning moved because its callers changed.
- **It is not a registered suite.** It is runnable and mutation-tested, but nothing runs it
  automatically, so a future edit can rot the corpus without going red. Registering it is a
  decision, not an oversight — it belongs to whoever next opens `tests/run-all.sh`. When that
  happens the natural home is **alongside `tests/asset-fingerprints.mjs`, not as its own slot
  on the suite ladder**: both answer "do the artifacts and their references still agree", both
  fail for the same cause — bytes edited without following through — and the ladder is for
  behaviour checks. Slot 1 already owns half the question.
- **The tables on this page are a snapshot and can be wrong without warning.** One of them
  already was, within a single commit. Run the tool.
