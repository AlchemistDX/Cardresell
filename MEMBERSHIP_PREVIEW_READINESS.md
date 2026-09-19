# CardResell Preview readiness and owner actions

September 19, 2026. Production unchanged. This is an incomplete release checkpoint, not launch approval.

## Completed in this continuation

- Executable audited bootstrap is wired before account association. It atomically checks the durable legacy-writer fence and an exact server-owned audit record, creates enrollment once, and keeps a durable audit journal. Concurrent/repeated calls cannot reset subsequent paid enrollment. Missing or changed audit records fail closed before customer creation.
- Bootstrap does not grant credits, infer historical origin, set the global fence, or modify existing balances and welcome markers. The audit's `freeThrough` watermark and verification/capability fields require real operator evidence; zero is not a default for unknown history.
- A server-only `bindAuditedExisting` customer method verifies canonical Stripe account/customer/mode and atomically imports owner and reverse association with an evidence journal. It cannot overwrite conflicting associations, create a second customer, or associate by email. It requires an injected audited authority and is not exposed as a client action.
- Restricted test keys are accepted by customer, lifecycle-command and reversal transports. The existing Checkout/read transports already supported them.
- The new configuration validator requires a restricted mode-matching key, correct Vercel environment, trusted return origin, Portal configuration, exactly four paid plan mappings, seven pack mappings, and nonstacking coupon mappings. The test runtime uses it. Its live validation branch is preparation only: the composed runtime remains test-only and refuses Production.

## Datastore investigation

Project: `cardresell`, project ID `prj_NJbWQ7VxpYIjzpCDj7X7vtmEdLbU`.
Team ID: `team_6s4mtmL1E2PlqUbMADRWtGNs`.
Active local branch: `feature/launch-membership-v2`.

The Vercel environment metadata contains provider integration-store references, not merely environment labels:

| Effective scope | Vercel store resource ID | Binding |
|---|---|---|
| Preview for the active branch | `store_TBmlb2OlH8LyJL47` | General Preview/Development integration bindings |
| Production | `store_6dqT0OoumNHGCMVq` | Production-only sensitive integration bindings |

Both cite integration configuration `icfg_V77F59uqkmiPMMhVKxw1ACb7`, integration `oac_V3R1GIpkoJorr6fqyiwdhl17`, and product `iap_gpfB8wWHssmOi6P1`.

There are branch-specific sensitive overrides for `fix/listing-export-identity`, not the active membership branch. Those old overrides are not proof about this release.

The two store IDs differ, but actual provider database identity remains UNVERIFIED:

- GET `/v1/installations/icfg_V77F59uqkmiPMMhVKxw1ACb7/resources` was access-denied through the current Vercel connection.
- GET `/storage/stores/{storeId}` returned not-found for both IDs through the API.
- Production endpoint values are sensitive and were not retrievable; no secret was printed or persisted.
- Latest observed Production deployment: `dpl_CCHxcmyTiEjDnjBrNgwToy2fHa5V`. No membership-branch deployment was identified among the recent five inspected deployments.
- Current project bindings are not proof of the environment captured by an existing deployment.

No database-writing acceptance test was run against either managed environment. All database writes in this continuation were confined to disposable, process-owned local Redis sockets with no TCP listener.

## Exact missing access and consolidated owner actions

1. **Datastore resource identity and connections.** In Vercel, open team **willsep200-9430s-projects → cardresell → Storage**, then open each of the two store IDs above. If listed under the team's Storage page instead, open it there. Use the integration's provider dashboard link and inspect the database details and project connections. The missing capability is read access to integration installation resources and their provider database IDs, not permission to change ordinary project environment variables. Record the provider's database/resource ID for each store and which project/environment each is connected to. Confirm the two resources are physically distinct, and verify the latest Production deployment's binding. Non-secret resource IDs and connection-scope details are sufficient; do not send tokens, connection strings, or screenshots containing credentials.
2. **Secure test credential/configuration entry, only after isolation is confirmed.** The failed Stripe connector will not be retried. A test-account administrator must create the restricted test key through Stripe and enter it directly in Vercel's sensitive, Preview-only environment UI. Do the same for the test webhook signing secret. No credential should enter chat, Git, `.env`, a browser bundle, or a log. The Portal configuration and canonical test catalogue must be verified in that same test account. This is credential/dashboard access, not a new approval request.
3. **Normal-site authentication during acceptance.** Use the ordinary Firebase sign-in on the isolated Preview. Supply only the intended test Firebase UID(s) for the allowlist, not passwords or ID tokens in chat. The real account-switch and scan cases require the normal authenticated flow.

No additional purchase, migration, or Production permission is requested. Existing authorization remains subject to the release gates.

## Prepared Preview configuration

Set these only as sensitive Preview-scoped values, preferably explicitly scoped to the membership release branch. Do not copy a Production secret or bind a Production datastore:

| Variable | Required source |
|---|---|
| `MEMBERSHIP_PURCHASE_TEST_MODE` | `enabled` |
| `MEMBERSHIP_STRIPE_TEST_KEY` | Restricted test key; `rk_test_` mode, held only in Vercel |
| `MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET` | Secret for the actual membership test endpoint |
| `MEMBERSHIP_STRIPE_TEST_ACCOUNT` | Canonically verified test account ID |
| `MEMBERSHIP_STRIPE_TEST_PRICES` | Server mapping of four recurring and seven pack product/price pairs |
| `MEMBERSHIP_STRIPE_TEST_COUPONS` | Free/Starter null; unique Casual 10%, Pro 15%, Business 25% coupon IDs |
| `MEMBERSHIP_STRIPE_TEST_RETURN_ORIGIN` | Fixed HTTPS origin of the normal Preview site, not Production |
| `MEMBERSHIP_STRIPE_TEST_PORTAL_CONFIGURATION` | Test Portal configuration; payment methods/invoices enabled, period-end cancellation, subscription switching disabled |
| `MEMBERSHIP_TEST_NEW_CUSTOMER_OWNERS` | Explicit approved Firebase UID array |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Bindings from the independently verified test datastore |

Configure billing-route activation only after audited bootstrap and writer fencing are ready. The global fence is not automatically set by bootstrap; establishing it requires draining old writers, not merely changing a flag. Preserve old records and markers.

The key needs the resource capabilities actually used by the server: account/customer reads, customer creation, Checkout creation/read, price/product/coupon reads, invoice and related payment/charge/refund/dispute reads, subscription and schedule reads, Portal configuration reads and session creation. Schedule mutation is needed only for the explicitly rehearsed migration. Match these to the available Stripe restricted-key permissions and verify read-only preflight; do not grant unrestricted access to compensate for unknown permissions.

Configure the raw-body membership webhook route and select only supported event types. No endpoint has yet been created. The implemented event list is in `MEMBERSHIP_MVP_RELEASE_STATUS.md`.

After secure configuration: redeploy Preview; record deployment ID, exact Git SHA and asset hashes; verify the deployed datastore binding and normal Firebase sign-in; then execute the cases below. No managed write is authorized by the presence of variables alone.

## Automated verification for this continuation

`bash tools/run-membership-gate.sh <evidence-directory>`: **27 suites, 3,636 passed, zero failed**.

New/changed focused results: bootstrap 17; environment 19; customer 34; account routes 25. Remaining focused suites: lifecycle 187, lifecycle transport 17, reversal transport 88, fulfillment 12, paid enrollment 14, consumption 119, ledger 281, payments 625, bindings 284, read transport 246, checkout controller 313, checkout transport 519, purchase routes 52, shop identity 25, normal membership routes 55, scan intent 70, catalogue 82, registry 12, scan 36, webhook offline 4, ID confirmation 365, entitlements 72, remediation 63.

`bash tests/run-all.sh --local`: **ALL CHECKS PASSED**. The runner has 69 slots, with three explicit skips: real-store tests, Production smoke, and optional condition-applicability browser interaction. These are not counted as real acceptance.

## Real acceptance

| Case | Status |
|---|---|
| Five tiers, seven packs, permanent-credit wording and authenticated discounts | UNRUN |
| ID pack purchase and one grant | UNRUN |
| Return/webhook replay without second grant | UNRUN |
| Grade pack and separate balance | UNRUN |
| Each of four canonical test subscription prices | UNRUN |
| Initial paid invoice, correct credits once | UNRUN |
| Renewal adds one permanent allocation | UNRUN |
| Failed renewal then successful recovery | UNRUN |
| Cancellation preserves paid-through benefits and all credits | UNRUN |
| Interrupted Checkout/return recovery, no duplicate session | UNRUN |
| Cross-account checkout/return rejection | UNRUN |
| Duplicate/concurrent signed webhooks | UNRUN |
| Refund and dispute hold/review observation | UNRUN |
| Owner legacy-to-Casual migration rehearsal | UNRUN |
| Normal ID/Quick/Deep debit and exact-source refund | UNRUN |

## Remaining implementation, not owner chores

- Produce audited bootstrap records from verified account history and cutover evidence. The new executor is implemented; production/new-signup audit provisioning is not complete.
- Wire the direct owner association authority to the single verified legacy subscription. Implement its trusted legacy-origin terms and controlled renewal schedule, with canonical readback and first Casual invoice fulfillment. The association primitive does not complete the migration.
- Complete live-mode composition across customer/lifecycle/reversal transports after mode-isolation tests. The new live configuration validator does not make the test-only runtime live-capable.
- Verify inactive Free-account monthly issuance/backfill without inventing historical eligibility.
- Complete normal-site managed acceptance, a compatible rollback deployment, backup record, live configuration/preflight and controlled owner purchase.

The October 7 migration is NOT SCHEDULED. No immediate charge, prorated charge, midperiod grant, live purchase, new deployment, or live activation occurred.
