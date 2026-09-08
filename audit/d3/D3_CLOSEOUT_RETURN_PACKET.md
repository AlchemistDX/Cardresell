# D3 Closeout — Bundle Rename, Test Registration, Suite Inventory

**Written against tip `431da85`** (branch `phase1-block-d`). Nothing pushed; `origin/main`
remains `9aaf326`. Credential rotation, history cleanup, hosting checks and the push gate
are untouched by everything below.

All four closeout requirements, answered in order.

---

## 1. Bundle renamed from its final bytes; fingerprint guard's actual result

**`js/core.7f9c03ad.js` → `js/core.24cd52cb.js`** (20,227 lines). The name is
`sha256[:8]` of the bytes being published, measured at rename time. No name was written
down before the bytes were measured — the failure recorded in
`audit/BUNDLE_RENAME_7f9c03ad.md`, where a document pre-announced `8e24cab9` and the
bytes moved afterwards.

Method, unchanged from the previous two renames: copy the edited bytes to the new content
address, restore the retired name's **own** bytes (from `71e26e9`), never `git mv`.
`vercel.json:47-48` serves `/js/*` as `immutable`, so a browser holding a cached
`index.html` must be able to fetch the old name forever. All five core bundles
self-address:

| File | `sha256[:8]` of its own bytes |
|---|---|
| `core.24cd52cb.js` (live) | `24cd52cb` |
| `core.7f9c03ad.js` | `7f9c03ad` |
| `core.8bd8277a.js` | `8bd8277a` |
| `core.569ff536.js` | `569ff536` |
| `core.d9e1b484.js` | `d9e1b484` |

`index.html:3732` holds the one and only reference. Both bundles pass `node --check`.

### The fingerprint guard's actual result

**`tests/asset-fingerprints.mjs`: 15 passed, 0 failed.**

Before the rename it was 14/1, held red for the whole of D3 by design, with the single
failure reading `js/core.7f9c03ad.js is named after its own bytes (sha256[:8] = 24cd52cb)`
— the guard naming the new filename before the rename existed. It is now green. Reported
as measured rather than as predicted, and the prediction happened to be correct.

### A stale content address that no failure could have found

`tests/quick-pricing.mjs:420` read `readAppSource('js/core.7f9c03ad.js')` — a hardcoded
content address. After the rename that path still exists and still parses, because the
retired copy is deliberately kept. The block would have gone on **passing** while
asserting against bytes the browser no longer loads, and its own comment states that its
entire purpose is to execute the *live* bundle rather than grep a string for it.

Repointed to `readCoreBundle()`, which resolves from `index.html` and treats both zero
matches and two matches as errors, so it cannot silently select a retired file. Found by
grepping for the retired name after the rename, **not by a failure** — a stale content
address degrades into a green test. It was the only such site in `tests/` and `tools/`.

---

## 2. `review-fee-dl.mjs` is registered, and resolves the bundle `index.html` loads

**Registered** as slot 34 of `tests/run-all.sh`, denominator 45 → 46, slots 34+ shifted.
Editing only — the runner was not executed, since it reaches production.

The registration is confirmed by something other than my having edited the file:
**`tests/test-registry.mjs` now passes 12/0.** Before the edit it failed with

```
FAIL every suite on disk is either invoked by the runner or declared excluded
  → present but neither invoked nor declared (1): review-fee-dl.mjs -- each is a file, not a guard
```

so the suite's unregistered state was independently detectable, and its registered state
is too.

**A first attempt at this was wrong and the registry caught it.** The runner's progress
labels had 48 invocations under a `[n/45]` denominator with slots 24, 25 and 26 each
printed twice, which looked like accumulated copy-paste damage. I renumbered all labels
sequentially. `test-registry.mjs` failed: those three duplicate numbers are **deliberate**
— a gated check prints one label on its run branch and another on its SKIPPED branch,
sharing a slot, and the registry asserts no slot is printed *more than* twice precisely to
allow it. Reverted and redone as a single insertion preserving the shared pairs.

### Resolves the referenced bundle

`index.html` declares `src="/js/core.24cd52cb.js"`. The suite imports `readCoreBundle()`
from `tests/_assetRefs.mjs` — the one authority on which bundle the app loads — and prints
the path it resolved as its first assertion:

```
ok   renderer: produced markup from js/core.24cd52cb.js (priced 2171b, unpriced 723b)
...
review-fee-dl: 15 passed, 0 failed
```

`tools/review-fee-dl-render.mjs` was also refactored to use `readCoreBundle()` instead of
re-implementing the `index.html` regex, and exports the resolved path for exactly this
check. It reports `js/core.24cd52cb.js 24cd52cb`.

---

## 3a. `draft-review-screen` after the renderer/helper changes

**169 passed, 0 failed.**

