# TPL Rotation — Live Execution Runbook

**Status: steps A and B are yours to perform. Step C is a hard stop for your
authorization. Nothing is deployed, rotated or revoked as of this document.**

This is the executable form of the eleven-step procedure. It is self-contained:
everything needed to run steps A and B is here.

---

## 0. Pre-flight state, read from the provider dashboard and the Vercel API

All of this is metadata. **No credential value was read, printed, or stored by
me at any point**, and none will be.

| Fact | Value | Source |
| --- | --- | --- |
| Provider plan | **Pro — 10,000/day**, 0 used at reading | TPL dashboard |
| Active keys | **1 of 5 permitted** | TPL dashboard |
| The live key | **Key #518**, created Jun 28 2026, `Last used: Sep 9 06:23 AM` | TPL dashboard |
| Already revoked | Key #517, "Website Key" | TPL dashboard |
| Vercel variable | `CARDSELL_TPL_KEY`, id `GyudMHKTCEfdLo3T` | Vercel API, `decrypt=false` |
| Its storage type | **`plain`** — this is CH-3 | same |
| Its targets | **`production`, `preview`, `development`** | same |
| Created / updated | 2026-06-29 12:34 UTC / **never updated** | same |

**Two findings that change the instructions below.**

### Finding 1 — "encrypted" would not have prevented this exposure class

Vercel's `encrypted` type can be **read back in plaintext** by any holder of a
project token, via the API's `decrypt=true`. I know this in the most direct way
available: earlier in this work an env value was retrieved that way and is
still sitting in a scratch file on this machine (`/tmp/vpd.json` — which is
also why I will not print it).

So re-adding as `encrypted` would fix the *storage* type while leaving the
*read-back* path open. The `sensitive` type is **write-only**: it cannot be
retrieved after being set, by dashboard or API.

**There is already precedent for this in your own project.**
`TURNSTILE_SECRET_KEY` is stored as **`sensitive`**, and it targets
**`production` and `preview` only** — not `development`. That is the correct
handling of a secret in this project, applied to one variable and not to this
one.

### Finding 2 — the `development` target is the mechanism of the local copy

`CARDSELL_TPL_KEY` targets `development`, which is the surface `vercel env pull`
reads. That is a coherent explanation for how a production key came to sit in a
local `.env.production` file, and it is the same "local callers" spender that
forced me to withdraw the exhaustion guarantee — they bypass R4 entirely.

Dropping the `development` target closes both at once. **The cost is real and
you should decide it, not me:** local development would no longer receive a TPL
key from `env pull`. The mitigations are that the built R2/R3 tests already run
against a mocked upstream, and that four unused key slots remain if you ever
want a separate, independently revocable development key.

---

## Step A — Create the replacement key (provider dashboard)

**The old key stays active for this entire step and the next.** Five slots are
permitted and one is in use, so creating a second changes nothing about
production. Nothing you do in step A or B can take the site down.

1. Open the TCGPriceLookup dashboard → **API Keys** → **Create API Key**.
2. Give it a name you will recognise later. A name is optional in that form,
   but an unnamed key is hard to audit — suggest `cardresell-prod-2026-09`.
3. **Copy the value once, into Vercel in step B. Do not paste it into this
   conversation, a file, a note, or a terminal.** I do not need it and will not
   ask for it. If you lose it before step B, revoke it and create another — a
   spare unused key costs nothing.
4. **Record, and tell me, only these two things:**
   - the new key's **Key #** (e.g. "Key #519")
   - its **`Last used`** state right now — for a brand-new key this should be
     empty, a dash, or its creation time

Item 4 is the verification baseline. It is the whole reason this rotation can
be confirmed rather than assumed, so it has to be captured **before** any
request is made. **Do not skip it.**

**Do not revoke Key #518.** Not in this step, not until step 11.

---

## Step B — Replace the variable in Vercel (you type the value, I never see it)

Vercel cannot convert a variable's type in place, so this is a delete and a
re-add. **Deleting it does not affect the running site**: a live deployment
carries its own env snapshot from deploy time, which is precisely why a
redeploy is needed for any of this to take effect. The window between delete
and add is not an outage window.

1. Vercel → project **cardresell** → **Settings** → **Environment Variables**.
2. Find **`CARDSELL_TPL_KEY`** and **delete** it. (Its id is
   `GyudMHKTCEfdLo3T` if you want to confirm you have the right row.)
3. **Add a new variable**, exactly:

| Field | Value |
| --- | --- |
| Name | `CARDSELL_TPL_KEY` — exact, case-sensitive |
| Value | the step-A key. **Paste it here and nowhere else.** |
| Type | **Sensitive** (recommended — see Finding 1). `Encrypted` is acceptable but leaves the read-back path open |
| Environments | **Production and Preview.** See Finding 2 before deciding on Development |

4. Save. Then tell me it is done.

I will then verify by API, reading **metadata only** — that the name exists,
its type is `sensitive` or `encrypted` rather than `plain`, and its targets are
what you intended. A `sensitive` variable cannot be read back even by me, which
is the point of choosing it.

---

## Step B — COMPLETE, verified by API at 2026-09-09 15:24 UTC

Performed by the owner. **I did not see, request, or store the value.**
Verified read-only with `decrypt=false`:

| Check | Result |
| --- | --- |
| Rows named `CARDSELL_TPL_KEY` | **Exactly 1** — no duplicate, no leftover |
| Old row `GyudMHKTCEfdLo3T` | **Gone** |
| New row id | **`aVniyIhp7PBaZpHq`** — a different id, so this was a genuine delete-and-add, not an in-place edit |
| Type | **`sensitive`** — Q-CH3-9 taken as recommended |
| Targets | **`production`, `preview`** — `development` dropped, Q-CH3-10 taken as recommended |
| Created / updated | 15:22 / 15:24 UTC |
| Secrets still stored `plain` | **None.** The only `plain` vars left are `BLOB_STORE_ID` and `BLOB_WEBHOOK_PUBLIC_KEY` — an identifier and a public key |
| `development`-targeted vars | 12 → **11** |

**The read-back path is closed, and here is the evidence rather than the
claim.** On the same endpoint and the same request:

| Variable | Type | `value` returned |
| --- | --- | --- |
| `CARDSELL_TPL_KEY` | `sensitive` | **empty string, length 0** |
| `TURNSTILE_SECRET_KEY` | `sensitive` | **empty string, length 0** |
| `EBAY_CERT_ID` | `encrypted` | a **1,080-character** blob |

I probed those values with booleans and a length only — never printing or
storing content. **Bound on this claim:** it establishes that this endpoint
returns nothing for a `sensitive` variable, alongside Vercel's own dialog copy
("You can't reveal this value after saving"). I did **not** attempt
`decrypt=true` against it, because attempting to read the credential is both
forbidden here and beside the point.

**Consequence worth recording for the already-planned eBay rotation (G2/G3):**
`EBAY_CERT_ID` and `EBAY_VERIFICATION_TOKEN` are `encrypted`, i.e.
readable-after-saving. When those are rotated for their existing reason, they
should be re-added as **Secret** for the same reason this one was. That is a
change of *form* to work already scheduled, not new scope.

**CH-3 is not closed by this.** The exposed value is still live at the
provider. Storage is fixed; the credential is not yet replaced in service.

---

## Scratch-file cleanup, and a correction to my own claim

`/tmp/vpd.json` is deleted (`shred -u`), on the reasoning given: the evidence
was **superseded**, not inconvenient. The `sensitive` length-0 versus
`encrypted` 1,080-character comparison proves the same point with no
credential in it.

**The sweep then falsified something I wrote, and the correction matters more
than the cleanup.** I had described my first Vercel read as "metadata only, no
value retrieved". That was wrong as stated. With `decrypt=false`, a
**`plain`-typed variable returns its value anyway** — the `decrypt` flag governs
`encrypted` vars. So `/tmp/envmeta.json` held the live TPL key in plaintext
from the moment I ran that read. It was never printed, quoted, or transmitted,
and every probe I ran emitted only booleans, names and lengths — but it was on
disk, and my sentence claimed otherwise.

Both files are now shredded, along with `/tmp/envmeta2.json`. Nothing remains
under `/tmp`.

This is also a **third independent demonstration** of why `plain` was the
finding: the value was retrievable by a token holder without even asking to
decrypt anything. Post-change, the same read returns length 0.

## A tracked file carries a key prefix (Q-CH3-13, new, low severity)

A pattern sweep of the whole working tree — not just `.env*` files, which is the
gap in my earlier methodology — found `tcg_`-shaped text in
`qa/QA_PASS_2026-08-15.md:19`, which **is tracked** and **is present in
`origin/main` at `9aaf326`**.

Measured before concluding anything: the token is **10 characters** (`tcg_` +
6 hex) followed by a **literal `...`**. It is a deliberately truncated
**prefix**, not the credential. Its context is a QA note recording the original
exposure — that the key was hard-coded into `index.html` and served to every
anonymous visitor — which is CH-3's origin, already established.

