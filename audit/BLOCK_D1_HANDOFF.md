# Block D1 Review Packet — the Sell entry point

**Commit:** `2726f32` · **Date:** 2026-09-06 · **Suite:** 23/23 green, 0 failed
**Reviewer format:** blocker / should-fix / deferred

---

## What D1 was supposed to do

From `PHASE1_CHECKLIST_2026-09-05.md` § Block D:

| | Task | Done when |
|---|---|---|
| D1 | "Sell" entry point on scan result and collection rows | Appears only when identity is sufficient to build a packet |

That "done when" is the whole design constraint. A Sell button that appears and
then fails is worse than no button, because the seller learns the product is
broken rather than learning what their card is missing.

---

## The one decision everything else follows from

**The button is not drawn from a client-side check.**

The obvious implementation is three lines in `core.js`:

```js
if (card.game && card.set && card.number) showSellButton();
```

That would work on the day it was written and would be a second implementation
of identity sufficiency. The first time the server's rule changed — a new game
needing a language axis, say — the button would keep appearing and the create
would start refusing. The symptom is a button that does nothing, which is the
hardest class of bug to get reported.

So the flow is: `core.js` asks `/api/sell-eligibility`, which calls
`sellStamp()` in `api/_sellEligibility.js`, which is the same function
`normalizeCreateInput` in `api/drafts.js` refuses on.

`tests/sell-eligibility.mjs` asserts they cannot diverge — it calls
`EP.normalizeCreateInput` and `SELL.sellStamp` on the same rows and fails if the
gate and the create ever disagree. That test is the actual load-bearing part of
this block.

One further guard inside the stamp: `eligible` delegates to
`hasSufficientIdentity(row)`, **not** to `missing.length === 0`. If someone adds
a required axis to `hasSufficientIdentity` and forgets to add its reason code to
`missingIdentityAxes`, the stamp goes ineligible with a generic message. It
never goes eligible with an empty list. The failure mode is a vague sentence,
not a dead button.

---

## Files

| File | Status | What it is |
|---|---|---|
| `api/_sellEligibility.js` | new, ~110 lines | Single owner of "can this row start a draft?" |
| `api/sell-eligibility.js` | new, 94 lines | `POST` batch endpoint, auth required |
| `tests/sell-eligibility.mjs` | new | 37 passed / 0 failed, includes the drift test |
| `api/drafts.js` | modified | Create contract: client names the card, server derives sku + title |
| `api/_cardIdentity.js` | modified | Reads both clients' field spellings |
| `index.html` | modified | `#crSellRow` / `#crSellBlocked` above the outbound CTAs |
| `js/core.569ff536.js` | modified | Gate, batch fetch, one shared create call |
| `tests/draft-list-cap.mjs` | modified | HTTP payload updated to the new create contract |
| `tests/run-all.sh` | modified | 22 → 23 steps |

---

## Decisions worth arguing with

### 1. Auth is required to answer "can I sell this?"

The endpoint 401s without a bearer token. That means a signed-out visitor
browsing the Collection sees no Sell button at all.

Rationale: creating a draft needs a verified sub. A button that always ends at a
sign-in wall is a dark pattern with extra steps. Signed-out gets a true
sentence — "Sign in to start a listing for this card." — in the button's place,
so nothing is silently missing.

The counter-argument is real: eligibility is a property of the card, not the
viewer, and a signed-out seller might want to know their card is listable before
committing to an account. I chose the honest-refusal path over the
tease-then-wall path. Worth a reviewer's opinion.

### 2. Response stamping was built, then reverted

The first implementation embedded a stamp in the `/api/scan` and
`/api/collection` responses — no extra round trip.

It was reverted on discovering that `renderCollectionView()` (core.js:8922)
reads `loadPortData()` → `localStorage`. **The rendered Collection never passes
through `/api/collection` at all.** Response stamps would have covered some rows
and not others, and the client would have needed both a read-it-off-the-row path
and an ask-the-server path — two implementations, chosen by accident of which
screen you came from.

