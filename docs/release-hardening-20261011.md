# Existing-release hardening — October 11, 2026 (New York)

Execution continued October 12 UTC. Priority is the current customer journey;
new connected-selling feature development is paused pending release acceptance.

## Verification outcome

The final complete runner execution exited 0 and reported ALL CHECKS PASSED:
116 local sections ran successfully out of the 118-section registry. The live
production-store and production-endpoint sections were explicitly skipped and
are not passes. The normally opt-in condition browser section was enabled and
passed all 17 checks. Separate workflow checks (23 journal, 19 scan mapping,
6 auth, 10 catalog), configured build and 9 market-total checks also passed.

Earlier runs exposed hardcoded browser paths and stale test fixtures. The final
run used the corrected fixtures and shipped-function assertions described below.
One intermediate condition run failed because a separate tool session's local
server was unreachable; hosting the checkout in the runner's own environment
resolved that infrastructure failure. No acceptance assertion was removed to
conceal a product failure. This evidence is local/synthetic; it establishes
neither real-phone accuracy nor live payment/provider acceptance.

## Corrections

- Removed a Star City Games Ship + Sell service-fee warning from eBay's venue
  metadata. The existing SCG-specific explanation remains with SCG.
- Replaced unsupported "lowest fees/cheapest anywhere" language in Mana Pool
  and Cardsphere descriptions. Cardsphere's low-price recommendation now points
  out its cash-out minimum rather than implying a universal effective rate.
- Published the edited client under a new immutable filename,
  `core.d921811b.js`, and updated the HTML reference. Retained the prior bundle
  for cached-page compatibility. No fee arithmetic or fee-audit date changed.
- Repaired browser-test runtime discovery: use configured Playwright/Chromium
  paths or the normal package import rather than one former machine's absolute
  path. Existing assertions and failure/completion reporting remain enforced.
- Updated the printing-evidence fixture to supply the existing authenticated
  owner and successful photo-preflight dependencies. The same tests still prove
  a local artwork hit cannot bypass server printing identification.
- Replaced quantity-expression regex checks and a duplicate local pricing
  implementation with execution of the actual market tracker. Verify multiple
  copies, missing quantity, failed rows, cents and totals without purchase cost.
- The opt-in condition browser check blocks off-origin requests and suppresses
  the unrelated first-visit demo. It still verifies 17 actual raw/graded/sports
  condition-control behaviors.

## Acceptance still required before broad paid acquisition

| Gate | Concrete next action | Evidence to retain |
| --- | --- | --- |
| Real-phone scanning | Follow the existing camera acceptance script on a physical iPhone; exercise glare/zoom, cancel/retry and live Deep-to-Quick fallback | Device/browser, date, scenarios and observed results; no synthetic accuracy claim |
| Fresh-customer purchase | Prepare a genuinely fresh nonpilot test account and walk signup, email verification, welcome grant, checkout and fulfillment after the admission decision | Exactly one welcome grant, consistent billing/credit receipts and entitlement after reload; no secrets/screenshots in public docs |
| Costs and operating limits | Reconcile actual provider usage with invoices; verify current plan allowances, overage behavior and enforced ceilings | Cost per successful task, retry cost, alerts/owners and maximum expected exposure |
| Hosted recovery | Confirm actual backup availability/retention and restore a backup to a disposable isolated database | Restore duration, snapshot age, record/expiry/invariant checks and reconciliation plan |
| Measurement and claims | Run a tagged QA journey; reconcile browser funnel events with authoritative fulfilled payments; review every ad claim against the live release | Observed events distinguished from unique customers/revenue; no dormant feature advertised |

No available connector in this session provides Upstash backup/restore control.
An isolated Redis unit test is not evidence that hosted backups exist or that
they can restore this deployment. These operational gates remain open; a green
local suite does not replace them. No admission, billing, provider, advertising
or production deployment setting changed in this continuation.

## Deployed checks — October 11, 2026, 23:00–23:07 New York

