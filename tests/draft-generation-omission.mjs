// tests/draft-generation-omission.mjs — an omitted generation is a CLAIM.
//
// Before 2026-09-10 the create handler skipped the generation comparison
// entirely when the request carried no generation. That put the protection
// against a stale create back onto the idempotency record, which expires — the
// exact dependence the lifecycle generation exists to remove. The counterexample
// is short: create with no generation, delete, let both idempotency records
// expire, resend the ORIGINAL request. Nothing compared it to anything, and the
// old intent entered the current generation as a fresh create.
//
// The rule under test: an omitted generation is read as the legacy generation
// (0) and then goes through the SAME authoritative resolution and the SAME
// comparison as an explicit value. Generation 0 still supports first creation,
// legacy adoption and interrupted-create recovery. Once a deletion, a
// disappearance or a retirement has advanced the row, omission cannot authorize
// another creation. An invalid value is rejected, never read as omission.
//
// Everything here runs against the real service, the real store, the real
// idempotency module and the real lifecycle code over an in-memory Upstash.

import { harness } from './_assert.mjs';
import {
  SUB, K, store, sets, reset, kv, SVC, DS, EP, IDEM,
  input, httpInput, fakeReq, fakeRes, fail,
} from './_draftHarness.mjs';

const { check, checkAsync, section, done } = harness('draft-generation-omission');

const LC = await import('../api/_draftLifecycle.js');

const INST = 'inst_abc123';
const SLOT = 'ebay:fixed-price';
const lcKey = () => LC.lifecycleKey(SUB, INST, SLOT);
const quotaKey = () => `draftquota:${SUB}`;
const draftKeys = () => [...store.keys()].filter((k) => k.startsWith(`draft:${SUB}:`));
const quotaCount = () => Number(store.get(quotaKey()) || 0);
const gen = async () => (await LC.readLifecycle(kv, SUB, INST, SLOT)).record.gen;
const lastState = async () => (await LC.readLifecycle(kv, SUB, INST, SLOT)).record.lastState;

/**
 * Expire the idempotency records for one key.
 *
 * The fake has no TTL clock, so expiry is modelled by deleting exactly the
 * keys Upstash would drop. This is the whole point of the counterexample: the
 * protection must not be these records.
 */
function expireIdempotency() {
  let n = 0;
  for (const k of [...store.keys()]) {
    if (k.startsWith('idem:') || k.startsWith('idemresource:')) { store.delete(k); n++; }
  }
  return n;
}

/** Create with NO generation at all — an old client. */
const createOmitted = (key, over = {}) =>
  SVC.createDraft(kv, SUB, { ...input(), instanceId: INST, slot: SLOT, ...over }, K(key), {});

/** Create with an explicit generation. */
const createAt = (key, g, over = {}) =>
  SVC.createDraft(kv, SUB, { ...input(), instanceId: INST, slot: SLOT, ...over }, K(key), { generation: g });

async function caught(fn) {
  try { const r = await fn(); return { threw: false, result: r }; }
  catch (e) { return { threw: true, message: String(e && e.message), detail: (e && e.detail) || {} }; }
}

// ───────────────────────────────────────────────────────────────────────────
await section('generation 0 still does the three things a legacy client legitimately does', async () => {

  reset();
  const first = await createOmitted('legacy-first');
  check('an omitted generation creates on an unrecorded row',
        first.state === IDEM.IDEMPOTENCY_STATE.FRESH && first.result.saved === true,
        'the compatibility rule must not break the client it exists for');
  check('and the row records generation 0', await gen() === 0);
  const firstId = first.result.draftId;

  // Legacy adoption: a draft that predates the lifecycle record.
  reset();
  const pre = await createOmitted('adopt-seed');
  const preId = pre.result.draftId;
  store.delete(lcKey());                        // the record never existed for this row
  const adopted = await createOmitted('adopt-new-key');
  check('an omitted generation ADOPTS a draft that predates the record',
        adopted.result.draftId === preId && adopted.result.existing === true,
        'legacy discovery is the reason omission maps to 0 rather than being refused');
  check('and no second draft was written', draftKeys().length === 1);

  // Interrupted-create recovery: the reservation landed, the response did not,
  // and the client retries with a NEW key and still no generation.
  reset();
  const inter = await createOmitted('interrupted');
  const interId = inter.result.draftId;
  await LC.withLifecycleLock(kv, SUB, INST, SLOT, async ({ fence }) =>
    LC.reserveCreate(kv, SUB, INST, SLOT, interId, 0, fence));
  check('the row is left reserved over a live draft',
        await lastState() === LC.LIFECYCLE_STATE.RESERVED);
  const recovered = await createOmitted('interrupted-retry');
  check('an omitted generation recovers the interrupted create',
        recovered.result.draftId === interId && recovered.result.existing === true);
  check('and still only one draft exists', draftKeys().length === 1);
});

