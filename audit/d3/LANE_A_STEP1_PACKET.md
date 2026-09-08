# Lane A, step 1 — a packet may not outlive the inputs it was built from

**Commits:** `db396da` (staleness) · `2cc7c6b` (review items) · `3db7169` (producer connected) · `af65ece` (fee-schedule stamp) · `1303b7f` (two price conditions) · **Branch:** `phase1-block-d` · **Bundle:** `js/core.541c4c39.js` (unchanged by this work — server and tests only)
**Nothing pushed. Nothing deployed.** `origin/main` is still `9aaf326`.

> ## ⚠️ CURRENT STATUS — read this before §0
>
> **The sections below are a running record, written as the work happened, and
> the early ones have been overtaken.** Nothing in them has been rewritten to
> look prescient. What is true as of **2026-09-08, commit `da13bee`** (the
> create-path check in §17; the three §16 checks landed at `0cc4477`):
>
> | Section | Says | Actually |
> |---|---|---|
> | §0, §5, §6 | "**The producer is still unwired**" | Wired at `3db7169`. §7b records the wiring; §0 was written before it. |
> | header, §1–§10 | Bundle `js/core.541c4c39.js`, "unchanged by this work — server and tests only" | Live bundle is **`js/core.86000bf2.js`**. Five generations since (`audit/BUNDLE_CITATION_MAP.md`). Any line number in §1–§10 that points into `541c4c39` must be re-grepped by symbol. |
> | §15 | The client slice as first landed | Extended by §16 (a fourth verdict arm, a conflict re-read, a copy refusal) and by §17 (the create-path basis binding). |
> | §16.4 | The foreign-basis answer, refresh only | **Incomplete.** The create path was not covered and leaked; see §17. |
> | §14 | "a packet goes stale only after an edit" | **Wrong.** Corrected in §16.2. |
> | §14 | "A live client basis still wins" | **Withdrawn.** A client basis on a rebuild is now refused. §16.4. |
> | §13 | Both Phase 1 completion percentages | Still superseded. **No current figure replaces them.** |
>
> **What is implemented and tested**: draft persistence, the draft list, the
> review screen, packet staleness detection, packet refresh, copy-out, the
> three checks in §16, and the create-path basis binding in §17. **What is not**: `listPriceForTargetNet` is never wired
> (§7f), and target-net work is out of this lane by agreement.
>
> **Push and deployment remain blocked** by the unchanged credential-rotation
> gate. That gate has not moved and is not affected by anything in this
> document.

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

---

## §8 — The taxonomy mirror defect, fixed (commit `b66d6a7`)

### Why it was a different severity class

Every other row in the §7e sweep table is a failure to **state** something: a
field could not be read, resolved to `null`, and nothing said so. The taxonomy
row inverted that. The old line was:

```js
const treeVersionLive = ctx.taxonomyTreeVersion ? String(ctx.taxonomyTreeVersion) : null;
```

Any truthy value became `treeVersionLive`. That did three things at once:

1. recorded the unvalidated string as `metadata.taxonomyTreeVersion`;
2. stamped `metadata.taxonomyTreeVersionSource: 'live'` — an affirmative claim
   that we performed a live read;
3. **suppressed `TAXONOMY_VERSION_ASSUMED`**, because that code only fires when
   `treeVersionLive` is falsy.

So an unvalidated input was treated as *stronger evidence than the verified
constant*, and the honest fallback notice was silenced by the dishonest input.
The other silent nulls fail to speak. This one spoke falsely and gagged the
line that would have been correct.

### The format contract

eBay's `get_default_category_tree_id?marketplace_id=EBAY_US` returns
`{ categoryTreeId: "0", categoryTreeVersion: "134" }` — a numeric string,
recorded at `api/_ebayTaxonomy.js:46` as `VERIFIED_TREE_VERSION = '134'`.
Validation is `/^\d+$/` against the trimmed value. Deliberately not widened
into a lenient parser: the point is to refuse what we cannot recognize, not to
salvage it.

### Behaviour now

| Input | Recorded | Source | Codes |
|---|---|---|---|
| absent | `134` | `verified-constant` | `TAXONOMY_VERSION_ASSUMED` |
| `'134'` | `134` | `live` | — |
| `134` (number) | `134` | `live` | — |
| `'   '` | `134` | `verified-constant` | `TAXONOMY_VERSION_ASSUMED` |
| `'13.4'` | `134` | `verified-constant` | `UNPARSEABLE` + `ASSUMED` |
| `'complete garbage'` | `134` | `verified-constant` | `UNPARSEABLE` + `ASSUMED` |

The two codes are **allowed to co-occur**, and that co-occurrence is the fix.
Whitespace counts as absent rather than drift — same rule as
`FEE_SCHEDULE_DATE_ABSENT` vs `FEE_SCHEDULE_DATE_UNPARSEABLE`. Neither blocks.

### Reachability caveat, stated rather than buried

`api/drafts.js:580` lists `taxonomyTreeVersion` among the fields **refused**
from the client, and no server-side caller supplies it. So `treeVersionLive` is
`null` on every production create today and `TAXONOMY_VERSION_ASSUMED` always
fires. The garbage path is reachable only by the future caller that wires the
live eBay taxonomy read — which is exactly who the old code would have misled.
Fixing it now is a trap removed before anyone steps in it, not a live bug
closed.

---

## §9 — Producer-side normalizer second pass: `stampPriceBasis`

Five silent nulls, now split absent-from-unparseable throughout.

`stampPriceBasis` was refactored into `stampPriceBasisReporting`, which returns
`{ basis, findings }`; `stampPriceBasis` is now defined as a thin wrapper that
returns `.basis`. The parse rules therefore exist **once**. The alternative —
re-deriving the same conditions in `buildListingPacket` — would have put two
implementations of "is this age readable" in the codebase, which is how a stamp
and its findings start disagreeing.

| Code | Fires when | Severity |
|---|---|---|
| `PRICE_BASIS_ABSENT` | no basis **and** `priceSource` is `comp`/`venue` | WARNING |
| `PRICE_BASIS_AGE_ABSENT` | no `cacheAgeSec` | WARNING |
| `PRICE_BASIS_AGE_UNPARSEABLE` | `cacheAgeSec` present, not a finite ≥0 number | WARNING |
| `PRICE_BASIS_INCOMPLETE` | `label` or `sourceUrl` missing (named in `.missing`) | WARNING |
| `PRICE_BASIS_DATING_UNPARSEABLE` | `datedBySource` present, not a boolean | WARNING |

None block. Two judgement calls worth recording:

- **A seller who typed their own number owes no market basis.** So
  `PRICE_BASIS_ABSENT` is conditional on the price *claiming* to be derived.
  Firing it on `priceSource: 'seller'` would have made the common case noisy,
  and a warning that always fires is a warning nobody reads.
- **`datedBySource` non-boolean → `false` was a claim, not an omission.**
  `false` asserts *the source did not date this*. Coercing an unreadable value
  to `false` states that assertion without having established it.

### This is the live shape, not a hypothetical

The bundle assigns `window._crBasis` in three places. Two of them — the
SportsCardsPro paths at `js/core.541c4c39.js:3326` and `:4845` — set exactly:

```js
{ value: d.median, low: null, mid: null, high: null,
  label: `SportsCardsPro guide · ${v.productName}` }
```

No `cacheAgeSec`, no `sourceUrl`, no `datedBySource`. **Every sports-card price
produces a basis with a label and nothing else**, and the packet recorded that
as a clean stamp. The main path at `:2701` passes `cacheAgeSec ?? null`, so it
can be null there too when upstream omits it.

### A correction, recorded rather than made quietly

An earlier note in this file attributed `retrievedAt: null` to **PriceCharting**
publishing no as-of date. That was wrong, and is corrected here rather than
edited away. PriceCharting's gap is `datedBySource: false` — which the stamp
**already handled honestly** and which is a different failure from having no
retrieval time at all. The provider with no retrieval time is SportsCardsPro.
The conclusion ("this is a whole provider's normal path, not an edge") survives;
the attribution did not.

**Tests:** `listing-packet-offline` 188 → **207/0** (19 checks), including one
asserting `stampPriceBasis` is byte-identical to `stampPriceBasisReporting().basis`
so the wrapper cannot drift from what it wraps.

