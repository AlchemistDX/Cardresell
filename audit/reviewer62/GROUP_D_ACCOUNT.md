# Group D — Flips / Collection / Money, Listing Handoff, Auth & Billing (Items 31–46)

Reviewer 62 verification. Read-only pass over `/home/user/workspace/cardresell`.
Live bundles per `index.html` `<script src>`: `js/auth.5cf1cd22.js`, `js/config.20ebe911.js`,
`js/core.d9e1b484.js`, `js/pwa.68032543.js`, `js/ui.6b3a528e.js`. The stale bundle
`js/core.569ff536.js` is never cited below.

---

### Item 31 — Cost basis = purchase + ship-in + fees + grade + supplies

**Verdict:** PARTIAL

**Evidence:**
- Flip cost basis is computed as `buyPrice + fees + shippingCost + gradingCost` in `_flipNetOf` — `js/core.d9e1b484.js:9867-9879`. Four of the five requested components are real and are used in the net math, not just stored.
- The flip modal collects exactly those fields: `mCardName`, `mSetName`, `mBuyPrice`, `mSellPrice`, `mCurrentValue`, `mFees`, `mShipCost`, `mGradingCost`, `mCertNumber` — `js/core.d9e1b484.js:8306-8307`, persisted at `js/core.d9e1b484.js:8411`.
- The mark-as-sold path re-collects the same four cost components — `js/core.d9e1b484.js:9959-9960`, `js/core.d9e1b484.js:10022-10034`.
- **Supplies has no field anywhere.** No sleeve/toploader/mailer/label input exists in the modal (`js/core.d9e1b484.js:8306-8307`) or in the saved entry shape.
- **Portfolio ("hold") entries are much weaker than flips:** the entry shape at `js/core.d9e1b484.js:8362-8384` stores `buyPrice` only — no fees, no ship-in, no grading cost. So an unsold card's "cost basis" is just the purchase price, and the Collection CSV's "Cost Basis" column (`js/core.d9e1b484.js:8891-8907`) inherits that understatement.

**If real, what it takes:** Add one `supplies` number field to the flip modal and to `_flipNetOf`'s sum (`js/core.d9e1b484.js:9867-9879`), and extend the portfolio entry shape at `js/core.d9e1b484.js:8362-8384` with the same fees/ship-in/grading/supplies fields so a held card and a flipped card use one basis definition. Keep it as one basis function — do not add a second cost-basis calculator for the portfolio (rule 1).

**Rule conflict:** none. Watch rule 1 during implementation: flips and collection must share one basis function.

---

### Item 32 — Realized vs unrealized P&L, by venue, by month

**Verdict:** PARTIAL

**Evidence:**
- Realized and unrealized both exist. `renderFlipsView` computes realized `totalProfit` and a separate `unrealized` total — `js/core.d9e1b484.js:10150-10173`. Collection-side unrealized stats are at `js/core.d9e1b484.js:9000-9014`.
- **By venue: not aggregated.** Platform appears only as a per-row column in the flips table — `js/core.d9e1b484.js:10257`. There is no group-by-venue subtotal anywhere in the flips renderer.
- **By month: exists for exactly one report, and it is not the flips report.** A `byMonth` grouping is implemented only in `renderGradingReport` — `js/core.d9e1b484.js:8601-8630`. Flips P&L is never bucketed by month.

**If real, what it takes:** Add two grouping passes over the existing flips array in `renderFlipsView` (`js/core.d9e1b484.js:10150-10173`) — one keyed on `platform`, one on the sale month — and render them as summary rows. The month bucketing logic already exists at `js/core.d9e1b484.js:8601-8630` and should be extracted and reused rather than rewritten (rule 1).

**Rule conflict:** none, provided the existing `byMonth` helper is reused rather than duplicated.

---

### Item 33 — Tax lot / CSV for a CPA

**Verdict:** PARTIAL

**Evidence:**
- Three CSV exporters ship: `exportFlips` — `js/core.d9e1b484.js:8775-8792` (columns: Date, Card, Set, Buy, Sell, Fees, Shipping, Grading, Net, Platform); `exportCollection` — `js/core.d9e1b484.js:8891-8907` (Card, Set, Cost Basis, Current Value, Unrealized P/L, P/L %); `exportGradingLog` — `js/core.d9e1b484.js:8794-8825`, Pro-gated at `js/core.d9e1b484.js:8795`.
- **What makes it not a tax-lot export:** the flips CSV carries one `Date` and no acquisition date, so holding period (short vs long term) cannot be derived. The collection CSV carries no add-date at all (`js/core.d9e1b484.js:8891-8907`). Neither export emits a stable lot identifier, so two copies of the same card cannot be told apart.

**If real, what it takes:** Persist an acquisition date on both the flip entry (`js/core.d9e1b484.js:8411`) and the portfolio entry (`js/core.d9e1b484.js:8362-8384`), then add `Acquired`, `Sold`, `Holding Days`, and the entry `id` as a lot key to the two exporters. That is a column addition to existing functions, not a new export path.

**Rule conflict:** none. Do not have the app compute or label a tax result (short/long-term treatment, taxable gain) — emit the dates and let the CPA classify, or it becomes an invented number (rule 2) and a stamped claim (rule 3).

---

### Item 34 — Collection qty, condition, location (binder / slab / consigned)

**Verdict:** PARTIAL

