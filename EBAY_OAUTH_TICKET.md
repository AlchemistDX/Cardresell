# eBay Production OAuth — RESOLVED 2026-09-05

**Status:** Resolved. No support ticket needed. No credential problem ever existed.

**Original symptom (2026-08-12):** `POST /identity/v1/oauth2/token` with
`grant_type=client_credentials` returned `401 invalid_client` in production
while the same flow worked in sandbox. A support ticket was drafted and the
Cert ID was rotated. Neither helped.

---

## Root cause: two characters

> The credential values in this document are **synthetic placeholders** with
> the same shape and character length as the real ones (App ID 40, Cert ID 36),
> so the length arithmetic below still holds. Never paste a live credential
> into this file; the real values belong in the deployment secret store.

Every value in `.env.production` was stored as:

```
EBAY_APP_ID="FAKEUSER-Fakeapps-PRD-1f00d0000-deadbeef\n"
```

That `\n` is a **literal backslash followed by the letter n** — two characters
inside the quotes, not a newline. The Vercel-stored copies had the same defect
in a different form: a **real trailing newline** (App ID 41 chars instead of 40,
Cert ID 37 instead of 36, verification token 44 instead of 43).

So the Basic Auth header was built from:

```
FAKEUSER-Fakeapps-PRD-1f00d0000-deadbeef\n:PRD-f00dfeedface-0000-1111-2222-3333\n
```

eBay correctly rejected that as `invalid_client`. The credentials themselves
were always valid. **The transport was corrupting them.**

Strip the trailing characters and the same request returns `200` with
`expires_in: 7200` on the first try.

### Why every diagnostic pointed the wrong way

| Observation | Why it misled |
|---|---|
| Sandbox worked | Different keyset, pasted separately, no `\n` |
| Keys looked right in the portal | They *were* right — corruption happened at paste time |
| Cert rotation didn't help | The new cert got the same `\n` appended |
| User tokens reportedly worked | Different code path, not reading these vars |

The defect was invisible in every UI that renders a value rather than its
repr. `echo $EBAY_APP_ID` looks perfect.

---

## Verified working (2026-09-05, application token)

| Call | Result |
|---|---|
| `POST /identity/v1/oauth2/token` (client_credentials) | 200, `expires_in: 7200` |
| `GET /buy/browse/v1/item_summary/search?q=charizard base set holo` | 200, 10,278 items |
| `GET /commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US` | 200, tree `0`, version `134` |
| `get_item_aspects_for_category` on 183454 / 261328 / 183050 | 200 for all three |

**Taxonomy accepts the application token.** Category and aspect resolution does
not need the seller's user token, so the listing-packet layer can be built and
tested before any OAuth consent flow exists.

Required aspects — exactly one per category, all derivable from existing scan data:

| Category | ID | Required aspect | Total aspects |
|---|---|---|---|
| CCG Individual Cards | 183454 | `Game` | 35 |
| Sports Card Singles | 261328 | `Sport` | 30 |
| Non-Sport Singles | 183050 | `Franchise` | 33 |

Grader / grade / cert number are **not** aspects on 183454. They travel in the
condition-descriptor block (27501 / 27502 / 27503).

---

## Second bug found while fixing the first

`api/ebay-notifications.js` read `EBAY_VERIFICATION_TOKEN` straight from the
environment. Because the Vercel value carried a trailing newline, **production
was answering eBay's challenge with a hash over the wrong token**:

```
clean token  → c61401b9...   (correct)
prod returned → 0d8f324a...   (hash of token + "\n")
```

eBay's account-deletion endpoint must validate before production API access,
and validation failures can reduce or terminate that access. This was live and
silent.

Fixed in code via `cleanCredential()`. **The Vercel env value still needs
cleaning at the source** — see Remaining Actions.

> Caveat: this assumes the token entered in eBay's developer portal is the clean
> 43-character value. If a newline was pasted there too, the hashes would have
> matched and nothing was broken. Worth confirming in the portal.

---

## Correction to an earlier note in this file

An earlier revision of this file said to "wire the Browse API into
`/api/ebay-sold.js` as the primary path." **That is wrong** and has been
verified wrong:

| Probe | Result |
|---|---|
| `buy.marketplace.insights` scope | `400 invalid_scope` — not granted to this app |
| `GET /buy/marketplace_insights/v1_beta/item_sales/search` | `403 Access denied` |
| Browse with `filter=soldItems:true` | Rejected, warning `12002 invalid filter` |

**Browse only returns ACTIVE listings.** Sold comps require the Marketplace
Insights API, which is limited-release and this app does not have. So
`api/ebay-sold.js` must keep parsing search HTML for sold comps — the sanctioned
API cannot replace it today.

Browse is still useful, but for a *different* signal: current asking prices.
That is a complement to sold comps, never a substitute. `tests/ebay-live.mjs`
probes both denials on every live run, so if eBay ever grants access we find out
instead of assuming.

---

## Remaining actions

1. **Clean the Vercel production env values** — strip the trailing newline from
   `EBAY_APP_ID`, `EBAY_CERT_ID`, `EBAY_VERIFICATION_TOKEN`. Code now tolerates
   the corruption, but other tooling reading these vars will not.
2. **Delete `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET`** — both present in Vercel
   and both empty. They shadow nothing today but invite confusion.
3. **Confirm the portal token** matches the clean 43-char value.
4. **Deploy** the `cleanCredential()` fix so production stops hashing a
   malformed token.
5. **Resolve condition-descriptor VALUE ids** (which integer means "PSA", which
   means "10") via `getItemConditionPolicies` before any real `publishOffer`.
   `DESCRIPTOR_VALUES_RESOLVED` in `api/_ebayTaxonomy.js` is `false` until then.
   Do not guess these — a wrong value id mislabels a slab.

---

## Guardrails now in place

- `api/_ebayAuth.js` — `cleanCredential()` is the only path credentials take.
  Strips balanced quotes, real whitespace, and literal `\n` / `\r` / `\t` from
  both ends while never touching interior characters. On `invalid_client` the
  thrown error attaches a hint naming malformed credentials as the likely cause
  plus a masked per-variable diagnostic (`wasDirty`, `length`, 8-char prefix).
- `tests/ebay-auth-offline.mjs` — 53 assertions, no network, runs in the standard
  suite. Includes a direct regression test on the exact `"...aade6\n"` input.
- `tests/ebay-live.mjs` — gated behind `EBAY_LIVE=1`. Verifies the live token,
  taxonomy, Browse, both known denials, and the deployed challenge hash. On a
  hash mismatch it identifies which corruption production is hashing rather
  than reporting a bare mismatch.

**Lesson:** when a credential fails, log its *shape* — length, and whether
cleaning changed it — before suspecting the provider. Twenty-four days and a
needless key rotation would have collapsed into one line of output.
