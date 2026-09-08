// tests/draft-store.mjs — C1 authoritative draft persistence
import { harness } from './_assert.mjs';
import * as DS from '../api/_draftStore.js';
import * as INV from '../api/_inventoryInstance.js';
import { packetInputFingerprint } from '../api/_listingPacket.js';

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
check('an 81-char title STORES fine — 80 is eBay\'s rule, not the store\'s',
      DS.buildDraft({ ...base(), title: 'x'.repeat(81) }).title.length === 81,
      'the store is multi-venue by design; see the slot-validation block below');
check('but a title past the storage sanity bound is refused',
      bad({ title: 'x'.repeat(DS.TITLE_HARD_MAX + 1) }, 'too-long'));
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
const t = DS.tombstone(d2, { expectedRev: d2.rev });
check('the tombstone bumps the revision too', t.rev === 3);
check('the tombstone is marked deleted', t.status === DS.DRAFT_STATUS.DELETED);
check('the tombstone keeps identity', t.draftId === d2.draftId && t.instanceId === d2.instanceId);
check('the tombstone DROPS seller content',
      t.title === undefined && t.price === undefined,
      'a tombstone proves non-active; it is not a backup of the seller\'s content');
check('tombstoning twice is idempotent — and needs no revision', DS.tombstone(t).rev === t.rev);
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


// ── orphan claims ────────────────────────────────────────────────────────
console.log('\n🔴 a claimed-but-uncommitted revision must always recover');
kv = makeKv();
const od = DS.buildDraft(base());
await DS.putDraft(kv, 'sub1', od, 'op-create');           // rev 1 committed
// Editor A claims rev 2 and dies before writing.
await kv('set', DS.revisionClaimKey('sub1', od.draftId, 2),
         JSON.stringify({ op: 'op-A', at: Date.now() }), 'NX', 'EX', 600);
const stillOne = await DS.getDraft(kv, 'sub1', od.draftId);
check('setup: rev 2 is claimed but the record is still rev 1',
      stillOne.draft.rev === 1);

const opARetry = await DS.putDraft(kv, 'sub1', { ...od, rev: 2, price: 350 }, 'op-A');
check('🔴 the SAME operation retrying completes its own revision',
      opARetry.ok === true && opARetry.replayedClaim === true,
      'otherwise a retry after a lost response deadlocks against its own claim');

// Now the harder case: a DIFFERENT operation meets a young orphan, then a stale one.
kv = makeKv();
const od2 = DS.buildDraft(base());
await DS.putDraft(kv, 'sub1', od2, 'op-create');
await kv('set', DS.revisionClaimKey('sub1', od2.draftId, 2),
         JSON.stringify({ op: 'op-A', at: Date.now() }), 'NX', 'EX', 600);
const youngOrphan = await DS.putDraft(kv, 'sub1', { ...od2, rev: 2, price: 1 }, 'op-B');
check('a YOUNG claim from another operation is refused as IN-FLIGHT, not conflict',
      youngOrphan.ok === false && youngOrphan.error === DS.ERR.REV_IN_FLIGHT,
      'nothing has conflicted yet — the other writer may simply still be running');
check('and the refusal is RETRYABLE with a hint of how long to wait',
      youngOrphan.retryable === true && youngOrphan.retryAfterMs > 0);

// Age the claim past the grace window.
await kv('set', DS.revisionClaimKey('sub1', od2.draftId, 2),
         JSON.stringify({ op: 'op-A', at: Date.now() - (DS.CLAIM_GRACE_MS + 5000) }));
const staleOrphan = await DS.putDraft(kv, 'sub1', { ...od2, rev: 2, price: 1 }, 'op-B');
check('🔴 a STALE orphan is taken over — never a permanent block',
      staleOrphan.ok === true && staleOrphan.claimOutcome === DS.CLAIM_OUTCOME.ORPHAN_TAKEN,
      '"someone else has rev 2" when nobody has rev 2 would wedge the draft forever');
const afterTakeover = await DS.getDraft(kv, 'sub1', od2.draftId);
check('the takeover actually advanced the record', afterTakeover.draft.rev === 2);

// Only ONE taker may win an orphan.
kv = makeKv();
const od3 = DS.buildDraft(base());
await DS.putDraft(kv, 'sub1', od3, 'op-create');
await kv('set', DS.revisionClaimKey('sub1', od3.draftId, 2),
         JSON.stringify({ op: 'op-A', at: Date.now() - 60000 }), 'NX', 'EX', 600);
const [tb, tc] = await Promise.all([
  DS.putDraft(kv, 'sub1', { ...od3, rev: 2, price: 11 }, 'op-B'),
  DS.putDraft(kv, 'sub1', { ...od3, rev: 2, price: 22 }, 'op-C'),
]);
check('🔴 two writers racing to take over the SAME orphan: exactly one wins',
      tb.ok !== tc.ok, 'the takeover is itself an NX claim');