**Evidence:**
- The portfolio entry shape — `js/core.d9e1b484.js:8362-8384` — carries `grader`, `grade`, and `cert`. Slab vs raw is therefore distinguishable and *is* rendered as badges at `js/core.d9e1b484.js:9080-9091`. That covers the "slab" third of the location ask.
- **Quantity:** no qty field on the entry. The bulk-add path at `js/ui.6b3a528e.js:3731` expands a quantity into N separate rows rather than storing a count, so 12 of one card is 12 rows.
- **Condition:** the bulk path *does* write one — `condition: r.condition || 'NM'` at `js/ui.6b3a528e.js:3741` — but no renderer anywhere reads it. It is dead data: written, never displayed, never exported (`exportCollection`, `js/core.d9e1b484.js:8891-8907`, has no condition column). Manually added cards get no condition at all (`js/core.d9e1b484.js:8362-8384`).
- **Location (binder / consigned):** entirely absent from the repo. No field, no enum, no UI.

**If real, what it takes:** Three separate changes, ranked by cost: (a) surface the `condition` that is already being written — add it to the collection row renderer and to `exportCollection`; this is the cheapest real win in the whole group. (b) Add a `qty` integer to the entry shape and collapse the bulk expansion at `js/ui.6b3a528e.js:3731`. (c) Add a `location` enum (binder / slab / consigned / vault / listed) to `js/core.d9e1b484.js:8362-8384`.

**Rule conflict:** none.

---

### Item 35 — Sync that is not "hope localStorage survived this browser"

**Verdict:** PARTIAL — and this is the item in this group with a genuine, user-visible data-loss path.

**Evidence — where the data actually lives:**
- Read/write of both stores goes through localStorage: `loadFlipsData` / `saveFlipsData` — `js/core.d9e1b484.js:16556-16563`; `loadPortData` / `savePortData` — `js/core.d9e1b484.js:16564-16571`; both via `_lsWrite` — `js/core.d9e1b484.js:16447-16462`.
- Keys are namespaced by identity: `getUserKey` — `js/core.d9e1b484.js:16369-16371` — yields `cardsell_<sub>_portfolio` when signed in and bare `cardsell_portfolio` when anonymous.

**Evidence — the server mirror is explicitly best-effort, not authoritative:**
- Push is debounced 1.5s and returns early when there is no session: `_scheduleUserDataSync` — `js/core.d9e1b484.js:16589-16594` (early-returns on `!window.googleUser || !window._googleIdToken`); `_pushUserData` POSTs `/api/user-data` and swallows every error — `js/core.d9e1b484.js:16600-16621`.
- Pull happens once on sign-in and merges by union on id with tombstones, silently: `_pullUserData` — `js/core.d9e1b484.js:16632-16667`.
- The design intent is stated in the source itself: "All errors are silent — sync is best-effort, local always works" — `js/core.d9e1b484.js:16579-16586`.
- Server side is a real store with real limits: KV key `userdata:<googleSub>` — `api/user-data.js:54`; `MAX_BLOB_BYTES` 900,000 — `api/user-data.js:20`; `MAX_ITEMS` 2000 — `api/user-data.js:21`; tombstones 90d TTL / max 500 — `api/user-data.js:29-30`; last-write-wins on `clientUpdatedAt` — `api/user-data.js:93-103`; `413 payload_too_large` — `api/user-data.js:119-124`.
- Storage failures are surfaced to the user (not silently dropped) via `storageFailureMessage` — `js/core.d9e1b484.js:16466-16470` — and `_reportStorageFailure` — `js/core.d9e1b484.js:16473-16477`. Cross-tab consistency is handled by a `storage` event listener — `js/core.d9e1b484.js:16685-16704`. Anonymous data is migrated on first sign-in by `_migrateAnonDataToUser` — `js/core.d9e1b484.js:16375-16389`.
- `clearCollection` — `js/core.d9e1b484.js:8832-8889` — requires two confirmations, writes tombstones, and POSTs the empty state immediately without the debounce. That is correct behavior.

**Can a user lose data? Yes — plainly, in one specific case.**
- **Signed in:** covered. A browser-data clear or a second device is recovered by `_pullUserData` (`js/core.d9e1b484.js:16632-16667`) from `userdata:<googleSub>` (`api/user-data.js:54`).
- **Signed out / never signed in:** *not* covered. `_scheduleUserDataSync` early-returns with no session (`js/core.d9e1b484.js:16589-16594`), so an anonymous user's flips and collection exist in `cardsell_portfolio` / `cardsell_flips` and **nowhere else**. Clearing browser data, using private browsing, switching devices, or iOS evicting the origin's storage destroys the data with no recovery and no warning. This matters more because of Item 36: the sign-in wall on Collection was deliberately removed (`js/core.d9e1b484.js:8976-8988`), so the product actively invites anonymous users to enter data that has no backup.
- **Second lesser risk, signed in:** because push errors are swallowed (`js/core.d9e1b484.js:16600-16621`) and the last successful push is never displayed, a user whose sync has been failing — expired token, 413 at `api/user-data.js:119-124` — has no way to know. Last-write-wins (`api/user-data.js:93-103`) then means a stale device can overwrite a newer one.

**Also worth the owner's attention (rule 1):** `api/collection.js` is a **second, independent server-side collection store** — KV key `collection:<googleSub>`, its own `FREE_LIMIT` 25 / `PRO_LIMIT` 500, its own add/delete handlers (`api/collection.js:1-187`). Nothing in the live client calls it: no reference to `/api/collection` exists in `js/core.d9e1b484.js`, `js/ui.6b3a528e.js`, `js/auth.5cf1cd22.js`, or `index.html`. One business behavior (store the user's collection) currently has two server implementations, one of them orphaned and carrying different limits than the live path.

