# D7 — the listing-photo UI

Live bundle **`js/core.3f83abec.js`** (23,261 lines), referenced at
`index.html:3832`. Retired `ea2f03c4` retained on disk with its own bytes.
Suite: `tests/listing-photos.mjs`, **92 checks, 92 passing**, run three times.

Nothing is pushed and nothing is deployed.

---

## 1. The claim conflation, corrected

The store packet said the abort case proves that treating request-success as
storage "would resolve and two orphans would remain." That merges two
independent properties and the correction stands:

| Property | What establishes it | What breaks if it fails |
|---|---|---|
| No premature success | the **rejection** assertion | the UI reports a save that never landed |
| Rollback is real | **no-ghost-blob** + **unchanged-manifest** | orphan bytes and a torn pair survive |

Resolving early would falsely report a save. It would **not** by itself leave
orphans — the abort rolls the transaction back regardless of what the promise
did. Neither assertion substitutes for the other, and claiming one implied the
other overstated a single check into a proof of both. `D7_STORE_RETURN_PACKET.md`
now carries this as a marked correction rather than a rewrite.

---

## 2. The six requirements

| Requirement | Where | Assertion |
|---|---|---|
| Add, reorder, remove through seller controls; order verified after reload | `_photoAddFiles`, `_photoMove`, `_photoRemove`; store `photosMove` | §8 §9 §10 — the chosen order **persists** across a full page reload (persistence only; see the narrowing below) |
| Missing-photo placeholder distinct from an empty collection | `_photoItemHtml` (`[data-photo-missing]`, dashed border) vs `[data-photo-empty]` | §11 — three tiles still render, the lost one carries its own sentence, **the empty line is not shown** |
| Browser-local limitation always visible | `_photoInnerHtml`, emitted **outside** the grid/empty branch | §8 — asserted with zero photos and with photos; §10 — still present after the last removal |
| Decode validation, HEIC guidance reused | `_photoValidateFile` calls `_validateScanFile`, then actually attempts `createImageBitmap` | §12 — an undecodable file is refused; the HEIC line is the scan path's own wording |
| Partial batch stated explicitly | `_photoBatchStatus` | §13 — "Added 12 photos." + "2 photos were not added: CardResell keeps up to 12 … That is our limit, not an eBay requirement." |
| Transaction failure preserves the displayed collection, no saved confirmation | the `failure` branch returns **before** any re-list | §14 — collection intact, failure shown, no success line, no guessed cause |

**Reorder is an operation, not an array.** `photosMove(draftId, photoId, 'up'|'down')`
reads the manifest inside the write transaction and computes the new order
there.

**Narrowed on review, 2026-09-08.** I wrote that the reload check is what
catches a screen posting its own stale array. It is not, and the distinction
matters because I was leaning on the wrong assertion:

| Claim | What actually establishes it |
|---|---|
| The chosen order persists | the **reload** check (§9) |
| A stale UI array cannot overwrite a concurrent change | the **read-inside-transaction** implementation of `photosMove`, and the **two-tab** check for concurrent adds |

A stale write-back persists just as well as a transaction-local reorder — both
survive a reload, so reload cannot tell them apart. Reload establishes
persistence and nothing more. What rules out the stale array is that
`photosMove` never accepts one: it takes an id and a direction and reads the
manifest inside the write transaction. That is a property of the
implementation, supported by the earlier concurrency work, not something this
slice's reload assertion demonstrates.

**The cap wording.** 12 is described as CardResell's, scoped to this browser,
and explicitly denied as an eBay requirement. A disclosure keyed to our own
behaviour is one we can maintain; a claim about eBay's limits is not.

**Glare stays advisory.** Not implemented as a gate, and recorded in the code
as a decision: the scan path rejects glare to protect recognition, and a
listing photo has no recognition job.

---

## 3. Two production defects the tests found

Both were in the UI, not the store, and both were found by driving the picker:

1. **`busy` was not released on a throw.** The flag was set before validation
   and cleared after; anything that threw in between left the Add button
   permanently disabled with no error on screen. Now `try/finally`.
2. **`input.value = ''` before reading `input.files`.** `files` is a live list;
   clearing `value` first empties it, so the add would silently receive
   nothing — a Rule 2 silent omission. The list is copied first.

## 4. Three check defects, recorded

The suite blamed the product three times before it was right, and the record
matters more than the fix:

- **v1 waited for `busy === false`** — the state *before* an add starts. Every
  assertion sampled a blank screen.
