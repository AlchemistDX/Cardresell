# Instruction to the coding agent — production deploy and live test

**Supersedes the 21:39 version entirely.** That version was written from a stale
checkout and got three things wrong. They are corrected below and named, not
quietly dropped.

**Authorization:** Will authorized production deployment and live testing on
2026-09-11 and confirmed it still stands for the intended release. Batch drafting
is **in scope and already implemented** — it is not a choice to put to him.

---

## 0. What was wrong in the previous instruction

1. **It inspected the wrong commit.** It read `a89db24` / `core.ebc21977.js`,
   from **before** batch drafting existed, and concluded the feature was missing.
   The remote branch had moved to `4aa02df`. **Reconciled:** local
   `phase1-block-d` and `origin/phase1-block-d` had diverged at `e75700c` —
   thirty unpushed audit commits on one side, four commits including the
   implementation on the other. Merged at `875204b`; one add/add conflict in
   `audit/REQ_BATCH_DRAFTING.md` resolved to the remote as-built version, which
   supersedes the pre-implementation spec.
2. **It repeated the withdrawn cap-message claim.** Corrected in §5.
3. **It mislabelled the release as "CH-2 only" and proposed unsetting the
   production token.** Corrected in §1 and §3.

**`index.html` at HEAD now loads `js/core.2db046e6.js` and `js/ui.e6529e78.js`** —
the same bundles as the tested Preview.

---

## 1. The release is not "CH-2 only"

**Withdrawn:** the previous framing of an (A) CH-2-only deploy. **Pushing 254
changed files is not a one-line fix and must not be described as one.**

`HEAD` (`875204b`) vs `origin/main` (`9aaf326`): **254 files, +957,519 / −276**.
That includes **26 API modules** — the entire Block D draft path
(`_draftService`, `_draftStore`, `_draftLifecycle`, `_draftIndex`, `_draftQuota`,
`_idempotency`, `drafts.js`), listing packet/title/description, sell eligibility,
`_ebayAuth`, `_ebayTaxonomy`, the TPL budget/proxy, `scan.js`, `tcg-price.js`,
`_kv.js` — plus `index.html`, 40 bundle files, and the audit/test record.

**Describe the release by what it contains.** CH-2 is one file in it.

**Verify before pushing:**
- **Batch drafting — present.** `be49e0a` "Batch drafting from Bulk/Rapid Scan:
  stable scan identities, opt-in selection, per-card outcomes", with the check
  sheet at `46a5a4e`/`a311137` and corrections at `4aa02df`. Confirm it is an
  ancestor of HEAD.
- **CH-2 — present.** `api/ebay-notifications.js:31-32`
  `function verificationToken() { return cleanCredential(process.env.EBAY_VERIFICATION_TOKEN) || ''; }`
  — read at call time. `origin/main` still has the repo-literal fallback. That
  is the defect being fixed.
- Read the full diff. Do not push a release you have not inspected.

---

## 1a. Merged-build verification — DONE, on the merge commit itself

Matching frontend bundles do not verify the merged API code. Run on **`875204b`**
(the merge), the commit being deployed.

**First, what the merge actually changed.** `git diff --name-only 4aa02df..HEAD`
returns **no `api/` and no `js/` file**. The differences are audit documents,
plus tests and tools carried from my side (`tests/ebay-credential-check.mjs`,
`tests/cert-generation-compare.mjs`, `tools/verify-ebay-credential.mjs`,
`tools/verify-challenge.mjs`, and others). **The merged API and client code is
byte-identical to the tested tip.** That is a useful fact, not a substitute for
running the tests — so they were run.

**9 suites, 1,511 assertions, 0 failures, every suite `SUITE COMPLETE, exit=0`:**

| Suite | Result |
|---|---|
| `ebay-notify-token` (CH-2) | 22 passed, 0 failed |
| `draft-lifecycle` | 83 passed, 0 failed |
| `draft-store` | 147 passed, 0 failed |
| `bulk-batch-draft` (batch drafting) | 93 passed, 0 failed |
| `draft-crud-e2e` | 239 passed, 0 failed |
| `draft-list-cap` | 130 passed, 0 failed |
| `draft-index-recovery` | 265 passed, 0 failed |
| `draft-review-screen` | 417 passed, 0 failed |
| `draft-readiness` | 115 passed, 0 failed |

Completion **and** exit status are recorded per suite, so a seeding crash cannot
masquerade as a completed run.

**`bulk-batch-draft` carries its own mutation check** — "MUTATION TOOK: only two
drafts exist where three cards were selected", so the two-copies/two-drafts
assertion is discriminating rather than merely green.

**The CH-2 unset case is now verified, and §3 is satisfied without touching
production.** `ebay-notify-token` exercises it in-process with the variable
absent by construction: 503 with an explicit reason, **no `challengeResponse`
at all**, `""` / `"   "` / `"\n"` / `'""'` all treated as unset rather than
hashed, a missing `challenge_code` still 400 rather than 503, and a deletion
notification acknowledged with the token both unset and set. **No production
environment variable is to be unset.**

**Deploy this exact commit — `875204b`** — and confirm that SHA in the build log.
If any commit is added before pushing, **the suites above must be re-run on the
new commit**; these results attach to `875204b` and to nothing else.

**Not covered by these suites, and still open:** concurrency, the
original-scan-row retry, RV-1, RV-3/RV-9, deployed Google authentication, R4
activation. See §4 and §6.

---

## 2. Deploy, then confirm the production commit

- Push `phase1-block-d` to `main`; push auto-deploys.
- **Keep deployment protection enabled.** Never disable it to make a check pass.
- On READY, **confirm the deployed commit from the build log** — not the
  dashboard summary, not a bundle hash. A bundle hash has been mistaken for a
  commit in this project before.
