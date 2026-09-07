# Bundle citation map — retired generations → live

**Live bundle: `js/core.7f9c03ad.js`.** New work cites that hash.

The corpus does not. 408 line-citations point at `core.d9e1b484.js` and exactly **one** points
at `core.8bd8277a.js`, so reading almost any existing audit document means translating from the
oldest generation. This table is that translation, direct — never composed through the
intermediate generations.

## Why direct, not chained

Each rename produced its own offset map, so the mechanical route from a `d9e1b484` citation to
a live line is `d9e1b484 → 8bd8277a → 7f9c03ad`. That composition is tolerable at two hops and
unusable at five, and every hop is a place to make an arithmetic error silently. Each retired
generation is therefore diffed **straight against the live bundle**.

Composition was checked against measurement here, and agreed. That is a reason to trust the
tables, not a reason to keep composing by hand.

## `core.d9e1b484.js` (18,526 lines) → `core.7f9c03ad.js`

Four constant-offset intervals. **No deleted lines** — every line in `d9e1b484` has a
byte-identical counterpart in the live bundle.

| `d9e1b484` lines | Add | Notes |
|---|---|---|
| 1 – 8,116 | **+0** | everything up to `switchView` is untouched |
| 8,117 – 8,121 | **+2** | `switchView` view-handle declarations |
| 8,122 – 8,136 | **+4** | `switchView` display resets |
| 8,137 – 18,526 | **+18** | the rest of the bundle, including all of `api`-adjacent client code |

Anything at or below 18,527 in the live bundle is new since `d9e1b484` — the D2.1 drafts screen
and the D3 review screen — and has no `d9e1b484` address at all.

## `core.8bd8277a.js` (19,001 lines)

**No longer tabulated — and the reason is worth more than the table was.**

This document originally carried a five-interval table for `8bd8277a`. **It went stale one
commit later.** D3 step 3 inserted lines inside the region that table described, and the true
alignment is now nine intervals. Nothing announced that; the table simply became wrong while
continuing to look authoritative.

`d9e1b484`'s table survived the same commit unchanged, because every D3 insertion lands below
the last line `d9e1b484` has an address for. So one stamped table aged and one did not, in the
same edit, for reasons no reader could infer from either.

That is the whole argument for cache-versus-source-of-truth, demonstrated on this page rather
than asserted. `8bd8277a` has **one** line-citation in the corpus, so the table was never
earning its keep. Derive it:

```
node tools/bundle-citation-map.mjs 8bd8277a <line>
```

## `core.569ff536.js` (17,723 lines)

**Not tabulated.** Zero line-citations in the corpus. Its alignment to live is 25 intervals
with a genuine gap — a line that survives in no form — so a table would be both long and
misleading. If a citation to it ever appears, derive it on demand:

```
node tools/bundle-citation-map.mjs 569ff536 <line>
```

## The tables above are a cache. This is the source of truth

```
node tools/bundle-citation-map.mjs              # verify every corpus citation resolves
node tools/bundle-citation-map.mjs d9e1b484 8120  # translate one, mid-read
```

A hand-maintained offset table is a **derived value stamped into a document**, which is the
failure that produced `BUNDLE_RENAME_7f9c03ad.md` §"The expected name was wrong": a hash named
in advance of the derivation, executed later on trust. A table that ages is the same shape,
slower. So the derivation ships as a runnable check, and the table is a convenience that the
check can contradict.

The tool discovers the live bundle from the single `<script defer src>` in `index.html` rather
than taking it as a constant, so the next rename needs **no edit here** — the tables go stale
and the tool does not.

## Verified 2026-09-06 (re-verified after D3 step 3)

`6,629 / 6,629` cited lines are byte-identical at their mapped position, across all
`audit/**/*.md` and `tests/*.mjs`.

Three mutations confirm the check can fail:

| | Mutation | Caught by |
|---|---|---|
| M1a | citation to an out-of-range line (`:99999`) | "do not resolve", exit 1 |
| M1b | mutate one live line that a real citation points at | that citation reported by file and line |
| M2 | two `core.*.js` script tags in `index.html` | throws, refuses to guess which is live |

Two independent implementations were used deliberately: Python `difflib` opcodes and, in the
tool, unique-line anchoring with outward run extension. They produce identical intervals for
both tabulated generations.

## Not claimed

- **This does not verify that a citation is still *apt*.** It proves the cited line's bytes are
  unchanged and reachable. A citation can resolve perfectly and still point at code whose
  meaning moved because its callers changed.
- **It is not a registered suite.** It is runnable and mutation-tested, but nothing runs it
  automatically, so a future edit can rot the corpus without going red. Registering it is a
  decision, not an oversight — it belongs to whoever next opens `tests/run-all.sh`. When that
  happens the natural home is **alongside `tests/asset-fingerprints.mjs`, not as its own slot
  on the suite ladder**: both answer "do the artifacts and their references still agree", both
  fail for the same cause — bytes edited without following through — and the ladder is for
  behaviour checks. Slot 1 already owns half the question.
- **The tables on this page are a snapshot and can be wrong without warning.** One of them
  already was, within a single commit. Run the tool.
