# Rotation runbook — the dashboard answers, then the rotation, then the push

Written 2026-09-08 because the blocking questions have been referenced as "the
five Vercel dashboard questions" since the orientation packet without ever being
enumerated in one place. They are enumerated here. This is the only file needed
to run the sequence.

**Nothing in this file is a push, a deploy, or an environment change.** Steps 1
and 2 are read-only. Step 3 changes one secret. The push gate stays closed until
step 5 passes.

## 0. Why the owner has to do this

Re-verified today, not carried forward: `api.vercel.com` returns **HTTP 000**
from this sandbox (no route), and the CLI cannot be installed — the npm registry
returns **403** for the `vercel` package. So both instruments are gone, and no
repository inspection can substitute: every question below is dashboard state,
not a file. Two AI reviewers cannot answer them either.

Count correction: the corpus says "five". `audit/CARDRESELL_PLAN_AND_ROADMAP.md`
§8.3 lists **seven**. Seven is right; five was a miscount that propagated. Only
**two** of the seven actually gate the rotation — marked **GATING** below. The
other five are release-readiness facts worth capturing in the same sitting
because the tabs are already open, but they do not hold the rotation up.

## 1. The seven dashboard answers (read-only)

Vercel → the CardResell project.

| # | Question | Where | Gating? |
|---|---|---|---|
| 1 | **Does Preview receive live eBay secrets?** | Settings → Environment Variables → check the environment checkboxes on the eBay Cert ID row. Record which of Production / Preview / Development are ticked. **Record the tick boxes, never the value.** | **GATING** |
| 2 | **Does Preview read production KV?** | Storage → the KV/Redis store → Connected Projects and the environments it is linked to | **GATING** |
| 3 | Which Git branch is Production? | Settings → Git → Production Branch | no |
| 4 | Active production deployment SHA | Deployments → the one badged Production | no |
| 5 | Does a feature-branch push produce a Preview, and at what URL? | Settings → Git → "Deploy Previews" / branch settings | no |
| 6 | Current domain routing | Settings → Domains — which domain points at Production, and whether `www` and apex both resolve there | no |
| 7 | Installed integrations and webhooks | Settings → Integrations, and Settings → Webhooks | no |

**Why 1 and 2 are the ones that gate.** If Preview holds the same live eBay
credential *and* reads production KV, then rotating Production alone leaves
Preview authenticating with a retired secret against real data — it breaks, and
it breaks against production state rather than a sandbox. In that case the env
update in step 3 must land in **both** environments in the same sitting. If
Preview has its own credential or no eBay credential at all, Production-only is
correct and simpler. **The decision between those two cannot be made without
answer 1.** This is the single most important question in the set
(`audit/D2_0_ASSET_FINGERPRINT_RETURN_PACKET.md:326-335`).

Everything in §1 is read-only. Nothing is changed by looking.

## 2. Rotation, in order

Do not start until answers 1 and 2 are in hand.

1. **eBay developer portal** → generate a replacement Cert ID for the production
   keyset. Do not delete the old one yet.
2. **Vercel** → Settings → Environment Variables → update the Cert ID **in
   Production**, and **in Preview as well if and only if answer 1 says Preview
   holds a live credential**. Redeploy is required for the new value to take
   effect — that redeploy is a deployment and needs owner authorization like any
   other.
3. **Verify the new credential:** `EBAY_LIVE=1 node tests/ebay-live.mjs`.
   **The bar is 18/19, not 19/19.** The nineteenth failure predates the rotation
   and is not expected to be fixed by it. 18/19 confirms the credential and
   nothing more — do not later cite it as clearing the Phase 2 gate, which
   requires a genuine 19/19 (`audit/CARDRESELL_PLAN_AND_ROADMAP.md:482`, `:641`).
   Note also that 18/19 is itself a carried-forward report, never re-run here
   (`:601`); this run establishes the baseline as much as it confirms the change.
4. **Confirm the old Cert ID is retired** in the portal, and check issued-token
   implications rather than assuming secret rotation invalidates every live
   token.
