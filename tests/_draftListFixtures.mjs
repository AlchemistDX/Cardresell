// tests/_draftListFixtures.mjs — the D2.1 screen's fixtures, GENERATED.
//
// Contract: audit/DRAFT_LIST_API_CONTRACT.md Part 4, "Fixture provenance".
//
// Every envelope in here is whatever `api/drafts.js` actually emitted for a
// seeded scenario. Nothing is hand-written. The rule exists because a
// hand-written fixture that disagrees with the server still fails loudly, but
// it fails as "the screen is broken" — and the repair then changes the screen
// to match the wrong fixture, leaving the suite green against a shape
// production never sends. Green-after-work is worse than green-on-arrival.
//
// It paid for itself on the first run: `readiness` is nested at
// `row.summary.readiness`, not `row.readiness`, and `draftId` appears at both
// levels. Part 2.4 documents that correctly, but case 10's phrase "present on
// every summary row" would have supported a hand-written fixture putting it one
// level too high.
//
// Generated at call time rather than committed as JSON, deliberately: a
// committed artifact can drift from the handler between the day it was written
// and the day someone reads the suite. This cannot.

import {
  SUB, K, store, sets, reset, kv, SVC, DS, EP, input, httpInput, fakeReq, fakeRes, fail,
} from './_draftHarness.mjs';

const call = async (query) => {
  const res = fakeRes();
  await EP.default(fakeReq({ method: 'GET', query }), res);
  return { status: res.statusCode, body: res.body };
};

const draftKeyOf = (id) => `draft:${SUB}:${id}`;

/** Seed n publishable drafts through the real service. */
async function seedPublishable(n, over = () => ({})) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const out = await SVC.createDraft(kv, SUB, input({
      instanceId: `inst_${i}`,
      sku: `v2-SKU${i}-592a391e7b472559`,
      title: `Card number ${i}`,
      price: 400 + i,
      ...over(i),
    }), K(`fx-seed-${i}`));
    ids.push(out.result.draftId);
  }
  return ids;
}

/**
 * Put an id in the index whose stored record produces a given read failure.
 * This is the only way to generate the three non-throwing stub kinds: they are
 * properties of the stored bytes, not of the request.
 */
function plantUnreadable(id, kind) {
  if (!sets.has(`drafts:${SUB}`)) sets.set(`drafts:${SUB}`, new Set());
  sets.get(`drafts:${SUB}`).add(id);
  store.set(`draftquota:${SUB}`, String(sets.get(`drafts:${SUB}`).size));
  store.set(`draftquotafresh:${SUB}`, '1');
  if (kind === 'vanished') {
    store.delete(draftKeyOf(id));                        // indexed, no record
  } else if (kind === 'schemaTooNew') {
    store.set(draftKeyOf(id), JSON.stringify({ schemaVersion: 9999, status: 'draft' }));
  } else if (kind === 'unreadable') {
    store.set(draftKeyOf(id), 'not json at all{{');      // unparseable
  }
}

/**
 * Read-path fixtures for the review screen (`GET /api/drafts?id=`).
 *
 * The review screen's checks lived in a scratch file that hand-wrote its
 * envelope, which Part 4 forbids for exactly the reason above. Generating them
 * costs one function, and it immediately buys the thing a hand-written
 * envelope cannot: whatever `readiness.blockers[n]` actually carries on the
 * read path, including keys nobody remembered to write down.
 */
