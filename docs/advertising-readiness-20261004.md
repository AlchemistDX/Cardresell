# Current checkpoint — October 5, 2026

Roughly 75% of the bounded advertising-readiness effort, not the complete master plan. This section supersedes historical pending deployment and webhook notes below.

- Live source 1f2c260e95f25d1e42ea316873b34a8c63d84f84; Production dpl_2S1rpBae3f2iC5iw4VLQrJz22XxH READY. Browser loaded membership-shop.e910cd18.js and rendered all five plans.
- Both paid-invoice events delivered; last authenticated balance 53 ID / 5 Grade, with cancellation scheduled at the paid-through boundary.
- Current/legacy marketplace access mapping implemented, tested and live. Starter's two unlocked venues and current CASUAL/PRO upgrade badges accepted live.
- Funnel update: 176 Shop identity/telemetry checks, 99 asset checks and 224 copy checks pass. Production /api/events POSTs returned 200; no 5xx in the short post-deploy query. This does not independently prove counter persistence or accurate revenue measurement.
- The browser restarted during deployment; final storefront acceptance was signed out. Do not claim a fresh authenticated balance check for the telemetry-only deploy.
- Next owner-dependent acceptance: a genuinely new CardResell account and verified email, admitted through the normal pilot path. Do not merge, reset or rebind either existing owner account, and do not ask for another purchase. User must select an accessible, unused email and complete its verification normally.
- Still outstanding: acquisition attribution, provider cost and reliability evidence, and limited public admission. Listing/storage and bulk-grade capability rollouts remain separate and are not advertised as included operational benefits.

---

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

## Follow-up — October 5, 2026

Both events for the paid Starter invoice now report pending_webhooks=0. A fresh live reload retains 53 ID / 5 Grade; no duplicate allowance appeared. Dashboard sign-in is no longer needed for this retry acceptance.

This release adds a server-owned marketplace comparison bundle separate from billing amounts and bulk grading: Free/Starter 2 (eBay + TCGplayer), Casual up to 9, Pro/Business up to 15. Legacy Pro retains 9; legacy Pro Max/Ultimate retain 15. Availability varies by card game and selected selling venues. The browser consumes the server's bundle without reinterpreting new plan names as old ones, and drops mismatched identity/plan snapshots. Current plan labels, Shop disclosures and generated public pricing agree. Listing/storage rollout and bulk-grade capability rollout are unchanged and remain separate checks.

Validation: 32 new current/legacy venue checks; catalogue 52, Shop identity 164, normal membership routes 71, asset fingerprints 99, auth integrity 96, entitlement regression 78, copy truth 224. All 38 focused membership gate invocations passed across the final run and one targeted rerun: ID-confirmation initially could not write its historical output path, then completed 365/0 after restoring that scratch directory. Test registry passes 12/0, now also registering the two existing scan recovery suites. No further real purchase was made. Production acceptance follows publication.

Production deployment dpl_7BWsYgSUbRAJ9d4TWmjjKeoTDu3Q reached READY with source d535da00d07b9bdac84a9c657acfc779cc703009. Live acceptance loaded core.9e2db59c.js and membership-shop.a174cdfd.js: Starter current, expected two unlocked venues, 53 ID / 5 Grade retained, scheduled cancellation preserved. Public /pricing shows the same five plans and marketplace counts, with pilot eligibility disclosed. Venue picker acceptance exposed one remaining presentation mismatch: old PRO/PRO MAX badges. Follow-up relabels those CASUAL/PRO to match current purchasable plans; entitlement behavior is unchanged.

Production badge follow-up dpl_3CEvwYug1ZiFCkmGYziFrzkXp8Jc (e7be23bb5df1eac5b6c0c533e3b36722492ec16e) is READY; live venue picker now labels the current purchasable minimum plans CASUAL/PRO.

