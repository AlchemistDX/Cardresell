# Draft List API Contract — D2.1

`js/core.d9e1b484.js:18394` points at this path. This file closes that dangling reference.

**Verified against tip `95435b4`**, branch `phase1-block-d`, via
`audit/d21/D21_AND_ORIENTATION_ANSWERS.md`. Every field name below is copied from source, not
inferred. No test was run in producing this.

**Amendment 1 applied 2026-09-06** (owner-decided). Both open items are closed: rows are not
tappable in D2.1 (§3.1a), and blocker copy is owned by the server and shipped on the wire
(§1.2, §3.4). Nothing in this document is awaiting a decision.

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
  publishable: <boolean>,
  blockers: [{ code: <VIOLATION code>, message: <string> }, ...]
}
```

Derived, not recomputed (§1.2a):

```js
const v = validateDraftForSlot(draft, draft.slot);
readiness = {
  publishable: v.ok,
  blockers: v.blocking.map((x) => ({ code: x.code, message: x.message }))
};
```

`v.blocking` is exactly the ERROR set, because only `error` blocks:
`blocks(severity) { return severity === SEVERITY.ERROR; }` (`api/_draftStore.js:152-154`).
Take `code` and `message` only — `field`, `detail`, `severity`, and `blocking` are redundant on
the wire, since every element of `v.blocking` is by construction blocking and of error
severity.

`message` is already interpolated server-side. The client performs no substitution.

The four blocking codes (`VIOLATION`, `api/_draftStore.js:156-163`; severity map `:172-190`)
and their server messages (`api/_draftStore.js:208-225`):

| Code | Meaning | Server message |
|---|---|---|
| `SLOT_PRICE_REQUIRED` | slot requires a price and price is `null`/`undefined` | This listing needs a price before it can be sent. |
| `SLOT_ZERO_PRICE_NOT_ALLOWED` | price is `0` and this slot forbids zero | A price of zero is not allowed for `{venue}`. |
| `SLOT_TITLE_TOO_LONG` | title exceeds the slot limit | Title is `{length}` characters; `{venue}` allows `{max}`. Shorten it by `{n}`. |
| `SLOT_RULES_UNKNOWN` | slot not in the registry | CardResell does not know how to list to `{slot}` yet. |

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
readiness = {
  publishable: v.ok,
  blockers: v.blocking.map((x) => ({ code: x.code, message: x.message }))
};
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

### 2.8 The `focus` parameter

Added by Amendment 2. A contract change, not a screen behavior, so it lives with the other
paging concerns.

**Why it exists.** `newDraftId()` is `drf_${randomBytes(16).toString('hex')}`
(`api/_draftStore.js:105-107`) and paging sorts ids lexically (`api/_draftService.js:574`), so a
new draft's page position is **uniformly random** — not "usually recent."

| Seller's drafts | P(new draft on page 1) |
|---|---|
| 25 | 100% |
| 200 | 12.5% |
| 500 (cap) | 5% |

Amendment 1's page-forward rule therefore cost up to 20 sequential authenticated requests
before first paint, and a highlight-only-if-already-loaded rule would have degraded silently
with usage: flawless on a dev account with six drafts, failing for the sellers with the most at
stake. The server can answer directly — `listDraftSummaries` already holds `ordered`, the
complete sorted id array (`api/_draftService.js:574`), and already returns
`total: ordered.length` (`:614`). The offset of any id is `ordered.indexOf(draftId)`, free in
memory it already has.

**No bounded client loop, ever.** `api/_draftService.js:162` records that concurrent requests
took a 500-cap seller to 519 in a test. The cap can be exceeded, so "up to 20 pages" is a floor,
not a ceiling. A client written as `for (let p = 0; p < 20; p++)` would be wrong on exactly the
seller it was written for.

#### Request

`GET /api/drafts?focus=<draftId>` — optional, read only on the hydrated list path. Ignored on
the `?ids=1` path, which D2.1 does not use.

The server resolves the id to its offset in `ordered` and serves **the page containing it**,
aligned to `limit` boundaries so the cursor contract is unchanged:

```js
pageStart = Math.floor(focusOffset / limit) * limit;
```

Everything downstream — `nextCursor`, `count`, `total`, ordering, recency-within-page — behaves
exactly as for an equivalent `cursor` request. `focus` resolves to an offset and then stops
being special.

#### Validation — refuse, never clamp

Follows the existing pattern at `api/drafts.js:145-155`.

| Condition | Status | Body |
|---|---|---|
| `focus` does not match the draft-id format | 400 | `{ error: 'focus must be a draft id', code: 'LIST_FOCUS_INVALID' }` |
| `focus` and `cursor` both supplied | 400 | `{ error: 'focus and cursor cannot be combined', code: 'LIST_FOCUS_CURSOR_CONFLICT' }` |

Sending both is a caller defect, not a preference to resolve — refuse rather than pick a winner
(§5.6). The id format is **server-owned**; the client never validates a draft id and never
constructs one. It echoes what the create response gave it.

**Rule-1 note on the format predicate.** No draft-id format check existed anywhere before this
amendment — `?id=`, PATCH, and DELETE all test only for non-empty (`api/drafts.js:118, 241,
268`). Writing a regex inline for `focus` alone would create a second, narrower definition of
"draft id" sitting next to the generator that actually owns the format. The predicate is
therefore exported once from `_draftStore.js`, beside `newDraftId()`, and `focus` calls it.
Retrofitting the other three paths onto the same predicate is deliberately **not** part of this
amendment: those paths currently accept any non-empty string and tightening them is a
behavior change with its own blast radius. Tracked in Part 7.

#### Envelope

One key added to the seven in §2.2:

```
focusOffset: <integer> | null
```

- **Integer** — the id was found in `ordered`; the served page is the one containing it.
- **`null`** — the id is not in the index. The server serves page 1.

**`focusOffset` is a found/not-found signal and a diagnostic. It is not row arithmetic.** The
client marks the row whose `draftId` matches the created id, and must never compute a row
position from `focusOffset`.

#### The trap: a non-null `focusOffset` does not guarantee the row is on the page

`ordered` is the id list, and tombstoned ids are dropped only after hydration — the read returns
`STORE_ERR.DELETED` and the row becomes `null` (`api/_draftService.js:590`), then
`rows.filter((r) => r !== null)` removes it (`:600`). This is the same mechanism that lets
`count` fall below the page size (§2.2). A focused id tombstoned between index write and read
resolves to an offset, is served, and then disappears from `rows`.

So the client handles two independent facts: what `focusOffset` says, and whether a matching row
is actually present. §3.1a is written so both resolve to the same safe outcome.

## Part 3 — The screen

### 3.1 Mounting and navigation

There is no router. Screens are top-level `<div>`s that `switchView(view)` shows and hides
(`js/core.d9e1b484.js:8111-8137`; containers at `index.html:1674, 2431, 2516, 2579`; tabs at
`index.html:1667-1671`).

Add a `#draftsView` container, a tab, and a branch in `switchView`. Call
`switchView('drafts')`.

