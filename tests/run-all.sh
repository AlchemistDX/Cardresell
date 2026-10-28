#!/usr/bin/env bash
# Full regression suite for CardResell. Run before every push.
#
# Usage:
#   ./tests/run-all.sh              # all local checks + prod smoke
#   ./tests/run-all.sh --local      # skip prod smoke (offline mode)
#   ./tests/run-all.sh --base=URL   # smoke against a different base

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

LOCAL_ONLY=0
BASE="https://www.cardresell.org"
for arg in "$@"; do
  case "$arg" in
    --local) LOCAL_ONLY=1 ;;
    --base=*) BASE="${arg#--base=}" ;;
  esac
done

FAIL=0

# ── How a suite is judged ───────────────────────────────────────────────────
#
# A PASS REQUIRES THREE THINGS: the suite completed normally, it reported zero
# failures, and the process exited 0. Exit status alone is not enough, and this
# runner learned that the hard way twice: two suites crashed before their first
# assertion and printed a stack with no summary, and for several commits that
# read as "not run" rather than "dead".
#
#   * TIMEOUT    -- a hung suite never returns, so the whole run used to hang
#                   with no verdict. `timeout` converts that into a failure.
#   * NO MARKER  -- an .mjs suite that ends without printing SUITE COMPLETE
#                   ended early. Recorded as a failure regardless of its exit
#                   status, because a crash that happens to exit 0 is the case
#                   the marker exists for.
#   * SKIPPED    -- a suite that says so explicitly (a live suite without its
#                   opt-in variable). Not a pass and not a failure.
#
# Output is teed, not swallowed, so the run still streams. `set -o pipefail` is
# what makes the pipeline carry node's status rather than tee's -- without it
# every suite in this file would report success.
SUITE_TIMEOUT="${SUITE_TIMEOUT:-900}"

suite() {
  local path="$1"; shift
  local name; name="$(basename "$path")"
  local out; out="$(mktemp)"
  local rc=0
  timeout -k 10 "$SUITE_TIMEOUT" node "$path" "$@" 2>&1 | tee "$out" || rc=$?

  if [[ "$rc" == "124" || "$rc" == "137" ]]; then
    echo "  ❌ TIMEOUT after ${SUITE_TIMEOUT}s — $name never finished. A hung suite is a failed suite."
    rm -f "$out"; return 1
  fi

  if grep -q 'SUITE SKIPPED' "$out"; then
    echo "  ⏭ $name skipped by its own gate — no assertions ran, this is not a pass"
    rm -f "$out"; return 0
  fi

  # Only .mjs suites report completion. The older .js checks predate the marker
  # and are judged on exit status alone; that limitation is stated rather than
  # papered over.
  if [[ "$path" == *.mjs ]] && ! grep -q 'SUITE COMPLETE' "$out"; then
    echo "  ❌ NO COMPLETION MARKER — $name ended before its end (exit=$rc). Everything after the failure point is UNTESTED, not passing."
    rm -f "$out"; return 1
  fi

  rm -f "$out"
  [[ "$rc" == "0" ]]
}

echo "════════════════════════════════════════════════════"
echo "  CardResell regression suite"
echo "════════════════════════════════════════════════════"