Two things had to change to get there, and neither was a pass produced by lowering a bar.

### The assertion T2.14 invalidated — sharpened, not deleted

`tests/draft-review-screen.mjs:658` asserted `🔴 no fee row claims the discount` by
requiring that **no** fee row mention Top Rated at all. That was correct when the withheld
discount existed only as prose. T2.14 gave it a real `dt`/`dd` row, so the assertion went
red on a change that improved the thing it was guarding — an assertion that had encoded
the implementation rather than the behaviour.

The behaviour it guards is unchanged and is still the point of the block: **a global "I am
Top Rated" answer must not become a discount on this draft.** What changed is what
satisfies it. Deleting the check would have removed the leak guard entirely, so it was
split into three:

| Assertion | Guards |
|---|---|
| the withheld discount has exactly one fee row | the row exists and is not duplicated |
| `🔴` that row claims no amount — the global answer did not become a discount | `amount === '—'`; anything numeric means a per-listing benefit was granted on a global answer, and `$0.00` would claim it was computed and came to nothing |
| `🔴` that row is typed as withheld, not as a fee | `kind === 'withheld'` and the `dt`/`dd` kinds match |

What it used to assert and why it changed is recorded **in the test**, per the standing
rule that commit messages are the one part of the corpus nobody greps.

### The two "pre-existing failures" were the harness, not the rule

Reported at handoff as a stale-pill boundary defect red at `4e02d38`. It is not a defect
in the rule. `atAge()` computed its clock offset as `(days - 6) * 86400000`, where `6` was
**the stamp's age in days on the day the helper was written**. A hardcoded calendar
constant: it drifted one day further out of true every day, and by 2026-09-07 the
`2026-09-01` stamp was 7 days old, so every case landed one day late and the
`30 → not amber` and `45 → not stale` cases reported as failures.

`isFeeStale` is `> 45` and `isFeeAmber` is `> 30`, exactly as documented, and at true ages
of 30 and 45 they are correctly quiet. **No production behaviour was wrong and nothing in
the rule was changed.** The offset now comes from the app's own `verifiedAgeDays('ebay')`,
so it is derived from whatever the stamp says; changing the stamp or waiting a day no
longer moves the boundaries under the test. A guard asserts the age is finite, because a
non-finite age would make every boundary case land on `Infinity` and assert nothing.

This is the failure mode the block's own comment warned about one screen earlier — it
moves the **clock** because the config is not reachable — and then measured the moved
clock against a constant instead of against the config.

**A mistake worth recording:** my first version measured `verifiedAgeDays` *after* the
block above had left a fixed clock 200 days in the future, so it read ~207, every offset
landed before the stamp, and the age was `Infinity`. The symptom was two boundary cases
failing in **opposite directions** — which says the input moved, not that a threshold is
off by one. Both the fix and that diagnostic are recorded in the test.

## 3b. Clean-checkout local inventory

Run in a disposable detached worktree at tip `431da85`⁽¹⁾ with **0 uncommitted files**, so
nothing measured came from the working tree. Every live credential env var
(`KV_REST_API_URL`, `KV_REST_API_TOKEN`, `EBAY_CERT_ID`, `STRIPE_SECRET_KEY`,
`DRAFT_KV_LIVE`, `EBAY_LIVE`) was confirmed **unset**, so no suite could reach a live store
even by accident. `tests/run-all.sh` itself was **not** executed. Each suite was invoked
directly with a 240s timeout.

⁽¹⁾ the inventory ran at `09fc203`; the two commits after it touch only `audit/*.md`.

**46 registered suites: 41 executed, 41 passed, 0 failed, 0 timed out. 5 excluded.**

### Excluded — production-touching

| Suite |
| `draft-crud-e2e.mjs` |
| `draft-index-recovery.mjs` |
| `draft-kv-live.mjs` |
| `draft-list-cap.mjs` |
| `endpoints-smoke.js` |

Excluded on what the suite actually does, not on a string match: each performs `fetch(`
against either the production host or the live KV store. An earlier classifier flagged 11
suites by grepping for env-var names and hostnames; that was wrong. `test-registry.mjs`
matched because it *lists* excluded suites, `launch-audit-regressions.mjs` and
`minors-011-012-013` match `cardresell.org` because they assert it as an expected
`og:image` string in local files, and the two `*-offline` suites read env var names to
simulate their absence. All five of those execute offline and are in the executed set.

### Executed

