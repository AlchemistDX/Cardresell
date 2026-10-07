## 2026-10-07: physical-phone camera regression and mitigation

Owner screenshots IMG_4541/4542/4543 show the soft warning on a small card,
but a visibly defocused close-up received a green guide. Owner also reports
that the zoom slider freezes the camera. Focus-hint acceptance FAILED; a
warning appearing once does not validate discrimination. No paid scan is
needed to reproduce either preview problem.

Mitigation: shared camera zoom is disabled on iPhone/iPad (including desktop-mode
iPadOS); other devices serialize and coalesce hardware changes, preserve existing
constraints, handle rejections, and disable controls after a 2-second timeout.
Late completions cannot change UI or apply queued zoom after teardown.
The live capture guide never uses a green pass: no warning means a neutral
manual readability check. Unknown focus gets an explicit advisory; low-score
advice no longer always says move back. Unknown scores clear previous metadata.
The sharpness algorithm/threshold remains provisional and is NOT claimed fixed.
No account, billing, grade, or image-resolution changes in this patch.

Local validation: photo-capture-lifecycle 17/0 (including zoom regression cases),
grade-capture-resolution 28/0, decoder fallback 10/0 and retake history 8/0,
asset fingerprints 99/0, mobile accessibility 178/0, test registry 12/0;
new bundle syntax and git diff checks passed. Physical iPhone acceptance is pending.
The handoff's shortened a11y-mobile test filename did not exist; the actual
registered a11y-mobile-2026-09-04.mjs passed.
Readiness stays approximately 85%; pilot stays on.

# Current checkpoint — October 6, 2026, 13:00 Eastern

Roughly 85% of the bounded advertising-readiness effort, a qualitative estimate, not the complete master plan. The increase rests on live acceptance evidence (below), not on deployed instrumentation. Public advertising is still not ready: public admission is pilot-only and email/password verification delivery is unaccepted.

Closed since the Oct 5 checkpoint (all Production, live accounts):
- Provider measurement accepted live for every paid operation: ID (Ximilar tcg_id ~1.7–1.9 s, incl. a low-confidence miss with refund), Quick Grade (gpt-6.1-sol, ~$0.016–0.017 OpenAI; latency not recorded), Deep Grade (gpt-6.1-sol ~$0.025 + Ximilar async grader, ~37 s). Ximilar billed credits are not reported by the API and stay unknown, not zero; reconcile with the Ximilar invoice.
- Deep Grade CV was broken: Ximilar retired the sync grader endpoint. Migrated to the async job API; live result shows CV-verified (dpl_Dk5KUHsraiJsJoG3MrrTJEF1Hq3t onward).
- Grading honesty: poor visibility/plastic lowers confidence, not the grade; labels and limiting factor follow the final grade; "Measured" only for CV values. Discrimination check passed live (clean vs crumpled/bent cards: 9 vs 2, 7 vs 3). Not calibration.
- Wrong grading-upside price (name-only PriceCharting match) fixed; name-only TCG matches no longer "exact".
- Free-user "Out of ID credits" toast fixed.
- Daily welcome-award circuit breaker (default 200/day, deferred not denied) live — prerequisite for public admission.
- Business plan 750 ID live.

Still open before paid advertising:
1. Public admission switch (MEMBERSHIP_LIVE_AUDIENCE=public) — owner decision; breaker now in place.
2. Email/password verification delivery to a real inbox (Firebase native mail and/or Resend verified sender domain) — unaccepted.
3. Deep Grade fallback policy when Ximilar fails (refund 1 credit vs disclose) — owner decision.
4. Ad copy must not claim calibrated grading accuracy or precise "pixel-measured" centering: same card measured T/B 66/34 vs 60/40 across sessions from 1000 px photos.
5. Recommended, not blocking: higher-resolution grading capture (needs direct upload; 4.5 MB body limit), Ximilar invoice reconciliation, eBay sold comps remain blank (public API shut down).

## Email/password fresh-account acceptance — October 7, 2026, 00:02 Eastern

Pilot list (sensitive env, JSON, 5 max) now: willsep200, willsep923 (new, replaced willsep23 with owner approval; willsep23 balances untouched but not admitted), willsep205, cartoonclipscentral23, wljones9322@eagle.fgcu.edu. Rebuilt Production dpl_8yT8LUYznB3ySuPy2Vn3hdcBbjZe (source 8e21efd); homepage byte-identical.