echo ""
echo "▶ [1/172] Asset fingerprints (referenced bundles named after their bytes)"
if suite "$ROOT/tests/asset-fingerprints.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [2/172] membership-venue-access"
if suite "$ROOT/tests/membership-venue-access.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [3/172] scan-input-reset"
if suite "$ROOT/tests/scan-input-reset.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [4/172] scan-request-recovery"
if suite "$ROOT/tests/scan-request-recovery.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [5/172] Syntax check (all inline <script> blocks)"
if suite "$ROOT/tests/syntax-check.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [6/172] Auth stack integrity"
if suite "$ROOT/tests/auth-integrity.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [7/172] Scan-miss regression checks"
if suite "$ROOT/tests/scan-miss.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [8/172] Deeplink + companion links (TCGplayer product URL, eBay sell CTAs)"
if suite "$ROOT/tests/deeplink-companions.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [9/172] Copy truth checks"
if suite "$ROOT/tests/copy-truth-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [10/172] Fee truth checks"
if suite "$ROOT/tests/fee-truth-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [11/172] Stripe webhook P0 checks"
if suite "$ROOT/tests/webhook-p0-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [12/172] Launch-audit regressions"
if suite "$ROOT/tests/launch-audit-regressions.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [13/172] Variant selection (premium-printing bias)"
if suite "$ROOT/tests/variant-selection.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [14/172] Sports price guard (host + parallel discipline)"
if suite "$ROOT/tests/sports-price-guard.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [15/172] Quick Pricing + headline price"
if suite "$ROOT/tests/quick-pricing.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [16/172] Sports parallel matching"
if suite "$ROOT/tests/sports-parallel.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [17/172] Scanner fastpath + miss-logging"
if suite "$ROOT/tests/scanner-fastpath.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [18/172] eBay auth + taxonomy (offline)"
if suite "$ROOT/tests/ebay-auth-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [19/172] Card identity + SKU golden tests"
if suite "$ROOT/tests/sku-identity.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [20/172] Sell entry point eligibility (D1 gate, offline)"
if suite "$ROOT/tests/sell-eligibility.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [21/172] Sell gate: out-of-order responses + wire size (D1, offline)"
if suite "$ROOT/tests/sell-gate-ordering.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [22/172] Listing packet: title + condition + target-net + metadata (offline)"
if suite "$ROOT/tests/listing-packet-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [23/172] Draft index recovery + packet schema version (offline)"
if suite "$ROOT/tests/draft-index-recovery.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [24/172] C1 draft store — revisions, tombstones, schema safety (offline)"
if suite "$ROOT/tests/draft-store.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [25/172] C1 draft CRUD end-to-end — create/read/edit/delete (offline)"
if suite "$ROOT/tests/draft-crud-e2e.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [26/172] C2/C3 draft list + cap — hydration, paging, severity (offline)"
if suite "$ROOT/tests/draft-list-cap.mjs"; then
  :
else
  FAIL=1
fi

echo ""
if [[ "${DRAFT_KV_LIVE:-0}" == "1" ]]; then
  echo "▶ [27/172] C1 draft persistence against the REAL store"
  if suite "$ROOT/tests/draft-kv-live.mjs"; then
    :
  else
    FAIL=1
  fi
else
  echo "▶ [27/172] C1 real-store pass — SKIPPED (set DRAFT_KV_LIVE=1 + KV_REST_API_* to run)"
fi

if [[ "$LOCAL_ONLY" == "0" ]]; then
  echo ""
  echo "▶ [28/172] Prod endpoint smoke ($BASE)"
  if suite "$ROOT/tests/endpoints-smoke.js" "--base=$BASE"; then
    :
  else
    FAIL=1
  fi
else
  echo ""
  echo "▶ [28/172] Prod endpoint smoke — SKIPPED (--local)"
fi

echo ""
if [[ "${COND_PILLS_BROWSER:-0}" == "1" ]]; then
  echo "▶ [29/172] Condition-applicability interaction (real browser)"
  if suite "$ROOT/tests/condition-applicability.mjs"; then
    :
  else
    FAIL=1
  fi
else
  echo "▶ [29/172] Condition-applicability interaction — SKIPPED (set COND_PILLS_BROWSER=1 + serve the site at SITE_BASE to run)"
fi

echo ""
echo "▶ [30/172] D2.1 draft-list readiness (derivation + copy ownership)"
if suite "$ROOT/tests/draft-readiness.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [31/172] D2.1 draft-list focus parameter (offset resolution + refusal)"
if suite "$ROOT/tests/draft-focus.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [32/172] D2.1 drafts screen in a real browser (rows, blockers, stubs, no-nav)"
if suite "$ROOT/tests/draft-list-screen.mjs"; then
  :
else
  FAIL=1
fi

