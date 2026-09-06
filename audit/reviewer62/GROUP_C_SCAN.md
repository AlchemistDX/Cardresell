# Group C — Scanning, bulk mode, lookup catalog (items 18-26, 28, 30)

Reviewer wording is quoted verbatim from `REVIEWER_LIST_VERBATIM.md:32-47`.
All citations are to the live bundles named in `index.html:3514-3518`
(`js/core.d9e1b484.js`, `js/ui.6b3a528e.js`, `js/config.20ebe911.js`,
`js/pwa.68032543.js`, `js/auth.5cf1cd22.js`) plus `index.html` and `api/`.
The stale `js/core.569ff536.js` is never cited. No tests were executed and no
endpoint was called; test files were read as documentation of intent.

---

### Item 18 — "Proven bulk throughput: 20-50 cards, progress, pause, retry"
**Verdict:** PARTIAL

**Evidence:**
- Bulk ID Scan is a real queue with 3 parallel workers: `js/ui.6b3a528e.js:2987-3092`
  (`startBulkQueue`), which pre-renders one placeholder row per photo and then
  drains the queue with `CONCURRENCY = 3`.
- Progress is genuinely shipped: `bulkProgressLabel` ("Scanning X of N…"),
  `bulkProgressBar` width %, and `bulkProgressCredits` ("N credits remaining")
  are updated per completion inside `startBulkQueue`
  (`js/ui.6b3a528e.js:2987-3092`); completion sets the bar to 100% and the
  label to "Done!" with a summary line (`js/ui.6b3a528e.js:3221-3244`).
- Retry is shipped per row: `↻ Retry (free)` button rendered on every failed row
  (`js/ui.6b3a528e.js:3388`) calling `bulkRetryRow` (`js/ui.6b3a528e.js:3464`),
  and the free-ness is real server-side, not just UI copy — the client sends
  `retry_of` (`js/ui.6b3a528e.js:3113-3117`, `3134`) and `api/scan.js:803-830`
  validates ownership, 1h TTL and one-retry-per-scan before waiving the debit.
- **No count cap and no pause.** `processBulkUploadFiles`
  (`js/ui.6b3a528e.js:2331-2362`) accepts `Array.from(input.files)` with no
  length limit — it only drops undecodable files and then quotes
  `count + ' credit' … ' You have ' + credits + ' available'`. So 20-50 photos
  are accepted in principle, but nothing in the code proves throughput at that
  size and there is no batch ceiling either.
- There is **no pause control**. The bulk footer offers Cancel/Close only
  (`index.html:3638`, `index.html:3752`). `window._bulkPaused` is unrelated —
  it drives the "Back to Bulk Scan" pill used when a user taps a row through to
  the lookup view (`js/ui.6b3a528e.js:3822-3824`, `3947-3982`).
- Mid-batch credit exhaustion is handled honestly: a 402 marks all remaining
  rows "Skipped — out of credits" and toasts "Ran out of credits mid-scan.
  Results saved for cards that completed." (`js/ui.6b3a528e.js:3138-3173`).
- "Proven" is the part I cannot verify: `tests/bulk-scan-misfire.mjs:1-8` records
  live measurements (pokemontcg.io returned HTTP 500 on 5 of 8 identical
  queries, 62%) but those are per-card price-lookup measurements, not a 20-50
  card end-to-end throughput run.

**If real, what it takes:** Add a Pause/Resume button to the bulk progress
header that stops new workers from picking up queue items (the worker loop in
`js/ui.6b3a528e.js:2987-3092` already polls an index, so a `window._bulkHalt`
check at the top of the loop plus a resume that re-spawns workers is the whole
change), and decide an explicit batch ceiling in
`processBulkUploadFiles` (`js/ui.6b3a528e.js:2331`) so the credit-confirm screen
cannot quote 300 photos.
**Rule conflict:** none. (Do not add a second queue implementation — rule 1 —
pause belongs inside `startBulkQueue`.)

---

### Item 19 — "Instant refund and a visible 'this one failed, credit returned' row per card"
**Verdict:** PARTIAL — server-side refund is real and automatic; the per-card
*visible* statement exists in single-scan and is **missing in bulk**.

**Evidence — is a credit taken at all?** Yes. The debit happens *before* the
provider call: `api/scan.js:785-955` resolves a bucket and consumes it
(`id_free` via INCR of `scans:{key}:id_free_used_{stamp}`, `id_paid_left` via
atomic DECR, `paid_left`/`free` for grade mode). Entitlement/validation runs
before the debit, so a *rejected* request costs nothing
(`api/scan.js:836-841`). So the answer to the parent's question is **(b): the
credit is taken and then auto-refunded**, not (a) and not (c).