**Trap:** `switchView` uses three different show/hide mechanisms. `.flips-view` carries
`display:none` in CSS (`index.html:954`), so setting `style.display = ''` on a container in that
class yields a blank tab — documented at `js/core.d9e1b484.js:8131-8134`. Set an explicit
display value, or keep `#draftsView` out of `.flips-view`.

### 3.1a Rows are not tappable in D2.1

**The drafts list is informational. No row opens anything.**

D3 is the screen that renders a full draft, and it is not built. The alternatives were a
stripped-down detail view inside D2.1, which risks becoming a half-D3 that D3 later has to tear
out, or routing a tap back to the card panel, which is built around a fresh scan rather than a
stored draft and is more plumbing than it appears.

D3 adds row navigation when it lands. Until then a row is something a seller reads, not
something they open.

**Consequence for the "navigate by returned ID" contract.** With no detail screen, the
requirement to navigate by the returned `draftId` and never by `rows[0]` is satisfied at the
list level. Amendment 2 replaced the original page-forward rule with four principles that leave
the client no branch to get wrong:

1. **One request. Render what the server sent.** Open **All drafts** with
   `?focus=<draftId>` from the create response (§2.8). Never block first paint. Never loop.
2. **Highlight the row whose `draftId` matches the created id**, if that row is present.
3. **If no matching row is present, show a one-line notice: the draft is saved and may take a
   moment to appear.** Take the framing from the create response's own `degraded` /
   `repairRequired` flags, which state it directly — `api/drafts.js:229-230`: "the draft IS
   saved. Only finding it in a list may lag."
4. **Never page-hunt. Never let absence render as loss.**

Principle 2 keeps the no-`rows[0]` rule intact: the id is still matched, just not chased.

Principle 3 covers all three ways a row can go missing — reconcile lag, a tombstone race
(§2.8), and an index that has not caught up — with one message that is true in every case and
invents no cause. The client does not try to distinguish them; the server cannot cheaply do so
either, and a guessed cause would violate §5.2.

A replay (HTTP 200, same `draftId`) takes the identical path — same `focus` request, same
highlight, same notice if absent. That is the replay-is-success rule with no detail screen
behind it.

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