**If real, what it takes:** (a) Show sync state. A single line near the Collection/Flips header reading the timestamp of the last successful `_pushUserData` (`js/core.d9e1b484.js:16600-16621`) — "Backed up to your account · 2m ago" vs "Not backed up — sign in" — converts a silent risk into an informed one and costs almost nothing. (b) For anonymous users, replace the existing `anonSyncBanner` (`js/core.d9e1b484.js:8976-8988`) copy with an explicit warning that this data lives only in this browser. (c) Surface push failures through the existing `_reportStorageFailure` channel (`js/core.d9e1b484.js:16473-16477`) instead of swallowing them. (d) Separately: delete `api/collection.js` or wire it in — do not leave two stores.

**Rule conflict:** `api/collection.js` vs `api/user-data.js` is a rule 1 violation (one business behavior, two implementations). The sync-status line must show a real timestamp from a real successful push, never a reassuring placeholder — a "Synced ✓" that is not verified would be rule 3.

---

### Item 36 — Flip cap on free is fine; a logged-out collection looking empty is not a demo

**Verdict:** PARTIAL

**Evidence:**
- The reviewer's core complaint has already been addressed once: the hard sign-in wall on Collection was removed. `_updateCollectionSignInWall` — `js/core.d9e1b484.js:8976-8988` — now lets anonymous users render their Collection from the unscoped keys and shows an `anonSyncBanner` instead of blocking.
- The empty state is plain text, not a demo: "No cards in your collection yet" — `js/core.d9e1b484.js:9026`. No sample cards, no fake portfolio.
- The Flips view keeps a free-cap upsell empty state — `js/core.d9e1b484.js:10178-10190`.

**Why still PARTIAL:** an anonymous user with real cards sees them (good), but a *first-time* visitor sees a bare empty state with no illustration of what the view does. And per Item 35, the un-walled anonymous collection is exactly the data with no server backup, so the two changes interact badly.

**If real, what it takes:** Keep the wall removed. Improve `js/core.d9e1b484.js:9026` into a real empty state that explains the value and offers "Add your first card" — and, if any sample data is ever shown, it must be unmistakably labeled as an example.

**Rule conflict:** rule 3 — sample/demo rows must be visibly labeled as samples; never let a demo card look like the user's own inventory.

---

### Item 37 — One-click copy: title, condition notes, suggested list, fee warning

**Verdict:** GAP

**Evidence:**
- The reviewer is right, and the gap is specifically a *surfacing* gap, not a data gap.
- **The data exists, server-side.** `api/_listingPacket.js` assembles the packet: identity (`api/_cardIdentity.js`), a listing title (`api/_listingTitle.js`), condition descriptors (`api/_conditionDescriptors.js`), category/aspects (`api/_ebayTaxonomy.js`), and pricing.
- **The client can create a draft but cannot read one back.** Draft creation POSTs to `/api/drafts` at `js/core.d9e1b484.js:18363-18414`. The source comment at `js/core.d9e1b484.js:18392-18395` states the position outright: "The draft list view is D2. Until it exists, the id is what the seller has." The only client-side artifact is `window._crLastDraftId`.
- **No copy affordance for listing content exists.** Every clipboard call in the live bundle is for something else: share-ranking URL — `js/core.d9e1b484.js:10817-10833`; referral link — `js/core.d9e1b484.js:10846`; grade-share URL — `js/core.d9e1b484.js:15119-15189`. Nothing copies a title, a condition note, a suggested list price, or a fee warning.

So: the data exists; the user cannot copy it. Today a seller who generates a draft receives an opaque id and must retype the title and condition into eBay by hand.

**If real, what it takes:** This is the highest value-per-line item in the group. It does not require the full D2 draft list view. A GET on `/api/drafts` by id, rendered into a small panel with three copy buttons (title / condition notes / suggested price) reusing the clipboard helper already at `js/core.d9e1b484.js:10817-10833`, closes it. The fee warning is already computed for the payout ranking and can be pulled from there rather than recomputed (rule 1).

**Rule conflict:** none. Copy-to-clipboard is not automation and is not a publish button — it stays inside the Phase 3 restriction, because the human still pastes and still presses list.

---

### Item 38 — Deep links that prefill eBay / TCGplayer where the APIs allow

**Verdict:** PARTIAL

**Evidence:**
- **A genuine prefilled sell-flow deep link already ships**, and it is a plain URL, not automation: `https://www.ebay.com/sell/listing?flow=startSell&presetNameSearchQuery=${ebayQ}` — built at `js/core.d9e1b484.js:12823-12825` and rendered as a "List on eBay →" anchor at `js/core.d9e1b484.js:12862`.
- **But it is reachable from exactly one place: the scan-miss path.** That anchor lives inside `_renderScanMissPanel`, which begins at `js/core.d9e1b484.js:12801`. A user only sees it when the scanner failed to identify their card.
- **Every normal path gets search-only links, not prefill.** Collection rows link to eBay *sold comps* search via `_entryEbayUrl` — `js/core.d9e1b484.js:9041-9048`. TCGplayer links are plain search URLs — `js/core.d9e1b484.js:5055`, `js/core.d9e1b484.js:8754`, `js/core.d9e1b484.js:9469`, `js/core.d9e1b484.js:12828`.

The reviewer is directionally right: on the happy path — scan succeeded, card identified, payout ranked — there is no prefill, only search.

**If real, what it takes:** Reuse the URL builder already at `js/core.d9e1b484.js:12823-12825` on the successful-scan result panel and on Collection rows. One shared builder, not a second one (rule 1). TCGplayer has no documented public prefill parameter comparable to eBay's `presetNameSearchQuery`, so TCGplayer should stay a search link until a documented parameter is confirmed — guessing at query parameters is the same failure mode as guessing descriptor value ids.

