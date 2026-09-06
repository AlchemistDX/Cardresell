# Group A — Trust & numbers (reviewer items 1-10, 27, 29)

Repo read-only at `/home/user/workspace/cardresell`. No tests run, no production
calls, no files touched inside the repo. Live bundle is `js/core.d9e1b484.js`
(`index.html:3514-3518`); the stale `core.569ff536.js` is never cited below.

---

### Item 1 — Comp confidence score, outlier trim, sample count, fetched-at timestamp ("trust bundle designed, not live")

**Verdict:** PARTIAL — and the headline claim ("not live") is WRONG.

**Evidence:**

The trust bundle is implemented end to end on the eBay sold-comp path.

- Outlier trim: `api/ebay-sold.js:60-96` — IQR trim with a 25%-max-removal
  floor plus hard 30%/300%-of-median guardrails; falls back to the raw list when
  fewer than 2 comps survive (`api/ebay-sold.js:308-316`).
- Confidence score and tier: `api/ebay-sold.js:99-149` — volume points
  (`Math.min(count * 4, 40)`), spread points, outlier-ratio points, cross-source
  sanity against TCG market; buckets `>=75 high / 50-74 medium / 25-49 low /
  <25 insufficient`.
- Sample count and freshness in the payload: `api/ebay-sold.js:339-350`
  (`count`, `rawCount`, `outliersRemoved`, `confidence`, `confidenceScore`,
  `confidenceReasons`, `fetchedAt`, `cacheAgeSec`).
- It renders. `renderPriceStatus()` row 3 draws the colored confidence pill,
  the comp count, the median, the trimmed range, the retrieval age and an
  outlier tooltip (`js/core.d9e1b484.js:1924-1958`), and that HTML is written
  into `#ebayCompsStatusText` on the main card view
  (`js/core.d9e1b484.js:2691`; markup at `index.html:2114-2118`). A user
  reaches it by searching or scanning any card on the homepage.
- Quoted outlier tooltip (`js/core.d9e1b484.js:1941-1943`): *"N outliers
  filtered from R raw comps. Prices outside 1.5× IQR or 30%–300% of median were
  removed."*
- Fetched-at strings are governed by an explicit freshness contract
  (`js/core.d9e1b484.js:1825-1848`, `1858`, `1895`, `1954`). The verbs are
  deliberate: `retrieved just now / N min ago / N hr ago / N d ago`
  (`_ageStr`, `js/core.d9e1b484.js:1729-1735`), `Updated <date>` **only** when
  the feed supplied a real date, and `no price date ⓘ` for PriceCharting with
  the tooltip *"PriceCharting publishes a current blended guide value with no
  as-of date and no sales history, so we can date when we retrieved it but not
  when the price was set."* (`js/core.d9e1b484.js:1858`).

What is genuinely absent:

1. **No sample count or confidence on the paths that actually serve prices.**
   The code records that eBay sold comps are 403ing sitewide from Vercel IPs
   (`js/core.d9e1b484.js:1700-1701`, `2440-2441`, `js/core.d9e1b484.js:1877`
   comment "eBay is 100% 403'd from Vercel IPs; PC is the primary source"). The
   two rungs that normally win — TCGplayer market and PriceCharting — carry
   **no** comp count and no computed confidence. PriceCharting's pill
   (`js/core.d9e1b484.js:1877-1912`) reads `pc.confidence` straight from the
   provider payload and defaults to `'medium'` when absent; it is not derived
   from a sample the app can see.
2. **The trim is not applied to the headline price on the TCG path.**
   `_trimmedMean()` (`api/tcg-price.js:650-679`) is reached only when
   `marketPrice` is missing: `if (M == null) return _trimmedMean(...)`
   (`api/tcg-price.js:595`), otherwise the sale price is published verbatim
   (`api/tcg-price.js:620`). The former "sanity valve" that blended asks into
   the headline was removed on purpose, with a worked $19,800-vs-$1,000 example
   (`api/tcg-price.js:597-619`). What the TCG path does have instead is the
   high-price clamp (`api/tcg-price.js:531-540`, re-applied on cache read at
   `:131`, client belt-and-braces at `js/core.d9e1b484.js:1706-1714`) and the
   `$99,999` sentinel guard (`api/tcg-price.js:546-551`, `:222`).
3. **`marketAskDivergence` is computed and never shown.** The server builds it
   and attaches it to the payload (`api/tcg-price.js:628-651`, `:266-267`), and
   the comment says it exists "so the UI can warn instead of guessing"
   (`api/tcg-price.js:614-616`). The identifier does not appear anywhere in
   `js/core.d9e1b484.js`. That is a real, small, honest gap.