**The client authors no blocker copy.** A blocked row renders `readiness.blockers[n].message`
verbatim, as a second line beneath the title, in `--text-muted`.

Render **every** blocker on the row, each on its own line. There are at most four. Showing one
and hiding the rest would be omission dressed as brevity.

A non-textual marker is permitted and encouraged — a coloured left border, a dot, the wrench
icon — because it is not copy and does not duplicate the server's message. **A text chip is
not permitted**, since authoring "Needs price" alongside the server sentence re-creates exactly
the duplication this decision removes.

`code` is on the wire for branching and testing, not for display. The client may switch on it
to choose a marker; it must never map it to a string.

Why the server owns this: per §3.1a a row cannot be tapped, so the row is the **only** place a
seller ever learns what is wrong with their draft. A four-word chip is a dead end — "Title too
long" with no way to discover how long. The row must carry the real sentence, and the server
already owns it, with interpolated values a client cannot reconstruct without a second copy of
the slot rules table.

#### Stub rows — the client's to author

The server ships no text for the four stub kinds, and routing a stub `reason` through
`reasonMessage()` hits its `default` branch and returns the wrong sentence (§2.5).

| `reason` | Copy | Action |
|---|---|---|
| `DRAFT_READ_FAILED` | Couldn't load this draft. It's still saved. | **Try again** |
| `DRAFT_VANISHED` | This draft is no longer in storage. | none |
| `DRAFT_SCHEMA_TOO_NEW` | Saved by a newer version of CardResell. Reload to update. | Reload |
| `DRAFT_UNREADABLE` | This draft's saved data can't be read. | none |

Only `DRAFT_READ_FAILED` carries `retryable: true`; it is the only kind where a retry is
honest. Never say "deleted" for `DRAFT_VANISHED` — the server has not established that, and
genuinely deleted drafts are filtered out before they reach the client.

Every stub renders as a **visible row**. Never filter one out. `api/_draftService.js:464-470`:
a record we could not read is not a record that does not exist.

### 3.5 Copy rules

Labels are exactly **Drafts** and **All drafts**. Never Recent, Latest, My Drafts, or Saved.
Neither string exists in the client yet and nothing polices wording — there is no string table
anywhere in the codebase. Unfinished states say **under maintenance**, never "beta."

### 3.6 Touch and contrast

44×44 minimums are ad-hoc per-selector `min-height` / `min-width` rules, not a class or token
(`index.html:1072-1091`), asserted rule-by-rule at
`tests/a11y-mobile-2026-09-04.mjs:269-330`. Match the existing pattern and add the new
selectors to that block.

Per §3.1a the row itself is not a touch target. The only interactive elements this screen ships
are the **Try again** and **Reload** actions on stub rows (§3.4) and the paging control — those
are what need 44×44 and what belong in the asserted block. Do not give a non-interactive row a
touch-target rule; it would assert a tap affordance the screen deliberately does not have.

One caveat worth stating plainly: `tests/a11y-mobile-2026-09-04.mjs` is **not registered** in
`tests/run-all.sh`. Adding selectors to its asserted block is correct, but it will not gate
until someone registers it. Registering it is out of scope here and is not tracked elsewhere.

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
**DONE 2026-09-06.** Registered as `[27/27]`; all 29 `[n/26]` labels renumbered to `[n/27]`.
The `[n/26]` labels were literal strings and `[26/26]` was the last; adding a 27th
means renumbering the banners or accepting a wrong count.

Cases:

1. `price: null` yields `SLOT_PRICE_REQUIRED` in `blockers`; `price: 0` on a slot with
   `allowsZeroPrice: true` (`whatnot:auction`, `api/_draftStore.js:119`) does **not**. This is
   the `f0324d4` regression at list level, and the exact reason `if (!row.price)` is wrong —
   `!0 === true` would mark a publishable $0 Whatnot draft as needing a price.
2. The client renders blocker text only from `readiness.blockers[n].message`. Assert with a
   fixture whose message is a recognisable sentinel string, and assert that string appears in
   the rendered row.
3. All four stub kinds render a visible row with their own copy. Assert the client matches
   `'DRAFT_UNREADABLE'` and never `'DRAFT_RECORD_UNREADABLE'` or `'unreadable'`.
4. Only `DRAFT_READ_FAILED` offers retry.
5. `count: 0` with a non-null `nextCursor` continues the walk.
6. `total: 0` is the only path to the empty state.
7. 503 with `retryable` and 503 without are distinguished, and neither renders "no drafts."
8. `degraded: true` renders rows plus a banner, never a hidden list.
9. A 200 replay resolves to the same `draftId` a 201 would have, and surfaces no error.
10. `readiness` is present and correctly typed on every summary row, with `blockers` an array
    of `{ code, message }` objects.
