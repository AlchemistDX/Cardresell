# Plan — Fix "scan opens search-results grid on lookup failure"

**Author:** CardResell (draft for Will's review)
**Written:** 2026-08-12 late night
**Ship after:** Will approves this doc, no code changes yet
**Blast radius:** `_loadScannedCardExact` in `index.html` and any UI that calls it (single-card scan tap-through, bulk-scan tap-through)

## The problem in one sentence

When the ID scanner identifies a card but PokemonTCG.io returns zero exact
matches for the queries we try, the fallback dumps the user into
`openCatalog(name)` — a full grid of every card with that name — which
almost never contains the exact card they scanned and forces them to hunt.
That's the "scan-to-search-bar" bug Will has flagged multiple times.

## Where the bug lives (verbatim, so you can eyeball it)

`index.html` lines 7058–7144 — `_loadScannedCardExact(pending)`.

Current logic:

1. Try 3 progressively-broader PokemonTCG.io queries:
   - `name:"<full name>"`
   - `name:<first word>* number:<number>`
   - `name:<first word>*`
2. Score results by exact number → number-before-slash → rarity → first.
3. If **any** query returned at least one card AND scoring picks something, load it — even if the picked card is dead wrong (wrong set, wrong art, no price data).
4. If **all** queries returned zero cards or the try/catch throws, fall
   through to lines 7141–7143 — set the search box to the scanned name and
   call `openCatalog(name)`, which is the results-grid modal.

## Two failure modes users actually see

**Failure mode A — "wrong card loads silently"** (worse UX)
Scanner sees `Charizard #4` from Chaos Rising. PokemonTCG.io hasn't
catalogued Chaos Rising yet, so query 1+2 return zero, query 3
(`name:Charizard*`) returns 250 Charizards. Scoring falls through
(no number match, no rarity match) and picks `cards[0]` — usually Base
Set Charizard. User sees a totally different card load with the wrong
price. They don't know it's a mismatch until they squint at the image.

**Failure mode B — "dumped into search grid"** (the Will-annoying one)
Scanner sees an obscure card, all 3 queries return zero. Fallback fires
→ `openCatalog(name)` opens a grid of every card that matches the name
loosely. Even worse when the scanner OCR got the name slightly wrong
("Lillie's Clefiary" instead of "Lillie's Clefairy") — grid is empty
or full of nothing relevant.

## The fix, in three parts

### Part 1 — Never load a wrong-card silently

Right now: if any query returns any card, we load *something*. That's the
silent-wrong-card mode.

New rule: **we only auto-load if the pick meets a confidence threshold.**
Threshold = at least one of:
- Exact number match (`c.number === cleanNumber`), OR
- Exact number-before-slash match, OR
- Rarity match AND set name contains the scanned setName (loose includes)

If none of those hold, treat as "no confident match" and go to Part 2.

### Part 2 — Failure UI is a card-shaped result panel, not the results grid

When we have no confident match, instead of `openCatalog(name)`:

Render a **"Card scanned but not found in database"** state INSIDE the
lookup card panel (`#cardMain` / `#cardPanel`). It shows:

- **Scanned card info as captured** — name, number, setName, rarity — read
  from the `pending` object (the OCR result).
- **A thumbnail** — if the scanner attached a preview image (it usually
  does — `pending.imageUrl` or similar; if not, a card-back placeholder).
- **Three action buttons stacked:**
  1. **"Search on eBay"** — opens `buildEbayUrl(<name> <number> <setName>)`
     in a new tab. Affiliate-tagged. This is the workflow Will already
     uses when TCGplayer doesn't have data.
  2. **"Search on TCGplayer"** — opens the Impact affiliate URL with the
     search query pre-filled. Affiliate-tagged.
  3. **"Adjust name and search again"** — sets the search box focus with
     the scanned name selected so a keystroke replaces it, and does NOT
     open the grid.
- **Small "Scan another card" text link** at the bottom.

The full-catalog `openCatalog(name)` call is REMOVED from this path
entirely. The results grid was never the right fallback because grids are
for "browse a set", not "the exact card I just scanned is missing".

### Part 3 — Instrument it so we can measure

Add a lightweight log call whenever we hit the not-found path:

```js
// pseudocode — final impl in a helper so bulk-scan hits it too
_logScanMiss({
  name: pending.name,
  number: pending.number,
  setName: pending.setName,
  rarity: pending.rarity,
  triedQueries: queries,      // the 3 strings we tried
  candidateCount: cards.length // how many candidates the 3rd query returned
});
```

Fires POST to a new `/api/scan-miss.js` endpoint that just KV-stores the
payload with a 30-day TTL and a rolling counter. Non-blocking, wrapped in
a try. Lets Will see WHICH cards are missing from PokemonTCG.io and how
often — great signal for deciding when to build the eBay Browse API path
(when it comes back from support).

## What stays the same

- The 3-query strategy in `_loadScannedCardExact` — that logic is fine.
- The rendering path for confident matches (lines 7097–7133) — unchanged.
- The auto-Google-image-search integration for grade scan — unchanged.
- The `_bulkPaused` / "Back to Bulk Scan" pill flow — unchanged. If Part 2
  fires while a bulk scan is paused, the pill still shows so the user can
  return to their session.

## Edge cases we've thought about

| Edge case | Handling |
|---|---|
| Scanner OCR mangles the name ("Charrizard") | Part 2 fires. User taps "Adjust name and search again", edits to "Charizard", searches normally. |
| Card exists in PokemonTCG.io but scanner missed a punctuation ("Lillies" vs "Lillie's") | Query 3 (`name:Lillies*`) still returns matches, but they're all Lillie-related. Part 1 threshold rejects them (no number match), Part 2 fires with a "Did you mean Lillie's ...?" hint IF we can compute Levenshtein cheaply against candidates. Nice-to-have, not required for v1. |
| Card really is uncatalogued (Chaos Rising Charizard today) | Part 2 fires. eBay button fetches sold comps. This becomes the primary flow for new sets until PokemonTCG.io catches up or eBay Browse API works. |
| Bulk scan tap-through (line 9868) | Same Part 2 UI, PLUS the "Back to Bulk Scan" pill is already showing. User can tap eBay button OR the pill to return to their session. |
| Non-Pokemon games (MTG, Yugioh, etc) | `_loadScannedCardExact` is Pokemon-specific. Other games use different code paths and are not affected by this change. |

## Rollout

1. **Feature-flag it.** Wrap the new Part 2 UI behind `window._SCAN_MISS_V2 = true` in a `<script>` at the top of the page, defaulting to `true`. If it misbehaves in prod, one line change reverts it — the old `openCatalog(name)` code stays in place as the else branch for the first week.

2. **Add a regression test** in `tests/auth-integrity.js` (or a new
   `tests/scan-miss.js`) that asserts `openCatalog(name)` is NOT called
   from `_loadScannedCardExact`'s catch-fallthrough when the flag is on.
   Easy: string-match the file for the specific fallthrough block.

3. **Manual smoke test on prod after deploy:**
   - Scan a card that exists in PokemonTCG.io → confident match loads as before ✅
   - Scan Chaos Rising Charizard (known missing) → Part 2 UI shows,
     eBay button opens correct affiliate URL, no results grid appears ✅
   - Bulk scan the same card → "Back to Bulk Scan" pill shows alongside
     Part 2 UI ✅

4. **After 7 days**, if `/api/scan-miss` logs show Part 2 firing at the
   expected rate (<20% of scans in prod), remove the feature flag and
   delete the old `openCatalog(name)` fallback dead code.

## Files touched (final estimate)

- `index.html` — ~60 lines added, ~5 lines removed
- `api/scan-miss.js` — new, ~40 lines
- `tests/scan-miss.js` — new, ~30 lines
- Total diff: ~130 lines. Small, contained.

## Time to implement

- Part 1 (threshold rejection): 5 min
- Part 2 (not-found card panel + 3 action buttons): 25 min
- Part 3 (KV logging endpoint + client hook): 15 min
- Tests + smoke test: 15 min
- **Total: ~60 min, single focused session**

## What Will needs to decide before I build this

1. **Do we hard-remove the results-grid fallback or keep it behind the
   feature flag for a week?** My rec: keep behind flag for 7 days, then
   delete.
2. **Should the "eBay Search" button also apply the current game/category
   filter, or just search the raw name+number+set?** My rec: raw
   name+number+set. Less over-engineered, works for any TCG.
3. **Instrument scan misses (Part 3)?** Adds a new endpoint + KV writes
   per miss. My rec: yes — it's the only way to prove the fix is
   working AND it feeds product decisions ("which sets do we most need
   eBay Browse API for?").
4. **Anything I'm missing about how you actually use scans?** e.g. do
   you ever *want* to see the results grid on a miss (some flow I'm not
   picturing)?

---

*After approval, next commit message will be:*
`fix(scan): replace results-grid fallback with card-shaped not-found panel + eBay/TCGplayer affiliate search buttons`
