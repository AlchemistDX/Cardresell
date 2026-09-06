// tests/draft-index-recovery.mjs — Block C entry criteria
//
// Two things the external review asked to be settled before C1 counts as
// complete:
//   1. a failed index write must never strand an authoritative draft
//   2. packetSchemaVersion must be acted on, never assumed current
//
// The index module talks to Upstash over fetch(), so these tests stub fetch
// with an in-memory Redis that can be told to fail specific commands. That
// exercises the real code path rather than a re-implementation of it.

import assert from 'node:assert';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}`); if (detail) console.log(`       → ${detail}`); }
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
    default: result = null;
  }
  return { ok: true, status: 200, json: async () => ({ result }) };
};

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
      readStoredPacket({ packetSchemaVersion: cur, sku: 'x' }).status === PACKET_COMPAT.CURRENT);
const ahead = readStoredPacket({ packetSchemaVersion: cur + 1, sku: 'x' });
check('🔴 a newer packet is marked incompatible, not read as current',
      ahead.status === PACKET_COMPAT.INCOMPATIBLE && ahead.usable === false);
check('a newer packet is preserved verbatim, not rewritten or dropped',
      ahead.packet && ahead.packet.sku === 'x' && ahead.packet.packetSchemaVersion === cur + 1,
      'the reader is behind; the record is not corrupt');
check('the reason distinguishes "ahead of reader" from corruption',
      ahead.reason === 'PACKET_VERSION_AHEAD_OF_READER');
for (const bad of [{}, { packetSchemaVersion: null }, { packetSchemaVersion: '1' },
                   { packetSchemaVersion: 1.5 }, { packetSchemaVersion: 0 },
                   { packetSchemaVersion: -3 }]) {
  const r = readStoredPacket(bad);
  check(`malformed version ${JSON.stringify(bad.packetSchemaVersion)} → incompatible, never current`,
        r.status === PACKET_COMPAT.INCOMPATIBLE && r.usable === false,
        `got ${r.status}`);
}
for (const junk of [null, undefined, [], 'packet', 7]) {
  const r = readStoredPacket(junk);
  check(`non-object ${JSON.stringify(junk)} is refused`,
        r.status === PACKET_COMPAT.INCOMPATIBLE && r.usable === false);
}
const older = readStoredPacket({ packetSchemaVersion: 1, sku: 'x' }, { currentVersion: 2 });
check('an older version with no registered migration is incompatible, not assumed',
      older.status === PACKET_COMPAT.INCOMPATIBLE
      && older.reason === 'PACKET_NO_MIGRATION_PATH',
      'silently treating v1 as v2 is the outcome C0 exists to prevent');
check('an unmigratable old packet is still preserved', older.packet.sku === 'x');

// migration table wired up for real
const { PACKET_MIGRATIONS } = await import('../api/_listingPacket.js');
PACKET_MIGRATIONS[1] = (p) => ({ ...p, packetSchemaVersion: 2, migratedField: true });
const migrated = readStoredPacket({ packetSchemaVersion: 1, sku: 'x' }, { currentVersion: 2 });
check('a registered migration runs and the packet becomes usable',
      migrated.status === PACKET_COMPAT.MIGRATED && migrated.usable === true
      && migrated.packet.migratedField === true);
check('the migration is recorded, not silent',
      migrated.migrationsApplied.join(',') === '1->2' && migrated.fromVersion === 1);
PACKET_MIGRATIONS[2] = (p) => ({ ...p, packetSchemaVersion: 3 });
const twoHops = readStoredPacket({ packetSchemaVersion: 1 }, { currentVersion: 3 });
check('multi-step migrations chain in order',
      twoHops.status === PACKET_COMPAT.MIGRATED
      && twoHops.migrationsApplied.join(',') === '1->2,2->3');
PACKET_MIGRATIONS[2] = (p) => ({ ...p });   // forgets to advance the version
const stuck = readStoredPacket({ packetSchemaVersion: 1 }, { currentVersion: 3 });
check('a migration that does not advance the version fails loudly',
      stuck.status === PACKET_COMPAT.INCOMPATIBLE
      && stuck.reason === 'PACKET_MIGRATION_DID_NOT_ADVANCE_VERSION',
      'a half-applied chain must not be handed back as usable');
delete PACKET_MIGRATIONS[1]; delete PACKET_MIGRATIONS[2];


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

const rawA = INV.buildInstance(CARD_RAW, { condition: 'near-mint', acquisitionCost: 80 });
const rawB = INV.buildInstance(CARD_RAW, { condition: 'heavily-played', acquisitionCost: 45 });
check('🔴 two raw copies share one SKU', rawA.sku === rawB.sku);
check('🔴 but are different instances — the collision is gone',
      rawA.instanceId !== rawB.instanceId,
      'this is the case that was broken before C0c: NM and HP collided on one draft pointer');
check('each carries its own condition and cost',
      rawA.condition === 'near-mint' && rawA.acquisitionCost === 80 &&
      rawB.condition === 'heavily-played' && rawB.acquisitionCost === 45);
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
      INV.instanceDraftKey('sub1', rawA.instanceId) === `instancedraft:sub1:${rawA.instanceId}`);
check('two raw copies get two independent draft slots',
      INV.instanceDraftKey('sub1', rawA.instanceId) !== INV.instanceDraftKey('sub1', rawB.instanceId));
check('a per-product set still answers "all drafts for this card"',
      INV.skuInstancesKey('sub1', rawA.sku) === `skuinv:sub1:${rawA.sku}`);
check('key delimiters are refused, not escaped',
      (() => { try { INV.instanceKey('a:b', 'x'); return false; } catch { return true; } })());

console.log('\nquantity — lots, with honest limits');
const lot = INV.buildInstance(CARD_RAW, { condition: 'near-mint', quantity: 5 });
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
  const r = (() => { try { return INV.buildInstance(CARD_RAW, { condition: 'mint', acquisitionCost: bad }); }
                     catch (e) { return e.message; } })();
  check(`cost ${JSON.stringify(bad)} never becomes a real number`,
        bad === null || bad === '' ? r.acquisitionCost === null : r === 'INSTANCE_COST_INVALID',
        'Number(null) === 0 must not turn missing input into a $0 cost basis');
}

console.log('\nlot splitting stays possible');
const { remainder, split } = INV.splitInstance(lot, 2, { condition: 'lightly-played', acquisitionCost: 12 });
check('the split leaves the lot smaller', remainder.quantity === 3);
check('the split copies become their own instance',
      split.quantity === 2 && split.instanceId !== lot.instanceId);
check('the split can differ materially', split.condition === 'lightly-played' && split.acquisitionCost === 12);
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
