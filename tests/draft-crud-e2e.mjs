// tests/draft-crud-e2e.mjs — C1 wiring: a draft surviving the whole path
//
// The question this file answers is the one review asked for: does a draft
// actually survive create → read → edit → delete through the HTTP layer, with
// the indexes and idempotency wired in, and do the failure paths still say the
// right thing when the store misbehaves?
//
// The index module talks to Upstash over fetch(), so fetch is stubbed with an
// in-memory Redis that can be told to fail specific commands. That exercises
// the real code path rather than a re-implementation of it.

import { harness } from './_assert.mjs';
const { check, checkAsync, done } = harness('draft-crud-e2e');

process.env.KV_REST_API_URL   = 'https://kv.test';
process.env.KV_REST_API_TOKEN = 'test-token';

const SUB = '1029384756';

/**
 * Idempotency keys must be real uuids — the store refuses anything else, so a
 * client cannot pass a value like "draft-1" that another client would collide
 * with. These are deterministic per label so a retry in a test reuses the key.
 */
function K(label) {
  const h = [...label].reduce((a, c) => (a * 33 + c.charCodeAt(0)) % 0xffffffff, 7);
  const hex = (n, len) => n.toString(16).padStart(len, '0').slice(-len);
  return `${hex(h, 8)}-${hex(h >> 3, 4)}-4${hex(h >> 5, 3)}-8${hex(h >> 7, 3)}-${hex(h * 31, 12)}`;
}

// ── in-memory Upstash over fetch ──────────────────────────────────────────
const store = new Map();
const sets  = new Map();
let failCommands = new Set();
let failKeyPrefix = null;
let failNextN = 0;
const seen = [];

function reset() {
  store.clear(); sets.clear(); failCommands = new Set(); failKeyPrefix = null; failNextN = 0; seen.length = 0;
  // The endpoint resolves the Firebase uid by email, never the Google sub.
  store.set(`uid_by_email:seller@example.com`, SUB);
}

// Token verification is a real network call in production. Stub it at the same
// boundary the endpoint uses, so the endpoint's auth code path runs for real.
const TEST_EMAIL = 'seller@example.com';
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('oauth2.googleapis.com/tokeninfo')) {
    return { ok: true, status: 200, json: async () => ({
      aud: '971593505703-6feq3nn7p9580krori6r157rfm5tp88l.apps.googleusercontent.com',
      email: TEST_EMAIL, sub: 'google-sub-not-used',
    }) };
  }
  if (u.includes('googleapis.com')) return { ok: false, status: 500, json: async () => ({}) };

  const parts = String(url).replace('https://kv.test/', '').split('/').map(decodeURIComponent);
  const [cmd, ...rest] = parts;
  seen.push(cmd.toLowerCase());
  const auth = (opts && opts.headers && opts.headers.Authorization) || '';
  if (auth !== 'Bearer test-token') return { ok: false, status: 401, json: async () => ({}) };
  if (shouldFail(cmd, rest)) {
    return { ok: false, status: 500, json: async () => ({ error: 'injected' }) };
  }
  return { ok: true, status: 200, json: async () => ({ result: run(cmd.toLowerCase(), rest) }) };
};

/**
 * Targeted failure injection. `failKeyPrefix` matters: failing ALL `set`
 * commands also fails the idempotency reservation, which correctly refuses the
 * whole operation before any work runs — a different (also correct) path than
 * "the authoritative write itself failed", which is what we want to test.
 */
function shouldFail(cmd, args) {
  const c = String(cmd).toLowerCase();
  if (failNextN-- > 0) return true;
  if (!failCommands.has(c)) return false;
  if (failKeyPrefix && !String(args[0] || '').startsWith(failKeyPrefix)) return false;
  return true;
}