// A claim whose revision DID commit is a genuine conflict, not an orphan.
kv = makeKv();
const od4 = DS.buildDraft(base());
await DS.putDraft(kv, 'sub1', od4, 'op-create');
await DS.putDraft(kv, 'sub1', { ...od4, rev: 2, price: 9 }, 'op-A');
await kv('set', DS.revisionClaimKey('sub1', od4.draftId, 2),
         JSON.stringify({ op: 'op-A', at: Date.now() - 60000 }));
const committed = await DS.putDraft(kv, 'sub1', { ...od4, rev: 2, price: 5 }, 'op-B');
check('🔴 a claim whose revision COMMITTED is a real conflict, never taken over',
      committed.ok === false && committed.error === DS.ERR.REV_CONFLICT,
      'the authoritative record decides whether it committed, not the claim');

// ── the guard: ownership is necessary, never sufficient ──────────────────
console.log('\n🔴 claim ownership is NEVER sufficient on its own');
kv = makeKv();
const gd = DS.buildDraft(base());
await DS.putDraft(kv, 'sub1', gd, 'op-1');
await DS.putDraft(kv, 'sub1', { ...gd, rev: 2, price: 300 }, 'op-2');
await DS.putDraft(kv, 'sub1', { ...gd, rev: 3, price: 250 }, 'op-3');
// Ops wipe every claim key. Concurrency detection is gone; correctness is not.
for (const k of [...kv.store.keys()]) if (k.startsWith('draftrev:')) kv.store.delete(k);
// This writer read rev 2 and believes rev 3 is next. The record is already at 3.
const staleAfterWipe = await DS.putDraft(kv, 'sub1', { ...gd, rev: 3, price: 1 }, 'op-stale');
check('🔴 a stale writer cannot advance just because the claim key vanished',
      staleAfterWipe.ok === false && staleAfterWipe.error === DS.ERR.REV_CONFLICT,
      'losing claim keys must degrade concurrency detection, never correctness');
check('and it is told the authoritative revision it actually lost to',
      staleAfterWipe.current && staleAfterWipe.current.rev === 3);
const rightful = await DS.putDraft(kv, 'sub1', { ...gd, rev: 4, price: 200 }, 'op-4');
check('the CORRECT successor still writes fine after a claim wipe', rightful.ok === true);

// ── DELETE concurrency ───────────────────────────────────────────────────
console.log('\n🔴 delete is destructive, so it gets edit-grade concurrency');
kv = makeKv();
const dd = DS.buildDraft(base());
await DS.putDraft(kv, 'sub1', dd, 'op-c');
await DS.putDraft(kv, 'sub1', { ...dd, rev: 2, price: 300 }, 'op-e1');
await DS.putDraft(kv, 'sub1', { ...dd, rev: 3, price: 275 }, 'op-e2');
await DS.putDraft(kv, 'sub1', { ...dd, rev: 4, price: 260 }, 'op-e3');

const phoneStale = await DS.deleteDraft(kv, 'sub1', dd.draftId, 3, 'op-phone');
check('🔴 DELETE with a STALE expectedRev is refused',
      phoneStale.ok === false && phoneStale.error === DS.ERR.REV_CONFLICT,
      'the phone would otherwise destroy a version the seller never saw');
const survived = await DS.getDraft(kv, 'sub1', dd.draftId);
check('and the record is untouched at its current revision',
      survived.ok === true && survived.draft.rev === 4 && survived.draft.price === 260);
check('the refusal hands back the current record so the UI can show the diff',
      phoneStale.current && phoneStale.current.price === 260);

const noRev = await DS.deleteDraft(kv, 'sub1', dd.draftId, undefined, 'op-norev');
check('🔴 DELETE with NO expectedRev on an ACTIVE draft is refused',
      noRev.ok === false && noRev.error === DS.ERR.REV_REQUIRED);

const good = await DS.deleteDraft(kv, 'sub1', dd.draftId, 4, 'op-del');
check('DELETE at the current revision succeeds', good.ok === true && good.deleted === true);
const twice = await DS.deleteDraft(kv, 'sub1', dd.draftId, 4, 'op-del2');
check('deleting an already-tombstoned draft succeeds even with a stale rev',
      twice.ok === true && twice.alreadyDeleted === true,
      'the intent is already satisfied and there is no unseen work left to destroy');
const twiceNoRev = await DS.deleteDraft(kv, 'sub1', dd.draftId, undefined, 'op-del3');
check('and with no rev at all', twiceNoRev.ok === true && twiceNoRev.alreadyDeleted === true);

