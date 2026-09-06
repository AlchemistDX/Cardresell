// tests/draft-focus.mjs — D2.1 / Amendment 2: the `focus` list parameter
//
// The bug this exists to prevent is not a crash. It is a client that renders
// page 1, looks for the draft the seller just created, does not find it, and
// either pages forward 20 times or quietly shows a list without it.
//
// Draft ids are random (`newDraftId`) and paging sorts them lexically, so a new
// draft's page position is uniformly distributed. At the 500-draft cap the id is
// on page 1 about 5% of the time. `focus` moves that lookup to the server, which
// already holds the sorted id array.
//
// The cases that matter here are the two absences and the one that looks like a
// success:
//   · the id is genuinely not indexed yet (reconcile path) -> null, page 1
//   · the id resolves but its row was tombstoned          -> offset, no row
//   · the id resolves and the row is there                -> offset, row present
// The first two must be indistinguishable to the screen, because the screen is
// not allowed to guess a cause it cannot know.
//
// Contract: audit/DRAFT_LIST_API_CONTRACT.md §2.8, §3.1a, Part 4 cases 16-20.
// Cases 21 and 22 are screen behaviour and are not testable until D2.1's client
// half exists; they are listed in the contract, not asserted here.

import { harness } from './_assert.mjs';
const { check, checkAsync, done } = harness('draft-focus');

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
console.log('\nthe predicate that owns the draft-id format');