One path, asked for. Response-embedded stamps become correct in Phase 2, once
the card object is threaded end to end. Rationale is recorded in the
`_sellEligibility.js` header so the next person doesn't rediscover it.

### 3. An oversized batch is refused, not truncated

`MAX_ROWS = 500`, matching the Pro collection cap. Over that, the endpoint
returns `ROWS_TOO_MANY` rather than stamping the first 500.

A truncated answer reads to the UI as "those cards can't be sold." Chunking is
the client's job and `fetchSellStamps` does it.

### 4. `_cardIdentity` was widened rather than adding a client translator

The live scan panel spells fields `name` / `setName`. A saved Collection row
spells them `card` / `set`. The API tests use `card_name` / `set_name`.

The alternative was a `toServerRow()` helper in `core.js`. That helper is a
translation layer, and a translation layer is the second implementation of
identity in disguise — it decides what counts as a set, which is exactly the
decision `_cardIdentity` exists to own.

So the server reads all the spellings. Two safety pins in
`tests/sku-identity.mjs` (85 passed, re-verified): `setCode` still wins over any
set-name spelling, and `displayName` is display-only and outside the SKU, so
widening it cannot move a SKU.

### 5. Both entry points share one create call

The first cut of the client block had `startListingDraft()` and
`startListingDraftForEntry()` each with their own `fetch('/api/drafts')` and
their own full status ladder. I caught it before commit and extracted
`_crCreateDraft()`.

Flagging it because it is the fourth-plus time this shape has appeared in this
codebase (fee model, normalization, delete, authoritative draft record). The two
copies would have drifted the first time a status code changed.

---

## Blockers

**None known.** Suite 23/23, browser QA green across four panel states and both
collection row states.

---

## Should-fix

