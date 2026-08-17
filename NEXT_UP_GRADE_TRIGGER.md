# Grade Opportunity Trigger — Spec

Goal: Stop users from burning AI grade scan credits on cards where grading is economically stupid. Show a subtle "worth grading" nudge on regular scans **only** when the math actually works out.

## The math

For a given raw card:

```
raw_price   = TCG market or eBay raw median  (source of truth: TCG)
graded_est  = raw_price × grade_multiplier   (per grader × grade)
grading_cost = PSA/BGS/CGC/etc submission cost + shipping (default $25 for PSA value tier)
platform_fees = graded_est × 0.13            (eBay 13% blended)
expected_profit = graded_est − grading_cost − platform_fees − raw_price
edge = expected_profit / raw_price           (percentage return)
```

**Trigger threshold (Phase 1, conservative):**
- `expected_profit >= $30` AND `edge >= 40%` → show "Worth grading" pill (green)
- `expected_profit >= $10 && < $30`, OR `edge >= 20% && < 40%` → show "Borderline — check comps" pill (yellow)
- Everything else → **silent**. No pill. Don't nag users.

## Grade multipliers — the hard part

We don't have per-card historical PSA10 sold data (need eBay for that, which is dark). So Phase 1 uses **conservative category multipliers** with a **card-value tier adjustment**:

| Raw price tier | PSA 10 mult | PSA 9 mult | BGS 9.5 mult |
|---|---|---|---|
| Under $5 | 3× | 1.5× | 2× |
| $5–$25 | 4× | 2× | 3× |
| $25–$100 | 5× | 2.2× | 3.5× |
| $100–$500 | 4× | 2× | 3× |
| Over $500 | 3× | 1.8× | 2.5× |

Rationale:
- Mid-tier ($5–$25) chases yield the best % return (a $12 raw → $50 PSA 10 = 4× is common)
- Under $5 rarely justifies the $25 grading fee — very high threshold
- Over $500 the % edge compresses because grading cost is a rounding error

Phase 2 will replace this table with real historical eBay PSA multipliers once we get eBay flowing (proxy/API).

## Grading cost defaults

| Grader | Card value tier | Cost |
|---|---|---|
| PSA | Under $200 | $25 (Value tier) |
| PSA | $200–$500 | $50 (Regular) |
| PSA | Over $500 | $100 (Express) |
| BGS | Any | $50 |
| CGC | Any | $18 |
| SGC | Any | $18 |

Phase 1: **PSA only** in the recommendation. Simplest first.

## Where the trigger fires

1. **Card detail page** — new row between price and shipping section:
   - Green: `⚡ Worth grading — PSA 10 est. $XX profit (+YY% edge)`
   - Yellow: `📋 Borderline — check recent comps`
   - Silent otherwise
2. **Collection view** — a small `⚡` icon in the corner of any card row where trigger says green
3. **AI Grade scan modal** — if the card the user is about to grade is silent-tier, warn them: `"Grading may not be profitable — $X est. profit doesn't cover the $25 grading fee. Grade anyway?"`

The third one is the actual credit-saver.

## Data requirements

New endpoint: `/api/grade-opportunity`

**GET params:** `name`, `set`, `number`, `game`
**Response shape:**
```json
{
  "rawPrice": 12.45,
  "recommendation": "worth_grading" | "borderline" | "sell_raw",
  "targetGrade": "PSA 10",
  "gradedEst": 49.80,
  "gradingCost": 25,
  "expectedProfit": 18.55,
  "edgePct": 149,
  "grader": "PSA",
  "reasoning": ["mid-tier card ($5-$25 chase yield)", "4× PSA 10 multiplier"],
  "fetchedAt": "2026-08-17T22:51:00Z"
}
```

Internally calls `/api/tcg-price` (source of truth for raw), applies the multiplier table, returns recommendation.

## Frontend

Reuse the `trust-pill` CSS class we already have. New render function:

```js
function renderGradeOpportunity(g) {
  if (g.recommendation === 'sell_raw') return '';  // silent
  const isGreen = g.recommendation === 'worth_grading';
  const bg  = isGreen ? 'rgba(34,197,94,.15)'  : 'rgba(245,158,11,.15)';
  const bd  = isGreen ? 'rgba(34,197,94,.55)'  : 'rgba(245,158,11,.55)';
  const clr = isGreen ? '#4ade80'              : '#fbbf24';
  const icon = isGreen ? '⚡' : '📋';
  const label = isGreen
    ? `Worth grading — ${g.targetGrade} est. $${g.expectedProfit.toFixed(0)} profit (+${g.edgePct.toFixed(0)}%)`
    : `Borderline — check recent comps`;
  return `<div class="trust-pill" style="...${bd}...${clr}...">${icon} ${label}</div>`;
}
```

Fires immediately after `renderPriceStatus()` on card detail load.

## Guardrails (things not to do)

- **Never** show grade-opportunity pill when `tcg.market` is null or below $2 (data too weak)
- **Never** trigger on sports cards without a raw price (they route to manual entry)
- **Never** recommend grading a card that's already graded (check current grader pill state)
- **Never** use category multipliers for slabs the user is scanning (grade already resolved)
- Silent on JP cards (different market dynamics)

## Success metric

Post-ship, watch:
- % of AI grade scans that came AFTER user saw a green "worth grading" pill (should trend up)
- Ratio of "grade credits used on flagged cards" vs "grade credits used on silent cards" (should trend toward flagged)

If users are still grading silent-tier cards at high rates, the modal warning in #3 becomes the harder gate.

## Ship order

1. `api/grade-opportunity.js` — pure math, no external calls beyond internal TCG fetch
2. Frontend render on card detail page
3. AI Grade scan modal warning (the credit-saver)
4. Collection view badge (deferred to Priority #7 build)
