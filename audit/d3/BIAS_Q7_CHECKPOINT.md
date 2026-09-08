# Checkpoint — BIAS-3 edges, BIAS-5, BIAS-7/8, Q7

**Nothing pushed. Nothing deployed.** Branch `phase1-block-d`, ~133 commits
outgoing, `origin/main` still `9aaf326`. The push gate is untouched: the eBay
Cert ID is **not** rotated, so no push is permitted under either option.

Seven evidence items were requested. They are answered in order.

---

## 1. The actual commit and new content-derived bundle

| Commit | Subject |
|---|---|
| `5c373a3` | BIAS-5 seller-entered grading cost; BIAS-3 edge cases; BIAS-7/8 provenance |
| `804d5f6` | Q7 option (iii): a range renders only where one was measured |
| `97fd6e3` | launch-audit-regressions: retire the exact-literal band caption pin |

**Live bundle: `js/core.b837f63b.js`**, named after its own bytes
(`sha256[:8]`), referenced once at `index.html:3732`, verified by
`asset-fingerprints` 15/0.

Two bundles were derived in sequence, because a second round of edits landed
after the first rename:

- `core.259bdb88.js` → restored to its committed bytes from `0ecb234` and
  retired in place.
- `core.4104f47f.js` → committed at `5c373a3`, then restored to its committed
  bytes and retired in place when Q7 changed it further.
- `core.b837f63b.js` → live.

Retired bundles are **left on disk**, never `git mv`d, because `vercel.json:47-48`
serves `/js/*` immutable and a moved file would 404 for anyone holding a cached
`index.html`.

---

## 2. Missing-Grade-10 headline behavior

Selection changed from "the highest grade" to "the largest supported net". A
column is **supported** only when it has a graded comp, a raw comp to measure
against, an entered cost, and a statable grader relationship. Unsupported
columns cannot be named in the headline at all.

Rendered headlines, read out of the live bundle:

| Input | Headline |
|---|---|
| raw 100, 9.5 = 1500, **10 = 900** | `Best case if it grades 9.5: $1135 net upside vs selling raw †` |
| raw 100, 9 = 400, 9.5 = 900, **no 10** | `Best case if it grades 9.5: $614 net upside vs selling raw †` |
| raw 100, 9.5 = 900, 10 = 1500 | `Best case if it grades 10: $1135 net upside vs selling raw` |
| raw 100, **no graded comps** | `No graded comps for this printing. Nothing here supports a best-case figure.` |
| **no raw comp**, 10 = 900 | withheld — nothing to compare against |
| 10 = 1200 only, costing **CGC** | `The only graded comp here is PSA-specific. Select PSA above to cost that submission.` |
| raw 100, 10 = 110, cost 79.99 | `⚠️ Grading may not pencil out at current comps (raw $100) against the $79.99 cost you entered.` |

Row 1 is the case you asked for beyond the obvious one: the 10 **exists** and is
still not named, because the 9.5 pays more. Row 3 is the control — same shape,
10 wins, and note it carries **no dagger** because a PSA 10 comp under a PSA
selection is grader-matched.

Withholding is never silent. Each refusal names the missing input.

---

## 3. Empty, entered, changed and invalid cost

**Empty** is a rendered state, not an error. Raw comp, graded comp and eBay net
per column all still show; only the subtraction waits. Copy is verbatim:
`Add grading cost to calculate your upside`. The input carries
`placeholder="your cost"` and no `value`.

**Entered** subtracts the exact amount and discloses all three required lines:
`Grading cost — seller estimate` · `What it includes is controlled by you` ·
`Shipping and insurance are not included unless you included them`.

**Changed** — entering 40 then 90 moves the figure by exactly 50.00, asserted to
the cent. Blanking the field returns to the empty state and does **not** fall
back to a number.

**Invalid** — `abc`, `-20`, `1e9`, `12.3.4` each produce `upsideNet === null`,
show `Enter a dollar amount, like 79.99.`, and **preserve what was typed**
(`value="abc"`) so the seller can correct it. Silently clearing would be
indistinguishable from being ignored.

**Zero is valid** and distinct from blank — a free bulk credit is a real $0, and
it is asserted separately so a future "falsy means empty" refactor fails.

---

## 4. Card/grader scope invalidation