- Gmail inbox delivery: owner screenshot shows "Verify your email for CardResell" from noreply@cardresell-e0329.firebaseapp.com labelled Inbox (not Spam) at 23:15, for a new email/password Gmail account.
- First run (willsep923, 04:02Z): GET membership-account 401 email_not_verified_password (stale pre-link token) → verify-send Resend 403 test-sender restriction → Firebase link fallback → GET 200 → single POST 200 association → GET 200. Settings screenshot: verified email, 15 ID / 2 Grade, no Shop opened. Exactly one association request in the window.
- School account (wljones9322, 02:59Z): automatic first association GET 200 → POST 200 → GET 200 without the Shop; that account was already verified, so its inbox delivery is not established.
- Minor: before first association, /api/pro-status and /api/scan-credits return 503 billing_unavailable for an unenrolled verified/unverified account; it should report setup-needed, not outage. Self-resolves after association; not changed.

Email/password verification delivery (Gmail) and fresh-account first-run grant are now accepted live. Outlook/school junk placement remains unmeasured.

## Owner decisions and follow-up — October 6, 2026, 16:30 Eastern

Owner policy (2026-10-06): Deep Grade whose CV step does not complete is billed as a Quick Grade (1 credit, 1 refunded) only when a usable assessment completes, clearly labelled; no usable assessment refunds both; never silently charge for unavailable CV. Keep pilot restriction until email path and this policy are accepted live. Ads describe identification and photo-based condition estimates; "CV-verified" means the CV step completed, not that the grade is proven. OpenAI readings are partial cost; Ximilar charges must be reconciled before setting an ad budget. Photo downscaling is a candidate, not established, cause of centering inconsistency.

Shipped: source 8e21efd, Production dpl_EomqWYvHkC2rWZZZePXCjjQxzWVd (live homepage and core.806406cb.js byte-identical; scan GET 405, unauthenticated POST 401). The 2-credit ledger operation is refunded exactly and a new 1-credit operation is debited under the same scan id; failure/uncertainty on that debit leaves the user uncharged. CV completion no longer raises "low" confidence to "medium". Deep Grade picker and result badge wording narrowed. Validation on private Redis: membership-routes 80/0 (CV complete = 2; CV failed = 1 charged + 1 refunded, ledger refunded/debited records; CV disabled = 1; no assessment = both back), test-scan 37/0 (legacy counters), membership-consumption 119/0, membership-ledger 281/0, id-confirmation-atomic 365/0, membership-scan-intent 70/0. Not tested: uncertain second-debit branch. Live acceptance of a CV-failed Deep Grade has not occurred (cannot be induced safely in Production).

Email path trace: every non-owner verification email is Firebase native. Signup calls sendEmailVerification; the six-digit "Send code" route uses Resend's test sender onboarding@resend.dev, which Production logs show returning 403 "testing emails only to your own email" for other recipients (7 requests on Oct 5), after which the client falls back to the Firebase link. The Resend key is accepted at runtime. www.cardresell.org is an authorized Firebase domain.

Inbox acceptance (non-Gmail disposable inbox, 2026-10-06): Firebase signUp + VERIFY_EMAIL with the production continue URL delivered in 5–6 s from noreply@cardresell-e0329.firebaseapp.com; the link verified the account; with a fresh token /api/membership-account moved from 401 authentication_required to 403 membership_access_restricted (pilot gate). Two throwaway Firebase Auth users were created for this test; neither is pilot-listed or holds credits. Gmail/Outlook spam placement is not established. Defect: the email subject/sign-off read "project-107816299392" because the Firebase public-facing project name is unset — fix in Firebase console. A pilot-listed fresh email/password first-run grant is still not accepted live. Update 22:35 EDT: owner set the public-facing name on cardresell-e0329; re-test delivered in 6 s with subject "Verify your email for CardResell" and sign-off "Your CardResell team" (third throwaway user, no pilot access). A second Firebase project, cardresell-37512, exists in the owner's console but is not referenced anywhere in the repository or its history.

---

# Current checkpoint — October 5, 2026, 16:50 Eastern

Roughly 80% of the bounded advertising-readiness effort, a qualitative estimate, not the complete master plan. Public advertising is not yet ready: public admission, email/password delivery, and provider cost/reliability acceptance remain open.

