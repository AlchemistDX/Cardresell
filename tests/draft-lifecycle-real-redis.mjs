// tests/draft-lifecycle-real-redis.mjs — the three Lua scripts, on a real Redis
//
// WHAT THIS CLOSES. `tests/draft-lifecycle.mjs` drives the real module but
// against an in-memory kv that interprets `eval` by pattern-matching the three
// scripts (tests/_kvScripts.mjs). That double is honest about being one, and it
// leaves a real gap: nothing in this repo had ever executed the actual Lua
// source under an actual Lua interpreter inside an actual Redis. Atomicity,
// `tonumber` on a Redis bulk-string reply, `KEYS`/`ARGV` arity, the integer
// reply types, and the behaviour of a key that Redis itself expired were all
// asserted by a substitute.
//
// So this suite runs the SAME exported constants and the SAME exported
// functions — ACQUIRE_SCRIPT, FENCED_SET_SCRIPT, and the unexported
// UNLOCK_SCRIPT reached through releaseLifecycleLock — against redis-server,
// and asserts the STORED STATE after each script as well as its return value.
// A return value alone cannot distinguish "refused" from "refused and also
// corrupted the row".
//
// WHAT IT DOES NOT CLOSE, stated so a pass here is not over-read:
//   • Upstash compatibility. Production speaks Upstash's REST endpoint
//     (api/_kv.js:19-27, one HTTP GET per command, result under `j.result`).
//     This suite speaks RESP to a self-hosted redis-server. Upstash's EVAL
//     support and its reply encoding are NOT verified here.
//   • Deployed behaviour. Nothing here touches Preview or Production.
//
// Lock expiry is produced by REDIS, not by a clock the test controls: the test
// shortens the real TTL with PEXPIRE and waits for the server to drop the key.
// LOCK_TTL_SEC is 15s and waiting it out would make the suite unusable, but the
// expiry itself is the server's.

import { completionGuard } from './_complete.mjs';
const { finish: _finish } = completionGuard('draft-lifecycle-real-redis');

import { createClient } from 'redis';
import { execFileSync } from 'node:child_process';
import {
  LOCK_TTL_SEC, LIFECYCLE_ERR,
  ACQUIRE_SCRIPT, FENCED_SET_SCRIPT,
  lifecycleLockKey, lifecycleFenceKey,
  acquireLifecycleLock, releaseLifecycleLock, fencedSet,
} from '../api/_draftLifecycle.js';

const PORT = Number(process.env.CR_REDIS_PORT || 6399);
const SUB = 'redis-sub';
const SLOT = 'slot-a';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond && typeof cond.then === 'function') {
    failed++;
    console.log(`  FAIL ${name}\n       → TEST_API_MISUSE: a Promise is not a truth value; await it`);
    return;
  }
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `\n       → ${detail}` : ''}`); }
}
function section(t) { console.log(`\n── ${t}`); }

// ── The kv adapter ─────────────────────────────────────────────────────────
//
// Same call surface as the production caller in api/_kv.js: a variadic
// function taking (command, ...args) and returning the command's result. The
// production one encodes the args into a URL path and reads `j.result`; this
// one sends them as a RESP command. That difference is the residual named at
// the top of this file, and it is the reason this adapter is deliberately thin
// — it must not normalise anything the script's reply carries, because reply
// shape is part of what is under test.
function makeRealKv(client) {
  return async function kv(...args) {
    return client.sendCommand(args.map((a) => String(a)));
  };
}

let client;
try {
  client = createClient({ url: `redis://127.0.0.1:${PORT}` });
  client.on('error', () => {});
  await client.connect();
} catch (e) {
  console.log(`  FAIL cannot reach redis-server on 127.0.0.1:${PORT}\n       → ${e && e.message}`);
  _finish(0, 1);
}

const kv = makeRealKv(client);

