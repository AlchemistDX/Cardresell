# Lane A, step 1 — a packet may not outlive the inputs it was built from

**Commit:** `db396da` · **Branch:** `phase1-block-d` · **Bundle:** `js/core.541c4c39.js` (unchanged by this work — server and tests only)
**Nothing pushed. Nothing deployed.** `origin/main` is still `9aaf326`.

Prior closures recorded, for context only: T2.10 accepted at `19cb94c` + `00445d0`; T2.9 accepted as the correction record. Neither is reopened here.

---

## 0. What this step was, and what it turned into

The instruction was to connect `buildListingPacket()` to the existing draft lifecycle, using the existing schema, storage reader, migrations and staleness policy.

Before connecting a producer, I checked what the already-integrated half actually does. It has a live defect, and the "reader is already wired" note carried in the plan is **too generous**. Both are below with evidence.

So this commit is groundwork, not the wiring: it makes the storage lifecycle safe to attach a producer to. **The producer is still unwired**, and §5 states the one decision that has to be taken before it can be, because it cannot be taken correctly without you.

---

## 1. The defect: a stale packet read back as current

`applyEdit` builds the next revision with `next = { ...current }` (`api/_draftStore.js:535`). The packet is a plain field, so it is carried across an edit byte-for-byte. `readStoredDraft` then validated only the **schema version**, which is untouched by a reprice, and returned the packet as `CURRENT` / `usable: true`.

Executed, not inferred — through the real edit path, not a hand-built row:

| | |
|---|---|
| Created | `price: 100`, packet reporting `pricing.listPrice: 100` |
| Edited | `applyEdit(d, { price: 500 })` |
| Read back | `packetStatus: 'CURRENT'`, `packetUsable: true`, packet still says `listPrice: 100` |

Nothing was wrong with that packet. It was simply about a price that no longer existed. This is the failure mode that shows a seller a **wrong number** rather than an error, and it is the more common of the two: version compatibility answers "can this reader parse the snapshot", never "does the snapshot still describe this draft".

## 2. The fix, and why it is not an invalidation in `applyEdit`

The obvious fix is to drop the packet in `applyEdit` when the price changes. **That fix is one write path wide.** `applyEdit` is not the only thing that can change a price — a migration, a repair script, a future bulk reprice, or simply the next edit path someone adds are each free to write a draft record without knowing packets exist, and each one silently reintroduces the same stale display.

So staleness is **derived at read time**:

- `packetInputFingerprint(draft)` (`api/_listingPacket.js:117`) fingerprints the draft fields the packet is a function of.
- `PACKET_INPUT_FIELDS = ['price', 'title']` (`api/_listingPacket.js:93`) — declared in the **packet** module, not the store, because the packet is the thing that depends on them: whoever adds a field to the packet is the one who must add it here, in the file they are already editing.
- `buildDraft` records it beside the packet (`api/_draftStore.js:526`), computed from the draft being built, never accepted from the caller — a caller that could supply its own fingerprint could declare a stale packet fresh.
- `readStoredDraft` recomputes it from the draft as it actually is and refuses the packet on mismatch (`api/_draftStore.js:416,418`).

A write path that has never heard of packets cannot defeat this: changing the price changes the recomputed fingerprint, and the mismatch is what makes the packet unusable. **Nothing has to remember to invalidate.**

### It reuses the existing policy rather than adding a second one

Per the existing asymmetry at `api/_draftStore.js:356` — the draft is authoritative and always readable, the packet is advisory and may be refused without taking the draft down with it:

- `packet` handed to the caller → `null`
- `packetUsable` → `false`
- `packetRaw` → the stale bytes, **preserved verbatim, never rewritten or deleted**
- the draft itself → reads fine, `ok: true`

New status `PACKET_COMPAT.STALE` (`api/_listingPacket.js:78`) is kept **distinct from `INCOMPATIBLE`** deliberately. Nothing is wrong with a stale record; it is simply no longer current. One means "recompute", the other means "your app is behind", and collapsing them would hand a seller the wrong instruction.

Two reasons are distinguished: `PACKET_INPUTS_CHANGED` and `PACKET_INPUTS_UNRECORDED`.

