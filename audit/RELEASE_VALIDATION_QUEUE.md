# Release-validation queue

> **Citation provenance.** Bundle citations in this document were
> re-resolved on 2026-09-09 against **`js/core.53a0674d.js`** at commit
> **`5a4ce14`**. They were resolved by matching the *content* of each
> cited line in its original generation — every retired generation is
> retained on disk — not by offsetting line numbers, and each was
> re-verified after rewriting (`tools/resolve-citations.mjs`).
>
> Citations that are **historical evidence for a closed finding** were
> deliberately left at their original generation and commit, with a note,
> rather than redirected to today's code.
>
> | was | now | function |
> | --- | --- | --- |
> | `core.3f83abec.js:3556` | `:3708` | `loadCardUI()` |

Checks that cannot run offline in this sandbox and must run before release.
Created 2026-09-08. This file exists because "carry it into release validation"
was previously said in prose and then lived nowhere — a queue nobody can read is
not a queue.

Each entry states what to run, what must be true, and **why the offline
assertions are not sufficient**. That last column is the point: several entries
have passing source-level assertions, and a source assertion establishes where a
field was written, never that it arrives.

---

## ADJUDICATED 2026-09-09 — verdicts

Every entry below now carries a verdict: **passed**, **blocking**, or
**deferred with its limitation**. The offline and read-only items were finished
without waiting on credentials; three items that had been parked behind "needs
Playwright and a local server" were run on 2026-09-09.

| Item | Verdict |
| --- | --- |
| RV-1 grade response contract | **BLOCKING** — needs the deployed function |
| RV-2 T2.14 disclosure accessibility | **DEFERRED** — needs a real screen reader; dagger name still unverified |
| RV-3 eBay live suite | **BLOCKING** — Production-only credentials (G2) |
| RV-4 draft KV live | **BLOCKING** — no live KV binding (G1) |
| RV-5 flip completeness | **PASSED** — re-run 2026-09-09, 22 / 0 |
| RV-6 rendered ranking | **PASSED, narrowed** — re-run 2026-09-09, identical in 4 / 4 cases, two default-tier rows only |
| RV-7 D7 listing photos | **PASSED** — re-run 2026-09-09, 92 / 0; Safari/iOS limitation retained |
| RV-8 preview reads production KV | **CONFIGURATION CLOSED, deployed proof pending** — verified 2026-09-10 00:20 from the Vercel CLI: the five KV names now exist as **two disjoint groups**, Production and Preview+Development, so Preview no longer resolves to the production store. Preview writes remain unproven — the 21 existing Preview deployments all predate the split and were built against the production store, so a **fresh** Preview is what proves it (see §Redis reconciliation) |
| RV-9 the other eighteen live checks | **BLOCKING** — same gate as RV-3 |
| RV-10 containment mechanism | **EXECUTED for KV, verified by listing** — the second Redis database was created and the targeting is disjoint (Production vs Preview+Development), confirmed 2026-09-10 00:20. The earlier row read "designed, not executed" and is corrected. Cause and rejected alternatives retained in §4. **Three non-KV production resources are still reachable from Preview** — see §Redis reconciliation. |
| CH-1 published verification token | **BLOCKING** — G3; replacement token is step 3 of the rotation window |
| CH-2 code fallback to that token | **CLOSED IN CODE at `6c610e2`** — the literal is gone, the token is read at call time, and an absent token fails closed with `503 verification_token_unset`. Reaches production when the release deploys. *(An earlier row here said "prepared, not applied" — wrong, and corrected 15:12.)* |
| CH-3 unencrypted TPL key | **CLOSED at `c4ea5e4`** — #518 revoked, replacement verified by post-revocation lookups, storage type now `sensitive` (`3570d97`). Public and plain-storage exposures both closed. **Do not re-open; the TPL rotation is done.** Only G12 / R4 activation remains, tracked under release preparation. |
| Same-card basis retention | **DEFERRED** — product decision; consequence is disclosed, not silent |
| D5 §8.3 signed-in continuation | **PASSED for one tested case**; stays in the queue. Q-D5-5 desktop never exercised |

**4 passed · 7 blocking · 2 closed · 3 deferred.** Every blocking item is
credential-, configuration-, or deployment-gated. None is blocked on writing
more code. **Closed** means done and evidenced — CH-2 in code at `6c610e2`,
CH-3 by the completed rotation at `c4ea5e4`. Neither is owner work any more;
CH-2 reaches production with the release, and the only TPL item left is R4
activation (G12).

*Counts and verdicts in this table are current as of 2026-09-09 15:12 EDT.*
*Anything in the History and withdrawn sections below is dated evidence, not*
*live status — see the banner above those sections before treating an entry*
*there as a blocker.*

## RELEASE PREPARATION — the remaining items (opened 2026-09-09, corrected 15:12 and 15:25)

> **CORRECTION, and it is mine.** The first version of this section, written at
> 15:00, told the owner to perform a TPL rotation **that was already complete**,
> described CH-2 as an unwritten one-line edit **when the code change is
> committed**, and claimed the proxy is "metered but unenforced" **when
> enforcement off means not metered at all**. It also proposed budget numbers
> without accounting for the clustering in our own request shape, or for the
> provider-side 429 this session had already seen. A later revision then
> overstated that 429 as an established two-second window — corrected again at
> 15:25, and the standing description is that the provider's precise limit is
> **unknown**. Each error came from rewriting a summary against older
> prose instead of against the branch. The corrected text follows; the errors
> are named rather than quietly patched, because a release checklist that
> re-opens finished work is worse than no checklist.

RV-13's local implementation is complete and adjudicated; it is no longer the
head of this queue. What follows is, and **none of it is code**.

**Authorization recorded 2026-09-09 15:31 EDT:** Will granted permission to
push what Phase 1 needs. Recorded, and deliberately **not acted on yet** —
authorization was never the constraint here. The first Phase 1 push is gated by
containment (steps 11a/11b of the rotation checklist), whose control has not
been read yet, and that gate exists to stop a push from deploying into a shared
store. A standing permission does not remove a technical prerequisite, so the
push waits on containment rather than on consent.

Nothing below has been executed. Local implementation is not authorization, and
authorization is not readiness.

### Already closed — do not re-open

| Item | Closed by | Evidence |
| --- | --- | --- |
| **G11 / R1 — TPL key rotation** | `c4ea5e4` | **Key #518 revoked.** Three post-revocation lookups through www on novel terms with fresh cache keys returned 200, `x-vercel-cache MISS`, age 0 — with #518 dead, no other credential could have produced them. This is the one observation in the sequence that needs no inference. |
| **CH-3 — TPL key exposure** | `c4ea5e4`, storage at `3570d97` | Closed as worded: the **public** exposure and the **plain-storage** exposure are both closed. Storage type is now **`sensitive`** — write-only, not merely `encrypted`, because `encrypted` is readable back via `decrypt=true` and would have left the read-back path open. |
| **CH-2 — published token fallback** | `6c610e2` | **The change is written and committed.** `api/ebay-notifications.js` now reads `cleanCredential(process.env.EBAY_VERIFICATION_TOKEN) \|\| ''` at call time; there is no literal. An absent token fails closed with `503 verification_token_unset` and no `challengeResponse` field. It reaches production when the release deploys — that is deployment, not authorship. |

**TPL rotation needs no further action.** The only TPL item still open is
**G12 / R4 activation**, which is item 3 below.

### 1. eBay credential rotation and verification — the next owner task

The one credential task left. The procedure is written and self-contained
(`audit/ROTATION_EXECUTION_CHECKLIST.md`); the pre-flight configuration has been
read; the harness has been corrected so it no longer compares production against
the committed literal it was serving — it was agreeing with itself.

The verification token is **replaced with a fresh random value**, never the repo
literal nor that literal with the newline stripped: whitespace-cleaning a
published value leaves a published value in production. **CH-1** closes when
production stops serving the repo default and eBay's challenge completes against
the new token.

### 2. Deployment containment and non-production KV isolation

**Still blocking, but the mechanism is now ESTABLISHED** (RV-8, RV-10) — as of
2026-09-09 15:48, from the owner's dashboard readings. Both halves are settled
and neither is an inference.

**Cause.** Five store variables each exist as a **single row targeting
`production,preview,development`**: `KV_REST_API_URL`, `KV_REST_API_TOKEN`,
`KV_REST_API_READ_ONLY_TOKEN`, `KV_URL`, `REDIS_URL`
(`audit/ROTATION_GATE_ANSWERED.md:82-86`). One row carries one value to every
environment in its target list, so Preview and Development read **the same store
as Production**. Established from the configuration's shape — no secret
decrypted. All five share `createdAt 1783172908043`, the signature of one
integration writing one store's credentials, and `GET /v1/storage/stores`
returns `{"stores": []}`, which together indicate **an integration rather than a
first-party Vercel store** — without identifying which provider. The blast radius is wide: **32 files under `api/`
read `KV_REST_API_URL`**, so this is not only R4's problem.

**Remedy.** Not a deployment gate. The project's Environments page exposes
**Production / Preview / Development** as first-class environments, and Vercel
supports **different values for the same key per environment**, so isolation is
achieved with a second Redis database and a **disjoint** final assignment.

**Correction to my own instruction (15:57): "override" was wrong.** I said to
add Preview/Development rows and leave Production's rows untouched. That cannot
work, and the reason is the same fact that caused the leak: **each existing row
already targets `production,preview,development`.** A new row cannot claim
Preview while an existing row still claims it — the assignments must be made
**disjoint**, which means *editing* the existing rows, not merely adding to them.
Left as I first wrote it, the change would have been rejected as a conflict or
left Preview still pointed at production data. The target state is:

| Value | Environments |
| --- | --- |
| Existing production database credentials | **Production only** |
| New non-production database credentials | **Preview and Development only** |

For all five names: `KV_REST_API_URL`, `KV_REST_API_TOKEN`,
`KV_REST_API_READ_ONLY_TOKEN`, `KV_URL`, `REDIS_URL`.

**Changes apply only to new deployments**, consistent with what the key rotation
already demonstrated — an environment change needs a fresh deployment to carry
it, and reading a value at call time does not alter that.

**The provider is not yet identified.** The shared `createdAt` and the empty
`GET /v1/storage/stores` response together indicate *an integration rather than
a first-party Vercel store*, and that is all they establish — **they do not name
which provider.** Identifying it from the integration or variable metadata is
step 1 below, before any database is created. I previously wrote "marketplace
Redis provider" as though the vendor were settled; it is not.

**The included custom environment is not needed.** Standard Preview and
Development scopes already provide what Phase 1 requires, so the plan uses no
custom environment and incurs no additional cost.

### Execution order — owner, and none of it executed

1. **Identify the actual Redis provider** from the integration or variable
   metadata. **Partly advanced 2026-09-09 17:03** from the owner's Environment
   Variables page: exactly the five KV rows — `KV_REST_API_URL`, `REDIS_URL`,
   `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL`, `KV_REST_API_TOKEN`, all *Added
   Jul 4* — carry a **provider badge beside the name that no other variable on
   the page has**. That corroborates integration ownership from a second,
   independent surface. **The badge is not legible at this resolution and the
   provider is still unnamed** — I am not guessing a vendor from an icon.
   Corroboration on the cause: all five display **"All Environments"** in the
   dashboard, matching the API's `production,preview,development` targets
   exactly. **Safeguard 1's stop condition is therefore live**, not
   hypothetical: these are integration-managed rows, so whether they can be
   edited at all must be established before step 4.

   Also visible and worth separating: the five KV rows show the `<>` glyph and a
   reveal control, unlike `TURNSTILE_SECRET_KEY`'s padlock. They are **not**
   write-only sensitive, so they are readable back — the same weakness the TPL
   key had before it was moved to `sensitive`. Note it; it is not part of this
   step.

   **CLOSED 2026-09-09 17:06 — provider identified, and Safeguard 1's stop
   condition both triggered and resolved.**

   **Provider: Upstash for Redis**, store **`upstash-kv-bistre-arrow`**, plan
   shown as **Free**, created **Jun 30** (Storage page). Read from the label, not
   inferred from the badge.

   **The rows cannot be edited — Safeguard 1 triggered as written.** The `···`
   menu on `KV_REST_API_URL` offers **Manage Connection · Rotate Integration
   Secrets · Copy to Clipboard · View History · Delete**. There is **no Edit**.
   So step 4 as I wrote it — "retarget each existing row" — is **not performable
   on the variable rows**, and the instruction to stop was correct.

   **The supported method is the connection's scope, one level up.** The Storage
   page shows the store with an environment-scope control reading **"All
   Environments"**, with a selector. Environment assignment for
   integration-managed variables is a property of the **connection**, not of the
   individual rows. Revised step 4: **narrow the existing connection to
   Production, then connect a second Upstash database scoped to Preview and
   Development.** Same disjoint target state, reached through the surface that
   owns it.

   **What that control does to the five rows is expected, not established.**
   Narrowing the connection should rewrite their targets to Production; that it
   does so, and cleanly, must be **read back from the Environment Variables page
   after the change** rather than assumed. Step 5 already requires that check.

   **Cost — partly answered, and it raises a decision (17:25).** The existing
   database is **Upstash for Redis - Free**. The **Install Integration →
   Installation Plans** screen reached from *Create Database* lists **no free
   option in the visible region**: Pay As You Go at **$0.2 per 100K commands**,
   then Fixed 250MB **$10/mo**, Fixed 1GB **$20/mo**, and upward to 500GB at
   **$1500/mo** — each *plus* a per-read-region multiplier. Whether a free plan
   exists above or below that scroll region is **not established**.

   **Before treating that as the price, note the flow may be the wrong one.**
   That screen says *Install Integration*, i.e. a **new installation** with its
   own plan — not a second database inside the existing one. The existing store
   page carries an **All Databases** tab alongside *Installation*, which implies
   the current installation can hold more than one database. **Creating the
   second database inside the existing installation is the path to try first**,
   both because it may inherit the current free plan and because a fresh install
   of the same integration is exactly the event that could rewrite the five
   variables just retargeted (the standing warning against reconnecting).

   **QUESTION FOR WILL — Q-CONTAIN-1.** If the existing installation cannot hold
   a second database and isolation requires a paid plan, which do you want?
   (a) **Pay As You Go, $0.2 per 100K commands** — for preview-only traffic this
   is close to nothing, but it is a real recurring charge and a new vendor
   commitment; (b) **stay free by other means** — reuse a single database with a
   key prefix per environment, which is *weaker isolation* since one credential
   still reaches both datasets and a prefix bug crosses them; (c) **another
   provider** — the dialog also offers *Redis - Official Redis for Vercel*,
   unpriced here. **This is a spend decision and remains yours. Not
   recommended-by-default, not assumed.** My own lean is (a) if the existing
   installation refuses, because (b) reintroduces the shared-credential shape
   this whole item exists to remove.

   **NEW FINDING 2 (17:20) — `CARDSELL_TPL_KEY` targets Production AND
   Preview.** Visible on the same page, padlocked, "Updated". This is the paid
   PriceCharting credential — the replacement issued after #518 was revoked at
   `c4ea5e4`. A Preview deployment can therefore **spend production TPL quota**,
   against a provider plan of 10,000/day that R4 exists to protect. Isolating KV
   does not touch it: KV governs the budget *counter*, while this variable
   governs *access to the paid API itself*. Two consequences worth stating
   plainly. First, it is a live exposure now, independent of Phase 1. Second, it
   would corrupt item 3's verification — testing R4 in Preview against the
   isolated store would still issue **real, chargeable** calls, which collides
   with the standing rule not to demonstrate abuse by consuming paid quota. The
   remedy is the same shape as the eBay credentials, which are already
   `production` only: **retarget `CARDSELL_TPL_KEY` to Production only**, and
   decide separately whether Preview gets its own low-value key or none.

   **CLOSED 2026-09-09 17:33.** `CARDSELL_TPL_KEY` now reads **Production**,
   Secret, updated 10m ago — down from "Production and Preview". Preview can no
   longer spend production TPL quota, which also removes the obstacle to
   verifying R4 in Preview without issuing chargeable calls. **Still open as a
   choice, not a defect:** whether Preview eventually gets its own low-value TPL
   key or stays without one. Unbound is the safer default and is what is in
   place.

   **Noted for Task B while the page was open:** `EBAY_APP_ID`,
   `EBAY_CERT_ID`, and `EBAY_VERIFICATION_TOKEN` are Production-scoped but typed
   **`Config`, not `Secret`** — readable back, unlike `CARDSELL_TPL_KEY`. Since
   the rotation replaces the Cert ID and verification token anyway, and the
   Sensitive toggle **is** available for Production-scoped variables, the
   replacements should be written as **Sensitive**. Cheap hardening at the exact
   moment the values change; not a reason to alter the rotation's order.

   **NEW FINDING — a second shared store, outside RV-8's scope.** The same
   Storage page lists **`cardresell-blob` (Blob Store, Private, created Jun 30)**
   scoped **"Production, Preview"**. Preview therefore shares **production blob
   storage** as well. This is the same class of defect as RV-8 and is **not**
   addressed by any Redis work. Recorded here so it is not mistaken for covered;
   it needs its own decision before isolation can be called complete.
