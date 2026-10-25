# Seller authentication and workflow recovery — 2026-10-25

This pass checks the handoff from an active seller session to eBay connection checks, draft review, saved listing operations and a Seller Hub CSV export. It fixes failures that could leave those steps busy indefinitely or allow a closed dialog to start an action later.

## Findings and changes

- The shared token helper had no deadline. A stalled SDK refresh occurred before each caller's network timeout, so those timeouts could not recover the interface. Refresh now has a 15-second deadline. Existing request timeouts still apply separately after authentication.
- A rejected or missing refresh previously fell back to the global cached bearer. The helper now requires a current account and a matching SDK user. It rejects mismatched account identities, invalid token values, changed SDK users and replaced sessions; it cannot use a cached token to establish the active account.
- The previous helper could overwrite the token cache when an old account's refresh completed late. Only a timely response from the still-current session can update the cache. A timeout returns control and discards the eventual result; it does not cancel the SDK's own network operation.
- Browser testing reproduced a queued-close-event race: closing the connection dialog made it visually disappear, but an immediate token completion could still start OAuth before the close event handler ran. The connection, review and operations guards now check the dialog's synchronous open state as well as owner and instance.
- The eBay connection dialog accepts the same UID identity as the rest of the seller workspace. Its failed initial check replaces the loading status and offers Retry. All affected dialogs explain a failed refresh and unlock their controls.
- The export availability check distinguishes an account change from a failed refresh. It says no listing file was created and allows an explicit retry. The browser regression confirms that a stalled refresh triggers no photo upload or download, and a successful retry completes once.

## Verification

All 160 runnable suites in the 162-slot release runner passed; the two intentional skips are live Redis and the production mutation smoke. The new auth unit suite passes 21 assertions, and the full browser workflow passes 60 assertions across 390- and 1280-pixel widths. The auth suite reproduced 16 failures against the prior core before the fix. Asset fingerprints match the shipped bytes.

The browser exercises the shipped core and dialogs, local review/operations/availability handlers, and isolated Redis with controlled SDK/provider boundaries. It checks timeout recovery, explicit retry, correct-account authorization, discarded late results, dialog closure, export gating and lack of page overflow. External network calls are blocked during these tests. No paid scans, live listings, purchases or customer inventory writes are performed.

Five older test fixtures assumed that a cached bearer alone represented a signed-in account or that SDK refresh began synchronously. They now model the active account and SDK identity, wait for the pending refresh where needed, and simulate actual sign-out/account changes. Their shipping snapshot, photo upload/export, eligibility ordering and account-switch assertions remain in place. The signed-out photo cases retain a stale cache to prove it cannot authorize an export.

Detailed runner summaries and asset digests are in the companion JSON.

## Selling readiness and limits

The inspected production handler still defaults listing execution to disabled, and its exported handler does not enable it. The configured seller OAuth scopes in the repository are read-only identity, account and inventory. The interface accurately offers listing preparation, review and recovery; the usable publication handoff remains a reviewed Seller Hub CSV. Linking an account is not proof that direct publication or automatic sales synchronization has been enabled or verified.

This release does not enable live marketplace writes, add a market-wide sold-comps feed, establish current seller policy/location readiness, or measure scanner recognition accuracy. It preserves the earlier price-evidence fixes. Existing runtime `url.parse` deprecation warnings remain outside this change.
