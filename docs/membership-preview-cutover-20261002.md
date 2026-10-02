# Preview writer cutover

The one-time build migration was committed as `75ee705e5236cbc47412894f2ea5ca51a9c03d49`.
Its `vercel-build` hook is intentionally removed after managed confirmation.
The executable and its tests remain as historical operational evidence, not an HTTP endpoint.

## Observed evidence

- Owner confirmed separate Upstash resource IDs: Preview `b0de2137-6c5c-41b4-8af4-da80a70ce1c3`, Production `dc621a30-497c-4851-a3c3-42a51309f094`.
- Owner reported completed `preview-before-membership-20261001`, 25.53 KB. This is dashboard evidence, not a restore test.
- Owner reported no local Development clients running; sandbox inspection found no managed Development writer.
- Following the owner's reset, the old Preview deployment returned explicit datastore authorization rejection, not a timeout.
- Upstash refreshed the five Vercel datastore bindings. They were restricted to Sensitive, Preview-only, `feature/launch-membership-v2`. Production binding IDs and modification times remained unchanged.
- Replacement deployment `dpl_AB5jxLP69pDnX6apEySJnsShdzhg` accepted the new credential.
- Cutover deployment `dpl_6cMaBcYRxCgyAY6WrpEqLGPmpXcv` installed the fence at Redis time `1790916337`. Subsequent builders replayed the exact evidence.
- The stable preflight served commit `75ee705e5236cbc47412894f2ea5ca51a9c03d49`, returned 32 passing Stripe checks, accepted datastore authorization and `fence: installed`.

The audit JSON is stored byte-for-byte at `membership:launch-v2:preview_cutover:20261002`.
Its separate installation timestamp and the permanent fence are committed atomically.
No balances, account records, enrollment records or financial journals were changed by the migration.
The public writer-readiness diagnostic deliberately does not infer provider revocation from a fence alone; its `cutoverProven: false` is not a replacement for the operational evidence above.

## Operational safety

The migration is gated by an exact commit, Preview environment, membership branch, test account, trusted return origin, and disabled purchases/billing routing.
Conflicting or partial audit state is refused rather than overwritten.
An unknown acknowledgment is reconciled only by identical audit replay.
There is no deletion or reset operation.

The temporary commit selector remains in branch-scoped Vercel metadata: automated deletion was blocked by the tool's deletion-confirmation safeguard.
It is not a credential and is inert in the post-cutover release because that release has no build hook.
Do not reintroduce the hook or re-arm this migration for another commit.

## Rollback

Disable new sandbox purchasing and deploy a compatible fenced build.
Never remove the global fence, cutover audit, issuance histories or financial journals.
Do not restore revoked credentials or deploy an unfenced writer with the new credentials.
The cutover deployment is a purchasing-disabled Preview rollback candidate; its credential snapshot is post-rotation and its legacy writers respect the fence.
Production has not been migrated or activated.
