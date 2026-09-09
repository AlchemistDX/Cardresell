# Rotation maintenance window — final execution checklist

**Date:** 2026-09-09 · Repo `cardresell`, branch `phase1-block-d` ·
**Nothing in this file has been executed.** It is the deliverable requested
before authorization. No credential written, nothing pushed, nothing deployed,
Cert ID not rotated, recovery ref not deleted.

Self-contained: carries the rulings, the corrections they forced, the observed
configuration, the ordered steps, and what each step does and does not prove.

---

## 0. What changed since the last packet

Three rulings changed the plan, and one of my own findings changed it again.

1. **The gate is no longer a number at all** — not 19, not 18. Correcting my
   correction: the harness has conditional checks, so no fixed count can define
   success. §1.
2. **The verification token is replaced, not repaired.** Stripping whitespace
   from a published value leaves a published value in production. §2.
3. **Containment first, and its mechanism must be verified before it is relied
   on.** I have now observed what the project actually exposes, and it is *not*
   the preview-only toggle I proposed. §4.
4. **The harness has been changed** (`tests/ebay-live.mjs`) to stop comparing
   against the committed default. This was self-confirming: production was
   serving that literal, so the harness was comparing two copies of a published
   value and calling it agreement. §3.

---

## 1. The acceptance gate, restated

**Required: every required check passes. No fraction, no total.**

Adopted from the ruling, and it invalidates my own §1 of
`ROTATION_PLAN_BOUNDED.md` as much as it does the 18/19 bar — I replaced an
unverified number with a *verified* number, when the shape of the harness means
**no count is a criterion.** Demonstration, using this window's own work: the
harness edit in §3 **adds** a check, so the all-passing happy-path count moves
from 19 to 20. Had "19/19" survived as the bar, a correct run today would have
printed 20 and failed a gate it passed.

**A run is recorded as:**

- Every **failed** assertion by name, with its printed hint.
- Every **warning** — warnings mask checks in this harness. `category tree
  version moved`, `Marketplace Insights scope is NOW GRANTED`, and `Browse may
  now support a sold filter` each *replace* a check with a warn, so a warning is
  a check that did not run, not a footnote.
- Every **skipped branch**: which of the conditional checks (`:145`, `:208`,
  `:220`, and the taxonomy/browse throw paths at `:148`, `:167`, `:185`) emitted
  and which did not.
- **Target deployment id and commit**, and the timestamp.
- The harness's own verbatim `X passed, Y failed, Z warnings` line — its actual
  output format. It has never printed a fraction; "18/19" was never its output.

**Changed behaviour is adjudicated explicitly, not averaged into a pass.** If
eBay's category tree version has moved or the Insights scope has been granted,
that is a finding requiring a decision, and it neither passes nor fails the
rotation on its own.

**Below the required set concludes nothing by itself.** Each failure is
classified — authentication, configuration, connectivity, or pre-existing
behaviour — before anyone says whether the rotation worked. And a run with no
failures is not automatically a pass either: it may have warned away a check
that mattered.

---

## 2. Both credentials are replaced in one window

The Cert ID and the verification token have **distinct checks** — `Cert ID
present and 36 chars` / `client_credentials returns a token` versus `deployed
challenge hash matches the CLEAN token` — so changing both does not impair
diagnosis. Confirmed and adopted.

### 2.1 The ordering constraint, and why it is not the obvious one

eBay challenges the endpoint **when the configuration is saved**. So the
endpoint must **already be answering with the new token** before the portal is
updated. That inverts the intuitive order:

```
generate new token  →  set in Vercel Production (no whitespace)
                    →  REDEPLOY 9aaf326e7        ← endpoint now answers with it
                    →  save in eBay portal        ← eBay challenges here
                    →  portal challenge succeeds
```

Setting the portal first, or setting Vercel without redeploying, produces a
challenge against an endpoint still hashing the old value.

**The window that cannot be closed.** Between the redeploy and the portal save,
eBay's stored token and the endpoint's token disagree. Any eBay-initiated
re-validation in that interval fails. Keep the interval to minutes and do the
portal save immediately after the redeploy reports READY.

### 2.2 Two verifications, neither substituting for the other

| What passes | What it proves | What it does **not** prove |
| --- | --- | --- |
| Harness check `deployed challenge hash matches the CLEAN token` | The endpoint hashes **the value the operator supplied to the harness** | Nothing about what eBay has stored |
| eBay portal's own challenge on save | **eBay's** stored value matches the endpoint | Nothing about the harness's expectation |

Both are required. A green harness with a failed portal save means the operator
and eBay hold different values.

