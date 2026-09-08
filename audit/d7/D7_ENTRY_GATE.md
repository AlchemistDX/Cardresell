# D7 Entry Gate — local listing photos

**Written 2026-09-08, before any D7 code.** Branch `phase1-block-d`, tip
`2640032`, nothing pushed, nothing deployed.

Requirement, unchanged: *"Ordered local photo state, validation, removal, and
cross-device limitation copy; no server upload"*
(`audit/TODO_PHASE1.md:23`, `audit/CARDRESELL_PLAN_AND_ROADMAP.md:561`).
Reconciliation: **not implemented** — a grep for listing-photo state returns
nothing, and the scan-local photos that do exist are a different thing
(`audit/PHASE1_RECONCILIATION_2026-09-08.md:100`).

D7 reads as the clean one: no venue, no hand-off, nothing keyed to eBay. That is
true of the *venue* boundary and false of the storage one, and this gate is
about the boundary that is actually there.

## 1. The boundary D7 does have

Photos live on the device. The **browser's storage engine** decides whether they
stay there, and it is not obliged to tell us when they do not. Origin storage
can be evicted under pressure, cleared by the user, or dropped by private-mode
rules, all **after a write we observed succeed**, with no event we listen for.

That is `audit/PATTERN_DISCLOSURE_OWNERSHIP.md` one layer down. Not eBay's
behaviour — the browser's — but the same shape: a state we assert, maintained by
someone else, with no signal on our side when it stops being true.

**The asymmetry that matters, and it is already half-solved.** Write failure is
detectable and the app already handles it honestly: `_lsWrite` (`js/core.a7e7422d.js:18442`)
catches `QuotaExceededError` and its Safari/Firefox aliases, records
`window._lastStorageFailure`, and returns `false` so callers keep the modal open
instead of closing over a discarded write. `storageFailureMessage()` (`:18460`)
says so in plain language. Nine call sites use it. That entire mechanism exists
because of a 2026-09-04 audit where a full-quota device silently dropped a
portfolio save and the UI re-rendered as if it had worked.

**Eviction after a successful write has no equivalent and cannot have one.**
There is no callback. The only honest detection is *read time*: the photo we
stored is not there. So D7's failure story is not "warn on write" — that part is
inherited — it is **what the screen says when a photo the seller added is gone
at read time.** That is the design question, and it is the one a photo feature
that "just stores locally" would never think to ask.

## 2. Storage medium — an open question, not a detail

`indexedDB` appears **zero times** in the live bundle. All durable client state
goes through `localStorage` via `_lsWrite`.

`localStorage` holds strings, so photos would have to be base64 data URLs, which
inflate the bytes and share one small origin-wide quota with the portfolio,
flips, grading and seller-profile data that already live there. A handful of
card photos plausibly exhausts it — and the *first* casualty of a full quota is
not the photo, it is the next portfolio save, which is existing working
behaviour.

**This must be measured, not estimated.** No figure goes in this document or the
UI until D7 writes real photos on a real device and observes the ceiling; quotas
differ by browser, by private mode, and by available disk. Stating a megabyte
number now would be the §5.3 defect from D6 committed against our own platform.

IndexedDB is the technically correct medium — blobs, no base64 inflation, a
larger budget — and adopting it is **new infrastructure**, not a swap. It is
asynchronous, so `_lsWrite`'s synchronous success/failure contract does not
carry over, and Rule 1 says one business behaviour gets one implementation. A
second durable-write path would be exactly the duplication Rule 1 forbids unless
the first is refactored to cover both.

Not decided here. It is the first D7 decision and it wants a measurement.

## 3. Cross-device copy — unconditional, for the D6 reason

Drafts are server records in KV; photos would be device-local. So a draft opened
on a second device has no photos, and **that device cannot know any exist** — it
holds no record of them. Conditioning the limitation copy on "this draft has
photos elsewhere" is unanswerable, exactly as D6's "is this seller new" was
(`audit/d6/D6_ENTRY_GATE.md` §1-2).