4. `NEXT_UP_TRUST_BUNDLE.md:3` still says **"Status: Paused mid-design"**. That
   document is stale — everything in its locked plan (trim, confidence, buckets,
   timestamps, pill colors, ⓘ tooltip) is in `api/ebay-sold.js` and
   `js/core.d9e1b484.js` today. A reviewer reading the public roadmap would
   reasonably conclude the bundle never shipped. This is the likely origin of the
   claim, and it is also reviewer item 55.

**If real, what it takes:** (a) render `marketAskDivergence` somewhere quiet on
the card view — the detection already exists, so this is a render-only change in
`renderPriceStatus()`; (b) update `NEXT_UP_TRUST_BUNDLE.md` status so the
roadmap stops contradicting production. Do **not** synthesize a confidence value
or sample count for the TCG/PriceCharting rungs.

**Rule conflict:** Rule 2 blocks the most obvious "fix". TCGCSV gives four price
points, not a sample; PriceCharting publishes an undated blended guide value with
no sales history (`js/core.d9e1b484.js:1821-1830`). Any confidence number or
sample count attached to those rungs would be invented.

---

### Item 2 — Stale-fee / verified pills on the homepage payout tile, not only Accuracy

**Verdict:** PARTIAL — reviewer is wrong that the pills live only on Accuracy.

**Evidence:**

- Every venue payout tile renders a `Verified <Mon YYYY>` or amber `Stale` pill
  inside its fee block, linking to `/accuracy#fees`
  (`js/core.d9e1b484.js:7682-7693`). CSS at `index.html:710-719`.
- Thresholds: `isFeeAmber` >30 days, `isFeeStale` >45 days
  (`js/core.d9e1b484.js:5880-5881`, ages from `verifiedAgeDays`, `:5869-5879`).
- Stale-pill title text (`js/core.d9e1b484.js:7689-7691`): *"This venue's fees
  haven't been re-verified in over 45 days, so we won't rank it #1. Click for
  methodology."* The claim is true: the ranker partitions stale venues to the
  bottom (`js/core.d9e1b484.js:7270-7274`).
- The tiles are on the homepage — `#resultsArea` in `index.html:2378+`, filled
  by `calc()`. In the default (non-compact) grid the fee block is visible without
  interaction; only `.plat-grid.compact` hides it behind a Details toggle
  (`index.html:773-793`).
- `tests/copy-truth-offline.mjs:372-376` asserts the 45-day threshold and the
  exact pill copy, so the behavior is pinned.

What is absent: the two most-read surfaces above the tiles carry no freshness
mark — the winner banner (`js/core.d9e1b484.js:7304-7321`) and the "Ranked by net
payout" strip (`js/core.d9e1b484.js:7347-7368`). A user who reads only the banner
sees a crowned venue with no verification state. The all-stale case is covered
(item 8), but the mixed case is not: a venue at 44 days is amber on its tile and
unmarked in the banner.

**If real, what it takes:** carry `isFeeAmber`/`isFeeStale` into the banner and
the rank rows in `js/core.d9e1b484.js:7304-7368`, reading the same helpers. No
new data.

**Rule conflict:** none — reuse of `isFeeStale`/`isFeeAmber` satisfies rule 1.

---

### Item 3 — Seller-level overrides: eBay Top Rated, Basic vs Store, TCGplayer Direct vs self-ship, Pro seller rate

**Verdict:** SHIPPED.

**Evidence:** All four exist as persisted controls under *Advanced Platform
Options → "Your seller profile"* on the homepage sidebar
(`index.html:2308-2372`), keyed in
`SELLER_PROFILE_KEYS = ['tcgLevel','ebayStore','ebayTopRated','ebayPromo']`
(`js/core.d9e1b484.js:5529`), each wired to `calc()`.

- TCGplayer level, including Direct and Pro:
  `index.html:2322-2327` (`Level 1-4 10.75%` / `Pro non-Direct 9.25% + 2.5%` /
  `Direct 8.95%, no $0.30, you don't ship` / `Direct + Pro`), modeled in
  `TCG_LEVELS` (`js/core.d9e1b484.js:6658-6662`) and `feeTCGPlayer`
  (`:6664-6705`) with sourced notes at `:6635-6657`. Direct genuinely changes
  behavior, not just a rate: the $0.30 per-order fee drops
  (`js/core.d9e1b484.js:6676`), a per-item Direct fee is added (`:6694`), and
  seller postage goes to zero because TCGplayer fulfills
  (`js/core.d9e1b484.js:7036-7047`), with the tile's workflow badges swapped to
  the Direct story (`:7504-7520`).
