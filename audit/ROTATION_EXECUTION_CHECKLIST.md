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
3. **Containment gates the push, not this window.** Superseded — an earlier
   draft said "containment first". It does not block steps 2–11; it gates
   11a–13. Its mechanism must still be verified before it is relied on, and
   what the project exposes is *not* the preview-only toggle I proposed. §4, §8a.
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

Both are required, and they answer different questions. A green harness with a
failed portal save does **not** prove the operator and eBay hold different
values — an earlier draft said it did. It narrows the fault to eBay's side of
the exchange, which includes the configured endpoint URL, whether the request
arrived, and eBay-side faults. Diagnose per the recovery table before editing
either value.

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
deployments too, that must be understood **before it is applied at 11b** — see
§8a for why it is no longer applied ahead of the rotation, which needs to be
able to deploy at step 5.

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
| **1c** | **PARTIAL — 2026-09-11 00:58, corrected 07:24.** **What the owner reported, verbatim:** *"generation and expiry details not displayed."* Read-only, controls untouched, no values shared. **What that establishes:** the portal surfaces **no generation numbering and no expiry date or status**. **What it does NOT establish, and what I wrongly wrote up as attested:** that the portal reveals nothing at all. **Credential values are hidden but revealable**, so the **Production Cert ID currently shown is obtainable by the owner.** Absence of labelling is a fact about the **UI**, not the keyset: it neither establishes that one generation exists nor excludes another in grace. Historical count remains unobtainable; **"at least the second"** remains the whole claim. | eBay developer portal |
| **1d** | **DONE — 2026-09-11 09:40. Result: NO MATCH. Interpretation narrowed 10:22.** Owner ran the **corrected** `compare-cert-generation.mjs`, which compares **exact input with no trimming** (`fingerprint` no longer calls `.trim()`; its suite asserts *"trailing newline is a different complete value"*). **Establishes only: the two entered strings differed.** It does **NOT** establish that the two stored credentials differ — **leading/trailing whitespace, a truncated copy, or any paste error produces the same NO MATCH**. My earlier write-up called it "not a near-miss or formatting artefact"; **that is withdrawn** — under exact comparison a formatting difference is precisely one of the live explanations. | operator shell — complete |
| **1e** | **DONE — 2026-09-11 09:40. Result: ACCEPTED**, on the **portal-shown pair**. eBay issued an application token. **Establishes:** that pair is currently valid, and the "appears not enrolled for `client_credentials`" hypothesis is **disproved**. **Does NOT establish:** that the deployed application uses that pair (at `9aaf326` production reads **neither** `EBAY_APP_ID` nor `EBAY_CERT_ID`), nor anything about the Vercel-row value, which was never exchanged. | operator shell — complete |
| **1f** | **No predecessor recorded, because no Cert ID rotation is in progress. Corrected 2026-09-11 10:22.** **The Cert ID rotation is PAUSED.** The portal pair **authenticates**, so there is a **known-working production credential**; nothing established requires resetting it. There is **no replacement Cert ID** — none was generated. The Vercel-row value remains **untested**, and 1d's NO MATCH may reflect an entry difference rather than a different credential. My "three values in play" framing is **withdrawn**: it counted a replacement that does not exist. | paused — no action |
| 2 | **PAUSED — not part of this window. 2026-09-11 10:22.** Generating a replacement **eBay Cert ID** is deferred. The portal pair authenticates (1e), so a working production credential exists; the withdrawn exposure premise supplied no need, and 1d's NO MATCH does not supply one either. **Do not reset the working portal credential as part of the verification-token window.** Revisit only on new evidence. | deferred |
| 3 | Generate a **fresh verification token** — a new random value, **not** the repo literal, **not** the literal with the newline removed. **Added 2026-09-10 22:05 — eBay requires 32–80 characters, alphanumeric plus `_` and `-` only. A base64 generator emitting `+`, `/` or `=` will be rejected by the portal whatever our endpoint does.** | operator's generator |
| 4 | Set **`EBAY_VERIFICATION_TOKEN` only**, **Production only**, **no whitespace**. **Corrected 2026-09-11 10:22 — `EBAY_CERT_ID` is removed from this step**: the Cert ID rotation is paused (step 2) and must not ride along on this window. Changing exactly one variable also keeps 6b's result unambiguous. Preview holds no eBay credential and must not gain one. | Vercel → Environment Variables |
| 5 | **Redeploy the exact live commit `9aaf326e7`** (commit verification happens at 6a, once READY). | Vercel → Deployments → ~~`dpl_AuwggY9Y…`~~ **`dpl_BJuH3okrHAsHpM7vUhCZv85or225`** → Redeploy. **Corrected 2026-09-10 21:30:** `dpl_AuwggY9Y…` is no longer the production deployment; production is now `dpl_BJuH3ok…`, created 2026-09-09 17:03 UTC, serving `www.cardresell.org` with `js/core.569ff536.js`. Its commit is **`9aaf326`, branch `main`**, read from the build log via `vercel inspect <id> --logs` (ordinary `inspect` shows no commit metadata). It is the **TPL rotation rebuild** — `TPL_ROTATION_RUNBOOK.md:507`. 6a still applies, to the *rebuild this rotation produces*. See `audit/ROTATION_RECHECK_2026-09-10.md` §1. |
| 6 | **DONE — 2026-09-11 14:51:45 UTC. Rebuild READY.** New production deployment **`dpl_BdLD4y9z5Uq7jpQPDoNvS7a96gG3`**, target `production`, authorized explicitly by the owner at 10:51 EDT. Build cache **confirmed skipped** — build log: *"Skipping build cache, deployment was triggered without cache."* (`vercel redeploy` exposes no cache flag; the behaviour was **read from the log, not assumed**.) **READY is not proof the replacement token is active.** | — |
| 6a-verified | **DONE.** New deployment's commit read from the build log: *"Cloning github.com/AlchemistDX/Cardresell (Branch: main, Commit: 9aaf326)"* — the pinned commit, **not a branch head**. Domain check: `https://www.cardresell.org` is aliased to `dpl_BdLD4y9z…` and returns 200 serving `js/core.569ff536.js` (unchanged, as expected for an identical commit). | — |
| 6-r2 | **DONE — 2026-09-11 15:38:16 UTC. Second rebuild READY.** First 6b attempt on `dpl_BdLD4y9z…` **FAILED**: the checker named the shape **a trailing newline** — i.e. the endpoint's `challengeResponse` equalled `sha256(token + "\n")`, so the **stored Production value carried a trailing newline** while the owner's paste did not. Owner replaced the Production value with a clean copy; rebuild re-authorized explicitly. New production deployment **`dpl_BS1a9nXNzpUtEqiWpRLakQmjMRXz`**, commit read from build log as **`9aaf326`, branch `main`** (pinned commit, not a branch head), cache **confirmed skipped** from the log. `www.cardresell.org` aliased to it, 200, `js/core.569ff536.js` unchanged. **Note:** this is the **same class of defect as the original CH-1 corruption** — a whitespace-carrying stored value, caught by the checker rather than by READY. | — |
| 6b | **PENDING RE-RUN — owner's Mac.** `node tools/verify-challenge.mjs` against `dpl_BS1a9nXNzp…`. **This is the only check that establishes which token production hashes.** An HTTP 200 with a `challengeResponse` body does **not** identify the token in use; any earlier reading of the pre-rebuild 200 as token evidence is **withdrawn**. **Must PASS before step 7.** | operator shell |
| 7 | **REASSESSED 2026-09-11 11:49 — DOES NOT APPLY in the current portal state. Do NOT disable the exemption to run it.** The owner reports the Production keyset **already had "Exempted from Marketplace Account Deletion" enabled**, pre-existing and unchanged by this window. Per eBay's own page, the exemption is the *"Not persisting eBay data"* toggle: **"notifications will stop being delivered to the configured endpoint"**, while **"email, endpoint, and verification token data remain saved."** So while exempt, **eBay does not deliver notifications to our endpoint**, and there is no subscribe action for its challenge to gate. **Limit of the source:** eBay's page does **not** explicitly state whether a challenge is issued on a token *save* during the exempt state — so whether saving would trigger one is **Unverified**, not "no". Either way the exemption is a **compliance declaration** about data persistence; **disabling it to obtain a challenge would change a compliance posture to satisfy a checklist**, and eBay warns that incorrect information there risks account penalties. **Superseded by 7-alt.** | not applicable |
| 7-alt | **Save the new verification token in eBay's portal, no exemption change.** The portal retains endpoint and token while exempt, so the stored value should be the clean replacement rather than the published default — this removes the published value from *both* sides without touching the exemption. **If eBay happens to issue a challenge on save, record the result** (that is a bonus observation, not the gate). If the portal will not accept a token edit while exempt, record **"not editable while exempt"** and stop — do **not** toggle the exemption. | eBay portal |
| 8 | Confirm the **old Cert ID is retired**, and check what happens to **already-issued tokens** — secret rotation does not necessarily invalidate live ones. | eBay portal |
| 9 | **`bash tools/run-ebay-live.sh`** — hidden prompts, no secret in argv, history or logs. Do **not** use the inline `VAR=… node …` form. | operator shell |
| 10 | **Record per §1**: failures by name, every warning, every skipped branch, deployment id, commit, timestamp, verbatim summary line. | audit file |
| 11 | Adjudicate any changed behaviour explicitly (§1). | — |

