# Catalogue response recovery — walkthrough follow-up

During the post-release user walkthrough, `Mew 76` returned an empty HTTP 200 response from `/api/tpl-proxy`. The response had `Content-Length: 0`, `X-Vercel-Cache: HIT`, and an age of 119 seconds. The UI correctly reported lookup failure, but another attempt received the cached failure rather than a fresh catalogue response.

The proxy previously treated any upstream 2xx status as cacheable, even when the body was empty or unreadable. It now parses successful responses before permitting edge or shared-result caching. Empty, truncated, non-JSON and non-object replies become a JSON 502 error with `Cache-Control: no-store`. A valid `{"data":[]}` response remains a successful, cacheable empty search.

The provider call may already have consumed quota, so the existing spending reservation remains counted. This change neither refunds an attempted provider request nor adds automatic retries.

The five focused suites pass 356 assertions covering malformed responses, a real empty search, shared-cache admission, spending accounting, stalled headers/body, and the user-facing failure state. They use mocked providers or local sockets. The full local release gate is also required before this follow-up is merged and deployed.

This prevents our proxy from retaining a transient invalid response as success. It cannot guarantee upstream catalogue availability.

## Root cause established in the follow-up

The empty response persisted after upstream validation. Its `X-TPL-Cache: hit` header led to the production cache adapter: it wrote raw provider JSON but the budget reader expected `{ value, expired }`. Consequently, the first lookup could work while the next cache hit returned `undefined` as an empty HTTP 200 body. The empty response was therefore not evidence of an upstream empty body.

A regression comparing the first and second response bodies failed against the old adapter (104 passed, 1 failed). Existing tests had checked the second response's status, cache header and lack of provider spending, but had not checked its body.

The adapter now writes a versioned envelope containing the response, fresh-until timestamp and stale-until timestamp. Reads unwrap it and calculate expiry. Legacy, corrupt and fully expired entries become cache misses; replacements still require the normal spending reservation. The budget policy also rejects malformed envelopes defensively.

The expanded suite passes 120 assertions, including exact first/second response equality, a complete stale response under an exhausted budget, full expiry, malformed and legacy entries, and one metered repair followed by a complete cache hit. The entire local release gate is rerun before deployment. No production cache deletion, new credentials, additional allowance or automatic retry is introduced.