**Evidence — is it returned automatically?** Yes, on every failure path:
- `refundCredits()` at `api/scan.js:956-975` restores the exact bucket that was
  consumed (`id_free` decrements the used counter, `id_paid_left`/`paid_left`
  increment the remaining counter).
- Provider missing/misconfigured → `api/scan.js:984-992` refunds then 503
  `IDENTIFY_PROVIDER_UNAVAILABLE`.
- Ximilar miss (`no_match`, `no_card_detected`, `low_confidence`, `no_records`)
  → `api/scan.js:1032-1068`: `await refundCredits()` then HTTP 200 with
  `identified:false` and a `retake_hint`. The comment at
  `api/scan.js:1029-1031` states the contract: "Both paths refund the consumed
  credit and neither can reach GPT."
- Multi-candidate picker → `api/scan.js:1182-1208` refunds *before* returning
  `needsPicker`; `api/scan-debit-id.js` re-debits only after the user picks.
- Later grade-path failures also refund (`api/scan.js:1595`, `1659`, `2463`,
  `2547`), and two of those user-facing error strings literally say "Credits
  refunded."

**Evidence — is it visible to the user?**
- **Single scan: yes.** The unidentified state renders literally
  `Your ID credit was refunded automatically.` at
  `js/core.d9e1b484.js:13657`, inside the failed-scan block at
  `js/core.d9e1b484.js:13630-13680`, alongside Try again / Search by name.
- A manual escape hatch also exists: the "Not my card — refund credit" button
  (`js/core.d9e1b484.js:13976`) → `_requestScanRefund`
  (`js/core.d9e1b484.js:11656-11709`), which flips the button to
  `✓ Credit refunded` (`:11695`) and toasts "Credit refunded. Try a clearer
  photo or a different angle." (`:11702`). `api/scan-refund.js` backs it:
  verified token only (`:33-46`), idempotent (`:81-89`), rate-limited 3/24h
  (`:91-102`), same-bucket refund (`:104-126`), 30-day audit record
  (`:128-150`).
- **Bulk: no.** The failed bulk row renders only the error string plus a
  hint plus `↻ Retry (free)` (`js/ui.6b3a528e.js:3384-3399`,
  hints at `js/ui.6b3a528e.js:3335-3348`). Nowhere in the row is the credit
  mentioned. The batch summary says only
  `N cards identified · M failed · Tap below to save to your Collection`
  (`js/ui.6b3a528e.js:3229-3234`). So in a 30-card batch with 6 failures the
  user sees six failures, a credit counter that already ticked down and back up,
  and no statement that they were not charged. This is exactly the reviewer's
  complaint and they are right about it for bulk.
- Related silent behavior found while tracing this: bulk accepts a `needsPicker`
  (medium-confidence, 2-3 candidate) response as a confident hit, because it
  branches on `if (data.card_name)` (`js/ui.6b3a528e.js:3188-3204`). The server
  refunded that scan and expected a picker (`api/scan.js:1182-1208`); bulk shows
  the top candidate as a normal ✓ row with no picker, no "we weren't sure" flag,
  and never calls `api/scan-debit-id.js`. The user is under-charged (harmless to
  them) but also under-informed (a possibly-wrong ID presented as certain).

**If real, what it takes:** In `_bulkUpdateRow`'s failure branch
(`js/ui.6b3a528e.js:3384-3399`) add one line — "Credit returned" — driven by the
same signal the server already sends, and add a "· M failed (credits returned)"
clause to the summary at `js/ui.6b3a528e.js:3229-3234`. Separately, handle
`data.needsPicker` in `js/ui.6b3a528e.js:3188` so bulk either flags the row as
unconfirmed or offers the picker.
**Rule conflict:** rule 3 (do not stamp a lie) is the constraint on the wording,
not a blocker: only say "credit returned" where the server refunded. The 402
"Out of ID scan credits" rows (`js/ui.6b3a528e.js:3138-3141`) were never
debited, so they must *not* say "returned".

---

### Item 20 — "CSV / clipboard export of ID + set + number + market + best venue + net"
**Verdict:** PARTIAL — four CSV exports exist; none is from Bulk ID Scan and
none contains best venue or net payout.

**Evidence:**
- Bulk **Grade** has a CSV export: `exportBulkGradeCSV`
  (`js/ui.6b3a528e.js:1777-1804`), button at `index.html:4056`. Columns are
  Card, Set, Number, Final Grade, Corners, Edges, Surface, Centering, Raw Price,
  Est Graded Price, Grading ROI.
- Collection: `exportCollection` (`js/core.d9e1b484.js:8891-8907`) —
  `['Card','Set','Cost Basis','Current Value','Unrealized P/L','P/L %']`.
