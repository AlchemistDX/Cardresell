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
photos stay in **the browser** that added them and do not travel with the draft.
(Corrected 2026-09-08 from "device" — see §6.1. Another browser on the same
device has separate storage, so "device" overstates the reach.)
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

### 5.1 SUPERSEDED 2026-09-08 by §6 — three states, on a false premise

**This section is retained, not deleted, because §6 corrects it and a correction
needs the thing it corrects.** Its state table is still right. Its premise —
that a small ordering record survives when image bytes do not — is **wrong**,
and every consequence drawn from it in §5.1-5.3 (separate storage to buy
survival, bytes-first write order, orphan deletion as a truth requirement)
followed from that error. Read §6 instead. Prior text preserved below.

The read-time absence case is not "no photos", and it must not render as "no
photos". Three states, and the middle one is the whole point of asking: never
added; added and present; added and gone. This is the withheld-versus-never-had
rule — two different facts must not render identically. **[The claim that the
ordering record "survives when the image bytes do not" is the superseded
premise. See §6.1.]**

With eBay the seller stands in front of the other party's screen and can compare
our claim against it. With eviction there is nothing to compare against, and if
the screen renders a lost photo as "never added", the seller's own memory is the
only contradicting evidence. **That part survives the correction** — it is why
§6 keeps an explicit unavailable state wherever the evidence for one exists.

### 5.2 SUPERSEDED IN PART — the medium argument

The cross-feature degradation argument stands and decides the medium: photos in
`localStorage` would consume quota that existing working behaviour depends on,
and the first casualty of a full quota is the next portfolio save, not the
photo. A portfolio defect with a photo cause, across a boundary neither
feature's code mentions. **IndexedDB it is.**

**Corrected:** this section proposed a quota-exhaustion measurement to size the
harm. Dropped — one device's ceiling does not establish a portable limit, and
the medium was never waiting on it. See §6.4.

### 5.3 SUPERSEDED 2026-09-08 by §6.2 and §6.3

Decided here that the order record is the index of truth, that bytes without a
record must be **deleted**, and that bytes are written before the record. The
authority half is kept (§6.2). The deletion-as-truth-requirement and the
bytes-first protocol are **withdrawn** — both were workarounds for the §5.1
premise, and an atomic transaction removes the problem they addressed (§6.3).

## 6. Corrected storage design (2026-09-08, supersedes §5.1-5.3)

Five corrections came back on review. Two invalidate premises, three simplify
the build. All five verified against the specs before adoption rather than taken
on assertion.

### 6.1 Separate records do not buy separate survival

The §5.1 design assumed a small ordering record could outlive the blobs, making
"added and gone" reliably detectable. **The Storage Standard says otherwise:**
"Whenever a storage bucket is cleared by the user agent, **it must be cleared in
its entirety**" ([Storage Standard](https://storage.spec.whatwg.org/)). Eviction
under pressure clears best-effort buckets wholesale; it does not pick records.
Separateness is a schema property, not a durability guarantee.

Consequences:

- **Detect "manifest present, bytes missing" where that evidence happens to
  survive** — partial loss is real (a failed write, a bug, a targeted clear) and
  the explicit unavailable state is still owed. It is no longer the *expected*
  shape of eviction.
- **Complete local loss is indistinguishable from first use, and the copy must
  not pretend otherwise.** Absence of a record does not establish that nothing
  was added. So the empty wording is **"No listing photos are available in this
  browser"** — never "nothing was added". That is a statement about what this
  browser holds, which is all we can see.
- **"This browser", not "this device"** — another browser on the same device has
  its own storage. The cross-device limitation copy (§3) takes the same
  correction: photos stay in **the browser** that added them.

### 6.2 The manifest is authoritative for order — and that is all it is

Kept from §5.3: an ordered manifest is the authority on sequence, and bytes not
named by it do not appear in the ordered listing. Orphan bytes carry no
sequence, so any order recovered from storage keys or timestamps would be
invented.

**Withdrawn:** that deleting them is *the only honest choice*. Excluding them
from the ordered listing is a bounded policy and is honest on its own. An
explicitly unordered recovery view — "these images are on this browser but we no
longer know their order; pick again" — would also be honest, and would not
destroy recoverable images. **D7 does not build it. That is a scope decision,
recorded as scope and not dressed as a truth requirement.** Reopening it costs
nothing later; deleting the bytes would have made it impossible.

Cleanup is likewise narrowed: no sweep that deletes blobs merely for being
unreferenced, because that races another tab mid-addition. Blob deletion happens
only in the same transaction as its manifest removal.

### 6.3 One atomic transaction, not a hand-rolled ordering protocol

