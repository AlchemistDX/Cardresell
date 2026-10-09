# Scrydex pilot adapter — October 9, 2026

## Release scope

Implemented a default-off GET /api/pokemon-provider endpoint. No existing search, camera, grading, collection or browser provider path calls it. Deployment alone cannot activate it, purchase a plan, migrate the catalog or consume customer ID/Grade credits. The existing provider and local fallback remain in place.

The separate TCGPriceLookup proxy now keeps its eight-second deadline active through body transfer. Previously it stopped the timer when headers arrived, allowing a stalled body to wait indefinitely. Failure responses remain non-cacheable and uncertain requests retain their existing budget accounting.

## Pilot contract

- Verified Firebase/Google account plus explicit operator UID allowlist; no anonymous lookup or wildcard access. Authentication runs before cache access. Responses are private/no-store.
- Exact ID lookup, or literal card-name search with EN/JA language and explicit page/pageSize. Page size is at most 100, page at most 100; no automatic fan-out or pagination. Response includes nextPage and a truncation flag at the search ceiling. Arbitrary provider paths, query syntax, history, listings, vision and extra includes are rejected.
- Separate price opt-in. Canonical identity, printed number, expansion, language, variant images and names are retained. HTTPS image URLs come from the response, not a fabricated CDN pattern. Raw/graded prices retain currency, condition, company, grade and signed/perfect/error flags. Missing prices stay missing. No conversion of JPY to USD or aggregate values into TCGplayer comps. Missing source/observation date remains null; fetchedAt is explicitly separate.
- One upstream request per admitted cache miss; no automatic retry. Eight-second header/body deadline, two-MiB response ceiling, redirects forbidden. Exact ID, language and pagination mismatches fail rather than quietly selecting another printing.
- Shared 24-hour normalized-result cache. A distributed 30-second lock suppresses duplicate concurrent misses; followers receive a retryable busy response instead of buying another call. A stalled worker cannot overwrite another worker's result. Provider throttling pauses new calls for five minutes; authentication and server errors pause for one minute. Cache hits remain available.
- Atomic aggregate allowance and per-user UTC-day limit. Every reservation counts, including timeout, invalid response or uncertain storage acknowledgment. No speculative refunds. A missing/corrupt aggregate counter blocks new paid calls. A failed cache write preserves an already successful result without repeating the paid request.

## Activation configuration — not performed

Use isolated production and preview KV stores. The adapter deliberately does not use the application's general KV credentials. Server-only configuration:

| Variable | Meaning |
|---|---|
| SCRYDEX_ENABLED | Exactly 1 to permit configured pilot traffic; otherwise disabled |
| SCRYDEX_API_KEY / SCRYDEX_TEAM_ID | Confirmed provider credentials, never browser settings |
| SCRYDEX_PILOT_UIDS | Comma-separated verified account UIDs; no wildcard |
| SCRYDEX_PRICES_ENABLED | Exactly 1 after confirming plan entitlement; otherwise no prices |
| SCRYDEX_KV_REST_API_URL / SCRYDEX_KV_REST_API_TOKEN | Isolated durable Redis REST store |
| SCRYDEX_KV_SCOPE | Stable environment scope, 3–60 lowercase letters/digits/underscore/hyphen |
| SCRYDEX_WINDOW_START / SCRYDEX_WINDOW_END | Explicit ISO pilot budget window, at most 32 days, no automatic renewal |
| SCRYDEX_REQUEST_CAP | Positive integer aggregate request allowance |
| SCRYDEX_USER_DAILY_CAP | Positive integer per-account cache-miss allowance |

Before enabling, reconcile the provider's used credits and all other consumers with the chosen allowance. Initialize the budgetKey returned by scrydexConfig to the already consumed count in this window, using SET NX; never overwrite it to reset usage. The key has no TTL. Its namespace includes a hash of the provider team plus the stable scope and window start. Changing scope/window/team creates a new uninitialized budget, not fresh automatic access. Do not share a paid provider key with unmetered consumers and call this a total account spending cap: this allowance governs only this adapter's requests, not subscription charges or calls elsewhere.

On a lost/restored database, disable first and reconcile usage with the provider before initializing or adjusting a counter. Surviving but stale restored counters cannot be detected automatically. Storage isolation and a recovery drill remain activation requirements.

## Remaining acceptance

1. Confirm account, plan, price entitlement, usage/overage terms and credentials without placing secrets in chat.
2. Configure a small explicit pilot allowance, isolated store and known owner accounts; initialize usage after reconciliation.
3. Compare live responses for English/Japanese, collector suffixes, variants, raw/graded prices and empty results against the normalized contract. Strict schema failures are visible; do not relax identity checks simply to make a test pass.
4. Wire browser search/exact scan/server grounding incrementally after validation. Maintain local identity fallback and account for pagination cost. Audit legacy image and affiliate redirect dependencies separately.
5. Retain physical iPhone and naturally occurring live Deep-to-Quick acceptance gates. No paid advertising is started by this release.

## Sources

Schema/authentication/caching reviewed against official docs on October 9:
- https://scrydex.com/docs/pokemon/cards
- https://scrydex.com/docs/getting-started/authentication
- https://scrydex.com/docs/getting-started/prices
- https://scrydex.com/docs/getting-started/best-practices

## Verification

tests/scrydex-pilot.mjs exercises the actual adapter handler and Lua against process-private Redis, with synthetic provider replies and a real local HTTP body stall. Covers authorization, default-off behavior, schema/price separation, hard bounds, cache, twenty concurrent distinct requests for one remaining allowance, twenty duplicate requests, lost reservation acknowledgments, malformed identity, cache-write failure, deleted/corrupt counters, throttling and full-body timeout. No paid provider calls or production storage writes.

tests/tpl-body-deadline.mjs exercises actual eight-second production timing against stalled headers and stalled bodies. Existing TPL contract/budget suites, copy truth, asset fingerprints and release inspection are rerun for this release.