---

## §10 — The two reachability sweeps

Run because "never wired" changed what the roadmap's completion column means.
Both sweeps are scripted, not read by eye.

### §10a — Functions with no production call site

**Method.** Every `export function` in `api/*.js` plus every top-level
`function` in the live bundle `js/core.541c4c39.js` — **610 definitions**.
Call sites counted across `api/*.js`, the live bundle, and `index.html`, with
the definition line itself, comments, and dotted forms excluded. Retired
bundles are deliberately **not** counted as call sites: they are not served.
`index.html:3753` loads exactly one bundle.

**Guard against the obvious false positive.** Handlers wired by string — 
`onclick="foo()"` in generated markup, `data-callback="foo"`, `window[name]()` — 
would look uncalled to a naive scan. Checked: the bundle contains **zero**
`window[` dynamic dispatch and no interpolated `onclick="${...}()"`. A second
pass counted bare-name references (functions passed as values, e.g.
`rows.map(_crWireRow)`) separately.

**Result: 64 of 610 have no production call site**, in three groups:

| Group | Count | Meaning |
|---|---|---|
| A — called only by tests | 9 | the Block B pattern: lands as a library, tested, no seller reaches it |
| B — referenced but not called | 17 | passed as a value, re-exported, or named only in a comment |
| C — appears **only** at its own definition | 38 | unreferenced anywhere in production |

**Group A — tested, unreachable.** `listPriceForTargetNet` (25 test calls),
`ageFromRetrievedAt` (12), `stampPriceBasis` (4), `_resetTokenMemo` (4),
`buildConditionPayload` (2), `verifiedAgeDays` (2), `conditionHandoffLines`,
`getDefaultCategoryTreeId`, `getRequiredAspectNames` (1 each). This is the
group that bears on the completion estimate: **test-call count is not
reachability**, and a high one can actively disguise its absence.

**Group C — checked before being characterised.** Four of the 38 looked alarming
and turned out not to be:

- `startProCheckout`, `startAnnualCheckout`, `startScanCheckout` — the live
  subscription entry point is `startTierCheckout(tier)`, wired at
  `index.html:3232` (`'pro'`) and `:3256` (`'pro_max'`). Checkout **works**.
  These three are **superseded duplicates**.
- `handleGoogleSignIn`, `applyGoogleUser`, `loadUserData` — auth runs through
  `window._waitForAuth()` / `window.googleUser`. Also superseded.

So Group C is predominantly **rule-1 debt, not missing capability**: one
business behaviour with a dead second implementation sitting beside the live
one. The hazard is that someone "fixes" the dead copy. That is a real
maintenance risk and a different problem from Group A.

**Conclusion for the estimate:** Group C does *not* deflate Phase 1 — those
behaviours ship. **Group A does**, and `listPriceForTargetNet` is its
exemplar: 25 test calls, a correctness fix in `ce616c8`, and no seller path.

### §10b — Serialized fields with no reader

**Method and its honest limit.** A real packet was built and walked to
**70 field paths**. Readers were counted by leaf name across production,
excluding the producing module.

**This method can prove absence, not presence.** A leaf like `title`, `price`,
or `condition` appears all over the bundle for unrelated reasons, so "has
readers" from a name match is worth nothing. Reported as a limitation rather
than dressed up as a result. It flagged 6 paths with zero name matches
(`aspects.missingRequired`, `aspects.optional.Card Number`,
`aspects.valuesVerified`, `metadata.packetSchemaVersion`,
`metadata.taxonomyTreeVersionSource`, `blockingCodes`).

**A decisive structural finding supersedes the field-level count.**
`buildListingPacket` has exactly **one** call site in the entire codebase —
`api/drafts.js:618`, `out.packet = buildListingPacket(card, packetCtx)` — and
`api/_draftService.js:317` carries the deliberate-discard comment that drops
the packet fields before `readDraft` returns. Nothing downstream of the create
reads any of it.

**Therefore all 70 packet fields are currently unread outside the producer and
its tests.** The per-field sweep is moot until the packet reaches HTTP at all,
which is the next queued item. It should be re-run **after** the consumer
exists, when a per-field answer will mean something.

### §10c — What the sweeps license about the Phase 1 estimate

They do **not** license a new percentage, and no number is offered here.

What they establish is that the roadmap's completion column measures the wrong
thing. `audit/CARDRESELL_PLAN_AND_ROADMAP.md:520-528` marks blocks A, B, C, D1
and D2.0 **Implemented** on the strength of code existing and suites passing.
Block B is the demonstrated counter-example: `buildListingPacket` had no caller
until `3db7169`, `listPriceForTargetNet` still has none, and the packet's output
is discarded before it reaches a seller — while the block reads *Implemented,
with external fields gated* and the suite reads 207/0.

The sweeps give the tool for a per-block reachability pass; they do not
constitute one. Until that pass runs block by block, the honest statement is
still the one that prompted them: **the basis of the 80–85% has not been
checked**, and any block marked Implemented inherits that doubt.

Recorded in the roadmap itself so the doubt travels with the claim rather than
living only here.

---

## §11 — Reviewer corrections (2026-09-08)

Four defects, three raised by review and one found while reproducing the first.
Commit `52c7164`.

### §11a — The fingerprint proved the draft matched itself

`buildDraft` computed `packetInputFingerprint(draft)` from the draft it was
building and stored that as *the packet's* fingerprint. The reader then
recomputed the same value from the same draft, agreed, and declared any
attached packet current. Reproduced before changing anything:

| | |
|---|---|
| packet built from price | `$100` |
| draft normalized price | `$500` |
| stored `packetInputs` | `price=number:500\|priceSource=string:comp\|title=string:…` |
| reader recomputes | identical |
| **verdict** | **packet declared CURRENT** |

The old code carried a comment defending this choice: a caller that supplied
its own fingerprint could declare a stale packet fresh. That defends against a
lying caller and buys a tautology in exchange. It also does not apply — `packet`
is refused from the client on the create path, so the value is server-produced,
and a caller that could forge the fingerprint could forge the whole packet.

**Fixed.** `buildListingPacket` stamps `metadata.inputFingerprint` from the
exact inputs it consumed: `ctx.price`, `ctx.priceSource`, and the title it
rendered itself. `buildDraft` reads that stamp rather than computing one.
Absence still is not agreement — a packet with no stamp records no fingerprint
and reads stale.

**Initial mismatch, added.** Derived from `rev`, not stored:

- `PACKET_INPUTS_NEVER_MATCHED` — mismatch at `rev === 1`. No edit has
  happened, so none can be blamed; this is a producer bug.
- `PACKET_INPUTS_CHANGED` — mismatch after an edit. The ordinary case.
- `PACKET_INPUTS_UNRECORDED` — no fingerprint at all. A write path that does
  not know packets exist.

All three withhold the packet, keep the draft readable, and preserve the bytes
in `packetRaw`.

### §11b — Fourth defect: the reader looked where the producer never wrote

Running a real producer packet through `readStoredPacket` for the first time —
something §10b had established nobody does — returned `INCOMPATIBLE`:

- `readStoredPacket` read `stored.packetSchemaVersion` (top level).
- `buildListingPacket` has always written `metadata.packetSchemaVersion`.

So **every packet the producer has ever built was unreadable**, not merely
unread. The version suite was green because its fixtures hand-write a
top-level field production never emits: the assertions were right about the
behaviour and wrong about the shape. That is the §10-family failure again, and
this time inside a suite that was cited as evidence.

Reader now reads the nested field, migrations bump the nested field, and the
fixtures were corrected to the producer's real shape, each carrying a note of
what it used to assert. No top-level fallback — two accepted shapes is an
ambiguous version, and no legacy data exists to accommodate, because no packet
has ever been read back.

### §11c — Client-declared metadata may not present as verified

`feeModelRevision` and `feeScheduleVerified` arrive in the request body
(`pricingContext`) and are only type-checked: any integer, any parseable date,
including a future one.

**Server-side validation is not available**, and this is a finding rather than
a deferral. The fee model exists only in the client bundle
(`FEE_MODEL_REVISION`, `js/core.541c4c39.js:7590`); `api/_listingPacket.js`
already reasons that a server-side copy would be a second fee model, excluded
by standing decision and by one-behaviour-one-implementation. So the reviewer's
option (a) is closed until a genuinely shared contract module exists, which is
its own piece of work in a repo with no bundler.