const resurrect = await DS.putDraft(kv, 'sub1', { ...dd, rev: 5, price: 999 }, 'op-zombie');
check('🔴 no stale PUT can resurrect a tombstone',
      resurrect.ok === false && resurrect.error === DS.ERR.DELETED,
      'deletion is a decision the seller made; a slow client must not undo it by arriving late');
const resurrectHigh = await DS.putDraft(kv, 'sub1', { ...dd, rev: 6, price: 999 }, 'op-zombie2');
check('not even at a higher revision', resurrectHigh.ok === false && resurrectHigh.error === DS.ERR.DELETED);

// ── slot-specific validation ─────────────────────────────────────────────
console.log('\nvenue rules belong to the venue, not to the storage layer');
const longTitle = DS.buildDraft({ ...base(), title: 'x'.repeat(120) });
check('a 120-char title SAVES — a seller mid-edit is not blocked from persisting',
      longTitle.title.length === 120,
      'save rules and publish rules are different rules; conflating them is how apps lose drafts');
const ebayCheck = DS.validateDraftForSlot(longTitle, 'ebay:fixed-price');
check('🔴 but it fails eBay validation at 80 chars',
      ebayCheck.ok === false && ebayCheck.violations.some((v) => v.code === DS.VIOLATION.TITLE_TOO_LONG));
check('the violation says by how much', ebayCheck.violations[0].detail === '120 > 80');
check('the same title fails Mercari even harder at 40',
      DS.validateDraftForSlot(longTitle, 'mercari:fixed-price').violations
        .some((v) => v.detail === '120 > 40'),
      'baking 80 into the store would have hidden this the day a second venue lands');
check('but PASSES TCGplayer at 200', DS.validateDraftForSlot(longTitle, 'tcgplayer:fixed-price').ok === true);
check('a normal draft passes its own slot', DS.validateDraftForSlot(DS.buildDraft(base())).ok === true);
check('a zero price is fine to store but refused by eBay',
      DS.buildDraft({ ...base(), price: 0 }).price === 0 &&
      DS.validateDraftForSlot(DS.buildDraft({ ...base(), price: 0 }), 'ebay:fixed-price')
        .violations.some((v) => v.code === DS.VIOLATION.ZERO_PRICE));
check('an unknown slot is refused rather than assumed permissive',
      DS.validateDraftForSlot(DS.buildDraft(base()), 'nope:nope').violations[0].code === DS.VIOLATION.UNKNOWN_SLOT);
check('every Phase 1 venue slot has rules',
      INV.VENUES.every((v) => INV.SUPPORTED_SLOTS[v].every((st) => !!DS.SLOT_RULES[`${v}:${st}`])),
      'a slot with no rules would publish unvalidated');


// ── replaying a write that already committed ─────────────────────────────
console.log('\nan operation retrying its OWN committed write is a replay, not a failure');
kv = makeKv();
const rp = DS.buildDraft(base());
await DS.putDraft(kv, 'sub1', rp, 'op-c');
const firstWrite = await DS.putDraft(kv, 'sub1', { ...rp, rev: 2, price: 321 }, 'op-edit');
check('setup: the write lands', firstWrite.ok === true);
const replay = await DS.putDraft(kv, 'sub1', { ...rp, rev: 2, price: 321 }, 'op-edit');
check('🔴 the same operation retrying gets SUCCESS, not a conflict',
      replay.ok === true && replay.replayedWrite === true,
      'a caller whose response was lost must not be told its committed write failed');
check('and it gets back the record that actually landed', replay.draft.price === 321);
const notMine = await DS.putDraft(kv, 'sub1', { ...rp, rev: 2, price: 999 }, 'op-other');
check('a DIFFERENT operation at that revision is still a conflict',
      notMine.ok === false && notMine.error === DS.ERR.REV_CONFLICT,
      'replay is only available to the operation that owns the claim');
const unchanged = await DS.getDraft(kv, 'sub1', rp.draftId);
check('and the impostor changed nothing', unchanged.draft.price === 321);

console.log('\nclaim keys are protocol state with a documented lifecycle');
check('a claim is a lease, not a permanent lock', DS.CLAIM_TTL_SEC === 600);
check('the in-flight grace window is much shorter than the lease',
      DS.CLAIM_GRACE_MS < DS.CLAIM_TTL_SEC * 1000,
      'otherwise an orphan could never be taken over before its own lease expired');
check('takeover keys are namespaced separately from claims',
      DS.takeoverKey('s', 'd', 2).startsWith('drafttake:') &&
      DS.revisionClaimKey('s', 'd', 2).startsWith('draftrev:'));


