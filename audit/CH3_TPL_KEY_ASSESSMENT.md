# CH-3 — TCGPriceLookup key exposure: read-only assessment and bounded remedy

**Date:** 2026-09-09 · Read-only. **No request was made to the paid API**, no
abuse was demonstrated, no quota consumed. Every claim below is bound to
`file:line` in the repo or marked **Unverified**.

**Separate from the eBay maintenance window**, which remains unauthorized and
untouched.

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
| Query-param restriction | **None** | Every param except `path` forwarded verbatim, `:32-37` |
| Response caching | **Present but bypassable** | `s-maxage=300`, `:50` — see §3 |
| Upstream timeout | **Present** | 8s abort, `:42-45` |
| Method restriction | **Present** | GET/OPTIONS only, `:15-16` |
| Key leakage into URLs or errors | **None found** | Key travels in a header `:44`; the 502 body returns `e.message` only, `:53` |
| Provider spending cap | **Unverified** | Not determinable from the repo. TCGPriceLookup dashboard, owner-side |

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

**But calibrating rather than alarming:** the live client sends only named
params — `path`, `q`, `game`, `limit` (`js/core.66c39922.js`, the deployed
bundle) — with **no cache-buster**. So the cache works for legitimate traffic.
This is **abuse potential, not active bleeding.** Whether it has been abused is
**Unverified** and answerable only from usage records (§5).

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

- **Whether the key has been abused.** Requires the TCGPriceLookup usage
  dashboard (owner-side) and Vercel function invocation records for
  `/api/tpl-proxy`. I did not probe the provider, by instruction and because
  probing would itself spend quota.
- **Whether a provider-side spending cap or plan limit exists.** Owner-side.
- **What the current KV-cached PriceCharting hit rate is.** Would require
  reading the production KV store, which is out of scope while production KV is
  the only store.

---

## 6. Bounded remedy, proposed for review — not built

Ordered by what closes exposure fastest.

### R1 — Rotate at TCGPriceLookup (owner, immediate)

Issue a new key at the provider, revoke the old one, and set it in Vercel as an
**`encrypted`** variable. Vercel cannot convert a `plain` row in place, so:
delete the row, re-add it as encrypted. Same rotation hygiene as the eBay
window — no whitespace, and nothing pasted into a shell.

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

**Implementation and mocked tests can proceed without production KV**; only live
integration is blocked on store isolation.

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

---

## 8. Status

Assessment read-only; **no request was made to a paid API and no quota was
spent.** R2 and R3 are now **built and tested locally** — 65 assertions, mocked
upstream, registered as suite 49 of 50. **Local implementation is not
authorization to deploy**, and nothing here is deployed.

R1 is yours at the provider, and its procedure now covers activation, existing
deployments and local environments — not just the one code reader. R4 is
designed with an aggregate safeguard and can be built against mocks on your
word.

The eBay maintenance window is unaffected and still awaiting explicit
authorization. **This review does not authorize credential changes or
deployment.**
