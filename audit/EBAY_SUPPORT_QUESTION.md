# Draft question for eBay Developer Support — marketplace account deletion exemption

**Status: UNSENT. It stays unsent until the owner explicitly approves sending
it.** Nothing in this file has been transmitted to eBay.

## Why this file exists at all

This draft has lived, until now, only in a prior session's re-check notes
(`Rotation-Runbook-Re-check 2026-09-10`, §17). That document was never committed
to this repo, so the corrected wording could not be reviewed from the repo and
could not be diffed. It is committed here so the next correction lands on a file
that exists.

`audit/ROTATION_RUNBOOK.md` in this repo stops at §5. The §17/§18 material is
**not** in it. Anyone reading the runbook for the support-question status should
read this file instead.

## Correction applied 2026-09-11

The previously pasted draft said the data was retained **"in two places"** and
that the derived figure was held **"until they delete the card or their data."**
Both claims were repaired in an explanatory note underneath the draft while the
draft body itself still made them. The body is what would be sent, so the body
is what is corrected here. Three edits, all in the message itself:

1. **"What we retain, in two places" → three locations.** §18 of the re-check
   established three: the Upstash listing cache, a browser `localStorage` copy,
   and an account-keyed Upstash copy. The two-place count predated that finding.
2. **The browser copy is now its own numbered item.** It was previously absent
   from the message entirely, not merely miscounted.
3. **The deletion promise is removed.** `api/user-data.js` handles `GET` and
   `POST` only — there is no `DELETE`, and no account-data erasure path. Saying
   the record is held "until they delete the card or their data" describes a
   capability the code does not implement. The message now states the retention
   we can substantiate and says plainly that we have no deletion endpoint.

## The message

> **Subject:** Marketplace account deletion exemption — does derived sold-price
> data count as "persisting eBay data"?
>
> Our application shows sellers recent sold-price comparables for trading
> cards. We would like to confirm whether our current exemption is accurate,
> and we would rather ask than declare something incorrect.
>
> **How we obtain the data.** We do **not** use the eBay API for this. Our
> server requests the public sold-listings search page on `ebay.com` and parses
> the returned HTML.
>
> **What we retain, in three locations.**
>
> 1. A server-side cache of the parsed result, expiring automatically after
>    **15 minutes**. Each record contains: item **title**, **price**,
>    **currency**, **item URL**, **image URL**, **sold date**, and an
>    **item ID**. It is keyed by search terms and is not associated with any
>    user.
> 2. When a user saves a card to their collection, a **single derived figure** —
>    the **median** of those sold prices — is written into that user's
>    collection in their **browser's local storage**, together with a refresh
>    timestamp. Individual listings, item IDs and listing URLs are **not**
>    written here.
> 3. That same collection is synced to our server and stored under **the user's
>    Google account identifier**, so the derived median and its timestamp are
>    also held server-side. This copy has **no expiry**. Again, individual
>    listings, item IDs and listing URLs are **not** retained.
>
> **On retention and removal.** We want to be precise rather than reassuring:
> the two derived copies have no expiry set. Removing a card from the collection
> rewrites the stored collection without that card's row on the next sync. We do
> **not** currently expose an account-data deletion endpoint, so we are not
> claiming an erasure path we have not built.
>
> **What we do not retain.** In the surfaces we have audited we found no eBay
> **user** identifiers — no eBay username, user ID, buyer, seller or feedback
> data. We are describing the storage paths we traced, not making a
> whole-application guarantee.
>
> **Our questions.**
>
> 1. For exemption purposes, does any of these count as "persisting eBay data" —
>    the 15-minute listing cache, the derived median held in the user's browser,
>    or the derived median held server-side under a user account identifier?
> 2. Does it change the answer that the data is obtained from the public
>    website rather than through an eBay API?
>
> If any of them counts, we will disable the exemption and subscribe to
> marketplace account deletion notifications.

## Note for the owner before sending

Question 2 discloses the HTML-retrieval method. That is the honest framing, and
eBay cannot give a reliable answer without it — but it may prompt a separate
conversation about whether that retrieval is consistent with eBay's site terms.
That is an owner/counsel question, it is pre-existing production behaviour, and
nothing here proposes changing it. The trade-off is yours, which is one more
reason this stays unsent.

## What is retained — the evidence behind the message

| Kind | Location | Expiry | Key |
|---|---|---|---|
| **Listing records** — `title`, `price`, `currency`, item `url`, `imgUrl`, `soldDate`, `itemId` | `ebay_cache:*` (Upstash) | **15 min** | search terms, no user |
| **Derived median** — as `currentValue` + `lastRefreshed` | `getUserKey('portfolio')` (browser localStorage) | **none** | local user |
| **Derived median** — same rows, synced | `userdata:<googleSub>` (Upstash, `api/user-data.js`) | **none** | the user's Google subject identifier (`sub`) from their Google ID token |

No eBay user identifier was found in the audited surfaces. That clause is about
eBay usernames and IDs; it says nothing about the Google identifier under which
we store our own users' data.