- **v2 waited for the `busy` true→false edge.** Works for a batch that reaches
  IndexedDB; **cannot** work for one rejected during validation, where the flag
  rises and falls inside a single task. The HEIC case timed out on a wait it
  could never satisfy.
- **`every` on an empty array is true**, so "each tile shows a real thumbnail"
  passed while nothing was rendered. Count is part of the condition now.
- **A substring ban cannot tell a claim from its denial.** "no saved
  confirmation" was `!/added/i`, and the frozen failure copy reads "…were **not
  added**". It now bans the positive shapes only. Each carries a comment saying
  what it used to assert and why it changed.

---

## 5. Registration — and a second suite that had drifted out

`tests/listing-photos.mjs` is a **declared exclusion** in
`tests/test-registry.mjs`, not an offline slot, on the
`flip-completeness-e2e.mjs` precedent: Playwright plus a local HTTP server,
neither of which the offline runner provides. Registering it as an offline slot
would make the offline gate depend on an environment it does not stand up. Its
results are tracked as **RV-7** in `RELEASE_VALIDATION_QUEUE.md`.

Doing that turned the registry red on an unrelated file:
**`tests/decision-restatements.mjs`**, added at `d0e9665`, on disk, never
invoked and never declared. `git log -S` over the runner shows it was never
referenced there, so it never landed rather than regressed. It is now **slot
48** — it needs nothing the runner lacks. 33/33 by hand.

The detection was still incidental, and the assertion-count floor from the
earlier interruption entry is **still not built**.

---

## 6. The `draft-review-screen` flake — identified, still unexplained

Reproduced. **336 passed, 2 failed**, then 338/0 on three consecutive reruns.
The two failing assertions are always the same pair, adjacent, in the basis-
binding section:

```
  ok   setup: the legitimate create went out
  FAIL 🔴 a basis read FOR this card is still sent
  FAIL with its tiers and its own retrieval time intact
  ok   setup: the unbound-basis create went out
```

Both print **no detail value**, and their detail argument is
`JSON.stringify(meta)` — so `meta` was `undefined`: the captured POST body had
no `pricingContext.basisMeta` at all, rather than a wrong one. `waitPost()`
returned true, so a body *was* captured.

**Unverified hypothesis, recorded as such:** `posted` is reset to `null` and
then the next click is awaited, so a POST from the *previous* step arriving
after the reset would satisfy `waitPost()` with the earlier body — which in
that step legitimately carries no basis. That would explain `undefined` rather
than a mismatched URL. It is **not established**: nothing in the run
distinguishes it from a slow bind, and three passing reruns support
intermittency without explaining it.

**Open.** Not closed, not worked around, and no assertion was weakened to make
it green. It gates nothing in this slice — the pair concerns basis binding on
the sell path, not photos.

---

## 7. Not established

- **Headless Chromium only.** Nothing here speaks for Safari or iOS, which is
  where the storage behaviour behind the browser-scoped copy is most likely to
  differ.
- **No storage ceiling is claimed.** No quota-exhaustion experiment was run, by
  decision.
- **Nothing about eBay's photo handling.** These photos are never uploaded;
  what eBay would accept is untested and unclaimed.
- The photos are not attached to the listing packet or to any request. They
  are a browser-local collection and nothing downstream reads them yet.

Sources for the storage behaviour behind §2 remain the two verified in the
gate: the [Storage Standard](https://storage.spec.whatwg.org/) on bucket
clearing being all-or-nothing, and [MDN on IDBTransaction](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction)
on request success not meaning stored.


---

## 8. Release limits, restated explicitly

These are not caveats buried in prose; they are the shape of what D7 does and
does not establish.

- **Safari and iOS are unverified.** All evidence is headless Chromium. The
  storage behaviour behind the browser-local copy is exactly where these engines
  are most likely to differ.
- **Local photos do not transfer to eBay.** D7 establishes **local preparation
  only**. Nothing uploads them, nothing attaches them to a packet, and no part
  of the handoff carries them.
- **Release validation is outstanding.** RV-7 records the browser-suite
  obligation; the suite is a declared exclusion, not a gate that runs offline.
- **D5's signed-in checks, D6's remaining verification, and SI-1 remain open**
  as last reported.
- **No Phase 1 percentage replaces the withdrawn estimates.** Both are
  withdrawn, not revised, and nothing here computes a new one.
- **Nothing is pushed or deployed.** Credential rotation still gates pushing.
