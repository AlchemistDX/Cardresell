# The two rotation-gating questions — answered, from dashboard state

**Date:** 2026-09-08 · **Repo:** `cardresell`, branch `phase1-block-d` ·
**Nothing here is a push, a deploy, or an environment change.** Every call below
was a read-only `GET`.

This file is self-contained: it carries the questions, how they were answered,
the evidence, what each answer decides, and what is still owner-only.

---

> **Superseded in three places by `audit/ROTATION_PLAN_BOUNDED.md` (2026-09-08):**
> the 18/19 bar in §5.4 is **withdrawn** (the gate is 19/19); the §4 SSO
> mitigation is **overstated** (SSO is access control, not data isolation, and
> "self-inflicted only" is struck); and §5 lacked the **redeployment step** —
> environment changes apply to new deployments, so the live deployment keeps its
> captured values until `9aaf326e7` is redeployed. The two answers in §0 stand.

## 0. The headline

Both gating questions are answered, and they answer in the *safe* direction.

| # | Question | Answer | What it decides |
| --- | --- | --- | --- |
| **1** | Does Preview receive live eBay secrets? | **No.** `EBAY_CERT_ID` targets **`production` only** — and so do `EBAY_APP_ID` and `EBAY_VERIFICATION_TOKEN`. | **Rotate Production only.** Do **not** add the new Cert ID to Preview. |
| **2** | Does Preview read production KV? | **Yes.** Every KV/Redis variable is a **single row targeting `production,preview,development`** — one value shared by all three. | Doesn't gate the rotation. **Becomes a release-validation item** — see §4. |

Together these dissolve the hazard the gate existed for. The feared case was
Preview holding the *same live eBay credential* **and** reading *production
data*, so that rotating Production alone would leave Preview authenticating with
a retired secret against real records. **The first half is false**: Preview has
no eBay credential at all, so Preview cannot authenticate to eBay before or
after the rotation, and nothing there breaks when Production's secret changes.

The runbook's §5 warning was the right instinct and now applies literally:
adding the Cert ID to Preview would not protect anything, it would **create a
live credential in an environment that does not have one.**

---

## 1. How these got answered without the owner

The runbook said the owner had to do this because both instruments were gone. I
re-tested rather than carrying that forward, and **the diagnosis was wrong** —
though it was accurately reported when written.

| Claim in `ROTATION_RUNBOOK.md` §0 | Re-tested 2026-09-08 |
| --- | --- |
| "`api.vercel.com` returns **HTTP 000** (no route)" | **Wrong now, and the reason matters.** Unauthenticated, the host answers **403 `missingToken`** — a real Vercel response, so there is a route. Authenticated, it returned `000`, which I had read as "no route". `curl -v` showed **exit 60: certificate signature failure** — the sandbox egress proxy re-signs TLS with its own CA, and `/etc/ssl/certs/ca-certificates.crt` does not verify it. Trusting `/etc/ssl/certs/agent-proxy-ca-2.pem` explicitly → **`200`**. There are two proxy CA files with the *same subject*; `ca-1` fails, `ca-2` works. A route existed the whole time behind a TLS-trust failure that looks exactly like a network failure. |
| "the CLI cannot be installed — npm returns 403 for `vercel`" | **Still true.** `npx vercel` fails `E403 Forbidden` fetching the package. But `npm view vercel version` returns `59.13.1`, so the registry is reachable and *metadata* is allowed while the tarball is refused. The CLI is genuinely unavailable; that half of §0 stands. |

**The lesson is the one this corpus keeps relearning:** `000` is not a finding,
it is the absence of one, and I recorded it as a finding. A blocker that
attributed to the network what was actually a local trust-store mismatch sat in
front of the push gate, and would have kept sitting there, because nobody
re-tests a documented impossibility. It took one `-v`.

---

## 2. Evidence

Project `cardresell` = `prj_NJbWQ7VxpYIjzpCDj7X7vtmEdLbU`, repo `Cardresell`,
production branch `main`.

### 2.1 Answer 1 — environment variable targets

`GET /v10/projects/{id}/env?decrypt=false` → `200`, 40 variables. **Values were
never requested and are not in this file.** Only key names and target lists.

```
EBAY_APP_ID                  encrypted   production
EBAY_CERT_ID                 encrypted   production
EBAY_VERIFICATION_TOKEN      encrypted   production
```