**Rule conflict:** none, and the distinction matters: a prefilled URL that opens the venue's own form in the user's browser is not headless automation and not DOM scraping. Do not read the do-not-do list as blocking this. Do not, however, ship guessed eBay aspect/descriptor value ids inside such a URL — that is explicitly forbidden.

---

### Item 39 — "List here" checklist per venue (photos required, ship-in, payout days)

**Verdict:** PARTIAL

**Evidence:**
- A per-venue rules block already ships. The `PLATFORMS` table (from `js/core.d9e1b484.js:5590`) carries `workflow`, `payoutTime`, `redFlags`, and `bestFor`, documented at `js/core.d9e1b484.js:5575-5589`.
- It renders as a "Rules of Sale" section on each venue tile: `workflowLabelMap` — `js/core.d9e1b484.js:7596-7602`; `payoutText` — `js/core.d9e1b484.js:7604`; `bestFor` — `js/core.d9e1b484.js:7607`; `redFlags` — `js/core.d9e1b484.js:7608-7613`; injected into the tile at `js/core.d9e1b484.js:7661-7663`. Section headers at `js/core.d9e1b484.js:7472-7487`.
- So two of the reviewer's three named fields exist: ship-in is covered by `workflow` (`js/core.d9e1b484.js:7596-7602`) and payout days by `payoutTime` (`js/core.d9e1b484.js:7604`).
- **"Photos required" does not exist anywhere.** No photo-requirement field is present on any `PLATFORMS` entry or anywhere in the repo.

**If real, what it takes:** Add one `photosRequired` field per venue to the existing `PLATFORMS` entries (from `js/core.d9e1b484.js:5590`) and render it in the same "Rules of Sale" block at `js/core.d9e1b484.js:7661-7663`. No new component needed.

**Rule conflict:** rule 2 and rule 3. Each venue's photo requirement must be copied from that venue's published seller policy and be checkable; do not infer "probably 2 photos" from what a competitor does.

---

### Item 40 — Days-to-cash next to net payout

**Verdict:** SHIPPED — the reviewer is asking for something that is already on screen.

**Evidence:**
- `DAYS_TO_CASH` map — `js/core.d9e1b484.js:6982-6988`; formatter `daysToCashText` — `js/core.d9e1b484.js:6989-6992`; attached to each ranked result at `js/core.d9e1b484.js:7248`; rendered at `js/core.d9e1b484.js:7680` as "Payout time after it sells", positioned directly beneath the "Net after all deductions" row at `js/core.d9e1b484.js:7679`. That is literally days-to-cash next to net payout.
- The rule-2 discipline here is deliberate and worth preserving. `SELL_SPEED` — `js/core.d9e1b484.js:6948-6979` — is **categorical**, not numeric (instant / fast / cadence / narrow / blocked), each with a sourced `why` string. The comment at `js/core.d9e1b484.js:6926-6947` states that inventing per-venue day counts "would be stamping a lie." `index.html:2136` documents the same: "Deliberately absent: any 'sells in N days' or sell-through claim."
- `/home/user/workspace/audit/SELL_VELOCITY_RESEARCH.md` (dated Sep 2, 2026) confirms no venue publishes days-to-sell data. **Important scope note:** that research covers *listing-to-sale* time. `DAYS_TO_CASH` is a different quantity — *post-sale settlement* time, which venues do publish (e.g. the Card Kingdom settlement detail at line 225 of that file). So `DAYS_TO_CASH` is not sourced by, and is not contradicted by, the sell-velocity research.

**If real, what it takes:** n/a. The only thing to do is not to "fix" this. If a future reviewer pushes for a numeric "sells in N days," refuse it — that is the rule-2 violation the current design was built to avoid.

**Rule conflict:** none. Current implementation is the rule-2-compliant answer. Any change that converts the categorical `SELL_SPEED` into invented day counts would violate rule 2 and rule 3.

---

### Item 41 — Sign-in besides Google (email magic link, Apple, passkeys)

**Verdict:** PARTIAL — and the reviewer's premise is materially wrong.

**Evidence — a second sign-in method already ships:**
- Email + password sign-in and sign-up are live at `/signin`. Tabs — `signin.html:275-276`; Google button ~`signin.html:285`; an "or sign in with email" divider; email input `siEmail`; password input `siPass` — `signin.html:300`; show/hide toggle — `signin.html:301`; "Forgot password?" — `signin.html:304`; sign-up fields `suPass` — `signin.html:331` — and `suPass2` — `signin.html:337`; verify-email view — `signin.html:344`; reset view — `signin.html:360`; error map — `signin.html:731-734`.
- Wiring: `js/auth.5cf1cd22.js:5-6` imports `createUserWithEmailAndPassword` and `signInWithEmailAndPassword`, used at `js/auth.5cf1cd22.js:81`; called from `signin.html:381-382` and `signin.html:440`.

**Evidence — none of the three methods the reviewer named exist:**
- **Apple:** referenced only in verification logic — `js/auth.5cf1cd22.js:198-202` and `js/auth.5cf1cd22.js:264` check `providerIds.includes('apple.com')` to auto-verify. There is **no Apple sign-in button** anywhere.
- **Magic link:** absent.
- **Passkeys:** absent.

**Two things the owner needs to know:**
1. **Rule 5's "no password collection" is already violated by shipped code**, not by a proposed change. `signin.html:300`, `signin.html:331`, and `signin.html:337` collect passwords today, and `js/auth.5cf1cd22.js:81` transmits them. Whatever the rule was meant to prevent, it did not prevent this. The owner should decide deliberately whether to keep the password path or retire it — but the decision has already been made once, in production, by default.
2. **Rule 5 does not block Item 41.** Magic link, Apple, and passkeys collect no passwords. They are all permitted. The rule blocks adding *another* password form; it does not block passwordless alternatives.
3. **Related rule-3 exposure:** the marketing CTA at `index.html:2445` reads "Sign in with Google — it's free" and the in-app button at `js/core.d9e1b484.js:10904` reads "Sign in with Google," while email sign-in actually works. Users who do not want a Google account are being told, incorrectly, that Google is the only door.