What this does and does not change:

- It does **not** weaken the earlier finding that no `.env*` file was ever
  committed. That sweep's conclusion stands; its **scope** was narrower than I
  implied, and this is the correction.
- It is **not** a credential disclosure. Six hex characters of prefix do not
  authenticate.
- After step 11 the prefix refers to a **revoked** key and is inert.

**Q-CH3-13:** leave it, or mask it in a later commit? My recommendation is
**leave it.** It is already in `origin/main`, so masking removes it from the
tip but not from history, and rewriting history to redact six characters of a
key that is about to be revoked is disproportionate and cuts against preserving
completed work. Worth your explicit call rather than my silent one.

## Incident: a full key value was pasted into the session transcript

**2026-09-09, during step A reporting.** Asked for the Key # and baseline
readings, the owner pasted a **complete `tcg_`-form key value** into the
conversation. The value is **not recorded here, not in any commit, and not
written to disk by me**; it was never used in a request. It is deliberately
not quoted even in part.

**It must be treated as exposed.** Conversation transcripts are retained, so
the value has left the owner's control regardless of intent. That is the whole
class of failure CH-3 exists to close, and it recurred in the middle of closing
it.

**RETRACTED. The owner's identification was mistaken, and the dashboard
disproves it.** I recorded "the value was old Key #518" on the owner's word and
committed it. A screenshot of the key list then showed that is **false**. The
prior record is struck rather than quietly amended.

**Evidence, from the dashboard's own masked forms — no value reprinted:**

| Key | Masked form shown | Matches the pasted value? |
| --- | --- | --- |
| `cardresell production replacement` | prefix `tcg_1ff755`, suffix `8bae24` | **Yes** — both ends match |
| `Key #518` | prefix `tcg_37ca6c`, suffix `d78e12` | **No** — neither end matches |

**So the exposed value is the replacement**, the key now stored in Vercel as
`sensitive`. This is the branch the table called the actionable one, and it
inverts the response:

- The replacement is **compromised on arrival** and must be **discarded, not
  deployed**.
- Nothing in service uses it — the live deployment still carries the old env
  snapshot — so it can be revoked with **zero production impact**.
- **#518 stays active.** It remains the key serving production and is still not
  revoked until a replacement verifies.
- I recommended a **third** key, another delete-and-add, then revoking the
  exposed replacement.

**OWNER DECISION, 2026-09-09: keep `cardresell production replacement`.** No
third key. Recorded as the owner's call, not as my recommendation, and taken
as final.

**The risk that decision accepts, stated plainly and not re-argued.** The
value sits in a retained conversation transcript and in an uploaded screenshot.
It was **not** published, not committed, and not served to visitors. The blast
radius is **provider quota only** — 10,000/day on Pro — not customer data, not
payments, not the site. Access to the transcript already implies account access,
and per Q-CH3-15 account access retrieves every key value anyway via the
dashboard's `Copy` button, revoked keys included. So the marginal exposure is
small, and the judgement is defensible.

**What this changes in the record, and it is only wording.** The rotation still
removes two real exposures: a key hard-coded into `index.html` and served to
**every anonymous visitor**, and a key stored `plain` and retrievable by any
project-token holder. Both are large reductions. What it does **not** produce is
an unexposed credential.

So **CH-3's closure must be worded as "the public and plain-storage exposures
are closed"** — never as "the TPL credential is unexposed." The second sentence
would be false, and stamping it is the one thing this decision does not license.

**The step-A baseline stands as recorded:** name `cardresell production
replacement`, created Sep 9 2026 11:10 AM, **`Last used: Never`**, counter
**0 / 10,000**. `Never` remains the ideal baseline, so verification is unchanged
and Q-CH3-12 stays dissolved.

**Why the branch was written before the answer was known.** Had the response
been decided after the identification, an incorrect identification would have
produced a wrong action — deploying an exposed key while believing it safe. The
pre-committed branch is what turned a mistaken answer into a corrected step
instead of a bad deployment.

The original branching analysis is retained below, because the reasoning is
what made the resolution safe rather than lucky — the response was determined
before the answer was known.

**Which key it belongs to was unestablished and decided the response.** Do not
revoke anything until it is identified, because the two cases invert:

| If the value is | Then | Response |
| --- | --- | --- |
| the **replacement** created minutes ago | nothing in service uses it — production still runs the old deployment's env snapshot | **Safe to revoke immediately, zero impact.** Create a third key, re-add in Vercel, revoke the exposed replacement. Slots allow it: 5 permitted |
| the **old Key #518** | it is the already-exposed key, still serving production | **Change nothing.** The disclosure adds no new exposure and #518 is revoked at step 11 as planned |

**Identifying it without revealing more:** the dashboard shows a masked prefix
per key row. Compare only the leading characters against each row. No further
disclosure is needed to tell the two apart.

**This does not jeopardise production either way.** The live deployment carries
its env snapshot from deploy time, so the replacement is not yet in service.
The exposure's blast radius is provider quota, not the site.

**Q-CH3-14:** the step-A instruction said "copy the value once, into Vercel
only." It was followed for Vercel and then the value was also pasted here. The
instruction named the destination but did not say plainly **"never paste it into
this conversation, including to me."** That wording is now added to step A.

## Step C — HARD STOP

**I stop here and wait for you.**

The next action is the redeploy, and it is the first irreversible-ish step: it
changes what production runs. Per your standing instruction it needs your
explicit authorization, separately from this document.

For clarity about what that authorization would cover when you give it:

- Redeploy **from** `dpl_AuwggY9YcPftJcqSnsztAw4qPfmT` (commit `9aaf326`)
- The rebuild produces a **new deployment with its own ID and URL** — that new
  one is what gets verified, not the source
- **Not** a branch deploy, **not** a push, **not** `--prod` from this working
  tree. This tree is ~237 commits ahead of production and none of it is in
  scope
- Then: confirm commit → uncached lookup on the new deployment → invocation log
  → the new key's `Last used` advances → alias check → **only then** revoke

**Not authorized by anything here:** the redeploy, any push, R4 activation, and
any revocation.

### Do not use the toast's Redeploy button

Vercel's success toast offers **Redeploy**, and it is the wrong instrument. It
gives no control over *which* deployment is rebuilt and no opportunity to
capture the returned deployment id before the fact. The procedure needs a
named source (`dpl_AuwggY9YcPftJcqSnsztAw4qPfmT`, commit `9aaf326`) and the new
deployment's own id and URL recorded as they come back. **Dismiss the toast.**

### The baseline needs two fields, and the timestamp is the weaker one

`Last used` renders as `Sep 9, 2026, 06:23 AM` for Key #518, which **looks**
minute-resolution. What the field *stores* versus what the dashboard *renders*
is **Unverified**, and I cannot establish it from a rendered string. So it is
not relied upon alone.

**Capture the usage counter in the same baseline.** A counter moving **0 -> 1**
is cleaner than a timestamp advancing and carries no granularity question.

**The two provider-side signals are not symmetric, and both earlier rulings
survive.** The account-wide total was demoted because it read **0** while an
active key reported same-day use — so a **flat** total cannot fail a rotation.
That ruling is about absence. A total **moving** is positive evidence. Absence
of movement stays non-decisive; presence of movement counts.

**The granularity question may resolve itself.** If the new key's baseline
`Last used` is **empty or a dash**, then any non-empty value afterwards is
unambiguous at any granularity, and the concern disappears. It only bites if the
new key already displays a timestamp — in which case the counter carries the
verification and the timestamp is corroboration.

Restated pass criterion: uncached `200` **and** an invocation logged on that
deployment **and at least one affirmative provider-side signal** — counter
increment or timestamp advance — with both captured. Neither present: stop and
diagnose, on containment, old key still active.

### Before you authorize: the failure mode is an outage, not a revert

Key #518 is still live at the provider, but its **value is gone from Vercel and
was never recorded anywhere** — which is the intended property of `sensitive`
storage, working as designed.

So if the step-B paste was mistyped or truncated, **#518 cannot be restored.**
There is nothing to revert to. Recovery is: create another key, re-add, redeploy
again — with production TPL lookups failing in the interval.

Three things bound that:

- The interval is minutes, and the fix is the same procedure you just ran.
- It is detected immediately by the step-6 request, before anything depends on it.
- It costs no credential safety. A mistyped value authenticates as nothing.

**A safer sequencing was considered and is not available.** The variable now
targets preview as well, so a preview deployment would carry the new key and
could be verified without touching production. Building one requires pushing a
branch, and pushing is out of scope here. Recording it as considered and
declined for that reason, rather than leaving it unexamined.

This is stated **before** authorization, not after: authorize knowing the
downside is outage-until-repeat.

## Dashboard readings, 2026-09-09 (baseline for a key being discarded)

Recorded because two of these facts change the procedure, not merely to log it.

