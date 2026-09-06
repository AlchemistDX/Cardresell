// tests/draft-store.mjs — C1 authoritative draft persistence
import { harness } from './_assert.mjs';
import * as DS from '../api/_draftStore.js';
import * as INV from '../api/_inventoryInstance.js';

const { check, checkAsync, done } = harness('draft-store');

console.log('\n[C1 draft store]');

// in-memory Upstash with NX + EX semantics
function makeKv() {
  const s = new Map();
  let failNext = 0;
  const kv = async (cmd, key, ...rest) => {
    if (failNext > 0) { failNext -= 1; throw new Error('STORE DOWN'); }
    if (cmd === 'get') return s.has(key) ? s.get(key) : null;
    if (cmd === 'set') {
      const nx = rest.includes('NX');
      if (nx && s.has(key)) return null;
      s.set(key, rest[0]);
      return 'OK';
    }
    if (cmd === 'del') { s.delete(key); return 1; }
    if (cmd === 'expire') return 1;
    return null;
  };
  kv.store = s;
  kv.breakFor = (n) => { failNext = n; };
  return kv;
}

const base = () => ({
  instanceId: 'inv_abc', sku: 'v2-XXX7473-592a391e7b472559',
  slot: INV.draftSlot('ebay', 'fixed-price'), title: 'Charizard VMAX 074/073 PSA 9',
  price: 400, quantity: 1,
});

// ── build ────────────────────────────────────────────────────────────────
console.log('\nbuilding a draft');
const d1 = DS.buildDraft(base());
check('a new draft starts at revision 1', d1.rev === 1);
check('a new draft is editable', d1.status === DS.DRAFT_STATUS.DRAFT);
check('the draft id is unguessable, not derived from the card',
      /^drf_[0-9a-f]{32}$/.test(d1.draftId));
check('two drafts for the same instance get different ids',
      DS.buildDraft(base()).draftId !== DS.buildDraft(base()).draftId,
      'the draft is not deterministic; the SKU is');
check('the draft carries the SKU, the instance AND the slot — all three',
      d1.sku && d1.instanceId && d1.slot,
      'losing any one of these collapses two layers that we deliberately separated');
check('the schema version is stamped', d1.schemaVersion === DS.DRAFT_SCHEMA_VERSION);
check('the slot is stored canonical', INV.isCanonicalSlot(d1.slot));

const bad = (o, why) => {
  try { DS.buildDraft({ ...base(), ...o }); return false; }
  catch (e) { return e.message.includes(why); }
};
check('a missing instance is refused', bad({ instanceId: undefined }, 'instanceId'));
check('a sub-cent price is refused', bad({ price: 19.999 }, 'sub-cent'),
      'persisting it makes every later fee calculation disagree by a fraction');
check('a negative price is refused', bad({ price: -1 }, 'negative'));
check('a price of zero is allowed — free is a real listing choice',
      DS.buildDraft({ ...base(), price: 0 }).price === 0);
check('a title over the eBay 80-char limit is refused',
      bad({ title: 'x'.repeat(81) }, 'too-long'),
      'eBay would reject it at publish; catching it at draft time is the point of a draft');
check('an 80-char title is accepted', DS.buildDraft({ ...base(), title: 'x'.repeat(80) }).title.length === 80);
check('a numeric-string price is refused, not coerced', bad({ price: '400' }, 'not-a-finite-number'));

// ── edit + revision concurrency ──────────────────────────────────────────
console.log('\nediting: the revision is the concurrency control');
const d2 = DS.applyEdit(d1, { price: 375 }, { expectedRev: 1 });
check('an edit bumps the revision', d2.rev === 2);
check('the edit applied', d2.price === 375);
check('createdAt survives an edit', d2.createdAt === d1.createdAt);
const editErr = (patch, opts, why) => {
  try { DS.applyEdit(d1, patch, opts); return false; } catch (e) { return e.message.includes(why); }
};
check('🔴 an edit with NO expected revision is refused',
      editErr({ price: 1 }, {}, DS.ERR.REV_REQUIRED),
      'without it a seller editing a stale copy silently overwrites an edit they never saw');