- Google onboarding accepted on Production dpl_GF6UXwwpK7ju9oX96z5SyyiT4CwU, source a7fade9f1d21b82dfee7533a3885caadda7814c1. User screenshot IMG_4458(1) at 16:49 shows cartoonclipscentral23@gmail.com verified, 15 ID / 2 Grade, and no setup warning. The requested path was refresh then Settings without Shop. Correlated live logs at 20:49:43–44Z show GET account 200 → POST account 200 → GET account 200. This establishes successful automatic first association on the new account. Repeat-refresh non-duplication for this account is not independently established yet; willsep205's earlier refresh was accepted.
- Paid pack, Starter subscription, duplicate webhook delivery and scheduled cancellation were accepted earlier on willsep200 with 53 ID / 5 Grade retained. Original willsep202 bindings remain unchanged.
- Current/legacy marketplace access mapping is live. Listing/storage and bulk-grade rollouts remain separate and are not advertised as operational benefits.
- Acquisition channel tracking is live on production dpl_EZm6HTbDHZtfebunw3JsSDRkisnM (source 1a6cca8). The live homepage matched the release, one telemetry_check/qa event returned recorded:true, and the unauthenticated campaign report returned 403. This is storage acknowledgment, not a retrieved aggregate or revenue attribution.
- Next blockers: normal email/password verification delivery, provider cost/reliability measurement, and limited public admission. Google onboarding success does not establish non-Gmail or email/password acceptance.

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


## Verification-state recovery — October 5, 2026, 12:34 EDT

The user's Safari screenshot for willsep23 shows the unverified banner and unavailable balances. It does not prove that Google sign-in completed; the earlier email/password session may have been restored. No membership-account request appeared in the scoped Production logs for the preceding 15 minutes. Automatic first-sign-in acceptance is still outstanding.

Review found the new browser helper skipped its server check when the local Firebase emailVerified hint was false. The follow-up checks every authenticated identity with the existing server authenticator; no association is sent unless that check succeeds. This honors existing server-owned verification without trusting a provider name or changing authentication policy. A server verify_email response now exposes Verify email and Sign in with Google beside the header. Settings replaces the obsolete Open Shop instruction with the relevant verification/setup recovery, preserving all confirmed numeric balances. Server-verified completion through the older email flow resumes setup on the next credit refresh.

Validation: storefront identity and recovery 201/0, auth integrity 96/0, fingerprints 99/0. Server authentication/enrollment, pilot admission, customer binding and grant logic are unchanged.


## Google sign-in recovery — October 5, 2026

User confirms cartoonclipscentral23 used Sign in with Google. Production requests at 18:08:15Z, 18:08:17Z and 18:08:35Z returned membership-account 401 with MEMBERSHIP_AUTH_REJECTED email_not_verified. This establishes the server rejection category, but the old diagnostic did not identify the signed-in provider. Do not infer that the user chose password sign-in.

Review identified independent recovery faults: the home Google helper swallowed popup errors, and /signin swallowed popup-closed-by-user then proceeded to flush/redirect the previous session. Both helpers now require a Google UserCredential for the current UID, reload its profile, and force a signed-token refresh with the Google sign-in provider before continuing. Home reloads through the normal auth/account setup path so same-UID sign-ins cannot depend solely on an auth-state callback. Home exposes safe popup/network errors; /signin cancellation reaches its existing visible error path and never redirects. Account-switch races stop completion.

Server rejection diagnostics distinguish fixed google/password/other provider categories after signature verification. No email, UID, token, provider payload or raw error is logged. Verification, pilot admission, credits and customer binding policy are unchanged. Actual first-login acceptance remains pending until the user completes the updated live Google flow.

Validation: Google recovery 38/0, membership authentication 34/0, auth integrity 96/0, asset fingerprints 99/0, storefront identity 201/0, deep links 187/0, verification-email send regression passed.

### Google-provider verification repair (2026-10-05, 20:37Z acceptance failure)

User screenshot IMG_4457 still shows verification-required after Google sign-in. Production deployment dpl_9TWfxR2qAwNXaHFGJBPfQLshaitZ logged membership-account 401 at 20:37:22Z with email_not_verified_google. This confirms a signed Google session, not a password session or merely a swallowed popup. The prior refresh fix did not close fresh-account acceptance.

The shared verifier now supplements an absent/false primary verification flag only for a current, signature-verified Google session. It calls Firebase accounts.lookup using that same token, requires exactly the signed Firebase UID, an enabled account, an unrevoked issued-at, and exactly one Google provider whose rawId matches the signed Google identity. Only that provider's Gmail address is accepted, and any present primary/token email must match. Google is authoritative for Gmail according to https://firebase.google.com/docs/auth/users#verified_email_addresses and https://developers.google.com/identity/gsi/web/guides/verify-google-id-token. Non-Gmail, merely linked Google identities, password/custom sessions, ambiguous records and lookup failures do not gain verification. No Firebase profile or verification override is written; the verified identity retains its original UID. Existing automatic setup and pro-status receive the server-confirmed result. No credit amounts, billing bindings, pilot scope, or anti-bot configuration changed.

Validation: new provider-verification suite 32/0, including real RSA signature and membership integration; membership authentication 34/0; storefront identity 201/0; auth integrity 96/0. Live acceptance remains pending: refresh the current Google session and inspect Settings directly, without opening Shop. Expected fresh account entitlement remains 15 ID / 2 Grade with no repeated welcome grant on refresh. Deployment alone is not evidence of account completion.


