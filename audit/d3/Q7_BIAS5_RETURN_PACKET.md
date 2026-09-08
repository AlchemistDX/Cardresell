# Q7 + BIAS-5 Return Packet — the gate was bypassed, and the shared key was reachable

**Date:** 2026-09-08 · **Branch:** `phase1-block-d` · **Commit:** `7bd9261`
**Live bundle:** `js/core.8e031c8f.js` (was `b837f63b`), referenced once at `index.html:3732`
**Not pushed.** The credential and deployment gates are unchanged and untouched.

Both review items were right, and item 2 was more right than it was phrased. Asking
for evidence "from ingestion through rendering" rather than from the gate alone is
what exposed the defect: the gate was correct and complete, and it was being fed
laundered inputs one frame upstream. Nine passing assertions covered the gate.
None could see this, because every one of them handed the gate its basis fields
directly instead of letting production build them.

---

## 1. Q7 — the bypass, in the order it ran

### What was actually happening

| Stage | Code | Effect |
|---|---|---|
| Server, tcgcsv path | `low: r.low ?? (_spreadOk ? displayMarket * 0.85 : null)` | invents a floor at 85% of market |
| Server, same | tags it `lowBasis: 'derived'` | **honest** — the server never lied |
| Client ingestion | `lowBasis: Number(d.low) > 0 ? 'tcgplayer' : null` | **discards the wire tag**, stamps `'tcgplayer'` from value presence |
| Gate | `'tcgplayer'` ∈ `_CR_MEASURED_ORIGINS` | renders `0.85 × market` as a measured TCGplayer range |

The server labelled the synthesized number correctly and the client threw the
label away and re-derived it from the presence of the number it was supposed to
describe. So tagging protected nothing. This is why the fix is not a tighter
`_spreadOk` — as recorded, the guard was never the weak part.

Two further synthesizers were found in the same sweep:

- **Free-API path** (Scryfall / lorcana-api / YGOProDeck): `low: fb.low ?? (fb.market * 0.85)`, emitted with **no basis fields at all** — and the provider is not TCGplayer, so the client's inference also misattributed the vendor.
- **`_clampHighPriceInPlace`**: rewrote `data.high = anchor * _HIGH_CAP_MULT` while leaving `highBasis: 'observed'` in place. A clamped high is our arithmetic, not the provider's observation.

### What changed

**`api/tcg-price.js`**

- Both percentage synthesizers **deleted**, not re-guarded → `low: r.low ?? null`, `high: r.high ?? null`. `_spreadOk` no longer exists. No `* 0.85` or `* 1.15` survives on any executable line (asserted).
- Free-API path now attributes its own endpoints (`api/tcg-price.js:360-368`):
  ```js
  marketBasis: 'provider',
  lowBasis:  fb.low  != null ? 'provider' : null,
  highBasis: fb.high != null ? 'provider' : null,
  midBasis:  fb.mid  != null ? 'provider' : 'derived',
  ```
- Clamp invalidates the basis it no longer describes (`api/tcg-price.js:618`):
  ```js
  if (data.highBasis != null) data.highBasis = 'derived';
  ```
  `highRaw` is preserved, so the original observation is not lost.

**`js/core.8e031c8f.js` — ingestion site A (`:3727-3732`)**

```js
const _dLow  = Number(d.low)  > 0 ? Number(d.low)  : null;
const _dHigh = Number(d.high) > 0 ? Number(d.high) : null;
const liveVariant = { key: 'tcgplayer_live', label: 'TCGPlayer Live', market: d.market,
  low:  _dLow,  lowBasis:  _dLow  != null ? (d.lowBasis  || null) : null,
  high: _dHigh, highBasis: _dHigh != null ? (d.highBasis || null) : null,
  mid: d.market, midBasis: 'derived' };
```

Provenance is now **read**, never inferred. `high` is also no longer hardcoded
`null`, which it had been — a genuinely supplied high was being dropped on the floor.

**Ingestion site B (`js/core.8e031c8f.js:359`)** reads `_tp.lowBasis || 'tcgplayer'`
and sets `highBasis = 'derived'` when `_tp.highClamped === true`.

### The focused integration case

`tests/quick-pricing.mjs:658` — block `[Q7 — ingestion to gate, integration]`.