Retried the previously pending Vercel deployment for commit
`c14124ddb277d58861d6727a4ca255f8eca672d6`. Deployment
`dpl_B89DHcqBsSaS4nrzHNNerGuivcWM` is READY; its Vercel GitHub status and
foundation workflow are successful.

- Production homepage returned 200. Its SHA-256 remains
  `cfa4a1870e2c20c1f40c6172e635d14f8b76e7649c7b460018edcdf49af5d9dc`.
  The public membership catalogue returned JSON/200 with
  `purchaseEnabled: false`. Unauthenticated drafts and user-data GETs returned
  401. These are availability/authentication checks, not paid-flow acceptance.
- Initial raw preview requests followed Vercel's login redirect and returned
  HTML/200. They were **not** counted as application passes. Retried through the
  connected account's protected-deployment fetch without disabling protection.
- The actual preview homepage returned 200. Its application HTML exactly
  matches the committed index, followed only by Vercel's injected feedback
  script. The served `js/core.d921811b.js` matches the committed blob exactly.
  The public catalogue returned JSON/200 with purchases disabled.
- The preview's drafts and user-data GETs returned JSON/503,
  `{"error":"Storage unavailable"}`. Both handlers emit this response when
  `KV_REST_API_URL` or `KV_REST_API_TOKEN` is absent, before checking application
  authentication. This is an unresolved preview configuration blocker, not
  evidence that those flows work. The foundation branch has no branch-specific
  environment variables in the configuration metadata returned by Vercel.
  The configured preview KV credentials are scoped to other branches; none
  apply to the foundation branch.

Next deployment acceptance step: configure a verified isolated preview store
for this branch, with preview-scoped credentials and side effects fenced,
then redeploy and run authenticated draft/Collection persistence and recovery
checks against it. Do not copy production storage credentials into this branch.
Keep membership/payment acceptance on its separately controlled path.

No live-store writes, provider-backed smoke requests, payment attempts, emails,
or production promotion occurred during these checks. The legacy full endpoint
smoke and live-store suite remain unexecuted; the targeted GET checks above do
not replace them.

## Hosted restore drill procedure

1. Record the source database and backup identifiers, timestamp, retention and
   recovery target. Confirm the exact service plan supports the proposed path.
2. Restore into a separate disposable database. Do not overwrite production or
   attach the restored data to active billing, mail, seller publication or other
   side effects. Keep credentials and customer data out of logs/repository files.
3. Compare relevant record families and expiry behavior, not just total keys:
   membership ledger/bindings, grants/debits/refunds, operation receipts, draft
   ownership, Collection data and deletion markers. Record aggregate checks and
   anonymous fixture results rather than exporting customer records publicly.
4. Exercise representative read/recovery paths against the isolated restore;
   expired records must not become persistent, and retained deletion/receipt
   records must still prevent stale replay. Treat snapshot-after effects and
   external payment events as reconciliation work, not automatic replays.
5. Measure restoration time and lost-write window; document the exact safe
   reconciliation and cutover procedure. Review discrepancies before declaring
   recovery ready. Remove the disposable copy under the agreed retention plan.

This procedure is prepared, not executed. Production restoration is a separate
action; passing the drill is not authorization to overwrite the live database.

## Reproduce local verification

Use Node 20+, Playwright, a Chromium executable, and an isolated local Redis
runtime. Configure `CR_PLAYWRIGHT`, `CR_CHROMIUM` and any Redis executable path.
`CARDRESELL_TEST_REDIS_TCP=1` enables the test harness's loopback fallback.

Run `bash tests/run-all.sh --local`. For the condition gate, serve this checkout
on loopback in the same execution environment, set `SITE_BASE` to that origin
and `COND_PILLS_BROWSER=1`. The server and browser must share a network namespace;
an independently launched tool session may not do so. Also run
`npm run workflow:check`, `npm run vercel-build` and
`node tests/bulk-market-total.mjs`.

The legacy production smoke includes a scan-miss POST and provider-backed GETs;
it was deliberately not represented as a read-only or offline acceptance test.
The live-store gate likewise remains separate. Neither skipped gate counts as
a pass, and neither would by itself prove fresh-account payment acceptance.
