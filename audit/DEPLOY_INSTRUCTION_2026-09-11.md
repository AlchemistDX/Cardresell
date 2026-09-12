# Instruction to the coding agent — production deploy and live test

**Authorization:** Will authorized production deployment and live testing on
2026-09-11 21:39 EDT. That authorization is real and explicit. **Read the
blocker in §0 before acting on it** — one of the two things the release is
supposed to contain does not exist.

---

## 0. BLOCKER — batch drafting is NOT in the release commit, and cannot be

The instruction says to *"verify the release commit includes batch drafting and
CH-2."* **Verified, and the answer for batch drafting is NO.**

Batch drafting was **specified and sized earlier today** and **never built**. It
was recorded as new scope with an explicit note that it was *not started* and
that building it awaited Will's scope decision, under the standing instruction of
no further feature expansion.

Measured against the branch's live bundle `js/core.ebc21977.js` (the one
`index.html:4017` loads):

| Token | Occurrences |
|---|---|
| `Create Selected Drafts` | **0** |
| `Select All` | **0** |
| `selectedCount` | **0** |
| `batchCreate` / `createSelected` | **0** |
| `at-cap` / `AT_CAP` (client sentence) | **0** |

**Do not deploy and then report batch drafting as shipped. Do not build it now
to make the release match the instruction** — that would be unreviewed feature
work going straight to production under a deploy authorization, which is not
what was authorized.

**Stop and ask Will which he wants:**

- **(A)** Deploy **CH-2 only** now, and treat batch drafting as separate
  scheduled work. CH-2 is ready and its deployment has been pending since
  2026-09-09. **This is the recommended path.**
- **(B)** Hold the deployment until batch drafting is built and reviewed.

Everything below assumes **(A)** unless Will says otherwise.

---

## 1. Verify the release commit before pushing

Branch `phase1-block-d`, HEAD `a89db24`. Production (`origin/main`) is
`9aaf326`.

**CH-2 — verified present.** `6c610e2` ("release: CH-2 prepared, TPL rotation
sequenced, completion labels narrowed") **is an ancestor of HEAD**. Confirm both
sides yourself before pushing:

- Branch: `api/ebay-notifications.js` has `function verificationToken()`
  returning `cleanCredential(process.env.EBAY_VERIFICATION_TOKEN) || ''` —
  **read at call time, no repo literal**.
- Production `origin/main`: still
  `const VERIFICATION_TOKEN = process.env.EBAY_VERIFICATION_TOKEN || 'CardResell-eBay-Notify-2026-secure-token-v1'`
  — **the repo literal fallback CH-2 removes**. This is the defect being fixed.

Also note the branch carries **247 changed files** against `origin/main`,
including the whole Block D draft path and the audit record. **This release is
much larger than CH-2.** Re-read what is going out; do not describe it as a
one-line fix.

---

## 2. Deploy, then confirm the production commit

- Push `phase1-block-d` to `main`. Push auto-deploys.
- **Keep deployment protection enabled.** Do not disable it to make a check pass.
- Wait for READY, then **confirm the deployed commit from the build log**, not
  from the dashboard summary and not from a bundle hash alone — a bundle hash has
  been mistaken for a commit before in this project.
- Report the deployment ID and the commit SHA it built.
- Verify `https://www.cardresell.org` serves 200 and the expected bundle. Use the
  cloud browser or `node -e` with `fetch`; **sandbox `curl` is unreliable here**.

---

## 3. Live checks — report each failure individually

**Report per check. A count or a fraction is not a result.** The eBay harness
acceptance gate is *every required check passes* — no fraction, no count. For
every failure give: the check name, the assertion, the observed value, and the
`file:line`. Do not aggregate, do not stop at the first failure, and do not
summarize failures away.

Run, and report separately:

1. **RV-9 / RV-3 — `tests/ebay-live.mjs`**, all 20 checks, where the
   Production-only eBay credentials resolve. **RV-9 currently stands at 0 of 20
   established.** The earlier standalone challenge-check PASS is **not** one of
   these 20 and must not be counted as one.
2. **CH-2 in production** — `GET /api/ebay-notifications` with
   `EBAY_VERIFICATION_TOKEN` set must behave correctly; with it unset it must
   fail closed with `503 verification_token_unset`, `no-store`, and **no**
   `challengeResponse` field. POST stays open deliberately.
3. **RV-1** — grade response contract against the deployed function.
4. **RV-4 + lifecycle** — deployed draft round-trip and lifecycle. See §4.
5. **Deployed Google authentication** — sign in, confirm the
   `userdata:<googleSub>` round-trip.
6. **R4 activation (G12)** — activate, then verify.

**Do not re-run the 6b challenge check.** It passed on 2026-09-11 against
`dpl_BS1a9nXNzpUtEqiWpRLakQmjMRXz` and Will has said no further token test is
needed. Do not consume paid quota to demonstrate anything.

---

## 4. Carry this open result forward as UNVERIFIED

**Deletion survived refresh. Retrying from the original scan row was NOT
tested.** Keep it marked **unverified** — do not upgrade it on the strength of
the refresh result, and do not let a green lifecycle suite stand in for it.

The untested path is specifically: a draft is deleted, then the seller returns to
**the original scan row** and retries from there. Per Q-D8-6 the expected
behaviour is that a pending retry **cannot** recreate, and only a **fresh
explicit Create** produces a new draft. Per the 410 decision, a stale generation
must **show the deleted state and require an explicit new Create** — **no
automatic refresh-and-retry**. If you test it, test that; if you do not, it
stays unverified in the report.

---

## 5. Test-data rules for live testing

- **Every live draft must be clearly marked as a test draft** in its title, so it
  is unmistakable in production data.
- **Publish nothing.** No listing is submitted to eBay or any venue. No
  auto-publish.
- **No purchases.** No paid quota consumed to demonstrate a behaviour.
- **No manual production quota changes.** Do not edit counters, credits, or the
  draft quota by hand to make a check pass. `DRAFT_CAP = 500`
  (`api/_draftQuota.js:69`) — if you hit the cap, report it; do not raise it.
- **Clean up** the test drafts you create, through the product's own delete path.
- Note: the client has **no seller-facing sentence for `AT_CAP`** (0 hits in the
  bundle). If a cap refusal occurs, the UI will say nothing useful — record that
  as the observation, it is a known defect.

---

## 6. Rules that still bind

- **Do not weaken a check, a gate, or eligibility to force a pass.**
- **Do not change the eBay exemption.** Its eligibility is unresolved and
  owner-held.
- **Do not send the eBay support question.** It stays unsent pending Will's
  approval.
- **Do not claim deletion clears every stored copy** — that is untraced across
  all three storage locations.
- **Never print, echo, or validate a credential value.** No token output.
- Commit messages containing `$` must use `git commit -F`.
- **Bind every claim to `file:line`.** If something is not established, write
  **Unverified**. Do not stamp a lie.
- A passing suite is not evidence it would catch the bug. **When a test fails,
  establish whether the fixture or the product is wrong before changing either.**

---

## 7. What to report back

1. §0 answered: deploying **(A)** CH-2-only or **(B)** holding.
2. The pushed commit SHA, the deployment ID, and the commit the build log says
   it built.
3. Each live check, named, with PASS / FAIL / NOT RUN and, for every failure,
   assertion + observed + `file:line`.
4. RV-9 stated as **checks established out of 20**, with the challenge check
   excluded.
5. The scan-row retry result, or **Unverified** if not tested.
6. Test drafts created and whether each was cleaned up.