- Flips: `exportFlips` (`js/core.d9e1b484.js:8774-8792`) —
  `['Date','Card','Set','Buy Price','Sell Price','Fees','Shipping','Grading','Net Profit','Platform']`.
  This is the only export with a net and a platform, and it is for *completed*
  flips the user typed in, not for a scan batch.
- Grading log: `exportGradingLog` (`js/core.d9e1b484.js:8794-8825`), Pro-gated.
- **Bulk ID Scan has no export at all.** Its bottom bar is Close / Add All to
  Collection / + Scan More (`index.html:3750-3760`).
- No clipboard export anywhere: the only `navigator.clipboard` uses are share
  links and the referral link (`js/core.d9e1b484.js:10818-10819`, `10846`,
  `15186`).

**If real, what it takes:** Add one export button to the Bulk ID bottom bar
(`index.html:3750-3760`) writing name/set/number/market/variant from
`window._bulkResults`. Best venue + net would additionally require running the
existing venue ranker per row rather than a second copy of it.
**Rule conflict:** rule 1 — the venue ranking and fee math already exist for the
single-card panel; a bulk exporter must call that same code, not reimplement
per-row fee math. Rule 2 also applies: a net column must be labeled derived.

---

### Item 21 — "Duplicate / same-card collapse in a bulk session"
**Verdict:** SHIPPED

**Evidence:** After a batch finishes, `_bulkFinishQueue` calls
`_bulkDetectDuplicates()` (`js/ui.6b3a528e.js:3243`). Keying is
name|set|number lowercased (`_bulkDupKey`, `js/ui.6b3a528e.js:3247-3251`);
detection renders a gold banner reading
`You scanned <name> N times` with a `Tap to merge` button
(`js/ui.6b3a528e.js:3256-3277`); `bulkMergeDuplicates`
(`js/ui.6b3a528e.js:3279-3330`) collapses them into one row carrying a `×N`
quantity badge (`js/ui.6b3a528e.js:3345-3347`) and re-renders the list and
summary. A user reaches it with zero extra steps — it fires automatically at the
end of every bulk batch.

**If real, what it takes:** n/a.
**Rule conflict:** none.

---

### Item 22 — "Fallback when Ximilar misses (set code + collector number typed path)"
**Verdict:** GAP for the specific mechanism the reviewer asked for (no typed
set-code + collector-number entry exists anywhere); PARTIAL as a fallback
story, because a different, name-based fallback is shipped and reasonably
discoverable.

**Evidence — what exists:**
- Ximilar is the sole ID authority and a miss terminates identification
  (`api/scan.js:1029-1068`).
- Failed single scan shows Try again / "Search by name" plus the automatic
  refund line (`js/core.d9e1b484.js:13630-13680`).
- When a card is identified but has no live price, the scan-miss panel renders:
  `_renderScanMissPanel` (`js/core.d9e1b484.js:12801-12880`) with header "Live
  pricing unavailable", the scanned name/number/set/rarity, and buttons Add to
  My Collection / Search sold on eBay / List on eBay / Search on TCGplayer /
  "Wrong card? Adjust name" / Dismiss. It also auto-fires `doSearch(name)` to
  populate the catalog dropdown (`js/core.d9e1b484.js:12787-12795`).
- "Wrong card? Adjust name" (`_scanMissAdjustName`,
  `js/core.d9e1b484.js:12991`) only focuses and selects `#searchInput`.
- In bulk, every row's name is tappable to correct (`bulkEditCardName`,
  `js/ui.6b3a528e.js:3374`, handler at `js/ui.6b3a528e.js:3449`) and the price is editable (`bulkEditPrice`,
  `js/ui.6b3a528e.js:3362-3363`, handler at `js/ui.6b3a528e.js:3479`).

**Evidence — what does not exist:** search is name-only. `doSearch`
(`js/core.d9e1b484.js:891-931`) does no query parsing at all — it hands the raw
string to a per-game function, and `searchPokemon` sends it as
`name:{q}*` to pokemontcg.io (`js/core.d9e1b484.js:975`). There is no set-code
field and no collector-number field on the lookup form (the only such inputs in
the app are the sports form's `sp_year`/`sp_brand`/`sp_cardnum`,
`index.html:1891-1911`). Typing "SV5K 097" or "swsh4 25" into the lookup box
produces a `name:` query and, on no rows, the empty state "No Pokémon cards
found. Try a different name." (`js/core.d9e1b484.js:1019`).

