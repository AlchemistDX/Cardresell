# Group E — UX / platform, social proof & growth, ops / risk (items 47–62)

Verification of reviewer claims 47–62 against `/home/user/workspace/cardresell`.
Read-only; no tests executed, no production endpoints called, no secrets printed.
Live bundle per `index.html:3517` and the `<script src>` set is `js/core.d9e1b484.js`
(+ `js/ui.6b3a528e.js`, `js/pwa.68032543.js`). `js/core.569ff536.js` is stale and is
not cited anywhere below.

---

### Item 47 — First session aha: a ghosted 15-venue rank, not two near-tied free rows

**Verdict:** PARTIAL

**Evidence:**
- The free tier really is exactly two venues: `const FREE_PLATFORMS = new Set(['ebay', 'tcgplayer']);`
  (`js/core.d9e1b484.js:5883`), Pro is 9 (`:5884`), Pro Max / Ultimate is 15 (`:5885`),
  gated through `platformsForTier()` (`:5887-5891`) and `venueUnlocked()` (`:6059-6061`).
  A comment states the counts outright: "Free = 2, Pro = 9, Pro Max and Ultimate = 15"
  (`js/core.d9e1b484.js:7450`). So the reviewer's "two near-tied free rows" is an accurate
  description of the free ranking strip.
- Ghosting is **already built, but capped at 3**. The ranking strip renders unlocked rows
  plus locked teaser rows: `const unlockedRank = eligible.filter(...).slice(0, 8);`
  and `const lockedRank = eligible.filter(r => !_tierPlatforms.has(r.pid)).slice(0, 3);`
  (`js/core.d9e1b484.js:7343-7344`), with the comment "up to 3 locked venues render as
  teaser rows (name + blurred $ + Upgrade link) so Free users [see them]"
  (`:7339-7341`). The locked row shows the venue name and a blurred amount
  `<div class="payout-rank-amt payout-rank-blur">$•••.••</div>` (`:7376`) and is clickable
  into the upgrade flow (`:7371`).
- Cross-border labelling renders on locked rows too, deliberately: "Shown on EVERY venue,
  locked or unlocked, so a seller comparing a blurred row still knows the venue is [foreign]"
  (`js/core.d9e1b484.js:5836-5837`).
- The full 15-venue list is also visible (not blurred) in the venue picker, where locked rows
  stay rendered with an "Upgrade to unlock" chip (`js/core.d9e1b484.js:6115`, `6144`, `6157-6160`).
- Gate on the strip itself: it only renders when `unlockedRank.length >= 2`
  (`js/core.d9e1b484.js:7346`), i.e. a free user needs both eBay and TCGplayer eligible
  to see any rank at all.

**If real, what it takes:** The aha the reviewer wants is 15 ghosted rows, not 2 + 3.
The change is one number: raise the `.slice(0, 3)` cap on `lockedRank`
(`js/core.d9e1b484.js:7344`) and let the row template repeat, plus a mobile density pass
(`.payout-rank-row` mobile rules at `index.html:725`). No new data is needed — every locked
venue's net is already computed in `eligible` before the slice.

**Rule conflict:** none. This modifies an existing single implementation rather than adding
a parallel one. Note the blurred value must stay blurred rather than being replaced with a
placeholder figure (rule 2).

---

### Item 48 — Mobile: scan/grade as a sticky bar; promo banner gone after dismiss

**Verdict:** PARTIAL

**Evidence:**
- A mobile-specific scan/grade row exists but it is **not sticky**. `.scan-sub-row{display:none;
  gap:.5rem;margin-top:.45rem;flex-wrap:wrap}` (`index.html:289`), switched on below 820px:
  `@media(max-width:820px){ .search-row .scan-inline{display:none!important} .scan-sub-row{display:flex!important} }`
  (`index.html:296-299`). Markup is at `index.html:1760-1773` (ID Scan / Bulk ID / AI Grade,
  each with a live credit count). It sits inline under the search box and scrolls away —
  there is no `position:sticky` or `position:fixed` on it. The header `.hdr` is not sticky
  either (`index.html:238`). The only fixed bottom elements are the toast (`index.html:1261`)
  and the PWA install banner (`index.html:3808`).
- Touch targets on that row are already 44px on small screens (`index.html:1083`).
- Promo banner dismissal **does** persist, but only for the session:
  `dismissPromoBanner()` writes `sessionStorage.setItem('cs_banner_dismissed', '1')`
  (`js/core.d9e1b484.js:16890-16893`), and `updateProUI()` re-shows it only when that key is
  absent (`:16878-16882`). So it is gone after dismiss within the tab, and returns in a new
  tab or after a browser restart. The signed-out sign-in nudge behaves the same way
  (`index.html:1690`, `js/core.d9e1b484.js:16851-16856`).

**If real, what it takes:** (a) add `position:sticky;bottom:0` (or a fixed bar with
`padding-bottom: env(safe-area-inset-bottom)`) to `.scan-sub-row` inside the existing
`@media(max-width:820px)` block at `index.html:296-299`, and reserve body padding so the
last rank row is not covered; (b) if "gone after dismiss" should mean permanently, change
the one `sessionStorage` call at `js/core.d9e1b484.js:16892` and its read at `:16879` to
`localStorage` with a TTL — the PWA banner already models this pattern with a 30-day
dismissal window (`js/pwa.68032543.js:3-4`, `14-22`).

**Rule conflict:** none.

---

### Item 49 — One visual system (light app vs dark pricing)

**Verdict:** PARTIAL — and the split is accidental, not a design decision.

**Evidence:** There are effectively **three** visual systems in the repo:
1. **App, light** — `:root, [data-theme="light"]` with `--bg:#f2f1ed`, `--text:#18160f`
   (`index.html:81-113`).
2. **App, dark** — `[data-theme="dark"]` with `--bg:#111009`, `--text:#d4d2cc`
   (`index.html:115-146`).