check('🔴 an edit against a STALE revision is refused',
      editErr({ price: 1 }, { expectedRev: 1 }, DS.ERR.REV_CONFLICT) === false &&
      (() => { try { DS.applyEdit(d2, { price: 1 }, { expectedRev: 1 }); return false; }
               catch (e) { return e.message === DS.ERR.REV_CONFLICT; } })(),
      'the lost update, which here would be a wrong live price');
check('the instance cannot be patched',
      editErr({ instanceId: 'inv_other' }, { expectedRev: 1 }, 'immutable'),
      'moving a draft to another physical card while keeping its slot and history is a delete plus a create');
check('the SKU cannot be patched', editErr({ sku: 'v2-other' }, { expectedRev: 1 }, 'immutable'));
check('the slot cannot be patched', editErr({ slot: 'ebay:auction' }, { expectedRev: 1 }, 'immutable'));
check('the draft id cannot be patched', editErr({ draftId: 'drf_x' }, { expectedRev: 1 }, 'immutable'));
check('a patch that restates an identity field UNCHANGED is fine',
      DS.applyEdit(d1, { sku: d1.sku, price: 10 }, { expectedRev: 1 }).price === 10,
      'clients that PUT the whole object must not be forced to strip fields');
check('quantity must be a positive integer',
      editErr({ quantity: 0 }, { expectedRev: 1 }, 'not-a-positive-integer'));
check('a published draft is not freely editable',
      (() => { try { DS.applyEdit({ ...d1, status: 'published' }, { price: 1 }, { expectedRev: 1 }); return false; }
               catch (e) { return e.message === DS.ERR.NOT_EDITABLE; } })(),
      'editing the local copy of a live listing would make the app disagree with eBay');

// ── tombstones ───────────────────────────────────────────────────────────
console.log('\ndeleting leaves a tombstone, not a hole');
const t = DS.tombstone(d2);
check('the tombstone bumps the revision too', t.rev === 3);
check('the tombstone is marked deleted', t.status === DS.DRAFT_STATUS.DELETED);
check('the tombstone keeps identity', t.draftId === d2.draftId && t.instanceId === d2.instanceId);
check('the tombstone DROPS seller content',
      t.title === undefined && t.price === undefined,
      'a tombstone proves non-active; it is not a backup of the seller\'s content');
check('tombstoning twice is idempotent', DS.tombstone(t).rev === t.rev);
const readTomb = DS.readStoredDraft(JSON.stringify(t));
check('🔴 a tombstone reads as DELETED, not as absent',
      readTomb.error === DS.ERR.DELETED && readTomb.deleted === true && readTomb.exists === true,
      'index reconciliation may prune on confirmed non-active; it may never prune on absence');
check('an absent record reads as NOT_FOUND with absence as the evidence',
      DS.readStoredDraft(null).error === DS.ERR.NOT_FOUND);

// ── schema safety ────────────────────────────────────────────────────────
console.log('\nschema-safe reads');
const future = JSON.stringify({ ...d1, schemaVersion: DS.DRAFT_SCHEMA_VERSION + 1 });
const fr = DS.readStoredDraft(future);
check('🔴 a record from a NEWER schema is refused, not best-effort parsed',
      fr.error === DS.ERR.SCHEMA_TOO_NEW,
      'parsing it with old semantics and writing it back silently destroys fields the new version added');
check('but it is reported as EXISTING, so the UI says "newer version" not "not found"',
      fr.exists === true);
check('a record with no schema version is unreadable',
      DS.readStoredDraft(JSON.stringify({ draftId: 'x' })).error === DS.ERR.UNREADABLE);
check('unparseable JSON is unreadable, not absent',
      DS.readStoredDraft('{not json').error === DS.ERR.UNREADABLE);

// ── persistence + claim races ────────────────────────────────────────────
console.log('\npersistence: SET NX is the only atomic primitive we have');
let kv = makeKv();
const put1 = await DS.putDraft(kv, 'sub1', d1, 'op-1');
check('the first write succeeds', put1.ok === true);
const got = await DS.getDraft(kv, 'sub1', d1.draftId);
check('and reads back', got.ok === true && got.draft.price === 400);

