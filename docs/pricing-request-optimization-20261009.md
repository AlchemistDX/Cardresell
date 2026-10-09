# Pricing request optimization — October 9, 2026

## Problem

PriceCharting used three attempts per provider request, each with a 12-second header-only timeout. Non-retryable HTTP errors were thrown inside a catch that retried them anyway. Identity correction can make multiple provider queries; the browser then retried errors after another 1.2 seconds, despite its ten-second overall result deadline. Exact-product and variant-list failures also bypassed the short error cache. The response cache omitted sport and brand even though they affect product selection.

## Change

- One 7.5-second provider lookup budget and four-attempt ceiling shared across search, identity follow-ups and retries. Each request gets at most 3.5 seconds, covering headers and JSON body. This bounds provider work within the browser's result window; slow responses may now return an unavailable result sooner.
- Only transient HTTP 500/502/503/504 responses without Retry-After receive one retry, after 200 ms. Authorization failures, rate limits, malformed bodies, network failures and timeouts are not automatically retried. Provider Retry-After is respected by declining an immediate retry.
- Cache reads/writes use POST command bodies and 600-ms full-response deadlines. Provider URLs containing credentials cannot appear in transport error labels.
- All lookup modes return an explicit unavailable result and use a 60-second failure-cache TTL. Cache reads report the remaining retry interval. Successful cached data keeps its six-hour TTL; expired/future-dated entries are refused.
- Cache v11 serializes the complete identity tuple, including sport and brand. JSON serialization prevents delimiter collisions; old incomplete keys are not reused.
- Scalar query validation and field length bounds run before provider requests. This does not change the existing exact-printing, parallel or grade-price admission rules.
- Removed the browser's duplicate PriceCharting request after a server failure. Active immutable core asset is now `js/core.58e35c65.js`; the old published generation remains on disk.

## Verification

New pricing-request-budget suite: 73 checks covering deadlines, request ceilings, transient retry recovery, no retry on denied/rate-limited/stalled responses, cache identity collisions, invalid input, error caching/recovery in all modes, and the actual active client request block. No real provider requests or customer credits.

Existing checks: sports price guards 60; sports parallel 11; grading identity 12; quick pricing 219; launch regressions 440; advertised copy 224; marketplace/deep-link companions 187; asset fingerprints 109; Collection→draft browser flow 44. Syntax and diff checks pass. Two older cache-key source assertions were updated for the new serialized v11 format; behavioral collision checks exercise the real handler.

No provider subscription, pricing plan, allowance, payment or admission setting changed. This bounds request work but is not a provider invoice reconciliation, a company-wide spending cap, or evidence that every pricing provider is healthy. Physical-phone, live fallback, new-user acceptance, provider migration and backup/restore gates from the full audit remain open.
