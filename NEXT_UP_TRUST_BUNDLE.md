# NEXT UP — Trust Bundle (Features #1 + #14)

**Status:** Paused mid-design to fix shop pricing first (bad $9 / 100 ID scan tier).
**Resume trigger:** After shop tiers are live + verified.

---

## The plan (locked, ready to build)

Ship as ONE PR: comp sanity filter + confidence score + timestamps.

### Backend — `api/ebay-sold.js`

New response fields:
```json
{
  "count": 12,           // AFTER outlier removal
  "rawCount": 15,
  "median": 84.00,
  "avg": 86.20,
  "low": 62.00,          // trimmed (5th %ile)
  "high": 118.00,        // trimmed (95th %ile)
  "trueLow": 22.00,      // untrimmed context
  "trueHigh": 340.00,
  "outliersRemoved": 3,
  "confidence": "high",  // high | medium | low | insufficient
  "confidenceScore": 87,
  "confidenceReasons": ["12 comps", "tight spread ±14%"],
  "fetchedAt": "2026-08-17T15:43:00Z",
  "cacheAgeSec": 0,
  "items": [...]
}
```

### Sanity filter algorithm

1. Compute Q1, Q3, IQR
2. Trim outside `[Q1 − 2.0·IQR, Q3 + 2.0·IQR]` (2.0 not 1.5 — card prices skew right)
3. Hard guardrails: drop <30% of median or >300% of median
4. If <3 comps survive → return raw with `confidence: "low"` instead

### Confidence formula (0-100)

- Volume: `min(count × 8, 40)`
- Spread: `max(0, 30 − (stdev / median × 100))`
- Recency: 30 if fresh (deferred until sold-date parsing in feature #2)
- Buckets: ≥75 high · 50–74 medium · 25–49 low · <25 insufficient

**Open question (unanswered by user):** IQR multiplier 2.0 vs 1.5, and confidence bucket cutoffs 75/50/25 vs stricter 85/60/35. Ask user when we resume.

### Frontend — `index.html` line 4190-4194

Replace status line:

**Before:** `eBay sold · 12 sales · median $84.00 · avg $86.20`

**After:**
```
eBay sold · 12 comps · median $84.00 · range $62–$118
🟢 High confidence · Updated 4 min ago · 3 outliers filtered ⓘ
```

Confidence pill colors: green / yellow / orange / gray.
ⓘ tooltip explains what got filtered and why.

### Timestamps (feature #14)

Add `fetchedAt` server-side, render "Updated X min ago" beside every price surface. Apply same to `tcg-price.js`.

---

## Why NOT in this PR (defer to feature #2 liquidity)

- Sold-date parsing (eBay HTML is inconsistent)
- 7 / 30 / 90-day volume counts
- "Estimated time to sell"
- Liquidity rating

Keeping this PR focused = reviewable in one sitting.

---

## Call sites to update in index.html

1. Line ~4140 — `fetchAndApplySoldComps()` (main card view)
2. Line ~7014 — `_fetchEbayPriceForEntry()` (collection refresh)
3. Line ~4190-4194 — status line render (main UI change)
