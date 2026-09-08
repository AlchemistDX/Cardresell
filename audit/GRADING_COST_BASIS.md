# Grading Cost Basis — What the Published Schedules Actually Say

**Compiled 2026-09-07 for BIAS-5.** Every figure below is quoted from the grader's own
published page. Third-party summaries were used only to locate pages and are not cited as
authority for any number.

## Why this exists

`api/grade-opportunity.js:44-52` returns a grading cost, and the client's grade ladder uses
a separate constant of `$25`. The instruction was to make the server table authoritative.
It cannot be, for two independent reasons: **it does not agree with the published
schedules**, and **it is bucketed on the wrong quantity**.

## 1. The server table versus the published prices

```js
function getGradingCost(rawPrice, grader = 'PSA') {
  if (grader === 'BGS') return 50;
  if (grader === 'CGC') return 18;
  if (grader === 'SGC') return 18;
  if (rawPrice < 200) return 25;
  if (rawPrice < 500) return 50;
  return 100;
}
```

| Table value | Published schedule | Verdict |
|---|---|---|
| PSA `$25` | Value **$32.99**; Value Bulk **$24.99** but Collectors Club-only with a 20-card minimum per era ([PSA pricing update, effective 2026-02-10](https://www.psacard.com/info/submission-updates)) | **Unsupported** for a single-card submission |
| BGS `$50` | Base **$14.95**, Base+subgrades **$17.95**, Standard **$34.95**, Express **$79.95**, Priority **$124.95** ([Beckett grading](https://beckett.com/grading)) | **Matches no level** |
| CGC `$18` | Bulk **$17** (25-card minimum), Economy **$20**, Standard **$55**, Express **$100** ([CGC services and fees](http://www.cgccards.com/submit/services-fees/cgc-grading/)) | **Matches no level** |
| SGC `$18` | SGC's own pricing page returned no readable schedule; third-party trackers disagree with each other ($15 vs $50 for the same $1,500 band) | **Unverified — do not assert** |

Two further facts the table cannot express:

- **Beckett's two cheapest levels are not orderable.** Beckett's own page shows *Notify me*
  rather than an order action against Base and Standard ([Beckett grading](https://beckett.com/grading)).
  A cost of $14.95 is not a cost a seller can currently pay.
- **CGC can move your card up a tier and bill you.** "In the event that CGC, at its sole
  discretion, determines that the fair market value of a collectible is higher than the
  value stated by the submitter, CGC will move the collectible to the appropriate higher
  tier and the additional charge will be the responsibility of the submitter"
  ([CGC services and fees](http://www.cgccards.com/submit/services-fees/cgc-grading/)).
  The submitter's stated value is not binding, so no cost derived from it is firm.

## 2. The value basis is wrong, not just the number

The table buckets on **`rawPrice`**. Every grader gates its levels on **declared value with
a maximum ceiling**:

| Grader | Ceilings published |
|---|---|
| PSA | Max insured value **$500 / $500 / $500 / $1,000 / $1,500 / $2,500 / $5,000 / $10,000** across levels ([PSA trading card grading](https://www.psacard.com/services/tradingcardgrading)) |
| CGC | **$500** Bulk · **$1,000** Economy · **$3,000** Standard · **$10,000** Express · **$100,000** WalkThrough ([CGC](http://www.cgccards.com/submit/services-fees/cgc-grading/)) |
| Beckett | No declared-value maximums stated on the pricing page — **Unverified** |

This matters most in exactly the case the grade ladder exists to show. A card raw at $150
projected to a PSA 10 worth $1,200 is a card whose **graded** value is what travels back
insured. Bucketing it by its $150 raw price selects a level whose ceiling its graded value
exceeds. The panel's own headline number is evidence that the cheap level does not apply.

**Unverified join:** PSA publishes prices on one page and ceilings on another, and the
ceilings page does not name the service levels. Mapping `$32.99 → $500 ceiling` therefore
requires joining on turnaround days across two pages. A third-party table asserts Value
Plus covers $1,000 where PSA's own page shows $500 against the 45-day row. **The
price-to-ceiling mapping is not established from primary sources and is not asserted here.**

## 3. Expenses incurred only by grading, currently unmodelled

None of these appear anywhere in the ladder. They are incurred *because* the card was
graded, so they belong in a grading-versus-raw comparison.

| Expense | Published figure |
|---|---|
| PSA return shipping **and** insurance, 1–8 cards, $1–$1,000 declared | **$19.00 per submission** ([PSA postage rates](https://www.psacard.com/submissions/postage/), effective 2023-01-24) |
| Same, $1,001–$5,000 declared | **$34.00 per submission** |
| Inbound shipping and insurance | Submitter's responsibility; not published as a PSA rate |
| PSA Collectors Club, required for the $24.99 bulk rate | Annual membership; amount not stated on the join page — **Unverified** |
| Beckett extras | Autograph **+$5**, oversized **+$8**, any subgrade 10 on Base **+$3** ([Beckett](https://beckett.com/grading)) |

**Floor for a single PSA card, domestic, declared ≤ $500:** `$32.99 + $19.00 = $51.99`,
before inbound shipping. The panel currently assumes **$25**. The gap is **larger than the
figure the panel names**, and it runs in the optimistic direction.

Return shipping is charged **per submission**, not per card, so per-card cost falls sharply
with submission size — another input the app cannot observe from one scan.

## 4. What this means for BIAS-5

The cost is not one number. It is a function of grader × service level × declared value ×
submission size × shipping, and the app observes none of those at scan time. Picking a new
constant would repeat the BIAS-1 error at a different address: **inventing an input to a
cost model.**

So BIAS-5 needs an owner decision, recorded in the packet. The value is left at `$25` and
annotated as unsupported rather than silently replaced. The test that pinned `$25` has been
deleted and replaced with the invariant that survives any decision: **the cost used in the
arithmetic is the cost disclosed to the seller.**