| Suite | Result |
|---|---|
| `a11y-mobile-2026-09-04.mjs` | 174 passed, 0 failed |
| `accuracy-fee-parity.mjs` | 17 passed, 0 failed |
| `asset-extraction-2026-09-05.mjs` | 34 passed, 0 failed |
| `asset-fingerprints.mjs` | 15 passed, 0 failed |
| `auth-integrity.js` | ✅ Auth stack integrity verified |
| `bulk-bulbasaur-qualifier-2026-09-04.mjs` | 72 passed, 0 failed |
| `bulk-minun-misfire-2026-09-04.mjs` | 85 passed, 0 failed |
| `bulk-scan-misfire.mjs` | all bulk-scan misfire regressions pass |
| `condition-applicability.mjs` | 17 passed, 0 failed |
| `contrast-tokens.mjs` | 12 passed, 0 failed |
| `copy-truth-offline.mjs` | ALL CHECKS PASSED |
| `deeplink-companions.js` | Total: 170 checks, 0 failure(s) |
| `draft-focus.mjs` | 56 passed, 0 failed |
| `draft-list-screen.mjs` | 101 passed, 0 failed |
| `draft-readiness.mjs` | RESULT: PASS |
| `draft-review-screen.mjs` | 169 passed, 0 failed |
| `draft-store.mjs` | 111 passed, 0 failed |
| `durability-tombstones-2026-09-04.mjs` | 130 passed, 0 failed |
| `ebay-auth-offline.mjs` | 53 passed, 0 failed |
| `entitlements-2026-09-04.mjs` | 68 passed, 0 failed |
| `fee-truth-offline.mjs` | All fee-truth checks passed. |
| `launch-audit-regressions.mjs` | 432 passed, 0 failed |
| `listing-packet-offline.mjs` | 153 passed, 0 failed |
| `majors-flip-and-pack-2026-09-04.mjs` | 100 passed, 0 failed |
| `minors-011-012-013-2026-09-04.mjs` | [minors-011-012-013] 106/106 assertions passed |
| `quick-pricing.mjs` | 55 passed, 0 failed |
| `review-fee-dl.mjs` | 15 passed, 0 failed |
| `scan-hygiene-2026-09-04.mjs` | 182 passed, 0 failed |
| `scan-miss.js` | ✅ Scan-miss regressions covered |
| `scanner-fastpath.mjs` | 16 passed, 0 failed |
| `sell-eligibility.mjs` | 113 passed, 0 failed |
| `sell-gate-ordering.mjs` | 38 passed, 0 failed |
| `sku-identity.mjs` | 85 passed, 0 failed |
| `sol-remediation-2026-09-04.mjs` | 58 passed, 0 failed |
| `sports-parallel.mjs` | 11 passed, 0 failed |
| `sports-price-guard.mjs` | 60 passed, 0 failed |
| `syntax-check.js` | Total: 7 blocks, 0 error(s) |
| `test-registry.mjs` | 12 passed, 0 failed |
| `trs-listing-scope.mjs` | 60 passed, 0 failed |
| `variant-selection.mjs` | 16 passed, 0 failed |
| `webhook-p0-offline.mjs` | All 4 webhook P0 cases passed. |

---

## 4. If BIAS work changes the bundle, a new content-derived filename comes first

Acknowledged as a standing gate, not a one-off. The bundle is currently consistent —
`index.html` references `core.24cd52cb.js` and those bytes hash to `24cd52cb` — and
`tests/asset-fingerprints.mjs` is green at 15/0, so it will go red on the first byte
changed in the live bundle. That red is the trigger: the name is re-derived from the final
bytes, the reference updated, and the guard's **actual** result reported before any
checkpoint is presented as complete.

Per your correction, the BIAS pass ahead closes **BIAS-1 only** by routing
`renderGradingUpside` through `feeEbay`. That removes the duplicate fee model
(`FEES_PCT = 13`) and nothing else. BIAS-3 needs conditional grade labels; BIAS-5 needs
supported grader-cost inputs including grading-only expenses, and `feeEbay` has no grader
input at all, so the `GRADING_FEE = 25` contradiction with `api/grade-opportunity.js:44-52`
survives the routing untouched; BIAS-7 and BIAS-8 need a compatible grader/price basis,
and `syncKey` cannot supply provenance because it is a lookup key, not a record of origin.
They may land in one implementation pass; each needs its own acceptance evidence. Recorded
in `audit/DIRECTIONAL_BIAS_AUDIT.md`, with a note on why the wrong claim was plausible:
all five were filed together in one audit pass against one function, and shared provenance
reads as shared cause — but "found by the same audit" and "fixed by the same change" are
different relations, and only the first leaves a trace in the document.

---

## Open finding this rename exposed — the verifier cannot see a wrong bundle *name*

**Not a blocker for D3. It does mean a number I could otherwise have quoted as clean is
not clean.**

`tools/bundle-citation-map.mjs` reports `core.7f9c03ad.js  42/42 citations resolve`. That
is a statement about arithmetic, not about authorship. The tool assumes a citation naming
bundle X was written against X's bytes, and aligns X→live accordingly.

