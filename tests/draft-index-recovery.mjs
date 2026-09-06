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
      result = ['0', [...store.keys()].filter((k) => rx.test(k))];
      break;
    }
    default: result = null;
  }
  return { ok: true, status: 200, json: async () => ({ result }) };
};

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
check('a deterministic recovery path is named', res.recovery === 'rebuildDraftIndex');

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
