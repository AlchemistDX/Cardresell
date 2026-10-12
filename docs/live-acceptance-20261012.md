# Live acceptance — 2026-10-12 UTC

## Release and live retest completed

The owner approved deployment after reviewing PR #34. That PR merged as
`a1bff81eb6a1d4ba8912e6aec7235eed9c037f79`; its tree exactly matches the
650-check hotfix tree (`73b07b11162767c4310a079cc0081a617ea202a3`). A production
build, `dpl_2FouFFnqpuDEA3gkoLrPRF1NCfqu`, reached READY and was assigned to
both cardresell.org and www.cardresell.org. Build logs report 32 seconds;
building-to-ready was approximately 42 seconds. No credentials or environment
settings were changed.

Live browser retest on the authorized separate account:

- Collection -> Prepare draft succeeded: "1 draft ready."
- Review showed the shortened title, $44.80 price and an explicit note that
  rarity was omitted to fit the title limit.
- Full reload, restored sign-in and reopening Drafts showed 1 / 25 drafts.
- Preparing the same Collection fixture again showed "Saved draft recovered."
  Draft count remained one, with 24 slots available.
- Credit balances remained unchanged. No payment, subscription change or
  marketplace listing was submitted.
- One QA Collection fixture and its one QA draft remain for follow-up testing.

Post-deployment public smoke: 18 checks, 17 passed, 1 degraded, 0 failed.
The remaining degraded result is the eBay sold-comps provider. The runtime
error-level sample contained six Node `url.parse()` deprecation warnings,
not six failed requests; no application exception appeared in that sample.
This is a short observation window, not a claim of zero production errors.

The reported deployment-failure email could not be matched directly without
reading the email. The newest ERROR deployment found was an older production
attempt (`dpl_6WWzGQd8ZzLBkxwuJuX98fefJqDu`, commit `616d6ce`), reporting
`git_info_fail` before build logs. All six latest deployments inspected before
release were READY. The approved new production deployment succeeded.

Remaining acceptance: completed payment/webhook reconciliation, physical-phone
camera capture, independent cross-device persistence and concurrent real-store
testing. Follow up on navigation restoration: a Collection click made during
post-reload account/card restoration returned to Lookup; clicking Collection
again after restoration worked. Also review the "Ready to list" label when a
draft has no seller photos and incomplete price-source/shipping provenance.
Neither observation was changed by this narrowly scoped server fix.

The remainder records the pre-deployment findings and local fix verification.

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
