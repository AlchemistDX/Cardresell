// tests/_complete.mjs — completion reporting for suites that keep their own
// counters.
//
// WHY THIS IS SEPARATE FROM _assert.mjs. Two suites in this repo were dead for
// multiple commits: one crashed in its first seeding call, one threw before its
// first assertion. Both printed a stack and no summary, and a reader scanning
// output could not distinguish that from a suite that had not been run. The
// harness in `_assert.mjs` already reports completion, but converting 34 suites
// to it would mean rewriting their assertions and fixtures — a much larger and
// riskier change than the reporting defect warrants. So the reporting is
// available on its own, and a suite keeps everything else it has.
//
// The rule this enforces: A PASS REQUIRES NORMAL COMPLETION, ZERO FAILURES AND
// A SUCCESSFUL PROCESS EXIT. Missing completion is a failure, not silence.
//
// Usage, at the very end of a suite, AFTER all awaited work:
//
//     import { completionGuard } from './_complete.mjs';
//     const { finish } = completionGuard('my-suite');
//     ...
//     finish(passed, failed);
//
// `finish` prints the marker and exits. Do not call it from a cleanup hook, a
// `finally`, or a signal handler: completion must mean the test work finished,
// and a marker emitted unconditionally on the way out would certify exactly the
// crashes this exists to catch.

export function completionGuard(label) {
  let finished = false;

  process.on('exit', (code) => {
    if (finished) return;
    console.log(`\n${label}: SUITE DID NOT COMPLETE`
      + ` -- no completion marker was emitted (exit=${code}).`
      + ' The run ended before its end. Any totals printed above are'
      + ' partial, and everything after the failure point is UNTESTED,'
      + ' not passing.');
    // A crash that exits 0 must not read as success. An uncaught throw already
    // exits non-zero; a deliberate early `process.exit(0)` that skipped
    // `finish` is the case this covers.
    if (code === 0) process.exitCode = 1;
  });

  // An unhandled rejection can otherwise end a run with the summary already
  // printed and work still outstanding. Recorded as a failure of the run.
  process.on('unhandledRejection', (e) => {
    console.log(`\n${label}: UNHANDLED REJECTION -- ${e && e.message ? e.message : e}`);
    process.exit(1);
  });

  /** Report completion. Exits 1 if anything failed. */
  const finish = (passed, failed) => {
    finished = true;
    const p = Number(passed) || 0;
    const f = Number(failed) || 0;
    const code = f > 0 ? 1 : 0;
    console.log(`\n${label}: ${p} passed, ${f} failed -- SUITE COMPLETE, exit=${code}`);
    process.exit(code);
  };

  /**
   * A suite that INTENDS not to run — a live suite without its opt-in env var.
   * Not completion and not a crash; reporting it as either trains the reader to
   * ignore the marker.
   */
  const skipAll = (reason) => {
    finished = true;
    console.log(`\n${label}: SUITE SKIPPED -- ${reason}. No assertions ran; this is not a pass.`);
    process.exit(0);
  };

  return { finish, skipAll };
}
