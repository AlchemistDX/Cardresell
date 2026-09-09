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

**Secondary correctness issue:** `Cache-Control` is set unconditionally at `:47-50`,
after `res.status(r.status)`. A `401`, `429` or `5xx` from TPL is therefore
cached as `public, s-maxage=300` — so a transient upstream failure, or the
**dead key after rotation**, is served from the edge for five minutes.

---

## 4. This is a class of two, not one route

Of 37 routes, 16 do not verify a caller. Two of those 16 hold a **paid
third-party key**:

- `api/tpl-proxy.js` — `CARDSELL_TPL_KEY`
- `api/pricecharting.js` — `PRICECHARTING_API_TOKEN` (`:440-462`)

**`pricecharting.js` is the better-built one, and it is the model.** It is also
anonymous, but it reads a **named list of query params** (`:446-462`) and builds
its own cache key from those named fields, backed by a **6-hour server-side KV
cache** (`:18`, `:35`). An attacker cannot cache-bust it with arbitrary params,
and repeat lookups do not reach the provider. Its residual exposure is
first-time lookups only.

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

**Consumer update is a single row**: `api/tpl-proxy.js:18` is the only reader in
the repo. No client change, since the client never held the value.

**Sequencing note:** because error responses are cached (§3), the five minutes
after revocation may serve cached failures. Do R3 first if that matters, or
accept a 5-minute window.

### R2 — Named query-param allow-list (zero behaviour change, provable)

Replace the forward-everything loop at `:32-37` with a per-path allow-list of
named params, mirroring `pricecharting.js:446-462`:

- `/v1/cards/search` → `q`, `game`, `limit`
- `/v1/cards/lookup` → `name`, `game`
- `/v1/cards/<id>` → none

**This is provably behaviour-preserving for the live client**, whose four call
sites send exactly `path`, `q`, `game`, `limit` and nothing else. It closes the
cache bypass and stops unknown params reaching the provider.

### R3 — Do not cache failures

Set `Cache-Control` only when `r.status` is 2xx; use `no-store` otherwise.
Removes the five-minute dead-key window and stops caching upstream `429`s.

### R4 — Server-side cache and cap (needs a decision, see §7)

Add a KV-backed cache keyed on the named params, as `pricecharting.js` does, and
a per-IP ceiling. **Blocked on the production-KV isolation constraint** — this
route would be a new KV writer, and write-capable work is currently held pending
a separate store. R2 and R3 need no KV and are not blocked.

---

## 7. Questions for the owner — business/feature calls I should not make alone

**Q-CH3-1 — Should `/api/tpl-proxy` require a signed-in caller?**
It would make the exposure structurally similar to `api/scan.js`. But it is
reached from card search, and if anonymous visitors can search today, gating it
changes the product's front door. **My recommendation: no auth gate.** Do R2 +
R3 + R4 instead; they cut the abuse surface without touching the funnel. Confirm
before I build either way.

**Q-CH3-2 — Should TPL lookups debit scan credits?**
Consistent with the house pattern, but it prices a lookup the user currently
gets free. Probably not, but it is your call, not mine.

**Q-CH3-3 — Is R2 acceptable as an immediate, isolated change?**
It touches deployed code, so it needs authorization. It is ~10 lines, provably
behaviour-preserving for the live client, and needs no KV. It could ride with
the outgoing Phase 1 work or ship on its own.

**Q-CH3-4 — Should the same review be run on `api/pricecharting.js`?**
It is the stronger of the two but shares the anonymous posture, and the terms
dimension in §4 is not a cost question. Recommend yes, separately.

---

## 8. Status

Assessment complete and read-only. **Nothing changed, nothing rotated, no
request made to a paid API.** R1 is yours at the provider. R2–R3 are specified
and await authorization. R4 stays blocked behind KV isolation. Q-CH3-1 to
Q-CH3-4 await your answers.

The eBay maintenance window is unaffected and still awaiting explicit
authorization.
