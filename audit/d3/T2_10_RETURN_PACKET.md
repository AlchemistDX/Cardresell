# T2.10 — Midpoint provenance. Return packet

**Scope as authorised:** preserve `midBasis` through server and client, label
derived centres as calculated references, keep valid low/high ranges independent
of midpoint provenance, and test T2.14's comparison separately. Bounded trace
and correction only. No grading-price or tax-source research was done and no
such sources are cited here.

**Artifact.** Live bundle is now **`js/core.541c4c39.js`**; every `:NNNN`
citation below is against that file. The bundle was re-addressed in the same
step as the edit and `tests/asset-fingerprints.mjs` was run before any result
was reported — see `audit/BUNDLE_RENAME_541c4c39.md`. Retired
`js/core.9f0f6b30.js` is retained with its own bytes.

**Nothing pushed, nothing deployed.**

---

## 1. The reconciliation you asked for

You were right that seven occurrences do not establish preservation. They
establish that the *symbol* exists in seven places. Classified by role, only two
of the seven sat on the affected path, and both were on the wrong side of it.

| # | `:line` | Role | Before this work |
|---|---|---|---|
| 1 | `api/tcg-price.js:317` | **Producer** — main path | **Absent.** This is the defect. |
| 2 | `api/tcg-price.js:387` | **Producer** — fallback path | Present, `'provider'` / `'derived'` |
| 3 | `:440` | Producer — client, condition variants | Present, hardcoded `'derived'` |
| 4 | `:487` | Producer — client, graded variants | Present, hardcoded `'derived'` |
| 5 | `:3845` | Producer — client, TCGplayer Live ingest | Present, hardcoded `'derived'` |
| 6 | `:2669` | **Adapter** — reads the wire into `_basisMeta` | **Absent.** Second half of the defect. |
| 7 | `:2712` | **Adapter** — `_basisMeta` → `window._crBasis` | **Absent.** |
| 8 | `:4026`, `:4041` | Adapter — basis resolver | Present, `|| null` |
| 9 | `:4272` | **Consumer** — "Top of Book" tier gate | Present, `!== 'derived'` |
| 10 | `:4740` | Consumer — T2.14 tripwire | Comment only; reads no basis |
| 11 | `:5452` | **Consumer** — range label | **Absent.** Third half. |

**The three client producers (3, 4, 5) were already honest.** Each sets
`mid: <market>` and tags it `'derived'` in the same expression, which is exactly
the discipline the server main path lacked. They were never the problem, and
their presence in a grep is what made the count look reassuring.

**The affected path is the one that serves almost all traffic.** `/api/tcg-price`
→ `r.json()` (`:2530`, no intervening adapter) → `renderPriceStatus` → the
TCGplayer rung at `:2653` → `window._crBasis` (`:2701`) → render (`:4894`). Rows
1, 6, 7 and 11 are all on that chain. A midpoint could not have carried
provenance across it, because provenance was never attached at the producer, and
even the fallback path's honest tag was dropped at row 6.

## 2. What `mid` actually was

Both server paths write the same shape:

```js
mid: r.mid  ?? displayMarket   // main     tcg-price.js:291
mid: fb.mid ?? fb.market       // fallback tcg-price.js:382
```

`mid` is therefore **never null**. When the provider sends no midpoint, the
market price is republished under the name "Mid" — and until now the main path
attached no basis field to say so, while the fallback path did. The two paths
disagreed, and the silent one was the common one.

That is why the absent case is tagged `'derived'` rather than `null`. `lowBasis`
and `highBasis` use `null` because they describe a value that may not exist;
`mid` always exists here, so a null basis beside a populated number would read
as "no midpoint" — the opposite of what happened.

## 3. Vocabulary: deliberately not unified

The main path says `'observed'` where the fallback says `'provider'`, each
matching its own sibling `lowBasis`/`highBasis`. I did not normalise them.
Renaming either would touch a field two consumers already read, to fix a
cosmetic inconsistency. Instead the contract is stated and pinned:

> **`'derived'` is the only token with a decision behind it, and it is identical
> across both paths. Consumers test `=== 'derived'` or `!== 'derived'`, never
> `=== 'observed'`.**

Both existing consumers (`:4272`, `:5452`) already satisfy this. A test pins the
asymmetry so it is not "fixed" into a consumer-breaking rename.

## 4. No behaviour change at the tier gate — provable, not observed

`:4272` suppresses the "Top of Book" tier when
`mid > market * 1.02 && basis.midBasis !== 'derived'`. Newly populating
`midBasis` could in principle suppress a tier that used to render.

It cannot, and the reason is arithmetic rather than testing: **in every path
that emits `'derived'`, `mid` was set equal to `market` by the `??`.** A number
cannot exceed itself by 2%, so the first clause was already false wherever the
new tag is `'derived'`. The gate's outcome is unchanged for every input.

Pinned as `a derived mid is always exactly the market price, in both paths`,
which is the property the argument rests on — if a future edit makes a derived
mid something other than market, that test fails and this reasoning is retired
with it.

## 5. Label

`_rangeParts` (`:5423`) gained a fifth parameter. The label now follows the
basis rather than the number:

| `midBasis` | Renders |
|---|---|
| `'derived'` | `Ref $X (calculated)` |
| `'observed'` / `'provider'` | `Mid $X` |
| `null` / `undefined` | `Mid $X` |