It does **not** reconstruct the pipeline. It lifts the real ingestion expression
out of the live bundle by source range and composes it into the real gate, also
lifted from the live bundle:

```js
const a = core.indexOf("const _dLow  = Number(d.low)");
const b = core.indexOf("currentPrices['tcgplayer_live'] = liveVariant;");
const ingest = new Function('d', core.slice(a, b) + '; return liveVariant;');
// ... gate extracted the same way ...
const chain = (payload) => {
  const v = ingest(payload);
  return { variant: v, verdict: gate({ low: v.low, high: v.high,
                                       lowBasis: v.lowBasis, highBasis: v.highBasis }) };
};
```

If either expression is edited so the extraction no longer matches, the locator
assertions fail rather than silently testing a stale copy.

**Cases covered, all passing:**

| Payload | Asserted |
|---|---|
| `{low: 85, lowBasis: 'derived'}` | ingestion keeps `'derived'`; gate refuses |
| `{low: 85, high: 115, both 'derived'}` | refused, `why === 'derived-endpoint'` |
| `{low: 85, high: 115}`, no basis (old free-API shape) | tags stay `null`; refused `'unattributed'` |
| `{high: 300, highBasis: 'derived', highClamped: true}` | refused, clamped high never measured |
| `{low: 90, high: 130, both 'observed'}` | **renders** |
| `{low: 85, high: 115, both 'observed'}` | **renders** — symmetric and attributed |
| same numbers, both `'derived'` | refused |
| `{low: 90 'tcgplayer', high: 130 'ebay-sold'}` | refused `'mixed-origin'` — ask floor under sold ceiling is not one context |
| `{low: 90, lowBasis: 'observed'}` alone | refused `'low-only'` |

The pair the review asked for explicitly is the sixth and seventh rows together:
**identical numbers, 85/115 around a 100 comp, opposite verdicts, differing only in
provenance.** Symmetry neither authenticates nor disqualifies — the tags decide,
and only the tags.

Server-side surface assertions accompany these (synthesizers absent from both
paths, no multiplier on any executable line, free-API attribution present, clamp
re-tags). Those are surface claims and are labelled as such; the behavioural
claim is carried by the chain.

### Two assertions retired, with the record of what they used to assert

1. **`a spread is synthesized only around an observed centre`** — pinned `_spreadOk` and both multipliers. That was the Q3-C narrowing and it was correct for its defect (a 0.85 floor off an ask blend published `low` **above** `mid`). Q7 deleted the synthesizers, so it can only fail. Replaced by `no spread is synthesized around any centre, observed or not`, which asserts `_spreadOk` is absent from code. The inversion it protected against is now unreachable by construction.

2. **`Q7: the live TCGplayer variant tags its endpoints too`** — **this one passed while pinning the defective line.** It confirmed endpoints carried tags; it never asked where the tags came from. Replaced by an assertion that the values are read off the wire. The full note is in the test file, and the general lesson is filed as instance 29 below.

### Copy clarification — no change needed, as you suspected

Verified at `js/core.8e031c8f.js:4450` and `:4410`. The caption already reads:

> "Comp is the displayed source value; Sell Now and Patient are calculated
> suggestions at N% either side of it — not a provider range and not observed sales."

Comp retains its source/basis label; only the two outer tiers are called
calculated suggestions. Tier hints at `:4026`/`:4031` are Sell Now / Patient only.
"All three were relabelled" was shorthand in the earlier packet and was wrong as
written. Two assertions now pin this so the shorthand cannot drift into the code.

---

## 2. BIAS-5 — the shared unknown key was reachable, and is closed

**Confirmed reachable.** `_crGradingScope` previously ended `return 'unknown';`.
Any card without a PriceCharting URL and without a name — a scan that resolved to
pricing but not to identity — landed on that literal. Two such cards shared one
key, so a cost entered against the first was subtracted from the second's comps.

**Now** (`js/core.8e031c8f.js:11716`):

```js
if (pc && pc.url) return 'pc:' + pc.url;              // one printing — the grain comps publish at
if (nm) return 'card:' + [nm, st, nu].join('|');       // name+set+number
if (d.scan_id) return 'scan:' + d.scan_id;             // real per-analysis id from the server
if (cardData && typeof cardData === 'object') {        // WeakMap keyed on the object itself
  let t = _crGradingAnonScope.get(cardData);
  if (!t) { t = 'anon:' + (++_crGradingAnonSeq); _crGradingAnonScope.set(cardData, t); }
  return t;
}
return 'anon:none:' + (++_crGradingAnonSeq);           // reuse withheld
```