So the copy is unconditional and states the rule rather than this draft's state:
photos stay on the device that added them and do not travel with the draft.
Same resolution, and reached the same way — by finding no signal we own rather
than by preference.

## 4. What "ordered" and "validation" must not quietly become

- **Ordered** means the seller's chosen order survives reload and removal, and
  is observable. An array index is not an order if a removal renumbers silently.
- **Validation** reuses the existing photo QC gates (`js/core.a7e7422d.js:15330`,
  and the HEIC message at `:15244`) rather than growing a second set of rules
  for listing photos. Rule 1. If listing photos genuinely need different
  thresholds than scan photos, that is a decision to record, not a fork to make
  quietly.
- **Removal** must be honest about what it does: it deletes from this device.
  There is nowhere else for it to delete from, which is worth one clause.
- **No server upload** is the only requirement here that is trivially
  satisfiable and permanently checkable — a test can assert no request carries
  image bytes.

## 5. Entry gate

Open before code:

1. **Storage medium** — `localStorage` data URLs or IndexedDB blobs. Needs a
   real measurement of the current quota headroom on a real device, and, if
   IndexedDB, a decision on whether `_lsWrite`'s contract extends or a second
   path is justified.
2. **Read-time absence** — what the screen says when a stored photo is gone.
   The one genuinely new failure mode; everything else is inherited.
3. **Validation reuse** — confirm the scan QC gates are the right gates, or
   record why listing photos differ.

### 5.1 Question 2 sharpened — three states, not two

Added on review. The read-time absence case is not "no photos", and it must not
render as "no photos". There are **three** states and the middle one is the
whole point of asking:

| State | What we know | What the screen owes |
|---|---|---|
| Never added | no record of any photo for this draft | the ordinary empty prompt |
| Added, present | records and bytes both here | the photos |
| **Added, gone** | **a record says photos existed; the bytes are absent** | **say so** |

This is the withheld-versus-never-had rule. Two different facts must not render
identically, and the difference is cheap to keep: the ordering record is small
and survives when the image bytes do not, so *"photos were here and are not
now"* is knowable **even though why is not.** We can state the absence honestly
without claiming a cause — we were not told, and guessing between eviction,
private mode, and a user clearing storage would be inventing a reason.

Worth naming why this is a harder version of the eBay case rather than a
milder one: with eBay the seller is standing in front of the other party's
screen and can compare our claim against it. **With eviction there is nothing to
compare against.** The photo is simply not there, and the only party who could
have said so did not. If the screen renders it as "never added", the seller's
own memory is the only contradicting evidence, and they will assume they are
wrong.

Design consequence: the ordering record must be stored **separately from the
image bytes**, so it can survive them. If order and bytes live in one blob,
losing the bytes loses the evidence that anything was lost, and the third state
becomes unrepresentable.

### 5.2 The medium argument, restated — and what the measurement is now for

The strongest case against `localStorage` is not size. It is that **photos would
consume a quota that existing working behaviour depends on, and the failure would
land somewhere unrelated to the feature that caused it.** The first casualty of
a full quota is the next portfolio save, not the photo. Nothing on the screen
would connect a photo added on Tuesday to a card that would not save on Friday,
and the seller would experience it as the portfolio breaking.

That is not a photo defect with a storage cause. It is **a portfolio defect with
a photo cause** — a new feature quietly degrading an old one, across a boundary
neither feature's code mentions. The existing `_lsWrite` machinery would report
it accurately and still misattribute it, because it reports the write that
failed, not the feature that consumed the room.

So IndexedDB's async contract and its Rule 1 question are real work weighed
against the wrong alternative. The alternative is not "a smaller budget."

**This changes what the measurement is for.** It no longer decides the medium —
the cross-feature degradation argument does that on its own, at any quota. The
measurement now sizes the harm and sets urgency: how many photos it takes before
an existing feature starts failing. Recorded because a later reader will
otherwise see a pending measurement and assume the decision is waiting on it.

None of the three needs an account or a signed-in browser. (1) needs a device,
(2) and (3) need the rendered screen. That makes D7 the block's cleanest
remaining run of work — but not because it has no boundary. Because its
boundary is one we can see from here.
