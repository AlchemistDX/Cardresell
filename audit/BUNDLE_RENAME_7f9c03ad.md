# Bundle rename — `core.8bd8277a.js` → `core.7f9c03ad.js`

Contract Part 5 (`audit/DRAFT_LIST_API_CONTRACT.md:657-670`). Executed after D3 step 2
and its decision landed (`f443597`), deliberately not before — see §4.

## What was done

| | |
|---|---|
| Live bundle | `js/core.7f9c03ad.js` (19,328 lines) |
| Retired bundle | `js/core.8bd8277a.js` (19,001 lines) — **kept, bytes restored to `42c9e29`** |
| Live reference | `index.html:3593`, one `<script defer src>` — the only one |
| Method | copy edited bytes to the new content address, restore the old name's own bytes. **Never `git mv`** |

The reasoning for keeping the retired file's original bytes is unchanged from
`BUNDLE_RENAME_8bd8277a.md` and is not restated here: the name is a content address, and
`vercel.json:47-48` serves `/js/*` as `immutable`, so a browser holding a cached `index.html`
must still be able to fetch the old name forever.

## The expected name was wrong

`audit/d3/D3_STEP2.md` §5.1 said this rename would go to **`8e24cab9`**, and so did the
step 2 summary. It didn't. **`8e24cab9` was the hash of the review container as first
written** — measured before the decision in `DECISION_REVIEW_ERROR_VOCABULARY.md` was
applied. Dropping `_REVIEW_ERR_ALIAS`, rewording the copy-table comment, adding the region
sentinel and adding the `_draftsAbsorb` NOT PORTABLE note all changed the bytes again.

Renaming to `8e24cab9` because a document said so would have produced a filename that
hashes to something else — a fingerprint that lies, caught by nothing except the suite whose
whole job is catching it. **The name is derived from the bytes at rename time, never quoted
from a plan.** A hash written down in advance is a prediction, and a prediction that ages
across two commits is stale by default.

**Recurred 2026-09-07, in a packet rather than a document.** A review response reported
`asset-fingerprints` as "14/1, expected `FAIL ... (sha256[:8] = f9de26a1)`" — quoting a
specific hash as the expected end state. Two commits later the bundle hashes to `bea24540`,
and it will hash to something else again before the closing rename. The suite itself never
had this bug: it re-derives the hash on every run and prints the current one, so the failure
message is always true. The staleness was entirely in the prose around it.

Worth being precise about the consequence, because it is easy to overstate. The held-red
does **not** acquire a second cause when the bytes move — there is one cause, a stale
filename, with a moving hash, and one rename closes it whatever the bytes did on the way.
What a quoted hash costs is *recognisability*: a reader comparing a fresh run against a
packet that names `f9de26a1` sees a mismatch and cannot tell "expected red, bytes moved
since" from "new failure". Attribution survives at the count — 14/1 naming this one file is
the expected state, anything else is new — so the fix is in how it is reported, not in the
suite. **Report the held-red by its file and count, never by a hash.**

This is `PATTERN_ASSERTION_SURFACE.md`'s instance-4 shape again, in the mildest possible
form: a document stating a fact about work not yet done, which a later reader would have
executed on trust. The remedy is the same one already in practice — re-derive, then stamp.

## Line offsets, retired `8bd8277a` → live `7f9c03ad`

Five insertion points, no deletions and no moved lines. Citations against `8bd8277a` map
forward by adding the cumulative offset:

| Retired lines | Offset | What was inserted |
|---|---|---|
| 1 – 8,117 | 0 | — |
| 8,118 – 8,123 | +1 | `switchView`: `const review = …` |
| 8,124 – 8,146 | +2 | `switchView`: `review.style.display = 'none'` |
| 8,147 – 18,854 | +8 | `switchView`: the `view === 'review'` branch |
| 18,855 – 19,000 | +16 | `_draftsAbsorb` NOT PORTABLE invariant note |
| — | — | 19,017 – 19,328: region sentinel + the review screen |

Nothing in the drafts screen or the D2.1 work moved by more than 16 lines, and everything
below `_draftsAbsorb` is new. Existing citations into `api/*` are unaffected.

## Why the rename waited

Doing it at the end of step 2 as first written would have retired **two** bundles for one
step — `8e24cab9` for the container, then another for the decision — and produced two sets
of citation offsets, one of which would immediately be dead. The rename is the last action
after the bytes settle, not a step-by-step chore.

## Verified

| Suite | Result |
|---|---|
| `tests/asset-fingerprints.mjs` | **15 / 0** |
| `tests/draft-list-screen.mjs` | 81 / 0 |
| `tests/draft-focus.mjs` | 56 / 0 |
| `tests/draft-crud-e2e.mjs` | 130 / 0 |
| `tests/draft-list-cap.mjs` | 130 / 0 |
| `tests/draft-readiness.mjs` | PASS |
| review container (scratch, unregistered) | 30 / 0 |

`readCoreBundle()` resolves the live bundle from `index.html`, so the browser suites and the
offline suites both followed the repoint with no test edits. Both files parse.

**New work cites `7f9c03ad`.**