- Report the deployment ID and the commit SHA it built.
- Confirm `https://www.cardresell.org` serves 200 and the expected bundles via
  cloud browser or `node -e` with `fetch`. **Sandbox `curl` is unreliable here.**

---

## 3. CH-2 failure handling — do NOT unset the production token

**Withdrawn from the previous instruction:** the step that had production's
`EBAY_VERIFICATION_TOKEN` unset to observe `503 verification_token_unset`. That
would deliberately break a live production credential path to test a negative,
and it is not an acceptable way to verify fail-closed behaviour.

**Instead:** verify the unset case **with the tested release code in an isolated
environment** — Preview or local, where the variable can be absent by
construction. `api/ebay-notifications.js` is written so present and absent can be
exercised in one process. Assert: GET with the token unset returns **503
`verification_token_unset`**, `no-store`, and **no `challengeResponse` field**;
POST stays open deliberately.

**In production, verify only the positive path**, and only with the token in its
normal configured state. **Do not re-run the 6b challenge check** — it passed on
2026-09-11 against `dpl_BS1a9nXNzpUtEqiWpRLakQmjMRXz`; Will has said no further
token test is needed. Never print, echo, or validate a credential value.

---

## 4. Live checks — report each failure individually

**Report per check. A count or a fraction is not a result.** The eBay harness
gate is *every required check passes*. For each failure give the check name, the
assertion, the observed value, and the `file:line`. Do not aggregate, do not stop
at the first failure, do not summarize failures away.

1. **RV-3 / RV-9 — `tests/ebay-live.mjs`**, all 20 checks, where the
   Production-only credentials resolve. **RV-9 stands at 0 of 20 established.**
   The standalone challenge PASS is **not** one of the 20.
2. **RV-1** — grade response contract against the deployed function.
3. **RV-4 + lifecycle in production.** The Preview round-trip is done: a scan
   draft created, reopened, and deleted against `core.2db046e6.js` /
   `ui.e6529e78.js`. Per `4aa02df`, **that proves the store boundary and
   create/reopen only — it is not a substitute for the live suite's concurrency
   checks, which remain unrun.** Report concurrency separately.
4. **Deployed Google authentication** — sign in; confirm the
   `userdata:<googleSub>` round-trip.
5. **Batch drafting live** — selection, tri-state Select All, Create Selected,
   per-card outcomes. Confirm a re-run on a partially-succeeded batch **replays
   rather than duplicates**, via the `scan_<hex>` capture identity.
6. **R4 activation (G12)** — activate, then verify.

---

## 5. The cap claim, withdrawn a second time

**I was wrong twice and the method was the same error both times.** I reported
that no client cap message existed, on the strength of **zero bundle hits for
`at-cap` / `AT_CAP`**. Those are **internal enum values** (`api/_draftQuota.js:96`)
that **never reach the wire**. The wire code is **`DRAFT_CAP_REACHED`**, sent with
a seller-facing sentence at **`api/drafts.js:97-102`** ("You have reached the
maximum of 500 saved drafts…"), and the client **already handled it** at
`core.2db046e6.js:21580` (`409` + `/CAP/i`) and `ui.e6529e78.js:3940`. The handler
was found and tested. **This is the same failure as the storage audit: searching
for a name instead of tracing the payload.** Treat the cap path as **implemented**.

**Cap testing is deferred, per `4aa02df`, and that deferral stands.** Overwriting
`draftquota` / `draftquotafresh` by hand is **not reversible by deleting the
keys** — the fresh key's remaining TTL is destroyed by the write and no prior
value or TTL was captured. **Do not hand-edit production quota keys.** Held
pending a capture-and-restore procedure or an isolated test account.

---

## 6. Still unverified — original-scan-row retry

**Deletion survived refresh. Retrying from the original scan row was NOT
tested.** It remains **unverified**. Do not upgrade it on the refresh result and
do not let a green lifecycle suite stand in for it.

The path: delete a draft, return to **the original scan row**, retry from there.
Expected per Q-D8-6 — a pending retry **cannot** recreate; only a **fresh
explicit Create** produces a new draft. Per the 410 decision — a stale generation
**shows the deleted state and requires an explicit new Create**, with **no
automatic refresh-and-retry**. Test that, or report it unverified.

---

## 7. Test-data rules

- **Clearly marked test drafts** — unmistakable in production data.
- **Publish nothing.** No listing submitted to eBay or any venue. No auto-publish.
- **No purchases.** No paid quota consumed to demonstrate a behaviour.
- **No manual production quota changes.** See §5.
- **Clean up** test drafts through the product's own delete path.

---

## 8. Rules that still bind

- **Do not weaken a check, a gate, or eligibility to force a pass.**
- **Do not change the eBay exemption** — eligibility unresolved, owner-held.
- **Do not send the eBay support question** — unsent pending Will's approval.
- **Do not claim deletion clears every stored copy** — untraced across all three
  storage locations.
- **No credential output.** Commit messages containing `$` use `git commit -F`.
- **Bind every claim to `file:line`.** Unestablished ⇒ write **Unverified**.
- A passing suite is not evidence it would catch the bug. **When a test fails,
  establish whether the fixture or the product is wrong before changing either.**
- **Negative greps do not prove absence** — see §5, twice over.

---

## 9. Report back

1. Pushed commit SHA, deployment ID, and the commit the **build log** says it built.
2. Each live check named, PASS / FAIL / NOT RUN; every failure with assertion +
   observed + `file:line`.
3. RV-9 as **checks established out of 20**, challenge check excluded.
4. Concurrency reported **separately** from the create/reopen round-trip.
5. The scan-row retry result, or **Unverified**.
6. CH-2 unset-case result, **and the isolated environment it was verified in**.
7. Test drafts created, and whether each was cleaned up.
