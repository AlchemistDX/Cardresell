# D3 Step 2 — The Review Container

Status: **built and verified, NOT committed.** Stopped at one decision (§4).

Bundle: `js/core.8bd8277a.js` (edited in place; see §5 — the fingerprint is now stale).

## 1. What was built

The container, the state machine, and every failure state. Not the
field-by-field rendering (step 4), not the fee breakdown (step 5). No
placeholder previews of either.

| Piece | Where |
|---|---|
| `#reviewView` > `#reviewWrap` | `index.html`, immediately after `#draftsView` |
| `switchView('review')` branch | `js/core.8bd8277a.js` — hides on every other view, `display:'block'` |
| `_reviewState` | `signedIn`, `loading`, `draftId`, `draft`, `readiness`, `error` |
| `_reviewFetch` | `GET /api/drafts?id=<draftId>`, hand-rolled Bearer (§3.2) |
| `_reviewAbsorb` | 401 → wall · non-200 → mapped copy · 200 → `draft` + `readiness` |
| `_reviewPaint` | wall / error / spinner / no-id / loaded |
| `openDraftReview(draftId)` | entry point, guarded on a falsy id |
| `_reviewBindOnce` | one delegated listener on `#reviewWrap` (back, retry) |

Styles share the drafts tokens (`--surface-2`, `--border`, `--gold-text`,
`--radius-md`) and the existing `.empty-flips`, `.draft-spinner`,
`.draft-more-btn`, `.draft-paging` classes. `.review-back` was added to the
existing 44×44 mobile rule rather than getting its own (§3.6).

Both inheritances D3 was handed are honoured:

- **Reads `readiness` and only `readiness`.** `validation` arrives on the same
  response and is never touched. Absent `readiness` is *unknown* — no verdict is
  rendered — not reconstructed from `validation.blocking`. Mutation M2 proves
  the assertion catches the reconstruction.
- Rows are not yet tappable; that is step 3, with case 15 inverting in the same
  commit.

## 2. The finding that changed the code

`body.error` on the single-draft read is a **machine code**, not prose.
`errorBody` (`api/drafts.js:343-344`) sets `error` from the store constant —
`DRAFT_NOT_FOUND`, `DRAFT_DELETED`, `DRAFT_RECORD_UNREADABLE`
(`api/_draftStore.js:83-94`).

The list screen's absorb reads `text: b.error || <fallback>`
(`_draftsAbsorb`), and that is correct **there**: the list path's failure ships
real prose (`'Could not load your drafts'`, `api/drafts.js:132`).

Copying that one line into the review screen would have printed
`DRAFT_NOT_FOUND` to the seller. The screen therefore maps codes to copy and
never renders `body.error`. Mutation M1 confirms the assertion catches the
raw-code render.

**This is the pattern again, on the reuse side:** the list's absorb is a correct
implementation whose correctness depends on a property of its own endpoint. Read
as "how this app absorbs an error," it is wrong. Nothing in it says which.

## 3. Verified

30 assertions, real browser, `?id=` stubbed with envelopes shaped like the real
handler's output. **All 30 pass.** Four mutations, all caught:

| Mutation | Assertion that fired |
|---|---|
| M1 render `body.error` raw | no raw code on screen · human copy instead |
| M2 derive readiness from `validation` | no verdict claimed · `readiness` is null |
| M3 render the server's refresh advice | does NOT tell the seller to refresh |
| M4 collapse the tombstone into "vanished" | deleted copy, not vanished copy |

Covered: `?id=` not `?ids=` · exactly one request · title/set/number/slot/price
off the record · verdict from `readiness` · a `validation` sentinel never
reaching the DOM · absent readiness claims nothing · 404 · 410 · retryable 503
and its retry re-reading the same id · 409 schema-too-new · null-id guard · no
active tab on review · back returns and hides · signed-out wall with zero
requests.

**These 30 are not yet a registered suite.** They live in a scratch file. Step 6
owns registering them, together with the named gap from
`DECISION_D3_ENTRY.md` §3 — that no registered assertion covers the read
*response body* carrying `readiness`. Two of the 30 now cover it in substance;
neither is registered, so the gap stays open and stays owned.

## 4. THE DECISION — a standing tripwire fired, and it was right to

> **RESOLVED 2026-09-06** — `audit/DECISION_REVIEW_ERROR_VOCABULARY.md`. Option A, and
> `_REVIEW_ERR_ALIAS` dropped. Both landed in the same commit as this amendment.
>
> **My premise below was wrong where it mattered.** I argued the two vocabularies belong to
> two unrelated domains and that the shared word "unreadable" is a coincidence of English. It
> is not: the list *translates* store errors into row reasons, so on the overlapping subset
> both surfaces report the **same store condition** under two names — already documented as
> naming trap #1 in contract §2.5. The de-aliasing is right, but the reason is **consequence,
> not domain**: on the list one row degrades to a stub and the rest works; here the seller has
> nothing. Same cause, different situation, different copy. That reason also survives someone
> later adding a genuinely shared code, which the domain argument would not.
>
> So the code comment's sentence — "a vocabulary difference is not a licence for a second copy
> table" — was **reworded, not reversed**. It is true; it just isn't what is happening here.
>
> Two hazards were recorded rather than left implicit: contract **Amendment 4** now states
> that both spellings are live, names which surface uses which, and says they must not be
> unified in either direction; and the narrowed grep reads a **declared sentinel** in the
> bundle instead of inferring its end from adjacent code, so the next append cannot widen it
> silently. `§2` below was also filed in the catalogue as a **sibling pattern**, not a seventh
> instance — an implementation with an unstated invariant needs the invariant stated at the
> site, which is a different remedy from naming an assertion's reach.