**Only after 10 and 11 are complete and the required checks pass:**

| # | Action | Surface |
| --- | --- | --- |
| 11a | **Verify the containment control** and its scope in the dashboard (§4, §8a). | Vercel → Settings → Git |
| 11b | **Apply containment.** | same |
| 12 | Delete `refs/recovery/pre-scrub-c2366b2`. **Not before completed verification.** | git |
| 13 | Push — **only once 11a and 11b are done**, since the push is the trigger they contain. | git |

**Containment is a gate on 11a–13, not on 2–11.** An unresolved containment
control is **not** a reason to stop the rotation; it is a reason not to push.

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

## 6a. Two leaks found while building the runbook's own tooling

Both found by *using* the tools rather than reading them, and both fixed.

**The harness printed a credential fragment.** A test run through the new secret
runner emitted `"prefix":"appid"` from `describeCredential`
(`api/_ebayAuth.js:74`). It capped secrets at 8 characters — but capping is not
withholding, and the runbook has the operator paste harness output into an audit
file two reviewers read. Eight characters of a Cert ID is eight characters of a
Cert ID. Now withheld entirely for any name matching
`CERT|SECRET|TOKEN|PASSWORD|KEY`, and withheld **explicitly** via
`prefixWithheld: true` — a silently empty prefix would read as "the value was
empty", a different and misleading fact. App ID prefixes are kept: they are
public and dropping them costs diagnosability for nothing. Four assertions
added; `tests/ebay-auth-offline.mjs` → **57 passed, 0 failed**. Only the test and
the throw path in `getEbayCredentials` consume this function, so the change is
contained. It is outgoing work, so it cannot reach the maintenance deployment —
but it **does** take effect for the window's harness run, which executes from the
checkout.

