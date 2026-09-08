# Return packet — ingestion B, the origin contract, the BIAS-5 lifecycle, T2.14

> **HISTORICAL from here to the end of this section.** Everything below was
> written for commit **`4e82155`** and describes the production-code change made
> *then*: the ingestion-B fix, the third ingestion site, the `api/scan.js`
> `analysis_id` addition, the T2.14 row, and the bundle re-derivation and
> retirement. **Commit `8b0bff2`, the subject of the current packet, changed no
> production code and no bundle** — tests and audit documents only. Where the
> text below reports commit counts, bundle renames, or "shipped" behaviour, read
> it as the state at `4e82155`. The current state is at the top of this file.

**Commit `4e82155`** on `phase1-block-d`. **Bundle `js/core.1eea628c.js`**,
referenced once at `index.html:3740`. Nothing pushed; nothing deployed. The
rotation gate is still closed.

Three items were asked for: resolve ingestion B, confirm the anonymous-object
lifecycle, and report the focused results against the final bundle. All three
are below, followed by the two reporting corrections applied as instructed.

---

## 1. Ingestion B

### What was there

`js/core`, inside `tplCardToNormalized`, the TPL raw path:

```js
lowBasis  = _tp.lowBasis  || 'tcgplayer';
highBasis = _tp.highBasis || 'tcgplayer';
```

The objection was that this promotes an absent provenance field into an accepted
origin. It is worse than that, and the difference matters for how the fix had to
be shaped.

`api/tpl-proxy.js` is **55 lines of pass-through**. It forwards the query to
`https://api.tcgpricelookup.com`, adds `X-API-Key`, caches for five minutes, and
normalizes nothing. `lowBasis` is **our own vocabulary** — it is not a field the
vendor emits, on any endpoint. So the left operand of that `||` was *always*
undefined. The fallback was not a fallback; it was the entire behaviour. Every
TPL endpoint that reached the gate was attributed `'tcgplayer'` purely on the
strength of the object key it happened to be nested under.

Directly above those two lines sat a comment, added the previous day, stating
the correct rule verbatim:

> a basis is READ, never invented. When the nested object carries its own
> attribution we use it; when it does not, the endpoint is unattributed and
> `_crMeasuredRange` refuses it ('unattributed') instead of it inheriting a
> vendor name from the field it was nested under.

The comment was accurate about the rule and silent about the code beneath it,
and the checkpoint reporting the fix described it as landed. That comment is now
a marked retraction in place. The episode is **instance 30** in
`audit/PATTERN_ASSERTION_SURFACE.md`.

### What is there now

A validator, `_crTplAskEndpoints(condData, condKey, rawBlock)`, inserted
immediately before `tplCardToNormalized` and called as
`const _ask = _crTplAskEndpoints(condData, key, raw);`. It attributes endpoints
`'tcgplayer'` **only** when the block conforms to the documented contract, and
otherwise returns unattributed endpoints with a reason:

| reason | condition |
|---|---|
| `no-block` | no condition data at all |
| `no-tcgplayer-block` | condition data with no `tcgplayer` object |
| `block-not-condition-scoped` | the block handed in is not the one `raw[condKey]` holds |

A `highClamped` high is re-tagged `'derived'`, because the clamp is our
arithmetic and this path skips the server clamp. Non-positive values are not
endpoints. The raw-path push also now carries `marketBasis` — `'tcgplayer'` when
the figure came from `tcgplayer.market`, `'ebay-sold'` when the `??` ladder
reached an eBay average, else `null` — because that ladder crosses from an ask
to a sale and the old code recorded nothing about which it had returned.

### The third site, found while extending the test

The same function has a graded-variant branch that was doing this:

```js
const low  = ebay.avg_30d ?? mkt;
const high = ebay.avg_1d  ?? mkt;
```

Averages used as range endpoints, with no basis fields at all, and capable of
producing `low === high === market`. The gate refused it as `'unattributed'`, so
it was invisible — **but the T2.14 row shipped in this same commit would have
rendered a 30-day eBay mean as "Provider low (not used)"**, i.e. the new
disclosure would have started reporting a mean as a provider floor. It now
pushes `low: null, high: null, lowBasis: null, highBasis: null`, with
`mid: mkt, midBasis: 'derived'` and `marketBasis` recorded.

This was not in the reported scope. Flagging it because it is the kind of thing
that becomes visible only when a withheld state stops being invisible.