// ───────────────────────────────────────────────────────────────────────────
await section('the counterexample: omission after BOTH idempotency records expired', async () => {

  reset();
  const c = await createOmitted('counter-1');
  const cId = c.result.draftId;
  const quotaAfterCreate = quotaCount();
  const del = await SVC.deleteDraftOp(kv, SUB, cId, 1, K('counter-del'));
  check('the draft is deleted', del.ok === true && del.deleted === true);
  check('the deletion advanced the generation to 1', await gen() === 1);
  check('and released the slot', quotaCount() === quotaAfterCreate - 1);

  const expired = expireIdempotency();
  check('both idempotency records are gone', expired > 0 && ![...store.keys()].some((k) => k.startsWith('idem')));

  const quotaBefore = quotaCount();
  const draftsBefore = draftKeys().length;
  const replay = await caught(() => createOmitted('counter-1'));   // the ORIGINAL request, verbatim
  check('🔴 the original request, resent with no generation, is REFUSED',
        replay.threw && replay.message === SVC.SERVICE_ERR.LIFECYCLE_STALE,
        'this is the defect: it used to skip the comparison and create a second draft');
  check('the refusal names the resolved generation', replay.detail.generation === 1);
  check('and reports that nothing was sent rather than inventing a claim',
        replay.detail.sentGeneration === null && replay.detail.generationOmitted === true);
  check('the evidence names the rule that refused it',
        replay.detail.evidence === 'omitted-generation-not-legacy');
  check('it is not retryable', replay.detail.retryable === false);
  check('🔴 no draft was created', draftKeys().length === draftsBefore);
  check('🔴 and no quota was consumed', quotaCount() === quotaBefore,
        'a refused create that still spent a slot would leak the cap one delete at a time');

  const fresh = await createAt('counter-fresh', 1);
  check('an explicit Create at the current generation still succeeds',
        fresh.state === IDEM.IDEMPOTENCY_STATE.FRESH && fresh.result.saved === true);
  check('and it is a NEW draft, not the deleted one', fresh.result.draftId !== cId);
  check('the row advanced to generation 2 is not claimed — it stays at 1 while live',
        await gen() === 1);
});

// ───────────────────────────────────────────────────────────────────────────
await section('and again after the TOMBSTONE expires, with the lifecycle record retained', async () => {

  reset();
  const t = await createOmitted('tomb-1');
  const tId = t.result.draftId;
  await SVC.deleteDraftOp(kv, SUB, tId, 1, K('tomb-del'));
  expireIdempotency();
  store.delete(`draft:${SUB}:${tId}`);           // the tombstone's own TTL fires
  check('the tombstone is gone', !store.has(`draft:${SUB}:${tId}`));
  check('the lifecycle record survives it', store.has(lcKey()) && await gen() === 1);

  const afterTomb = await caught(() => createOmitted('tomb-1'));
  check('🔴 omission is still refused once the tombstone has expired',
        afterTomb.threw && afterTomb.message === SVC.SERVICE_ERR.LIFECYCLE_STALE,
        'the lifecycle record, not the tombstone, is what outlives the retry');
  check('no draft was created', draftKeys().length === 0);
  check('and the wording rule holds: this row is not described as deleted by the seller',
        afterTomb.detail.lastState !== undefined);
});

