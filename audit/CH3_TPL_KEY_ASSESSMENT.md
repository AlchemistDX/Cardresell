# CH-3 — TCGPriceLookup key exposure: read-only assessment and bounded remedy

**Date:** 2026-09-09 · Read-only. **No request was made to the paid API**, no
abuse was demonstrated, no quota consumed. Every claim below is bound to
`file:line` in the repo or marked **Unverified**.

**Separate from the eBay maintenance window**, which remains unauthorized and
untouched.

**Reading order.** §2 and §3 record the posture **as assessed**, before any
change. §6's R2 and R3 are **built** and supersede the rows they close; where
the two differ, §6 is current.

---

## 1. What the key is and how it was exposed

`CARDSELL_TPL_KEY` is the **paid TCGPriceLookup API key**. `api/tpl-proxy.js:18`
reads it and `:44` sends it as `X-API-Key` to `https://api.tcgpricelookup.com`.
The proxy exists specifically to keep it off the client:
`js/config.20ebe911.js:4` ships the sentinel `'__PROXIED__'` instead of a value.

**Exposure:** the row is stored in Vercel as `type: plain` rather than
`encrypted`, so the project detail endpoint returns its value in cleartext. It
was returned that way into agent working output on 2026-09-09 while reading Git
deployment settings for an unrelated question. It was not written to any file
and is not reproduced anywhere. It entered a session, so it is **treated as
exposed**.

**Rotation at the provider is the only thing that ends the exposure.** Changing
the storage type does not invalidate a key that has already been disclosed. And
per the reviewer, correctly: **rotation alone will not stop quota spending
through an unprotected proxy** — the two problems are independent and both need
closing.

---

## 2. The proxy's actual protections, established from code

| Control | Status | Evidence |
| --- | --- | --- |
| Caller authentication | **None** | No `_verifyToken` import; whole file is `api/tpl-proxy.js:11-55` |
| Server-side usage limit | **None** | No counter, no KV, no per-IP or per-user accounting anywhere in the file |
| Path restriction | **Present** | Allow-list of 3 exact patterns, `:23-30` |
| Query-param restriction | **None in production; addressed in the built R2, not shipped** | Production (`9aaf326`) forwards every param except `path` verbatim, `:32-36`. The built change rejects unknown and duplicate params before any upstream call (`api/_tplContract.js`) — **local and tested, not deployed.** |
| Response caching | **Present but bypassable** | `s-maxage=300`, `:50` — see §3 |
| Upstream timeout | **Present** | 8s abort, `:42-45` |
| Method restriction | **Present** | GET/OPTIONS only, `:15-16` |
| Key leakage into URLs or errors | **None found** | Key travels in a header `:44`; the 502 body returns `e.message` only, `:53` |
| Provider spending cap | **ESTABLISHED 2026-09-09 — there is no spending cap, because there is no spending dimension** | Owner read the TCGPriceLookup dashboard: **Starter, 2,500 requests/day, midnight UTC reset, requests blocked at the limit.** Overage is **refused, not billed**, so no dollar cap exists to verify. See §6. |

**CORS is not the boundary, and I should not have implied it was.** Adopted:
`Access-Control-Allow-Origin: *` at `:12` governs what *browsers* permit
cross-origin, and a `Referer` check would be no better — both are client-asserted
headers, and neither constrains `curl`. Restricting origins would not have
prevented a single direct request. The route's real authorization posture is the
first two rows of that table: **anonymous, unmetered.**

---

## 3. The caching bypass, and its honest severity

The comment at `:49` calls the edge cache a "big cost saver". The param
forwarding at `:32-37` defeats it: the cache key varies with the full query
string, so **any junk parameter produces a unique URL and a fresh billable
upstream call.** No provider-side or app-side limit stands behind it (§2).

**But calibrating rather than alarming:** both client generations send only
named params — `path`, `q`, `game`, `limit` — with **no cache-buster**, so the
cache works for legitimate traffic. (Deployed is `js/core.569ff536.js` at commit
`9aaf326e7`; `js/core.66c39922.js` is outgoing. An earlier draft of this section
called 66c39922 deployed — see R2 for the correction.)
This is **abuse potential, not active bleeding.** Whether it has been abused is
now **substantially answered**: at the owner's dashboard reading on 2026-09-09,
usage stood at **1 request used of 2,500 for the day**, with 2,499 remaining.
That is a single day's window against a midnight-UTC reset, so it does not rule
out abuse on an earlier day — but it does establish there is **no sustained
draw** on the key at the time of reading, which is the scenario that would have
made rotation urgent rather than merely necessary.

