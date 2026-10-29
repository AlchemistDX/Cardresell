# Live user workflow audit — 29 October 2026

## Result

The primary lookup and fee-comparison path works for the three sampled main games. This is **not a clean launch sign-off**: saved-draft navigation and the comparison-to-draft handoff still have confirmed usability problems. One independently reproduced stale-card bug was fixed in this audit.

The live audit began on app commit `09ed446228efdb84f2545b5879c4fb44462a7336`, core bundle `302986f3`. The corrective bundle is `493d2522`; release verification is recorded below after deployment.

## Confirmed findings

| Priority | Finding | Evidence / impact | Status |
|---|---|---|---|
| High | Old price choices and research links remain after switching games | Pokémon → Magic and Yu-Gi-Oh! → Magic both cleared the name/value but retained the previous card's low/high buttons and eBay link. An old override also survived. | Fixed: reset clears card-specific pricing and research UI, aborts pending research, invalidates its generation and clears the old override. |
| High | Saved draft page can be blank although active drafts exist | Drafts badge showed 214 while usage showed 3 / 2000 active saved drafts; first page displayed only Load more. One Load more recovered a Mew row. Re-entering Drafts reproduced the empty first page. | Open. `_draftService.js:listDraftSummaries` pages stable indexed IDs, omits deleted rows, and reports indexed total. UI uses that total for its badge but active usage for its heading. A deleted-only page is allowed and has no explanation or automatic advancement. No data loss established. |
| Medium | “Review eBay draft” creates a saved draft | Clicking this label for Greninja led to “Listing draft started” and an Open draft action. | Open. Label should make creation explicit, or review should be a non-saving preview until a save action. |
| Medium | Draft headline uses a different net basis | Greninja at $1.50 with $1 postage: comparison $0.00; draft headline $1.00, labelled item price only. The draft explains that postage is excluded. | Open. Not an arithmetic failure; an inconsistent decision-making basis that needs clearer, consistent presentation. |
| Medium | Draft pricing provenance missing after price choice | Choosing Greninja Listed high $1.50 and preparing a draft produced “No price source was recorded with these listing details.” | Open. Preserve the chosen price basis and timestamp through the handoff. |
| Low | Search results contain broad related matches | Exact queries return correct first result plus loosely related cards/products. A mixed nonsense query with “audit card” returned unrelated art cards. Pure nonsense returned a clear no-match message. | Open usability refinement: distinguish exact matches from related suggestions. |

## Live browser journey exercised

- Homepage and returning signed-in session: Business state appeared after hydration. Existing saved lookup restored. No new sign-in or credentials entered.
- Pokémon: **Mega Greninja ex - 081**, ME: Mega Evolution Promo, Holofoil. Market $0.79; reported asking range $0.44–$1.50. Exact promo was first result. Fee comparison appeared automatically, without opening Listing help.
- Price choice: clicked Listed high $1.50, entered $1 postage and calculated. eBay/TCGplayer displayed approximately break-even $0.00 and no buy offer met the target margin.
- Draft handoff: identity, finish, compared condition and chosen price carried through. Review gave eBay listing link and copy actions, separate photo section and warnings. **This audit created one Greninja draft as a side effect of the “Review” action. It remains saved.** No deletion or marketplace publishing was performed.
- Returning to Lookup preserved the selected card, asking price and postage.
- Magic: **Eager Glyphmage**, Secrets of Strixhaven #11, Foil. Market $0.15; reported asking range $0.25–$0.40. Negative proceeds were displayed with the entered postage. A market reference below current asking lows is not automatically an error; these are different provider measures.
- Yu-Gi-Oh!: **Blitzclique - Breakaway**, Chaos Origins CORI-EN051, 1st Edition. Market $0.26; reported asking range $0.01–$0.40. Correct set/edition reached the panel and research query.
- Search failure recovery: `zzzxqvvvqqq` settled to “No matches in this catalog snapshot. Try the printed name, set or number.” Modal could be dismissed.
- Scan menu: Single, Bulk and Rapid choices show their ID-credit costs. Single Scan encountered this cloud browser's lack of a camera; no new scan/photo upload was completed in this audit. This does not retest scanner identification accuracy.
- Collection: existing two cards loaded; missing cost excluded from unrealized profit; search/filter/import/export and Drafts navigation available. No inventory edits, sales or price-refresh writes performed.
- Flips: zero-sale empty state, portfolio and unknown-cost handling rendered; recovery controls collapsed and report/export visible. No sale logged.
- Draft tutorial: opens from “How to use drafts,” hides and can reopen; includes “Don't show this automatically again,” Seller Hub Reports upload link and finish/publish instructions. Checkbox preference was not changed. CSV was not downloaded/uploaded in production.
- eBay connection dialog accurately states read-only seller checks and that connecting does not grant sold data, direct publishing or automatic sync. Existing connection recognized. The read-only seller check returned registration Complete, zero enabled addressed locations, and unavailable shipping/payment/return policy checks (HTTP 400, eBay code 20403). The dialog provided recovery guidance rather than claiming readiness. This account is not verified ready for a future direct-publish flow; CSV does not require this connection.
- Subscription dialog loaded account-aware plans and credit balances; existing legacy membership and cancellation information displayed. No checkout, billing change or purchase performed.

## Automated verification

Eight isolated suites completed before the fix with **821 checks**, zero reported failures:

- search-workflow-browser: 36
- core-values-browser: 66
- bulk-workflow-browser: 206
- draft-read-workflow-browser: 46
- auth-session-workflow-browser: 40
- selling-next-step-browser: 243
- a11y-mobile-2026-09-04: 164
- restore-navigation: 20

The new game-switch regression failed against the pre-fix bundle at “game switch hides previous card price choices.” After the fix, core-values-browser completed **87 checks, zero failures**, including 21 new assertions across 320px, 390px and 1280px viewports. Test ordering was corrected because resetting the page deliberately replaces the welcome content; this was a fixture-order issue, not an application regression.

These browser suites use synthetic accounts/data and block or stub external/API traffic. Their mobile coverage is simulated browser width, **not a physical iPhone/Safari test**. They do not establish production write, payment or marketplace-publish success.

An initial broader test command was rejected by automatic review over possible production state changes. After inspecting the suites' network isolation, a narrower set of verified isolated suites was accepted and completed. No review bypass was used.

## Limits and next work

Prior original/degraded-photo acceptance evidence remains separate. This audit does not claim universal scanner accuracy, every catalogue printing, physical-camera compatibility, actual card grading, real payment processing, eBay upload acceptance or live publication. The draft-list and handoff findings above should be closed before advertising a seamless end-to-end selling workflow.

Evidence: `screenshots/user-audit-drafts-2026-10-29.jpg` captures the blank draft page and inconsistent counts.

## Release verification

The 176-entry release runner completed with ALL CHECKS PASSED (offline mode; conditional/live gates remain skipped). Live deployment verification follows in a documentation update.