3. **Marketing pages, dark-only** — `pricing.html:43-45` hardcodes its own token block
   (`--bg:#0a0a0b; --surface:#141416; --text:#eee`), which is a *different* dark palette
   from the app's dark tokens (`#111009` / `#1a1915` / `#d4d2cc`). `pricing.html`, `about.html`,
   `contact.html`, `privacy.html`, `terms.html` carry no `data-theme` attribute at all
   (`<html lang="en">`), so the app's toggle cannot reach them. Only `index.html:2` and
   `accuracy.html` declare `data-theme="dark"`.

Which app theme a first-time visitor sees is decided by the OS, not by the product:
`let d = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
root.setAttribute('data-theme', d);` (`js/core.d9e1b484.js:8061-8064`). The toggle button
(`index.html:1540`) flips the attribute but **never persists the choice** — there is no
`localStorage` write in that IIFE (`js/core.d9e1b484.js:8060-8078`), so the preference is
lost on every reload. And on phones under 480px the toggle is hidden entirely
(`.hdr .theme-btn{display:none!important}`, `index.html:257`).

So the reviewer's observation is reproducible and has a precise cause: a light-mode OS user
gets a light app (`index.html:2` is overwritten at `js/core.d9e1b484.js:8064`) and then a
hardcoded dark pricing page. That is not an intentional light/dark split; it is one page set
that honours the OS and another that ignores it, using a third palette.

The per-game ambient pattern (`body[data-game-theme=...] .theme-bg`, `index.html:152-232`)
is a **separate layer** and is the protected wallpaper — it is not part of this finding and
should not be touched.

**If real, what it takes:** the smallest honest fix is to give the static pages the same
token block and `data-theme` handling as `index.html:81-146`, and to persist the toggle
choice (one `localStorage` read/write in `js/core.d9e1b484.js:8060-8078`) so the app stops
re-deciding on every load. Do **not** duplicate the token block per page — that would be a
second implementation of the same behavior.

**Rule conflict:** Rule 1 risk. Copy-pasting tokens into each `.html` file creates five
parallel implementations of one theme system. Extract one shared stylesheet instead. Rule 6:
keep the wallpaper/`theme-bg` layer untouched.

---

### Item 50 — Working PWA / add-to-home-screen called out for shop-floor use

**Verdict:** PARTIAL

**Evidence:**
- A real web app manifest exists and is linked and routed: `manifest.json` (name, `start_url:"/"`,
  `display:"standalone"`, `theme_color:"#111009"`, 192/512/maskable/apple-touch icons),
  linked at `index.html:1281` (`<link rel="manifest" href="/manifest.json" />`), served static
  and routed in `vercel.json` (builds list and `{ "src": "/manifest.json", "dest": "/manifest.json" }`).
  Icons exist on disk: `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`.
- An install prompt flow is implemented in `js/pwa.68032543.js`: it captures
  `beforeinstallprompt` (`:37-47`), only shows the banner after the user has loaded a card
  (`if (window.selectedCard) showBanner()`, `:42-46`), calls `deferred.prompt()` on click
  (`:50-53`), and has an explicit iOS path with 3-step Share → Add to Home Screen instructions
  (`:61-63`, `:67-79`), plus a 30-day dismissal memory (`:2-3`, `:14-22`) and an `appinstalled`
  handler (`:81-84`). Banner markup: `index.html:3808-3816`, copy "Scan cards right from your
  home screen — no browser tabs" (`index.html:3812`).
- **What is missing: there is no service worker.** No `sw.js` or equivalent exists anywhere in
  the repo (`find` for service-worker files returns nothing), and no `navigator.serviceWorker`
  registration appears in `index.html` or any live bundle. So the installed app is a
  standalone-window shortcut with zero offline capability or asset precaching — a shop floor
  with bad wifi gets a blank page, and Chrome's installability criteria are only met on the
  strength of manifest + HTTPS.
- Meta tags: `apple-mobile-web-app-status-bar-style` and `-title` are present
  (`index.html:1286-1287`); `apple-mobile-web-app-capable` is not.

The reviewer says PWA/add-to-home-screen should be "called out for shop-floor use" — it *is*
called out (`index.html:3812`), but only after a card loads, and the thing being installed is
not offline-capable.

**If real, what it takes:** add a service worker (new file, e.g. `sw.js`, plus a registration
call in `index.html` and a route in `vercel.json`) precaching `index.html`, the hashed bundles,
and the icons, with a network-first policy for `/api/*` so prices are never served stale from
cache. Note the two index JSON blobs are 4.3MB and 3.7MB (`card-index.json`, `mtg-index.json`) —
precaching those would be hostile; they are already `max-age=86400, immutable` in `vercel.json`.

**Rule conflict:** Rule 5 forbids `package.json` and a bundler/framework migration — so the
service worker must be hand-written vanilla JS with a manually rotated cache version string,
not Workbox-generated. That is feasible but must be stated up front.

---

### Item 51 — Keyboard + paste-image + camera permissions that do not fail silently

**Verdict:** PARTIAL — the paste half is a straight GAP; the camera half is the reviewer's
weakest claim.

**Evidence:**
- **Paste-image: does not exist.** There is no `paste` listener, no `clipboardData` read, and
  no `onpaste` handler anywhere in `index.html`, `js/core.d9e1b484.js`, or `js/ui.6b3a528e.js`.
  There is also no drag-and-drop path (`dragover` / `drop` / `dataTransfer` return zero hits).
  Image input is exclusively file inputs (`index.html:1789-1790`,
  `<input type="file" id="scanFileInput" accept="image/..." capture="environment">`) and the
  live camera overlay. A desktop user with a screenshot in the clipboard has no route in.