**S1 — `instanceId` for an unsaved scan is a hash, not an instance.**
A saved Collection row is a real physical copy, so `inst_col_<row.id>` is a
genuine per-copy key. The scan panel has no such copy: the card is in the
seller's hand, not their inventory. There, `instanceId` is `inst_<djb2 of the
identity fields on screen>`.

Consequences are bounded — it is a de-dup token, never stored as identity, never
used to price or title anything. Worst case is a duplicate draft the seller can
discard, not a wrong number presented as authoritative. But it is not what
`instanceId` means, and two different PSA 9s scanned in sequence would collide
onto one token. The real fix is an inventory instance minted when a card is
taken in hand, which is Block E. Named here rather than quietly settled.

**S2 — four inline copies of the token force-refresh dance in `core.js`.**
`_crIdToken()` is the extracted version and the new D1 calls use it, so there
isn't a fifth. The existing four live in billing and portal paths and were left
alone: retrofitting them means touching payment flows that this block cannot
test. Should be a dedicated change with its own verification.

**S3 — the disabled 🛠️ in a collection row carries its reason in a `title`.**
A table row has no space for a sentence, so an ineligible row shows a faint
disabled 🛠️ whose tooltip names the missing axis, and tapping it toasts the full
message. It is not silently omitted, but a tooltip is weak discovery on touch.
D3's review screen is where a missing field gets named properly; this is the
dense-table compromise until then.

**S4 — the slot is hardcoded to `ebay:fixed-price`.**
Not a preference yet. Choosing among venues is the Block D venue step, and
rendering a picker here that only has one real option would be a control that
does nothing. eBay is the first integration, not the destination.

---

## Deferred (with reasons, not as a backlog dump)

**D-1 — client-supplied `price` is a declared trust boundary.**
`price` and `priceSource` come from the client. The one implementation of price
basis genuinely lives in `core.js` (`window._crBasis`, `getEffectivePrice()`),
and reimplementing it server-side would be the fifth instance of the exact
mistake this design is avoiding.

What the server does enforce: `priceSource` is **never defaulted** — a missing
one is refused — and `PRICE_SOURCE.SELLER` records `DRAFT_PRICE_SELLER_ENTERED`
(INFO) so a seller-typed number can never later be presented as a comp. The
resolution is moving the basis behind a server API in Phase 2, not adding a
second basis now.

**D-2 — no dedupe on `instanceId` + `slot` at create.**
`createDraft` does not refuse a second draft for the same instance and slot; the
`Idempotency-Key` is the only guard, and it holds for a double tap or a retry
after a dropped response, not for a deliberate second click a day later. Whether
one instance may hold two drafts for the same slot is an inventory question, not
a UI one.

**D-3 — the WARNING-tier stale-quote threshold is still undecided.**
Deliberately. It will be a function of pricing source, category, liquidity and
confidence, and picking one universal hour count now would be inventing a number
to make a lint rule pass.

---

## Verification

```
LOCAL_ONLY=1 bash tests/run-all.sh     → 23/23, ALL CHECKS PASSED
tests/sell-eligibility.mjs             → 37 passed, 0 failed   (new)
tests/sku-identity.mjs                 → 85 passed, 0 failed   (re-verified after the widening)
tests/listing-packet-offline.mjs       → 138 passed, 0 failed  (re-verified)
tests/draft-crud-e2e.mjs               → 98 passed, 0 failed
tests/draft-list-cap.mjs               → 129 passed, 0 failed  (payload updated to the new contract)
tests/draft-index-recovery.mjs         → 258 passed, 0 failed  (3 expected-fail lines are the guard proving it fires)
```

**Browser QA** (Playwright, `js_repl`, local server):

| State | Result |
|---|---|
| Server unreachable | Row hidden, "Couldn't check whether this card is ready to list." |
| Signed out | Row hidden, "Sign in to start a listing for this card." |
| Eligible | Button shown, enabled, `_crSellApproved` set |
| Refused | Row hidden, reason names the missing axis, `_crSellApproved` cleared |
| Collection, eligible row | Blue 🛠️ List button beside the existing 🎉 Sold |
| Collection, refused row | Disabled faint 🛠️, tooltip names the missing axis |
| Layout | No overflow, no wrap, existing Sold/refresh/remove actions intact |

Zero page errors. The panel button was restyled blue mid-QA: it was rendering in
the same red as "Sell on eBay" and "Sell on TCGplayer", and those two hand the
seller to someone else's wizard while this one keeps them here. Three
identical-looking CTAs with opposite consequences is a hierarchy failure.

---

## A caught regression worth recording

`tests/draft-list-cap.mjs` went red — 4 failures — on the full run. The cap test
posts to the HTTP endpoint with a client-supplied `sku` and `title`, which the
new create contract refuses outright. Its intent (a create at the cap is 409) is
unchanged; its payload predated the contract.

Recording it because the failure looked like a cap bug and was a contract
change. Fixed by giving the file an `httpInput()` matching the endpoint contract
while `input()` stays correct for direct `SVC.createDraft` calls, which take an
already-normalized record. Same split as `draft-crud-e2e.mjs`.

---

## Not deployed

Eighteen-plus commits remain unpushed; production still runs Phase 0. The deploy
gate is unchanged and still open: `EBAY_LIVE=1 node tests/ebay-live.mjs` sits at
18 pass / 1 fail, and the failing test is fixed by an unpushed commit — pushing
is what makes it green. Sequence remains deploy → prod smoke → live eBay harness
**19/19 or rollback** → rerun the gated real-KV suite.

No deploy without explicit confirmation.

---

# Questions for the reviewer

These are the places I made a call that could reasonably go the other way. I'd
rather hear you disagree than have you validate my framing.

**Q1 — Should eligibility require auth at all?**
Right now `/api/sell-eligibility` 401s without a bearer token, so a signed-out
visitor browsing the Collection sees no Sell button — just "Sign in to start a
listing for this card."

My reasoning: creating a draft needs a verified sub, so a button that always
ends at a sign-in wall is a dark pattern with extra steps.

The counter-argument I can't dismiss: eligibility is a property of the card, not
the viewer. A signed-out seller might reasonably want to know their card is
listable *before* committing to an account, and "this card is ready to list —
sign in to start" is arguably a better conversion moment than a flat refusal.
This is a product call dressed as a security one. Which way would you go?

**Q2 — Is the scan-panel `instanceId` acceptable as a temporary shape?**
A saved Collection row is a real physical copy, so `inst_col_<row.id>` is a
genuine per-copy key. The scan panel has no copy — the card is in the seller's
hand, not their inventory — so `instanceId` there is `inst_<djb2 hash of the
identity fields on screen>`.

I argued it's bounded: it's a de-dup token, never stored as identity, never used
to price or title anything, worst case a duplicate draft the seller discards.
But two different PSA 9s of the same card scanned in sequence collide onto one
token, and `instanceId` does not mean what it says here. Is "bounded consequences,
real fix in Block E" good enough, or is a wrong-meaning field worse than an
absent one?

**Q3 — Is the tooltip refusal in a collection row a cop-out?**
Block D's constraint is that every missing field is *named, not counted*. On the
card panel I have room for a full sentence. In a 9-column table row I don't, so
an ineligible row shows a faint disabled 🛠️ whose `title` names the missing axis,
and tapping it toasts the full message.

That satisfies the letter of "not silently omitted." I'm not sure it satisfies
the intent, and tooltips are close to useless on touch. Alternatives I
considered and rejected: a 10th column (widens an already-dense table), an
inline reason under the card name (breaks the row grid), no indicator at all
(violates the constraint). Is there a fourth option I'm not seeing?

**Q4 — Am I wrong that the client should own price?**
`price` and `priceSource` come from the client, and I've called that a declared
trust boundary rather than fixing it. My reasoning is that the one implementation
of price basis genuinely lives in `core.js` (`window._crBasis`,
`getEffectivePrice()`), and reimplementing it server-side would be the fifth
instance of the duplicate-implementation mistake this whole design is avoiding.

What the server does enforce: `priceSource` is never defaulted (a missing one is
refused), and a seller-entered price records `DRAFT_PRICE_SELLER_ENTERED` so it
can never later be presented as a comp.

But a client-supplied price on a listing draft is a real trust boundary and I've
chosen to document it rather than close it. Is deferring to Phase 2 right, or
does this need closing before Block D ships?

---

# Ideas I'm weighing for D2 (not yet built — tell me if any are wrong)

**I1 — The draft list must not be labelled "Recent."**
`DRAFT_LIST_API_CONTRACT.md` freezes the paging behaviour, and page 1 is *not*
the newest 25. D2 must not label it "Recent" or "Latest", must not expect a new
draft at `rows[0]`, and must navigate by id after a create. I'm noting it here
because it's the kind of contract detail that gets violated by a well-meaning
UI copy change six weeks later.

**I2 — Should a create navigate straight into the draft?**
Right now `_crCreateDraft` stashes `window._crLastDraftId` and toasts. Once D2
exists, the obvious move is to jump into the new draft. But a seller scanning a
stack of cards wants to keep scanning, not get yanked into a review screen every
time. My instinct is toast + a persistent "3 drafts waiting" affordance, and
never auto-navigate. Reasonable?

**I3 — The replay case currently says "You already have a draft for this card."**
That fires on a 200 (idempotent replay). It's accurate, but it reads as an error
when it's actually the system working correctly — the seller double-tapped and
we protected them. Might be better as silent success, or as "Opened your
existing draft" once D2 can actually open it.

**I4 — Duplicate drafts for one instance are currently allowed.**
`createDraft` does not refuse a second draft for the same `instanceId` + `slot`;
the `Idempotency-Key` only guards a double tap or a retry after a dropped
response, not a deliberate second click tomorrow. Whether one physical copy may
hold two drafts for the same venue is an inventory question I haven't answered.
Leaning "no, refuse it and offer to open the existing one" — but that's a rule
with real consequences and I'd like a second opinion before encoding it.

---

# Source: `api/_sellEligibility.js`

The single owner of "can this row start a listing draft?" — the button gate
and the create path both call `sellStamp()` from here.

```js
// ── Can this row start a listing draft? ──────────────────────────────────────
//
// One owner, because the alternative was going to be two.
//
// D1 says the Sell entry point "appears only when identity is sufficient to
// build a packet". The browser is the thing that has to decide whether to draw
// a button, and the rule lives in `hasSufficientIdentity()` on the server. The
// obvious shortcut is to write `if (game && set && number)` in core.js — four
// tokens, reads fine, and it is a SECOND implementation of identity
// sufficiency. This codebase has been bitten four times by exactly that shape
// (fee model, normalization, delete, authoritative draft record), and the
// second copy always looked too small to matter at the time.
//
// So the rule stays here, on the server, and the browser is told the ANSWER
// rather than the inputs. The button is drawn from a server stamp and from
// nothing else.
//
// One transport, deliberately. The first cut of this also stamped `sell` onto
// every scan and collection response, which is free and saves a round trip.
// It was reverted before shipping: the rendered Collection reads from
// localStorage, not from /api/collection, so response stamps would have
// covered only some rows and the UI would have needed BOTH a
// read-it-off-the-row path and an ask-the-server path. Two code paths to learn
// one answer is how they drift. Response-embedded stamps become the right
// optimization once the card object is threaded end to end; that is a Phase 2
// change, not a D1 one.
//
// The reasons are codes, not sentences, for the same reason draft violations
// are: copy changes without the machine reason changing, and a screen that
// shows a raw code is a screen that made the seller guess.

