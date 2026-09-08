# Lane A, step 1 — a packet may not outlive the inputs it was built from

**Commits:** `db396da` (staleness) · `2cc7c6b` (review items) · `3db7169` (producer connected) · `af65ece` (fee-schedule stamp) · `1303b7f` (two price conditions) · **Branch:** `phase1-block-d` · **Bundle:** `js/core.541c4c39.js` (unchanged by this work — server and tests only)
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

## 7b. Producer connected — `3db7169`

Option A adopted, on your sharper argument: a client packet is not a widened boundary, it is a **bypass** of the `sku`/`title` refusal by nesting. `packet` now joins that refuse-don't-drop list.

- **Placement:** `normalizeCreateInput`, beside `skuFor` / `identityReadiness` / `buildListingTitle` — the function that already is the server's derivation of the scanned card.
- **Client declares four:** `feeModelRevision`, `feeScheduleVerified`, `pricing`, `basisMeta`, in a named `pricingContext` envelope so the declared set is visible in one place.
- **Context assembled field by field, body never spread.** `now` and `maxTitleLength` are server-set and *refused* if a client sends them — a client-chosen clock could date a stale comp to whenever it liked. The two client objects pass whole only because the builder already whitelists them (`stampPriceBasis` eight keys, `pricing` five); a second whitelist would be a thing to drift against the first.
- **No default.** Absent revision → `MISSING_FEE_MODEL_REVISION`, `blocked: true`, and the create still succeeds. A blocked packet is a bad snapshot, not a bad draft.

### Retry safety needed a new kind of table entry

The packet stamps `priceBasis.retrievedAt` from the clock, so an identical request retried a second later produces different bytes. Counting it toward mutation identity would refuse that retry as key reuse — ordinary network retry turned into a hard failure. Rather than loosen the undeclared-field guard (the one that caught `priceSource` missing from the fingerprint), `_idempotency.js` gains `DERIVED_FIELDS`: a named table of fields skipped rather than fingerprinted, with declaring a field in both tables a hard error. Proven by behaviour — two creates on one key, 1.1s apart, verified to produce different stamps and still `REPLAYED`.

### An over-suppression I shipped, and the suite caught

My first cut had the covering packet gate **both** arms of the provenance check, and `a $0 draft still reports WHERE the 0 came from` went red. **The test was right.** `SELLER_PRICED` is not "we cannot tell where this came from" — it discloses that the seller typed the number, and a packet documents a *comp basis* without converting a seller-entered price into a comp-derived one. Suppressing it would have told a seller their own number was market-derived.

The arms are now separate: `SELLER_PRICED` fires on any present seller-sourced price regardless of packet; only `NO_PROVENANCE` stands down under coverage. The asymmetry is worth naming — a warning that wrongly disappears is invisible, one that wrongly appears is merely noise, so this arm errs loud.

### 22 new checks (`draft-crud-e2e` 130 → 152/0)

Packet sku/title equal the stored server-derived ones · declared revision recorded · basis stamped absolute with no age key · a feed with no as-of date not claimed as dated · `NO_PROVENANCE` absent on create **and after reload** · reprice through the real service path stales it, the warning returns, the draft still reads fine at $500 · `SELLER_PRICED` not suppressed · client packet refused · three server-owned ctx fields refused · bare create blocked-but-successful · retry replays.

**Suites:** `draft-crud-e2e` 152/0 · `draft-store` 125/0 · `draft-readiness` PASS · `listing-packet-offline` 160/0 · `draft-index-recovery` 258/0 · `draft-list-cap` 130/0 · `draft-focus` 56/0 · `draft-list-screen` 101/0 · `draft-review-screen` 180/0 · `quick-pricing` 219/0 · `launch-audit-regressions` 438/0 · `review-fee-dl` 21/0 · `accuracy-fee-parity` 41/0 · `asset-fingerprints` 15/0.

### Still not on the wire, deliberately

`_draftService.readDraft` still discards the five packet fields, and the comment at that line now says why. The client sends no `pricingContext` yet, so **in production today every packet would be blocked with `MISSING_FEE_MODEL_REVISION`** — the honest state, and the reason forwarding and the client change should land together as the next step.

## 7c. Two findings from sequencing the client change second — `af65ece` and one open

Both were found by starting the client wiring and *reading what it would have to send*, before any renderer existed. Neither would have surfaced as a red test, and both would first have appeared as a review-screen bug.

### Fixed — the fee-schedule stamp was silently null (`af65ece`)

Three defects stacked:

1. The `buildListingPacket` docblock said `feeScheduleVerified` comes from `PLATFORMS.ebay.verified`. **No such field exists.** The real one is `feeAuditedOn`. That docblock is the only instruction whoever wires a caller gets.
2. `feeAuditedOn` is `'2026-09-01'`, and `normalizeVerifiedStamp` accepted `YYYY-MM` and `Mon YYYY` only — so `YYYY-MM-DD` fell out as `null`.
3. **A null result was reported nowhere.** No code, no severity, no note.

