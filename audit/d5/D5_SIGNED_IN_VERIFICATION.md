# D5 — Signed-in continuation: what I could verify, and the one check I cannot run

**Date:** 2026-09-08 · **Branch:** `phase1-block-d` · **Live bundle:** `js/core.66c39922.js` (`index.html:3834`)
**Suite:** `draft-review-screen` **370 passed, 0 failed**
**Status: mobile-web run OBSERVED 2026-09-08 on iOS Safari and it PASSES the
criterion (§9). Signed-in closure waits on one sentence of owner attestation —
see §9.3, where the standard for it has been corrected.
Nothing pushed, nothing deployed.**

D5 §8.3 reclassified signed-in continuation from a footnote to the critical path,
on the grounds that every probe was logged out and every real seller is signed
in. That reclassification stands. This document reports what today's work
changed and what it did not.

---

## 1. What I tried first, and why it failed

The gate named the instrument correctly: "the only instrument is the owner's own
signed-in browser." I attempted exactly that — a read-only navigation in your
browser, no clicks past the landing screen.

**It was not reachable.** The session reported no local browser available, so
your logged-in eBay state was not accessible from here. I did not fall back to a
logged-out browser and present it as the signed-in answer, because that is the
substitution the gate exists to prevent.

Recorded plainly: **the four signed-in questions are unanswered, and no evidence
in this document upgrades them.**

## 2. What documentation could contribute: nothing

