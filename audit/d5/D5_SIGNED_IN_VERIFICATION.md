# D5 — Signed-in continuation: what I could verify, and the one check I cannot run

**Date:** 2026-09-08 · **Branch:** `phase1-block-d` · **Live bundle:** `js/core.fa9c358d.js` (`index.html:3834`)
**Suite:** `draft-review-screen` **365 passed, 0 failed**
**Status: signed-in behaviour still UNVERIFIED. Nothing pushed, nothing deployed.**

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
| 4. **Is the query still in the address bar after landing?** | **Yes.** Final URL identical to the sent URL — both `title` and `caty` present, no redirect, no strip, no rewrite. |

So the failure mode step 4 was written to catch — a query dropped in transit,
the same way the dead scan-miss link died — **does not happen logged out today.**

## 4. One new finding, and it supports copy we already ship

eBay pre-filled its own facet chips from our title: `Card Name: Charizard VMAX`,
`Set: Champions Path`, and **`Stage: Champion`**.

The first two are right. The third is eBay's matcher mis-parsing "Champions
Path" — a set name — into a "Stage" attribute. Nothing we sent said "Champion".

This is worth recording because it is the first *direct* observation of the
thing the shipped seed note asserts: "Their matcher decides what it matches, it
does not always answer the same way twice, and their catalogue sometimes
disagrees with ours." That sentence was previously reasoned from the sell-start
contract; it now has an instance behind it. It also strengthens the case for the
identity check being the loud line on the screen (full `--text`, WARNING
severity) while the seed and limits notes stay muted: the seller really does
have something to check.

**Not claimed:** that this mis-parse is stable, reproducible, or affects the
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

`draft-review-screen`: **365 passed, 0 failed** (was 363).

## 6. The check itself — four steps, five minutes, your account

Self-contained. Nothing else needs to be open.

1. Signed in to eBay, open:
   `https://www.ebay.com/sl/prelist/identify?title=Charizard%20VMAX%20074%2F073%20Champions%20Path&caty=183454`
2. Does the "Find a match" screen appear — or does eBay send you to Seller Hub,
   a restored draft, or a different screen?
3. Does it show `Charizard VMAX 074/073 Champions Path` as the search, and is
   `074/073 Champions Path` the collector number on the top offered match?
4. **After it settles, is the query still in the address bar** — are both
   `title=` and `caty=` still there, unchanged?

**Please do not click a match or continue past that screen.** Landing is
read-only; continuing begins a real listing on your account.

## 7. Pre-committed consequences, so the result decides rather than the reading

Written before the observation, so no outcome can be argued into a pass.

| Result | What it means | What I do |
| --- | --- | --- |
| All four match §3 | Signed-in behaviour equals the logged-out baseline. The exact-search note describes what the seller sees, and §8.1's compare-the-number instruction is performable. | Close §8.3, record the observation with its date, and leave the copy alone. |
| Screen appears, **but the query is gone** from the address bar (step 4 fails) | The parameters are dropped for signed-in sellers. This is the dead-scan-miss failure mode, and it breaks §8.1: the seller is told to compare against a number that never arrived. | **Blocker.** The seed note's "we send eBay this search" becomes misleading in practice, and the identity check becomes unperformable. Copy changes before D5 closes. |
| Screen appears with the search, but the **top match is a different card** | eBay's matcher disagreed. Already disclosed; not a defect in our behaviour. | No code change. Record it as a second instance behind the seed note. |
| eBay routes you somewhere else entirely (Seller Hub, restored draft) | The note describes a screen the seller never sees. | **Blocker**, and the more serious one: §8.1's instruction is addressed to a screen that is not in front of them. |
| Something else | — | Report it verbatim; I will not classify it in advance. |

Until one of those rows is observed, **§8.3 stays Unverified** and the shipped
copy stays as it is — it says what we send and asks the seller to check what
arrives, neither of which depends on which screen eBay chooses.

## 8. Questions

- **Q-D5-1.** Can you run §6 in your signed-in browser and paste the four
  answers? It is the highest-value check left in D5 and I have no instrument for
  it. Alternatively, if you would rather I drive it, reconnect the browser on
  your machine and I will run it read-only in front of you.
- **Q-D5-2.** If step 4 fails — the query dropped for signed-in sellers — do you
  want the hand-off to **keep the link and change the copy** (drop the exact
  search sentence and the compare-the-number instruction, keep the button), or
  **hold the link** until we find a parameter form that survives? My inclination
  is the first: a seller can still list, and a hand-off with honest copy beats
  no hand-off.
- **Q-D5-3.** The `title`/`caty` parameters are undocumented internals with no
  compatibility promise (§2). Do you want a release-validation item that re-runs
  §6's four steps before each deploy, so a silent change on eBay's side surfaces
  as a failed check rather than as a seller's confusion? It is cheap and manual;
  it cannot be automated without a signed-in session we do not have.

---

**Nothing pushed. Nothing deployed. Cert ID not rotated.** The eBay-side
questions above change copy and documentation only; none of them requires a
credential or a deploy to answer.
