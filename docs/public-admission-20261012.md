# Public verified-customer admission — live and verified

## Production release

For CardResell project `prj_NJbWQ7VxpYIjzpCDj7X7vtmEdLbU` in team
`team_6s4mtmL1E2PlqUbMADRWtGNs`, changed only production
`MEMBERSHIP_LIVE_AUDIENCE` to `public`, then deployed commit
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
No secrets were retrieved or copied. No new application code was needed.

Deployment `dpl_5vLJCuhvqUHJVesAF4GJiTKsLba6` reached READY on
2026-10-12 at approximately 05:30 UTC, with both `cardresell.org` and
`www.cardresell.org` assigned and no alias error. The variable retained its
production-only scope and sensitive type. No other environment value changed.

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
Redis, not customer records.

## Authorization history

The attempted production-only environment update was rejected by automatic
approval review. Its stated reason: the broad verified-customer enrollment and
billing exposure requires explicit approval of this exact production-wide
switch; general permission to fix access was not sufficient. The tool reported
no update. No alternative route or narrower permission workaround was used.

The owner subsequently explicitly approved enabling public signup and billing
for all verified customers and deploying it. The authorized retry succeeded.

## Live verification

- Existing admitted Starter account retained 53 ID credits and 5 Grade credits.
- Previously blocked verified non-pilot account completed enrollment and showed
  15 ID credits and 2 Grade credits. The pilot restriction no longer appeared.
- Shop confirmed account-specific pricing and distinguished included credits
  (5 ID / 1 Grade) from the verification bonus (10 ID / 1 Grade).
- The non-pilot account opened live Stripe Checkout for 25 ID credits at $2.99.
  No payment details were entered and no payment was submitted.
- Returning through the checkout cancellation link preserved 15 ID / 2 Grade.
- A full page reload preserved 15 ID / 2 Grade after authentication settled;
  no duplicate verification award appeared.
- Production public-boundary smoke: 18 checks, 17 passed, 1 degraded, 0 failed.
  Signed-out protected routes remained refused and public catalogue reported
  anonymous purchasing disabled. eBay sold comps remained provider-unavailable;
  that is an unresolved availability issue, not a passing check.
- Warning/error/fatal runtime-log query for this deployment from
  05:37:12 to 05:42:12 UTC returned no entries during the non-pilot onboarding
  and checkout check. An earlier sample contained Node url.parse deprecation
  warnings from pricing routes; this is limited sampling, not proof of no errors.
- Payment fulfillment and phone tests were previously owner-confirmed complete.
  They were not repeated or reclassified as pending in this release.

Email-verification refusal and welcome-award concurrency/replay protections
passed preflight. This live check used a verified account; it did not create a
new unverified identity.

## Remaining work and rollback

Advertising readiness still requires resolving or clearly limiting the eBay
sold-comps dependency and the previously recorded navigation/draft-readiness
usability issues. This release removes the pilot admission blocker; it does
not claim the full site is advertising-ready.

If admission itself causes an unexpected production regression, restore the
owner-only audience and rebuild the same source. That stops broader admission;
it does not erase enrollments or reverse purchases already completed. Preserve
all customer data and investigate through the existing recovery mechanisms.