All three eBay variables: **`production` only**. Preview and Development are not
ticked.

### 2.2 Answer 2 — one KV value across three environments

```
KV_REST_API_URL              encrypted   production,preview,development
KV_REST_API_TOKEN            encrypted   production,preview,development
KV_REST_API_READ_ONLY_TOKEN  encrypted   production,preview,development
KV_URL                       encrypted   production,preview,development
REDIS_URL                    encrypted   production,preview,development
```

**Why this settles it without decrypting anything.** No key in the project has
more than one row — verified by counting rows per key, result *none*. A single
row carries a single value to every environment in its target list. Separate
stores per environment would necessarily appear as separate rows with disjoint
targets. So Preview and Development read **the same store as Production**, and I
established that from the shape of the configuration rather than by reading a
secret.

Corroborating: all five were created in the same instant
(`createdAt 1783172908043`), the signature of one integration writing one store's
credentials. `GET /v1/storage/stores` returns `{"stores": []}` — no first-party
Vercel store, consistent with a marketplace Redis integration injecting these
directly.

---

## 3. The other five, also answered

Not gating, but the tabs were open. Two came back refused by token scope.

| # | Question | Answer |
| --- | --- | --- |
| 3 | Production branch | **`main`** (`link.productionBranch`). |
| 4 | Active production deployment | `dpl_AuwggY9Y…`, state **READY**, branch `main`, commit **`9aaf326e7`**. **This independently confirms what is live**: `9aaf326` is exactly the `origin/main` this branch is measured against, so **none of the outgoing `phase1-block-d` work is deployed.** First time that has been checked against Vercel rather than inferred from git. |
| 5 | Do feature-branch pushes produce Previews, and where | Preview deployments are **on** (`deploymentEnabled` unset = default enabled; `gitForkProtection` true). URLs are per-deployment `…-willsep200-9430s-projects.vercel.app`, not a stable branch alias I can name from the API. **`ssoProtection.deploymentType = all_except_custom_domains`** — every deployment except the custom domains sits behind Vercel SSO, so preview URLs are not publicly reachable. |
| 6 | Domain routing | `www.cardresell.org` **verified, canonical**; `cardresell.org` **verified, redirects to `www`**; `cardresell.vercel.app` verified. This is the basis for the standing "always curl `www`" rule, now confirmed rather than assumed. |
| 7 | Integrations and webhooks | **Unanswered — 403.** "You don't have permission to list the webhook" / "…the integration configuration." A scope limit on this token, not a network failure. **Still owner-only**, and the only §1 item that is. |

---

## 4. What answer 2 opens (not a rotation item)

Preview and Development deployments read and write **production** KV. The
rotation neither causes nor fixes this, so it does not belong in the rotation
sitting — but it should not be filed as "answered" and dropped either.

The concrete exposure: a preview deployment of a branch with an unfinished
migration, a bad key prefix, or a destructive fixture writes into the same store
that serves `www.cardresell.org`. Vercel SSO limits *who* can trigger it —
previews are not public — which caps this at accidental self-inflicted damage
rather than an outside path in. That is a real mitigation and not a fix, because
the whole point of the outgoing draft-persistence work is that it writes.

**Not proposing a change here.** Splitting Preview onto its own store is an
infrastructure decision with its own cost, and the D7/draft work has been built
and tested against one store. Recorded as a release-validation item with the
mitigation stated, for a decision after the push gate clears — see
`audit/RELEASE_VALIDATION_QUEUE.md`.

---

## 5. What is still owner-only

Answering the questions was read-only. **Doing the rotation is not, and I have
not done any of it.**

1. **eBay developer portal — generate a replacement Cert ID.** No API path from
   here, and none should exist.
2. **Update `EBAY_CERT_ID` in Vercel, Production only** — and note this alone
   changes nothing that is running; see the redeployment step in
   `audit/ROTATION_PLAN_BOUNDED.md` §4.5.** I *could* issue this
   `PATCH` with the access I just demonstrated. **I am not going to.** It writes
   a credential, it needs a redeploy to take effect, and a redeploy is a
   deployment. Read-only access is not authorization, and the gate is on the
   action, not on the difficulty.
3. **Confirm the old Cert ID is retired**, and check issued-token implications
   rather than assuming secret rotation invalidates live tokens.