// Provenance, recorded in the output rather than in prose: a reader of this log
// must be able to tell WHICH code and WHICH server produced the result.
const serverInfo = await client.sendCommand(['INFO', 'server']);
const redisVersion = /redis_version:([^\r\n]+)/.exec(String(serverInfo))?.[1] || 'unknown';
const luaVersion = String(await client.sendCommand(['EVAL', 'return _VERSION', '0']));
let commit = 'unknown', dirty = '';
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('..', import.meta.url).pathname })
    .toString().trim();
  const st = execFileSync('git', ['status', '--porcelain', 'api/_draftLifecycle.js'],
    { cwd: new URL('..', import.meta.url).pathname }).toString().trim();
  dirty = st ? ' (api/_draftLifecycle.js MODIFIED vs commit)' : '';
} catch { /* provenance is reported, not asserted */ }

console.log(`  UNDER TEST: commit ${commit}${dirty}`);
console.log(`  SERVER:     redis-server ${redisVersion}, ${luaVersion}, RESP via node-redis, port ${PORT}`);
console.log(`  SCRIPTS:    ACQUIRE_SCRIPT, FENCED_SET_SCRIPT (exported), UNLOCK_SCRIPT (via releaseLifecycleLock)`);
console.log(`  LOCK_TTL_SEC from the module: ${LOCK_TTL_SEC}`);

// Each section gets its own instance id, so a leaked key cannot make a later
// section pass. Nothing is shared between sections but the connection.
let instN = 0;
async function freshInstance() {
  const inst = `inst-${++instN}-${Date.now()}`;
  await client.sendCommand(['DEL', lifecycleLockKey(SUB, inst, SLOT), lifecycleFenceKey(SUB, inst, SLOT)]);
  return inst;
}
const get = (k) => client.sendCommand(['GET', k]);
const ttl = (k) => client.sendCommand(['PTTL', k]);
const exists = (k) => client.sendCommand(['EXISTS', k]);

// ── 0. The scripts really are the module's, and Redis really runs them ─────
section('0. the source under test');
{
  check('ACQUIRE_SCRIPT is the module constant, not a copy in this file',
    ACQUIRE_SCRIPT.includes("redis.call('incr',KEYS[2])")
    && ACQUIRE_SCRIPT.includes("redis.call('exists',KEYS[1])==1"),
    ACQUIRE_SCRIPT);
  check('FENCED_SET_SCRIPT is the module constant',
    FENCED_SET_SCRIPT.includes("tonumber(cur)>tonumber(ARGV[1])")
    && FENCED_SET_SCRIPT.includes("redis.call('set',KEYS[2],ARGV[2])"),
    FENCED_SET_SCRIPT);
  // If Redis rejected the Lua, every later assertion would fail for the wrong
  // reason. Load them by hand once so a syntax error is reported as one.
  const sha1 = await client.sendCommand(['SCRIPT', 'LOAD', ACQUIRE_SCRIPT]);
  const sha2 = await client.sendCommand(['SCRIPT', 'LOAD', FENCED_SET_SCRIPT]);
  check('redis-server compiles ACQUIRE_SCRIPT', typeof sha1 === 'string' && sha1.length === 40, String(sha1));
  check('redis-server compiles FENCED_SET_SCRIPT', typeof sha2 === 'string' && sha2.length === 40, String(sha2));
}