// ── claim age is server-owned ────────────────────────────────────────────
console.log('\nclaim age comes from the server clock, never from request input');
kv = makeKv();
const ts = DS.buildDraft({ ...base(), title: 'Clock test' });
await DS.putDraft(kv, 'sub1', ts, 'op-c');
const rawClaim = kv.store.get(DS.revisionClaimKey('sub1', ts.draftId, 1));
const parsedClaim = JSON.parse(rawClaim);
check('the claim stores a server timestamp', Number.isFinite(parsedClaim.at) && parsedClaim.at > 0);
check('and it is within a second of now', Math.abs(Date.now() - parsedClaim.at) < 1000);

// A client trying to smuggle a timestamp in must not be able to age its own claim.
const hostile = { ...DS.buildDraft(base()), at: 0, claimedAt: 0, timestamp: 0 };
await DS.putDraft(kv, 'sub1', { ...hostile, draftId: ts.draftId, rev: 2 }, 'op-hostile2');
const claim2 = JSON.parse(kv.store.get(DS.revisionClaimKey('sub1', ts.draftId, 2)) || '{}');
check('🔴 client-supplied timestamp fields cannot age a claim',
      Number.isFinite(claim2.at) && Math.abs(Date.now() - claim2.at) < 1000,
      'a client that could set at=0 would get any live writer treated as an orphan');

// An unparseable/legacy claim value is treated as MAXIMALLY OLD, not young.
kv = makeKv();
const lg = DS.buildDraft(base());
await DS.putDraft(kv, 'sub1', lg, 'op-c');
await kv('set', DS.revisionClaimKey('sub1', lg.draftId, 2), 'op-legacy-plain-string');
const legacyTakeover = await DS.putDraft(kv, 'sub1', { ...lg, rev: 2, price: 12 }, 'op-new');
check('a legacy claim with no timestamp is recoverable, not a permanent block',
      legacyTakeover.ok === true,
      'treating an unknown age as YOUNG would wedge the draft until its TTL expired');
check('and the guard still governed the write it allowed',
      (await DS.getDraft(kv, 'sub1', lg.draftId)).draft.rev === 2);


console.log('\na persisted packet is a snapshot, and never takes the draft down with it');
const pkBase = () => ({
  draftId: 'drf_' + 'a'.repeat(32), instanceId: 'i1', sku: 's1',
  slot: 'ebay:fixed-price', title: 'T', price: 10,
});
// A `packet` in `extra` is routed THROUGH buildDraft rather than spread over
// its output. Spreading bypassed the writer, which is now what records the
// input fingerprint beside the packet, so a spread fixture arrived looking
// like a packet stored by no known writer -- and read as STALE
// (PACKET_INPUTS_UNRECORDED) instead of exercising the version axis these
// checks are about. The fixture was wrong in a way that only became visible
// once absence stopped being read as agreement.
// SECOND FIXTURE CORRECTION (2026-09-08): `buildDraft` no longer computes the
// fingerprint from the draft -- it reads the one the PACKET BUILDER stamped,
// because computing it from the draft proved only that the draft matched
// itself. So a fixture packet with no `metadata.inputFingerprint` now records
// no fingerprint and reads STALE, which again is not the axis these checks
// are about. The fixture stamps the matching one, which is what a real
// producer does: the packet declares the inputs it consumed.
const pk_stored = (extra = {}) => {
  const { packet, ...rest } = extra;
  let p = packet;
  if (p && p.metadata && p.metadata.inputFingerprint === undefined) {
    // THIRD FIXTURE CORRECTION (2026-09-08): the projection widened to include
    // `sku` and `slot`, so a stamp over price/source/title alone no longer
    // matches any draft. Stamped from the record the writer will actually
    // persist, which is what a producer handed the same inputs would stamp.
    p = { ...p, metadata: { ...p.metadata,
      inputFingerprint: packetInputFingerprint(DS.buildDraft(pkBase())) } };
  }
  const base = packet === undefined ? DS.buildDraft(pkBase())
                                    : DS.buildDraft({ ...pkBase(), packet: p });
  return JSON.stringify({ ...base, ...rest });
};

check('a draft with no packet reads clean',
      DS.readStoredDraft(pk_stored({})).packetStatus === undefined);

const pk_cur = DS.readStoredDraft(pk_stored({ packet: { metadata: { packetSchemaVersion: 1 }, title: 'X' } }));
check('a current packet is returned as usable',
      pk_cur.ok === true && pk_cur.packetUsable === true && pk_cur.packetStatus === 'CURRENT');
check('and it is the packet itself, not a copy of the draft', pk_cur.packet.title === 'X');

const pk_ahead = DS.readStoredDraft(pk_stored({ packet: { metadata: { packetSchemaVersion: 99 }, title: 'X' } }));
check('🔴 a packet from a NEWER deploy does not fail the draft read',
      pk_ahead.ok === true,
      'the draft is authoritative; the snapshot is advisory');