echo ""
# 2026-09-07. Registered as D3 step 6 closeout. The suite existed and was green
# from step 2 onward but was only ever run by hand, so nothing here would have
# noticed it going red -- an unregistered suite is a suite that protects
# whichever branch the author last remembered to run it on.
echo "▶ [33/172] D3 draft review screen (fields, fee breakdown, freshness, TRS withholding)"
if suite "$ROOT/tests/draft-review-screen.mjs"; then
  :
else
  FAIL=1
fi

echo ""
# 2026-09-07, third review. Registered in the same commit that fixed the bug it
# describes, because the bug was a SCOPE bug and no existing suite could see
# scope: the rule suite tests pure functions, and the screen suites test one
# render at a time. A confirmation leaking from one card to the next only shows
# up when a document survives across two listings and a reload.
echo "▶ [34/172] Top Rated Plus confirmation is scoped to one listing (4 acceptance states)"
if suite "$ROOT/tests/trs-listing-scope.mjs"; then
  :
else
  FAIL=1
fi

# 2026-09-07: These two were written, passed, and were NOT wired in here -- the
# session record claimed contrast-tokens was "registered" when only its pass
# count had ever been observed by hand. A suite that is never invoked by the
# runner is not a guard, it is a file. Registering both, and renumbering to 33.
echo "▶ [35/172] Theme token contrast meets AA in both themes (runtime-resolved)"
if suite "$ROOT/tests/contrast-tokens.mjs"; then
  :
else
  FAIL=1
fi

# Bidirectional: a venue missing from either side, or a date that disagrees
# across the two surfaces, is a published claim the code no longer backs.
echo "▶ [36/172] accuracy.html and the fee model agree on venues and audit dates"
if suite "$ROOT/tests/accuracy-fee-parity.mjs"; then
  :
else
  FAIL=1
fi

# The review screen's fee breakdown as a term/value list: T2.14's withheld
# discount pair, the qualifier's literal space (which CSS margin cannot supply
# to an accessible name), and the unpriced skeleton. Renders the block from the
# live bundle's own template text rather than restating the row order, so
# reordering or deleting a row fails here. Registered in the same commit that
# wrote it, rather than run by hand and wired in later -- the drift this
# runner's own comments document three separate times.
echo "▶ [37/172] Review-screen fee rows are a dt/dd list with the withheld pair intact"
if suite "$ROOT/tests/review-fee-dl.mjs"; then
  :
else
  FAIL=1
fi

# ── 2026-09-07: registered in bulk ───────────────────────────────────────────
# Eleven of these were written as regression guards for bugs that were actually
# fixed, then never wired in here. They passed when run by hand and drifted out
# of sight, which means every bug they pin could have returned silently. One of
# them (minors-011-012-013) was ALREADY RED and nobody knew -- an exact-count
# assertion that had gone stale in the safe direction. Registration is what
# turns a passing file into a guard. tests/test-registry.mjs now fails if a
# suite sits on disk without either an invocation here or a declared reason.

echo ""
echo "▶ [38/172] SOL-PLAT-007 asset extraction — inline JS/CSS stays split and hashed"
if suite "$ROOT/tests/asset-extraction-2026-09-05.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [39/172] Sol-audit blockers — executes the shipped logic, not its text"
if suite "$ROOT/tests/sol-remediation-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [40/172] Sol majors — flip and pack"
if suite "$ROOT/tests/majors-flip-and-pack-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [41/172] Sol majors — data durability and tombstones"
if suite "$ROOT/tests/durability-tombstones-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [42/172] Sol majors — scan hygiene"
if suite "$ROOT/tests/scan-hygiene-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [43/172] Sol majors — entitlements and session integrity"
if suite "$ROOT/tests/entitlements-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [44/172] Sol majors — accessibility, mobile targets, honest copy"
if suite "$ROOT/tests/a11y-mobile-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [45/172] SOL-PLAT-011/012/013 — gold text AA, social meta, absolute og:url"
if suite "$ROOT/tests/minors-011-012-013-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [46/172] Bulk-scan misfire — two bugs, four fixes"
if suite "$ROOT/tests/bulk-scan-misfire.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [47/172] Bulk row regression — Bulbasaur qualifier"
if suite "$ROOT/tests/bulk-bulbasaur-qualifier-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [48/172] Bulk row regression — Minun set/variant misfire"
if suite "$ROOT/tests/bulk-minun-misfire-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [49/172] Grading upside: net comes from the shared fee model (BIAS-1)"
if suite "$ROOT/tests/grading-upside-fees.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [50/172] Payout honesty: signed payout bars + four-state cost records (BIAS-6)"
if suite "$ROOT/tests/payout-honesty.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [51/172] Decision restatements — shipped copy still matches the decisions of record"
if suite "$ROOT/tests/decision-restatements.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [52/172] TPL proxy contract (offline, mocked upstream) [CH-3]"
if suite "$ROOT/tests/tpl-proxy-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [53/172] TPL cache + aggregate spending allowance (offline, mocked store) [CH-3/R4]"
if suite "$ROOT/tests/tpl-budget-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [54/172] eBay notification verification token fails closed [CH-2]"
if suite "$ROOT/tests/ebay-notify-token.mjs"; then
  :
