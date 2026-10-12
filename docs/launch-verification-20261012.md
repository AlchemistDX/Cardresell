# Launch verification continuation — October 12, 2026 (New York)

## Findings and completed work

### Pricing-provider limits and costs

Read production configuration metadata and only the non-secret TPL budget
values. Enforcement is enabled (`TPL_BUDGET_ENFORCE=1`), aggregate allowance
is 400 upstream requests per aligned 3,600-second window, and the secondary
per-IP allowance is 60 per window. The budget suite passed 101 checks,
including reservation/concurrency and fail-closed behavior. No limit changed.

This allows at most 9,600 reservations across 24 aligned hourly windows through
this proxy. It is not a dollar ceiling, a measured daily usage figure, or a
cap on another application using the same provider account. It does not prove
the account's purchased plan or commercial rights.

TCG Price Lookup's dashboard requires sign-in in the available browser. Its
published pricing and FAQ conflict on commercial plan names, rates and legacy
rights (sources in `launch-status-20261012.md`). Confirm the actual subscription,
commercial display/cache rights, reset time, hard/soft quota and invoices from
the authenticated dashboard or vendor confirmation before approving this gate.
OpenAI/Ximilar invoice reconciliation is also outstanding. The existing
`tools/provider-usage-report.mjs` explicitly reports unknown dollar cost rather
than converting incomplete logs into an invoice or a profit claim.

### Hosted storage and recovery

Vercel confirms an Upstash Marketplace installation and reports $0.21 of
installation-level usage spending for October 1–31 as of October 12, 06:03 UTC.
This spans three resources, is a current usage estimate rather than a finalized
invoice, and does not identify which resource is the production ledger.

The available Vercel connector does not expose backup/restore operations.
Looking up the provider resource ID through the Vercel store endpoint returned
404; a provider resource ID is not established as a Vercel store ID. The Upstash
console requires sign-in. No backup availability, retention or successful
restore has been established. No live database was exported or overwritten.

After authenticated access: identify the production database from its project
connection; record backup timestamp/retention; choose an empty, isolated target
with no application connections; restore there; compare ledger/binding,
Collection, draft, deletion-marker and TTL invariants; measure the recovery
window. Upstash documents that a restore deletes the target database's existing
contents. Never use production as the drill target. Any additional paid resource
requires a concrete cost decision before creation.

Source: https://upstash.com/docs/redis/features/backup

### Campaign-to-payment measurement

Read-only Stripe inspection used the connected CardResell live account. A sample
of the latest 30 Checkout Sessions contained 11 launch-v2 sessions, of which four
were complete/paid totaling $14.71 USD. None of those 11 had campaign metadata.
The response had more pages; this is not an all-time sales total, net revenue,
customer count, fulfillment audit, or proof that these were acquired customers.
Historical campaign attribution cannot be reconstructed from absent labels.

The concrete code gap was that campaign labels reached browser events but not
checkout requests or Stripe. This release fixes that:

- The storefront snapshots the same bounded channel used by funnel events.
- The server persists it once alongside the checkout operation. Changing the
  label on a retry cannot rewrite it or trigger a second Stripe creation.
- Stripe Checkout Session metadata records `acquisition_campaign` and the
  explicit client-reported attribution model. Raw URLs, advertising IDs and
  arbitrary text do not become metadata; unknown labels are bounded.
- Existing clients/operations remain compatible. Missing attribution is
  `unknown`, not an invented `direct` visit. Recovery leaves old records intact.
- Campaign metadata never authorizes identity, prices, discounts or credits.
  Server-verified payments and durable grant receipts still own fulfillment.
- Analytics failure cannot block checkout. Existing subscription styling is
  retained and its canonical CSS source is synchronized so rebuilding does not
  silently drop it.

This enables checkout-cohort reconciliation for future initial purchases; it
does not attribute subscription renewal revenue or prove incremental ad impact.
Browser event counts remain observations, not unique customers or revenue.

## Verification

2,079 targeted checks passed: acquisition 23, storefront identity 240, checkout
controller 338, Stripe checkout transport 567, purchase routes 52, payment
adapter 625, fulfillment 12, TPL budget 101, asset fingerprints 109, registry 12.
The build inspector passed. Tests use synthetic provider responses and isolated
process-owned Redis; they are not hosted backup or payment acceptance evidence.

The initial storefront run lacked the existing test runtime's Acorn dependency;
switching to that runtime resolved it. Request-shape assertions then correctly
identified the new optional campaign field; they were updated to require that
bounded context while still excluding every financial/ownership field. All
affected suites passed after the correction.

## Next acceptance steps

1. On the deployed release, enter with `cr_campaign=qa`, open a new checkout,
   inspect its Stripe metadata and verify amount/currency/customer association
   through the existing server path. Do not pay merely to test attribution.
2. For a subsequent owner-authorized payment, match the session's immutable
   intent to the binding store, its PaymentIntent (pack) or initial paid invoice
   (subscription), and the durable grant receipt. Exclude open/unpaid/expired
   sessions and separately track refunds/disputes. A browser success event or
   paid Stripe status alone is not proof of delivered credits.
3. Preserve QA as its own channel and exclude it from advertising conversion
   reporting. Record report period, pagination coverage, unknown attribution,
   currency, gross payments and reversals separately.

Provider account sign-in and hosted recovery evidence remain blocking for those
specific checks. No commercial plan, spend limit, backup policy, security
setting, payment or email was changed by this continuation.