check('but the packet is refused as unusable',
      pk_ahead.packetUsable === false && pk_ahead.packetStatus === 'INCOMPATIBLE');
check('and it is named as pk_ahead of this reader',
      pk_ahead.packetReason === 'PACKET_VERSION_AHEAD_OF_READER');
check('🔴 the unreadable packet is preserved verbatim, not dropped',
      pk_ahead.packetRaw && pk_ahead.packetRaw.metadata.packetSchemaVersion === 99,
      'the client that CAN read it may be one deploy away');
check('and the usable packet field is null so nothing stale can be shown',
      pk_ahead.packet === null);

const pk_bad = DS.readStoredDraft(pk_stored({ packet: { packetSchemaVersion: '1' } }));
check('🔴 a string version is unknown provenance, not version 1',
      pk_bad.packetUsable === false && pk_bad.packetReason === 'PACKET_VERSION_MALFORMED');
const pk_noVer = DS.readStoredDraft(pk_stored({ packet: { title: 'X' } }));
check('a packet with no version at all is refused, never assumed current',
      pk_noVer.packetUsable === false);
check('and the draft is still perfectly readable', pk_noVer.ok === true && pk_noVer.draft.price === 10);

check('a non-object packet is refused at WRITE time', (() => {
  try { DS.buildDraft({ ...pkBase(), packet: 'nope' }); return false; }
  catch (e) { return e.message.endsWith(':packet:not-an-object'); }
})());
check('a packet is stored verbatim with the version it declared',
      DS.buildDraft({ ...pkBase(), packet: { metadata: { packetSchemaVersion: 1 }, a: 1 } }).packet.metadata.packetSchemaVersion === 1,
      'stamping our own version onto someone else\u2019s packet destroys the fact that makes it safe to read');

const pk_tomb = DS.readStoredDraft(JSON.stringify({
  ...DS.buildDraft(pkBase()), status: 'deleted', packet: { packetSchemaVersion: 1 },
}));
check('a tombstone is still DELETED regardless of what packet it carries',
      pk_tomb.ok === false && pk_tomb.error === DS.ERR.DELETED);

// ── Lane A: a packet may not outlive the inputs it was built from ──────────
//
// The version check answers "can this reader parse the snapshot". It cannot
// answer "does the snapshot still describe this draft", and that second
// question is the one that shows a WRONG NUMBER rather than an error: a
// perfectly current v1 packet priced at $100 sitting on a draft the seller
// has since repriced to $500.
//
// Before this, `applyEdit` spread `{...current}`, so the packet was carried
// across a reprice byte-for-byte and `readStoredDraft` returned it as
// CURRENT / usable. Nothing was wrong with the packet. It was simply about a
// price that no longer existed.
console.log('\na packet may not outlive the inputs it was built from');

const laneA = (over = {}) => DS.buildDraft({
  draftId: 'd_laneA', instanceId: 'i_laneA', sku: 'sku_laneA',
  slot: 'ebay:fixed-price', title: 'Charizard Base Set Holo', price: 100,
  rev: 1, priceSource: 'comp',
  // Stamped as a real producer stamps it: from the inputs the packet
  // consumed, not from the draft it is attached to.
  packet: { metadata: { packetSchemaVersion: 1,
              inputFingerprint: packetInputFingerprint({ sku: 'sku_laneA', slot: 'ebay:fixed-price',
                price: 100, priceSource: 'comp', title: 'Charizard Base Set Holo' }) },
            pricing: { listPrice: 100 }, title: { text: 'Charizard Base Set Holo' } },
  ...over,
});

const la_fresh = DS.buildDraft(laneA());
check('the writer records the inputs a packet was built from',
      typeof la_fresh.packetInputs === 'string' && la_fresh.packetInputs.length > 0);
check('and a packet read back unedited is CURRENT and usable',
      DS.readStoredDraft(JSON.stringify(la_fresh)).packetUsable === true
      && DS.readStoredDraft(JSON.stringify(la_fresh)).packetStatus === 'CURRENT');

// The defect, pinned. Note this goes through applyEdit -- the real edit path,
// not a hand-built row -- so it fails if the carry-forward ever returns.
const la_repriced = DS.applyEdit(la_fresh, { price: 500 }, { expectedRev: la_fresh.rev });
const la_read     = DS.readStoredDraft(JSON.stringify(la_repriced));
check('\ud83d\udd34 a reprice through applyEdit still carries the packet bytes forward',
      la_repriced.packet && la_repriced.packet.pricing.listPrice === 100 && la_repriced.price === 500,
      'the edit path does not know about packets, and must not have to');
