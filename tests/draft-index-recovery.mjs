// tests/draft-index-recovery.mjs — Block C entry criteria
//
// Two things the external review asked to be settled before C1 counts as
// complete:
//   1. a failed index write must never strand an authoritative draft
//   2. packetSchemaVersion must be acted on, never assumed current
//
// FIXTURE SHAPE CORRECTION (2026-09-08): every fixture below used to carry a
// TOP-LEVEL `packetSchemaVersion`. `buildListingPacket` has always written it
// nested at `metadata.packetSchemaVersion`, and `readStoredPacket` used to
// read the top level -- so these assertions were green while every real packet
// read back PACKET_VERSION_MALFORMED -> INCOMPATIBLE. The assertions were
// correct about the BEHAVIOUR and wrong about the SHAPE, which is exactly how
// a suite passes against a fiction. Fixtures now match what the producer
// emits, and the migration fixtures bump the nested field.
//
// The index module talks to Upstash over fetch(), so these tests stub fetch
// with an in-memory Redis that can be told to fail specific commands. That
// exercises the real code path rather than a re-implementation of it.

import assert from 'node:assert';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  // A Promise is never a truth value. `(async () => {...})()` is always
  // truthy, so passing one here asserts nothing while printing ok — we
  // shipped two of those. Make the whole category impossible, loudly.
  if (cond && typeof cond.then === 'function') {
    failed++;
    console.log(`  FAIL ${name}\n       → TEST_API_MISUSE: a Promise is not a truth value; await it or use checkAsync()`);
    return;
  }

  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}`); if (detail) console.log(`       → ${detail}`); }
}
/** For assertions whose condition is async. Awaits, then asserts. */
async function checkAsync(name, thunk, hint) {
  let v;
  try { v = await (typeof thunk === 'function' ? thunk() : thunk); }
  catch (e) { v = false; hint = `threw: ${e.message}`; }
  return check(name, !!v, hint);
}


// ── in-memory Upstash ─────────────────────────────────────────────────────
process.env.KV_REST_API_URL   = 'https://kv.test';
process.env.KV_REST_API_TOKEN = 'test-token';

const store = new Map();   // key -> string | Set
let failCommands = new Set();
let scanHides = new Set();
let commandLog = [];

globalThis.fetch = async (url) => {
  const path = String(url).replace('https://kv.test/', '');
  const parts = path.split('/').map(decodeURIComponent);
  const [cmd, ...args] = parts;
  commandLog.push(cmd);
  if (failCommands.has(cmd)) {
    return { ok: false, status: 500, json: async () => ({}) };
  }
  let result = null;
  switch (cmd) {
    case 'sadd': {
      const set = store.get(args[0]) instanceof Set ? store.get(args[0]) : new Set();
      for (const m of args.slice(1)) set.add(m);
      store.set(args[0], set); result = set.size; break;
    }
    case 'srem': {
      const set = store.get(args[0]); if (set instanceof Set) set.delete(args[1]); result = 1; break;
    }
    case 'smembers': {
      const set = store.get(args[0]); result = set instanceof Set ? [...set] : []; break;
    }
    case 'scard': {
      const set = store.get(args[0]); result = set instanceof Set ? set.size : 0; break;
    }
    case 'set':    store.set(args[0], args[1]); result = 'OK'; break;
    case 'get':    result = typeof store.get(args[0]) === 'string' ? store.get(args[0]) : null; break;
    case 'incr':   { const n = (Number(store.get(args[0])) || 0) + 1; store.set(args[0], String(n)); result = n; break; }
    case 'decr':   { const n = (Number(store.get(args[0])) || 0) - 1; store.set(args[0], String(n)); result = n; break; }
    case 'del':    store.delete(args[0]); result = 1; break;
    case 'expire': result = 1; break;
    case 'scan': {
      // args: cursor, 'match', pattern, 'count', n
      const pattern = args[2];
      const rx = new RegExp('^' + pattern.split('*').map((p) =>
        p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
      // scanHides simulates SCAN's non-snapshot nature: a key that exists but
      // which this particular scan pass does not return.
      result = ['0', [...store.keys()].filter((k) => rx.test(k)
        && ![...scanHides].some((h) => k.endsWith(`:${h}`)))];
      break;
    }
    // ── Unknown commands are a FAILURE, not a null ──────────────────────
    //
    // This returned null for years. When the cap moved to INCR, the fake did
    // not implement it, every reservation read as 0, and the cap test passed
    // while the cap did nothing. A fake that silently answers "nothing" to a
    // command it does not know will certify any behaviour you ask it about.
    default: throw new Error(`fake kv: unimplemented command '${cmd}'`);
  }
  return { ok: true, status: 200, json: async () => ({ result }) };
};

const ID = await import(new URL('../api/_cardIdentity.js', import.meta.url).href);
const IDEM = await import(new URL('../api/_idempotency.js', import.meta.url).href);
const INV = await import(new URL('../api/_inventoryInstance.js', import.meta.url).href);
const DI = await import('../api/_draftIndex.js');
const { readStoredPacket, PACKET_COMPAT, PACKET_SCHEMA_VERSION } =
  await import('../api/_listingPacket.js');

const SUB = '117425550012345';
const SKU = 'pokemon|obsidian-flames|125|charizard-ex|en|psa-10|84061234';

function reset() { store.clear(); failCommands = new Set(); commandLog = []; }
/** Simulate the authoritative write that always precedes indexing. */
function writeRecord(sub, id) { store.set(DI.draftRecordKey(sub, id), JSON.stringify({ id })); }

// ── 1. Key derivability ───────────────────────────────────────────────────
console.log('\ndraft record keys are derivable');
reset();
check('record key is deterministic',
      DI.draftRecordKey(SUB, 'd1') === DI.draftRecordKey(SUB, 'd1'));
check('draft id round-trips out of the record key',
      DI.draftIdFromRecordKey(SUB, DI.draftRecordKey(SUB, 'd-42')) === 'd-42',
      'this is what makes the index rebuildable from primary storage alone');
check('a key belonging to another user does not yield an id',
      DI.draftIdFromRecordKey(SUB, DI.draftRecordKey('999', 'd1')) === null,
      'a scan must never hand one seller another seller\'s drafts');
check('a draft id containing the separator cannot forge a key',
      DI.draftIdFromRecordKey(SUB, DI.draftRecordKey(SUB, 'a:b')) === 'a:b');
check('an unrelated key is rejected',
      DI.draftIdFromRecordKey(SUB, 'skudraft:x:y') === null);

// ── 2. 🔴 Split-brain: index write fails after the record is durable ──────
console.log('\n🔴 split-brain — index write fails, record is already durable');
reset();
writeRecord(SUB, 'd1');
failCommands = new Set(['sadd', 'set']);
let res = await DI.indexDraft(SUB, SKU, 'd1');
check('🔴 indexDraft does not throw once the record exists',
      res && typeof res === 'object',
      'throwing here surfaces as "save failed" for a draft that saved fine');
check('the failure is reported, not swallowed', res.degraded === true && res.ok === false);
check('it names which writes failed',
      res.failed.some((f) => f.step === 'drafts_sadd')
      && res.failed.some((f) => f.step === 'skudraft_set'));
check('lost duplicate-detection is called out separately', res.skuPointerLost === true,
      'the seller may be offered a second draft for the same card — recoverable, visible');
check('a deterministic recovery path is named',
      res.recovery === 'reconcileDraftIndex' && typeof DI.reconcileDraftIndex === 'function',
      'the named path must exist as an export, not just as a string');

// ── 3. 🔴 The stranded-draft scenario cannot happen ───────────────────────
console.log('\n🔴 the draft is never unreachable');
failCommands = new Set();
const idx = store.get(DI.draftsKey(SUB));
check('the index really is empty after the torn write',
      !idx || idx.size === 0, 'otherwise this test proves nothing');
let listed = await DI.listDraftIds(SUB);
check('🔴 a read still finds the draft the index lost',
      listed.includes('d1'),
      'this is the assertion: a failed index write leaves no unreachable authoritative draft');
check('the read repaired the index on its way past',
      store.get(DI.draftsKey(SUB)) instanceof Set
      && store.get(DI.draftsKey(SUB)).has('d1'),
      'recovery is automatic — no operator, no background job');
commandLog = [];
listed = await DI.listDraftIds(SUB);
check('the repaired index is used, so the scan is not the hot path',
      listed.includes('d1') && !commandLog.includes('scan'));

// ── 3b. 🔴 PARTIAL index — non-empty does not imply complete (review) ─────
// The realistic torn write: draft A indexed fine, draft B's index write
// failed, so the index is NON-EMPTY and still missing B. An "is it empty?"
// fallback trusts it and B is unreachable forever.
console.log('\n🔴 partial index — the non-empty-but-incomplete case');
reset();
// A saves and indexes cleanly.
writeRecord(SUB, 'A');
let r = await DI.indexDraft(SUB, SKU + '-a', 'A');
check('setup: A indexed cleanly', r.ok === true);
// B's record persists; B's index write fails.
writeRecord(SUB, 'B');
failCommands = new Set(['sadd']);
r = await DI.indexDraft(SUB, SKU + '-b', 'B');
failCommands = new Set();
check('setup: B\'s index write failed', r.degraded === true);
const idxNow = store.get(DI.draftsKey(SUB));
check('🔴 the index is NON-EMPTY and incomplete — the exact hole',
      idxNow instanceof Set && idxNow.has('A') && !idxNow.has('B'),
      'if this is not true the test proves nothing');
check('the degraded write asks the caller to repair now',
      r.repairRequired === true && r.recovery === 'reconcileDraftIndex');

listed = await DI.listDraftIds(SUB);
check('🔴 a normal list read returns BOTH drafts',
      listed.includes('A') && listed.includes('B'),
      `got [${listed}] — a non-empty index must never be assumed complete`);
check('🔴 and the index itself is repaired, without an operator',
      store.get(DI.draftsKey(SUB)).has('B'));
commandLog = [];
listed = await DI.listDraftIds(SUB);
check('once reconciled, later reads trust the index again',
      listed.length === 2 && !commandLog.includes('scan'),
      'otherwise the cache is pointless and every read scans');

// ── 3c. Pathological: the invalidation ALSO fails ─────────────────────────
console.log('\n🔴 when the freshness invalidation fails too');
reset();
writeRecord(SUB, 'A');
await DI.indexDraft(SUB, SKU + '-a', 'A');
await DI.listDraftIds(SUB);                       // index now marked clean
writeRecord(SUB, 'B');
failCommands = new Set(['sadd', 'del']);          // index write AND invalidation fail
r = await DI.indexDraft(SUB, SKU + '-b', 'B');
failCommands = new Set();
check('the failed invalidation is reported honestly',
      r.degraded === true && r.freshnessInvalidated === false,
      'we must not claim to have invalidated a marker we could not delete');
check('repairRequired still tells the caller to reconcile',
      r.repairRequired === true,
      'this is the path that stays correct when every marker write failed');
const forced = await DI.reconcileDraftIndex(SUB);
check('🔴 a forced reconcile scans regardless of the index looking clean',
      forced.ids.includes('A') && forced.ids.includes('B'),
      'this is the deterministic repair that does not depend on any marker');
check('the index is whole afterwards', store.get(DI.draftsKey(SUB)).has('B'));

// ── 3d. TTL backstop — recovery even if nothing signalled ─────────────────
console.log('\nTTL backstop');
reset();
writeRecord(SUB, 'A');
await DI.indexDraft(SUB, SKU + '-a', 'A');
await DI.listDraftIds(SUB);
writeRecord(SUB, 'B');                            // record exists, never indexed at all
store.delete(DI.indexFreshKey(SUB));              // marker expires on its own TTL
listed = await DI.listDraftIds(SUB);
check('an expired freshness marker forces a reconcile',
      listed.includes('A') && listed.includes('B'),
      'bounded staleness: recovery happens within RECONCILE_INTERVAL_SEC even if every signal was lost');
check('the backstop interval is a real bound', DI.RECONCILE_INTERVAL_SEC > 0
      && DI.RECONCILE_INTERVAL_SEC <= 24 * 60 * 60);

// ── 3e. The repair must not drop what the scan cannot see ─────────────────
console.log('\nreconcile is a union, not a replacement');
reset();
writeRecord(SUB, 'A');
await DI.indexDraft(SUB, SKU + '-a', 'A');
// indexDraft writes the RECORD first and the index second, so an indexed id
// always has a record. The case the union protects is therefore a record that
// exists but which this scan pass did not return — not a missing record.
writeRecord(SUB, 'inflight');
store.get(DI.draftsKey(SUB)).add('inflight');
store.delete(DI.indexFreshKey(SUB));
scanHides = new Set(['inflight']);
listed = await DI.listDraftIds(SUB);
scanHides = new Set();
check('a reconcile keeps index entries the scan did not see',
      listed.includes('inflight') && listed.includes('A'),
      'a draft the scan missed must not be dropped by the read repairing the index');

// ── 3f. A clean empty account does not scan on every read ─────────────────
console.log('\nempty accounts settle');
reset();
await DI.listDraftIds(SUB);                       // first read reconciles and marks clean
commandLog = [];
listed = await DI.listDraftIds(SUB);
check('a genuinely empty, reconciled index is a valid answer',
      listed.length === 0 && !commandLog.includes('scan'),
      'emptiness was never the right question — completeness is');

// ── 4. Recovery under multiple drafts, and no cross-tenant bleed ──────────
console.log('\nrebuild from primary storage');
reset();
for (const id of ['a1', 'a2', 'a3']) writeRecord(SUB, id);
writeRecord('other-user', 'b1');
const rebuilt = await DI.rebuildDraftIndex(SUB);
check('every draft record is recovered', rebuilt.rebuilt === 3);
check('another user\'s drafts are not swept in',
      !rebuilt.ids.includes('b1') && rebuilt.ids.length === 3);
check('rebuild is idempotent',
      (await DI.rebuildDraftIndex(SUB)).rebuilt === 3);
reset();
check('rebuilding an account with no drafts is a no-op, not an error',
      (await DI.rebuildDraftIndex(SUB)).rebuilt === 0);

// ── 5. Rebuild must not evict a draft mid-write ───────────────────────────
console.log('\nrebuild is additive');
reset();
writeRecord(SUB, 'a1');
await DI.rebuildDraftIndex(SUB);
store.get(DI.draftsKey(SUB)).add('inflight');   // indexed, record not yet visible
await DI.rebuildDraftIndex(SUB);
check('a rebuild does not delete index entries the scan did not see',
      store.get(DI.draftsKey(SUB)).has('inflight'),
      'a draft mid-write would otherwise be evicted by its own rebuild');

// ── 6. Happy path is unchanged ────────────────────────────────────────────
console.log('\nhappy path');
reset();
writeRecord(SUB, 'd9');
res = await DI.indexDraft(SUB, SKU, 'd9');
check('a clean index write reports ok', res.ok === true && res.degraded === false);
check('the sku pointer resolves', (await DI.draftIdForSku(SUB, SKU)) === 'd9');
check('the count is right', (await DI.countDrafts(SUB)) === 1);
await DI.unindexDraft(SUB, SKU, 'd9');
check('unindex clears both', (await DI.countDrafts(SUB)) === 0
      && (await DI.draftIdForSku(SUB, SKU)) === null);
writeRecord(SUB, 'dA'); await DI.indexDraft(SUB, SKU, 'dA');
await DI.unindexDraft(SUB, SKU, 'dB');
check('a late delete of an old draft does not erase the new pointer',
      (await DI.draftIdForSku(SUB, SKU)) === 'dA');
check('bad arguments still throw — that is a bug, not an outage',
      await DI.indexDraft(SUB, SKU, null).then(() => false, () => true));

// ── 7. 🔴 C0 — schema version is acted on, never assumed ──────────────────
console.log('\n🔴 C0 — packet schema version handling');
const cur = PACKET_SCHEMA_VERSION;
check('a current packet is usable',
      readStoredPacket({ metadata: { packetSchemaVersion: cur }, sku: 'x' }).status === PACKET_COMPAT.CURRENT);
const ahead = readStoredPacket({ metadata: { packetSchemaVersion: cur + 1 }, sku: 'x' });
check('🔴 a newer packet is marked incompatible, not read as current',
      ahead.status === PACKET_COMPAT.INCOMPATIBLE && ahead.usable === false);
check('a newer packet is preserved verbatim, not rewritten or dropped',
      ahead.packet && ahead.packet.sku === 'x' && ahead.packet.metadata.packetSchemaVersion === cur + 1,
      'the reader is behind; the record is not corrupt');
check('the reason distinguishes "ahead of reader" from corruption',
      ahead.reason === 'PACKET_VERSION_AHEAD_OF_READER');
for (const bad of [{}, { metadata: { packetSchemaVersion: null } }, { metadata: { packetSchemaVersion: '1' } },
                   { metadata: { packetSchemaVersion: 1.5 } }, { metadata: { packetSchemaVersion: 0 } },
                   { metadata: { packetSchemaVersion: -3 } }]) {
  const r = readStoredPacket(bad);
  check(`malformed version ${JSON.stringify(bad.metadata && bad.metadata.packetSchemaVersion)} → incompatible, never current`,
        r.status === PACKET_COMPAT.INCOMPATIBLE && r.usable === false,
        `got ${r.status}`);
}
for (const junk of [null, undefined, [], 'packet', 7]) {
  const r = readStoredPacket(junk);
  check(`non-object ${JSON.stringify(junk)} is refused`,
        r.status === PACKET_COMPAT.INCOMPATIBLE && r.usable === false);
}
// The BEHAVIOUR under test: a version with no registered hop must be refused
// rather than assumed current.
//
// The fixture is DERIVED, not written down. It was 1 -> 2 when the migration
// table was empty; RC-2 registered a real 1 -> 2 hop for shipping and the
// check began exercising a hop that existed, so it was moved to 2 -> 3; the
// v3 description bump then broke it the same way. Twice is a pattern, and the
// pattern is that any literal version here becomes a real hop at the next
// bump. So it hangs off the current schema version instead: the top version
// is by definition the one with no migration above it, and this fixture now
// moves itself every time the schema moves.
const noHopFrom = PACKET_SCHEMA_VERSION;
const older = readStoredPacket(
  { metadata: { packetSchemaVersion: noHopFrom }, sku: 'x' },
  { currentVersion: noHopFrom + 1 },
);
check('an older version with no registered migration is incompatible, not assumed',
      older.status === PACKET_COMPAT.INCOMPATIBLE
      && older.reason === 'PACKET_NO_MIGRATION_PATH',
      'silently treating an old packet as current is the outcome C0 exists to prevent');
check('an unmigratable old packet is still preserved', older.packet.sku === 'x');

// migration table wired up for real
const { PACKET_MIGRATIONS } = await import('../api/_listingPacket.js');
// Saved, not assumed absent. Hop 1 is now a REAL production migration, and the
// `delete` this block used to end with would have removed it for every later
// assertion in this process -- a test silently disabling the thing it shares a
// module with.
const REAL_MIGRATION_1 = PACKET_MIGRATIONS[1];
PACKET_MIGRATIONS[1] = (p) => ({ ...p, metadata: { ...p.metadata, packetSchemaVersion: 2 }, migratedField: true });
const migrated = readStoredPacket({ metadata: { packetSchemaVersion: 1 }, sku: 'x' }, { currentVersion: 2 });
check('a registered migration runs and the packet becomes usable',
      migrated.status === PACKET_COMPAT.MIGRATED && migrated.usable === true
      && migrated.packet.migratedField === true);
check('the migration is recorded, not silent',
      migrated.migrationsApplied.join(',') === '1->2' && migrated.fromVersion === 1);
PACKET_MIGRATIONS[2] = (p) => ({ ...p, metadata: { ...p.metadata, packetSchemaVersion: 3 } });
const twoHops = readStoredPacket({ metadata: { packetSchemaVersion: 1 } }, { currentVersion: 3 });
check('multi-step migrations chain in order',
      twoHops.status === PACKET_COMPAT.MIGRATED
      && twoHops.migrationsApplied.join(',') === '1->2,2->3');
PACKET_MIGRATIONS[2] = (p) => ({ ...p });   // forgets to advance the version
const stuck = readStoredPacket({ metadata: { packetSchemaVersion: 1 } }, { currentVersion: 3 });
check('a migration that does not advance the version fails loudly',
      stuck.status === PACKET_COMPAT.INCOMPATIBLE
      && stuck.reason === 'PACKET_MIGRATION_DID_NOT_ADVANCE_VERSION',
      'a half-applied chain must not be handed back as usable');
// Restore the real hop rather than deleting it; only hop 2 was invented here.
PACKET_MIGRATIONS[1] = REAL_MIGRATION_1;
delete PACKET_MIGRATIONS[2];
check('the real 1->2 migration is restored after the overrides',
      typeof PACKET_MIGRATIONS[1] === 'function'
      && PACKET_MIGRATIONS[1]({ metadata: { packetSchemaVersion: 1 } }).shipping === null,
      'a test that leaves the production migration table modified poisons every later assertion');


// ── 3g. Stale index entries — pruning only on POSITIVE absence ────────────
console.log('\nstale entries are pruned, but only on proof');
reset();
writeRecord(SUB, 'A'); await DI.indexDraft(SUB, SKU + '-a', 'A');
writeRecord(SUB, 'B'); await DI.indexDraft(SUB, SKU + '-b', 'B');
store.get(DI.draftsKey(SUB)).add('C');            // C indexed, no record: a zombie
store.delete(DI.indexFreshKey(SUB));
listed = await DI.listDraftIds(SUB);
check('a zombie index entry is dropped once its record is confirmed absent',
      !listed.includes('C') && listed.includes('A') && listed.includes('B'));
check('and it is removed from the index, not just filtered from the reply',
      !store.get(DI.draftsKey(SUB)).has('C'),
      'otherwise the zombie returns on every future read');

console.log('\n🔴 but never pruned on a scan miss alone');
reset();
writeRecord(SUB, 'A'); await DI.indexDraft(SUB, SKU + '-a', 'A');
writeRecord(SUB, 'B'); await DI.indexDraft(SUB, SKU + '-b', 'B');
store.delete(DI.indexFreshKey(SUB));
scanHides = new Set(['B']);                       // SCAN is not a snapshot
listed = await DI.listDraftIds(SUB);
scanHides = new Set();
check('🔴 a live draft the scan missed is NOT deleted',
      listed.includes('B') && store.get(DI.draftsKey(SUB)).has('B'),
      '"the scan did not see it" and "it is not there" are different statements');

console.log('\nan unreadable record is not evidence of absence');
reset();
writeRecord(SUB, 'A'); await DI.indexDraft(SUB, SKU + '-a', 'A');
writeRecord(SUB, 'B'); await DI.indexDraft(SUB, SKU + '-b', 'B');
store.delete(DI.indexFreshKey(SUB));
scanHides = new Set(['B']);
failCommands = new Set(['get']);                  // existence check itself fails
listed = await DI.listDraftIds(SUB);
failCommands = new Set(); scanHides = new Set();
check('a failed existence check keeps the entry',
      listed.includes('B') && store.get(DI.draftsKey(SUB)).has('B'),
      'an error is not a null');

// ── 5. Inventory instance layer (C0c) ────────────────────────────────────
console.log('\n🔴 C0c — SKU is product, instance is the physical copy');
const CARD_RAW  = { game: 'pokemon', setCode: 'base', set: 'Base Set', number: '4', card: 'Charizard' };
const CARD_PSA9 = { ...CARD_RAW, grader: 'psa', grade: '9' };

const rawA = INV.buildInstance(CARD_RAW, { condition: 'near-mint', totalAcquisitionCost: 80 });
const rawB = INV.buildInstance(CARD_RAW, { condition: 'heavily-played', totalAcquisitionCost: 45 });
check('🔴 two raw copies share one SKU', rawA.sku === rawB.sku);
check('🔴 but are different instances — the collision is gone',
      rawA.instanceId !== rawB.instanceId,
      'this is the case that was broken before C0c: NM and HP collided on one draft pointer');
check('each carries its own condition and cost',
      rawA.condition === 'near-mint' && rawA.totalAcquisitionCost === 80 &&
      rawB.condition === 'heavily-played' && rawB.totalAcquisitionCost === 45);
check('instance ids are generated, not derived',
      INV.buildInstance(CARD_RAW, { condition: 'near-mint' }).instanceId !==
      INV.buildInstance(CARD_RAW, { condition: 'near-mint' }).instanceId,
      'no function of card attributes can separate two indistinguishable copies');
check('the id is prefixed and key-safe',
      /^inv_[0-9a-f]{32}$/.test(rawA.instanceId));

const slabA = INV.buildInstance({ ...CARD_PSA9, cert: '84061234' }, {});
const slabB = INV.buildInstance({ ...CARD_PSA9, cert: '84069999' }, {});
check('🔴 two PSA 9s share one SKU', slabA.sku === slabB.sku);
check('🔴 and are separated by instance, each keeping its own cert',
      slabA.instanceId !== slabB.instanceId &&
      slabA.cert === '84061234' && slabB.cert === '84069999',
      'same mechanism fixes raw and graded duplicates');
check('cert lives on the instance, never on a raw copy', rawA.cert === null);
check('a graded instance takes its condition from the grade', slabA.condition === 'graded');

console.log('\nuniqueness moves to the instance');
check('the draft-uniqueness key is per instance',
      INV.instanceDraftsKey('sub1', rawA.instanceId) === `instancedrafts:sub1:${rawA.instanceId}`);
check('two raw copies get two independent draft slots',
      INV.instanceDraftsKey('sub1', rawA.instanceId) !== INV.instanceDraftsKey('sub1', rawB.instanceId));
check('a per-product set still answers "all drafts for this card"',
      INV.skuInstancesKey('sub1', rawA.sku) === `skuinv:sub1:${rawA.sku}`);
check('key delimiters are refused, not escaped',
      (() => { try { INV.instanceKey('a:b', 'x'); return false; } catch { return true; } })());

console.log('\nquantity — lots, with honest limits');
const lot = INV.buildInstance(CARD_RAW, { condition: 'near-mint', quantity: 5, totalAcquisitionCost: 40 });
check('a lot of five identical NM copies is one record', lot.quantity === 5);
check('quantity defaults to one', rawA.quantity === 1);
for (const bad of ['5', 0, -1, 2.5, NaN]) {
  check(`quantity ${JSON.stringify(bad)} is refused, not coerced`,
        (() => { try { INV.buildInstance(CARD_RAW, { condition: 'mint', quantity: bad }); return false; }
                 catch (e) { return e.message === 'INSTANCE_QUANTITY_INVALID'; } })());
}
check('🔴 a slab lot cannot exceed one — a cert describes one object',
      (() => { try { INV.buildInstance({ ...CARD_PSA9, cert: '1' }, { quantity: 3 }); return false; }
               catch (e) { return e.message === 'INSTANCE_SLAB_QUANTITY_MUST_BE_ONE'; } })());
check('an unknown condition is refused rather than guessed',
      (() => { try { INV.buildInstance(CARD_RAW, { condition: 'pretty good' }); return false; }
               catch (e) { return e.message === 'INSTANCE_CONDITION_UNKNOWN'; } })());
for (const bad of [null, '', '12', [], NaN, -5]) {
  const r = (() => { try { return INV.buildInstance(CARD_RAW, { condition: 'mint', totalAcquisitionCost: bad }); }
                     catch (e) { return e.message; } })();
  check(`cost ${JSON.stringify(bad)} never becomes a real number`,
        bad === null || bad === '' ? r.totalAcquisitionCost === null : r === 'INSTANCE_COST_INVALID',
        'Number(null) === 0 must not turn missing input into a $0 cost basis');
}

console.log('\nlot splitting stays possible');
const { remainder, split } = INV.splitInstance(lot, 2, { condition: 'lightly-played', totalAcquisitionCost: 12 });
check('the split leaves the lot smaller', remainder.quantity === 3);
check('the split copies become their own instance',
      split.quantity === 2 && split.instanceId !== lot.instanceId);
check('the split can differ materially', split.condition === 'lightly-played' && split.totalAcquisitionCost === 12);
check('and the basis it leaves behind is the remainder, not the original',
      remainder.totalAcquisitionCost === 28,
      'a split moves no money, so the two halves must still sum to $40');
check('allocating cost against an unrecorded basis is refused, not ignored',
      (() => { try { INV.splitInstance(
                 INV.buildInstance(CARD_RAW, { condition: 'mint', quantity: 4 }),
                 1, { totalAcquisitionCost: 10 }); return false; }
               catch (e) { return e.message === 'SPLIT_COST_ALLOCATION_WITHOUT_BASIS'; } })(),
      'silently dropping a number the seller typed is how a cost basis goes missing');
check('both sides keep the same product', remainder.sku === split.sku);
check('a split cannot empty the lot',
      (() => { try { INV.splitInstance(lot, 5); return false; }
               catch (e) { return e.message === 'SPLIT_WOULD_EMPTY_LOT'; } })());
check('a slab cannot be split', (() => { try { INV.splitInstance(slabA, 1); return false; }
               catch (e) { return e.message === 'SPLIT_SLAB_NOT_SPLITTABLE'; } })());

console.log('\ninstance schema version is read, not assumed');
check('a current instance is usable', INV.readStoredInstance(rawA).usable === true);
check('a newer instance is refused and preserved',
      (() => { const r = INV.readStoredInstance({ ...rawA, schemaVersion: 99 });
               return !r.usable && r.reason === 'INSTANCE_VERSION_AHEAD_OF_READER' && r.instance.cert === null; })());
for (const bad of [undefined, null, '1', 1.5, 0]) {
  check(`instance version ${JSON.stringify(bad)} is incompatible, never current`,
        INV.readStoredInstance({ ...rawA, schemaVersion: bad }).reason === 'INSTANCE_VERSION_MALFORMED');
}


// ── 6. Plural draft index + venue slots (multi-venue readiness) ──────────
console.log('\n🔴 one instance, many venues');
check('the draft index is a SET name, not a single pointer',
      INV.instanceDraftsKey('sub1', 'inv_x') === 'instancedrafts:sub1:inv_x');
check('slots are per venue and strategy',
      INV.draftSlot('ebay') === 'ebay:fixed-price' &&
      INV.draftSlot('ebay', 'auction') === 'ebay:auction' &&
      INV.draftSlot('mercari', 'fixed-price') === 'mercari:fixed-price');
check('venue case is normalized', INV.draftSlot('eBay') === INV.draftSlot('ebay'));
check('🔴 eBay and Mercari drafts can coexist on one instance in the SHAPE',
      INV.draftSlot('ebay') !== INV.draftSlot('mercari'),
      'the storage model must not need unwinding when the second venue arrives');
check('Phase 1 admits a first eBay draft',
      INV.phase1DraftAdmission([], 'ebay') === null);
check('Phase 1 refuses a SECOND eBay draft for the same instance',
      INV.phase1DraftAdmission(['ebay:fixed-price'], 'ebay') === 'ACTIVE_DRAFT_EXISTS_FOR_SLOT');
check('Phase 1 refuses other venues by RULE, not by storage shape',
      INV.phase1DraftAdmission([], 'mercari') === 'VENUE_NOT_SUPPORTED_IN_PHASE_1',
      'relaxing this later must not require a migration');
check('an auction strategy is a different slot from fixed-price',
      INV.phase1DraftAdmission(['ebay:fixed-price'], 'ebay', 'auction') === null);

// ── 7. Lot cost basis: unambiguous, and conserved ───────────────────────
console.log('\n🔴 lot cost basis');
const CARD_R = { game: 'pokemon', setCode: 'base', set: 'Base Set', number: '4', card: 'Charizard' };
const lot11 = INV.buildInstance(CARD_R, { condition: 'near-mint', quantity: 11, totalAcquisitionCost: 55 });
check('the field says TOTAL, so 11 for $55 cannot be misread',
      lot11.totalAcquisitionCost === 55 && lot11.acquisitionCost === undefined);
check('per-unit is derived, not stored', INV.unitAcquisitionCost(lot11) === 5);
check('an unknown basis stays null and never becomes zero',
      INV.unitAcquisitionCost(INV.buildInstance(CARD_R, { condition: 'mint' })) === null);
check('🔴 the ambiguous single-cost field is REFUSED on a multi-copy lot',
      (() => { try { INV.buildInstance(CARD_R, { condition: 'mint', quantity: 4, acquisitionCost: 25 }); return false; }
               catch (e) { return e.message === 'INSTANCE_COST_AMBIGUOUS_USE_TOTAL'; } })(),
      '$25 each or $25 for all four? we refuse to pick a meaning');

console.log('\ncost basis is conserved across a split');
for (const [qty, total, take] of [[10, 100, 3], [3, 100, 1], [11, 55, 3], [7, 0.07, 2], [2, 1234.56, 1]]) {
  const src = INV.buildInstance(CARD_R, { condition: 'near-mint', quantity: qty, totalAcquisitionCost: total });
  const { remainder, split } = INV.splitInstance(src, take);
  const sum = Math.round((remainder.totalAcquisitionCost + split.totalAcquisitionCost) * 100);
  check(`qty ${qty} / $${total} split ${take}: basis conserved exactly`,
        sum === Math.round(total * 100),
        `got $${(sum / 100).toFixed(2)} — a split moves no money, so the money must not change`);
  check(`qty ${qty} / $${total} split ${take}: quantities conserved`,
        remainder.quantity + split.quantity === qty);
}
const manual = INV.splitInstance(
  INV.buildInstance(CARD_R, { condition: 'near-mint', quantity: 10, totalAcquisitionCost: 100 }),
  3, { totalAcquisitionCost: 45 });
check('a manual allocation is allowed', manual.split.totalAcquisitionCost === 45);
check('and still has to add up', manual.remainder.totalAcquisitionCost === 55);
check('a manual allocation cannot exceed the basis',
      (() => { try { INV.splitInstance(
                 INV.buildInstance(CARD_R, { condition: 'mint', quantity: 5, totalAcquisitionCost: 20 }),
                 2, { totalAcquisitionCost: 999 }); return false; }
               catch (e) { return e.message === 'SPLIT_COST_EXCEEDS_BASIS'; } })());
check('an unknown basis splits to unknown, not to zero',
      (() => { const r = INV.splitInstance(
                 INV.buildInstance(CARD_R, { condition: 'mint', quantity: 5 }), 2);
               return r.split.totalAcquisitionCost === null && r.remainder.totalAcquisitionCost === null; })());

// ── 8. SKU identity is NOT valuation identity ───────────────────────────
console.log('\n🔴 product identity vs valuation identity');
const nmKey = ID.valuationKeyFor(CARD_R, { condition: 'near-mint' });
const hpKey = ID.valuationKeyFor(CARD_R, { condition: 'heavily-played' });
check('🔴 NM and HP are the same PRODUCT', ID.skuFor(CARD_R) === ID.skuFor(CARD_R));
check('🔴 but never the same VALUATION', nmKey !== hpKey,
      'priceCache[sku] would serve an NM price for an HP copy — authoritative and wrong');
check('the helper states the relationship directly',
      ID.sameProductDifferentValue(CARD_R, CARD_R, { condition: 'near-mint' }, { condition: 'heavily-played' }));
check('a missing condition is refused, not defaulted',
      (() => { try { ID.valuationKeyFor(CARD_R); return false; }
               catch (e) { return e.message === 'VALUATION_CONDITION_REQUIRED'; } })(),
      'a guessed condition is a guessed price with a dollar sign in front of it');
check('a slab collapses to one valuation — the grade is already identity',
      ID.valuationKeyFor({ ...CARD_R, grader: 'psa', grade: '9' }) ===
      ID.valuationKeyFor({ ...CARD_R, grader: 'psa', grade: '9', cert: '840612' }),
      'two PSA 9s are worth the same; the cert does not change the price');
check('a PSA 9 and a PSA 10 are valued apart',
      ID.valuationKeyFor({ ...CARD_R, grader: 'psa', grade: '9' }) !==
      ID.valuationKeyFor({ ...CARD_R, grader: 'psa', grade: '10' }));
check('pricing source is part of the valuation key',
      ID.valuationKeyFor(CARD_R, { condition: 'mint', source: 'ebay' }) !==
      ID.valuationKeyFor(CARD_R, { condition: 'mint', source: 'tcgplayer' }),
      'a TCGplayer number must not be cached where an eBay payout is read');
check('the valuation key contains the sku, so it stays debuggable',
      nmKey.startsWith(ID.skuFor(CARD_R)));

// ── 9. Create idempotency ───────────────────────────────────────────────
console.log('\n🔴 retries must not mint two records');
const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const REQ_A = { quantity: 5, condition: 'near-mint' };
const REQ_B = { quantity: 10, condition: 'near-mint' };
let idemStore = new Map();
const idemKv = async (cmd, key, ...rest) => {
  if (cmd === 'get') return idemStore.has(key) ? idemStore.get(key) : null;
  if (cmd === 'set') { idemStore.set(key, rest[0]); return 'OK'; }
  if (cmd === 'del') { idemStore.delete(key); return 1; }
  if (cmd === 'expire') return 1;
  return null;
};
let creations = 0;
const create = async () => { creations += 1; return { instanceId: `inv_made_${creations}` }; };

const first  = await IDEM.runOnce(idemKv, 'sub1', 'instance-create', UUID, create, { request: REQ_A });
const second = await IDEM.runOnce(idemKv, 'sub1', 'instance-create', UUID, create, { request: REQ_A });
check('the first attempt does the work', first.result.instanceId === 'inv_made_1');
check('🔴 a retry does NOT create a second record', creations === 1,
      'generated ids are non-deterministic, so SKU dedup cannot catch this');
check('🔴 the retry returns the ORIGINAL result',
      second.result.instanceId === 'inv_made_1' && second.replayed === true);
check('a different key is a different action',
      (await IDEM.runOnce(idemKv, 'sub1', 'instance-create',
        '11111111-2222-3333-4444-555555555555', create, { request: REQ_A })).result.instanceId === 'inv_made_2');
check('another user cannot replay this user\'s attempt',
      (await IDEM.runOnce(idemKv, 'sub2', 'instance-create', UUID, create, { request: REQ_A })).replayed === false,
      'the key is scoped per user or one seller could read another\'s create result');
check('the same key in a different scope is a different action',
      (await IDEM.runOnce(idemKv, 'sub1', 'draft-create', UUID, create, { request: REQ_A })).replayed === false);

// A key is an opaque bounded token, not a uuid. The uuid-only rule this block
// used to assert is the rule that made every create from the UI fail with
// IDEMPOTENCY_KEY_INVALID, because the keys the app sends are derived
// (`sell-col-<entryId>-<slot>`), never uuids. What must stay refused is
// anything that could walk out of the `idemresource:<sub>:<scope>:<key>`
// namespace, or that is too short to be a meaningful key at all.
for (const bad of ['', 'abc', null, 42, undefined,
                   'sell:col:1',            // `:` is the store's delimiter
                   'sell col 1 2 3 4',      // whitespace
                   'sell/col/1/2/3/4',      // path separator
                   'x'.repeat(129)]) {      // over IDEMPOTENCY_KEY_MAX
  check(`idempotency key ${String(JSON.stringify(bad)).slice(0, 24)} is refused`,
        (() => { try { return !IDEM.validIdempotencyKey(bad); }
                 catch { return true; } })());
}
// The keys this application actually sends must be accepted. Asserting the
// shipped shapes by name is the check that was missing: the suite minted its
// own uuids via K(), so it passed while the product could not create a draft.
for (const good of ['sell-col-1757900000000-ebay-fixed-price',
                    'sell-inst_col_1757900000000-ebay-fixed-price',
                    'pkt-drf_6faa96487b4bac636a05a2e1b3ba9293-r1',
                    'rev-drf_6faa96487b4bac636a05a2e1b3ba9293',
                    'del-drf_6faa96487b4bac636a05a2e1b3ba9293',
                    '11111111-2222-3333-4444-555555555555']) {
  check(`the shipped key ${good.slice(0, 30)} is accepted`,
        IDEM.validIdempotencyKey(good) === true,
        'a validator that refuses the keys its own client and server generate is the D8 defect');
}
idemStore = new Map(); creations = 0;
const boom = async () => { creations += 1; throw new Error('WORK_FAILED'); };
let threw = false;
try { await IDEM.runOnce(idemKv, 'sub1', 'instance-create', UUID, boom, { request: REQ_A }); } catch { threw = true; }
check('a failing attempt propagates the error', threw);
const retried = await IDEM.runOnce(idemKv, 'sub1', 'instance-create', UUID, create, { request: REQ_A });
check('🔴 and is RETRYABLE — one transient failure must not poison the key forever',
      retried.replayed === false && retried.result.instanceId.startsWith('inv_made_'),
      'a failed attempt must release its reservation, or one blip refuses the create for a day');
idemStore = new Map();
await idemKv('set', IDEM.idempotencyKeyFor('sub1', 'instance-create', UUID),
             JSON.stringify({ status: 'in-flight', at: Date.now() }));
const concurrent = await IDEM.runOnce(idemKv, 'sub1', 'instance-create', UUID, create, { request: REQ_A });
check('a concurrent attempt is refused rather than raced',
      concurrent.state === IDEM.IDEMPOTENCY_STATE.IN_FLIGHT,
      'racing two creates is precisely the bug this module exists to prevent');
check('the scopes that must be idempotent are named in one place',
      IDEM.IDEMPOTENT_SCOPES.includes('instance-create') &&
      IDEM.IDEMPOTENT_SCOPES.includes('draft-create') &&
      IDEM.IDEMPOTENT_SCOPES.includes('instance-split') &&
      IDEM.IDEMPOTENT_SCOPES.includes('listing-publish'));


// ── 10. Slot normalization is deterministic and total ───────────────────
console.log('\n🔴 the slot is a uniqueness boundary, so normalization must be total');
check('🔴 casing cannot create two logical slots',
      INV.draftSlot('EBAY', 'FIXED-PRICE') === INV.draftSlot('ebay', 'fixed-price'),
      '"eBay:fixed-price" and "ebay:fixed-price" as two slots reintroduces the collision via casing');
check('the canonical form is lowercase', INV.draftSlot('eBay') === 'ebay:fixed-price');
check('whitespace and underscores canonicalize', INV.draftSlot(' eBay ', 'fixed_price') === 'ebay:fixed-price');
check('a canonical slot recognizes itself', INV.isCanonicalSlot('ebay:fixed-price'));
check('a non-canonical slot is NOT accepted as canonical', !INV.isCanonicalSlot('eBay:fixed-price'));
check('a malformed slot is not canonical', !INV.isCanonicalSlot('ebay') && !INV.isCanonicalSlot('a:b:c'));
for (const [args, expect] of [
  [['', 'fixed-price'],              'SLOT_VENUE_EMPTY'],
  [['ebay', ''],                     'SLOT_STRATEGY_EMPTY'],
  [['unknown-venue', 'fixed-price'], 'SLOT_VENUE_UNKNOWN'],
  [['ebay', 'whatever'],             'SLOT_STRATEGY_UNKNOWN'],
  [[null, 'fixed-price'],            'SLOT_VENUE_EMPTY'],
]) {
  check(`draftSlot(${JSON.stringify(args)}) is refused → ${expect}`,
        (() => { try { INV.draftSlot(...args); return false; }
                 catch (e) { return e.message === expect; } })());
}
check('admission refuses a non-canonical venue rather than inventing a slot',
      INV.phase1DraftAdmission([], 'not-a-venue') === 'SLOT_VENUE_UNKNOWN');
check('🔴 admission normalizes before comparing, so EBAY hits the existing slot',
      INV.phase1DraftAdmission(['ebay:fixed-price'], 'EBAY') === 'ACTIVE_DRAFT_EXISTS_FOR_SLOT',
      'otherwise a differently-cased retry opens a second active draft');
check('a non-canonical entry already in the set does not count as a match',
      INV.phase1DraftAdmission(['eBay:fixed-price'], 'ebay') === null);

// ── 11. Repeated splits conserve basis exactly (property test) ──────────
console.log('\n🔴 repeated splits cannot create or destroy a cent');
function splitChainConserves(qty, total, takes) {
  let lots = [INV.buildInstance(CARD_R, { condition: 'near-mint', quantity: qty, totalAcquisitionCost: total })];
  for (const take of takes) {
    const target = lots.find((l) => l.quantity > take);
    if (!target) break;
    const { remainder, split } = INV.splitInstance(target, take);
    lots = lots.filter((l) => l !== target).concat([remainder, split]);
  }
  const cents = lots.reduce((a, l) => a + Math.round(l.totalAcquisitionCost * 100), 0);
  const q     = lots.reduce((a, l) => a + l.quantity, 0);
  return { cents, q, lots: lots.length };
}
for (const [qty, total, takes] of [
  [3, 100, [1, 1]],
  [10, 100, [3, 2, 1]],
  [11, 55, [3, 3, 1, 2]],
  [7, 0.07, [1, 1, 1]],
  [9, 1000.03, [4, 2, 1]],
  [5, 33.33, [1, 1, 1, 1]],
]) {
  const r = splitChainConserves(qty, total, takes);
  check(`qty ${qty} / $${total} split ${takes.join(',')} → ${r.lots} lots, basis exact`,
        r.cents === Math.round(total * 100),
        `sum $${(r.cents / 100).toFixed(2)} != $${total} — repeated splits must be lossless`);
  check(`qty ${qty} / $${total} split ${takes.join(',')} → quantity conserved`, r.q === qty);
}

// ── 12. Valuation source: 'any' is not a thing ──────────────────────────
console.log('\n🔴 the aggregate source is a defined product, not a shrug');
check('🔴 "any" is refused as a source',
      (() => { try { ID.valuationKeyFor(CARD_R, { condition: 'mint', source: 'any' }); return false; }
               catch (e) { return e.message === 'VALUATION_SOURCE_UNKNOWN'; } })(),
      '"whichever source answered" is not cacheable — the next reader cannot know what they read');
check('the default source is the NAMED aggregate',
      ID.valuationKeyFor(CARD_R, { condition: 'mint' }).endsWith(`|${ID.CONSENSUS_SOURCE}`));
check('the aggregate has a real name', ID.CONSENSUS_SOURCE === 'cardresell-consensus');
check('concrete sources are accepted',
      ID.VALUATION_SOURCES.includes('tcgplayer') && ID.VALUATION_SOURCES.includes('ebay'));
check('"any" is not a member of the source set', !ID.VALUATION_SOURCES.includes('any'));
check('an unknown source is refused, not passed through',
      (() => { try { ID.valuationKeyFor(CARD_R, { condition: 'mint', source: 'some-blog' }); return false; }
               catch (e) { return e.message === 'VALUATION_SOURCE_UNKNOWN'; } })());
check('a slab also carries its source',
      ID.valuationKeyFor({ ...CARD_R, grader: 'psa', grade: '9' }, { source: 'ebay' })
        !== ID.valuationKeyFor({ ...CARD_R, grader: 'psa', grade: '9' }, { source: 'tcgplayer' }));

// ── 13. Idempotency must not fail open ──────────────────────────────────
console.log('\n🔴 fail closed when idempotency cannot be established');
const UUID2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const deadKv = async () => { throw new Error('STORE_DOWN'); };
let attempts = 0;
const mkInstance = async () => { attempts += 1; return { instanceId: `inv_x${attempts}` }; };

for (const scope of IDEM.IDEMPOTENT_SCOPES) {
  check(`${scope} fails CLOSED when the store is unavailable`,
        IDEM.policyFor(scope).onStoreUnavailable === IDEM.FAIL_POLICY.FAIL_CLOSED);
}
attempts = 0;
const down1 = await IDEM.runOnce(deadKv, 'sub1', 'listing-publish', UUID2, mkInstance, { request: REQ_A });
check('🔴 a store outage does NOT run the side effect', attempts === 0,
      'whatever broke the store is plausibly also breaking responses — this is the HIGH-retry window');
check('it reports unavailable, not success', down1.state === IDEM.IDEMPOTENCY_STATE.UNAVAILABLE);
check('it is marked retryable with user-facing copy',
      down1.retryable === true && /try again/i.test(down1.message));
attempts = 0;
await IDEM.runOnce(deadKv, 'sub1', 'listing-publish', UUID2, mkInstance, { request: REQ_A });
await IDEM.runOnce(deadKv, 'sub1', 'listing-publish', UUID2, mkInstance, { request: REQ_A });
check('🔴 repeated retries during an outage never publish twice', attempts === 0,
      'a duplicate eBay listing is a real listing with real fees the seller must find and end by hand');
check('an unknown scope is refused rather than defaulted',
      (() => { try { IDEM.policyFor('whatever'); return false; }
               catch (e) { return e.message === 'IDEMPOTENCY_SCOPE_UNKNOWN'; } })());

// ── 14. Crash after side effect, before result record ───────────────────
console.log('\n🔴 side effect succeeded, result record lost');
let s14 = new Map();
const kv14 = async (cmd, key, ...rest) => {
  if (cmd === 'get') return s14.has(key) ? s14.get(key) : null;
  if (cmd === 'set') { s14.set(key, rest[0]); return 'OK'; }
  if (cmd === 'del') { s14.delete(key); return 1; }
  if (cmd === 'expire') return 1;
  return null;
};
// Simulate: reservation written, work ran, process died before recordDone.
let world = [];
let ran14 = 0;
const create14 = async (op) => { ran14 += 1; const r = { instanceId: `inv_real`, createdByOperation: op }; world.push(r); return r; };
const reconcile14 = async (op) => world.find((r) => r.createdByOperation === op) || null;

s14.set(IDEM.idempotencyKeyFor('sub1', 'instance-create', UUID2),
        JSON.stringify({ status: 'in-flight', at: Date.now(), op: UUID2 }));
world = [{ instanceId: 'inv_real', createdByOperation: UUID2 }];   // the work DID land
ran14 = 0;
const rec = await IDEM.runOnce(kv14, 'sub1', 'instance-create', UUID2, create14, { request: REQ_A, reconcile: reconcile14 });
check('🔴 an in-flight marker with a landed side effect RECONCILES', rec.state === IDEM.IDEMPOTENCY_STATE.RECONCILED,
      'reserve→work→record has a window; the retry must reconcile before repeating');
check('🔴 and does NOT repeat the side effect', ran14 === 0 && world.length === 1);
check('it returns the ORIGINAL resource', rec.result.instanceId === 'inv_real' && rec.replayed === true);

// in-flight with nothing landed → refuse, do not race
s14 = new Map(); world = []; ran14 = 0;
s14.set(IDEM.idempotencyKeyFor('sub1', 'instance-create', UUID2),
        JSON.stringify({ status: 'in-flight', at: Date.now(), op: UUID2 }));
const conc = await IDEM.runOnce(kv14, 'sub1', 'instance-create', UUID2, create14, { request: REQ_A, reconcile: reconcile14 });
check('a genuinely concurrent attempt is refused, not raced',
      conc.state === IDEM.IDEMPOTENCY_STATE.IN_FLIGHT && ran14 === 0);

// reservation EXPIRED after the work landed → the silent-duplicate case
s14 = new Map();                                     // marker gone (TTL)
world = [{ instanceId: 'inv_real', createdByOperation: UUID2 }];
ran14 = 0;
const exp = await IDEM.runOnce(kv14, 'sub1', 'instance-create', UUID2, create14, { request: REQ_A, reconcile: reconcile14 });
check('🔴 an EXPIRED reservation over a landed side effect still reconciles',
      exp.state === IDEM.IDEMPOTENCY_STATE.RECONCILED && ran14 === 0,
      'this is the case that silently duplicates without a reconcile step');

// the resource pointer alone is enough, without a reconcile hook
s14 = new Map(); ran14 = 0; world = [];
await IDEM.runOnce(kv14, 'sub1', 'instance-create', UUID2, create14, { request: REQ_A, reconcile: reconcile14 });
check('the work ran once on a clean slate', ran14 === 1);
s14.delete(IDEM.idempotencyKeyFor('sub1', 'instance-create', UUID2));   // lose the RESULT record only
const viaPointer = await IDEM.runOnce(kv14, 'sub1', 'instance-create', UUID2, create14, { request: REQ_A });  // no reconcile hook
check('🔴 the resource pointer alone recovers a lost result record',
      viaPointer.state === IDEM.IDEMPOTENCY_STATE.RECONCILED && ran14 === 1,
      'the pointer is written first precisely so it outlives the result record');
check('the pointer key is deterministic in the operation',
      IDEM.resourcePointerKey('sub1', 'instance-create', 'abc123')
        === 'idemresource:sub1:instance-create:abc123');
check('the created resource carries its operation provenance',
      world[0].createdByOperation === UUID2,
      'createdByOperation makes the record itself the evidence, not just the pointer');
s14 = new Map(); world = []; ran14 = 0;
s14.set(IDEM.idempotencyKeyFor('sub1', 'instance-create', UUID2),
        JSON.stringify({ status: 'in-flight', at: Date.now() }));
const badRec = await IDEM.runOnce(kv14, 'sub1', 'instance-create', UUID2, create14,
                                  { request: REQ_A, reconcile: async () => { throw new Error('DOWN'); } });
check('🔴 a FAILED reconcile is no evidence and must not be read as absence',
      badRec.state === IDEM.IDEMPOTENCY_STATE.IN_FLIGHT && ran14 === 0,
      'same rule as index pruning: a failed read is not proof the side effect did not happen');


// ── 15. The key identifies one MUTATION, not a store slot ───────────────
console.log('\n🔴 same key + different request must be refused');
let s15 = new Map();
const kv15 = async (cmd, key, ...rest) => {
  if (cmd === 'get') return s15.has(key) ? s15.get(key) : null;
  if (cmd === 'set') { s15.set(key, rest[0]); return 'OK'; }
  if (cmd === 'del') { s15.delete(key); return 1; }
  if (cmd === 'expire') return 1;
  return null;
};
let made = 0;
const mk = async () => { made += 1; return { instanceId: `inv_f${made}` }; };

const f1 = await IDEM.runOnce(kv15, 'sub1', 'instance-create', UUID, mk, { request: REQ_A });
check('the first request succeeds', f1.state === IDEM.IDEMPOTENCY_STATE.FRESH && made === 1);
const f2 = await IDEM.runOnce(kv15, 'sub1', 'instance-create', UUID, mk, { request: REQ_A });
check('the SAME request with the same key replays', f2.replayed === true && made === 1);
const f3 = await IDEM.runOnce(kv15, 'sub1', 'instance-create', UUID, mk, { request: REQ_B });
check('🔴 a DIFFERENT request with the same key is REFUSED',
      f3.state === IDEM.IDEMPOTENCY_STATE.MISMATCH && f3.error === IDEM.FINGERPRINT_MISMATCH,
      'asking for quantity 10 and being handed the quantity-5 result is a lie, not idempotency');
check('and the refusal does NOT run the work', made === 1);
check('the mismatch is not marked retryable — retrying will not help a client bug',
      f3.retryable === false);

console.log('\nthe fingerprint is canonical, so field order cannot break retries');
check('key order does not change the fingerprint',
      IDEM.requestFingerprint({ a: 1, b: 2 }) === IDEM.requestFingerprint({ b: 2, a: 1 }),
      'otherwise a rebuilt client object looks like a different mutation and every retry is refused');
check('nesting is canonicalized too',
      IDEM.requestFingerprint({ x: { p: 1, q: 2 } }) === IDEM.requestFingerprint({ x: { q: 2, p: 1 } }));
check('array ORDER does matter — [a,b] is not [b,a]',
      IDEM.requestFingerprint({ x: [1, 2] }) !== IDEM.requestFingerprint({ x: [2, 1] }));
check('a changed value changes the fingerprint',
      IDEM.requestFingerprint({ q: 5 }) !== IDEM.requestFingerprint({ q: 10 }));
check('undefined and absent are the same request',
      IDEM.requestFingerprint({ a: 1, b: undefined }) === IDEM.requestFingerprint({ a: 1 }));
check('null and absent are NOT the same request',
      IDEM.requestFingerprint({ a: 1, b: null }) !== IDEM.requestFingerprint({ a: 1 }),
      'an explicit null is a stated value; absent is no statement');
check('"5" and 5 are different requests',
      IDEM.requestFingerprint({ q: '5' }) !== IDEM.requestFingerprint({ q: 5 }));
check('a request is REQUIRED — an undeclared body cannot be fingerprinted',
      await (async () => { try { await IDEM.runOnce(kv15, 'sub1', 'instance-create', UUID, mk); return false; }
                           catch (e) { return e.message === 'IDEMPOTENCY_REQUEST_REQUIRED'; } })());

console.log('\nthe pointer path honours the fingerprint too');
s15 = new Map(); made = 0;
await IDEM.runOnce(kv15, 'sub1', 'instance-create', UUID, mk, { request: REQ_A });
s15.delete(IDEM.idempotencyKeyFor('sub1', 'instance-create', UUID));   // lose the result record
const viaPtrMismatch = await IDEM.runOnce(kv15, 'sub1', 'instance-create', UUID, mk, { request: REQ_B });
check('🔴 a mismatched request cannot be answered from the resource pointer either',
      viaPtrMismatch.state === IDEM.IDEMPOTENCY_STATE.MISMATCH && made === 1,
      'the pointer is evidence about a DIFFERENT operation');
const viaPtrMatch = await IDEM.runOnce(kv15, 'sub1', 'instance-create', UUID, mk, { request: REQ_A });
check('but a matching request still recovers from the pointer',
      viaPtrMatch.state === IDEM.IDEMPOTENCY_STATE.RECONCILED && made === 1);

console.log('\nlisting-publish: the case that must never replay across requests');
s15 = new Map();
let published = [];
const pub = async () => { published.push('one'); return { listingId: `lst_${published.length}` }; };
const PRICE_A = { sku: 'v2-X', price: 400, title: 'Charizard PSA 9' };
const PRICE_B = { sku: 'v2-X', price: 40,  title: 'Charizard PSA 9' };
await IDEM.runOnce(kv15, 'sub1', 'listing-publish', UUID, pub, { request: PRICE_A });
const wrongPrice = await IDEM.runOnce(kv15, 'sub1', 'listing-publish', UUID, pub, { request: PRICE_B });
check('🔴 a different PRICE under the same key is refused, not replayed',
      wrongPrice.state === IDEM.IDEMPOTENCY_STATE.MISMATCH,
      'replaying here tells the seller a $40 listing published at $400');
check('and it does not publish a second listing', published.length === 1);

// ── 16. Venue + strategy PAIR validation ────────────────────────────────
console.log('\n🔴 the venue/strategy PAIR must be possible');
check('eBay supports auction', INV.draftSlot('ebay', 'auction') === 'ebay:auction');
check('Whatnot supports auction', INV.draftSlot('whatnot', 'auction') === 'whatnot:auction');
check('🔴 Mercari + auction is refused even though both tokens are valid',
      (() => { try { INV.draftSlot('mercari', 'auction'); return false; }
               catch (e) { return e.message === 'SLOT_STRATEGY_UNSUPPORTED_FOR_VENUE'; } })(),
      'a draft in an impossible slot looks like a listing in progress that can never publish');
check('Whatnot + fixed-price is refused',
      (() => { try { INV.draftSlot('whatnot', 'fixed-price'); return false; }
               catch (e) { return e.message === 'SLOT_STRATEGY_UNSUPPORTED_FOR_VENUE'; } })());
check('every venue declares at least one strategy',
      INV.VENUES.every((v) => INV.SUPPORTED_SLOTS[v].length > 0));
check('the strategy list is derived from the table, not maintained separately',
      INV.STRATEGIES.every((st) => Object.values(INV.SUPPORTED_SLOTS).flat().includes(st)));
check('admission reports the pair failure specifically',
      INV.phase1DraftAdmission([], 'mercari', 'auction') === 'SLOT_STRATEGY_UNSUPPORTED_FOR_VENUE');
check('a Phase 1 eBay auction slot is admitted', INV.phase1DraftAdmission([], 'ebay', 'auction') === null);

// ── 17. The harness itself refuses a Promise as a truth value ───────────
console.log('\n🔴 a Promise is never a truth value');
const before = failed;
console.log('  (the next three FAIL lines are EXPECTED — the guard proving it fires)');
check('[expected-fail] a Promise passed to check() is a FAILURE, not an ok', (async () => true)());
check('🔴 the harness caught it', failed === before + 1,
      'two vacuous assertions shipped before this guard existed');
failed = before;   // that failure was the point of the test
await checkAsync('checkAsync awaits and asserts the resolved value', async () => true);
await checkAsync('[expected-fail] checkAsync fails on a resolved false', async () => false);
check('the false case counted as a failure', failed === before + 1);
failed = before;
await checkAsync('[expected-fail] a throwing async assertion is a failure, not a crash', async () => { throw new Error('x'); });
check('the throw counted as a failure', failed === before + 1);
failed = before;


// ── 18. Fingerprint the VALIDATED mutation, not the raw body ────────────
console.log('\nthe fingerprint describes business intent, not serialization');
const MF = (o) => IDEM.mutationFingerprint('instance-create', o);
check('a real SKU keeps its casing — SKUs are opaque ids, not tokens',
      typeof MF({ sku: 'v2-XXX7473-592a391e7b472559', quantity: 5 }) === 'string',
      'a blanket lowercase rule here would refuse every genuine retry');
check('property order does not matter',
      MF({ sku: 'v2-A', quantity: 5 }) === MF({ quantity: 5, sku: 'v2-A' }));
check('an unknown cost is still fingerprintable and is not zero',
      MF({ sku: 'v2-A', totalAcquisitionCost: null }) !== MF({ sku: 'v2-A', totalAcquisitionCost: 0 }),
      'unknown basis splits to unknown, never zero — same rule as My Flips');
const refuses = (o, why) => {
  try { MF(o); return false; } catch (e) { return e.message.includes(why); }
};
check('🔴 a numeric STRING is refused, not coerced',
      refuses({ sku: 'v2-A', quantity: '5' }, 'numeric-string'),
      'coercing here would be a second normalization impl beside the endpoint, and they would drift');
check('a non-canonical token is refused', refuses({ sku: 'v2-A', condition: 'Near-Mint' }, 'uncanonical-case'));
check('an untrimmed value is refused', refuses({ sku: ' v2-A ', quantity: 1 }, 'untrimmed'));
check('a fractional quantity is refused', refuses({ sku: 'v2-A', quantity: 1.5 }, 'not-a-non-negative-integer'));
check('a negative quantity is refused', refuses({ sku: 'v2-A', quantity: -1 }, 'not-a-non-negative-integer'));
check('sub-cent money is refused — 19.999 and 20.00 are the same charge',
      refuses({ sku: 'v2-A', totalAcquisitionCost: 19.999 }, 'sub-cent-precision'));
check('🔴 an UNDECLARED field is refused',
      refuses({ sku: 'v2-A', nope: 1 }, 'MUTATION_FIELD_UNDECLARED'),
      'silent drift here eventually produces a fingerprint blind to a price change');
check('a cosmetic field cannot be smuggled in to defeat a retry',
      refuses({ sku: 'v2-A', requestedAt: 'x' }, 'MUTATION_FIELD_UNDECLARED'));
check('every idempotent scope declares its mutation fields',
      IDEM.IDEMPOTENT_SCOPES.every((sc) => IDEM.MUTATION_FIELDS[sc] &&
                                            Object.keys(IDEM.MUTATION_FIELDS[sc]).length > 0),
      'a scope with no declared fields would fingerprint every request identically');
check('listing-publish declares price and title — the fields that must never silently replay',
      'price' in IDEM.MUTATION_FIELDS['listing-publish'] &&
      'title' in IDEM.MUTATION_FIELDS['listing-publish']);
check('an unknown scope cannot be fingerprinted',
      (() => { try { IDEM.mutationFingerprint('nope', {}); return false; }
               catch (e) { return e.message === 'IDEMPOTENCY_SCOPE_UNKNOWN'; } })());

// ── 19. PERMANENT: the nastiest crash state ─────────────────────────────
console.log('\n🔴 PERMANENT ASSERTION — pointer survives, fingerprint differs');
let s19 = new Map();
const kv19 = async (cmd, key, ...rest) => {
  if (cmd === 'get') return s19.has(key) ? s19.get(key) : null;
  if (cmd === 'set') { s19.set(key, rest[0]); return 'OK'; }
  if (cmd === 'del') { s19.delete(key); return 1; }
  return cmd === 'expire' ? 1 : null;
};
let sideEffects = 0;
const publish = async () => { sideEffects += 1; return { listingId: `lst_${sideEffects}` }; };
const KEY19 = '99999999-8888-7777-6666-555555555555';
const A = IDEM.selectMutation('listing-publish', { draftId: 'drf_1', price: 400, title: 'Charizard PSA 9' });
const B = IDEM.selectMutation('listing-publish', { draftId: 'drf_1', price: 40,  title: 'Charizard PSA 9' });

await IDEM.runOnce(kv19, 'sub1', 'listing-publish', KEY19, publish, { request: A });
// Crash between pointer write and result write: only the pointer survives.
s19.delete(IDEM.idempotencyKeyFor('sub1', 'listing-publish', KEY19));
check('setup: only the resource pointer survives',
      s19.has(IDEM.resourcePointerKey('sub1', 'listing-publish', KEY19)) &&
      !s19.has(IDEM.idempotencyKeyFor('sub1', 'listing-publish', KEY19)));

const nasty = await IDEM.runOnce(kv19, 'sub1', 'listing-publish', KEY19, publish, {
  request: B,
  reconcile: async () => ({ listingId: 'lst_1' }),   // authoritative state EXISTS
});
check('🔴 same key + different fingerprint + only the pointer survives → REFUSED',
      nasty.state === IDEM.IDEMPOTENCY_STATE.MISMATCH && nasty.error === IDEM.FINGERPRINT_MISMATCH,
      'never reconcile to the old resource: the pointer is evidence about a DIFFERENT mutation');
check('and it does NOT publish a second listing', sideEffects === 1,
      'refusing is safe; publishing again is not');
check('and it does NOT return the old listing as if it were this request',
      !nasty.result || nasty.result.listingId !== 'lst_1',
      'returning lst_1 here tells the seller a $40 publish succeeded at $400');
const honest = await IDEM.runOnce(kv19, 'sub1', 'listing-publish', KEY19, publish, {
  request: A, reconcile: async () => ({ listingId: 'lst_1' }),
});
check('the MATCHING request still recovers from the pointer without republishing',
      honest.replayed === true && sideEffects === 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
