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
    default: return null;
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


const input = () => ({
  sku: 'v2-XXX7473-592a391e7b472559',
  instanceId: 'inst_abc123',
  slot: 'ebay:fixed-price',
  title: 'Charizard VMAX 074/073 PSA 10',
  price: 400,
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
  sku: '  v2-XXX7473-592a391e7b472559 ', instanceId: 'inst_abc123',
  slot: 'eBay:Fixed-Price', title: '  Charizard  ', price: '400.005',
});
check('🔴 an id keeps its casing', n.sku === 'v2-XXX7473-592a391e7b472559',
      'lowercasing ids would corrupt every real SKU and refuse every genuine retry');
check('a token is lowercased', n.slot === 'ebay:fixed-price');
check('text is trimmed', n.title === 'Charizard');
check('money is rounded to cents once, here', n.price === 400.01);
check('a dollar sign is accepted from a text input', EP.normalizeCreateInput({ ...input(), price: '$19.99' }).price === 19.99);
check('a negative price is refused', (() => {
  try { EP.normalizeCreateInput({ ...input(), price: -1 }); return false; }
  catch (e) { return e.message === 'DRAFT_FIELD_INVALID:price:negative'; }
})());
check('a non-numeric price is refused', (() => {
  try { EP.normalizeCreateInput({ ...input(), price: 'free' }); return false; }
  catch (e) { return e.message.endsWith(':not-a-number'); }
})());
check('🔴 a strategy that disagrees with the slot is refused', (() => {
  try { EP.normalizeCreateInput({ ...input(), strategy: 'auction' }); return false; }
  catch (e) { return e.message === 'DRAFT_FIELD_INVALID:strategy:disagrees-with-slot'; }
})(), 'silently preferring one would make two different-looking requests behave identically');
check('a strategy that agrees is accepted',
      EP.normalizeCreateInput({ ...input(), strategy: 'Fixed-Price' }).strategy === 'fixed-price');

console.log('\nthe endpoint refuses to invent an idempotency key');
reset();
const res = fakeRes();
await EP.default(fakeReq({ method: 'POST', body: input() }), res);
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
await EP.default(fakeReq({ method: 'POST', body: input(), headers: { 'idempotency-key': K('http-post') } }), res3);
check('a valid POST is 201 with the draft', res3.statusCode === 201 && !!res3.body.draft);
const res4 = fakeRes();
await EP.default(fakeReq({ method: 'POST', body: input(), headers: { 'idempotency-key': K('http-post') } }), res4);
check('🔴 the replay is 200, not 201, with the same draftId',
      res4.statusCode === 200 && res4.body.draftId === res3.body.draftId &&
      res4.body.replayed === true);
const res5 = fakeRes();
await EP.default(fakeReq({ method: 'POST', body: { ...input(), price: 12 }, headers: { 'idempotency-key': K('http-post') } }), res5);
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

done();