check('\ud83d\udd34 but the reader refuses it as STALE rather than showing $100 for a $500 draft',
      la_read.packetUsable === false && la_read.packetStatus === 'STALE'
      && la_read.packetReason === 'PACKET_INPUTS_DIFFER');
check('and no packet is handed to the caller to render',
      la_read.packet === null);
check('while the draft itself reads fine -- advisory snapshot, authoritative draft',
      la_read.ok === true && la_read.draft.price === 500);
check('and the stale bytes are PRESERVED, not deleted',
      !!la_read.packetRaw && la_read.packetRaw.pricing.listPrice === 100);

// Title is a packet input too, because the packet carries title.text.
const la_retitled = DS.applyEdit(la_fresh, { title: 'Charizard Base Set' }, { expectedRev: la_fresh.rev });
check('a title edit also makes the packet stale',
      DS.readStoredDraft(JSON.stringify(la_retitled)).packetStatus === 'STALE');

// ...but an edit that cannot have changed a packet field must NOT invalidate.
// An over-broad invalidation would be its own defect: it would throw away a
// good snapshot, and re-earn a NO_PROVENANCE warning, for editing a note.
const la_qty   = DS.applyEdit(la_fresh, { quantity: 4 },        { expectedRev: la_fresh.rev });
const la_notes = DS.applyEdit(la_fresh, { notes: 'ship Monday' }, { expectedRev: la_fresh.rev });
// ===========================================================================
// THE OVER-INVALIDATION CONTROL — READ BEFORE WIDENING PACKET_INPUT_FIELDS
//
// The two checks below assert that a packet SURVIVES a quantity or notes edit.
// They are not slack in the staleness guard. They are the guard against the
// opposite defect, and they are the only thing enforcing it.
//
// Mutation evidence: adding 'quantity' to PACKET_INPUT_FIELDS turns exactly ONE
// check red — the first one below. Nothing else in the suite notices. So if
// this assertion is deleted, the design silently becomes "any edit invalidates",
// which throws away a good snapshot and re-earns a DRAFT_NO_PRICE_PROVENANCE
// warning for changing a note. The packet is a snapshot of PRICE PROVENANCE; a
// note is not an input to it, and invalidating on one is not caution, it is a
// wrong answer that happens to fail safe-looking.
//
// This is a guard against being TOO CONSERVATIVE, which is rare here — almost
// every other assertion in this file guards against being too permissive. That
// rarity is the risk: a reviewer scanning for missing invalidations reads this
// as an oversight, widens the field list "to be safe", sees one red, and
// deletes it as stale. The one red IS the design. See instance 40a in
// audit/PATTERN_ASSERTION_SURFACE.md before changing either of these.
//
// Widening the list is correct only when the packet's OUTPUT actually depends
// on the new field. Ask: would buildListingPacket() produce different bytes?
// For quantity and notes today the answer is no.
// ===========================================================================
check('a quantity edit does NOT invalidate the packet',
      DS.readStoredDraft(JSON.stringify(la_qty)).packetUsable === true);
check('nor does a notes edit',
      DS.readStoredDraft(JSON.stringify(la_notes)).packetUsable === true);

// Absence is not agreement. A packet stored by a path that records no
// fingerprint cannot be shown to match, so it is stale -- the same rule the
// version check applies to a malformed version.
const la_legacy = { ...la_fresh };
delete la_legacy.packetInputs;
check('a packet with no recorded inputs is stale, not assumed current',
      DS.readStoredDraft(JSON.stringify(la_legacy)).packetStatus === 'STALE'
      && DS.readStoredDraft(JSON.stringify(la_legacy)).packetReason === 'PACKET_INPUTS_UNRECORDED');

// STALE and INCOMPATIBLE are different facts and must not collapse into one
// message: one means "recompute", the other means "your app is behind".
const la_ahead = DS.buildDraft(laneA({ packet: { metadata: { packetSchemaVersion: 99,
  inputFingerprint: packetInputFingerprint({ sku: 'sku_laneA', slot: 'ebay:fixed-price',
    price: 100, priceSource: 'comp', title: 'Charizard Base Set Holo' }) } } }));
check('a version-ahead packet is INCOMPATIBLE, not STALE',
      DS.readStoredDraft(JSON.stringify(la_ahead)).packetStatus === 'INCOMPATIBLE');