During D3, documents cited `core.7f9c03ad.js` with line numbers taken from the **working
tree** — which this rename has now published as `core.24cd52cb.js`, while `7f9c03ad.js`
was frozen back to its own original bytes. Those citations name a file whose bytes never
contained what they cite. The tool maps a line the author never read onto a line they
never meant, and reports success.

I checked all 18 name-level `7f9c03ad` citations across 9 documents by comparing the
retired and live content at each cited line. **All 18 differ.** Two were flagged by the
tool and are adjudicated; the other 16 are not distinguishable mechanically, because the
population is mixed:

- `audit/d3/D3_STEP5_THIRD_REVIEW_RESPONSE.md:35` cited `:5660-5673` for
  `_crSellerProfile()`. Retired `:5660` is an unrelated Lorcana comment; **live** `:5660`
  is `function _crSellerProfile() {` and live `:5668` is the exact comment the document
  quotes. Written against live bytes → bundle name corrected to `24cd52cb`, verified line
  by line rather than bulk-replaced.
- `audit/CSS_TOKEN_DEBT.md:7289` and `audit/d3/D3_STEP4.md:7289` cite a line whose
  **retired** content is `html += '<div class="warning-banner" role="status">…'` — which
  matches those documents' subject, while live `:7289` is an unrelated COMC comment. These
  look genuinely retired-based and were left alone.

So the same bundle name covers two populations, and telling them apart needs the
document's own claim read against both candidate lines. 16 remain unadjudicated, in
`CONSTANT_STATE_SCAN.md`, `CSS_TOKEN_DEBT.md`, `DIRECTIONAL_BIAS_AUDIT.md`,
`PATTERN_ASSERTION_SURFACE.md`, `TODO_PHASE1.md`, `d3/D3_STEP4.md`,
`d3/D3_STEP5_REVIEW_RESPONSE.md` and `d3/DISCLOSURE_PARITY_Q3.md`.

This is your "D3's rename does not cover later bytes", arriving one level up from where I
expected it: not in the bytes, in the corpus that points at them.

### The one correction where the claim had to be re-verified first

`audit/DIRECTIONAL_BIAS_AUDIT.md:587` cited `7f9c03ad` lines 19991 and 20006 for the claim
that `_reviewFeeCalc()` passes a **hard zero** shipping charge, which is what makes the
`item price only` basis true on the review screen. Line 19991 is past the end of the
retired bundle (19,329 lines), so that citation never resolved against the file it named,
and the numbers had drifted again during T2.14.

**The claim was re-verified against live code before the citation was touched:**
`js/core.24cd52cb.js:19969`, inside `_reviewFeeCalc()` at `:19951`, reads
`feeEbay(price, 0, prof.ebayStore, prof.ebayPromo, false)` — shipping charge is a hard
literal `0`. The claim stands; only the reference was wrong. Re-cited, with the old
reference recorded in place.

That correction note is itself written **without** the `file:line` separator, because the
verifier scans whole documents and a corrected citation quoted inside its own correction
note is re-flagged as a live citation forever. Recording history in place creates a
citation.

### Still red elsewhere, unchanged and pre-existing

30 citations do not resolve, all against `core.d9e1b484.js` (6598/6628). Was 32 before
this closeout; the two fixed are the two described above. Not introduced here and not
addressed here.

---

## Commits

| Commit | Contents |
|---|---|
| `6d97dea` | renderer reuses `readCoreBundle()`; TRS leak guard sharpened; staleness harness de-dated |
| `09fc203` | bundle rename; `quick-pricing` repointed; `review-fee-dl` registered as slot 34 |
| `2250f36` | `BUNDLE_RENAME_24cd52cb.md`; citation-map caveats; two citations corrected |
| `431da85` | corrected BIAS dependency map |

Roughly 124 commits outgoing, **nothing pushed**, and the push gate is unchanged: the Cert
ID rotation has not happened.

## Questions

1. **The 16 unadjudicated citations** — worth a pass now, or filed until something needs
   to read one? My inclination is to file it: each needs a human reading of the document's
   claim against two candidate lines, and the payoff is corpus navigability rather than any
   behaviour. If you want it now, say so and it becomes the next item instead of BIAS-1.
2. **The verifier's blind spot itself** — should `bundle-citation-map.mjs` learn to flag a
   citation whose cited line differs in content between the named bundle and live? That
   would have caught all 18 as *suspicious* on day one without needing to know which
   population each belongs to. It is a cheap check and it would have fired here.
3. **`asset-fingerprints` as the BIAS trigger** — I am treating its red as the signal to
   re-derive the filename. That works only if the BIAS pass runs it, and it is registered
   in `run-all.sh`, which I cannot run. Confirm you are happy with me invoking that one
   suite directly at the BIAS checkpoint; it reads local files only.
