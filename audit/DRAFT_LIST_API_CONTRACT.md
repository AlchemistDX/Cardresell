# Draft List API Contract — D2.1

`js/core.d9e1b484.js:18394` points at this path. This file closes that dangling reference.

**Verified against tip `95435b4`**, branch `phase1-block-d`, via
`audit/d21/D21_AND_ORIENTATION_ANSWERS.md`. Every field name below is copied from source, not
inferred. No test was run in producing this.

**The one open binding is now closed** — see §1.2a. Resolving it surfaced one new problem that
needs an owner decision before the client copy table is written: see §3.4a.

---

## Part 1 — The server change

### 1.1 Decision

Extend summary rows with a small server-derived readiness field. Settled by evidence, not
preference: `validateDraftForSlot(draft, slot = draft && draft.slot)`
(`api/_draftStore.js:244`) is a pure synchronous function over the already-read record. Per
row it adds one function call — no KV read, no parse, no await, no new failure mode
(`api/_draftService.js:556-574`).

Rejected: client-side per-draft hydration costs +25 requests and +25 KV reads for a 25-row
page, which is the payload `summarize()` exists to avoid. Rejected: shipping full findings
couples the list wire format to the finding schema.

### 1.2 The field

Added to `summarize()` (`api/_draftService.js:493-513`), making thirteen keys:

```js
readiness: {
  publishable: <boolean>,   // passthrough of the server's own determination
  blockers:    [<VIOLATION code>, ...]   // ERROR severity only, codes only
}
```

`blockers` carries **only `error`-severity codes**, because only `error` blocks:
`blocks(severity) { return severity === SEVERITY.ERROR; }` (`api/_draftStore.js:152-154`).

The four blocking codes (`VIOLATION`, `api/_draftStore.js:156-163`; severity map `:172-190`):

| Code | Meaning |
|---|---|
| `SLOT_PRICE_REQUIRED` | slot requires a price and price is `null`/`undefined` |
| `SLOT_ZERO_PRICE_NOT_ALLOWED` | price is `0` and this slot forbids zero |
| `SLOT_TITLE_TOO_LONG` | title exceeds the slot limit |
| `SLOT_RULES_UNKNOWN` | slot not in the registry |

**Deliberately excluded from `blockers`:** `DRAFT_NO_PRICE_PROVENANCE` (warning) and
`DRAFT_PRICE_SELLER_ENTERED` (info). Neither blocks publish. The provenance warning
additionally fires on **every priced draft in production today**, because
`buildListingPacket()` has no production caller and provenance is inferred from packet
presence (`api/_draftStore.js:288-292`). Shipping it to the list would put a permanent warning
on every row and teach sellers to ignore the marker. When Block B is wired, revisit.

### 1.2a Binding closed — the accessor shape

`validateDraftForSlot` returns via `finish(v)` (`api/_draftStore.js:299-309`):

```js
{
  ok:         <boolean>,   // blocking.length === 0
  violations: [<violation>, ...],   // all severities
  blocking:   [<violation>, ...],   // filtered on x.blocking
  errors:     <number>,
  warnings:   <number>,
  infos:      <number>,
}
```

Each violation is `{ code, field, detail, severity, blocking, message }`, constructed at
`api/_draftStore.js:247-254`.

**Derive both fields from that return value. Do not recompute either:**

```js
const v = validateDraftForSlot(draft, draft.slot);
readiness = { publishable: v.ok, blockers: v.blocking.map((x) => x.code) };
```

`v.blocking` is exactly the ERROR set, not an independent notion — the per-violation flag is
assigned `blocking: blocks(severity)` at `:251`, the same predicate `finish()` counts
`errors` with at `:306`. So `blockers` from `v.blocking` and `blockers` filtered on
`severity === 'error'` are provably the same list. Use `v.blocking`; it is the accessor the
module publishes.

A second readiness formula inside `_draftService` would be the fifth instance of the defect
shape recorded at `js/core.d9e1b484.js:18014-18019`.

### 1.3 Why this is safe to add

