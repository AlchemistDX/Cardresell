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

None of the three needs an account or a signed-in browser. (1) needs a device,
(2) and (3) need the rendered screen. That makes D7 the block's cleanest
remaining run of work — but not because it has no boundary. Because its
boundary is one we can see from here.
