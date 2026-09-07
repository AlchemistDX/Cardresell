# D3 Step 5 — Second Review Response

**Review of:** commit `bc83222`
**Responding at:** `491558c` (branch `phase1-block-d`)
**Date:** 2026-09-07
**Verdict received:** proceed with focused corrections

All three blockers are closed and committed. Both should-fix items are addressed
— one landed, one is argued below rather than done, with the reason. Two of the
four step-6 evidence items landed; the other two are reported honestly as not
landed, with what remains.

Nothing has been pushed. Nothing has been deployed. The push gate is unchanged
and still binding: **the Cert ID is not rotated.**

---

## Commits this round

| Commit | What |
| --- | --- |
| `869404e` | Blockers 1 and 2 — the verification stamp becomes a real date; the note and the unknown tax |
| `7e3f9d5` | Blocker 3 — Top Rated Plus is a listing benefit, not a seller status |
| `4abf2c1` | Step 6 — register the review suite, pin both fee steps at the cent |
| `491558c` | a11y — `--text-muted` clears AA in dark, in its own commit as asked |

---

## Blocker 1 — the verification stamp was not measuring anything

### What was actually wrong

Worse than a stale date. `verifiedAgeDays` anchored to the **last** day of the
stamped month and then clamped negative results to `0`. Two consequences:

1. **Any future stamp read as permanently fresh.** A typo of `Sep 2099` returned
   an age of 0 days and `stale = false`, forever. The clamp that looked like
   defensive coding was the thing hiding the lie.
2. **Month granularity understated real age by up to 29 days.** A date audited
   on the 1st was measured from the 30th.

A clamp hides a lie, and a date we refuse to measure from is a date we refuse
to show.

### Fixed

All 15 venues now carry `feeAuditedOn: '2026-09-01'`, a real day. The date is
not invented — it is sourced from
[`fee_audit_full_2026-09-01.md`](../../fee_audit_full_2026-09-01.md) and
corroborated independently by the `accuracy.html:95` changelog entry.

`feeAuditAgeDays(pid)` returns **`Infinity`** for missing, unparseable,
calendar-rolled-over (`Feb 30`), and **future** dates. There is no clamp. A date
we cannot measure is not fresh — it is unverified, and it says so.

- `isFeeStale` = age > 45 days
- `isFeeAmber` = age > 30 days
- `feeAuditedLabel(pid)` returns `''` when age is non-finite, so nothing is
  stamped when nothing is known

Both pills relabeled so the claim is scoped to what was checked:
"Fee schedule verified Sep 1, 2026" / "Fee schedule stale · Sep 1, 2026" /
"Fee schedule not verified". **Fee verification never implies price
verification** — that constraint is respected in the copy.

The review pill emits `data-fee-verified="fresh|stale|unverified"` so the state
is assertable without matching on prose. The ranking pill now renders
**unconditionally** — a missing pill is silence, and silence reads as fine.

`accuracy.html` corrected too: 15 `<td>Sep 2026</td>` → `Sep 1, 2026`, the prose
at `:148`, a Sep 7 2026 changelog entry, and the header stamp.

**Still open, disclosed:** the `accuracy.html` stamp table is a **second copy**
of the audit date. It is now correct, but it is a copy, and rule 1 says one
business fact should have one home. Logged, not fixed here.

---

## Blocker 2 — the note, and the unknown tax

A shared block now sits before `const FEE_MODEL_REVISION = 1;`:

```js
FEE_UNKNOWN = '\u2014'
FEE_DISCLOSURE = { taxLabel, taxQualifier: 'not estimated', baseLabel: 'Fee base',
                   estimateNote, trsWithheldNote }
```

**The tax row is an em dash, not `$0.00`.** A zero is a claim. We do not know
the buyer's tax, and a parenthetical qualifier does not turn an unknown amount
into zero — so the amount column says "unknown" in the only way a number column
can.

The note now attributes the item-only base to **our estimate** rather than
implying eBay works that way, states that eBay charges on the total sale
including buyer-paid shipping and tax, and says proceeds "may be lower". The
direction of the error is stated, not left for the seller to discover.

**Still open, disclosed:** `FEE_DISCLOSURE` collapses the **copy** so the two
surfaces cannot drift in wording, but the review screen and the ranking screen
still **render different markup**. The duplicate-render shape is reduced, not
eliminated. This is rule 1's sixth bite and I am not claiming it is closed.

---

## Blocker 3 — Top Rated Plus, and why reading the source changed the answer

### The bug