- eBay Top Rated: `index.html:2346-2351`; `-10%` applies to the FVF only and is
  disclosed in the visible fee formula as `13.25% −10% Top Rated`
  (`js/core.d9e1b484.js:6380`, `6392-6420`).
- eBay Store: `index.html:2331-2334`.
- Also present beyond the reviewer's list: eBay Promoted Listings ad rate
  (`index.html:2337-2344`), COMC submission tier and cash-out
  (`index.html:2354-2369`).

**If real, what it takes:** n/a. Two honest nits, not gaps: eBay Store offers
only `none` / `basic` (no Premium/Anchor tiers), and the whole panel is behind
the collapsed *Advanced* accordion (`index.html:2309-2312`), so discovery is the
weak link rather than existence.

**Rule conflict:** none.

---

### Item 4 — Custom shipping / label cost instead of a hidden $5 inbound assumption

**Verdict:** PARTIAL — the $5 is real, but "hidden" is WRONG.

**Evidence:**

- The constant is a literal `5` inside two fee functions, not a named constant:
  `feeFanatics` → `{ l: 'Ship-in to vault (est.)', a: 5 }`
  (`js/core.d9e1b484.js:6726-6731`), and `feeCOMC` →
  `{ l: 'Ship-in to COMC (est.)', a: 5 }` (`js/core.d9e1b484.js:6741-6752`).
- It is disclosed, not hidden. Every `feeItems` row renders as a labeled
  deduction line in the tile's fee block
  (`js/core.d9e1b484.js:7683`), and the label carries "(est.)". The intent is
  documented as a surfaced line item at `js/core.d9e1b484.js:6722` and
  `:7073-7075`.
- The seller's *outbound* label cost is already user-editable: the "Shipping —
  Charge to buyer / Your cost" pair (`index.html:2278-2293`, `#shipCost` read at
  `js/core.d9e1b484.js:7005` and applied as `sellerShip` per venue,
  `:7025-7201`). Cross-border postage has its own input
  (`js/core.d9e1b484.js:6180-6193`).
- So the accurate version of the reviewer's complaint is narrow: the two
  **inbound** ship-in legs are a fixed $5 estimate with no override.

**If real, what it takes:** hoist the literal to one named constant (e.g.
`INBOUND_SHIP_EST = 5`) used by both fee functions, and add a single "Ship-in
cost" input in the same Advanced panel feeding both. Files:
`js/core.d9e1b484.js` (`feeFanatics`, `feeCOMC`, `calc()` input read),
`index.html` (one input). Update `accuracy.html` if the copy names $5.

**Rule conflict:** Rule 1 risk if implemented carelessly. Adding a second
shipping input that shadows `#shipCost` for consignment venues would create two
implementations of "what shipping costs the seller". One input, read once, passed
into both fee functions.

---

### Item 5 — International buyer toggle that actually re-ranks (FX, VAT, de minimis, EIS)

**Verdict:** PARTIAL.

**Evidence — what exists (seller-side, and it does re-rank):**