Every registered assertion touching summary shape is a subset check — no `Object.keys`
equality, no deep-equal, no snapshot anywhere in `tests/`
(`tests/draft-list-cap.mjs:241-248`, `:541-543`). Slot 23 will catch a removed or renamed
field; it will not object to an added one.

---

## Part 2 — The contract the screen consumes

All of this is current behavior. None of it is proposed.

### 2.1 Request

`GET /api/drafts` reads exactly four query params (`api/drafts.js:111-115`):

| Param | Range | Default | Note |
|---|---|---|---|
| `id` | any non-empty string | `''` | Single-draft read; **all list logic skipped** (`api/drafts.js:118`) |
| `ids` | literal `'1'` only | off | Legacy bare-id mode. **D2.1 must not use it** |
| `limit` | `/^[0-9]+$/`, 1–100 | 25 | Refused, never clamped |
| `cursor` | `/^[0-9]+$/`, ≥ 0 | 0 | **Integer offset, not an opaque token** |

No `sort`, `status`, `slot`, `q`, `offset`, or `page` exists. A repeated param takes its first
value. Empty string is treated as absent.

### 2.2 Success envelope — seven keys, always all present

`api/drafts.js:164-172`:

```
rows, count, total, nextCursor, cap, source, degraded
```

- `rows` — summary rows and/or stub rows (§2.4)
- `count` — rows on **this page after tombstone filtering**. Not page size, not total.
- `total` — ids known to the index. Can exceed the sum of all `count`s across a walk.
- `nextCursor` — integer, or literal `null` at end of walk
- `cap` — 500. Advertised so the UI need not hardcode it.
- `source` — `'index' | 'reconciled' | null`. **Diagnostic only. Do not drive UI off it.**
- `degraded` — boolean

`unavailable` and `reconciled` are computed by the service but **not forwarded** on a 200
(`api/_draftService.js:538,599` consumed at `api/drafts.js:161-163`). Reading
`body.unavailable` on a 200 always yields `undefined`.

### 2.3 Paging — the three traps

**Terminate on `nextCursor === null`. Nothing else.**

1. **`count === 0` does not mean end-of-list.** A fully-tombstoned mid-list page returns
   `count: 0` with a non-null `nextCursor` (pinned `tests/draft-list-cap.mjs:444-449`).
2. **`total === 0` is the only signal of genuine emptiness.** `rows.length === 0` is not.
3. **Echo `nextCursor`; never compute it.** The source comment at
   `api/_draftService.js:592-595` warns explicitly against deriving it from `count`.

Ordering: ids sort lexically, the cursor is a numeric offset into that order, recency applies
**only within a page** (`api/_draftService.js:535-550`). The client must not re-sort across
pages — that would fabricate an ordering the server does not provide.

### 2.4 Row shapes

**Summary row — two keys:** `{ draftId, summary }` (`api/_draftService.js:565`).
`summary` holds twelve keys today, thirteen after Part 1:
`draftId, sku, instanceId, slot, status, rev, title, price, quantity, createdAt, updatedAt,
hasPacket` + `readiness`.

`packet` is deliberately absent. `hasPacket` is **always `false` in production** until Block B
is wired.

**Stub row — four keys:** `{ draftId, summary: null, reason, retryable }`.

**Discriminate on `row.summary` being truthy**, then switch on `row.reason`. That is the field
the tests key on (`tests/draft-list-cap.mjs:241, 295, 316, 360`).

Tombstoned drafts are filtered out entirely and never reach the client
(`api/_draftService.js:567, 577`).

### 2.5 The four stub kinds

`ROW_REASON`, `api/_draftService.js:485-491`:

| `reason` | `retryable` | Trigger |
|---|---|---|
| `DRAFT_READ_FAILED` | `true` | the store call itself threw |
| `DRAFT_VANISHED` | `false` | indexed, but the record is positively absent |
| `DRAFT_SCHEMA_TOO_NEW` | `false` | written by a newer CardResell |
| `DRAFT_UNREADABLE` | `false` | stored bytes are not a draft we can parse |