export async function generateReadFixtures() {
  await reset();

  // Blocked on TITLE: over the slot limit, so the message is the interpolated
  // one ("Shorten it by N") that a client copy table could not reproduce.
  const longIds = await seedPublishable(1, () => ({ title: 'L'.repeat(140) }));
  const blockedTitle = await call({ id: longIds[0] });

  // Blocked on PRICE, a different field, so the screen has to place two
  // findings in two places rather than pile them under one heading.
  await reset();
  const noPriceIds = await seedPublishable(1, () => ({ price: null }));
  const blockedPrice = await call({ id: noPriceIds[0] });

  // Blocked on BOTH, one per field, in a single envelope.
  await reset();
  const bothIds = await seedPublishable(1, () => ({ title: 'B'.repeat(140), price: null }));
  const blockedBoth = await call({ id: bothIds[0] });

  // Clean: no blockers at all, so the fields render with nothing attached.
  await reset();
  const okIds = await seedPublishable(1);
  const publishable = await call({ id: okIds[0] });

  // ── Packet-bearing envelopes ────────────────────────────────────────────
  //
  // Generated through the REAL POST handler with a pricingContext, per the
  // fixture rule: nothing here is hand-written. A hand-built packet would be
  // whatever its author believed the producer emits, and the last time this
  // repo trusted that belief the version field turned out to live somewhere
  // else entirely and every stored packet read back as incompatible.
  //
  // Three states, because the screen has three behaviours:
  //   packetCurrent  — usable; the listing rows and copy buttons render
  //   packetStale    — an edit moved a dependent input; content is WITHDRAWN
  //   packetAbsent   — no packet fields at all; a different message
  await reset();
  // ONE DRAFT PER (instanceId, slot) IS NOW A SERVER RULE (D8). Every fixture
  // below used `httpInput()`'s default instanceId, so the second and later
  // POSTs no longer created anything: the create handler resolved the row,
  // found the FIRST fixture's draft live on it, and returned that draft with
  // existing:true. All the packet fixtures collapsed onto one id --
  // demonstrated: packetShipDeclared, packetShipZero and packetShipUnreadable
  // were the same drf_ id, so the zero-shipping case rendered the $5.99 draft.
  //
  // These fixtures are meant to be DIFFERENT drafts, so each one needs its own
  // row. TWO helpers rather than one with a rule, because the rule is exactly
  // the thing that must not be applied by guesswork:
  //
  //   post(body, key)        sends the body VERBATIM. Whatever instanceId it
  //                          carries is the row it lands on. This is what a
  //                          retry, an adoption or a recreate needs -- the same
  //                          row across different requests and different keys --
  //                          and no scoping is inferred for it.
  //   postOwnRow(body, key)  overrides instanceId with one derived from the
  //                          idempotency key, which is already unique per
  //                          fixture. For independent fixtures only.
  //
  // A single helper that scoped "unless the caller looks like it meant
  // otherwise" would have to recognise a deliberate shared row by its VALUE,
  // and `httpInput()`'s default is indistinguishable from a call that means it.
  // Splitting a row that a test needs shared is the same class of silent defect
  // as the collision this replaced, so the choice is made at the call site.
  const post = async (body, key) => {
    const res = fakeRes();
    await EP.default(fakeReq({
      method: 'POST', body,
      headers: { authorization: 'Bearer ' + 'x'.repeat(40), 'idempotency-key': K(key) },
    }), res);
    return { status: res.statusCode, body: res.body };
  };
  const postOwnRow = async (body, key) => {
    if (!key) throw new Error('postOwnRow needs an idempotency key to derive a row from');
    return post(
      { ...body, instanceId: `inst_${String(key).replace(/[^A-Za-z0-9]+/g, '_')}` },
      key,
    );
  };
  const patch = async (id, body, key) => {
    const res = fakeRes();
    await EP.default(fakeReq({
      method: 'PATCH', query: { id }, body,
      headers: { authorization: 'Bearer ' + 'x'.repeat(40), 'idempotency-key': K(key) },
    }), res);
    return { status: res.statusCode, body: res.body };
  };

  // The retrieval time is FIXED at 12:00 so a test can prove the rebuild did
  // not walk it forward. Nothing downstream may recompute it.
  const PRICING_CONTEXT = {
    feeModelRevision: 1,
    feeScheduleVerified: '2026-09-01',
    basisMeta: {
      label: 'PriceCharting loose',
      sourceUrl: 'https://www.pricecharting.com/x',
      retrievedAt: '2026-09-08T12:00:00.000Z',
      low: 380, mid: 400, high: 430,
    },
  };

  const madeCurrent = await postOwnRow({ ...httpInput(), pricingContext: PRICING_CONTEXT }, 'pkt-current');
  const currentId   = madeCurrent.body.draftId;
  const packetCurrent = await call({ id: currentId });

  // Stale: edit a dependent input WITHOUT a pricingContext, which is the one
  // server rule -- an edit alone never rebuilds. The packet then describes a
  // price the draft no longer holds and the read gate withdraws it.
  await patch(currentId, { price: 555, expectedRev: packetCurrent.body.draft.rev }, 'pkt-stale-edit');
  const packetStale = await call({ id: currentId });

  // ── packetBlocked: current, readable, and NOT fit to list ───────────────
  //
  // A fourth state, and the one the earlier three could not express. This
  // packet is CURRENT and usable -- it is readable and it agrees with the draft
  // -- while carrying an ERROR finding, because the create declared no fee
  // model revision. A packet that cannot say which fee logic priced it is
  // permanently ambiguous, so the producer refuses to call it listable.
  //
  // Produced by POSTing an EMPTY pricingContext through the real handler. The
  // create still succeeds: a blocked packet is a bad snapshot, not a bad draft
  // (see api/drafts.js). Note what the envelope reports -- packetUsable true,
  // readiness.publishable true, zero readiness blockers -- which is exactly why
  // the screen needed a fourth verdict rather than being able to infer this
  // from the three facts it already had.
  const madeBlocked  = await postOwnRow({ ...httpInput(), pricingContext: {} }, 'pkt-blocked');
  const blockedPktId = madeBlocked.body.draftId;
  const packetBlocked = await call({ id: blockedPktId });

  // ── D4 provenance fixtures ──────────────────────────────────────────────
  //
  // The provenance block's states are decided by TWO records that are stored
  // apart: the draft's `priceSource` and the packet's `priceBasis`. A fixture
  // that only varied one of them could not tell "market context beside a
  // seller's price" from "the evidence that set it", which is the distinction
  // the block exists to draw. So each combination is created through the real
  // POST handler, and the hostile URL is stored the same way a client would
  // store it -- unsanitized -- because the client-side rejection is the thing
  // under test and a pre-cleaned fixture would assert nothing.
  const ctx = (basisMeta) => ({
    feeModelRevision: 1, feeScheduleVerified: '2026-09-01',
    ...(basisMeta === undefined ? {} : { basisMeta }),
  });

  const madeSeller = await postOwnRow({ ...httpInput(), priceSource: 'seller', pricingContext: PRICING_CONTEXT }, 'pkt-seller');
  const sellerId = madeSeller.body.draftId;
  const packetSellerPriced = await call({ id: sellerId });

  const madeComp = await postOwnRow({ ...httpInput(), priceSource: 'comp', pricingContext: PRICING_CONTEXT }, 'pkt-comp');
  const compId = madeComp.body.draftId;
  const packetCompPriced = await call({ id: compId });

  // Rebuild the comp-priced draft with NO client basis, which is what the
  // refresh button sends. The stored retrieval time must come back unchanged
  // while `metadata.generatedAt` moves -- the whole point of the display
  // reading one and not the other.
  await patch(compId, { expectedRev: packetCompPriced.body.draft.rev, pricingContext: ctx() }, 'pkt-comp-rebuild');
  const packetCompRebuilt = await call({ id: compId });

  // ── The price edit that must re-attribute ───────────────────────────────
  //
  // A comp-derived draft, then a real PATCH that moves the price AND asks for a
  // rebuild -- the exact sequence a seller performs when they type over a
  // suggested price. The rebuild carries the prior basis forward from the
  // record (api/drafts.js does that, not the client), so the fixture exercises
  // the whole chain: attribution flips to seller, the basis survives as
  // context, and the packet documents the NEW price.
  const madeEdited = await postOwnRow({ ...httpInput(), priceSource: 'comp', pricingContext: PRICING_CONTEXT }, 'pkt-edit');
  const editedId = madeEdited.body.draftId;
  const beforeEdit = await call({ id: editedId });
  await patch(editedId, {
    expectedRev: beforeEdit.body.draft.rev, price: 365, pricingContext: ctx(),
  }, 'pkt-edit-price');
  const packetPriceEdited = await call({ id: editedId });

  // The control: a NOTES-only edit on the same shape. Attribution must not
  // move, because nothing about the price did. Without this the fix could be
  // "any edit means the seller set the price", which is a different lie.
  const madeNotes = await postOwnRow({ ...httpInput(), priceSource: 'comp', pricingContext: PRICING_CONTEXT }, 'pkt-notes');
  const notesId = madeNotes.body.draftId;
  const beforeNotes = await call({ id: notesId });
  await patch(notesId, {
    expectedRev: beforeNotes.body.draft.rev, notes: 'ships Monday', pricingContext: ctx(),
  }, 'pkt-notes-edit');
  const packetNotesEdited = await call({ id: notesId });

  // A feed that CLAIMS to date its own data, with no instant recorded for that
  // claim -- the shape that used to caption our retrieval time as the source's
  // published date.
  const madeDated = await postOwnRow({
    ...httpInput(), priceSource: 'comp',
    pricingContext: ctx({ ...PRICING_CONTEXT.basisMeta, datedBySource: true }),
  }, 'pkt-dated');
  const packetDatedBySource = await call({ id: madeDated.body.draftId });

  // A stored link that must never become an href.
  const madeHostile = await postOwnRow({
    ...httpInput(), priceSource: 'comp',
    pricingContext: ctx({ ...PRICING_CONTEXT.basisMeta, sourceUrl: 'javascript:alert(document.domain)' }),
  }, 'pkt-hostile');
  const packetHostileUrl = await call({ id: madeHostile.body.draftId });

  // Label only -- the real SportsCardsPro shape. No URL, no retrieval time.
  const madePartial = await postOwnRow({
    ...httpInput(), priceSource: 'comp',
    pricingContext: ctx({ label: 'SportsCardsPro loose' }),
  }, 'pkt-partial');
  const packetPartialBasis = await call({ id: madePartial.body.draftId });

  // A 'comp'-derived price with no basis at all: the claim with no evidence.
  const madeNoBasis = await postOwnRow({ ...httpInput(), priceSource: 'comp', pricingContext: ctx() }, 'pkt-nobasis');
  const packetNoBasis = await call({ id: madeNoBasis.body.draftId });

  // Absent: created through the service, which stores no packet at all.
  await reset();
  const bareIds = await seedPublishable(1);
  const packetAbsent = await call({ id: bareIds[0] });

  // ── RC-2: shipping assumptions, created through the real POST handler ────
  //
  // These exist to answer a question the suite totals could not: does a
  // shipping assumption a seller declares at CREATE survive being written,
  // read back, and rendered? Every one of these goes through the real POST and
  // the real read, so what the screen receives is what production would store.
  //
  // Three states, because the display has three behaviours:
  //   packetShipDeclared  — both sides declared, nonzero; rows read back
  //   packetShipZero      — a declared zero, which cannot be told from an
  //                         untouched value="0" input, so it must be marked
  //                         unconfirmed rather than shown as free shipping
  //   packetShipUnreadable — an entry that did not parse, handed back verbatim
  const shipCtx = (shipping) => ({ ...PRICING_CONTEXT, shipping });

  const madeShipDeclared = await postOwnRow(
    { ...httpInput(), pricingContext: shipCtx({ buyerPays: '5.99', sellerCost: '4.50' }) }, 'pkt-ship-declared');
  const shipDeclaredId = madeShipDeclared.body.draftId;
  const packetShipDeclared = await call({ id: shipDeclaredId });

  const madeShipZero = await postOwnRow(
    { ...httpInput(), pricingContext: shipCtx({ buyerPays: '0', sellerCost: '0' }) }, 'pkt-ship-zero');
  const shipZeroId = madeShipZero.body.draftId;
  const packetShipZero = await call({ id: shipZeroId });

  const madeShipUnreadable = await postOwnRow(
    { ...httpInput(), pricingContext: shipCtx({ buyerPays: 'four dollars', sellerCost: '4.50' }) }, 'pkt-ship-unreadable');
  const shipUnreadableId = madeShipUnreadable.body.draftId;
  const packetShipUnreadable = await call({ id: shipUnreadableId });

  return {
    packetShipDeclared, packetShipZero, packetShipUnreadable,
    blockedTitle, blockedPrice, blockedBoth, publishable,
    packetCurrent, packetStale, packetAbsent, packetBlocked,
    packetSellerPriced, packetCompPriced, packetCompRebuilt,
    packetHostileUrl, packetPartialBasis, packetNoBasis,
    packetPriceEdited, packetNotesEdited, packetDatedBySource,
    PRICING_CONTEXT,
    ids: {
      blockedTitle: longIds[0], blockedPrice: noPriceIds[0], blockedBoth: bothIds[0], publishable: okIds[0],
      packetCurrent: currentId, packetStale: currentId, packetAbsent: bareIds[0],
      packetBlocked: blockedPktId,
      packetSellerPriced: sellerId, packetCompPriced: compId, packetCompRebuilt: compId,
      packetHostileUrl: madeHostile.body.draftId,
      packetPartialBasis: madePartial.body.draftId,
      packetNoBasis: madeNoBasis.body.draftId,
      packetPriceEdited: editedId, packetNotesEdited: notesId,
      packetDatedBySource: madeDated.body.draftId,
      packetShipDeclared: shipDeclaredId,
      packetShipZero: shipZeroId,
      packetShipUnreadable: shipUnreadableId,
    },
  };
}

