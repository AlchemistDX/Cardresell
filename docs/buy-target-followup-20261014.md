# Custom buy target and review reconciliation

Baseline: release `9861ed9ccde32043d4e02b1c2bf34be7e39769e7`.

## Delivered

The existing fixed 20%/30%/40% maximum-buy estimates now share a custom target-margin control. The default is 25%; preset buttons remain available. The selected valid target survives calculator recalculation within the current page session. It is not a saved account preference.

Maximum purchase price = estimated net payout − item sale price × target margin. Margin is profit divided by item sale price, not ROI on purchase cost. Offers round down to whole cents. Empty or out-of-range margins show no offer, and an impossible target is explicitly identified rather than clamped to a misleading $0 offer. The current eligible, ranked, fresh-fee venue set supplies the payout; stale-fee venues do not supply a buy target. Existing fee arithmetic and paid-plan access are unchanged.

The panel explains that purchase tax, grading costs and unmodelled marketplace tax fees may reduce profit. It is a scenario based on the displayed price, not a guarantee of sale proceeds. The newsletter panel now describes product news and selling tips and has an accessible email label; it no longer promises price-drop or market alerts. No subscription was submitted.

## Reconciliation of external suggestions

- Max-buy estimates, purchase-cost/profit/ROI calculations, seller profiles, funnel instrumentation and bulk scanning already exist. This release improves the existing buy target instead of duplicating it.
- Public purchasing admission was already opened, and PR #71 removed the retired pilot-only pricing copy. No new paid transaction was run here.
- PR #71 aligned 15 ranked venues plus 3 bulk workflows, corrected source attribution, moved technical history to `/changelog`, and refreshed five fee-source dates. Cardmarket and CoolStuffInc still need current confirmation.
- Independent ID/grade accuracy metrics require held-out labelled card evidence. No rates, grades or customer testimonials have been invented.
- Reliable sold-comp access, a real eBay import acceptance report, price-triggered alerts, offline scan queueing and automated sales import remain separate work. UI tests or static public-page reviews do not establish those capabilities.

## Verification

The release PR records full local regression and production checks. Targeted tests include the actual maximum-offer arithmetic, forward margin checks, invalid/impossible values, preset selection, retained targets after shipping changes, stale-fee exclusion, and phone/desktop layouts in both themes.
