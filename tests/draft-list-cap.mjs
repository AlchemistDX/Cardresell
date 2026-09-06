// tests/draft-list-cap.mjs — C2/C3: the hydrated draft list and the draft cap
//
// The list is the screen a seller trusts to tell them what work they have. So
// the interesting cases are not "N drafts render as N rows" — they are the
// four ways a row can exist without being summarisable, and the one answer the
// list is never allowed to give: "you have no drafts" when it does not know.
//
// The cap's interesting case is likewise not "the 501st create is refused" —
// it is that a RETRY of an already-saved draft still succeeds while at the cap,
// because the check lives inside the idempotent operation rather than in front
// of it.
// The index module talks to Upstash over fetch(), so fetch is stubbed with an
// in-memory Redis that can be told to fail specific commands. That exercises
// the real code path rather than a re-implementation of it.

import { harness } from './_assert.mjs';
const { check, checkAsync, done } = harness('draft-list-cap');

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

/**
 * Put a seller at `n` active drafts without writing n records.
 *
 * Writes the index set AND the quota gate, because a seller who really has n
 * drafts has both. Stuffing only the set would build a world the API cannot
 * produce, and a test that passes only in an impossible world is not evidence.
 * Real drift between the two is exercised separately and on purpose.
 */
function stuffIndex(n) {
  if (!sets.has(`drafts:${SUB}`)) sets.set(`drafts:${SUB}`, new Set());
  const set = sets.get(`drafts:${SUB}`);
  while (set.size < n) set.add(`drf_${String(set.size).padStart(32, '0')}`);
  store.set(`draftquota:${SUB}`, String(set.size));
  store.set(`draftquotafresh:${SUB}`, '1');
  return set;
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



// The HTTP create contract (D1, 2026-09-06): the client names WHICH card and
// the server derives sku and title from it. A client-supplied sku or title is
// refused outright, so an HTTP-level create must not send them — `input()`
// below is still correct for direct SVC.createDraft calls, which take an
// already-normalized record.
const CARD = () => ({
  game: 'pokemon', set_name: 'Champions Path', card_number: '074/073',
  card_name: 'Charizard VMAX', rarity: 'Secret Rare', language: 'en',
});
const httpInput = (over = {}) => ({
  card: CARD(),
  instanceId: 'inst_abc123',
  slot: 'ebay:fixed-price',
  price: 400,
  ...over,
});

const input = (over = {}) => ({
  sku: 'v2-XXX7473-592a391e7b472559',
  instanceId: 'inst_abc123',
  slot: 'ebay:fixed-price',
  title: 'Charizard VMAX 074/073 PSA 10',
  price: 400,
  ...over,
});

function fakeReq({ method, body, query, headers }) {
  return {
    method, body, query: query || {},
    headers: headers === undefined ? { authorization: 'Bearer ' + 'x'.repeat(40) } : headers,
  };
}
function fakeRes() {
  return {
    statusCode: 0, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}

/** Create n drafts directly through the service, returning their ids. */
async function seed(n, over = () => ({})) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const out = await SVC.createDraft(kv, SUB, input({
      instanceId: `inst_${i}`,
      sku: `v2-SKU${i}-592a391e7b472559`,
      title: `Card number ${i}`,
      ...over(i),
    }), K(`seed-${i}`));
    ids.push(out.result.draftId);
  }
  return ids;
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\na row that cannot be read is still a row');

reset();
{
  const ids = await seed(3);

  const ok = await SVC.listDraftSummaries(kv, SUB, {});
  check('all three drafts hydrate', ok.count === 3 && ok.rows.every((r) => r.summary));
  check('the summary carries what a list row has to show',
        ok.rows.every((r) => r.summary.title && r.summary.price !== undefined
                          && r.summary.slot && r.summary.status && r.summary.sku));
  check('🔴 the summary does NOT carry the pricing packet',
        ok.rows.every((r) => !('packet' in r.summary)),
        'a 25-row list must not ship 25 pricing snapshots to render 25 lines of text');
  check('but it says whether one exists', ok.rows.every((r) => 'hasPacket' in r.summary));

  // ── unparseable bytes ──
  const victim = ids[1];
  store.set(`draft:${SUB}:${victim}`, '{not json at all');
  const corrupt = await SVC.listDraftSummaries(kv, SUB, {});
  check('🔴 a corrupt record does not silently vanish from the list',
        corrupt.count === 3,
        'dropping it would render as "that draft is gone" — one row at a time');
  const crow = corrupt.rows.find((r) => r.draftId === victim);
  check('it comes back as a stub naming its reason',
        crow && crow.summary === null && crow.reason === SVC.ROW_REASON.UNREADABLE);
  check('and the stub is not marked retryable', crow.retryable === false,
        'retrying a read of corrupt bytes returns the same corrupt bytes');

  // ── written by a newer build ──
  store.set(`draft:${SUB}:${victim}`, JSON.stringify({
    schemaVersion: DS.DRAFT_SCHEMA_VERSION + 1, draftId: victim, status: 'draft',
  }));
  const newer = await SVC.listDraftSummaries(kv, SUB, {});
  const nrow = newer.rows.find((r) => r.draftId === victim);
  check('a draft from a newer build is distinguished from a corrupt one',
        nrow && nrow.reason === SVC.ROW_REASON.SCHEMA_TOO_NEW,
        'the honest row says "update the app", not "this is broken"');

  // ── indexed but positively absent ──
  store.delete(`draft:${SUB}:${victim}`);
  const gone = await SVC.listDraftSummaries(kv, SUB, {});
  const grow = gone.rows.find((r) => r.draftId === victim);
  check('an indexed id with no record reads as VANISHED, not as a draft',
        grow && grow.reason === SVC.ROW_REASON.VANISHED);
  check('and it is still counted as a row', gone.count === 3,
        'the index says it exists; hiding the discrepancy hides the bug');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\na deleted draft is the one row that SHOULD disappear');

reset();
{
  const ids = await seed(3);
  const del = await SVC.deleteDraftOp(kv, SUB, ids[0], 1, K('del-0'));
  check('the delete succeeded', del.ok === true && del.draft.status === DS.DRAFT_STATUS.DELETED);

  const after = await SVC.listDraftSummaries(kv, SUB, {});
  check('a deleted draft is gone from the list', after.count === 2
        && !after.rows.some((r) => r.draftId === ids[0]));
  check('the surviving rows still hydrate', after.rows.every((r) => r.summary));

  // That path only proves the INDEX dropped it. The tombstone rule in the
  // hydrator matters in the degraded case: the tombstone was written but the
  // index eviction failed, so a deleted id is still listed.
  reset();
  const ids2 = await seed(3);
  failCommands = new Set(['srem']);
  const degraded = await SVC.deleteDraftOp(kv, SUB, ids2[0], 1, K('del-degraded'));
  failCommands = new Set();
  check('the tombstone is authoritative even when index eviction fails',
        degraded.ok === true && degraded.degraded === true,
        'a cache eviction cannot un-delete anything');
  check('the stale id is still in the index',
        [...sets.get(`drafts:${SUB}`)].includes(ids2[0]));

  const hyd = await SVC.listDraftSummaries(kv, SUB, {});
  check('🔴 the hydrator drops the tombstoned row anyway',
        hyd.count === 2 && !hyd.rows.some((r) => r.draftId === ids2[0]),
        'a tombstone is POSITIVE evidence the seller deleted it — omitting it is obedience, not a lie');
  check('and it is dropped, NOT shown as an unreadable stub',
        !hyd.rows.some((r) => r.summary === null),
        'the one deletion the seller asked for must not come back as a broken row');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\nthe list never answers "none" when it means "I do not know"');

reset();
{
  await seed(2);
  // Both the index read AND the authoritative scan fail.
  failCommands = new Set(['smembers', 'scan']);
  const blind = await SVC.listDraftSummaries(kv, SUB, {});
  check('🔴 a total read failure is unavailable, not empty',
        blind.unavailable === true && blind.count === 0,
        'returning [] here is the one answer that makes a seller think their work is gone');
  check('and it is flagged retryable', blind.retryable === true);
  failCommands = new Set();

  const rec = await SVC.listDraftSummaries(kv, SUB, {});
  check('once the store recovers the drafts are all there', rec.count === 2);
}

// ── the same distinction at the HTTP boundary ──
reset();
{
  await seed(1);
  failCommands = new Set(['smembers', 'scan']);
  const res = fakeRes();
  await EP.default(fakeReq({ method: 'GET', query: {} }), res);
  check('🔴 the endpoint returns 503, not 200 with an empty list',
        res.statusCode === 503, 'a 200 would be the UI rendering "no drafts yet"');
  check('and tells the client to retry', res.body.retryable === true);
  failCommands = new Set();
}

// ── a single row's read failing is not the whole list failing ──
reset();
{
  const ids = await seed(3);
  failCommands = new Set(['get']);
  failKeyPrefix = `draft:${SUB}:${ids[1]}`;
  const partial = await SVC.listDraftSummaries(kv, SUB, {});
  check('the other two rows still hydrate', partial.count === 3
        && partial.rows.filter((r) => r.summary).length === 2,
        'one unreadable row must not take the list down with it');
  const prow = partial.rows.find((r) => r.draftId === ids[1]);
  check('the failed row is marked READ_FAILED and retryable',
        prow.reason === SVC.ROW_REASON.READ_FAILED && prow.retryable === true,
        'unlike corrupt bytes, a failed store call may well succeed next time');
  failCommands = new Set(); failKeyPrefix = null;
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\npaging is stable while the seller edits');

reset();
{
  const ids = await seed(7);

  const p1 = await SVC.listDraftSummaries(kv, SUB, { limit: 3 });
  check('the first page honours the limit', p1.count === 3);
  check('total counts everything, not just this page', p1.total === 7);
  check('a cursor is offered', p1.nextCursor === 3);

  const p2 = await SVC.listDraftSummaries(kv, SUB, { limit: 3, cursor: p1.nextCursor });
  const p3 = await SVC.listDraftSummaries(kv, SUB, { limit: 3, cursor: p2.nextCursor });
  check('the last page ends the walk', p3.nextCursor === null);

  const walked = [...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.draftId);
  check('🔴 the three pages cover every draft exactly once',
        walked.length === 7 && new Set(walked).size === 7
        && ids.every((id) => walked.includes(id)));

  // The reason paging is over sorted ids rather than over the visible
  // "recently updated" order: editing between pages reorders freshness.
  await SVC.updateDraft(kv, SUB, ids[6], { title: 'Edited between pages' }, 1, K('edit-6'));
  const q1 = await SVC.listDraftSummaries(kv, SUB, { limit: 3 });
  const q2 = await SVC.listDraftSummaries(kv, SUB, { limit: 3, cursor: q1.nextCursor });
  const q3 = await SVC.listDraftSummaries(kv, SUB, { limit: 3, cursor: q2.nextCursor });
  const qw = [...q1.rows, ...q2.rows, ...q3.rows].map((r) => r.draftId);
  check('🔴 an edit between pages neither duplicates nor skips a row',
        qw.length === 7 && new Set(qw).size === 7,
        'paging over the freshness order would move an edited row across a page boundary');
}

// ── rows are ordered by recency WITHIN a page ──
reset();
{
  // Timestamps are pinned rather than produced by three creates in a row:
  // the whole seed runs inside one millisecond, so a real clock would leave
  // the comparator untested and the assertion passing on insertion order.
  const ids = await seed(3);
  const stamp = (id, t) => {
    const d = JSON.parse(store.get(`draft:${SUB}:${id}`));
    d.updatedAt = t;
    store.set(`draft:${SUB}:${id}`, JSON.stringify(d));
  };
  stamp(ids[0], 3000); stamp(ids[1], 1000); stamp(ids[2], 2000);
  const l = await SVC.listDraftSummaries(kv, SUB, {});
  check('🔴 rows are ordered most-recently-updated first',
        l.rows.map((r) => r.draftId).join() === [ids[0], ids[2], ids[1]].join(),
        'the list is a work queue; the draft they just touched belongs at the top');
}

// ── unsummarisable rows sort last, not by a timestamp they lack ──
reset();
{
  const ids = await seed(3);
  store.set(`draft:${SUB}:${ids[0]}`, '{broken');
  const l = await SVC.listDraftSummaries(kv, SUB, {});
  check('a stub row sorts after every readable row',
        l.rows[l.rows.length - 1].draftId === ids[0],
        'it has no updatedAt, so ordering it by one would be inventing a value');
}

// ── a page whose rows were all tombstoned still offers its cursor ──
reset();
{
  const ids = await seed(4);
  const sorted = [...ids].sort();
  // Delete both drafts on the first page of 2, with index eviction failing so
  // the ids remain listed. This is the case where a page can legitimately
  // hydrate to zero rows while more drafts exist behind it.
  failCommands = new Set(['srem']);
  await SVC.deleteDraftOp(kv, SUB, sorted[0], 1, K('d-a'));
  await SVC.deleteDraftOp(kv, SUB, sorted[1], 1, K('d-b'));
  failCommands = new Set();
  const p = await SVC.listDraftSummaries(kv, SUB, { limit: 2 });
  check('🔴 a fully-tombstoned page still hands back a cursor',
        p.count === 0 && p.nextCursor === 2,
        'a short page is not the end of the list — stopping here would hide the remaining drafts');
  const p2 = await SVC.listDraftSummaries(kv, SUB, { limit: 2, cursor: p.nextCursor });
  check('and the walk finds the survivors', p2.count === 2);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\nthe cap holds without breaking a retry');

reset();
{
  check('the cap is a guardrail, not a paywall', SVC.DRAFT_CAP >= 100,
        'Phase 4 bulk scanning needs room to work');

  await seed(3);
  stuffIndex(SVC.DRAFT_CAP);

  const refused = await SVC.createDraft(kv, SUB, input({ instanceId: 'inst_over' }), K('over-cap'))
    .then(() => null).catch((e) => e);
  check('a create at the cap is refused', refused && refused.message === SVC.SERVICE_ERR.DRAFT_CAP_REACHED);
  check('the refusal names the ceiling', refused.detail && refused.detail.cap === SVC.DRAFT_CAP);
  check('and says retrying will not help', refused.detail.retryable === false,
        'nothing is rate-limited; the seller has to finish or delete one');
}

// ── the whole reason the check lives inside the idempotent operation ──
reset();
{
  const first = await SVC.createDraft(kv, SUB, input({ instanceId: 'inst_keep' }), K('retry-me'));
  const savedId = first.result.draftId;
  check('the draft saved while under the cap', first.result.saved === true);

  stuffIndex(SVC.DRAFT_CAP);

  // Same idempotency key, same body: a client retrying a lost response.
  const replay = await SVC.createDraft(kv, SUB, input({ instanceId: 'inst_keep' }), K('retry-me'));
  check('🔴 a retry of an already-saved draft succeeds even at the cap',
        replay.replayed === true && replay.result.draftId === savedId,
        'checking the cap in front of the operation would turn a network retry into a refusal for work already done');

  // ...while a genuinely new create with a fresh key is still refused.
  const blocked = await SVC.createDraft(kv, SUB, input({ instanceId: 'inst_new' }), K('brand-new'))
    .then(() => null).catch((e) => e);
  check('but a genuinely new create is still refused',
        blocked && blocked.message === SVC.SERVICE_ERR.DRAFT_CAP_REACHED);
}

// ── the refusal releases the key, so it works again after making room ──
reset();
{
  const set0 = stuffIndex(SVC.DRAFT_CAP);

  const refused = await SVC.createDraft(kv, SUB, input(), K('same-key')).then(() => null).catch((e) => e);
  check('refused while full', refused && refused.message === SVC.SERVICE_ERR.DRAFT_CAP_REACHED);

  // The seller deletes something, then the client retries the SAME key. The
  // gate is decremented alongside the index, which is what a real delete does
  // via `releaseDraftSlot` — a test that shrank only the index would be
  // exercising drift, not deletion.
  for (let i = 0; i < 5; i++) set0.delete(`drf_${String(i).padStart(32, '0')}`);
  store.set(`draftquota:${SUB}`, String(set0.size));
  const now = await SVC.createDraft(kv, SUB, input(), K('same-key'));
  check('🔴 the same idempotency key works once there is room',
        now.result && now.result.saved === true,
        'a refused operation must not burn the key — otherwise the fix is "restart the app"');
}

// ── the cap fails OPEN when it cannot count ──
reset();
{
  failCommands = new Set(['scard']);
  const out = await SVC.createDraft(kv, SUB, input(), K('cannot-count'));
  check('🔴 an uncountable index does not block a save',
        out.result && out.result.saved === true,
        'refusing a real draft over an unreadable counter trades a certain loss for a hypothetical one');
  check('and remaining room is reported as unknown rather than guessed',
        out.result.capRemaining === null);
  failCommands = new Set();
}

reset();
{
  const out = await SVC.createDraft(kv, SUB, input(), K('room-left'));
  check('when the count IS known, remaining room is reported',
        out.result.capRemaining === SVC.DRAFT_CAP - 1);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\nthe endpoint speaks the list and the cap');

reset();
{
  await seed(2);
  const res = fakeRes();
  await EP.default(fakeReq({ method: 'GET', query: {} }), res);
  check('GET /api/drafts returns hydrated rows by default',
        res.statusCode === 200 && res.body.rows.length === 2 && res.body.rows[0].summary);
  check('the cap is advertised so the UI need not hardcode it', res.body.cap === SVC.DRAFT_CAP);

  const idsRes = fakeRes();
  await EP.default(fakeReq({ method: 'GET', query: { ids: '1' } }), idsRes);
  check('?ids=1 still serves the bare id list reconciliation depends on',
        idsRes.statusCode === 200 && Array.isArray(idsRes.body.draftIds)
        && idsRes.body.draftIds.length === 2 && idsRes.body.rows === undefined);
}

reset();
{
  await seed(3);
  for (const [q, code] of [
    [{ limit: 'abc' }, 400], [{ cursor: '-1' }, 400],
    [{ limit: '0' }, 400], [{ limit: '999' }, 400], [{ limit: '2' }, 200],
  ]) {
    const r = fakeRes();
    await EP.default(fakeReq({ method: 'GET', query: q }), r);
    check(`limit/cursor ${JSON.stringify(q)} → ${code}`, r.statusCode === code,
          'a bad paging param is a client bug; silently serving the default hides it');
  }
}

reset();
{
  const set = sets.get(`drafts:${SUB}`) || (sets.set(`drafts:${SUB}`, new Set()), sets.get(`drafts:${SUB}`));
  for (let i = 0; i < SVC.DRAFT_CAP; i++) set.add(`drf_${String(i).padStart(32, '0')}`);
  const res = fakeRes();
  await EP.default(fakeReq({
    method: 'POST', body: httpInput(),
    headers: { authorization: 'Bearer ' + 'x'.repeat(40), 'idempotency-key': K('http-cap') },
  }), res);
  check('🔴 a create at the cap is 409, not 500',
        res.statusCode === 409, 'the server is fine; the account is full');
  check('🔴 and not 429 either', res.statusCode !== 429,
        'nothing is rate-limited and waiting does not help');
  check('the body names the code and the ceiling',
        res.body.code === SVC.SERVICE_ERR.DRAFT_CAP_REACHED && res.body.cap === SVC.DRAFT_CAP);
  check('the message tells the seller what to actually do',
        /delete/i.test(res.body.error) && String(res.body.error).includes(String(SVC.DRAFT_CAP)));
  check('and it is not advertised as retryable', res.body.retryable === false);
}


// ══════════════════════════════════════════════════════════════════════════
console.log('\nonly ERROR blocks a handoff');

{
  const base = { slot: 'ebay:fixed-price', title: 'Charizard VMAX PSA 10', price: 400, packet: {} };

  const clean = DS.validateDraftForSlot(base);
  check('a complete draft is publishable', clean.ok === true && clean.errors === 0);
  check('and reports no blocking findings', clean.blocking.length === 0);

  // ── the tier contract itself ──
  check('🔴 ERROR blocks', DS.blocks(DS.SEVERITY.ERROR) === true);
  check('🔴 WARNING does not block', DS.blocks(DS.SEVERITY.WARNING) === false,
        'if a warning blocks, nobody will ever add one, and the tier is dead');
  check('🔴 INFO does not block', DS.blocks(DS.SEVERITY.INFO) === false);

  // ── an unknown code defaults to blocking ──
  check('🔴 a code with no declared severity is treated as ERROR',
        DS.severityOf('SOME_CHECK_ADDED_WITHOUT_A_DECISION') === DS.SEVERITY.ERROR,
        'a new check with a forgotten severity should stop a handoff and get noticed, not sail through unread');

  // ── "the seller typed it" is provenance; "nobody knows" is a defect ──
  //
  // These were one finding, and collapsing them taught the system that
  // provenance means "came from our pricing engine". A seller-entered price
  // is a complete answer to where the number came from.
  const typed = DS.validateDraftForSlot({
    slot: 'ebay:fixed-price', title: 'Charizard', price: 400,
    priceSource: DS.PRICE_SOURCE.SELLER,
  });
  check('🔴 a seller-entered price is recorded as provenance, not as missing',
        typed.violations.some((x) => x.code === DS.VIOLATION.SELLER_PRICED)
        && !typed.violations.some((x) => x.code === DS.VIOLATION.NO_PROVENANCE));
  check('and it is INFO, so it never blocks', typed.ok === true && typed.blocking.length === 0);
  check('the seller can read it', /you set this price/i.test(
        typed.violations.find((x) => x.code === DS.VIOLATION.SELLER_PRICED).message));

  const np = DS.validateDraftForSlot({ slot: 'ebay:fixed-price', title: 'Charizard', price: 400 });
  check('a price with no stated origin still raises a finding',
        np.violations.some((x) => x.code === DS.VIOLATION.NO_PROVENANCE));
  check('🔴 it is a WARNING — a data-quality defect, not a neutral fact',
        DS.severityOf(DS.VIOLATION.NO_PROVENANCE) === DS.SEVERITY.WARNING);
  check('🔴 but it still does NOT block the listing',
        np.ok === true && np.blocking.length === 0,
        'blocking would refuse to list a real draft over a missing label');
  check('🔴 a missing source is never defaulted to "seller"',
        !np.violations.some((x) => x.code === DS.VIOLATION.SELLER_PRICED),
        'defaulting would silence the warning on every draft, which is the whole failure');
  check('an unrecognised price source is refused outright',
        (() => { try { DS.buildDraft({ slot: 'ebay:fixed-price', sku: 'v2-A-592a391e7b472559',
                 instanceId: 'i', title: 't', price: 1, priceSource: 'vibes' }); return false; }
                 catch (e) { return /priceSource/.test(e.message); } })());

  // ── errors block, and say why ──
  const long = DS.validateDraftForSlot({ ...base, title: 'x'.repeat(120) });
  check('an over-length title blocks', long.ok === false && long.errors === 1);
  const lv = long.violations.find((x) => x.code === DS.VIOLATION.TITLE_TOO_LONG);
  check('the finding is marked blocking', lv.blocking === true);
  check('it names the field', lv.field === 'title');
  check('the detail stays machine-readable', lv.detail === '120 > 80');
  check('🔴 and it carries a sentence a seller can act on',
        /120/.test(lv.message) && /80/.test(lv.message) && /eBay/.test(lv.message)
        && /\b40\b/.test(lv.message),
        'the message should say how much to cut, not just that it is too long');

  const noPrice = DS.validateDraftForSlot({ slot: 'ebay:fixed-price', title: 'ok', packet: {} });
  check('a missing price blocks',
        noPrice.ok === false
        && noPrice.violations.some((x) => x.code === DS.VIOLATION.PRICE_REQUIRED && x.blocking));

  const zero = DS.validateDraftForSlot({ ...base, price: 0 });
  check('a zero price blocks on eBay fixed-price', zero.ok === false);
  const zeroWhatnot = DS.validateDraftForSlot({ ...base, slot: 'whatnot:auction', price: 0 });
  check('🔴 but not on a Whatnot auction, where zero is the point',
        zeroWhatnot.ok === true,
        'the slot rules are per-venue; a single global price rule would break auctions');

  const unknown = DS.validateDraftForSlot({ ...base, slot: 'craigslist:barter' });
  check('an unknown slot blocks and names itself',
        unknown.ok === false
        && unknown.violations[0].code === DS.VIOLATION.UNKNOWN_SLOT
        && unknown.violations[0].message.includes('craigslist:barter'));

  // ── every message is human text, not a code echo ──
  for (const code of Object.values(DS.VIOLATION)) {
    const m = DS.reasonMessage(code, { length: 100, max: 80, venue: 'eBay', slot: 'ebay:fixed-price' });
    check(`${code} has a seller-facing message`,
          typeof m === 'string' && m.length > 15 && !m.includes('SLOT_') && !m.includes('_'),
          'a screen showing the raw code is a screen that made the seller guess');
  }

  // ── counts add up ──
  // FIXTURE NOTE (D2 readiness consolidation): this used to be an UNPRICED
  // draft, which produced three findings only because an absent price also
  // collected a NO_PROVENANCE warning — two complaints about one fact, the
  // second one incoherent (there was no number claiming an origin). That
  // double-report is gone, so an unpriced draft now yields two errors and no
  // warning, and this fixture had to change to keep testing what it was
  // written to test.
  //
  // A $0 price with no stated source is the honest three-finding case: the
  // title is too long (error), $0 is not a valid Mercari price (error), and a
  // price that IS present with no nameable origin is a real data-quality
  // warning. Same counts, all three now defensible.
  const multi = DS.validateDraftForSlot({
    slot: 'mercari:fixed-price', title: 'y'.repeat(60), price: 0,
  });
  check('several findings are all reported, not just the first',
        multi.violations.length === 3
        && multi.errors === 2 && multi.warnings === 1,
        'fixing one field at a time across three round trips is not a review screen');
  // And the reason the warning exists here is the present-but-unattributed
  // price — pinned so this fixture cannot drift back to the incoherent one.
  check('\ud83d\udd34 the warning is about a price that exists, not one that does not',
        multi.violations.some((x) => x.code === DS.VIOLATION.NO_PROVENANCE)
        && !multi.violations.some((x) => x.code === DS.VIOLATION.PRICE_REQUIRED),
        JSON.stringify(multi.violations.map((x) => x.code)));
  check('and only the errors are blocking', multi.blocking.length === 2 && multi.ok === false);
  check('🔴 a WARNING is counted but does not change the verdict',
        multi.warnings === 1 && !multi.blocking.some((x) => x.severity === DS.SEVERITY.WARNING));

  // ── the WARNING tier has exactly one rule, and it is the deliberate one ──
  //
  // This guard used to assert the tier was EMPTY. It is no longer empty: an
  // unattributable price is a genuine data-quality defect and earns a warning
  // without needing a threshold invented for it. The guard is kept, narrowed
  // to the rules actually decided, so the next warning still has to be an
  // explicit choice rather than a quiet addition.
  const warned = Object.entries(DS.VIOLATION_SEVERITY)
    .filter(([, sev]) => sev === DS.SEVERITY.WARNING)
    .map(([code]) => code);
  check('the WARNING tier holds only the rule that was actually decided',
        warned.length === 1 && warned[0] === DS.VIOLATION.NO_PROVENANCE,
        'the stale-quote threshold is still a product decision, not a number to invent because a tier looked thin');
}

// ── the reasons reach the client, not just the server ────────────────────
console.log('\nthe refusal reason survives the HTTP boundary');

reset();
{
  const created = await SVC.createDraft(kv, SUB, input({ title: 'z'.repeat(120) }), K('too-long'));
  const p = created.result.publishable;
  check('an unpublishable draft still SAVES', created.result.saved === true,
        'a draft is allowed to be incomplete; it is not allowed to be published incomplete');
  check('and carries its blocking reason', p.ok === false && p.blocking.length >= 1);

  const res = fakeRes();
  await EP.default(fakeReq({ method: 'GET', query: { id: created.result.draftId } }), res);
  check('GET returns the publishable verdict', res.statusCode === 200 && res.body.publishable.ok === false);
  check('🔴 with the message, severity and field for each finding',
        res.body.publishable.violations.every((v) => v.message && v.severity && v.field),
        'the review screen must not have to re-derive why the handoff is blocked');
}


// ══════════════════════════════════════════════════════════════════════════
console.log('\nthe cap is a ceiling under concurrency, not just in sequence');

reset();
{
  // One slot left.
  const set = stuffIndex(SVC.DRAFT_CAP - 1);
  check(`setup: ${SVC.DRAFT_CAP - 1} drafts, one slot left`, set.size === SVC.DRAFT_CAP - 1);

  // Twenty genuinely different creates, each with its own idempotency key.
  // Idempotency cannot help here: these are twenty distinct intents, and it is
  // correct for twenty distinct intents to each attempt a create. Only the
  // quota may stop them.
  const attempts = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      SVC.createDraft(kv, SUB, input({ instanceId: `inst_race_${i}`, sku: `v2-RACE${i}-592a391e7b472559` }), K(`race-${i}`))
        .then((r) => ({ ok: true, r }))
        .catch((e) => ({ ok: false, e })))
  );

  const saved = attempts.filter((a) => a.ok && a.r.result && a.r.result.saved === true);
  const refused = attempts.filter((a) => !a.ok && a.e.message === SVC.SERVICE_ERR.DRAFT_CAP_REACHED);

  check('every attempt resolved as either a save or a cap refusal',
        saved.length + refused.length === 20,
        `saved=${saved.length} refused=${refused.length}`);
  check('🔴 exactly ONE create won the last slot',
        saved.length === 1,
        `${saved.length} creates succeeded into a single free slot`);
  check('🔴 the active count never exceeds the cap',
        sets.get(`drafts:${SUB}`).size <= SVC.DRAFT_CAP,
        `ended at ${sets.get(`drafts:${SUB}`).size}, cap is ${SVC.DRAFT_CAP}`);
  check('and the other nineteen were told the cap, not an internal error',
        refused.length === 19);
}


// ══════════════════════════════════════════════════════════════════════════
console.log('\nthe gate is kept honest over a draft lifetime');

reset();
{
  // Deleting must give the slot back, or the cap ratchets: a seller who has
  // created and deleted 500 drafts would be permanently full with nothing
  // saved.
  const ids = await seed(3);
  check('setup: the gate counted the creates', store.get(`draftquota:${SUB}`) === '3');

  await SVC.deleteDraftOp(kv, SUB, ids[0], 1, K('q-del'));
  check('🔴 a delete releases the slot', store.get(`draftquota:${SUB}`) === '2',
        'a cap that only counts up ratchets a seller into a ceiling they cannot clear');

  // A repeated delete must not release twice — that would hand out a slot the
  // seller never freed.
  await SVC.deleteDraftOp(kv, SUB, ids[0], 1, K('q-del-again')).catch(() => {});
  check('🔴 deleting an already-deleted draft does not release a second slot',
        store.get(`draftquota:${SUB}`) === '2');
}

reset();
{
  // A create that reserves and then fails to write must not leak the slot.
  stuffIndex(10);
  failCommands = new Set(['set']);
  await SVC.createDraft(kv, SUB, input({ instanceId: 'inst_fail' }), K('q-fail')).catch(() => {});
  failCommands = new Set();
  check('🔴 a create that failed to persist gives its slot back',
        store.get(`draftquota:${SUB}`) === '10',
        'leaked slots accumulate silently into a seller locked out below their real limit');
}

reset();
{
  // Downward drift — an evicted counter, or drafts written before the gate
  // existed. The cap must not silently stop enforcing.
  stuffIndex(SVC.DRAFT_CAP);
  store.delete(`draftquota:${SUB}`);
  store.delete(`draftquotafresh:${SUB}`);

  const blocked = await SVC.createDraft(kv, SUB, input({ instanceId: 'inst_drift' }), K('q-drift'))
    .then(() => null).catch((e) => e);
  check('🔴 a missing gate is re-derived from the index, not treated as zero',
        blocked && blocked.message === SVC.SERVICE_ERR.DRAFT_CAP_REACHED,
        'INCR on an absent key returns 1 — without seeding, a full seller would look empty');
}

reset();
{
  // Upward drift — leaked slots say full when the seller has room. The first
  // attempt is refused (a disagreement is not evidence of room during a
  // concurrent burst), but it marks the gate stale so the retry succeeds.
  stuffIndex(100);
  store.set(`draftquota:${SUB}`, String(SVC.DRAFT_CAP));

  const first = await SVC.createDraft(kv, SUB, input({ instanceId: 'inst_leak1' }), K('q-leak-1'))
    .then(() => null).catch((e) => e);
  check('a leaked gate refuses once', first && first.message === SVC.SERVICE_ERR.DRAFT_CAP_REACHED);
  check('and the refusal reports the INDEX count, not the drifted gate',
        first.detail.count === 100,
        'telling a seller with 100 drafts that they have 500 is a lie the UI would repeat');
  check('the stale gate was marked for re-derivation',
        store.get(`draftquotafresh:${SUB}`) === undefined);

  const second = await SVC.createDraft(kv, SUB, input({ instanceId: 'inst_leak2' }), K('q-leak-2'));
  check('🔴 and the very next attempt succeeds',
        second.result && second.result.saved === true,
        'a seller must not be locked out below their real limit by a counter nobody can see');
  check('the gate now agrees with the index', store.get(`draftquota:${SUB}`) === '101');
}

reset();
{
  // The gate must never be the reason a draft is lost.
  stuffIndex(5);
  failCommands = new Set(['incr']);
  const out = await SVC.createDraft(kv, SUB, input({ instanceId: 'inst_open' }), K('q-open'));
  failCommands = new Set();
  check('🔴 an unreachable gate does not block a save', out.result.saved === true,
        'refusing real work over an unreadable counter trades a certain loss for a hypothetical one');
  check('and remaining room is reported as unknown rather than guessed',
        out.result.capRemaining === null);
}


// ══════════════════════════════════════════════════════════════════════════
console.log('\na row the seller can see must be a row the seller can resolve');

reset();
{
  const ids = await seed(2);
  // Corrupt one record's bytes. The index still lists it, so it is visible.
  store.set(`draft:${SUB}:${ids[0]}`, '{not json at all');

  const listed = await SVC.listDraftSummaries(kv, SUB, { limit: 50 });
  const stub = listed.rows.find((r) => r.draftId === ids[0]);
  check('setup: the corrupt draft is visible as a stub', stub && stub.summary === null);
  check('and it is flagged unreadable', stub.reason === 'DRAFT_UNREADABLE');

  const before = store.get(`draftquota:${SUB}`);
  const del = await SVC.deleteDraftOp(kv, SUB, ids[0], 1, K('trap-del'))
    .then((r) => r).catch((e) => ({ threw: e.message }));
  check('🔴 the seller can remove a draft nobody can read',
        del && del.ok === true,
        'visible + counts against the cap + impossible to delete is a permanent dead row');
  check('🔴 and removing it frees the slot it was occupying',
        store.get(`draftquota:${SUB}`) === String(Number(before) - 1));

  const after = await SVC.listDraftSummaries(kv, SUB, { limit: 50 });
  check('and it is gone from the list', !after.rows.some((r) => r.draftId === ids[0]));
}


reset();
{
  // The waived revision check must not become a route around concurrency.
  const ids = await seed(1);
  const dis = await DS.discardDraft(kv, SUB, ids[0], 'op-x');
  check('🔴 discard refuses a draft that reads perfectly well',
        dis.ok === false && dis.error === DS.ERR.NOT_DISCARDABLE,
        'otherwise "delete without a revision" is available on any draft by calling the other path');

  const still = await DS.getDraft(kv, SUB, ids[0]);
  check('and the healthy draft is untouched', still.ok === true && still.draft.rev === 1);
}

reset();
{
  // A record written by a NEWER deploy is not damaged — it is ahead of us.
  const ids = await seed(1);
  const rec = JSON.parse(store.get(`draft:${SUB}:${ids[0]}`));
  rec.schemaVersion = DS.DRAFT_SCHEMA_VERSION + 5;
  store.set(`draft:${SUB}:${ids[0]}`, JSON.stringify(rec));

  const dis = await DS.discardDraft(kv, SUB, ids[0], 'op-y');
  check('🔴 discard refuses a record newer than this deploy',
        dis.ok === false && dis.error === DS.ERR.SCHEMA_TOO_NEW,
        'destroying data a newer build understands because an older one cannot read it is the worst move available');

  const kept = store.get(`draft:${SUB}:${ids[0]}`);
  check('and the newer record is still there for the client that wrote it',
        JSON.parse(kept).schemaVersion === DS.DRAFT_SCHEMA_VERSION + 5);
}

reset();
{
  // Indexed but absent: cleanup, not a tombstone for a record that never was.
  const ids = await seed(2);
  store.delete(`draft:${SUB}:${ids[0]}`);

  const del = await SVC.deleteDraftOp(kv, SUB, ids[0], 1, K('trap-vanish'));
  check('🔴 a vanished row can be cleared off the list', del.ok === true);
  check('and no tombstone was invented for a record that never existed',
        store.get(`draft:${SUB}:${ids[0]}`) === undefined,
        'a 90-day key asserting a deletion that never happened is a fabricated fact');
  check('the index no longer advertises it',
        !sets.get(`drafts:${SUB}`).has(ids[0]));
  check('and the slot came back', store.get(`draftquota:${SUB}`) === '1');
}

reset();
{
  // An id that was never this seller's stays a plain not-found. Reporting a
  // successful delete for any string would make the endpoint a liar.
  await seed(1);
  const bogus = `drf_${'a'.repeat(32)}`;
  const del = await SVC.deleteDraftOp(kv, SUB, bogus, 1, K('trap-bogus'))
    .then((r) => r).catch((e) => ({ threw: e.message }));
  check('🔴 an id that is not in the index is still not found',
        del && del.ok === false && del.error === DS.ERR.NOT_FOUND);
}

// ── the obligation, stated as a test ──────────────────────────────────────
//
// Every reason the list can show a row it could not hydrate must have an
// answer to "what can the seller do about this?". A new reason added without
// one fails here rather than shipping as a permanent dead row.
{
  const RESOLUTION = {
    DRAFT_UNREADABLE:     'discard',   // bytes will not parse — delete clears it
    DRAFT_VANISHED:       'discard',   // indexed, no record — delete clears it
    DRAFT_READ_FAILED:    'retry',     // transient; the row is fine
    DRAFT_SCHEMA_TOO_NEW: 'newer-client', // intact and owned by a newer deploy
  };
  const reasons = Object.values(SVC.ROW_REASON);
  check('🔴 every stub reason has a stated resolution',
        reasons.every((r) => RESOLUTION[r]),
        'a visible row with no working action is worse than either hiding it or failing the list');
  check('and the only ones without a self-service fix are the recoverable ones',
        reasons.filter((r) => RESOLUTION[r] === 'discard').length === 2
        && RESOLUTION[SVC.ROW_REASON.READ_FAILED] === 'retry',
        'READ_FAILED must stay retryable — discarding a draft over a flaky read destroys a good draft');
}

done();