5. **Then** delete `refs/recovery/pre-scrub-c2366b2`.
6. **Never** use the unblock URL, at any point in this sequence.
7. Record only status, checker, and time. **Never reprint a credential value,
   fragment, or unblock URL** into code, fixtures, logs, commit messages, or this
   file.

## 3. What the rotation does and does not unblock

**Unblocks:** pushing. That is all it unblocks, and it is a lot — the outgoing
work on `phase1-block-d` is held entirely by this gate.

**Does not unblock:** deployment, which stays a separate explicit authorization,
and Phase 2, which needs 19/19 plus the OAuth and token-storage items.

**Already decided, not an open item:** the `94dc777` commit-history question was
settled on 2026-09-06 — **Option A, keep the history**, recorded with evidence
and rationale at `audit/DECISION_94dc777.md`. No rebase, no rewrite, no
force-push; every SHA cited across the audit corpus stays valid.

**But it is conditional, and the condition is this runbook.** A is safe *because*
rotation happens: the decision rests on the fragments becoming references to a
dead credential. Until step 2 completes they are fragments of a live one, and
`94dc777` is unreachable from `origin/main`, so **the push is the publishing
event.** That is the whole reason the push gate exists — under A, rotation is the
only protection, because A leaves the fragments in place to be published as-is.
If rotation stalls indefinitely, the decision record says to revisit A rather
than to wait.

*Corrected 2026-09-08.* The first version of this section said no owner decision
had been recorded, and cited the decision record while doing it. See §5.

## 4. While you are signed in anyway — the eBay check

Four questions, one page load, unrelated to the dashboard but the same sitting.
See `audit/d5/D5_ENTRY_GATE.md` §8.3 for why each matters. Signed in to eBay,
open:

`https://www.ebay.com/sl/prelist/identify?title=Charizard%20VMAX%20074%2F073%20Champions%20Path&caty=183454`

1. Does the identify/match screen appear at all?
2. Does it show **that search**, rather than an empty box or a restored draft?
3. Is the collector number on the offered match `074/073`?
4. **Is the query still in the address bar after landing?** If eBay strips or
   rewrites `title`/`caty` on a signed-in redirect, that is the same failure mode
   that killed the old scan-miss link, and it is the one failure D5's shipped
   instruction cannot survive.

---

## 5. Two corrections this runbook had to make to itself

Recorded rather than quietly fixed, because both are the same failure and it is
the failure this corpus is most prone to.

**The count.** "Five Vercel dashboard questions" was carried through six
documents and enumerated in none of them. The roadmap §8.3 lists seven, and
seven is right. An unenumerated blocker cannot be worked, only referred to —
which is how this one survived fifty commits of otherwise careful work — and a
number with no list behind it drifts by retelling. Same shape as the offset table
and the predicted hash: **a derived value stamped into prose, aging quietly,**
with nothing to check it against.

**The decision.** §3 of this file asserted that no owner decision on `94dc777`
had been recorded, and cited `audit/DECISION_94dc777.md` in the same sentence —
a file that opens with "Decision: Option A — keep the history" and was decided
2026-09-06. The claim came from `CARDRESELL_PLAN_AND_ROADMAP.md` §8.2, which was
accurate when written and went stale that day. **A stale sentence in a
carried-forward document became a false claim in a new one, in a file whose
entire purpose is to be the single place this gets read from.** Both corrected;
the roadmap paragraph now records that it propagated, so the correction is not
itself the sort of thing that ages.

**One substantive divergence, resolved.** The decision record's rotation sequence
says "update the Vercel environment variable in **both** Production and Preview"
unconditionally. §2 of this runbook makes Preview conditional on dashboard answer
1. The conditional version is correct and supersedes it: if Preview holds no eBay
credential, updating Preview does not protect anything, it **creates a live
credential in an environment that did not have one.** The unconditional wording
was written before the Preview questions were posed and reads as safe-by-default
only if you assume Preview already holds the secret — which is precisely the
thing answer 1 exists to establish.
