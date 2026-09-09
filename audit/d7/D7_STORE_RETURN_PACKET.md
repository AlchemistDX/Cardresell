# D7 Return Packet — the store layer

**Commit `c8a8174`** on `phase1-block-d`. Bundle generation 11,
`js/core.ea2f03c4.js` (22,969 lines). Clean tree. **Not pushed, not deployed.**

This packet is self-contained: everything needed to review the work is below,
including the copy, the validation decisions, and the limits.

---

## 1. What was built

The store layer only. **There is no photo UI yet.** Nothing here proves a seller
ever sees the unavailable state or the browser-local line — only that the store
produces them and the strings say what the design requires. Rendering is the
next step and is unverified.

Both carried-in details are implemented and tested rather than asserted.

### Shape

| Store | Key | Holds |
|---|---|---|
| `manifest` | `draftId` | `{ draftId, order: [photoId, …] }` — the authority on sequence |
| `blobs` | `id` | `{ id, draftId, blob, type, name, addedAt }` |

Separate object stores, **one database**, one `readwrite` transaction spanning
both for every addition and every removal.

### The four refusals, written at the top of the module

1. **Never reports a save on a request's `success`.** Success is the
   transaction's `complete` event. Reporting on request success would rebuild
   the 2026-09-04 portfolio defect — UI closing over a write that never landed —
   in a new store.
2. **Never writes back a manifest captured earlier by the UI.** It is read *and*
   modified inside the write transaction.
3. **Never guesses why a write failed.**
4. **Never claims history from an absence.**

### Detail 1 — read-modify-write inside the transaction

`photosAdd` opens the transaction first, then `get`s the manifest row from
inside it, appends, and `put`s it back before commit. There is no code path that
accepts an order array from a caller. Verified with two pages in one browser
context, both holding the same stale view, adding simultaneously: all three
photos survive. A store that wrote back a UI copy would end with two.

### Detail 2 — failure copy that does not guess

| Condition | Message |
|---|---|
| `QuotaExceededError` (or `NS_ERROR_DOM_QUOTA_REACHED`, code 22/1014) | "Your browser storage is full, so these photos could not be saved. Free up space and try again." |
| Per-draft cap reached | "You can add up to 12 photos to a listing. Remove one to add another." |
| Anything else | "These photos could not be saved in this browser, so they were not added." |

Private mode is **never named**. It is not inferable from a failed write, and
naming it would be a cause we were not given. The quota case is named because
the browser established it. Classification is shared with the `localStorage`
path so a storage failure reads the same wherever it happens; the nine
`_lsWrite` call sites are untouched.

---

## 2. Copy in this build

**Empty state** — `No listing photos are available in this browser.`

Scoped to what this browser holds. Makes no claim about what was added, because
a bucket is cleared in its entirety and complete local loss is
indistinguishable from first use.

**Missing bytes** — `This photo is no longer available in this browser.`

Distinct string from the empty state, by the withheld-versus-never-had rule.
Asserted distinct in the suite, so the two cannot converge by later editing.

**Browser-local limitation, unconditional** —

> Photos stay in the browser that added them. They are not uploaded, and they
> will not appear on your other devices or in another browser.

Unconditional for the D6 reason: there is no signal on our side about the
seller's other devices. "Browser", not "device" — another browser on the same
machine has separate storage. The suite asserts it contains no `if you` or
`when applicable` hedge, so the conditional form cannot creep back in.

---

## 3. Validation decisions

**Reuse is conditional on checking each gate, and the check is not done yet.**

Scan QC (`js/core.ea2f03c4.js`, the scan path) was tuned to reject photos that
break *recognition*. A listing photo has no recognition job, so a gate that
protects the scanner is not automatically a listing-photo rejection rule.

| Gate | Disposition |
|---|---|
| Image decodes at all | **Inherit** — an undecodable file is useless to both |
| HEIC guidance message | **Inherit** — same user problem, same wording |
| Blur / focus threshold | **Do not inherit** as a rejection. A soft photo is a bad scan and an acceptable listing photo. Advisory at most. |
| Crop / card-fills-frame | **Do not inherit.** A listing photo may deliberately show a slab edge or a back. |
| Glare | **Undecided** — needs the rendered screen to judge |

This build enforces **none** of them: `photosAdd` accepts what it is given. The
gates land with the UI, and each one that lands will be argued individually
rather than inherited as a set.

**Cap: 12 per draft.** A partly-fitting batch truncates and reports `skipped`
rather than rejecting the whole batch; adding to a full draft rejects with
`PHOTO_LIMIT`, which reads as a cap and not as a storage failure.

---

## 4. Verification

`tests/listing-photos.mjs` — **41 checks, 0 failures**, real Chromium against
the real bundle. The property under test is a transaction property, so a stub
would be testing the stub.

| Case | Checks |
|---|---|
| reload, order, removal | 9 |
| **abort after blob success, before commit** | 7 |
| two tabs adding to one draft | 4 |
| manifest entry with missing bytes | 4 |
| complete local absence | 6 |
| no image upload | 4 |
| failure copy | 7 |

The abort case fires the fault *after* every blob `put` has reported `success`
and *before* the manifest write and commit, then asserts: the caller sees a
rejection; **no ghost blob survives**; the manifest is byte-identical to before;
the store still works afterwards. Had request-success been treated as storage,
that call would resolve and two orphans would remain.

### The one failure, and why it was the check's bug

First run failed "no POST during the page lifetime" on a page-load beacon to
`/api/events` with an empty body. Probed directly before changing anything: the
beacon fires **twice before any photo call**, and the add issues zero requests.

Fixed in the check, not by relaxing the store. The window is now scoped to the
add, and two further assertions hold independently of any window — no request
carries a non-empty body while photos are in play, and no request goes to an
upload-shaped URL.

### Other suites after the bundle rename

listing-photos 41 · asset-fingerprints 62 · launch-audit-regressions 438 ·
deeplink-companions 178 · draft-review-screen 338 · draft-store 147 ·
decision-restatements 33. All run individually. `tests/run-all.sh` not run.

`draft-review-screen` failed 2 on its first post-rename run and passed 338/0 on
three consecutive reruns. **Recorded as suspected flake, not as green** — an
intermittent suite is a finding, and it is on the open list rather than
explained away.

### Bundle rename

`a7e7422d` → `ea2f03c4`; `index.html:3807`; citation map generation 11.
`git mv` removed the retired generation and `asset-fingerprints` caught it —
the generation-8 mistake repeating and being stopped by the check written for
it. `a7e7422d` restored with matching bytes.

---

## 5. Open, and not presented as solved

1. **No UI.** Nothing renders. Five verified cases are store-level.
2. **Validation gates unenforced** — dispositions above are decided, not built;
   glare undecided.
3. `tests/listing-photos.mjs` **not registered** in
   `audit/RELEASE_VALIDATION_QUEUE.md` or `audit/SUITE_COVERAGE_INTERRUPTIONS.md`.
   Registration is a D7 closeout item.
4. **`draft-review-screen` flake** unexplained.
5. Recovery of orphan bytes is **out of scope by decision** (§6.2), not
   impossible — the bytes are not deleted, so it stays reopenable.
6. Carried: D5's four signed-in checks; D6's wording pass and presence test; no
   verified Phase 1 percentage replaces the withdrawn figures.

**Push and deployment remain blocked. The rotation gates pushing.**