else
  FAIL=1
fi

echo ""
# 2026-09-10: four suites sat on disk unregistered. draft-lifecycle guards the
# generation pointer every draft create is now compared against, and had been
# run by hand only. Registering all four; the registry suite stays last so it
# reports on the file it just checked.
echo "▶ [55/172] Draft lifecycle pointer — generations, reservations, fencing (offline)"
if suite "$ROOT/tests/draft-lifecycle.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [56/172] An omitted generation is legacy generation 0, then compared like any other"
if suite "$ROOT/tests/draft-generation-omission.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [57/172] Draft delete in a real browser — 410 shows the deleted state, no auto-retry"
if suite "$ROOT/tests/draft-delete-browser.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [58/172] TPL outcome rendering"
if suite "$ROOT/tests/tpl-outcome-render.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [59/172] Collection escaping: hostile values stay inside their attributes"
if suite "$ROOT/tests/collection-escaping-browser.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [60/172] Draft card actions in a real browser — edit, delete, download, desktop and 375px"
if suite "$ROOT/tests/draft-card-actions-browser.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [61/172] Batch drafting from Bulk/Rapid Scan in a real browser — scan identity, copies, retry, cap refusal"
if suite "$ROOT/tests/bulk-batch-draft.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [62/172] Collector number display — denominator safeguards, prefixes, leading zeros, SKU-neutrality"
if suite "$ROOT/tests/collector-number-format.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [63/172] Scan rarity grounding — the grounded record overrides an invented rarity"
if suite "$ROOT/tests/scan-rarity-grounding.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [64/172] Catalogue printing evidence — reject ambiguous or contradictory enrichment"
if suite "$ROOT/tests/catalog-printing-evidence.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [65/172] Cert generation matcher — no mislabelled generation, no entered value in output"
if suite "$ROOT/tests/cert-generation-compare.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [66/172] eBay credential checker output — no supplied credential or token on any path"
if suite "$ROOT/tests/ebay-credential-check.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [67/172] Seeder collector numbers — leading zeros and prefixes survive verbatim"
if suite "$ROOT/tests/seeder-collector-number.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [68/172] Printed denominator resolves without the filesystem; embedded table matches the seeder record"
if suite "$ROOT/tests/printed-totals-runtime-2026-09-13.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [69/172] Photo hosting contract — eBay’s documented photo-column limits, and no host configured yet"
if suite "$ROOT/tests/photo-host-2026-09-13.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [70/172] Photo upload endpoint — a non-owner cannot host another seller’s draft photos"
if suite "$ROOT/tests/photo-upload-endpoint-2026-09-13.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [71/172] Item photo URL is written, and a blank column is disclosed rather than claimed as sent"
if suite "$ROOT/tests/photo-export-wiring-2026-09-13.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [72/172] Draft-list Download button: seller photo lands or the file is refused (never blank)"
if suite "$ROOT/tests/photo-download-gating-2026-09-13.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [73/172] Photo decoding falls back without bypassing quality checks"
if suite "$ROOT/tests/photo-decoder-fallback.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [74/172] Provider request timers are cleared on failures"
if suite "$ROOT/tests/provider-timer-cleanup.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [75/172] Camera cancellation and late callbacks remain isolated"
if suite "$ROOT/tests/photo-capture-lifecycle.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [76/172] Firebase email verification and persistence"
if suite "$ROOT/tests/firebase-email-claim.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [77/172] Acquisition channel tracking and admin report protection"
if suite "$ROOT/tests/acquisition-tracking.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [78/172] Google provider verification for signed Google sessions"
if suite "$ROOT/tests/google-provider-verification.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [79/172] Grade model selection keeps the default and allowlist"
if suite "$ROOT/tests/grade-model-selection.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [80/172] Post-scan ID credit nudge counts included credits"
if suite "$ROOT/tests/id-credit-toast.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [81/172] Limiting factor keeps defect-driven explanations"
if suite "$ROOT/tests/limiting-factor-reconcile.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [82/172] Daily welcome-award circuit breaker"
if suite "$ROOT/tests/welcome-daily-cap.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [83/172] Ximilar grading uses the async job API"
if suite "$ROOT/tests/ximilar-grade-async.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [84/172] Grading: poor visibility is not damage"
if suite "$ROOT/tests/grade-evidence-honesty.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [85/172] Grading upside prices the graded printing"
if suite "$ROOT/tests/grade-upside-identity.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [86/172] Grading capture resolution and body budget"
if suite "$ROOT/tests/grade-capture-resolution.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [87/172] Client printing identity survives local artwork ambiguity"
if suite "$ROOT/tests/client-printing-evidence.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [168/172] Catalog completeness and cross-game printing selection"
if suite "$ROOT/tests/catalog-completeness.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [171/172] Magic catalog generation validation and safe retry"
if suite "$ROOT/tests/magic-catalog-integrity.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [170/172] Full Magic paper-printing offline recovery, split-face names and canonical UUIDs"
if suite "$ROOT/tests/magic-offline-fallback.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [169/172] Catalog recovery through scanner, details and inventory"
if suite "$ROOT/tests/catalog-scan-recovery.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [88/172] Catalog search exposes every printing page"
if suite "$ROOT/tests/catalog-search.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [89/172] Private AI grade report storage"
if suite "$ROOT/tests/grade-history.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [90/172] Batch grading browser to ledger and saved reports"
if suite "$ROOT/tests/batch-grade-browser.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [91/172] Collection sync failures and concurrent writes"
if suite "$ROOT/tests/collection-storage.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [92/172] Local catalog fallback has no invented prices"
if suite "$ROOT/tests/catalog-outage.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [93/172] Membership header tier badge"
if suite "$ROOT/tests/membership-header-badge.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [94/172] Business batch size (25) and plan-derived bulk grade cap"
if suite "$ROOT/tests/bulk-grade-plan-cap.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [95/172] Bulk photo preflight (no provider calls)"
if suite "$ROOT/tests/bulk-photo-preflight.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [96/172] Catalog read sharing"
if suite "$ROOT/tests/catalog-read-sharing.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [97/172] Collection drafts (real browser)"
if suite "$ROOT/tests/collection-drafts-browser.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [98/172] Draft plan capacity"
if suite "$ROOT/tests/draft-plan-capacity.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [99/172] eBay sold-comp resilience"
if suite "$ROOT/tests/ebay-sold-resilience.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [100/172] Pricing request budget"
if suite "$ROOT/tests/pricing-request-budget.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [101/172] Provider deadlines"
if suite "$ROOT/tests/provider-deadlines.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [102/172] Rapid Scan (real browser)"
if suite "$ROOT/tests/rapid-scan-browser.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [103/172] Scrydex pilot adapter (default off)"
if suite "$ROOT/tests/scrydex-pilot.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [104/172] TCG Price Lookup body deadline"
if suite "$ROOT/tests/tpl-body-deadline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [105/172] Grade prompt is cache-ordered (static rules first)"
if suite "$ROOT/tests/grade-prompt-cache-order.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [106/172] Ximilar sports retry only after a detected-card miss"
if suite "$ROOT/tests/ximilar-sport-retry.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [107/172] Ximilar match-distance telemetry (numbers only)"
if suite "$ROOT/tests/provider-match-distance.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [108/172] First-visit demo yields to any other card selection"
if suite "$ROOT/tests/example-demo-yields.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [109/172] Scan-miss Search by name reaches the real search box (real browser)"
if suite "$ROOT/tests/scan-miss-search-browser.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [110/172] Binder pockets pre-selected by local detail check (real browser)"
if suite "$ROOT/tests/binder-autoselect-browser.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [111/172] Bulk rows price the scanned printing; no same-photo retry on a definite miss"
if suite "$ROOT/tests/bulk-variant-choice.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [112/172] Several binder pages reviewed in turn, one bulk quote (real browser)"
if suite "$ROOT/tests/binder-multipage-browser.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [113/172] Owner test account: Business features only, credits and billing unchanged"
if suite "$ROOT/tests/owner-feature-plan.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [114/172] Magic misses rescued from the printed name, only within the batch's sets"
if suite "$ROOT/tests/bulk-text-rescue.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [115/172] Photo check before a grade is charged: flagged photos named, retake or grade anyway (real browser)"
if suite "$ROOT/tests/grade-photo-check-browser.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [116/172] Grade results explain moderate/low confidence and show centering beside the overall grade (real browser)"
if suite "$ROOT/tests/grade-result-explain-browser.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [117/172] Fee pills show schedule age and a pre-filled report link; Poshmark \$15 boundary (real browser)"
if suite "$ROOT/tests/fee-pill-report-browser.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [118/172] Search reuse, cancellation and truthful error handoff"
if suite "$ROOT/tests/search-workflow.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [119/172] Comp grants: one claim per grant, permanent credits, UID-bound Business features (local Redis)"
if suite "$ROOT/tests/membership-comp.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [120/172] Scan hash distance and full-catalog ranking parity"
if suite "$ROOT/tests/scan-hash-distance.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [121/172] Optional eBay buyer-tax assumption across the live UI"
if suite "$ROOT/tests/ebay-buyer-tax-browser.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [122/172] Collection CSV identity, estimates and selected copies"
if suite "$ROOT/tests/collection-export.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [123/172] Saved sales report, corrections and CSV downloads (real browser)"
if suite "$ROOT/tests/flip-report-browser.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [124/172] Bulk miss recovery, partial values and replacement-photo races"
if suite "$ROOT/tests/bulk-recovery-browser.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [125/172] Reviewed CSV inventory import and honest collection amounts"
if suite "$ROOT/tests/collection-import.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [126/172] Seller OAuth isolation, token lifecycle and signed deletion"
if suite "$ROOT/tests/ebay-seller-connect.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [127/172] Seller connection browser consent and setup checks"
if suite "$ROOT/tests/ebay-connect-browser.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [128/172] Reviewed batch defaults and recovery after interruption"
if suite "$ROOT/tests/collection-batch-recovery.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [129/172] eBay submission metadata, photo ownership and review recovery"
if suite "$ROOT/tests/ebay-listing-review.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [130/172] Direct eBay review in mobile and desktop browsers"
if suite "$ROOT/tests/ebay-listing-review-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [131/172] eBay physical-copy reservations and recoverable listing operations"
if suite "$ROOT/tests/ebay-listing-operations.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [132/172] eBay operation recovery in mobile and desktop browsers"
if suite "$ROOT/tests/ebay-listing-operations-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [133/172] Durable sold-copy identity and listing guards"
if suite "$ROOT/tests/copy-sales.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [134/172] Interrupted sales and cross-tab recovery in browsers"
if suite "$ROOT/tests/sale-recovery-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [135/172] Sale correction revisions and concurrent device protection"
if suite "$ROOT/tests/sale-reconciliation.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [136/172] Refunds, expenses and consistent profit in browsers"
if suite "$ROOT/tests/sale-reconciliation-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [137/172] Explicit sale choices and atomic recovery archives"
if suite "$ROOT/tests/sale-conflicts.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [138/172] Sale conflict review and recovery through browser, API and Redis"
if suite "$ROOT/tests/sale-conflicts-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [139/172] Per-field inventory protection and explicit recovery archives"
if suite "$ROOT/tests/inventory-details.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [140/172] Inventory editing, bulk location and recovery through browser, API and Redis"
if suite "$ROOT/tests/inventory-details-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [141/172] Reviewed backup recovery and atomic retry receipts"
if suite "$ROOT/tests/inventory-backup-recovery.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [142/172] Backup recovery through browser, API and Redis"
if suite "$ROOT/tests/inventory-backup-recovery-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [143/172] Import history, recovery guards and concurrent tabs through browser/API/Redis"
if suite "$ROOT/tests/import-history-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [144/172] ebay-search-links-browser"
if suite "$ROOT/tests/ebay-search-links-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [145/172] selling-selection-browser"
if suite "$ROOT/tests/selling-selection-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [146/172] ebay-recent-sales"
if suite "$ROOT/tests/ebay-recent-sales.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [147/172] Draft price integrity — selection recovery, snapshot, quote age and account refresh"
if suite "$ROOT/tests/draft-price-integrity-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [148/172] Draft selection handoff — saved choices and grade quote races"
if suite "$ROOT/tests/draft-selection-handoff-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [149/172] eBay reusable selling defaults and setup recovery"
if suite "$ROOT/tests/ebay-selling-defaults-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [150/172] Saved copy availability and listing export conflicts"
if suite "$ROOT/tests/listing-availability.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [151/172] Browser listing export and reservation recovery"
if suite "$ROOT/tests/listing-availability-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [152/172] Recognition provider contract and unsupported games"
if suite "$ROOT/tests/ximilar-contract.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [153/172] Scanner refund, printing handoff and picker UI audit"
if suite "$ROOT/tests/scanner-audit-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [154/172] Catalog deadlines cover response bodies"
if suite "$ROOT/tests/scanner-catalog-deadlines.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [155/172] Single scan review and cancellation recovery"
if suite "$ROOT/tests/single-scan-review-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [156/172] Collection CSV round-trip identity and historical receipts"
if suite "$ROOT/tests/collection-csv-roundtrip.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [157/172] Saved grade authentication and deadline recovery"
if suite "$ROOT/tests/grade-history-recovery.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [158/172] Comparable price evidence and exact graded matching"
if suite "$ROOT/tests/price-evidence.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [159/172] Price evidence through selling comparisons and drafts"
if suite "$ROOT/tests/selling-price-evidence-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [160/172] Account-bound seller authentication recovery"
if suite "$ROOT/tests/seller-auth-recovery.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [161/172] Seller dialog and listing export recovery"
if suite "$ROOT/tests/seller-auth-workflow-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [162/172] Authentication session and verification lifecycle"
if suite "$ROOT/tests/auth-session-lifecycle.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [163/172] Account handoff and sign-out through the shipped workspace"
if suite "$ROOT/tests/auth-session-workflow-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [164/172] draft-read-recovery"
if suite "$ROOT/tests/draft-read-recovery.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [165/172] draft-read-workflow-browser"
if suite "$ROOT/tests/draft-read-workflow-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [166/172] Selling priority and exact selected-copy workflow (real browser)"
if suite "$ROOT/tests/selling-next-step-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [172/172] Draft CSV tutorial and Seller Hub handoff (real browser)"
if suite "$ROOT/tests/draft-export-help-browser.mjs"; then
  :
else
  FAIL=1
fi

echo "▶ [167/172] Every suite on disk is invoked or declared; slot numbering is derived"
if suite "$ROOT/tests/test-registry.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "════════════════════════════════════════════════════"
if [[ "$FAIL" == "0" ]]; then
  echo "  ✅ ALL CHECKS PASSED — safe to push"
else
  echo "  ❌ FAILURES DETECTED — DO NOT PUSH"
fi
echo "════════════════════════════════════════════════════"

exit $FAIL
