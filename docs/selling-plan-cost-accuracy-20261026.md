# Batch selling cost accuracy — October 26, 2026

The seller selects physical cards, compares selling options, adjusts assumptions, and continues to draft review. This release keeps incomplete or selection-specific costs from becoming confident after-cost estimates.

## Reproduced problems

- A Collection selection with one unknown purchase cost and one $20 cost showed a complete $20 total and dollar-valued after-cost proceeds.
- Clearing postage was interpreted as zero and retained all payout recommendations.
- A manually entered $60 purchase total remained after removing a card from the selection.
- Scan planning allocated pack cost only to identified cards, while Collection reserves a share for unresolved copies and retains an allocation frozen by an earlier save.

## Changes

- Missing purchase costs remain unknown. A visible notice reports the number of missing copies and the known subtotal; after-cost cells say `Cost unknown`. Estimated proceeds before acquisition cost remain available.
- An explicit zero remains a known cost. Clearing a known total retracts after-cost figures.
- Changing the selected cards clears a manually entered total. The seller can enter the new total or explicitly restore the selected saved costs. Changing only an asking price preserves the purchase total.
- Blank or invalid shipping charges and postage retract both payout tables and recommendation quotes. Fields expose their invalid state. Draft review remains available and uses the existing review flow.
- Pack-cost allocation now reserves unresolved copies' shares and respects an allocation frozen by Collection. A blank optional pack cost stays unknown in this planner; an explicitly entered zero remains known.
- The cost notice is readable in both themes. The planner remains usable at 320, 390 and 1280px; other mobile layout checks include landscape.

The planner remains read-only: its estimate edits do not rewrite Collection, scan prices, or draft prices. Draft review retains the selected physical-copy identities and its existing confirmation step.

## Verification

All 16 focused suites passed. These include selling next step (237 checks), selling planner (210), selling advice (65), selected price/condition handoff (150), asking-range workflow (180), quick pricing (235), price evidence (42), eBay buyer-tax assumptions (75), bulk venues (80), draft-selection handoff (62), entry identity (139), listing export (111), listing photos (171), brand/UI (978), asset fingerprints (272), and test registry (12). The configured build inspection and whitespace check passed. Logs and asset hashes are recorded in `selling-plan-cost-accuracy-20261026.json`.

The first release run exposed two test-fixture problems. The inventory-ID source check mistook an existing optional-chained price-choice lookup for an inventory lookup; an exact reviewed exception was added while preserving the inventory checks. The welcome-control test raced the timed example-card tour; the fixture now marks that tour as already seen before exercising the controls. Final runs passed. Screenshot review also caught low contrast in the new notice; the final browser run measures at least 4.5:1 in both themes.

## Limits

External services and accounts are controlled fixtures. No customer inventory, credit balance, marketplace listing, or payment was changed by testing. This is a focused release run, not another complete 165-suite site audit.

Shipping still starts with explicitly displayed zero assumptions and must be entered realistically. Existing saved zero acquisition costs are treated as known; this change cannot distinguish a historical unknown previously stored as zero. Recognition accuracy, fee schedules, recent sold-data access, direct publishing and sales synchronization are unchanged.