- **Camera permissions: not silent, but not surfaced consistently either.**
  `openLiveCameraCapture()` checks for API absence and reports `onCancel('unsupported')`
  (`js/ui.6b3a528e.js:621-624`), and on a rejected `getUserMedia` it logs and reports
  `onCancel('permission-denied')` (`js/ui.6b3a528e.js:688-692`). Rapid Scan surfaces a
  user-visible message: `showToast('⚠️ Camera permission needed for Rapid Scan.')`
  (`js/ui.6b3a528e.js:2020-2021`).
  The Grade/Single-Scan callers **deliberately** say nothing and instead open the native
  `<input capture=environment>` picker: "On permission-denied or unsupported, silently fall
  back to the native `<input capture=environment>` flow" (`js/core.d9e1b484.js:14218-14224`,
  and the same at `:14237-14241`, `:14254-14258`, `:14272-14278`). That is a designed graceful
  degradation to a working path, not a dead end — so "fails silently" is the wrong description,
  though the user is never told why the guided-frame UI disappeared.
- **Keyboard:** partial. Modals are Escape-closable (`js/core.d9e1b484.js:2747-2751`, `6361-6362`,
  `17317-17318`), one modal implements a focus trap on Tab (`:17400-17406`), locked venue rows
  are keyboard-activatable (`role="button" tabindex="0"` + Enter/Space handler,
  `js/core.d9e1b484.js:6158-6160`), and Enter/Escape work in the search box
  (`js/core.d9e1b484.js:859-868`) and the verify-code inputs (`:10504`, `:10624`).
  **Missing: arrow-key navigation of the autocomplete dropdown.** `#dropList` is
  `role="listbox"` (`index.html:1744`) but the search input's keydown handler
  (`js/core.d9e1b484.js:859-868`) handles only Enter and Escape — no ArrowUp/ArrowDown, no
  `aria-activedescendant`. A keyboard user cannot select a suggestion.

**If real, what it takes:** (1) one `paste` listener on `document` that pulls
`e.clipboardData.files`/`items` image blobs into the existing `processScanImage` /
`processGradeImage` entry points (`index.html:1789-1790`) — no new pipeline needed;
(2) ArrowUp/ArrowDown + `aria-activedescendant` in `js/core.d9e1b484.js:859-868`;
(3) optionally a one-line toast before the native-picker fallback at
`js/core.d9e1b484.js:14222`, `14238`, `14255`, `14273` so the switch is explained.

**Rule conflict:** none, provided paste routes into the *existing* image pipeline rather than
a second one (rule 1).

---

### Item 52 — First paint is Pokemon-coded; default game should follow last-used or geo/referrer

**Verdict:** PARTIAL. The reviewer is right about first paint. Last-used is partially
implemented (via the last-*card* snapshot, not a last-*game* preference). Geo/referrer does
not exist.

**Scope note — this is NOT the wallpaper.** The protected wallpaper is the ambient
`.theme-bg` pattern layer driven by `body[data-game-theme=...]` (`index.html:152-232`,
set at `js/core.d9e1b484.js:751` and `:803`). This item is about the **default value of
`activeGame`**, which is a separate variable that happens to also drive that attribute.
Changing the default game changes which wallpaper is showing without editing the wallpaper
itself. Any fix must not modify the pattern definitions at `index.html:152-232`.

**Evidence:**
- Hard-coded Pokemon default in two places: `let activeGame = 'pokemon';` and
  `window.activeGame = 'pokemon';` (`js/core.d9e1b484.js:480-481`), and the static markup
  `<body data-game-theme="pokemon">` (`index.html:1484`). So first paint is Pokemon before any
  JS restore runs.
- Last-used is restored **only as a side effect of restoring the last viewed card**:
  `_restoreLastLoadedCard()` reads `localStorage['cr:lastCard:v1']` (`js/core.d9e1b484.js:495`,
  `542-545`) and, if the snapshot's game differs, calls `switchGame(snap.game)`
  (`:573-577`). It fires 400ms after load and is skipped when a deep-link param is present
  (`js/core.d9e1b484.js:17998-18007`). Consequences: a user who browsed MTG but never loaded a
  card still gets Pokemon; and every user gets a 400ms Pokemon flash before the switch.
- There is no `?game=` URL parameter handling, no `Accept-Language` check, no geo lookup, and
  no referrer inspection anywhere in the live bundle — searching for a persisted game
  preference returns only `dropList.dataset.lastGame`, which is an autocomplete cache key
  (`js/core.d9e1b484.js:901`, read at `js/ui.6b3a528e.js:199`), not a user preference.
- Pokemon is also privileged elsewhere in ways that reinforce the impression: a Pokemon-only
  dropdown footer (`js/core.d9e1b484.js:1579`) and Pokemon-only branches at `:685`, `:716`.

**If real, what it takes:** persist the selected game to `localStorage` inside the existing
`onGameSelectChange` (`js/core.d9e1b484.js:749-751`) and read it where `activeGame` is
initialised (`:480-481`), before `_restoreLastLoadedCard` runs, so there is no flash. A `?game=`
param is a cheap referrer/campaign lever on top of that. Geo-based defaulting (EN vs JP
Pokemon) is the weakest form and would need a new data source; last-used covers the complaint.

**Rule conflict:** Rule 6 adjacency — do not touch the wallpaper pattern block
(`index.html:152-232`) or the `data-game-theme` attribute contract; only the default value of
`activeGame` changes.

---

### Item 53 — Named testimonials with a real flip

**Verdict:** NOT-CODE

**The decision the owner actually has to make:** whether to ask real users for attributable
quotes with a dollar figure, and whether to publish them. No amount of code changes this.
There is nothing to build until the quotes exist; once they do, they are static markup in
`index.html`.

For completeness: there are **no** testimonials anywhere in the site today. The only
social-proof-adjacent copy is the search counter (item 54) and the operator line "Built by a
card flipper, for card flippers" (`index.html:3303`).

**If real, what it takes:** n/a (business).