The WeakMap (`:11714`) is keyed on the `cardData` object, so the token is stable
across re-renders of one analysis and necessarily distinct across two. The final
branch mints a fresh token every call, which **withholds reuse** rather than
faking it — with no object there is nothing to be stable against.

This mirrors the reasoning already in `_crScanInstanceId` (`js/core:19346`), which
made the same correction for physical-copy identity. It is not reused directly
because that function keys on `_crIntentToken`, which is itself identity-derived
and therefore unavailable in exactly the case this branch exists for.

**Tests** — `tests/quick-pricing.mjs:803`, block `[BIAS-5 — unidentified card scope]`,
12 assertions, all passing:

- the no-identity branch no longer returns the shared literal
- two unidentified cards get **different** scopes ← the inheritance case
- the same unidentified card keeps its scope **across re-renders** ← the regression the fix could have caused
- server `scan_id` preferred over a minted token; same id shares, different ids do not
- an identified card still scopes by printing URL
- **returning to an identified card restores its own entry** — asserted as `scope({url}, cardA) === scope({url}, cardB)`: identity wins over the per-analysis token
- name+set scoping unchanged; two different named cards do not share
- no data object at all → reuse withheld

The no-default decision is untouched and not revisited.

---

## 3. PSA — you are right, my retrieval was wrong, and the claim is retracted

Recorded in `audit/GRADING_COST_BASIS.md` under **"Retrieval conflict, 2026-09-07
vs 2026-09-08"**, and the corresponding code comment in the bundle is rewritten.

### Postage — I cited a stale page that PSA still serves

| Final URL | Page header | Domestic card table |
|---|---|---|
| `https://www.psacard.com/submissions/postage/` | "Effective **January 24, 2023**" | 1–8 items, $1–$1,000, **$19.00** |
| `https://www.psacard.com/info/postage` | "Last Updated **November 14, 2024**" | 1–4 items, **$2,000**, **$19.99** |

Retrieved 2026-09-07 and 2026-09-08 respectively. Verbatim excerpt from the
current page:

```
|No. of Items|$2,000|$12,500|$25,000|...|
|1 - 4|$19.99|$34.99|$49.99|...|
|5 - 9|$24.99|$39.99|$54.99|...|
```

Your figure is the current one. I retrieved the 2023 page, treated it as current
because it was still served under a plausible URL, and concluded "the number has
not moved." **That conclusion was wrong.**

### Regular $79.99 — agreed by both retrievals.

### Value paused — unresolved here, and not refuted

Your 2026-09-08 retrieval of the grading-services page shows an explicit "Value
Services Are Temporarily Paused" notice with those services marked unavailable.
That page is client-rendered and returns **0 bytes of HTML** to this sandbox, so
nothing retrievable here can confirm or refute it. It is recorded as your finding,
not adjudicated.

My earlier verdict of "Unverified" rested on an argument that does not hold — that
Value appearing in a price-increase list on a *different* page established
availability. A price list is not an availability statement. **That inference is
withdrawn**, exactly as you framed it.

### Retracted

- **"$51.99 was never stale"** — retracted. The postage component moved ($19.00 → $19.99, with the item band and insured cap changing too) and the service component may be unavailable.
- **The chronology of PSA prices** — retracted. Two conflicting retrievals, one of them mine and taken from a stale page, establish neither direction.

**Product behavior unaffected**, and deliberately so. No default ships; the seller
supplies the assumption. That decision never depended on these figures, because a
default would guess at inputs a scan cannot observe — service eligibility and
selection, Collectors Club membership, submission size, declared value, and
**inbound** postage, which appears in no PSA table at all. Two readers of the same
vendor disagreeing, one of them misled by that vendor's own stale page, is itself
an argument against pinning any of it into the product. No further grading-price
research cycle opened.

### Generic provenance beside the headline claim

`js/core.8e031c8f.js:12088-12090`. The dagger is no longer a bare glyph:

```js
const _dagWhy = 'Uses a graded comp that is not specific to ' + _grader + '.';
' <span style="opacity:.75" title="' + _dagWhy + '" aria-label="' + _dagWhy + '" role="img">\u2020</span>'
```

It carries an accessible name, a hover explanation, and `role="img"` so the name is
announced. The qualification also appears as a visible block clause beside the
claim ("comp not specific to {grader}"), so it survives when the generic comp wins
the headline. Footnote contrast was raised from `.55rem`/`.35` alpha to
`.62rem`/`.6` alpha. I have verified the markup and the contrast tokens, **not**
the announcement itself with a screen reader — per the standing rule that element
presence alone does not establish usable announcements, treat the announcement as
**unverified**.

---

## 4. Closeout items

### `scanner-fastpath` — it ran, and my reporting was the defect

Executed directly: **16 passed, 0 failed, `exit=0`.** It asserts real behaviour
(dual crop/raw hashing, `CONFIDENCE_MAX` 20, `GAP_MIN` 6, miss-logging call sites
and dedup key, seeder hash geometry).

The earlier "unresolved" report was an artifact of my harness: the suite ends with
a trailing newline and I was extracting the summary with `tail -1`, which returned
the blank line. Since silence establishes neither pass nor failure, I re-ran
**every** suite with explicit exit-code capture and a summary-line grep rather than
positional extraction. Results in §5.

### T2.14 — surface identified, and it is not the completed row

The remaining item is the **Quick Pricing ladder floor row**, a different surface
from the review-screen withheld-discount fee row, which stays completed and is not
reopened.

- **Where:** the ladder assembly in `renderQuickPricing`, `js/core.8e031c8f.js:4588-4591`:
  ```js
  const _askRef = (basis.mid != null) ? basis.mid : basis.market;
  const _lowExceedsAsk = (basis.low != null && _askRef != null && basis.low > _askRef);
  if (basis.low != null && !_lowExceedsAsk) {
    rows.push([_lowIsObserved ? 'Lowest listing' : 'Estimated low', ...]);
  }
  ```
- **Element:** the `.qp-row` carrying key `Lowest listing` inside `#qpRows`.
- **The collapse:** `basis.low == null` (upstream sent no floor) and `basis.low != null && _lowExceedsAsk` (we have a floor and distrust it) both fall through the same `if`. The DOM is byte-identical.

**Q7 did not close it**, and it is worth being precise about why, because the new
disclosure could easily be read as covering this:

| state | range line | ladder floor row |
|---|---|---|
| no floor upstream | `_CR_NO_RANGE_NOTE` shown | absent |
| floor present, distrusted | range may render normally | absent |

`_CR_NO_RANGE_NOTE` fires off `_crMeasuredRange`, which reads the low/high
**range**, not this row. So after Q7 a distrusted floor can sit inside a rendering
measured range while being suppressed from the ladder beneath it. Not a regression
Q7 introduced — the suppression predates it — but "Q7 shipped a disclosure" must
not be read as "T2.14 is disclosed."

Still not fixed unilaterally, for the reason already on file: the copy would assert
something about *why* the book is inverted. Recorded in `audit/TODO_PHASE1.md`.

### Instance 29 filed — and the counter was itself stale

`audit/PATTERN_ASSERTION_SURFACE.md`, **instance 29 — a populated provenance field
is not true provenance.** The assertion `Q7: the live TCGplayer variant tags its
endpoints too` passed for weeks while pinning the exact line that laundered the
tag. A surface can show that a provenance field is populated; it cannot show that
the value was sourced rather than inferred from the thing it describes.

Two corrections to the file itself, both self-inflicted and both the same shape:

- the header read "**25 instances**" while the file already ran to 28
- a test comment cited "instance 30", which **did not exist**

Both fixed; the header now explains that a hand-maintained counter beside the thing
it counts is the defect this file is about.

Also worth recording: the first version of the "synthesizer is gone" check stripped
comments line-wise (`//` and `*` prefixes). The commit that deleted the synthesizers
**quotes the deleted lines inside a block comment**, so the check matched my own
explanation and reported live code as unfixed. It failed loudly and was caught, but
it is instance 29 one level up — the assertion was reading the wrong artifact and
its name did not say so. The stripper now removes block-comment regions.

---

