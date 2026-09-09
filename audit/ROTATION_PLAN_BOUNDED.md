# Bounded rotation plan · the nineteenth check, identified · Preview containment

**Date:** 2026-09-08 · Repo `cardresell`, branch `phase1-block-d` ·
**Nothing here is a credential write, a push, or a deployment.** The one active
probe below was an unauthenticated `GET` to our own public endpoint.

Self-contained. Carries the reviewer's four rulings, what changed because of
them, the evidence, and the plan.

---

## 0. The headline: the nineteenth check has a name, and it does not need an exception

The reviewer refused the 18/19 substitution and required the nineteenth check be
identified before any exception is proposed. **It is identified — and the
exception should be withdrawn rather than granted, because the check can be
fixed in the same sitting.**

**The failing check is `deployed challenge hash matches the CLEAN token`**
(`tests/ebay-live.mjs:256/269`). It fails right now, and I measured that against
live production rather than inferring it:

```
GET https://www.cardresell.org/api/ebay-notifications?challenge_code=probe-<ts>
→ 200, {"challengeResponse": …}
production is hashing: TRAILING NEWLINE
```

Reproduced by the harness's own candidate-shape logic (`:262-267`): I hashed
`challenge + token + endpoint` for the clean token and each corruption shape,
and production's response matches **the token plus one trailing real newline.**
No credential was needed and none was read — the endpoint is public and the
hashing input is in the repo.

**Why it fails, established from the two commits:**

| | `EBAY_VERIFICATION_TOKEN` handling |
| --- | --- |
| Live production `9aaf326` | `process.env.EBAY_VERIFICATION_TOKEN \|\| '<repo default>'` — **used raw** (`api/ebay-notifications.js:8`) |
| `HEAD` (`phase1-block-d`) | `cleanCredential(process.env.EBAY_VERIFICATION_TOKEN) \|\| …` (`:6,:16`) |

The fix landed in **`94dc777`**, which is in the **outgoing, unpushed** set. So
the deployed code cannot strip the stray character, and the stored value carries
one.

**This is why it matters for the plan the reviewer asked for.** A redeployment of
`9aaf326e7` that excludes outgoing Phase 1 work — correctly the required scope —
**cannot fix this check by code.** But it does not have to:

- **Remedy A (in scope):** strip the trailing newline from the stored
  `EBAY_VERIFICATION_TOKEN` value. Same environment sitting, no code change,
  fixes the check at `9aaf326`. **19/19 becomes reachable without shipping any
  outgoing work.**
- **Remedy B (out of scope):** deploy the `cleanCredential` call. Requires
  shipping `94dc777`, i.e. the Phase 1 work. Not available in a bounded sitting,
  and not needed.

**So the standing 19/19 gate stands unmodified.** I am withdrawing the 18/19 bar
rather than defending it — see §1.

### 0.1 A separate finding, from the same probe

Production's response matches **the repo's committed default token** plus a
newline. Since the deployed code is `process.env.X || '<literal>'` and the
literal has no newline, the environment variable **is set**, and its stored value
equals the public repo default with trailing whitespace. **The production eBay
verification token is a value published in the repository.** That is a
credential-hygiene item, not a rotation item, and it was previously carried only
as the vague line "credential hygiene". It is now concrete: this token should be
replaced with a generated value in eBay's portal and in Vercel, and the literal
in code should stop being a usable fallback. Filed as **CH-1** in §6. No value,
fragment, or hash is recorded anywhere in this file.

---

## 1. Withdrawing the 18/19 bar

The reviewer's ruling: *do not silently replace the standing 19/19 gate with
18/19; judge individual checks, not the total.* Accepted, and the correction is
larger than the wording.

**Where 18/19 came from.** It has no run behind it. Traced through the corpus:
`audit/CARDRESELL_PLAN_AND_ROADMAP.md:657` — "reportedly at 18/19; **this was not
re-run**" — and `audit/DECISION_94dc777.md:88-104`, which set 18/19 as the
rotation bar while itself noting the figure is unverified. **No file in the repo
records which check failed.** I then carried the figure into
`ROTATION_GATE_ANSWERED.md:147` as a bar, which converted an unverified report
into an acceptance criterion. That was the error, and it is the same failure mode
as the `HTTP 000` blocker: a reported number, never re-tested, hardening into a
rule because it was written down.

