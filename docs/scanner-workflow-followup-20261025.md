# Scanner confirmation and cancellation follow-up — 2026-10-25

This continues the scanner/binder audit after PR119. It fixes reproducible review and recovery defects; it does not claim a higher live recognition rate.

## Changes

Single-card review now binds its server-issued receipt to the signed-in owner and scanner session. Confirmation refreshes the auth token and has a deadline covering token retrieval, the request, and response decoding. The client accepts only the matching scan and exact offered candidate. Duplicate taps are ignored, and retries reuse the identical receipt and selection.

Closing, retaking, or starting another capture cannot discard an in-flight or uncertain confirmation. A failed login after a lost reply no longer clears that uncertainty in either single-card or binder review. An accepted result becomes usable immediately even if the optional balance refresh stalls. An expired, unaccepted offer provides a new-photo action; invalid offers cannot send a debit request.

The selected printing retains set code, verified catalog ID, game, language, Japanese name, and other identity fields. The API preserves language and Japanese name in the offered candidate. Japanese Magic cards reach the non-Pokémon loader instead of the Japanese Pokémon loader. Confirmation labels, direct-scan labels, and error messages render provider text literally rather than interpreting it as HTML.

Photo preparation and scan responses are scoped to the current account and scan run. Cancellation during photo checks, local matching, or compression prevents a later scan request. Late errors cannot replace the next screen. A compression failure now produces a usable retry state without sending a paid request.

Mobile review retains readable, at least 48px-high match buttons and scroll access to every choice. Its explicit cancellation action replaces the duplicate generic Cancel button. Old immutable assets remain unchanged; the entry document references new content-hashed core and binder-review bundles.

## Verification

**2,158 checks passed across 20 targeted suites, with no failures.** Detailed totals, complete-suite markers, and active asset SHA-256 values are in [scanner-workflow-followup-20261025.json](scanner-workflow-followup-20261025.json).

The new single-card suite uses the shipped app, real scan/confirmation handlers, and isolated Redis. Its 100 checks cover Magic/Japanese metadata, exact seventh-choice acceptance, wrong scan/printing replies, lost replies, login failure after a lost reply, duplicate-charge prevention, closing during confirmation, account changes, token/body deadlines, malformed offers, cancellation at preparation boundaries, compression errors, literal provider labels, fresh auth tokens, and mobile scrolling. The baseline reproduced the missing metadata, blocked credit-refresh handoff, missing recovery, and late-token defects before fixes.

Binder match review runs against both legacy and membership billing ledgers. Added cases prove that a lost accepted response followed by a 401 retains the original choice and safely replays once authenticated. Existing cases cover price isolation, seller overrides, copy IDs, cost basis, and inventory/draft boundaries.

The remaining checks cover confirmation atomicity, billing release behavior, membership scan intent, scanner/provider contracts, selected finish and pricing, rapid/bulk workflows, photo input resets, request recovery, camera lifecycle, decoder fallback, binder crop preparation, rarity grounding, local artwork matching, asset fingerprints, and test registry coverage. The normal runner now registers 156 suites; this release ran the 20 relevant suites, not the entire application suite. The configured Vercel build inspection also passed.

Screenshots of the 390px review screen were inspected. All test providers, auth responses, and catalog services were fixtures; Redis and Chromium were real and isolated. No paid recognition requests, production credits, seller inventory, or marketplace listings were changed during verification.

## Limits and follow-up

These fixes make review and recovery more reliable. A live Ximilar exact-printing accuracy measurement still needs original full-resolution labeled photos, especially Magic binder pages. The earlier recovered Magic uploads are screenshots and cannot recreate the provider input. No recognition thresholds were relaxed. Native iPhone camera/Safari behavior still needs a device check.

The production `DEP0169` warning was investigated separately. No application `url.parse()` call was found. Vercel has a matching open runtime report ([vercel/vercel#16109](https://github.com/vercel/vercel/issues/16109)); that makes a platform source plausible, but no application-specific stack trace established it conclusively. This release does not suppress warnings or claim to fix that warning.

Recovery guarantees here cover the current browser session. They do not establish durable recovery of an unresolved picker after clearing site data, closing the tab, or changing the authenticated Firebase user object. Those are separate recovery work, not claims of this release.

## Reproduce

With the repository test dependencies, Chromium, and private Redis available:

```sh
node tests/single-scan-review-browser.mjs
node tests/bulk-match-review-browser.mjs
node tests/billing-release-browser.mjs
node tests/scanner-audit-browser.mjs
node tests/id-confirmation-atomic.mjs
node tests/asset-fingerprints.mjs
node tests/test-registry.mjs
```

`CR_CHROMIUM` selects the local Chromium binary. Optional `CR_SHOT_DIR` saves mobile review screenshots to an existing directory. The JSON report lists all 20 suite entry points.