export async function generateFixtures() {
  const fx = {};

  // ── a plain page of publishable rows ──────────────────────────────────────
  reset();
  await seedPublishable(30);
  fx.page1 = await call({});
  fx.page2 = await call({ cursor: String(fx.page1.body.nextCursor) });

  // ── the empty state: total 0 is the ONLY path to it (case 6) ──────────────
  reset();
  fx.empty = await call({});

  // ── blocked rows, one per blocking code, plus a multi-blocker row ─────────
  //
  // Built through the real validator, so `message` is the server's own
  // sentence — including SLOT_TITLE_TOO_LONG's computed "shorten by N", which
  // is the one no client-side copy table could reproduce.
  reset();
  const blocked = {};
  blocked.titleTooLong = (await SVC.createDraft(kv, SUB, input({
    instanceId: 'inst_title', sku: 'v2-TITLE-592a391e7b472559',
    title: 'T'.repeat(140), price: 400,
  }), K('fx-title'))).result.draftId;
  blocked.priceRequired = (await SVC.createDraft(kv, SUB, input({
    instanceId: 'inst_noprice', sku: 'v2-NOPRICE-592a391e7b472559',
    title: 'Unpriced draft', price: null,
  }), K('fx-noprice'))).result.draftId;
  blocked.zeroPrice = (await SVC.createDraft(kv, SUB, input({
    instanceId: 'inst_zero', sku: 'v2-ZERO-592a391e7b472559',
    title: 'Zero priced on eBay', price: 0,
  }), K('fx-zero'))).result.draftId;
  // Two blocking findings about two different fields on one row (case 11).
  blocked.multi = (await SVC.createDraft(kv, SUB, input({
    instanceId: 'inst_multi', sku: 'v2-MULTI-592a391e7b472559',
    title: 'M'.repeat(140), price: 0,
  }), K('fx-multi'))).result.draftId;
  fx.blocked = await call({});
  fx.blockedIds = blocked;

  // ── $0 renders distinctly from absent price (case 1) ─────────────────────
  //
  // whatnot:auction is the one slot with allowsZeroPrice:true
  // (api/_draftStore.js:136), so a $0 draft there is genuinely publishable.
  // This is the f0324d4 regression at list level: `if (!row.price)` marks it
  // as needing a price, because !0 === true.
  reset();
  const zero = {};
  zero.publishableZero = (await SVC.createDraft(kv, SUB, input({
    instanceId: 'inst_wn', sku: 'v2-WN-592a391e7b472559',
    slot: 'whatnot:auction', title: 'Whatnot zero dollar auction',
    price: 0,
  }), K('fx-wn'))).result.draftId;
  zero.absentPrice = (await SVC.createDraft(kv, SUB, input({
    instanceId: 'inst_abs', sku: 'v2-ABS-592a391e7b472559',
    title: 'Absent price draft', price: null,
  }), K('fx-abs'))).result.draftId;
  fx.zeroPrice = await call({});
  fx.zeroPriceIds = zero;

  // ── all four stub kinds on one page (cases 3, 4) ──────────────────────────
  reset();
  const realIds = await seedPublishable(2);
  const stubIds = {
    vanished: DS.newDraftId(),
    schemaTooNew: DS.newDraftId(),
    unreadable: DS.newDraftId(),
    readFailed: realIds[0],
  };
  plantUnreadable(stubIds.vanished, 'vanished');
  plantUnreadable(stubIds.schemaTooNew, 'schemaTooNew');
  plantUnreadable(stubIds.unreadable, 'unreadable');
  // READ_FAILED is the store call THROWING, not bad bytes — the only stub kind
  // that needs failure injection rather than a planted record.
  fail.commands = new Set(['get']);
  fail.keyPrefix = draftKeyOf(stubIds.readFailed);
  fx.stubs = await call({});
  fail.commands = new Set();
  fail.keyPrefix = null;
  fx.stubIds = stubIds;

  // ── a fully tombstoned mid-list page: count 0, nextCursor NOT null ────────
  //
  // Case 5. This is the page that makes `count === 0` an unsafe end-of-walk
  // signal, and the reason the screen must terminate only on nextCursor null.
  // First attempt seeded 30 and emptied offsets 25-29 — the LAST page, where
  // nextCursor is legitimately null, so the fixture proved nothing. The page
  // has to be a middle one for `count === 0` and a non-null nextCursor to
  // coexist, which is the only configuration that makes case 5 bite.
  reset();
  const walkIds = await seedPublishable(60);
  const sorted = [...walkIds].sort();
  // And the ids have to stay INDEXED. deleteDraftOp also de-indexes, which
  // shifts the 55 survivors up and refills offsets 25-29 with live rows —
  // count came back 5, not 0. Rule 2 (drop tombstones from the page) only has
  // something to drop while the index still lists them.
  for (const id of sorted.slice(25, 30)) {
    await SVC.deleteDraftOp(kv, SUB, id, 1, K(`fx-tomb-${id}`));
    sets.get(`drafts:${SUB}`).add(id);
  }
  fx.tombstonedPage = await call({ cursor: '25', limit: '5' });

  // ── focus: the four resolutions ───────────────────────────────────────────
  reset();
  const focusIds = await seedPublishable(60);
  const focusSorted = [...focusIds].sort();
  const midTarget = focusSorted[37];
  fx.focusMidList = await call({ focus: midTarget });
  fx.focusAbsent = await call({ focus: DS.newDraftId() });
  fx.focusInvalid = await call({ focus: 'not-a-draft-id' });
  fx.focusConflict = await call({ focus: midTarget, cursor: '0' });
  fx.focusMidTarget = midTarget;

  // ── the trap: a real offset whose row is gone (case 19) ───────────────────
  //
  // Tombstoned between index write and hydration: focusOffset resolves, the
  // row is filtered out, and the screen must render the saved-may-lag notice
  // rather than an error or a blank.
  //
  // deleteDraftOp removes the id from the index AND tombstones the record, so
  // on its own it produces focusOffset null — an absent id, not the trap. The
  // race being modelled is narrower: the id is still indexed and the record is
  // already gone. Re-adding it after the delete reconstructs that window, the
  // same way tests/draft-focus.mjs:134 does.
  const tombTarget = focusSorted[12];
  await SVC.deleteDraftOp(kv, SUB, tombTarget, 1, K('fx-tomb-focus'));
  sets.get(`drafts:${SUB}`).add(tombTarget);
  fx.focusTombstoned = await call({ focus: tombTarget });
  fx.focusTombstonedTarget = tombTarget;

  // ── degraded: rows AND a banner, never a hidden list (case 8) ────────────
  //
  // Generated by failing the index read so the service falls to its reconcile
  // path, which is what sets degraded on a 200.
  reset();
  await seedPublishable(4);
  fail.commands = new Set(['smembers']);
  const degraded = await call({});
  fail.commands = new Set();
  fx.degraded = degraded;

  // ── the two 503 shapes (case 7) ──────────────────────────────────────────
  //
  // Both must render "couldn't load", never "you have no drafts". They are
  // distinguished by the presence of `retryable`, not by the status.
  reset();
  await seedPublishable(3);
  fail.commands = new Set(['smembers', 'scan']);
  fx.unavailableRetryable = await call({});
  fail.commands = new Set();

  // ── create: fresh, replay, and the degraded/repairRequired replay ─────────
  //
  // Cases 9, 14, 21, 22. The replay must carry the IDENTICAL draftId, and a
  // 200 must be treated as success.
  reset();
  await seedPublishable(30);
  const idem = K('fx-create-once');
  const CARDX = {
    game: 'pokemon', set_name: 'Champions Path', card_number: '074/073',
    card_name: 'Charizard VMAX', rarity: 'Secret Rare', language: 'en',
  };
  const post = async () => {
    const res = fakeRes();
    await EP.default(fakeReq({
      method: 'POST',
      body: { card: CARDX, instanceId: 'inst_created', slot: 'ebay:fixed-price', price: 999 },
      headers: { authorization: 'Bearer ' + 'x'.repeat(40), 'idempotency-key': idem },
    }), res);
    return { status: res.statusCode, body: res.body };
  };
  fx.createFresh = await post();
  fx.createReplay = await post();
  // The list the screen would then request, focused on the created id.
  if (fx.createFresh.body && fx.createFresh.body.draftId) {
    fx.createFocusList = await call({ focus: fx.createFresh.body.draftId });
  }

  return fx;
}