Manifest and blobs go in **separate object stores in one IndexedDB database**,
and every addition or removal commits both in **one `readwrite` transaction**
spanning both stores. Atomicity is the store's job, not ours — the bytes-first
write order in §5.3 was rebuilding by hand a guarantee IndexedDB already gives,
and rebuilding it badly, since a crash between the two writes still left an
inconsistent pair.

**Success is the transaction's `complete` event, never an individual request's
`success`.** MDN is explicit that request success "does not mean the item has
been stored successfully in the DB"
([MDN, IDBTransaction](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction)).
Reporting saved on request success would be the 2026-09-04 portfolio defect
rebuilt in a new store: UI closing over a write that never landed.

### 6.4 Two simplifications

**Rule 1 does not require refactoring `_lsWrite`.** A dedicated asynchronous
photo store is a *different* business behaviour from synchronous settings
persistence, so a second write path is not the duplication Rule 1 forbids. What
must be shared is the **error classification and the user-facing copy** — quota
versus blocked versus private mode — so a storage failure reads the same
wherever it happens. Nine existing call sites stay as they are.

**Stable IDs, and renumbering is normal.** Each photo keeps a stable id for its
lifetime; the manifest holds the order. After a removal, survivors keep their
relative order and their visible positions renumber — that is expected
behaviour, not the silent-renumbering defect §4 warned about. The defect is
losing *relative* order, not closing a gap in display numbering.

**Validation reuse is conditional on checking it.** Reuse image decoding and the
HEIC guidance, but the scan QC gates were tuned to reject photos that break
*recognition* (`js/core.a7e7422d.js:15330`). A listing photo has no recognition
job. Each gate gets checked before it becomes a listing-photo rejection rule; any
that is scan-specific is not inherited.

### 6.5 What D7 verifies — BUILT, store layer green (2026-09-08)

Implemented in `js/core.ea2f03c4.js` (generation 11) and verified by
`tests/listing-photos.mjs`, **41 checks, 0 failures**, in real Chromium against
the real bundle. Not a fake: the property under test is a transaction property,
so a stub would be testing the stub.

| # | Owner-specified case | Check | Result |
|---|---|---|---|
| 1 | reload / order / removal | §1, 9 checks | green |
| 2 | transaction failure leaves no partial state | §2, 7 checks | green |
| 3 | manifest entry with missing bytes | §4, 4 checks | green |
| 4 | complete local absence | §5, 6 checks | green |
| 5 | no image upload | §6, 4 checks | green |
| + | two tabs adding to one draft | §3, 4 checks | green |
| + | failure copy names only what is established | §7, 7 checks | green |

**The abort case is built the way it was asked for**: the fault fires *after*
every blob `put` has reported `success` and *before* the manifest write and
commit. It asserts the caller sees a rejection, no ghost blob survives, the
manifest is byte-identical to before, and the store still works afterwards. If
request-success had been treated as storage, that call would resolve and two
orphan blobs would remain.

**First run found a bug in the check, not the store.** "No POST during the page
lifetime" failed on a page-load beacon to `/api/events` with an empty body.
Probed directly before touching anything: the beacon fires twice *before* any
photo call, and the add issues zero requests. Fixed in the check — the window
is now scoped to the add, plus a second assertion that holds independently of
any window (no request carries a non-empty body while photos are in play) and a
third (no request goes to an upload-shaped URL). The store was never relaxed.

**Limit stated plainly.** This suite covers the store, not a screen. There is no
photo UI yet, so nothing here proves a seller ever sees the unavailable state or
the browser-local line — only that the store reports them and the strings say
what §6.1 requires. Rendering is the next step and is unverified.

**Not registered** in `audit/RELEASE_VALIDATION_QUEUE.md` or
`audit/SUITE_COVERAGE_INTERRUPTIONS.md`. Registration happens at D7 closeout;
recorded here so the gap is written down rather than discovered.

### 6.6 Original list

### 6.5 What D7 verifies

Owner-specified, all in the existing browser workflow, none needing an account:

1. reload, order, and removal survive round-trip
2. transaction failure leaves no partial state and reports honestly
3. a manifest entry whose bytes are missing renders the explicit unavailable
   state
4. complete local absence renders "no listing photos in this browser" — and not
   a claim about history
5. no request carries image bytes

**No quota-exhaustion experiment.** It cannot choose the medium (§5.2 already
did, at any quota) and one device's ceiling is not a portable limit.

None of the three needs an account or a signed-in browser. (1) needs a device,
(2) and (3) need the rendered screen. That makes D7 the block's cleanest
remaining run of work — but not because it has no boundary. Because its
boundary is one we can see from here.
