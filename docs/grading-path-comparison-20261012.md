# Grade-by-grade grader comparison — October 12, 2026

## User outcome

The grader pills now replace the price ladder with values for the selected
company. Each outcome shows its guide value immediately and expands into
selling fees, grading fee/service, submission shipping and insurance, sale
shipping, optional capital cost, proceeds, and difference versus selling raw.
The app uses existing prices and the shared eBay fee engine automatically.
Users no longer enter an outcome and resale estimate separately for each path.

PSA, CGC, BGS and SGC use dated official US direct-submission base rates. The default
chooses the lowest listed eligible fee for each scenario's guide value and
submission size (initially 1 card, visibly stated). There is no grading-cost
entry box or manual quote mode. The fee is visible on each collapsed grade row;
users can optionally choose a different published service. CGC Bulk needs at
least 25 cards. Paused PSA Value and BGS Base/Standard services are excluded.
BGS Express with subgrades is $79.95/15 business days on the current official
temporary submission form (100-card maximum). SGC Standard starts at $50 for
values through $1,500 and rises to $85 through $3,500; expedited brackets cover
values through $100,000. Values above that remain unavailable until the variable
SGC surcharge rounding is confirmed. The list covers standard-size unsigned
cards; tax, shipping, discounts and optional extras are explicitly excluded.
PSA high-value tiers include the published Premium 10 incremental surcharge;
CGC Unlimited includes 1% of value. All supported guide values cap at $1 million.
The grader determines final declared-value eligibility and any extra charges.

Only unknowable submission details are requested: card count, allocated
shipping/insurance, seller-paid sale shipping, and optional capital assumptions.
Blank shipping produces a subtotal explicitly labeled before unentered costs;
only entered costs (including explicit zero) allow the net-proceeds label.
The same sale-shipping input applies to the raw and graded scenarios.

## Price provenance and grading limits

The API retains grade 1–6 prices plus distinct CGC Pristine 10 and BGS Black
Label 10 fields from PriceCharting. Grades 1–6 fold away. Grade 7/7.5, 8/8.5,
9 and 9.5 are mixed-grader guide prices, explicitly labeled as such, and can
remain unchanged when switching companies. PSA has no 9.5 row. Grade 10 uses
only the selected company's field. Missing prices never fall back to PSA 10.
Special grade-10 outcomes are separate, not substituted for ordinary 10.

The AI condition estimate remains PSA-based. This does not create or claim a
CGC/BGS/SGC AI grade, calibrated probabilities, or an expected resale value.
Guide values are conditional scenarios, not guaranteed future sale prices.
Existing six-hour price caches may lack newly mapped fields until refreshed.
There are no new provider requests, model calls, scan charges or entitlements.

## Calculation and state

- Sale proceeds start with the existing shared eBay fee calculation.
- Graded proceeds subtract grading, allocated submission shipping/insurance,
  sale shipping and optional capital cost.
- Raw proceeds subtract the same sale-shipping assumption.
- Difference is graded proceeds minus raw proceeds; it is not purchase profit.
- Calendar estimate is ceiling(working days × 7/5) plus extra transit/sale days.
  Holidays and actual processing delays are not predicted. SGC Standard's 40+
  working days stay explicitly open-ended; capital cost using this minimum wait
  is labeled as potentially higher.
- Capital cost is (max(raw proceeds, 0) + grading fee + submission shipping)
  × annual rate × calendar days / 365. Rate defaults to 0 (off); enabling it
  requires complete cost and time assumptions.

Missing, invalid, negative, nonfinite or ineligible inputs withhold affected
calculations and show the reason in the collapsed row. Expanded rows remain
open while inputs change. State is memory-only, bounded, and scoped by user,
card/analysis identity and grader. Empty/failed guide requests still leave
functional grader selection and clearly unavailable values.

Published fee snapshots expire after 14 days and then withhold fee estimates.
To refresh, verify the official sources, update checkedAt and tier records in
js/grading-paths.js, and run node tools/build-grading-paths.mjs. Automated rate
refresh is not part of this change. Legacy ladder code remains as a fallback
when the module is unavailable; its historic comments describe that fallback.

## Verification and release

Required gate: CR_CHROMIUM=<binary> node tests/grading-paths-browser.mjs.
It covers the actual mapped API fields, selected-grader price isolation,
per-grade fee eligibility and arithmetic, invalid inputs, blank-vs-zero costs,
expired rates, shared production fee engine, missing comps, mobile overflow,
PSA-only AI labeling and state separation. All external requests are blocked.
The grade-result, grading-fee, identity, asset-fingerprint, registry and build
checks provide focused regression coverage. No paid grade scans are performed.

Official sources checked October 12, 2026:
- https://www.psacard.com/services/tradingcardgrading
- https://www.cgccards.com/submit/services-fees/cgc-grading/
- https://www.cgccards.com/card-grading/grading-scale/
- https://www.pricecharting.com/api-documentation
- https://maintenance.beckett.com/
- https://beckett.jotform.com/form/beckett-card-grading-submission
- https://www.gosgc.com/card-grading/services-pricing

This document records implementation, not a production deployment claim.
Existing advertising backup, commercial-data-rights and cost gates still apply.

Continuation verification: the original 322 focused checks passed again.
Review then found the legacy Vercel build/route list omitted the new CSS folder;
added a static build entry and a fingerprinted CSS route before the HTML fallback.
Three deployment-configuration checks now guard this failure (325 total checks).
The API field mappings and PSA/CGC fee snapshot were rechecked against their
official documentation. PriceCharting's public API documentation also requires
an express commercial agreement for customer-facing data; confirm account rights
alongside the existing TCG Price Lookup permission gate before paid advertising.

Owner correction, October 12 at 11:30 ET: all four graders must calculate the
fee without a required cost box. The browser/economics gate now passes 88 checks,
including automatic BGS/SGC defaults, visible collapsed fees, SGC thresholds,
PSA variable fees, CGC value-based fees and no manual fee entry. The same tested
core/API mapping is retained; the comparison module and fingerprint are updated.
The current user screenshot shows the older production UI, not this PR.

Bulk action follow-up: Create Listing Drafts now sits beside Add to Collection
in both the initial footer and the completion/reset template. Compare selling
moves into More actions. Draft-limit feedback remains visible beneath the
primary row. Selection, draft creation and comparison handlers are unchanged.
The selling-plan browser suite passes 186 checks at 320, 390, 844 and 1280px;
asset fingerprints pass 115 checks and the release build inspector passes.