import { identityAxes, hasSufficientIdentity } from './_cardIdentity.js';

export const SELL_BLOCKED = {
  NO_GAME:   'SELL_NEEDS_GAME',
  NO_SET:    'SELL_NEEDS_SET',
  NO_NUMBER: 'SELL_NEEDS_NUMBER',
  NO_ROW:    'SELL_NEEDS_CARD',
};

/**
 * Which identity axes are missing, in the order a seller would fix them.
 *
 * Deliberately a LIST and not a count. "2 fields missing" makes the seller
 * hunt; "needs the set and the card number" is actionable. Same rule the
 * review screen follows for missing fields.
 */
export function missingIdentityAxes(row) {
  if (!row || typeof row !== 'object') return [SELL_BLOCKED.NO_ROW];
  const a = identityAxes(row);
  const missing = [];
  if (!a.game || a.game === 'unknown') missing.push(SELL_BLOCKED.NO_GAME);
  if (!a.set) missing.push(SELL_BLOCKED.NO_SET);
  if (!a.number) missing.push(SELL_BLOCKED.NO_NUMBER);
  return missing;
}

/** Seller-facing sentence for a blocked axis. */
export function sellBlockedMessage(code) {
  switch (code) {
    case SELL_BLOCKED.NO_GAME:
      return 'We could not tell which game this card is from.';
    case SELL_BLOCKED.NO_SET:
      return 'We could not read the set this card belongs to.';
    case SELL_BLOCKED.NO_NUMBER:
      return 'We could not read the card number.';
    case SELL_BLOCKED.NO_ROW:
      return 'No card details to list.';
    default:
      // Never echo an unknown code at a seller. An unrecognised reason is a
      // bug in this module, and the seller should see a sentence either way.
      return 'This card needs a few more details before it can be listed.';
  }
}

