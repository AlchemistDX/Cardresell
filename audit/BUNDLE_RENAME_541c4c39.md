# Bundle rename — `core.9f0f6b30.js` → `core.541c4c39.js`

Executed 2026-09-08 as part of the T2.10 midpoint-provenance work. **Planned
this time**, which is the only difference from the previous three: the rename
was performed in the same step as the edit, before any suite was reported green,
rather than being discovered afterwards by an external tool.

## What was done

| | |
|---|---|
| Live bundle | `js/core.541c4c39.js` |
| Retired bundle | `js/core.9f0f6b30.js` — **kept, bytes restored from `HEAD`** |
| Live reference | `index.html:3753`, one `<script defer src>` — the only one |
| Method | copy edited bytes to the new content address, restore the old name's own bytes. **Never `git mv`** |
| Gate | `tests/asset-fingerprints.mjs` 15 passed / 0 failed, run *before* reporting |

Reasoning for keeping the retired file's bytes is unchanged from
`BUNDLE_RENAME_7f9c03ad.md` and `BUNDLE_RENAME_9f0f6b30.md`: the name is a
content address and `vercel.json:47` serves `/js/*.<8hex>.js` as
`max-age=31536000, immutable`, so a browser holding a cached `index.html` must
be able to fetch the old name forever. Nothing was deployed, so no cache holds
either name — the discipline is maintained because the rule cannot be applied
selectively once it has been forgotten twice.

## What changed inside the bundle

Three client edits, all T2.10:

1. The wire read now copies `midBasis` alongside `marketBasis` / `lowBasis` /
   `highBasis` (the TCGplayer rung of `renderPriceStatus`).
2. The basis object passes `midBasis` through to the renderer.
3. `_rangeParts` gained a fifth parameter and labels a `'derived'` centre
   `Ref $X (calculated)` instead of `Mid $X`.

## Retired-name inventory

`js/core.9f0f6b30.js` joins `59d4b1ab`, `7f9c03ad`, `24cd52cb`, `8bd8277a` and
the rest as a retained, correctly-addressed file. Every `core.*.js` in `js/`
hashes to its own name; that is the whole of what `asset-fingerprints` checks,
and it is now 15/15.

## Citations

Documents written before this rename cite `js/core.9f0f6b30.js:NNNN`. Per the
standing decision, **"named bundle differs from live" is not a failure rule** —
it governs the citation map only, and no broad historical citation cleanup is
required. Those citations still resolve, because the retired file is retained
with its exact bytes and therefore its exact line numbering. Only documents
touched by this work were updated.

One exception was corrected by hand: the T2.9 packet's authoritative header row
read "Live bundle: `js/core.9f0f6b30.js`", which this rename made false. It now
reads "Live bundle *at that correction*" with the current name named alongside.
That is a truth fix, not citation cleanup.