Option (b), taken:

| was | now |
|---|---|
| `metadata.feeModelRevision` | `metadata.clientDeclaredFeeModelRevision` |
| `metadata.feeScheduleVerified` | `metadata.clientDeclaredFeeScheduleDate` |
| — | `metadata.feeMetadataSource: 'client-declared'` |
| — | `FEE_METADATA_CLIENT_DECLARED` (INFO), **unconditional** |

Unconditional is the substance. A supplied value cannot suppress the
disclosure, because supplying it is the thing being disclosed — the same
inversion the taxonomy fix removed. `MISSING_FEE_MODEL_REVISION` still blocks:
that code is about presence, not authority, and the two are separate claims.

### §11d — `NO_TARGET_NET_PRICING` was noise on every draft

It fired whenever a target-net result was absent, which is every ordinary
draft, because no production surface requests one (§10a: `listPriceForTargetNet`
has no caller outside tests). A warning for declining a feature nobody was
offered is noise, and noise is how a real warning gets ignored.

The two arms cannot share a gate — a warning that wrongly disappears is
invisible, one that wrongly appears is noise:

- **No target requested** → absent optional analysis, no code.
- **Target requested, no usable answer** → still warns.

## §12 — Stale-packet recovery: the operation, defined

"The caller recomputes" was policy with no operation behind it. Defined here
before any packet state goes on the wire, because a withheld packet with no way
to obtain a replacement is a dead end that looks like a feature.

**Lifecycle, as required:**

```
create → current packet
       → edit a dependent input (price | priceSource | title)
       → packet withheld, reason PACKET_INPUTS_CHANGED, bytes preserved
       → recompute with current pricing context
       → new current packet
       → reload → review
```

**Decision: one builder, reached two ways.**

1. **`PATCH` carrying `pricingContext` regenerates.** The edit path rebuilds
   the packet from the *post-edit* normalized values and re-stamps the
   fingerprint. This is the ordinary route: the review screen holds the pricing
   context already, so the recompute rides the edit that caused the staleness.
2. **`PATCH` carrying only `pricingContext` (no field changes) is the explicit
   recompute.** Same code path, no second endpoint, no new verb — a recompute
   is an edit that changes no fields.

**A `PATCH` with no `pricingContext` does not regenerate.** It leaves the
existing packet in place to read stale. Regenerating without pricing context
would build a packet with no basis and a blocking
`MISSING_FEE_MODEL_REVISION`, overwrite preserved evidence, and trade a
diagnosable stale snapshot for a fresh useless one. A title edit from the list
screen is exactly this case.

**One implementation.** The `packetCtx` assembly currently inline in
`normalizeCreateInput` gets extracted so create and recompute call the same
builder, and the store gets a single `attachPacket(draft, packet)` that records
the packet and its stamped fingerprint together. Two callers of one function,
not two functions — the rule that has bitten this codebase ten times.

Implementation lands with the forwarding work, not before it; this section is
the definition the forwarding gate asked for.

## §13 — Both percentages are superseded estimates

There is **no current Phase 1 completion percentage for this project.** Two
have been offered and both have been withdrawn by the person who offered them:

| Figure | Origin | Status |
|---|---|---|
| **80–85% seller-reachable** | Owner's earlier estimate | **Superseded.** Withdrawn in §10c: its basis had never been checked. |
| **75–80% seller-reachable** | Reviewer's adjustment of the same basis, offered provisionally | **Superseded.** Withdrawn by the reviewer on 2026-09-08. |

Neither is a current owner figure, and neither should be quoted forward. The
second was never independent of the first — it adjusted the same unaudited
foundation, so withdrawing the foundation withdraws both. An earlier version of
this section recorded 75–80% as "the owner's provisional figure"; that framing
is wrong twice over, since it was the reviewer's figure and it is no longer
offered. Corrected here rather than deleted, because the mistake is the useful
part: a number survives by being repeated, not by being verified.

**What replaces them.** Progress is measured against the seller workflow and
the original Phase 1 requirements, not a percentage. For this lane the
milestone is stated as a behaviour: *a stored packet that the seller can
review, refresh and copy.* That is either true or it is not, on a given commit,
and it does not average.

**Sweep counts are leads, not measurements.** Per review, the §10a and §10b
counts stand as discovery evidence pending classification of externally invoked
handlers, aliases and callbacks. §10a already rules out `window[…]` dynamic
dispatch and interpolated `onclick`, and the `startTierCheckout` /
`_waitForAuth` findings show what classification does to the raw count — it
moved 38 rows from "missing capability" to "superseded duplicate". The
remaining classes are not yet done, so no completion percentage may be derived
from these numbers.

---

## §14 — The four focused checks, and the two qualifications

Commits `b8042ff` and `16f4a29` on `phase1-block-d`. Nothing pushed; `origin/main`
is still `9aaf326`. Suites run individually with `timeout 240 node tests/<name>.mjs`;
`tests/run-all.sh` was not run.

### §14a — Bind the packet to the card, not only to its price

**The check.** "Confirm that another card with the same title and price cannot
inherit the packet."

It could. Before this change `PACKET_INPUT_FIELDS` was `['price',
'priceSource', 'title']`, so a packet built for one card covered a draft for a
different card whenever the display title and price matched — a reprint, or the
same card in two sets. That is not a narrow leak: **identity is most of a
packet.** `packet.sku`, `packet.category`, `packet.aspects` and
`packet.condition` are all derived from the card row, so card B's draft would
have shown card A's category and aspect values as its own.

**The projection now.** `api/_listingPacket.js`:

```js
export const PACKET_INPUT_FIELDS = ['sku', 'slot', 'price', 'priceSource', 'title'];
export const PACKET_INPUT_PROJECTION = 2;
```

`sku` is the existing immutable identity and `slot` the existing immutable
listing slot, as the review suggested — no new identity was invented.
`packetInputFingerprint` emits `v=2|` as a prefix inside the fingerprint
string, so a stamp taken under the narrow projection can never equal one taken
under the wide projection. Without that prefix, widening the field list would
have silently accepted every old three-field stamp that happened to collide.

**Evidence.** `tests/draft-store.mjs`, three new assertions:

- a packet stamped for `sku_laneA` attached to a draft for `sku_OTHER_CARD` at
  identical title and price → `packetUsable === false`, `packetStatus === 'STALE'`;
- the draft itself still reads (`ok === true`) — an unusable packet is not a
  broken draft;
- a packet stamped for `ebay:fixed-price` does not cover a draft in
  `ebay:auction`.

**And the opposite direction,** which is what makes a projection useful rather
than merely strict: a notes-only edit leaves the packet `CURRENT` and leaves
its bytes byte-identical. A projection that invalidated on every edit would
teach sellers to ignore the staleness signal.

`slot` is in the projection even though no edit path can change it today.
"No edit path changes it today" is a claim about `normalizePatch`, not about
the packet, and the fingerprint should not depend on another module's current
behaviour.

### §14b — The card row is now stored, and why that was forced

A server-side rebuild needs the card row: `buildListingPacket(card, ctx)`
derives identity, title, category, aspects and condition from it. The draft
record did not carry it.

Three ways to obtain it, two of which do not work:

1. **Re-derive from `sku`.** Impossible. `skuFor` is
   `sha256(identityString(row)).slice(0, N)` (`api/_cardIdentity.js:386`), and
   there is no card-by-sku lookup anywhere in `api/` — `grep -rln
   "cardById\|getCard\|fetchCard\|card_id" api/*.js` returns nothing.
2. **Accept `card` on the rebuild request,** the same trust boundary the create
   already uses. Works for a client that still holds the scan. **Fails after a
   page reload,** because the draft GET response never contained the row — and
   reload is explicitly inside the lifecycle this review requires
   (create → reload → review → edit → rebuild → reload).
3. **Persist the row at create.** Adopted.

It is written once, from the same `card` the create derived `sku` and `title`
from, and it is **immutable**: `normalizePatch` accepts only `title`, `price`,
`status` and `notes`, so no edit path can move a draft onto a different card.
It needs no invalidation story because it is the thing `sku` is a digest **of** —
and if some future repair script did rewrite it, the widened fingerprint now
covers `sku` and the packet would refuse to cover the row rather than quietly
describing the wrong card.