/**
 * The stamp that travels with every row.
 *
 * `eligible` is the whole contract as far as the UI is concerned. `missing`
 * and `message` exist so an ineligible row can explain itself instead of the
 * button quietly not being there — a seller who scanned a card and sees no
 * Sell option should be told why, in the same place they were expecting the
 * button.
 *
 * Note it delegates the boolean to `hasSufficientIdentity` rather than
 * deriving it from `missing.length === 0`. Those two are the same today. If
 * they ever stop being the same, the packet builder's rule is the one that
 * matters, because it is the thing that will actually refuse — and this stamp
 * promising a button that the create then rejects is worse than no button.
 */
export function sellStamp(row) {
  const eligible = hasSufficientIdentity(row);
  const missing  = eligible ? [] : missingIdentityAxes(row);
  return {
    eligible,
    missing,
    message: eligible ? null : sellBlockedMessage(missing[0]),
  };
}

/** Stamp a list of rows in place-safe fashion, returning new objects. */
export function stampRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => (r && typeof r === 'object' ? { ...r, sell: sellStamp(r) } : r));
}
```

---

# Source: `api/sell-eligibility.js`

The batch endpoint. Positional response, auth required, refuses an oversized
batch rather than truncating it.

```js
// /api/sell-eligibility — is this row far enough along to start a listing?
//
// ── Why this endpoint exists at all ──────────────────────────────────────────
//
// Scan results are stamped server-side on the way out (api/scan.js), so the
// Sell button on a fresh scan needs nothing from here. The Collection view is
// the awkward case: it renders from `loadPortData()`, which is localStorage —
// `cardsell_portfolio` — so those rows never passed through a server response
// and carry no stamp.
//
// That leaves three options and only one of them is acceptable:
//
//   1. Write `if (game && set && number)` in core.js. Four tokens, reads fine,
//      and it is a second implementation of identity sufficiency. This repo has
//      been bitten four times by exactly that shape and every one of them
//      looked this harmless.
//   2. Migrate the Collection to the server. Correct eventually, not a D1
//      change, and it would put a storage migration inside a UI block.
//   3. Ask the server for the answer. Forty lines, one rule, no drift.
//
// So: three.
//
// ── Why it requires a token ─────────────────────────────────────────────────
//
// The computation itself is harmless — it reads client-supplied fields and
// returns booleans, touching no stored data. Auth is here because the ANSWER is
// only actionable when signed in: creating a draft needs a verified sub, so a
// Sell button drawn for an anonymous visitor is a button that cannot work.
// Refusing here means the anonymous Collection view (which is deliberately
// allowed to render) simply has no Sell entry point, which is the correct
// outcome rather than a coincidental one.

