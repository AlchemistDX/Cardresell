# Rotation runbook re-check — 2026-09-10 21:30 EDT
*(corrected 21:50: commit read from build logs, the 2026-09-09 deployment
identified as the TPL rotation rebuild, §3 recorded as a superseded plan, the
non-KV count corrected from three to one. Extended 22:05 with §7 eBay token
treatment and §8 verify-challenge operator requirements; §6 re-sorted so
separately-tracked work is not listed as a rotation gate. **Re-check closed**; extended 22:20 with three wording corrections, the GET/POST distinction, and §9 token inventory; §9's cache consequence corrected 22:40; output handling verified and EXP-1 registered 22:55.)*

Preparation only. **No production action was taken and none is proposed here
beyond what the existing runbooks already say.** Will performs the production
account actions.

The rotation documents were written on 2026-09-08/09, before the current
Preview existed and before the KV split. This re-check establishes which
instructions still point at things that exist, and separates the **Preview**
identifiers (which changed) from the **production** target (which must not be
replaced by them).

## 1. The production target, identified independently

I did not carry the runbook's `dpl_AuwggY9Y…` forward. I asked Vercel what is
live now.

| | |
|---|---|
| Production deployment | **`dpl_BJuH3okrHAsHpM7vUhCZv85or225`** |
| State | Ready |
| Created | 2026-09-09 17:03:19 UTC |
| Aliases | `www.cardresell.org`, `cardresell.org`, `cardresell.vercel.app`, `cardresell-git-main-…` |
| Bundle served at `www.cardresell.org` | `js/core.569ff536.js` (HTTP 200) |

**The runbooks' `dpl_AuwggY9YcPftJcqSnsztAw4qPfmT` is no longer the production
deployment.** It was created 2026-09-05; the current one was created
2026-09-09. Any step that says "redeploy `dpl_AuwggY9Y…`" now names a
deployment that is not live.

**Where it came from — already in the record, and I missed it.** This is not a
new or unexplained deployment. It is the **TPL rotation rebuild**:
`audit/TPL_ROTATION_RUNBOOK.md:507` records step 5 as *"Rebuild's own new id —
`dpl_BJuH3okrHAsHpM7vUhCZv85or225`, url `cardresell-bx1egjeuk-…`, READY, commit
`9aaf326` — the exact live commit"*, rebuilt from `dpl_AuwggY9Y…` via the REST
API after the TPL row was swapped, and `:532` turns that build-order fact into
the discriminator proving the replacement key is the one in use.
`RELEASE_VALIDATION_QUEUE.md:2600` names the same id as the live production
deployment. An earlier version of this document asked Will to explain a
deployment his own rotation record already documents. **That request is
withdrawn** — checking the rotation evidence was my job, not his.

### Its commit — established, and my §1 caveat withdrawn

**Commit `9aaf326`, branch `main`.** Read from the build log:

```
2026-09-09T17:03:21.050Z  Cloning github.com/AlchemistDX/Cardresell (Branch: main, Commit: 9aaf326)
```

`vercel inspect <id> --logs` supplies the commit that ordinary inspection does
not — as this record already said it had before. **I should have tried that
first**; the reviewer had to point me back at my own evidence.

This retires the hedge an earlier version of this section carried. I had only
bundle-level agreement (`origin/main` → `core.569ff536.js`, and production
serving that bundle) and called the commit "probable and unverified". It is now
read directly from the deployment's own build.

**And the narrowed claim can be widened, but only because of this.** I wrote
that production runs no `phase1-block-d` work on the strength of the bundle
match; the reviewer was right that this was invalid — **a bundle filename
identifies the frontend, not the deployed API code**, and `api/*` could differ
with `index.html` untouched. The claim now rests on the **deployment source**:
this deployment was built from `main` at `9aaf326`, so no branch work is in it
whatever the bundle says. Had the log been unavailable, the narrow version
would have had to stand.

**Dashboard verification (step 6a) stays mandatory regardless.** It applies to
the *rebuild* the rotation produces, which does not exist yet.

## 2. Gate answer 1 — re-verified, unchanged

Re-read from the Vercel CLI today, **names and environments only, never
values**:

```
EBAY_CERT_ID             Encrypted   Production
EBAY_VERIFICATION_TOKEN  Encrypted   Production
EBAY_APP_ID              Encrypted   Production
```

**Production only.** Preview still holds no eBay credential. The runbook's
conditional — update Preview if and only if Preview holds the secret — still
resolves to **do not add it to Preview**.

## 3. Gate answer 2 — SUPERSEDED

`ROTATION_GATE_ANSWERED.md` answer 2 reads: *"Does Preview read production KV?
**Yes.** Every KV/Redis variable is a single row targeting
`production,preview,development`."*

**That is no longer true.** Today's listing shows two disjoint groups:

```
KV_URL, KV_REST_API_URL, KV_REST_API_TOKEN,
KV_REST_API_READ_ONLY_TOKEN, REDIS_URL     Preview (+Development)
KV_URL, KV_REST_API_URL, KV_REST_API_TOKEN,
KV_REST_API_READ_ONLY_TOKEN, REDIS_URL     Production
```

This is the RV-8 / RV-10 containment, executed 2026-09-10 00:20 and verified by
the controlled `draft:*` comparison. The original answer is **kept as the
dated 2026-09-08 reading**; it must not be acted on as current state.

It did not gate the rotation then and does not now.

## 4. The §3 containment order was superseded, not departed from

An earlier version of this section called the §3 ordering "not executed in the
chosen order", as though the plan had been chosen and then quietly skipped.
**That mischaracterises it.** The record shows a deliberate revision.

`ROTATION_PLAN_BOUNDED.md` §3 chose: disable automatic Preview deployment
first, then build the separate store. The first half was then **invalidated by
evidence**: the preview-only disable control was *not established to exist with
that scope*. What the project exposes is
`gitProviderOptions.createDeployments: "enabled"`, which appears to govern
Git-triggered deployments **as a whole, production included**, and
`link.deploymentEnabled` is unset — reading that as "default enabled" is an
inference, not an observation
(`ROTATION_EXECUTION_CHECKLIST.md` §4, carried into the queue at §RV-10).

So the store split did not bypass the chosen order; it **replaced an approach
whose instrument turned out not to exist**. The §3 text is a **superseded
plan**, and the rejected toggle is retained because the rejection is the reason
a store split became the remedy.

## 5. Current Preview identifiers

Where an instruction concerns the current Preview:

| | |
|---|---|
| Deployment | `dpl_9J3HHDXTdMgez8kKCAmqk9DENMAP` |
| Commit | `e75700c` |
| Branch alias | `https://cardresell-git-phase1-block-d-willsep200-9430s-projects.vercel.app` |
| Bundle | `js/core.ebc21977.js`, generation 21 |
| Protection | enabled |

**These must not be substituted into the rotation or challenge steps.** The
rotation targets Production. A Preview identifier appearing in a rotation step
would be a defect, not an update.

## 6. What is left, sorted by what it actually is

An earlier version listed six "unresolved prerequisites". That conflated three
different kinds of thing, and the effect was to turn separately-tracked work
into new gates on the eBay rotation. Corrected:

### Execution steps — part of running the rotation, not prerequisites to it

1. **Redeploy from `dpl_BJuH3okrHAsHpM7vUhCZv85or225`** (not the retired
   `dpl_AuwggY9Y…`).
2. **Verify the rebuild's commit** (step 6a) and that `www.cardresell.org`
   resolves to it, before any revocation. `vercel inspect <id> --logs` prints
   the `Cloning … (Branch: main, Commit: …)` line when ordinary inspection
   shows no metadata.
3. **Run `node tools/verify-challenge.mjs`** (step 6b) — see §8.

### Open question — answered below

4. **eBay's treatment of already-issued tokens** — resolved from eBay's own
   documentation in §7, and it changes the step order.

### Separately tracked — NOT gates on this rotation

- **Turnstile** (`TURNSTILE_SECRET_KEY` broader than Production) — D-RV-3.
- **Safeguard 2** — older deployments and downloaded local credentials retain
  old access.

Both are real and both stay open. Neither blocks the eBay rotation, and listing
them among its prerequisites was my error.

## 7. eBay's treatment of already-issued tokens — ANSWERED

Plan step 4 asked what happens to live tokens when the Cert ID is retired. From
eBay's own documentation:

> "Creating a new Cert ID does not affect existing user tokens that have
> already been created for the application."
> — [Resetting your cert ID](https://developer.ebay.com/api-docs/static/gs_resetting-your-cert-id-new.html)

**So the caution in the plan was correct: rotation does not invalidate live
tokens.** A rotation can look complete while tokens issued under the old
credential keep working.

### The finding that changes the step order

The same page states that **the new Cert ID cannot be used to revoke user
tokens created with the old one**, and that older tokens should be revoked
*before the old Cert ID expires*
([Resetting your cert ID](https://developer.ebay.com/api-docs/static/gs_resetting-your-cert-id-new.html)).

**The documented old-credential revocation route closes with the old Cert ID.**
If it is allowed to expire first, tokens issued under it can no longer be
revoked *through that route*. Any revocation by that means must happen **while
the old Cert ID is still valid** — the opposite of the intuitive "retire the
old thing, then clean up".

*Narrowed 2026-09-10 22:20 — an earlier draft said "revocation capability
dies", which is too absolute.* One documented route closes. eBay separately
directs developers to **Developer Technical Support to revoke active tokens**
when a Cert ID is breached
([Credentials and token management](https://developer.ebay.com/api-docs/static/gs_credentials-and-token-management.html)),
so a support-assisted path exists outside the old credential. Whether it is
available for a **precautionary** rotation rather than a breach is
**Unverified** — the page frames it around breach. Do not plan on it as the
primary route; do not write it off either.

### The grace period is a choice made at generation time

Generating a new Cert ID sets a grace period for the old one, **0 days
(immediate) to 4000 days**, typically 30–90, during which **both are valid**
([Resetting your cert ID](https://developer.ebay.com/api-docs/static/gs_resetting-your-cert-id-new.html)).

This is a decision Will makes **at step 1**, before anything else, and the
runbook does not currently mention it:

- **0 days** ends the **old Cert ID's validity** immediately — which is not the
  same as ending the exposure. Tokens already issued under it can survive it
  (that is the finding above). It also closes the old-credential revocation
  window in the same moment, and leaves the redeploy no margin.
- **A short non-zero period** keeps the old credential alive — the thing being
  rotated away from — while leaving room to redeploy and revoke.

I am not choosing this. It trades exposure time against revocation
capability, and it is Will's call.

### Explicitly unresolved before revocation

- **Whether any user tokens exist to revoke.** Not established. The
  Create-Drafts path is a file download, not an OAuth user grant, so there may
  be none — but "probably none" is not a check.
- **Application tokens and refresh tokens specifically.** The page addresses
  "existing user tokens". It does **not** separately state the fate of OAuth
  *application* tokens or *refresh* tokens, and
  [Credentials and token management](https://developer.ebay.com/api-docs/static/gs_credentials-and-token-management.html)
  says only that active tokens can persist "for a considerable period" after a
  reset, and that a **breached** Cert ID means contacting eBay Developer
  Technical Support to revoke active tokens. Unverified for our case.

## 8. `tools/verify-challenge.mjs` — exact operator requirements

Read from the script and cross-checked against eBay's specification.

| | |
|---|---|
| Invocation | `node tools/verify-challenge.mjs` — no arguments |
| Runtime | **Node 18+**. ESM with top-level `await` and global `fetch`. |
| Dependencies | **None.** Only `node:crypto` and `node:readline`. No `NODE_PATH`, no install. |
| Where | Any machine with **network access to `www.cardresell.org`**. Not sandbox-runnable in any meaningful sense — it tests production. |
| Input | **Hidden prompt**, repainted so nothing is echoed. Never printed, never written to a file, never in `argv`. |
| Target | **Hard-coded** `https://www.cardresell.org/api/ebay-notifications` (`tools/verify-challenge.mjs:21`). No flag to point it elsewhere. |
| Exit | `0` = the deployed endpoint hashes exactly the supplied token. `1` = anything else. |
| Timing | **After** the redeploy reports READY, **before** the token is saved in eBay's portal. |

**Operator notes that matter:**

- **A TTY is required for the hidden prompt.** It accepts piped stdin, but
  piping means the token passes through a shell — the exact exposure the hidden
  prompt exists to avoid. Type it.
- **It warns on leading or trailing whitespace** in what **you typed at the
  prompt**, before trimming. *Corrected 2026-09-10 22:20 — an earlier draft
  read this as proof the Vercel value is wrong. It is not.* The warning is
  about the operator's input and nothing else. **Fix your input and re-run
  first.** Change Vercel and redeploy only if the endpoint comparison itself
  establishes a stored-value mismatch — which is the next bullet's job, not
  this one's.
- **On failure it names the corruption shape** — trailing newline, CRLF,
  literal `\n`, wrapping quotes, trailing space. If none match, its own advice
  is that the redeploy has not picked up the variable or the domain is served
  by a different deployment.
- **`FAIL — could not reach the endpoint` is not a failed verification — but
  it is not a pass either.** Unreachable does not establish a wrong token, and
  equally **cannot satisfy the verification step or license advancing past
  it**. Verification is incomplete until the comparison actually runs. Retry;
  do not proceed on "probably fine".

**Verified against eBay's spec today.** eBay requires SHA-256 over
`challengeCode + verificationToken + endpoint`, in that order, returned as hex
in a `200` `application/json` body under `challengeResponse`
([Marketplace User Account Deletion](https://developer.ebay.com/develop/guides/sell/marketplace-user-account-deletion)).
Both the script (`:57-61`) and the deployed handler
(`api/ebay-notifications.js:60-68`) hash in exactly that order and shape, and
the handler supports GET and POST as eBay requires.

**One constraint the runbook should carry, from the same page:** the
verification token must be **32–80 characters, alphanumeric plus `_` and `-`
only**. Step 3's "fresh random value" is under-specified — a generator that
emits `+`, `/`, `=` or padding will be rejected by eBay's portal regardless of
what our endpoint does.

**And the endpoint string must match byte-for-byte.** The URL registered in
eBay's portal must equal the hard-coded constant exactly, since the URL is an
input to the hash. A trailing slash difference fails with a correct token.

### What a challenge pass does and does not demonstrate

eBay's endpoint contract has **two** halves: a **GET** carrying
`challenge_code`, answered with the hash, and a **POST** carrying the actual
account-deletion notification, answered `200`
([Marketplace User Account Deletion](https://developer.ebay.com/develop/guides/sell/marketplace-user-account-deletion)).

`verify-challenge.mjs` exercises **only the GET half**. A pass establishes that
the deployed endpoint hashes the supplied token — endpoint ownership — and
**nothing about notification processing**. The POST path is deliberately not
gated on the token (`api/ebay-notifications.js:71-76`), so it is not even
exercised by the same evidence. Do not read a green challenge as "notification
handling verified"; that is a separate, unperformed check.

## 9. eBay token inventory — grant types, issuance and storage paths

Read from code today. No credential value was read, printed, or stored.

| | |
|---|---|
| Grant type in use | **`client_credentials` only** — `api/_ebayAuth.js:149`, against `https://api.ebay.com/identity/v1/oauth2/token` (`:23`) |
| Scope | `https://api.ebay.com/oauth/api_scope` (`:24`) — the default application scope |
| Token kind | **Application access token.** `fetchEbayAppToken` reads `json.access_token` (`:189`) and `expires_in` (`:195`); no `refresh_token` is read anywhere. |
| Authorization-code / user consent | **No path exists in the codebase.** No RuName, no `redirect_uri`, no `auth.ebay.com/oauth2/authorize`, no consent handler. `api/_ebayTaxonomy.js:8` states it in comment: written "before any OAuth consent flow exists". |
| Callers | `api/_ebayTaxonomy.js`, `api/ebay-sold.js` |

**Storage paths — two, both derived, neither a durable grant:**

1. **Per-instance memory.** `let _memo` (`:34`), lost when the lambda instance
   recycles.
2. **Redis**, key **`ebay:app_token`** (`:25`), written with `SETEX`
   (`kvSetEx :127`) at `TTL = expires_in − 120s` (`:222`), so **≈7080s / just
   under two hours** on eBay's default `expires_in` of 7200.

### What this establishes, and what it does not

**Establishes:** the application uses one grant type. `client_credentials`
issues an application token and **no refresh token**, so there is no refresh
token for this application to survive a rotation — and there is **no code path
by which a user token could be issued**. That is a stronger basis than the
file-download argument I offered earlier, which was correctly rejected: a
download workflow says nothing about what other paths exist.

**Does not establish:** that no user token *exists*. Absence of an issuance
path in this repository does not cover tokens issued **out of band** — the
developer portal's own test tooling, sandbox experiments, any earlier manual
OAuth consent, or another application on the same keyset. Those are account
facts, not code facts, and only the eBay portal can answer them. **Unresolved.**

### A concrete rotation consequence — CORRECTED 2026-09-10 22:40

An earlier version of this section said the cached application token is
"unaffected by rotation" and offered two operator options, one of which
claimed "nothing breaks either way". **Both are withdrawn.** Three separate
faults, and the third invalidates the section's premise for production.

**Fault 1 — survival is unverified, and §7 says so.** Cache retention
establishes what *our application may reuse*, not whether *eBay will keep
accepting it*. eBay states only that active tokens can persist "for a
considerable period" after a reset
([Credentials and token management](https://developer.ebay.com/api-docs/static/gs_credentials-and-token-management.html)),
which does not settle the application-token case. Writing "unaffected by
rotation" in §9 contradicted my own §7. The honest statement: **a cached token
may or may not continue to be accepted; that is unresolved**, and "nothing
breaks either way" was never supportable.

**Fault 2 — deleting Redis does not clear the memo.** Traced at
`api/_ebayAuth.js`:

- `_memo` is module-level per lambda instance (`:34`); a new deployment starts
  with it empty.
- The read order is memo → Redis → eBay (`:210-217`). So the **first request
  after a redeploy loads the old Redis record into that instance's memo**, and
  deleting `ebay:app_token` afterwards does not evict it.
- **No production route can force a refresh.** The only caller is
  `_ebayTaxonomy.js:108`, `getEbayAppToken()` with no arguments.
  `forceRefresh` (`:207`) is never passed by product code, and
  `_resetTokenMemo` (`:230`) is documented "Tests only". Adding a production
  cache-bust route would be a test-only production surface — excluded.

  So "delete the key after the redeploy" **does not guarantee an immediate
  mint**. It loses a race it cannot see.

**What *is* established about expiry.** The memo is not unbounded: `:211`
gates on `_memo.expiresAtMs > now`, and both caches are written from the same
record with the same `ttl = expires_in − 120` (`:221-224`). **Memo expiry and
Redis TTL are the same value**, so **≈2 hours is an upper bound on both** —
the memory-expiry behaviour the review asked to see established. That bounds
"wait it out"; it does not make it a *verification* method, because the bound
is a ceiling, not an observation.

**Fault 3 — none of this applies to production today.** At **commit
`9aaf326`**, the deployed code:

- does **not contain `api/_ebayAuth.js` at all** (`git ls-tree 9aaf326 -- api/`
  lists only `ebay-notifications.js` and `ebay-sold.js`);
- performs **no token exchange** — `git grep client_credentials 9aaf326 --
  api/` returns nothing;
- **never reads `EBAY_APP_ID` or `EBAY_CERT_ID`.** The only eBay credential
  production reads is `EBAY_VERIFICATION_TOKEN`
  (`9aaf326:api/ebay-notifications.js:8`);
- reaches eBay through an **unauthenticated fetch of a search URL** with
  rotated browser headers, cached under `ebay_cache:`
  (`9aaf326:api/ebay-sold.js:20-33, 235`).

**The supported conclusion — narrowed 2026-09-10 22:55.** An earlier draft
said there is *no* `ebay:app_token` key in production Redis. That overreaches:
no writer in *current* code does not prove no key *exists*, since an earlier
deployment or ad-hoc tooling could have written one. What is supported is
enough: **current production neither reads nor writes that cache, so deleting
it is unnecessary for this rebuild** — and no Redis inspection is needed to
reach that. The entire concern is **branch work** — real
for when `_ebayAuth.js` ships, not an operator instruction for this rotation.
I generalised from the working tree to production, which is the same error as
the bundle-agreement claim, made again.

**Consequence for the rotation itself, stated by credential:** **Cert ID
rotation does not change a credential current production consumes** — nothing
at `9aaf326` reads `EBAY_APP_ID` or `EBAY_CERT_ID`. **Verification-token
rotation does**: `EBAY_VERIFICATION_TOKEN` is read at
`9aaf326:api/ebay-notifications.js:8` and is live. The two halves of this
runbook carry different risk, and only the second can break production.

> **WITHDRAWN 2026-09-11 00:28 — superseded basis.** This section previously
> read: *"The rotation is justified by the credential's **exposure**, not by
> production dependence on it."* **That justification is withdrawn.**
> Confirmed exposure is **not established**; a possible earlier-session
> exposure is **unresolved** (§11). The Cert ID rotation's basis is
> **precautionary**: the Cert ID authenticates the application and is
> security-sensitive, current production does not depend on it, and the
> rotation cost is bounded. **CH-1** — the published verification token — is
> the independently established, blocking credential defect.

`EBAY_OAUTH_TICKET.md` is now registered as **EXP-1** in
`audit/RELEASE_VALIDATION_QUEUE.md`, with its credential types identified and
rotation coverage assessed — repository cleanup and credential invalidation
kept distinct, since neither substitutes for the other.

### Verification method — `tools/verify-ebay-credential.mjs`

Added today. One hidden-prompt exchange against
`https://api.ebay.com/identity/v1/oauth2/token`, `grant_type=client_credentials`.

| | |
|---|---|
| Invocation | `node tools/verify-ebay-credential.mjs` — no arguments |
| Input | App ID and Cert ID, both **hidden prompts**. **Refuses piped stdin** outright, since a pipe routes the secret through a shell. |
| Output | Non-secret only: HTTP status, `token_type`, `expires_in`, `scope`, observation timestamp. **The access token is never printed.** |
| Failure | Reports eBay's own `error` / `error_description` — `invalid_client` means the pair was rejected. |
| Unreachable | Reported as **INCOMPLETE**, explicitly neither a failed credential nor a pass. |
| Quota | **One** real exchange. Application-token requests are daily-limited. Run it once. |
| Output safety | Every line on both streams passes through `redact()` before printing — the supplied values, the Basic header, and token-shaped strings are removed. |

**Output handling verified against mocked responses** —
`tests/ebay-credential-check.mjs`, **58 passed, 0 failed**, no network, no real
credential. Covers success, `invalid_client` rejection, malformed body, `200`
with no token, and network failure, asserting on **every** path that neither
supplied credential, the Basic header, nor the returned token appears on either
stream.

**The assumption that check removed.** I had called eBay's `error_description`
non-secret. It is upstream text that may quote the client identifier it
rejected, and the suite includes exactly that case: the description is
**redacted rather than dropped**, so the diagnostic survives and the value does
not. Redaction is not trusted on a passing suite — three mutations were run:
disabling `redact()` fails 9 assertions, accepting a tokenless `200` as success
fails 1, collapsing `incomplete` into `fail` fails 2. Restored: 58/0.

**What a pass establishes:** eBay's token endpoint accepts the replacement
pair and issues an application token.

**What it does not:** that the **deployed application** uses that credential.
Proving that additionally requires tying an exchange to the rebuilt
deployment — and at `9aaf326` that tie **cannot be made at all**, because the
deployed application performs no exchange. It becomes checkable only once
`_ebayAuth.js` reaches production, and the check would then have to observe
the deployment minting, not a direct exchange from a laptop.

### Out-of-band token inventory — scope corrected

Scoped to the **production keyset only**. Sandbox experiments are a different
keyset and **do not establish production token exposure**; citing them either
way would be noise. Further: whether the developer portal even exposes a
**complete token inventory** for a keyset is **not established** as an
available capability. Until it is, "no user tokens exist" cannot be concluded
from the portal any more than it can from the code. Both halves stay open.

## Method

Vercel CLI, read-only: `vercel list --prod`, `vercel inspect`, `vercel env ls`.
`www.cardresell.org` fetched over the network for the served bundle. Git read
locally. **No credential value was printed, inspected, or written anywhere.**

---

## 11. Rotation basis re-checked after EXP-1 — and the generation gap (added 2026-09-10 23:40)

### EXP-1 is not the basis, and never was

EXP-1 resolved to synthetic fixtures, a non-secret App ID and self-masked
fragments, so it supplies **no evidence of secret disclosure**. If the Cert ID
rotation had been resting on it, it would now be unsupported. It was not.

> **WITHDRAWN 2026-09-11 00:28.** The table and the "Retained" paragraph
> immediately below are the **superseded** reading, kept only as a record of
> what was claimed and corrected. **Do not cite them as a basis.** The
> correction that follows them governs.

**The stated basis, which predates EXP-1 and survives it:** *(withdrawn)*

| | |
|---|---|
| Claim | The eBay **Cert ID** was **printed in plaintext in an earlier session** |
| Recorded at | `audit/TODO_PHASE1.md:234` |
| Credential identified by | `sha256[:12] = e3f0a0bc343d` — a fingerprint used throughout the corpus as a non-disclosing reference (`audit/d3/D3_STEP5_SECOND_REVIEW_RESPONSE.md:475`, which also records **0 published blobs**) |
| Surface | A **conversation transcript**, not this repository |

~~**Retained.** The exposure is a session disclosure, entirely independent of
any repository literal, and EXP-1's collapse does not touch it. "0 published
blobs" is consistent: the repository was never the exposure surface.~~
**— WITHDRAWN.** "The exposure is a session disclosure" asserts as fact the
very thing that is not established. Superseded by the correction below.

**Corrected 2026-09-10 23:55 — the exposure is not established.** I read
`TODO_PHASE1.md:234` as meaning the credential was printed, and adopted that
reading. Will checked the accessible prior context: it contains **no plaintext
Cert ID** and repeatedly instructs keeping credentials out of chat, and
conversation retrieval did not recover the underlying session. And the
sentence, read as written — "sha256[:12] `e3f0a0bc343d` was printed in
plaintext" — **grammatically says the fingerprint was printed**, which
discloses nothing. My reading was the less literal one and is withdrawn.

| Status | |
|---|---|
| **Confirmed exposure** | **Not established.** |
| **Possible earlier-session exposure** | **Unresolved.** Absence from accessible context is not proof it never happened. |
| **Rotation** | **Retained as a precaution.** The rationale is **not** that the Cert ID is unimportant — it **authenticates the application** and is security-sensitive. It is that **current production does not depend on it** (nothing at `9aaf326` reads `EBAY_CERT_ID`) and the **precautionary rotation cost is bounded**, so rotating against an unresolved possibility is cheap and rotating is the safe direction. |

**How it must be described.** Not as remediation of a proven plaintext
disclosure, unless the original transcript is recovered. Every document that
calls this a response to a known exposure overstates the record.

**CH-1 is unaffected and independent.** The published verification token is an
established, repository-visible defect requiring rotation on its own evidence.
It needs no premise from EXP-1 or from the session disclosure.

### A consequence for the push gate — flagged, not acted on

`audit/DECISION_94dc777.md` gates the first push on rotation because "pushing
before rotation publishes fragments of a live credential." Those fragments are
the `EBAY_OAUTH_TICKET.md` literals introduced at `94dc777` — now established
as **synthetic**. The gate's stated rationale is therefore weaker than when it
was written. **The gate stands**: it is the owner's decision, the session
disclosure is untouched by this, and nothing here is a reason to push. Logged
so the rationale is not cited later as stronger than it is.

### The generation gap — pre-steps 1c–1f (corrected 23:55)

"At least the second rotation" is an inference from one documentary sentence.
It fixes neither how many generations exist now, nor which one is live.

- A prior rotation **attempt** is on record. Whether it completed, and whether
  its generation is the one production uses, is **not established**.
- The old `401` is evidence of **transport corruption** — a literal `\n` in
  the stored value. It says **neither** that the fresh Cert ID was invalid,
  **nor** that it is the credential currently configured.
- eBay's grace model means **two generations can be simultaneously valid**, so
  "the previous Cert ID" is not well defined until the portal is read.

**Two corrections to my first draft of these steps, both narrowing what they
can claim.**

**1c cannot count history.** It records only what the portal **displays**. If
expired generations are no longer listed, the total historical rotation count
is **not obtainable** this way, and "at least the second" remains the whole
claim.

**1d as I first wrote it overclaimed.** I had a single token exchange
identifying which generation Vercel holds. It does not. An exchange proves
whether the **operator-supplied pair** is accepted. A **failure identifies
nothing** — equally consistent with an expired credential, a mismatched pair,
a transcription error, or another rejection cause. Even a pass identifies the
Vercel generation only if the supplied Cert ID is first established to be
exactly the stored value **and** mapped to a portal generation.

**The corrected sequence** — identification and validity are now separate
steps, in that order:

| Step | What it does | What it establishes |
|---|---|---|
| **1c** | Record displayed generations, current/grace/expiry, **no values** | The **visible** generation set — not the historical count |
| **1d** | `tools/compare-cert-generation.mjs` — interactive TTY required, piped input refused, no network, complete-value equality, prints matched label or `no match` | A **match** identifies the generation on the **Vercel project row** — not a credential in the running deployment. **`no match`** rules out only the **displayed** ones; the configured generation stays **unknown** |
| **1e** | One token exchange on that exact pair | **accepted** / **rejected** / **unreachable** — describes the **pair**, never a generation. **rejected** means **only** *the supplied pair was rejected*. Even with a 1d Cert ID match it is **not** proof of Vercel misconfiguration: the **supplied App ID** could be wrong |
| **1f** | Record the superseded generation and its revocation route | **Unknown** where 1d did not match or could not run |

`EBAY_CERT_ID` is stored **`encrypted`, not `sensitive`**
(`ROTATION_GATE_ANSWERED.md:71`), so owner readback for 1d is available. Where
it is not, the configured generation stays unknown — the rotation may replace
it regardless, and **the runbook must not claim 1d identified it**.

`tools/compare-cert-generation.mjs` added: SHA-256 fixed-width comparison, no
network, nothing echoed or written, result object carries no value.
`tests/cert-generation-compare.mjs` — **15 passed, 0 failed**, with mutations:
comparing on a 12-character prefix fails 2, leaking a label on `no match`
fails 1.

### The push gate — rationale retired, gate preserved

`audit/DECISION_94dc777.md` gated the first push on "pushing before rotation
publishes fragments of a live credential." Those fragments are the
`EBAY_OAUTH_TICKET.md` literals introduced at `94dc777`, now established
**synthetic**. **That rationale is retired** and must not be cited again.

**The gate's wording also needs correcting.** `DECISION_94dc777.md` speaks of
"the first push." Several **branch and Preview pushes have since occurred**,
so read literally the gate is already spent. The surviving gate must be stated
explicitly as **the first push to `main` / production release** — which is
what it always meant operationally, and which the standing authorization for
Phase 1 preview/branch pushes already presupposes.

**The owner's gate stands on its own authority**, unchanged in force. Its
remaining bases are **CH-1** and the **owner's unrevisited release hold** —
not the retired fragment rationale, and not the unresolved session question.
**CH-1 remains independently established.**

---

## 12. 1c executed — partial result, and my over-reading of it (2026-09-11 00:58, corrected 07:24)

### Three columns, kept apart

| | |
|---|---|
| **Reported by the owner, verbatim** | *"generation and expiry details not displayed."* Read-only inspection, controls untouched, no values shared. |
| **Still unknown** | How many generations exist; whether any is in grace; the historical rotation count; the **generation number** of any value. |
| **What the portal CAN reveal** | **Credential values are hidden but revealable.** The **Production Cert ID currently shown** is obtainable by the owner. |

### My error, stated plainly

I collapsed those three into one owner-attested finding — **"the portal
displays no generation state"** — and then built two conclusions on it: that
1d was **not runnable** and that the configured generation was
**unidentifiable by any step**. The wording was my own conditional suggestion,
not something the owner attested, and the third column makes the strongest
conclusion wrong. **Both are withdrawn.** The pattern is the one already
recorded against me repeatedly in this thread: treating a narrow observation
as a broader established fact.

### 1d is runnable, with a narrowed conclusion

The comparison never needed generation *numbering* — only two values. The
owner can reveal the **Production Cert ID currently shown**, so the comparison
runs with that single entry labelled `portal-current`.

**A match establishes exactly:** *the Vercel project row matches the
Production Cert ID the portal currently shows.* It does **not** establish that
value's **historical generation number**, and it does **not exclude another
credential still honoured in grace**. **`no match`** establishes only that the
row differs from the shown value. No new tooling — the existing tool accepts a
single labelled generation.

### Absence of labelling is a UI fact

It neither establishes that one generation exists nor excludes one in grace.
The historical count stays unobtainable and **"at least the second"** remains
the whole claim. **1f** accordingly records the predecessor at the available
precision — *"the Cert ID the portal showed as current on 2026-09-11, generation
number not exposed"* — or **unknown**, and no revocation route can be selected
by number.

### The enrollment sentence — withdrawn as a reason not to run 1e

I cited `EBAY_OAUTH_TICKET.md` line 35, *"appears to not be enrolled for the
`client_credentials` grant type,"* to argue 1e's expected information was low.
That is an **old hypothesis, not a confirmed account restriction**, and the
**recorded transport corruption** — a literal `\n` in the stored value — is
an equally good explanation for the same earlier failures. It justifies
neither discounting a fresh exchange nor opening a support dependency.
**Withdrawn.**

**1e stands as the next step.** **accepted** settles whether the supplied pair
works now. **rejected** is a **fresh diagnostic** and is recorded as *the
supplied pair was rejected* — without pretending to identify the cause, and
without a 1d match upgrading it, since the supplied App ID could itself be
wrong. **unreachable** is neither and cannot license proceeding.

The precautionary basis for the rotation is unaffected throughout: it never
depended on identifying a generation.

---

## 13. 1d and 1e executed — and two corrections to my reading (2026-09-11 09:40, corrected 10:22)

### The corrected scripts, adopted

The owner's results came from **corrected** scripts, not my repository copies.
Adopted into `tools/` and `tests/`, with a shared
`tools/hidden-prompt.mjs`: readline output is routed to a **muted `Writable`**
rather than repainted, `historySize: 0`, `SIGINT` and `close` both settle the
promise, and **both** stdin *and* stdout must be TTYs. `verify-challenge.mjs`
**no longer accepts piped input at all** — my copy did, which was the weaker
rule. Suites re-run after adoption: **15/0** and **58/0**.

**The change that matters for interpretation:** `fingerprint` **no longer
calls `.trim()`**. Comparison is exact input, and the corrected suite asserts
*"trailing newline is a different complete value."*

### Correction 1 — NO MATCH does not rule out a formatting difference

I wrote that NO MATCH was "not a near-miss or formatting artefact." **Wrong,
and withdrawn.** Under exact comparison, **leading or trailing whitespace, a
truncated copy, or any paste slip produces NO MATCH.** What it establishes is
narrower: **the two entered strings differed.** Whether the two *stored
credentials* differ is **not established**.

### Correction 2 — there is no third value

I described "three values in play," counting a replacement Cert ID. **No
replacement Cert ID exists** — none was generated, and the Cert ID rotation is
**paused**. Withdrawn.

What remains: the **portal pair authenticates**, so a **known-working
production credential exists**. The Vercel-row value is **untested**. Nothing
established requires resetting a working credential — the exposure premise was
already withdrawn, and NO MATCH does not replace it. I had written that NO
MATCH "strengthens" the rotation; **that is withdrawn too**, since it rested
on reading NO MATCH as a genuine value difference.

### What 1e did establish

**ACCEPTED** on the portal pair: that pair is currently valid, and the
**"appears not enrolled for `client_credentials`" hypothesis is disproved**.
It does **not** establish that the deployed application uses that pair — at
`9aaf326` production reads **neither** `EBAY_APP_ID` nor `EBAY_CERT_ID` — and
says nothing about the Vercel row, which was never exchanged.

**On the record against me:** I argued 1e's expected information was low,
citing the enrollment note. 1e passed; the recommendation was wrong.

### The window ahead is the verification token alone

**`EBAY_CERT_ID` is removed from step 4.** Step 2 is deferred. The window is:
fresh verification token → Production-only variable → rebuild of `9aaf326e7` →
commit check → local challenge **PASS** → save in eBay's portal and let its
challenge succeed. Changing exactly one variable also keeps 6b's result
unambiguous.

**CH-1 closes only when the replacement token is serving production and eBay's
own verification succeeds** — not at rotation, not at READY.

---

## 14. 6b failed on a trailing newline; second rebuild READY (2026-09-11 15:38)

**First 6b attempt: FAIL, shape named `a trailing newline`.** The checker
matched the endpoint's `challengeResponse` against
`sha256(token + "\n")`, so the **value stored in Vercel Production carried a
trailing newline** while the owner's pasted value did not. Owner replaced the
Production value with a clean copy; second rebuild authorized and READY as
**`dpl_BS1a9nXNzpUtEqiWpRLakQmjMRXz`**, commit `9aaf326` from the build log,
cache skipped, `www.cardresell.org` aliased and serving 200.

### Why this matters beyond one retry

**This is the same class of defect as the original CH-1 corruption** — a stored
credential carrying trailing whitespace, invisible to READY and invisible to a
200 response. It is the second time a whitespace-carrying value has entered
this variable through the dashboard path. **Two consequences:**

1. **READY and HTTP 200 remain worthless as token evidence.** Both were green
   while the stored value was corrupt. Only the hash comparison caught it.
   Recorded because I previously offered a 200 as a baseline observation.
2. **It gives the 1d whitespace explanation observed support.** A newline
   demonstrably entered a credential value in this workflow. That makes
   "formatting difference" a **live, evidenced explanation** for 1d's NO MATCH
   — but it still does **not establish** that 1d's NO MATCH *was* whitespace.
   1d compared different values through a different path; nothing here
   identifies what happened there. The Cert ID rotation stays **paused**.

**CH-1 remains open.** It closes only when the replacement token is serving
production **and** eBay's own verification succeeds.


---

## 15. 6b PASSED; exemption eligibility is NOT established; CH-2 already fixed (2026-09-11 11:52)

### 6b — PASS, recorded against the second rebuild

Owner-run `tools/verify-challenge.mjs` against
**`dpl_BS1a9nXNzpUtEqiWpRLakQmjMRXz`**: the endpoint's `challengeResponse`
matches the clean replacement token, **no whitespace shape**. With the token
freshly generated and never committed, **production no longer serves the
repository default**. That is **RV-9 check 19**, and it does **not** establish
the other eighteen. **Completed — not to be re-run.**

### Exemption eligibility — my check was too narrow, and the result changes

I declared the exemption "a true declaration" on the strength of
`api/ebay-notifications.js` alone. **That was the wrong scope**, and widening
it to caches finds eBay data persisted in production:

`9aaf326:api/ebay-sold.js:29-36` writes Upstash keys `ebay_cache:<v3|keywords|limit>`
via `SETEX` with **`CACHE_TTL_SEC = 15 * 60`** (`:15`), storing per-item
records built at `:336` — `title`, `price`, `currency`, `url`, `soldDate`,
`imgUrl`, `itemId`. So **eBay listing data is written to durable storage**,
not merely proxied.

**What I can and cannot conclude:**

- **Established:** production persists eBay-derived *listing* data for 15
  minutes. Namespaces written by production API code are `ebay_cache:`,
  `pc_cache:`, `tcgprice:`, `type:` — one of which is eBay-derived.
- **Established:** no eBay **user identifier** appears in the cached record.
  The item shape at `:336` has no seller username, seller id, buyer, or
  feedback field.
- **NOT established — and this is the reviewer's point:** whether a 15-minute
  cache of listing fields counts as "persisting eBay data" for the exemption.
  eBay's page states the exemption is for applications **"not persisting any
  eBay data"** and warns that incorrect information "may result in penalties or
  having their account disabled." Marketplace *Account Deletion* notifications
  concern **user** data, which suggests listing caches are outside their
  intent, but eBay's toggle wording is **broader than user data** and I have
  found no source resolving the gap.
- **Unverified:** client-side storage. The production bundle
  `js/core.569ff536.js` contains **137** case-insensitive matches for "ebay";
  no per-key audit of browser storage was performed here.

**Consequence:** the exemption's accuracy is **an open compliance question for
the owner**, not something I have confirmed. My §14-era "it also happens to be
a true declaration" is **withdrawn**. The instruction stands unchanged in the
other direction too: **leave the exemption as it is** — nothing here justifies
touching a pre-existing declaration, and this finding is a reason for owner
review, not for an agent-initiated toggle.

### CH-2 — already fixed in the branch; I was wrong to call it outstanding work

**`6c610e2`** removes the published literal:
`6c610e2:api/ebay-notifications.js:32` reads
`cleanCredential(process.env.EBAY_VERIFICATION_TOKEN) || ''`. Read at call
time, so a warm instance cannot freeze a stale value. GET **fails closed** —
`503 verification_token_unset`, `no-store`, **no `challengeResponse` field at
all**. POST stays open deliberately: refusing a deletion notification over our
own misconfiguration would convert a config defect into a compliance failure,
and that asymmetry is pinned by a test.

I called CH-2 "the more interesting of the two" and implied it needed
implementing. **Withdrawn.** What is outstanding is **deployment**: production
runs `9aaf326`, which still carries the fallback, and `6c610e2` is unpushed on
`phase1-block-d`. **Deployment authorization is the owner's and is not
inferred** from this finding.