**Known limitation, stated rather than discovered later.** Drafts created
before this commit have no stored row. A rebuild on one of those throws
`PACKET_REBUILD_NO_CARD_ROW` — refused explicitly, not built from a partial
row, because a packet whose category and aspects came from nowhere is worse
than no packet. This is a different question from §14g: §14g establishes that
no deployed code ever wrote a *packet*; it does not establish anything about
drafts, which the deployed create path does write.

### §14c — One builder, one attach

Two functions now exist where the assembly used to be inline in
`normalizeCreateInput`:

- `buildPacketFor(card, { pricingContext, slot, price, priceSource, titleMax, now })`
  in `api/drafts.js` — the only place a packet context is assembled. Create and
  rebuild both call it. `slot` is documented on it as **the one input the
  builder cannot derive**: the builder sees `maxTitleLength`, never the slot, so
  a caller that forgets it stamps a fingerprint no real draft can match and the
  packet reads stale forever. Fail-closed, but silently — hence the note.
- `attachPacket(draft, packet)` in `api/_draftStore.js` — the only place a
  packet and the fingerprint **it** stamped are recorded together. `buildDraft`
  delegates to it. Passing `null` removes both, because a fingerprint with no
  packet leaves the next reader comparing against nothing.

`titleMaxForSlot(slot)` was also extracted, for the same reason: a rebuild
under a different title bound would produce a title the create would not have
stored, and the difference would surface as an unexplained `dropped` segment.

### §14d — The rebuild is a PATCH, with the conditional write it already had

Per the review, no new endpoint. One rule:

> **A PATCH carrying `pricingContext` regenerates the packet from the
> post-edit values. A PATCH without it does not.**

That serves both cases: `PATCH {price, pricingContext}` is edit-and-recompute;
`PATCH {pricingContext}` with no edit fields **is** the explicit recompute.

A PATCH *without* `pricingContext` deliberately leaves the packet alone.
Rebuilding from nothing would produce a packet with no declared fee revision —
`MISSING_FEE_MODEL_REVISION`, `blocked: true` — and overwrite a previously good
snapshot with a worse one, on an edit the seller made to their notes. A stale
packet is more useful than that: it still records what it was built from, and
the read gate already reports it as unusable rather than showing it as current.

**Revision and retry protection.** The rebuild sits in
`api/_draftService.js updateDraft` **between `applyEdit` and `putDraft`**, and
both halves of that placement carry weight:

- *Post-edit*, because the packet must describe the draft that will be stored.
  Building from `cur.draft` would reproduce the defect this lane opened with.
- *Before `putDraft`*, because `putDraft` → `claimRevision(kv, sub, draftId,
  next.rev, …)` **is** the conditional write. A concurrent edit that lands first
  takes the revision, this claim fails `REV_CONFLICT`, and the rebuilt packet is
  discarded unwritten. That is the reviewer's race exactly — rev 7 captured,
  seller edits to rev 8, the old build completes producing a rev-7-shaped packet,
  and the attachment is rejected. **No new mechanism was added**, because the
  packet rides the same record as the edit under one claim. There is deliberately
  **no `await` between the build and the claim**, and the build is pure and
  synchronous, so no interleaving point exists inside the window.

### §14e — Retry identity: exclude the packet, and *therefore* include the context

`packet` was already in `DERIVED_FIELDS` for `draft-create`, and correctly so:
it stamps a build-time clock, so an identical request retried three seconds
after a dropped response fingerprints differently and would be refused as key
reuse — turning ordinary network retry, the thing idempotency exists to make
safe, into a hard failure.

But excluding it only kept its meaning once the **declared context counted**,
and it did not. `pricingContext` was read locally in `normalizeCreateInput` and
never reached the fingerprint. Consequence: the same key sent twice with
`feeModelRevision: 7` and then `8` **replayed the first answer**, so the seller
kept a packet whose declared fee revision was not the one their client runs —
and a replay looks like a success, so nothing reported it.

Now declared:

```js
'draft-create': {
  sku: 'id', instanceId: 'id', slot: 'token', price: 'money',
  title: 'text', strategy: 'token', priceSource: 'token',
  pricingContext: 'digest',
}
```

`digest` is a new kind that accepts a plain object and refuses arrays and
non-objects. Key order needs no special handling: `canonicalize` already sorts
keys at every depth, so a client that rebuilds the object in a different
property order fingerprints identically.

`card` is **derived**, and the existing docblock had already argued it: the row
is represented by `sku`, a sha256 over its identity axes, and `sku` counts. Two
creates whose rows differ anywhere identity reads produce different skus and
conflict on that field. Two creates whose rows differ only outside those axes
are the same card, so replaying the first is the correct answer rather than a
missed conflict.

### §14f — Quote age: the defect, asserted rather than described

**The check.** "Rebuilding now must not make an earlier retrieval appear newer."

It would have. `stampPriceBasisReporting` computed
`retrievedAt = new Date(now - cacheAgeSec * 1000)`. `cacheAgeSec` is a
**duration**, meaningful only against the clock that read it. Converting it is
right on a create, where the build and the read are the same moment. On a
rebuild it is wrong, and the test now asserts the wrong number on purpose:

| | quote read | packet built | `retrievedAt` produced |
|---|---|---|---|
| create | 12:00 | 12:10 | 12:00 ✓ |
| rebuild, same duration re-converted | 12:00 | 13:00 | **12:50** ✗ |
| rebuild, absolute declared | 12:00 | 13:00 | 12:00 ✓ |

An hour-old quote reading as ten minutes old, with nothing reporting it.

`basisMeta.retrievedAt` (absolute ISO) is now accepted and **preferred** when
present, so the answer no longer depends on when the rebuild ran. The relative
form stays supported because the create path legitimately has only that. A
rebuild may carry both — the client's cached basis still holds the duration it
was built with — and absolute wins.

Two subsidiary rules:

- **A future timestamp is refused, not clamped**: `retrievedAt: null` plus
  `PRICE_BASIS_RETRIEVAL_UNPARSEABLE`. Clamping would convert a wrong client
  clock into a plausible retrieval time, the exact fabrication the null policy
  exists to prevent. `RETRIEVAL_SKEW_MS = 60_000`, sized to forgive a fast
  browser and nothing more.
- **`PRICE_BASIS_AGE_ABSENT` is suppressed** when the absolute form is usable.
  A "no retrieval time" warning printed beside a retrieval time is a warning
  that wrongly appears, and those are noise.

`metadata.generatedAt` and `priceBasis.retrievedAt` remain separate fields and
the test pins both: generated 13:00, retrieved 12:00, `datedBySource: false`.
Generating bytes is not re-fetching a source.

### §14g — Qualification 2: "no packet has been read" ≠ "no packet has been stored"

Accepted, and answered from **writer history** rather than from the absence of
reads.

Commits anywhere in this repository's history capable of writing a `packet`
field: `52c7164`, `3db7169`, `db396da`, `0251642`, `0c560aa`, `5c7cb28`,
`937c546`.

```
$ git merge-base --is-ancestor <each of the seven> origin/main
→ NO, for every one
$ git grep -c "packet" origin/main -- api/ js/
→ (no output)
```

The shipped tree contains **zero** mentions of `packet` in `api/` or `js/`.
`out.packet = buildListingPacket(...)` was introduced in `3db7169`, which is
unpushed. So **no deployed code has ever written a packet field, and there is
no legacy stored packet.** No dual-shape reader is needed — and that conclusion
rests on positive evidence about writers, not on an inference from reads.

Scope of the claim, stated precisely: this is about *packets*, not about
drafts. The deployed create path does write drafts, which is why §14b's
`PACKET_REBUILD_NO_CARD_ROW` path exists.

### §14h — Qualification 1: the reason is now factual, not causal

Accepted. `PACKET_INPUTS_CHANGED` → **`PACKET_INPUTS_DIFFER`**.

