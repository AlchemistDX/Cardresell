# CardResell Membership MVP Release Status

Checkpoint: September 19, 2026. This is a blocked release record, not launch approval.

## Local implementation

Base commit: `d2c5412cb33faec17e27b7172205857adc38bffc`.

This checkpoint removes card-only Checkout configuration in favor of configured dynamic payment methods, adds authenticated Stripe Customer Portal sessions, requires a safe Portal configuration, and hides arbitrary subscription schedule changes in the launch runtime.

Portal configuration must enable payment-method updates, invoice history, and cancellation at period end. Subscription updates must be disabled. The server selects the customer, configuration, return origin, prices, quantities, and discounts. The permanent-credit ledger and consumption modules are unchanged by this checkpoint.

## Automated verification

- Focused gate: 25 suites, 3,590 passed, zero failed.
- Complete local regression command: `bash tests/run-all.sh --local`; final result `ALL CHECKS PASSED`.
- The complete runner has 69 slots. Real-store tests, Production endpoint smoke, and optional condition-applicability browser interaction were skipped, not passed.
- Asset generation: `node tools/build-membership-assets.mjs`.
- Served shop asset: `js/membership-shop.1296cfa2.js`.
- Whitespace/error check: `git diff --check` passed.

Focused results and full logs are preserved outside the repository in the release evidence package. Synthetic HTTP/private Redis tests do not establish real Stripe or managed-datastore acceptance.

## External acceptance and deployment

No Preview or Production deployment was made for this checkpoint. No live catalogue, financial transaction, migration schedule, or webhook endpoint was created.

Stripe Sandbox authorization failed. No automatic retry is permitted. Only the live account was available through the connector. Existing Vercel environment names were inspected, but isolated Preview datastore identity was not verified and no membership test credentials or Portal configuration were found.

All 15 requested real acceptance cases remain UNRUN: normal authenticated catalogue/discount display; ID pack; return/webhook replay; Grade pack; four mapped subscription prices; initial invoice; renewal; failed renewal/recovery; cancellation; uncertain Checkout recovery; account switching; duplicate/concurrent signed webhooks; refund/dispute; legacy-to-Casual rehearsal; and normal ID/Quick/Deep consumption with exact-source refunds.

Owner low-value live purchase: UNRUN. October 7 Casual migration: NOT SCHEDULED.

## Implemented event handling, not configured endpoint

The code handles:

- `checkout.session.completed`, `checkout.session.async_payment_succeeded`
- `invoice.paid`, `invoice.payment_succeeded`
- `invoice.payment_failed`, `invoice.payment_action_required`
- `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
- `charge.refunded`
- `refund.created`, `refund.updated`, `refund.failed`
- `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`

The final endpoint subscription list must be verified during test-mode configuration. This list is not evidence of a configured Stripe endpoint.

## Release blockers

- Executable, audited enrollment/bootstrap for new and returning accounts without guessing historical balance provenance.
- Controlled trusted binding and test rehearsal for the single owner legacy subscription.
- Global old-writer draining and durable financial writer fencing before enrollment/cutover.
- Runtime live-mode support with strict environment/account/catalogue separation; current transport/runtime intentionally refuse Production/test-mode crossover.
- Isolated Preview datastore, test credentials, signing secret, trusted Preview origin, and safe Portal configuration.
- Normal Firebase sign-in and all real Stripe test-mode acceptance.
- Live catalogue, restricted credentials, Production webhook verification, backup, rollback build verification, and controlled live acceptance.

## Rollback constraints

No rollback deployment has been created or verified. Do not deploy the older base as a financial rollback after enrollment merely because it is a known commit.

On rollout failure, disable new purchases while preserving journals, source allocations, customer bindings, operation claims, and Stripe records. Drain in-flight writers. Reconcile uncertain operations through canonical readback rather than resetting claims. A compatible rollback must preserve sticky enrollment and the new writer fence; it must not restore unconditional legacy writes. Verify that build against a backup in isolation before activation.

## Deferred scope

Storage/listing quotas, photo accounting, universal migration, custom payment-method management, automatic clawbacks, arbitrary schedule replacement, advanced dealer features, and annual subscriptions remain outside this release.