(3) is what made (1) and (2) invisible: a client wired from the docblock produces a clean-*looking* unblocked packet with a missing field. `TAXONOMY_VERSION_ASSUMED` in the same table does the right thing for the same situation, which is what makes this an omission rather than a decision.

Fixed on the function: `YYYY-MM-DD` accepted with the day dropped (a fee schedule has month granularity), *not* widened into a general date parser; docblock corrected and told to stop saying `.verified`; and two codes split — `FEE_SCHEDULE_DATE_ABSENT` (incomplete caller) vs `FEE_SCHEDULE_DATE_UNPARSEABLE` (**format drift** — the venue table moved and this module didn't hear). Neither blocks; both stay `null` rather than defaulting to this month. `listing-packet-offline` 160 → **175/0**.

### OPEN, needs a decision — the packet's `pricing` field has no producer

`buildListingPacket`'s docblock says `pricing` is "the `listPriceForTargetNet` result". **`listPriceForTargetNet` has no production caller.** It is defined in the live bundle at `js/core.541c4c39.js:7658` and called only from `tests/listing-packet-offline.mjs`, which extracts it by source text. Same in every retained bundle generation.

This is the second instance of the exact shape Lane A exists to remove — `buildListingPacket` had no production caller until `3db7169`; its `pricing` input still has no production producer — and it is the `marketAskDivergence` read-by-nobody family from the other direction.

It blocks the client change, because there are only three things the client could send and two are not allowed:

| Option | Verdict |
|---|---|
| Call `listPriceForTargetNet` at create time with a target the seller never set | **Refused** — invented input to a fee model |
| Send `pricing` built from the draft price by hand | **Refused** — second implementation of the inversion |
| Omit `pricing` | Honest, but see below |

Omitting it is honest and is what the producer does today, with one consequence worth deciding rather than absorbing: **`NO_PRICE` fires on a draft that has a price.** The trigger is `!pricing || pricing.ok !== true || !(pricing.listPrice > 0)`, and the message is *"No list price computed. Set a target payout to get one."* The code name claims one thing, the message claims another, and the trigger tests the second. The packet **never sees the draft's price at all** — `row` is the card, and `stampPriceBasis` keeps eight named keys that do not include `basisMeta.value` — so it cannot currently tell the difference between "unpriced draft" and "priced draft, no target-payout inversion".

On a $250 comp-priced draft the packet would therefore render a warning telling the seller to set a target payout, next to a price. That is the "stamp a lie" shape, and it is why the client change is paused here rather than shipped.

Three ways out, not chosen:

- **(a) Rename to what it tests** — `NO_TARGET_NET_PRICING`, message adjusted. Cheapest; leaves the packet still blind to the draft price.
- **(b) Let the packet see the price** — the client already sends `price`/`priceSource` as declared inputs, so passing them into `packetCtx` widens nothing. Then `NO_PRICE` means what its name says, and the inversion gap becomes a separate, correctly-named note.
- **(c) Give `listPriceForTargetNet` its production caller** — the largest, and arguably the real fix, since a target-payout feature that exists in tested code and not in the product is its own finding.

(b) looks right for this lane and (c) looks like its own piece of work, but this is a decision, not a cleanup.

## 7d. (a)+(b) landed together — `1303b7f`

Both defects fixed, neither standing in for the other.

- **`NO_PRICE` now tests the draft's own price** and says *"This draft has no price yet."* `packetCtx` receives the **server-normalized** `price`/`priceSource` — for the same reason `sku` and `title` are server-derived: reading the raw client field would let a packet document a price the store rejected or coerced. Absence is the test, not falsiness — **$0 is a price** on venues that permit one.
- **`NO_TARGET_NET_PRICING`** names the inversion gap separately, non-blocking. A seller can list a priced draft without ever asking "what price nets me $X".
- **`PRICE_BASIS_NOT_SOURCE_OF_PRICE`** — this fell out of giving `priceSource` a real job rather than passing it unread. It is the packet-level form of `SELLER_PRICED`: a basis stamped beside a seller-typed price is market **context**, not that price's provenance, and a review screen reading the packet must not present the two as the same claim. **Warned, not stripped** — the basis is genuinely useful beside an asking price, and deleting evidence to avoid mislabelling it is the wrong trade.
- **`priceSource` joins `PACKET_INPUT_FIELDS`.** The packet now reads it, so it changes packet bytes. `applyEdit` cannot currently change `priceSource`, but leaving it out would be safe only while that stays true — a coupling to another module's behaviour, and precisely the assumption the read-time fingerprint exists to stop making.

**`NO_PRICE` had zero test coverage in any suite.** That is why changing its semantics passed 175/0 in silence, and it is the same read-by-nobody family as the finding that prompted the change. Now 13 checks in `listing-packet-offline` (175 → **188/0**) and 6 in `draft-crud-e2e` (152 → **158/0**), including the production-shaped create — priced, no inversion — which is the case every real create hits today.

## 7e. The normalizer sweep — siblings found, including one in the mirror direction

The check applied: for every field this module normalizes, is there a code for the failure case? Run against a live builder, not by reading.

| Field | Failure | Reported? |
|---|---|---|
| `feeModelRevision` | non-integer → `null` | ✅ `MISSING_FEE_MODEL_REVISION`, blocking |
| `feeScheduleVerified` | absent / unparseable | ✅ fixed in `af65ece` |
| `taxonomyTreeVersion` | absent → verified constant | ✅ `TAXONOMY_VERSION_ASSUMED` |
| `taxonomyTreeVersion` | **garbage accepted as live** | ❌ **mirror defect — see below** |
| `priceBasis` | **no basis supplied → `null`** | ❌ silent |
| `priceBasis.retrievedAt` | **age absent → `null`** | ❌ silent |
| `priceBasis.retrievedAt` | **age unreadable → `null`** | ❌ silent, and not distinguished from absent |
| `priceBasis.label` / `.sourceUrl` | **absent → `null`** | ❌ silent |
| `datedBySource` | non-boolean → `false` | ❌ malformed reads as "not dated by source" |

Two things worth separating out.

**The mirror direction is worse than a silent null.** `taxonomyTreeVersion: 'complete garbage'` is accepted, stamped `taxonomyTreeVersionSource: 'live'`, and **suppresses `TAXONOMY_VERSION_ASSUMED`** — so an unvalidated string is treated as better evidence than the verified constant. Every other row here fails to state something; this one states something false, and it does it by silencing the code that would have been correct.

**`retrievedAt: null` is live, not hypothetical.** PriceCharting publishes no as-of date, and the freshness contract is that a caption names the source *and* how old it is. A packet that cannot answer "how old" says nothing about it. And absent-vs-unreadable is the same split as `FEE_SCHEDULE_DATE_ABSENT` vs `FEE_SCHEDULE_DATE_UNPARSEABLE` — incomplete caller vs format drift — which collapsing sends someone to fix the wrong end.

**Not fixed in this commit.** These are producer-side and want the same absent/drift treatment, but that is a second pass, not a rider on the price split.

## 7f. (c) answered: never wired, not cut

Asked directly, because "restore a cut feature" and "finish an unwired one" are different jobs.

Across **every commit in the repository's history**, `listPriceForTargetNet(` appears **zero times outside its own definition** in shipped code (`js/`, `index.html`). The apparent growth in occurrences — 1 at `e457a9d`, 13 at `19cb94c` — is entirely retained retired bundles accumulating copies of the *definition*. There was never a call site to remove.

It entered in `e457a9d` / `e6b9579`, *"Phase 1 Block B: listing packet (title, condition, target-net, metadata)"* — the same commit family that introduced `buildListingPacket`, which itself had no production caller until `3db7169` three days ago. Both halves of Block B shipped as library code with no entry point. It was then substantially reworked in `ce616c8` (*"FIX B — the 60-cent inverse scan"*, replacing a magic constant with branch-wise search over `FEE_TOTAL_DISCONTINUITIES = [10]`) — a correctness fix, well-tested, to a function no seller could reach.

**So: never wired.** The answer is unambiguous and it makes (c) a scoping question about finishing Block B, not an archaeology question about a regression.

One consequence worth stating: `audit/CARDRESELL_PLAN_AND_ROADMAP.md:452-454` §5.3 *"Fix the function, not the label"* reads **"If target-net inversion misses by more than $0.05, fix the calculation. Do not relax or rewrite the UI claim."** There is no UI claim. The rule governs a function no seller can reach, and it has been enforced — `ce616c8` is that rule being obeyed. The rule is fine; what it documents is that the plan has treated target-net as shipped for as long as the plan has existed.

**Filed as its own finding, not as Lane A follow-up.** With `marketAskDivergence` and `buildListingPacket`, that is three, and the third one confirms the shape is a pattern rather than a coincidence: work lands as tested library code, the plan records it as done, and nothing reaches a seller. The **serialized-field-with-no-reader sweep** already on the open list is the same question asked of data; this is it asked of functions. Neither has been run.

## 8. Unchanged and still open

Stale comment `core:2657-2659` and the duplicate clamp remain separate cleanup, per instruction. D3, BIAS-1, BIAS-6 and Q7 remain closed. §8 of the T2.9 packet — `feeBase`/`feeBaseLabel` on only 2 of 15 venues, **BIAS-10's remaining half, no ranking effect ruled out** — is untouched by this work. `DRAFT_NO_PRICE_PROVENANCE` still fires on every priced non-seller draft, now for the accurate reason that no packet covers the price.

Push and deployment gates remain closed. Phase 1: roughly 80–85% implemented; release validation outstanding.
