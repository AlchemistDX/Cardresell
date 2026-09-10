/**
 * D1 — out-of-order eligibility responses must never decorate the wrong card.
 *
 * The reviewer's scenario: card A is asked about and answers slowly, the panel
 * moves to card B, B is refused quickly, then A's "eligible" lands last. A
 * boolean flag would light up a Sell button on a card that was just refused.
 *
 * These tests run against the SHIPPED client source rather than a copy of it.
 * core.js is a classic script, not a module, so the D1 block is sliced out by
 * its banner comment and evaluated in a node:vm sandbox with a small DOM stub.
 * That costs a stub but buys the thing that matters: if someone edits the real
 * generation logic, this file fails. A reimplementation in the test would pass
 * forever while the app broke — the same duplicate-implementation trap this
 * block has been avoiding all the way down.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { harness } from './_assert.mjs';
import { readCoreBundle } from './_assetRefs.mjs';

const { check, done } = harness('sell-gate-ordering');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Slice the D1 block out of the shipped file ──────────────────────────────
const SRC = readCoreBundle().source;
const MARK = 'D1 — THE LISTING DRAFT ENTRY POINT';
const at = SRC.indexOf(MARK);
check('the D1 block is still findable in core.js', at > 0,
      'if this fails the banner moved and this whole file is testing nothing');
const BLOCK = SRC.slice(SRC.lastIndexOf('/*', at));

// ── The smallest DOM that the block actually touches ────────────────────────
function fakeEl(id) {
  const el = {
    id, _text: '', disabled: false, style: { cssText: '', display: '' },
    children: [], attrs: {},
    set textContent(v) { this._text = String(v); this.children = []; },
    get textContent() { return this._text; },
    set innerHTML(v) { this._text = String(v); this.children = []; },
    get innerHTML() { return this._text || this.children.map((c) => c.textContent).join(''); },
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    querySelector(sel) {
      const want = String(sel).replace(/[[\]]/g, '').split('=')[0];
      return this.children.find((c) => want in c.attrs) || null;
    },
    focus() {},
  };
  return el;
}

function makeSandbox() {
  const els = new Map();
  for (const id of ['crSellRow', 'crSellBlocked', 'crSellBlockedMsg', 'crSellBtn', 'crSellBtnLabel']) {
    els.set(id, fakeEl(id));
  }
  const toasts = [];
  const win = { _googleIdToken: 'tok-1', _ovAutoFilled: false };
  const sandbox = {
    window: win,
    document: {
      getElementById: (id) => els.get(id) || null,
      createElement: (t) => Object.assign(fakeEl('new-' + t), { tagName: t }),
    },
    fetch: async () => { throw new Error('no fetch stub installed'); },
    crypto: { randomUUID: () => 'uuid-' + Math.random().toString(16).slice(2) },
    showToast: (m) => toasts.push(m),
    loadPortData: () => [],
    renderCollectionView: () => {},
    getEffectivePrice: () => 10,
    selectedCard: null,
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(BLOCK, sandbox);
  return { sandbox, els, toasts, win };
}

const CARD_A = { game: 'pokemon', set: 'Champions Path', number: '074/073', card: 'Charizard VMAX' };
const CARD_B = { game: 'pokemon', set: 'Base Set',       number: '004/102', card: 'Charizard' };

const STAMP_OK   = { eligible: true,  missing: [], message: null };
const STAMP_NO   = { eligible: false, missing: ['SELL_NEEDS_NUMBER'], message: 'We could not read the card number.' };

/** A fetch stub whose resolution is controlled by the test, not by timing. */
function deferredFetch(sandbox) {
  const queue = [];
  sandbox.fetch = () => new Promise((resolve) => {
    queue.push((stamp) => resolve({
      ok: true, status: 200,
      json: async () => ({ stamps: [stamp], count: 1 }),
    }));
  });
  return queue;
}

/** Resolve once `n` requests are genuinely in flight. `applySellGate` awaits a
 *  token before it ever calls fetch, so the queue is not populated on the tick
 *  the call is made — waiting for it is what makes "both are in flight" true
 *  rather than assumed. */
async function inFlight(q, n) {
  for (let i = 0; i < 200 && q.length < n; i++) await new Promise((r) => setImmediate(r));
  if (q.length < n) throw new Error(`only ${q.length}/${n} requests went out`);
}

const shown = (els) => ({
  row: els.get('crSellRow').style.display,
  msg: els.get('crSellBlockedMsg').textContent,
});

// ════════════════════════════════════════════════════════════════════════════
console.log('\nan answer applies only to the card that asked for it');