**Two naming traps.**

1. The row emits `'DRAFT_UNREADABLE'`; the store's own constant is
   `'DRAFT_RECORD_UNREADABLE'` (`api/_draftStore.js:91`). **Match the row value.** A client
   switching on the store spelling falls silently to a default branch.
2. `SUMMARY_UNREADABLE = 'unreadable'` (`api/_draftService.js:483`) is **dead** — declared,
   zero readers repo-wide, never emitted. Never write `reason === 'unreadable'`.

**The server supplies no human-readable text for any stub.** Only `reason`, `retryable`,
`draftId`. Do not route stub reasons through `reasonMessage()` (`api/_draftStore.js:208-225`)
— it covers publish violations only, and a stub `reason` hits its `default` branch and returns
the generic *"This draft cannot be listed yet."*, which is wrong copy for a row that failed to
read.

### 2.6 Unavailable vs degraded vs empty

The single most load-bearing rule on this screen, stated twice in source
(`api/drafts.js:128-130`, `api/_draftIndex.js:357-363`): a failure must never render as "you
have no drafts."

```
status 503                          → UNAVAILABLE. Never render the empty state.
  body has `retryable: true`        → list read failed (api/drafts.js:162)
  body has no `retryable` key       → store misconfigured (api/drafts.js:50)
status 200 && degraded === true     → DEGRADED. Render rows AND a banner.
status 200 && total === 0           → EMPTY. Render the empty state.
status 200 && total > 0 && !rows    → NOT empty. Keep paging.
```

`degraded: true` does not mean rows are missing or wrong. It means index completeness is
unproven. Show the list plus a non-blocking banner; never hide the list.

### 2.7 Create replay

`api/drafts.js:219-235`. Nine keys, **byte-identical between fresh and replay**:
`draft, draftId, saved, replayed, idempotencyState, degraded, repairRequired, index,
publishable`.

- **201 = fresh, 200 = replay.** Treat both as success and open `body.draftId`.
- The `draftId` is identical on replay — minted inside the protected operation
  (`api/_draftService.js:222`).
- **Branch on `replayed` or the status code, never on `idempotencyState`.** Two values arrive
  with `replayed: true`: `'replayed'` and `'reconciled'`. A client special-casing
  `'replayed'` mishandles crash recovery.
- A reconcile-path replay legitimately returns `degraded: true, repairRequired: true`
  (`api/_draftService.js:290-295`). That is not an error.

Failure shapes worth distinguishing: 409 `mismatch` carries `code` and `retryable: false`;
409 `in-flight` omits `code` and carries `retryable: true`. On a 409, absence of `code` means
in-flight.

---

## Part 3 — The screen

### 3.1 Mounting and navigation

There is no router. Screens are top-level `<div>`s that `switchView(view)` shows and hides
(`js/core.d9e1b484.js:8111-8137`; containers at `index.html:1674, 2431, 2516, 2579`; tabs at
`index.html:1667-1671`).

Add a `#draftsView` container, a tab, and a branch in `switchView`. Call
`switchView('drafts')`.

### 3.2 Auth

Use `_crIdToken()` (`js/core.d9e1b484.js:18093-18108`). There is **no canonical
authenticated-fetch wrapper** — roughly 25 call sites hand-roll
`'Authorization': 'Bearer ' + token`. Hand-roll it once here and do not add another inline
force-refresh block; the bundle already carries six, and the comment claiming four is stale.

### 3.3 Primitives that do not exist

Build: a list-row renderer (both existing list screens hand-build
`<table class="flip-table">` inline), a degraded/error banner (only a single-use
`.warning-banner` exists), and a spinner (CSS only).

Reuse: `showToast()` (`js/core.d9e1b484.js:17500-17520`), `.empty-flips` empty-state CSS
(`index.html:1024-1027`).

CSS lives inline in `index.html` — there is no stylesheet file. JS-rendered components use
inline `style="..."` in template literals; that is the de-facto convention.

### 3.4 Row copy

