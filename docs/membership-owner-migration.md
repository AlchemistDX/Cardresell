# Single-owner migration implementation

This module is an executable **test-only library**, not a live migration or a configured runtime route. It is limited to one server-authorized owner, existing Stripe customer and existing subscription, moving from a canonical USD 9.99 monthly legacy price to Casual at the verified period end.

## Contract

`createMembershipOwnerMigration` receives server-owned `authorization`, immutable customer association, fixed-account Stripe transport, canonical launch price mapping, private datastore execution and the existing financial fulfillment callback. Never construct authorization from browser parameters, email, Stripe metadata or an inferred old tier.

Authorization fields are `owner`, `customerId`, `subscriptionId`, `priceId`, `productId`, `periodStart`, `periodEnd`, `evidenceId` and `approvedAt`. Times are epoch seconds. `evidenceId` must identify actual audited ownership/authorization evidence; the module does not generate that evidence or claim a backup/writer drain occurred.

Configure the dedicated lifecycle transport with `legacySubscription`, consisting of the same first seven fields. Its legacy exception is limited to that exact subscription/customer/period/price/product. It validates the old and target prices and only permits a Casual plan-change command for the authorized owner.

The library exposes:

- `schedule({owner})`: verifies ownership and canonical legacy state, records immutable preparation under the writer fence, executes the existing durable schedule transport and records confirmation only after canonical schedule readback. The old price and paid-through interval remain unchanged. The new phase starts exactly at the boundary with no proration. No subscription is created and no credits are granted.
- `invoiceRecovery({invoiceId, authenticatedOwner})`: invokes the existing canonical paid-invoice verifier, persists a finite authorized Casual term, then verifies again and delivers through the existing invoice grant journal.
- `webhook({rawBody, signature})`: uses the existing exact-raw-body verifier and canonical invoice validation. This entry accepts only the fixed migration's paid subscription invoice, not pack fulfillment or arbitrary lifecycle events.

Term authority is a real migration record, not a fabricated Checkout origin. An invoice before the authorized boundary, a future period, failed payment, wrong owner/customer, unexpected price/product or malformed authority is rejected. Historic records and standing balances are not copied, relabeled, expired or overwritten.

## Recovery and limits

The existing transport claims before each schedule POST and does not reset unknown claims. A lost update acknowledgment is recoverable from canonical schedule readback without another POST. A lost create acknowledgment remains pending, with no automatic re-creation; controlled canonical schedule-origin recovery is still needed for that case.

Confirmed authority and finite terms are byte-CAS protected. The existing financial ledger provides exactly-once invoice grants and retains permanent credits. A lost financial acknowledgment replays the original grant, not another allowance.

Managed runtime composition remains pending: supply the actual audited test-owner authorization/customer binding and enrollment; route that fixed subscription's invoices to this adapter; expose its safe account state while preventing a second paid Checkout. The current general purchase runtime does not import this library, so this commit cannot silently activate or schedule a migration.

The broader normal webhook dispatcher must continue handling status, cancellation and refund/dispute observations for the migrated subscription. The library alone is not proof that those routes are composed.

Live mode is refused. Real Stripe test-clock migration, managed enrollment, webhook delivery and owner live scheduling remain UNRUN. Do not treat the previously discussed October 7 date as freshly verified; retrieve the actual live renewal boundary before any eventual live scheduling.

## Local verification

`node tools/check-membership-owner-migration.mjs` runs 20 scenarios using actual private Redis, synthetic Stripe transport responses, the real HMAC verifier and unchanged payment/ledger modules. Coverage includes authority/customer/price/boundary rejection, missing fence, no midperiod grant, no proration, preserved historical counters, schedule readback, response loss, signed duplicate/concurrent invoices, first Casual 50 ID + 15 Grade grant, failed-payment recovery and cross-account rejection.

This check is registered in `tools/run-membership-gate.sh`. It is synthetic evidence, not normal-site or real Stripe acceptance.