## Acquisition tracking follow-up — October 5, 2026

The homepage now captures a fixed channel label from cr_campaign, recognized UTM source/medium values or recognized referral domains. It retains the last non-direct channel locally for up to 30 days, including sign-in/payment returns. Unknown values become other_campaign; raw UTM text, URLs, referrers and ad-click IDs are not stored as attribution. Fixed labels: direct, shop_qr, youtube, discord, google_ads, meta_ads, reddit, organic_search, referral, other_campaign, qa. cr_campaign=shop_qr is the simple shop-card/QR campaign tag. Existing source properties remain event context and cannot override the channel.

Funnel events carry the channel into /api/events. Page entry is once per tab session/channel, not a unique-customer measure. Storage-disabled clients still attempt the event, and sendBeacon refusal falls back to fetch. The endpoint accepts only the fixed channel labels and offers an admin-protected breakdown=campaign over the existing window; the report explicitly identifies counts as observed events rather than people or revenue. Existing unauthenticated analytics remains untrusted, best-effort telemetry. No payment or credit authority depends on it.

Storage HTTP/Redis errors now prevent a recorded:true response. A dedicated telemetry_check event with campaign=qa allows a live persistence acknowledgment without contaminating the checkout or real acquisition funnel. This is not proof of cross-device attribution or Stripe revenue attribution. Validation: acquisition tracking 23/0, including persistence failure, safe fixed labels, auth/payment return continuity, caller override rejection, blocked storage and admin report protection.

## Provider measurement and email audit — October 5, 2026

User asked to move on. The repeated-refresh 15 ID / 2 Grade check for cartoonclipscentral23 remains unconfirmed; do not interpret that instruction as acceptance.

Added server-only PROVIDER_USAGE records for each OpenAI and Ximilar recognition/grading attempt. Fixed provider/operation/mode/model labels, random attempt IDs, elapsed time, HTTP status, outcome and provider-reported token counters are recorded. No identity, image, prompt, card result or raw provider error is included. Failed/empty/unparseable model outputs retain any reported usage. Fallbacks generate separate observations. Missing token usage, Ximilar billed credits and USD cost are null, never assumed free. No new provider call, database write, model choice, debit/refund rule or client behavior is introduced. Removed raw provider error/model-output logging from these fallback paths.

Use `node tools/provider-usage-report.mjs < runtime-log-export.ndjson` to summarize exported observations. It deduplicates random attempt IDs and reports unknown usage separately. Coverage is limited to the provided log export and platform retention; this is not durable invoice accounting, a customer conversion report, calibrated accuracy, or proof of profitability. Before ad scale, reconcile representative live ID/Quick/Deep outcomes (including failures/refunds) with provider invoices and payment fees. The current release still needs a real authenticated scan to establish production observation acceptance.

Focused provider checks: 20 cases passed, covering successful recognition/grading, all existing timer cleanup cases, actual shipped OpenAI attempt logic, empty/parse/HTTP/network/JSON failures, malformed usage, log failure isolation, privacy fields and report deduplication. Scan request recovery and syntax/diff checks passed. Live deployment acceptance is recorded separately after rollout. The additional membership-scan-intent check could not start because redis-server is absent in this workspace (ENOENT); it is not counted as passed. Credit ledger/intention code is unchanged.

Email audit: signup and native verification links use Firebase sendEmailVerification; the separate six-digit-code route uses Resend with hardcoded onboarding@resend.dev and falls back to Firebase on the documented domain restriction. Production environment metadata has RESEND_API_KEY but no sender setting. A Resend sender change alone cannot fix missing native Firebase mail. Verified sender-domain access/configuration and an actual inbox receipt remain open; no email was sent, no account verification was bypassed and no delivery success is claimed in this audit. Public admission remains pilot-only.

Production rollout evidence: source 3f0c21a1bfb56bb8895f74f828956b2a636ee121, deployment dpl_7SiiTJd2mh8dcZkroqZLFB6f5hCs reached READY at 2026-10-05T23:20:21Z and owns cardresell.org/www.cardresell.org. Live homepage returned 200 and matched the local release byte-for-byte; public membership catalogue returned 200/JSON; scan GET returned 405 and unauthenticated POST returned 401 without a provider call. Asset fingerprints 99/0. Early error-level logs contained two Node url.parse deprecation warnings on successful tpl-proxy 200 responses; no claim of a warning-free release. No signed-in provider attempt has yet been accepted. Next live sample: existing cartoonclipscentral23 account, one ID Scan and one Quick Grade; correlate production PROVIDER_USAGE logs, result and credit deduction before cost acceptance.
