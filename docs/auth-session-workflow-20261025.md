# Seller account handoff and verification — 2026-10-25

The user story is an active Firebase session opening its own seller workspace, loading its account status and inventory, and completing verification without an older session changing that workspace later.

## Findings and changes

- A new account facade could be rendered while the previous account's cached bearer was still present. Rendering starts status requests, so the old token could be sent while the interface already represented the new account. The callback now clears the cached bearer before rendering or loading data. Old plan, credit, referral and verification display state is invalidated when the owner changes.
- The null-auth branch ignored every sign-out without an in-tab intent flag once a UID had been seen. It now ignores only a stale callback while the SDK actually retains a signed-in user. An SDK sign-out, including the event used for cross-tab sign-out, clears the facade, SDK handle, bearer, account display state and timers, and rerenders the collection in its anonymous scope. Stored account inventory is retained.
- Session generations, the active SDK user and the rendered account facade bind asynchronous continuations to one session. Initial tokens, recurring refreshes, verification reloads, claim responses, membership follow-ups and delayed sign-in actions cannot act after that session changes. A same-UID replacement session also invalidates older work.
- A late initial token cannot overwrite a token already refreshed by verification or a user action. The recurring refresh also preserves a cache that changed while its request was pending.
- Returning from an email verification link starts its check without holding up the signed-in workspace. The two background verification paths share one guarded routine. A pending reload suppresses overlapping polling requests; each retired poll owns its timer and cannot cancel a newer account's poll.
- Verification email fallback retains the original SDK user. It cannot send a second email to a newly selected account after the first attempt fails.
- Manual email/code/link confirmation and resend actions bind both responses and delayed UI updates to the original session and button attempt. Their token retrieval uses the existing account-bound refresh helper. Account changes reset the old buttons, and signed-out actions show a sign-in instruction. Successful manual checks require an affirmative server response, update current verification state and refresh account status.

## Verification

All 162 runnable suites in the 164-slot release gate pass; live Redis and production mutation smoke remain intentionally skipped. The new lifecycle suite has 68 assertions. The new full-workspace browser suite has 40 assertions at 390 and 1280 pixels. Three additional account/billing/customer-journey gates pass, as do verification-email acceptance and Google sign-in recovery checks. The initial 52-assertion version reproduced 39 failures against the preceding production assets before the later positive-path and signed-out-message checks were added.

The browser loads the actual shipped Firebase adapter, core, UI and account-scoped storage with a controlled SDK and API edge. It verifies that an account switch sends no request using the previous account's bearer, clears the old balance and visible collection, restores the new account's own balance, and preserves saved inventory after sign-out. It also holds a verification reply across an account change and verifies that the new verification view remains open, unverified and usable. Existing tests retain their provider-send rejection and fallback assertions; their fixtures now include the actual session helpers and a matching SDK identity.

The historical sign-out source assertion now checks the SDK's active user rather than merely the absence of a local intent flag. Independent executable and browser tests establish the behavior. External traffic is blocked throughout the local release run. No real login, verification email, credit grant, purchase, marketplace action or customer inventory write is used.

## Limits

SDK behavior is controlled in these tests. This is evidence for the application's response to the documented Firebase observer contract, not a live Firebase or native Safari acceptance test. The SDK version, persistence configuration, provider configuration and server verification/billing contracts are unchanged. This pass does not establish a deadline for every SDK reload or verification HTTP request. Direct eBay publication, automatic marketplace sales synchronization and market-wide sold-comps access are unchanged. Existing runtime `DEP0169` deprecation warnings remain outside this release.

## Primary documentation

- [Firebase: Manage Users](https://firebase.google.com/docs/auth/web/manage-users): the auth observer and a null current user when signed out.
- [Firebase: Authentication State Persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence): local persistence and sign-out state across tabs.