### Focused chain tests through ingestion B

`tests/quick-pricing.mjs` § 5b. The validator is lifted out of the live bundle
(`core.indexOf('function _crTplAskEndpoints(')`) and composed with the lifted
gate, so these cannot pass against a fixed test while the shipped code differs.
A locatability assertion guards the extraction.

| case | input | result |
|---|---|---|
| conforming block | `raw.near_mint.tcgplayer = {market:100, low:90, high:130}` | both endpoints `'tcgplayer'`; gate `ok: true` |
| **untagged positive endpoint** | `raw.near_mint = {market:100, low:90, high:130}`, no `tcgplayer` block | `low: null`, `lowBasis: null`; gate refuses `no-endpoints` |
| block not condition-scoped | foreign block passed with `condKey: 'near_mint'` | `lowBasis: null`, `why: 'block-not-condition-scoped'` |
| **clamped high** | `{market:100, low:90, high:300, highClamped:true}` | `highBasis: 'derived'`; gate refuses `derived-endpoint` |
| lone low | `{market:100, low:90}` | gate refuses `low-only` |
| non-positive | `{low:0, high:-3}` | neither attributed |

Plus three absence assertions on the shipped source: the `|| 'tcgplayer'` lines
are gone, `marketBasis` is recorded, and the average-as-endpoint lines are gone.

On the untagged-positive case specifically: under the new code the meaningful
distinction is no longer "tagged vs untagged" — nothing is ever tagged upstream
— but **conforming vs not**. The test is shaped that way deliberately.

### The adapter itself — added on review

The gap was correctly identified: § 5b composed `_crTplAskEndpoints` with the
gate, so it tested the validator and not `tplCardToNormalized`, which is where
the defect lived. A validator returning the right answer proves nothing if the
function calling it drops, overwrites or re-tags the result on the way out.

**§ 5b-int now lifts the shipped adapter.** Its only free identifier is
`_crTplAskEndpoints` (the two `_crMeasuredRange` mentions inside it are in
comments), so the real function reconstitutes from bundle text with one
dependency and **no stubs**. It is given a TPL-shaped card object and its
emitted `priceVariant` is fed to the real gate — the shape production produces,
with no hand-built basis object anywhere in the chain.

The three required cases, plus two:

| case | asserted |
|---|---|
| conforming block | `low === 90`, `high === 130`, `lowBasis === highBasis === 'tcgplayer'`, `marketBasis === 'tcgplayer'`, real gate `ok: true` |
| clamped high | `highBasis === 'derived'` **after** normalization; gate refuses `derived-endpoint` |
| graded averages only | `low`, `high`, `lowBasis`, `highBasis` all `null`; `market === 100` with `marketBasis === 'ebay-sold'`; `mid` tagged `derived`; gate refuses `no-endpoints`; and `basis.low == null`, which is what gates the T2.14 row |
| untagged positive, through the adapter | endpoints do not reach the variant; gate refuses |
| untyped graded market | `marketBasis === null` — `g[grade].market` has no documented instrument, so it does not borrow the eBay tag above it |

**These were mutation-tested, not just observed green.** Three mutations were
applied to the live bundle and reverted:

1. Endpoints resurrected past the validator (`condData?.low ?? _ask.low`) →
   **caught**, and caught *only* by § 5b-int. The § 5b validator-level
   assertions all still passed, because the validator was untouched. That is a
   direct demonstration of the gap that was flagged.
2. The original defect restored (`_ask.lowBasis || 'tcgplayer'`) → **caught**.
3. Graded averages restored (`ebay.avg_30d ?? mkt` / `ebay.avg_1d ?? mkt`) →
   **caught**, 3 assertions failing including the T2.14 reachability one.

Bundle restored afterwards; `sha256sum` first 8 is `1eea628c`, matching its own
name, and `asset-fingerprints` re-passes.

One incident worth recording: the first version of the extraction anchored the
slice end on "the next function declaration", which overshot into top-level code
touching `window` and threw `ReferenceError` before a single assertion ran. It
now anchors on the adapter's own closing brace, with an assertion that the
extracted slice contains no `window.` reference. Same family as instance 31, and
it recurred a third time in this same session when a spliced gate region omitted
the line defining its own allow-list. Both now carry explicit
slice-contains-its-dependency assertions.

### The generic provider token in presentation