// ── 1. Acquisition contention ──────────────────────────────────────────────
section('1. acquisition contention');
{
  const inst = await freshInstance();
  const lk = lifecycleLockKey(SUB, inst, SLOT);
  const fk = lifecycleFenceKey(SUB, inst, SLOT);

  const a = await acquireLifecycleLock(kv, SUB, inst, SLOT);
  check('first acquisition succeeds', a.ok === true, JSON.stringify(a));
  check('it allocates fence 1 on a fresh row', a.fence === 1, JSON.stringify(a));

  // STORED STATE, not just the reply: the lock value must carry nonce:fence,
  // because release compares the exact acquisition and a nonce-only value
  // would let a later acquisition by the same caller free an earlier one.
  const stored = String(await get(lk));
  check('the lock key stores nonce:fence', stored === a.token, `${stored} vs token ${a.token}`);
  check('the stored value ends in the allocated fence', stored.endsWith(`:${a.fence}`), stored);
  check('the fence counter holds 1', String(await get(fk)) === '1', String(await get(fk)));

  const t = Number(await ttl(lk));
  check('Redis set a TTL from the module constant',
    t > (LOCK_TTL_SEC - 2) * 1000 && t <= LOCK_TTL_SEC * 1000, `PTTL=${t}`);

  const b = await acquireLifecycleLock(kv, SUB, inst, SLOT);
  check('a second caller is refused while the lock is held', b.ok === false, JSON.stringify(b));
  check('refusal is BUSY', b.error === LIFECYCLE_ERR.BUSY, JSON.stringify(b));
  check('refusal is retryable', b.retryable === true, JSON.stringify(b));

  // THE ATOMICITY CLAIM. The refused caller must not have consumed a fence:
  // the incr sits after the exists guard inside one script, so a refusal
  // cannot burn a number. If these two commands were separate, the refused
  // caller would still have incremented.
  check('the refused caller allocated no fence — counter still 1',
    String(await get(fk)) === '1', String(await get(fk)));
  check('the refused caller did not overwrite the lock value',
    String(await get(lk)) === a.token, String(await get(lk)));

  // Many simultaneous callers: exactly one wins, and the counter moves by
  // exactly one. Run through the real function, in parallel, on one row.
  const inst2 = await freshInstance();
  const fk2 = lifecycleFenceKey(SUB, inst2, SLOT);
  const results = await Promise.all(
    Array.from({ length: 12 }, () => acquireLifecycleLock(kv, SUB, inst2, SLOT)),
  );
  const winners = results.filter((r) => r.ok);
  check('12 simultaneous acquisitions produce exactly one winner',
    winners.length === 1, JSON.stringify(results.map((r) => (r.ok ? r.fence : r.error))));
  check('every loser is BUSY',
    results.filter((r) => !r.ok).every((r) => r.error === LIFECYCLE_ERR.BUSY), 'a loser reported something else');
  check('11 refusals consumed no fences — counter is 1, not 12',
    String(await get(fk2)) === '1', String(await get(fk2)));
  check('the stored lock belongs to the winner',
    String(await get(lifecycleLockKey(SUB, inst2, SLOT))) === winners[0].token, 'stored lock is not the winner token');
}

