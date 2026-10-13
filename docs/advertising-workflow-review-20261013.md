# CardResell advertising and workflow review

Reviewed October 13, 2026. This batch is implemented and tested locally. It has
not been pushed or deployed. The inspected production release is `ca463a5`
(Vercel deployment `dpl_2hDJeLiwYURih7e1g29BDWgYpmJx`).

## Changes ready to publish

| Visitor or seller problem | Change | Result |
| --- | --- | --- |
| Pressing Search repeats the autocomplete lookup | Share the matching in-flight search; reuse successful rows for up to 30 seconds while their original click targets remain valid | The tested autocomplete → full-results handoff uses one provider lookup, rather than starting another |
| An older search can finish after the query is cleared, replaced, or the game changes | Invalidate at the input boundary and check query, game and request identity before rendering | Late replies cannot replace the current results |
| A failed provider can become “No results found” in the full-screen catalog | Preserve the provider explanation; retain local-catalog limitations when filters change | Visitors can distinguish an outage from a genuine missing card |
| Picking cheap cards out of a collection takes repeated manual selection | Add All values, Under $5, $5 and above, and Missing value filters | A seller can compare the shown cards directly, or explicitly select them for draft preparation |
| Previously selected cards disappear behind a filter | Show the number selected outside the filter and offer “Keep only shown selections” | The seller can see exactly why a comparison includes more than the visible cards |
| Comparing a large selection repeatedly reads the collection | Read once and resolve the batch through one index; use a set when pruning selection | Less repeated storage parsing and array scanning, with ambiguous/missing IDs still refused |

The value filters use **saved estimates**, not new live appraisals. Exactly $5
belongs in “$5 and above”; a known zero belongs in “Under $5”; null, invalid and
missing values remain in their own queue. No saved card, price or balance is
changed by filtering or comparing. Existing membership and draft-cap checks
remain authoritative.

This release also incorporates the two corrections already prepared in the
outreach review: the methodology-page date matches its October 13 changelog,
and retired subscription links direct users to current plans without naming a
retired offer. Fee-verification dates are unchanged.

## Suggested seller workflow after release

1. Scan or look up cards, confirm the set/printing, and save them to Collection.
2. Open Collection → **Missing value**. Resolve those prices before relying on a
   collection total.
3. Choose **Under $5** → **Compare shown cards**. Enter a realistic lot price,
   postage, packing and purchase cost before comparing a lot with separate
   shipments. The displayed singles sum is not a dealer offer or a lot appraisal.
4. Use **$5 and above** and the per-card selling guidance to review cards that may
   justify individual listings. $5 is a convenient filter, not a guaranteed
   profitability threshold.
5. Select the cards to list → Prepare drafts → review selected drafts → download
   the handoff. Check photos, condition, price and shipping before publication.
   A downloaded file is not proof of an accepted marketplace import or listing.

Explicit selections take priority over a filter. Clear the selection or use
“Keep only shown selections” when changing the group you want to compare.

## Verification evidence

- The repository's **119-slot regression runner completed successfully**:
  **116 suites ran; three optional checks were skipped** (real-store validation,
  the runner's production HTTP probe, and the separately gated condition-pill
  interaction). Skips are not passes. Production HTTP was checked separately
  below.
- Search workflow: **20** controlled asynchronous checks, including shared
  requests, expiry, game changes, out-of-order replies, clearing, cancellation,
  provider failure and recovery.
- Search UI: **20** additional browser checks across 390px and 1280px, including
  correct card selection from reused results and retained outage disclosure.
- Collection UI: **72** browser checks across 390px and 1280px, including the
  value boundaries, filter/selection interaction, account changes, duplicate
  identity refusal, one storage read per comparison, and draft retry behavior.
- Final asset fingerprints: **117** checks passed. Previous immutable assets
  remain available; the entry document references newly hashed bundles.
- `npm run vercel-build` and `git diff --check` passed locally. The local build
  does not establish production configuration or a successful deployment.
- Production public endpoint smoke: **18 checks — 17 passed, one degraded,
  zero failed**. Automatic eBay sold-price retrieval remains unavailable.
- Live browser inspection confirmed search results, the fallback sold-listings
  link and the current subscription chooser. No new purchase, customer-account
  mutation, paid scan or physical-phone test was performed in this pass.

The first test attempt lacked the local Redis executable on PATH; a subsequent
attempt encountered this host's Unix-socket limitation. The final successful
run used the existing isolated loopback test mode with per-process credentials.
No production database was used or reconfigured.

## Advertising preparation and next efficiencies

Use the existing `advertising-launch-kit-20261013.md` for the ad copy, demo script,
channel links and measurement definitions. Provider permission outreach is
already settled by the owner's confirmation; do not reopen it.

| Priority | Next evidence or improvement | Why it matters |
| --- | --- | --- |
| Release | Publish this tested batch, then verify search and the new filters on the deployed build | Local passing checks do not make the changes live |
| Pilot economics | Reconcile provider usage and billed costs for completed ID/Quick/Deep operations, including retries and refunded attempts | A subscription price or a successful browser event does not establish contribution margin |
| Recovery monitoring | Confirm the first scheduled daily snapshot and its retention | Daily backups were enabled in the later October 12 work; a scheduled snapshot still needed confirmation |
| First cohort | Follow tagged visits, completed scans, drafts and fulfilled payments; separate QA and owner activity | Existing campaign counts are observed events, not unique customers or a joined conversion funnel |
| Initial page load | Profile and then separate infrequently used scan, grading and draft code from first-use lookup | The entry page currently loads 14 first-party JS files: 1,955,809 source bytes and about 604 KB with local gzip; the core bundle alone is about 1.49 MB before compression |
| Provider resilience | Restore automatic eBay sold data when the upstream service supports it | Current research links are useful but do not replace an automated sold-comps feed |

The payload figures are a local byte inventory, **not measured mobile load
times or actual CDN transfer sizes**. Splitting the large shared bundle should
be a separate measured change with load-order and offline/cached-client checks.

Recovery notes reconciliation: the isolated manual snapshot/restore and scoped
invariant checks were completed in `advertising-gates-20261012.md`. Its older
“Daily Backup OFF” statement predates the subsequent backup enablement. The
launch kit's instruction to complete the isolated drill also predates that
evidence. Do not repeat or claim a full application failover from the scoped
restore test. Scheduled-snapshot confirmation is a separate open item.

No ad campaign was activated. The earlier proposed $70 pilot remains a proposal,
not an approved spend. No company email was sent as part of this review.

## Release scope and rollback

Only client search/Collection behavior, two public-copy corrections, tests and
this review change. No fee arithmetic, membership entitlement, billing, storage
schema, customer data, provider credentials or marketplace publishing changes.
Roll back by restoring the prior deployed entry document and application
revision; retained immutable client assets support already-open sessions.

An earlier automatic approval review rejected publishing the outreach fixes
without explicit authorization. This batch is therefore ready for the owner's
approval to push and deploy, rather than being reported as already live.