Retained as required. `_crRangeHtml` renders `· range $90.00–$130.00` and
nothing else, and this is now asserted rather than observed: for a
`provider`-origin range the output must match `/\brange\b/` and must **not**
match `/sold|sales|completed/i` or `/observed/i`. A further assertion requires
that an ask-origin range produce byte-identical wording once digits are
stripped, so no token's presentation can be upgraded above another's on the
strength of its tag — the tag gates admission, not adjectives.

### Naming the co-context guarantee

The instruction was to name and test the guarantee before calling the result a
measured range, and that it need not become new fields everywhere. It has not.

`_CR_ORIGIN_CONTRACT` replaces the bare `_CR_MEASURED_ORIGINS` literal, and
`_CR_MEASURED_ORIGINS = Object.keys(_CR_ORIGIN_CONTRACT)` — one list, derived,
so it cannot drift from the guarantees. Each entry records provider, instrument,
currency and the **structural** guarantee:

| token | provider | instrument | currency | guarantee |
|---|---|---|---|---|
| `tcgplayer` | TCGplayer | ask | USD | one `prices.raw[condition].tcgplayer` block |
| `observed` | TCGplayer | ask | USD | one tcgcsv price row |
| `ebay-sold` | eBay | sale | USD | one sold-comps query for one product |
| `provider` | varies per response | **unknown** | USD | one upstream card object from one free API |

The guarantees are positional — they follow from *where in the payload* the
figures were read — which is why no new field travels beside every number.

`provider` declares its instrument **unknown** on purpose: its upstream vendor
varies per response, so ask-versus-sale is not established and no path may
label it either way. It is admitted because its figures are co-contextual with
each other, not because their nature is known.

Asserted in § 5c: every token declares all four properties; the allow-list is
`Object.keys` of the contract in the shipped source; TCGplayer tokens are asks
and `ebay-sold` is a sale; `provider` is `unknown`; mixing an ask origin with a
sale origin is refused `mixed-origin`; a token absent from the contract is
refused, so admission is contract membership and not string plausibility.

