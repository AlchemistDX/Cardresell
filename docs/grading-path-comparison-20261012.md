# Grading path comparison — October 12, 2026

## User outcome

Grade results now offer a collapsed **Compare grading paths** section. Two
independent paths can use PSA, CGC, BGS or SGC. Each path's submission and sale
assumptions fold away to leave a readable results comparison on mobile.

PSA and CGC have explicit service-tier choices from official US direct-submission
pages checked October 12. BGS/SGC use seller-entered current quotes. Selecting a
published tier fills only its base fee and upper estimated working-day wait;
there is no automatic service selection, discount, shipping allowance or resale
price. Published snapshots stop calculating after 14 days; custom quotes remain
available. Refresh `checkedAt` and the tier records only after checking sources,
then run `node tools/build-grading-paths.mjs` to produce immutable assets.

Each scenario requires its own grade outcome and gross sale assumption. CGC Gem
Mint and Pristine are explicitly distinguished in the input guidance. Switching
graders clears the previous assumptions. Nothing converts a PSA estimate into
a CGC grade, applies a resale multiplier, or copies a PSA comp into another
grader. No model, scan charge, entitlement or provider call changes.

## Arithmetic and eligibility

- Raw proceeds = shared eBay net calculation minus raw-sale shipping paid.
- Graded proceeds = shared eBay net calculation minus graded-sale shipping,
  grading fee, and allocated submission shipping/insurance.
- Approximate calendar days = ceiling(working days × 7/5) + entered additional
  transit/selling days. This is not a calendar promise and excludes holiday delays.
- Optional capital adjustment = (max(raw proceeds, 0) + grading fee + submission
  shipping/insurance) × annual rate × calendar days / 365.
- Displayed difference = graded proceeds − raw proceeds − capital adjustment.

This compares conditional proceeds with selling raw, not profit on purchase
cost, expected value across grades, or a guarantee about future card prices.
The annual rate starts explicitly at 0 (off). Other missing costs remain missing;
users enter 0 when a cost does not apply. Inputs are USD per card. Shipping means
seller-paid cost; the scenarios assume no separately charged buyer shipping.

Published tiers check declared value, scenario sale value and submission count.
CGC Bulk requires 25 cards; PSA paused Value tiers are not offered. Missing,
negative, nonfinite or unreasonable values withhold calculations. The selection
is only an eligibility aid; the grader may determine a different value or charge
extras. A current custom quote is available for other tiers or discounts.

State is memory-only and scoped to signed-in user plus existing card/analysis
identity. The original grade ladder and its seller-entered cost state remain
separate. Comparison works when guide comps are absent or the guide request
fails. Manual quotes do not require additional API calls.

## Existing functionality and scope correction

The site already has grader-specific cost selection and a submission log with
company, sent date and returned grade. The next log extension should connect
an immutable prediction to the actual result/return date, with explicit consent
before using records for aggregate model evaluation. No shared training dataset
or accuracy claim is introduced here.

`api/grade-opportunity.js` contains legacy hardcoded PSA economics, but the live
client deliberately withdrew that route. It stays disabled. This change does
not revive its unsupported raw-price multipliers or PSA-10-only payoff claims.

## Verification

Required gate: `CR_CHROMIUM=<binary> node tests/grading-paths-browser.mjs`.
The synthetic suite covers conditional arithmetic, shipping/capital costs,
blank-vs-zero inputs, invalid amounts, bulk/value eligibility, stale snapshots,
grader separation, actual shipped fee integration, mobile overflow, missing
comps, scope restoration and duplicate-free rerenders. All external requests
are blocked. Existing grading-fee and identity suites also cover the preserved
ladder behavior. Asset fingerprints, test registry and build inspection apply.

The first mobile pass with foldable assumptions found the native details toggle
event could arrive after a service selection. Taking the visible open state
before redraw fixes the lost-open-state race; the browser gate was rerun.

This is a comparison foundation. Separate CGC AI prediction, dated company-
specific sales evidence, calibrated grade probabilities and automated fee
refresh are subsequent work. Existing advertising backup/rights/cost gates
still apply. This document does not claim deployment or grading accuracy.

Official sources checked October 12, 2026:
- https://www.psacard.com/services/tradingcardgrading
- https://www.cgccards.com/submit/services-fees/cgc-grading/
- https://www.cgccards.com/card-grading/grading-scale/