**If real, what it takes:** Fix the copy first — it costs one line and is a truth defect, not a feature. Change `index.html:2445` and `js/core.d9e1b484.js:10904` to "Sign in" with Google shown as one option. Then, if a passwordless method is wanted, Firebase `sendSignInLinkToEmail` (magic link) is the lowest-friction addition given `js/auth.5cf1cd22.js` is already the Firebase auth surface; Apple sign-in requires an Apple developer program enrollment; passkeys are the largest lift.

**Rule conflict:** rule 5 is **already breached by existing shipped code** (`signin.html:300`, `signin.html:331`, `signin.html:337`) — flagged for an explicit owner decision. Rule 5 does **not** conflict with adding magic link, Apple, or passkeys. Rule 3 applies to the "Sign in with Google" CTA copy.

---

### Item 42 — Credit balance always visible without "Sign in to check"

**Verdict:** PARTIAL

**Evidence:**
- The reviewer's exact phrase is a literal string in the codebase, four times: `settingsScanSub` — `index.html:1558`; `idScanSub` — `index.html:1564`; `shopIdSub` — `index.html:3056`; `shopGradeSub` — `index.html:3061`. All four default to "Sign in to check."
- It is written by two functions on the signed-out branch: `loadSettingsScanCredits` — `js/core.d9e1b484.js:102-108` — and `shopRefreshBalances` — `js/core.d9e1b484.js:17285-17290`.
- **For signed-in users the balance is real and correct.** `shopRefreshBalances` computes purchased + free remaining and paints actual counts — `js/core.d9e1b484.js:17292-17298`. Settings paints the server count with a red treatment at zero — `js/core.d9e1b484.js:127-139`. State is held at `js/core.d9e1b484.js:16729-16737` (`_isPro`, `_freeScansLeft`, `_scanCredits`, `_idScanCredits`, `_freeIdLeft`) and refreshed by `checkProStatus()` from `js/core.d9e1b484.js:16740` via `/api/pro-status`, with 401 handling at `js/core.d9e1b484.js:16749-16758`.

**What the reviewer gets right and wrong:** wrong that the balance is unavailable — signed-in users see it in Settings and in the Shop. Right that it is not *always visible*: it appears only inside two panels the user must open, never persistently in the header, and it is genuinely unavailable signed out. The signed-out case is unavoidable — credits are account-scoped, so there is no balance to show before identity exists — but "Sign in to check" is a weak way to say so.

**If real, what it takes:** Two changes. (a) Put the credit count in the persistent header next to the tier badge for signed-in users, reading the state already at `js/core.d9e1b484.js:16729-16737` — no new fetch. (b) Replace the signed-out string at `index.html:1558`, `index.html:1564`, `index.html:3056`, `index.html:3061` with something that states the free grant, e.g. "Free plan includes 5 ID scans/mo — sign in to see yours," which answers the user's real question instead of deflecting it.

**Rule conflict:** rule 2 — the header count must read live state, never an optimistic cached number. Any signed-out copy quoting the free grant must match the authoritative grant table in `api/_tier.js:15-23`, or it becomes a fifth place where the free tier's numbers are hand-maintained (see Item 44).

---

### Item 43 — In-app cancel / portal, not "email will@"

**Verdict:** SHIPPED

**Evidence:**
- A real Stripe billing portal endpoint ships: `api/stripe-portal.js` — POST, auth required, 401 without a token, identity derived from the verified token only (the source is explicit that email/uid come from the token and "NEVER from the body"), customer resolved by Stripe email search then by `subscriptions/search metadata['google_sub']`, returns `{url}`.
- Client implementation: `openBillingPortal()` — `js/core.d9e1b484.js:17464-17497`. It waits for auth, force-refreshes the Firebase ID token before the call (`js/core.d9e1b484.js:17474-17479`), POSTs to `/api/stripe-portal` (`js/core.d9e1b484.js:17481-17485`), and redirects to the returned URL (`js/core.d9e1b484.js:17487-17488`), with toasts on both the error and network paths (`js/core.d9e1b484.js:17490`, `js/core.d9e1b484.js:17494`).
- **Two reachable entry points, both correctly gated to paying users:** the Settings panel button labeled "Manage billing — Cancel or update payment (Stripe)" — `index.html:1569-1575`, un-hidden for Pro at `js/core.d9e1b484.js:16868`; and the Shop button `#shopBillingBtn` "Manage billing · cancel or update payment" — `index.html:3124`, un-hidden at `js/core.d9e1b484.js:17280` when signed in and Pro.
- The pricing copy matches reality: "Cancel anytime in Account → Manage billing" — `index.html:3277` — and "Cancel anytime" — `index.html:2952`.
- **No "email will@" for cancellation exists.** The only `mailto:will@cardresell.org` in the app-facing pages is `privacy.html:99`, and it concerns *account deletion*, not cancellation — see Item 45.

**If real, what it takes:** n/a.

**Rule conflict:** none.

---

### Item 44 — One pricing source of truth (live tiers vs a leftover "Ultimate" spec in the repo)

**Verdict:** PARTIAL — the reviewer is right that a stale Ultimate spec exists, but wrong about which duplication actually hurts. Separating the two is the point of this item.