**Rule conflict:** If testimonials ever quote a payout figure, rule 2 applies — a quoted
number must come from a real user's real flip, not a representative example.

---

### Item 54 — Homepage search counter paired with outcomes, not vanity volume

**Verdict:** PARTIAL — the counter is real and honestly built, but it counts API calls, not
outcomes, and it has two soft spots.

**Evidence:**
- The counter is genuinely KV-backed, not a formula: `/api/stats` reads
  `stats:searches:total` from Upstash (`api/stats.js:60-77`), and every price lookup and scan
  increments it server-side (`api/tcg-price.js:798-806`, called at `:123, 187, 270, 307, 313, 513`;
  `api/scan.js:2677`, called at `:1211, 2493`). The client renders "Over N searches so far —
  find out the value of your card" (`js/core.d9e1b484.js:3251`, markup `index.html:1725`) and
  hides the badge entirely until a real number arrives — "no fake '0' flash"
  (`js/core.d9e1b484.js:3248`). The "cards searched today" badge is hidden when today's count is
  0 so the site "never advertise[s] a fake number" (`js/core.d9e1b484.js:3264-3275`,
  `index.html:2420`). That discipline is real and matches rule 2.
- **What it actually counts** is `/api/tcg-price` and `/api/scan` invocations — including
  cache hits (`api/tcg-price.js:123`) and **including lookups that found nothing**: the
  `no_match` empty response increments before returning (`api/tcg-price.js:313`, returning
  `{market:null, ..., reason:'no_match'}`). So a failed search counts as a search. It is
  volume, exactly as the reviewer says, and it is not tied to any outcome.
- **Two soft spots the owner should know:**
  1. `const BASELINE = 200;` and `Math.max(parseInt(totalRaw) || 0, BASELINE)`
     (`api/stats.js:17-19`, `:70`) floors the public number at 200 even if KV is wiped. The
     comment justifies it as ~200 real dev searches. It is a floor, so it can only overstate,
     and the response does label its provenance (`since: 'kv' | 'baseline'`, `api/stats.js:76`)
     — but the UI does not surface that label.
  2. `POST /api/stats` is secret-guarded so clients cannot inflate the counter
     (`api/stats.js:103-107`) — but `/api/tcg-price` is fully unauthenticated with
     `Access-Control-Allow-Origin: *` (`api/tcg-price.js:71-72`), and it increments on every
     call. Anyone can inflate the public counter with a loop against the price endpoint. See
     item 60.
- The displayed figure is base + this-session bumps (`js/core.d9e1b484.js:3237-3241`,
  `_triggerSocialProof` at `:3280-3283`), which is defensible since each bump follows a real
  search by that visitor, but it means two tabs show two different totals.

**If real, what it takes:** the reviewer's ask ("paired with outcomes") is a product/marketing
decision about what to show, and the data to back an outcome claim (dollars saved, best-venue
deltas) is not currently persisted anywhere. What *is* a code fix: stop incrementing on the
`no_match` path (`api/tcg-price.js:313`) so the number means "searches that found a card".

**Rule conflict:** Rule 2 — any outcome figure ("$X saved") must be derived from stored real
results and labelled as derived, not modelled.

---

### Item 55 — Public roadmap that matches production

**Verdict:** GAP (with a NOT-CODE component)

**Evidence:** There is **no public roadmap page**. The routed static pages are `signin`,
`terms`, `privacy`, `about`, `contact`, `accuracy`, `pricing` (`vercel.json` routes block) —
no roadmap route, no roadmap file. The word "roadmap" appears in exactly two places in the
repo: one line of user-facing copy on the accuracy page — "The roadmap is a 100-card gold-set
audit (paired PSA slabs + our estimate) — when that ships, the results land on this page with
the raw comparison, not marketing copy" (`accuracy.html:194`) — and the internal
`audit/CARDRESELL_PLAN_AND_ROADMAP.md`, which is a repo document and not served (it is not in
the `vercel.json` builds list).

The reviewer's specific worry — a paused trust bundle versus marketed 15-venue certainty — is
partially answered by that accuracy line, which does say plainly that no validation set has
been published and refuses to claim "within N points of PSA" (`accuracy.html:194`). But there
is no single page where a user can see what is built, what is paused, and what is planned.

**If real, what it takes:** a new `roadmap.html` plus a `vercel.json` build entry and route
(same shape as the `accuracy.html` entries), and a footer/nav link. The content decision —
what to admit is paused — is the owner's, not code's.

**Rule conflict:** Rule 4 — in-progress items must read "under maintenance", never "beta".
Rule 3 — a roadmap that lists shipped items must match the code; if the trust bundle is
paused, the roadmap has to say so, since `accuracy.html:194` already does.

---

### Item 56 — Support SLA in writing (Pro Max "priority email" is undefined)

**Verdict:** PARTIAL — and there is an inconsistency worth fixing regardless of what SLA is chosen.

**Evidence:**
- "Priority email support" appears as a Pro Max bullet in three places with no definition
  attached: `pricing.html:244` (`<li>Priority email support</li>`),
  `pricing.html:329` (comparison table row: `—` / `—` / `✓`), and the in-app pricing modal
  (`index.html:3015`). Nothing anywhere states what "priority" buys — no hours, no ordering,
  no channel difference.
- A general response-time promise does exist, but only on the contact page, and it contradicts
  itself: `contact.html:63` says "We usually respond within 1–2 business days" while
  `contact.html:78` says "Reply time: usually within 24 hours on weekdays, sometimes faster."
  Those are two different commitments on one page.
- No SLA text exists on `pricing.html`, in the pricing modal, or in `terms.html`.

**If real, what it takes:** pick one number, state it once, and reference it from all four
locations (`pricing.html:244`, `pricing.html:329`, `index.html:3015`, `contact.html:63`/`:78`).
If "priority" cannot be honoured as a distinct tier, the honest move is to drop the word
rather than define it — a paid bullet the operation cannot deliver is a stamped lie.
Choosing the number is the owner's call (staffing), not a code question.

