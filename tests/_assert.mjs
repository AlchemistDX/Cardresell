// tests/_assert.mjs
//
// Shared assertion helpers for new suites.
//
// The invariant that matters: A PROMISE MUST NEVER BE ACCEPTED AS THE TRUTH
// VALUE OF AN ASSERTION. `(async () => { ... })()` is always truthy, so an
// async IIFE passed to a synchronous assert prints "ok" while testing nothing.
// Two of those shipped in this repo before the harness refused them, so this
// is demonstrated rather than theoretical.
export function harness(label) {
  let passed = 0, failed = 0;
  const check = (name, cond, hint) => {
    if (cond && typeof cond.then === 'function') {
      failed++;
      console.log(`  FAIL ${name}\n       → TEST_API_MISUSE: a Promise is not a truth value; use await checkAsync()`);
      return false;
    }
    if (cond) { passed++; console.log(`  ok   ${name}`); return true; }
    failed++;
    console.log(`  FAIL ${name}${hint ? '\n       → ' + hint : ''}`);
    return false;
  };
  const checkAsync = async (name, thunk, hint) => {
    let v;
    try { v = await (typeof thunk === 'function' ? thunk() : thunk); }
    catch (e) { return check(name, false, `threw: ${e.message}`); }
    return check(name, !!v, hint);
  };
  const done = () => {
    console.log(`\n${label ? label + ': ' : ''}${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  };
  return { check, checkAsync, done, counts: () => ({ passed, failed }) };
}
