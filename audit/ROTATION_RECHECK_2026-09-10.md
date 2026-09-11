# Rotation runbook re-check — 2026-09-10 21:30 EDT
*(corrected 21:50 after review: commit read from build logs, the 2026-09-09
deployment identified as the TPL rotation rebuild, §3 recorded as a superseded
plan, and the non-KV count corrected from three to one)*

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

## 6. Unresolved prerequisites

1. **The redeploy source changed.** Execute from
   `dpl_BJuH3okrHAsHpM7vUhCZv85or225`, not the retired `dpl_AuwggY9Y…`, and
   confirm the rebuild reports commit `9aaf326` and that `www.cardresell.org`
   resolves to it before any revocation.
2. **Step 6a stays mandatory** — it verifies the *rebuild*, which does not
   exist yet. The current deployment's commit is settled (§1); the next one's
   is not.
3. **`tools/verify-challenge.mjs` (step 6b) has not been run** and cannot be
   from here; it needs the production endpoint and the operator's prompt.
4. **eBay's treatment of already-issued tokens** (plan step 4) is still
   unanswered. Retiring a Cert ID does not necessarily invalidate live tokens.
5. **Turnstile** — Preview still shares the production configuration. Tracked
   separately under **D-RV-3**, whose remedy is a distinct *test* credential
   for Preview rather than narrowing to Production-only, and which changes
   credential scope and so needs the owner's authorization.
6. **Safeguard 2 remains open** — existing deployments and downloaded local
   credentials retain old access.

### Withdrawn from this list

- **"An unexplained 2026-09-09 production deployment."** It is the TPL rotation
  rebuild, documented at `TPL_ROTATION_RUNBOOK.md:507`. See §1. No question for
  Will.
- **"Three non-KV production resources remain reachable from Preview."**
  **Stale as written**, and it is now one, not three. Re-read from the CLI
  today, names and targets only:
  - `PRICECHARTING_API_TOKEN` → **Production** only. Narrowed as decided
    (D-RV-2 order, step 1); the "live leak" row at
    `RELEASE_VALIDATION_QUEUE.md:2677` describes the pre-narrowing state.
  - Blob → **closed by D-RV-4**: nothing reads either Blob variable and the
    photo path is IndexedDB, so there is no production photo storage for
    Preview to reach. Cleanup of the unused identifier and public key is
    non-blocking.
  - `TURNSTILE_SECRET_KEY` → still broader than Production. **This one is
    real**, and is item 5 above.

## Method

Vercel CLI, read-only: `vercel list --prod`, `vercel inspect`, `vercel env ls`.
`www.cardresell.org` fetched over the network for the served bundle. Git read
locally. **No credential value was printed, inspected, or written anywhere.**