**Evidence — the stale Ultimate spec: real, but cosmetic and not user-reachable.**
- The spec lives at `NEXT_UP_TIER_EXPANSION.md` — a full four-tier plan including Ultimate pricing ($39.99/mo, $359.99/yr — `NEXT_UP_TIER_EXPANSION.md:62-63`), Stripe product and price ids (`NEXT_UP_TIER_EXPANSION.md:57`, `:62-63`), grants (`NEXT_UP_TIER_EXPANSION.md:165`), and an Ultimate-only Bulk Grade feature (`NEXT_UP_TIER_EXPANSION.md:125-150`).
- **It is not deployed.** `vercel.json` uses an explicit `builds` whitelist naming each static file; no `.md` file appears in it, and the catch-all route rewrites unknown paths to `/index.html`. `NEXT_UP_TIER_EXPANSION.md` is not fetchable by a user.
- **No live code path can sell or display Ultimate.** Checkout hard-refuses it: `api/stripe-subscription-checkout.js:62-66` returns `plan_retired` with "Ultimate was retired. Choose Pro or Pro Max." A stale `?upgrade=ultimate` deep link is remapped to Pro Max with an honest disclosure toast: `js/config.20ebe911.js:71-78`. Neither pricing surface offers it — `pricing.html:185-250` and `index.html:2955-3020` show Free / Pro / Pro Max only. Regression tests pin this shut: `tests/copy-truth-offline.mjs:402-412` and `tests/launch-audit-regressions.mjs:81-83`.
- Residue that remains but cannot surface: orphaned CSS (`index.html:1042-1043`, `index.html:1106-1107`, `index.html:1110-1111`), stale comments (`index.html:1799`, `index.html:3951`), and dormant server tier entries — `api/_tier.js:37-42`, `api/_tier.js:56-57`, `api/pro-status.js:8-9`, `api/pro-status.js:111-112`, `api/scan.js:838`, `api/scan.js:866-867`, `api/stripe-grade-checkout.js:69`, `js/ui.6b3a528e.js:1005-1007`. These activate only if `STRIPE_PRICE_ULTIMATE_MONTHLY` / `_ANNUAL` are ever populated (`api/_tier.js:56-57`). No env values were read or printed.

**Verdict on the Ultimate half: cosmetic.** The remedy is not to revive or rebuild Ultimate — it is on the do-not-touch list. If anything is done, it is to move `NEXT_UP_TIER_EXPANSION.md` under an `archive/` path with a "RETIRED — do not implement" header so no future contributor reads it as a to-do.

**Evidence — the duplication that is actually a defect: prices are hand-maintained in four-plus places.**
- Tier tables are fully duplicated between `index.html:2955-3020` and `pricing.html:185-250`, and they have **already drifted**: the annual note reads "save about 25%" at `index.html:2984` and `index.html:3007` but "3 months free" at `pricing.html:210` and `pricing.html:234`; Free lists "2 marketplaces" at `index.html:2968` vs "2 venues" at `pricing.html:194`; Pro carries an extra bullet ("Skip one bad PSA sub → saves a year") at `index.html:2992` that `pricing.html` does not have.
- Credit-pack prices are duplicated **three times inside `index.html` alone** — Settings at `index.html:1581-1611`, the scan gate at `index.html:2660-2675`, the Shop at `index.html:3092-3115` — plus again on `pricing.html`.
- The repo already knows this is fragile. The comment at `pricing.html:256-259` documents a prior incident where the catalog advertised three packs that could not be bought (25 IDs/$4.99, 100 IDs/$14.99, 40 grades/$19.99) and instructs: "Do not edit one without the others." A comment instructing humans to keep four copies in sync *is* the defect rule 1 exists to prevent.
- Meanwhile the authoritative grant numbers live server-side in `api/_tier.js:14-42` and `api/pro-status.js:8-9`, and every marketing bullet restates them by hand.

**If real, what it takes:** Define the tier and pack catalog once — name, price, interval, grants, discount, Stripe price-id key — and render both `index.html` and `pricing.html` from it, with the server reading the same grant numbers now in `api/_tier.js:14-42`. Separately, archive `NEXT_UP_TIER_EXPANSION.md`. Do **not** rebuild Ultimate.

**Rule conflict:** rule 1 — one business behavior (what a plan costs and includes) currently has four-plus hand-maintained implementations, and they have already drifted. Rule 6 — "Ultimate" is retired and the spec must be archived, never revived. Rule 2/3 — the drifted annual copy means at least one of the two pricing pages is telling users something the other contradicts; reconcile before launch.

---

### Item 45 — Account delete button, not only a Privacy paragraph

**Verdict:** GAP — the reviewer described the situation exactly.

**Evidence:**
- The only deletion path in the product is prose with a mailto: `privacy.html:99` — "You may request deletion of your account and associated data at any time by emailing will@cardresell.org. We will process deletion requests within 30 days."
- **No delete affordance exists in the app.** The Settings panel (`index.html:1550-1615`) contains credit balances, Manage billing, and credit-pack buy buttons — no delete control.
- **No server endpoint exists.** No file in `api/` matches delete / purge / account / gdpr. The only account-deletion code in the repo is `api/ebay-notifications.js:1`, `api/ebay-notifications.js:45` — which handles eBay's *marketplace account deletion notifications* about eBay users, unrelated to deleting a CardResell account.
- The nearest existing capability is `clearCollection` — `js/core.d9e1b484.js:8832-8889` — which wipes collection data (two confirmations, tombstones, immediate empty POST) but does not delete the account, the Stripe customer, or the `userdata:<googleSub>` blob at `api/user-data.js:54`.