I searched for any eBay documentation of the `/sl/prelist/identify` query
parameters — the `title` and `caty` pair we send. There is none. eBay documents
listing creation through its APIs ([eBay, "Listing
Creation"](https://developer.ebay.com/develop/guides-v2/listing-creation)) and
documents category IDs for API callers ([eBay, "Finding categories for a
listing"](https://developer.ebay.com/api-docs/sell/static/metadata/sell-categories.html)),
but the prelist URL family is internal and undocumented.

**Consequence worth stating once:** the parameters we depend on are undocumented
internals. They carry no compatibility promise, they can change without notice,
and no amount of reading will ever close the signed-in question — only an
observation will. That is an argument about the shape of the risk, not a reason
to stop using the link: the alternative is no hand-off at all, and §7 of the
entry gate already weighed that.

## 3. What I did establish: a logged-out baseline, re-taken today

I re-ran the exact probe URL from §8.3 step 1 in a clean browser with no
logins, and answered all four of the gate's questions in the logged-out case.
This is a **baseline, not the answer** — its only use is that a signed-in run
now has something to be compared against, and a difference will be visible.

URL sent (exactly what the builder produces for the fixture card):

```
https://www.ebay.com/sl/prelist/identify?title=Charizard%20VMAX%20074%2F073%20Champions%20Path&caty=183454
```

| §8.3 question | Logged-out answer today |
| --- | --- |
| 1. Does the identify/match screen appear? | **Yes.** "Find a match", eBay's own listing entry screen. No sign-in wall, no register prompt. |
| 2. Does it show *that* search, not an empty box or a restored draft? | **Yes.** Verbatim: `Find a match for "Charizard VMAX 074/073 Champions Path"`, under `Toys & Hobbies > Collectible Card Games > CCG Individual Cards` — the `caty=183454` we sent. |
| 3. Is the collector number on the offered match the one in the URL? | **Yes.** Top pick: `Charizard VMAX (Secret) 074/073 Champions Path Holo`. Same number, same set. |
| 4. Final URL after landing (**recorded, not a criterion** — see §7.0) | Identical to the sent URL: both `title` and `caty` present, no redirect. |

The URL observation is reported because it is free and may explain a failure,
**not because it decides one** — §7.0 corrects the reasoning I had attached to
it.

## 4. One new finding, and it supports copy we already ship

eBay pre-filled its own facet chips from our title: `Card Name: Charizard VMAX`,
`Set: Champions Path`, and **`Stage: Champion`**.

The first two are right. The third is eBay's matcher mis-parsing "Champions
Path" — a set name — into a "Stage" attribute. Nothing we sent said "Champion".

**It supports a parsing disagreement, and only that.** On review I had let it
carry more than it can. The shipped seed note also claimed eBay's matcher "does
not always answer the same way twice", and neither this observation nor the
earlier 232/165 → 205/165 one demonstrates instability: both are eBay reading
**one** search differently than we meant it. A variability claim needs repeated
identical probes diverging, and we have never run them.

So the claim is **withdrawn from the shipped copy, not softened.** The seed note
now reads:

> We send eBay this search: **Charizard VMAX 074/073 Champions Path**. eBay may
> interpret it differently, and their catalogue sometimes disagrees with ours.
> Nothing is listed or published until you do it there yourself.

The assertion was **flipped rather than deleted**: it now forbids the
variability vocabulary (`same way twice`, `inconsistent`, `varies`,
`unpredictable`, …) and requires the disagreement wording, so the stronger claim
cannot return without the evidence arriving first. What survives is the useful
part, which was never the variability: the seller has something to check.

I did **not** add "check the card details before selecting a match" to the seed.
The imperative already exists one line above, in the WARNING-severity check note
naming the collector number. One behaviour, one implementation — and a second
"check the card" sentence in muted text directly under the loud one competes
with it instead of reinforcing it.

**Not claimed:** that the mis-parse is stable, reproducible, or affects the
resulting listing. It was seen once. I did not click through to find out,
because clicking a match begins a listing flow.

## 5. What changed in code

One assertion pair, protecting the invariant that makes shipping against an
unverified boundary defensible in the first place.

`tests/draft-review-screen.mjs` now asserts, over the whole
`.review-packet-sell` block:

- **no sentence predicts eBay's screen** — no "you'll see", "you'll land",
  "eBay will show/display/open/take you"; and
- the block **still** says "We send eBay this search", i.e. it remains keyed to
  our own behaviour.

This turns the gate's principle — *a disclosure keyed to our behaviour holds
whatever the other side does; one keyed to theirs is a claim we cannot maintain*
— from a paragraph in a document into a failing test. Asserted as a **property
of every sentence in the block**, not as a check on today's wording, so a future
edit that predicts eBay's screen fails here rather than shipping.

`draft-review-screen`: **367 passed, 0 failed** (was 363: two for the boundary invariant, two for the withdrawn variability claim).

## 6. The check itself — four steps, five minutes, your account

Self-contained. Nothing else needs to be open.

1. Signed in to eBay, open:
   `https://www.ebay.com/sl/prelist/identify?title=Charizard%20VMAX%20074%2F073%20Champions%20Path&caty=183454`
2. Does the "Find a match" screen appear — or does eBay send you to Seller Hub,
   a restored draft, or a different screen?
3. Does it show `Charizard VMAX 074/073 Champions Path` as the search, and is
   `074/073 Champions Path` the collector number on the top offered match?
4. **Record the final URL** — copy it as-is. This is an observation, not the
   pass/fail criterion (§7.0). If it has changed, it may help explain a
   failure in steps 2–3; on its own it decides nothing.

**Please do not click a match or continue past that screen.** Landing is
read-only; continuing begins a real listing on your account.

## 7. Pre-committed consequences

Written before the observation, so no outcome can be argued into a pass.

### 7.0 Correction: the URL is evidence, not the criterion

My earlier table judged step 4 on the query string, and that inference was
wrong in **both** directions:

- **A missing query string does not prove eBay discarded the inputs.** eBay can
  consume `title` and `caty`, resolve them server-side, and redirect to a
  cleaner URL. The seller would then be on exactly the right screen with a
  clean address bar, and my table would have called it a blocker.
- **Parameters remaining in the address bar do not prove they were used.** An
  unconsumed query survives a page that ignored it completely. My logged-out
  baseline in §3 shows the parameters intact, and that fact alone establishes
  nothing about them being read — what establishes it there is the **displayed**
  search and category, which happened to be visible in the same screenshot.

The criterion is therefore what a seller can see and do:

1. **Does the landing screen display our search and category?**
2. **Can the seller follow the hand-off instruction** — is there a card or match
   in front of them whose collector number they can compare against ours?

The final URL is recorded on every run because it is free and because it can
*explain* a failure. It never decides one.

### 7.1 The table, on the corrected criterion

| Observation | What it means | What I do |
| --- | --- | --- |
| Search and category are displayed, and a match is offered to compare | The inputs reached the workflow and the instruction is performable — **however the URL ended up**. | Close §8.3 with the observation, its date and its account/browser context. Leave the copy alone. |
| Search and category displayed, but the **offered match is a different card** | eBay read our search differently. Already disclosed by the seed note, and the check note is exactly what catches it. Not a defect in our behaviour. | No code change. Record it as a further instance of disagreement — **not** of variability (§4). |
| **The search/category are not displayed** — empty box, restored draft, Seller Hub, or any screen without our card in it | The inputs did not reach the workflow *as far as the seller is concerned*, which is the only sense that matters. §8.1's compare-the-number instruction is addressed to something not in front of them. | **Blocker.** Fall to the Q-D5-2 fallback in §7.2. |
| Screen appears but the seller cannot tell what to compare | Same blocker, softer cause. | As above. |
| Anything else | — | Report it verbatim; I will not classify it in advance. |

### 7.2 The pre-committed fallback (Q-D5-2, answered)

If the inputs genuinely fail to reach the workflow: **keep a usable generic eBay
continuation, with manual-copy instructions.** The seller can still list; a
hand-off with honest copy beats no hand-off.

Specifically, and decided now rather than after the observation:

- **Keep** the button and a working eBay destination.
- **Keep** the identity instruction, phrased to hold *wherever* eBay presents a
  selection rather than at a named screen. This survives precisely because it
  is keyed to our behaviour and to the seller's task, not to eBay's layout.
- **Keep** the seed on screen — it becomes the thing the seller copies by hand,
  so it matters more in this branch, not less.
- **Remove** only wording that assumes a particular screen.
- **Relabel, because the label describes the action.** If the fallback stops
  putting the search in the URL, "We send eBay this search" becomes false and
  also tells the seller the wrong thing to do. It becomes **"Copy this search
  into eBay."** The text stays useful either way — in that branch it is the
  thing the seller carries by hand, so it matters more, not less.

  **Now enforced, not promised** (`tests/draft-review-screen.mjs`): the claim is
  asserted as an *implication* — if the note says we send the search, the
  link's `title` parameter must equal the seed shown on screen. Drop the
  parameter and the assertion fails, which forces the relabel rather than
  leaving it to whoever edits next.

  The existing no-deeplink branch was checked against this rule and already
  complies: it says "Copy the details above and search from eBay's own start
  page", never "we send". That is now pinned by two assertions rather than by
  wording.
- **Do not** hunt for further undocumented parameters to preserve prefill.
  Prefill is a convenience; the identity guarantee is the product. Chasing
  internals we cannot see documented (§2) trades a small convenience for a
  dependency that can break silently.

### 7.3 What a successful observation does and does not establish

It establishes **that tested case**: that account, that browser, that card, that
date. It is **not** a continuing compatibility guarantee — §2 already notes the
parameters are undocumented internals with no compatibility promise. This is why
the check is queued as recurring rather than closed once (Q-D5-3, accepted).

Until §7.1 is observed, **§8.3 stays Unverified** and the shipped copy stays as
it is — it says what we send and asks the seller to check what arrives, neither
of which depends on which screen eBay chooses.

## 8. Questions

- **Q-D5-1.** Can you run §6 in your signed-in browser and paste the four
  answers? It is the highest-value check left in D5 and I have no instrument for
  it. Alternatively, if you would rather I drive it, reconnect the browser on
  your machine and I will run it read-only in front of you.
- **Q-D5-2 — answered, recorded in §7.2.** Generic continuation with
  manual-copy instructions; identity verification preserved wherever eBay
  presents a selection; only screen-assuming wording removed; no hunting for
  more undocumented parameters. One thing I would flag rather than decide: this
  fallback keeps the seed sentence, since in that branch it becomes the text the
  seller copies. Say so if you would rather it went.
- **Q-D5-3 — answered, accepted.** Folded into the existing D5
  release-validation item, recording **date, account/browser context and
  result** per run, and stating in the item itself that a pass establishes that
  tested case only. Manual by necessity: it cannot be automated without a
  signed-in session the build environment does not have.

---

**Nothing pushed. Nothing deployed. Cert ID not rotated.** The eBay-side
questions above change copy and documentation only; none of them requires a
credential or a deploy to answer.

---

## 9. The observation (2026-09-08)

Owner-run, since the build environment has no signed-in instrument. Screenshot
retained at `audit/d5/evidence/2026-09-08-signed-in-ios-safari.jpeg`.

### 9.1 Context

| Field | Value |
| --- | --- |
| Date | 2026-09-08, 22:40 ET |
| Browser | **iOS Safari, mobile web** — Safari toolbar and `ebay.com` address chip visible in the screenshot |
| Opened in the eBay app instead? | **No.** It stayed in the browser. Recorded because app routing is a real mobile branch — **but see §9.6: an app hand-off is not automatically a failure.** My earlier note implied it was, which was wrong. |
| Account | Owner's, reported as signed in — see §9.3 |
| Card | Fixture: Charizard VMAX 074/073 Champions Path, `caty=183454` |

### 9.2 Result — the pass row of §7.1

| Criterion | Observed |
| --- | --- |
| **Is our search displayed?** | **Yes.** `Find a match` / `for "Charizard VMAX 074/073 Champions Path"` — verbatim. |
| **Is our category displayed?** | **Yes.** `Toys & Hobbies > Collectible Card Games > CCG Individual Cards`, the `caty=183454` we sent. |
| **Can the seller follow the hand-off instruction?** | **Yes.** Top pick: `Charizard VMAX (Secret) 074/073 Champions Path Holo`. The collector number is on screen and matches the number the check note tells them to compare against. |
| Final URL (evidence only) | Not readable from the screenshot — iOS Safari shows only `ebay.com`. **This is exactly the case §7.0 was corrected for:** the URL was never the criterion, and its absence here costs the observation nothing. |

So the inputs reached the workflow **and the instruction is performable on a
phone**, which is the surface a seller who just scanned a card is actually on.
eBay also pre-filled its own facet chips (`Card Name: Charizard VMAX`,
`Set: Champio…`) from our title.

**Not claimed:** the "Stage: Champion" mis-parse from the logged-out desktop run
is not visible in this screenshot — the chip row is cut off. Nothing here
confirms or contradicts it.

### 9.3 The one open item — and the standard for closing it, corrected

**Owner attestation is sufficient. Account chrome in the screenshot is not
required.** I had set the bar at visible account evidence; that was stricter
than necessary and it is the wrong instrument anyway, since eBay's simplified
prelist view carries no account chrome at all — the bar could never have been
met on that screen.

**As of this writing that attestation has not been given in words.** The link
was opened on request and the screenshot returned, and the request did say
"while signed in" — but I am not converting a compliance-shaped inference into
an owner attestation and filing it as the owner's word. That is the same
substitution I refused when I declined to report a logged-out run as the
signed-in answer, and it is worse here, because the record would attribute it to
him rather than to me.

So §8.3 turns on one sentence, and there are two routes to it:

1. **"Yes, I was signed in."** → recorded as **owner-attested**, and §8.3
   closes for that tested case (this card, this account, iOS Safari,
   2026-09-08).
2. **Uncertain** → don't reconstruct the earlier session. Confirm Seller Hub
   loads in that same Safari without a fresh sign-in, then reopen the test link.
   That produces a **fresh** signed-in observation, which is cleaner than
   reasoning backwards about a session that has since moved on.

Until one of those arrives, what is established is a **mobile-web run that
passes the criterion**. That is not nothing: §3's baseline was desktop and
logged out, so this is the first observation on the surface a scanning seller
actually uses, and the first to rule out an iOS app hand-off.

### 9.4 What this establishes

That tested case: this card, this account, iOS Safari, 2026-09-08. **Not a
continuing compatibility guarantee** — the parameters remain undocumented
internals (§2), which is why the recurring pre-deploy check stays in
`audit/RELEASE_VALIDATION_QUEUE.md` rather than being struck off.

### 9.5 Questions

- **Q-D5-4 — standard corrected, one sentence outstanding.** Were you signed in
  to eBay in that Safari session? A plain yes is enough and closes §8.3 for that
  tested case. If you are not sure, take route 2 in §9.3 rather than
  reconstructing it.
- **Q-D5-5 — answered, applied.** Both surfaces, mobile prioritised for the scan
  workflow, desktop retained for saved-collection sellers. Recorded in
  `audit/RELEASE_VALIDATION_QUEUE.md`.

### 9.6 Correction: app routing is not automatically a failure

§9.1 recorded that the link stayed in the browser and framed an app hand-off as
a loss — "somewhere our URL cannot reach". **That framing was wrong**, and wrong
in a familiar way: it judged the *route* instead of the *outcome*, the same
error the §7.0 correction fixed for the address bar.

The criterion is unchanged and does not care which application renders the
screen: **does the destination show our search and category, and are usable card
details in front of the seller to compare against?** An app that does that
worked. An app that opens to a home screen or a generic search with our details
gone failed — and so would a browser tab that did the same.

So app routing is **recorded, not scored**. It changes scope, not verdict: an
app path is a rendering surface we have never observed, so when it occurs the
run log notes it, and its destination and card details decide the result exactly
as a browser's would.
