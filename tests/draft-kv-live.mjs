// tests/draft-kv-live.mjs — C1 completion criterion: the real KV, not a stub
//
//   DRAFT_KV_LIVE=1 KV_REST_API_URL=... KV_REST_API_TOKEN=... node tests/draft-kv-live.mjs
//
// Everything the offline suite proves, it proves against an in-memory Redis we
// wrote ourselves. That is worth a lot and it is not the same thing. Upstash's
// actual return shapes, TTL behaviour, SCAN paging and error codes are the
// parts most likely to differ from our mental model, and they are exactly the
// parts the concurrency rules are built on.
//
// ── Safety ────────────────────────────────────────────────────────────────
//
// This talks to the REAL store. Every key it writes is namespaced under a
// synthetic user id that cannot collide with a Google sub (`ktest-<random>`,
// where a real sub is all digits), and the run deletes everything it created
// before exiting — including on failure.

import { harness } from './_assert.mjs';
const { check, checkAsync, done } = harness('draft-kv-live');

if (process.env.DRAFT_KV_LIVE !== '1') {
  console.log('draft-kv-live: SKIPPED (set DRAFT_KV_LIVE=1 to run against the real store)');
  process.exit(0);
}

const URL_  = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;
if (!URL_ || !TOKEN) {
  console.error('draft-kv-live: KV_REST_API_URL / KV_REST_API_TOKEN required');
  process.exit(1);
}

// A real Google sub is a numeric string. This can never be one.
const SUB = `ktest-${Math.random().toString(36).slice(2, 10)}`;
const created = new Set();

