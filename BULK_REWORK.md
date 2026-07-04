# Bulk Scan Full Rework

## Summary

Reworked the Bulk ID Scan flow end-to-end in `index.html`. All work is frontend-only —
`/api/scan.js` was not touched, and `/api/ebay-sold.js` was left in place (still used by
the Quick/Deep Grade scanner's price lookups at lines ~3591 and ~5602).

## Fixes

### 1. "Price unavailable" for every card — FIXED
Bulk scan was calling `/api/ebay-sold`, which wraps eBay's Finding API. That API was
deprecated by eBay in Feb 2025 and now returns 503 for every request, so every bulk-scanned
card showed "Price unavailable."

Replaced with a new `_bulkFetchPrice(cardName, setName, cardNumber)` helper that queries
`https://api.pokemontcg.io/v2/cards` (the same source already used by the rest of the app).
It:
- Builds a quoted `name:"..."` (+ optional `number:"..."`) query
- Scores results by set-name similarity (exact match > prefix match > fallback to first result)
- Picks the highest `market` price across variants (holofoil > reverseHolofoil > normal > firstEdition, falling back to `mid` if `market` is missing)
- Times out after 4s via `AbortController` and fails silently (returns `null`) on any error, so a slow/broken price lookup never blocks the scan

### 2. "Add All to Collection" appeared to do nothing — FIXED
The cost sheet transition itself worked, but there was no feedback loop back to the user
after saving, so it *felt* broken even when it succeeded. The save flow no longer auto-jumps
views — after a successful save, the bottom bar swaps to **"View Collection" / "Scan More"**
buttons and a toast confirms the save, so the result of tapping "Add All" is now visible
immediately without leaving Bulk Scan.

### 3. Collection save reliability — hardened
- Save loop now tags each entry with `condition`, `imageUrl`, and expands `qty > 1` merged
  rows into N separate portfolio entries (so P&L math per-card still works).
- Added a "Skip pricing — save with $0 cost each" shortcut in the cost sheet, and an
  immediate-save path when nothing has a market price and there's nothing to input costs for.
- `window._bulkSaved` flag added to prevent double-adds.

## New features (per spec)

- **Thumbnails**: rows now show the pokemontcg.io card image when available, falling back to the user's captured photo, then a placeholder.
- **Duplicate detection**: after a scan run completes, results are grouped by `name|set|number`. If any group has >1 entry, a banner appears ("You scanned X N times — Tap to merge"). Merging collapses duplicates into one row with a `qty` badge (`×N`).
- **Condition**: every card defaults to `NM`. A tappable "NM ▾" chip opens a bottom-sheet picker (NM/LP/MP/HP/DMG); selecting one updates `result.condition` and re-renders just that row.
- **Manual name correction**: tapping the card name opens `prompt()` pre-filled with the current name. On change, `result.cardName` updates, price is re-queried via `_bulkFetchPrice`, and the row re-renders with a "Card name updated" toast.
- **Inline price edit**: a small ✎ icon next to the price opens `prompt()` to manually override `result.marketPrice`.
- **Free retry for failed scans**: a "↻ Retry (free)" button re-runs `/api/scan` for that single card without decrementing the credit counter client-side. If the retry itself 402s, the row is still shown (not blocked).
- **Reworked row layout**: thumbnail + qty badge, name (tap to edit), set/number, price + variant label, condition chip, and ✓/✗ status with a retry or remove action.

## Bonus fix: Deep Grade edge case-mismatch

`submitGradeScan` read capitalized `edges.Top/.Bottom/.Left/.Right`, but the inline
`onchange="processGradeEdge(this,'top')"` handlers (and `processGradeEdge` itself) store
keys lowercase. This meant Deep Grade submissions with valid edge photos could silently
omit them from the OpenAI request. Fixed by reading either case:

```js
const top    = edges.top    || edges.Top;
const bottom = edges.bottom || edges.Bottom;
const left   = edges.left   || edges.Left;
const right  = edges.right  || edges.Right;
```

Also updated `showDeepGradeEdgeUI`'s checkmark logic (`edgeBtn`) to check
`edges[key] || edges[key.toLowerCase()]` so the "CAPTURED" indicator reflects reality
regardless of which case populated the object. `submitDeepGrade`'s `Object.keys(edges).length`
count check needed no change since it works regardless of key casing.

## Verification

- **Syntax check**: `node -e "...new Function(...)..."` over all inline `<script>` blocks — no errors.
- **Test suite**: `node tests/test-scan.mjs` — 31/31 passing (unchanged; these tests cover
  the untouched `/api/scan.js` backend, not the frontend bulk-scan rework).
- **Constraints preserved**: all existing DOM ids (`bulkScanOverlay`, `bulkResultsList`,
  etc.) and function names (`openBulkScan`, `closeBulkScan`, `startBulkCamera`,
  `startBulkUpload`, `bulkAddAllToCollection`, `confirmBulkCostSave`) kept stable. Mode
  picker and credit-confirm screens untouched. `/api/ebay-sold.js` left in place and still
  used by the (unrelated) Quick/Deep Grade scanner price lookups.

## Diff stats

`index.html`: 585 insertions, 133 deletions (net +452 lines) — concentrated in the Bulk
Scan JS block (previously lines 8130–8526, now ~8130–8920) plus the cost-sheet DOM (added
a "Skip pricing" button) and two small edits in the Deep Grade submit/UI functions
(~line 6744, ~6841–6853).