11. Every blocker on a multi-blocker row is rendered, not just the first.
12. `readiness.publishable === v.ok` and `readiness.blockers` equals
    `v.blocking.map(x => ({ code: x.code, message: x.message }))` for a fixture set spanning
    all four blocking codes — pins §1.2a against a reintroduced second formula.
13. Source-text tripwire: the drafts-screen code contains none of the four blocking codes
    mapped to a literal string. This is a tripwire, not proof — it catches the obvious
    reintroduction, not a clever one.
14. After a create whose `draftId` is deliberately not `rows[0]`, the list highlights the row
    matching that id. A 200 replay with the same id highlights the same row.
15. No row carries a click, tap, or key handler, and no code path calls `switchView` to a
    detail view — pins §3.1a.

---

### Added by Amendment 2

**16.** `focus` for an id at a mid-list offset serves the page containing it, with
`focusOffset` equal to its absolute offset in `ordered` and `nextCursor` correct for that
page's boundary.

**17.** `focus` for an id absent from the index serves page 1 with `focusOffset: null`.

**18.** `focus` with a malformed id returns 400 `LIST_FOCUS_INVALID`. `focus` combined with
`cursor` returns 400 `LIST_FOCUS_CURSOR_CONFLICT`.

**19.** A focused id that is tombstoned yields a non-null `focusOffset` with no matching row in
`rows`. The client renders the notice, not an error and not a blank.

**20.** A focused id at offset 499 — and at 518, per the over-cap case at
`api/_draftService.js:162` — resolves in exactly one request.

**21.** The create-to-list path issues **exactly one** list request. Assert the count, not the
absence of a loop; a bounded loop that happens to terminate at one on the fixture would
otherwise pass.

**22.** A create whose response carries `degraded: true, repairRequired: true` renders the
notice, and the notice text is not authored per-cause — the same string appears for the
tombstone case in test 19.

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
- [ ] Blocked rows render the server `message` verbatim; the client contains no blocker copy.
- [ ] Every blocker on a row is rendered, not just the first.
- [ ] No text chip duplicates a server message.
- [ ] Blocked state derives from `readiness`; no `if (!price)` anywhere in the client.
- [ ] $0 renders distinctly from absent price.
- [ ] Rows are not tappable; no detail view was built.
- [ ] Replay (200) is treated as success with no error surfaced.
- [ ] Created and replayed drafts are located by `draftId` and highlighted, never by position.
- [ ] Interactive elements only (stub actions, paging) are 44×44 and added to the a11y test's
      asserted block; non-interactive rows are not given touch-target rules.
- [ ] New secondary text uses `--text-muted`.
- [ ] Suite registered with `else FAIL=1`.
- [ ] Bundle renamed, `index.html:3515` updated, old file kept, slot 1 run.
- [ ] Stated which tests and gates were not run.

---

### Added by Amendment 2

- [ ] Exactly one list request on the create-to-list path; no loop, bounded or otherwise.
- [ ] Row matched by `draftId`; no row position computed from `focusOffset`.
- [ ] Missing row renders the saved-may-lag notice, identical across all three causes.
- [ ] `focus` misuse refused with a 400, never clamped or silently ignored.

Amendment 2's brief called for removing Amendment 1's page-forward acceptance line. There was
none: the page-forward rule lived only in §3.1a's prose, and the surviving acceptance item
above — "located by `draftId` and highlighted, never by position" — is unaffected by this
amendment and stays as written. Nothing was removed.

## Part 7 — Out of scope

- Any publish control. There is no publish path in Phase 1 by design.
- **Row navigation.** Deferred to D3, which must add it. D2.1 ships a read-only list (§3.1a).
- A detail or review view of any kind, however minimal.
- Registering `tests/a11y-mobile-2026-09-04.mjs` in `run-all.sh` (§3.6).
- Atomic one-active-draft-per-(instance, slot) — still absent (`createDraft()`). D2.1 may
  surface duplicates if they exist; it must not hide them and must not invent client-side
  enforcement.
- Non-eBay slots. The server registry accepts five, the client exposes one. If a non-eBay slot
  appears in a row, render it. Filtering a seller's own record would be its own rule violation.
- Wiring `buildListingPacket()`. Until that lands, `hasPacket` is always false — do not build
  UI that depends on it.

---

### Added by Amendment 2