**If real, what it takes:** Either (a) parse set-code and number out of the
existing search box before dispatch in `doSearch`
(`js/core.d9e1b484.js:891`) and route to a `set.id`/`number` query in
`searchPokemon` (`js/core.d9e1b484.js:975`), or (b) add two small inputs to the
scan-miss panel (`js/core.d9e1b484.js:12801`) that call the same query. (a) is
cheaper and keeps one entry point.
**Rule conflict:** rule 1 — do this inside `doSearch`/`searchPokemon`, not as a
parallel lookup implementation.

---

### Item 23 — "JP vs EN language / stamp detection called out, not silent wrong ID"
**Verdict:** PARTIAL — language detection is real end-to-end and is called out
in single-scan; it is **not** called out in bulk rows; **stamp / 1st Edition /
shadowless detection does not exist at all.**

**Evidence — language:**
- Detection is at the provider layer, not guessed: `api/_ximilar.js:100-115`
  reads Ximilar's `Alphabet` tag and sub-category and sets
  `isJapanese = alphabet === 'japanese' || subCat === 'Pokemon Japanese'`, plus
  `jp_name` from `m.japanese_name`.
- `is_japanese` and `jp_name` are carried on every identify response
  (`api/scan.js:1201`, `1233`, `2368`, `2452`, `2532`) and on each picker
  candidate (`api/scan.js:1188`). The GPT prompt used in grade mode asks for the
  same fields with explicit JP signals (`api/scan.js:1499-1511`).
- Single-scan callout: JP cards are routed to the pokemonjp comps card and
  displayed as `englishBase + ' (Japanese)'`
  (`js/core.d9e1b484.js:11996`, also `:13921-13924`, and `:1185` in the JP
  search path), and the game selector switches with a toast or a confirm
  (`maybeAutoSwitchGameFromScan`, `js/core.d9e1b484.js:1998-2050`) — note the
  deliberate design there: it only switches silently when the previous game was
  the generic Sports/Other, otherwise it *asks* (`:2005-2013`, `:2035-2043`).
- Bulk: `result.isJapanese` is stored (`js/ui.6b3a528e.js:3196`) and correctly
  routes pricing through the JP catalog first (`_bulkFetchPricePokemonJP`,
  `js/ui.6b3a528e.js:2647-2650`, dispatched at `:2681-2684` and `:2758-2768`),
  but the rendered bulk row shows only name, set/number, price, condition
  (`js/ui.6b3a528e.js:3364-3382`) — **no JP badge**. A JP card in a bulk batch
  is displayed under its English name with no language marker.

**Evidence — stamp / printing provenance:** searching the live bundles and the
scan API for `stamp`, `shadowless`, `1st edition`, `first edition` returns no
detection logic. The only hits are (a) unrelated fee/verification "stamp" date
helpers (`js/core.d9e1b484.js:5862-5875`), (b) comments about a
pokemontcg.io card *named* "Bulbasaur (Mega Evolution Stamped)"
(`js/ui.6b3a528e.js:2379`, `2785`; `js/core.d9e1b484.js:12154`). Nothing reads a
1st Edition or shadowless stamp off the image, and nothing asks the user.
Mitigation, not detection: the price layer defaults *away* from premium
printings so an undetected 1st Edition is under-valued rather than
over-valued — `api/_tcgcsv.js:438-489` ranks `Holofoil, Normal, Reverse
Holofoil, Unlimited Holofoil, …` ahead of `1st Edition Holofoil/Normal`, with
the comment recording the Neo Genesis Lugia #9 case (1st Ed Holofoil $1085.03 vs
Unlimited Holofoil $518.99, previously returned as $5,917) and the rule
"Unlimited is the safe default" (`api/_tcgcsv.js:443-453`); the unrecognized-
subtype fallback re-sorts `1st edition|shadowless|first edition|staff|prerelease`
to the back (`api/_tcgcsv.js:475-477`). `tests/variant-selection.mjs` pins this.

**Severity, honestly:** the JP half is not a silent-wrong-ID bug in single scan —
the language is detected at the provider, surfaced in the card title, and priced
from the JP catalog. In bulk it is a silent *labelling* gap: the ID and the price
are right, the row just doesn't say "Japanese". The stamp half is a real
correctness exposure, but it is a systematic under-valuation (safe direction,
deliberately chosen and documented), not a random wrong number — so: medium, and
lower than item 19's bulk-refund silence.

**If real, what it takes:** add a `(JP)` chip to the bulk row in
`_bulkUpdateRow` (`js/ui.6b3a528e.js:3364-3382`) when `result.isJapanese`. For
stamps, the cheap honest version is a user-declared selector rather than
detection: expose the `1st Edition …` variants that already arrive in
`allVariants` (`api/_tcgcsv.js:468`) in the Printing/Variant dropdown with a
"1st Ed? price differs" note — see item 26.
**Rule conflict:** rule 2 — do not infer or display a 1st Edition premium the
feed did not price.