Vendor evidence is recorded in `audit/ORIGIN_CONTRACT.md`, quoted from the raw
pages. From the [TCG Price Lookup FAQ](https://tcgpricelookup.com/faq): TCGplayer
figures are "marketplace listings, what sellers are currently asking"; eBay
figures are "aggregate averages … computed from actual completed sales, what
buyers actually paid"; "All prices are USD." The
[API reference](https://tcgpricelookup.com/docs/api-reference?endpoint=cards-search)
gives `low`/`mid`/`high` as a TCGplayer "Listing price range" and states `raw`
is keyed by condition — that last clause is the condition guarantee, and is why
the validator checks the block against `raw[condKey]` rather than trusting a key
name. Corroborating for `observed`: `api/_tcgcsv.js:131-134` maps all four
figures from a single `p` row.

**What the contract does not guarantee:** currency is documented, not verified
per response — nothing in the payload carries a currency code, so a vendor
change would not be detected here. Freshness is not part of it.

---

## 2. The BIAS-5 lifecycle

The narrower claim is the correct one. Distinct objects receive distinct WeakMap
tokens; that is object isolation and nothing more. Here is what the scan
lifecycle actually says.

**It held, and it held by accident.**

- `submitGradeScan` (`js/core:15630`) does `const data = await response.json()`
  (`js/core:15707`) — a **fresh object per analysis** — and passes it to
  `renderGradingUpside(upsideEl, pc, psa, psaGrade, data)`. So on today's path,
  two analyses do get two objects.
- `_crRerenderGradingPanel` (`js/core` ~11797) deliberately reuses
  `window._crGradingPanelArgs.cardData` (set at `js/core:12183`). That reuse is
  wanted: a re-render is not a new analysis.
- But `scanId` is minted at `api/scan.js:792` for **every** scan including grade
  mode, and was returned only at `api/scan.js:1046` and `:1226` — both
  `mode: 'identify'`. So on the grading surface the `scan:` branch was
  **unreachable**, and the WeakMap was carrying the whole property.

Object identity was load-bearing for a guarantee it cannot make. Nothing in
production forbids a future mutate-and-reuse path.

**The fix, using the existing lifecycle and no new identity system.** The grade
response now returns the identifier it already had — `analysis_id: scanId` — and
`_crGradingScope` prefers it over the WeakMap, still behind card identity. It is
named `analysis_id` and **not** `scan_id` deliberately: `scan_id` keys the refund
path, which is claimable only for scans logged to KV (`api/scan.js:1220`), and
grade responses are not. Reusing that name would have made grade scans look
claimable.

Resolution order, which is the fix and is what the assertions pin:

```
product URL  >  card identity  >  analysis_id  >  scan_id  >  WeakMap token
```

Assertions (`tests/quick-pricing.mjs`, `[BIAS-5 — analysis lifecycle]`):

- **the mutate-and-reuse case** — one object, `analysis_id` changed from `a1` to
  `a2` between calls, yields `'scan:a1'` then `'scan:a2'`. With only a WeakMap
  this returns the same token twice and two analyses share one grading cost.
- an `analysis_id` outranks the anonymous token.
- identify-shaped `scan_id` responses still resolve.
- a **named** card still keys on card identity ahead of `analysis_id`, so the
  accepted restoration is unaffected.
- the product URL still outranks everything.
- with no identifier at all, two objects are still separated and one object is
  still stable across re-renders — the WeakMap keeps its role as last resort.
- source assertions: the grade response carries `analysis_id`, and it is **not**
  exposed as `scan_id` on the grade path.

Grading-cost choice not revisited. Identified-card restoration, grader
separation and no-default behaviour untouched.

---

## 3. T2.14

Implemented as specified. When `basis.low != null` and the low exceeds the
comparison reference, the Quick Pricing ladder renders:

```
Provider low (not used)                    —
Not used in this comparison because it exceeds Market price.
```

- The value is an em dash. **No figure is printed**, so nothing can be read as a
  price.
- The reference is named when it has an **established, visible** label —
  `Market price` is a row in this ladder. When the reference is `mid`, which has
  no row of its own, the copy stays generic: "exceeds the comparison reference."
  Naming `mid` would cite a label the seller cannot see.
- When no low was supplied, the row is **omitted entirely**. Absence still reads
  as absence.
- The copy calls the book nothing. Asserted: the note must not match
  `/invert|wrong|incorrect|error|fabricat|stale|bad data/i`, and must match
  `/not used in this comparison/i`.

This is why T2.14 could close while **T2.10 stays open**: the disclosure reports
non-use in this comparison and does not adjudicate why the provider and the book
disagree.

Styling: `.qp-row` gained `flex-wrap:wrap`; `.qp-row-note` uses `--text-muted`,
not `--text-faint`, the latter having already been too low-contrast for the
footnote it was raised out of. Rendered at 420px: no overflow, no mid-word
break, and the dashed `.qp-row + .qp-row` separator is preserved because the
note sits inside the row rather than after it.

**Two retired assertions, with CHANGED-FROM records in the test file.** Both
asserted `label(...) === null` — that the row vanishes:

- `'an observed floor above the median ask is withheld, not relabelled'`
- `'a derived floor above the median ask is also withheld'`

They pinned the defect, not the fix. Withholding the figure was right;
rendering the withholding as empty space was not, because it made "we have a
floor and distrust it" byte-identical to "upstream sent no low". **Both passed
for the entire time that hole was open**, because each checked one state on its
own and nothing compared the two absences.

Their real content is carried forward, not dropped: no price is printed, and
condition (2) still fires on **observed** endpoints (it was never folded into
the provenance test). Added on top, the comparison the retired pair never made:

```js
const suppressed = row0({ low: 255, mid: 100, lowBasis: 'observed' });
const neverHad   = row0({ low: null, mid: 100, lowBasis: null });
// the two shapes must differ; only the withheld state carries an explanation
```

**Screen-reader announcement remains explicitly unverified.** The note is
visible text in document order, but element presence alone does not establish a
usable announcement, and no screen reader has been run. The separately displayed
provider range keeps its own qualification.

---

## The two reporting corrections

### Release inventory — SECOND correction, derived from the tool this time

My first correction said **42 registered suites**. That was also wrong, and
wrong in the same family as the error it was correcting: I re-derived by hand
instead of running the tool that derives it.

`grep -oE 'tests/[a-z0-9._-]+\.mjs'` **excludes `.js` files.** Five registered
checks are plain `.js`: `syntax-check.js`, `auth-integrity.js`, `scan-miss.js`,
`deeplink-companions.js`, `endpoints-smoke.js`. 42 + 5 = **47**, which matches
the earlier registry inventory.

Worse, `tests/run-all.sh` **prints its own denominator** — every slot label reads
`[N/47]`. I did not have to derive anything. And `tests/test-registry.mjs`
computes the whole inventory and asserts it is self-consistent. Running it
(12/0, twice now) while hand-rolling a `grep` beside it is instance 32 recurring
inside its own correction.

**Derived from `node tests/test-registry.mjs`, quoting its assertions:**

```
ok   runner: parsed 47 invocations from run-all.sh (floor 20)
ok   disk: found 49 suite files (floor 20)
ok   every suite on disk is either invoked by the runner or declared excluded
ok   runner: parsed 50 slot labels (floor 20)
ok   the declared total (47) equals the number of distinct slots (47)
ok   the declared total (47) equals the number of invoked files (47)
```

- **47 invoked files, 47 distinct slots, declared total 47.** Reconciled three
  ways by the tool itself.
- **49 files on disk.** The two extra are declared exclusions with written
  reasons in `tests/test-registry.mjs:73,77`: `ebay-live.mjs` and
  `test-scan.mjs`. Note this corrects another of my standing claims — I have
  been describing `ebay-live` as *registered but gated behind the rotation
  gate*. It is **not registered at all**; it is a declared exclusion.
- **50 slot labels for 47 slots.** Slots 24, 25 and 26 each print a second
  `SKIPPED` label for their gated branch. These are the three gated slots:

  | slot | suite | gate |
  |---|---|---|
  | 24 | `draft-kv-live.mjs` | `DRAFT_KV_LIVE=1` + `KV_REST_API_*` |
  | 25 | `endpoints-smoke.js` | not `--local` (runs prod smoke against `$BASE`) |
  | 26 | `condition-applicability.mjs` | `COND_PILLS_BROWSER=1` + `SITE_BASE` |

- **No genuine duplicate invocation.** `test-registry.mjs` appears twice in the
  file, but one is a comment at `tests/run-all.sh:339`; the invocation is at
  `:440`. The three `tests/run-all.sh` self-references are in the usage header.
- The declared total moved 46 → 47 at commit `9872ac8` (the BIAS-1 change added
  slot 46, `grading-upside-fees`). That is why the earlier inventory said 46 and
  is not a discrepancy.

### Corrected execution count

"All 25 have now been run" was wrong: **24 ran, 1 did not** — `draft-kv-live`
needs live KV, exactly as my own table showed. The prose contradicted the table
directly beneath it.

Since the first correction I additionally ran the four **offline `.js`** suites I
had omitted entirely by filtering on extension:

| suite | result |
|---|---|
| `syntax-check.js` | 7 script blocks, 0 errors |
| `auth-integrity.js` | ✅ Auth stack integrity verified |
| `scan-miss.js` | ✅ Scan-miss regressions covered |
| `deeplink-companions.js` | 170 checks, 0 failures |

**Checkpoint total: 45 of 47 registered suites executed, all green.** The two not
executed are `draft-kv-live.mjs` (live KV) and `endpoints-smoke.js` (prod smoke
against a live host). Both are in `audit/RELEASE_VALIDATION_QUEUE.md`.

### What the newly-executed suites actually ran against

This is the fair challenge: running a suite individually does not make it
offline. Recorded from source and from the running environment, not inferred.

**Command form, every suite:** `timeout 240 node tests/<name>.mjs` (or `.js`),
invoked directly from `/home/user/workspace/cardresell`. `tests/run-all.sh` was
**not** executed. No `--base`, no `EBAY_LIVE`, no `DRAFT_KV_LIVE`.

**`draft-crud-e2e`, `draft-index-recovery`, `draft-list-cap` — in-process KV
double. No network, no credentials.** Each one, at the top of the file, *assigns*
dummy env values and then *replaces* the global fetch:

```
tests/draft-crud-e2e.mjs:15   process.env.KV_REST_API_URL   = 'https://kv.test';
tests/draft-crud-e2e.mjs:16   process.env.KV_REST_API_TOKEN = 'test-token';
tests/draft-crud-e2e.mjs:48   globalThis.fetch = async (url, opts) => { ... }
```

`globalThis.fetch` stubs are also at `draft-index-recovery.mjs:46` and
`draft-list-cap.mjs:52`. `kv.test` is not a real host and `test-token` is not a
credential. The suites import the real draft handlers and drive them against an
in-memory store. `tests/run-all.sh` labels all three **"(offline)"** in their own
slot text (slots 20–23).

**This means the earlier exclusion rationale was itself wrong.**
`audit/d3/D3_CLOSEOUT_RETURN_PACKET.md:168` excluded these three as
"production-touching", stating "each performs `fetch(` against either the
production host or the live KV store". They perform `fetch(` against a stub they
install themselves. That packet had just criticised an earlier classifier for
"grepping for env-var names and hostnames" — and then made a subtler version of
the same error, reading the presence of `fetch(` and `KV_REST_API_URL` without
checking the assignment direction. So the correct count of genuinely
production-touching registered suites is **two**, not five: `draft-kv-live.mjs`
and `endpoints-smoke.js`.

**`condition-applicability` — real Chromium against a local static server.** Not
offline, and I should not have listed it without saying so. `:16`
`chromium.launch()`; `:20` `const BASE = process.env.SITE_BASE ||
'http://127.0.0.1:8097'`; `:21` `page.goto(BASE + '/index.html')`. `SITE_BASE`
was unset, so it used the default. A `python3 -m http.server 8097` (pid 26575)
is running with cwd `/home/user/workspace/cardresell` and serves
`js/core.1eea628c.js` — the working-tree bundle. So it tested **local files in a
real browser**, never a deployed host. In `run-all.sh` this slot is gated on
`COND_PILLS_BROWSER=1`; invoking it directly bypassed that gate and happened to
work because the server was already up. It is reproducible only while that
server runs.

**`draft-list-screen` — real Chromium against an ephemeral in-process server.**
`:95` `server.listen(0, '127.0.0.1', ...)` — port 0, so it binds its own random
loopback port and serves working-tree files; `:147` navigates to it. Fully
self-contained, no external dependency.

**Everything else** — pure Node, reading repo files and lifting functions out of
the bundle text. No sockets.

**Bundle under test in all cases:** `js/core.1eea628c.js`, resolved through
`tests/_assetRefs.mjs` from `index.html`, and the same file the local server
serves. Verified by `curl`.

### The new integration block's own result

The retained `163 passed, 0 failed` below belongs to the **preceding** packet
(`4e82155`) and does not cover assertions added afterwards. For commit
`8b0bff2`:

```
$ node tests/quick-pricing.mjs
188 passed, 0 failed          exit 0
```

163 → **188**, all 25 new assertions from the adapter integration block and the
provider-presentation pin included.

### Fee arithmetic versus disclosures

**Fee arithmetic was unchanged.** `feeEbay` and every input to it are untouched;
`accuracy-fee-parity` (17/0), `review-fee-dl` (15/0), `grading-upside-fees`
(103/0) and `fee-truth-offline` all pass unchanged.

**Disclosures did change**, and these are the changes:

1. **New visible row** — `Provider low (not used) —` with its explanation, in
   the state where a supplied low exceeds the comparison reference. Previously
   this state rendered nothing.
2. **Reference naming** — the note names `Market price` when that row is
   visible, and says "the comparison reference" otherwise.
3. **Row omission preserved** — no low supplied still renders no row, now
   asserted as distinct from (1) rather than incidentally equal to it.
4. Carried from the prior checkpoint and restated here for completeness: the
   visible generic-comp qualification, the dagger's accessible name, and the
   footnote contrast raise.
5. **New CSS token use** — `.qp-row-note` on `--text-muted`.

No amount, calculation or existing disclosure was altered.

---

## Suite results against bundle `1eea628c`

All exit 0.

| suite | result |
|---|---|
| `launch-audit-regressions` | 436 / 0 |
| `draft-review-screen` | 180 / 0 |
| **`quick-pricing`** | **163 / 0** (was 121; +42 this commit) |
| `sell-eligibility` | 113 / 0 |
| `grading-upside-fees` | 103 / 0 |
| `sku-identity` | 85 / 0 |
| `sports-price-guard` | 60 / 0 |
| `accuracy-fee-parity` | 17 / 0 |
| `condition-applicability` | 17 / 0 |
| `scanner-fastpath` | 16 / 0 |
| `variant-selection` | 16 / 0 |
| `asset-fingerprints` | 15 / 0 |
| `review-fee-dl` | 15 / 0 |
| `test-registry` | 12 / 0 |
| `contrast-tokens` | 12 / 0 |
| `copy-truth-offline` | ALL CHECKS PASSED |
| `fee-truth-offline` | passed |

### One more instance of the pattern, in the tests themselves

The first version of the three ingestion-B absence assertions regexed the raw
bundle for `_tp.lowBasis || 'tcgplayer'` to prove it was gone. **They failed** —
because the comment documenting the removal quotes the removed line verbatim, so
the assertion matched its own explanation and reported fixed code as broken.

This is the identical mechanism already recorded under instance 29's
second-order note, recurring within 24 hours in a different file. It is now
structural rather than remembered: absence assertions run against a
comment-stripped view (block comments removed as regions; line comments dropped
only when the line *starts* with `//`, so an `https://` inside a string is left
alone), and a **meta-assertion checks that the stripper actually removed the
quotation** — present in the raw text, absent from the code — so the three
absence checks cannot silently prove nothing in either direction.

**Instance 31** records a near-miss filed as evidence *for* the extraction
technique: when the allow-list became `Object.keys(_CR_ORIGIN_CONTRACT)`, two
suites that slice the gate out of the bundle stopped containing their own
dependency and threw `ReferenceError` immediately. Had they restated the gate's
logic locally, they would have kept passing against a copy while the shipped
gate changed underneath them. Both anchors were repointed with CHANGED-FROM
records.

---

## Bundle re-derivation

`8e031c8f` → **`1eea628c`** (`sha256sum` of the new bytes, first 8). The old
name was restored to its exact `HEAD` bytes and retired in place — *(this
retirement happened at `4e82155`; no bundle changed at `8b0bff2`)* — a served
bundle is never `git mv`'d, because `vercel.json:47-48` serves `/js/*` immutable
and any client holding the old URL must keep getting the old program. The single
reference at `index.html:3740` was updated by `sed`. `asset-fingerprints` 15/0
confirms the live bundle resolves unambiguously and is named after its own
bytes.

Retired in place: `040daa95`, `259bdb88`, `4104f47f`, `24cd52cb`, `569ff536`,
`7f9c03ad`, `8bd8277a`, `c5d0858b`, `d9e1b484`, `b837f63b`, `2abb15f0`,
`8e031c8f`.

Citation map — **corrected on review, and the correction is worse than the
original error.** The prior line read "31 mappings resolved". Two things were
wrong with it: the status was **inverted** (prior inventories reported 31
*unresolved*), and the number is not 31.

`node tools/bundle-citation-map.mjs` actually reports:

```
core.24cd52cb.js   17/17 citations resolve
core.7f9c03ad.js   42/42 citations resolve
core.8bd8277a.js     1/1 citations resolve
core.8e031c8f.js    9/10 citations resolve
core.d9e1b484.js  6557/6628 citations resolve
72 citation(s) do not resolve — the cited line changed or moved:
```

**72 unresolved**, which is exactly 71 (`6628 − 6557`) plus 1 (`10 − 9`). The
listing beneath that headline shows 40 rows across 4 documents (29 unique
document+citation pairs), because `tools/bundle-citation-map.mjs:134` prints
`problems.slice(0, 40)` — **the listing is capped at 40**. So any count taken by
reading the listing rather than the headline is truncated, which is the most
likely origin of the standing "31" figure and is why it could not be reconciled
against the headline.

One of the 72 is **new at this checkpoint**: the single unresolved citation in
`core.8e031c8f.js` appeared because that bundle was retired and restored to its
`HEAD` bytes here. One more sits in `audit/d3/Q7_BIAS5_RETURN_PACKET.md`, my own
prior packet.

Correct status: **72 citations unresolved, 6626 resolve, listing capped at 40.**
Still "mappings", not "citations verified" — resolution means the cited line
exists, not that it says what the citing text claims. The tool remains
unregistered in `tests/run-all.sh`, which is why this drifted unnoticed.

---

## Scope discipline

D3 and BIAS-1 stay closed; nothing here reopens them. The larger open-item
inventory stays prioritized separately — the next items on it are **BIAS-6**
(unwalked estimate surfaces), **BIAS-10 / T2.9** (venue tax-treatment audit, one
date, 2026-09-21), **T2.10**, and the credential and history-cleanup gates.

**Push and deployment remain blocked.** *(Historical count, as at `4e82155`;
the live count at `8b0bff2` is 146 — see the top of this file.)* ~136 commits
outgoing on
`phase1-block-d`; `origin/main` is still `9aaf326`. The Cert ID is not rotated,
so the push gate is closed, and no deploy has been requested or authorized.