**If real, what it takes:** A `DELETE /api/account` endpoint that verifies the Firebase ID token (the pattern is already established in `api/stripe-portal.js` — identity from the verified token only), then deletes the KV records `userdata:<googleSub>` (`api/user-data.js:54`) and `pro:<googleSub>` (`api/_tier.js:3-4`), cancels any live Stripe subscription, deletes the Firebase user, and clears local storage via the existing wipe path at `js/core.d9e1b484.js:8832-8889`. Plus a confirm-typed dialog in Settings. Then update `privacy.html:99` to point at the button.

**Rule conflict:** none — but note this is table stakes for both the Google Play/App Store account-deletion requirement and GDPR/CCPA erasure, and `privacy.html:99` currently commits the owner to a 30-day manual SLA that only one person can service.

---

### Item 46 — Failed-scan refund history the user can see

**Verdict:** GAP

**Evidence:**
- **The refund mechanism itself is solid.** `api/scan-refund.js` implements a one-tap refund: auth from a verified token only (`api/scan-refund.js:30-49`), short-TTL opaque `scan_id` so yesterday's scans cannot be refunded (`api/scan-refund.js:14`), idempotent (`api/scan-refund.js:80-81`), rate-limited to 3 per rolling 24h per uid (`api/scan-refund.js:17`, `api/scan-refund.js:94`), and every refund written to an audit record (`api/scan-refund.js:18`, `api/scan-refund.js:144`, key `scan_refund:{scan_id}`, 30-day TTL).
- The client surfaces it per-scan: the "Not my card — refund credit" button — `js/core.d9e1b484.js:13976`, wired at `js/core.d9e1b484.js:13980-13982`, handler `_requestScanRefund` at `js/core.d9e1b484.js:11656-11705`, which restores the credit locally (`js/core.d9e1b484.js:11692`) and confirms with "✓ Credit refunded" (`js/core.d9e1b484.js:11695`, `js/core.d9e1b484.js:11702`). The automatic path shows "Your ID credit was refunded automatically" — `js/core.d9e1b484.js:13657`.
- **But the confirmation is transient and per-scan. There is no history.** The audit records at `scan_refund:{scan_id}` (`api/scan-refund.js:144`) are write-only from the user's perspective: no endpoint lists them. `api/scan-credits.js` contains no reference to refunds — it returns a balance, not a ledger. `scan_refund` is emitted as an analytics event (`api/events.js:29`) which the user cannot see either.
- Consequence: after the overlay closes, a user cannot confirm the refund landed, cannot reconcile a balance they think is wrong, and cannot see how many of their 3 daily refunds remain — even though `api/scan-refund.js:20` already returns `remaining_refunds_today` in the response and the client discards it.

**If real, what it takes:** Two steps, the first nearly free. (a) Display the `remaining_refunds_today` value already returned by `api/scan-refund.js:20` in the confirmation at `js/core.d9e1b484.js:11695`, so the rate limit stops being a silent surprise. (b) Add a `GET /api/scan-credits?history=1` (or a small dedicated endpoint) that lists the last 30 days of `scan_refund:*` audit records for the caller's uid, rendered as a simple ledger in the Settings credits panel (`index.html:1543-1566`).

**Rule conflict:** none. Note the refund promise is advertised prominently — `index.html:1734` ("Credit refunds instantly — automatic or one-tap") and `index.html:2952` ("failed scans refund automatically") — so under rule 3 the user should be able to verify the promise was kept, not just be told it was.

---

## Group summary

**Counts per verdict (16 items):**

| Verdict | Count | Items |
|---|---|---|
| SHIPPED | 2 | 40, 43 |
| PARTIAL | 11 | 31, 32, 33, 34, 35, 36, 38, 39, 41, 42, 44 |
| GAP | 3 | 37, 45, 46 |
| GAP-BLOCKED | 0 | — |
| NOT-CODE | 0 | — |
| WRONG | 0 | — (but see items 40, 41, 43 below: three reviewer premises are factually wrong even though the items themselves land as SHIPPED/PARTIAL) |
| UNVERIFIABLE | 0 | — |

**The 3 items most worth doing first:**

1. **Item 35 — anonymous data has no backup, and nothing tells the user.** This is the only item in the group where a user can permanently lose work they entered. Anonymous flips and collection live solely in localStorage (`js/core.d9e1b484.js:16589-16594` early-returns without a session), and the Collection sign-in wall was deliberately removed (`js/core.d9e1b484.js:8976-8988`), so the product invites exactly the data it cannot protect. A sync-status line plus honest anonymous-user copy is a small change against a permanent, unrecoverable failure.
2. **Item 37 — the listing packet exists server-side but no user can copy it.** `api/_listingPacket.js` already builds title, condition, and pricing; the client creates drafts at `js/core.d9e1b484.js:18363-18414` and then hands the seller an opaque id (`js/core.d9e1b484.js:18392-18395`). One read endpoint plus three copy buttons — reusing the clipboard helper at `js/core.d9e1b484.js:10817-10833` — converts already-built work into the thing sellers actually do all day. Highest value per line in the group.
3. **Item 44 — reconcile the pricing tables before launch, and archive the Ultimate spec.** Prices are hand-maintained in four-plus places and have already drifted (`index.html:2984` "save about 25%" vs `pricing.html:210` "3 months free"), with a comment at `pricing.html:256-259` documenting a prior incident where the site advertised unbuyable packs. This is a live rule-1 violation that has already produced a user-facing contradiction, and it is cheap to fix before more surfaces are added.

Honorable mention: **Item 45** (no account-delete button, only `privacy.html:99`) is a hard requirement for app-store distribution and GDPR/CCPA, and the current 30-day manual mailto SLA scales to exactly one person.

**What the reviewer got materially wrong:**