"Changed" asserts a history: that the packet once matched and something moved
it. At `rev === 1` that history is establishable and keeps its own reason,
`PACKET_INPUTS_NEVER_MATCHED`. At a later revision it is not: a packet that
never matched, on a draft that has since been edited, arrives at exactly the
same comparison. The record cannot distinguish them, so the reason now states
what is observed — the stored fingerprint differs from the live one — and the
comment notes that a later-revision mismatch is *consistent with* an edit
without asserting one.

The test carries a line recording what it used to assert and why it changed,
per the standing rule that commit messages are the one part of the corpus
nobody greps.

### §14i — Forwarding: four of five fields

`readDraft` in `api/_draftService.js` previously discarded all five packet
fields, with a long comment explaining that forwarding them would ship a field
nothing read. **That state has ended** — the producer runs on create and on
rebuild, and the consumer is next — so the comment was replaced rather than
deleted, and four fields are forwarded: `packet`, `packetStatus`,
`packetUsable`, `packetReason`.

**`packetRaw` is withheld,** and that is not an oversight either. It is the
unvalidated stored bytes, kept for diagnosing a record that failed to read.
Putting it on a seller-facing response would make an unreadable packet's
contents renderable by any client willing to ignore `packetUsable` — which is
the whole point of having a `packetUsable` flag.

`api/drafts.js` GET maps `undefined` to `null` / `false` so the wire shape is
stable whether or not a packet exists.

### §14j — What is NOT done in these two commits

Stated plainly so the milestone is not read as met:

- The client does not yet send `pricingContext` on create (`_crCreateDraft`).
- The review screen does not yet consume the forwarded envelope, so **the
  client-declared fee qualification does not yet appear on screen.**
- The full lifecycle (create → reload → review → edit → rebuild → reload) is
  not yet exercised end to end, and the requirement that previously displayed
  packet content and copy-button payloads **disappear** when the packet becomes
  unusable is not yet implemented or tested.

The milestone — a stored packet the seller can review, refresh and copy — is
therefore **not met**. Push and deployment remain blocked.

### §14k — Suite results

Run individually, after the two commits:

| Suite | Result |
|---|---|
| `listing-packet-offline` | 230 passed, 0 failed |
| `draft-store` | 135 passed, 0 failed |
| `draft-crud-e2e` | 159 passed, 0 failed |
| `draft-review-screen` | 180 passed, 0 failed |
| `draft-readiness` | PASS |
| `quick-pricing` | 219 passed, 0 failed |
| `review-fee-dl` | 21 passed, 0 failed |
| `accuracy-fee-parity` | 41 passed, 0 failed |

Running these individually does not itself make them offline, and that debt is
tracked separately from functional release evidence.

**Fixture debt found, not fixed:** `tests/listing-packet-offline.mjs` defines a
`codes` helper three times at different scopes (lines ~1205, ~1286, ~1376) plus
a `codesOf` variant. One behaviour, four implementations — the architectural
rule applies to test helpers too. Logged rather than folded into this pass.

---

## §15 — The client slice: a seller can see the listing details

Server groundwork was reported complete in §14. This section covers the
seller-visible workflow built on top of it, the two evidence points asked for
by name, and the two places where building it disproved something §14 asserted.

### §15.0 — Commits and the bundle

| SHA | What it landed |
|---|---|
| `b8042ff` | Packet fingerprint bound to card identity + slot |
| `16f4a29` | One builder + `attachPacket`; PATCH rebuild through the same route |
| `b8aae07` | Rebuild excluded from the retry record; `pricingContext` declared |
| `be84f6a` | A refused rebuild is a 409; revision-conflict and quote-age evidence |
| **`a8dc3d6`** | **The client slice + the server-side quote-age carry-forward** |
| `aa706dd`, `16653e8` | Bundle citation map brought current |

**Live bundle: `js/core.34fb750c.js`** (22,142 lines), renamed from
`js/core.541c4c39.js`. The single live reference is
`index.html:3769 <script defer src="/js/core.34fb750c.js"></script>`, resolved
from `index.html` rather than from the directory — `js/` holds fourteen retired
generations and picking one by glob is how a scratch script earlier in this
session edited the wrong file.

**One naming hazard to record:** `core.fec7fb3a.js` was a valid fingerprint of
a real intermediate file for part of one session and **appears in no commit**.
The bundle was renamed to it, then changed again before the commit. Do not cite
`fec7fb3a`; it names a file that was never version-controlled.

Nothing is pushed. `origin/main` remains `9aaf326`. Push and deployment stay
blocked, and the Cert ID rotation gate is unchanged and not satisfied.

### §15.1 — Focused results

| Suite | Result |
|---|---|
| `tests/draft-review-screen.mjs` | **220 passed, 0 failed** (was 180/0; +40) |
| `tests/draft-crud-e2e.mjs` | **173 passed, 0 failed** (was 164/0; +9) |
| `tests/listing-packet-offline.mjs` | **232 passed, 0 failed** |
| `tests/asset-fingerprints.mjs` | **15 passed, 0 failed** |
| `tests/draft-store.mjs` | **135 passed, 0 failed** |
| `tests/draft-list-screen.mjs` | **101 passed, 0 failed** |
| `tests/draft-readiness.mjs` | **PASS** |

Run individually with `timeout <n> node tests/<name>.mjs`. `tests/run-all.sh`
was not run. Running these individually does not by itself establish that they
are offline; it establishes that these seven pass.

### §15.2 — The five requested behaviours, and where each is asserted

**1. `pricingContext` on create and rebuild, preserving the original absolute
retrieval time.** One builder, `_crPricingContext(opts)`, serves both calls. It
emits `feeModelRevision`, `feeScheduleVerified` (omitted, not nulled, when
absent), and `basisMeta`. It sends an **absolute** `retrievedAt` and never a
duration; `_crRetrievedAtFrom(meta)` prefers the absolute stamp and otherwise
derives one from `cacheAgeSec` **at the moment of the price read**, returning
`null` rather than inventing "now".

**This requirement moved to the server, and the end-to-end test is why.** The
first implementation read the prior packet's `retrievedAt` off `_reviewState`
and forwarded it on rebuild. That is wrong: the read gate **withholds** a
withdrawn packet's content in all three of its cases, so at the moment a
refresh is most likely the client holds nothing to forward. The test caught the
PATCH going out with no retrieval time at all. Preservation now happens in the
rebuild closure in `api/drafts.js`, which always has the record.

> **Corrected 2026-09-08.** This paragraph previously read "a packet goes stale
> only after an edit," and the sentence after it said "a live client basis still
> wins — the carry-forward is a fallback, not an override." Both are wrong and
> both are replaced. See **§16.2** for the staleness correction and **§16.4**
> for the withdrawn basis claim.

**2. Forwarded packet status and content, with the client-declared fee
qualification visible.** `_reviewAbsorb` takes `packet`, `packetStatus`,
`packetUsable`, `packetReason` from the read envelope; `packetUsable` requires
strict `=== true` **and** a packet object. `_reviewPacketHtml()` renders one of
three arms — `data-review-packet="absent" | "unusable" | "usable"`.
`_reviewPacketDisclosuresHtml()` renders the server's notes verbatim and
attaches `data-packet-declared="client-declared"` **to the same element that
carries the declared revision and schedule numbers**, so the boundary travels
with the claim instead of sitting in a footnote a seller scrolls past.
`readiness` is still never derived client-side.

**3. Stale content and copy payloads cleared whenever the packet becomes
unusable or another draft loads.** Structural rather than remembered:
`_reviewPacketRows()` returns `[]` unless the packet is usable, so an unusable
state renders **no rows and no copy buttons** — there is nothing to forget to
clear. `_reviewCopyPayload(kind)` derives its bytes from state **at click
time** with one gate at the top; no payload is cached anywhere.
`_reviewClearPacket()` clears the whole group as one unit and
`loadDraftReview` calls it **before** the fetch.

**4. Refresh/rebuild with an actionable `PACKET_REBUILD_NO_CARD_ROW`
message.** `_reviewRefreshPacket()` PATCHes `{expectedRev, pricingContext}`
and no edit fields, under `Idempotency-Key: 'pkt-'+draftId+'-r'+rev`, then
**re-reads** via `loadDraftReview` rather than absorbing the PATCH body. On the
409 the seller is told to scan the card again **and** that the existing draft
is unaffected and still editable — the second half matters more than the first,
because the failure sounds like data loss and is not.