---

### Item 24 — "Sports / non-TCG scan path that doesn't pretend it's a Pokemon index"
**Verdict:** SHIPPED for the scan routing; the reviewer's implied failure mode
(a sports card being forced through Pokemon) is specifically prevented.

**Evidence:**
- Server: identify calls Ximilar's TCG endpoint first and, on
  `no_match`/`no_card_detected`, retries Ximilar's **sport** endpoint
  (`api/scan.js:1016-1025`); when the sport path answers, the response carries
  `sport` and `year` and the Pokemon-only alphabet tag is explicitly cleared
  (`api/scan.js:1124`: `cardInfo.is_japanese = false; // Ximilar's alphabet tag
  was for pokemon path`).
- Client: `_routeScannedSportsCard` (`js/core.d9e1b484.js:11825-11899`) switches
  the game selector to `sports`, fills `sp_player`, `sp_year`, `sp_brand`,
  `sp_cardnum` and the `sp_sport` select from the scan, fires
  `doSportsSearchLive`, then calls `loadSportsCardFromSearch` so the card panel
  and the parallel picker actually render, and toasts "Sports card scanned —
  pick your exact parallel to price it."
  The comment at `js/core.d9e1b484.js:11881-11886` records why that second call
  exists (before it, a scanned sports card filled the form and stopped).
- Cross-TCG mis-tagging is handled too, and conservatively: Ximilar mis-tagging
  a Yu-Gi-Oh card as Pokemon does not silently swap the user's chosen game —
  `js/core.d9e1b484.js:2005-2043` asks first, and only auto-switches when the
  user was in the generic Sports/Other mode.
- Non-Pokemon TCGs get their own loader rather than the Pokemon one
  (`_loadScannedNonPokemonCard`, `js/core.d9e1b484.js:11912+`), and it removes
  any stale Pokemon scan-miss panel (`js/core.d9e1b484.js:11924-11930`).
- One honest caveat: when the sport is not returned, the router **defaults to
  Baseball** (`js/core.d9e1b484.js:11847`: `const inferredSport = (sport ||
  'Baseball')`). That is a guess, though a low-stakes one (it selects a dropdown
  value the user can change, and sport is not part of the price key alone).

**If real, what it takes:** n/a for the routing. Optionally leave `sp_sport`
unselected instead of defaulting to Baseball.
**Rule conflict:** rule 2 is arguably touched by the Baseball default (a value
the user did not supply, presented as if scanned).

---

### Item 25 — "Empty state for non-Pokemon that isn't Charizard"
**Verdict:** WRONG as stated — every non-Pokemon mode has its own empty state
and its own example placeholders. The reviewer likely landed on the first-visit
auto-example, which is Pokemon by design.

**Evidence:**
- `showIntro()` branches per game (`js/core.d9e1b484.js:8015-8052`): sports gets
  `⚾ "Search eBay comps, then enter your price"`; pokemonjp gets
  `🇯🇵 "Search a JP card, click JP COMPS"`; the no-card default is
  `🃏 "Search for a card to get started" / "Find any Pokémon, Magic, Yu-Gi-Oh!,
  Lorcana or One Piece card…"`. No Charizard anywhere in it.
- Switching game clears the card, resets the panel and swaps the search
  placeholder per game (`onGameSelectChange`, `js/core.d9e1b484.js:759-790`):
  mtg → "e.g. Black Lotus, Jace…", yugioh → "e.g. Dark Magician, Blue-Eyes…",
  lorcana → "e.g. Elsa, Mickey Mouse…", onepiece → "e.g. Luffy, Zoro…",
  other → "Enter card name to search (manual price only)".
