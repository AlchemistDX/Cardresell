# Grading fee, wait and cost visibility

The calculator already had selectable tiers, working-day/month estimates and optional submission expenses. This change makes those assumptions visible before the outcome comparison.

- A prominent service summary shows each eligible tier actually used by the priced outcomes, with per-card fee and estimated wait. Automatic selection can use multiple tiers for different guide values; they remain distinct.
- Missing submission and sale shipping are named outside the collapsed details. Add shipping costs opens and focuses the first missing amount. Explicit zeros count as entered; optional zero costs remain excluded.
- Raw and graded scenarios follow the controls. Source links clearly describe a dated snapshot, not a live quote.
- Existing fee schedules, freshness cutoff, shared eBay fee calculations and conditional-outcome semantics are unchanged. No expected-value claim uses uncalibrated AI weights.

Validation: 104 grading browser/math checks, including differing automatic tiers, unavailable tiers, stale snapshots, cost-coverage updates and keyboard focus. Mobile screenshot inspected at 390px with no horizontal overflow. Asset fingerprint and registry checks, production build inspection and diff whitespace check pass.

Official fee data remains the October 12 snapshot documented in grading-path-comparison-20261012.md. PSA and CGC published pages were rechecked during this work; no fee changes were needed. SGC was not independently re-extracted in this pass, so no additional freshness claim is made.

Production verification must compare the served index and new hashed grading JS/CSS to this tested tree. Local UI checks block external provider calls; they do not constitute a signed-in production transaction.
