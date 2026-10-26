# Catalogue response recovery — walkthrough follow-up

During the post-release user walkthrough, `Mew 76` returned an empty HTTP 200 response from `/api/tpl-proxy`. The response had `Content-Length: 0`, `X-Vercel-Cache: HIT`, and an age of 119 seconds. The UI correctly reported lookup failure, but another attempt received the cached failure rather than a fresh catalogue response.

The proxy previously treated any upstream 2xx status as cacheable, even when the body was empty or unreadable. It now parses successful responses before permitting edge or shared-result caching. Empty, truncated, non-JSON and non-object replies become a JSON 502 error with `Cache-Control: no-store`. A valid `{"data":[]}` response remains a successful, cacheable empty search.

The provider call may already have consumed quota, so the existing spending reservation remains counted. This change neither refunds an attempted provider request nor adds automatic retries.

The five focused suites pass 356 assertions covering malformed responses, a real empty search, shared-cache admission, spending accounting, stalled headers/body, and the user-facing failure state. They use mocked providers or local sockets. The full local release gate is also required before this follow-up is merged and deployed.

This prevents our proxy from retaining a transient invalid response as success. It cannot guarantee upstream catalogue availability. The original cause of the upstream empty body has not been established.