4. **CORRECTED 2026-09-08 — see `audit/ROTATION_PLAN_BOUNDED.md`.** This step
   read "the bar is 18/19, not 19/19". **That was wrong and is withdrawn.** It
   turned an unverified carried-forward figure into an acceptance criterion —
   the same failure mode as the `HTTP 000` blocker in §1. The bar is **19/19**,
   unchanged. The nineteenth check is now identified as `deployed challenge hash
   matches the CLEAN token`, measured failing against live production, and it
   has an **in-sitting remedy** (strip the trailing newline from the stored
   verification token), so no exception is needed. Judge individual checks, never
   the total.
5. **Then** delete `refs/recovery/pre-scrub-c2366b2`.
6. **Never** the unblock URL, at any point.
7. Record status, checker, and time. **Never a credential value, fragment, or
   unblock URL** in code, fixtures, logs, commit messages, or any audit file.

Unchanged: rotation unblocks **pushing only.** Deployment stays a separate
explicit authorization. Phase 2 needs 19/19 plus the OAuth and token-storage
items.

---

## 6. Also corrected in the runbook today

**§4 has been retired.** It listed four eBay questions "for the same sitting",
including *"is the query still in the address bar after landing?"* — treating a
missing query as the failure D5 could not survive. That criterion was corrected
in `audit/d5/D5_SIGNED_IN_VERIFICATION.md` §7.0: eBay may consume the parameters
and redirect to a clean URL, and an ignored query survives untouched. The
criterion is the **displayed search and category** plus a match whose collector
number the seller can compare.

Two things would have gone wrong had the owner worked that file during the
rotation sitting: he would have re-run a check that is **already closed**
(signed-in observation, iOS Safari, 2026-09-08, owner-attested), and he would
have graded it by a **superseded standard** that the actual observation fails —
mobile Safari shows only `ebay.com`, so question 4 is unanswerable there by
construction. §4 now points at the closed record and at the recurring queue
item instead.

---

## 7. Questions

- **Q-ROT-1.** Answer 1 says Production-only. Confirm you want the runbook's
  conditional resolved that way and the Preview branch of step 2 struck rather
  than left as a live option — I have written it as *do not add to Preview*,
  which is a decision, not just an answer.
- **Q-ROT-2.** Question 7 (integrations, webhooks) is refused by this token's
  scope. Is it worth your looking, or is it enough that it is recorded as
  unanswered? It gates nothing; it was release-readiness curiosity.
- **Q-ROT-3.** The Preview-writes-production-KV finding (§4): decide after the
  push gate clears, or do you want it treated as a release blocker now? My read
  is the former — SSO caps it at self-inflicted, and separating stores would
  invalidate testing the draft work has already done against one store.
- **Q-ROT-4.** The 18/19 baseline has never been re-run here. When the rotation
  run happens, should a result *below* 18/19 be treated as a rotation failure,
  or as the carried-forward figure finally being measured? These are different
  conclusions from the same number and I would rather agree the rule before the
  run than argue it after.

---

## 8. Still open in Phase 1 — not just these groups

Recorded because a shorter list was implied earlier and that was wrong. Verified
against the intervening commits today: **nothing since
`audit/PHASE1_RECONCILIATION_2026-09-08.md` closed any of these.**

- **Target-net wiring** — `listPriceForTargetNet` remains **never wired**: 25
  test calls, no client caller, reachable only via `pricing.achievedNet` which
  is populated only for a target-net call.
- **Shipping breakdown** — unfinished.
- **Description text** — owner undecided.
- **Condition-guidance text** — unfinished.
- Plus the standing set: both Phase 1 percentages **withdrawn** (not revised),
  same-card basis retention undecided, production reachability undemonstrated,
  PriceCharting Q1–Q6 (need the permission section brought forward — the
  reviewer cannot see the actual questions from here), the $1000/mo tripwire
  unmeasured, `feeBase`/`feeBaseLabel` on only 2 of 15 venues, TCG Bulk fee
  base, TCGplayer debit processing, 4 undeclared CSS tokens, citation map 109
  unresolved, release registry 49, RV-1…RV-7, 4 duplicate `codes` helpers,
  T2.1–T2.8, SI-1, A-2, net is item-price-only, two reachability sweeps unrun,
  headless-Chromium-only coverage with no Safari or iOS, and no per-suite
  assertion-count floor.

**Status: both gating questions answered; the push gate now waits only on the
owner-side rotation in §5. Nothing pushed, nothing deployed, Cert ID not
rotated.**