The membership storefront previously bypassed the legacy checkout telemetry calls. This follow-up adds best-effort shop-open, attempt, pending, failure, Stripe-redirect and server-verified-return observations to the existing first-party event endpoint. No UID, email, token, Stripe session ID or error message is sent in these events. URL parameters alone never report fulfillment; repeated verification of the same returned session is suppressed within the retained browser history (bounded to 20 entries). These client observations are NOT authoritative revenue or deduplicated transaction totals across browsers; use Stripe and the fulfillment ledger for financial reporting. The shop identity suite passes 176 checks including telemetry failure isolation and pending/expired/fulfilled returns.

Scope audit: LISTING_USAGE_V2 was absent from retrieved project environment metadata; photo policy is explicitly dormant and lacks an atomic byte-reservation integration. Do not advertise these allowances as operational. Bulk grading still requires a separate authoritative capability rollout. Public admission remains pilot-only, and acquisition attribution plus provider cost measurement are still outstanding before spending on ads.

Fresh-account acceptance began with `willsep23@gmail.com` after adding that address to the Production pilot. Email/password account creation succeeded. The UI reported that a Firebase verification link was sent, but delivery was not established; the user later reported no email received. The Cloudflare Turnstile widget then failed in the OpenAI cloud browser with client code 600010 before `/api/verify-claim-firebase` was called; Vercel showed no matching function request. Cloudflare documents 600-family errors as retryable generic challenge failures caused by bot detection. This is not evidence of a CardResell API failure or a bad site-key/domain configuration.

The recovery follow-up keeps Turnstile and the server-side fail-closed check intact, adds explicit error/timeout/expiry handling to both verification interfaces, prevents tokenless claim requests, and gives the visitor a retry plus browser/VPN/extension guidance instead of an uncaught widget exception. Local validation: Firebase claim 10/0, launch/deeplink 187/0, plus syntax checks for the unchanged known-good browser assets. The fresh account's one-time issuance still requires live acceptance from a browser that Cloudflare accepts; do not mark public admission complete from the cloud-browser failure.

## Email delivery correction — October 5, 2026

The user reports no verification email received at the fresh test address. Code review found `_fbSendVerification` resolved `{ok:false}` on provider errors while callers treated any resolution as success. The auth helper now rejects send failures, exposes a safe error on signup, and only retries without the return URL for continue-URL errors. The signup view no longer claims an email was sent unconditionally. Resend remains configured in code with its test sender; broad recipient delivery is not accepted. Firebase acceptance does not establish inbox delivery. Live fresh-account verification and one-time credits remain blocked.


## Fresh account and automatic setup — October 5, 2026

Production pilot configuration was repaired after fixed-category diagnostics identified invalid serialized runtime configuration. The verified Google account willsep205@gmail.com then completed manual account association on Production. User screenshots show 15 ID / 2 Grade, and the user confirms this balance persists after refresh. These totals match the 5/1 monthly allowance plus the one-time 10/1 welcome allocation. This supersedes the earlier fresh-account blocker for Google sign-in; email/password inbox delivery remains unaccepted.

This follow-up starts normal server account association automatically after verified sign-in and after email verification is observed. It first reads account state, associates only missing/pending customers, and checks balances again before reporting readiness. Existing paid accounts take a read-only path. Concurrent triggers share a promise; identity changes invalidate work; interrupted requests expose an inline retry below the header. No Shop modal is opened by automatic setup. The existing server authentication, pilot eligibility, identity bindings and idempotent grant logic are unchanged. Public admission is still pilot-only.

Validation before publication: storefront identity/recovery 195 checks, auth integrity 96, fingerprints 99, account routes 27, purchase routes 52, verification-send regression passed. The additional Redis-backed enrollment flow suite could not start because redis-server is absent in this execution environment; no server enrollment code changed. Automatic first-sign-in acceptance must still be confirmed on the live site with a fresh eligible account; existing-account refresh cannot prove that first-run mutation.