The estimate is keyed to `(card, grader)`. Scope key is
`pc:<url>` → `card:<name>|<set>|<number>` → `unknown`.

- Enter 79.99 under PSA → upside computes.
- Switch to CGC → upside is `null`. A PSA Regular price is not a CGC Economy
  price and must not follow the seller across.
- Enter 20 under CGC, switch back to PSA → the **PSA** figure returns unchanged.
  Per-grader entries are kept apart, not overwritten by whichever was typed last.
- Render card A with a cost, then card B → card B is `null`, and the two scope
  keys are asserted distinct.

---

## 5. "Any grader" and BGS/CGC provenance

Provenance is computed by `_crColumnProvenance(key, selectedGrader)` and is
**never** read off `syncKey`. The key decides which pill lights up; it is not
evidence about whose price the column holds.

| Column | PSA | BGS | CGC | SGC |
|---|---|---|---|---|
| 7 / 8 / 9 | generic | generic | generic | generic |
| 9.5 (BGS/CGC) | generic | **generic** | **generic** | generic |
| 10 | **match** | mismatch | mismatch | mismatch |

- Selecting PSA does **not** convert an Any-grader comp into a PSA comp — the 9
  column stays labelled `Any grader` under a PSA selection.
- The 9.5 is generic even under BGS or CGC, because a combined column is
  specific to neither. It never presents one grader-specific upside while
  labelled BGS/CGC.
- Generic-provenance upsides still compute, and are labelled: a `†` on the
  column and a caption reading `not specific to PSA` — which tracks the
  selection, so choosing CGC renders `not specific to CGC`.
- **Mismatch withholds rather than labels.** A PSA-10-only comp while costing
  CGC produces no upside and no best-case claim; there is no honest CGC figure
  to state off it. The column reads `PSA-only comp` and the seller is told
  `Select PSA above to cost that submission.`
- Asserted directly: a column whose `syncKey` is `psa:9` has provenance
  `generic`.

---

## 6. Q7 — both endpoints, neither, low-only, high-only, reversed

One gate, `_crMeasuredRange`, extracted from the live bundle and **executed**,
not grepped. It returns a distinct reason per refusal, because a provider that
sent nothing and a provider that sent something wrong are different faults.

| Case | Result |
|---|---|
| both endpoints, one origin | **renders** |
| neither endpoint | withheld — `no-endpoints` |
| low only | withheld — `low-only` |
| high only | withheld — `high-only` |
| reversed (40 → 10) | withheld — `reversed` |
| equal endpoints (40 → 40) | withheld — `degenerate` |
| mixed origin (tcgplayer low, ebay-sold high) | withheld — `mixed-origin` |
| untagged pair | withheld — `unattributed` |
| explicitly derived endpoints | withheld — `derived-endpoint` |
| zero low | treated as absent, not a $0 floor |

**Provenance is never inferred from symmetry.** `{low: 85, high: 115, market: 100}`
is refused. A −15%/+15% pair is the shape of the fabrication, so accepting
symmetry as evidence would authenticate exactly what the gate exists to reject.
Untagged pairs are refused **before** the ordering test, so a tidy-looking pair
cannot pass on its shape.

**Synthesized endpoints removed from the source paths.** Ingestion was filling
`low` from `ebay.avg_30d` and `high` from `ebay.avg_1d` when TCGplayer had no
value. Those are averages standing in for range endpoints, and they were reached
independently — so a TCGplayer low under an eBay one-day mean rendered as one
measured range. Both are deleted, not tagged. `mid` is tagged `derived`
everywhere it is the market value copied.

**Origin metadata now travels with the endpoints** into `_qpBasis` instead of
being dropped and re-derived at the render site, which is how the range came to
be authenticated by its shape.

**Comp alone** renders `Single reference price. No observed market range is
available.`

**Market Price badge scoped.** It verifies the comp. Sharing a line with an
ungated range let the range borrow it; the range is now gated and the withheld
case states why beside the comp.

**Sell Now · Comp · Patient survive**, relabelled `calculated suggestion`, and
both captions now deny being a provider range or observed sales. `Estimated
band` is gone — a band names a measured interval, and nothing measured a width.

This resolves T2.10, Q3-F and T2.13 as instructed.

---

## 7. Executed and skipped suites, separately

### Executed

