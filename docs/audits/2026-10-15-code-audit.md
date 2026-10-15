# CardResell code audit — 15 October 2026

## Scope and interpretation

Broad regression testing plus focused review of authentication, collection persistence, saved/public grading reports, payment checkout and fulfillment, webhook verification, scan credits/refunds, draft ownership, exports, and the seller journey. This is not a claim that every line was manually audited or that no bugs remain. No real purchase, paid provider scan, customer-data mutation, or email was used to test the changes.

## Findings addressed

| Priority | Finding | Change and evidence |
| --- | --- | --- |
| High | Legacy sign-in fallback resolved a Firebase account by email. Unverified Firebase sessions could populate that mapping. | Only a verified Firebase Google session can establish a new, versioned Google-subject-to-Firebase-UID binding. Old email bindings are ignored. Tokeninfo issuer, audience, expiry, subject, and verified-email checks are required. Signed-token and synthetic fallback regressions cover identity mismatches. No claim of observed exploitation. |
| High | Legacy collection reads turned HTTP, Redis and JSON errors into an empty collection; subsequent writes could overwrite data. Concurrent mutations also used read/replace without coordination. | Explicit absence alone means empty; errors fail closed. Compare-and-set retries recompute duplicates and limits from fresh data. Real isolated Redis tests cover failed reads, failed writes, simultaneous additions, and a simultaneous add/delete. The current main collection UI uses user-data rather than this legacy route. |
| Medium | Saved grade history could acknowledge malformed write/delete results and treat an invalid list response as empty. | Strict storage response and acknowledgement validation; malformed responses return 503. Existing idempotency, capacity, ownership and browser tests retained. |
| Medium | Public grade sharing did not verify storage writes and could return a broken link. Read failures appeared as missing shares. Collision checking and saving were separate. Optional ownership passed the request object to a token-string verifier and read the wrong UID fields. | Confirm storage replies; distinguish absence from failure; reserve random IDs with atomic SET NX and expiry; repair optional token/UID handling; reject out-of-range grades. Failure/collision regressions exercise the real handler. |
| Medium | A saved-grade Redis script could partially save or delete a report when its summary index had the wrong data type. Redis script errors do not roll back earlier mutations. | Validate both hash keys before either mutation. A failing regression reproduced an orphaned report on the prior code; six new checks verify failed saves/deletes preserve storage and recovery succeeds. |
| Medium | Imported IDs matching JavaScript prototype properties could lose deletion markers and reappear when an older device synced. | Preserve opaque ID keys as explicit own properties in browser and server merge/compaction, and local deletion recording. Regressions cover `__proto__`, `constructor`, `toString`, and `hasOwnProperty`, including real Redis round trips after stale uploads. Generated numeric/UUID IDs were not affected. |
| Low | The billing browser suite depended on absolute paths from another machine. | Resolve installed Playwright normally, honor CR_CHROMIUM, and write temporary evidence to /tmp. The actual billing workflow assertions remain intact. |

Firebase token validation also now rejects missing/non-numeric expiry and issue-time claims, invalid subjects, and non-RS256 headers. Existing draft/photo fixtures were updated to model valid provider-subject bindings; the dedicated verifier suite proves the old email binding no longer authorizes a legacy token.

## Compatibility

Normal Firebase sign-in preserves the existing UID and account data. An old Google-only session without the new trusted binding must sign in through Firebase again. No old email mapping is migrated or trusted. There are no pricing, credit allocations, fee schedules, or scanner-recognition changes in this audit.

## Validation

- All 141 server JavaScript files and five selected active/canonical client files pass Node syntax checks (146 files total).
- Focused verifier suite: 46 checks; collection persistence: 46; saved/public grade history with browser coverage: 52; billing browser: 34.
- Standard release gate: 122 suites passed, 3 expected skips (managed real-store check, production smoke in local mode, opt-in condition interaction). All 16 supplemental billing/customer-workflow suites passed.
- Browser tests use Chromium, including mobile emulation, with synthetic provider/auth/payment boundaries and isolated Redis where applicable. They do not establish physical iPhone Safari performance or real provider accuracy.

## Remaining acceptance and limits

Before broad advertising, finish physical iPhone binder-camera testing, glare/low-light scan trials on original full-resolution photos, and a small real customer cohort. Real Stripe settlement, managed production storage fault injection, and paid vision calls were deliberately excluded from this audit. Existing operational/readiness items such as provider cost reconciliation and unresolved external fee confirmations remain separate gates.

This review did not perform a penetration test, historical compromise investigation, full dependency vulnerability assessment, or load test. Deployment checks and a brief runtime-log review are point-in-time evidence, not a long-term error-rate guarantee.

## Follow-up check

The repeated audit request was treated as a continuation, not a deployment retry. The previous commit remained present and clean. The additional saved-grade storage defect above was reproduced and fixed. Its complete 52-check suite passed, as did repeat runs of binder-interaction-browser, binder-scan-browser, bulk-recovery-browser, collection-export, and photo-upload-endpoint-2026-09-13. The earlier full release gate is the baseline for unchanged code; it was not rerun wholesale for this isolated follow-up. All fixes remain local because the prior GitHub publishing request was rejected. No production deployment is claimed.

## Collection deletion follow-up

Reproduced the special-ID defect in the prior browser and server implementations (18 new assertions failed). Updated both implementations and generated a new immutable browser bundle rather than changing the previously served asset. Added local deletion-recording checks and real Redis stale-upload regressions. The complete release runner passed again: 122 executed suites, 3 expected skips. Focused deletion durability passed 157 checks; real Redis collection persistence passed 46. Browser asset content hash and its active HTML reference were verified. Publication remains paused following the rejected GitHub request.

## Release authorization

After these checks, the owner explicitly authorized publishing and deploying all held fixes on 14 October 2026 (America/New_York). The earlier paused-publication statements above describe the audit checkpoints. See the release PR and deployment status for the final publication outcome.