### Absence is not agreement

A packet stored with **no recorded fingerprint** cannot be shown to still match, so it reads `STALE` / `PACKET_INPUTS_UNRECORDED` rather than current. This is the same rule the version check already applies to a malformed version: unknown provenance is not current.

## 3. Provenance — the warning returns where it is justified

The gate was `!hasOwnProperty(draft, 'packet')`, so the presence of a packet **key** silenced `DRAFT_NO_PRICE_PROVENANCE`. It now requires the packet to **cover** the row (`api/_draftStore.js:310,313`): a recorded fingerprint that still matches the draft's current price and title.

A packet built against a different price documents the origin of a number that is no longer on the draft, so it leaves the current price exactly as unaccounted-for as having no packet at all.

Stated against your item 4: this is **not** manufacturing provenance to clear a warning. It is the opposite — letting the warning return when the thing that justified silencing it stopped being true.

## 4. Evidence

### 4a. Mutations (all restored; `draft-store` back to 125/0)

| Mutation | Result |
|---|---|
| absence treated as agreement (`storedInputs !== null && …`) | **1 red** |
| stale branch removed entirely | **5 red** |
| writer stops recording the fingerprint | **red at an existing version check** — by crash, dereferencing a null packet. A real red, but a noisy one, and worth saying plainly rather than counting it as a clean kill. |
| `quantity` added to `PACKET_INPUT_FIELDS` | **1 red** — the over-broad control |

That last row matters as much as the others. **Over-invalidation is its own defect**: it would throw away a good snapshot, and re-earn a `NO_PROVENANCE` warning, for editing a note. `quantity` and `notes` edits are asserted **not** to invalidate.

### 4b. New checks in `tests/draft-store.mjs`

Fresh read is `CURRENT`/usable · reprice through `applyEdit` still carries the bytes forward (the edit path does not know about packets and must not have to) · reader refuses it as `STALE`/`PACKET_INPUTS_CHANGED` · no packet handed to the caller · draft still reads fine at the new price · stale bytes preserved · title edit also stales · quantity and notes edits do not · unrecorded fingerprint is stale not current · version-ahead is `INCOMPATIBLE` not `STALE` · covered price makes no provenance finding · repriced-and-not-rebuilt raises `NO_PROVENANCE` again.

### 4c. Two fixtures were wrong, and only became visible now

**`tests/draft-store.mjs` `pk_stored`** spread a packet over `buildDraft`'s output, bypassing the writer that records the fingerprint. It therefore arrived looking like a packet stored by no known writer, and read `STALE` instead of exercising the version axis those checks are about. Now routed through `buildDraft`.

**`tests/draft-readiness.mjs` `base()`** carried `packet: { source: 'test' }` — not a packet, no schema version, no relation to the price — and its assertion name was literally *"base() carries a packet KEY, so it makes no provenance finding"*. That was true of the old gate, and it is exactly the semantics this commit changes: a non-packet counted as provenance for a $250 price. The assertion now requires the packet to cover the price; the old wording is kept in the test recording what it used to assert and why it changed; two negative controls were added.

### 4d. Suites

`draft-store` 111→**125/0** · `draft-readiness` **PASS** · `listing-packet-offline` 153/0 · `draft-review-screen` 180/0 · `draft-focus` 56/0 · `draft-crud-e2e` 130/0 · `draft-list-screen` 101/0 · `draft-index-recovery` 258/0 · `draft-list-cap` 130/0 · `quick-pricing` 219/0 · `launch-audit-regressions` 438/0 · `review-fee-dl` 21/0 · `accuracy-fee-parity` 41/0 · `asset-fingerprints` 15/0.

`tests/run-all.sh` was not run.

---

## 5. Correction to the plan: the chain has three gaps, not one

Your item 3 asks me to verify that create/save → reload → **review** uses the stored packet. **It cannot be verified as true today**, and the reason is larger than the missing producer:

| Hop | State | Evidence |
|---|---|---|
| Producer | **absent** | `buildListingPacket()` at `api/_listingPacket.js:368` has no production caller. The live bundle says so itself at `js/core.541c4c39.js:21230`. |
| Storage write | present | `api/_draftStore.js:526` — accepts a packet, validates it, now fingerprints it |
| Storage read | present | `api/_draftStore.js:356` — computes `packet`, `packetStatus`, `packetUsable`, `packetReason`, `packetRaw` |
| **Service** | **discards** | `api/_draftService.js:311` rebuilds the response as `{ ok, draft, validation, readiness }` and drops every packet field one line after `getDraft` returned them |
| **HTTP** | **never sees them** | `api/drafts.js:190` returns `{ draft, validation, readiness }` |
| **Client** | **no consumer** | the whole bundle contains three occurrences of "packet", all comments; zero reads of `packetUsable`/`packetStatus` |

So "the reader is already integrated" is true only of `readStoredDraft`. Everything it computes is thrown away before it reaches an HTTP response.

**I did not wire the forwarding in this commit, on purpose.** Forwarding a field that no producer creates and no client renders is a serialized-field-with-no-reader — already an open item in this repo — and your item 5 puts wire findings after the producer is connected. Producer, forwarding and consumer should land together, so the field arrives with something that reads it.

## 6. The decision I need before connecting the producer

`buildListingPacket` requires `ctx.feeModelRevision`, and **deliberately does not default it** (`api/_listingPacket.js` — a missing value is an `ERROR`, not a zero, because a fallback would let two fee revisions drift silently). The single source of truth is `FEE_MODEL_REVISION`, and it exists **only in `core.js`**, the browser bundle. The server has no copy. Same for the `pricing` and `basisMeta` inputs.

That leaves two placements, and I do not want to pick by default:

**Option A — server produces the packet, client declares the fee inputs.** One producer, server-side, next to the identity/title/category/aspects/condition it already derives from `card`. `feeModelRevision`, `pricing` and `basisMeta` arrive as declared client inputs, exactly as `price` and `priceSource` already do at `api/drafts.js` — a trust boundary already recorded as a Phase 2 item rather than papered over. If the client omits `feeModelRevision`, the packet gets `MISSING_FEE_MODEL_REVISION` and `blocked: true` — honest degradation, no invented value.

**Option B — client produces the packet and posts it.** The fee model, pricing and basis all live where the packet is built, so nothing is declared across a boundary. But `api/drafts.js` already **refuses** client-supplied `sku` and `title` precisely because a client that can post its own identity can create a draft that disagrees with the card the seller scanned. A client-supplied packet is a strictly larger version of that hole: it carries identity, title, category, aspects and pricing together.

My recommendation is **A**, because it keeps one producer on the side that already owns derived identity, and because it degrades to a visible `ERROR` rather than a plausible-looking wrong number. It does not close the fee-input trust boundary — nothing available in Phase 1 does — and I would record that rather than imply otherwise.

If A: the sole client change is to send `feeModelRevision`, `pricing` and `basisMeta` on create, and `packet` stays refused as a client input like `sku` and `title`.

## 7. Regeneration policy this establishes (your item 2)

- **Generated** once, at create, from the same `card` row identity is already derived from.
- **Regenerated** never automatically on the write path. A changed input makes the stored snapshot `STALE`, and the caller recomputes — which is the existing policy's own instruction (`api/_draftStore.js:356`: "the caller must recompute rather than show stale numbers").
- **Which changes count** is one declared list, `PACKET_INPUT_FIELDS`, checked structurally at read time rather than remembered at each write site.

This is the shape that satisfies "changed inputs cannot display stale numbers" without a second staleness mechanism. What it does **not** yet do is give the review screen something to recompute *with*, because of §5 — that is the next step, and it is gated on §6.

## 8. Unchanged and still open

Stale comment `core:2657-2659` and the duplicate clamp remain separate cleanup, per instruction. D3, BIAS-1, BIAS-6 and Q7 remain closed. §8 of the T2.9 packet — `feeBase`/`feeBaseLabel` on only 2 of 15 venues, **BIAS-10's remaining half, no ranking effect ruled out** — is untouched by this work. `DRAFT_NO_PRICE_PROVENANCE` still fires on every priced non-seller draft, now for the accurate reason that no packet covers the price.

Push and deployment gates remain closed. Phase 1: roughly 80–85% implemented; release validation outstanding.