**My own whitespace guard was dead code.** `read -rs` without `IFS=` strips
leading and trailing whitespace before assignment, so the check that claimed to
reject a padded paste could never fire — a trailing space was silently accepted
in testing. Fixed to `IFS= read -rs`; the guard now fires. Worth stating plainly:
the *safety* was never lost (a stripped value tested against a padded deployment
still fails, loudly), but the guard advertised a protection it did not provide.

**The challenge verifier is tested against real production state.** Fed a wrong
value it reports no known malformed shape; fed the repo literal it reports
"hashing your token plus a trailing newline" — matching the defect measured
independently on 2026-09-08. Both branches exercised, so it is not being handed
over untested.

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

**What it authenticates — established from the repo, without printing it again.**
`CARDSELL_TPL_KEY` is the **paid TCGPriceLookup API key**: `api/tpl-proxy.js:18`
sends it as `X-API-Key` to `https://api.tcgpricelookup.com`. The whole point of
that proxy is to keep the paid key off the client — `js/config.20ebe911.js:4`
ships the sentinel `'__PROXIED__'` instead of a value. So the exposure is a
billable third-party key, not an internal identifier: the risk is quota and
billing abuse.

**Storage type alone would not invalidate an exposed key. It must be rotated at
TCGPriceLookup**, and re-created as encrypted, in that order of importance.

**Separate pre-existing observation** (not caused by the exposure):
`api/tpl-proxy.js:12` sets `Access-Control-Allow-Origin: *` with no referer or
rate check, so anyone can spend our TPL quota through the proxy. The path
allow-list bounds it to three card-lookup endpoints, so it is quota abuse rather
than arbitrary API access. Filed with CH-3 since both concern the same key's
cost exposure.

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

## 8a. Containment reordered — it gates the push, not this window

Owner decision 2026-09-09: **verify containment before deciding.** Holding.
While specifying what to read, a simplification surfaced that is worth taking
first, because it makes the gate smaller.

**This window contains no push or other deployment trigger beyond the
explicitly authorized redeploy.** That is the whole rationale, and it is
narrower than what I wrote first: "only pushes create automatic deployments" is
broader than anything established here — deploy hooks, integrations and the
`enableAffectedProjectsDeployments` flag are all plausible triggers I have not
enumerated. The claim that holds is about **this** window's contents, not about
Vercel's trigger surface in general.

So containment is a **prerequisite for the push (step 13)**, not for the
credential rotation — and sequencing it before step 4 buys nothing while
introducing the exact risk the reviewer named: that disabling Git deployments
also blocks the **manual redeploy** in step 5.

**Accepted by the owner and the reviewer 2026-09-09, and now applied to the
step table**: containment is unapplied during the window and verified and
applied as **11a–11b**, immediately before the recovery-ref deletion and the
push. The earlier §9 instruction to stop the rotation over an unresolved
containment control **contradicted this and has been withdrawn**, not softened.
The window no longer depends on an unestablished capability.

**This does not dissolve the Q-ROT-7 findings**, which stand unchanged:
production-KV remains reachable from existing deployments and local development,
both stay out of write-capable testing, and the deferred preview-surface checks
wait for a separate store rather than being run against production.