// The provenance finding follows the same rule: a packet that does not cover
// the current price is not provenance for it. This is deliberately NOT
// manufacturing provenance to clear a warning -- it is letting the warning
// return when the thing that justified silencing it stopped being true.
// ── The initial mismatch, distinguished from the edit mismatch ────────────
//
// A packet can fail to cover a draft two ways, and they send someone to two
// different places. Attached to a record it NEVER described -- a build-time
// bug -- versus described it once and the seller has since moved a dependent
// input. The old code could not tell them apart, because the stored
// fingerprint was the draft's own and therefore always agreed.
{
  const fpOf = (o) => packetInputFingerprint(o);
  const mismatched = DS.buildDraft(laneA({
    packet: { metadata: { packetSchemaVersion: 1,
                // built from $100, about to be attached to a $500 draft
                inputFingerprint: fpOf({ sku: 'sku_laneA', slot: 'ebay:fixed-price',
                  price: 100, priceSource: 'comp', title: 'Charizard Base Set Holo' }) },
              pricing: { listPrice: 100 }, title: { text: 'Charizard Base Set Holo' } },
    price: 500,
  }));
  const readBack = DS.readStoredDraft(JSON.stringify(mismatched));
  check('\ud83d\udd34 a packet built from a different price is refused at the FIRST read',
        readBack.packetUsable === false && readBack.packetStatus === 'STALE',
        'no edit happened; the packet never described this draft');
  check('and the reason names it as never having matched, not as an edit',
        readBack.packetReason === 'PACKET_INPUTS_NEVER_MATCHED');
  check('the draft itself still reads fine \u2014 the snapshot is advisory',
        readBack.ok === true && readBack.draft.price === 500);
  check('the bytes are preserved for whoever debugs the producer',
        readBack.packetRaw && readBack.packetRaw.pricing.listPrice === 100);

  // REVIEW CHECK: bind the packet to the card, not only to its price.
  // Two different cards can share a display title and a price -- a common
  // reprint, or the same card in two sets. Before the projection widened, a
  // packet built for card A attached to card B matched, and B's draft would
  // have shown A's category, aspects and condition block.
  const wrongCard = DS.buildDraft(laneA({
    sku: 'sku_OTHER_CARD',
    packet: { metadata: { packetSchemaVersion: 1,
                inputFingerprint: fpOf({ sku: 'sku_laneA', slot: 'ebay:fixed-price',
                  price: 100, priceSource: 'comp', title: 'Charizard Base Set Holo' }) },
              pricing: { listPrice: 100 }, title: { text: 'Charizard Base Set Holo' } },
  }));
  const wcRead = DS.readStoredDraft(JSON.stringify(wrongCard));
  check('\ud83d\udd34 a packet cannot be inherited by a different card at the same title and price',
        wcRead.packetUsable === false && wcRead.packetStatus === 'STALE',
        'identity is most of a packet: sku, category, aspects and condition all come from the row');
  check('and that draft is still readable',
        wcRead.ok === true && wcRead.draft.sku === 'sku_OTHER_CARD');

  // Slot is not editable today. It is in the projection anyway, because
  // "not editable today" is a claim about another module's behaviour.
  const wrongSlot = DS.buildDraft(laneA({ slot: 'ebay:auction' }));
  check('a packet built for one slot does not cover a draft in another',
        DS.readStoredDraft(JSON.stringify(wrongSlot)).packetUsable === false);

  // The other direction, which is the one that makes the projection useful
  // rather than merely strict: an edit to a field the builder never reads
  // must NOT invalidate the packet, and must not rewrite its bytes.
  const notesOnly = DS.applyEdit(DS.buildDraft(laneA()),
                                 { notes: 'Keep front and back photos together.' },
                                 { expectedRev: 1 });
  const noRead = DS.readStoredDraft(JSON.stringify(notesOnly));
  check('a notes-only edit leaves the packet current',
        noRead.packetUsable === true && noRead.packetStatus === 'CURRENT');
  check('and the packet bytes are unchanged by that edit',
        JSON.stringify(noRead.packet) === JSON.stringify(DS.buildDraft(laneA()).packet));

  // The edit case keeps its own name, and rev is what separates them.
  const edited = DS.applyEdit(DS.buildDraft(laneA()), { price: 500 }, { expectedRev: 1 });
  // WAS: asserted the reason was PACKET_INPUTS_CHANGED. Renamed to DIFFER
  // because "changed" asserted that the packet had once matched and an edit
  // moved it -- a history the record cannot establish, since a never-matching
  // packet that is then edited past also arrives here.
  check('a mismatch after an edit is reported as DIFFER, not NEVER_MATCHED',
        DS.readStoredDraft(JSON.stringify(edited)).packetReason === 'PACKET_INPUTS_DIFFER');
}

const codesFor = (d) => DS.validateDraftForSlot(d, 'ebay:fixed-price').violations.map((v) => v.code);
check('a covered price makes no provenance finding',
      !codesFor(la_fresh).includes(DS.VIOLATION.NO_PROVENANCE));
