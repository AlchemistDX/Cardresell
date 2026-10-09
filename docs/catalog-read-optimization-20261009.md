# Catalog request efficiency — October 9, 2026

Simultaneous reads of the same catalog groups, set products, or set prices now share one running lookup within a server instance. The sharing key separates cache environments, credentials, categories, sets, and resource types. Each caller receives an independent result so sorting or enrichment cannot alter another scan's result.

This is bounded, per-instance request sharing, not a distributed lock or a persistent memory cache. Completed and failed requests leave the sharing table. At capacity, unrelated lookups continue normally. Existing durable cache TTLs remain: groups 24 hours, products 6 hours, prices 30 minutes.

Catalog cache commands now use POST bodies instead of putting serialized product data in URLs. Cache operations retain their three-second deadline, including body consumption, and cache failures do not discard usable provider results. The shared cache helper retains its shorter default for PriceCharting callers.

Provider responses without a results array fail rather than being cached as an empty catalog. Card matching, printing selection, price calculations, access rules, and subscription allowances are unchanged.

## Verification

Seven targeted offline suites passed:

- catalog-read-sharing: 217 assertions
- pricing-request-budget: 73 assertions
- variant-selection: 16 assertions
- bulk-bulbasaur-qualifier-2026-09-04: 72 assertions
- catalog-printing-evidence: 23 assertions
- launch-audit-regressions: 440 assertions
- quick-pricing: 219 assertions

The new concurrency tests cover twenty identical simultaneous requests, independent caller mutations, cache reuse, shared failures and recovery, cache/environment isolation, a product payload above 100 KB, cache outages, and capacity overflow. Network and cache responses are synthetic; these results do not establish production latency or dollar savings. No paid provider calls were needed for these checks.

The catalog remains partial. Existing physical-phone, live grading fallback, and fresh-user acceptance gates remain open; public admission restrictions and paid advertising readiness are unchanged.