**Rule conflict:** Rule 3 — "Priority email support" as a paid Pro Max differentiator must
correspond to something the code or the operator actually does differently. Today nothing in
the repo routes Pro Max mail differently.

---

### Item 57 — Distinct brand vs cardresellai.com (a UFC marketplace collision)

**Verdict:** NOT-CODE

**The decision the owner actually has to make:** whether to rebrand, buy the confusable
domain, or ignore the collision — a trademark/marketing judgment. The codebase cannot settle
whether a name is confusable, and I cannot verify the third-party site's current content from
here without visiting it.

The only code-adjacent facts: the product name is fixed in `manifest.json`
(`"name": "CardResell"`), the wordmark at `index.html:1484+` and the header logo, and the
canonical domain in `sitemap.xml` / `robots.txt`. A rebrand would touch those plus every
static page's title and OG tags — mechanical, but only after the business decision.

**If real, what it takes:** n/a (business/legal).

**Rule conflict:** none.

---

### Item 58 — Status page for TCGplayer / PriceCharting / Ximilar / OpenAI outages

**Verdict:** GAP

**Evidence:** There is exactly one health surface and it is not a status page:
`api/health.js` returns `{ ok: true, service: 'cardresell', time }` unconditionally
(`api/health.js:6-10`) — it makes no provider call, so it returns `ok: true` while every
upstream is down. There is no `/status` route in `vercel.json`, no status HTML page, and no
uptime/incident copy anywhere in `index.html`, `about.html`, `contact.html`, or `accuracy.html`.

What *does* exist is per-request honesty at the point of failure rather than a dashboard:
the price caption names the rung that actually produced the number and how old it is
(`js/core.d9e1b484.js:1832-1850`, `2519-2543`), PriceCharting errors get a short-TTL error
cache and a retry (`api/pricecharting.js:903-910`, `:559`, `:577-578`), and a total price
failure degrades to a "View sold comps on eBay →" link (`js/core.d9e1b484.js:2694-2703`).

**If real, what it takes:** extend `api/health.js` into a real provider probe (cheap HEAD or
cached-ping per provider, with results cached in KV so the endpoint itself is not an attack
surface — see item 60), plus a `status.html` that renders it and a `vercel.json` build+route
entry. The probes must report what was actually measured; a green dot that means "we did not
check" is a stamped lie.

**Rule conflict:** Rule 3. Also note that a public status endpoint that fires live provider
calls on every request would be a free way to burn paid provider quota — it must be
KV-cached and, ideally, cron-refreshed.

---

### Item 59 — Second person who can refund a credit if the owner is offline

**Verdict:** NOT-CODE (with a hard code constraint the owner should know)

**The decision the owner actually has to make:** whether to bring in a second trusted operator.
That is a staffing and trust decision; no code change creates a second person.

**The code constraint:** even if the owner decides yes tomorrow, the admin path is hard-wired
to a single identity. `api/admin.js:13` declares `const OWNER_SUB = '111904685934190351595';`
and `requireOwner()` rejects any token whose uid is not exactly that value
(`api/admin.js:25-38`). The credit-restore action itself
(`POST { action: 'restore_scan_credit', target_uid, amount }`, `api/admin.js:5`, `:57-72`)
sits behind that single-owner gate. So delegation requires a one-line change from a constant
to an allow-list, plus a deploy — which is currently on hold (rule 7).

**Mitigation that already exists:** users are not fully dependent on an operator. Self-service
refunds run through `api/scan-refund.js`, rate-limited to 3 per rolling 24h per uid
(`api/scan-refund.js:17`, `:91-101`), and the failure message names the escalation address
directly: "If a scan really was wrong, message will@cardresell.org and we'll sort it out."
(`api/scan-refund.js:98`). Scan failures also auto-refund server-side
(`api/scan.js:956`, called at `:984, 991, 1033, 1184, 1595`). So the human-in-the-loop case is
the 4th refund in a day, or a dispute — a genuinely rare path.

**If real, what it takes:** n/a for the staffing decision. If the owner says yes: change
`OWNER_SUB` (`api/admin.js:13`) to a set and update `requireOwner` (`api/admin.js:29`).

**Rule conflict:** Rule 7 — any such change ships only on owner authorization.

---

### Item 60 — Rate limits / abuse controls on scan APIs

**Verdict:** PARTIAL — and this is the material risk in this group. The *paid* scan path is
well defended. The *unauthenticated, money-costing price path* has no rate limit at all.

**Evidence — what IS protected:**
- `/api/scan` requires a verified bearer token; identity comes only from the token, not the
  body. The comment records why: "flexible-auth accepted body-supplied email/googleSub, which
  let an unauthenticated attacker call this endpoint against a victim's uid and drain their
  ID/paid credits" (`api/scan.js:645-652`).
- Credits are an atomic per-user quota: `decrKV` on `scans:<uid>:id_paid_left` with a negative
  check that refunds and returns 402 (`api/scan.js:885-901`), the same for grade credits with
  `DECRBY` (`api/scan.js:908-945`), and entitlement checks run *before* any debit
  (`api/scan.js:836-843`). Photo/payload validation happens before the debit too, specifically
  so a truncated request cannot burn a credit (`api/scan.js:679-687`, `:705`).
- Free-tier abuse is gated by email verification, not just sign-in: unverified free users get
  0 credits (`api/scan.js:846-863`, `api/_tier.js:17-18`), and the verify flow layers
  Cloudflare Turnstile (`api/verify-claim-firebase.js:62-98`, fail-closed at `:96-98`), an IP
  throttle (`api/verify-claim-firebase.js:154-179`), and an attempt limit returning 429
  (`api/verify-confirm.js:86`). `api/scan.js:848` names the stack: "Google OAuth + Turnstile +
  IP throttle + one-time-per-email verify gate".