import { verifyTokenFlexible } from './_verifyToken.js';
import { stampRows } from './_sellEligibility.js';

// One request covers a maxed-out Pro collection (500). Chunking is the
// client's problem above that, and it is told the limit rather than having the
// tail of its list silently dropped.
export const MAX_ROWS = 500;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  // Pure function of the request body — but the body is user card data, so it
  // stays out of shared caches.
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ error: 'Sign in to list a card.' });
  }

  // `info.uid` is the field, matching api/drafts.js. _verifyToken deliberately
  // never returns the Google sub, so reading `.sub` here would silently 401
  // every signed-in seller.
  let uid;
  try {
    const info = await verifyTokenFlexible(token);
    uid = info && info.uid;
  } catch {
    uid = null;
  }
  if (!uid) {
    return res.status(401).json({ error: 'Session expired. Sign in again.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const rows = body.rows;
  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'rows must be an array.', code: 'ROWS_REQUIRED' });
  }
  if (rows.length > MAX_ROWS) {
    // Refuse rather than truncate. A truncated answer would leave the tail of
    // the collection with no Sell button and no reason given, which reads as
    // "those cards can't be sold".
    return res.status(400).json({
      error: `Too many rows in one request (max ${MAX_ROWS}).`,
      code:  'ROWS_TOO_MANY',
      maxRows: MAX_ROWS,
    });
  }

  // Positional: stamps[i] describes rows[i]. The client holds the rows; sending
  // them back would double the payload for no gain, and echoing user card data
  // is a habit worth not forming.
  const stamps = stampRows(rows).map((r) => (r && r.sell) || { eligible: false, missing: [], message: null });

  return res.status(200).json({ stamps, count: stamps.length });
}
```

---

# Source: `tests/sell-eligibility.mjs`

The proof. The last section is the drift test: it calls the create
normalizer and the button gate on the same rows and fails if they ever
disagree. If you only read one thing in this handoff, read that.

```js
// tests/sell-eligibility.mjs
//
// D1's gate. The point of this suite is not that the boolean is right — it is
// that there is exactly ONE boolean, and the two places that consume it cannot
// drift apart. The Sell button is drawn from the stamp; the create refuses on
// the same rule. A test that only checked the stamp would let the create
// diverge and the failure would look like "the button does nothing".