// ───────────────────────────────────────────────────────────────────────────
await section('an invalid generation is rejected, never read as omission', async () => {

  reset();
  for (const [label, raw] of [
    ['an empty string', ''],
    ['a blank string', '   '],
    ['a word', 'abc'],
    ['true', true],
    ['false', false],
    ['an empty array', []],
    ['a negative number', -1],
    ['a fraction', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ]) {
    const r = await caught(() => SVC.createDraft(kv, SUB, { ...input(), instanceId: INST, slot: SLOT }, K(`inv-${label}`), { generation: raw }));
    check(`${label} is refused as an invalid field`,
          r.threw && r.message === 'DRAFT_FIELD_INVALID:generation:non-negative-integer',
          `Number('') , Number(true) and Number([]) are all coercible to a generation; ` +
          `treating any of them as "no claim" would hand a broken client the legacy path`);
  }
  check('nothing was created by any of the invalid attempts', draftKeys().length === 0);

  // The values that ARE legitimate.
  reset();
  const zeroExplicit = await createAt('valid-0', 0);
  check('an explicit 0 creates on an unrecorded row', zeroExplicit.result.saved === true);
  reset();
  const stringGen = await SVC.createDraft(kv, SUB, { ...input(), instanceId: INST, slot: SLOT }, K('valid-str'), { generation: '0' });
  check('a digit string is accepted (the wire carries strings)', stringGen.result.saved === true);

  // ── and at the HTTP boundary ──────────────────────────────────────────────
  reset();
  const call = async (body, key) => {
    const res = fakeRes();
    await EP.default(fakeReq({ method: 'POST', body, headers: {
      authorization: 'Bearer ' + 'x'.repeat(40), 'idempotency-key': K(key),
    } }), res);
    return { status: res.statusCode, body: res.body };
  };
  const httpBad = await call({ ...httpInput(), instanceId: INST, generation: 'abc' }, 'http-bad');
  check('the endpoint answers 400 for an invalid generation, not 410 or 201',
        httpBad.status === 400 && String(httpBad.body.code) === 'DRAFT_FIELD_INVALID');
  const httpOmitted = await call({ ...httpInput(), instanceId: INST }, 'http-omitted');
  check('the endpoint still accepts a create with no generation at all',
        httpOmitted.status === 201 || httpOmitted.status === 200,
        `status was ${httpOmitted.status}`);

  // The endpoint's 410, end to end, for a client that sends nothing.
  const httpId = httpOmitted.body && httpOmitted.body.draftId;
  const rev = httpOmitted.body && httpOmitted.body.draft ? httpOmitted.body.draft.rev : 1;
  await SVC.deleteDraftOp(kv, SUB, httpId, rev, K('http-del'));
  expireIdempotency();
  const httpStale = await call({ ...httpInput(), instanceId: INST }, 'http-omitted');
  check('🔴 the endpoint answers 410 to the resent omitted-generation create',
        httpStale.status === 410 && httpStale.body.code === SVC.SERVICE_ERR.LIFECYCLE_STALE);
  check('the body reports the omission explicitly',
        httpStale.body.generationOmitted === true && httpStale.body.sentGeneration === null);
  check('and does not invite an automatic retry', httpStale.body.retryable === false);
});

// ───────────────────────────────────────────────────────────────────────────
await section('compatibility is not a dead end: the legacy lost-response case still recovers', async () => {

  reset();
  const l1 = await createOmitted('lost');
  const l2 = await createOmitted('lost');                       // same key, still no generation
  check('a byte-identical retry with no generation replays',
        l2.result.draftId === l1.result.draftId && l2.replayed === true);
  check('and only one draft exists', draftKeys().length === 1);

  // A second tap that mints a NEW key, still with no generation, must open the
  // existing draft rather than create a second one for the row.
  const l3 = await createOmitted('lost-new-key');
  check('a new key with no generation opens the existing draft',
        l3.result.draftId === l1.result.draftId && l3.result.existing === true);
  check('still one draft', draftKeys().length === 1);
});

// ───────────────────────────────────────────────────────────────────────────
await section('incomplete legacy discovery stays fail-closed under omission', async () => {

  reset();
  const seedForScan = await createOmitted('failclosed-seed');
  store.delete(lcKey());                       // force the legacy-discovery path
  fail.commands = new Set(['smembers']);
  const closed = await caught(() => createOmitted('failclosed'));
  fail.commands = new Set();
  check('🔴 an unreadable index refuses rather than authorizing generation 0 as empty',
        closed.threw && closed.message === SVC.SERVICE_ERR.LIFECYCLE_UNRESOLVED,
        'answering "no draft here" from a failed read is how a duplicate draft gets created');
  check('and it is marked retryable', closed.detail.retryable === true);
  check('no second draft was written', draftKeys().length === 1);
  check('the pre-existing draft is untouched', store.has(`draft:${SUB}:${seedForScan.result.draftId}`));
});

done();