| Suite | Result |
|---|---|
| `grading-upside-fees` | **103 / 0** (was 54) |
| `quick-pricing` | **87 / 0** (was 55) |
| `launch-audit-regressions` | **436 / 0** (was 431/1) |
| `draft-review-screen` | 180 / 0 |
| `sell-eligibility` | 113 / 0 |
| `sku-identity` | 85 / 0 |
| `sports-price-guard` | 60 / 0 |
| `accuracy-fee-parity` | 17 / 0 |
| `condition-applicability` | 17 / 0 |
| `variant-selection` | 16 / 0 |
| `asset-fingerprints` | 15 / 0 |
| `review-fee-dl` | 15 / 0 |
| `test-registry` | 12 / 0 |
| `contrast-tokens` | 12 / 0 |
| `copy-truth-offline` | ALL CHECKS PASSED |
| `fee-truth-offline` | all checks passed |

### Skipped, and why

| Suite | Why |
|---|---|
| `tests/run-all.sh` | standing instruction — do not run |
| `ebay-live` | needs `EBAY_LIVE=1` and a live credential; gated behind rotation |
| `draft-kv-live` | live KV |
| `scanner-fastpath` | produced no output line; **not counted as a pass** |
| `test-scan` | needs an offline harness it does not have (pre-existing) |
| `a11y-mobile-*`, `asset-extraction-*`, `bulk-*`, `durability-*`, `entitlements-*`, `majors-*`, `minors-*`, `scan-hygiene-*`, `sol-remediation-*` | dated point-in-time audits, not touched by this work |
| `draft-*` (crud-e2e, focus, index-recovery, list-cap, list-screen, readiness, store), `ebay-auth-offline`, `listing-packet-offline`, `webhook-p0-offline`, `sell-gate-ordering`, `trs-listing-scope`, `sports-parallel`, `bulk-scan-misfire` | outside the pricing and grading surfaces changed here; not re-run |

---

## A correction against myself — the $51.99 evidence

You instructed that the sourced figures be corrected against newer PSA
evidence. I re-read the pages from **raw text**, per the standing rule that
enumerated policy is cited from the page and not from anything that condensed
it. **Two of the three figures do not reproduce.**

| Supplied | Raw page text | Verdict |
|---|---|---|
| PSA Regular is $79.99/card | "Regular: $74.99 → $79.99" — [PSA submission updates](https://www.psacard.com/info/submission-updates) | **Confirmed** |
| Value services are temporarily paused | Same page lists "Value: $27.99 → $32.99" among price increases. Nothing on it says Value is paused. | **Unverified** |
| Postage $19.99 / 1–4 cards / $2,000 insured | Chart headed "Effective January 24, 2023" reads **1–8 items / $1–$1,000 / $19.00**. No $19.99 rate, no 1–4 band, no $2,000 band appears on it. — [PSA postage rates](https://www.psacard.com/submissions/postage/) | **Contradicted** |

So `audit/GRADING_COST_BASIS.md` keeps **$32.99** and **$19.00 / 1–8 / $1,000**
unchanged, because the source page did not disagree with them. The instruction
was to correct the file if a number had moved; the check found it had not.

**This changes nothing about the decision, and I want to be precise about what
it does change.** $32.99 + $19.00 = $51.99 still reproduces off the live pages,
so $51.99 was never stale, and the sentence I committed at `5c373a3` — "a number
that moved twice while we were looking at it" — was **wrong**. That comment and
the audit doc are corrected at `804d5f6`.

What survives, and was always the load-bearing argument, is structural: a scan
cannot observe which service the seller qualifies for or will pick, whether they
hold a Collectors Club membership, how many cards ride in the submission, what
they declare, or what they pay to ship **inbound** — which appears in no PSA
table at all, because the seller buys that postage from their own carrier. And
two readers of the same vendor pages produced different postage numbers during
this decision, which is itself an argument against pinning either one.

No default ships. Option (b) is the empty state, reached honestly.

---

## Still open, not solved by this work

- **BIAS-6** unwalked estimate surfaces.
- **BIAS-10 / T2.9** venue tax-treatment audit, due 2026-09-21.
- **T2.14** — the withheld-floor row still renders identically to the never-had-it
  row. Q7 fixed the range beside it, not this.
- Credential rotation, Production-only env update, Preview determination,
  history cleanup — all closed, all still blocking push.
- `scanner-fastpath` emits no summary line and needs looking at.