| Field | Reading |
| --- | --- |
| Daily Usage | **0 / 10,000**, 0% — "across all active API keys" |
| API Keys | **2 total** active (4 rows; 2 revoked) |
| Replacement | name `cardresell production replacement`, **Active**, created **Sep 9, 2026 11:10 AM**, **`Last used: Never`** |
| Key #518 | **Active**, created Jun 28 2026 08:19 PM, `Last used: Sep 9, 2026, 06:23 AM` |
| #517, `Website Key` | **Revoked** |

**`Last used: Never` is the ideal baseline, and Q-CH3-12's granularity question
dissolves.** From `Never`, any later value can only have come from the
verification request, at any storage resolution. The concern about rendered
versus stored precision does not arise. This carries to the third key, which
should also read `Never` at creation.

**Correction to my own instruction: there is no Key #.** I asked for "a
three-digit number above 518", but a key created with a name shows that **name**
in place of a number — the numbering is a fallback for unnamed keys. The
identifier to record is the **name plus creation timestamp**. My expectation was
wrong and sent the owner looking for a field that does not exist, which is part
of how the wrong row got identified.

**New finding — the provider allows unlimited read-back (Q-CH3-15).** Every key
row carries a **`Copy` button, including the revoked ones**. So a TPL key value
is retrievable from the dashboard at any time by anyone with account access.

Two consequences worth stating plainly:

- The "copy the value once" discipline **cannot** rest on the provider being
  write-only. It is a handling rule, not a property of the system.
- The exposure surface for TPL credentials **includes provider account access**,
  permanently, for revoked keys as well as active ones. Vercel's `sensitive`
  storage closes read-back on our side only.

This does not change the current steps. It is recorded because it is the kind
of assumption that would otherwise be discovered later and treated as new.

### Still outstanding before verification can run

1. **The Key # and `Last used` baseline** from step A item 4. Not yet supplied.
   Without a recorded pre-request baseline the decisive signal has nothing to
   compare against, and the rotation becomes unverifiable in exactly the way
   this whole procedure exists to prevent. **This must be captured before any
   lookup is made.**
2. **Your authorization for the redeploy.**

---

## Questions for you — in the file, as you asked

**Q-CH3-9 — ANSWERED: Sensitive.** Taken as recommended and verified in place
(type `sensitive`, value returns empty). Original question retained below for
the record.

**Q-CH3-10 — ANSWERED: development target dropped.** Taken as recommended and
verified (targets are production and preview only). The `env pull` path that
put a production key into a local file is closed at the source.

**Q-CH3-12 — NEW, and the only thing blocking verification besides your
deployment authorization.** I still need the replacement key's **Key #** and
its **`Last used`** state **and the usage counter** (`N of 10,000 used`) as
they read **now, before any lookup**. A baseline
captured after the fact cannot distinguish "the new key authenticated" from
"the field already had a timestamp", which would leave me asserting a verified
rotation on no evidence — the exact failure this procedure was rewritten twice
to remove.

---

**Q-CH3-9 (original) — `Sensitive` or `Encrypted` for the replacement?**
My recommendation is **Sensitive**, because `encrypted` demonstrably does not
prevent the read-back that produced the plaintext copy still on this machine,
and because your own `TURNSTILE_SECRET_KEY` already sets that precedent. The
tradeoff is that neither you nor I can ever read the value back; recovery means
generating a new key, which costs one of five slots and no money. **Answer
needed before step B.**

**Q-CH3-10 — Keep the `development` target?**
My recommendation is **drop it**, matching `TURNSTILE_SECRET_KEY`. It closes
the `env pull` path that put a production key in a local file and removes a
class of spender that bypasses R4 entirely. The cost is that local TPL work
then needs either the mocked upstream the R2/R3 tests already use, or its own
separate key in one of the four free slots. **Answer needed before step B.**

**Q-CH3-11 — The scratch file.** `/tmp/vpd.json` on this sandbox holds a
plaintext env value from earlier work. It dies with the sandbox and I have
never reprinted it. Say the word and I will delete it now; I have left it in
place only because deleting evidence unasked is not my call.

---

## What I will not do, restated because this step is where it matters

- I will not ask for, accept, read, print, or store the key value.
- I will not deploy, push, or revoke anything without separate explicit
  authorization for that specific action.
- I will not tell you the rotation is verified on anything less than the three
  signals together: uncached `200`, matching invocation evidence, and that
  specific key's `Last used` advancing.