**The denominator is not even fixed at 19.** Counting emitted `check()` calls on
the all-passing path with `CARD_CATEGORIES` = 3 (`CCG`, `SPORTS`, `NON_SPORT`,
`api/_ebayTaxonomy.js`): 19 exactly. But **at least four of those exist only in
one branch** — `category tree version still 134` (`:145`, skipped with a `warn`
if the version moved), `Marketplace Insights scope still denied` (`:208`, skipped
if the scope is granted), `Browse still rejects a soldItems filter` (`:220`,
skipped if it doesn't), and the taxonomy and browse blocks swap in different
checks on throw (`:148`, `:167`, `:185`). The harness prints `X passed, Y failed,
Z warnings` — it never prints a fraction. **So "18/19" is not even the harness's
output format**, and a clean run with a moved category tree version would print
18 passed / 0 failed. "18 of 19" cannot distinguish that from one real failure.

**Consequences, adopted:**

1. **The gate is 19/19**, unchanged, as
   `audit/CARDRESELL_PLAN_AND_ROADMAP.md:511` and
   `audit/RELEASE_VALIDATION_QUEUE.md:71` have said all along.
2. **No exception is proposed.** The one check known to fail has an in-scope
   remedy.
3. **Record checks, not a score.** Any run records: every failed assertion by
   name with its hint, every warning (they mask checks), the target deployment
   id and commit, the timestamp, and the printed `passed/failed/warnings` triple
   verbatim.
4. **A result below 19/19 concludes nothing by itself.** Each failure gets
   classified — authentication, configuration, connectivity, or pre-existing
   behaviour — before anyone says whether the rotation worked. **18/19 is
   likewise not a pass**: it could hide a different failing check while this one
   was fixed.
5. **The other 18 checks have never been run here** and remain unverified. They
   need `EBAY_APP_ID` and `EBAY_CERT_ID`, which are Production-only in Vercel and
   absent from this sandbox. The rotation run establishes their baseline as much
   as it confirms the credential — the difference is that this is now stated
   rather than used as an escape hatch.

---

## 2. §7 corrections, from the reviewer's rulings

| Ruling | What I had written | Corrected |
| --- | --- | --- |
| **Q-ROT-1** — evidence is current project configuration; env changes apply to **new** deployments only | Presented the target lists as though they described what is running | The targets describe **stored configuration as of 2026-09-08**. They do **not** establish what credentials existing deployments captured at build time, and the live deployment keeps its captured values until it is replaced. This is why §4 has a redeployment step and did not before. |
| **Q-ROT-2** — leave unanswered and nonblocking; no broader token scope needed | Asked whether it was worth your looking | Closed as **recorded-unanswered**. Not to be revisited absent a specific dependency. No scope escalation requested. |
| **Q-ROT-3** — SSO restricts access, it does not isolate data; "self-inflicted only" too strong; separating stores does not invalidate the completed tests | "capped at accidental self-inflicted damage rather than an outside path in", and separating stores "would invalidate testing the draft work has already done" | **Both wrong, and wrong in the same direction — toward comfort.** SSO gates *who can request a URL*; it constrains nothing about what deployed code writes once running. Any preview build with a bad key prefix or a migration writes to the production store whether or not a human ever opens it, and scheduled or webhook-triggered paths need no browser at all. And the functional tests assert behaviour against a KV interface, not against a particular store — a new store requires **re-checking the configuration**, not re-earning the test results. I overstated the mitigation and invented a cost for the fix. |
| **Q-ROT-4** — judge individual checks | Framed it as a choice between two readings of one number | The framing was the error: I offered you a rule for interpreting a total when the total is not the unit of judgement. §1. |

---

## 3. Preview containment — the choice

The reviewer required this resolved **before** a push that automatically creates
a Preview, and named two routes. Both are needed; the question is order.

**Chosen: disable automatic Preview deployment first, then build the separate
non-production store, then re-enable.**

- **Why this order.** The thing being unblocked is *pushing*. A push creates a
  Preview, and that Preview is the exposure. Disabling automatic Preview
  deployment is **one project setting**, reversible, and removes the trigger
  outright — it does not depend on provisioning, on the marketplace integration,
  or on getting five variable values right. A separate store is the durable
  answer but is a multi-step infrastructure change, and gating ~220 commits
  behind it means the gate outlives the reason for it.
- **Why not the store first.** No objection to it as the destination — the
  reviewer's recommendation is right and it is step 2 here, not a rejected
  option. It is simply the larger action, and the smaller one fully covers the
  interval.
- **The cost, stated plainly.** Disabling Previews removes the only
  pre-production verification surface. Anything that would have been checked on a
  preview URL must wait for the separate store or be checked against production,
  which is the thing we are protecting. **This is a real loss, not a free
  win** — it is acceptable only because it is temporary and because nothing in
  the current queue depends on a preview deployment.
- **One caveat on the evidence.** `link.deploymentEnabled` came back **unset**,
  and I read that as "default enabled". That is an inference from Vercel's
  default, **not an observation**. The dashboard toggle is the authoritative
  surface and should be read there before and after the change.

**Neither step is authorized here.** Each needs its own concrete authorized
action. Recorded as **RV-8** (revised, §6).

**One scoping point that follows from §4:** the rotation sitting itself does
**not** create a Preview. Redeploying `9aaf326e7` is not a push. So the
containment decision gates **the push**, and the rotation and redeployment can
precede it — provided nothing is pushed. They are separate authorizations in
separate sittings.

---

## 4. The bounded rotation and redeployment plan

Scope: **restore a known-good credential state on the currently live commit.**
Not a release. No outgoing Phase 1 work ships. Each numbered item is a distinct
owner action; none is authorized by this document.

**Standing constraints:** never the unblock URL, at any point. Never a credential
value, fragment, or hash in code, fixtures, logs, commit messages, or any audit
file. Paste values into the dashboard only — **and paste without a trailing
newline**, which is the exact defect §0 measured.

| # | Action | Surface | Why, and what it does not do |
| --- | --- | --- | --- |
| 1 | Generate a replacement eBay **Cert ID** | eBay developer portal | No API path from here and none should exist. |
| 2 | Update `EBAY_CERT_ID`, **Production only** | Vercel → Settings → Environment Variables | Answer 1: Preview holds no eBay credential. Do **not** add it to Preview. |
| 3 | **Strip the trailing newline from `EBAY_VERIFICATION_TOKEN`**, Production | same | §0 Remedy A. Fixes check 19 at `9aaf326` with no code change. **Skipping this leaves 19/19 unreachable in this sitting.** |
| 4 | Confirm the old Cert ID is retired, and check what happens to **already-issued tokens** | eBay portal | Secret rotation does not necessarily invalidate live tokens; assuming it does is how a rotation looks complete while the old credential still works. |
| 5 | **Redeploy the currently live commit `9aaf326e7`** to Production, with **no** outgoing work included | Vercel → Deployments → the `dpl_AuwggY9Y…` production deployment → Redeploy | **The reviewer's point, and the gap in my previous packet.** Environment changes apply to new deployments; the running deployment captured the old values at build time. Without this, the stored replacement and the running application differ — steps 2 and 3 would be invisible. Verify the redeployment reports commit `9aaf326e7`, **not** a branch head. |
| 6 | `EBAY_LIVE=1 node tests/ebay-live.mjs` | owner shell | **Bar: 19/19.** Record per §1.4 — failed assertion names, all warnings, target deployment id, commit, timestamp, and the verbatim `passed/failed/warnings` line. Not a score. |
| 7 | Delete `refs/recovery/pre-scrub-c2366b2` | git | Only after 6 is recorded. |
| 8 | Record status, checker, and time | audit file | Values never. |

**What clears when this completes.** The **push** gate — and only once the §3
containment decision is also taken, since a push creates a Preview. **Deployment
of Phase 1 remains a separate authorization**, and Phase 2 entry still needs
official user OAuth, resolved descriptor value IDs, and the token
storage/deletion contract review
(`audit/CARDRESELL_PLAN_AND_ROADMAP.md:511`).

**If step 6 does not reach 19/19:** classify each failure per §1.4 before
concluding anything, and do not proceed to step 7. A failure in
`client_credentials returns a token` or `Cert ID present and 36 chars` points at
steps 1–2; `deployed challenge hash` at step 3 or a redeployment that did not
take; connectivity failures at neither.

---

## 5. Questions

- **Q-ROT-5.** §0 Remedy A means check 19 is fixable in the sitting, so I have
  withdrawn the exception request entirely rather than narrowing it. Confirm you
  want it withdrawn — the alternative reading is that you wanted a properly
  evidenced exception, and I am arguing none is needed.
- **Q-ROT-6.** CH-1 (§0.1): the production verification token is the repo's
  committed default. Replace it in the same sitting as step 3 — one dashboard
  visit, and the newline strip is touching that variable anyway — or keep the
  sitting minimal and handle it separately? Combining means step 6's check 19
  then tests a *new* value, which is cleaner but changes two things at once.
- **Q-ROT-7.** §3 order: Previews off first, separate store second. If you would
  rather hold the push until the store exists, say so — that is your Q-ROT-3
  recommendation taken literally and I have no argument against it beyond the
  gate outliving its reason.

---

## 6. Queue changes

**RV-8 revised** in `audit/RELEASE_VALIDATION_QUEUE.md`: the SSO mitigation
overstatement is struck; the invented cost of separating stores is struck; the
item is now a **decision required before the first push**, with the two-step
order from §3.

**CH-1 added:** production `EBAY_VERIFICATION_TOKEN` equals the repo's committed
default literal, plus a trailing newline. Two defects, one variable — a published
value in production, and a stray character that breaks eBay's endpoint
validation against a clean portal value.

**RV-9 added:** the eighteen other live-harness checks have never been run in
this workspace and are unverified.

---

## 7. Unchanged

D5, D6, D7 closed within scope. Still open and untouched by any commit today:
target-net wiring (`listPriceForTargetNet` never wired), shipping breakdown,
description text, condition-guidance text, both withdrawn Phase 1 percentages,
same-card basis retention, production reachability beyond the single endpoint
probed in §0, PriceCharting Q1–Q6 (the permission section still needs bringing
forward — the reviewer cannot see the questions from here), the $1000/mo
tripwire, `feeBase`/`feeBaseLabel` on 2 of 15 venues, TCG Bulk fee base,
TCGplayer debit processing, 4 undeclared CSS tokens, citation map 109 unresolved,
release registry 49, RV-1…RV-7, 4 duplicate `codes` helpers, T2.1–T2.8, SI-1,
A-2, net is item-price-only, two reachability sweeps unrun, no Safari or iOS in
CI, no per-suite assertion-count floor.

**Status: nineteenth check identified and measured; 19/19 gate restored intact;
containment chosen pending your ruling. Nothing pushed, nothing deployed, no
credential written, Cert ID not rotated.**
