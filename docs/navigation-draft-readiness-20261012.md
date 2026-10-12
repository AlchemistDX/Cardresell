# Navigation restoration and draft wording — October 12, 2026

## Problem and fix

Live acceptance found that selecting Collection during startup could return the
seller to Lookup. The delayed `_restoreLastLoadedCard` callback explicitly
called `switchView('lookup')`. Remove that navigation from background restore;
the saved card and defensive second hydration continue to run.

Draft list and review screens described passing field checks as "Ready to
list", although seller photos, condition, asking price, shipping assumptions
and pricing provenance still need seller review. List rows now say "Draft
checks passed — review before listing"; review says "Draft checks passed" and
names those review steps. The existing validation, stale-detail handling,
blocking findings and copy controls are unchanged. Nothing publishes a listing.

The entry document references a new content-addressed core bundle. Previous
immutable assets are retained for already-open sessions and rollback.

## Verification

The restore regression first completed with four failures (Collection, Drafts,
Flips and Review were replaced by Lookup). After the fix all 20 checks passed,
including saved-card hydration and the delayed rehydration callback.

| Check | Passed |
| --- | ---: |
| Restore navigation | 20 |
| Draft review browser suite | 419 |
| Draft list browser suite | 102 |
| Server draft readiness | 115 |
| Asset fingerprints | 109 |
| Test registry | 12 |
| Total | 777 |

All suites completed with zero failures. The repository's `vercel-build`
command also passed locally; it is not an independent production-config build.
Tests used isolated synthetic fixtures, not customer balances or purchases.

Prepared against production commit
`a1bff81eb6a1d4ba8912e6aec7235eed9c037f79`. Production deployment and live
verification of this follow-up are not yet recorded here.

Public verified-customer admission is already live in deployment
`dpl_5vLJCuhvqUHJVesAF4GJiTKsLba6`; this change does not alter its settings.
That is the appropriate prior production artifact for rollback, not the older
pilot-only build. eBay sold-comps provider availability remains unresolved.
