# Single-owner membership transition

This is the bounded transition for the existing owner subscription, not a historical migration engine. All issued credits remain permanent. The implementation must not be described as a completed managed import or a completed Stripe transaction merely because its local suites pass.

## Deployment and authority

- The operator executable is `tools/transition-membership-owner.mjs`. Its default `inspect` action is read-only. It is not exposed as an HTTP endpoint.
- `apply` and `schedule` require Production, the expected Stripe account, the exact armed deployment commit, purchasing disabled, and a recorded completed Production backup plus observed old-credential rejection. These evidence fields are operator attestations of external observations, not substitutes for performing those checks.
- Production database: `upstash-kv-bistre-arrow`, resource `dc621a30-497c-4851-a3c3-42a51309f094`. Preview resource `b0de2137-6c5c-41b4-8af4-da80a70ce1c3` is not an acceptable Production backup.
- Preserve the completed provider backup before retiring old credentials. Pause owner scans and old webhook delivery during the cutover; reconcile any in-flight scan/payment before importing. Record rejected old-deployment authorization, then install the nonexpiring fence and exact cutover receipt through the executable. Do not infer rejection from a variable label.
- Put replacement datastore bindings only in their intended environment. Rebuild the release and rollback candidates with the replacement credentials. An old candidate containing revoked credentials is not a usable rollback.
- The optional `MEMBERSHIP_OWNER_READ_ONLY_INSPECT=enabled` build flag runs only canonical reads. The normal build hook performs no import or scheduling.

## Import

`node tools/transition-membership-owner.mjs inspect` verifies the actual legacy subscription, period and account record without writes. `apply` installs the writer fence and then uses an atomic compare-and-set import; an incomplete result is reconciled by rerunning the same armed operation, never by deleting its receipt.

Standing ID/Grade balances, legacy account JSON, welcome markers, old usage counters and unrelated records remain byte-identical. The import indexes the remaining existing current-calendar-month allowance using the actual legacy tier and actual underscore-form monthly counters. This is an existing allowance, not a new Casual grant. Unknown legacy tiers or malformed counters fail closed. No prior months or unrecorded awards are inferred.

The imported owner cannot create a second Stripe customer or subscription. Existing customer binding is immutable and canonical. The internal legacy plan is consumption-only; its explicit discount continuity mapping is not a promise of new feature capabilities.

## Renewal transition

The authorized legacy boundary is `1791390116` (October 7, 2026 at 16:21:56 UTC). Both import and scheduling require canonical Stripe readback to match the saved customer, subscription, old price, product and period. If any has changed, stop and reconcile; do not move the date to make the script succeed.

After import and live-path readiness, `schedule` uses the saved operation identity, no proration and no immediate allowance. It must read back the schedule before reporting confirmation. Canonically paid Casual invoices add 50 ID and 15 Grade exactly once through the existing financial ledger. Duplicate invoice events and return recovery share that financial authority. Failed invoices add nothing; later paid recovery may grant once.

Preserve permanent balances after cancellation and use Stripe Customer Portal for payment-method repair, invoice history and cancellation at period end. Arbitrary plan-change controls remain disabled. Imported-owner refund/dispute provenance uses the audited subscription origin, not an invented Checkout session; issued credits are not clawed back.

## Runtime controls and rollback

- `MEMBERSHIP_BILLING_V2=on` requires the durable writer fence. Turning it off does not reopen legacy writers.
- `MEMBERSHIP_PURCHASE_LIVE_MODE=enabled` admits new purchases.
- `MEMBERSHIP_SERVICING_LIVE_MODE=enabled` keeps account, webhook and uncertain-purchase recovery paths available when new purchases are paused.
- `MEMBERSHIP_LIVE_AUDIENCE=owner` is the default. The one configured owner remains reserved for audited import. `public` additionally permits authenticated new-customer enrollment, but never bypasses a legacy subscription or missing owner import.
- Purchase pause allows canonical recovery of an already claimed Checkout operation; it cannot start another payment attempt.

Rollback means deploying the same ledger-compatible code with new purchases disabled and servicing enabled, using the current datastore bindings. Preserve the fence, journals, import, terms, customer associations and Stripe records. Never restore the old pre-ledger build as a financial writer. A database restore after financial activity requires reconciliation, not overwriting current journals with an older backup.

Before public activation, record the exact deployment ID, replacement-credential readback, import result, schedule result, webhook configuration and the normal owner transaction result separately. A Ready deployment or configuration preflight is not a purchase PASS.

## Validation boundaries

Private-Redis and synthetic-Stripe suites cover import replay, concurrent import, lost acknowledgments, source-change rejection, preserved serialization, legacy allocation consumption/refund, first Casual renewal addition, signed lifecycle recovery and purchase pause. Actual Firebase sign-in, actual owner import, real Checkout, actual webhook delivery and actual scheduled renewal each require separate managed evidence. Do not mark unexecuted cases PASS.
