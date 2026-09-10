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
  let passed = 0, failed = 0, skipped = 0;
  const check = (name, cond, hint) => {
    // A FUNCTION IS NOT A TRUTH VALUE EITHER — it is always truthy, so
    // `check(name, () => x.field.length > 0)` silently passed while testing
    // nothing. Same class as the Promise bug above. Rather than refuse it,
    // evaluate it: a lazy condition is the only way an assertion ABOUT a
    // value's absence can avoid dereferencing that value in the caller's
    // expression, where the harness cannot see the throw.
    if (typeof cond === 'function') {
      try { cond = cond(); }
      catch (e) {
        failed++;
        console.log(`  FAIL ${name}\n       → threw: ${e.message}`);
        return false;
      }
    }
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
  /**
   * Run one case with its own error boundary.
   *
   * WHY THIS EXISTS. D3 step 4 mutation-tested a suite by removing a key from
   * the wire. One assertion dereferenced the missing value, threw a
   * TypeError, and the throw ended the process. The run reported ONE failure.
   * The real damage was eleven, and every case after the first never ran.
   *
   * The assertion bug was fixable at the assertion. This is not: "a throw ends
   * the run" is a property of the harness, and the next dereference bug will
   * not be one anybody is watching for. The instrument failed in the
   * direction that looks like LESS damage than there was, which is the worst
   * available direction for a test runner: a broad regression reads as a
   * narrow one, and any other regression the same change caused is invisible
   * because those cases never execute.
   *
   * A throw here is recorded as a failure of the case and the suite carries
   * on. It is never swallowed and never converted to a pass.
   */
  // An opt-in section filter, for focused investigation of one failing case.
  //
  // WHY IT ANNOUNCES ITSELF. A filtered run is an INCOMPLETE run, and an
  // incomplete run that prints the same summary line as a full one is a way to
  // mistake "the rest did not execute" for "the rest passed". So a skip is
  // printed per section and the count is carried into the summary, which also
  // names the filter. Absent CR_ONLY nothing changes: every section runs.
  const only = process.env.CR_ONLY || '';
  const section = async (name, fn) => {
    if (only && !name.includes(only)) {
      skipped++;
      console.log(`\n⏭ ${name}\n  skipped by CR_ONLY`);
      return true;
    }
    console.log(`\n▶ ${name}`);
    try { await fn(); return true; }
    catch (e) {
      failed++;
      const at = String(e.stack || '').split('\n')[1] || '';
      console.log(`  FAIL [case threw, remaining assertions in this case did not run] ${name}`
        + `\n       → ${e.name}: ${e.message}\n       → ${at.trim()}`);
      return false;
    }
  };

  // COMPLETION IS REPORTED, NOT INFERRED FROM THE TOTALS.
  //
  // A suite that dies during fixture seeding prints no summary at all, and for
  // three commits that is exactly what happened here: two client suites were
  // crashing before their first assertion, and the failure looked -- to anyone
  // scanning output -- like a suite that had simply not been run. Totals cannot
  // carry this distinction: "0 passed, 0 failed" and "the process died at
  // import" are the same two numbers.
  //
  // So completion says so explicitly, and the ABSENCE of completion says so
  // too. The exit hook fires on a throw, on an unhandled rejection, and on any
  // exit that did not come through `done()`, so the last line of a run always
  // names which of the three happened -- without the reader having to know how
  // many checks the suite was supposed to contain.
  let finished = false;
  process.on('exit', (code) => {
    if (finished) return;
    console.log(`\n${label ? label + ': ' : ''}SUITE DID NOT COMPLETE`
      + ` -- no summary was produced (exit=${code}).`
      + ` Totals at the point of failure: ${passed} passed, ${failed} failed.`
      + ' Everything after that point is UNTESTED, not passing.');
  });

  const done = () => {
    finished = true;
    const code = failed ? 1 : 0;
    console.log(`\n${label ? label + ': ' : ''}${passed} passed, ${failed} failed`
      + (skipped ? ` -- INCOMPLETE RUN: ${skipped} section(s) skipped by CR_ONLY=${only}` : '')
      + ` -- SUITE COMPLETE, exit=${code}`);
    process.exit(code);
  };
  return { check, checkAsync, section, done, counts: () => ({ passed, failed, skipped }) };
}