---

## 3. The harness no longer trusts a repo literal — done, uncommitted at write time

`tests/ebay-live.mjs:233-247`: the committed default fallback is **removed**.

```js
const rawVToken = process.env.EBAY_VERIFICATION_TOKEN;
const vToken = cleanCredential(rawVToken || '');
if (!rawVToken) {
  check('EBAY_VERIFICATION_TOKEN supplied to the harness', false, …);
}
```

Absence is now a **failed check**, not a silent fallback — a silent omission is
the bug. `node --check` passes. The literal `CardResell-eBay-Notify-…` now
appears in **exactly one** place in the tree: `api/ebay-notifications.js:17`,
the production handler.

**Why this mattered more than it looks.** The old harness derived its expected
token from the same literal production was serving. The check could not fail for
the right reason — it compared a published value against itself. It only ever
caught the *newline*, which is why it looked like a working check.

**Editing the harness cannot contaminate the maintenance deployment.** Test
files are not deployed, and more fundamentally the maintenance deployment is a
**redeploy of `9aaf326e7`**, which contains none of this branch's commits by
construction. The operator runs the harness from a checkout; the deployment is
built from the live commit.

**CH-2, tracked separately:** removing the usable fallback from
`api/ebay-notifications.js:17` is a **code** change. The environment change in
this window does not remove it, and it is not in scope here — it ships with the
outgoing Phase 1 work or as its own authorized change. Until then, an unset
production variable silently falls back to a published value.

---

## 4. Containment — what the project actually exposes

**My proposed "disable automatic Preview deployment" toggle is Unverified. I
could not establish that it exists with the intended scope, and I should not
have named it as though I had.**

What the project **does** expose, observed:

| Field | Value | What it appears to govern |
| --- | --- | --- |
| `gitProviderOptions.createDeployments` | **`"enabled"`** | Whether Vercel creates deployments from Git at all |
| `link.deploymentEnabled` | **unset** | Read by me as "default enabled" — an **inference**, not an observation |
| `gitForkProtection` | `true` | Fork PR builds require approval |
| `ssoProtection.deploymentType` | `all_except_custom_domains` | Access control only — **not** data isolation |

**The honest reading of `createDeployments`:** it appears to be all-or-nothing
for Git-triggered deployments — **production included** — not a preview-only
switch. That is *broader* than what I proposed. For this purpose that is
arguably correct rather than a problem: deployment is separately authorized
anyway, so a push that creates nothing is the desired behaviour. But it is a
different setting with a different blast radius than the one I described, and
**the dashboard is the authoritative surface.** Verify the exact control and its
scope there before relying on it. If it does turn out to suppress production
deployments too, that must be understood before the maintenance window, since
step 6 depends on being able to deploy.

**What containment does not do**, adopted from the ruling:

- It prevents **new automatic** deployments. It does **not revoke
  production-KV access from existing deployments** — the running production
  deployment and any live preview from an earlier push keep the credentials they
  captured at build time.
- It does **not** cover **local development**. `KV_*`, `KV_URL` and `REDIS_URL`
  all target `development` as well, from the same single rows. A local `vercel
  env pull` or an already-pulled `.env` writes to the production store.
- **Therefore: existing deployments and local development stay out of
  write-capable testing until a separate store exists.** Read-only inspection
  only.

**And the checks that needed a preview surface wait for the separate store.**
They are **not** to be run against production instead. That substitution would
defeat the purpose of the containment, and it is the specific temptation this
paragraph exists to foreclose.

---

## 5. The window — ordered steps

**Scope: restore a known-good credential state on the currently live commit.**
Not a release. **No outgoing Phase 1 code enters this deployment.**

**Standing constraints:** never the unblock URL, at any point. Never a credential
value, fragment, or hash in code, fixtures, logs, commit messages, or any audit
file. Paste into the dashboard only — **and paste without a trailing newline**,
the exact defect measured on 2026-09-08.

