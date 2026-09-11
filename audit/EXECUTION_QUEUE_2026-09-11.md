# Current Execution Queue — 2026-09-11 13:15

Supersedes the flat "remaining blocking queue" list I gave at 11:57, which
**mixed release blockers with separately tracked work** and implied every item
waits on a production release. Two corrections applied:

- **Turnstile Preview scope (D-RV-3) is NON-BLOCKING.** I listed it as blocking.
  It was adjudicated non-blocking; it is a distinct Preview *test* credential,
  not a narrowing.
- **Preview-isolated checks do not wait for a production release.** RV-4 and the
  lifecycle/KV work run against the isolated Preview. Grouping them under
  "needs the deployed release" was wrong and would have idled them behind a
  release they don't depend on.

Phase 1: approximately 95%. Production token replacement complete. Remaining
validation and exemption clarification open.

---

## A. Runs on Preview now — no production release needed

| Item | Target | Required access | Next action |
|---|---|---|---|
| RV-4 draft KV live | Isolated Preview | Preview KV binding (G1) — Preview+Development group already exists | Bind KV on Preview, then run the draft round-trip |
| Deployed lifecycle behaviour | Isolated Preview | Same Preview binding | After RV-4: create → delete → confirm explicit new Create required (Q-D8-6) |
| Upstash REST compatibility | Isolated Preview | Preview KV binding | Exercise `/set`, `/setex`, `/get` against the Preview database |
| Deployed Google authentication | Isolated Preview | Preview deployment + a Google sign-in | Sign in on Preview, confirm `userdata:<sub>` round-trip |

## B. Needs the authorized production release

| Item | Target | Required access | Next action |
|---|---|---|---|
| **CH-2** | Production | **Your explicit deploy authorization** | **Implemented at `6c610e2`, deployment pending.** Push to `main` auto-deploys — yours alone to authorize |
| RV-1 grade response contract | Production | Deployed function | Call the deployed endpoint, compare against the frozen contract |
| RV-3 eBay live suite | Production | Production-only eBay credentials (G2) | Run `tests/ebay-live.mjs` where the production credentials resolve |
| RV-9 remaining live checks | Production | Same as RV-3 | **0 of 20 checks established.** Runs with RV-3; the standalone challenge PASS is not one of them |
| R4 activation (G12) | Production | Production env | Activate, then verify |

## C. Owner-held — not agent work

| Item | Target | Required access | Next action |
|---|---|---|---|
| **CH-1 close** | eBay portal | Your portal session | **7-alt**: save the clean token, exemption untouched. If no token-edit field is exposed while exempt, report that and stop |
| Exemption eligibility | eBay policy | — | Approve or discard the revised §17 draft. **Unsent.** Exemption stays unchanged |
| Site-terms question (HTML retrieval) | Counsel | — | Your call; pre-existing production behaviour, not a release blocker |
| Safeguard 2 | Vercel | Deployment protection settings | Old deployments retain prior access — still OPEN |

## D. Separately tracked — NOT release blockers

D-RV-3 Turnstile Preview scope · RV-11 · RV-14 · RV-15 · `createdByOperation`
null · PriceCharting Q1–Q6 · $1000/mo tripwire · Q-D5-5 · Safari/iOS photos ·
SI-1 · A-2 · `feeBase` on 2 of 15 venues · 4 duplicate `codes` helpers ·
T2.1–T2.4 / T2.6 / T2.8 · Blob identifier cleanup.

## Not in this list by instruction

No further 6b or Terminal check. No exemption change. No RV-13 work. No feature
expansion. No push without your authorization.

**Scope caveat:** this is the queue as visible in this thread. It is not
necessarily the whole release queue.
