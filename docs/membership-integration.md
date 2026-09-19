# CardResell tiers and packs implementation

## Release status

The local implementation now connects customer association, checkout creation and return recovery, signed webhook fulfillment, subscription invoice reconciliation, next-renewal commands, and the normal shop/account UI. All credits remain permanent. This is a tested, dormant, test-mode implementation, not a completed Production release.

Production activation is refused by the runtime. No live payment, subscription change, migration, push, or Production deployment occurred. Real Stripe test-mode acceptance remains **UNRUN** because access is unavailable; no reconnection was attempted. The private pricing preview is read-only and cannot accept purchases.

Some requested paths remain incomplete, not merely untested: executable legacy-origin migration, cancellation of an existing schedule, customer-facing failed-payment repair, and audited enrollment/bootstrap. These are listed explicitly below. This package is a consolidated implementation checkpoint, not a claim that all requested lifecycle work is finished.

## Catalogue and permanent credits

| Plan | USD/month | ID/month | Grade/month | Pack discount |
|---|---:|---:|---:|---:|
| Free | $0 | 5 | 1 | None |
| Starter | $4.99 | 25 | 5 | None |
| Casual | $9.99 | 50 | 15 | 10% |
| Pro | $19.99 | 250 | 40 | 15% |
| Business | $49.99 | 1,000 | 100 | 25% |

Free verification separately awards a one-time 10 ID + 1 Grade welcome bonus. Included allocations remain spendable after their issuance period; oldest included allocations are consumed first, then welcome, then purchased credits. Refunds restore the exact source allocations. Cancellation or failed renewal does not expire existing credits.

| Pack | Free/Starter | Casual | Pro | Business |
|---|---:|---:|---:|---:|
| 25 ID | $2.99 | $2.69 | $2.54 | $2.24 |
| 100 ID | $9.99 | $8.99 | $8.49 | $7.49 |
| 500 ID | $29.99 | $26.99 | $25.49 | $22.49 |
| 1,000 ID | $49.99 | $44.99 | $42.49 | $37.49 |
| 10 Grade | $5.99 | $5.39 | $5.09 | $4.49 |
| 25 Grade | $12.99 | $11.69 | $11.04 | $9.74 |
| 50 Grade | $22.99 | $20.69 | $19.54 | $17.24 |

The server catalogue is authoritative. No new marketplace capabilities, storage enforcement, or listing quotas were added to this narrowed integration.

## Implemented application paths

- **Customer association:** immutable bidirectional ownership; explicit audited owner allowlist; creation claim before Stripe POST; stable idempotency; no email matching. Unknown creation outcomes do not automatically repeat POST. Actual request credentials are checked against the canonical account.
- **Checkout:** durable server-owned orders, fixed Preview return origin, canonical price/product/customer/account/mode validation, bounded discovery, stable per-owner operation identity, and uncertain-result recovery.
- **Return fulfillment:** authenticated owner-bound canonical retrieval. Pack return and webhook share a PaymentIntent grant identity. Subscription return validates its invoice, creates only an authorized finite term, and reconciles the same invoice grant as webhooks.
- **Signed webhooks:** bounded exact-byte body verification before parsing, canonical retrieval, no early legacy processed marker, and retriable service responses for unresolved reconciliation. Read-only reconciliation retries fence stale readers; they do not restart uncertain financial commands.
- **Renewals:** canonical paid-invoice validation against saved subscription origins and historically authorized terms. Duplicate/concurrent events and lost committed responses replay without additional grants.
- **Plan changes:** durable next-renewal commands, no proration, canonical target-price validation, schedule readback checks, and no claim of confirmation merely because an intent was stored.
- **Cancellation and failed-payment state:** canonical status reconciliation and period-end cancellation for supported unscheduled subscriptions. A later valid paid invoice can recover from failed-payment state without expiring old balances.
- **Refunds and disputes:** canonical provenance-bound observations and exact-origin late-grant holds. Holds execute inside grant Lua, preventing new issuance after a hold; existing grant journals still replay. Issued credits are never clawed back or guessed. These events enter review, not automatic adjudication.
- **Enrollment reconciliation:** already-audited enrollment is reconciled after paid grant with exact-byte CAS. Large integers, empty arrays, capabilities, and optional paid `freeThrough` remain intact. A failure here does not mean the earlier financial grant failed; retry replays the grant then retries reconciliation.
- **Shop/account UI:** five-tier comparison, seven packs, source-separated balances, status/boundary display, pending/confirmed plan commands, association, refresh, cancellation, and authenticated return verification. Matching confirmed operation IDs retire saved commands after lost responses. SDK and facade identity must remain the same through token acquisition, requests, and redirect.
- **Asset integration:** the shop uses a content-addressed shipped script and inline CSS, preserving existing caching/first-paint conventions. Pricing metadata and existing Manage billing guidance are restored.