2. **Create the second database** there. **DONE 2026-09-09 17:31.**
   **`upstash-kv-aureolin-door`**, Upstash for Redis, **Pay As You Go**, primary
   region `iad1`, connected to project `cardresell` ("Connected Project
   cardresell to Database"). Creation parameters recorded: **Prod Pack
   (+$200/month) False**, **Auto Upgrade False**, **Eviction False**, Read
   Regions none, Max Commands/sec 10000. Eviction False is deliberate — an
   evicted budget counter reads as "no spend yet" and would silently reopen R4's
   cap. The production database `upstash-kv-bistre-arrow` **remains on Free**;
   the Pay As You Go charge applies only to the new non-production store. Will
   took option (a) of Q-CONTAIN-1 knowingly.

   **VERIFIED 2026-09-09 17:33 — both halves, disjoint, unprefixed.** The
   Environment Variables page now groups the rows by owning store:

   | Store | Names | Environments | Type |
   | --- | --- | --- | --- |
   | `upstash-kv-bistre-arrow` | the five | **Production** | Secret |
   | `upstash-kv-aureolin-door` | the five | **Preview and Development** | Config |

   The five are `KV_REST_API_READ_ONLY_TOKEN`, `KV_REST_API_TOKEN`,
   `KV_REST_API_URL`, `KV_URL`, `REDIS_URL` in both groups — **identical names,
   no prefix**, so the 32 files under `api/` bind in every environment and
   Preview is isolated by *pointing elsewhere*, not by pointing at nothing. The
   two failure modes watched for — an overlapping Production claim, and a
   silently prefixed set — **did not occur.** The target state set at 15:57 is
   reached.

   `Config` versus `Secret` in that table is the Sensitive gap recorded at
   17:29, visible here as the exact shape predicted: the production set is
   write-only, the non-production set is readable.
3. **Save its credentials directly into Vercel.** Never into this session, never
   into a local file, never into a commit message.
4. **Superseded 17:06 — the variable rows have no Edit.** Do it at the
   connection instead: **narrow the existing `upstash-kv-bistre-arrow`
   connection from All Environments to Production**, then **connect the second
   database scoped to Preview and Development**. The target state is unchanged;
   only the surface is.

   **Order within step 4 is load-bearing (17:15).** Narrow the existing
   connection to Production **first**, and only then connect the second
   database. Both connections inject the *same five key names*; while
   `upstash-kv-bistre-arrow` still claims All Environments, a second store
   scoped to Preview/Development would be claiming key names already held there.
   **Confirmed live at 17:18**, no longer a prediction: attempting to connect
   `upstash-kv-bistre-arrow` to Production while it already holds All
   Environments returns **"This project is already connected to the target store
   in one of the chosen environments"** with **Connect Project disabled**.
   Vercel refuses an overlapping claim outright — so the second store cannot be
   connected to Preview/Development until the first connection stops claiming
   them. Narrowing first vacates Preview and Development so the
   second connection lands on unclaimed names.

   **Two settings in that dialog decide whether the second connection works.**

   *Custom Environment Variable Prefix — leave it at the default.* The dialog
   offers a prefix (shown as `STORAGE` → `..._URL`). A prefixed connection would
   inject `STORAGE_KV_REST_API_URL` and similar, and **no code reads those
   names** — all 32 files under `api/` read `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` verbatim. A prefix would produce a Preview deployment
   that is isolated only because it is bound to nothing, which would pass a
   careless isolation check for entirely the wrong reason. The second connection
   must inject **the same five names**, differing only in environment.

   *Sensitive toggle — UNAVAILABLE, recorded as an accepted gap (17:29).*
   Vercel **greys the Sensitive control out unless Production is among the
   selected environments**, so a Preview/Development-only connection cannot be
   marked write-only. **Selecting Production to unlock it was rejected** — that
   would recreate the overlap this item exists to remove, and the overlap guard
   would refuse it regardless. The new credentials are therefore **readable back
   from the dashboard**. Accepted, because they grant access only to a
   throwaway preview database holding no production data; this is a materially
   different exposure from the readable *production* credentials found at 17:03,
   which the narrowing has since closed. **Recorded as a known limitation with
   its reason, not an oversight, and not closeable at this surface.**

   *Original reasoning, retained — it is why the toggle was sought:* It makes the
   values write-only, the same hardening applied to the TPL key at `3570d97`.
   It does not impede step 5: separation is verified from **names and
   environment scopes**, which stay visible, not from values. The one cost is
   that `vercel env pull` can no longer retrieve them for local development —
   acceptable for a non-production store, and worth stating rather than
   discovering.

   Between the two operations, **Preview and Development have no Redis
   binding.** That is acceptable and expected: nothing currently depends on
   Preview, and `budgetMode` already answers `ENABLED_UNBOUND` → 503
   `budget_store_unbound` for an unbound store (`api/tpl-proxy.js:44-56,:123`)
   rather than failing open. Do not treat a 503 from a Preview deployment during
   that interval as a defect.
5. **Verify all five names show the correct separation before pushing.**
   **PASSED for the Production half, 2026-09-09 17:20.** All five read
   **Production**, and all five are present — `REDIS_URL`, `KV_URL`,
   `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, `KV_REST_API_URL`. The
   "gone would look like narrowed" failure did not occur. ~~This verifies only
   that Production was vacated of the other two environments; Preview and
   Development are currently bound to nothing, which is the intended midpoint,
   not the finished state.~~ **Superseded 2026-09-10:** that was true when
   written. Preview and Development are now bound to the second database, so
   the separation is complete as configuration. See §Redis reconciliation.

   **Unplanned gain: the five are now write-only.** Each row now shows a
   **padlock**, where before it showed `<>` with a reveal control. Narrowing the
   connection appears to have re-created them as **sensitive**. That removes the
   read-back weakness noted at 17:03 without a separate task. It also means
   their values can no longer be retrieved from the dashboard — irrelevant to
   verification, which reads names and scopes, but relevant if anything
   downstream expected to pull them.
6. **Create a Preview deployment and prove writes land only in the new
   database** — the step that converts the design into evidence.

**Safeguard 1 — preserve the production values.** Step 4 removes the
Preview/Development targets from the existing rows; it must **not** discard the
production values themselves. If the rows are integration-managed and cannot be
edited, **stop** and establish the provider's supported method for
per-environment assignment rather than deleting and recreating them from
whatever is at hand. A production credential that cannot be restored is not a
safe thing to improvise around.

**Safeguard 2 — new assignments do not revoke old access.** Environment
variables bind at build time, so **already-built deployments keep the
credentials they were built with**, and any credential already downloaded
locally keeps working. Retargeting closes no existing path. Consequently:
**keep existing deployments and local credential copies out of the isolation
testing**, and account for both before declaring isolation complete. Isolation
is a property of what the *new* deployments reach, not a revocation.

**Cost is not established.** Dropping the custom environment from the plan
removes Vercel's `$50 / 5 environments` charge; it says nothing about what the
**second database** costs. Confirm its price and limits with the provider before
creating it — an unmetered free tier that silently caps connections would be its
own incident.

**What was ruled out, and why the earlier plan was wrong.** I had proposed a
preview-scoped deployment toggle (`gitProviderOptions.createDeployments`). The
Git settings page carries **no such control**: its toggles are Pull Request
Comments, Commit Comments, `deployment_status` Events, `repository_dispatch`
Events, Commit Status, Consolidated Commit Status, Require Verified Commits
(Inherit from Team, Disabled) and Git LFS (Disabled) — every one a notification
or status control, none gating whether a deployment is *created*. The only
all-or-nothing control is **Disconnect** on the repository. **No Ignored Build
Step section exists on that page**, consistent with its absence from the API
response. So the inference marked Unverified in the rotation checklist is now
**disproved, not merely unconfirmed**.

Isolating the store is also the better remedy on the merits: blocking
non-production deployments would have removed the very environment R4 has to be
verified in, whereas a separate store both contains the leak and *creates* the
isolated store that item 3's verification requires.

This gates the first push. It does not gate item 1.

### 3. R4 activation — the activated deployment must carry both halves

**The requirement, stated properly: the deployment being activated must contain
both R4's implementation and its intended configuration.** Not "deploy first,
then configure" — that was too rigid, and it was mine. **Settings can be
prepared beforehand**, and preparing them early is the better order, because it
means the activating deployment is built with them already in place.

Two facts fix the shape of this:

- **The implementation is not in production.** `9aaf326` is what production
  runs, and `api/_tplBudget.js` **does not exist at that commit** —
  `git show 9aaf326:api/_tplBudget.js` fails. Variables set against it configure
  nothing, because there is no budget code there to configure.
- **Changing environment variables after a deployment requires a new deployment
  to carry them**, as the rotation already demonstrated: the replacement TPL key
  took effect only once a fresh deployment was built with it. **Reading a value
  at call time does not change this.** Call-time reads stop a warm instance
  freezing a value it read at module load; they do not pull a variable into a
  build made before the variable existed. I have conflated those two things
  before, so it is worth stating plainly.

**And "metered but unenforced" was false — withdrawn.** With
`TPL_BUDGET_ENFORCE` unset or `'0'`, `budgetMode` returns `DISABLED` and the
entire reservation block at `api/tpl-proxy.js:131+` is skipped: no reservation,
no counting, no KV cache read or write. Enforcement off is **R4 bypassed**, not
R4 observing quietly. The counters in the measurement section came from a test
fixture, not from a disabled production path.

So the order is:

1. **Containment and KV isolation** — ahead of the first Phase 1 push, per item
   2. Unchanged.
2. **Approve the values** (below). They may be set at any point from here on;
   what matters is that they are in place when the activating deployment is
   built.
3. **Verify R4 with enforcement enabled, against the isolated store.** This is
   where activation is actually proven: enforcement on, a real store, and
   non-production. `budgetConfig` treats `TPL_BUDGET_MAX` and
   `TPL_BUDGET_WINDOW_SEC` as the configured-ness test
   (`api/_tplBudget.js:55-56`), so until both are set `usable` is false whatever
   the others say.
4. **Prepare the production deployment with the approved values and the correct
   binding**, then activate it — both halves present in the same deployment,
   binding confirmed rather than inferred from configuration.

**Enforcement stays last, and is fail-closed by design.** With
`TPL_BUDGET_ENFORCE='1'` and no bound store, `budgetMode` returns
`ENABLED_UNBOUND` and every uncached lookup 503s
(`api/tpl-proxy.js:44-56,:123`). Correct behaviour, and a total outage if it
reaches production ahead of a confirmed binding.

#### The six settings — policy choices for your approval, not derived limits

| Variable | Proposed | Standing |
| --- | --- | --- |
| `TPL_BUDGET_MAX` | `400` | **Policy choice.** See the three caveats below. |
| `TPL_BUDGET_WINDOW_SEC` | `3600` | One hour. Matches the code default and keeps the arithmetic legible. |
| `TPL_PER_IP_MAX` | `60` | **Policy choice**, provisional. The one scripted session charged 5 calls for 4 cards; 60/hour is roughly twelve times that shape. A starting point with headroom, not a percentile. |
| `TPL_CACHE_TTL_SEC` | `21600` | 6 hours, mirroring `api/pricecharting.js:18` — the house precedent for the same class of paid lookup. |
| `TPL_STALE_TTL_SEC` | `86400` | 24 hours an expired entry stays servable as stale. Degraded prices beat a dead lookup. |
| `TPL_BUDGET_ENFORCE` | **last** | Enabled for the isolated-store verification at step 3; reaches production only in the deployment prepared at step 4. |

**Three things the 400 does not do**, stated because the first version of this
table implied otherwise:

1. **It leaves only 400 calls of daily headroom.** 400 × 24 = 9,600 against a
   10,000/day plan. That is a thin margin, and it is thin by construction rather
   than by evidence.
2. **It is one shared hourly limiter, and it does not cap account-wide usage.**
   The 9,600 figure holds only if that limiter is intact and is the sole path to
   the key. Another deployment, a direct caller, or any request that does not
   pass through this proxy spends from the same daily account total without
   touching the counter.
3. **An hourly cap does not control short bursts.** This holds on the
   arithmetic alone: a 3,600-second window cannot constrain what happens inside
   any few seconds of it, whatever the provider's rules turn out to be.

   **The provider's precise limit is unknown**, and my earlier phrasing here
   overstated it a second time after it had already been downgraded elsewhere in
   this file. What was observed during the rotation run is one 429 with the
   daily counter nowhere near 10,000, followed by successful retries
   (`c4ea5e4`). **One 429 plus later successes does not establish a two-second
   window, a call count, or any threshold** — a burst rule, a transient
   provider-side condition, and several other explanations all fit that single
   observation equally well. No further probing is warranted; establishing the
   rule would mean deliberately spending paid quota to demonstrate a limit.

   What survives, and is enough to matter for sizing: **our request shape can
   cluster.** The 180 ms debounce is shorter than a mid-word pause, and the
   graded path fires two adjacent calls from one user action. So clustering is
   real and an hourly cap is the wrong instrument for it, while the provider's
   response to clustering is **Unverified**.

All five numbers are **explicitly provisional** wherever stated. Refining them
from real traffic is a post-launch improvement, not a launch prerequisite:
collecting the traffic cannot be a precondition for the release that generates
it.

### 4. RV-11 — has local work available, and stays non-blocking

**Corrected: this was listed under "needs a deployed function or a live
credential." It does not, and its agreed severity stands.**

RV-11 is a **fail-open entitlement default plus a possible admin-reporting
undercount** — not a revenue-loss defect, and **non-blocking**. That severity was
already adjudicated and is not re-opened here.

The available local work needs no credentials and no account access: drive
`api/stripe-webhook.js` with **synthetic events and a mocked KV** in both
delivery orders — `checkout.session.completed` → `customer.subscription.created`
and the reverse — recording the final persisted `plan`. That establishes whether
a wrong label is possible at all and which order produces it. **If neither order
yields `pro_monthly` for an annual subscription, the Stripe/KV comparison is
unnecessary.**

The sequencing constraint is unchanged and load-bearing: **map the annual price
in code before touching the `|| 'pro'` fallback** at `api/_tier.js:113`. That
fallback is currently the only thing granting Pro to the annual price, because
the map has no entry for it. Tightening it first revokes access from every
legitimate annual subscriber the moment it ships.

### 5. Remaining release checks, then deployment authorization

The blocking entries in the verdict table: RV-1, RV-3, RV-4, RV-8, RV-9, RV-10
and CH-1, plus the live suites never run (`tests/ebay-live.mjs`,
`tests/test-scan.mjs`). They share one shape — each needs a deployed function, a
live credential, or a real store.

**Deployment is yours alone and must be explicit.** A push to `main`
auto-deploys, so there is no rehearsal step between authorization and
production. Nothing here should be read as asking for it.

### Where Phase 1 stands

**Roughly 90–92% complete — a judgment, not a computed figure**, recorded as one
so it is not later quoted as a measurement. What remains is **release
configuration and verification against what is actually deployed**, which no
passing local suite can substitute for. **Containment is designed but not
executed**, and design is not progress against that remainder.

---

### 2026-09-09 run records

- **RV-5** — `CR_E2E_URL=http://127.0.0.1:<port>/index.html node tests/flip-completeness-e2e.mjs`:
  **22 passed, 0 failed.** First run 2026-09-09 against `js/core.73a71fac.js`;
  **re-run 2026-09-09 15:00 against the current bundle `js/core.2cb1e377.js`,
  same result.** The bundle has been renamed four times since the first run, so
  the earlier citation is kept only as history.
- **RV-7** — `node tests/listing-photos.mjs`: **92 passed, 0 failed.** Same two
  runs, same result, current bundle `js/core.2cb1e377.js`. Limitation unchanged:
  headless Chromium only, and no storage-ceiling experiment.
- **RV-13 rendered outcomes** — `node tests/tpl-outcome-render.mjs` against
  `js/core.2cb1e377.js`: **150 passed, 0 failed** (was 136 at the previous
  packet; groups G and H and the panel-discrimination assertions were added
  since). Stable across two consecutive runs.
- **RV-6** — compared `HEAD~1` against `HEAD`, which is the right pair: the RC-1
  blank-shipping note is inserted immediately above the ranking. Rendered
  `.payout-rank-row` name/amount pairs **identical in all four cases**
  ($3.00 · $1.00 · $45.00 · $400.00). **Narrowing, stated rather than hidden:**
  the harness rendered the **two** default-tier rows, not the six-row Pro
  ranking of the 2026-09-08 run — the tier gate reads a module-scoped value that
  could not be lifted from page scope. Non-vacuous, but narrower. A first attempt
  returned **zero** rows and was discarded as vacuous rather than reported as a
  pass.

---

## RV-1 — grade response contract (added 2026-09-08, from the BIAS-5 change)

**Why offline assertions are not enough.** `tests/quick-pricing.mjs` asserts that
`api/scan.js` contains `analysis_id: scanId` and that `scan_id` does not appear
in the grade-mode response literal. Those are text assertions over source. They
establish that the field was **added**; they cannot establish that the response
**path** returns it — an early return, a later overwrite, a serializer, or a
wrapper could all drop it, and the whole point of the BIAS-5 fix is that
`_crGradingScope` silently falls back to the WeakMap when the field is missing.
A silent fallback plus a source-only assertion is exactly the shape that let the
`scan:` branch sit unreachable in production while looking correct in review.

**Run:** exercise a successful grade scan against the deployed function with a
mocked or fixture card.

**Must be true:**

1. The 200 response body contains `analysis_id`, a non-empty string.
2. The 200 response body does **not** contain `scan_id`. `scan_id` keys the
   refund path, which is claimable only for scans logged to KV
   (`api/scan.js:1220`); grade scans are not logged, so exposing that name would
   make them look claimable.
3. Two grade scans in one session return **different** `analysis_id` values.
4. Client-side, `_crGradingScope` resolves to `scan:<analysis_id>` and not to an
   anonymous WeakMap token. If it resolves to a token, item 1 failed silently.

**Blocked by:** `tests/test-scan.mjs` has no offline harness (existing open
item). This entry is the concrete reason to build one.

---

## RV-2 — accessibility of the T2.14 disclosure row (added 2026-09-08)

**Why offline assertions are not enough.** The note is visible text in document
order and `a11y-mobile-2026-09-04` passes 174/0, but element presence alone does
not establish a usable announcement, and `page.accessibility` has been removed
from the installed Playwright build, so no automated proxy is available here.

**Run:** a real screen reader over the Quick Pricing ladder in the state where a
supplied low exceeds the comparison reference.

**Must be true:**

1. `Provider low (not used)` is announced as the row's name.
2. The em-dash value is not announced as a price, or as nothing at all in a way
   that leaves the row nameless.
3. The explanation note is announced in the same row context, not orphaned after
   the table.
4. The dagger's accessible name is announced (this has been carried as
   unverified since the prior checkpoint and is still unverified).