- Per-game no-results states exist as well: `js/core.d9e1b484.js:1264`/`1271`
  ("No Magic cards found…"), `:1524`/`:1531` ("No Yu-Gi-Oh! cards found…"),
  `:1382` ("No Lorcana cards found…"), `:1363` ("Lorcana card database
  unavailable…"), `:1167` (JP: "No results found. Try clicking the JP COMPS
  button above."), `:921` (Other TCG: "No live API for \"Other TCG\". Enter your
  price manually in the Override field.").
- Where Charizard *does* appear: a first-time visitor with no deep link and no
  saved card gets an auto-run example that forces Pokemon and searches
  "Charizard" (`autoRunExampleCard`, `js/core.d9e1b484.js:714-745`, gated at
  `js/core.d9e1b484.js:17956-17972`), and there is a persistent
  `Try Charizard →` CTA button (`index.html:1728`) wired to `loadExampleCard`
  (`js/core.d9e1b484.js:682-701`), which also force-switches to Pokemon.
- The only real nit: that CTA has **no per-game hide logic** — the only JS
  touching `tryExampleBtn` is the first-visit pulse
  (`js/core.d9e1b484.js:17964`, `17975`) — so a user sitting in MTG mode still
  sees "Try Charizard →".

**If real, what it takes:** relabel/hide `#tryExampleBtn` per `activeGame` in
`onGameSelectChange` (`js/core.d9e1b484.js:759`) — e.g. "Try Black Lotus →" in
MTG. Small copy change; the empty states themselves need nothing.
**Rule conflict:** none.

---

### Item 26 — "Printing / language / stamp / 1st Ed as unavoidable selectors, not buried"
**Verdict:** PARTIAL. The printing selector is prominent, not buried — but it is
**auto-defaulted rather than unavoidable**, and language/stamp/1st Ed are not
selectors at all.

**Evidence — not buried:** the Printing / Variant control is a top-level field
in the card panel, directly under Condition and above Graded Slab, with an
inline qualifier: `index.html:2196-2200` —
`Printing / Variant <span …>— raw prices; graded prices set below</span>` and
`<select id="printingSelect" onchange="_onPrintingChange()">`.

**Evidence — but avoidable:** `loadCardUI` builds the options and then picks one
for the user: `js/core.d9e1b484.js:3579-3640`. Every non-graded variant is added
as `label — $price` (graded slabs are deliberately excluded and live in the
grade dropdown, `js/core.d9e1b484.js:3628`), then
`const pref = ['holofoil','reverseHolofoil','normal','usd','tcgplayer']` selects
the first available and falls back to `variants[0].key`
(`js/core.d9e1b484.js:3634-3639`), immediately calling `updatePriceFromPrinting()`
and `calc()`. So a user who never touches the dropdown still gets a priced
answer chosen for them. Only the empty/reset states show a forcing
`— select —` (`index.html:2199`, `js/core.d9e1b484.js:3698`).
The same default-choosing happens server-side for feed prices:
`bestPriceForProduct` (`api/_tcgcsv.js:438-489`).

**Evidence — the refusals that DO exist, and their limits.** The parent asked
for the logic that refuses ambiguous lookups. There are three, and none of them
is a printing/variant guard:
1. `_loadScannedCardExact` (`js/core.d9e1b484.js:12209-12460`) runs a query
   ladder plus a set-score pre-sort (3 = identical set, 2 = whole word,
   1 = substring, ties to fewest extra words — `:12355-12375`) and then match
   tiers (rarity+set+number+name → rarity+set+name → set+number+name →
   number+name → number-before-slash+name). Critically, the comment block at
   `js/core.d9e1b484.js:12420-12440` documents that the number-only, name-blind
   fallback was **removed** (it read "Fennekin #080" and loaded Snorlax Flashfire
   #80 at $4.72) and that there is deliberately **no `cards[0]` fallback** — a
   miss renders the scan-miss panel instead. So: it refuses a wrong *card*, not
   a wrong *printing of the right card*.
2. `pcIdentityRejection` (`api/pricecharting.js:279-312`) refuses a
   PriceCharting product whose name or number contradicts the request, and
   refuses a sealed product when a card number was asked for (the recorded prod
   bug: `Miraidon #197 -> "League Battle Deck: Miraidon Ex" at $20.98`,
   `api/pricecharting.js:296-309`). It is **exempt for sports and for an
   explicit `pcid`** (`:283-285`).
3. `filterSportsParallel` (`api/pricecharting.js:342-380`, rationale at
   `:322-337`) is the one true variant guard: if the caller named a parallel the
   candidate's bracket must contain every word of it, supersets/no-match refuse
   rather than fall back to base; if the caller named no parallel, only bare
   (unbracketed) candidates are kept, and a card existing *only* as parallels
   refuses rather than guesses. That discipline exists for **sports only**.
   Pokemon printings get the preference-ordered default instead.
- `tests/variant-selection.mjs` documents the cost of getting this wrong: it
  pins Unlimited Holofoil ($518.99) over 1st Edition Holofoil ($1085.03) for Neo
  Genesis Lugia #9 and records the two-source disagreement that the old
  1st-Edition-first ordering produced.
- Language is a mode, not a per-card selector (`pokemon` vs `pokemonjp` in the
  game select, `js/core.d9e1b484.js:759-790`); stamp/1st Ed have no selector at
  all (see item 23).

**If real, what it takes:** in `js/core.d9e1b484.js:3634-3639`, when two or more
*materially different* raw variants are priced (e.g. a >2x spread, or a
1st Edition/Unlimited pair), leave `printingSelect` on `— select —` and suppress
the auto-priced number until the user picks — reusing the refuse-rather-than-
guess stance already written for sports parallels
(`api/pricecharting.js:322-337`).
**Rule conflict:** rule 1 — the "refuse when ambiguous" behavior should be one
shared rule, not a Pokemon copy of `filterSportsParallel`. Rule 2 also applies:
the currently-defaulted price is presented as *the* market price with no note
that a printing was chosen for the user.

---

### Item 28 — "Watchlist + price-drop alert per card, not a newsletter footer"
**Verdict:** GAP. The reviewer is exactly right, including the jab.

**Evidence:** searching the live bundles, `index.html` and all of `api/` for
`watchlist`, `price drop`, `price alert`, `notifyOnPrice` returns **one** hit:
`index.html:1646`, the heading
`📬 Price Drop Alerts`. The block beneath it is a newsletter signup —
"Get CardResell updates", "Tips, new features, and market alerts — no spam,
unsubscribe anytime" (`index.html:1647-1649`), an email field and a Subscribe
button (`index.html:1650-1653`). `submitNewsletter`
(`js/core.d9e1b484.js:8910-8945`) POSTs the email to `/api/newsletter` and shows
"You're subscribed! Thanks for joining." There is no per-card watch record, no
target price, no scheduled job (`api/` contains `newsletter.js` and
`ebay-notifications.js`; nothing that evaluates a saved price threshold).

**Rule note worth raising on its own:** a section headed "Price Drop Alerts"
that only subscribes the user to a general newsletter is a rule 3 violation
(UI text must match what the code does) independent of whether the feature is
ever built. Renaming that heading is a one-line fix.

**If real, what it takes:** a watch record per card (game/set/number/variant +
target), a scheduled re-price job hitting the existing price endpoints, and a
delivery channel. Files that would change: `index.html` (a Watch button on the
card panel), `js/core.d9e1b484.js` (watch add/remove + list view), a new
`api/watchlist.js`, and a cron entry. Delivery via the existing PWA push
(`js/pwa.68032543.js`) or email.
**Rule conflict:** rule 3 today (the mislabeled heading). Rule 7 (deployment on
hold) affects when a new cron can ship. Nothing in the do-not-do list blocks it,
as long as prices come from the existing endpoints and not from page reads.

---

### Item 30 — "Sports cards as a real mode (player + year + set), not ToS-only"
**Verdict:** SHIPPED — and it is more than player+year+set.

**Evidence:**
- Dedicated form, shown when the game select is `sports`
  (`index.html:1870`, toggled at `js/core.d9e1b484.js:770-772`):
  `sp_player` "Player Name *" (`index.html:1887-1888`), `sp_year`
  (`:1891-1892`), `sp_sport` select (`:1895-1896`), `sp_brand` "Brand / Set"
  (`:1906-1907`), `sp_cardnum` "Card #" (`:1910-1911`), `sp_grade`
  "Grade / Condition" (`:1914-1915`). The lookup search row is hidden in sports
  mode and this form replaces it (`js/core.d9e1b484.js:770-771`).
- Pricing is a real sports source, not a TCG shim: `api/pricecharting.js` points
  at `sportscardspro.com` for sports (`:487-489`) and stamps
  `source: 'sportscardspro'` (`:640`, `:648`, `:696`, `:720`); the sports query
  is built from year + brand + name + set + number + sport
  (`api/pricecharting.js:538-548`); `isSportsCategoryOk`
  (`api/pricecharting.js:790-812`) rejects Funko/plush/console rows; the cache
  key carries game/year/parallel/pcid (`api/pricecharting.js:516`).
- The parallel picker is the centerpiece, and its copy is honest about why:
  `index.html:1884` — "Fill in the card, then **pick your exact parallel** from
  the list — we price that one product at the grade you chose, from the
  SportsCardsPro guide. Parallels of the same card can differ by many multiples,
  so nothing is priced until you pick one. No published value for your grade
  means you'll see a comp link instead of a guess." That matches
  `filterSportsParallel` (`api/pricecharting.js:342-380`), which refuses rather
  than substituting a base-card price.
- Scans route into this mode (see item 24, `js/core.d9e1b484.js:11825-11899`).
- `tests/sports-price-guard.mjs` and `tests/sports-parallel.mjs` extract and pin
  `isSportsCategoryOk`, `sportsCandidateAdmissible`, `scoreSportsCandidate`,
  `pcParallelOf`, `filterSportsParallel`, `pcNameMatches`, `pcNumberMatches`,
  `pcIdentityRejection` against Jordan/Brady/Griffey/Morant fixtures.
- Real limits, stated plainly: sports is excluded from the main autocomplete
  (`doSearch` returns immediately when `activeGame === 'sports'`,
  `js/core.d9e1b484.js:892-893`), sports cards fall back to the Override field
  for pricing when the guide has no value for the chosen grade
  (`js/core.d9e1b484.js:8016-8025`), and in bulk a sports row commonly shows an
  `unavailableReason` instead of a price
  (`js/ui.6b3a528e.js:3209`, rendered at `js/ui.6b3a528e.js:3363`; the sports
  reason string itself is `js/ui.6b3a528e.js:2677` — "Sports pricing lives in the
  card details — tap 🔍 for live comps.").

**If real, what it takes:** n/a.
**Rule conflict:** none.

---

## Group summary

**Counts per verdict (11 items)**
- SHIPPED: 3 — items 21, 24, 30
- PARTIAL: 5 — items 18, 19, 20, 23, 26
- GAP: 2 — items 22 (for the specific typed set-code/number mechanism), 28
- WRONG: 1 — item 25
- GAP-BLOCKED / NOT-CODE / UNVERIFIABLE: 0

**The 3 most worth doing first**
1. **Item 19 (bulk) — one line of copy on failed bulk rows.** The refund is
   already automatic and correct server-side (`api/scan.js:956-975`,
   `1032-1068`); only the bulk UI stays silent about it
   (`js/ui.6b3a528e.js:3384-3399`, `3229-3234`). It is the cheapest fix in the
   group and it is the one that touches user money.
2. **Item 28 — rename "📬 Price Drop Alerts" (`index.html:1646`).** The feature
   does not exist; the heading claims it does. That is a rule 3 violation live
   on the page today, fixable in one line, independent of ever building the
   watchlist.
3. **Item 26 — stop auto-defaulting the printing when variants disagree
   materially** (`js/core.d9e1b484.js:3634-3639`). The "refuse rather than guess"
   discipline is already written and tested for sports parallels
   (`api/pricecharting.js:322-380`); Pokemon printings still get a silent
   preference pick, and `tests/variant-selection.mjs` records what that costs.

**What the reviewer got materially wrong**
- **Item 25 is wrong.** Every non-Pokemon mode has its own empty state and its
  own example placeholders (`js/core.d9e1b484.js:8015-8052`, `759-790`,
  plus per-game no-results copy at `:1167`, `:1264`, `:1382`, `:1524`). What
  they almost certainly hit is the deliberate first-visit auto-example, which
  forces Pokemon/Charizard (`js/core.d9e1b484.js:714-745`, gated at `:17956`).
  The only legitimate residue is the always-visible "Try Charizard →" CTA
  (`index.html:1728`), which does not relabel per game.
- **Items 24 and 30 understate the system.** Sports is a full mode with its own
  form, its own price source (SportsCardsPro), a mandatory parallel picker, a
  refuse-rather-than-guess parallel filter, and two dedicated test files. The
  scan path routes into it, and cross-TCG mis-tags *ask* before switching games
  (`js/core.d9e1b484.js:2005-2043`) rather than pretending everything is Pokemon.
- **Item 19's premise is half wrong.** Refunds are instant and automatic on every
  failure path, and single-scan says so verbatim ("Your ID credit was refunded
  automatically.", `js/core.d9e1b484.js:13657`). Only bulk is silent.
- **Item 21 is already shipped**, automatically, at the end of every batch.
- **Item 18's "retry" is already shipped and genuinely free** (server-validated
  `retry_of`, `api/scan.js:803-830`); it is *pause* and a batch ceiling that are
  missing, not retry.

**What I could not check, and why**
- Whether bulk actually sustains 20-50 cards in one session (item 18). That
  needs a live run against `/api/scan` with real photos and real credits, which
  METHOD.md forbids. The code has no cap, 3 workers, and a mid-batch
  out-of-credits path; latency, provider rate limits and serverless timeouts at
  that batch size are runtime facts.
- Ximilar's current miss rate and its sport-endpoint coverage (items 22, 24).
  Those are provider behaviors; the code paths are verified but the hit rates
  are not.
- The offline pHash fastpath's real accuracy. `tests/scanner-fastpath.mjs:1-19`
  states its own checks are structural and that the empirical harness
  (`tools/fastpath_calibration.mjs`) must be re-run by hand; the last recorded
  numbers there (26/30 accepted, 0 wrong-accepted, mean self-distance 2.5 bits)
  are the test file's claim, not something I measured.
- Whether the `needsPicker` bulk behavior I flagged under item 19 ever fires in
  practice — it depends on how often Ximilar returns medium confidence with 2-3
  candidates, which is a live-provider question.