- **Item 41 is the big one. "Sign-in besides Google" already ships.** Email + password sign-in, sign-up, verification, and password reset are all live at `/signin` (`signin.html:275-276`, `signin.html:300`, `signin.html:304`, `signin.html:331-337`, `signin.html:344`, `signin.html:360`) and wired through `js/auth.5cf1cd22.js:5-6`, `js/auth.5cf1cd22.js:81`. The reviewer's specific three (magic link, Apple, passkeys) genuinely do not exist, so the item is not baseless — but the framing is wrong. Two consequences the owner must not miss: (i) **rule 5's "no password collection" is already violated by shipped production code**, not by anything proposed here — that needs a deliberate decision, because it was made by default; (ii) **rule 5 does not block Item 41** — magic link, Apple, and passkeys collect no passwords and are all permitted. Do not read the do-not-do list as closing this item. Separately, the CTAs at `index.html:2445` and `js/core.d9e1b484.js:10904` still say "Sign in with Google," which is now a rule-3 truth defect since email sign-in works.
- **Item 40 is already shipped and should not be "fixed."** Days-to-cash renders directly beneath net payout (`js/core.d9e1b484.js:7679-7680`). More importantly, the *absence* the reviewer may next complain about — no "sells in N days" number — is a deliberate rule-2 decision documented in the source (`js/core.d9e1b484.js:6926-6947`) and in `index.html:2136`, and confirmed by `/home/user/workspace/audit/SELL_VELOCITY_RESEARCH.md`: no venue publishes the data. Adding a number here would be a regression, not an improvement.
- **Item 43's "not 'email will@'" premise is wrong.** A full Stripe billing portal ships (`api/stripe-portal.js`, `js/core.d9e1b484.js:17464-17497`) with two gated entry points (`index.html:1569-1575` shown at `js/core.d9e1b484.js:16868`; `index.html:3124` shown at `js/core.d9e1b484.js:17280`). The only `mailto:will@` in the product is for *account deletion* (`privacy.html:99`) — which is item 45's problem, not item 43's.
- **Item 44's Ultimate concern is real but misdirected.** A stale Ultimate spec does exist (`NEXT_UP_TIER_EXPANSION.md`), so the reviewer is right that it is there. But it is **not deployed** (`vercel.json` uses an explicit static whitelist with no `.md` entries) and **no live path can surface it**: checkout rejects it (`api/stripe-subscription-checkout.js:62-66`), deep links remap honestly (`js/config.20ebe911.js:71-78`), and regression tests pin it shut (`tests/copy-truth-offline.mjs:402-412`). That half is cosmetic. The real two-sources-of-truth defect is the duplicated live pricing described above — and the remedy for the Ultimate half is to archive the spec, never to revive it (rule 6).
- **Item 38 conflates two different things in the codebase's favor.** A genuine prefilled eBay sell-flow deep link already exists (`js/core.d9e1b484.js:12823-12825`, rendered at `js/core.d9e1b484.js:12862`) — it is just buried in the scan-*miss* panel (`js/core.d9e1b484.js:12801`) rather than the success path. And to be explicit for the owner: a prefilled URL is not headless automation and not DOM scraping, so the do-not-do list does not block extending it.
- **Item 42's premise overstates the problem.** "Sign in to check" is real (`index.html:1558`, `index.html:1564`, `index.html:3056`, `index.html:3061`), but only signed out — where no account-scoped balance can exist. Signed-in users do see real counts (`js/core.d9e1b484.js:17292-17298`, `js/core.d9e1b484.js:127-139`). The fixable part is that the balance is not *persistent*, and that the signed-out copy deflects instead of stating the free grant.

**Bonus finding the reviewer did not raise (rule 1):** `api/collection.js` is a complete second server-side collection store — KV key `collection:<googleSub>`, its own `FREE_LIMIT` 25 / `PRO_LIMIT` 500, its own add/delete — that the live client never calls (no `/api/collection` reference in `js/core.d9e1b484.js`, `js/ui.6b3a528e.js`, `js/auth.5cf1cd22.js`, or `index.html`). The live path is `api/user-data.js`. Two implementations of one behavior, with different limits, one of them orphaned. Delete it or wire it — leaving it invites a future contributor to use the wrong one.

**What could not be checked, and why:**

- **Environment variable values.** Whether `STRIPE_PRICE_ULTIMATE_MONTHLY` / `_ANNUAL` are actually set — which is what determines whether the dormant Ultimate tier entries at `api/_tier.js:56-57` and `api/pro-status.js:111-112` can activate — cannot be determined from the repo, and printing env values is prohibited. The code-level conclusion (no live path *offers* Ultimate) holds regardless, because `api/stripe-subscription-checkout.js:62-66` rejects it before any price lookup.
- **Runtime behavior.** No tests were run and no production endpoints were called, per METHOD constraints. All verdicts are static-analysis conclusions from source. Specifically not runtime-verified: that `_pullUserData` (`js/core.d9e1b484.js:16632-16667`) restores correctly on a fresh device; that the Stripe portal returns a working URL (`api/stripe-portal.js`); that the eBay `presetNameSearchQuery` prefill (`js/core.d9e1b484.js:12823-12825`) still matches eBay's current sell-flow contract.
- **Stripe dashboard state.** Whether an Ultimate product/price still exists in the live Stripe account (the ids at `NEXT_UP_TIER_EXPANSION.md:57`, `:62-63` are repo text only) and whether any legacy Ultimate subscriber records remain in KV under `pro:<googleSub>` with `tier: 'ultimate'` — which would still receive the 100/300 grants at `api/_tier.js:37-42`. Worth an owner check outside this audit.
