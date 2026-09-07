# Bundle rename — `core.d9e1b484.js` → `core.8bd8277a.js`

Contract Part 5 (`audit/DRAFT_LIST_API_CONTRACT.md:657-670`). Executed last, after
every D2.1 suite was green.

## What was done

| | |
|---|---|
| Live bundle | `js/core.8bd8277a.js` (19,001 lines) |
| Retired bundle | `js/core.d9e1b484.js` (18,526 lines) — **kept, bytes frozen** |
| Live reference | `index.html:3574`, one `<script defer src>` — the only one |
| `tests/asset-fingerprints.mjs` | 15 passed, 0 failed |

## Why the retired file keeps its ORIGINAL bytes

The obvious execution is `git mv`. That is wrong here, twice over.

**1. The name is a content address.** `tests/asset-fingerprints.mjs` asserts every
hashed asset hashes to the eight hex characters in its own filename. The D2.1
screen was written by editing `core.d9e1b484.js` in place, so those bytes hashed
to `8bd8277a` under a filename claiming `d9e1b484`. Renaming the file would have
made the name true. So does copying the edited bytes to the new name and
restoring the old name's original content — and only the second keeps the old
address resolvable.

**2. `vercel.json:47-48` serves `/js/*` as `max-age=31536000, immutable`.** A
browser holding a cached `index.html` still asks for `/js/core.d9e1b484.js` by
name. Deleting that file 404s the entire client for those users. The whole point
of fingerprinted assets is that a retired asset stays fetchable forever; the new
deploy adds a file, it does not move one.

## The effect nobody would have predicted

Editing the bundle in place had silently invalidated audit citations, because
1,125 `js/core.<hash>.js:<line>` references across 130 files were written against
the pre-D2.1 line numbering.

A drift sweep (blank line / mid-docblock / out-of-range as the signal, per the
noise-floor method already used on `api/*.js`) measured it:

| | signals |
|---|---|
| Before restoring the retired bytes | **61** |
| After | **12** |

The 12 survivors are 6 unique citations duplicated across the two copies of the
audit tree, and all 6 are range citations whose first line is a docblock opener —
a legitimate style, i.e. the noise floor, not errors.

So 49 of 61 were drift caused by in-place editing, and restoring the retired
asset's original bytes repaired all 1,125 citations at once, with no document
edited. **Every existing citation is true against the file it names.** That is
the second reason not to `git mv`, and it is the one that was not obvious going
in.

## Offset map — retired line → live line

For anyone re-reading an old citation against the live bundle. Verified by
`diff` (`8116a8117`, `8121a8123`, `8136a8139,8146`, `18526a18537,19001`):

| Retired `d9e1b484` lines | Live `8bd8277a` |
|---|---|
| 1 – 8116 | same |
| 8117 – 8121 | **+1** |
| 8122 – 8136 | **+2** |
| 8137 – 18526 | **+10** |
| — | 18537 – 19001 = the drafts screen, new |

The +1/+2/+10 steps are the `switchView` `drafts` branch; the tail is the screen,
appended rather than inserted for exactly this reason.

## Going forward

New work cites **`js/core.8bd8277a.js`**. `js/core.d9e1b484.js` and
`js/core.569ff536.js` are both retired — do not cite either for live behaviour.
There is deliberately no text tripwire enforcing this: any such check would flag
all 1,125 historically-correct citations, which is the false-confidence failure
mode catalogued in `audit/DECISION_SOURCE_DISAGREEMENT.md`.

`tests/_assetRefs.mjs` resolves the live bundle from `index.html`, so every suite
followed the rename with no test edited. All re-run after it:
`draft-list-screen` 80/0 · `draft-focus` 56/0 · `draft-readiness` PASS ·
`a11y-mobile-2026-09-04` 174/0 · `asset-fingerprints` 15/0.

Not deployed. `tests/run-all.sh` not run — it hits prod endpoints.