{
  // Slow ELIGIBLE A → fast REFUSED B → A lands last. B must stay blocked.
  const { sandbox, els } = makeSandbox();
  const q = deferredFetch(sandbox);

  const pA = sandbox.applySellGate(CARD_A);
  const pB = sandbox.applySellGate(CARD_B);
  await inFlight(q, 2);
  q[1](STAMP_NO);   // B answers first
  await pB;
  q[0](STAMP_OK);   // A answers last
  await pA;

  const st = shown(els);
  check('🔴 a late eligible for the previous card does not show a Sell button',
        st.row === 'none', 'this is the exact reordering the reviewer described');
  check('and the refusal on screen still belongs to the card on screen',
        st.msg === STAMP_NO.message);
  check('no approval is left behind for the wrong card',
        sandbox.window._crSellApproved === null);
}

{
  // Slow REFUSED A → fast ELIGIBLE B → A lands last. B must stay sellable.
  const { sandbox, els } = makeSandbox();
  const q = deferredFetch(sandbox);

  const pA = sandbox.applySellGate(CARD_A);
  const pB = sandbox.applySellGate(CARD_B);
  await inFlight(q, 2);
  q[1](STAMP_OK);
  await pB;
  q[0](STAMP_NO);
  await pA;

  check('🔴 a late refusal for the previous card does not hide a valid Sell button',
        els.get('crSellRow').style.display === 'block');
  check('and the approved card is still the one being displayed',
        sandbox.window._crSellApproved === CARD_B);
  check('no stale refusal text is left sitting in the DOM',
        els.get('crSellBlockedMsg').textContent === '');
}

{
  // The same card rendered twice. An identity hash could not tell these apart;
  // a generation counter can.
  const { sandbox, els } = makeSandbox();
  const q = deferredFetch(sandbox);

  const p1 = sandbox.applySellGate(CARD_A);
  const p2 = sandbox.applySellGate(CARD_A);
  await inFlight(q, 2);
  q[1](STAMP_NO);
  await p2;
  q[0](STAMP_OK);
  await p1;

  check('🔴 a re-render of the SAME card still discards the older answer',
        els.get('crSellRow').style.display === 'none',
        'the identity-hash version of this guard passed A/B and failed here');
}

{
  // Signing out mid-flight. The card never changed; the account did.
  const { sandbox, els } = makeSandbox();
  const q = deferredFetch(sandbox);

  const p = sandbox.applySellGate(CARD_A);
  await inFlight(q, 1);                      // request left carrying tok-1
  sandbox.window._googleIdToken = '';        // signed out while in flight
  q[0](STAMP_OK);
  await p;

  check('🔴 an eligible answer earned by a signed-in account is dropped after sign-out',
        els.get('crSellRow').style.display === 'none');
  check('and nothing is left approved',
        sandbox.window._crSellApproved === null);
}