**5. create → reload → review → edit → rebuild → reload, on displayed and
copied values.** In `tests/draft-review-screen.mjs`, real Chromium. "Reload"
means a fresh browser context, so the packet has to come back off the record
rather than out of a variable. The clipboard is read through
`context.grantPermissions(['clipboard-read','clipboard-write'])` and
`navigator.clipboard.readText()`; **no production global was exported for the
test.** Assertions include: the on-screen title equals the packet's title
character for character; Copy title puts exactly that on the clipboard; after
an edit **zero** `[data-packet-field]` and **zero** `[data-packet-copy]`
elements exist and the prior title appears nowhere in the block; the rebuild
PATCH carries a `pricingContext` and no `title`/`price`/`quantity`; the client
performed a second GET; a second draft loaded after the first shows none of the
first's content and none of its copy buttons.

The packet fixtures are generated through the **real POST/PATCH handlers**, not
hand-written, per the fixture rule in that file's header.

### §15.3 — Evidence point 1: the revision claim rejecting a concurrent write

**The question as asked:** the absence of an `await` does not by itself prove
safety across concurrent requests. Agreed — it does not.

`tests/draft-crud-e2e.mjs` now interleaves two real `updateDraft` calls through
the real service and storage path, using a **barrier promise rather than a
sleep** (a sleep would make the test's timing the thing under test). Request A
reads rev 7 and parks inside a gated kv wrapper. Request B proceeds, takes rev
8 and price 999. A is released and builds its packet from the obsolete price
70. The write is refused with `DRAFT_REVISION_CONFLICT`, the stored draft is
B's at rev 8 / price 999, and **A's packet was never written** — asserted by
its marker being absent from the stored record, not by inspecting a return
value.

### §15.4 — Evidence point 2: the quote timestamp, with its negative control kept

The wrong result is preserved rather than deleted. In
`tests/listing-packet-offline.mjs` the **12:50** outcome — a 12:00 read whose
age was re-derived against a later clock — is kept as a reproduction, and two
assertions pin the correct 12:00 answer against it at both the
`stampPriceBasisReporting` and `buildListingPacket` levels. **Mutation-verified:**
stubbing `rawAbs = undefined` fails 6 assertions.

The server-side carry-forward added in `a8dc3d6` has its own mutation check in
`tests/draft-crud-e2e.mjs`. Disabling it produces **3 clean failures**, and the
failure mode is worth stating precisely because it is not the one I expected:
without the carry-forward the timestamp does not go wrong, `packet.priceBasis`
comes back **null entirely**. The packet still builds and still reads as
`CURRENT` and usable — it simply stops saying where its price came from or
when. A vanished provenance on an otherwise healthy-looking listing.

The first version of those three assertions read
`read3.body.packet.priceBasis.retrievedAt` directly and, under mutation,
**threw instead of failing**, killing the run before the later sections. They
now reach defensively, with that reason recorded in the file.

### §15.5 — Two assertions changed, with their old text recorded in place

Per the standing rule that a changed assertion records what it used to claim
and why, both edits carry that note in the test file itself.

**`draft-review-screen.mjs`, "the verdict says ready".** Previously asserted
that a draft passing every readiness check displays "Ready to list". That
approved a screen which told a seller to go ahead **while withholding the title
and aspects they would need to do it** — the fixture's draft is fully
publishable and has no stored packet. "Ready to list" now requires both. The
readiness verdict itself is unchanged and still asserted separately. The rule
is written out explicitly in `_reviewIdentityHtml`: `!publishable` → "N things
to fix" (`blocked`); `publishable && !packetUsable` → "Listing details need a
refresh" (`details-stale`); both → "Ready to list" (`ready`).

**`draft-review-screen.mjs`, the retrieval-time assertion.** Previously
asserted the PATCH's `pricingContext.basisMeta.retrievedAt` was the original
12:00. It described the design §15.2 explains the test disproved. The client's
obligation is now the negative one — **send no price basis it cannot vouch
for** — and the preservation itself is asserted through the real handler in
`draft-crud-e2e.mjs`.

### §15.6 — What this section does not claim

- **Completion percentage remains unverified.** Both Phase 1 figures are
  superseded (§13) and no current figure replaces them.
- The four undeclared CSS tokens (`--accent`, `--danger`, `--surface-1`,
  `--text-dim`) remain outstanding debt. The packet stylesheet added here uses
  only declared tokens — `--surface-2`, `--border`, `--text-muted`, `--text` —
  verified by the token check already in the review-screen suite.
- `applyEdit` still never updates `priceSource`; A-2 open; §8's
  `feeBase`/`feeBaseLabel` still emit on only **2 of 15** venues.
- `tests/listing-packet-offline.mjs` still carries 4 duplicate `codes` helpers,
  logged and unfixed.
- No source research was done for this section and no broad new suite was
  added, as instructed.

---

## §16 — Three focused checks at the newly connected interfaces

Three questions, asked against the existing suites rather than a new one. All
three were run before anything was written here, and **two of the three found a
real gap.** Both gaps are fixed, both fixes have a negative control, and one
prior claim in this document is withdrawn.

Reused suites: `tests/draft-crud-e2e.mjs` (server, real endpoint) and
`tests/draft-review-screen.mjs` (Playwright, real bundle). No new suite.
`tests/_draftListFixtures.mjs` gained one fixture, built through the real POST
handler like the other three.

### §16.1 Existing coverage, stated first

| Question | Already covered? |
|---|---|
| Q1 refresh retry identity | **Partly.** The route's replay behaviour was covered; the *corrected-context* and *identical-retry* sequences were not. Added. |
| Q2 foreign basis | **No.** The prior assertion asserted the opposite behaviour and passed. Replaced. |
| Q3 blocked packet vs "Ready to list" | **No.** The verdict had three arms and none read packet findings. Added. |

### §16.2 Correction: "a packet goes stale only after an edit"

Withdrawn. The read gate distinguishes **three** ways a stored packet fails to
cover its draft (`api/_draftStore.js:457-458`):

| Reason code | Condition | Involves an edit? |
|---|---|---|
| `PACKET_INPUTS_UNRECORDED` | `storedInputs === null` — a write path stored no fingerprint | **No** |
| `PACKET_INPUTS_NEVER_MATCHED` | fingerprint mismatch at `rev === 1` — no edit has occurred yet | **No** |
| `PACKET_INPUTS_DIFFER` | fingerprint mismatch after `rev > 1` | Consistent with one; does not establish it (§11) |

My own earlier cases are what disprove the claim: the missing-fingerprint case
and the rev-1 initial-mismatch case both reach the gate with no edit in the
record. The argument the sentence was serving is unaffected and in fact
stronger — the gate withholds packet content in **all three** cases, so the
client holds nothing to forward at refresh time in every one of them, not just
after an edit.

The wrong sentence appeared in four places and all four are corrected:
`audit/d3/LANE_A_STEP1_PACKET.md` §14, the `_reviewRefreshPacket` docblock in
the bundle, `tests/draft-crud-e2e.mjs`, and `tests/draft-review-screen.mjs`.

### §16.3 Q1 — refresh retry identity does not distinguish context, and does not need to

**The key is not what protects this route.** `pkt-<draftId>-r<rev>` is an
idempotency key, but `MUTATION_FIELDS` (`api/_idempotency.js:119`) declares a
`pricingContext: 'digest'` field for the **`draft-create`** scope only; there
is no `draft-update` scope. `updateDraft` says so in its own docblock
(`api/_draftService.js:353`): *"Not idempotency-keyed: the expected revision
already makes a replayed edit either a no-op replay or a conflict. The revision
IS the concurrency token here."*

Executed through the real endpoint (`tests/draft-crud-e2e.mjs`, section
"correcting a refused refresh, and retrying an identical one"):

| Step | Request | Result |
|---|---|---|
| 1 | refresh, key `pkt-…-r2`, context containing `now` | **400 `DRAFT_FIELD_INVALID`** — the producer refuses `pc.now`. Nothing written, key unspent. |
| 2 | refresh, **same key**, corrected context | **200, `packetRebuilt: true`** — the corrected context succeeds; the refusal did not consume the identity. |
| 3 | **identical** retry of step 2 | **409 `DRAFT_REVISION_CONFLICT`** — no second rebuild, revision and stored quote untouched. |
| 4 | same key, stale rev, *different* context | **409** as well. |

So: a corrected context can succeed, and an identical retry cannot duplicate
anything. The mechanism is the revision, not the key — `applyEdit` rejects the
moved revision before `putDraft`'s operationId replay can apply, which is why
step 3 conflicts rather than replaying the 200.

**A conflict is not a failure the seller should see.** A lost response leaves
the client holding a stale revision, and the honest state is "the refresh
already happened." So a 409 `DRAFT_REVISION_CONFLICT` on refresh now re-reads
the draft and stays silent if the packet came back usable
(`_reviewRefreshPacket`, bundle `:22155`). Only a still-unusable packet shows
conflict copy. Asserted in the browser: `PATCHes=1`, `GETs=2`, no error
element, details on screen, verdict `ready`.

**A dead branch found on the way.** `_reviewRefreshErrCopy` compared
`code === 'REV_CONFLICT'` — the constant *name* — while the wire carries
`'DRAFT_REVISION_CONFLICT'` (`api/_draftStore.js:86`). The branch never ran, so
every conflict fell through to "try again in a moment," advice that cannot work
because the stale thing is the revision being resent. Now accepts both spellings
(bundle `:22192`) and says the draft changed elsewhere, with a reopen. Asserted
in the section "a real conflict with another device is still reported."

### §16.4 Q2 — a foreign basis is refused, and the old claim is withdrawn

**The gap was real.** Scan card B, then refresh card A's saved draft: card A's
rebuilt packet came back with `sourceUrl https://x/CARD-B`, `mid 10`, and card
B's retrieval time. The rule this document previously stated — *"A live client
basis still wins — the carry-forward is a fallback, not an override"* — **is
withdrawn.** It cannot be made correct with a card-binding condition, because
**nothing in a `basisMeta` identifies the card it was read for.** There is no
field to bind against, so no binding is possible at this interface.

Fixed by refusing the input rather than ranking it. `handleUpdate` now rejects
any PATCH whose `pricingContext` carries a `basisMeta` own-property, before any
write: **400 `PRICING_CONTEXT_BASIS_NOT_BINDABLE`**, `retryable: false`, with a
hint (`api/drafts.js:312`). A rebuild reassembles from stored values and has no
use for a live basis. The rebuild closure's `declared` override branch is gone
with it (`api/drafts.js:371`) — the record is now the only source.

Two independent defences, verified separately:

1. **Server refuses it.** Four assertions in `tests/draft-crud-e2e.mjs`. Under
   mutation (guard disabled) three of them fail. The fourth — "this draft keeps
   its OWN basis, source and time" — **still passed**, because removing the
   `declared` branch independently prevents the override. Reported as found.
2. **Client never sends it.** `_crPricingContext` is the one builder and refresh
   calls it with `{ basis: null }`. Asserted with a foreign basis deliberately
   populated: `window._crBasis` set to a card-B comp, then card A refreshed —
   the PATCH body contains no `basisMeta` and the string `CARD-B` appears
   nowhere in it, while the global is confirmed still set, so the absence is the
   builder refusing rather than nothing being there. This is the point the
   review made: a populated global is not the question; what leaves the browser
   is.

### §16.5 Q3 — server readiness does **not** incorporate packet findings

**The gap was real, and the fixture proves the three facts the screen had were
insufficient.** A draft created with an empty `pricingContext` reads back:

| Field | Value |
|---|---|
| `packetStatus` | `CURRENT` |
| `packetUsable` | `true` |
| `packet.blocked` | `true` |
| `packet.blockingCodes` | `["MISSING_FEE_MODEL_REVISION"]` |
| `readiness.publishable` | **`true`** |
| `readiness.blockers.length` | **`0`** |

`readinessOf` (`api/_draftService.js:607`) is `validateDraftForSlot(draft)` over
the stored draft fields; it has no view of the packet. Blocking findings are the
producer's: `blocked: blocking.length > 0` where `blocking` is the ERROR-severity
notes (`api/_listingPacket.js:840,875`). Three codes can set it today —
`MISSING_FEE_MODEL_REVISION` (`:623`), `INSUFFICIENT_IDENTITY` (`:700`),
`NO_CARD_NAME` (`:714`). Before the fix this fixture rendered **"Ready to
list."**

Fixed client-side only. Server readiness is left alone: the packet is advisory
and one behaviour gets one implementation, so readiness does not grow a second
notion of blocked.

- `_reviewPacketBlocking()` (bundle `:21762`) is the single reader of
  `blocked`/`blockingCodes`.
- Fourth verdict arm: `data-review-verdict="details-blocked"` (bundle `:21295`),
  "1 problem with the listing details" / "N problems…", distinct from the stale
  arm because the remedy differs by code.
- `_reviewCopyPayload` returns `null` while any finding stands, so **copy is
  withheld** — a blocked packet is one paste from being a live listing.
- Fields stay rendered, so the seller can see which part is wrong; the container
  carries `data-packet-blocked` while still reporting `data-review-packet="usable"`.

**One deliberate departure from the verbatim-copy rule.** Blockers and
disclosures are rendered verbatim. These are not, because the server's text is
not written for a seller — `MISSING_FEE_MODEL_REVISION` reads *"Pass
FEE_MODEL_REVISION from core.js."* Known codes get seller-facing copy (same
shape as `_reviewPacketReasonCopy`); an **unknown** code falls back to the
server's message, so a finding added server-side still reaches the seller
without a client release. Asserted both ways: the code is present, the
developer instruction is not.

