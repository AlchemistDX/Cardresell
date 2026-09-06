# Decision — The D2.1 screen suite is a self-hosting real-browser suite

**Date:** 2026-09-06 · **Status:** decided, before writing the screen
**Scope:** `tests/draft-list-screen.mjs` and the client-test technique generally

---

## 1. The reframe that produced this decision

The three vacuous assertions catalogued in `DECISION_SOURCE_DISAGREEMENT.md` shared a shape:
each named a behavior and tested a surface. But the third one is different in kind, and the
difference matters.

`/function _sourceDisagreement/.test(index)` **can only** test a surface. Regex over a string
has no access to behavior. That assertion was not a mistake somebody made — it was **the ceiling
of the available technique, wearing a behavioral label.**

That moves the problem. It is not that the disagreement thresholds happen to lack a behavior
test. It is that the technique in use could not have produced one.

## 2. What the registered suite actually covers — one correction to the framing

The honest statement is **not** "client behavior is spell-checked." There are **three**
techniques in this repo, not two:

| Technique | Falsifiable? | Where |
|---|---|---|
| Regex over bundle text | **No** — surface only | `launch-audit-regressions.mjs`, `quick-pricing.mjs`, `scanner-fastpath.mjs`, `fee-truth-offline.mjs`, `copy-truth-offline.mjs` |
| `new Function(extractedSrc)` — slice a function's source out of the bundle and execute it | **Yes**, for pure functions | Registered: `sell-gate-ordering.mjs`, `sports-parallel.mjs`, `listing-packet-offline.mjs`. Unregistered: most of the dated `*-2026-09-04.mjs` audit files |
| Real browser against a served site | **Yes**, including DOM | `condition-applicability.mjs` only — slot 26, env-gated off |

So client behavior **is** falsifiably tested in places, by extraction. The framing overstated
this by one step.

**But the conclusion survives, for a sharper reason.** Extraction only works on pure functions —
slice the source, execute it, feed it arguments. **A list renderer touches the DOM.** The
technique that rescues client testing generally cannot touch rendering at all. So for the D2.1
screen specifically the gap is real and total: there is no non-browser technique that can assert
what a row renders.

Slot 26 is the only harness that can, and it is `COND_PILLS_BROWSER`-gated off by default
(`tests/run-all.sh:239-248`). **A gate that is off is not a gate.**

## 3. Decision

**`tests/draft-list-screen.mjs` is a real-browser suite. It self-hosts, and it is ungated.**

Self-hosting is the part that makes ungated possible, and it is the whole reason this decision
is cheap. Slot 26 is gated because it depends on `SITE_BASE` — a site somebody remembered to
serve. Remove that dependency and the reason for the gate disappears.

Proven by spike before deciding, not assumed:

```
self-hosted on ephemeral port 41213
bundle actually loaded by the browser: [ 'http://127.0.0.1:41213/js/core.d9e1b484.js' ]
stale 569ff536 present: false
probe: { hasFn: true, domReachable: true }
page errors: 0
```

The harness is `node:http` + `fs` serving the repo root on port **0** (kernel-assigned), plus
Playwright at the existing overridable `PLAYWRIGHT_PATH`. No new dependency, no `package.json`,
no fixed port, no env var, nothing to remember.

Three properties fall out of it for free:

- **It cannot read a retired bundle.** The browser resolves `index.html`'s own `<script>`
  reference, so the `readCoreBundle`/`resolveCoreBundle` discipline that exists to stop a suite
  globbing `js/` and finding `core.569ff536.js` is structurally unnecessary here. Verified in
  the spike output above.
- **Port 0 cannot collide** with the 8097 server or the stale 8090 copy, and it never needs
  `pkill`.
- **`page.on('pageerror')`** turns any uncaught client exception into a failure, which no text
  or extraction test can see. `condition-applicability.mjs:114` already does this.

### What it bought within a minute of existing

The spike executed `_sourceDisagreement` against three fixtures:

| Fixture | Result | Branch proven |
|---|---|---|
| `tcg.market 10` vs `pc.median 100` | fires — `ratio 0.1, spreadPct 900, higher: 'pc'` | detection |
| `1` vs `10` | `null` | the `$20` floor |
| `100` vs `90` | `null` | the 1.5× band |

That is the **first behavioral evidence that function has ever had.** It replaces an assertion
that would have passed on `return null`.

**One honest caveat from the same spike.** My first probe passed `{tcg:{median:10}}` and got
`null`, and I briefly had a bug — the function reads `tcg.market`, and requires
`pc.source === 'pricecharting'` (`js/core.d9e1b484.js:1768-1770`). The code was right and my
fixture was wrong. A text test fails toward false confidence; a behavior test fails toward false
alarm. The second is far better, but it is not free — **a wrong fixture is still a wrong test**,
which is the same lesson the offset-518 fixture taught from the other direction.

## 4. Case allocation

Cases 2, 3, 4, 8, 11, 13, 14, 15, 21, 22 describe **rendering, handler presence, or request
counts through the client path**. They go to the browser suite. Landing them as regex over
`core.*.js` would make them green and structurally incapable of failing — the exact outcome the
last commit spent its message documenting.

| Case | Home | Why |
|---|---|---|
| 1, 5, 6, 7, 9, 10, 12 | offline | Response-shape and derivation. Case 12 pins §1.2a against a second formula — pure comparison, no DOM. |
| 16–20 | offline, **already shipped** | `tests/draft-focus.mjs`, 56 assertions. Server-side offset resolution. |
| 2, 3, 4, 8, 11, 14, 22 | **browser** | Each asserts what a row or banner renders. Not reachable by extraction. |
| 15 | **browser** | "No row carries a click, tap, or key handler" is a property of live DOM nodes. A source-text version could be defeated by any indirection. |
| 21 | **browser** | "Exactly one list request" needs the real create-to-list path with a counted `fetch` stub. The contract already warns to assert the count, not the absence of a loop. |
| 13 | offline, **stays a tripwire** | Explicitly labelled a tripwire in the contract, consistent with the accepted "drift guard is a TRIPWIRE not a proof" decision. It is honest as written. What changes is that case 2's sentinel-string assertion becomes *real* in the browser suite, so the tripwire is backed instead of standing alone. |

## 5. Not in scope, deliberately

**No extraction harness gets built, and slot 26 does not get ungated.** The screen is worth more
than test infrastructure right now, and the general problem — every pure client function tested
by regex — is not solved by this decision. It is narrowed: the *new* surface gets a real harness
so it does not add to the debt, and the existing debt stays recorded.

Retrofitting the five text suites is filed, not scheduled. Ungating slot 26 requires converting
it to self-hosting too — mechanical once this suite exists, since the harness is the same
15 lines, but it is a separate unit and it touches a passing test.

## 6. Correction shipped alongside this

The contract's Part 4 previously stamped `tests/draft-list-screen.mjs` as
"**DONE 2026-09-06.** Registered as `[27/27]`." **It was false.** The file does not exist and
slot 27 runs `tests/draft-readiness.mjs` (`tests/run-all.sh:251-256`).

A slot 27 *was* created that day and the labels *were* renumbered — both true, both verifiable,
both belonging to a different suite. The stamp named a behavior and evidenced a surface. That is
the fourth instance of the pattern, and the first one that was in a document rather than a test.
The contract now carries the correction inline rather than the stamp.