- **Retrofitting `?id=`, PATCH, and DELETE onto the shared draft-id predicate.** Those three
  paths test only for non-empty (`api/drafts.js:118, 241, 268`). `focus` uses the exported
  predicate from `_draftStore.js`, but tightening the existing paths is a behavior change with
  its own blast radius and belongs in its own unit.
- **Distinguishing why a focused row is missing.** Reconcile lag, tombstone race, and index lag
  all render the same notice by design (§3.1a principle 3).

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
  including `else FAIL=1`. `[26/26]` was the final label, so the 27th required renumbering all
  29 label strings — done in the same commit as the server change.
- `reasonMessage()`'s `default` branch returns "This draft cannot be listed yet." — correct
  that it is wrong copy for a stub row.

**One correction, raised on filing and now resolved by Amendment 1:** the spec's premise that
the server supplies no human-readable text is true for the **four stub kinds** but false for the
**four blocking codes**. Every violation object carries a `message` from `reasonMessage()`
(`:252`), and that function has specific, partly interpolated copy for all four blockers
(`:208-225`). Authoring fresh client copy for those four would have duplicated a business
message the server already owns, and `SLOT_TITLE_TOO_LONG` would have lost its computed
"Shorten it by N". Owner decided option (a): ship `message` next to `code`. §1.2 and §3.4 now
reflect that; the former §3.4a is deleted.

### Amendment 1 — verified while applying

- **`tests/a11y-mobile-2026-09-04.mjs` is confirmed unregistered.** `grep -c` against
  `tests/run-all.sh` returns 0. The file exists and its 44×44 block is real
  (`SOL-PLAT-009 — 44x44 minimum touch targets at 375px`, `:269`), so adding selectors there is
  correct — but it will not gate. Recorded in §3.6 and Part 7 rather than left implied.
- **The `switchView` blank-tab trap** (`.flips-view { display:none }`, `index.html:954`;
  documented at `js/core.d9e1b484.js:8131-8134`) was missing from §3.1 and is now stated. It is
  the most likely way a correct implementation ships an empty screen.
- **Two knock-ons from Decision 1** that the amendment did not cover, now folded in: §3.6's
  44×44 rule no longer applies to rows, only to stub actions and paging, since a
  non-interactive row given a touch-target rule asserts an affordance the screen deliberately
  lacks; and Part 4 case 9's "opens" was reworded, since nothing opens.
- **§3.1a's highlight rule is load-bearing, not defensive.** Ids sort lexically and recency
  applies only within a page (§2.3), so a new draft is not reliably on page 1. Stated inline.
- Added case 15 to pin §3.1a: no row handler, no `switchView` to a detail view. Without it,
  "rows are not tappable" is an acceptance box with no test behind it.

**Unverified / not attempted:** none of the runtime claims were exercised, since running tests
was out of scope for this filing. The `f0324d4` regression reference in Part 4 case 1 was not
traced to that commit.

---

## Note for whoever implements this

The original §3.4 was wrong, and the way it was wrong is worth keeping in view. The answer
packet established that the server ships no human-readable text for stub rows; that was
generalised into "the server supplies no text" and a copy table was authored for the blocker
rows too. One verified fact, applied one step past where it held.

The tripwire in test 13 exists because that mistake is easy to make again, and it will look
reasonable at the time.

---

## Addendum — found while implementing (2026-09-06)

**The blocker codes on the wire are prefixed, and the `VIOLATION` key names are not.**
`VIOLATION.TITLE_TOO_LONG === 'SLOT_TITLE_TOO_LONG'` (`api/_draftStore.js:157`), and the same
holds for the other five: `SLOT_PRICE_REQUIRED`, `SLOT_ZERO_PRICE_NOT_ALLOWED`,
`SLOT_RULES_UNKNOWN`, `DRAFT_NO_PRICE_PROVENANCE`, `DRAFT_PRICE_SELLER_ENTERED`
(`:156-163`).

§1.2's table is correct — it lists the values. This addendum exists because the failure mode
is silent: a client that matches on the key name matches nothing, so a row carrying a real
blocker renders as though it had none. That is worse than a crash, because the screen looks
fine. Test `draft-readiness.mjs` now asserts every emitted code is a declared
`VIOLATION` **value** and is not a bare key name.

**§1.2's severity claim is confirmed.** `DRAFT_NO_PRICE_PROVENANCE` is WARNING and
`DRAFT_PRICE_SELLER_ENTERED` is INFO (`api/_draftStore.js:192-193`), so neither reaches
`blockers`. The reasoning is in the code comment at `:180-191`: a price the seller typed *has*
provenance — the seller — and blocking on it would refuse to list a draft priced by hand.