- Foreign venues are their own group, off by default, with an explicit postage
  input and an EU-account confirmation, both of which gate ranking:
  `VENUE_REQUIRES = { cardmarket: ['intlShip', 'cmAccount'] }`
  (`js/core.d9e1b484.js:5959`), checked in `venueEligible`
  (`js/core.d9e1b484.js:6060-6100`), UI at `js/core.d9e1b484.js:6180-6205`
  ("International postage you'll pay (USD)", "I have an EU-registered
  Cardmarket account"). Filling postage genuinely re-ranks — an ineligible venue
  cannot be crowned (`js/core.d9e1b484.js:7264-7269`) and renders greyed with
  *"For reference · not ranked"* (`js/core.d9e1b484.js:7627-7634`).
- FX is modeled where it is a seller cost: Cardmarket's 3% currency conversion
  is a real deducted line (`js/core.d9e1b484.js:6857-6867`), and the postage
  substitution for Cardmarket is deliberate (`:7130-7135`).
- VAT / IOSS / de minimis are disclosed as per-venue prose in `CROSS_BORDER`
  (`js/core.d9e1b484.js:5788-5830`) and tabulated on
  `accuracy.html:170-180`. The Whatnot entry names the Aug 29 2025 removal of the
  US de minimis exemption (`js/core.d9e1b484.js:5805`).

**Evidence — what is absent:** there is no buyer-location toggle, and eBay's
international economics are explicitly excluded from the number. Quoted
(`js/core.d9e1b484.js:5790`): *"If the buyer or the delivery address is outside
the US, eBay adds a 1.65% international fee charged on the item + shipping + tax
— waived if you use eBay International Shipping. Converting a foreign currency
costs a further 3%. **Neither is included in the payout above.**"* Same wording
on `accuracy.html:175`. So the disclosure is honest (rule 3 satisfied) but the
ranking is US-buyer-only; a seller who ships worldwide cannot see the ranking
they actually face, and EIS exists only as prose.

**If real, what it takes:** one "buyer outside the US" toggle that, when on,
adds a 1.65% international fee line to eBay's `feeItems` and a 3% FX line unless
an "using eBay International Shipping" sub-toggle is set — then let the existing
ranker re-sort. Files: `js/core.d9e1b484.js` (`feeEbay`, `calc()` input read,
`CROSS_BORDER` copy so prose and math stop disagreeing), `index.html` (toggle),
`accuracy.html`. VAT and de minimis should stay prose: they are buyer-side or
jurisdiction-specific and modeling them would mean guessing a destination.

**Rule conflict:** Rule 3 becomes live the moment the toggle ships — the
"Neither is included" sentences must change in the same commit, or the app
stamps a statement its own math contradicts.

---

### Item 6 — Condition markdown on buylists (NM vs LP vs MP) as an input, not a footnote

**Verdict:** PARTIAL — reviewer is wrong that it is only a footnote, right that
buylist-specific markdowns are not modeled.

**Evidence — it is an input:**

- Condition pills NM/LP/MP/HP/DMG with multipliers
  `{ nm:1.0, lp:0.85, mp:0.65, hp:0.45, dmg:0.25 }`
  (`js/core.d9e1b484.js:4577-4582`; label set at `:316-322`).
- The multiplier is applied to the price basis in `getEffectivePrice()`
  (`js/core.d9e1b484.js:4586-4601`), including to a system-auto-filled override
  (`:4590-4593`) — a bug fixed on purpose because "selecting Moderately Played
  moved the Market Value headline but left every payout row unchanged".
- That price is the single input to every venue's fee function, buylists
  included: `feeBuylist(price, ratio, serviceFeePct)`
  (`js/core.d9e1b484.js:6873-6897`), called with the same `price` as all other
  venues (e.g. `js/core.d9e1b484.js:7199`). So an LP selection *does* move every
  buylist payout, and it is pinned to 1.0 on slabs and on sports for stated
  reasons (`js/core.d9e1b484.js:4578`, `:2984-2988`).

**Evidence — what is genuinely a footnote:** venue-specific condition
schedules. CoolStuffInc's actual rule appears only as tile prose: *"played cards
pay 75% of NM"* (`js/core.d9e1b484.js`, `SELL_SPEED.coolstuffinc.why`, ~`:6975`).
The app instead applies its own generic 0.85/0.65 to retail and then the buylist
ratio. Also, the multiplier table itself is a derived estimate with no source
comment and is not labeled as derived in the UI.

**If real, what it takes:** the cheap, safe version is to label the multiplier
as an estimate where the condition pills live (`index.html` condPills block) and
add each buylist's published played-card rate to `accuracy.html`. A per-venue
condition schedule is the expensive version and needs sources per venue.

**Rule conflict:** Rule 1 — a per-venue condition table layered on top of
`getCondMultiplier()` would be a second implementation of "how much condition
takes off". If it is built, it belongs inside the one multiplier path, keyed by
venue, not as a parallel adjustment. Rule 2 also applies: today's 0.85/0.65/0.45
figures are derived and are not labeled as such.

---

### Item 7 — Graded vs raw as a first-class payout path with source labeled on the number

**Verdict:** PARTIAL, close to SHIPPED on labeling; the "cross-source
disagreement" half is a real regression the reviewer could not have known about.

**Evidence — graded is first-class:**

- Grader pills + grade dropdown drive graded pricing, with each option naming
  its source: `'PSA 10 (PriceCharting)'`, `'Grade 9.5 — BGS/CGC
  (PriceCharting)'` etc. (`js/core.d9e1b484.js:2583-2593`); shown/hidden at
  `:5367-5372`.
- Graded selection changes the math, not just the number: condition multiplier
  pinned to 1.0 (`js/core.d9e1b484.js:4578`, `:4472`, rationale at
  `:4533-4541`), COMC's graded intake fee is charged
  (`feeCOMC(price, service, isGraded, cashout)`, `js/core.d9e1b484.js:6741-6752`,
  called at `:7063`), Quick Pricing switches to the single-guide-value shape
  because a slab has no ask book (`js/core.d9e1b484.js:4162-4231`).
- Source is labeled next to the number, twice over. Row 2 of the status readout
  renders a confidence pill + `Guide value $X · PriceCharting ↗ · <matched
  product> · retrieved N min ago · no price date ⓘ`
  (`js/core.d9e1b484.js:1877-1912`). The headline caption is rendered from one
  place, `_renderPriceCaption()` (`js/core.d9e1b484.js:1832-1852`), fed by
  `_crBasis.label` recorded by the ladder itself — `'PriceCharting guide
  value'`, `'eBay sold median · N comps'`, `'TCGPlayer market'`
  (`js/core.d9e1b484.js:2426`, `2432`, `2461`, `2470`, `2476`). The comment at
  `:2515-2523` records the exact bug this fixed: a PriceCharting number
  captioned "TCGPlayer market".
- Every fee tile repeats it: `Price used (PriceCharting guide value)`
  (`js/core.d9e1b484.js:7212-7217`, rendered at `:7671`).
- The graded ladder's precedence is documented and dated on
  `accuracy.html:138-146`.

**Evidence — what is not first-class:**

1. Cross-source disagreement is detected and deliberately **not rendered**. The
   render was "Withdrawn 2026-09-04 at the owner's direction", with the cost
   recorded in the comment (`js/core.d9e1b484.js:1917-1930`): *"when the two
   feeds disagree by more than 50% the seller now sees only the basis we picked,
   with no hint that the other source says something very different."* Detection
   (`_sourceDisagreement`) is kept and still tested. Separately,
   `marketAskDivergence` from `api/tcg-price.js:628-651` is never referenced in
   the bundle. So both disagreement signals exist server-/detector-side and
   neither reaches the eye.
2. Grade *upside* is withdrawn on purpose (`js/core.d9e1b484.js:2068-2125`;
   `renderGradeOpportunity()` returns `''` at `:2122-2124`). `api/grade-opportunity.js`
   still computes `gradedEst`/`expectedProfit` from hardcoded category
   multipliers (`api/grade-opportunity.js:17-24`) and a grading-cost table
   (`:44-51`), but nothing renders. The withdrawal reasoning is the strongest
   rule-2 document in the repo (24x intra-set PSA-10 spread, survivorship bias,
   thin per-grade samples).

**If real, what it takes:** put one disagreement disclosure back somewhere
quieter than the homepage card (e.g. inside the Details expander), reusing
`_sourceDisagreement` and `marketAskDivergence` — render-only, no new detection.
This is an owner decision, not a build problem: it was switched off on purpose.

**Rule conflict:** Rule 2 blocks any grade-upside revival — see the re-enable
preconditions at `js/core.d9e1b484.js:2101-2116` (licensed per-card grade
distribution **and** a dated per-grade price). Rule 1 is satisfied by reusing
the existing detectors.

---

### Item 8 — "This rank is reference-only" when every venue is stale, unmissable in UI

**Verdict:** SHIPPED.

**Evidence:** `js/core.d9e1b484.js:7288-7290` — when no fresh eligible venue
remains, the results HTML opens with:

> `<div class="warning-banner" role="status">All marketplace fee schedules are
> past the 45-day verification window. Rankings are shown for reference only
> until the next fee audit.</div>`

It is prepended to `html` **before** the winner banner (`:7292-7304`), so it
renders above everything a user reads, styled as an amber-bordered block
(`.warning-banner`, `index.html:846`) with `role="status"`. The rule is also
documented publicly on `accuracy.html:98`: *"If every venue becomes stale,
CardResell labels the ranking as reference-only rather than presenting a stale
winner as current."* Related but distinct: the per-venue "For reference · not
ranked" state for requirement-blocked venues
(`js/core.d9e1b484.js:7627-7634`).

A user reaches it by calculating payouts on any card at a time when every
venue's `verified` stamp is >45 days old. As of the Sep 1 2026 audit no venue is
stale (`accuracy.html:98`), so in practice this banner is currently unreachable —
which is the correct behavior, not a gap.

**If real, what it takes:** n/a. Reviewer is wrong that this is policy-only.

**Rule conflict:** none.

---

### Item 9 — Public fee-bug log ("user reported X, we shipped Y on DATE")

**Verdict:** GAP, with real partial credit.

**Evidence — what exists:** `accuracy.html:92-104` is a dated, newest-first
accuracy changelog, and its entries already record corrections with the delta
spelled out. Quoted (`accuracy.html:100`): *"TCGplayer commission corrected
10.25% → **10.75%**"*. `accuracy.html:97` lists six shipped fee corrections in
one entry ("Corrections shipped: Whatnot's commission bills the item only while
its 2.9% + $0.30 bills the whole order…"). Intake exists as a request:
`accuracy.html:147` — *"If a fee has changed and we haven't caught it yet, tell
us"* linking `/contact.html`.

**Evidence — what is missing:** no report is attributed to a user, there is no
per-report record, and there is no structured intake. `api/log-correction.js` is
**not** a fee-bug log — it counts scan-ID mis-picks into KV
(`api/log-correction.js:1-19`, keys `stats:corrections:*`) and is called from the
"Wrong card?" flow (`js/core.d9e1b484.js:11619`). So the reviewer's specific
shape — "user reported X, we shipped Y on DATE" — does not exist.

**If real, what it takes:** an added `<h2 id="fee-reports">` section in
`accuracy.html` with one entry per report (date received, what was claimed, what
we verified, what shipped, date shipped). This is a content discipline, not a
feature: the page, the styling (`accuracy.html:60-64`) and the intake link are
already there. A structured intake endpoint is optional and should not reuse
`/api/log-correction`, whose KV keys mean something else.

**Rule conflict:** none. Attribution must be voluntary/anonymized to stay
consistent with the no-PII posture (`api/log-correction.js:19`).

---

### Item 10 — Independent audit, or at least a pinned "we were wrong, here's the delta" post

**Verdict:** NOT-CODE for the audit; the second half is already substantially
SHIPPED and the reviewer double-counts it.

**Evidence:** Commissioning an independent audit is a business/spend decision
with no codebase answer. The fallback the reviewer offers already exists in
substance: `accuracy.html:92-104` is exactly a running "we were wrong, here is
the delta" record — `:100` (fee rate corrected, with the old and new numbers),
`:102` (high-price clamp explained, with `highRaw` retained), `:97` (six named
corrections in one pass), `:99` ("Changelog started. We're now dating every
accuracy-affecting change on this page"). The reviewer's own "already counts, do
not rebuild" list credits the accuracy changelog — so items 9 and 10 are partly
asking for the thing they already credited. What is absent is only the framing:
nothing is pinned as a standalone post, and no entry says "we were wrong" in
those words.

The repo also contains stronger self-correction material than the changelog
surfaces: the `$19,800`-for-a-`$1,000`-card sanity-valve removal
(`api/tcg-price.js:597-619`) and the grade-upside withdrawal
(`js/core.d9e1b484.js:2073-2116`) are both "we were wrong" stories with numbers,
and neither is on the public page.

**If real, what it takes:** promote two existing internal corrections into
changelog entries in `accuracy.html`. No code.

**Rule conflict:** none. Note rule 7 — publishing anything is a deploy, and
deployment is on hold pending owner authorization.

---

### Item 27 — Sold-comp drawer: last N sales, date, price, outlier tags

**Verdict:** GAP-BLOCKED.

**Evidence:**

- The data is half there. `/api/ebay-sold` returns up to 8 comps ordered by
  closeness to the median, each `{ title, price, currency, url, soldDate,
  imgUrl, itemId }` (`api/ebay-sold.js:330-337`).
- **`soldDate` is hardcoded to the empty string** (`api/ebay-sold.js:337`). The
  date does not exist. `NEXT_UP_TRUST_BUNDLE.md:88-90` defers sold-date parsing
  explicitly because "eBay HTML is inconsistent".
- Nothing renders the array. `.items` does not appear anywhere in
  `js/core.d9e1b484.js`; `renderPriceStatus()` uses only the aggregates
  (`js/core.d9e1b484.js:1924-1958`). So there is no drawer.
- Outlier information is aggregate-only: a count plus a tooltip
  (`js/core.d9e1b484.js:1941-1943`). Trimmed prices are dropped before the item
  list is built — `filtered.filter(it => finalPrices.includes(it.price))`
  (`api/ebay-sold.js:331-332`) keeps only survivors, so per-item "outlier" tags
  would require returning the removed items too.
- Whether any of this is reachable at all is separately doubtful: the code
  states eBay sold comps are 403ing sitewide from Vercel IPs
  (`js/core.d9e1b484.js:1700-1701`, `2440-2441`).

**If real, what it takes:** a reduced drawer is buildable today — N, each comp's
title, price and link, expandable under the eBay row, using data already in the
payload. That needs one render function in `js/core.d9e1b484.js`. The **date
column cannot be built** without eBay sold-date parsing, and per-item outlier
tags need `api/ebay-sold.js:331` changed to return removed items flagged rather
than filtered.

**Rule conflict:** Rule 2 blocks the reviewer's version as specified. A date
column with no parsed date would be an invented figure, and a relative
"retrieved" age must not be dressed up as a sale date — the codebase already
draws that exact distinction (`js/core.d9e1b484.js:1825-1830`).

---

### Item 29 — "Max buy" that includes grade fee, inbound ship, expected days-to-cash

**Verdict:** PARTIAL, with the grade-fee component GAP-BLOCKED.

**Evidence — Max Buy exists and is on the homepage:**
`js/core.d9e1b484.js:7879-7899` (free + Pro path) and `:7945-7960` (Pro path),
labeled `MAX BUY PRICE (via <venue>)` with rows for 20/30/40% target margin and
the caption *"Don't pay more than these to hit your target margin"*. The formula
is `maxCost = bestNet − price × target%`, where `bestNet` is the winning venue's
`netPayout`.

Component by component:

- **Inbound ship: already included, indirectly.** `netPayout` is
  `price + shipCharge − totalFees − sellerShip`
  (`js/core.d9e1b484.js:7226`), and for the two ship-in venues `totalFees`
  contains the $5 inbound line (`js/core.d9e1b484.js:6726-6731`,
  `6741-6752`). It also nets cash-out fees and the seller's own postage. So Max
  Buy is already an after-all-deductions number — but nothing on the Max Buy tile
  says which deductions, and it silently follows whichever venue won.
- **Days-to-cash: exists, but not next to Max Buy.** `DAYS_TO_CASH`
  (`js/core.d9e1b484.js:6982-6989`) and `daysToCashText()` (`:6989-6992`) feed a
  per-tile row *"Payout time after it sells"* (`js/core.d9e1b484.js:7690`), plus
  a separate `SELL_SPEED` axis for listing-to-sale speed (`:6927-6980`). The Max
  Buy block shows no time dimension at all. Adding the winner's range there is a
  two-line change.
- **Grade fee: absent, and the obvious version is blocked.** Grading cost lives
  in two places already: `api/grade-opportunity.js:44-51`
  (`PSA <$200 → $25`, `<$500 → $50`, else `$100`; BGS $50; CGC/SGC $18) and the
  Flips ledger's user-entered `gradingCost` field, which is a real cost-basis
  input (`js/core.d9e1b484.js:8402-8411`, `9846-9880`). Neither reaches Max Buy.

**If real, what it takes:** (1) print the winner's `daysToCashText(pid)` inside
the Max Buy block, and one line naming what the net already deducts — both read
existing fields, no new data; (2) if a graded Max Buy is wanted, scope it to
"you already hold a slab of grade G", where the grade is a fact rather than a
probability, using the existing PriceCharting graded basis. Files:
`js/core.d9e1b484.js` only.

**Rule conflict:** Rule 2 blocks "max buy including grade fee" for a **raw**
card. That number requires a probability of hitting the target grade, and the
project has already researched and rejected every available version of that
figure (`js/core.d9e1b484.js:2073-2116`: 0.6%-14.7% PSA-10 rates *within one
set*, an ~18x overstatement from applying a set baseline, survivorship-biased
population data). Reviving it as an input to a dollar figure the seller acts on
would re-introduce exactly the number that was withdrawn on 2026-09-03. Rule 1
also applies: grading cost must not be re-tabulated in the bundle while
`api/grade-opportunity.js:44-51` owns it. Separately worth the owner's
attention — `DAYS_TO_CASH` is an unsourced hardcoded day-range shown as
*"Payout time after it sells: 3–7 days"* with no derived label, which is the
literal example rule 2 names.

---

## Group summary

**Counts per verdict (12 items):**

| Verdict | Count | Items |
|---|---|---|
| SHIPPED | 2 | 3, 8 |
| PARTIAL | 7 | 1, 2, 4, 5, 6, 7, 29 |
| GAP | 1 | 9 |
| GAP-BLOCKED | 1 | 27 |
| NOT-CODE | 1 | 10 |
| WRONG / UNVERIFIABLE | 0 | — (items 1, 2, 4, 6 each contain a claim that is
flatly wrong, but the surrounding item still has a genuine remainder, so they
are scored PARTIAL per METHOD's instruction not to round) |

**The 3 most worth doing first:**

1. **Item 2 — carry the verified/stale pill into the winner banner and the
   ranking strip** (`js/core.d9e1b484.js:7304-7368`). The helpers, thresholds
   and copy all exist; the two surfaces users actually read are the only ones
   without a freshness mark. Smallest change with the largest trust return, and
   it cannot violate any rule.
2. **Item 1 (part) — render `marketAskDivergence`, and fix
   `NEXT_UP_TRUST_BUNDLE.md`.** The server computes the sales-vs-asks
   disagreement specifically "so the UI can warn" (`api/tcg-price.js:614-616`)
   and no client code reads it. Meanwhile the roadmap says the trust bundle is
   paused when it shipped — that stale doc is probably the source of this
   reviewer's biggest error, and it is also item 55.
3. **Item 9 — start a fee-report section on `accuracy.html`.** The page,
   styling and intake link already exist; this is discipline, not engineering,
   and it converts corrections the project is already making into visible
   evidence.

**What the reviewer got materially wrong (owner should know):**

- **The trust bundle is live, not "designed".** Outlier trim, confidence tiers,
  comp counts, `fetchedAt`/`cacheAgeSec` and the ⓘ tooltip are all in
  `api/ebay-sold.js:60-149`/`339-350` and rendered at
  `js/core.d9e1b484.js:1924-1958`. The reason a user may never see it is that
  eBay 403s Vercel IPs (`js/core.d9e1b484.js:1700-1701`, `2440-2441`) — an
  availability problem, not a missing feature. `NEXT_UP_TRUST_BUNDLE.md:3` still
  says "Paused", which is now false and publicly misleading.
- **Stale/verified pills are already on the payout tiles**, not only on
  Accuracy (`js/core.d9e1b484.js:7682-7693`), and a stale venue is already
  barred from #1 (`:7270-7274`).
- **The $5 inbound is disclosed, not hidden** — it renders as a labeled
  "Ship-in to vault (est.)" / "Ship-in to COMC (est.)" deduction line
  (`js/core.d9e1b484.js:6726-6731`, `6741-6752`, rendered at `:7683`). The real
  gap is only that it is not editable.
- **Condition is an input, not a footnote** — `getEffectivePrice()` multiplies
  the basis before every venue, buylists included
  (`js/core.d9e1b484.js:4586-4601`, `6873-6897`). The genuine remainder is
  venue-specific buylist schedules.
- **The all-stale reference-only state is shipped UI**, not policy
  (`js/core.d9e1b484.js:7288-7290`).
- **Items 9/10 partly duplicate the reviewer's own "already counts" list.**
  They credit the accuracy changelog and then ask for a dated corrections log
  and a "we were wrong" post, which is largely what `accuracy.html:92-104` is.
- **Three of these items ask for numbers the project has already researched and
  refused.** Grade-fee-inclusive max buy (item 29) and any confidence figure on
  the TCG/PriceCharting rungs (item 1) both require invented probabilities or
  invented sample counts; the reasoning is documented at
  `js/core.d9e1b484.js:2073-2116` and `1821-1830`. The sold-comp date column
  (item 27) requires a date the feed does not give
  (`api/ebay-sold.js:337`). A reviewer scoring "trust" should be told these are
  refusals, not oversights.
- **One finding the reviewer missed, in their own subject area:** the
  cross-source disagreement disclosure was **withdrawn on 2026-09-04** at the
  owner's direction (`js/core.d9e1b484.js:1917-1930`). Detection is kept and
  tested; only the render is off. The reviewer credits "cross-border labels" and
  "fee sources linked" as shipped and never noticed that a seller looking at a
  card where TCGplayer says $500 and PriceCharting says $2,000 now gets no hint
  of the disagreement. Both numbers still render separately and neither is
  averaged, so nothing is a lie — but this is the single largest live trust
  regression in Group A, and it is a product decision to revisit, not a bug to
  fix.
- **Possible rule-2 exposure not raised by the reviewer:** `DAYS_TO_CASH`
  (`js/core.d9e1b484.js:6982-6989`) is an unsourced hardcoded day-range rendered
  as "Payout time after it sells: 3–7 days" with no derived/estimate label, and
  `getCondMultiplier()`'s 0.85/0.65/0.45 table (`:4577-4582`) is likewise
  unsourced. Rule 2 names fabricated day-ranges explicitly.

**What I could not check, and why:**

- Whether the eBay sold-comp path returns anything in production. The 403 claim
  comes from code comments (`js/core.d9e1b484.js:1700-1701`, `2440-2441`) and
  cannot be tested read-only without calling eBay. Settled by one live
  `/api/ebay-sold` call from the deployed function, which METHOD forbids. Every
  verdict on items 1 and 27 that depends on this is stated as "implemented" plus
  "possibly unreachable", not as working.
- Rendered pixel prominence of the reference-only banner and the confidence
  pills. I read the markup and CSS (`index.html:846`, `710-719`, `773-793`) but
  did not render the page, so "unmissable" (item 8) is judged on DOM position
  and styling rather than on a screenshot.
- Whether `PLATFORMS[pid].verified` stamps are currently accurate. Ages derive
  from a `'Mon YYYY'` string (`js/core.d9e1b484.js:5869-5879`); whether the
  underlying re-verification actually happened on those dates is an operational
  fact the repo cannot establish.
- `pricecharting.js` internals were not exhaustively read; the item-7 claims
  above rest on the client-side ladder, labels and captions, which is where the
  "source labeled on the number" question is actually decided.
