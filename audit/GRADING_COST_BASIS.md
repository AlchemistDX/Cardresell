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

---

## Re-verification, 2026-09-07 — and a disagreement, disclosed not averaged

The owner supplied newer PSA evidence when resolving BIAS-5 and instructed that
this file be corrected against it. It was re-read from **raw page text**, per the
standing rule that enumerated policy is cited from the page and not from
anything that condensed it. Two of the three supplied figures do not reproduce.

| Claim supplied | What the raw page says | Verdict |
|---|---|---|
| PSA Regular is $79.99/card | "Regular: $74.99 → $79.99" ([PSA submission updates](https://www.psacard.com/info/submission-updates)) | **Confirmed** |
| PSA Value services are temporarily paused | Same page lists "Value: $27.99 → $32.99" among increases. Nothing on it says Value is paused. | **Unverified** — could not be substantiated |
| Postage is $19.99 for 1–4 cards up to $2,000 insured | Chart headed "PSA & PSA/DNA Postage Rates - Effective January 24, 2023" reads **1–8 items / $1–$1,000 / $19.00**. No $19.99 rate, no 1–4 band, no $2,000 band appear on it. ([PSA postage rates](https://www.psacard.com/submissions/postage/)) | **Contradicted** |

Consequently the figures already in this file — Value **$32.99** and postage
**$19.00 / 1–8 cards / $1–$1,000** — are **left unchanged**, because the source
page did not disagree with them. The instruction was to correct this file if a
number had moved; the check found that the number had not moved. Changing it to
match the summary would have been stamping a lie in the other direction.

`Regular $79.99` is added below as confirmed. The "Value paused" line is
recorded as Unverified rather than omitted, so a later pass does not have to
rediscover that it was checked.

### What this does and does not change

**Nothing about the decision.** BIAS-5 ships with no default. $51.99 stays
rejected, and the re-verification actually strengthens the rejection while
removing one of the stated reasons for it:

- The arithmetic still reproduces. $32.99 + $19.00 = $51.99 off the live pages.
  So $51.99 was never stale, and "a number that moved twice while we were
  looking at it" — the phrasing used when the decision was taken — was wrong.
- The reasons that survive are the structural ones, and they were always the
  load-bearing ones: a scan cannot observe which service the seller qualifies
  for or will choose, whether they hold a Collectors Club membership, how many
  cards ride in the submission, what value they declare, or what they pay to
  ship **inbound** — which appears in no PSA table at all, because the seller
  buys that postage from their own carrier.
- Two readers of the same vendor pages produced different postage numbers
  during this decision. That is a direct argument against pinning either one
  into the product as an automatic cost.

The owner's framing — "the sourced figures can appear as dated guidance after
their service/value relationship is verified, but not as an automatic cost" —
is unaffected. This table is that dated guidance. It is not wired to anything.

### Confirmed service prices, raw-text read 2026-09-07

Source: [PSA submission updates](https://www.psacard.com/info/submission-updates).
Listed there as increases for new submissions.

| Service level | Was | Now |
|---|---:|---:|
| Value Bulk (Collectors Club only) | $21.99 | **$24.99** |
| Value | $27.99 | **$32.99** |
| Value Plus | $44.99 | **$49.99** |
| Value Max | $59.99 | **$64.99** |
| Regular | $74.99 | **$79.99** |

The same page states TCG Bulk and Value Bulk have been consolidated into a
single Collectors Club-only service, Value Bulk, which now accepts all
categories including TCG.

**Not established from these pages:** per-card declared-value caps tied to each
service name (the services page renders its tiers client-side and returned
turnaround/insurance rows without service names), and any pause on Value.
Recorded as Unverified rather than inferred from row order.