| Condition | Copy | Action |
|---|---|---|
| `blockers` includes `SLOT_PRICE_REQUIRED` | Needs price | opens draft |
| `blockers` includes `SLOT_ZERO_PRICE_NOT_ALLOWED` | Price can't be $0 for this venue | opens draft |
| `blockers` includes `SLOT_TITLE_TOO_LONG` | Title too long | opens draft |
| `blockers` includes `SLOT_RULES_UNKNOWN` | Venue not supported | opens draft |
| `DRAFT_READ_FAILED` | Couldn't load this draft. It's still saved. | **Try again** (only kind where retry is honest) |
| `DRAFT_VANISHED` | This draft is no longer in storage. | none |
| `DRAFT_SCHEMA_TOO_NEW` | Saved by a newer version of CardResell. Reload to update. | Reload |
| `DRAFT_UNREADABLE` | This draft's saved data can't be read. | none |

Never say "deleted" for `DRAFT_VANISHED` — the server has not established that, and deleted
drafts are filtered out before they reach the client.

Every stub renders as a **visible row**. Never filter one out. `api/_draftService.js:464-470`:
a record we could not read is not a record that does not exist.

The four stub rows are genuinely the client's to author — the server ships no text for them
(§2.5). **The four blocker rows are not.** See §3.4a.

### 3.4a OPEN DECISION — the server already owns blocker copy

Closing the §1.2a binding surfaced this, and it changes §3.4.

Every violation object already carries a `message`, populated at `api/_draftStore.js:252` from
`reasonMessage(code, { venue, slot, ...ctx })`. That function has real per-code copy for all
four blocking codes (`api/_draftStore.js:208-225`):

| Code | Server message |
|---|---|
| `SLOT_PRICE_REQUIRED` | "This listing needs a price before it can be sent." |
| `SLOT_ZERO_PRICE_NOT_ALLOWED` | "A price of zero is not allowed for `{venue}`." |
| `SLOT_TITLE_TOO_LONG` | "Title is `{length}` characters; `{venue}` allows `{max}`. Shorten it by `{n}`." |
| `SLOT_RULES_UNKNOWN` | "CardResell does not know how to list to `{slot}` yet." |

So §3.4's first four rows are a **second copy source for a business message the server already
produces** — rule 1, the defect shape that has bitten this project four times. Two concrete
consequences, not stylistic ones:

1. `SLOT_TITLE_TOO_LONG`'s server message is **computed** from `length`, `max` and venue. A
   codes-only wire throws that away, and "Title too long" cannot be reconstructed into
   "Shorten it by 12" on the client without re-deriving the limit — a second copy of the slot
   rules table on top of a second copy of the copy.
2. `SLOT_ZERO_PRICE_NOT_ALLOWED` and `SLOT_RULES_UNKNOWN` interpolate venue and slot. Same
   problem, smaller blast radius.

Three ways out. This is an owner call:

- **(a) Ship `message` alongside `code`.** `blockers: [{ code, message }, ...]`. Server stays
  the single copy owner, interpolation survives, wire cost is a short string per blocker on
  rows that have one. Costs the wire-format minimalism §1.2 was aiming at.
- **(b) Keep codes only, and accept terse chips as a distinct register.** A row chip
  ("Needs price") and a detail sentence ("This listing needs a price before it can be sent.")
  are arguably different surfaces, not duplicate implementations. Defensible — but it must be
  written down as a decision, and `SLOT_TITLE_TOO_LONG` still loses its numbers, so its chip
  has to stay genuinely generic and D3 has to carry the specific sentence.
- **(c) Codes only, chips generic, and every blocker row links to D3** where the server
  message is rendered verbatim from the per-draft read. Cheapest wire, no duplicate copy, at
  the cost of one navigation for the seller to learn the specific number.

My read: **(a)**. It keeps one copy owner for one business message, which is rule 1 applied
literally, and the wire cost is a handful of bytes on the minority of rows that are blocked.
(b) is the option that looks cheapest today and quietly re-creates the duplication the rule
exists to prevent. But this is a product-voice call as much as an architecture one, so it is
yours.

