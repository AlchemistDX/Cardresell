# Return packet — ingestion B, the origin contract, the BIAS-5 lifecycle, T2.14

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

### Suites not rerun at this checkpoint

Reported as **not rerun at this checkpoint**, with regression relevance
classified from **behaviour**, not from the dated name.

| suite | why not rerun | regression relevance to this commit |
|---|---|---|
| `tests/run-all.sh` | instructed not to run | n/a |
| `ebay-live` | needs `EBAY_LIVE=1`, blocked behind the rotation gate | **relevant** — 18/19, and 19/19 is a release gate |
| `draft-kv-live` | needs live KV | low — no draft or KV code touched |
| `test-scan` | no offline harness exists | **relevant** — `api/scan.js` changed (grade-mode response shape) |
| `a11y-mobile-*` | dated audit, no runner registered | **relevant** — a new visible row and a new CSS rule shipped |
| `asset-extraction-*` | dated audit | **relevant** — the bundle was renamed |
| `bulk-*` | dated audit | low — bulk paths not touched |
| `durability-*` | dated audit | low — no persistence change |
| `entitlements-*` | dated audit | low — no entitlement change |
| `majors-*`, `minors-*` | dated audits | **partly relevant** — both include pricing-ladder items |
| `scan-hygiene-*` | dated audit | **relevant** — `api/scan.js` response shape changed |
| `sol-remediation-*` | dated audit | low — items already closed elsewhere |

The dated name is a filename convention, not evidence about scope. Where a suite
exercises behaviour this commit changed, it is marked relevant regardless of its
date.

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
name was restored to its exact `HEAD` bytes and retired in place — a served
bundle is never `git mv`'d, because `vercel.json:47-48` serves `/js/*` immutable
and any client holding the old URL must keep getting the old program. The single
reference at `index.html:3740` was updated by `sed`. `asset-fingerprints` 15/0
confirms the live bundle resolves unambiguously and is named after its own
bytes.

Retired in place: `040daa95`, `259bdb88`, `4104f47f`, `24cd52cb`, `569ff536`,
`7f9c03ad`, `8bd8277a`, `c5d0858b`, `d9e1b484`, `b837f63b`, `2abb15f0`,
`8e031c8f`.

Citation map: 31 mappings **resolved**, all pointing at `d9e1b484`, all
pre-existing. That is "mappings resolved", not "citations verified".

---

## Scope discipline

D3 and BIAS-1 stay closed; nothing here reopens them. The larger open-item
inventory stays prioritized separately — the next items on it are **BIAS-6**
(unwalked estimate surfaces), **BIAS-10 / T2.9** (venue tax-treatment audit, one
date, 2026-09-21), **T2.10**, and the credential and history-cleanup gates.

**Push and deployment remain blocked.** ~136 commits outgoing on
`phase1-block-d`; `origin/main` is still `9aaf326`. The Cert ID is not rotated,
so the push gate is closed, and no deploy has been requested or authorized.
