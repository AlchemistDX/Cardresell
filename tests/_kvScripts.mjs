/**
 * Redis script semantics for the test doubles — ONE implementation.
 *
 * Two suites drive the lifecycle through fake stores, and both have to answer
 * EVAL. A second copy of these semantics is the same class of bug the
 * production rule forbids: the copies drift, one suite certifies behaviour the
 * other contradicts, and the disagreement is invisible because each suite
 * passes against its own fake.
 *
 * The atomicity is modelled, not approximated: each branch runs to completion
 * with no `await` anywhere inside, because that indivisibility is the property
 * the acquisition and fencing tests exist to check.
 */
import { ACQUIRE_SCRIPT, FENCED_SET_SCRIPT } from '../api/_draftLifecycle.js';

const UNLOCK_MARKER = "redis.call('del',KEYS[1])";

/**
 * @param io {{get, set, del, setEx}} — `get` must already honour expiry.
 * @param rest the EVAL arguments after the command word: [script, numkeys, ...KEYS, ...ARGV]
 */
export function evalScript(io, rest) {
  const script = String(rest[0]);
  const nk = Number(rest[1]);
  const KEYS = rest.slice(2, 2 + nk).map(String);
  const ARGV = rest.slice(2 + nk).map(String);

  if (script === ACQUIRE_SCRIPT) {
    // exists → incr → set, indivisibly. The whole point of the script is that
    // no caller can observe the gap between the check and the allocation.
    const [lockKey, fenceKey] = KEYS;
    const [nonce, ttl] = ARGV;
    if (io.get(lockKey) !== null) return -1;
    const f = Number(io.get(fenceKey) || 0) + 1;
    io.set(fenceKey, String(f));
    io.setEx(lockKey, `${nonce}:${f}`, Number(ttl));
    return f;
  }

  if (script === FENCED_SET_SCRIPT) {
    // The guard and the write are one command, so a lapsed owner cannot pass
    // the check and then land the write.
    const [fenceKey, key] = KEYS;
    const [fence, value] = ARGV;
    const cur = io.get(fenceKey);
    if (cur !== null && Number(cur) > Number(fence)) return -1;
    io.set(key, value);
    return 1;
  }

  if (script.includes(UNLOCK_MARKER)) {
    // Release only my own lock: a lapsed owner must not delete the lock a
    // newer owner now holds.
    const lockKey = KEYS[0];
    if (io.get(lockKey) === ARGV[0]) { io.del(lockKey); return 1; }
    return 0;
  }

  // An unknown script is a failure, never a null. A double that answers
  // "nothing" to a script it does not know will certify any behaviour.
  throw new Error('fake kv: unimplemented script');
}