The third row is deliberate. An untagged mid is **not** evidence of derivation,
and relabelling it would invent provenance in the other direction — asserting
our arithmetic produced a number that may well be a real median. Only an
explicit `'derived'` downgrades the label. Both call sites (`:4894`, `:4922`)
now pass the basis; `_clampHigh` spreads the row, so it survives the clamp.

## 6. Low/high independence

Held, and asserted separately rather than left implicit:

> `low and high are unchanged by midpoint provenance` — the `Low $…` and
> `High $…` elements are byte-identical between a `'derived'` and an
> `'observed'` call with the same numbers.

A derived centre says nothing about whether the endpoints were measured, and
discarding a usable range because the middle was computed would lose real
information. The all-equal collapse and the no-midpoint case are pinned too.

## 7. T2.14, checked separately

As instructed, this was checked as its own question, not folded into the above.

T2.14's low-vs-ask tripwire (`:4746`) computes
`_askRef = (basis.mid != null) ? basis.mid : basis.market`. It reads `mid` as a
**value** and gates on nothing. The comment at `:4740` records why: an earlier
revision required `midBasis === 'observed'` before the comparison would run,
which meant an untagged mid — the common case — stopped triggering the
suppression and a bad floor came back. **Tripwires fail closed.**

T2.10 does not change this and must not. Two assertions guard it:

- `T2.14: the low-vs-ask comparison does not gate on midBasis` (comment-stripped
  region scan, so a future gate cannot be added silently)
- `T2.14: the ask reference still prefers mid and falls back to market`

The comparison's *result* is also unchanged, for the same reason as §4: where
the new tag is `'derived'`, `mid === market`, so `_askRef` takes the same value
under either branch.

## 8. Tests

| Suite | Before | After |
|---|---|---|
| `quick-pricing` | 188 / 0 | **204 / 0** (+16 T2.10) |
| `launch-audit-regressions` | 433 / 3 | **438 / 0** |
| `asset-fingerprints` | — | **15 / 0** |
| `review-fee-dl` | — | 21 / 0 |
| `draft-review-screen` | — | 180 / 0 |
| `accuracy-fee-parity` | — | 41 / 0 |
| `trs-listing-scope` | — | 60 / 0 |
| `payout-honesty` | — | 32 / 0 |
| `sports-price-guard` | — | 60 / 0 |

Nine of the sixteen new checks are **executed**, not pattern-matched:
`_rangeParts` is sliced out of the live bundle and called with real arguments.

**Three pre-existing assertions failed and were re-pointed, not deleted.** They
pinned `_rangeParts`'s exact four-parameter signature and its two call sites'
exact argument counts. The behaviours they name — an all-equal triple collapses;
neither writer hand-rolls a `Low $…` string — are unchanged; only the arity is.
Each now pins the first four parameters **in order** and tolerates appended
ones, and each carries a `USED TO ASSERT` note in the test file recording the
old text and why it moved.

## 9. Two findings, recorded not fixed

Both are out of T2.10's scope and neither changes a number.

**(a) A stale comment asserts the opposite of the code.** `:2657-2659` says to read
the basis fields from `tcg` rather than `_tcgC` because "`_clampHigh` rewrites
`high` and does not carry these fields". `_clampHigh` (`:1893`) returns
`{ ...row, high, highClamped }` — it **does** carry them. Reading from `tcg` is
still correct and harmless, so no behaviour depends on this; the comment is
simply wrong and would mislead the next reader.

**(b) The clamp runs twice.** `renderPriceStatus` reassigns `tcg = _clampHigh(tcg)`
at `:2040`, and `:2652` computes `_tcgC = _clampHigh(tcg)` on the already-clamped
value. It is idempotent — the second pass tests `high > anchor * 3` against a
`high` that now equals `anchor * 3` exactly, which is false — so the result is
correct and only the work is redundant. Left alone deliberately: the low/high
path was to stay independent of this work.

## 10. Not done

- No `midBasis` re-tag in `_clampHighPriceInPlace` (`api/tcg-price.js:623`). The
  clamp rewrites `high` only; `mid` is untouched, so its basis is still accurate
  afterwards. The `highBasis → 'derived'` re-tag at `:637` remains the correct
  precedent for a value that becomes ours, and no mid ever does.
- No normalisation of `'observed'` vs `'provider'` — see §3.
- The kit's proposed MID-01…MID-07 identifiers were **not** adopted as
  production reason codes. Evidence is organised under the existing suites.
- D3, BIAS-1, BIAS-6 and Q7 were not reopened.

## Sources

Repository only. No external retrieval was performed for this work.

- `api/tcg-price.js` — `:291`, `:317`, `:382`, `:387`, `:623`, `:637`
- `js/core.541c4c39.js` — `:440`, `:487`, `:1893`, `:2040`, `:2530`, `:2653`,
  `:2657-2659`, `:2669`, `:2712`, `:3845`, `:4026`, `:4041`, `:4272`,
  `:4740`, `:4746`, `:4894`, `:4922`, `:5423`, `:5452`
- `index.html:3753`
- `tests/quick-pricing.mjs`, `tests/launch-audit-regressions.mjs`,
  `tests/asset-fingerprints.mjs`
- `audit/BUNDLE_RENAME_541c4c39.md`