**Until this is decided, do not write the §3.4 blocker copy into the client.** The stub copy
(bottom four rows) is unaffected and can proceed.

### 3.5 Copy rules

Labels are exactly **Drafts** and **All drafts**. Never Recent, Latest, My Drafts, or Saved.
Neither string exists in the client yet and nothing polices wording — there is no string table
anywhere in the codebase. Unfinished states say **under maintenance**, never "beta."

### 3.6 Touch and contrast

44×44 minimums are ad-hoc per-selector `min-height` / `min-width` rules, not a class or token
(`index.html:1072-1091`), asserted rule-by-rule at
`tests/a11y-mobile-2026-09-04.mjs:269-330`. Match the existing pattern and add the new
selectors to that block.

Secondary text uses `--text-muted` (`index.html:89`, `:123`). **Do not use `--text-faint`** —
it is an open contrast finding at 1.90:1. Do not define a new token.

---

## Part 4 — Tests

New suite `tests/draft-list-screen.mjs`, flat in `tests/`, using `harness()` from
`tests/_assert.mjs:10`. To evaluate the shipped client, import
`readCoreBundle`/`resolveCoreBundle` from `tests/_assetRefs.mjs:84,113` — never glob `js/`, or
the suite may read the retired `core.569ff536.js`.

**Registration is what makes it a gate.** Copy slot 23's shape
(`tests/run-all.sh:205-211`), ungated:

```bash
echo ""
echo "▶ [27/27] D2.1 draft list screen (offline)"
if node "$ROOT/tests/draft-list-screen.mjs"; then
  :
else
  FAIL=1
fi
```

The `else FAIL=1` branch is mandatory — without it the suite runs, prints, and does not gate.
The `[n/26]` labels are literal strings and `[26/26]` is currently the last; adding a 27th
means renumbering the banners or accepting a wrong count.

Cases:

1. `price: null` yields `SLOT_PRICE_REQUIRED` in `blockers`; `price: 0` on a slot with
   `allowsZeroPrice: true` (`whatnot:auction`, `api/_draftStore.js:119`) does **not**. This is
   the `f0324d4` regression at list level, and the exact reason `if (!row.price)` is wrong —
   `!0 === true` would mark a publishable $0 Whatnot draft as needing a price.
2. The client renders "Needs price" only from `blockers`, including the adversarial case of an
   absent price with an empty `blockers` array.
3. All four stub kinds render a visible row with their own copy. Assert the client matches
   `'DRAFT_UNREADABLE'` and never `'DRAFT_RECORD_UNREADABLE'` or `'unreadable'`.
4. Only `DRAFT_READ_FAILED` offers retry.
5. `count: 0` with a non-null `nextCursor` continues the walk.
6. `total: 0` is the only path to the empty state.
7. 503 with `retryable` and 503 without are distinguished, and neither renders "no drafts."
8. `degraded: true` renders rows plus a banner, never a hidden list.
9. A 200 replay opens the same `draftId` as the 201 would have.
10. `readiness` is present and correctly typed on every summary row.
11. `readiness.publishable === v.ok` and `readiness.blockers` equals
    `v.blocking.map(x => x.code)` for a fixture set spanning all four blocking codes — pins
    §1.2a against a reintroduced second formula.

---

## Part 5 — Bundle rename

`core.d9e1b484.js` is served `max-age=31536000, immutable` (`vercel.json:47-48`). Changed bytes
at an existing hashed URL are permanently poisoned for cached clients.

There is no script. Manual, and the rename is the **last** step:

1. Make the byte edit.
2. `sha256(file)`, take the first 8 hex characters.
3. Rename to `core.<newhash>.js`.
4. Update the single reference at `index.html:3515`.
5. Keep the old file.
6. Run `tests/asset-fingerprints.mjs` (slot 1).

Nothing catches a violation at edit time — no linter, no formatter, no `package.json`. Run
`node --check` on every changed JS file.

---

## Part 6 — Acceptance