{
  // Switching accounts mid-flight is the same hazard with a different shape.
  const { sandbox, els } = makeSandbox();
  const q = deferredFetch(sandbox);
  const p = sandbox.applySellGate(CARD_A);
  await inFlight(q, 1);
  sandbox.window._googleIdToken = 'tok-2';
  q[0](STAMP_OK);
  await p;
  check('a different account in flight also invalidates the answer',
        els.get('crSellRow').style.display === 'none');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nan unreachable server is not a verdict');

{
  const { sandbox, els } = makeSandbox();
  sandbox.fetch = async () => { throw new Error('offline'); };
  await sandbox.applySellGate(CARD_A);
  check('a network failure blocks the button', els.get('crSellRow').style.display === 'none');
  check('and says so without claiming the card is at fault',
        /Couldn't check/.test(els.get('crSellBlockedMsg').textContent));
  const retry = els.get('crSellBlocked').querySelector('[data-cr-retry]');
  check('🔴 and offers a retry, because a dropped connection is not evidence',
        !!retry && retry.textContent === 'Try again');
}

{
  const { sandbox, els } = makeSandbox();
  sandbox.window._googleIdToken = '';
  await sandbox.applySellGate(CARD_A);
  check('signed out gets its own sentence',
        /Sign in/.test(els.get('crSellBlockedMsg').textContent));
  check('and no retry, because retrying signed out changes nothing',
        els.get('crSellBlocked').querySelector('[data-cr-retry]') === null);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nthe wire projection carries the card, not the photo album');

{
  const { sandbox } = makeSandbox();
  let sent = null;
  sandbox.fetch = async (_u, o) => {
    sent = JSON.parse(o.body);
    return { ok: true, status: 200, json: async () => ({ stamps: [STAMP_OK], count: 1 }) };
  };
  const heavy = { ...CARD_A, img: 'data:image/png;base64,' + 'A'.repeat(50000), notes: 'x'.repeat(9000) };
  await sandbox.fetchSellStamps([heavy]);

  check('the thumbnail never goes on the wire', sent.rows[0].img === undefined);
  check('neither do free-text notes', sent.rows[0].notes === undefined);
  check('every identity field survives untouched',
        sent.rows[0].game === 'pokemon' && sent.rows[0].set === 'Champions Path'
        && sent.rows[0].number === '074/073' && sent.rows[0].card === 'Charizard VMAX');
  check('and the row the caller handed in is not mutated', heavy.img.length > 1000);
}

{
  // S3: the payload has to stay sane at the cap, not just on one card.
  const { sandbox } = makeSandbox();
  let bytes = 0, rowsSent = 0;
  sandbox.fetch = async (_u, o) => {
    bytes = Buffer.byteLength(o.body, 'utf8');
    rowsSent = JSON.parse(o.body).rows.length;
    return { ok: true, status: 200,
             json: async () => ({ stamps: Array(rowsSent).fill(STAMP_OK), count: rowsSent }) };
  };

  // A realistic saved Collection row, thumbnail and all.
  const rows = Array.from({ length: 500 }, (_, i) => ({
    id: 1756000000000 + i, updatedAt: Date.now(),
    card: 'Charizard VMAX', set: 'Champions Path', number: String(i).padStart(3, '0') + '/073',
    game: 'pokemon', setCode: 'CPA', rarity: 'Secret Rare', language: 'en',
    buyPrice: 120, currentValue: 400, addedDate: '2026-01-01', estGrade: 9,
    grader: 'PSA', grade: '10', cert: '1234' + i, cardType: 'pokemon',
    tcgplayerUrl: 'https://www.tcgplayer.com/product/' + i,
    img: 'data:image/jpeg;base64,' + 'A'.repeat(24000),   // ~24 KB per row
  }));

  await sandbox.fetchSellStamps(rows);

  check('all 500 rows go in one request', rowsSent === 500);
  check('🔴 the batch stays under 512 KB on the wire',
        bytes < 512 * 1024,
        `${(bytes / 1024).toFixed(0)} KB — unprojected this payload is about ${(500 * 24 / 1024).toFixed(1)} MB`);
  console.log(`       (500 rows serialised to ${(bytes / 1024).toFixed(0)} KB)`);
}

// ── S1: the instance UUID lifecycle ────────────────────────────────────────
// The id used to be a hash of the card's identity fields, which quietly
// asserted that two separately scanned copies of the same card were ONE
// physical object. It is now a UUID minted per displayed scan. That is a
// behaviour the rest of Block D will build draft-to-card relationships on, so
// the lifecycle is pinned here rather than left to inspection.
console.log('\nthe scan instance id lives exactly as long as the displayed scan');
{
  const { sandbox } = makeSandbox();
  let n = 0;
  sandbox.crypto = { randomUUID: () => 'uuid-' + (++n) };

  const first = sandbox._crScanInstanceId(CARD_A);
  check('the id is minted for the displayed scan', /^inst_scan_uuid-1$/.test(first), first);

  // Re-render of the SAME displayed scan: the panel redraws for all sorts of
  // reasons (condition pill, price refresh) and must not silently become a
  // different physical object mid-flow.
  check('🔴 re-reading the same displayed scan keeps its id',
        sandbox._crScanInstanceId(CARD_A) === first
        && sandbox._crScanInstanceId({ ...CARD_A }) === first,
        'a redraw must not mint a new instance');

  // A different card is a different instance.
  const b = sandbox._crScanInstanceId(CARD_B);
  check('a different card gets a different id', b !== first, `${b} vs ${first}`);

  // Back to A: this is a NEW scan of A, and it must NOT recover A's old id.
  // The old identity-hash implementation returned the same value here, which
  // is the precise bug — a second copy of the card inheriting the first
  // copy's instance.
  const aAgain = sandbox._crScanInstanceId(CARD_A);
  check('🔴 a genuinely new scan of the same card gets a NEW id',
        aAgain !== first,
        'an identity hash returned the old id here, merging two physical cards');

  // Two identical cards scanned in a row are still two instances.
  sandbox.window._crScanInstance = null;
  const c1 = sandbox._crScanInstanceId(CARD_A);
  sandbox.window._crScanInstance = null;
  const c2 = sandbox._crScanInstanceId(CARD_A);
  check('🔴 two scans of an identical card are two instances', c1 !== c2, `${c1} / ${c2}`);

  // No crypto.randomUUID (older Safari): still unique, never a thrown error.
  const { sandbox: s2 } = makeSandbox();
  s2.crypto = { randomUUID: () => { throw new Error('unsupported'); } };
  const f1 = s2._crScanInstanceId(CARD_A);
  s2.window._crScanInstance = null;
  const f2 = s2._crScanInstanceId(CARD_A);
  check('the fallback id still works and is still unique',
        !!f1 && !!f2 && f1 !== f2, `${f1} / ${f2}`);
}

console.log('\nthe idempotency key follows the instance, so replays are safe');
{
  const { sandbox } = makeSandbox();
  let n = 0;
  sandbox.crypto = { randomUUID: () => 'uuid-' + (++n) };

  // Capture the payload every create sends.
  const sent = [];
  sandbox._crCreateDraft = async (p) => { sent.push(p); };
  sandbox.window._crSellApproved = CARD_A;

  // A double tap: two starts with no new scan in between.
  await sandbox.startListingDraft();
  await sandbox.startListingDraft();
  check('both taps sent a create', sent.length === 2);
  check('🔴 a double tap reuses one idempotency key',
        sent[0].idemKey === sent[1].idemKey,
        'two keys would create two drafts for one physical card');
  check('and one instance id', sent[0].instanceId === sent[1].instanceId);
  // The slot appears CANONICALISED, not raw. The server's key charset is
  // /^[A-Za-z0-9._~-]+$/ (api/_idempotency.js:364), which excludes the colon
  // in `ebay:fixed-price`, so _crIdemPart replaces it. This assertion used to
  // expect the raw slot and was failing before this block was touched: the
  // sanitizer is correct and the expectation was stale. Asserting the
  // canonical form here is also what makes the test able to catch the real
  // regression — a key the server would reject as malformed.
  check('the key is derived from the instance and the slot',
        sent[0].idemKey === 'sell-' + sent[0].instanceId + '-ebay-fixed-price',
        sent[0].idemKey);
  check('and the key it builds is one the server would accept',
        /^[A-Za-z0-9._~-]+$/.test(sent[0].idemKey) && sent[0].idemKey.length >= 8,
        sent[0].idemKey);

  // A retry after a lost response is the same displayed scan, so the same key
  // replays the draft the seller already has rather than making a second one.
  sandbox._crCreateDraft = async () => { throw new Error('network'); };
  let failed = false;
  try { await sandbox.startListingDraft(); } catch (_) { failed = true; }
  sandbox._crCreateDraft = async (p) => { sent.push(p); };
  await sandbox.startListingDraft();
  check('🔴 a retry after a dropped response reuses the same key',
        sent[sent.length - 1].idemKey === sent[0].idemKey,
        'a new key on retry is how one card becomes two listings');

  // A new scan must NOT reuse the key, or the second card would replay the
  // first card's draft and the seller would never get a listing for it.
  sandbox.window._crScanInstance = null;
  sandbox.window._crSellApproved = CARD_A;
  await sandbox.startListingDraft();
  const last = sent[sent.length - 1];
  check('🔴 a new scan of the same card gets a fresh key',
        last.idemKey !== sent[0].idemKey,
        'replaying the previous draft would silently drop this card');
}

console.log('\nan unpriced card still starts a draft, claiming no provenance');
{
  // B2 on the client side. Refusing here was the entry point promising an
  // operation and then declining it.
  const { sandbox } = makeSandbox();
  const sent = [];
  sandbox._crCreateDraft = async (p) => { sent.push(p); };
  sandbox.window._crSellApproved = CARD_A;
  sandbox.getEffectivePrice = () => 0;

  await sandbox.startListingDraft();
  check('🔴 no price no longer refuses to start a draft', sent.length === 1,
        'the seller was previously stranded with an identified card and no comp');
  check('no price is sent', sent[0].price === undefined);
  check('🔴 and no priceSource is claimed alongside it',
        sent[0].priceSource === undefined,
        'a source with no number is a claim about nothing');

  // With a price, provenance is claimed again.
  sandbox.getEffectivePrice = () => 400;
  sandbox.window._crScanInstance = null;
  await sandbox.startListingDraft();
  check('a priced draft carries its source', sent[1].price === 400
        && ['seller', 'comp'].includes(sent[1].priceSource), JSON.stringify(sent[1].priceSource));
}


done();