| # | Action | Surface |
| --- | --- | --- |
| 0 | **Verify the containment control** and its scope in the dashboard (§4). Confirm whether it suppresses production deployments too. | Vercel → Settings → Git |
| 1 | **Apply containment**: stop Git-triggered deployments. | same |
| 2 | Generate a replacement **eBay Cert ID**. | eBay developer portal |
| 3 | Generate a **fresh verification token** — a new random value, **not** the repo literal, **not** the literal with the newline removed. | operator's generator |
| 4 | Set `EBAY_CERT_ID` and `EBAY_VERIFICATION_TOKEN`, **Production only**, **no whitespace**. Preview holds no eBay credential and must not gain one. | Vercel → Environment Variables |
| 5 | **Redeploy the exact live commit `9aaf326e7`.** Verify the new deployment reports **that commit**, not a branch head. | Vercel → Deployments → `dpl_AuwggY9Y…` → Redeploy |
| 6 | Wait for READY. The endpoint now answers with the new token. | — |
| 7 | **Save the new verification token in eBay's portal** and let its challenge run. Record the portal's result. | eBay portal |
| 8 | Confirm the **old Cert ID is retired**, and check what happens to **already-issued tokens** — secret rotation does not necessarily invalidate live ones. | eBay portal |
| 9 | `EBAY_VERIFICATION_TOKEN=<new> EBAY_APP_ID=… EBAY_CERT_ID=… EBAY_LIVE=1 node tests/ebay-live.mjs` — from a checkout, exported for the run, not persisted. | operator shell |
| 10 | **Record per §1**: failures by name, every warning, every skipped branch, deployment id, commit, timestamp, verbatim summary line. | audit file |
| 11 | Adjudicate any changed behaviour explicitly (§1). | — |

**Only after 10 and 11 are complete and the required checks pass:**

| # | Action |
| --- | --- |
| 12 | Delete `refs/recovery/pre-scrub-c2366b2`. **Not before completed verification.** |
| 13 | Push — **and only once §4 containment is verified applied**, since a push is what would otherwise create a Preview. |

**Deployment of Phase 1 remains a separate authorization.** Phase 2 entry still
requires official user OAuth, resolved descriptor value IDs, and the token
storage/deletion contract review (`audit/CARDRESELL_PLAN_AND_ROADMAP.md:511`).

---

## 6. Authorization requested

I will not execute any of §5 without an explicit go. Two notes on who does what:

- **Steps 2–4 and 7 should be yours in the dashboard and portal.** I have the
  API access to write the environment variables, but doing so would require the
  new secret values to pass through this session. They should not. Nothing is
  gained: the dashboard is two fields.
- **Step 5, the redeploy, involves no secret** and I could trigger it. I believe
  the API supports redeploying an existing deployment by id; **I have not tested
  it and will not without authorization**, since a redeploy is a deployment.
  Say the word and I will, or do it in the dashboard — the dashboard is the
  surface I would recommend, since you can read the commit it reports before
  confirming.

**What I am asking for, explicitly:** authorization for the environment changes
(step 4) and the redeployment of `9aaf326e7` (step 5), on the understanding that
no outgoing Phase 1 code enters that deployment and that no push or recovery-ref
deletion precedes completed verification.

---

## 7. New hygiene finding — disclosure

While reading the project configuration to answer §4, the project detail
endpoint returned **environment variable values in cleartext for rows stored as
`type: plain`**. Three rows are `plain`: `BLOB_STORE_ID`,
`BLOB_WEBHOOK_PUBLIC_KEY`, and **`CARDSELL_TPL_KEY`**.

**Disclosing plainly: one value was displayed in my working output as a result.**
It was not recorded in any file, and it is not reproduced here or anywhere in the
repo. But it entered this session, so treat it as exposed rather than assume
otherwise.

**CH-3:** `CARDSELL_TPL_KEY` is stored as `plain` rather than `encrypted` and
targets `production,preview,development`. If it is a live API key it should be
re-created as an encrypted variable — Vercel cannot convert in place, so it must
be deleted and re-added — and **rotated**, given the above. The two `BLOB_*`
rows are store identifiers rather than secrets and can stay as they are. Filed
to the release queue; **not** part of this window, which is already changing two
credentials.

---

## 8. Unchanged

D5, D6, D7 closed within scope. Rotation, containment, release validation and the
unfinished Phase 1 features remain open: target-net wiring
(`listPriceForTargetNet` never wired), shipping breakdown, description text,
condition-guidance text, both withdrawn Phase 1 percentages, same-card basis
retention, production reachability beyond the one endpoint probed, PriceCharting
Q1–Q6 (the permission section still needs bringing forward), the $1000/mo
tripwire, `feeBase`/`feeBaseLabel` on 2 of 15 venues, TCG Bulk fee base,
TCGplayer debit processing, 4 undeclared CSS tokens, citation map 109 unresolved,
release registry 49, RV-1…RV-9, CH-1…CH-3, 4 duplicate `codes` helpers,
T2.1–T2.8, SI-1, A-2, net is item-price-only, two reachability sweeps unrun, no
Safari or iOS in CI, no per-suite assertion-count floor.

**Status: checklist complete and awaiting authorization. Nothing executed.**