## 5. Test results — executed and skipped, reported separately

Every suite below was run against the **final bundle `js/core.8e031c8f.js`**, after
the last edit, with exit status captured explicitly.

**Executed:**

| Suite | Exit | Result |
|---|---|---|
| `quick-pricing` | 0 | **121 / 0** (was 87 — +34 from the two new blocks and the retirements) |
| `launch-audit-regressions` | 0 | 436 / 0 |
| `draft-review-screen` | 0 | 180 / 0 |
| `sell-eligibility` | 0 | 113 / 0 |
| `grading-upside-fees` | 0 | 103 / 0 |
| `sku-identity` | 0 | 85 / 0 |
| `sports-price-guard` | 0 | 60 / 0 |
| `accuracy-fee-parity` | 0 | 17 / 0 |
| `condition-applicability` | 0 | 17 / 0 |
| `scanner-fastpath` | 0 | **16 / 0** ← previously misreported as unresolved |
| `variant-selection` | 0 | 16 / 0 |
| `asset-fingerprints` | 0 | 15 / 0 |
| `review-fee-dl` | 0 | 15 / 0 |
| `test-registry` | 0 | 12 / 0 |
| `contrast-tokens` | 0 | 12 / 0 |
| `copy-truth-offline` | 0 | ALL CHECKS PASSED |
| `fee-truth-offline` | 0 | All fee-truth checks passed |

**Skipped, with the reason:**

- `tests/run-all.sh` — instructed not to run
- `ebay-live` — requires `EBAY_LIVE=1` and a live credential; blocked behind the rotation gate
- `draft-kv-live` — requires live KV
- `test-scan` — no offline harness exists (tracked)
- dated audits (`a11y-mobile-*`, `asset-extraction-*`, `bulk-*`, `durability-*`, `entitlements-*`, `majors-*`, `minors-*`, `scan-hygiene-*`, `sol-remediation-*`) — point-in-time records, not regression suites
- draft/listing suites outside this surface

Nothing is reported as unresolved this round.

---

## 6. Bundle and repo state

- Bundle re-derived **`b837f63b` → `8e031c8f`** by content hash. `core.b837f63b.js` was restored to its committed content and left in place; the served bundle was never `git mv`d (`vercel.json:47-48` serves `/js/*` immutable). Single reference updated at `index.html:3732`. `asset-fingerprints` 15/0 confirms name matches content.
- `node --check` clean after every JS patch.
- Commit `7bd9261` on `phase1-block-d`. `origin/main` remains `9aaf326`; **~135 commits outgoing, nothing pushed.**
- Citation mappings: 31 unresolved, all `d9e1b484`, pre-existing. Reported as *mappings resolved*, not *citations verified*.
- No amounts, disclosures, or fee calculations were changed. Completed work preserved.

## 7. Unchanged gates

The Cert ID rotation still gates pushing, and it is **not done**. No push, no
deploy, no credential touched, no history rewritten. The Production-only env
update and the Preview determination remain open exactly as recorded.

## 8. Still open, not presented as solved

BIAS-6 unwalked estimate surfaces · BIAS-10 / T2.9 venue tax-treatment audit due
**2026-09-21** · T2.14 ladder floor row (surface now named, copy undecided) ·
credential hygiene — partial commit-message disclosure to rewrite before push ·
history cleanup · 5 Vercel dashboard questions · dagger announcement unverified by
screen reader · guard-reachability sweep still narrow (see below) · serialized-field-with-no-reader
sweep not run · citation-map tool unregistered · `buildListingPacket()` unwired ·
`hasPacket` constant-false · 4 undeclared CSS tokens · `'venue'` priceSource
unreachable · no registered behavior test for the 1.5× / $20 thresholds · five text
suites unretrofitted · `api/admin.js:13,29` hard-wires refunds to one uid ·
`api/_cardIdentity.js:380` docblock wrongly says the SKU hash includes cert.

**One new candidate**, flagged rather than acted on: with the server synthesizers
gone, `low` should now arrive either observed or absent, which would make the
`'Estimated low'` arm of `_lowIsObserved ? 'Lowest listing' : 'Estimated low'`
unreachable. I have **not** established that — it is a reachability claim and the
reachability sweep is the open item it belongs to. Recording it as a lead, not a
finding.