- [ ] Labels are Drafts and All drafts; nothing says Recent or Latest.
- [ ] Paging walks the integer offset cursor over lexical id order.
- [ ] Recency ordering applied within a page only; no cross-page re-sort.
- [ ] Walk terminates on `nextCursor === null`, never on `count === 0`.
- [ ] Empty state reachable only via `total === 0`.
- [ ] Both 503 shapes render as "couldn't load," never as "no drafts."
- [ ] `degraded: true` renders rows plus banner.
- [ ] All four stubs render visible rows with authored copy; only `DRAFT_READ_FAILED` retries.
- [ ] `readiness` derived from `v.ok` / `v.blocking`, not recomputed (§1.2a).
- [ ] §3.4a decided, and blocker copy has exactly one owner.
- [ ] "Needs price" derives from `readiness.blockers`; no `if (!price)` anywhere in the client.
- [ ] $0 renders distinctly from absent price.
- [ ] Replay (200) opens the existing draft with no error.
- [ ] Created draft opened by returned `draftId`, never `rows[0]`.
- [ ] New coarse-pointer targets are 44×44 and added to the a11y test's asserted block.
- [ ] New secondary text uses `--text-muted`.
- [ ] Suite registered with `else FAIL=1`.
- [ ] Bundle renamed, `index.html:3515` updated, old file kept, slot 1 run.
- [ ] Stated which tests and gates were not run.

---

## Part 7 — Out of scope

- Any publish control. There is no publish path in Phase 1 by design.
- D3's review screen. D2.1 navigates to a draft; rendering the packet is D3.
- Atomic one-active-draft-per-(instance, slot) — still absent (`createDraft()`). D2.1 may
  surface duplicates if they exist; it must not hide them and must not invent client-side
  enforcement.
- Non-eBay slots. The server registry accepts five, the client exposes one. If a non-eBay slot
  appears in a row, render it. Filtering a seller's own record would be its own rule violation.
- Wiring `buildListingPacket()`. Until that lands, `hasPacket` is always false — do not build
  UI that depends on it.

---

## Verification log

Checked against tip `95435b4` while filing. Read-only; no test run, nothing pushed.

**Confirmed exactly as written:**

- `validateDraftForSlot(draft, slot = draft && draft.slot)` at `api/_draftStore.js:244`, pure
  and synchronous; returns through `finish(v)` at `:299-309`.
- `blocks(severity)` at `:152-154`, with the source comment "Only ERROR blocks a handoff.
  Nothing else may."
- All six `VIOLATION` codes at `:156-163`, spellings as given.
- `SEVERITY = { ERROR: 'error', WARNING: 'warning', INFO: 'info' }` at `:149`.
- `whatnot:auction` is the **only** slot with `allowsZeroPrice: true` (`:119`); the other four
  (`ebay:fixed-price`, `ebay:auction`, `mercari:fixed-price`, `tcgplayer:fixed-price`) are
  `false`. Title limits 80 / 80 / 40 / 80 / 200.
- Slot 23 registration block at `tests/run-all.sh:205-211`, shape reproduced correctly
  including `else FAIL=1`. `[26/26]` is the final label, so a 27th requires renumbering.
- `reasonMessage()`'s `default` branch returns "This draft cannot be listed yet." — correct
  that it is wrong copy for a stub row.

**One correction, folded in as §3.4a:** the spec's premise that the server supplies no
human-readable text is true for the **four stub kinds** but false for the **four blocking
codes**. Every violation object carries a `message` from `reasonMessage()` (`:252`), and that
function has specific, partly interpolated copy for all four blockers (`:208-225`). Authoring
fresh client copy for those four would duplicate a business message the server already owns,
and `SLOT_TITLE_TOO_LONG` would lose its computed "Shorten it by N". Filed as an open owner
decision with three options; my recommendation is (a), ship `message` next to `code`.

**Unverified / not attempted:** none of the runtime claims were exercised, since running tests
was out of scope for this filing. The `f0324d4` regression reference in Part 4 case 1 was not
traced to that commit.
