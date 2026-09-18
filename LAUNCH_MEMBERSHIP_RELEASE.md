# CardResell launch membership restructure

## Release status

Implementation in progress, not activated. Baseline is Production billing repair
`0d4c1570350f93c158758d5d938e8a7044ff6225`. Work branch is
`feature/launch-membership-v2`. The initial configuration module is deliberately
not imported by live handlers yet.

Owner authorization covers application changes, Stripe catalogue creation, test
environment verification, and tested live activation/deployment. It does not
authorize charging the owner's payment method, purchasing a subscription on the
owner's behalf, or publishing marketplace listings.

## Authoritative contract

`api/_launchMembershipConfig.js` records exact launch prices, allowances, decimal
storage limits, pack discounts, and credit costs. There are no annual launch
plans, no monthly export quota, and no customer-facing monthly upload-GB quota.
Configuration tests cover every tier and all 35 tier/pack price combinations.

Free credits are one-time welcome grants, never reissued after cancellation,
downgrade or resubscription. Paid included credits replenish once per successfully
paid subscription period and do not roll over. Purchased ID and Grade balances
are distinct, never expire, and are consumed after included credits. Refunds
restore the correct source balance under the established operation policy.

Paid plan changes take effect next renewal; cancellation retains benefits through
paid-through date. Existing active subscriptions require a specific migration
decision, not automatic remapping from old tier names.

The owner confirmed the sole active legacy $9.99/month subscription is theirs and
authorized migration to new Casual $9.99 at the October 7, 2026 renewal
(12:21:56 PM EDT / 16:21:56 UTC). No immediate charge or midperiod allowance grant
is authorized. This resolves the migration decision, not the implementation or
test gates. Preserve purchased credits and billing history.

## Listing and photo invariants

- Atomically enforce active-held and successfully-created-per-period counts.
- Archive/delete releases an active slot, never a creation allowance.
- Edit/export/re-export/restore is not creation; restore still needs active room.
- Duplication is new creation and must not copy seller photos.
- Paid creation periods follow billing periods; Free periods are UTC months.
- Preserve existing work above a downgraded limit; only block new additions.
- Count all retained owned versions and derivatives, excluding shared catalogue.
- Archive does not release storage; deletion releases bytes only after physical
  deletion and confirmation no record still requires the object.
- Replacement seller photos must appear in later exports.
- Same physical card's unchanged export may reuse its hosted files.
- At storage cap preserve viewing, download and export.
- Safe orphan cleanup must not delete objects used by active or archived work.

## Product scope and experience

Audit real UI and server enforcement before advertising. A listing means a
CardResell draft/prepared listing, not a marketplace publication. Export means
listing-data export. Preserve marketplace access pending the access audit.
Do not add unsupported saved grading reports, binder scans, dealer analytics,
bulk editing, or templates from earlier brainstorming.

Normal account/shop UI must show plan/status, paid-through and scheduled-change
dates, separate included/purchased ID and Grade balances, active/creation/storage
meters, reset dates and advance warnings, discounted pack prices, and working
subscription management. Use confirmed current data, not UI-only entitlement
gates. Do not build another authentication harness.

Direct support must use only the owner-provided number and the exact configured
response-within-24-hours wording. Missing contact information blocks advertising
a working direct-contact action, not permission to invent one.

## Payment, migration and security gates

- Inventory live/test products, prices, subscriptions, checkout routes, webhooks,
  balances and special/internal entitlements before migration.
- Verify zero paying subscribers; if not zero, preserve billing and request the
  specific migration decision.
- Preserve transaction history and purchased credits. Version new catalogue
  entries and archive obsolete purchase paths only after replacement verification.
- Derive identity, pack, eligible tier, discount and price server-side.
- Verify webhook signatures and payment status. Atomically couple credit grants
  to durable business-operation idempotency, not only event identifiers.
- Handle delayed/out-of-order events, failed payment/recovery, refund, dispute,
  and cancellation without erasing unrelated balances.
- Preserve receipt-aware atomic scan/confirmation/replay protections.
- Reuse the managed 7/7 evidence only for unchanged underlying billing code.
- Keep temporary acceptance routes, workers and isolated Preview fences out of
  the release. Do not modify old acceptance controls or prior evidence.
- Preserve rollback and verify intended Production configuration and endpoints.

## Required validation

Use Stripe test environment for every tier, pack and discount; successful payment
and duplicate events; exactly-once renewal; failed payment and recovery;
cancellation/scheduled changes; purchased-credit preservation. Test quota edges,
concurrent listing creation, photo replacement/deletion/accounting, over-limit
downgrades, and existing normal authentication/scanning/export behavior.

Measure representative listing creation, photo processing, scanning/grading and
export costs plus file/batch/concurrency/rate limits. Deletion must not reset
traffic counters. Disclose missing measurements and material sustainability
concerns before activation; never silently alter owner prices or allowances.

## Completion package

Provide exact tier/pack tables, available/new/deferred feature inventory, commits,
deployment provenance, Stripe product/price mappings, tests and untested cases,
migration/rollback notes, measured costs and assumptions, release blockers, and
verified data-preservation status. Include one short normal-site owner checklist.

Scanner/grader improvements and the full new-set catalogue gap audit remain queued
after this restructure.