---

## RV-3 — eBay live suite (pre-existing, restated here)

**Run:** `EBAY_LIVE=1 node tests/ebay-live.mjs`.
**Must be true:** 19/19 — **unchanged and not substituted.** The "currently
18/19" figure previously recorded here has **no run behind it**
(`audit/CARDRESELL_PLAN_AND_ROADMAP.md:657`: "reportedly at 18/19; this was not
re-run") and is withdrawn as a bar. The harness prints
`X passed, Y failed, Z warnings` and never a fraction, and at least four of its
nineteen happy-path checks exist only in one branch — so a clean run with a
moved category-tree version prints 18 passed / 0 failed, indistinguishable from
one real failure by that fraction. Judge individual checks, never the total. See
`audit/ROTATION_PLAN_BOUNDED.md` §1.
**Blocked by:** the Cert ID rotation gate. This is a release gate, not a
checkpoint gate.

---

## RV-4 — draft KV live (pre-existing, restated here)

**Run:** `node tests/draft-kv-live.mjs`.
**Must be true:** passes against live KV.
**Blocked by:** no live KV binding in this sandbox. It is the only registered
suite in `tests/run-all.sh` that cannot be run here.

---

## RV-5 — flip completeness through the real record path (added 2026-09-08)

**Run:** serve the repo on a local port, then
`CR_E2E_URL=http://127.0.0.1:<port>/index.html node tests/flip-completeness-e2e.mjs`.
**Must be true:** 22/22. **Last run 2026-09-09 15:00 against `js/core.2cb1e377.js`: 22 passed, 0 failed.** (First run 2026-09-08, same result, against a bundle four renames older.)

**Why it exists.** `tests/payout-honesty.mjs` lifts the completeness helpers out
of the bundle and asserts their return values. That is a unit test and cannot
speak for the surfaces the original `hasCosts` defect actually reached
— persisted records, the portfolio total, "Best Flip", and the CSV export.
RV-5 follows one record through all of them: explicit zeros survive a reload as
complete, a blank cost stays provisional after reload and inside the aggregate,
a pre-tracking record stays untracked with no missing-field list invented for
it, and all three remain distinguishable in the exported file.

**Why it is not a runner slot.** It needs Playwright and a local HTTP server.
The offline runner provides neither and the repo has no `package.json` to depend
on Playwright from. It is a declared exclusion in `tests/test-registry.mjs`.

---

## RV-6 — rendered-ranking comparison across the chart change (added 2026-09-08)

**Run:** extract the pre-change build (`git archive fa4739b^`), serve both, and
compare the painted `.payout-rank-row` name/amount pairs in DOM order.
**Must be true:** identical amounts and identical order in every case.

**Why it exists.** `_payoutBarGeom` returns geometry only and has no amount
field, but that fact is a property of the helper, not proof that the caller
preserved amounts and ordering. The claim is carried by rendered output instead.

**Last run 2026-09-08 — 4 cases, all identical:**

| case | override | rendered ranking (identical before and after) |
|---|---|---|
| mixed signs | $3.00 | Poshmark $0.05 · CardNexus −$9.24 · Mercari −$9.30 · Whatnot −$9.63 · eBay −$9.70 · TCGPlayer −$9.70 |
| all negative | $1.00 | Poshmark −$1.95 · CardNexus −$11.08 · Mercari −$11.10 · Whatnot −$11.41 · eBay −$11.43 · TCGPlayer −$11.43 |
| ordinary profitable | $45.00 | Poshmark $36.00 · CardNexus $29.40 · Mercari $28.50 · Whatnot $27.80 · TCGPlayer $26.74 · eBay $26.64 |
| high value | $400.00 | CardNexus $356.00 · Mercari $348.00 · Whatnot $344.10 · TCGPlayer $334.70 · eBay $334.60 · Poshmark $320.00 |

The two cases the chart change targets — mixed signs and all-negative — are the
first two rows.

---

## RV-7 — D7 listing photos, store and screen (added 2026-09-08)

`tests/listing-photos.mjs`, **92 checks, 92 passing, run twice** on
2026-09-08 against `js/core.3f83abec.js`. It is a **declared exclusion** in
`tests/test-registry.mjs`, not an offline slot, on the same grounds as
`flip-completeness-e2e.mjs`: it needs Playwright and a local HTTP server the
offline runner does not stand up.

Run by hand: `node tests/listing-photos.mjs`.

What only this suite covers:

| area | what it establishes |
|---|---|
| store transaction | a fault fired after every blob `put` reports success but before commit ⇒ caller sees a rejection, no orphan blob survives, manifest byte-identical |
| picker | files arrive via `setInputFiles` on the real hidden input, not a synthesised `File` in page JS |
| reorder | the chosen order survives a **full page reload**, not just a repaint |
| missing photo | renders as its own tile with its own sentence while its neighbours still show thumbnails, and the empty line stays hidden |
| cap | 12 is attributed to CardResell and explicitly not to eBay |
| failure | the previously displayed collection is intact, the failure is shown, and no success line appears beside it |
| no upload | add, reorder and remove issue no request with a body, scoped after boot |

**What it does not establish.** It runs in headless Chromium only, so it says
nothing about Safari or iOS, where the storage behaviour that motivated the
browser-scoped copy is most likely to differ. It does not establish a storage
ceiling — no quota-exhaustion experiment was run, by decision. Glare is not
asserted because glare is advisory, not a gate.

---

## Open behaviour question — same-card basis retention (opened 2026-09-08)

Tracked here rather than left inside the D7 basis-loss packet, because it is a
product decision with a release consequence and it is nobody's side note.

**What is established.** `loadCardUI` (`js/core.53a0674d.js:3708`) clears
`_crBasis` on every card load. The clear **treats both cases alike**: a load of
a DIFFERENT card, where dropping the previous card's basis is the leak
prevention the binding work was built for, and a reload of the SAME card, where
the basis just bound for that card is dropped too. Demonstrated deterministically
by `a same-card reload drops that card's own bound basis` in
`tests/draft-review-screen.mjs`, driven through the real
`_restoreLastLoadedCard()` path.

**What is not established.** Whether a same-card reload SHOULD retain the
basis. Retention is not obviously safe: reinstating a basis whose card is no
longer certain recreates the foreign-provenance leak. Production reachability
is also undemonstrated — the only observed occurrence was a test binding a
basis while a startup card load was still pending. No minimum duration is
claimed in either direction.

**Why it is not urgent.** The consequence is disclosed, not silent: the review
screen states `data-packet-basis="absent"` with "No price source was recorded
with these listing details.", and flags a comp-derived price as owing a source
(`tests/draft-review-screen.mjs:2519`, `:2521`).

**What would close it.** A decision on the intended same-card behaviour, and if
retention is chosen, a rule that distinguishes the two loads by card identity
rather than by timing. Production clearing stays unchanged until then.

---

## Not in this queue

Everything else registered in `tests/run-all.sh` runs offline and was run at the
2026-09-08 checkpoint — 41 of 42 suites, all green. Anything reported as "not
rerun" must name which of these six entries it falls under, or it was simply
not run.

## Signed-in eBay continuation (D5 §8.3) — open, owner-run

The four checks in `audit/d5/D5_SIGNED_IN_VERIFICATION.md` §6 need a real
signed-in eBay seller account. No instrument exists in the build environment:
the cloud browser has no logins and this project does not collect marketplace
passwords. A logged-out baseline was re-taken 2026-09-08 and passes all four
questions, including the query surviving in the address bar; it is a comparison
point, not the answer.

Pre-committed consequences for each outcome are in §7 of that document, written
before the observation. Two of the five rows are blockers.

**Recurring pre-deploy check (Q-D5-3, ACCEPTED 2026-09-08).** The `title`/`caty`
parameters we depend on are undocumented eBay internals with no compatibility
promise, so a silent change on their side would otherwise surface as seller
confusion rather than as a failed check. Manual by necessity — it cannot be
automated without a signed-in session the build environment does not have.

Each run records:

| Field | Why |
| --- | --- |
| Date | A pass ages; eBay can change between deploys. |
| Account + browser context | The result belongs to a case, not to the product. |
| Landing screen — is our search and category displayed? | **The criterion.** |
| Offered match — can the seller compare a collector number? | **The criterion.** |
| Surface: mobile web **and** desktop | Both in scope (Q-D5-5). **Mobile is the priority** — it is the scan workflow, where a seller who just photographed a card is standing. **Desktop is retained** for saved-collection sellers working a list later. |
| Did it route into the eBay app? | **Recorded, not scored.** Opening the app is not a failure by itself; the destination and whether usable card details are in front of the seller decide the result, exactly as in a browser. An app run is a rendering surface we have never observed, so note it when it happens. |
| Final URL, verbatim | Evidence only. A missing query does not prove the inputs were discarded (eBay may consume them and redirect to a clean URL), and a surviving query does not prove they were used. |

**A pass establishes that tested case, not a continuing compatibility
guarantee.** The item stays in this queue after a successful run rather than
being struck off.

Pre-committed fallback if the inputs do not reach the workflow: keep a usable
generic eBay continuation with manual-copy instructions, keep the identity
instruction phrased to hold wherever eBay presents a selection, remove only
screen-assuming wording, and do not hunt for further undocumented parameters to
preserve prefill (D5 verification §7.2).

### Run log

| Date | Account / browser | Search + category displayed? | Match comparable? | Final URL | Result |
| --- | --- | --- | --- | --- | --- |
| 2026-09-08 | Owner, **iOS Safari mobile web** (not the eBay app); **signed in — owner-attested**, *"yes I was signed into safari"* | Yes, verbatim search and `caty=183454` category | Yes — `Charizard VMAX (Secret) 074/073 Champions Path Holo` | Not readable (Safari shows `ebay.com` only); evidence only, not a criterion | **Pass for that tested case.** Screenshot: `audit/d5/evidence/2026-09-08-signed-in-ios-safari.jpeg` |

---

## RV-8 — Preview and Development read production KV

**Established 2026-09-08** (`audit/ROTATION_GATE_ANSWERED.md` §2.2): every
KV/Redis variable on the `cardresell` project is a single row targeting
`production,preview,development`. One row carries one value, so preview and
development deployments read and write the **production** store. No key on the
project has more than one row, so there is no per-environment store.

**Exposure.** A preview deployment of a branch with an unfinished migration, a
bad key prefix, or a destructive fixture writes into the store serving
`www.cardresell.org`. The outgoing draft-persistence work writes by design, so
this is not hypothetical.

**Mitigation, weaker than first recorded.** `ssoProtection.deploymentType =
all_except_custom_domains` means previews are not publicly *reachable*. That is
access control, **not data isolation** — it constrains who can request a URL and
says nothing about what deployed code writes once running. A preview build with
a bad key prefix or an unfinished migration writes to the production store
whether or not a human opens it, and scheduled or webhook-triggered paths need
no browser at all. **The earlier "self-inflicted damage only" framing was too
strong and is struck.**

**Also struck:** the claim that separating environments would invalidate the
completed functional tests. It would not. Those tests assert behaviour against a
KV interface, not against a particular store; a new store requires **checking
the new configuration**, not re-earning the results. That was an invented cost
for the fix.

**DECISION REQUIRED BEFORE THE FIRST PUSH** — not after. A push automatically
creates a Preview, and the Preview is the exposure, so this cannot be resolved
afterwards. Chosen order (`audit/ROTATION_PLAN_BOUNDED.md` §3): **(1)** disable
automatic Preview deployment — one reversible project setting that removes the
trigger outright; **(2)** provision a separate non-production store, which is
the durable answer; **(3)** re-enable Previews. Step 1's cost is real: it removes
the only pre-production verification surface for as long as it lasts. Each step
needs its own concrete authorized action.

**Not a rotation item** — the rotation neither causes nor fixes it, and
redeploying the live commit does not create a Preview, so the rotation sitting
may precede this decision provided nothing is pushed.

---

## CH-1 — production eBay verification token is the repo's committed default

**Measured 2026-09-08** by an unauthenticated `GET` to our own public endpoint
(`audit/ROTATION_PLAN_BOUNDED.md` §0): production's challenge response matches
the repository's committed default token **plus one trailing newline**. Because
the deployed code is `process.env.EBAY_VERIFICATION_TOKEN || '<repo literal>'`
and the literal carries no newline, the environment variable **is set**, and its
stored value is the published default with stray whitespace.

Two defects in one variable: a **value published in the repository** is serving
production, and a **stray character** breaks eBay's endpoint validation against
a clean portal value. Replace with a generated value in eBay's portal and in
Vercel, and stop the code literal being a usable fallback. No value, fragment,
or hash recorded.

---

## RV-9 — the other eighteen live-harness checks are unverified

`tests/ebay-live.mjs` has never been run in this workspace: it requires
`EBAY_APP_ID` and `EBAY_CERT_ID`, which are Production-only in Vercel and absent
here. Only check 19 (`deployed challenge hash matches the CLEAN token`) has been
established, and only because that one needs no credential. The rotation run
establishes the baseline for the remaining eighteen as much as it confirms the
new credential.

---

## CH-2 — the production code fallback to a published token

`api/ebay-notifications.js:17` still reads
`cleanCredential(process.env.EBAY_VERIFICATION_TOKEN) || '<repo literal>'`. The
literal is a value committed to the repository, and CH-1 established production
was serving it. **The environment change in the rotation window does not remove
this**, so an unset or cleared production variable silently falls back to a
published value.

Code change, tracked separately from the rotation. After the harness edit of
2026-09-09 the literal appears in exactly one place in the tree — this line.

---

## CH-3 — `CARDSELL_TPL_KEY` is stored unencrypted

Observed 2026-09-09: three project variables are `type: plain` rather than
`encrypted` — `BLOB_STORE_ID`, `BLOB_WEBHOOK_PUBLIC_KEY`, and
`CARDSELL_TPL_KEY` (targets `production,preview,development`). Plain rows have
their values returned in cleartext by the project detail endpoint, and one such
value was displayed in agent working output while reading Git deployment
settings. It was not written to any file, but treat it as exposed.

If `CARDSELL_TPL_KEY` is a live API key: re-create it as an **encrypted**
variable (Vercel cannot convert in place — delete and re-add) and **rotate** it.
The two `BLOB_*` rows are store identifiers, not secrets, and can stay.

Not part of the rotation window, which is already changing two credentials.

**Assessed read-only 2026-09-09 — `audit/CH3_TPL_KEY_ASSESSMENT.md`.** The key
is the paid TCGPriceLookup key (`api/tpl-proxy.js:18,:44`). The route is
**anonymous and unmetered**: no caller verification, no usage limit, and every
query param forwarded verbatim (`:32-37`), so the `s-maxage=300` edge cache
(`:50`) is bypassable with any junk param. Calibrated: the deployed client sends
only `path`, `q`, `game`, `limit` with no cache-buster, so this is abuse
potential, not active bleeding. Whether it has been abused is **Unverified** —
provider dashboard and Vercel invocation records, owner-side.

**CORS is not the boundary** — origin and `Referer` are client-asserted and do
not constrain direct requests. Withdrawn as a proposed control.

**Class of two, not one:** `api/pricecharting.js` also holds a paid key while
anonymous, but reads named params and caches 6h in KV (`:18,:35,:446-462`), so
its exposure is first-time lookups only. It is the model for the remedy, and
`api/scan.js:1,:785-797` (verify + atomic credit debit) is the stronger house
pattern. Also a **terms** question given the open PriceCharting negotiation, not
just a cost one.

**Remedy R1 rotate at provider (owner) · R2 named param allow-list, provably
behaviour-preserving · R3 stop caching failures · R4 KV cache + cap, blocked on
KV isolation.** Q-CH3-1..4 await owner answers; R2–R3 await authorization.

---

## RV-10 — containment mechanism unverified

`audit/ROTATION_EXECUTION_CHECKLIST.md` §4. The "disable automatic Preview
deployment" toggle named in the earlier plan was **not established to exist with
that scope**. What the project exposes is
`gitProviderOptions.createDeployments: "enabled"`, which appears to govern
Git-triggered deployments **as a whole, production included** — broader than a
preview-only switch. `link.deploymentEnabled` is unset, and reading that as
"default enabled" is an inference, not an observation.

Verify the exact control and scope in the dashboard before relying on it. If it
suppresses production deployments too, that must be understood before the
maintenance window, which needs to deploy.

### What RV-10 gates — corrected 2026-09-09

This has drifted twice, in the same direction each time, so it is stated as a
table rather than a sentence:

| Gated by RV-10 | **Not** gated by RV-10 |
| --- | --- |
| The **first push** to `main` — a push creates a Preview, and the Preview is the exposure | Rotating the eBay Cert ID or verification token **at the provider** |
| Containment **steps 11a–13** of the maintenance window | Rotating or revoking the TPL key at TCGPriceLookup |
| | **The exact-commit maintenance rebuild** — a deployment, separately authorized by the owner |
| | Reading a dashboard, choosing budget numbers, provisioning an isolated store |

**Struck, 2026-09-09 (second pass).** An earlier version of this table listed
"the rebuild **deployment**" in the gated column and justified it with the claim
that "the credential window contains no deployment." **Both are wrong.** The
credential window **does** contain a deployment — the exact-commit rebuild. The
rebuild sits outside RV-10 because the **owner authorizes it directly**, not
because it is somehow not a deployment. The tidier phrasing was doing work the
facts do not support.

**The surviving distinction:** containment gates **the push and steps 11a–13**,
and does **not** gate the separately authorized maintenance rebuild or the
provider-side credential work.

**Rotation comes first; containment comes second.** Both earlier drifts inverted
this, because containment reads like a precaution and precautions feel like they
belong at the front. Treating containment as a prerequisite for rotation would
hold an exposed credential open while waiting on a dashboard control nobody has
yet located — the exact failure containment exists to prevent.

**Containment does not revoke production-KV access from existing deployments or
from local development** — `KV_*`, `KV_URL` and `REDIS_URL` target
`development` from the same single rows. Keep both out of write-capable testing
until a separate store exists, and **do not run the deferred preview-surface
checks against production instead.**

## RV-11 — Unknown prices default to Pro; possible annual-count error

**Supersedes an earlier, wrong filing of RV-11**, kept in History at the foot of
this file. **My original claim was wrong.** I wrote that an annual subscriber "pays $89.99 and the
tier lookup returns nothing", and the reviewer, reasonably relying on that,
called it the most serious defect of the session and the only one where a seller
loses money to CardResell. **Neither is true.** I stopped tracing at
`api/_tier.js:58` \u2014 the line that returns `null` \u2014 and reported the null as the
outcome. It is not the outcome. Every consumer catches it.

**Four independent fallbacks, all landing on the correct tier.**

| Consumer | Line | What happens to the unmapped annual price |
| --- | --- | --- |
| `api/_tier.js` | `:113` | `priceIdToTier(priceId) \|\| 'pro'` |
| `api/pro-status.js` | `:114` | `metaTier \|\| priceMap[priceId] \|\| 'pro'` |
| `api/stripe-webhook.js` | `:111` | `\|\| undefined`, then \u2026 |
| `api/stripe-webhook.js` `storeProUser` | `:194` | `tier \|\| existing.tier \|\| 'pro'` |

An annual **Pro** subscriber therefore resolves to **`'pro'`**, which is the
**right** tier for the $89.99/yr plan. **No entitlement is lost, no customer is
owed a comp, and nobody needs contacting.** The read paths do have a fallback;
I asserted they did not without reading them.

**The rule the reviewer drew still holds \u2014 it just did not fire here.** "A
fallback on the write path without a matching fallback on the read path
manufactures unrecognized state" is a sound check. Applied honestly, the read
paths **each** carry a fallback, so the pair is not mismatched. The general check
is worth keeping; this instance is not an example of it.

### What is actually defective, at reduced severity

**1. The lenient fallback fails open, which is the inverse of what I claimed.**
`api/_tier.js:113` carries its own comment: *"any active sub with unknown price
\u2192 assume Pro"*. So an active subscription at **any** unrecognized price \u2014 a
retired plan, a discounted one, a mistake \u2014 is **granted Pro**. The system errs
toward granting entitlement, which is precisely **why** no one loses money, and
is a real risk pointing the other way. **Severity: worth a decision, not a
blocker.**

**2. `"undefined"` as a computed key \u2014 real, and masked.** `api/pro-status.js:108`
does create a literal `"undefined"` key mapped to `'pro'`, so a subscription with
a **missing** price ID collides with it and resolves to Pro. Its effect is
currently invisible because `:114`'s `|| 'pro'` would return `'pro'` anyway. The
reviewer's instinct to trace it before a fix ships was right; the trace shows it
**writes nothing on its own** \u2014 it is a lookup map, rebuilt per request, never
persisted. **No record cleanup is implied by this key.**

**3. The one durable-record concern that survives \u2014 and it is about reporting.**
`storeProUser:193` persists `plan: plan || existing.plan || 'pro_monthly'`, and
the `subscription.created` branch at `:116` passes `plan` as **`undefined`**. So
an annual subscription can be written to KV as **`'pro_monthly'`**. That matters
because `api/admin.js:135` counts annual subscribers as
`if (data.plan === 'pro_annual') proAnnual++` \u2014 so **the admin annual count can
undercount**, showing fewer annual subscribers than exist.

**Unverified, and order-dependent:** `api/stripe-annual-checkout.js` does set
`pro_annual` in metadata, and `api/stripe-webhook.js:78` reads
`obj.metadata?.plan || 'pro_monthly'`. Whether the final persisted value is
correct depends on **webhook delivery order** between `checkout.session.completed`
and `customer.subscription.created`, which **cannot be established from the code
alone**. So: the undercount is **possible, not demonstrated**.

**Corrected severity: RV-11 is a fail-open entitlement default plus a possible
admin-reporting undercount. It is not a revenue-loss defect and not the most
serious finding of the session.** It should not be sequenced ahead of the
rotation on the strength of my original claim.

**What Stripe would still settle** \u2014 read-only, and now for a different reason
than comping anyone: whether any annual subscriber exists, and whether their KV
`plan` reads `pro_annual` or `pro_monthly`. That converts item 3 from possible to
measured. Worth doing before any fix, since the fix differs if records are
already wrong.

### Sequencing, per the reviewer

**Map the supported annual price *before* touching the fallback.** The order is
load-bearing, not stylistic. `|| 'pro'` at `api/_tier.js:113` is currently the
**only** thing granting Pro to the annual price, because the map has no entry for
it. Remove or tighten the fallback first and every annual subscriber loses access
the moment it ships. So: **add the mapping, verify annual resolves through the
map rather than the fallback, and only then decide whether the fallback should
keep failing open.** A cleanup done in the other order revokes legitimate access.

### The annual-count question needs both sources, not Stripe alone

Corrected: I implied Stripe would settle it. It cannot. Stripe establishes
**which subscriptions exist and at what price/interval**; KV holds the
**`plan` label** that `api/admin.js:135` counts. The defect is a **disagreement
between the two**, so it is only visible by comparing them. Stripe alone shows
subscriptions; KV alone shows labels with nothing to check them against.

**And the delivery-order question is testable locally, without either.** The two
orders are `checkout.session.completed` → `customer.subscription.created` and the
reverse. Both can be driven against `api/stripe-webhook.js` with synthetic events
and a mocked KV, recording the final persisted `plan`. That establishes **whether
a wrong label is possible at all**, and which order produces it, with no account
access and no authorization. **Do this first** — if neither order yields
`pro_monthly` for an annual sub, the Stripe/KV comparison is unnecessary.

**The fix recommendation stands but is no longer urgent:** map the constant in
code so one behaviour has one implementation. It now also wants a decision on
whether `|| 'pro'` should keep failing open.

## History — RV-11 as originally filed (RETRACTED 2026-09-09, superseded)

> **HISTORICAL EVIDENCE — NOT LIVE STATUS.** Everything from here to the end of
> this section is a dated record of what was believed at the time, kept because
> the reasoning that retracted it is worth as much as the finding. **Do not
> re-open anything below as a blocker.** Live status is the verdict table at the
> top of this file, which is dated. If a statement here and a statement there
> disagree, the table wins, and the disagreement is the point of keeping both.


**Not a blocker. Not current. Retained only so the correction has something to
point at.** Every factual claim in this block was disproved by the trace in the
current RV-11 entry above: the read paths each carry a fallback, so annual
subscribers resolve to `'pro'` and no customer is owed anything. Read the
current entry for the live findings.

<details>
<summary>Original text, preserved unedited</summary>

### (retracted) Annual subscribers are charged and resolve to no tier

Found by the sweep the reviewer asked for. **This is a live production path**, not
branch work: `git diff 9aaf326 HEAD` is **empty** for all three files below, so
the code described here is what `www.cardresell.org` runs today.

**The chain, each link at `file:line`.**

1. `STRIPE_PRICE_ANNUAL_ID` is **absent from the Vercel project** (40 vars
   enumerated, name-only read). Nothing sets it.
2. `api/stripe-annual-checkout.js:20` therefore sells the annual plan at a
   hardcoded constant: `const priceId = process.env.STRIPE_PRICE_ANNUAL_ID || ANNUAL_PRICE_FALLBACK`,
   where `ANNUAL_PRICE_FALLBACK` is defined at `api/stripe-annual-checkout.js:10`
   as the **$89.99/yr** price. **Checkout succeeds** \u2014 the `503 'Payments not
   configured'` guard at `:21` is satisfied by the fallback.
3. `api/_tier.js:53` maps the annual price via
   `add(process.env.STRIPE_PRICE_ANNUAL_ID, 'pro')`, and `add` at `:51` is
   guarded `if (id)`. Unset \u21d2 **no entry is added**.
4. The fallback constant is mapped **nowhere**: a search for
   `ANNUAL_PRICE_FALLBACK` in `api/_tier.js` and `api/pro-status.js` returns
   **0 hits**. The price the customer actually bought at is not in the tier map.
5. `api/_tier.js:58` returns `map[priceId] || null`. So
   `priceIdToTier('<the annual price>')` \u2192 **`null`**.
6. `api/pro-status.js:108` has the same hole in a worse form: as a **computed
   object key**, `undefined` becomes the literal string `"undefined"`, so the map
   gains a `"undefined"` entry that can never match a real price ID.

**So a customer pays $89.99 for a year and the tier lookup for their
subscription returns nothing.** Sold successfully, entitlement not granted \u2014 the
purchase path and the recognition path disagree because only one of them has a
fallback.

**Exactly the shape already named twice.** `hasPacket` permanently false,
`buildListingPacket` with no caller, and now a price ID that only checkout knows
about. **Rule 2 \u2014 a silent null is the bug** \u2014 and this one is on the revenue path.

**What is established and what is not.**

- **Established:** steps 1\u20136 above, all at `file:line`, in production code.
- **Unverified:** what the downstream consumers do with `null`. `getUserTier`
  (`api/_tier.js:66`) has a KV fast path and a Stripe-by-email fallback; whether
  `null` degrades to `'free'` or is handled some other way is **not yet traced**.
- **Unverified:** whether any annual subscriber exists. With no revenue data I
  cannot say whether this has already cost a real customer their entitlement, or
  is latent. **It is not safe to assume latent.**

**Severity: blocking for the release, and it does not wait for the rotation.**
Independent of TPL, eBay and the KV gate.

**Two candidate fixes, both needing a redeploy, neither authorized.**

1. **Set `STRIPE_PRICE_ANNUAL_ID` in Vercel** to the same price the fallback
   already sells at. No code change; makes the map and checkout agree.
2. **Map the fallback in code**, so the constant is the single source for both
   paths.

Option 1 is smaller, but leaves two places stating the same price. Option 2
matches **Rule 1 \u2014 one business behaviour, one implementation**. **Recommend 2**,
with the constant imported by `_tier.js` rather than duplicated.

**Q-RV11-1 (owner):** which fix, and is either authorized to deploy? Until one
ships, **annual is being sold into a tier gap.**

</details>

## RV-12 — WITHDRAWN. Duplicates R3, which is already built and mock-tested.

> **HISTORICAL EVIDENCE — NOT LIVE STATUS.** Everything from here to the end of
> this section is a dated record of what was believed at the time, kept because
> the reasoning that retracted it is worth as much as the finding. **Do not
> re-open anything below as a blocker.** Live status is the verdict table at the
> top of this file, which is dated. If a statement here and a statement there
> disagree, the table wins, and the disagreement is the point of keeping both.


**Not a new defect. Not a queue item. Filed in error.**

The success-only fix **already exists on this branch**, and has since R3:

| Branch `api/tpl-proxy.js` | Behaviour |
| --- | --- |
| `:185` | `if (r.status >= 200 && r.status < 300)` → sets `s-maxage=300` |
| `:194` | `else` → `Cache-Control: no-store` |
| `:99, :124, :146, :155, :203` | `no-store` on validation failure, unbound budget, stale serve, exhausted/per-IP, and upstream throw |

So the production observation at `9aaf326` is **the symptom R3 was written to
fix**, and it belongs to R3's release, not to a new queue entry. **Correct
linkage: the rotation run produced the first live confirmation that the
unconditional header is real in production — evidence for shipping R3, not a
finding of its own.**

### The part that is worse than a duplicate

`api/tpl-proxy.js:183` on this branch already carries this comment, which I
wrote:

> *"Note the withdrawn claim: this does NOT mean a dead key was previously
> served for five minutes — Vercel's cacheable statuses exclude 401, 429 and
> 5xx, so most failures were never cached whatever we asked for."*

**I then re-made that exact claim in RV-12**, writing that one rate-limited
request "poisons that query for five minutes for every user" — against a
retraction already committed, in the file I was reading. Marking it "Unverified"
did not help: **the answer was not unknown, it was recorded, in my own code
comment.** The reviewer had to withdraw the same claim twice.

**Withdrawn: the poisoning consequence.** Vercel's cacheable statuses exclude
`429`, `500` and `502`, so the documented platform behaviour prevents it
([Vercel caching criteria](https://vercel.com/docs/edge-network/caching)). The
unconditional header is still worth correcting — because relying on an external
list of eligible statuses is fragile, which is what `no-store` at `:194` makes
explicit — but **there is no user-facing harm to claim**, and I should not have
described one.

### Two more corrections to the same run

**The burst-limit explanation is plausible, not established. Downgraded.** One
`429` followed by successful retries establishes **neither window, scope nor
threshold**. I wrote "short-window burst limit, not a daily quota" as though
observed; **one observation cannot separate those**, and it does not show that a
twenty-card session meets any limit. Hourly allowance and short-term pacing are
**different constraints**, and R4 sizing is not rewritten by this. **Recorded as:
one `429` occurred under concurrent lookups; cause Unverified.**

**And my freshness evidence was invalid.** I argued the payloads proved a live
provider call because they carried `tcgplayer_id`, `cdn.tcgpricelookup.com`
image URLs and a `last_price_update`. **A cache replays exactly those fields** —
they are payload contents, and payload contents cannot establish freshness. What
actually carried the rotation proof: **`x-vercel-cache: MISS` with `age: 0` on
terms never queried in the session**, so no edge entry could exist, plus **#518
already revoked**, leaving no other credential able to produce a `200`. **The
conclusion stands; that particular argument for it does not.**

---

<details>
<summary>RV-12 as originally filed (withdrawn — retained for the correction to point at)</summary>

### (withdrawn) RV-12 original text

**Production defect at `9aaf326`. Found during the TPL rotation verification, not
by review.**

`api/tpl-proxy.js` at `9aaf326`, lines 47\u201351:

```
res.status(r.status);                                    // upstream status, verbatim
res.setHeader('Content-Type', ...);
// Cache TPL responses at the edge for 5 min — big cost saver
res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
res.send(body);
```

**The header is set unconditionally, after the upstream status has been
applied.** A `429`, a `500`, a provider outage body \u2014 each is stamped
"cacheable for five minutes, serve stale for sixty seconds beyond that",
identically to a real 28 KB card payload. **The code draws no distinction
between a payload and an error.** The comment says "Cache TPL responses",
and the implementation caches TPL *responses* rather than TPL *data*.

**How it was found:** a live lookup returned `429` from the provider (a
short-window burst limit; `:47` passes the status through verbatim, which is how
the attribution was established). That surfaced the header being applied to it.

**Rule 2 applies:** the failure is not that an error occurred \u2014 it is that the
error is dressed as a cacheable success. If honoured, one rate-limited request
poisons that query for five minutes for **every** user, and `stale-while-
revalidate` extends it: the first user's `429` becomes everyone's answer, and
nothing on the read side knows the cached body is an error rather than a card.

**This is the reviewer's write/read asymmetry rule, and here it does fire.** The
write path labels an error as durable, and no read path distinguishes it. Unlike
RV-11, there is no lenient default catching it downstream.

### What is Unverified, stated plainly

**Whether Vercel's edge actually caches a `429`.** Its CDN honours caching
directives for a specific set of status codes, and `429` is not obviously among
them, so **the live blast radius may currently be nil**. I have not tested it,
and testing it means deliberately provoking repeated provider rate limits \u2014
consuming paid quota to demonstrate an abuse case.

**The code defect does not depend on that answer.** It relies on an undocumented
platform behaviour to be harmless, and a `500` or a `502`-shaped upstream body
may sit inside the cacheable set where `429` does not. **Severity: real, bounded,
and not release-blocking on current evidence.**

### Fix, and the one judgement call in it

Set the caching header **only for a successful upstream status**, and send an
explicit non-cacheable header otherwise. One behaviour, one implementation.

The judgement call: the existing comment calls the 5-minute cache a "big cost
saver", and it is \u2014 it is what keeps the daily counter far from 10,000. **The fix
must not weaken caching of real payloads while excluding errors.** Narrow the
condition to the status, not to the caching.

</details>

## RV-13 — FIXED ON BRANCH. Lookup failure no longer reads as "no such card"

**Status: implemented and mock-tested on `phase1-block-d`, in bundle
`js/core.2cb1e377.js`. Still present in the live bundle `js/core.569ff536.js`,
which is what production serves — so RV-13 stays in this queue until a push.**

The original filing overstated the blast radius (one caller was traced, seven
were asserted). That correction is kept in full below, and the fix does not
rely on the withdrawn part: the four input conditions are now held distinct at
the helper and rendered distinctly by **all eight** callers, measured in a
browser rather than argued from source — including the scan path, which was
Unverified in the previous version of this entry and is now driven through a
real production entry point. Fallback providers that never answer are handled
in the same pass; that was filed here as a separate gap and is now fixed,
because an uncaught rejection made the promised unavailable state unreachable.

`searchWithTPL` at `:297`:

```
if (!window.tplApiKey) return null;
...
if (!r.ok) return null;
const json = await r.json();
if (!(json.data && json.data.length)) return null;
```

**Every non-2xx becomes `null`.** A `429`, a `500`, a `502`, an aborted timeout
\u2014 all collapse into the **same value** the code uses for "this card does not
exist." Grepping `429` across both bundles returns **2 hits, both `429,#d`**,
an SVG path/colour fragment. **There is no rate-limit handling anywhere in the
client.**

**Rule 2, exactly as stated: the silent null IS the bug.** The seller who gets
rate-limited is not told to wait \u2014 they are told, in effect, that their card
isn't in the database. The rational response to that message is to **retype the
query**, which issues more lookups into the condition that caused it.

### This is the write/read asymmetry rule firing properly

Unlike RV-11, there is no lenient default catching it, and unlike RV-12 the
consequence needs no platform assumption:

- **R4 already produces distinguishable refusals** \u2014 `api/tpl-proxy.js:155`
  returns `'Too many lookups from this address'` with `reason: 'per_ip_limit'`,
  and `'Lookup temporarily unavailable'` with `budget_exhausted`.
- **The client discards all of it at `:303`.** `!r.ok \u2192 null`. The reason string,
  the status, the distinction between "slow down" and "not found" \u2014 none reaches
  the interface.

**So shipping R4 as built would add a spending control whose refusals are
invisible to the person they are refusing.** That is a defect in the pair, not in
either half, and it is the correct target of the burst observation \u2014 **not** the
per-IP number, which remains unresized and Unverified.

### CORRECTION — the seller-facing consequence was asserted, not traced

**The `null` proves the helper merges outcomes. It does not prove every screen
says "no such card", and I wrote it as though it did.** Tracing the eight
callers in `js/core.569ff536.js`:

| Caller | Guard | Established end state |
| --- | --- | --- |
| `:1459` generic `gameSlug` | `if (!data \|\| !data.length)` | **Renders `"${emptyMsg} Try a different name."`** — every failure mode reaches this |
| `:938` pokemon, `:1236` mtg, `:1489` yugioh | `if (tplData)` | falls through — **end state not established** |
| `:1336` lorcana, `:1420` onepiece | `if (tplData && tplData.length)` | falls through — **not established** |
| `:1074` pokemon-jp | no guard at the call | falls through to TCGdex / PokemonTCG.io fallbacks — **not established** |
| `:12258` scan | `if (tplHits && tplHits.length)` | falls through to other match strategies — **not established** |

**So the confirmed blast radius is one caller, not the interface.** The other
seven may mask the failure behind a fallback provider, may leave the dropdown
untouched, or may reach a different empty state — **unestablished, and that is
exactly what the mocked render must settle.**

**Now established (it was not, from the snippet I showed):** the `catch` block at
`:307` does `console.warn` then `return null`, so **thrown timeouts and network
failures merge into the same null** as a `429`. The merge is real across all
four input conditions; only the *display* varies.

**Severity: real loss of error information, to be corrected before R4
activation.** The interface-wide phrasing is withdrawn.

### `window.tplApiKey` — checked, not a finding

`js/config.20ebe911.js:4`: `window.CARDSELL_TPL_KEY = '__PROXIED__'; // sentinel
— real key stays server-side`. It is a **presence gate**, matching the earlier
record. **Not a credential, not a new finding**, and closed here rather than
left hanging as an open question.

~~**Open question:** whether `:297` reads a gate or a value.~~ **Closed** by
the paragraph above — it is the `__PROXIED__` sentinel, a presence gate. The
question is struck rather than deleted so the record shows it was answered.

### RV-13 — the fix, and what the browser actually rendered

**Bundle: `js/core.53a0674d.js`** (`index.html:3842`). Renamed at the close of
RC-2 from the working name `core.2cb1e377.js`. The chain during this work was
`73a71fac` → `176e4a56` → `e9f21f4e` → `613f164a` → `2cb1e377` → `53a0674d`.

A clause here previously said `2cb1e377` "matches its own content", which was
wrong and contradicted the sentence naming `53a0674d` beside it. It is removed
rather than annotated. `2cb1e377` and `613f164a` never matched their own
content — no blob in the repository hashes to either — and both are recorded
as working names, not generations, in `audit/BUNDLE_CITATION_MAP.md`
(generation 13) and in the UNRECOVERABLE table in
`tests/asset-fingerprints.mjs`. `53a0674d` does match its own content, and is
the only bundle `index.html` references.

**1. The helper stopped merging outcomes.** `searchWithTPL` returns a
discriminated result instead of `null`:

| Return | Meaning |
| --- | --- |
| `{ok: true, cards: [...]}` | provider answered with cards |
| `{ok: true, cards: []}` | **successful empty search** — the only case that may say "no matches" |
| `{ok: false, cards: null, reason}` | refusal or failure; `reason` ∈ `rate_limited` \| `budget` \| `unavailable` \| `network` \| `not_configured` |

The reason is read from R4's own JSON where R4 sent one — `per_ip_limit` →
`rate_limited`, `budget_exhausted` → `budget` — and derived from the status
otherwise (`429` → `rate_limited`). The `catch` path, the one that had been
merging thrown timeouts into the same `null`, yields `network`.

**2. Ten give-up points now route through one helper.** `tplOutcomeHtml(res,
emptyHtml)` returns the seller's original empty-state markup when the search
genuinely succeeded and returned nothing, and a temporary-unavailability panel
when it did not. One behaviour, one implementation — Rule 1. The panel carries
`data-tpl-state="unavailable" data-tpl-reason="<reason>"`, which is what the
suite asserts on rather than on copy wording.

**3. Successful fallback results are preserved.** The six game callers keep
their existing truthiness exactly — `(_tplRes.cards && _tplRes.cards.length) ?
_tplRes.cards : null` — so a TPL refusal still falls through to Scryfall,
PokemonTCG.io, TCGdex, ygoprodeck or Lorcana as before. **A TPL failure never
replaces another provider's working results with an error screen.** Case group
C proves it directly: TPL rate-limited, PokemonTCG.io answering, cards render
and no unavailability panel appears.

The Japanese path needed a decision, and it is recorded rather than buried: it
always synthesizes a usable eBay JP comps entry, so it *has* a successful
fallback result even when TPL refused. That result is kept, and the notice is
prepended above it — otherwise absent prices look like prices the card doesn't
have. **A judgement call, not a derived rule.**

**4. One judgement call at MTG's Scryfall 404.** When Scryfall says "no such
card" but TPL was unavailable, we cannot assert the card doesn't exist — the
temporary message wins over the 404's empty state. Deliberate; the alternative
is asserting an absence from an incomplete search.

### Rendered outcomes — `node tests/tpl-outcome-render.mjs`

**134 assertions, 0 failed** (two consecutive runs at this size; the earlier
81-assertion version was stable across five). Four input conditions are mocked
at the proxy boundary: `429` + `per_ip_limit`, `503` + `budget_exhausted`, a
transport-level abort, and `200` with `data: []`.

| Caller | 429 | budget | network | genuine empty |
| --- | --- | --- | --- | --- |
| `searchPokemon` | `rate_limited` | `budget` | `network` | its own "no cards found" |
| `searchPokemonJP` | `rate_limited` + JP comps kept | `budget` + kept | `network` + kept | JP comps, no notice |
| `searchMTG` | `rate_limited` | `budget` | `network` | "no Magic cards found" |
| `searchLorcana` | `rate_limited` | `budget` | `network` | "no Lorcana cards found" |
| `searchOnePiece` | `rate_limited` | `budget` | `network` | its own panel |
| `searchYugioh` | `rate_limited` | `budget` | `network` | "no Yu-Gi-Oh! cards found" |
| `searchTPLGame` (generic) | `rate_limited` | `budget` | `network` | "`${emptyMsg}` Try a different name." |
| **`_loadScannedCardExactImpl`** (scan/revisit) | `rate_limited` | `budget` | `network` | "no Pokémon cards found" |

For every failure condition the suite asserts four things: the rendered
`data-tpl-reason` matches the condition, the text does **not** tell the seller
the card was not found, the text tells them their input is still there, and
**`document.getElementById('searchInput').value` still equals what was typed.**
For the genuine-empty condition it asserts the opposite — **no** unavailability
claim, and a rendered not-found.

**The input-preservation assertion is now on the element, not on the copy.**
Wording that says "your search is still here" proves nothing; the value read
back from the input does. Adding that assertion immediately caught a real
interference the copy-level check had hidden — see the startup demo below.

### The eighth caller — established, through a production entry

`_loadScannedCardExactImpl` is not on `window`, and putting it there would be a
test-only production global, which is not allowed. So the fixture drives it the
way a seller does: `_restoreLastLoadedCard()` reads the `cr:lastCard:v1`
snapshot at boot and, when that snapshot carries a name but no `_fullCard` and
no grounded id, hands the card to `_loadScannedCardExact`. **That is the seller
revisiting a scanned card after a refresh** — a real path, no new global, and
seeding the snapshot also switches the first-visitor demo off by itself because
`_hasSavedCard` gates it.

What renders, per condition:

- **The scanned card is still presented.** The input holds `Mega Greninja ex`
  in all four conditions; nothing is erased.
- **`#scanMissPanel` reads "Live pricing unavailable"** and "This card loaded
  but we don't have live market prices" — recoverable phrasing, and it never
  claims the card does not exist.
- **The dropdown this path opens** (the scan path fires the same `doSearch()`
  Enter would) carries `data-tpl-reason` for all three failure conditions, and
  a plain not-found only for the successful-empty one.
- **No uncaught rejection escapes the scan path** in any condition.

**Cost of that revisit: 4 `/api/tpl-proxy` requests for one card.** The restore
hydrates twice — it detects that the panel was cleared and re-hydrates — and
each hydration runs the scan path and then its `doSearch`. Recorded as measured,
not defended.

**Two fixture shapes failed first, and both are recorded because they failed
differently.** Seeding `localStorage` from the loaded page and reloading: boot
code clears the key before the 400 ms restore timer, so nothing restored. One
page with an init script: the first condition restored and the next three did
not, so run 1 left state behind that suppressed the restore. Both looked
identical from outside — empty input, empty dropdown — which is also what a
genuinely broken scan path looks like. The case now runs **a fresh browser
context per condition**, and the successful-empty condition must still produce
a rendered not-found, which only happens if the path actually ran. That
assertion exists specifically so a silent fixture failure cannot be mistaken
for a passing product.

### Fallback providers that do not answer — FIXED (was filed as a separate gap)

Previously filed here as a robustness gap and left unfixed. It is fixed now,
because it made the promised state unreachable exactly when it was needed: an
uncaught rejection prevented the unavailability panel from rendering at all.

Three callers did a bare `await fetch(url)` on their fallback provider —
`searchPokemon`, `searchMTG`, `searchYugioh`. Two of them additionally read any
non-ok status as "no such card", which is the same conflation RV-13 fixed one
layer up. `searchMTG` also had an explicit `throw new Error('Scryfall ' +
status)`. Those are gone.

One implementation of "the provider might not answer", plus one adjudicator:

| | Meaning | Seller sees |
| --- | --- | --- |
| provider answered, ok | fallback completed | its own results, or the TPL outcome |
| provider never answered | `{ok:false, reason:'network'}` | "Could not reach the card database" |
| provider answered with a not-found status | genuine absence **for that provider** | TPL still decides whether an absence may be claimed |
| provider answered with any other error | `{ok:false, reason:'unavailable'}` | "temporarily unavailable" |

The not-found statuses are per provider and stated per provider: Scryfall uses
`404`; **YGOProDeck answers HTTP `400` when a name matches nothing**, so `400`
is an absence for that provider and only for it. Everything else non-ok is the
provider failing.

**This change caught a regression in itself.** The first version had the
adjudicator return the TPL outcome when the fallback had answered fine — which
meant that with TPL rate-limited and PokemonTCG.io answering normally, it
panelled over a working result set. That is precisely the failure the
preserve-the-fallback rule exists to prevent, and case group C failed on it
immediately. A completed fallback now returns `{ok:true}` and nothing else; the
caller's own give-up point still consults the TPL outcome to decide whether an
empty result may be called an absence. Two cases were wrong, the suite said so,
and both are recorded rather than quietly corrected.

Verified in the browser (case group F, four cases plus recovery):

- **Both providers failed** (TPL 429, PokemonTCG.io unreachable) → the
  unreachable-database state renders, no not-found wording, and the box still
  holds `charizard`.
- **TPL succeeded-empty and Scryfall unreachable** → `network`, not "no Magic
  cards found". This case previously rejected out of the caller and the seller
  saw nothing change at all.
- **YGOProDeck 500** → `unavailable`. Previously rendered "No Yu-Gi-Oh! cards
  found" — a provider failure told to the seller as an absence.
- **YGOProDeck 400** → a genuine no-match, and it says so. The discrimination
  has to cut both ways or it is just a blanket excuse.
- **No uncaught rejection escaped any caller** across those four cases
  (asserted on `pageerror`, not inferred).
- **Recovery:** the next request after a fallback failure succeeds and shows
  cards.

`searchLorcana` needed no change — `_getLorcanaCards` already had
`.catch(() => [])` — and `searchPokemonJP`'s fallback fetch was already wrapped.
`searchOnePiece` and `searchTPLGame` have no fallback fetch.

### Seller-session measurement — counted where R4 charges

**Two numbers have now been withdrawn from this section, and both were mine.**
First the twenty-call loop, which reported 1.00 requests per card without ever
typing, selecting or revisiting. Then the six-request session that replaced it:
it counted requests to `/api/tpl-proxy` and called them TPL demand. **They are
not.** `reserveUpstream` reads its cache *first* and returns `CACHE_HIT` before
it touches either counter (`api/_tplBudget.js:117-127`) — so a cache hit
increments neither the per-IP counter nor the aggregate allowance, and costs
nothing at the provider. Only a **miss** reaches `store.incr`, and only a miss
can become a paid call. Counting endpoint requests overstates paid demand and
mis-sizes the per-IP cap in the same motion.

The session is now metered where the charge happens. The fixture mirrors the
real key (`cacheKey`, `api/_tplBudget.js:78` — contracted params sorted, so
param order does not fork an entry) and caches successes only, as
`api/tpl-proxy.js:187` does. Three counters, never summed:

- **req** — requests that reached the endpoint
- **chrg** — cache misses: what R4 reserves against the aggregate allowance and
  counts against the per-IP cap
- **cach** — served from cache: not charged, not per-IP counted
- **fb** — mocked fallback-provider calls (pokemontcg.io and friends), a
  different budget entirely

| Seller action | req | chrg | cach | fb |
| --- | --- | --- | --- | --- |
| page load, before touching anything | 0 | 0 | 0 | 0 |
| typed "charizard ex" — 12 keystrokes 70 ms apart, then a 700 ms pause | 1 | 1 | 0 | 0 |
| selected the first printing | 0 | 0 | 0 | 0 |
| typed "blastois", paused 400 ms, finished it — one card, two pauses | 2 | 2 | 0 | 0 |
| selected that printing | 0 | 0 | 0 | 0 |
| typed "pikachu" | 1 | 1 | 0 | 0 |
| selected that printing | 0 | 0 | 0 | 0 |
| came back to the first card | 1 | **0** | 1 | 0 |
| selected it again | 0 | 0 | 0 | 0 |
| reloaded — the last card restores itself | 0 | 0 | 0 | 0 |
| typed "gyarados" while TPL had nothing | 1 | 1 | 0 | **1** |
| **total** | **6** | **5** | **1** | **1** |

Four cards, three selections, one revisit, one reload.

What this establishes:

- **The debounce holds.** Twelve keystrokes typed straight through cost **one**
  lookup. The same card typed across two pauses cost **two** — the boundary was
  crossed deliberately, because that is what exercises it.
- **Selecting a printing costs nothing.** The click path does not re-look-up.
- **Revisiting a card already looked up charges nothing** — one request, one
  cache hit, zero allowance, and it does not count against the per-IP cap
  either. Asserted on the counters, not assumed from the cache's existence.
- **Chargeable calls are strictly fewer than proxy requests** (5 of 6 here),
  which is the whole reason the two cannot be used interchangeably. The suite
  asserts that inequality so the distinction cannot quietly collapse again.
- **A reload after a selection costs nothing**, because the full card was
  persisted. The scan-revisit case costs 4 requests for the same gesture,
  because only a name was stored.
- **Fallback-provider traffic moves independently.** It stays at 0 while TPL
  answers, because a fallback is only consulted when TPL returns nothing.

**What it still does not establish.** One session shape is not a distribution.
**5 chargeable calls for 4 cards is the result of this scripted scenario and
nothing more — it is not a production ceiling.** Corrected 2026-09-09: an
earlier version of this section called it a ceiling on the grounds that
production shares one cache across sellers while the fixture's cache is
per-session. Shared caching does pull in that direction, but it is only one of
the forces. Different queries do not share entries, a retried or re-typed search
after `cacheTtlSec` expires is a fresh miss, and a seller who searches more
widely than this script charges more per card. Production demand can land above
this figure as easily as below it, and this run does not bound it in either
direction.

That is still enough to set the six `TPL_*` values as **explicitly
provisional** — a scenario-justified starting point that is honest about being
one. It is not enough to call them measured, and no wording here should imply
that it is.
Refining them from a real-traffic percentile is a post-launch improvement and
**is not a launch prerequisite** — collecting traffic cannot be a precondition
for the release that generates the traffic. What remains genuinely blocking is
unchanged and is configuration, not measurement: **the six `TPL_*` variables
are absent from Vercel, so none of these defaults are in force in production.**

No live request was made anywhere in this work. Providers and the proxy are
mocked throughout, successful-response caching is untouched, and no limit was
probed.

### Early input versus the startup demo — a defect, found and fixed

Waiting for the demo to settle kept the other cases honest and proved nothing
about a seller who starts typing straight away. Driving that case found a real
defect, and it was worse than a stale value.

`autoRunExampleCard()` writes "Charizard" into the search box, runs `doSearch`,
then **polls for up to nine seconds** for a dropdown row and clicks the first
one it finds. A seller typing inside that window had their own results clicked
for them: the fixture typed `pikachu`, and the box ended up holding
**"Pikachu ex"** — a printing chosen by the page, not by the seller, on a card
they were still mid-way through searching for. Everything downstream — the
price panel, the payout comparison, the listing draft — would have been built
from that unrequested selection.

Two guards, one rule: **once there is real input, the demo is over.**

1. **It will not clobber a non-empty box.** If anything is already in the search
   input when the demo starts, it returns without writing. This also removed a
   fixture flake in which the demo's own late write overwrote a case's text and
   failed a random caller each run — the same defect, one beat earlier.
2. **It abandons its poll the moment the seller touches the box** — `input`,
   `keydown` or `paste`, plus a value re-check immediately before the click,
   because the rows the poll is about to click may be *theirs*.

It returns `'abandoned'` rather than `false` in both cases: `false` means the
demo *failed* and the caller pulses the "Try Charizard" prompt, and a seller who
is already typing does not need to be pulsed at.

Verified in the browser (case group H, six assertions): the demo does write
"Charizard" before the seller starts, the seller's `pikachu` is in the box
immediately after typing, **it is still `pikachu` after the demo's poll window
closes**, no printing was chosen out of the seller's own results, their results
are still on screen to choose from, and no uncaught rejection escaped while the
two overlapped. Plus one that matters as much: **left alone, the demo still runs
and still selects the example printing** — a guard that silently disables the
feature it guards is not a fix.

### The scan panel now discriminates too

Adjudicated: the seller should not have to reconcile a generic panel against a
more precise dropdown, and this is inside RV-13's existing purpose rather than
new scope.

`_renderScanMissPanel` said **"Live pricing unavailable"** whether we had looked
and found no live price or had never completed the lookup. It took no lookup
outcome at all — it could not have discriminated. The scan path now keeps the
last TPL outcome it saw and hands it to the panel, which renders:

| Situation | Headline | Body | Attribute |
| --- | --- | --- | --- |
| lookup completed, no live price | "Live pricing unavailable" | unchanged — track it, check sold comps | `data-scan-price-state="no_price"` |
| lookup did not complete | **"Price lookup unavailable"** | the reason, then "This card loaded, so nothing is lost — we just could not finish checking its price. The sold-comp links below still work." | `data-scan-price-state="unavailable"` + `data-tpl-reason` |

The reason sentences come from `TPL_UNAVAILABLE_MSG`, the same vocabulary the
dropdown uses — one vocabulary, not a second one that can drift from it (Rule 1).

Case group G asserts this on the element rather than on the copy, in all four
conditions: the failed conditions carry `state="unavailable"` with the matching
reason, the successful-empty condition carries `state="no_price"` with **no**
reason and does not claim the lookup failed, and **panel and dropdown agree on
the reason** in every failing condition. That last assertion is the one that
would catch the two surfaces drifting apart again.

### Follow-up — the four-request scan revisit (not a release blocker)

Adjudicated as a follow-up optimization: request count alone does not make it a
release blocker. **How many of those four requests are charged in production is
unmeasured** — an earlier version of this section asserted they would be "mostly
cache hits in production, where the cache is shared." That was an inference from
the cache's existence, not a measurement, and it is withdrawn. What is measured
is the request count below.

Revisiting a scanned card costs **4 `/api/tpl-proxy` requests** because the
restore hydrates twice — it detects the panel was cleared and re-hydrates — and
each hydration runs the scan path and then its `doSearch`. Measured, not
argued.

**The constraint on fixing it: card identity must survive.** The double
hydration is doing something. The restore path deals with a snapshot that has a
name, number, set and rarity but no `_fullCard` and no grounded id, and the
match strategies that resolve it — exact number, then leading-zero-stripped
number, then rarity+set — are exactly what keeps a revisit from silently landing
on a *different* printing of the same name. Any de-duplication has to keep the
resolved card identical to what the un-optimized path resolves, and that is the
test to write first: same snapshot in, same card id out, fewer requests. **Not
attempted in this pass.**
### Three things the suite found about the suite

Recorded because each produced a confident false result first, and a harness
that lies deserves the same scrutiny as code that lies:

1. **Route registration order.** Playwright resolves the **most recently
   registered** matching handler. A catch-all `**/api/**` alongside the specific
   `tpl-proxy` mock silently decides the outcome by registration order — the
   suite has no catch-all for this reason, and the same mistake reappeared in a
   scratch debug script and made the scan path look broken when it was not. The
   glob `**/api/tpl-proxy*` also matched nothing; the mock uses a regex.
2. **Reading `dropList` once was flaky** — some callers paint a "Searching…"
   placeholder first, and a different caller failed on each run. The read polls
   past loading states.
3. **The page writes to the search box on its own at startup.** The
   first-visitor demo overwrote the seller's text mid-case, and a random caller
   failed each run reporting the input as "Charizard". The element-level input
   assertion is what surfaced it; the copy-level check never could. Cases wait
   for the page to stop writing before asserting — **and this one turned out not
   to be a harness artefact at all.** Driving the case deliberately (group H)
   showed the same demo could overwrite, and then auto-select from, a real
   seller's input. It is fixed in the product, not worked around in the fixture;
   the section above records it. A flaky test was reporting a real defect.

### Questions for Will — RV-13

Both earlier questions here have been decided by you and are implemented above —
the four-request revisit is recorded as a follow-up optimization with the
identity constraint attached, and the scan panel now discriminates. What is left
is not a question about the work:

1. **Nothing is pushed.** This is branch-local: `phase1-block-d`, live bundle
   `core.569ff536.js` still has RV-13. Production still serves Phase 0 and still
   shows the old behaviour on all three of these — the generic scan panel, the
   demo that can overwrite early input, and the lookup failure that reads as
   "no such card". A push to `main` auto-deploys, so it waits on you saying so
   explicitly.

---

## RC-2 item 1 — shipping assumptions in the listing packet (`552df07`, `37269c9`, local)

> **Status 2026-09-09: item closed locally.** `552df07` recorded shipping in the
> packet; `37269c9` carried it to the seller and answered both questions above.
> Read the two subsections at the end of this item — "The gap `552df07` left"
> and "Verification of create → save → reload → review" — before treating the
> earlier prose as current.

**Status: implemented, local only.** Nothing pushed; `origin/main` is still
`9aaf326` and production still serves Phase 0.

### What this is, and what it deliberately is not

The scope agreed for RC-2 framed this as *carrying the seller's existing
shipping assumptions into the draft* — not building a shipping model. That
distinction did all the design work here.

The venue comparison already computes shipping into the payout it ranks on:
`netPayout = price + effectiveShipCharge − totalFees − sellerShip`. That is one
business behaviour, and it already has one implementation. So the packet records
what the seller declared and states plainly that its own net figure excludes it.
It computes nothing. There is a test that builds the same packet with and
without shipping and asserts the pricing block is byte-identical — if a later
change makes shipping move a number in this file, that test fails, which is the
point of it.

### The blank-versus-zero problem

Both client inputs (`index.html:2512` for what the buyer pays, `:2518` for what
shipping costs you) are declared with `value="0"`. A zero in those fields is the
default, not a statement. The packet therefore cannot tell "I ship free" from "I
never touched that field", and rather than pick one it says so: a declared zero
is recorded as declared, with a note that it is unconfirmed. This is the same
position RC-1 took — zero is a fallback assumption, not an established cost.

Related, and deliberate: a negative cost is recorded as supplied rather than
clamped to zero. Clamping would make a sign error indistinguishable from free
shipping.

### Two defects found while writing the tests

Both were in code I had just written, and both were the same class of bug —
two representations of one fact:

1. **Absent had two shapes.** A missing shipping object returned `null`; an
   empty object returned a block whose every field was false/null. Same fact,
   two answers for anything branching on `shipping === null`. It now collapses
   to `null` — but only when the seller said nothing at all. If a value was
   supplied and rejected as unreadable, the block survives, because that
   rejected text is the one thing the seller needs in order to correct it.
2. **An unreadable value reported as absent.** The absent/partial split was
   keyed on whether a value *parsed*, so an unreadable entry produced
   `SHIPPING_ABSENT` next to `SHIPPING_UNPARSEABLE` — one finding saying the
   field was empty, the other quoting its contents. The split now turns on
   whether the seller *said* anything; an attempt counts as an attempt.

### Schema bump, 1 → 2

This one needs your eye because it touches stored data rather than only new
writes.

Adding a field to the packet is not free. A v1 packet has no `shipping` key, so
read by the new code it would have reported CURRENT with `shipping` undefined —
which at the consumer is indistinguishable from "the seller declared nothing".
Those are different events. A v1 packet was built by code that could not observe
shipping at all.

Packets are persisted on draft create (`api/drafts.js:757`) and the review screen
reads them, so any drafts you or anyone else created before this carry v1
packets. This is live data. The schema is now 2 with a registered 1 → 2 hop that
lands an explicit `shipping: null`.

The hop does **not** synthesise a `SHIPPING_ABSENT` finding. It would have been
easy to add and it would have been a small lie: it would claim a build looked
for shipping and found none, when that build could not look. Anything that needs
to distinguish observed absence from inherited absence reads `migrationsApplied`.

### One judgement call, stated rather than buried

Shipping is **not** covered by the packet's input fingerprint. The fingerprint's
job is to detect a packet that no longer describes the draft it is attached to,
and it projects *persisted draft fields*. Shipping arrives as context, the same
way the price basis does, and that is not fingerprinted either. Covering it would
invalidate packets on a change the draft has no way to record.

I am reasonably confident this is right, but it is the kind of call that is
cheap now and expensive later, so it is written down and asserted in a test
rather than left as an accident of what I happened not to add.

### Decisions taken (2026-09-09)

- **Q-RC2-1 — DECIDED.** One net figure for Phase 1, labelled **"Estimated net
  before shipping"**, with the recorded shipping assumptions displayed beside
  it. A second calculated figure is **deferred**. Implemented in `37269c9`:
  the label changed at both render sites, and the assumptions render through
  `_reviewBasisRow` — the existing qualifier-in-parentheses mechanism for a
  number that is disclosed but not counted — rather than as fee rows, which
  are deductions the model applied. A test asserts the net still equals gross
  minus the fee rows alone, so shipping cannot quietly start being deducted.
- **Q-RC2-2 — DECIDED.** Zero-unconfirmed stays **informational**; an untouched
  default must not silently become confirmed free shipping, and this is **not**
  a new readiness blocker. Implemented as a qualified row
  ("declared zero, unconfirmed") plus a notice, with a test asserting the
  notice carries no blocking imperative and that readiness is unaffected.

### Verification

| Suite | Result |
| --- | --- |
| `tests/listing-packet-offline.mjs` | 270 passed, 0 failed |
| `tests/draft-index-recovery.mjs` | 259 passed, 0 failed |
| `tests/draft-store.mjs` | 147 passed, 0 failed |
| `tests/draft-review-screen.mjs` | 370 passed, 0 failed |
| `tests/draft-crud-e2e.mjs` | 192 passed, 0 failed |
| `tests/draft-readiness.mjs` | PASS |

Three fixture repairs were needed and none of them relaxed a check. Fixtures
that meant "a current packet" had hardcoded the literal `1` and broke on the
bump for reasons unrelated to what they test — they now import the constant, so
the next bump does not repeat this. The "an older version with no registered
migration is refused" fixture used v1 as its example of an unregistered hop;
since v1 now has a real migration, it moved to 2 → 3, which genuinely has none.
And `draft-index-recovery.mjs` overrode `PACKET_MIGRATIONS[1]` for a test and
ended with `delete` — harmless when the table was empty, but it would now strip
a real production migration for every later assertion in that process. It saves
and restores, and asserts the restore.

`tests/run-all.sh` was not run.

**Next in RC-2:** item 2, condition guidance; item 3, listing description text.
Target-net entry stays deferred.

---

## RC-2 item 1 — the gap `552df07` left, and its closure (`37269c9`, local)

`552df07` was reported as sound, and the packet side was. It was also, on its
own, invisible: **no seller could ever have seen a shipping figure.** Two
independent breaks, one at each end of the chain, both established by reading
the live bundle rather than inferred:

| End | Finding | Evidence |
| --- | --- | --- |
| Send | `_crPricingContext` returned only `{feeModelRevision, feeScheduleVerified?, basisMeta?}` — no shipping key existed | `_crPricingContext()` in the bundle at `37269c9^`, then named `js/core.2cb1e377.js:20903`. Left at its original commit as historical evidence. That filename never matched its own bytes (they hashed to `57f78056`); the commit is what makes the line resolvable. |
| Render | No shipping rendering at all; `grep` for `packet.shipping` and `SHIPPING_[A-Z_]*` in the live bundle returned **zero matches** | live bundle, pre-`37269c9` |

So in production every draft would have recorded `SHIPPING_ABSENT` and the
review screen would have shown nothing. The suite totals in the previous
section were true and did not establish this, which is exactly why the
create → save → reload → review demand was the right gate.

### The prior decision this had to respect, not overrule

Wiring the obvious way — read `#shipCharge`/`#shipCost` from the review screen
— would have reintroduced a bug a previous decision had explicitly refused. The
fee-breakdown comment in `_reviewFeesHtml` states the rule:

> shipCharge and shipCost live on the scan surface and describe the card
> currently in hand … Reading those inputs here would quietly attribute the
> last scanned card's postage to an unrelated draft, which is precisely the
> invented figure Sec 5.5 refuses.

That reasoning is correct and is preserved. The resolution is **when** the
values are read, not whether the rule holds:

- **Capture at create**, gated on the same identity test the price basis
  already passes — `_crIntentToken(cardInHand) === _crIntentToken(cardBeingDrafted)`.
  Fails closed: no card, or a different card, and shipping is omitted, which
  the server reports as `SHIPPING_ABSENT` rather than as a declared zero.
- **Render from the persisted packet only**, with **no fallback** to the live
  inputs — so the misattribution the comment refuses cannot occur even for
  drafts whose packet is missing.
- Raw strings go up **unparsed**. The ranking surface's `|| 0` coercion is
  deliberately not applied: it converts an unreadable entry into a confident
  zero, the precise failure the packet's vocabulary exists to prevent.

One clause of that comment — "a draft record carries no shipping field at all"
— was made false by `552df07` and is now **corrected in place**, with the
reasoning it supported restated and kept.

### A copy defect the new tests found

Five shipping messages interpolated internal object keys into seller-facing
prose. `notes[].message` is rendered **verbatim** to the seller, so this was
seller-visible, not cosmetic:

> Shipping **buyerPays** and **sellerCost** came through as zero. That field
> starts at zero, so **this packet** cannot tell …

One `SHIPPING_SIDE` map now supplies "what the buyer pays" / "your postage" to
every branch, so the two names cannot drift between codes, and
`SHIPPING_NOT_IN_NET` no longer says "this packet". `notes[].fields` still
carries the internal keys, because that side is machine-read — a rename there
would have broken every consumer. A guard in the offline suite now runs every
shipping shape and rejects internal spellings in any note message.

### Verification of create → save → reload → review

Not suite totals. Three fixtures created through the **real POST handler** and
read through the **real GET**, then asserted in the browser:

| Fixture | Declared | Read back at review |
| --- | --- | --- |
| `packetShipDeclared` | `5.99` / `4.50` | both figures render, qualified "not in net" |
| `packetShipZero` | `0` / `0` | shown, qualified "declared zero, unconfirmed", `SHIPPING_ZERO_UNCONFIRMED` INFO |
| `packetShipUnreadable` | `"four dollars"` / `4.50` | rejected text handed back verbatim; readable side still shown |

What the assertions pin, beyond the figures appearing:

- The zero notice is **actually visible** — measured via `offsetWidth`/
  `getClientRects`, not merely present in the DOM. This screen has shipped a
  banner with dead styling before, so DOM presence is not accepted as proof.
- **Exactly one** net figure is shown, per the decision.
- The net still equals **gross minus the fee rows alone**, so shipping is
  disclosed and not deducted.
- The unreadable entry is **not coerced to `$0.00`** and does not vanish.
- The notice carries no blocking imperative, and readiness is unchanged.

Two assertions were **re-pointed, neither relaxed**:

1. `shipping is not rendered as a $0.00 fee row` matched `/ship|postage/i`
   against every label. It passed only while no label anywhere contained the
   word — and the relabel to "Estimated net before shipping" made it fail on
   the very label whose job is to disclose the exclusion. A guard that fires on
   an honest disclosure is testing spelling, not behaviour. It now matches on
   row **kind**, and gained a companion that still forbids an invented shipping
   figure in a fee row.
2. The net-label assertion moved from `/item only/` to `/before shipping/`,
   per Q-RC2-1.

| Suite | Result |
| --- | --- |
| `tests/listing-packet-offline.mjs` | **395 / 0** (was 270; +125 incl. the copy guard) |
| `tests/draft-review-screen.mjs` | **389 / 0** (was 370) |
| `tests/draft-crud-e2e.mjs` | 192 / 0 |
| `tests/draft-index-recovery.mjs` | 259 / 0 |
| `tests/draft-store.mjs` | 147 / 0 |
| `tests/draft-readiness.mjs` | PASS |
| `tests/run-all.sh` | **not run**, per standing instruction |

### Bundle naming — DONE (rewritten in place 2026-09-09)

This section said the rename was deliberately deferred and the asset check was
red by design at 69 / 4. Both statements are now out of date, and the section
is corrected here rather than contradicted further down.

RC-2's bytes settled and the rename happened: `js/core.2cb1e377.js` →
**`js/core.53a0674d.js`**, with the `index.html` reference updated to match.
`tests/asset-fingerprints.mjs` is **81 passed / 0 failed**, and every
`js/core.*.js` on disk hashes to its own name.

### New finding — three retired bundles are missing from disk (SUPERSEDED)

> **Superseded 2026-09-09 by "Q-RC2-3 — resolved" below.** The section as
> written overstated the impact. It is kept because the correction is the
> point, but the production-defect claim in it is **withdrawn**. Read the
> resolution instead.

Raised, not fixed, because it **pre-dates this work** and is not RC-2 scope.
`tests/asset-fingerprints.mjs` reports `js/core.176e4a56.js`,
`js/core.73a71fac.js` and `js/core.e9f21f4e.js` absent. This is a real user
impact rather than bookkeeping: `vercel.json:47-48` serves `/js/*` as
`immutable`, so a browser holding cached `index.html` that references one of
these gets a **404 and a blank app**.

Two of the three are recoverable from git — `73a71fac` from `33434a6` and
`e9f21f4e` from `6cf5922` — by the method the test itself prescribes
(`git show <commit>:js/core.<hash>.js > js/core.<hash>.js`). `176e4a56` appears
in **no commit** and may be unrecoverable, in which case it needs a
declared-unrecoverable entry like `fec7fb3a` already has rather than a restore.

**Question for you — Q-RC2-3.** Both restores touch retired bundles rather than
live code, so they are low risk, but they are outside RC-2 as scoped. Restore
the two recoverable ones and declare `176e4a56` unrecoverable as part of
finishing RC-2, or file it as its own release-validation item? These files
became reachable through commits that are on the branch and not in production,
so I have not established whether any production `index.html` ever referenced
them; I can determine that before acting if you would rather decide on
evidence.

---

## R4 / TPL verification — correction accepted (2026-09-09)

The record previously implied that removing the Preview `CARDSELL_TPL_KEY`
would demonstrate R4. **It does not, and that is now recorded as the standard.**
A missing key can bypass the reservation path entirely, so an absent-key
response proves only that the key was absent.

Verification of R4 requires all of:

| Requirement | Why the weaker version fails |
| --- | --- |
| The **real isolated Redis store** | A shared store cannot show that writes landed in the right place |
| A **controlled upstream fixture** | Without one, a pass may reflect upstream behaviour rather than R4 |
| Evidence the **reservation, caching and refusal paths actually ran** | A response shape alone does not show which path produced it |

Also recorded: **previously built deployments retain their old credentials**,
so isolation is not complete while they remain reachable — this is the same
open Safeguard 2, and it applies to R4 verification directly.

Two further corrections to the surrounding record:

- Redis separation is **configured**; **deployed verification remains pending**.
  The newer environment records do not by themselves close RV-10.
- The provider screenshot is **no longer required**.

Standing constraint restated because it governs how this gets verified: the
deployment being activated must contain **both R4's implementation and its
intended configuration**. Changing environment variables after a deployment
requires a **new deployment** to carry those settings; reading them at call
time does not change that.

### Phase 1 completion

**Approximately 92%**, by judgment. Production remains on the **Phase 0**
experience.

---

## RC-2 item 1 — the sender, closed on evidence (`535f8fc`, local)

The earlier closure was incomplete and the gap was correctly identified: the
three fixtures prove **POST → storage → GET → display**, but they hand
`pricingContext.shipping` to the POST handler themselves. `_crPricingContext`
— the half that was actually broken — is never invoked by them. **A fixture
that supplies the value cannot detect a sender that never produces it.** Those
three sections would have stayed green against the exact defect they were
written for.

### The case that closes it

One browser case, from the button a seller presses to the reopened review
screen, with the **real endpoint and store** in between:

| Step | What is real |
| --- | --- |
| Card on the panel | `loadCardUI()`, the production render path — so the Sell row has a visible ancestor for the reason it does in production |
| Sell button revealed | the real `applySellGate()`, off an eligibility response; `_crSellApproved` is set by the gate, not by the test |
| Shipping entered | typed into `#shipCharge` / `#shipCost`, not injected into a context object |
| Create | `page.click('#crSellBtn')` → the real `startListingDraft()` → `_crCreateDraft()` → `_crPricingContext()` |
| Server | the browser's own POST body handed to the **production handler**; the GET reads it back through the same handler |
| Reopen | `openDraftReview()` on the id the handler returned |

Between create and reopen the case does the thing the boundary exists for: it
**changes the card in hand** to card B via the real path and sets the shipping
inputs to `99.99` / `88.88`. The draft must still show `7.25` / `3.10`.

### What is now asserted that was not before

- The create body's `pricingContext.shipping` **exists** and carries `7.25` /
  `3.10` — the sender asserted directly, on its own output.
- The values arrive **unparsed and uncoerced**, as strings.
- After the card change, the review screen shows the **created** figures and
  **not** `99.99` / `88.88`. A fallback to the live inputs fails here.
- The Sell button is **genuinely on screen** (`offsetWidth` / `getClientRects`),
  not merely `display:block` under a hidden ancestor.
- **The sell path and the identity gate agree on which card is in hand.** This
  one was unplanned and matters: `startListingDraft()` drafts
  `window._crSellApproved` while the capture gate compares against
  `selectedCard`. Nothing previously established that those two agree, and if
  they ever diverge, shipping is silently dropped on **every legitimate press**
  — the original bug, restored, with all other assertions still green.

### The case was verified by making it fail

A green new test proves nothing on its own, so the sender was mutated
(`if (false && …) ctx.shipping = ship`) and the suite re-run. It failed at
exactly the intended assertion, and the context the mutant produced was

```
{"feeModelRevision":1,"feeScheduleVerified":"2026-09-01"}
```

— **byte-identical to the pre-fix shape**. So this case detects the original
defect, not merely a hypothetical one. The mutation was reverted and the
assertion made null-safe so a future regression reports a failure rather than
throwing past the remaining checks.

`tests/draft-review-screen.mjs`: **399 / 0** (was 389).

**Item 1 is closed.**

---

## Q-RC2-3 — resolved as release cleanup. No production defect existed.

### 1. The production-defect claim is withdrawn

I said a cached `index.html` referencing a missing bundle would 404 into a
blank app. **No deployed `index.html` ever referenced any of the three.**

| Check (`origin/main`) | 176e4a56 | 73a71fac | e9f21f4e |
| --- | --- | --- | --- |
| Commits referencing it in `index.html` | 0 | 0 | 0 |
| Commits referencing it in **any** file | 0 | 0 | 0 |
| Ever added to `origin/main` | no | no | no |

`origin/main`'s `index.html` references exactly one bundle —
**`js/core.569ff536.js`** — and that file is present on disk (911,576 bytes).
All three missing generations are **branch-only artifacts** of the RV-13 work,
retired before anything shipped.

Two corrections to my own reasoning, both accepted:

- **Branch-only references do not establish a production defect.** I inferred
  reachability from the citation map, which tracks branch history, and did not
  check `origin/main`. The check takes one command and I should have run it
  before filing an impact claim.
- **The `/js/*` immutable header does not establish that an older HTML document
  is still cached.** `vercel.json:47-48` sets caching for **JavaScript**
  responses; the lifetime of a previously served `index.html` is governed by
  that document's own headers, which I did not examine. The header made the
  consequence *conditional*, and I stated it as established.

So this is **citation hygiene** — keeping the bundles a reviewer's `file:line`
citations point into — not a reachable-asset defect.

### 2. One bundle restored, byte-exact

Every commit carrying each path was enumerated and the **blob hashed** rather
than trusting the commit noted earlier — which was wrong in both cases:

| Bundle | Earlier note | Verified |
| --- | --- | --- |
| `73a71fac` | "recoverable from `33434a6`" | recoverable from **`1321d7b5`** |
| `e9f21f4e` | "recoverable from `6cf5922`" | **not recoverable at all** |

`js/core.73a71fac.js` restored from `1321d7b5`, verified `sha256[:8] = 73a71fac`
at 1,212,859 bytes, and `node --check` clean.

### 3. Two are unrecoverable — established, not assumed

`e9f21f4e` was recorded as recoverable. It is not. The two commits carrying
that path hold bytes hashing to `b5eefbc0` and `b46e38e2`; **neither matches
the name.** Restoring from either would have put wrong bytes behind a hash that
claims to identify them — worse than the absence, and precisely what the
fingerprint rule exists to prevent.

Both were then checked beyond their own paths: **every `js/core.*.js` blob in
`--all` (56 objects) was hashed**, and none produces `e9f21f4e` or `176e4a56`.
Both are now declared unrecoverable by name with that reason, which is the
mechanism's deliberate, reviewable act — not a wildcard.

Because neither was ever deployed, an exception entry **does** resolve this
one: there is no compatibility question to leave open. Had either been
deployed, the entry alone would not have been sufficient, and the standard for
that case is recorded here.

### 4. The rename — DONE (rewritten in place 2026-09-09)

This section said the rename was still pending and the asset check stood at
73 / 1. Both are now out of date; corrected here rather than appended to.

`js/core.2cb1e377.js` → **`js/core.53a0674d.js`**, `index.html` re-pointed,
`tests/asset-fingerprints.mjs` **81 passed / 0 failed**. This closes RC-2's
completion requirement.

Two findings surfaced while settling it, both recorded in
`audit/BUNDLE_CITATION_MAP.md` under generation 13:

- **`2cb1e377` was never a settled generation.** No blob in the repository
  hashes to it. The rename to that name at `197a5b2` happened in the same
  commit that edited the file, so the committed bytes hashed to `57f78056`
  from the start, then `80f64317`, then `53a0674d`. The asset check was
  reporting this the whole time; the red was read as sequencing, and it was
  also a genuine mislabel.
- **`613f164a`, the name before it, has the same defect** — created at
  `6cf5922` already holding bytes hashing to `b5eefbc0` — and is absent from
  disk. It cannot be restored without inventing content. Both names, and the
  three byte hashes, are now listed by name and reason in the UNRECOVERABLE
  table in `tests/asset-fingerprints.mjs`, which is a reviewable act rather
  than a wildcard.

The citation map header was also corrected: it named two different live
bundles in consecutive paragraphs (`e9f21f4e`, then `3f83abec`), neither of
which was live.

---

## RC-2 items 2 and 3 — condition guidance and description text

Commit `fe1ae2e`, plus the rename commit. **Local only. Nothing deployed.**

### Item 2 — condition guidance

`CONDITION_GUIDANCE` in `api/_conditionDescriptors.js`, attached as `guidance`
on both branches of `buildConditionBlock`, rendered by
`_reviewConditionGuidanceHtml()`.

Against the stated boundary — guidance helps the seller assess and confirm
condition, and must not turn an AI estimate into a certified grade:

- The raw guidance says it in as many words: "Any estimated grade this app
  shows is a scan estimate, not a grade. Do not enter it as one, and do not
  describe the card as graded."
- It is also true structurally, not just in copy. `estGrade` is **not** in
  `IDENTITY_WIRE_FIELDS` (`api/_cardIdentity.js:148-163`), so the estimate
  never leaves the browser and cannot reach the packet at all. `isSlab(row)`
  requires **both** grader and grade, so a row carrying only `estGrade` is
  `Ungraded`.
- The graded branch says the app "does not verify" the slab; it asks the
  seller to confirm the label matches.

Guidance renders immediately **after the Condition row**, not after the field
list. The list continues past Condition for four more rows, so guidance at the
end sat well below the thing it was about.

### Item 3 — description text

New `api/_listingDescription.js`. `buildListingDescription` composes the text
from recorded card details and the seller's own declarations.

Against the stated boundary — no invented defects, authenticity claims,
packaging or shipping promises:

- Values are read from the normalized aspects bag, so there is one mapping
  from card data to description, not a second one that can drift.
- Raw cards get **no condition line at all**, an explicit
  `omitted: ['condition']`, and an INFO note saying so. Condition on a raw
  card is the seller's declaration; the description does not guess it.
- Graded cards reuse `conditionHandoffLines` rather than restating it.
- Nothing in the module emits packaging, shipping or authenticity text.

### Copy consolidated

Three separate strings had grown to tell a raw-card seller where to set
condition: the condition note, the guidance, and the description note. Each
was defensible alone; together they read as the app not trusting the seller to
have read the previous sentence. Now stated once, with an assertion pinning
the count at exactly one (`tests/listing-packet-offline.mjs`).

### Packet schema at 3

Adding `description` changed the packet's shape, so the version bumped 2 → 3
with a registered `2 -> 3` hop. Without the bump, a v2 packet read by v3 code
reports CURRENT with `description === undefined` — indistinguishable from a
build that produced nothing, which is the silent null this repo treats as the
bug. Same argument the `1 -> 2` shipping hop was built on.

The migration writes `description: null` and `condition.guidance: null`. It
deliberately does **not** reconstruct the description from stored aspects: the
text a seller copies has to be what their own draft's build produced, not
something inferred later from a subset of inputs. No condition block is
fabricated where none existed.

### Verification

Verified through the seller's actual review and copy actions in a real
browser, and mutation-tested — the lesson from item 1 being that a fixture
supplying a value cannot detect a producer that never emits it:

| mutation | result |
|---|---|
| description producer returns empty text | 3 assertions fail |
| copy branch rebuilds from rows instead of using the packet text | 3 assertions fail |
| `guidance` key removed from the condition block | 3 browser + 2 offline fail |

| suite | result |
|---|---|
| `tests/listing-packet-offline.mjs` | 472 / 0 |
| `tests/draft-review-screen.mjs` | 417 / 0 |
| `tests/draft-index-recovery.mjs` | 259 / 0 |
| `tests/draft-crud-e2e.mjs` | 192 / 0 |
| `tests/draft-store.mjs` | 147 / 0 |
| `tests/draft-list-screen.mjs` | 101 / 0 |
| `tests/asset-fingerprints.mjs` | 81 / 0 |
| `tests/condition-applicability.mjs` | 17 / 0 |
| `tests/draft-readiness.mjs`, `tests/copy-truth-offline.mjs` | PASS |
| `tests/run-all.sh` | **not run**, per standing instruction |

A fixture repair came with this: the "no registered migration" check in
`tests/draft-index-recovery.mjs` used a literal version, and a literal version
there becomes a real hop at the next bump — it had already broken once that
way. It is now derived from `PACKET_SCHEMA_VERSION`, so it moves itself.

---

## Questions for you — RC-2 items 2 and 3

**Q-RC2-4. Should the pricing condition become a listing declaration?**
The pricing panel has a condition selector (`#condPills`, values
`nm/lp/mp/hp/dmg`). The listing path does not read it: `_crPricingContext`
does not capture it, and the packet does not receive it. I left it that way on
the reasoning that a condition chosen to *fetch a comp* and a condition
*warranted to a buyer* are different statements, and silently promoting one to
the other would put a declaration in the seller's mouth. The cost is that a
seller who already picked "LP" for pricing picks condition again in eBay's
form. Leave them separate, or prefill the listing condition from it as an
editable suggestion?

**Q-RC2-5. Should the description carry a provenance line?**
The description is currently card details only. I deliberately omitted any
"identified with CardResell" or comp-source line — it is buyer-facing text,
and a line about our tooling is a marketing claim in a place a buyer reads as
a product statement. Confirm omission, or specify wording.

**Q-RC2-6. The line-number citations against `core.2cb1e377.js`.**
Audit documents from this block cite line numbers in a filename whose bytes
were never stable (see §4 above). Those citations resolve against whatever the
working file held when each document was written. Re-resolving them to
`53a0674d` is mechanical but touches many documents. Worth doing before
release, or accept the map's generation-13 note as the explanation?

---

## Redis reconciliation, and what Preview can still reach — 2026-09-10

**A tooling change makes this section evidence rather than recollection.** The
Vercel REST API is unreachable from this sandbox (curl exit 60, HTTP 000) and
that had been treated as "no direct verification available". It was not: a
`vercel` CLI is installed at `/usr/local/bin/vercel` and reaches the API
normally. Everything below is read from it. No values were requested, read or
printed — `env ls` reports names, targets and ages only.

### 1. The KV separation is complete as configuration

Ten rows, two disjoint groups, no name targeting more than one group:

| names | target | age at check |
| --- | --- | --- |
| `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, `REDIS_URL` | **Preview, Development** | 3h |
| the same five | **Production** | 3h |

This closes the reconciliation Will asked for. The queue held two statements
that could not both be true — §4 step 5 said Preview and Development were bound
to nothing, while the store table recorded `upstash-kv-aureolin-door` as
targeted at Preview and Development. The listing settles it in favour of the
store table; step 5's sentence described a real midpoint that has since been
passed, and is struck through in place rather than deleted.

All ten rows report `Encrypted`, consistent with the padlock observed at 17:20.

### 2. Row ages, and what they do not prove — **narrowed 2026-09-10 00:24**

| | |
| --- | --- |
| live production deployment | `dpl_BJuH3okrHAsHpM7vUhCZv85or225` |
| created | 2026-09-09 17:03:19 UTC (**7h** before the check) |
| aliases | `www.cardresell.org`, `cardresell.org`, `cardresell.vercel.app`, `…-git-main-…` |
| bundle served | `js/core.569ff536.js` — **Phase 0**, confirmed in the cloud browser |
| KV rows | **3h** before the check |

The KV rows are four hours newer than the deployment carrying them. **An earlier
version of this section inferred a current fault from that and called for an
extra production deployment. Both went too far, and the reasoning is corrected
here rather than softened.**

A new row timestamp records that the row's **scope** was rewritten. It does not
record that the production **database or its credentials** changed — and under
Safeguard 1 the production values were specifically meant to survive the scope
change. The likeliest state is therefore that the running deployment still holds
the same working credentials it was built with, pointing at the same production
store. Nothing observed contradicts that.

So:

- **No current fault is asserted.** Production is not presumed misbound.
- **No deployment is required on this evidence.** Row age alone does not justify
  a rebuild.
- **What remains true** is narrower: the *binding* of a production build made
  after the scope change has not yet been observed. That is a verification gap,
  not a defect, and it is satisfied by checking the binding of **the next
  production build that happens anyway** — folded into the eBay rotation
  rebuild (decision 5 below).

There is still no read-only way to observe a binding from outside:
`api/health.js` returns `{ok, service, time}` and nothing about store binding,
and the endpoints that would reveal one consume paid quota. **Not probed.**

### 3. Preview deployments — **corrected: twenty-one exist**

**The earlier claim that no Preview deployment exists was wrong, and the way it
was wrong is worth recording.** It rested on an unfiltered `vercel ls`, whose
first page returned twenty rows that all happened to be Production — because
Production deployments are the recent ones. The listing was read as a census
when it was a page.

Re-checked with an explicit filter and pagination:

| | |
| --- | --- |
| `vercel ls --environment preview` | **21 deployments**, across 2 pages |
| age | all **~70 days**, i.e. all predate the KV split by months |
| status | 19 Ready, 2 Error |

Two consequences, pulling in opposite directions.

**It sharpens Safeguard 2.** These 21 were built when the five KV names targeted
all three environments, so each was baked with credentials for the **production**
store — and Safeguard 1 deliberately preserved those values, so those
credentials are still valid. This is no longer a hypothetical about "existing
deployments retaining old access"; it is 21 named deployments that retain it.

**It is bounded by deployment protection.** Old Preview URLs are not openly
callable. `GET /api/health` on two of them returns **302** to
`https://vercel.com/sso-api?url=…`, setting a `_vercel_sso_nonce` cookie —
Vercel Authentication is on. Reaching the production store through one of these
requires an authenticated team session, not merely the URL. Exposure is
therefore internal, not public.

Nothing was invoked past the redirect, and no store was written.

### 4. Three production resources remain reachable from Preview

The KV work isolated the store. It did not isolate anything else. Rows still
targeting Preview, and whether code reads them:

| name | targets | read by | assessment |
| --- | --- | --- | --- |
| `PRICECHARTING_API_TOKEN` | Production, Preview, Development | `api/pricecharting.js` | **Live leak.** A Preview deployment would spend the production PriceCharting quota. Against "don't demonstrate abuse by consuming paid quota", and it sits on top of the unresolved permission thread. |
| `TURNSTILE_SECRET_KEY` | Production, Preview | `api/verify-claim-firebase.js` | Shared production secret; lets Preview validate against the production Turnstile site. |
| `BLOB_STORE_ID`, `BLOB_WEBHOOK_PUBLIC_KEY` | Production, Preview | **nothing** | **Dead configuration** — see below. |

The `STRIPE_*_PRICE_*` rows that target all three environments are price
identifiers, not credentials, and are not treated as leaks.

### 5. The recorded Blob question, settled

The open item asked whether `cardresell-blob` being Production+Preview gives a
Preview deployment write access to production photo storage. **It does not, and
the reason is stronger than scoping: no code reads either variable.** A search
across `api/`, `js/` and the HTML for `BLOB_STORE_ID`, `BLOB_WEBHOOK_PUBLIC_KEY`,
`@vercel/blob` and `vercel-blob` returns nothing outside `audit/`.

The `blobs.put(...)` call at `js/core.53a0674d.js:18811` is **IndexedDB**, not
Vercel Blob — `s.blobs` is an object store inside `_photoTx()`, which is what
"browser-local listing photos" means. D7 photos never leave the browser, so
there is no production photo storage for Preview to reach.

Both rows also display their values in plain text in the listing
(`-----BEGIN PUBLIC …`, `store_YYN5SXl8CzIa…`), i.e. Config rather than Secret.
Neither is a credential — one is a public key, the other an identifier — so this
is hygiene, not exposure. The hazard is that dead configuration reads as live.

### 6. One correction to the containment record

The record states the eBay variables are typed Config rather than Secret, and
that rotation must therefore write replacements as Sensitive.
`EBAY_CERT_ID`, `EBAY_VERIFICATION_TOKEN` and `EBAY_APP_ID` all report
`Encrypted` in the listing, the same as every other secret, while the two
genuinely non-sensitive rows print their values. That is evidence **against**
the Config typing, but it is not proof: the listing may collapse the
distinction the dashboard draws. **Flagged as contradicted, not corrected** —
writing replacements as Sensitive stays the instruction either way, since it is
correct under both readings.

### Decisions — recorded 2026-09-10 00:24

**D-RV-1. Preview deployment: the committed `phase1-block-d` branch.**
Confirmed to target Preview — the production branch is `main`, evidenced by the
`cardresell-git-main-…` alias sitting on the production deployment, so a
non-`main` branch builds as Preview. The recorded Phase 1 push authorization
already covers this; **technical readiness is the remaining gate**, not
permission. My objection to CLI deployment is withdrawn as stated: a clean
checkout does represent an exact commit, so CLI deployment is not inherently
untraceable. The branch is preferred here for the ordinary reason that the
commit is already pushed and attributable, not because the alternative is
untraceable.

**D-RV-2. PriceCharting: scope the production token to Production before any
Preview is created.** Ordering is load-bearing — a Preview built while the token
still targets Preview is baked with it. This is **separate from the completed
TCGPriceLookup rotation** and is not a repeat of it.

**Method — this one must be done in the dashboard, not by me.** `vercel env`
offers `add`, `remove name [environment]` and `update name [environment]`, and
`update` changes a **value**, not a target. There is no target-editing
operation. `PRICECHARTING_API_TOKEN` is a **single row covering Production,
Preview and Development**, so `vercel env remove PRICECHARTING_API_TOKEN
preview` has no partial-edit to perform — it acts on the record, and the record
is the one holding the production value. That value cannot be read here (and
must not be), so it could not be restored afterwards. Deleting it is precisely
the loss Safeguard 1 exists to prevent, so **the CLI route is rejected and
nothing was run.**

The safe route is the same one used for the KV rows: **edit the row's
environment checkboxes in the dashboard**, unchecking Preview and Development
while leaving the Production value in place. Owner action.

The same constraint applies to any other row in §4 whose targets need
narrowing.

**D-RV-3. Turnstile: give Preview a test configuration that cannot reach
production claim data.** Not a narrowing to Production-only. Recorded reasoning:
sharing a verification secret is not equivalent to sharing a writable database,
so the remedy is a distinct test credential rather than removal, and Preview
keeps the ability to exercise claim verification.

**D-RV-4. Blob: the demonstrated photo-path concern is closed.** Nothing reads
either Blob variable, and the photo path is IndexedDB, so there is no production
photo storage for Preview to reach. Cleanup of the unused identifier and public
key is **non-blocking** — not a release gate. My recommendation to delete them
is downgraded accordingly.

**D-RV-5. Production rebuild: fold binding verification into the already-planned
eBay rotation rebuild**, provided that rebuild's configuration is ready. **No
separate rebuild on row ages alone.** See §2 as corrected.

**Milestone:** a Preview with verified isolated writes, then R4 verification.
Credential scope changes still need the owner's authorization wherever it has
not already been granted — D-RV-2 and D-RV-3 both change credential scope.

### Open question — how a protected Preview gets verified

One technical-readiness item that D-RV-1 surfaces, and I do not think it has
been decided. The existing Previews sit behind Vercel Authentication, and a
fresh one will too, so an unauthenticated request to it returns a 302 to
`sso-api` rather than reaching `api/drafts.js`. Proving that a Preview's writes
land in the isolated store means getting an authenticated request to it. Three
ways, in my order of preference:

1. **Protection Bypass for Automation** — a project-level secret sent as
   `x-vercel-protection-bypass`. Scoped to this purpose, revocable, and it
   leaves production protection untouched. Requires the owner to generate it.
2. **Will drives it in his own logged-in browser.** No new secret, but the
   verification steps are manual.
3. **Disabling Preview protection.** Not recommended — it would expose all 21
   old Previews, which is precisely the Safeguard 2 access being contained.

Which route? Until one is chosen, the Preview can be *created* but its writes
cannot be *observed*, and the milestone needs the second half.
