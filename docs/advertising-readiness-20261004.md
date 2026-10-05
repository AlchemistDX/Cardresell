# Advertising-readiness checkpoint — 2026-10-04 23:25 Eastern

## Scope and estimate

Approximately 70% of the bounded advertising-readiness effort, a qualitative planning estimate rather than a measured percentage or completion of the whole master plan. Public admission remains gated. Live acceptance only; do not use Preview for owner acceptance.

## Verified live on willsep200@gmail.com

- One $2.99 completed checkout purchased one 25-ID pack. Reloaded account: 3 included ID + 25 purchased ID = 28; Grade 0.
- One $4.99 Starter subscription checkout paid. Reloaded account: 28 included ID + 25 purchased ID = 53; Grade 5.
- Customer-portal cancellation scheduled for the paid-through boundary, November 4, 2026, 21:35:16 America/New_York. Stripe uses cancel_at=1793846116; cancel_at_period_end=false does not negate this timestamp. Subscription remains active through the boundary. All 53 ID / 5 Grade remain available.
- The original willsep202 account was not modified by these tests.
- iPhone Quick Grade delivered Seize the Spoils and charged one Grade credit. This does not validate grade accuracy or probability calibration.
- Opaque scanner panel and Close control verified on Production deployment dpl_JE4rZZyx34TTRVWaSsNCndmepoDK, source 4396e122bcfc0795e4bc60ea3a393abf6b72743b.

## Remaining webhook acceptance

Same paid Starter invoice in_1UN1kGFW2YZoedIZk3pugoJH has invoice.payment_succeeded event evt_1UN1kNFW2YZoedIZbpwwJeGB delivered (pending_webhooks=0), while invoice.paid evt_1UN1kMFW2YZoedIZJTVuM8qZ remains pending (1). Checkout completion and cancellation update delivered. Early Production logs show two 503 attempts followed by success. Do not call the complete webhook flow clean or infer the cause from generic error logging. Inspect/resend this existing event through Stripe's normal dashboard, then verify no extra allowance and no pending delivery. Connector exposes event reads but no resend operation; dashboard currently requires secure sign-in. Do not create another payment or fabricate a signed webhook.

## Plan-access audit findings

- Server membership balance route returns launch-v2 tiers Free/Starter/Casual/Pro/Business.
- Shipped core platformsForTier still recognizes only old pro/pro_max/ultimate names. Casual and Business fall through to Free venues; new Pro is interpreted as old Pro. Starter venue intent is not established in the approved billing-only integration.
- Existing docs/membership-integration.md explicitly narrowed that integration to credits/prices/lifecycle and excluded new marketplace capabilities, storage enforcement and listing quotas. Do not describe these exclusions as completed features or silently invent a capability mapping.
- LAUNCH_PLANS contains approved listing/storage quantities; separate _listingUsage and _membershipPhotoPolicy implementations exist. Verify deployed rollout flags and normal-route enforcement before claiming those benefits.
- Bulk-grade client still checks old tier names while server consumes authoritative enrollment capabilities. Audit this separately; do not bypass a null/denied server capability with a frontend tier rename.

## Next work

1. Close duplicate invoice delivery through real Stripe retry and preserved balances.
2. Establish one explicit, version-aware capability contract; reconcile frontend and server enforcement, preserve legacy owners, and verify Starter plus remaining plans.
3. Confirm normal listing/storage rollout or clearly scope public offers to what is available.
4. Finish mobile conversion flow, conversion/cost measurement, provider reliability and limited public admission before advertising scale.

No additional owner purchase is needed. Do not claim end-of-period expiry, future renewal, plan switching, all-tier discounts or advertising readiness from this acceptance.
