# eBay callback recovery — 24 October 2026

The supplied recording shows that eBay saved the application settings and returned to CardResell with `ebay_connection=error`. The connection dialog immediately cleared that outcome while refreshing status, leaving only “No eBay account connected.” The callback handler also discarded the failure stage, so the recording and existing runtime logs cannot identify the underlying provider/storage exception.

## Changes

- Keep authorization outcomes separate from status/action errors so refreshes and retries cannot erase the reason for returning.
- Distinguish approval, application configuration, account identity, state lookup, and connection storage failures. An expired pending review has an explicit recovery message.
- Add a random, non-credential connection reference to the UI and a matching `ebay_connection_failed` diagnostic. Diagnostics contain the fixed stage, allowlisted OAuth error code, numeric provider status/error ID, and timeout flag when available. They exclude request URLs, authorization codes, tokens, cookies, provider descriptions, exception messages, and account identifiers.
- Keep state single-use, tokens encrypted, account confirmation explicit, and existing connections intact after a failed reconnect. Diagnostics failing cannot prevent the recovery redirect.
- Center the dialog and publish a new immutable browser asset using `tools/build-ebay-connect.mjs`.

## Verification

Tests ran with external Node/browser traffic blocked and a process-local Redis instance. All provider responses and accounts were fixtures.

- `tests/ebay-seller-connect.mjs`: 158 checks passed. Includes callback/provider/storage fault injection, confidential-data exclusion, confirmation, account isolation, encrypted persistence, disconnect/refresh races, and deletion handling.
- `tests/ebay-connect-browser.mjs`: 86 checks passed at 390px and 1280px. Includes actual callback query handling, persistent error/reference display, status failure/retry, successful confirmation, centering, and account switching.
- `tests/asset-fingerprints.mjs`: 254 checks passed.
- Changed JavaScript passed syntax checks; `git diff --check` passed.

The real seller authorization has not been proven successful. A fresh connection attempt is still needed to either reach account confirmation or obtain the newly visible failure reference. No eBay listing publication or inventory synchronization was enabled by this release.