- If verification fails, **Key #518 stays active** while we diagnose. That is
  containment, not a rollback — there is nothing to restore, and the old key is
  never the thing we return to, because it is the exposed value.

## Live execution — 2026-09-09, authorized by Will

**Steps 1\u20136 and 10 done. Step 7 unobtainable by me. Step 8 needs Will. Step 11
NOT DONE \u2014 key #518 remains active.**

| # | Step | Result |
| --- | --- | --- |
| 1 | Replacement key exists | Yes, `cardresell production replacement` |
| 2 | Baseline recorded | `Last used: Never`, counter `0 / 10,000` |
| 3 | Vercel row replaced | Row `aVniyIhp7PBaZpHq`, type `sensitive`, prod+preview |
| 4 | Rebuild from `dpl_AuwggY9YcPftJcqSnsztAw4qPfmT` | Done via REST API, **not** the toast button |
| 5 | **Rebuild's own new id** | **`dpl_BJuH3okrHAsHpM7vUhCZv85or225`**, url `cardresell-bx1egjeuk-willsep200-9430s-projects.vercel.app`, `READY`, commit **`9aaf326`** \u2014 the exact live commit |
| 6 | Uncached lookup | **`200`**, `x-vercel-cache: MISS`, `age: 0`, **33,299 bytes**, payload `data,total,limit,offset` with `data len 20` |
| 7 | Vercel invocation log | **Unobtainable.** See below. |
| 8 | Key's `Last used` advanced | **Needs Will's dashboard reading.** |
| 9 | Account total | Corroboration only, not consulted |
| 10 | `www.cardresell.org` serves the rebuild | `200`, renders, bundle `js/core.569ff536.js`; new deployment `aliasAssigned: true` and is the newest READY production deployment |
| 11 | Revoke #518 | **NOT DONE.** Gated on step 8. |

### Step 7 \u2014 why it is unobtainable, stated plainly

`/v3/events?types=lambda` returns **0 events**;
`/v1/deployments/{id}/runtime-logs` returns **`not_found`**;
`/v2/deployments/{id}/events` returns **build events only**. Vercel has moved
runtime function logs off the REST surface I hold. **I cannot produce the
matching invocation evidence.** Will can read it in the dashboard under the new
deployment \u2192 Logs, filtered to `/api/tpl-proxy`.

### The discriminator, and why step 8 is decisive rather than ceremonial

A `200` alone does **not** prove the new key was used, because **key #518 is
still active at the provider** and the **old** deployment's env snapshot still
carries its value. So a successful lookup is consistent with either deployment
serving it. What separates them:

- Vercel bakes env into a deployment at build time. The rebuild
  (`dpl_BJuH3okr\u2026`) was built **after** the row was swapped, so it carries the
  **replacement** value and nothing else.
- Therefore **served by the rebuild \u21d2 the replacement key was used.**

The alias evidence says the rebuild is what `www` routes to, which makes that the
strong reading \u2014 but it is inference from routing metadata, not observation of
the key. **The replacement key's own `Last used` moving off `Never` observes it
directly, at the provider, with no inference.** That is why the standard requires
the readings together, and why I am not treating the `200` as sufficient.

### Two lookups should have registered, not one

The live page auto-ran a Charizard search on load **before** my explicit request,
and the graded path fires two calls where it runs. So the counter is expected to
read **at least 1, plausibly several** \u2014 a reading of exactly `0` would mean the
rebuild is **not** serving `www`, and would be a stop condition.

### Rollback position \u2014 improved, and worth recording

The no-rollback warning I gave applied to the **key**, and still does: #518's
value is gone from Vercel and unrecorded. But the **site** now has a rollback
that costs nothing: `dpl_AuwggY9YcPftJcqSnsztAw4qPfmT` is still `READY` with its
own working env snapshot, so promoting it restores the previous state exactly.
**Site rollback: available. Key rollback: still none.**

### Incident note \u2014 a 403 I reported was mine, not production's

Mid-verification `www.cardresell.org` returned `403` and then `http=000` from the
sandbox, on apex, `www` and `/index.html` alike. **This was not an outage.** The
`403` carried **no `x-vercel-id`**, so it never reached Vercel \u2014 it came from the
sandbox's own egress, which was also failing to `api.vercel.com`\u2011adjacent hosts
while the Vercel API itself kept answering. An independent cloud browser loaded
the site at `200`, fully rendered, on the `9aaf326` bundle. **Lesson for this
runbook: an egress failure in the harness must not be read as a production
outage, and the absence of `x-vercel-id` is the tell.**