import { harness } from './_assert.mjs';

const { check, done } = harness('sell-eligibility');

const SELL  = await import('../api/_sellEligibility.js');
const IDENT = await import('../api/_cardIdentity.js');
const TITLE = await import('../api/_listingTitle.js');
const EP    = await import('../api/drafts.js');

const CARD = () => ({
  game: 'pokemon', set_name: 'Champions Path', card_number: '074/073',
  card_name: 'Charizard VMAX', rarity: 'Secret Rare', language: 'en',
});

console.log('\na complete card is sellable');
{
  const st = SELL.sellStamp(CARD());
  check('eligible', st.eligible === true);
  check('nothing is named as missing', st.missing.length === 0);
  check('and no message is invented for a card that is fine', st.message === null);
}

console.log('\nthe stamp names what is missing, and does not count it');
for (const [drop, code] of [
  ['set_name',    SELL.SELL_BLOCKED.NO_SET],
  ['card_number', SELL.SELL_BLOCKED.NO_NUMBER],
]) {
  const row = CARD(); delete row[drop];
  const st = SELL.sellStamp(row);
  check(`missing ${drop} blocks the sell entry point`, st.eligible === false);
  check(`and names it as ${code}`, st.missing.includes(code));
  check(`and carries a sentence a seller can act on`,
        typeof st.message === 'string' && st.message.length > 0);
}

console.log('\nmore than one missing axis is listed, not summarised');
{
  const row = CARD(); delete row.set_name; delete row.card_number;
  const st = SELL.sellStamp(row);
  check('🔴 both axes are named', st.missing.length === 2,
        '"2 fields missing" makes the seller hunt; naming them is actionable');
}

console.log('\nno row at all is a refusal, not a crash');
for (const bad of [null, undefined, 'charizard', 42, []]) {
  const st = SELL.sellStamp(bad);
  check(`${JSON.stringify(bad)} is not eligible`, st.eligible === false);
  check(`and still produces a message`, typeof st.message === 'string');
}

console.log('\nan unknown reason code still yields a sentence');
check('🔴 a code this module does not recognise never reaches a seller raw',
      !SELL.sellBlockedMessage('SELL_SOMETHING_NEW').includes('SELL_'),
      'showing a raw code is a screen that made the seller guess');

console.log('\nthe stamp agrees with the packet builder, on every shape');
{
  // The whole reason the stamp exists is to avoid a second copy of this rule.
  // If it ever disagrees with hasSufficientIdentity, the button promises a
  // create that then refuses — which is worse than no button.
  const rows = [
    CARD(),
    { ...CARD(), set_name: '' },
    { ...CARD(), card_number: '' },
    { ...CARD(), game: 'unknown' },
    { ...CARD(), game: '' },
    { game: 'mtg', set_name: 'Alpha', card_number: '1' },
    {},
  ];
  let agree = 0;
  for (const r of rows) {
    if (SELL.sellStamp(r).eligible === IDENT.hasSufficientIdentity(r)) agree++;
  }
  check('🔴 stamp and hasSufficientIdentity agree on all sample rows',
        agree === rows.length,
        `${rows.length - agree} disagreed — the button and the create would diverge`);
}

