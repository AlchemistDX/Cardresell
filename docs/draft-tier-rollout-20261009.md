# Draft tier rollout — October 9, 2026

## Implemented offer

| Plan | Saved drafts at once | Bulk draft preparation per action |
|---|---:|---:|
| Free | 5 | Individual only |
| Starter | 25 | 10 |
| Casual | 100 | 25 |
| Pro | 500 | 100 |
| Business | 2,000 | 500 |

There is no monthly draft-creation meter and no additional scan-credit debit for draft preparation. These bulk limits concern already identified cards, not batch photo grading. Reports retain the separate 500-report limit. Prices, monthly credit amounts and pack discounts are unchanged.

## Preservation and authority

Draft creation resolves the current paid-through plan from the membership ledger, not request body or browser state. A future scheduled plan is not current authority. Legacy non-membership deployments retain their prior 500/500 behavior. Audited imported legacy memberships retain their existing 500-draft and bulk capacity until their normal plan authority takes over; the public ladder describes launch memberships.

Existing drafts are preserved on rollout, cancellation and downgrade. Over-cap accounts can read, edit, copy/export and delete; only additional creation is refused. Deletion frees capacity. A completed request replays before new admission checks, including during a billing-authority outage.

The permanent capacity set is separate from the expiring discovery index. Its initial baseline enumerates primary records; unreadable or incomplete scans fail closed. Creation commits the record, lifecycle pointer and capacity membership in one fenced Lua operation. Refused admission writes no draft or lifecycle reservation. Concurrent writers cannot share the last slot. Every subsequent fenced edit/delete maintains capacity membership. Count/set disagreement fails closed instead of inventing free space. Old missing/deleted records can be pruned using authoritative reads. Reads remain usable if membership usage is unavailable.

Bulk selection is prepared as an owner-bound, immutable 24-hour manifest of instance and idempotency identities, validated against server-resolved limits. Per-card saves validate membership and selection again. Bulk UI preserves selected cards on refusal and binds the operation to the starting signed-in account. Individual create remains available on all tiers; bulk preparation is a convenience entitlement, not a prohibition on a user individually preparing multiple drafts.

The existing LISTING_USAGE_V2 schema migration remains off and unchanged. It is a separate dormant subsystem with its own bootstrap and monthly-creation design; do not enable it as part of this rollout.

## Upgrade path

Eligible normal monthly subscriptions can choose another plan in Subscriptions. The screen shows the new monthly price and renewal date before confirmation. The existing scheduling transport uses no proration and requires Stripe readback before confirmation; paid invoices and webhooks retain entitlement authority. Current benefits and issued credits remain through the existing period. Pending changes preserve their operation identity for retry. Cancellation stays available through Billing.

Imported owner subscriptions retain their audited migration/billing path and are explicitly excluded from normal self-service scheduling. This release does not silently convert that subscription, create replacement subscriptions, charge a live account or expose immediate midperiod upgrades. Public pilot/admission restrictions remain unchanged.

## Verification

- Real isolated Redis: 69 checks, including every tier, twenty concurrent writers competing for one slot, 2,000-record pagination, retry at capacity, refusal then successful same-key retry after deletion, lost save responses, downgrade preservation, membership outages, seed corruption, owner separation, bulk boundaries, real ledger plan resolution and HTTP rejection of forged tier/cap fields.
- Existing draft cap suite: 130; draft CRUD: 239. Fixtures now use a synthetic Upstash-shaped host and body-form command parsing so the production membership resolver can run without bypassing its transport checks.
- Membership lifecycle: 187; Stripe lifecycle transport: 23; account routes: 30; storefront: 207; purchase routes: 52. Synthetic provider replies and private Redis only; no new live charge or real renewal scheduled.
- Browser: 642 checks across four viewport sizes and both themes, including tier disclosures, usage/over-cap UI, Free bulk refusal preserving selection and paid bulk manifest wiring. The mobile subscription screenshot was inspected.
- Copy truth: 224; asset fingerprints: 107; release inspector and diff checks pass.

A deployed-code verification is not physical-phone camera acceptance, a real subscription renewal, a complete provider/catalog audit or permission to start ad spending. Those existing launch conditions remain separate.