## Corrections — three, all conceded

### 1. A zero counter is NOT a stop condition. Withdrawn.

I wrote that a counter reading of exactly `0` "would mean the rebuild is not
serving `www`, and would be a stop condition." **That contradicts a finding
already on this record.** The account counter was established as unreliable for
this check, and the standing instruction is to keep the total **as corroboration,
not the decisive stop condition**. I re-promoted it to decisive in the same
document that records it as corroboration — a Rule 1 style contradiction in the
audit trail itself. **Withdrawn: no counter reading, zero or otherwise, proves or
disproves routing.** The `Last used` field, not the counter, is the provider-side
observation that carries weight.

### 2. The invocation log stays required. It does not become optional.

I recorded step 7 as "unobtainable by me" and then set out a completion path that
did not contain it. **That is the failure mode the standard exists to prevent:** a
required item quietly demoted to optional because the tool I reached for could not
produce it. The standard is the uncached lookup, the matching invocation evidence,
and the replacement key's updated `Last used` **together**. **Unobtainable via the
REST API ≠ not required.** It moves to the dashboard, and revocation waits for it.

### 3. The site rollback expires at revocation. My note was wrong.

I wrote that the old deployment gives the site a rollback that "costs nothing."
**True only while #518 is active.** `dpl_AuwggY9YcPftJcqSnsztAw4qPfmT` carries
#518's value in its build-time env snapshot, so once #518 is revoked, promoting
it yields a `READY` deployment whose TPL lookups **fail** — the worst kind of
rollback, one that looks available and is not. **Corrected: the site rollback is
real now and gone the moment #518 is revoked.** After revocation the only
recovery for a bad key is another key plus another rebuild.

## Step 7 — the dashboard path, and the exact window to match

**Deployment:** `dpl_BJuH3okrHAsHpM7vUhCZv85or225`
**Its URL:** `cardresell-bx1egjeuk-willsep200-9430s-projects.vercel.app`

1. Vercel → project **cardresell** → **Deployments**
2. Open the deployment whose URL contains **`bx1egjeuk`** — match on that, not on
   "most recent", since both deployments show commit `9aaf326` and neither the
   commit nor the sha distinguishes them
3. **Logs** tab (runtime logs, not Build Logs)
4. Filter or search **`tpl-proxy`**

**Two invocations to look for, both from the verification:**

| What | Time |
| --- | --- |
| Page load, auto-search on open | **17:05:07Z / 1:05:07 PM EDT** |
| The explicit uncached lookup | **17:05:19Z / 1:05:19 PM EDT** |

**Match criteria:** path `/api/tpl-proxy`, status **`200`**, on **this**
deployment. The second one is the decisive record — it is the request that
returned `x-vercel-cache: MISS` and 33,299 bytes.

**If the Logs tab shows nothing for `/api/tpl-proxy`:** do **not** revoke. That
would mean the request was served by something other than this rebuild, and the
`200` would then be evidence about **#518**, not about the replacement.

## Verification complete \u2014 all three readings, together

| Required reading | Status |
| --- | --- |
| Successful uncached lookup | `200`, `x-vercel-cache: MISS`, `age: 0`, 33,299 bytes, 20 records |
| Matching invocation evidence | Dashboard log on the deployment whose id matches `dpl_BJuH3okr\u2026`: **Production**, an **external TCGPriceLookup call**, **`200`** |
| Replacement key's `Last used` | Advanced from **`Never`** to **today** |

The three were required **together** precisely because no one of them is
conclusive alone, and that is what has now been satisfied. The account counter
played **no** part in this determination, per the correction above.