New routes are `/api/membership-catalogue`, `/api/membership-checkout`, `/api/membership-account`, `/api/membership-return`, and `/api/membership-webhook`. The new webhook route must be configured explicitly in test mode; it does not silently replace the legacy endpoint.

## Configuration and prerequisites

Use an isolated non-Production Preview and a dedicated test datastore. Financial consumption keys are not a substitute for infrastructure-level test/live isolation.

- `MEMBERSHIP_PURCHASE_TEST_MODE=enabled`; `VERCEL_ENV=production` is explicitly rejected.
- Dedicated `MEMBERSHIP_STRIPE_TEST_KEY`, `MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET`, and `MEMBERSHIP_STRIPE_TEST_ACCOUNT`.
- `MEMBERSHIP_STRIPE_TEST_PRICES` and `MEMBERSHIP_STRIPE_TEST_COUPONS`.
- Fixed `MEMBERSHIP_STRIPE_TEST_RETURN_ORIGIN`, excluding the Production origins.
- Explicit `MEMBERSHIP_TEST_NEW_CUSTOMER_OWNERS` allowlist.
- Audited consumption enrollment, sticky legacy-writer fence, complete allocation authority, and isolated Redis configuration.

`stripe-test-mapping.json` is imported from the supplied catalogue. Its IDs and amounts have offline validation, not independent real Stripe acceptance. Missing enrollment/balance authority blocks checkout even for an allowlisted new customer.

## Exact local test results

Command: `bash tools/run-membership-gate.sh <external-evidence-directory>`.

Tests use synthetic Stripe HTTP, signed synthetic events, and private local Redis. They are not evidence of real Stripe API compatibility or actual customer sign-in.

| Suite | Passed | Failed |
|---|---:|---:|
| membership-customer | 18 | 0 |
| membership-lifecycle | 187 | 0 |
| membership-lifecycle-stripe | 17 | 0 |
| membership-reversal-stripe | 88 | 0 |
| membership-account-routes | 16 | 0 |
| membership-fulfillment | 12 | 0 |
| membership-paid-enrollment | 14 | 0 |
| membership-consumption | 119 | 0 |
| membership-ledger | 281 | 0 |
| membership-payments | 625 | 0 |
| membership-bindings | 284 | 0 |
| membership-stripe | 246 | 0 |
| membership-checkout | 313 | 0 |
| membership-checkout-stripe | 519 | 0 |
| membership-purchase-routes | 52 | 0 |
| membership-shop-identity | 25 | 0 |
| membership-routes | 55 | 0 |
| membership-scan-intent | 70 | 0 |
| launch-membership-config | 82 | 0 |
| test-registry | 12 | 0 |
| test-scan | 36 | 0 |
| webhook-p0-offline | 4 | 0 |
| id-confirmation-atomic | 365 | 0 |
| entitlements-2026-09-04 | 72 | 0 |
| sol-remediation-2026-09-04 | 63 | 0 |
| **Total** | **3,575** | **0** |

The full repository command `bash tests/run-all.sh --local` also passes. Its 69-slot runner explicitly skips real-store, Production smoke, and optional condition-pill browser checks; those skips are not passes. Do not add full-gate counts to the table above because suites overlap.

The initial full-gate failure log is preserved. It exposed missing pricing metadata, an external stylesheet/unhashed script, and obsolete six-pack/annual/Pro Max catalogue assertions. Application regressions were fixed; only retired catalogue-specific assertions were revised. The final full-gate log is included.

Independent review also passed enrollment preservation/concurrency probes, canonical reversal provenance, signed-webhook recovery, grant/hold ordering, customer account checks, and UI identity/command-recovery cases. Detailed verdicts and hashes are included under `reviews/`.

Signed-out normal-site browser checks covered the visible shop entry, five tiers, seven packs, disabled purchase controls, close/Escape, desktop/mobile layout, and dark mode with external requests blocked. Signed-in controls have synthetic DOM tests only. Real Firebase sign-in, Stripe Checkout, and full normal-browser lifecycle acceptance remain unrun.