// WAS: 'a repriced draft whose packet was not rebuilt raises NO_PROVENANCE
// again'. It stopped being true when applyEdit began recording a changed price
// as seller-set, which routes this draft to the SELLER_PRICED arm instead.
// That is the same disclosure told more precisely: NO_PROVENANCE says "we
// cannot say where this number came from", and after a seller edit we can --
// the seller typed it. The finding the assertion existed to protect is the one
// that must not vanish, so it is asserted on the arm that now carries it, plus
// an explicit check that the draft did not fall silent between the two.
check('\ud83d\udd34 a repriced draft still raises a price-origin finding',
      codesFor(la_repriced).includes(DS.VIOLATION.SELLER_PRICED),
      'after applyEdit re-attributes, the origin of the new number is stated '
      + 'as seller-set rather than unaccounted-for: ' + codesFor(la_repriced).join(','));
check('and it is not silent about the price it no longer documents',
      codesFor(la_repriced).some((c) => c === DS.VIOLATION.SELLER_PRICED
        || c === DS.VIOLATION.NO_PROVENANCE),
      codesFor(la_repriced).join(','));
check('setup: the reprice is what moved it to the seller arm',
      la_repriced.priceSource === DS.PRICE_SOURCE.SELLER
        && la_fresh.priceSource !== DS.PRICE_SOURCE.SELLER,
      la_fresh.priceSource + ' -> ' + la_repriced.priceSource);

// ── The edit owner re-attributes a changed price ────────────────────────────
//
// The defect: priceSource was written at create and never moved, so a draft
// created 'comp' stayed 'comp' after a seller typed their own price over it.
// Harmless while nothing rendered the field; D4 renders it as the sentence
// "this price was derived from the market data below", which made a stale
// field into a false claim on screen.
{
  const base = () => DS.buildDraft({ ...laneA() });
  const withSource = (src) => ({ ...base(), priceSource: src });

  const comp = withSource('comp');
  check('setup: the draft starts comp-derived at a known price',
        comp.priceSource === 'comp' && typeof comp.price === 'number', String(comp.price));

  const moved = DS.applyEdit(comp, { price: comp.price + 65 }, { expectedRev: comp.rev });
  check('\ud83d\udd34 a price the seller changed is recorded as seller-set',
        moved.priceSource === DS.PRICE_SOURCE.SELLER, moved.priceSource);

  // The basis is a true record of what the market said. It stays; only its
  // ROLE changes, which is what the review screen derives from priceSource.
  check('\ud83d\udd34 and the edit does not destroy the pricing record to fix a label',
        JSON.stringify(moved.packet) === JSON.stringify(comp.packet));

  // The control on the rule: "any edit re-attributes" would be a different
  // false claim, told about every seller who fixed a typo in their notes.
  const noted = DS.applyEdit(comp, { notes: 'ships Monday' }, { expectedRev: comp.rev });
  check('\ud83d\udd34 a notes-only edit leaves the attribution alone',
        noted.priceSource === 'comp', noted.priceSource);
  check('setup: the notes edit did land', noted.notes === 'ships Monday');

  const titled = DS.applyEdit(comp, { title: 'Charizard Base Set Holo 4/102' }, { expectedRev: comp.rev });
  check('a title-only edit leaves the attribution alone', titled.priceSource === 'comp');

  const qty = DS.applyEdit(comp, { quantity: 2 }, { expectedRev: comp.rev });
  check('a quantity-only edit leaves the attribution alone', qty.priceSource === 'comp');

  // Normalization first, comparison second. A form that round-trips 400 as
  // "400.00" resubmits the same price; calling that a seller decision would
  // re-attribute a price nobody moved.
  const same = DS.applyEdit(comp, { price: Number(comp.price.toFixed(2)) }, { expectedRev: comp.rev });
  check('\ud83d\udd34 a price resubmitted unchanged after normalization does NOT re-attribute',
        same.priceSource === 'comp', same.priceSource + ' @ ' + same.price);
  // A string price never reaches the comparison at all: requireMoney refuses
  // it first. Asserted so the normalization claim above is not read as
  // covering a shape the guard rejects.
  let stringRejected = null;
  try { DS.applyEdit(comp, { price: comp.price.toFixed(2) }, { expectedRev: comp.rev }); }
  catch (e) { stringRejected = e.message; }
  check('a price sent as a string is refused before attribution is considered',
        typeof stringRejected === 'string' && /price/.test(stringRejected),
        String(stringRejected));

  // A seller-set price edited again stays seller-set: the rule sets, it does
  // not toggle.
  const seller = withSource('seller');
  const again = DS.applyEdit(seller, { price: seller.price + 1 }, { expectedRev: seller.rev });
  check('a seller-set price edited again is still seller-set',
        again.priceSource === DS.PRICE_SOURCE.SELLER, again.priceSource);
}

done();
