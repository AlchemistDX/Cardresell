# Public verified-customer admission — prepared, not enabled

## Intended change

For CardResell project `prj_NJbWQ7VxpYIjzpCDj7X7vtmEdLbU` in team
`team_6s4mtmL1E2PlqUbMADRWtGNs`, change only production
`MEMBERSHIP_LIVE_AUDIENCE` to `public`, then deploy commit
`a1bff81eb6a1d4ba8912e6aec7235eed9c037f79` with production configuration.
That source tree matches the tested hotfix checkout.

Effect: all normally authenticated, verified customer identities can proceed
through the existing enrollment and billing flows without being on the pilot
list. New eligible users may receive welcome credits and purchase through the
existing catalogue. Existing history can still require enrollment review;
public admission does not authorize overwriting historical records.

Unchanged: email verification, cryptographic identity checks, existing owner
import, customer ownership, paid credits, subscriptions, welcome-award
idempotency, the existing daily welcome-award cap, prices and preview scope.
No secrets need to be retrieved or copied. No new application code is needed.

## Preflight evidence

Seven targeted suites passed on the production-equivalent tree:

| Suite | Passed |
| --- | ---: |
| Membership authentication | 34 |
| Enrollment provisioner, including explicit public live mode | 9 |
| Enrollment flow | 10 |
| Daily welcome cap, replay and concurrency | 27 |
| Account routes | 30 |
| Paid enrollment preservation | 14 |
| Checkout | 323 |
| Total | 447 |

Configured build passed. Checks used synthetic identities and isolated local
Redis, not customer records. Production is currently READY on deployment
`dpl_2FouFFnqpuDEA3gkoLrPRF1NCfqu`.

## Approval-review block

The attempted production-only environment update was rejected by automatic
approval review. Its stated reason: the broad verified-customer enrollment and
billing exposure requires explicit approval of this exact production-wide
switch; general permission to fix access was not sufficient. The tool reported
no update. No alternative route or narrower permission workaround was used.

Await explicit approval to enable public verified-customer enrollment, free
welcome-credit eligibility and billing, and to redeploy the tested source.

## Verification after approval

1. Update only the named production audience variable; preserve its scope.
2. Build the exact source above in production and confirm domain assignment.
3. Verify an existing admitted account retains its balances and plan.
4. Sign in to the previously blocked, verified non-pilot account through secure
   browser authentication; confirm the restriction clears and setup works.
5. Verify reload/retry does not issue duplicate welcome credits. Keep unverified
   and signed-out access refused. Do not submit a payment for this check.
6. Run public boundary smoke and inspect recent runtime failures.

If admission itself causes an unexpected production regression, restore the
owner-only audience and rebuild the same source. That stops broader admission;
it does not erase enrollments or reverse purchases already completed. Preserve
all customer data and investigate through the existing recovery mechanisms.
