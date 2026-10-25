# Price research follows the selected card — 2026-10-25

The recent-comps panel could show broad card-wide quotes beside a specific finish or grade, drop its outage explanation when every feed failed, and keep old research visible after a condition change. A separate collection-refresh path accepted unreviewed eBay candidate medians.

## Result

- Condition, printing and grade changes clear old research immediately, invalidate late responses, cancel in-flight requests and schedule a debounced refresh for the new selection. Hand-entered prices remain unchanged.
- Broad TCGplayer quotes are identified as base-printing references with unverified condition/finish. Their clamped or unscoped highs never appear as measured endpoints. Raw TCG quotes do not appear under a graded selection.
- TCGplayer and PriceCharting requests do not carry a finish. Their replies are withheld from a selected finish, including automatic pricing and grade-ladder injection, so a missing quote cannot borrow another finish's guide.
- The unavailable-data explanation and exact-selection research link survive complete feed failure. The same source/status renderer handles empty and successful states.
- One dated listing can be opened and reviewed without a median or range being invented from it. Candidate samples say Needs review; heuristic confidence does not claim an exact match. Item-only prices say excluding shipping, and filtered ranges disclose excluded outliers.
- A missing or affirmative review-required flag cannot automatically price a card or refresh a saved collection value. Collection updates also require a finite positive median and at least two observations.
- Provider text is escaped, research links accept only their named HTTPS domains, and individual listing links require an eBay item URL. Invalid prices do not become guide or median values.
- The research panel uses a proper block container, readable links in dark mode and a 44-pixel Refresh button in its header. Refresh communicates loading and prevents repeated clicks while the request is active.

## Validation

The complete local regression run passed: 165 executed suites across 167 registered slots. The live managed-Redis probe and production mutation smoke were skipped; the condition browser gate ran. Tests use isolated local Redis and mocked provider/auth boundaries, with real Node fetch restricted to loopback.

Focused checks passed: selection/research browser workflow (141), sold-feed resilience and saved-value protections (47), quick pricing (235), launch regressions (426), price evidence/identity (40), price-to-draft browser workflow (180), asset fingerprints (270), and test registry (12). Browser coverage includes 320, 390 and 1280 pixel widths, immediate stale-result removal, automatic condition-specific requests, complete outage, single-candidate review, missing finish/grade prices, hand-entered prices, and an unpriced card receiving unreviewed search statistics. Light and dark screenshots were reviewed. The first full attempt was interrupted to fix the Refresh button layout found during visual review; the final complete run includes that fix.

The browser dates, cards and prices are synthetic test data. These tests verify source handling, selection ownership and UI/API behavior; they do not validate actual marketplace prices or promise selling speed.

## Live limitation

A fresh read-only request to the production eBay sold endpoint returned HTTP 200 with `available:false`, `reason:provider_unavailable`, zero candidates and null median/low/high at 2026-10-25T22:31:53.787Z. The deployed seller connection does not, by itself, restore this feed. This release changes how unavailable and unreviewed evidence is handled; it does not add sold-data access, bypass a provider restriction or enable seller writes.

Machine-readable evidence is in `research-price-context-20261025.json`.