`feeEbay` took the **seller-status string** as its eligibility argument and
applied the 10% discount whenever it read `'yes'`. eBay's wording is that once
you reach Top Rated status you **can qualify your listings** for Top Rated Plus
benefits if you offer same- or 1-business-day handling and 30-day-or-longer free
returns ([eBay seller standards
policy](https://www.ebay.com/help/policies/selling-policies/seller-standards-policy?id=4347)).

Status is **necessary, not sufficient.** A Top Rated seller listing without
qualifying handling pays the full fee — and we were quoting them a payout too
high on every single card.

### The part worth reading rather than copying

That same page lists the categories where you don't have to accept returns for
the benefit to still apply. The list contains, verbatim:

> Trading Cards (Sports Trading Cards, Non-Sports Trading Cards, and Collectible
> Card Games)

**Every item this app prices is in that set.** For our category the free-returns
condition is **waived** — the fee discount is extended, the seal is not — so the
only per-listing condition left for us is **same- or 1-business-day handling**.

This matters in the seller's favour. Had I implemented the headline rule, I
would have asked card sellers to confirm 30-day free returns, and thereby
**suppressed a discount eBay does not require them to earn that way.** Read the
category exemptions, not just the headline rule.

Sources fetched this round: the seller standards policy above (contained the
per-listing rules), plus [selling
fees](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822)
and [seller
levels](https://www.ebay.com/help/selling/seller-levels-performance-standards/seller-levels-performance-standards?id=4080)
— the latter two were checked and did **not** contain them.

### The fix

- **`trsDiscountApplies(prof)` is the single place eligibility is decided.**
  Requires the status **and** a separate listing confirmation. Returns `false`
  for `undefined` and `{}`.
- `feeEbay(price, shipCharge, ebayStore, ebayPromo, trsEligible)` — the 5th
  parameter is now a **resolved boolean**, and `const trs = trsEligible === true`
  so a truthy status string cannot discount.
- **`ebayTrsListing` is its own profile key defaulting to `'no'`.** A profile
  saved before this key existed yields `'no'`, so an old stored "I am Top Rated"
  can never be re-read as a confirmation about a listing.
- The confirmation is a seller-confirmed assumption, so it is **off until
  actively stated**, and the control says "Your answer, not a checked fact". The
  "(−10% FVF)" note **moved off** the status select onto the confirmation,
  because that is the answer that earns it.
- The three conditions we do **not** ask about — US residency, not
  local-pickup-only, not rated Very High for "item not as described" — are
  disclosed under the control as assumptions rather than left implied.
- Label moved `Top Rated` → **`Top Rated Plus`** on both the fee row and the rate
  signature. The arithmetic did **not** move: still 10% of the percentage fee
  only, **never** the per-order fee, per the same page.

### A caller that would have failed silently

`netEbayForPrice` was passing `c.ebayTopRated` (a string) into a now-boolean
parameter. Left alone, that would have **dropped the discount from the payout row
and the target-net bisection while the fee rows above still showed it** — the two
would have disagreed about one listing. Now resolved through
`trsDiscountApplies(c)`.

A string where a boolean is expected fails silently and asymmetrically. When a
parameter's type changes, grep every caller.

### The review screen withholds the discount, and says so

The review screen passes `false` and renders `FEE_DISCLOSURE.trsWithheldNote` in
`<div class="review-fees-note" data-fee-trs="withheld">`.

The reasoning, for the record: the confirmation is about a **listing**, the
profile is **global**, and a confirmation made while pricing an unrelated scan
would otherwise follow the seller into every draft afterwards. Draft-bound
confirmation is not built yet, so the honest reading is the undiscounted one —
plus which way it errs. **A fee estimated too high is a disappointment; a payout
estimated too high is a promise made on eBay's behalf that we cannot keep.**

Silence about a withheld discount reads as a fee that is simply high, so the note
names the programme, names the condition, and states the direction of the error.

---

## An assertion that was pinning the bug in place

Worth flagging on its own, because it is a failure mode of the test suite rather
than of the code.

`draft-review-screen.mjs` contained **'a Top Rated seller keeps strictly more of
the same price'**. That assertion *required* the review screen to inherit a
global seller status into a per-listing benefit. It was green. It was green
**because the bug was there**, and it would have gone red the moment the bug was
fixed.

Its real intent — the screen reads the profile rather than hardcoding defaults —
is now proved with the **store tier** (`ebayStore` → `'basic'`, 13.25% → 12.35%),
which genuinely *is* a property of the seller.

Both replaced assertions record their old text **inside the test file**, marked
`CHANGED 2026-09-07`, because a flip and a silencing look identical in a diff and
commit messages are the one part of the corpus nobody greps.

**An assertion can pin a bug in place.** This is instance 15's sibling and it is
going into `audit/PATTERN_ASSERTION_SURFACE.md`.

---

## Step 6 evidence — two of four landed

### (a) Suite registration — **done**

`draft-review-screen.mjs` is now slot **`[30/30]`** in `tests/run-all.sh`, and
every existing slot label was renumbered off `/29`. It had been green since step
2 but was only ever run **by hand**, so nothing would have noticed it going red.
An unregistered suite protects whichever branch the author last remembered to run
it on.

**Not done:** resolving the final bundle from `index.html` in every
source-consuming suite, and restoring `asset-fingerprints` to green. That suite
is **14 passed / 1 failed**, and the one failure is exactly the expected one:

```
FAIL  js/core.7f9c03ad.js is named after its own bytes (sha256[:8] = f9de26a1)
```

It stays red **by design** until the bundle rename closes D3. It is a real
signal, not a broken test.

### (b) Boundary cases — **done, from published figures**

Every prior fee assertion sat comfortably **inside** a band, so both of
`feeEbay`'s discontinuities were tested only from the middle. A step tested from
the middle is a step whose **edge** is untested.

Expectations are taken from published figures, not re-derived from our own code:

- **Per-order fee**, quoted verbatim from the fees page and **re-fetched
  2026-09-07**: "For orders $10.00 or less the per order fee is $0.30, for orders
  over $10.00 the per order fee is $0.40" ([eBay selling
  fees](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822)).
  Note **"or less"** — $10.00 exactly takes the **low** fee. That is the cent the
  section exists to pin.
- **Trading-card commission**, 13.25% up to $7,500 + 2.35% above, from eBay's
  dated 2025-02-14 fee-change table, which explicitly held Sports Trading Cards,
  Non-Sport Trading Cards and Collectible Card Games at **13.25%** while most
  categories rose to 13.6% ([eBay January 2025 seller
  update](https://www.ebay.com/sellercenter/resources/seller-updates/2025-january/final-value-fee)).

On the fees page itself: eBay's **live category fee table is rendered dynamically
and does not return in fetched content.** I re-confirmed that today. This was
already recorded as a limitation in `fee_audit_full_2026-09-01.md:348`, so the
dated seller update is the anchor. I am **not** claiming the fees page confirmed
the percentage — it confirmed the per-order fee only.

The strongest assertion in the set reproduces **eBay's own worked example** rather
than our reading of it. The fees page computes a trading-card sale as "13.25% of
$7,500, + 2.35% of $2,570, + $0.40" — a $10,070 sale:

| assertion | result |
| --- | --- |
| `$9.99` takes $0.30 | PASS |
| `$10.00` **exactly** still takes $0.30 | PASS |
| `$10.01` crosses to $0.40 | PASS |
| `$7,499.99` entirely at 13.25% | PASS |
| `$7,500.00` **exactly** still all at 13.25% | PASS |
| `$7,500.01` pays 2.35% on exactly one cent | PASS |
| **eBay's own $10,070 example reproduces to the cent** | PASS — `1054.545` |
| **and is `$1,054.55` as shown to a seller** | PASS |
| marginal rate above the boundary is 2.35% | PASS |
| Basic store pays 12.35% at `$2,500.00` exactly | PASS |
| and 2.35% on the cent above it | PASS |
| the two store tiers do not share a boundary | PASS |
| shipping carries a `$9.99` item over the per-order step | PASS |
| and over the commission tier as well | PASS |

Two notes on method:

- The **marginal rate is measured as a difference over a $2,500 span**, not as a
  per-price effective rate. Near the boundary a 2dp effective rate cannot
  distinguish a 2.35% marginal rate from a 13.25% one, because the blend is
  dominated by the first $7,500.
- **The cross-scan shipping isolation check is retained**, and the last two rows
  above are the cross-check that the steps apply to the **total** and not to the
  item price.

**Mutation-checked, including one that did not fire.** `total <= 10` → `total <
10` fails at $10.00 exactly. The equivalent tier mutation `total <= 7500` →
`total < 7500` **does not fail** — and rather than invent an assertion to chase
it, the reason is recorded in the test file: at exactly $7,500 the else branch
computes `7500*0.1325 + (7500-7500)*0.0235`, which is the same number the then
branch computes. The branches are **genuinely equal** at that boundary. **A
mutation that cannot be observed is not a missing test**, and the note is there so
the next person to mutation-test this does not read it as a gap.

### (c) Commit, checkout, suite inventory — **reported below, honestly**

- **Final commit:** `491558c`
- **Working tree:** clean (`git status --porcelain` empty)
- **Outgoing commits:** 68, `origin/main` unchanged. **Nothing pushed.**

**Suites actually executed locally this round:**

| Suite | Result |
| --- | --- |
| `tests/fee-truth-offline.mjs` | All checks passed |
| `tests/listing-packet-offline.mjs` | **152 passed / 0 failed** (was 138/0) |
| `tests/draft-review-screen.mjs` | **156 passed / 0 failed** (was 152/0) |
| `tests/asset-fingerprints.mjs` | **14 passed / 1 failed** — expected, bundle rename |

**Taking your instruction directly: do not infer full-suite success from these
four.** `tests/run-all.sh` has **not** been run — it hits production, and that is
excluded by your own ground rules. The other 26 slots are **unexecuted this
round**, not passing.

**Gates skipped, listed separately rather than folded in:**

- slot 24 — real-KV validation, needs `DRAFT_KV_LIVE=1` + `KV_REST_API_*`
- slot 25 — prod endpoint smoke, needs a live base
- slot 26 — condition-applicability browser gate, needs `COND_PILLS_BROWSER=1`
- `tests/ebay-live.mjs` — **18/19**, against your required **19/19**
- Cert ID rotation and runtime verification — **outstanding**
- hosting config and Preview access to production secrets — **unverified**

### (d) Corrected states shown — **partly**

Landed and verified visually at 720×820, light and dark, no overflow:

- **Fee-audit date states** — the pill renders "Fee schedule verified Sep 1,
  2026"; `data-fee-verified` carries `fresh|stale|unverified`; freshness is
  driven by `page.clock.setFixedTime()`, i.e. by moving a **real upstream input**
  rather than adding a test-only production global.
- **Unknown-tax presentation** — "Buyer sales tax (not estimated) — " with an em
  dash in the amount column.
- **Top Rated confirmation behavior** — the control defaults to "No / not sure";
  flipping **both** selects to yes does **not** move the draft net; no fee row
  claims the discount; the withheld note is present.
- **Measured dark contrast** — below.

**Not landed:** a single consolidated screenshot set covering every date state
side by side. The individual states are asserted in the suite and were inspected
individually; I have not assembled the comparison sheet.

---

## Should-fix 1 — dark contrast — **done, own commit, `491558c`**

Measured, not eyeballed — and my numbers **match yours exactly**.

The old dark value failed AA on **all three** dark backgrounds: 4.19 on `--bg`,
3.87 on `--surface`, 3.59 on `--surface-2`. Every muted label in the app was
below the bar in dark and none were in light. This round put **two paragraphs of
reading copy** at that token, which is what made it unignorable.

`--text-muted` in the dark block is now **`#918f86`**. Light mode untouched.

| pairing | ratio | AA |
| --- | --- | --- |
| `#918f86` on `--bg` `#111009` | **5.88** | pass |
| `#918f86` on `--surface` `#1a1915` | **5.43** | pass |
| `#918f86` on `--surface-2` `#21201a` | **5.04** | pass |

Verified **after** the change in a real browser, reading computed colours and
walking up to the first non-transparent ancestor background rather than assuming
which surface each label sits on. Every text pair on the review screen in dark now
clears AA; the tightest is **5.04** (`.review-back` on `--surface-2`).
`.field-hint` measures **5.43**.

**I took `#918f86` over `#8a887f`, and the reason is headroom.** `#8a887f` passes
at 4.59 — **0.09** above the bar. A token used 242 times sitting nine hundredths
above a compliance floor is a fix with an expiry date: any future surface
darkening breaks it and nothing in the build would catch it.

The cost is a little muted-ness, and it belongs in numbers rather than adjectives.
Against `--text` `#d4d2cc`:

| dark muted | separation from `--text` |
| --- | --- |
| `#78766f` (old, failing) | 3.01 |
| `#8a887f` | 2.35 |
| `#918f86` (taken) | 2.14 |

**Light mode already ships 3.29.** Both candidates land well below it, so neither
meaningfully preserves the separation light mode has — dark muted is inherently
less distinguishable here whichever is picked. Choosing between them moves
separation by **0.21** and headroom by **0.45**. Only one of those is a
compliance risk, so the decision goes to contrast.

Do-not-touch items were **checked rather than assumed**: the Grade gold-set and
wallpaper are gold- and image-driven and do not resolve through this token, and
the homepage feature-grid blurb was inspected in dark after the change with no
layout movement. One declaration changed. No copy, no layout, no light-mode value.

`--text-faint` remains **1.92** in dark across ~61 usages, re-confirmed in the
browser this round. Much larger change, still logged.

---

## Should-fix 2 — row semantics — **not done, and I want to argue the shape first**

I did not convert the fee rows to a native `<table>` with `th scope="row"`, and I
would rather say why than ship it half-considered.

The accepted decision on record is that the **fee breakdown is shaped to grow a
provenance column, with no column header.** That constraint and `th scope="row"`
pull against each other:

- A native table with row headers and **no column headers** is a valid but
  unusual shape, and screen-reader announcement of `scope="row"` in a
  header-less table varies by AT.
- A **definition list** matches the current semantics honestly — each row *is* a
  term/value pair — but a `<dl>` does not grow a third provenance column without
  becoming a layout lie.

So the two candidate shapes disagree about which accepted decision they serve.
Picking one is a real decision, not a refactor, and it belongs to whichever step
actually wires provenance — not to a step-5 correction where I would be guessing
which shape D4 needs.

**What I am asking for:** confirm whether provenance lands as a third column in
this block (which points at the table) or as an expandable per-row disclosure
(which points at the definition list). I will implement it in the step that adds
the column, with reading-order and label/value-association verification, and I
will not touch the compact layout.

If you would rather have the accessibility improvement **now** and accept
reworking it later, say so and I will take the native table with `th
scope="row"`, verify announcement, and log the provenance-column question as a
known follow-up.

---

## Deferred items — confirmed, not reopened

- **D4 sequence kept.** Packet wiring precedes the non-blocking wire contract.
- **No fabricated labels.** `hasPacket` is constant-false; no seller-entered or
  verified-reference labels are derived from it. Its **overstating comment** is
  still there and still logged.
- **Fee verification never implies price verification.** Respected in the pill
  copy.
- **Raw slot consistency.** `ebay:fixed-price` shown exactly as the list shows
  it, no friendly venue label.

---

## D3's closing action, unstarted

The bundle is renamed **once**, at the end of D3. Not started. When it happens:

- **Re-derive the hash from the final bytes.** Never predict it. Re-derive, then
  stamp — never record what a derived value *will be*.
- Update `tools/bundle-citation-map.mjs`; the tables are a cache, the tool is the
  source of truth.
- Retired bundles keep their **original bytes**; never `git mv`.
- `asset-fingerprints` returns to 15/0 as a **consequence**, not as a target.

---

## Push gate — unchanged and binding

> **Do not push before the Cert ID is rotated. Full stop, under either option.**

Gates **pushing only**, not local editing. State:

- eBay **Cert ID** — 36 chars, `sha256[:12] = e3f0a0bc343d`, 0 published blobs.
  **Rotation mandatory. Not done.**
- eBay **App ID** — 40 chars, `sha256[:12] = 9d01f53d45d9`, 1 published blob.
- Credential fragments exist only in **unpushed** history; `94dc777` is
  unreachable from `origin/main`.

Sequence: (1) rotate in the eBay portal → (2) update the Vercel env var in
**both** Production and Preview → (3) confirm `EBAY_LIVE=1 node
tests/ebay-live.mjs` at **19/19** (currently 18/19) → (4) **then** delete
`refs/recovery/pre-scrub-c2366b2` → (5) **never** use the unblock URL.

Steps 2–3 still need the five Vercel dashboard answers.

---

## Open questions for you

1. **Row semantics** — third provenance column, or per-row expandable
   disclosure? The answer picks the markup. Or tell me to take the table now and
   accept rework.
2. **The `accuracy.html` stamp table is a second copy of the audit date.** Now
   correct, but a copy. Do you want it generated from the same source in D3, or
   logged for later?
3. **`FEE_DISCLOSURE` collapsed the copy but not the markup** — the two surfaces
   still render differently. Rule 1's sixth bite. Collapse the render in D3, or
   after the packet wiring in D4?

---

## Patterns added this round

- **An assertion can pin a bug in place.** 'A Top Rated seller keeps strictly
  more' *required* the inheritance that was the bug.
- **Read the category exemptions, not just the headline rule.** The general
  free-returns requirement does not apply to trading cards, and implementing the
  headline would have suppressed a discount sellers are owed.
- **A string where a boolean is expected fails silently and asymmetrically.**
  Grep every caller when a parameter's type changes.
- **A mutation that cannot be observed is not a missing test** — record why,
  in the test file, so it is not read as a gap.
- **A clamp hides a lie**, and **a date we refuse to measure from is a date we
  refuse to show.**
- **A zero is a claim; a parenthetical does not make an unknown amount zero.**
- **Keep the row label stable so a frozen hash stays comparable** — the frozen
  fee hash still matched, which is what proves the arithmetic is byte-identical
  and only the eligibility plumbing moved.
- **Measure contrast, don't eyeball it** — and state the trade-off in numbers.
