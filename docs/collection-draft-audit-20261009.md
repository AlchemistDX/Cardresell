# Collection draft preparation and draft-system audit — 2026-10-09

## Shipped behavior

Collection now has search, per-card checkboxes, Select visible, Clear selection,
Prepare drafts, and View drafts. Selection survives filtering. Each card reports
its outcome and successful saves have an Open draft action. Cards stay in Collection.

The Collection action uses the existing `inst_col_<row id>` identity and the same
single-card idempotency key. Repeated selection adopts saved drafts. Pending retries
retain their original key, generation, bulk manifest, and wire payload. Ambiguous
row IDs are refused. Account changes abort further writes and clear selection.

Existing server policy remains authoritative: Free individual preparation;
Starter 10, Casual 25, Pro 100, Business 500 cards per action. Simultaneous saved
draft limits remain 5 / 25 / 100 / 500 / 2,000 respectively. No pricing or credit
changes. Over-limit selections are preserved, not silently split. Capacity and
uncertain-save failures stop later creates; per-card failures stay selected.

Shared create-client corrections:

- A lost response says saving could not be confirmed, rather than claiming nothing
  was saved. Retry recovers the original operation.
- Malformed successful responses retain pending identity rather than claiming a
  draft exists without a valid server draft ID.
- Pending payloads are serialized snapshots; later object edits cannot change retries.
- Collection DOM IDs escape seller/imported row identifiers.

## Verification

| Suite | Passed |
| --- | ---: |
| Collection selection, mobile and desktop Chromium | 44 |
| Bulk drafts, including Collection through real HTTP handlers | 102 |
| Per-plan capacity and admission, real Redis | 69 |
| Draft create/read/update/delete | 239 |
| Lifecycle Lua, isolated real Redis | 58 |
| Draft store | 147 |
| Index recovery | 265 |
| List capacity | 130 |
| Omitted-generation recovery | 52 |
| Draft list browser | 102 |
| Draft review browser | 417 |
| Draft deletion browser | 113 |
| Draft card actions/mobile browser | 88 |
| Export through real HTTP handlers/browser | 111 |
| Offline listing packets | 472 |
| Local photo attachments | 171 |
| Collection escaping browser | 23 |
| Collection storage | 24 |
| Referenced asset fingerprints | 109 |

Release inspection and JavaScript syntax checks passed. Mobile and desktop
Collection screenshots were inspected. Paid identification/grading providers,
live customer records, and real marketplace publishing were not used in tests.

Older test infrastructure was repaired: portable Playwright resolution and
Chromium override, current Upstash-compatible synthetic hostnames, POST command
transport and uppercase Redis commands. Successful response fixtures now use
real-format draft IDs. Bulk assertions distinguish manifests from per-card
creates, locate saved cards by identity rather than completion order, and verify
that a duplicate-copy manifest is rejected before any write. The lifecycle test
now starts its own isolated Redis instead of waiting for a pre-existing service.
Initial setup/fixture failures were rerun to completion; no failing assertions
were counted as passes.

## Scope and remaining release gates

These are saved drafts, listing packets, and exports; this change adds no direct
marketplace publication. Marketplace import acceptance still requires a seller
account check. Physical iPhone camera acceptance, natural live provider fallback,
live welcome/checkout verification, and grading cost margins remain separate
launch gates. Scrydex remains disabled pending provider setup. Catalog coverage
remains partial. This draft audit does not certify those unrelated gates.
