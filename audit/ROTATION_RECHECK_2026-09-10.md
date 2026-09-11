# Rotation runbook re-check — 2026-09-10 21:30 EDT

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

### What I can and cannot say about its commit

**Commit not read.** `vercel inspect` returns no commit metadata for this
project, so I could not read a SHA off the deployment.

What I have instead is **consistent, and weaker than a commit read**:

- `origin/main` is `9aaf326e75b235ee500cf134eeb5f869f299b2a4`.
- `git show origin/main:index.html` references `js/core.569ff536.js`.
- `www.cardresell.org` serves `js/core.569ff536.js`.

So production serves the bundle that `origin/main` points at. That is
**bundle-level agreement, not commit identity** — a different commit with an
unchanged `index.html` would look the same. Treat "production is `9aaf326e7`"
as **probable and unverified at the deployment level**; the runbook's own step
6a (verify the redeployment's commit in the dashboard) is the thing that
actually settles it, and it stays mandatory.

**None of the outgoing `phase1-block-d` work is in production.** Production
serves generation-0 `core.569ff536.js`; the branch is at generation 21
`core.ebc21977.js`.

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

## 4. The §3 containment decision was not executed in the chosen order

`ROTATION_PLAN_BOUNDED.md` §3 chose: **disable automatic Preview deployment
first**, then build the separate store, then re-enable.

**What actually happened: the second step was done and the first was not.** The
separate Preview store exists and is disjoint. Automatic Preview deployment was
never disabled — Previews have been created by pushes repeatedly since,
including the current one.

The exposure that ordering was meant to prevent — a Preview writing to the
production store — is closed by the store split for the **draft keyspace**. So
the outcome is defensible, but **it was reached by the other route**, and the
document should not be read as describing what was done. Recording this rather
than quietly re-writing the decision.

Still not covered: the **three non-KV production resources reachable from
Preview**, tracked in the queue.

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

1. **The live commit is not verified at the deployment level** (§1). Step 6a
   remains load-bearing.
2. **The redeploy source changed.** Whoever executes must redeploy from
   `dpl_BJuH3okrHAsHpM7vUhCZv85or225`, not the retired `dpl_AuwggY9Y…`, and
   confirm the rebuild reports the expected commit and that `www.cardresell.org`
   resolves to the rebuild before any revocation.
3. **Why production was redeployed on 2026-09-09 is not established.** A new
   production deployment appeared without a recorded cause in this thread. It
   is not necessarily anything — but an unexplained production deployment
   immediately before a credential rotation is worth Will confirming he made
   it.
4. **`tools/verify-challenge.mjs` (step 6b) has not been run** and cannot be
   from here; it needs the production endpoint and the operator's prompt.
5. **eBay's treatment of already-issued tokens** (plan step 4) is still
   unanswered. Retiring a Cert ID does not necessarily invalidate live tokens.
6. **Safeguard 2 remains open** — existing deployments and downloaded local
   credentials retain old access.

## Method

Vercel CLI, read-only: `vercel list --prod`, `vercel inspect`, `vercel env ls`.
`www.cardresell.org` fetched over the network for the served bundle. Git read
locally. **No credential value was printed, inspected, or written anywhere.**
