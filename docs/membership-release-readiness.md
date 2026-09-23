# Membership release readiness

This checkpoint follows `7fdc005` and `2c3fe9e` on `feature/launch-membership-v2`. It is an implementation and local-test checkpoint, not completed payment acceptance or authorization to bypass the launch gates.

## Authenticated enrollment

Membership authentication now accepts only a cryptographically verified Firebase subject with verified-account status. It does not use the legacy Google tokeninfo/email-to-UID fallback. Unverified identities, malformed temporal claims, wrong audiences/issuers, invalid signatures and mismatched subjects fail before account operations.

The normal account association route passes its server-authenticated identity into enrollment. After the existing audited provisioner and bootstrap succeed, it issues permanent Free catch-up and the separate welcome award through the existing ledger. Welcome execution checks the current Free enrollment and writer fence atomically. Historical owner/email bonus markers suppress another award without reassigning ownership or changing old balances.

Lost responses replay existing financial journals. Paid enrollment is preserved and receives no new Free/welcome award. Monthly issuance remains lazy catch-up from the recorded eligibility baseline, not an inferred signup month or a background scheduler.

## Local verification

`bash tools/run-membership-gate.sh <evidence-directory>` now runs 33 suites/checks, including the formerly standalone provisioner, catch-up and preflight checks.

At this checkpoint the focused gate reports **3,697 passed, 0 failed**. New strict-authentication tests report **19/0** and normal enrollment-flow tests **9/0**. The complete `bash tests/run-all.sh --local` gate passes; its real-store, Production-smoke and optional condition-browser slots remain explicitly skipped.

The permanent-credit financial ledger, consumption and payment modules are unchanged. Synthetic Redis/HTTP/token tests are not real Firebase login, managed-database or Stripe purchase acceptance.

## Managed Preview prerequisites

The existing Preview preflight still reports 32 passing Stripe configuration checks. The managed database is readable, but its durable writer fence is absent. Old-writer credential revocation has not been demonstrated. No enrollment audit may truthfully claim old writers are drained based solely on an environment label or a newly set fence.

Preview resource: `upstash-kv-aureolin-door`, Upstash ID `b0de2137-6c5c-41b4-8af4-da80a70ce1c3`. Production resource: `upstash-kv-bistre-arrow`, ID `dc621a30-497c-4851-a3c3-42a51309f094`. The owner confirmed these are separate. That isolation does not revoke credentials captured by older Preview or Development deployments.

Before managed enrollment:

- Retain a provider backup and record its identifier.
- Revoke the old Preview database credentials at the provider, accounting for Development clients sharing that resource. Do not rotate the Production resource.
- Make replacement write credentials available only to the reviewed branch and compatible rollback build. Stop or isolate conflicting Development writers rather than handing them replacement write credentials.
- Verify deployed bindings, denial of old credentials, and completion of in-flight old requests. Record actual evidence, not fabricated attestations.
- Install the durable fence through the controlled cutover, then exercise enrollment on the normal authenticated route.

Upstash documents that resetting a database password revokes its standard and read-only REST tokens. For integration-managed resources, the documented dashboard path is Vercel Integrations → Upstash → Manage → affected resource → Open in Upstash → Reset Credentials/Reset Password; replacement configuration must propagate and the intended deployments must be redeployed. See [Upstash REST token documentation](https://upstash.com/docs/redis/features/restapi) and [Upstash integration credential rotation guidance](https://upstash.com/blog/rotate-upstash-secrets-after-vercel-incident).

## Gates not cleared

Managed enrollment, normal Firebase sign-in and real sandbox purchase/lifecycle acceptance remain unexecuted. The controlled legacy-origin migration still needs its executable binding, schedule/readback and first-renewal rehearsal. October 7 is not a confirmed schedule.

Production runtime activation, live catalogue verification, provider backup and a deployed compatible rollback are not complete. Production must not be enabled on the strength of local tests or test-mode mappings.

Keep purchasing off until the writer transition and normal enrollment are verified. Do not reset uncertain financial claims, delete journals, expire credits or revert to a pre-fence build.