**Secondary issue, with its evidence corrected.** I claimed an unconditional
`Cache-Control` meant a `401`, `429` or `5xx` — including the **dead key after
rotation** — was served from the edge for five minutes. **Withdrawn.** Vercel's
documented cacheable statuses exclude 401, 429 and 5xx
([Vercel caching criteria](https://vercel.com/docs/edge-network/caching)), so
asking for the header does not establish that the platform honoured it. What
remains true is only that the code asked to cache responses it should not have.
The **guaranteed dead-key window is removed from the rotation rationale**; R3
still lands, on the narrower ground that intent should be explicit rather than
dependent on platform behaviour we do not control.

---

## 3a. Plan facts — established, owner-supplied 2026-09-09

**Superseded 2026-09-09 by a second dashboard reading: Pro is now active.**
Both readings are kept, because the change of state is itself evidence.

| Item | Reading 1 (earlier) | Reading 2 — **current** |
| --- | --- | --- |
| Plan | Starter — 2,500/day | **Pro — 10,000/day.** "10,000 requests remaining today" |
| Daily usage | 1 used of 2,500 | **0 of 10,000 (0%)**, "across all active API keys" |
| Reset | Midnight UTC | **Unchanged.** Shown as Sep 9 2026, 08:00 PM local = midnight UTC |
| Overage | Blocked at the limit | Unchanged |
| Active keys | 1 of 5 permitted | **1 of 5.** Two others listed **Revoked** |
| Licence | Commercial use requires Pro | **Satisfied by the active Pro plan** |

**Three things this settles.**

1. **The Pro upgrade has completed.** The compliance requirement identified
   below is met; it is no longer an open item.
2. **Overlap is confirmed by demonstration, not just by the stated limit.** Two
   keys already carry a **Revoked** state, so revocation is an exercised
   operation on this account rather than an assumed one.
3. **The exposed key is still the live one.** The single active key is
   **Key #518**, created Jun 28 2026, and it is the value stored `type: plain`.
   CH-3 remains open until it is rotated and revoked.

### The account-wide total is not trustworthy as a stop condition

The same screenshot shows **Daily Usage 0 of 10,000** while **Key #518 reports
"Last used: Sep 9, 2026, 06:23 AM"** — about four hours before the reading, and
after the midnight-UTC boundary that starts today's window (06:23 local is
10:23 UTC; the reset is rendered as 08:00 PM local for midnight UTC, so the
dashboard displays local time consistently).

So a key was used inside today's window while the day's total reads zero. I
cannot tell from one screenshot which explanation holds — the total may lag,
or it may have reset when the plan changed — and I am not going to guess. But
either way the conclusion is the same and it is the important one:

**Had "the account-wide total must rise by exactly N" been the decisive stop
condition, this dashboard state would have failed a working rotation** — and
the failure would have been read as "the replacement key does not work",
sending me to generate another key to fix a counter problem. The total stays as
**corroboration only**. See §6b.

**Two consequences for this assessment:**

1. **The exposure is bounded by availability, not by cost.** With overage
   refused, the worst case from the published key is **denial of service on card
   lookups until midnight UTC** — not an unbounded bill. That lowers the
   financial severity and leaves the availability severity intact. Rotation is
   still required; the reason is now stated correctly.
2. **Overlap is available**, so rotation needs **no outage**: generate the new
   key alongside the old, deploy, verify a genuine provider hit, then revoke.

**Settled, and it is a rights question rather than a quota one.** The supplied
pricing screen states Starter is **non-commercial use**. CardResell is a
commercial product, and there is no separate permission. So the Pro upgrade is
a **compliance requirement, not a performance choice** — and the 10,000/day
allowance is a side effect of buying the licence, not the reason for it.

This is **not** an open question for the owner and should not be re-asked. The
only thing outstanding is **confirmation that Pro is active**.

## 4. This is a class of two, not one route

Of 37 routes, 16 do not verify a caller. Two of those 16 hold a **paid
third-party key**:

- `api/tpl-proxy.js` — `CARDSELL_TPL_KEY`
- `api/pricecharting.js` — `PRICECHARTING_API_TOKEN` (`:440-462`)

**`pricecharting.js` is the better-built one, and it is the model.** It is also
anonymous, but it reads a **named list of query params** (`:446-462`) and builds
its own cache key from those named fields, backed by a **6-hour server-side KV
cache** (`:18`, `:35`). An attacker cannot cache-bust it with arbitrary params.

**Correction:** I wrote that "repeat lookups never reach the provider." That
overstates it. The cache protects **hits** only — after **expiry**, after
**eviction**, and on **concurrent misses** for the same uncached key, requests
do reach the provider. Its residual exposure is larger than "first-time lookups
only", and sizing it is part of the separate review (Q-CH3-4).

**And the house pattern for a paid upstream already exists in this codebase:**
`api/scan.js` gates the paid Ximilar call behind `verifyTokenFlexible` (`:1`)
and an atomic credit debit (`:785-797`). So `tpl-proxy.js` is not merely below
some external standard — it is below **two** patterns this repo already
implements.

**PriceCharting carries an extra, non-cost dimension:** an anonymous unmetered
proxy of their data sits badly alongside the open permission negotiation with
them. Not a spending question — a terms question. Filed, not resolved here.

---

## 5. What I could not establish

**Two of the three were closed on 2026-09-09 by the owner's dashboard reading
(§3a). Struck through rather than deleted, so the change of state is visible:**

- ~~**Whether a provider-side spending cap or plan limit exists.**~~ **CLOSED.**
  Starter, 2,500 requests/day, midnight UTC reset, **blocked at the limit.**
  There is a plan limit and **no spending dimension at all.**
- ~~**Whether the key has been abused.**~~ **SUBSTANTIALLY CLOSED for the
  current window.** 1 of 2,500 used at the reading — no sustained draw. Still
  open for **earlier days**: a daily counter against a midnight reset cannot
  speak to history, and Vercel function invocation records for `/api/tpl-proxy`
  were not consulted. I did not probe the provider, by instruction and because
  probing would itself spend quota.
- **What the current KV-cached PriceCharting hit rate is.** **Still open.**
  Would require reading the production KV store, which is out of scope while
  production KV is the only store — the same blocker as G1.

**Newly opened by the same reading:** whether **commercial use is permitted on
Starter**, given that the Pro tier lists a commercial-use licence as a feature.
A rights question, not a quota one, and not answerable from the repo.

---

## 6. Bounded remedy, proposed for review — not built

Ordered by what closes exposure fastest.

### R1 — Rotate at TCGPriceLookup (owner, immediate)

Issue a new key at the provider, revoke the old one, and set it in Vercel as an
**`encrypted`** variable. Vercel cannot convert a `plain` row in place, so:
delete the row, re-add it as encrypted. Same rotation hygiene as the eBay
window — no whitespace, and nothing pasted into a shell.

**Sequence refined 2026-09-09, now that overlap is known to be available**
(five key slots, one in use). The order matters and the revocation is the step
that closes the exposure:

| | Action | Note |
| --- | --- | --- |
| a | Generate the new key, old one still live | **No outage required** — confirmed by the five-slot allowance |
| b | Delete `CARDSELL_TPL_KEY`, re-add **encrypted** | The only path; Vercel cannot convert in place |
| c | **Redeploy `dpl_AuwggY9YcPftJcqSnsztAw4qPfmT` (commit `9aaf326`)** — not a branch deploy | An env change reaches **no running deployment**. `phase1-block-d` is ~237 commits ahead and must not ship as a side effect of a rotation. |
| d | Verify per §6b. **`x-vercel-cache: MISS`/`BYPASS` is necessary but not sufficient**; the confirming evidence is the **provider-side usage delta**. | My earlier `X-TPL-Cache`-absent test was invalid — see §6b. |
| e | **Revoke the old key** | **The step that actually closes CH-3.** Everything before it adds a good key; only this removes the exposed one. |
| f | Then R4 activation | A mitigation, not the remedy. Must not delay (e). |

**A revoked or exposed secret is not a rollback target.** If (d) fails, the
rollback is a *newly generated* key — never the old one.

**Correction — one code reader is not one running consumer.** I wrote that the
update was "a single row" because `api/tpl-proxy.js:18` is the only reader in
the repo. That conflates source with runtime. Updating a stored environment
variable **affects new deployments**
([Vercel environment variables](https://vercel.com/docs/environment-variables)),
so the private rotation procedure must also cover:

- **Activation** — the new value does not reach the running function until a
  deployment is created with it. Saving it and stopping leaves production on the
  revoked key.
- **Existing deployments** — anything already running, including any deployment
  that could be promoted, still resolves the old value.
- **Local and non-production environments** — any `.env` copy or developer
  machine holding the old key is a separate consumer to update privately, and a
  separate place the old key survives.

**Sequencing note:** the earlier claim that revocation would serve cached
failures for five minutes is withdrawn (§3). Order R1 and R3 as convenient.

### R2 — Reject unknown and duplicate parameters (BUILT, corrected)

**The first version of R2 was wrong and is withdrawn.** It proposed stripping
unknown params from the *upstream* request and claimed that closed the cache
bypass. It does not: Vercel keys dynamic responses by the **incoming** request
URL ([Vercel cache key](https://vercel.com/docs/edge-network/caching#cache-keys)),
so `?q=Pikachu&_=1` and `?q=Pikachu&_=2` stay two cache entries and each miss
can still reach TPL, no matter what we forward.

**What is built instead:** reject unknown and duplicate parameters **before**
the upstream call, with `400` and `no-store`, and validate supported values
against the client contract. `api/_tplContract.js` holds the contract;
`api/tpl-proxy.js` now calls it before constructing any request.

**Described accurately: this closes the unknown-parameter path.** It does not
eliminate cache bypass and it does not bound spending — distinct *valid*
queries still each reach the provider. Both limits are pinned as tests so the
overstatement cannot creep back.

**The client contract, derived from BOTH clients** — another correction. I
checked `js/core.66c39922.js`, which is the **outgoing** bundle; the recorded
production commit `9aaf326e7` ships **`js/core.569ff536.js`**. Checked properly,
both bundles call three sites with the same parameters:

- `/v1/cards/search` → `q`, `game`, `limit` (100 and 20)
- `/v1/cards/<id>` → no parameters

`/v1/cards/lookup` was allow-listed but is called by **neither** client, so it
was a billable path reachable by anyone for no product reason. Its
parameterised form is gone. **Stated limitation:** TPL ids are opaque, so the
bare string `/v1/cards/lookup` still matches the id pattern — an id named
"lookup" is indistinguishable from the retired endpoint. Only the useful,
parameterised form is closed.

**Tests:** `tests/tpl-proxy-offline.mjs`, registered as slot 49 of 50.
**65 passed, 0 failed.** The upstream is mocked, so the suite spends no quota —
and the central assertion is exactly that: thirteen rejection shapes each make
**zero** upstream calls.

### R3 — Do not cache failures (BUILT)

`Cache-Control` is now set only for 2xx; everything else, including the thrown
502 path, gets `no-store`. **The rationale is narrower than I first wrote:** not
"removes the five-minute dead-key window" — see §3 — but "makes the intent
explicit instead of relying on platform status filtering".

### R4 — Server-side cache and AGGREGATE cap (design; implementable now)

A KV-backed cache keyed on the named params, as `pricecharting.js` does, plus a
ceiling. **A per-IP cap alone does not bound distributed usage** — it caps one
address while any number of addresses spend in parallel. The design therefore
needs an **aggregate safeguard**: a global counter per window that fails closed
(serve stale or 503) when the period's budget is spent, with the per-IP cap as a
secondary control against a single noisy source.

**BUILT against mocks** — `api/_tplBudget.js`, `tests/tpl-budget-offline.mjs`,
**38 passed, 0 failed**, registered as suite 50 of 51. No KV, no provider call,
no quota.

| Acceptance case | How it is met |
| --- | --- |
| Cache hits consume no allowance | A hit returns before any counter touch; 51 consecutive hits increment nothing |
| Concurrent misses cannot exceed the allowance | `INCR`-then-compare **reserves before** the call; 25 concurrent misses against a budget of 3 yield exactly 3 |
| …and the test isn't vacuous | A deliberately non-atomic check-then-set store is asserted to **overspend**, so the assertion has teeth |
| Storage failure permits no new paid call | Counter unreachable, or answering non-numerically, never returns `RESERVED`. A failing cache **read** still permits a call — reading is not spending |
| Exhaustion → stale or clear unavailability | `EXHAUSTED_STALE` with the value flagged stale when an expired entry exists; `EXHAUSTED` otherwise. Over-budget attempts refund their reservation so the counter counts permitted calls, not attempts |
| Configurable, no invented limit | `TPL_BUDGET_MAX` / `TPL_BUDGET_WINDOW_SEC` / `TPL_PER_IP_MAX`. With nothing set, the config reports itself **`configured: false`** — the defaults are placeholders, and garbage input falls back to them rather than reading as "no budget" |

Also pinned: 30 distinct IPs, each inside the per-IP cap, are still bounded by
the aggregate — the case a per-IP cap alone cannot handle. And a canonical cache
key, so `?q=a&game=b` and `?game=b&q=a` are one entry; that reuse is what the
edge cache cannot give us, since it keys on the incoming URL and we key on
meaning.

**Deliberately NOT wired into `api/tpl-proxy.js`.** The module takes an injected
store and has no KV binding. Wiring it is the live-integration step, still
blocked on store isolation, and it needs the owner's budget numbers — which are
not mine to invent.

---

## 6a. Reviewer rulings on the four questions — recorded

| | Ruling | Effect |
| --- | --- | --- |
| Q-CH3-1 | **Preserve anonymous search** for this bounded change; add cost controls without a login requirement | No auth gate. R2/R3 built, R4 designed |
| Q-CH3-2 | **Keep lookups outside scan-credit charging** | Closed, not built |
| Q-CH3-3 | **Prepare corrected R2 and R3 together with mocked upstream tests.** Local implementation is distinct from authorization to deploy | Built locally. **Not deployed, not authorized** |
| Q-CH3-4 | **Focused read-only PriceCharting review, separately.** Keep permission questions separate from cost controls | Queued as its own item |

Also adopted: "repeats never reach the provider" **overstated** `pricecharting.js`'s
protection — its cache protects hits, but expiry, eviction and concurrent misses
all reach the provider. §4 is corrected accordingly.

## 6b. Verification method — my previous test was invalid

**Withdrawn: "`200` with no `X-TPL-Cache` header proves the provider was
called."** It fails twice over, and the second failure is the serious one.

**Failure 1 — an absent header is not an absent cache.** A CDN can replay a
response that never carried the header in the first place. The header is copied
from origin into the cached entry; its absence is preserved on replay. So
"absent" is consistent with both "the function ran" and "the edge replayed a
response from five minutes ago", which is exactly the distinction the check
existed to draw.

**Failure 2 — the header does not exist at the deployment target.** This is
decisive and I should have checked it before proposing the test. The rebuild
target is commit `9aaf326`, which **predates R4 entirely**:

| Fact at `9aaf326` | Evidence |
| --- | --- |
| `api/tpl-proxy.js` is **55 lines** | `git show 9aaf326:api/tpl-proxy.js` (206 lines on this branch) |
| It sets **no `X-TPL-Cache` header at all**, on any path | Only cache-related line is `Cache-Control: public, s-maxage=300, stale-while-revalidate=60` at `:50` |
| `api/_tplBudget.js` **does not exist** | `git cat-file -e 9aaf326:api/_tplBudget.js` → absent |

So the header would have been **absent on every response** — cached or fresh,
new key or dead key. **The check could not fail.** I would have redeployed,
seen the "verifying outcome" unconditionally, declared the replacement key
working, and revoked the only key that was actually serving traffic. That is a
self-confirming test in front of an irreversible step, which is the worst place
to put one.

### The corrected method

**Signal 1 — `x-vercel-cache`, to exclude the CDN.** Vercel documents the
values as `HIT`, `MISS`, `STALE`, `PRERENDER`, `REVALIDATED`, `BYPASS`
([Vercel response headers](https://vercel.com/docs/headers/response-headers)).
`HIT` or `STALE` means the answer never reached a function and says nothing
about the key. **`MISS` or `BYPASS` is necessary but not sufficient** — the
same documentation warns that `MISS` "does not necessarily mean that a function
ran", because runtime-cached `fetch` results can present as `MISS`, and directs
you to custom headers or runtime logs instead.

**Signal 2 — the handler's own behaviour at `9aaf326`.** Once the CDN is
excluded, the 55-line handler has **no application cache to fall back on**: no
KV, no `_tplBudget`, no store of any kind. Every allowed path runs
`fetch(url, { headers: { 'X-API-Key': key } })` at `:44` and returns the
provider's status verbatim at `:46`. This inference is **specific to this
commit** and is not a general claim that a CDN `MISS` excludes an application
cache — on this branch's 206-line handler it would not hold at all.

**Signal 3 — the replacement key's own "Last used" timestamp. This is the
confirming evidence, and it is per-key rather than account-wide.** The
dashboard lists every key with its own `Last used` value. Record the new key's
identifier (its **Key #**, never the secret) and its initial `Last used` state
— for a freshly created key that is empty or its creation time. After the
verification request, that key's own timestamp must **advance**.

This is stronger than the account total for three reasons, and the total's
weakness is not hypothetical — see §3a, where the day's total read **0** while
an active key reported a use four hours earlier:

| | Account-wide total | Per-key `Last used` |
| --- | --- | --- |
| Scope | Every active key — five slots permitted | **The one key under test** |
| Concurrent traffic | Real users move it independently | Attributable to the request just made |
| Update behaviour | Observed reading zero despite same-day key use | The signal that was actually consistent in that reading |
| Answers "did *this* key authenticate?" | **No** | **Yes** |

So the total is demoted to **corroboration**. It is still worth reading — a
large unexplained jump is informative — but it is **not the stop condition**.

**If the new key's `Last used` does not advance:** wait briefly and refresh, in
case of dashboard lag. If it still has not advanced, **stop and leave the old
key active.**

**Signal 4 — runtime logs**, corroborating an invocation of `/api/tpl-proxy` at
the verification timestamp, per the documentation's own advice.

**Two properties the check now has that it lacked.** It can **fail** — a dead
key surfaces as the provider's `401`/`403` passed through at `:46`. And a
repeated identical request returning `x-vercel-cache: HIT` is available as a
**cache control**, demonstrating the signal distinguishes states rather than
reading one constant.

**But that control is diagnostic, not part of the pass criteria.** Once the
replacement key's own `Last used` has advanced, authentication is established.
If the repeat still shows `MISS`, that is a **caching question to investigate
separately** — it does not make a verified key unverified, and it must not be
treated as a rotation failure.

**Cache-key note.** All params except `path` are forwarded verbatim (`:32-36`),
so a novel query value both varies the edge cache key and reaches the provider
as a legitimate query. Use a card genuinely not requested in the previous five
minutes rather than an invented parameter, which the provider may reject.

**Ordering is unchanged and matters more now: revocation is last.**

**And a failed verification is not a rollback.** I described continuing on the
old key as "rolling forward"/"rollback", which mislabels it. Correctly: the old
key is **still active throughout**, because nothing revokes it until a
replacement is verified. If verification fails, continuing to serve on the old
key is **containment while the problem is diagnosed** — there is no state to
roll back to and no restoration step. Generate a further replacement if needed.
**The old key is never revoked until some replacement has been verified**, and
it is never itself a target to restore to, because it is the exposed value.

---

## 7. Questions for the owner — business/feature calls I should not make alone

All four are answered above. What remains for **Will**:

**Q-CH3-5 — Rotate `CARDSELL_TPL_KEY` at TCGPriceLookup (R1).** Provider-side
and yours. Nothing in this review authorizes it.

**Q-CH3-6 — Deployment of the built R2 + R3.** They exist locally and are
tested; they are **not** deployed and no authorization is implied. They can ride
with the outgoing Phase 1 work or ship alone.

**Q-CH3-7 — Should R4 be built now against mocks?** The reviewer confirms it
can proceed without production KV, with live integration still blocked on store
isolation. Say the word and I will build it with the aggregate safeguard.

**Q-CH3-8 — Is the Pro plan active yet? — ANSWERED, and therefore closed.**
The 2026-09-09 dashboard reading shows **Current Plan: Pro, 10,000 requests
remaining today** (§3a). Both halves are settled: the licence question was
already answered by the supplied pricing screen, and activation is now
observed rather than assumed.

**No TPL question is open.** What remains is authorization, which is yours to
give and not a question for me to hold: rotation (R1/G11) and R4 activation
(G12, which additionally needs the measured per-IP session and real-store
evidence).

---

## 8. Status

Assessment read-only; **no request was made to a paid API and no quota was
spent.** R2 and R3 are **built and tested locally** — 65 assertions, mocked
upstream, registered as suite 49 of 50 — and are **included in the proposed
release. Nothing has shipped.** Production still runs `9aaf326`, which contains
neither. **Local implementation is not authorization to deploy.**

R1 is yours at the provider, and its procedure now covers activation, existing
deployments and local environments — not just the one code reader. R4 is
designed with an aggregate safeguard and can be built against mocks on your
word.

The eBay maintenance window is unaffected and still awaiting explicit
authorization. **This review does not authorize credential changes or
deployment.**