- Free retries are entitlement-checked against a real prior scan record and burn-once
  (`api/scan.js:813-830`), and refunds are capped at 3 per 24h (`api/scan-refund.js:91-101`).

**Distinguishing quota from abuse control:** all of the above is a *paid-credit quota* tied to
a verified identity. It bounds what a signed-in user can consume, and it is genuinely solid.
It is not a rate limit — a Pro Max user with 100 ID credits can spend all 100 in one second,
and there is no per-minute ceiling anywhere in `api/scan.js`.

**Evidence — what is UNPROTECTED:** every cost-bearing price endpoint is open, CORS-wildcarded,
and unmetered. None of these verify a caller token (checked by searching every `api/*.js` for
`req.headers['authorization']` / `verifyIdToken` / `_verifyToken`):
- `api/tcg-price.js:71-72` — `Access-Control-Allow-Origin: *`, no auth. Calls tcgcsv and then
  TCGplayer live search, then free game APIs. Mitigation: 30-minute KV cache
  (`api/tcg-price.js:13`, `:118-131`) — but only on cache *hits*; a query fuzzer varying
  `name`/`set`/`number` misses cache every time, since the cache key is the raw query
  (`api/tcg-price.js:118`).
- `api/pricecharting.js:439-444` — same wildcard CORS, no auth, and this one spends a **paid**
  PriceCharting API token (`api/pricecharting.js:465`). 6-hour cache (`:18`, `:518`), same
  cache-miss fuzzing exposure.
- `api/tpl-proxy.js:11-19` — an open proxy in front of a **paid** third-party key
  (`CARDSELL_TPL_KEY`). It has a path allow-list (`api/tpl-proxy.js:23-30`), which is good
  hygiene, but no auth, no cache, and no rate limit: anyone can loop
  `/api/tpl-proxy?path=/v1/cards/search&q=...` and burn the subscription.