### Original framing, kept for the record


`tests/draft-list-screen.mjs:300` went red:

```
the client does NOT key on the store constant DRAFT_RECORD_UNREADABLE
  reason: 'that constant never appears in a row; keying on it matches nothing'
  surface: !source.slice(source.indexOf('_DRAFT_STUB_COPY')).includes('DRAFT_RECORD_UNREADABLE')
```

It is a source grep over everything from `_DRAFT_STUB_COPY` to the end of the
bundle. The review screen is appended at the end, so it is inside the slice, and
it does key on `DRAFT_RECORD_UNREADABLE` — because that is exactly what
`GET ?id=` returns.

The assertion's stated reason is **true of the list and false of the read.** So
this is another catalogue instance: it names a behaviour and evidences a
surface, and the surface was an adequate proxy for precisely as long as the
bundle had one drafts surface.

Per the standing rule it was not flipped to go green. The adjacent line
(`:298`, "the client keys on the row value `DRAFT_UNREADABLE`") still passes and
is still meaningful.

But the tripwire is also raising a real design question, and narrowing it
without answering that question would be papering over it: **the client now
knows two error vocabularies for overlapping conditions.**

### Option A — narrow the surface to the list screen's region

Scope the grep from `_DRAFT_STUB_COPY` to the start of the review screen. Keeps
the behaviour claim, repairs the proxy.

### Option B — normalize server-side, so there is one vocabulary

Make the read path map store errors into the list's reason vocabulary. The
client would then know one set of codes and the tripwire would stay literally
true bundle-wide.

**Option B cannot be completed, and that is the argument against it.** The
read/edit path has conditions the list vocabulary has no words for and should
not acquire — `DRAFT_REVISION_CONFLICT`, `DRAFT_REVISION_REQUIRED`,
`DRAFT_NOT_EDITABLE`. Normalizing either flattens those distinctions or extends
the list vocabulary with codes the list can never emit.

### Option C — move the review screen above `_DRAFT_STUB_COPY`

**Rejected outright.** It makes the grep pass by relocating code out of the
slice. That is flipping the tripwire wearing a refactor's clothes, which is
worse than flipping it honestly, because the diff looks like tidying.

### Recommendation: A, and drop the aliasing

Working through B produced a reframe that I think is the actual answer. These
are **not two vocabularies for one domain. They are two vocabularies for two
different domains.**

- The list's stub reasons answer *"why can this one row not be summarized?"* —
  a per-row, partial-failure vocabulary. The list ships rows and a 200.
- The read path's store errors answer *"why did this whole request fail?"* — a
  request-level vocabulary. There is no row and no 200.

The list literally cannot emit `DRAFT_REVISION_CONFLICT`; the read literally
cannot emit a per-row stub reason. The overlap in the *word* "unreadable" is a
coincidence of English, not shared identity.

If that reframe holds, then `_REVIEW_ERR_ALIAS` as written is **wrong** — an
alias asserts shared identity, and there isn't any. The review screen should own
its copy table outright, and the two identical strings are not a rule-1
violation: rule 1 governs one business behaviour, and answering two different
questions is two behaviours that may legitimately diverge later.

That is a reversal of the reasoning in my own code comment, which currently says
"a vocabulary difference is not a licence for a second copy table." I still
think that sentence is right about *vocabulary differences*. It is wrong about
*this* difference, because this one is a domain difference wearing a vocabulary
difference's clothes.

**Not taken unilaterally.** Both the narrowing and the de-aliasing change a
passing standing assertion and a shipped design comment.

## 5. Two mechanical consequences, not yet done

1. **The bundle fingerprint is stale.** `js/core.8bd8277a.js` now hashes to
   `8e24cab9`; `tests/asset-fingerprints.mjs` fails on exactly that. Per the
   standing rule the live file gets renamed to `js/core.8e24cab9.js` (new
   bytes), `8bd8277a` is restored to its committed bytes and retired, and
   `index.html`'s `<script src>` is repointed — never `git mv`. Deliberately
   deferred: doing it now, then changing the error table in §4, would retire two
   bundles for one step.
2. **The degraded banner's 🛠️** is still unlicensed. Unchanged here; it belongs
   with the narrowing work.

## 6. State

**Committed.** The only remaining red is the stale bundle fingerprint (§5.1), which is
mechanical and deliberately deferred until the error table settled — it now has.

| Suite | Result |
|---|---|
| `tests/draft-list-screen.mjs` | **81 / 0** (was 80; the region-bounds guard is new) |
| review container verification (scratch, unregistered) | **30 / 0** |
| `tests/asset-fingerprints.mjs` | 14 / 1 — the deferred rename, §5.1 |

Six mutations caught in total: four on the review screen's own copy and readiness handling,
plus **M5** removing the sentinel (the bounds guard fires, so a deleted marker cannot silently
restore the old near-full-width region) and **M6** planting the store constant inside the
narrowed region (the assertion still fires, so scoping did not make it vacuous).