// ── 2. Expiry and takeover ─────────────────────────────────────────────────
section('2. lock expiry and takeover');
{
  const inst = await freshInstance();
  const lk = lifecycleLockKey(SUB, inst, SLOT);
  const fk = lifecycleFenceKey(SUB, inst, SLOT);

  const first = await acquireLifecycleLock(kv, SUB, inst, SLOT);
  check('owner A holds the lock with fence 1', first.ok && first.fence === 1, JSON.stringify(first));

  // Redis expires the key. The test only shortens the TTL; it does not delete
  // the key and does not fake a clock.
  await client.sendCommand(['PEXPIRE', lk, '40']);
  const deadline = Date.now() + 3000;
  while (Number(await exists(lk)) === 1 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
  check('redis-server expired the lock key on its own', Number(await exists(lk)) === 0, 'key still present');
  check('expiry did not touch the fence counter', String(await get(fk)) === '1', String(await get(fk)));

  const second = await acquireLifecycleLock(kv, SUB, inst, SLOT);
  check('owner B can take over once the lock has lapsed', second.ok === true, JSON.stringify(second));

  // THE FENCING INVARIANT: a later owner always holds a strictly higher fence.
  // This is why the incr lives inside the acquisition script.
  check('the takeover fence is strictly higher than A\'s',
    second.fence > first.fence, `A=${first.fence} B=${second.fence}`);
  check('the takeover fence is exactly 2', second.fence === 2, String(second.fence));
  check('the counter records the second allocation', String(await get(fk)) === '2', String(await get(fk)));
  check('the lock now stores B\'s token', String(await get(lk)) === second.token, String(await get(lk)));
  check('A\'s token is no longer the stored value', String(await get(lk)) !== first.token, 'A token still stored');
}

// ── 3. The expired owner's writes are refused ──────────────────────────────
section('3. refusal of the expired owner\'s writes');
{
  const inst = await freshInstance();
  const lk = lifecycleLockKey(SUB, inst, SLOT);
  const fk = lifecycleFenceKey(SUB, inst, SLOT);
  const row = `draft:${inst}:row`;

  const A = await acquireLifecycleLock(kv, SUB, inst, SLOT);
  // A writes while it legitimately holds the row.
  const w1 = await fencedSet(kv, SUB, inst, SLOT, A.fence, row, 'written-by-A');
  check('the current owner\'s write is accepted', w1.ok === true, JSON.stringify(w1));
  check('and the value is actually stored', String(await get(row)) === 'written-by-A', String(await get(row)));

  // A loses the row: Redis expires its lock, B takes over.
  await client.sendCommand(['PEXPIRE', lk, '40']);
  const deadline = Date.now() + 3000;
  while (Number(await exists(lk)) === 1 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
  const B = await acquireLifecycleLock(kv, SUB, inst, SLOT);
  check('B holds a higher fence than A', B.ok && B.fence > A.fence, `A=${A.fence} B=${B.fence}`);

  // A resumes, unaware. This is the exact scenario the fence exists for: A
  // still believes it owns the row and issues its write.
  const w2 = await fencedSet(kv, SUB, inst, SLOT, A.fence, row, 'written-by-STALE-A');
  check('the stale owner\'s write is refused', w2.ok === false, JSON.stringify(w2));
  check('refusal is FENCED', w2.error === LIFECYCLE_ERR.FENCED, JSON.stringify(w2));
  check('the refusal reports the fence the caller held', w2.mine === A.fence, JSON.stringify(w2));

  // STORED STATE — the assertion that a return value cannot make. A refused
  // write must leave the row exactly as it was.
  check('the row is unchanged by the refused write',
    String(await get(row)) === 'written-by-A', String(await get(row)));
  check('the refused write did not disturb the fence counter',
    String(await get(fk)) === String(B.fence), String(await get(fk)));
  check('the refused write did not touch B\'s lock',
    String(await get(lk)) === B.token, String(await get(lk)));

  // B's write, with the current fence, goes through.
  const w3 = await fencedSet(kv, SUB, inst, SLOT, B.fence, row, 'written-by-B');
  check('the new owner\'s write is accepted', w3.ok === true, JSON.stringify(w3));
  check('and it replaced the value', String(await get(row)) === 'written-by-B', String(await get(row)));

  // A equal fence is not a stale fence: the guard is strictly-greater, so the
  // holder of the current fence keeps writing. An off-by-one here would lock
  // the current owner out of its own row.
  const w4 = await fencedSet(kv, SUB, inst, SLOT, B.fence, row, 'written-by-B-again');
  check('the current fence is not treated as stale (guard is strictly greater)',
    w4.ok === true, JSON.stringify(w4));
  check('the second same-fence write also stored',
    String(await get(row)) === 'written-by-B-again', String(await get(row)));

  // A fence lower than current by more than one is still refused, and a
  // non-integer fence never reaches Redis at all.
  const w5 = await fencedSet(kv, SUB, inst, SLOT, 1, row, 'written-by-ancient');
  check('an ancient fence is refused too', w5.ok === false && w5.error === LIFECYCLE_ERR.FENCED, JSON.stringify(w5));
  check('the ancient write left the row alone',
    String(await get(row)) === 'written-by-B-again', String(await get(row)));
  const w6 = await fencedSet(kv, SUB, inst, SLOT, undefined, row, 'no-fence');
  check('a missing fence is refused before the script runs',
    w6.ok === false && w6.reason === 'no-fence', JSON.stringify(w6));
  check('the no-fence write left the row alone',
    String(await get(row)) === 'written-by-B-again', String(await get(row)));

  // The first write on a row whose counter has never been incremented: `cur`
  // is a Lua false, so the guard must fall through rather than error on
  // tonumber(false). This is a real Lua behaviour the in-memory double could
  // only imitate.
  const virgin = await freshInstance();
  const vrow = `draft:${virgin}:row`;
  const w7 = await fencedSet(kv, SUB, virgin, SLOT, 1, vrow, 'first-ever');
  check('a write against an unallocated counter is accepted, not an error',
    w7.ok === true, JSON.stringify(w7));
  check('and it stored', String(await get(vrow)) === 'first-ever', String(await get(vrow)));
}

// ── 4. Ownership-checked release ───────────────────────────────────────────
section('4. ownership-checked release');
{
  const inst = await freshInstance();
  const lk = lifecycleLockKey(SUB, inst, SLOT);

  const A = await acquireLifecycleLock(kv, SUB, inst, SLOT);
  const wrong = await releaseLifecycleLock(kv, SUB, inst, SLOT, `${A.token}-not-mine`);
  check('releasing with a wrong token returns 0', Number(wrong) === 0, String(wrong));
  check('and the lock is still held', String(await get(lk)) === A.token, String(await get(lk)));

  // The nonce-only case: release must compare the whole nonce:fence value. A
  // release keyed on the nonce alone would free a lock this caller no longer
  // holds after a takeover.
  const nonceOnly = A.token.slice(0, A.token.lastIndexOf(':'));
  const partial = await releaseLifecycleLock(kv, SUB, inst, SLOT, nonceOnly);
  check('releasing with the nonce but no fence returns 0', Number(partial) === 0, String(partial));
  check('and the lock survives that too', String(await get(lk)) === A.token, String(await get(lk)));

  const right = await releaseLifecycleLock(kv, SUB, inst, SLOT, A.token);
  check('releasing with the exact token returns 1', Number(right) === 1, String(right));
  check('and the lock key is gone', Number(await exists(lk)) === 0, 'lock key still present');

  const again = await releaseLifecycleLock(kv, SUB, inst, SLOT, A.token);
  check('releasing an already-released lock returns 0', Number(again) === 0, String(again));

  // THE RACE THE SCRIPT EXISTS FOR: A's lock expires, B acquires, then A's
  // release arrives late. A GET-then-DEL would free B's lock here and hand the
  // row to a third caller while B is still working. The compare-and-delete
  // must refuse, and B must still hold the row afterwards.
  const inst2 = await freshInstance();
  const lk2 = lifecycleLockKey(SUB, inst2, SLOT);
  const A2 = await acquireLifecycleLock(kv, SUB, inst2, SLOT);
  await client.sendCommand(['PEXPIRE', lk2, '40']);
  const dl = Date.now() + 3000;
  while (Number(await exists(lk2)) === 1 && Date.now() < dl) {
    await new Promise((r) => setTimeout(r, 20));
  }
  const B2 = await acquireLifecycleLock(kv, SUB, inst2, SLOT);
  check('B2 holds the row after A2 lapsed', B2.ok === true, JSON.stringify(B2));
  const late = await releaseLifecycleLock(kv, SUB, inst2, SLOT, A2.token);
  check('A2\'s late release does not free B2\'s lock', Number(late) === 0, String(late));
  check('B2 still holds the lock afterwards', String(await get(lk2)) === B2.token, String(await get(lk2)));
  check('B2 can still release its own lock',
    Number(await releaseLifecycleLock(kv, SUB, inst2, SLOT, B2.token)) === 1, 'B2 could not release');
}

await client.quit();
console.log('');
_finish(passed, failed);