{
  check('a real generated id passes', DS.isDraftId(DS.newDraftId()));
  check('the shape is drf_ plus 32 lowercase hex',
        DS.isDraftId('drf_' + 'a'.repeat(32)) && DS.isDraftId('drf_' + '0'.repeat(32)));
  check('uppercase hex is refused', !DS.isDraftId('drf_' + 'A'.repeat(32)));
  check('wrong length is refused',
        !DS.isDraftId('drf_' + 'a'.repeat(31)) && !DS.isDraftId('drf_' + 'a'.repeat(33)));
  check('missing prefix is refused', !DS.isDraftId('a'.repeat(32)));
  check('a trailing newline does not sneak through',
        !DS.isDraftId('drf_' + 'a'.repeat(32) + '\n'),
        'an unanchored regex would accept this');
  check('non-strings are refused',
        !DS.isDraftId(null) && !DS.isDraftId(undefined) && !DS.isDraftId(123) && !DS.isDraftId({}));
  check('empty is refused', !DS.isDraftId(''));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\ncase 16 — a mid-list id resolves to its own page in one request');

reset();
{
  const ids = await seed(9);
  const sorted = [...ids].sort();

  // Pick an id that is NOT on page 1 under a limit of 3, so the assertion is
  // about the server finding it rather than about it happening to be first.
  const target = sorted[7];
  const before = seen.length;
  const p = await SVC.listDraftSummaries(kv, SUB, { limit: 3, focus: target });

  check('focusOffset is the absolute offset in the sorted id order',
        p.focusOffset === 7, `got ${p.focusOffset}`);
  check('the served page is the one containing it',
        p.rows.some((r) => r.draftId === target));
  check('the page is aligned to a limit boundary',
        p.rows.length === 3 && sorted.slice(6, 9).every((id) => p.rows.some((r) => r.draftId === id)),
        'an unaligned window would make nextCursor describe a walk that skips rows');
  check('nextCursor is correct for that page, not for page 1',
        p.nextCursor === 9 || p.nextCursor === null, `got ${p.nextCursor}`);
  check('total still counts every indexed id', p.total === 9);
  check('it took one list call, not a walk',
        seen.slice(before).filter((c) => c === 'smembers').length <= 1);

  // The same page reached by cursor must be the same page.
  const byCursor = await SVC.listDraftSummaries(kv, SUB, { limit: 3, cursor: 6 });
  check('🔴 focus and the equivalent cursor produce the identical page',
        JSON.stringify(byCursor.rows.map((r) => r.draftId).sort())
          === JSON.stringify(p.rows.map((r) => r.draftId).sort()),
        'focus must resolve to an offset and then stop being special');
  check('and the identical nextCursor', byCursor.nextCursor === p.nextCursor);

  // First and last, because boundaries are where alignment arithmetic breaks.
  const first = await SVC.listDraftSummaries(kv, SUB, { limit: 3, focus: sorted[0] });
  check('the first id resolves to offset 0 on page 1',
        first.focusOffset === 0 && first.rows.some((r) => r.draftId === sorted[0]));
  const last = await SVC.listDraftSummaries(kv, SUB, { limit: 3, focus: sorted[8] });
  check('the last id resolves to its own offset and page',
        last.focusOffset === 8 && last.rows.some((r) => r.draftId === sorted[8]));
  check('the last page offers no cursor', last.nextCursor === null);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\ncase 17 — an id absent from the index is page 1 and a null, not an error');

reset();
{
  await seed(5);
  const absent = DS.newDraftId();
  const p = await SVC.listDraftSummaries(kv, SUB, { limit: 3, focus: absent });

  check('focusOffset is null', p.focusOffset === null);
  check('🔴 the list is served, not refused',
        p.rows.length === 3 && p.unavailable === false,
        'a create through the reconcile path is SAVED; refusing here would read as loss');
  check('page 1 is what is served',
        JSON.stringify(p.rows.map((r) => r.draftId))
          === JSON.stringify((await SVC.listDraftSummaries(kv, SUB, { limit: 3 })).rows.map((r) => r.draftId)));
  check('degraded is not invented on the seller\'s behalf', p.degraded === false,
        'the absence is a fact about the index, not a claim about this read');
  check('total is unaffected', p.total === 5);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\ncase 19 — the trap: a real offset whose row is gone');

reset();
{
  const ids = await seed(4);
  const sorted = [...ids].sort();
  const target = sorted[1];

  // Tombstone the record while leaving the id in the index — exactly the race
  // between an index write and a hydration read.
  await SVC.deleteDraftOp(kv, SUB, target, 1, K('tomb-focus'));
  if (!sets.get(`drafts:${SUB}`).has(target)) sets.get(`drafts:${SUB}`).add(target);

  const p = await SVC.listDraftSummaries(kv, SUB, { limit: 10, focus: target });

  check('focusOffset is a real integer', Number.isInteger(p.focusOffset) && p.focusOffset === 1);
  check('🔴 and the row is NOT in rows', !p.rows.some((r) => r.draftId === target),
        'this is why focusOffset is a signal and never row arithmetic');
  check('count reflects the surviving rows', p.count === p.rows.length && p.count === 3);
  check('the page still renders the other rows', p.count === 3);
  check('🔴 a non-null offset therefore cannot be used to index into rows',
        p.rows[p.focusOffset] === undefined || p.rows[p.focusOffset].draftId !== target,
        'a client doing rows[focusOffset] would highlight the wrong seller row');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\ncase 20 — at the cap, and past it via index drift');

reset();
{
  // 500 REAL drafts. An index stuffed with ids that have no records behind them
  // is a world the API cannot produce: the index reconciles the orphans away and
  // the list correctly reports zero. That fixture passed a weaker assertion and
  // proved nothing, which is why it is not used here.
  const ids = await seed(500);
  const sorted = [...ids].sort();

  const before = seen.length;
  const p = await SVC.listDraftSummaries(kv, SUB, { limit: 25, focus: sorted[499] });
  check('the index really holds 500', p.total === 500);
  check('offset 499 resolves', p.focusOffset === 499, `got ${p.focusOffset}`);
  check('and lands on the final page', p.nextCursor === null);
  check('the row is on the page it served', p.rows.some((r) => r.draftId === sorted[499]));
  check('🔴 in one request, not twenty',
        seen.slice(before).filter((c) => c === 'smembers').length <= 1,
        'the whole point of the parameter');

  // ── past the cap ──
  //
  // The 519 in `api/_draftService.js:162` came from a read-then-compare cap that
  // the atomic reservation in `_draftQuota.js` replaced, so `createDraft` can no
  // longer produce an over-cap index. It is still reachable as index/quota drift:
  // records exist, the index knows them, the quota counter is behind. Those are
  // real stored records copied at the store's own key, not invented rows.
  const raw = store.get(DS.draftKey(SUB, sorted[0]));
  const extra = [];
  for (let i = 0; i < 19; i++) {
    const rec = JSON.parse(raw);
    const id = `drf_${String(90000 + i).padStart(32, '0')}`;
    if (rec.draft && rec.draft.draftId) rec.draft.draftId = id;
    if (rec.draftId) rec.draftId = id;
    store.set(DS.draftKey(SUB, id), JSON.stringify(rec));
    sets.get(`drafts:${SUB}`).add(id);
    extra.push(id);
  }

  const all = [...sets.get(`drafts:${SUB}`)].sort();
  check('the drifted index is over the cap', all.length === 519);

  const q = await SVC.listDraftSummaries(kv, SUB, { limit: 25, focus: all[518] });
  check('total reports the real over-cap count', q.total === 519, `got ${q.total}`);
  check('🔴 offset 518 resolves too, past the cap',
        q.focusOffset === 518, `got ${q.focusOffset}`);
  check('and the offset arithmetic carries no page bound',
        q.rows.length > 0 && q.nextCursor === null,
        'a client loop bounded at 20 pages would fail on exactly the seller it was written for');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\ncase 18 — misuse is refused at the HTTP boundary, never clamped');

reset();
{
  await seed(2);
  const good = DS.newDraftId();

  const call = async (query) => {
    const res = fakeRes();
    await EP.default(fakeReq({ method: 'GET', query }), res);
    return res;
  };

  const bad = await call({ focus: 'not-a-draft-id' });
  check('a malformed focus is a 400', bad.statusCode === 400, `got ${bad.statusCode}`);
  check('with code LIST_FOCUS_INVALID', bad.body && bad.body.code === 'LIST_FOCUS_INVALID');
  check('🔴 and no rows are served alongside the refusal',
        !bad.body || !('rows' in bad.body),
        'serving page 1 with an error would let a client ignore the 400');

  const both = await call({ focus: good, cursor: '25' });
  check('focus plus cursor is a 400', both.statusCode === 400, `got ${both.statusCode}`);
  check('with code LIST_FOCUS_CURSOR_CONFLICT',
        both.body && both.body.code === 'LIST_FOCUS_CURSOR_CONFLICT',
        'picking a winner would hide the caller bug in whichever one lost');

  const cursorZero = await call({ focus: good, cursor: '0' });
  check('🔴 cursor=0 still conflicts',
        cursorZero.statusCode === 400,
        'a falsy-check instead of a presence-check would let cursor=0 through silently');

  const ok = await call({ focus: good });
  check('a well-formed focus is a 200', ok.statusCode === 200, `got ${ok.statusCode}`);
  check('and focusOffset reaches the client', ok.body && 'focusOffset' in ok.body);
  check('null for an unindexed id, not undefined or omitted',
        ok.body.focusOffset === null,
        'an omitted key makes a client write `body.focusOffset === undefined` checks');

  const none = await call({});
  check('🔴 focusOffset is present even when focus was not sent',
        none.statusCode === 200 && 'focusOffset' in none.body && none.body.focusOffset === null,
        '§2.2 says every envelope key is always present');
  check('the other seven envelope keys are unchanged',
        ['rows', 'count', 'total', 'nextCursor', 'cap', 'source', 'degraded']
          .every((k) => k in none.body));
  check('cap is still advertised', none.body.cap === 500);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\nfocus does not disturb the paths that do not use it');

reset();
{
  await seed(4);
  const plain = await SVC.listDraftSummaries(kv, SUB, { limit: 2 });
  check('an ordinary page is unchanged', plain.count === 2 && plain.nextCursor === 2);
  check('and carries a null focusOffset', plain.focusOffset === null);

  const walked = await SVC.listDraftSummaries(kv, SUB, { limit: 2, cursor: plain.nextCursor });
  check('a cursor walk still works', walked.count === 2 && walked.nextCursor === null);
  check('focusOffset stays null across the walk', walked.focusOffset === null);

  // The ids-only path must ignore focus rather than half-honour it.
  const res = fakeRes();
  await EP.default(fakeReq({ method: 'GET', query: { ids: '1', focus: DS.newDraftId() } }), res);
  check('the ids-only path is unaffected by focus',
        res.statusCode === 200 && Array.isArray(res.body.draftIds) && res.body.draftIds.length === 4);
  check('and does not pretend to answer it',
        !('focusOffset' in res.body),
        '§2.8: focus is read only on the hydrated list path');
}

done();