- `api/ebay-sold.js:183-188` — no auth; fetches eBay search result pages directly with rotated
  browser user-agents (`api/ebay-sold.js:214-220`, comment: "eBay aggressively 403s datacenter
  IPs"). Abuse here does not cost cash directly; it costs the **shared production IP's
  standing with eBay**, which is worse.
- `api/sports.js`, `api/tcgp-resolve.js`, `api/grade-opportunity.js` — likewise no caller auth.
- `vercel.json` configures security headers but no WAF, no rate-limit rule, and no bot
  protection on any route.

The reviewer's phrasing — "so one bad day doesn't kill margin" — lands squarely on `tpl-proxy`
and `pricecharting`: those are metered spend behind an open door. The scan endpoints they named
are actually the best-defended part of the system.

**If real, what it takes:** a shared KV-backed IP+route counter (Upstash `INCR` with `EX`, the
exact pattern already written twice — `api/scan-refund.js:91-101` and
`api/verify-claim-firebase.js:154-179`) applied to `api/tcg-price.js`, `api/pricecharting.js`,
`api/tpl-proxy.js`, `api/ebay-sold.js`, `api/sports.js`, `api/tcgp-resolve.js`. Returning 429
with a plain message. Tightening `Access-Control-Allow-Origin` from `*` to the site origin on
those same files is a cheap second layer.

**Rule conflict:** Rule 1 — implement the limiter **once** as a shared helper (e.g. a new
`api/_rateLimit.js`) and import it, rather than pasting the counter into six handlers. There
are already two hand-rolled throttle implementations in the tree
(`api/scan-refund.js:91-101`, `api/verify-claim-firebase.js:154-179`); a third and fourth
copy would itself be the bug.

---

### Item 61 — Documented model providers so a provider policy change does not blank Grade

**Verdict:** PARTIAL — the redundancy exists in code and the providers are disclosed to users;
what is missing is a written contingency, not the capability.

**Evidence — providers are documented:**
- User-facing disclosure is explicit and links to both providers' policies:
  "Card images you upload are processed by Ximilar for card identification and by OpenAI and/or
  Ximilar for grading" (`privacy.html:63`), the detail paragraph (`privacy.html:72`), and a
  named service-provider list — "**Ximilar** — card identification, card matching, and
  computer-vision grading" / "**OpenAI** — AI grading analysis" (`privacy.html:92-93`).
- Endpoints and vendor docs are named in code comments: `api/_ximilar.js:8-11`
  (`/collectibles/v2/tcg_id`, `/collectibles/v2/sport_id`, docs link) and
  `api/_ximilar_grade.js:8-10` (`/card-grader/v2/grade`, docs link).
- Per-call unit costs per provider and path are tabulated in
  `finance/MONTHLY_EXPENSES_2026-08-19.md:28-32`, with an explicit risk note: "if a user burns
  through free ID scans and doesn't pay, we still eat the Ximilar cost" (`:114`).

**Evidence — model-change resilience already exists:**
- OpenAI model fallback is implemented: `let modelUsed = 'gpt-5'; let attempt = await tryModel('gpt-5');`
  falling through to `gpt-4o` on three named failure conditions (`api/scan.js:1554-1590`), with
  the stated intent "fall back to gpt-4o so identify never hard-fails on a model change"
  (`api/scan.js:1521-1524`).
- Cross-provider fallback exists in the ID path: Ximilar is primary and GPT vision is the
  fallback (`finance/MONTHLY_EXPENSES_2026-08-19.md:30`, "Ximilar handles most; GPT is
  fallback"; the GPT path in `api/scan.js:1244`, `1521-1590`), and Ximilar/GPT failures refund
  the credit and return an honest error rather than a fabricated result
  (`api/scan.js:1595-1599`: "Scanner temporarily unavailable. Credits refunded.").

**What is genuinely absent:** a single document that says, per provider, what we use it for,
what the fallback is, what breaks if it disappears, and who to contact. That knowledge is
currently spread across `privacy.html`, a finance markdown file, and inline comments in
`api/scan.js` / `api/_ximilar*.js`. Deep Grade's Ximilar CV path in particular has no
documented substitute — the expenses table lists a GPT "Deep Grade fallback (4-6 photos, if
Ximilar fails)" (`finance/MONTHLY_EXPENSES_2026-08-19.md:29`) but nothing states what happens
if Ximilar terminates the account rather than erroring.

**If real, what it takes:** one markdown file in the repo root (the tree already carries
`NEXT_UP_*.md` / `PLAN_*.md` docs in this style) listing provider → feature → fallback →
blast radius. No code change.

**Rule conflict:** none.

---

### Item 62 — Backup if the TCGplayer feed or eBay solds go dark

**Verdict:** PARTIAL — a real, layered fallback exists and it labels its source honestly.
Two specific weaknesses: a synthesized price range on the fallback rung, and an eBay path that
is structurally fragile.

**Evidence — the fallback ladder is real, and it is honest about which rung produced the number:**
- `/api/tcg-price` routes tcgcsv first, then TCGplayer live search "only when tcgcsv can't
  resolve the card" (`api/tcg-price.js:4-9`), then per-game free public APIs — Scryfall for
  MTG, lorcana-api for Lorcana, YGOProDeck for Yu-Gi-Oh — "so users get *some* price instead of
  an empty state" (`api/tcg-price.js:276-289`). Every response carries a `source` field naming
  the rung: `'tcgcsv'` (`:178, 210, 244, 316`), `'tcgplayer-live'` (`:414, 463, 481, 490`),
  `'scryfall'` (`:715`), `'lorcana-api'` (`:748`), `'ygoprodeck'` (`:785`).
- **It degrades honestly rather than silently substituting.** The UI caption reads the rung the
  ladder actually took rather than guessing by comparing values, and the code comment records
  the bug that forced this: "a price filled from PriceCharting still read 'TCGPlayer market'
  … The number moving is a data question; the caption naming a source that did not produce it
  is just untrue, so fix that" (`js/core.d9e1b484.js:2513-2523`). The caption renders source +
  link + retrieval age, and stamps "no price date" when the provider gives no as-of date
  (`js/core.d9e1b484.js:1832-1850`). When nothing resolves at all, the app shows a
  "View sold comps on eBay →" link instead of a number (`js/core.d9e1b484.js:2694-2703`).
  This directly answers the "silent substitution" concern: it does not silently substitute.
- PriceCharting has retry-on-429/5xx (`api/pricecharting.js:559`, `:577-578`), a 6h cache
  (`:18`), and a short-TTL error cache so a provider outage does not stampede (`:903-910`).
  eBay-sold has a KV cache with an explicit age reported to the client
  (`api/ebay-sold.js:200-205`) and returns a structured empty response with
  `confidence: 'insufficient'` and `confidenceReasons: ['no comps found']` rather than a
  fabricated median (`api/ebay-sold.js:211-217`).

**Evidence — the weaknesses:**
1. **A synthesized range on the free-API rung.** When the fallback provider returns no
   low/high, the handler invents them: `low: fb.low ?? (fb.market * 0.85)` and
   `high: fb.high ?? (fb.market * 1.15)` (`api/tcg-price.js:293-295`). Scryfall's price object
   has no low/high, so that branch fires for every MTG fallback lookup. The client then prints
   that band as fact — `· range <strong>$low–$high</strong>` (`js/core.d9e1b484.js:1859-1861`,
   `:1870`) — with no marker that ±15% was computed rather than observed. That is a displayed
   number nobody measured.
2. **Pokemon has no free-API rung.** The `categoryId !== 3` guard (`api/tcg-price.js:280`)
   excludes Pokemon from the Scryfall/lorcana/YGO fallbacks — reasonably, since no free Pokemon
   price API is wired in — so if tcgcsv *and* TCGplayer live both go dark, the largest game has
   no price source at all, only the PriceCharting path running in parallel client-side
   (`js/core.d9e1b484.js:2316-2357`).
3. **The eBay solds path is the fragile one.** `api/ebay-sold.js` fetches
   `ebay.com/sch/i.html?...LH_Sold=1` result pages and parses them, rotating three Chrome
   user-agents because "eBay aggressively 403s datacenter IPs with thin headers"
   (`api/ebay-sold.js:214-220`), with an 8s abort (`:209`). There is no eBay-API fallback behind
   it. "eBay solds go dark" is therefore not a hypothetical outage — it is a UA-block away, and
   the mitigation in place (UA rotation) is the kind of thing rule 5's "no DOM scraping" line
   exists to discourage. The graceful part is that failure yields `confidence: 'insufficient'`
   and a link out, not a made-up comp.

**If real, what it takes:** (a) either stop synthesizing low/high at
`api/tcg-price.js:293-295` and return nulls so the range simply does not render, or carry an
explicit `derivedRange: true` flag that the caption renders as derived; (b) decide whether the
eBay solds path moves to the official eBay Browse/Marketplace Insights API — a scope call, not
a patch; (c) document the Pokemon single-point-of-failure alongside item 61's provider doc.

**Rule conflict:** Rule 2 directly — the `market * 0.85` / `market * 1.15` band at
`api/tcg-price.js:293-295` is an unlabelled derived figure rendered as an observed range
(`js/core.d9e1b484.js:1859-1870`). Rule 5's "no DOM scraping" is in tension with the existing
`api/ebay-sold.js` implementation; any hardening there should move toward the official API
rather than better evasion.

---

## Group summary

**Counts per verdict (16 items):**

| Verdict | Count | Items |
|---|---|---|
| PARTIAL | 11 | 47, 48, 49, 50, 51, 52, 54, 56, 60, 61, 62 |
| GAP | 2 | 55, 58 |
| NOT-CODE | 3 | 53, 57, 59 |
| SHIPPED | 0 | — |
| GAP-BLOCKED / WRONG / UNVERIFIABLE | 0 | — |

Total 16. Item 60 sits under PARTIAL because real abuse controls exist on the scan/credit
path even though the price path has none. Items 56 and 59 are PARTIAL and NOT-CODE
respectively but both also contain an owner decision, flagged in their blocks.

**NOT-CODE decisions the owner has to make (no code answer exists):**
- **53 — testimonials.** Ask real users for attributable quotes with a dollar figure, or don't.
  Nothing exists today. Publishing is 20 lines of static markup once the quotes exist.
- **57 — brand collision with cardresellai.com.** Rebrand, buy the domain, or accept it.
  Trademark/marketing judgment; I cannot assess a third-party site's content from here.
- **59 — a second person who can refund.** Staffing and trust. Worth knowing: the admin
  refund action is hard-wired to one uid (`api/admin.js:13`, `:29`), so delegation needs a
  one-line allow-list change *and* a deploy, which is on hold (rule 7). Self-service refunds
  (3/24h, `api/scan-refund.js:91-101`) plus server-side auto-refunds
  (`api/scan.js:956`) mean the human-in-the-loop path is genuinely rare.
- **56 — what the SLA number is.** The code side is a copy fix; the commitment is the owner's.

**The 3 most worth doing first:**

1. **Item 60 — rate-limit the open, money-spending price endpoints.** `api/tpl-proxy.js` is an
   unauthenticated open proxy in front of a paid API key with no cache and no limit
   (`api/tpl-proxy.js:11-19`), and `api/pricecharting.js:439-444` spends a paid token with the
   same wildcard CORS and no auth. This is the only item in the group that can lose real money
   in a day, and the fix is a shared KV counter using a pattern already written twice in the
   repo (`api/scan-refund.js:91-101`).
2. **Item 62 — kill the synthesized ±15% price range.** `api/tcg-price.js:293-295` invents
   `low`/`high` from `market` whenever the fallback provider omits them, and
   `js/core.d9e1b484.js:1859-1870` prints it as an observed range. That is a rule-2 violation
   shipping today, on the exact fallback rung that fires when the primary feed is down — the
   worst possible moment to be showing a number nobody measured. Two-line fix.
3. **Item 49 — persist the theme choice and stop the light-app/dark-marketing split.** The
   toggle at `js/core.d9e1b484.js:8060-8078` never writes the user's choice anywhere, so the
   OS re-decides on every load, and five static pages ignore the system entirely
   (`pricing.html:43-45` uses a third palette). This is the cheapest visible credibility win
   in the group and it is what the reviewer actually saw.

Honourable mention: **item 51's paste handler** is perhaps a 15-line change routing
`clipboardData` files into the existing `processScanImage` entry point, and it removes a
complete dead end for desktop users.

**What the reviewer got materially wrong:**
- **Item 47** — ghosting is not missing. Blurred locked teaser rows with an upgrade CTA are
  already built (`js/core.d9e1b484.js:7339-7376`); they are just capped at 3
  (`:7344`). The ask is a bigger cap, not a new feature.
- **Item 51** — "camera permissions fail silently" is not accurate. Permission denial is
  caught (`js/ui.6b3a528e.js:688-692`), Rapid Scan toasts the user
  (`js/ui.6b3a528e.js:2020-2021`), and the Grade/Single-Scan paths deliberately fall through to
  the native camera picker so no hardware combination is left without a route
  (`js/core.d9e1b484.js:14218-14224`). The user is not told *why* the UI changed, which is a
  real but much smaller complaint. Paste-image, by contrast, is a clean hit — it does not exist.
- **Item 60** — the endpoints the reviewer named (scan/grade) are the *best*-defended part of
  the system: token-only identity (`api/scan.js:645-652`), atomic credit debits with
  pre-debit validation (`api/scan.js:679-687`, `885-945`), Turnstile + IP throttle + email
  verification gating free credits (`api/scan.js:846-863`,
  `api/verify-claim-firebase.js:62-179`). The exposure is one layer over, on the price endpoints.
- **Item 61** — providers are documented, in `privacy.html:92-93` and
  `finance/MONTHLY_EXPENSES_2026-08-19.md:28-32`, and a model-change fallback is already coded
  (`api/scan.js:1554-1590`). What's missing is a contingency runbook, not the capability.
- **Item 54** — the counter is not a vanity fabrication. It is KV-backed
  (`api/stats.js:60-77`), write-guarded (`:103-107`), and the UI refuses to render a fake zero
  (`js/core.d9e1b484.js:3248`, `3264-3275`). The valid criticisms are narrower: it counts
  zero-result lookups (`api/tcg-price.js:313`), it is floored at 200 (`api/stats.js:17-19`),
  and it can be inflated through the open price endpoint.

**What I could not check, and why:**
- Whether the live counter currently reads ~4,000, and whether that number is mostly organic or
  mostly the reviewer's own session bumps — that is live KV state
  (`stats:searches:total`), not readable from the repo, and METHOD.md forbids calling
  production.
- Whether add-to-home-screen actually succeeds on a given device. The manifest and prompt code
  are verifiable (`manifest.json`, `js/pwa.68032543.js`); Chrome's installability verdict is a
  runtime judgment, and without a service worker some browsers/versions will decline. Settling
  it needs a device or Lighthouse run against production.
- Whether `cardresellai.com` is in fact a UFC marketplace (item 57) — a third-party site I did
  not visit.
- Whether providers are up right now, or whether eBay is currently 403-ing the production IP
  (item 62). That needs live requests, which are out of scope here; the code path
  (`api/ebay-sold.js:214-220`) shows the risk regardless of today's outcome.
- Whether the pricing-page tiers rendered in production match `pricing.html` in the repo — the
  repo is the only artifact I read, and deployment is on hold (rule 7), so repo and production
  may differ.