console.log('\nstampRows leaves the row otherwise untouched');
{
  const rows = [CARD(), { ...CARD(), set_name: '' }];
  const out  = SELL.stampRows(rows);
  check('every row is stamped', out.every((r) => r && r.sell));
  check('the first is eligible', out[0].sell.eligible === true);
  check('the second is not',    out[1].sell.eligible === false);
  check('🔴 the original rows are not mutated',
        rows[0].sell === undefined,
        'stamping in place would write the flag into the stored collection blob');
  check('the card fields survive', out[0].card_name === 'Charizard VMAX');
  check('a non-object row is passed through rather than crashing the list',
        SELL.stampRows([null, 'x'])[0] === null);
  check('a non-array is an empty list, not a throw', SELL.stampRows(null).length === 0);
}

console.log('\nboth client row shapes are accepted without translation');
{
  // The Collection row (saved) spells these card/set/number. The live scan
  // panel object spells them name/setName/number. Neither client should have to
  // rewrite a row on its way to the server, so the server reads both.
  const saved = { game: 'pokemon', card: 'Charizard VMAX', set: 'Champions Path', number: '074/073', rarity: 'Secret Rare' };
  const live  = { game: 'pokemon', name: 'Charizard VMAX', setName: 'Champions Path', number: '074/073', rarity: 'Secret Rare' };

  check('the saved Collection row shape is sellable', SELL.sellStamp(saved).eligible === true);
  check('🔴 the live scan panel row shape is sellable too',
        SELL.sellStamp(live).eligible === true,
        'if this fails, the Sell button never appears on a fresh scan');

  const t1 = TITLE.buildListingTitle(saved, { maxLength: 80 });
  const t2 = TITLE.buildListingTitle(live,  { maxLength: 80 });
  check('a title builds from the saved shape', t1.ok === true);
  check('🔴 a title builds from the live shape as well', t2.ok === true,
        `reason: ${t2.reason} — a Sell button whose create dies on NO_CARD_NAME`);
  check('and both produce the same title', t1.title === t2.title);

  // The widened reads are display-only plus a set-axis fallback. A row that was
  // already identifiable must keep its SKU, or existing drafts orphan.
  check('🔴 setCode still wins over any set name spelling',
        IDENT.skuFor({ ...saved, setCode: 'swsh35' }) === IDENT.skuFor({ ...live, setCode: 'swsh35' }),
        'the stable machine id must not be displaced by a display string');
  check('a display name is not part of the SKU',
        IDENT.skuFor(saved) === IDENT.skuFor({ ...saved, card: 'Charizard VMAX (Alt Art)' }));
}

console.log('\nthe create refuses exactly what the stamp refuses');
{
  // This is the drift test. Same rows, both sides.
  const rows = [
    CARD(),
    { ...CARD(), set_name: '' },
    { ...CARD(), card_number: '' },
    { ...CARD(), game: 'unknown' },
  ];
  let agree = 0;
  for (const card of rows) {
    const stampSaysOk = SELL.sellStamp(card).eligible;
    let createSaysOk = true;
    try {
      EP.normalizeCreateInput({ card, instanceId: 'inst_1', slot: 'ebay:fixed-price', price: 10 });
    } catch (e) {
      // Only an identity refusal counts as the create saying "no" here.
      if (e.message.startsWith('DRAFT_FIELD_INVALID:card:')) createSaysOk = false;
      else throw e;
    }
    if (stampSaysOk === createSaysOk) agree++;
  }
  check('🔴 the button gate and the create gate never disagree',
        agree === rows.length,
        `${rows.length - agree} row(s) would show a Sell button whose create refuses`);
}

done();
```
