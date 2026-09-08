# T2.10 — Midpoint provenance. Return packet

**Scope as authorised:** preserve `midBasis` through server and client, label
derived centres as calculated references, keep valid low/high ranges independent
of midpoint provenance, and test T2.14's comparison separately. Bounded trace
and correction only. No grading-price or tax-source research was done and no
such sources are cited here.

**Implementation commit: `19cb94c`** (local; nothing pushed). The integration
case, the two narrowed claims and the mutation evidence in §4, §3 and §8c
landed in **`00445d0`**.

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

**What `!== 'derived'` does and does not mean.** It means *not known to be
ours*. It does **not** mean observed, and it must not be read as one. Three
states share that branch:

| State | `midBasis` | What is established |
|---|---|---|
| Supplied | `'observed'` / `'provider'` | upstream sent a midpoint |
| Derived | `'derived'` | we substituted the market price |
| **Unknown** | `null` / absent | **nothing** |

The third is distinct from both, and it is reachable — any cached row written
before this commit, and every non-TCGplayer rung, arrives with no midpoint
basis. `!== 'derived'` is therefore a **negative** test with a deliberately weak
guarantee, and it is the correct shape for the two consumers that use it:
the tier gate withholds a tier only on positive evidence of derivation, and the
label declines to relabel without it.

It would be the **wrong** shape for anything asserting the midpoint is real. No
consumer may use `!== 'derived'`, or a neutral `Mid` label, to authenticate an
observed median or an ask. Nothing in this work does; this is written down
because the next consumer to read the field is the risk, not the current two.

## 4. No behaviour change at the tier gate — provable, not observed

`:4272` suppresses the "Top of Book" tier when
`mid > market * 1.02 && basis.midBasis !== 'derived'`. Newly populating
`midBasis` could in principle suppress a tier that used to render.

It does not, on the paths exercised — and the scope of that statement matters,
because my first version of it was too broad.

The argument is arithmetic: **in every path that emits `'derived'`, `mid` is set
equal to `market` by the `??`.** A number cannot exceed itself by 2%, so the
first clause is already false wherever the new tag is `'derived'`.

**But a producer assignment does not establish the equality at the consumer.**
Between the assignment and the gate sit `_clampHighPriceInPlace` on the server,
`_clampHigh` on the client, and the wire. Any of those could in principle
transform `market` or `mid` and break an equality that was true where it was
written. Reading the assignments proves nothing about that, which is the same
error as reading seven occurrences and calling provenance preserved.

So the claim is now scoped and measured, not asserted:

> On the **main and fallback `/api/tcg-price` paths**, with both clamps
> executed, a `'derived'` mid arriving at the consumer equals the market value
> the consumer holds.

That is a test (§8, `after the High clamp, a derived mid still equals market`),
run on a basis produced by the real producer and the real clamp, including a
case where the clamp actually fires. What it does **not** cover: the eBay and
PriceCharting rungs, `scan-miss`, cached pre-commit rows, and any future
producer. Those reach the gate with `midBasis` absent, take the `!== 'derived'`
branch, and are unaffected for that reason rather than by this equality.

If a future edit makes a derived mid something other than market, that test
fails and this reasoning retires with it.

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
| `quick-pricing` | 188 / 0 | **219 / 0** (+31 T2.10) |
| `launch-audit-regressions` | 433 / 3 | **438 / 0** |
| `asset-fingerprints` | — | **15 / 0** |
| `review-fee-dl` | — | 21 / 0 |
| `draft-review-screen` | — | 180 / 0 |
| `accuracy-fee-parity` | — | 41 / 0 |
| `trs-listing-scope` | — | 60 / 0 |
| `payout-honesty` | — | 32 / 0 |
| `sports-price-guard` | — | 60 / 0 |

### 8a. The integration case, and why the formatter tests were not enough

You were right, and it is the ingestion-B gap again. Executing `_rangeParts`
proves the **formatter** works. It proves nothing about whether production hands
it a fifth argument — a dropped assignment anywhere between the server and the
call site leaves every formatter test green while the label silently reverts.

So the new case walks the chain with **production text at every hop**:

```
api/tcg-price.js  const data = {…} + _clampHighPriceInPlace   (both paths)
  → core :2653  the wire read into _basisMeta                 (bundle text)
  → core :2701  the window._crBasis build                     (bundle text)
  → core :4894  priceRange.textContent = _rangeParts(…)       (bundle text)
  → core :5423  _rangeParts                                   (bundle text)
```

Cases: missing provider midpoint on the main path → `'derived'` survives to a
rendered `Ref $40.00 (calculated)`; supplied midpoint → `'observed'` survives
and renders `Mid $44.00`; both repeated on the **fallback** path, where
`'provider'` must render `Mid` and not be downgraded; the low/high pair verified
still present in the rendered string in each; and the clamp-fires case behind
§4's narrowed claim.

**What is reconstructed and therefore NOT proven:** the `if (tcg && tcg.market
!= null)` and `if (bestPrice != null)` branch guards, and the fetch that puts
the server's JSON into `tcg`. The field-copy statements between them are
production text, which is where the defect was and where a regression lands.

### 8b. T2.14, executed rather than structurally pinned

Your point stands — the two prior assertions established code structure, not
behaviour. Both states now run the real row builder on a basis produced by the
real producer:

- **Withheld:** server returns `low: 150` against a substituted `mid: 100`. The
  row renders `Provider low (not used)` with an em dash, no number, and the
  cause-free note. Asserted alongside `midBasis === 'derived'`, so the state
  under test is confirmed to be the one the regression involved.
- **Absent:** server returns `low: null`. No low row is emitted at all.

### 8c. Mutation check

Asked for, and it changed the packet. Two assignments dropped, one at a time:

| Mutation | Formatter checks | Integration checks |
|---|---|---|
| adapter `midBasis: tcg.midBasis ?? null` (`:2669`) | **all green** | **8 red** |
| server main path `midBasis:` (`:317`) | **all green** | **9 red** |

The separation is the result that matters: the formatter suite cannot see either
defect, and the integration case cannot miss it. Dropping only the main-path
server assignment also left both **fallback**-path checks green, so the cases
discriminate paths rather than failing en masse.

It also caught a dishonest assertion of mine. `main path, no provider mid: the
server tags it derived` was asserting on the **chained** basis, so the adapter
mutation turned it red — reporting a client regression as a server failure. It
now asserts on the producer's own output object. Nine of the ten new integration
checks are executed against real code; that one is executed against the server
alone, deliberately.

Nine of the original sixteen checks are also **executed**, not pattern-matched:
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