### What to read, and the one question that decides it

In **Project → Settings → Git**, report back **verbatim**:

1. The **exact labels** of every deployment control present, plus any help text.
   I am deliberately not naming the toggle: the API field is
   `gitProviderOptions.createDeployments`, and I do not know what the dashboard
   currently calls it. Naming a label I have not seen is how the last error
   happened.
2. Whether any control is **scoped to Preview only**, or whether the wording is
   all-or-nothing for Git deployments.
3. **The deciding question: does the wording indicate whether disabling it
   affects a manual redeploy of an existing deployment?** My inference is that a
   dashboard redeploy is not a Git-triggered deployment and so would be
   unaffected — **that is an inference, marked Unverified.** If the reorder above
   is accepted, this question stops blocking the window either way.
4. Whether an **Ignored Build Step** field exists. It was **absent** from the
   API response, so I cannot claim it is available.

---

## 9. Stop conditions

Written down so they are decided in advance rather than in the moment.

- **An unresolved containment control does NOT stop the rotation.** Superseded
  2026-09-09; the earlier instruction to stop before changing credentials over
  it contradicted §8a and is withdrawn. Containment gates **11a–13** only.
- **Step 6b fails → stop.** Do not save the token in eBay's portal. Fix the
  Vercel value or the deployment, redeploy, re-run 6b.
- **Any required check in step 9 fails → stop.** No push, no recovery-ref
  deletion, and classify the failure first.

### Recovery is failure-specific, and rollback is NOT the default

Correcting the earlier "rolling back is the expected response", which was wrong
in a way that matters here: **once the old Cert ID is revoked at eBay, an
earlier deployment is not a safe rollback target.** Vercel resolves environment
variables per deployment, and the two things this could mean are **not** the
same:

- **Promoting an existing pre-rotation deployment** reuses the environment
  captured for that build — the revoked Cert ID and the published token. This is
  the unsafe one, and it is never a recovery step.
- **Rebuilding the same commit with the corrected configuration** produces a new
  deployment that resolves the *new* values. This is what steps 5 and the
  recovery rows mean by "redeploy", and it is the mechanism the whole procedure
  depends on.

Promotion restores *configuration that references the revoked value* — trading a
misconfigured endpoint for a definitively broken one. And the pre-rotation
verification token is not merely old: it is **published in the repository**, so
returning to it re-establishes the exposure this window exists to end.

**A revoked or exposed secret is never a rollback target.**

| Failure | Recovery |
| --- | --- |
| 6b reports a corruption shape | Re-enter the value in Vercel without the stray character, **redeploy `9aaf326e7` again**, re-run 6b. Fix forward; no rollback. |
| 6b reports the endpoint hashes something unrecognised | Verify which deployment serves the domain and its commit **before** touching anything else. Likely the redeploy did not take effect, not a wrong value. |
| eBay's portal challenge fails at step 7 | **Diagnose before editing either value.** A passing 6b does not prove the failure is a token mismatch — it proves only that the endpoint hashed correctly for the value 6b was given, at that moment, over the path 6b used. Inspect the portal's error text, the endpoint URL eBay has configured, and whether the request arrived at all. Change a value only once the evidence names which one is wrong. |
| A required check in step 9 fails on **authentication** | **Read the error before assuming the Cert ID.** An auth failure can be a wrong or whitespace-damaged value, a credential not yet active at eBay, the wrong App ID pairing, or an eBay-side fault. Capture eBay's error code and body, confirm which credential the failing call used, then correct the one the evidence names and redeploy the same commit. |
| A required check fails on **pre-existing behaviour** | Not a rotation failure. Adjudicate per §1 and record it; the credentials stand. |
| The endpoint is unreachable entirely | **Diagnose first; unreachable does not mean redeploy.** Check DNS and routing, general connectivity, whether other paths on the domain respond, and the deployment's health and state. A redeploy is the answer only if the diagnosis points at the deployment. **Never** promote a pre-rotation deployment: it carries the revoked Cert ID and the published token. |

**Recovery preserves valid replacement credentials and follows the diagnosed
failure.** The earlier blanket "every path recovers by re-deploying" is
withdrawn: it prescribed a remedy before a diagnosis, which is how an unrelated
routing or portal problem gets answered with a needless deployment. What holds
unconditionally is the credential rule, not the deployment reflex — **never
restore an exposed or revoked credential**, and never treat one as a rollback
target. If the
window has to be abandoned, the correct terminal state is `9aaf326e7` deployed
with the **new** credentials — not a return to the old ones.

**Status: checklist complete and awaiting authorization. Nothing executed — no
credential written, nothing pushed, nothing deployed, Cert ID not rotated,
`refs/recovery/pre-scrub-c2366b2` intact.**
