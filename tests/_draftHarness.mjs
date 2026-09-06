// tests/_draftHarness.mjs — the shared in-memory draft harness.
//
// Extracted 2026-09-06, unchanged byte-for-byte from tests/draft-focus.mjs.
//
// Why it exists: the fixture rule in DRAFT_LIST_API_CONTRACT.md Part 4 requires
// the browser suite's fixtures to be GENERATED from the real handler rather than
// hand-written. Building that generator meant either importing this scaffold or
// making a third copy of it — draft-focus.mjs and draft-list-cap.mjs already had
// one each. A third copy is the rule-1 failure (one behaviour, one
// implementation), and a fake kv is exactly the kind of thing that drifts
// between copies until one of them certifies a behaviour the others refuse.
//
// draft-list-cap.mjs still carries its own copy. Migrating a 976-line suite is a
// separate unit of work; this file is the destination when someone does it.
//
// Importing this module has side effects on purpose: it sets the KV env vars and
// replaces globalThis.fetch, because the endpoint's real auth and store paths
// have to run against the fake rather than around it.

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

// ── exports ────────────────────────────────────────────────────────────────
//
// `seen` and `store`/`sets` are exported by reference and mutated in place;
// `reset()` clears them rather than reassigning, so a holder of the reference
// never goes stale. `fail` wraps the injection flags, which cannot be exported
// as `let` bindings and reassigned from outside the module.

export const fail = {
  set commands(v) { failCommands = v instanceof Set ? v : new Set(v); },
  get commands() { return failCommands; },
  set keyPrefix(v) { failKeyPrefix = v; },
  get keyPrefix() { return failKeyPrefix; },
  set nextN(v) { failNextN = v; },
  get nextN() { return failNextN; },
};

export {
  SUB, TEST_EMAIL, K,
  store, sets, seen,
  reset, stuffIndex, run, kv,
  SVC, DS, EP, IDEM,
  CARD, httpInput, input,
  fakeReq, fakeRes, seed,
};