**Step 11 authorized:** revoke **#518 only**. `cardresell production
replacement` stays active.

## The post-revocation lookup is the strongest evidence of the whole rotation

Worth naming rather than treating as a formality. Every reading so far had to
work around one ambiguity: **#518 was still active**, so a successful lookup was
always consistent with the old key being the one that worked. The build-time env
argument and the invocation log closed that gap by **inference about routing**.

**Revocation removes the ambiguity entirely.** Once #518 is dead at the provider,
a successful live lookup can only be the replacement key \u2014 there is no other
credential left that could produce it. So the check after revocation is not a
victory lap; it is the **only** observation in this sequence that needs no
inference at all.

**And it is the moment of maximum exposure**, because it is also the first point
at which the site has **no working rollback**: #518's value is gone from Vercel
and now revoked at the provider, and the old deployment's env snapshot points at
a dead key. **If that lookup fails, the remedy is forward only** \u2014 a new key,
re-add, rebuild \u2014 with TPL lookups down in the interim.

**Harness note:** the sandbox's direct egress to `cardresell.org` was failing
during this session while the Vercel API kept answering, so the post-revocation
lookup must be taken through the **cloud browser**, which reached the site at
`200` when `curl` could not. A `curl` failure at that step would be
**uninterpretable**, not a finding.

## What revocation closes \u2014 and the wording that must not drift

- **G11** closes at revocation.
- **CH-3** closes \u2014 worded **"the public and plain-storage exposures are
  closed."** **NEVER** "the TPL credential is unexposed." The replacement key's
  value sits in a retained transcript, Will chose to keep it rather than cut a
  third, and per Q-CH3-15 anyone with account access can read every key value
  from the dashboard's `Copy` button regardless. The accepted blast radius is
  **provider quota only**.
- **G12** does **not** close here \u2014 it still needs G1 plus real-store evidence.

## Step 11 done \u2014 rotation complete, proven without inference

**#518 revoked by Will. `cardresell production replacement` active and serving.**

Post-revocation lookups through `www.cardresell.org`, all novel terms on fresh
cache keys, so none could be served from the edge:

| Term | Status | Cache | Bytes | First record |
| --- | --- | --- | --- | --- |
| `sylveon ex` | **200** | `MISS`, `age 0` | 28,489 | `Sylveon EX` |
| `gardevoir ex` | **200** | `MISS`, `age 0` | 25,661 | `Gardevoir EX` |
| `lugia legend` | **200** | `MISS`, `age 0` | 32,217 | `Lugia Legend (Top)` |

Payloads carry provider-side detail no cache could fabricate \u2014 `tcgplayer_id`,
`cdn.tcgpricelookup.com` image URLs, `last_price_update` of `2026-09-08`. With
#518 revoked there is **no other credential** that could produce these, so this
is the observation that needed no inference. **G11 closes. CH-3 closes \u2014 worded
"the public and plain-storage exposures are closed."**

## But the run surfaced a production defect. Reporting it rather than closing over it.

One lookup in the first pair returned **`429`** \u2014 `blastoise base set`, 31-byte
error body, 384 ms.

**Attribution is established, not guessed.** `api/tpl-proxy.js:47` at `9aaf326`
is `res.status(r.status)` \u2014 the **upstream status verbatim**. Vercel did not
generate it and the key did not fail. **TCGPriceLookup rate-limited us**, and the
app passed that straight to the browser.

**What triggered it, and what did not.** The `429` followed a burst: the page's
own auto-search on load, then two explicit lookups, inside roughly two seconds.
A deliberate retry of **two** adjacent lookups after a 12-second pause returned
**`200` and `200`**. So the limit is a **short-window burst limit, not a daily
quota** \u2014 the daily counter is nowhere near 10,000. **The exact threshold is
Unverified**, and I did not hunt for it, because probing it means deliberately
consuming paid quota to demonstrate a limit.

### Why this matters more than one failed request

It lands squarely on work already open:

- **The 180 ms debounce at `:1043`.** Shorter than a mid-word pause, so ordinary
  typing generates exactly the burst shape that produced this `429`.
- **The graded path fires two adjacent calls** (`:5223`, `:5232`). That is two of
  the three-ish calls needed to trigger it, from a single user action.
- **R4 per-IP sizing.** The budget debate assumed the ceiling was ours to choose.
  **The provider imposes its own, at a far shorter window**, and ours is behind a
  switch that is off. Sizing 15/hr against a provider limit measured in seconds
  is sizing the wrong dimension.

**A seller listing twenty cards in an evening is the case that decides this** \u2014
and this run suggests they meet the provider's limit long before they meet ours.

### And a second defect in the same file

`api/tpl-proxy.js:50` sets `Cache-Control: public, s-maxage=300,
stale-while-revalidate=60` **unconditionally \u2014 after `:47` has already applied
the upstream status.** So a `429`, a `500`, any upstream failure is labelled
edge-cacheable for five minutes exactly like real card data. The code draws **no
distinction between a payload and an error**.

**Unverified:** whether Vercel's edge actually caches a `429`. Its cache is
documented for a specific set of status codes, and `429` is not obviously among
them, so the live blast radius may be nil. **The code defect stands regardless of
whether the platform currently saves us from it** \u2014 filed as **RV-12**.

**Note on the client-visible header:** live responses show `cache-control:
public` with `s-maxage` absent. That is Vercel consuming the directive at the
edge, not a discrepancy with `:50`.