const rival = { ...d1, rev: 2, price: 1 };
const mine  = { ...d1, rev: 2, price: 2 };
const w1 = await DS.putDraft(kv, 'sub1', rival, 'op-rival');
const w2 = await DS.putDraft(kv, 'sub1', mine, 'op-mine');
check('🔴 two writers claiming the SAME revision: exactly one wins',
      w1.ok !== w2.ok,
      'read-then-write would let both write rev 2 and one edit would silently vanish');
check('the loser is told it is a conflict, not a store error',
      (w1.ok ? w2 : w1).error === DS.ERR.REV_CONFLICT);
const after = await DS.getDraft(kv, 'sub1', d1.draftId);
check('the stored record is the winner\'s, intact', after.draft.price === (w1.ok ? 1 : 2));

console.log('\na retry of MY OWN claim is not a conflict');
const again = await DS.putDraft(kv, 'sub1', w1.ok ? rival : mine, w1.ok ? 'op-rival' : 'op-mine');
check('🔴 re-claiming the same revision with the same operation id succeeds',
      again.ok === true && again.replayedClaim === true,
      'otherwise a retry after a lost response deadlocks forever against its own claim');
const impostor = await DS.putDraft(kv, 'sub1', { ...d1, rev: 2, price: 999 }, 'op-someone-else');
check('but a DIFFERENT operation still loses that revision', impostor.ok === false);

console.log('\nstore failures fail closed');
kv = makeKv();
await DS.putDraft(kv, 'sub1', d1, 'op-1');
kv.breakFor(1);
const readFail = await DS.getDraft(kv, 'sub1', d1.draftId);
check('🔴 a failed READ is never reported as not-found',
      readFail.error === DS.ERR.STORE_UNAVAILABLE && readFail.retryable === true,
      'downstream, absence is a licence to prune an index entry or create a duplicate');
kv.breakFor(1);
const claimFail = await DS.claimRevision(kv, 'sub1', d1.draftId, 5, 'op-x');
check('🔴 a failed CLAIM does not fall through to an optimistic write',
      claimFail.claimed === false && claimFail.error === DS.ERR.STORE_UNAVAILABLE);

// ── end-to-end ───────────────────────────────────────────────────────────
console.log('\nend to end: create, edit, conflict, delete');
kv = makeKv();
const live = DS.buildDraft({ ...base(), createdByOperation: 'op-create' });
await DS.putDraft(kv, 'sub1', live, 'op-create');
const e1 = await DS.editDraft(kv, 'sub1', live.draftId, { price: 350 }, 1, 'op-e1');
check('an edit at the current revision succeeds', e1.ok === true && e1.draft.rev === 2);
const e2 = await DS.editDraft(kv, 'sub1', live.draftId, { price: 300 }, 1, 'op-e2');
check('🔴 a second editor holding revision 1 is refused', e2.ok === false && e2.error === DS.ERR.REV_CONFLICT);
check('and is handed the CURRENT record so the UI can show what it missed',
      e2.current && e2.current.price === 350,
      '"someone changed this" is only actionable if you show them what it now says');
const del = await DS.deleteDraft(kv, 'sub1', live.draftId, 2, 'op-del');
check('delete succeeds', del.ok === true && del.deleted === true);
const readAfter = await DS.getDraft(kv, 'sub1', live.draftId);
check('the deleted draft reads as DELETED', readAfter.error === DS.ERR.DELETED);
const delAgain = await DS.deleteDraft(kv, 'sub1', live.draftId, undefined, 'op-del2');
check('deleting twice succeeds — a seller pressing delete twice is not an error',
      delAgain.ok === true && delAgain.alreadyDeleted === true);
const editDeleted = await DS.editDraft(kv, 'sub1', live.draftId, { price: 1 }, 3, 'op-x');
check('🔴 a deleted draft cannot be edited back to life',
      editDeleted.ok === false && editDeleted.error === DS.ERR.DELETED);
const missing = await DS.getDraft(kv, 'sub1', 'drf_does_not_exist');
check('an unknown draft is NOT_FOUND', missing.error === DS.ERR.NOT_FOUND);

await checkAsync('a draft never leaks across users',
  async () => {
    const other = await DS.getDraft(kv, 'sub2', live.draftId);
    return other.error === DS.ERR.NOT_FOUND;
  }, 'the key is scoped per user');

done();