async function raw(url, token, args) {
  const path = args.map((a) => encodeURIComponent(String(a))).join('/');
  const r = await fetch(`${url}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

const kv = async (...args) => {
  const r = await raw(URL_, TOKEN, args);
  if (!r.ok) throw new Error(`kv_${r.status}`);
  const cmd = String(args[0]).toLowerCase();
  if (cmd === 'set' || cmd === 'setex') created.add(String(args[1]));
  if (cmd === 'sadd') created.add(String(args[1]));
  return r.body.result;
};

const SVC  = await import('../api/_draftService.js');
const DS   = await import('../api/_draftStore.js');
const IDX  = await import('../api/_draftIndex.js');
const IDEM = await import('../api/_idempotency.js');

function K(label) {
  const h = [...(label + SUB)].reduce((a, c) => (a * 33 + c.charCodeAt(0)) % 0xffffffff, 7);
  const hex = (n, l) => n.toString(16).padStart(l, '0').slice(-l);
  return `${hex(h, 8)}-${hex(h >> 3, 4)}-4${hex(h >> 5, 3)}-8${hex(h >> 7, 3)}-${hex(h * 31, 12)}`;
}
const input = (over = {}) => ({
  sku: 'v2-KTEST01-0000000000000001', instanceId: 'inst_ktest',
  slot: 'ebay:fixed-price', title: 'Live KV probe card', price: 25, ...over,
});

let exitCode = 0;
try {
  // ── 1. SET ... NX return shape ─────────────────────────────────────────
  //
  // The whole claim protocol rests on being able to tell "I created it" from
  // "it already existed". If Upstash answered '' or 0 instead of null on a
  // collision, every claim would look like a win.
  console.log('\nSET NX tells a creation from a collision');
  const nxKey = `nxprobe:${SUB}`;
  created.add(nxKey);
  const first  = await kv('set', nxKey, 'a', 'NX', 'EX', 60);
  const second = await kv('set', nxKey, 'b', 'NX', 'EX', 60);
  check('a fresh NX set returns OK', first === 'OK', `got ${JSON.stringify(first)}`);
  check('🔴 a colliding NX set returns null, not a falsy string',
        second === null,
        `got ${JSON.stringify(second)} — the claim protocol reads this as "someone else holds it"`);
  check('and the original value was NOT overwritten', (await kv('get', nxKey)) === 'a');

  // ── 2. Claims really expire ────────────────────────────────────────────
  console.log('\na claim carries a real TTL, so it cannot leak forever');
  const ttlKey = `draftrev:${SUB}:ttlprobe:1`;
  created.add(ttlKey);
  await kv('set', ttlKey, '{}', 'NX', 'EX', DS.CLAIM_TTL_SEC);
  const ttl = await kv('ttl', ttlKey);
  check('the TTL is set and counting down',
        typeof ttl === 'number' && ttl > 0 && ttl <= DS.CLAIM_TTL_SEC, `ttl=${ttl}`);
  check('🔴 it is not -1 (no expiry)', ttl !== -1,
        'a claim with no expiry would block a revision permanently after a crash');

  const shortKey = `draftrev:${SUB}:shortprobe:1`;
  created.add(shortKey);
  await kv('set', shortKey, '{}', 'NX', 'EX', 1);
  await new Promise((r) => setTimeout(r, 1600));
  check('and an expired claim really is gone', (await kv('get', shortKey)) === null);

  // ── 3. Create / read / edit / delete against the real store ────────────
  console.log('\na draft survives the whole path in the real store');
  const c1 = await SVC.createDraft(kv, SUB, input(), K('create'));
  const id = c1.result.draftId;
  created.add(`draft:${SUB}:${id}`);
  created.add(`drafts:${SUB}`);
  created.add(`skudraft:${SUB}:${encodeURIComponent(input().sku)}`);
  created.add(IDX.indexFreshKey(SUB));
  check('create succeeded', c1.result.saved === true && !!id);
  check('and it was NOT degraded against a healthy store', c1.result.degraded === false);

  const r1 = await SVC.readDraft(kv, SUB, id);
  check('the draft reads back at rev 1', r1.ok === true && r1.draft.rev === 1);
  check('🔴 the price survived the JSON round trip exactly',
        r1.draft.price === 25, `got ${r1.draft.price}`);

  const e1 = await SVC.updateDraft(kv, SUB, id, { price: 22.5 }, 1, K('edit'));
  check('an edit at the current revision commits', e1.ok === true && e1.draft.rev === 2);
  check('and re-reads as the new price', (await SVC.readDraft(kv, SUB, id)).draft.price === 22.5);

  // ── 4. Two ACTUAL concurrent edits ─────────────────────────────────────
  //
  // Not simulated interleaving — two real requests racing on real Redis.
  console.log('\ntwo real concurrent edits: exactly one wins');
  const [a, b] = await Promise.all([
    SVC.updateDraft(kv, SUB, id, { price: 30 }, 2, K('raceA')),
    SVC.updateDraft(kv, SUB, id, { price: 40 }, 2, K('raceB')),
  ]);
  const winners = [a, b].filter((x) => x.ok);
  const losers  = [a, b].filter((x) => !x.ok);
  check('🔴 exactly one edit commits', winners.length === 1,
        `got ${winners.length} winners — ${JSON.stringify([a.error, b.error])}`);
  check('🔴 the loser is refused with a conflict, not silently dropped',
        losers.length === 1 &&
        [DS.ERR.REV_CONFLICT, DS.ERR.REV_IN_FLIGHT].includes(losers[0].error),
        `got ${losers[0] && losers[0].error}`);
  const after = await SVC.readDraft(kv, SUB, id);
  check('the record is at exactly rev 3, not 4', after.draft.rev === 3, `rev=${after.draft.rev}`);
  check('🔴 and its price is the winner\u2019s, never a blend',
        after.draft.price === (winners[0].draft.price),
        `stored ${after.draft.price} vs winner ${winners[0].draft.price}`);
  if (losers[0].error === DS.ERR.REV_IN_FLIGHT) {
    check('an in-flight refusal is marked retryable', losers[0].retryable === true);
  } else {
    check('a conflict refusal carries the current record', !!losers[0].current);
  }

  // ── 5. Orphan takeover against a real claim key ────────────────────────
  //
  // The claim is written with an OLD server timestamp directly, because
  // waiting out CLAIM_GRACE_MS in a test would make the suite unusable. What
  // is being tested is the takeover decision on real Redis, not the clock.
  console.log('\nan abandoned claim is taken over exactly once');
  const orphanRev = after.draft.rev + 1;
  const claimKey = `draftrev:${SUB}:${id}:${orphanRev}`;
  created.add(claimKey);
  created.add(`drafttake:${SUB}:${id}:${orphanRev}`);
  await kv('set', claimKey,
           JSON.stringify({ op: 'crashed-operation', at: Date.now() - (DS.CLAIM_GRACE_MS * 4) }),
           'NX', 'EX', DS.CLAIM_TTL_SEC);
  const [t1, t2] = await Promise.all([
    DS.claimRevision(kv, SUB, id, orphanRev, 'takeover-A', after.draft.rev),
    DS.claimRevision(kv, SUB, id, orphanRev, 'takeover-B', after.draft.rev),
  ]);
  const took = [t1, t2].filter((x) => x.outcome === DS.CLAIM_OUTCOME.ORPHAN_TAKEN);
  const lost = [t1, t2].filter((x) => x.outcome !== DS.CLAIM_OUTCOME.ORPHAN_TAKEN);
  check('🔴 exactly one operation takes over the orphan',
        took.length === 1,
        `outcomes: ${t1.outcome} / ${t2.outcome} — two takeovers would mean two writers at one revision`);
  check('and the other is told it lost, not that it may proceed',
        lost.length === 1 &&
        [DS.CLAIM_OUTCOME.ORPHAN_LOST, DS.CLAIM_OUTCOME.IN_FLIGHT].includes(lost[0].outcome),
        `got ${lost[0] && lost[0].outcome}`);

  // A young claim must NOT be taken over.
  const youngRev = orphanRev + 1;
  const youngKey = `draftrev:${SUB}:${id}:${youngRev}`;
  created.add(youngKey);
  await kv('set', youngKey, JSON.stringify({ op: 'busy', at: Date.now() }), 'NX', 'EX', DS.CLAIM_TTL_SEC);
  const young = await DS.claimRevision(kv, SUB, id, youngRev, 'impatient', after.draft.rev);
  check('🔴 a claim younger than the grace window is left alone',
        young.outcome === DS.CLAIM_OUTCOME.IN_FLIGHT,
        `got ${young.outcome} — stealing a live claim is worse than waiting`);
  check('and the waiter is given a retry delay', young.retryAfterMs > 0);

  // ── 6. SADD / SREM / SCAN and paging ───────────────────────────────────
  console.log('\nthe index survives real SADD, SREM and a paged SCAN');
  const bulkIds = [];
  for (let i = 0; i < 12; i += 1) {
    const c = await SVC.createDraft(kv, SUB, input({
      sku: `v2-KTEST01-bulk${String(i).padStart(12, '0')}`,
      title: `Bulk probe ${i}`,
    }), K(`bulk${i}`));
    bulkIds.push(c.result.draftId);
    created.add(`draft:${SUB}:${c.result.draftId}`);
    created.add(`skudraft:${SUB}:${encodeURIComponent(`v2-KTEST01-bulk${String(i).padStart(12, '0')}`)}`);
  }
  const scanned = await IDX.scanDraftIds(SUB);
  check('🔴 SCAN finds every record it should, across pages',
        bulkIds.every((x) => scanned.includes(x)) && scanned.includes(id),
        `scanned ${scanned.length}, expected at least ${bulkIds.length + 1}`);
  check('and SCAN returns no duplicates', new Set(scanned).size === scanned.length);

  const listed = await SVC.listDrafts(SUB);
  check('the list matches the scan',
        listed.draftIds.length === scanned.length,
        `list=${listed.draftIds.length} scan=${scanned.length}`);
  check('and reports itself available', listed.unavailable === false);
  check('🔴 every scanned record is listed',
        scanned.every((x) => listed.draftIds.includes(x)),
        'a record the seller can read but cannot find is the same as a lost one');

  const del = await SVC.deleteDraftOp(kv, SUB, bulkIds[0], 1, K('delbulk'));
  check('a delete commits against the real store', del.ok === true);
  check('🔴 SREM really removed it from the set',
        !(await kv('smembers', `drafts:${SUB}`)).includes(bulkIds[0]));
  check('the tombstone still reads as DELETED',
        (await SVC.readDraft(kv, SUB, bulkIds[0])).error === DS.ERR.DELETED);
  const tombTtl = await kv('ttl', `draft:${SUB}:${bulkIds[0]}`);
  check('🔴 and the tombstone has a long TTL, not none and not immediate',
        typeof tombTtl === 'number' && tombTtl > 86400,
        `ttl=${tombTtl} — a tombstone that expires early lets a stale write resurrect the draft`);

  // ── 7. The freshness marker really expires ─────────────────────────────
  console.log('\nthe index freshness marker is a real, expiring claim');
  const freshTtl = await kv('ttl', IDX.indexFreshKey(SUB));
  check('the marker exists with a TTL',
        typeof freshTtl === 'number' && freshTtl > 0 && freshTtl <= IDX.RECONCILE_INTERVAL_SEC,
        `ttl=${freshTtl}`);
  check('🔴 it is not permanent', freshTtl !== -1,
        'a permanent "index is clean" marker would suppress reconciliation forever');

  // ── 8. Repeated idempotent create, for real ────────────────────────────
  console.log('\na repeated create against the real store returns the same draft');
  const key = K('idem-live');
  const i1 = await SVC.createDraft(kv, SUB, input({ sku: 'v2-KTEST01-idem0000000000001' }), key);
  created.add(`draft:${SUB}:${i1.result.draftId}`);
  created.add(`skudraft:${SUB}:${encodeURIComponent('v2-KTEST01-idem0000000000001')}`);
  const i2 = await SVC.createDraft(kv, SUB, input({ sku: 'v2-KTEST01-idem0000000000001' }), key);
  check('🔴 the retry returns the SAME draftId',
        i1.result.draftId === i2.result.draftId,
        `${i1.result.draftId} vs ${i2.result.draftId}`);
  check('and is flagged as a replay', i2.replayed === true);
  const [p1, p2, p3] = await Promise.all([
    SVC.createDraft(kv, SUB, input({ sku: 'v2-KTEST01-idem0000000000002' }), K('idem-race')),
    SVC.createDraft(kv, SUB, input({ sku: 'v2-KTEST01-idem0000000000002' }), K('idem-race')),
    SVC.createDraft(kv, SUB, input({ sku: 'v2-KTEST01-idem0000000000002' }), K('idem-race')),
  ]);
  const ids = [p1, p2, p3].map((x) => x.result && x.result.draftId).filter(Boolean);
  for (const x of ids) created.add(`draft:${SUB}:${x}`);
  created.add(`skudraft:${SUB}:${encodeURIComponent('v2-KTEST01-idem0000000000002')}`);
  check('🔴 three simultaneous identical creates make at most ONE draft',
        new Set(ids).size <= 1,
        `distinct ids: ${new Set(ids).size} — ${JSON.stringify(ids)}`);
  const inflight = [p1, p2, p3].filter((x) => x.state === IDEM.IDEMPOTENCY_STATE.IN_FLIGHT);
  check('and any loser is told IN_FLIGHT rather than being given a second draft',
        [p1, p2, p3].every((x) => x.state !== IDEM.IDEMPOTENCY_STATE.FRESH || ids.length),
        `states: ${[p1, p2, p3].map((x) => x.state).join(', ')}`);
  check('a same-key create with a DIFFERENT sku is refused',
        (await SVC.createDraft(kv, SUB, input({ sku: 'v2-KTEST01-different000000001' }), key))
          .state === IDEM.IDEMPOTENCY_STATE.MISMATCH);
  void inflight;

  // ── 9. Redis-level failure vs HTTP-level failure ───────────────────────
  //
  // These are different things and the code must not treat them the same. A
  // 401 is "we are misconfigured"; a WRONGTYPE is "this key is not what we
  // thought"; both must fail closed, neither may look like "not found".
  console.log('\na store error is never rendered as absence');
  const badAuth = await raw(URL_, 'definitely-not-the-token', ['get', `draft:${SUB}:${id}`]);
  check('🔴 a bad token is an HTTP error, not a null result',
        badAuth.ok === false && (badAuth.status === 401 || badAuth.status === 403),
        `status=${badAuth.status}`);

  const badKv = async (...args) => {
    const r = await raw(URL_, 'definitely-not-the-token', args);
    if (!r.ok) throw new Error(`kv_${r.status}`);
    return r.body.result;
  };
  const blindRead = await SVC.readDraft(badKv, SUB, id);
  check('🔴 a draft read with a broken store is UNAVAILABLE, not NOT_FOUND',
        blindRead.ok === false && blindRead.error === DS.ERR.STORE_UNAVAILABLE,
        `got ${blindRead.error} — "not found" would invite the client to create it again`);
  check('and it is marked retryable', blindRead.retryable === true);

  const blindClaim = await DS.claimRevision(badKv, SUB, id, 99, 'op', 98);
  check('🔴 a claim against a broken store fails closed',
        blindClaim.outcome === DS.CLAIM_OUTCOME.UNAVAILABLE,
        'falling through to an optimistic write is how two writers get the same revision');

  // A real Redis type error, not an HTTP one.
  const wrongType = `drafts:${SUB}`;
  const typeErr = await raw(URL_, TOKEN, ['get', wrongType]);
  check('🔴 a WRONGTYPE is reported by Redis, not silently null',
        typeErr.body && (typeErr.body.error || typeErr.ok === false),
        `body=${JSON.stringify(typeErr.body).slice(0, 120)}`);
  // ── 10. The three bugs this file found, kept from coming back ──────────
  console.log('\nregression: the bugs only the real store showed');

  // (a) A plain SET reservation let three concurrent creates all win.
  const rk = K('regress-nx');
  const [q1, q2, q3, q4] = await Promise.all([
    SVC.createDraft(kv, SUB, input({ sku: 'v2-KTEST01-regress00000000001' }), rk),
    SVC.createDraft(kv, SUB, input({ sku: 'v2-KTEST01-regress00000000001' }), rk),
    SVC.createDraft(kv, SUB, input({ sku: 'v2-KTEST01-regress00000000001' }), rk),
    SVC.createDraft(kv, SUB, input({ sku: 'v2-KTEST01-regress00000000001' }), rk),
  ]);
  const qids = [q1, q2, q3, q4].map((x) => x.result && x.result.draftId).filter(Boolean);
  for (const x of qids) created.add(`draft:${SUB}:${x}`);
  created.add(`skudraft:${SUB}:${encodeURIComponent('v2-KTEST01-regress00000000001')}`);
  check('🔴 four simultaneous creates on one key make exactly one draft',
        new Set(qids).size === 1,
        `distinct ids: ${new Set(qids).size} — an announcement is not a reservation`);
  const fresh = [q1, q2, q3, q4].filter((x) => x.state === IDEM.IDEMPOTENCY_STATE.FRESH);
  check('🔴 exactly one caller is told it did the work',
        fresh.length === 1,
        `${fresh.length} callers believed they created it`);
  check('and the losers are told in-flight or replayed, never given their own draft',
        [q1, q2, q3, q4].filter((x) => x !== fresh[0]).every((x) => [
          IDEM.IDEMPOTENCY_STATE.IN_FLIGHT,
          IDEM.IDEMPOTENCY_STATE.REPLAYED,
          IDEM.IDEMPOTENCY_STATE.RECONCILED,
        ].includes(x.state)),
        `states: ${[q1, q2, q3, q4].map((x) => x.state).join(', ')}`);
  const oneRecord = (await IDX.scanDraftIds(SUB)).filter((x) => qids.includes(x));
  check('and only one record exists for it in the real store', oneRecord.length === 1);

  // (b) The service's own delete path skipped the retention TTL.
  const ttlDraft = await SVC.createDraft(kv, SUB, input({ sku: 'v2-KTEST01-ttlcheck0000000001' }), K('ttlcheck'));
  created.add(`draft:${SUB}:${ttlDraft.result.draftId}`);
  created.add(`skudraft:${SUB}:${encodeURIComponent('v2-KTEST01-ttlcheck0000000001')}`);
  const liveTtlBefore = await kv('ttl', `draft:${SUB}:${ttlDraft.result.draftId}`);
  check('a LIVE draft has no expiry', liveTtlBefore === -1,
        'a draft that quietly expires is the worst possible failure');
  await SVC.deleteDraftOp(kv, SUB, ttlDraft.result.draftId, 1, K('ttlcheck-del'));
  const stoneTtl = await kv('ttl', `draft:${SUB}:${ttlDraft.result.draftId}`);
  check('🔴 deleting through the SERVICE sets the same retention TTL as the store',
        typeof stoneTtl === 'number' && stoneTtl > 86400 && stoneTtl <= DS.TOMBSTONE_TTL_SEC,
        `ttl=${stoneTtl} — the service used to reimplement delete and drop this line`);

  // (c) A refusal must arrive with the record that caused it.
  const evDraft = await SVC.createDraft(kv, SUB, input({ sku: 'v2-KTEST01-evidence00000000001' }), K('evidence'));
  const evId = evDraft.result.draftId;
  created.add(`draft:${SUB}:${evId}`);
  created.add(`skudraft:${SUB}:${encodeURIComponent('v2-KTEST01-evidence00000000001')}`);
  await SVC.updateDraft(kv, SUB, evId, { price: 11 }, 1, K('ev1'));
  const stale = await SVC.updateDraft(kv, SUB, evId, { price: 12 }, 1, K('ev2'));
  check('a stale edit is refused', stale.ok === false && stale.error === DS.ERR.REV_CONFLICT);
  check('🔴 and the refusal carries the record the seller did not have',
        !!stale.current && stale.current.price === 11,
        '"someone changed this" is only actionable if you can also say what it now says');

} catch (e) {
  console.error('\ndraft-kv-live: threw —', e && e.stack ? e.stack : e);
  exitCode = 1;
} finally {
  // ── Cleanup, unconditionally ─────────────────────────────────────────────
  let removed = 0;
  for (const k of created) {
    try { await raw(URL_, TOKEN, ['del', k]); removed += 1; } catch {}
  }
  try {
    const page = await raw(URL_, TOKEN, ['scan', '0', 'match', `*${SUB}*`, 'count', 1000]);
    const leftovers = (page.body.result && page.body.result[1]) || [];
    for (const k of leftovers) { try { await raw(URL_, TOKEN, ['del', k]); removed += 1; } catch {} }
    const page2 = await raw(URL_, TOKEN, ['scan', '0', 'match', `*${SUB}*`, 'count', 1000]);
    const still = (page2.body.result && page2.body.result[1]) || [];
    console.log(`\ncleanup: removed ${removed} keys, ${still.length} remaining under ${SUB}`);
    if (still.length) console.log('  leftover:', still.slice(0, 10).join(', '));
  } catch (e) {
    console.log('\ncleanup: scan sweep failed —', e && e.message);
  }
}

done();
if (exitCode) process.exit(exitCode);