## Migration behavior

No live migration ran. Existing balances, journals, drafts, photos, billing records, and payment methods were not altered. Unknown historical origin must remain unknown; do not relabel retained credits or fabricate past usage.

The owner authorized the legacy $9.99 subscription to move to Casual $9.99 at the October 7, 2026 renewal, without immediate charge or mid-period grant. The implemented legacy entry point is an audited Preview-only staging record. It deliberately does not invent checkout lineage, import the live subscription, create terms, or schedule a real change.

**The October 7 migration is not scheduled.** Completing it requires a separately authoritative legacy-origin binding, canonical renewal boundary verification, transport execution/readback, and real test-mode coverage before any live scheduling. A local authorization record is not a Stripe schedule.

Free monthly issuance for inactive accounts still needs an authoritative scheduler/backfill policy. Pre-index allocations require provenance-based migration. Preserve `freeThrough` on Free-to-paid transitions; existing paid records may legitimately omit it. The allocation history is bounded at 1,200 entries and needs provenance-preserving compaction before that bound is reached.

## Unresolved implementation and acceptance gates

- **Legacy migration:** executable trusted-origin import and actual schedule are unfinished.
- **Existing schedules:** cancellation of an already-attached schedule and replacement of a pending plan-change command deliberately refuse and require reconciliation. Ordinary supported period-end cancellation is implemented.
- **Payment repair:** failure/status and successful-payment recovery are integrated, but a new customer-facing payment-method repair/portal path is not implemented.
- **Enrollment/cutover:** the paid bridge does not create missing historical authority. Global all-owner enrollment, old-request draining, and incompatible-deployment fencing remain operational prerequisites.
- **Unknown customer creation:** durable pending state is safe, but automated canonical discovery for this case is not complete; trusted recovery must not reset the claim.
- **Reversal adjudication:** unsupported provenance enters explicit review. Holds are sticky; automatic hold release, refund adjudication, and clawback are not implemented.
- **API/provider validation:** real Dahlia invoice, creation, coupon, schedule, refund/dispute, pagination, and managed Redis behavior remain unverified.
- **Normal browser:** complete authenticated end-to-end acceptance remains unrun. Client scan-operation tokens remain a separate broader cutover limitation.

## Rollback procedure

The release record identifies the local commit and base `2e227909b2163c61da39a7cee0d03e39e1aa37dc`. The final patch includes earlier uncommitted billing work as well as this continuation; it does not imply every line was authored in this final pass. No push was performed.

Before any activation, retain the commit, exact deployment IDs, environment configuration, schema manifests, and datastore backup. Keep purchase/test endpoints disabled outside isolated acceptance.

For the current dormant release, revert the feature commit in a clean branch if needed; do not reset a shared worktree. Do not delete historical evidence or datastore records.

After future enrollment, disabling a UI flag is not a rollback of financial authority. Stop new mutations, drain in-flight requests, retain the sticky legacy fence and versioned journals, and deploy a fence-aware compatible build. Never restore unconditional legacy writers or reset unknown commands. Reconcile canonical outcomes before retrying. Post-activation rollback has not been exercised.

## Shortest normal-browser acceptance checklist

Use the actual normal site, Firebase sign-in, isolated datastore, and real Stripe test mode after the unfinished prerequisites are addressed.

1. Sign in; confirm all five tiers, seven pack prices/discounts, permanent-credit copy, and source-separated balances. Switch accounts during token/checkout/return handling and confirm isolation.
2. Buy a pack and subscription; interrupt the return, retry it, and deliver duplicate/concurrent signed webhooks. Confirm exactly one grant for each payment/invoice.
3. Advance a test renewal; exercise failed payment then recovery and repeated invoice events. Confirm exactly one new allocation, with prior credits preserved.
4. Schedule upgrade/downgrade, lose command responses, refresh, and verify canonical next-boundary terms with no immediate charge/grant. Test cancellation, including attached-schedule handling once implemented.
5. Refund/dispute before and after fulfillment; verify canonical ownership, atomic late-grant hold, unchanged issued credits, and visible review state.
6. Rehearse the legacy-to-Casual transition at a test renewal. Confirm no mid-period grant or immediate charge, then verify normal ID/Grade consumption and exact-source refunds.

Production must remain disabled until pack purchases and subscription lifecycle events demonstrate exactly-once grants through this complete normal-site flow.
