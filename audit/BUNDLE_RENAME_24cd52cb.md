# Bundle rename — `core.7f9c03ad.js` → `core.24cd52cb.js`

D3's last action, per the standing decision that the bundle is renamed **once** at the
end of the block rather than per step. Executed 2026-09-07 after T2.14 was accepted and
the bytes settled.

## What was done

| | |
|---|---|
| Live bundle | `js/core.24cd52cb.js` (20,227 lines) |
| Retired bundle | `js/core.7f9c03ad.js` (19,329 lines) — **kept, bytes restored to `71e26e9`** |
| Live reference | `index.html:3732`, one `<script defer src>` — the only one |
| Method | copy the edited bytes to the new content address, restore the old name's own bytes. **Never `git mv`** |

The name was derived from the final bytes at rename time (`sha256[:8]` of the file being
published), never from a predicted name — the failure mode recorded in
`BUNDLE_RENAME_7f9c03ad.md`, where a document had pre-announced `8e24cab9` and the bytes
moved afterwards. No name was written down before the bytes were measured.

All five core bundles now self-address:

| File | `sha256[:8]` of its own bytes |
|---|---|
| `core.24cd52cb.js` | `24cd52cb` |
| `core.7f9c03ad.js` | `7f9c03ad` |
| `core.8bd8277a.js` | `8bd8277a` |
| `core.569ff536.js` | `569ff536` |
| `core.d9e1b484.js` | `d9e1b484` |

Retired bytes are restored because `vercel.json:47-48` serves `/js/*` as `immutable`: a
browser holding a cached `index.html` must be able to fetch the old name forever.

## Verified

| Check | Result |
|---|---|
| `tests/asset-fingerprints.mjs` | **15 / 0** (was 14 / 1, held red for the whole block by design) |
| `tests/review-fee-dl.mjs` | 15 / 0, and prints the resolved path `js/core.24cd52cb.js` |
| `tests/draft-review-screen.mjs` | 169 / 0 |
| `tests/accuracy-fee-parity.mjs` | 17 / 0 |
| `tests/test-registry.mjs` | 12 / 0 |
| `node --check` on both bundles | both parse |
| `tools/bundle-citation-map.mjs` | live bundle read as `core.24cd52cb.js`; `7f9c03ad` 42/42, `8bd8277a` 1/1, `d9e1b484` 6598/6628 |

`readCoreBundle()` resolves the live bundle from `index.html`, so the browser suites and
the offline suites followed the repoint with **no test edits**.

## One test did not follow, because it was not asking

`tests/quick-pricing.mjs:420` read `readAppSource('js/core.7f9c03ad.js')` — a hardcoded
content address. After the rename that path still existed and still parsed, because the
retired copy is deliberately kept. So the block would have gone on passing while
asserting against bytes the browser no longer loads, and that block's own comment says
its entire purpose is to execute the **live** bundle rather than grep a string for it.

Repointed to `readCoreBundle()`, which resolves from the document and treats both zero
matches and two matches as errors, so it cannot silently select the retired file.

**Found by grepping for the retired name after the rename, not by a failure.** There is
no failure to find: a stale content address degrades into a passing test. It was the only
such site in `tests/` and `tools/`.

**New work cites `24cd52cb`.**
