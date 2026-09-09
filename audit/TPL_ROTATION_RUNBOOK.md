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

---

## Questions for you — in the file, as you asked

**Q-CH3-9 — `Sensitive` or `Encrypted` for the replacement?**
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