**Copy withholding is asserted through the click path, not a hook.** No
test-only production global was added. The test injects an ordinary
`[data-packet-copy]` button — markup the delegated listener already matches —
writes a sentinel to the clipboard, clicks, and asserts the clipboard is
unchanged and the toast says fix rather than refresh.

### §16.6 Negative controls

| Disabled | Suite | Result |
|---|---|---|
| the `details-blocked` verdict arm | `draft-review-screen` | 4 FAIL |
| the `DRAFT_REVISION_CONFLICT` re-read | `draft-review-screen` | 5 FAIL |
| the `basisMeta` refusal in `handleUpdate` | `draft-crud-e2e` | 3 FAIL (the fourth passes for the independent reason in §16.4) |

The conflict-recovery case initially reported as a **thrown** case rather than
clean failures, because a bare `waitForFunction` throws on exactly the
regression the section exists to catch — and a case that throws stops reporting
its own remaining claims. The wait is now defensive and the timeout is a value
the assertions read. Re-run mutated: 9 clean failures, no throw.

### §16.7 Counts, and what this changed

| Suite | Before | After |
|---|---|---|
| `tests/draft-crud-e2e.mjs` | 173 / 0 | **184 / 0** |
| `tests/draft-review-screen.mjs` | 220 / 0 | **249 / 0** |
| `tests/listing-packet-offline.mjs` | 232 / 0 | 232 / 0 |
| `tests/draft-store.mjs` | 135 / 0 | 135 / 0 |
| `tests/draft-list-screen.mjs` | 101 / 0 | 101 / 0 |
| `tests/asset-fingerprints.mjs` | 15 / 0 | 15 / 0 |
| `tests/draft-readiness.mjs` | PASS | PASS |

Run individually with `timeout <n> node tests/<name>.mjs`. `tests/run-all.sh`
was not run.

