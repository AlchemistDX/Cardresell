# Verification method — read this before checking any item

You are checking a third-party reviewer's claims about the CardResell codebase
at `/home/user/workspace/cardresell`. The reviewer did NOT have repository
access; they worked from the live site. So some claims describe things that are
already built, some describe real gaps, and some are product opinions that no
amount of code reading can settle.

**Your job is to determine which, with evidence. Not to agree, and not to
defend the codebase.**

## Hard constraints

- **Read-only.** Do not create, edit, move, or delete any file inside
  `/home/user/workspace/cardresell`. Do not `git add`, `commit`, `push`, or
  `fetch`.
- **Do not run the test suite** and do not call production endpoints. Several
  suites hit `www.cardresell.org`. Reading test files is encouraged; executing
  them is not.
- **Do not print, echo, or copy any secret, token, key, or `.env` value.**
- Write your findings ONLY to your assigned output file under
  `/home/user/workspace/audit/reviewer62/`.

## Background reading

`/home/user/workspace/audit/CARDRESELL_PLAN_AND_ROADMAP.md` is a recently
verified architecture and roadmap document. Use it for orientation, but it is
not evidence — re-check anything you intend to cite.

The repo is a static site (`index.html` plus hashed bundles in `js/`, currently
`js/core.d9e1b484.js`) plus ~55 Vercel serverless functions in `api/`, and ~45
test files in `tests/`. There is no `package.json` and no framework. The core
bundle is very large; use `rg` with line numbers and read windows around hits
rather than trying to read it whole.

`js/core.569ff536.js` is an OLD unreferenced bundle. Only `index.html`'s
`<script src>` names the live one. **Never cite the stale bundle.**

## Verdict vocabulary — use these exact labels

| Label | Meaning |
|---|---|
| `SHIPPED` | Already implemented and reachable by a user. Reviewer is wrong that it's missing. Cite file:line AND how a user reaches it. |
| `PARTIAL` | Some of it exists. State precisely what exists and what is genuinely absent. This is the most common correct answer — do not round it to SHIPPED or GAP. |
| `GAP` | Reviewer is right; it does not exist. Say what would have to be built and name the files that would change. |
| `GAP-BLOCKED` | A real gap, but a binding project rule or an external dependency prevents the reviewer's proposed solution. Name the rule or dependency. |
| `NOT-CODE` | A business, legal, marketing, or staffing judgment with no codebase answer (e.g. testimonials, hiring a second person, an independent audit). Say so plainly; do not invent a technical verdict. |
| `WRONG` | The claim misdescribes the system. Show the evidence that contradicts it. |
| `UNVERIFIABLE` | Depends on live runtime, a third-party dashboard, or a provider's current behavior that you cannot check from here. Say exactly what would settle it. |

## Binding project rules — flag any item whose proposed fix violates one

1. **One business behavior = exactly one implementation.** A second parallel
   implementation of an existing behavior is itself the bug.
2. **Never display an invented number.** No fabricated day-ranges,
   sell-through rates, sample counts, or confidence values. If a figure is
   derived rather than observed, it must be labeled as derived.
3. **Do not stamp a lie.** UI text must match what the code actually does.
4. Never use the word "beta"; in-progress states are "under maintenance".
5. Do-not-do list: no password collection · no headless-browser listing
   automation · no DOM scraping · nothing circumventing a closed partner API ·
   no second fee model · no guessed eBay descriptor value ids · no publish
   button before Phase 3 · no `package.json` · no auto-publish ever · no second
   normalization implementation · no new bundler or framework migration.
6. **The "Ultimate" tier is retired**, and the Grade gold-set, wallpaper, and
   homepage feature-grid blurb are on an explicit do-not-touch list.
7. Deployment is on hold; nothing ships without owner authorization.

If a reviewer item is a good idea whose obvious implementation would break one
of these, that is exactly the sort of thing the owner needs told. Use
`GAP-BLOCKED` and explain the safe alternative.

## Output format — one block per item, in numeric order

```
### Item N — <short restatement>
**Verdict:** <LABEL>
**Evidence:** file:line references, and what the code actually does.
**If real, what it takes:** the specific change, or "n/a".
**Rule conflict:** name the rule, or "none".
```

Then end your file with:

```
## Group summary
- Counts per verdict.
- The 3 items in this group most worth doing first, with one line each on why.
- Anything the reviewer got materially wrong that the owner should know.
- What you could not check, and why.
```

## Standards

- Cite `file:line` for every factual claim about the code. A claim with no
  citation will be treated as a guess and thrown out.
- Quote the relevant line when the wording matters (e.g. checking whether UI
  copy is honest).
- If the reviewer is right, say so without hedging. If they are wrong, say that
  plainly too, with the evidence.
- Prefer "I could not verify this" over a confident guess. Being cited is not
  being right; bind every claim to a line of code.