function run(cmd, a) {
  switch (cmd) {
    case 'get': return store.has(a[0]) ? store.get(a[0]) : null;
    case 'set': {
      const [k, v, ...flags] = a;
      const f = flags.map((x) => String(x).toUpperCase());
      if (f.includes('NX') && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    }
    // Real Redis semantics: absent key counts as 0, the value is stored as a
    // string, and the reply is an integer. Each command is atomic on its own
    // while a SEQUENCE of them is not — which is exactly the property the cap
    // race depends on, and exactly why this fake was able to expose it.
    case 'incr': {
      const n = (Number(store.get(a[0])) || 0) + 1;
      store.set(a[0], String(n));
      return n;
    }
    case 'decr': {
      const n = (Number(store.get(a[0])) || 0) - 1;
      store.set(a[0], String(n));
      return n;
    }
    case 'del': { const had = store.delete(a[0]); sets.delete(a[0]); return had ? 1 : 0; }
    case 'expire': return store.has(a[0]) || sets.has(a[0]) ? 1 : 0;
    case 'sadd': {
      if (!sets.has(a[0])) sets.set(a[0], new Set());
      const s = sets.get(a[0]); const before = s.size;
      for (const m of a.slice(1)) s.add(m);
      return s.size - before;
    }
    case 'srem': {
      const s = sets.get(a[0]); if (!s) return 0;
      let n = 0; for (const m of a.slice(1)) if (s.delete(m)) n++;
      return n;
    }
    case 'smembers': return [...(sets.get(a[0]) || [])];
    case 'scard': return (sets.get(a[0]) || new Set()).size;
    case 'scan': {
      const keys = [...store.keys()];
      const mi = a.findIndex((x) => String(x).toLowerCase() === 'match');
      const match = mi >= 0 ? a[mi + 1] : null;
      const re = match ? new RegExp('^' + match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*') + '$') : null;
      return ['0', re ? keys.filter((k) => re.test(k)) : keys];
    }
    // ── Unknown commands are a FAILURE, not a null ──────────────────────
    //
    // This returned null for years. When the cap moved to INCR, the fake did
    // not implement it, every reservation read as 0, and the cap test passed
    // while the cap did nothing. A fake that silently answers "nothing" to a
    // command it does not know will certify any behaviour you ask it about.
    default: throw new Error(`fake kv: unimplemented command '${cmd}'`);
  }
}

// The service's own kv, sharing the same in-memory Redis so the store and the
// index module cannot disagree about what is persisted.
const kv = async (...args) => {
  const cmd = String(args[0]).toLowerCase();
  seen.push(cmd);
  if (shouldFail(cmd, args.slice(1).map(String))) throw new Error('injected');
  return run(cmd, args.slice(1).map(String));
};

const SVC = await import('../api/_draftService.js');
const DS  = await import('../api/_draftStore.js');
const EP  = await import('../api/drafts.js');
const IDEM = await import('../api/_idempotency.js');
const IDENT = await import('../api/_cardIdentity.js');
const TITLE = await import('../api/_listingTitle.js');
const SELL  = await import('../api/_sellEligibility.js');


const input = () => ({
  sku: 'v2-XXX7473-592a391e7b472559',
  instanceId: 'inst_abc123',
  slot: 'ebay:fixed-price',
  title: 'Charizard VMAX 074/073 PSA 10',
  price: 400,
});

// ── HTTP create input ─────────────────────────────────────────────────────
// The endpoint no longer accepts `sku`/`title` — it derives them from the
// card row. The service still takes them explicitly, so `input()` stays as
// it is; this is the network-facing shape.
const CARD = () => ({
  game: 'pokemon', set_name: 'Champions Path', card_number: '074/073',
  card_name: 'Charizard VMAX', rarity: 'Secret Rare', language: 'en',
});
const httpInput = () => ({
  card: CARD(), instanceId: 'inst_abc123',
  slot: 'ebay:fixed-price', price: 400,
});

// ── create → read → edit → delete ─────────────────────────────────────────
console.log('\na draft survives the whole path');
reset();
const created = await SVC.createDraft(kv, SUB, input(), K('create-1'));
check('create succeeds', created.state === IDEM.IDEMPOTENCY_STATE.FRESH && created.result.saved === true);
const id = created.result.draftId;
check('it minted a draft id', /^drf_[0-9a-f]{32}$/.test(id));
check('the authoritative record is written', store.has(`draft:${SUB}:${id}`));
check('and it is indexed for listing', [...(sets.get(`drafts:${SUB}`) || [])].includes(id));
check('and for duplicate detection by sku',
      store.get(`skudraft:${SUB}:${encodeURIComponent(input().sku)}`) === id);
check('the create was NOT reported degraded', created.result.degraded === false);

const readBack = await SVC.readDraft(kv, SUB, id);
check('read returns the draft at rev 1', readBack.ok === true && readBack.draft.rev === 1);
check('read reports publish-readiness', readBack.publishable.ok === true);
check('the price round-tripped exactly', readBack.draft.price === 400);

const edited = await SVC.updateDraft(kv, SUB, id, { price: 375 }, 1, K('edit-1'));
check('edit at the current revision succeeds', edited.ok === true && edited.draft.rev === 2);
check('and the new price persisted', (await SVC.readDraft(kv, SUB, id)).draft.price === 375);

const staleEdit = await SVC.updateDraft(kv, SUB, id, { price: 1 }, 1, K('edit-2'));
check('an edit at a stale revision is refused',
      staleEdit.ok === false && staleEdit.error === DS.ERR.REV_CONFLICT);
check('and the refusal carries the current record', staleEdit.current.price === 375);

const deleted = await SVC.deleteDraftOp(kv, SUB, id, 2, K('del-1'));
check('delete at the current revision succeeds', deleted.ok === true && deleted.deleted === true);
check('the tombstone remains readable as DELETED',
      (await SVC.readDraft(kv, SUB, id)).error === DS.ERR.DELETED);
check('🔴 delete removed it from the list index',
      ![...(sets.get(`drafts:${SUB}`) || [])].includes(id));
check('🔴 and cleared the sku pointer',
      store.get(`skudraft:${SUB}:${encodeURIComponent(input().sku)}`) === undefined ||
      store.get(`skudraft:${SUB}:${encodeURIComponent(input().sku)}`) === null);

// ── idempotent create around the WHOLE operation ──────────────────────────
console.log('\ncreate is idempotent around the whole operation, id minting included');
reset();
const c1 = await SVC.createDraft(kv, SUB, input(), K('lost-response'));
const c2 = await SVC.createDraft(kv, SUB, input(), K('lost-response'));
check('🔴 a retry after a lost response returns the SAME draftId',
      c1.result.draftId === c2.result.draftId,
      'minting the id outside runOnce would create a second draft on every retry');
check('and is marked as a replay', c2.replayed === true);
check('🔴 only ONE draft record exists',
      [...store.keys()].filter((k) => k.startsWith(`draft:${SUB}:`)).length === 1);
check('and the list index holds exactly one entry', (sets.get(`drafts:${SUB}`) || new Set()).size === 1);

const different = await SVC.createDraft(kv, SUB, { ...input(), price: 900 }, K('lost-response'));
check('🔴 the same key with a DIFFERENT price is refused, not replayed',
      different.state === IDEM.IDEMPOTENCY_STATE.MISMATCH,
      'a key identifies one intended mutation, not a slot in a store');
check('the refusal is non-retryable', different.retryable === false);

const cosmetic = await SVC.createDraft(kv, SUB, input(), K('lost-response'));
check('a byte-identical retry still replays fine', cosmetic.result.draftId === c1.result.draftId);

// Key differences that MUST count as different mutations.
reset();
await SVC.createDraft(kv, SUB, input(), K('sku'));
const otherSku = await SVC.createDraft(kv, SUB, { ...input(), sku: 'v2-YYY0001-aaaaaaaaaaaaaaaa' }, K('sku'));
check('🔴 the same key for a different SKU is refused',
      otherSku.state === IDEM.IDEMPOTENCY_STATE.MISMATCH,
      'without sku in the mutation, one key would answer for whichever card arrived first');

// ── index failure must not rewrite the meaning of the create ──────────────
console.log('\nan index failure never becomes "your draft was not saved"');
reset();
failCommands = new Set(['sadd']);
const degraded = await SVC.createDraft(kv, SUB, input(), K('degraded'));
failCommands = new Set();
check('🔴 the create still reports SAVED', degraded.result.saved === true);
check('and the authoritative record really is there',
      store.has(`draft:${SUB}:${degraded.result.draftId}`));
check('🔴 but it is flagged degraded', degraded.result.degraded === true);
check('🔴 with repairRequired and a named recovery path',
      degraded.result.repairRequired === true &&
      degraded.result.index.recovery === 'reconcileDraftIndex');
check('and the draft is readable despite never being indexed',
      (await SVC.readDraft(kv, SUB, degraded.result.draftId)).ok === true,
      'an index is a cache; the record is the truth');

// The idempotent replay of a degraded create must describe the SAME state.
const degradedReplay = await SVC.createDraft(kv, SUB, input(), K('degraded'));
check('🔴 replaying a degraded create still reports the successful save',
      degradedReplay.result.saved === true &&
      degradedReplay.result.draftId === degraded.result.draftId);
check('and still reports the degradation', degradedReplay.result.degraded === true);

// A failed AUTHORITATIVE write is a real failure — the opposite case.
reset();
// Fail ONLY the authoritative record write, not the idempotency reservation.
failCommands = new Set(['set']); failKeyPrefix = `draft:${SUB}:`;
let realFailure = null;
try { await SVC.createDraft(kv, SUB, input(), K('real-fail')); }
catch (e) { realFailure = e.message; }
failCommands = new Set(); failKeyPrefix = null;
check('🔴 a failed AUTHORITATIVE write is NOT reported as saved',
      realFailure !== null,
      'degrading a lost record to "saved but degraded" would be a lie');
check('and nothing was indexed for it', (sets.get(`drafts:${SUB}`) || new Set()).size === 0);

// ── delete with a degraded unindex ────────────────────────────────────────
console.log('\ndelete is authoritative even when index cleanup fails');
reset();
const dc = await SVC.createDraft(kv, SUB, input(), K('d'));
const did = dc.result.draftId;
failCommands = new Set(['srem']);
const degradedDel = await SVC.deleteDraftOp(kv, SUB, did, 1, K('dd'));
failCommands = new Set();
check('the delete succeeds', degradedDel.ok === true && degradedDel.deleted === true);
check('🔴 it is flagged degraded rather than failed', degradedDel.degraded === true);
check('the tombstone is authoritative regardless',
      (await SVC.readDraft(kv, SUB, did)).error === DS.ERR.DELETED);
check('a stale index entry survives, which reconciliation can prune',
      [...(sets.get(`drafts:${SUB}`) || [])].includes(did),
      'a tombstone is positive evidence of non-active — the one thing pruning may act on');

// Re-deleting retries the cleanup that failed.
const retryDel = await SVC.deleteDraftOp(kv, SUB, did, 1, K('dd2'));
check('re-deleting reports alreadyDeleted', retryDel.ok === true && retryDel.alreadyDeleted === true);
check('🔴 and retries the index cleanup that failed',
      ![...(sets.get(`drafts:${SUB}`) || [])].includes(did),
      'the previous attempt may be exactly what failed, so a repeat delete is a repair');

// A failed tombstone write must NOT unindex a still-live draft.
reset();
const lc = await SVC.createDraft(kv, SUB, input(), K('live'));
const lid = lc.result.draftId;
failCommands = new Set(['set']); failKeyPrefix = `draft:${SUB}:`;
const failedDel = await SVC.deleteDraftOp(kv, SUB, lid, 1, K('live-del'));
failCommands = new Set(); failKeyPrefix = null;
check('a delete whose tombstone write fails is reported as failed', failedDel.ok === false);
check('🔴 and the live draft is still in the index',
      [...(sets.get(`drafts:${SUB}`) || [])].includes(lid),
      'unindexing a draft that was never tombstoned would hide a live draft from its owner');
check('and it is still readable and editable', (await SVC.readDraft(kv, SUB, lid)).ok === true);

// ── HTTP layer ────────────────────────────────────────────────────────────
console.log('\nthe HTTP layer maps every condition to one status code');
check('a missing draft is 404', EP.statusForStoreError(DS.ERR.NOT_FOUND) === 404);
check('🔴 a tombstone is 410 GONE, not 404',
      EP.statusForStoreError(DS.ERR.DELETED) === 410,
      '404 would let a client believe it may create it again under the same identity');
check('a revision conflict is 409', EP.statusForStoreError(DS.ERR.REV_CONFLICT) === 409);
check('a missing expectedRev is 428 Precondition Required',
      EP.statusForStoreError(DS.ERR.REV_REQUIRED) === 428);
check('an in-flight revision is 409, not 500', EP.statusForStoreError(DS.ERR.REV_IN_FLIGHT) === 409);
check('🔴 a newer schema is 409, not 500',
      EP.statusForStoreError(DS.ERR.SCHEMA_TOO_NEW) === 409,
      'the server is fine — this build is too old to read the record safely');
check('an unreadable record is 500', EP.statusForStoreError(DS.ERR.UNREADABLE) === 500);
check('an unavailable store is 503', EP.statusForStoreError(DS.ERR.STORE_UNAVAILABLE) === 503);
check('a field error is 400', EP.statusForStoreError(`${DS.ERR.FIELD_INVALID}:price:negative`) === 400);

console.log('\nnormalization happens once, in the endpoint');
const n = EP.normalizeCreateInput({
  card: CARD(), instanceId: '  inst_abc123 ',
  slot: 'eBay:Fixed-Price', price: '400.005',
});
check('🔴 an id keeps its casing', n.instanceId === 'inst_abc123',
      'lowercasing ids would corrupt every real id and refuse every genuine retry');
check('a token is lowercased', n.slot === 'ebay:fixed-price');
check('money is rounded to cents once, here', n.price === 400.01);
check('🔴 the sku is derived, and matches skuFor on the same row',
      n.sku === IDENT.skuFor(CARD()),
      'if the endpoint derived it differently the stored draft would point at a different card');
check('🔴 the title is derived, and matches buildListingTitle',
      n.title === TITLE.buildListingTitle(CARD(), { maxLength: 80 }).title,
      'a second title implementation is how the listing and the packet start disagreeing');
check('the derived title respects the venue limit, not a generic one',
      n.title.length <= 80);
check('🔴 the stored title is a string, not the builder result object',
      typeof n.title === 'string' && !n.title.includes('[object'),
      'buildListingTitle returns {title, ok, dropped} — storing it whole renders as [object Object]');
// The refusal now comes from the identity gate (card:SELL_NEEDS_CARD_NAME)
// rather than the title builder (title:NO_CARD_NAME). That ordering is the
// point: a nameless card used to pass the gate and die at the title, which is
// how the Sell button came to be offered for a card that could not be listed.
// Both layers still refuse it; the earlier one just answers first now.
check('a title that cannot be built at all is refused', (() => {
  const b = httpInput(); delete b.card.card_name;
  try { EP.normalizeCreateInput(b); return false; }
  catch (e) { return /NO_CARD_NAME|SELL_NEEDS_CARD_NAME/.test(e.message); }
})());
check('🔴 a Mercari draft gets a Mercari-length title',
      EP.normalizeCreateInput({ ...httpInput(), slot: 'mercari:fixed-price' }).title.length <= 40,
      'building to 500 then failing slot validation is a dead end the seller cannot act on');
check('🔴 a client-supplied sku is refused, not dropped', (() => {
  try { EP.normalizeCreateInput({ ...httpInput(), sku: 'v2-forged' }); return false; }
  catch (e) { return e.message === 'DRAFT_FIELD_INVALID:sku:derived-from-card'; }
})(), 'a caller who thought they set the sku must be told they did not');
check('🔴 a client-supplied title is refused, not dropped', (() => {
  try { EP.normalizeCreateInput({ ...httpInput(), title: 'Whatever I like' }); return false; }
  catch (e) { return e.message === 'DRAFT_FIELD_INVALID:title:derived-from-card'; }
})(), 'otherwise any text can sit above a price we then stamp with provenance');
check('a missing card is refused', (() => {
  const b = httpInput(); delete b.card;
  try { EP.normalizeCreateInput(b); return false; }
  catch (e) { return e.message === 'DRAFT_FIELD_INVALID:card:required'; }
})());
check('🔴 a card with no number is refused, naming the axis', (() => {
  const b = httpInput(); delete b.card.card_number;
  try { EP.normalizeCreateInput(b); return false; }
  catch (e) { return e.message === 'DRAFT_FIELD_INVALID:card:SELL_NEEDS_NUMBER'; }
})(), 'the create must hold even if the Sell button was drawn wrongly');
check('a card with no set is refused, naming the axis', (() => {
  const b = httpInput(); delete b.card.set_name;
  try { EP.normalizeCreateInput(b); return false; }
  catch (e) { return e.message === 'DRAFT_FIELD_INVALID:card:SELL_NEEDS_SET'; }
})());
check('a dollar sign is accepted from a text input', EP.normalizeCreateInput({ ...httpInput(), price: '$19.99' }).price === 19.99);
check('a negative price is refused', (() => {
  try { EP.normalizeCreateInput({ ...httpInput(), price: -1 }); return false; }
  catch (e) { return e.message === 'DRAFT_FIELD_INVALID:price:negative'; }
})());
check('a non-numeric price is refused', (() => {
  try { EP.normalizeCreateInput({ ...httpInput(), price: 'free' }); return false; }
  catch (e) { return e.message.endsWith(':not-a-number'); }
})());
check('🔴 a strategy that disagrees with the slot is refused', (() => {
  try { EP.normalizeCreateInput({ ...httpInput(), strategy: 'auction' }); return false; }
  catch (e) { return e.message === 'DRAFT_FIELD_INVALID:strategy:disagrees-with-slot'; }
})(), 'silently preferring one would make two different-looking requests behave identically');
check('a strategy that agrees is accepted',
      EP.normalizeCreateInput({ ...httpInput(), strategy: 'Fixed-Price' }).strategy === 'fixed-price');

console.log('\nthe endpoint refuses to invent an idempotency key');
reset();
const res = fakeRes();
await EP.default(fakeReq({ method: 'POST', body: httpInput() }), res);
check('🔴 POST with no Idempotency-Key is refused',
      res.statusCode === 400 && res.body.code === 'IDEMPOTENCY_KEY_REQUIRED',
      'a server-minted key looks like a new operation on every retry, removing the protection exactly when it is needed');
check('nothing was written', [...store.keys()].filter((k) => k.startsWith('draft:')).length === 0);

const res2 = fakeRes();
await EP.default(fakeReq({ method: 'PATCH', query: { id: 'drf_x' }, body: { price: 1 } }), res2);
check('🔴 PATCH with no expectedRev is 428',
      res2.statusCode === 428 && res2.body.code === DS.ERR.REV_REQUIRED,
      'no silent last-write-wins');
check('and it explains why rather than just refusing', typeof res2.body.hint === 'string');

const res3 = fakeRes();
await EP.default(fakeReq({ method: 'POST', body: httpInput(), headers: { 'idempotency-key': K('http-post') } }), res3);
check('a valid POST is 201 with the draft', res3.statusCode === 201 && !!res3.body.draft);
const res4 = fakeRes();
await EP.default(fakeReq({ method: 'POST', body: httpInput(), headers: { 'idempotency-key': K('http-post') } }), res4);
check('🔴 the replay is 200, not 201, with the same draftId',
      res4.statusCode === 200 && res4.body.draftId === res3.body.draftId &&
      res4.body.replayed === true);
const res5 = fakeRes();
await EP.default(fakeReq({ method: 'POST', body: { ...httpInput(), price: 12 }, headers: { 'idempotency-key': K('http-post') } }), res5);
check('🔴 the same key with a different body is 409', res5.statusCode === 409);

console.log('\nan unauthenticated or unconfigured request never touches the store');
const res6 = fakeRes();
await EP.default(fakeReq({ method: 'GET', headers: {} }), res6);
check('no token is 401', res6.statusCode === 401);
const savedUrl = process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_URL;
const res7 = fakeRes();
await EP.default(fakeReq({ method: 'GET' }), res7);
check('a missing store config is 503, matching the rest of api/', res7.statusCode === 503);
process.env.KV_REST_API_URL = savedUrl;

console.log('\na failed list is never rendered as "you have no drafts"');
reset();
await SVC.createDraft(kv, SUB, input(), K('list'));
failCommands = new Set(['smembers', 'scan']);
const res8 = fakeRes();
await EP.default(fakeReq({ method: 'GET' }), res8);
failCommands = new Set();
check('🔴 a store failure on list is 503, not an empty list',
      res8.statusCode === 503,
      'an empty list is the one response that makes a seller think their work is gone');

const res9 = fakeRes();
await EP.default(fakeReq({ method: 'GET' }), res9);
check('and a healthy list returns the draft', res9.statusCode === 200 && res9.body.count === 1);

console.log('\n"none" and "we could not tell" are different answers');
reset();
const c = await SVC.createDraft(kv, SUB, input(), K('detail'));
const healthy = await SVC.listDrafts(SUB);
check('a healthy list names its source', healthy.source === 'index' || healthy.source === 'reconciled');
check('and is not marked unavailable', healthy.unavailable === false);
check('and contains the draft', healthy.draftIds.includes(c.result.draftId));

reset();
const empty = await SVC.listDrafts(SUB);
check('🔴 a genuinely empty account reports empty, NOT unavailable',
      empty.draftIds.length === 0 && empty.unavailable === false);

reset();
await SVC.createDraft(kv, SUB, input(), K('detail2'));
failCommands = new Set(['smembers', 'scan']);
const blind = await SVC.listDrafts(SUB);
failCommands = new Set();
check('🔴 losing BOTH the index and the scan reports unavailable, not empty',
      blind.unavailable === true && blind.draftIds.length === 0,
      'an empty list is indistinguishable from lost work, so it must never be guessed');
check('and it is marked retryable', blind.retryable === true);

reset();
await SVC.createDraft(kv, SUB, input(), K('detail3'));
failCommands = new Set(['scan']);
const scanDown = await SVC.listDrafts(SUB);
failCommands = new Set();
check('🔴 losing only the SCAN still serves the index answer',
      scanDown.unavailable === false && scanDown.draftIds.length === 1,
      'a readable index is a real answer even when it cannot be reconciled');
check('and a freshly-marked index does not need the scan at all',
      scanDown.source === 'index',
      'the scan is the repair path, not the read path');

reset();
await SVC.createDraft(kv, SUB, input(), K('detail4'));
failCommands = new Set(['smembers']);
const idxDown = await SVC.listDrafts(SUB);
failCommands = new Set();
check('🔴 losing only the INDEX still finds the draft by scanning records',
      idxDown.draftIds.length === 1 && idxDown.unavailable === false,
      'the index is a cache; the records are the truth');
check('and that answer is flagged degraded', idxDown.degraded === true);

// ── helpers ───────────────────────────────────────────────────────────────
function fakeReq({ method, body, query, headers }) {
  return {
    method,
    body,
    query: query || {},
    headers: headers === undefined
      ? { authorization: 'Bearer ' + 'x'.repeat(40) }
      : { authorization: headers.authorization === undefined && Object.keys(headers).length
            ? 'Bearer ' + 'x'.repeat(40) : headers.authorization, ...headers },
  };
}
function fakeRes() {
  const r = {
    statusCode: 0, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return r;
}

// ── The reserved synthetic-test namespace ─────────────────────────────────
console.log('\nthe test namespace is reserved by us, not by luck');

check('the reserved prefix is recognised', DS.isSyntheticTestSub('ktest-abc123') === true);
check('a numeric Google sub is not reserved', DS.isSyntheticTestSub('118273645500192837465') === false);
check('🔴 an alphanumeric Firebase-shaped uid is not reserved',
      DS.isSyntheticTestSub('Xk29fLpQ7bVzR1mHs4Tw') === false,
      'the reservation must not accidentally capture real identifiers');
check('a non-string is not reserved', DS.isSyntheticTestSub(null) === false
      && DS.isSyntheticTestSub(undefined) === false && DS.isSyntheticTestSub(12345) === false);
check('the prefix is not matched mid-string',
      DS.isSyntheticTestSub('user-ktest-nope') === false,
      'only a leading prefix reserves; a substring match would capture real users');

// The door itself. This is what makes the namespace ours: the harness can
// write there because authenticated traffic cannot.
const rsvSeen = {};
const rsvRes = {
  status(c) { rsvSeen.status = c; return this; },
  json(b) { rsvSeen.body = b; return this; },
  setHeader() { return this; },
};
await EP.default(
  { method: 'GET', url: '/api/drafts', headers: { authorization: 'Bearer ktest-token' }, query: {} },
  rsvRes,
);
check('🔴 the HTTP door refuses the reserved namespace',
      rsvSeen.status === 403 || rsvSeen.status === 401,
      `got ${rsvSeen.status} — a reserved sub must never reach the store`);

// ── eligible ⟹ the create actually succeeds ───────────────────────────────
// The other half of the D1 contract. sell-eligibility.mjs proves the two gates
// agree about REFUSAL; this proves the acceptance is real — that a row the Sell
// button appears on produces a stored draft, not just a payload that survives
// normalization. Normalization is not the whole gate: it accepts a $0 price and
// an unsupported slot, both of which the slot rules catch later, so a create
// that stops at normalize would be proving the wrong thing.
console.log('\na card the Sell button appears on can really be created');
reset();
{
  const rows = [
    CARD(),
    { ...CARD(), rarity: '' },
    { ...CARD(), language: 'ja' },
    { ...CARD(), grader: 'PSA', grade: '10', cert: '12345678' },
    { ...CARD(), setCode: 'CPA' },
  ];
  let n = 0, firstProblem = '';
  for (const [i, card] of rows.entries()) {
    if (!SELL.sellStamp(card).eligible) { firstProblem ||= `row ${i} was not eligible to begin with`; continue; }
    for (const priceSource of ['seller', 'comp']) {
      const norm = EP.normalizeCreateInput({
        card, instanceId: `inst_scan_${i}_${priceSource}`,
        slot: 'ebay:fixed-price', price: 400, priceSource,
      });
      const res = await SVC.createDraft(kv, SUB, norm, K(`parity-${i}-${priceSource}`));
      if (res.state !== IDEM.IDEMPOTENCY_STATE.FRESH || res.result?.saved !== true) {
        firstProblem ||= `row ${i}/${priceSource} → ${res.state} ${res.result?.error || ''}`; continue;
      }
      // A created-but-unlistable draft would satisfy the letter of the contract
      // and break its intent, so publish-readiness is checked too. A
      // seller-entered price is INFO, not blocking — that distinction is the
      // whole reason `blocking` exists rather than a violation count.
      const blocking = (res.result.publishable?.violations || []).filter((v) => v.blocking);
      if (blocking.length) {
        firstProblem ||= `row ${i}/${priceSource} created with ${blocking.map((v) => v.code).join(',')}`; continue;
      }
      n++;
    }
  }
  check('🔴 every eligible row creates a real draft with nothing blocking it',
        n === rows.length * 2, firstProblem || `${n}/${rows.length * 2} succeeded`);
}

// ── the nameless card, end to end ─────────────────────────────────────────
// B1. The row the review supplied was stamped eligible and then refused at
// title generation. Both halves are pinned here: the gate must refuse it, and
// if it somehow reaches the create anyway, the create must still refuse rather
// than store a titleless draft.
console.log('\na card with no name is stopped at the gate, not at the title');
reset();
{
  const nameless = { game: 'pokemon', set_name: 'Champions Path', card_number: '074/073' };
  const st = SELL.sellStamp(nameless);
  check('🔴 the gate refuses it, so no button is ever drawn',
        st.eligible === false && st.missing[0] === 'SELL_NEEDS_CARD_NAME', JSON.stringify(st));

  let refusal = '';
  try {
    EP.normalizeCreateInput({
      card: nameless, instanceId: 'inst_nameless',
      slot: 'ebay:fixed-price', price: 400, priceSource: 'comp',
    });
  } catch (e) { refusal = e.message; }
  // It is refused with the GATE's reason, not the title builder's: normalize
  // runs the same missingIdentityAxes the stamp does, so the two layers cannot
  // disagree about whether a card has a name.
  check('🔴 and the create refuses it independently (defence in depth)',
        /SELL_NEEDS_CARD_NAME/.test(refusal), refusal || 'it was accepted');

  // Each spelling individually, through the real create, so a gate that
  // recognises a name the create does not is caught here too.
  let ok = 0;
  for (const [i, k] of ['card', 'card_name', 'name'].entries()) {
    const row = { ...nameless, [k]: 'Charizard VMAX' };
    if (!SELL.sellStamp(row).eligible) continue;
    const norm = EP.normalizeCreateInput({
      card: row, instanceId: `inst_name_${i}`,
      slot: 'ebay:fixed-price', price: 400, priceSource: 'comp',
    });
    const res = await SVC.createDraft(kv, SUB, norm, K(`nm-${i}`));
    if (res.state === IDEM.IDEMPOTENCY_STATE.FRESH && res.result?.saved
        && res.result.draft.title) ok++;
  }
  check('🔴 every accepted name spelling creates a titled draft', ok === 3, `${ok}/3`);
}

// ── valid identity, no price ──────────────────────────────────────────────
// B2. The product decision: sufficient identity starts an INCOMPLETE draft.
// Refusing here was the entry point promising an operation then declining it,
// and it stranded the cards that most need help — real cards with no comp.
// The price becomes a named blocking finding on the review screen instead.
console.log('\na correctly identified card with no price still gets a draft');
reset();
{
  const card = CARD();
  check('the card is eligible on identity alone', SELL.sellStamp(card).eligible === true);

  const norm = EP.normalizeCreateInput({
    card, instanceId: 'inst_noprice', slot: 'ebay:fixed-price',
    // Both omitted together: no number, so no claim about where it came from.
    price: undefined, priceSource: undefined,
  });
  check('normalize carries no price', norm.price === undefined);
  check('🔴 and no provenance is claimed for the absent price',
        norm.priceSource === undefined,
        'priceSource with no price would be a claim about nothing');

  const res = await SVC.createDraft(kv, SUB, norm, K('noprice'));
  check('🔴 the draft is really created and stored',
        res.state === IDEM.IDEMPOTENCY_STATE.FRESH && res.result?.saved === true,
        `${res.state} ${res.result?.error || ''}`);

  const v = res.result.publishable?.violations || [];
  const blocking = v.filter((x) => x.blocking);
  // Exact code, not /PRICE/. A regex here would pass on ZERO_PRICE too, and
  // "your price is zero" is a different sentence from "add your price".
  check('🔴 the review screen is told price is required, by name',
        blocking.some((x) => x.code === DS.VIOLATION.PRICE_REQUIRED),
        JSON.stringify(v.map((x) => x.code)));
  check('the finding names the price field rather than counting problems',
        blocking.some((x) => x.field === 'price'), JSON.stringify(blocking));
  check('so the draft exists but is not publishable',
        res.result.publishable?.ok !== true);

  // The seller then supplies the price on the review screen, and the same
  // draft becomes publishable. That is the whole point of allowing it to exist.
  const priced = EP.normalizeCreateInput({
    card, instanceId: 'inst_nowpriced', slot: 'ebay:fixed-price',
    price: 400, priceSource: 'seller',
  });
  const res2 = await SVC.createDraft(kv, SUB, priced, K('nowpriced'));
  const blocking2 = (res2.result.publishable?.violations || []).filter((x) => x.blocking);
  check('🔴 once a price exists, nothing blocks it',
        res2.result?.saved === true && blocking2.length === 0,
        JSON.stringify(blocking2.map((x) => x.code)));

  // And a source without a number is still refused at the door.
  let claim = '';
  try {
    EP.normalizeCreateInput({
      card, instanceId: 'inst_x', slot: 'ebay:fixed-price',
      price: undefined, priceSource: 'comp',
    });
  } catch (e) { claim = e.message; }
  check('🔴 "this came from a comp" with no comp is refused',
        /priceSource:no-price/.test(claim), claim || 'it was accepted');
}

// ── slot rejection happens before every side effect ───────────────────────
// Item 6 of the required return. An unsupported slot must not reserve quota,
// write an idempotency record, mutate the index, or persist a draft.
console.log('\nan unsupported slot changes nothing at all');
reset();
{
  const card = CARD();
  // Snapshot via the fake's own SCAN, not a guessed property. The first version
  // of this read `kv.store` — undefined on this stub — so both snapshots were
  // the string "undefined" and the assertion passed without inspecting
  // anything. A check that cannot fail is worse than no check.
  const snapshot = async () => {
    const [, keys] = await kv('scan', '0', 'match', '*', 'count', '10000');
    const out = {};
    for (const k of keys.sort()) { try { out[k] = await kv('get', k); } catch { out[k] = '<non-string>'; } }
    return JSON.stringify(out);
  };
  const before = await snapshot();
  check('the snapshot actually sees the store', before.length > 2, before);
  const norm = EP.normalizeCreateInput({
    card, instanceId: 'inst_slot', slot: 'etsy:fixed-price',
    price: 400, priceSource: 'seller',
  });
  check('normalize passes it through (the slot registry owns this rule)',
        norm.slot === 'etsy:fixed-price');

  let res = null, threw = '';
  try { res = await SVC.createDraft(kv, SUB, norm, K('slotbad')); }
  catch (e) { threw = e.message; }

  check('🔴 the create refuses the unsupported slot',
        /DRAFT_SLOT_INVALID/.test(threw), threw || JSON.stringify(res && res.result));

  const after = await snapshot();
  check('🔴 and leaves no trace: no draft, no index entry, no idempotency record',
        after === before,
        'a refusal that still wrote something would leak quota or block a retry');

  // The retry proof: because nothing was recorded, the same key is still free
  // for the corrected request rather than replaying the refusal forever.
  const good = EP.normalizeCreateInput({
    card, instanceId: 'inst_slot', slot: 'ebay:fixed-price',
    price: 400, priceSource: 'seller',
  });
  const res2 = await SVC.createDraft(kv, SUB, good, K('slotbad'));
  check('🔴 so the corrected retry on the same key succeeds',
        res2.state === IDEM.IDEMPOTENCY_STATE.FRESH && res2.result?.saved === true,
        `${res2.state} — a refusal must not poison its idempotency key`);
}


// ── PERMANENT INVARIANTS: what an unpriced draft is, and is not ─────────
//
// Decided in the D1 verdict. An unpriced draft is a NEUTRAL INCOMPLETE state
// — "Needs price" — not a warning and not a seller error. The draft was
// created successfully and is behaving exactly as intended, so the findings it
// carries must say one thing once. These are pinned permanently because the
// list, review and handoff screens all derive their state from these findings
// rather than from a client-side `if (!price)`, and a stray warning here would
// render as a defect the seller cannot act on.
console.log('\nan unpriced draft says one thing, once');
reset();
{
  const norm = EP.normalizeCreateInput({
    card: CARD(), instanceId: 'inst_inv', slot: 'ebay:fixed-price',
    price: undefined, priceSource: undefined,
  });
  const res = await SVC.createDraft(kv, SUB, norm, K('inv'));
  const v = res.result.publishable?.violations || [];
  const blocking = v.filter((x) => x.blocking);
  const codes = v.map((x) => x.code);

  check('\ud83d\udd34 EXACTLY ONE blocking finding, and it is PRICE_REQUIRED',
        blocking.length === 1 && blocking[0].code === DS.VIOLATION.PRICE_REQUIRED,
        JSON.stringify(blocking.map((x) => x.code)));
  check('\ud83d\udd34 NO missing-provenance warning about a price that does not exist',
        !codes.includes(DS.VIOLATION.NO_PROVENANCE),
        JSON.stringify(codes) + ' — two findings for one fact, the second incoherent');
  check('\ud83d\udd34 and no seller-priced info either — nobody priced it',
        !codes.includes(DS.VIOLATION.SELLER_PRICED), JSON.stringify(codes));
  check('\ud83d\udd34 so the whole finding set is one blocker and nothing else',
        v.length === 1, JSON.stringify(codes));
  check('\ud83d\udd34 zero warnings — this is incomplete, not defective',
        res.result.publishable.warnings === 0
        && res.result.publishable.infos === 0,
        `w=${res.result.publishable.warnings} i=${res.result.publishable.infos}`);

  // No fabricated provenance ANYWHERE in the persisted record.
  const stored = res.result.draft;
  check('\ud83d\udd34 the stored draft fabricates no priceSource',
        stored.priceSource === null || stored.priceSource === undefined,
        JSON.stringify(stored.priceSource));
  check('\ud83d\udd34 absence is null/undefined — never coerced to 0',
        stored.price !== 0 && (stored.price === null || stored.price === undefined),
        JSON.stringify(stored.price),
        '$0 is a real number eBay refuses, not a synonym for "no price"');
}

// ── $0 is NOT missing ─────────────────────────────────────────
// The distinction the verdict asked for explicitly. A seller who types 0 has
// stated a price; it is an invalid eBay price and the SLOT RULES refuse it.
// Folding it into "no price" would tell them to add a price they just added.
console.log('\na zero price is refused as invalid, not treated as absent');
reset();
{
  const norm = EP.normalizeCreateInput({
    card: CARD(), instanceId: 'inst_zero', slot: 'ebay:fixed-price',
    price: 0, priceSource: 'seller',
  });
  check('normalize accepts 0 — the slot registry owns this rule, not the parser',
        norm.price === 0);
  const res = await SVC.createDraft(kv, SUB, norm, K('zero'));
  const codes = (res.result.publishable?.violations || []).map((x) => x.code);
  check('\ud83d\udd34 $0 on eBay fixed-price is ZERO_PRICE',
        codes.includes(DS.VIOLATION.ZERO_PRICE), JSON.stringify(codes));
  check('\ud83d\udd34 and is NOT reported as a missing price',
        !codes.includes(DS.VIOLATION.PRICE_REQUIRED), JSON.stringify(codes));
  check('the seller who typed it keeps that provenance',
        res.result.draft.priceSource === 'seller');
  check('the stored 0 is a real 0, not nulled out',
        res.result.draft.price === 0, JSON.stringify(res.result.draft.price));
  // A PRESENT price reports its provenance — including 0. Found by mutation:
  // writing the presence check as `!!draft.price` still passed every other
  // assertion here while silently dropping the provenance finding for a $0
  // draft, because 0 is falsy. Presence is `!== null && !== undefined`, and
  // this is the assertion that says so out loud.
  check('\ud83d\udd34 a $0 draft still reports WHERE the 0 came from',
        codes.includes(DS.VIOLATION.SELLER_PRICED),
        JSON.stringify(codes)
        + ' — 0 is a present price, so provenance is still a question');

  // A venue that permits it accepts the same number — proving the refusal is
  // the slot's rule and not a global one.
  const wn = EP.normalizeCreateInput({
    card: CARD(), instanceId: 'inst_zero_wn', slot: 'whatnot:auction',
    price: 0, priceSource: 'seller',
  });
  const res3 = await SVC.createDraft(kv, SUB, wn, K('zerown'));
  const c3 = (res3.result.publishable?.violations || []).map((x) => x.code);
  check('\ud83d\udd34 the same $0 is fine on a venue whose rules allow it',
        !c3.includes(DS.VIOLATION.ZERO_PRICE) && !c3.includes(DS.VIOLATION.PRICE_REQUIRED),
        JSON.stringify(c3) + ' — proves the refusal belongs to the slot');
}


done();