**Assertion replaced, with its history recorded in the test itself.** The old
text — *"a live client read overrides the stored time rather than being
ignored"* — is preserved verbatim in a `WHAT THIS USED TO ASSERT, AND WHY IT
CHANGED` block above its four replacements, because a commit message is the one
part of the corpus nobody greps.

**Bundle renamed twice.** `34fb750c` → `611f4efe` (the fixes) → **`c61a6ef9`**
(the comment corrections). `611f4efe` is committed nowhere and must never be
cited; `audit/BUNDLE_CITATION_MAP.md` records both hops and flags it as a naming
hazard alongside `fec7fb3a`. `index.html` carries the single reference.

### §16.8 Still open after §16

- **Completion percentage still unverified** (§13). Both figures superseded, no
  replacement.
- `applyEdit` still never updates `priceSource`; A-2 open; `feeBase`/
  `feeBaseLabel` still emit on **2 of 15** venues.
- The four undeclared CSS tokens remain. The blocking stylesheet added here uses
  only `--border` and `--surface-2`.
- `tests/listing-packet-offline.mjs` still carries 4 duplicate `codes` helpers.
- Sections §1–§10 remain historical; the status table at the top of this
  document is the correction, not a rewrite of them.
- §16.4's answer was incomplete and §17 completes it. The create path is now
  bound; `applyEdit`'s `priceSource` gap is untouched.
- **Push and deployment remain blocked by the credential-rotation gate.**

---

## 17. The create path — whose basis does a NEW draft carry?

Asked at review after §16 was accepted: the PATCH refusal covers refreshing an
existing draft, it does not establish that the initial POST attaches the right
card's basis. Raised as a verification question, not a claimed defect. **It was
a defect.** Not on the path the question described, which was already clean, but
on the one it did not.

### §17.1 What was exercised

Populate the browser's basis for card B, reach card A without a new price read,
create A's draft through the control a seller actually clicks, reload, and read
the stored packet. Both create entry points were run, because they differ in
exactly the way that turned out to matter.

| Entry point | Control clicked | Goes through the card panel? |
|---|---|---|
| `startListingDraft()` | `#crSellBtn` (`index.html:2195`, `onclick="startListingDraft()"`) | Yes |
| `startListingDraftForEntry(id)` | the button `hydrateCollectionSellButtons()` renders into the row (`js/core.86000bf2.js:20515`) | **No** |

### §17.2 Result — the panel path was already clean, for the wrong reason

`loadCardUI` nulls `window._crBasis` on every card load
(`js/core.86000bf2.js:3556`, `window._crBasis = null;` with the comment "and no
basis to render the headline from"). So arriving at card A discards B's read and
A's create goes out with a context carrying only `feeModelRevision` and
`feeScheduleVerified`. Asserted, and it passed **before** any change was made:
`loading a card discards the previous card's basis`.

That is existing behaviour answering the question as asked. It is not a binding:
the basis is discarded because the panel reloaded, not because anything checked
who it belonged to.

### §17.3 Result — the Collection path leaked. CONFIRMED DEFECT

`startListingDraftForEntry` lists a saved Collection row and never touches the
panel, so nothing cleared the basis. Card B priced in the panel, then row A
listed, and A's create body carried:

```
pricingContext.basisMeta = { label: 'Card B comp',
  sourceUrl: 'https://…/CARD-B', low: 9, mid: 10, high: 11,
  retrievedAt: '2026-09-08T20:00:00.000Z' }
```

Card B's source, card B's tiers and card B's retrieval time, on card A's draft.
The server stores that faithfully and the reload serves it back — demonstrated
as a **control** in `tests/draft-crud-e2e.mjs`, not asserted as acceptable.

### §17.4 The fix — the basis carries the identity of the card it was read for

`_crBindBasis(basis, card)` (`js/core.86000bf2.js:20312`, immediately above
`_crPricingContext`) stamps `basis.cardKey = _crIntentToken(card)` at read time.
`_crIntentToken` (`:20079`) is reused rather than a second identity hash being
written; it already covers game, type, set, number, grader, grade and cert, and
it is already what the draft's instance key is derived from.

`_crPricingContext(opts)` then uses the ambient basis **only** when the caller
names the card and the stamp matches:

```js
let b = null;
if (ambient && o.card) {
  const want = _crIntentToken(o.card);
  if (ambient.cardKey && String(ambient.cardKey) === want) b = ambient;
}
```

`_crCreateDraft` passes `{ card }`; the refresh path still passes
`{ basis: null }` and is unchanged. Three read paths stamp on the way in:
`fetchAndApplySoldComps`, `_priceSportsVariant`, `_onPrintingChange`.

**The failure direction is deliberate.** An unstamped basis — a read path added
later that forgets to bind — is DROPPED, so the packet records no comp
provenance rather than someone else's. A missing basis is visible on the review
screen; a foreign one looks exactly like a correct one. Asserted directly: `a
basis carrying no card identity is dropped`.

### §17.5 Where this is enforced, stated plainly

**On the client, in one place.** The server cannot do it: a `basisMeta` contains
nothing that names the card it was read for, and on POST a client basis is
legitimate — it is the only way a comp ever enters a packet. So the PATCH-style
refusal of §16.4 is not available here. `tests/draft-crud-e2e.mjs` records that
asymmetry as two CONTROL assertions rather than leaving it unstated:

- `CONTROL: the server does store a basis handed to it on create`
- `CONTROL: so the binding is a client obligation, not a server refusal`

### §17.6 Evidence

New section in `tests/draft-review-screen.mjs`, real Chromium, real controls:

| Assertion | |
|---|---|
| loading a card discards the previous card's basis | passed pre-fix |
| the panel path sends no basis for a card it never priced | passed pre-fix |
| **REGRESSION: a Collection create sends no unbound basis** | **failed pre-fix** |
| **REGRESSION: card B is nowhere in the create body** | **failed pre-fix** |
| the global was populated, so the absence is a refusal, not an empty read | |
| a basis read FOR this card is still sent, tiers and retrieval time intact | |
| a basis carrying no card identity is dropped | |
| the fee revision still goes out, so dropping the basis is not dropping the context | |

Server half, `tests/draft-crud-e2e.mjs`, through the real POST and GET: a
reload holds none of the other card's basis, makes no source claim it cannot
support, and the packet stays usable and unblocked without a basis.

**Negative controls.** Binding condition removed → **4 FAIL**. Stamping removed
(`_crBindBasis` returns the object unstamped) → **2 FAIL**, and the Collection
assertions still passed — because an unstamped basis is refused too. Reported as
found: the two halves do not fail independently in both directions, and the
direction that survives is the safe one.

### §17.7 Two suites this touched, one of which was already broken

`tests/copy-truth-offline.mjs` asserts the ladder records ONE basis by matching
the assignment's source shape; the pattern now matches the bound call, with the
old pattern recorded in a comment beside it. A second assertion was added for
the stamp itself.

`tests/quick-pricing.mjs` builds the server→wire→basis→headline chain by
evaluating extracted bundle source. **It was crashing before this work** —
`ReferenceError: _crRetrievedAtFrom is not defined`, standing since the
retrieval-time work landed earlier the same day, so every integration check
after that point in the file had not run. The real source of
`_crRetrievedAtFrom`, `_crIntentToken` and `_crBindBasis` is now prepended to
the evaluated scope rather than stubbed. **219 passed, 0 failed** — a suite that
would not complete at all before.

### §17.8 Counts and the rename

| Suite | After | Before |
|---|---|---|
| `draft-review-screen` | **268 / 0** | 249 / 0 |
| `draft-crud-e2e` | **190 / 0** | 184 / 0 |
| `quick-pricing` | **219 / 0** | did not complete |
| `copy-truth-offline` | ALL CHECKS PASSED | ALL CHECKS PASSED |
| `launch-audit-regressions` | 438 / 0 | 438 / 0 |
| `listing-packet-offline` · `draft-store` · `draft-list-screen` · `sell-eligibility` · `sell-gate-ordering` | 232 / 135 / 101 / 113 / 38, all 0 failed | unchanged |
| `asset-fingerprints` | 15 / 0 | 15 / 0 |
| `draft-readiness` | PASS | PASS |

`tests/run-all.sh` was not run.

**Bundle renamed once, cleanly:** `c61a6ef9` → **`js/core.86000bf2.js`** (22,331
lines). Single reference updated in `index.html:3772`.
`audit/BUNDLE_CITATION_MAP.md` records it as generation 6 and notes that
`c61a6ef9` — unlike generations 1–4 — is recoverable from git
(`git show ffa735d:js/core.c61a6ef9.js`) for line alignment.

### §17.9 What §17 does not establish

- Nothing about `applyEdit` and `priceSource` (still open).
- Nothing about whether the stamped identity is the RIGHT granularity for a
  card with two physical copies in one collection. `_crIntentToken` does not
  distinguish copies; two rows of the same card, same grade share a token. For
  a price basis that is correct — the comp is about the card, not the copy —
  but it is an assumption, stated here rather than left implicit.
- The panel path's cleanliness still rests on `loadCardUI` nulling the basis
  **as well as** the binding. Both hold today; only the binding is asserted as
  a behaviour.
