# Production deployment and live acceptance — 2026-09-12

Executed under Will's standing authorization. Nothing here consumed paid quota,
published anything, altered production credentials, or touched quota keys.

## 1. Push and deployment

| | |
|---|---|
| Pushed | `9aaf326..7957ad7  HEAD -> main` |
| Deployment | **`dpl_GnNMK7V8WeVpBNyCTWQArD2MXGgX`**, target `production`, **Ready**, 19s |
| Created | 2026-09-12 12:15:30 UTC |
| **Build log** | `Cloning github.com/AlchemistDX/Cardresell (Branch: main, Commit: 7957ad7)` |

**The commit is confirmed from the build log**, not from a dashboard summary and
not from a bundle hash. Deployed SHA `7957ad7` **equals** the tested tree — the
non-markdown diff against the verified merge `875204b` was empty at push time.

Release size: **254 files, +957,519 / −276** against the previous production
commit `9aaf326`, including 26 API modules. Not a one-line change.

## 2. Live checks

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Site reachable | **PASS** | `GET https://www.cardresell.org` → **200** |
| 2 | Bundle identity | **PASS** | serves `js/core.2db046e6.js` + `js/ui.e6529e78.js` — the tested Preview bundles; both fetch **200** |
| 3 | CH-2 positive path | **PASS** | `GET /api/ebay-notifications?challenge_code=…` → **200**, body has **`challengeResponse` and no other key**, value is a 64-char lowercase hex SHA-256 digest. Shape only was inspected; **the value was not printed, stored, or logged** |
| 4 | CH-2 missing-code path | **PASS** | no `challenge_code` → **400 `challenge_code required`**, not 503 and not 200. Confirms in production what `ebay-notify-token` asserts offline |
| 5 | Deployment protection | **PASS** | direct deployment URL → **302** to `vercel.com/sso-api`. Protection **remains enabled**; nothing was disabled to make a check pass |
| 6 | Auth boundary | **PASS** | `GET /api/drafts` unauthenticated → **401** |
| 7 | Static routes | **PASS** | `/pricing.html`, `/privacy.html` → 200 |

**7 PASS, 0 FAIL.**

## 3. NOT RUN — and exactly what each would require

No workaround was improvised for any of these, and **no secret was copied out of
Vercel to complete one**.

| Check | Status | Blocked on |
|---|---|---|
| **RV-3 / RV-9** (20 checks) | **NOT RUN** | Production eBay credentials would have to be read out of Vercel and handed to a local harness. Refused by the §3a boundary. **Still 0 of 20 established.** Needs an owner-run pass, or a harness that executes entirely inside the deployed environment |
| **RV-1** grade response contract | **NOT RUN** | Needs a real grade scan against the deployed function through a signed-in session. `tests/test-scan.mjs` has no offline harness, so nothing substitutes |
| **Deployed Google authentication** | **NOT RUN** | Requires Will's Google sign-in. I have no session and must not obtain one |
| **Production draft create / reopen / delete** | **NOT RUN** | Same signed-in session. **No test drafts were created**, so none needed deleting |
| **R4 activation (G12)** | **NOT RUN** | Owner-held activation step |
| **Concurrency** | **NOT RUN** | Live suite's concurrency checks; not implied by any create/reopen result |
| **Original-scan-row retry** | **UNVERIFIED** | Never exercised. Deletion survived refresh; that is a different assertion |
| **Cap refusal** | **DEFERRED** | Hand-overwriting `draftquota` / `draftquotafresh` destroys a TTL a delete cannot restore. Stands deferred |

## 4. One finding, non-blocking

**The CH-2 success path does not set `no-store`.** Observed
`Cache-Control: public, max-age=0, must-revalidate` on the 200 response.
`api/ebay-notifications.js:67-68` sets only `Content-Type` on success; `:55` sets
`no-store` on the **503** path only. So a token-derived hash is served without an
explicit no-store.

**Scope, stated honestly:** `max-age=0, must-revalidate` means no cache may reuse
the response without revalidating, so in practice it is not retained, and the
digest is challenge-code-specific and useless for another challenge. This is a
**header-hygiene gap, not a disclosed secret** — and not a release blocker. Logged
as a follow-up; **I did not change it**, since a code change here would go out
unreviewed after the release commit was already verified and deployed.

## 5. Phase 1

Will's estimate before this deployment: **~96%**. Production deployment is done
and the safe live checks pass. **Live acceptance is not complete** — RV-3/RV-9
stands at 0 of 20, and RV-1, deployed auth, the production draft round-trip, R4,
concurrency and the scan-row retry are all still unexercised. **I am issuing no
new percentage**; the remaining milestone is owner-run acceptance, not more code.
