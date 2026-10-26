# Scan request recovery — October 26, 2026

## User story

A seller submits a single card, binder crop, or grade photo set. An interrupted connection must return a usable recovery action, preserve the exact request, and prevent a late result from replacing a later screen or another account's work.

## Changes

- The shared scan transport has a whole-request deadline: 45 seconds for identification and 90 seconds for grading. Hashing, sign-in token retrieval, network headers, and reading the response body are inside that deadline. The returned response is buffered so downstream JSON reads cannot wait indefinitely on the network.
- Explicit cancellation and account changes stop client processing and prevent the transport's connection retry. Late token, header, and body continuations cannot initiate a later request or refresh balances as a successful result.
- Network failures and pending responses retain the existing owner-bound operation ID. There is still only one automatic connection retry, using the same ID. A stalled body is not automatically submitted again.
- Single-card errors now offer **Retry same photo**. Recovery uses the original serialized request and photo, without recapturing, recompressing, or repeating the duplicate-photo check. The competing generic new-photo button is hidden in this state.
- Quick and Deep Grade errors now offer **Retry same photos**. The original analysis request is replayed; the loading animation is replaced with a recovery action. Duplicate submission taps are ignored.
- Grading is bound to its active account and photo session. Cancelling during photo checks cannot later submit a request. A response arriving after cancellation cannot overwrite the next screen or the saved grading identity.
- The transport has a dedicated asset builder and maintained-source parity check. Previously deployed immutable JavaScript files are unchanged.

## Evidence

The new transport boundary tests reproduced 21 failed assertions on the previous implementation. Tests held sign-in, headers, and streamed bodies, then released them after cancellation or the deadline. All 45 assertions pass after the fix, including identical operation IDs on retries, owner changes, response metadata, and cleanup.

The shipped-app browser suite reproduced the missing single-card recovery action, missing grading recovery action, and cancelled-grade overwrite. Its final run passes 133 assertions. It checks exact request replay even if display-account metadata changes, no repeated photo preparation, no replay by another account, cancellation during photo checks, duplicate grade taps, and rendering the recovered grade. Mobile recovery screens were visually inspected at 390px.

Additional suites cover real scan/confirmation handlers with isolated Redis for both billing models, binder preparation and interaction, catalogue recovery, batch saving, listing drafts, and membership scan intent. Providers, sign-in, and catalogue services are fixtures. No paid recognition requests, customer credit mutations, marketplace listings, or production inventory writes are used in these tests.

An initial concurrent binder-review run reported two pending-price-request assertions. URL diagnostics were added without weakening those assertions. The subsequent diagnostic and release runs each passed all 446 checks. The first failures did not capture their URLs, so their cause is not established by this report.

The full `run-all.sh --local` release gate completed successfully: 165 executed suites passed; the managed-store and production mutation checks were skipped. All nine additional workflow suites also passed. Asset fingerprints, test registry coverage, `git diff --check`, and the configured Vercel build inspection passed. Exact log and asset hashes are recorded in [scan-request-recovery-20261026.json](scan-request-recovery-20261026.json).

## Limits

Cancelling a client request does not establish that a server request already sent was cancelled or refunded. Recovery reuses the original operation ID and the server's existing billing and replay rules.

The same-photo buttons retain their request in the current browser session. They do not introduce durable photo storage or promise recovery after closing the tab, clearing site data, or changing accounts. Existing session storage still contains only request hashes and operation IDs, not photos or authentication tokens.

This release changes recovery and session handling, not recognition thresholds, image interpretation, price sources, eBay publishing, or sold-comparison access. It does not establish a Magic/binder recognition rate or professional grading accuracy. Original labeled photos and a device check remain necessary for those measurements.

## Reproduce

With the repository's test dependencies, Chromium and isolated Redis available:

```sh
node tests/scan-request-recovery.mjs
node tests/single-scan-review-browser.mjs
node tests/bulk-match-review-browser.mjs
node tests/billing-release-browser.mjs
bash tests/run-all.sh --local
```

`CR_CHROMIUM` selects the Chromium executable. `CR_SHOT_DIR` saves browser screenshots to an existing directory. The configured Vercel build command is `node tools/membership-release-inspect.mjs`.
