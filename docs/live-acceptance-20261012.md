# Live acceptance — 2026-10-12 UTC

Production tested: https://www.cardresell.org, commit
`dd378d99b30d7e5b99dd6908f7fb537f8af7373e`, deployment
`dpl_A567eBgFS72UAMPMJKQTJkGKW1AP` (READY).

## Results

| Flow | Observed result |
| --- | --- |
| Public API boundary smoke | 18 checks: 17 passed, 1 degraded, 0 failed. Exit 2 intentionally distinguishes provider degradation from success. |
| eBay sold comps | HTTP 200 with `available:false`, `reason:provider_unavailable`, no items. Data availability did not pass. UI offered an external sold-comps research link. |
| Exact card lookup | Selected Minun 194/182, SV04: Paradox Rift; market value displayed as $44.80. Broad Charizard query correctly refused to guess a printing. |
| Sign-in | Authorized separate test account restored successfully. |
| Collection save | Added one clearly labeled QA fixture; UI reported saved to account. Fixture remained after full reload and after returning from checkout. Existing card was not modified. This does not independently prove cross-device persistence or raw database contents. |
| Collection to draft | **Failed on production** with `MUTATION_FIELD_UNDECLARED:draft-create:titleDropped`; no draft created. |
| Credit checkout | Shop opened Stripe Checkout showing 25 ID credits for $2.99. Returned without payment; displayed credit balances remained unchanged. Payment fulfillment and webhook delivery were not tested. |

The public smoke also checked anonymous authorization, the membership catalogue,
legacy checkout fences and rejection of unsupported resolver destinations. It
does not send fake card-miss telemetry or create authenticated records.

## Draft failure and proposed fix

When the title builder removes an optional segment to meet the venue's title
limit, `normalizeCreateInput` emits `titleDropped`. The strict idempotency field
classifier did not declare this server-derived diagnostic, rejecting its own
normalized request before creating the draft. Add it to the derived-field set.
The final title and price still participate in mutation identity; unknown fields
are still rejected.

A regression through the actual HTTP handler reproduced four failed checks
before the fix. After the fix, creation succeeds, identical retries replay the
same draft, changed-price retries conflict and only one draft is stored.

Local validation on the foundation checkout:

- Draft CRUD: 246 checks passed, 0 failed.
- Draft index recovery: 265 checks passed, 0 failed.
- Listing usage: 139 checks passed, 0 failed.
- Configured build passed; seven smoke-classifier negative/positive checks passed.

These are 650 targeted checks, not a rerun of the entire repository suite.
The hotfix is based on the tested production commit. Deployment and live
retesting are pending; local success must not be reported as a production fix.

## Test residue and remaining acceptance

One fixture remains in the separate test account:
`QA live test 20261012 — Minun 194/182`, purchase cost $0.01. It is synthetic
test data and affects that account's Collection totals. No existing cards were
deleted, no marketplace listing was published, no subscription was changed and
no payment was submitted.

After deploying the hotfix, create a draft from that fixture, reload and confirm
the same draft persists. Check retry behavior without creating duplicates.
Keep real payment completion/webhook reconciliation, physical-phone camera
capture and concurrent real-store acceptance as separate outstanding gates.
Restore eBay sold-comps availability before advertising dependable automatic
sold-price coverage. The live draft failure blocks claiming the full
Collection-to-draft workflow is ready.
