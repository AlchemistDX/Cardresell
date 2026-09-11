# Rotation runbook re-check — 2026-09-10 21:30 EDT
*(corrected 21:50: commit read from build logs, the 2026-09-09 deployment
identified as the TPL rotation rebuild, §3 recorded as a superseded plan, the
non-KV count corrected from three to one. Extended 22:05 with §7 eBay token
treatment and §8 verify-challenge operator requirements; §6 re-sorted so
separately-tracked work is not listed as a rotation gate. **Re-check closed**; extended 22:20 with three wording corrections, the GET/POST distinction, and §9 token inventory.)*

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

### A concrete rotation consequence

The cached application token in Redis under `ebay:app_token` was **minted with
the old Cert ID and is unaffected by rotation**. It stays valid, and
`getEbayAppToken` will keep serving it from cache (`:211-217`) for up to
**≈2 hours** after the new credential is live. Two options, Will's choice:

- **Delete the `ebay:app_token` key** in production Redis after the redeploy,
  forcing an immediate re-mint under the new Cert ID. Cheap and immediate.
- **Wait out the TTL.** Nothing breaks; the old-credential token simply keeps
  being used until it expires.

This matters for *verifying* the rotation as much as for exposure: a live API
call succeeding right after the redeploy may be succeeding on the **old**
token, and would prove nothing about the new credential.

## Method

Vercel CLI, read-only: `vercel list --prod`, `vercel inspect`, `vercel env ls`.
`www.cardresell.org` fetched over the network for the served bundle. Git read
locally. **No credential value was printed, inspected, or written anywhere.**
