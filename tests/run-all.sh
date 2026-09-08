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

echo "════════════════════════════════════════════════════"
echo "  CardResell regression suite"
echo "════════════════════════════════════════════════════"

echo ""
echo "▶ [1/48] Asset fingerprints (referenced bundles named after their bytes)"
if node "$ROOT/tests/asset-fingerprints.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [2/48] Syntax check (all inline <script> blocks)"
if node "$ROOT/tests/syntax-check.js"; then
  echo "  passed"
else
  echo "  FAILED"; FAIL=1
fi

echo ""
echo "▶ [3/48] Auth stack integrity"
if node "$ROOT/tests/auth-integrity.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [4/48] Scan-miss regression checks"
if node "$ROOT/tests/scan-miss.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [5/48] Deeplink + companion links (TCGplayer product URL, eBay sell CTAs)"
if node "$ROOT/tests/deeplink-companions.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [6/48] Copy truth checks"
if node "$ROOT/tests/copy-truth-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [7/48] Fee truth checks"
if node "$ROOT/tests/fee-truth-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [8/48] Stripe webhook P0 checks"
if node "$ROOT/tests/webhook-p0-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [9/48] Launch-audit regressions"
if node "$ROOT/tests/launch-audit-regressions.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [10/48] Variant selection (premium-printing bias)"
if node "$ROOT/tests/variant-selection.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [11/48] Sports price guard (host + parallel discipline)"
if node "$ROOT/tests/sports-price-guard.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [12/48] Quick Pricing + headline price"
if node "$ROOT/tests/quick-pricing.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [13/48] Sports parallel matching"
if node "$ROOT/tests/sports-parallel.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [14/48] Scanner fastpath + miss-logging"
if node "$ROOT/tests/scanner-fastpath.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [15/48] eBay auth + taxonomy (offline)"
if node "$ROOT/tests/ebay-auth-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [16/48] Card identity + SKU golden tests"
if node "$ROOT/tests/sku-identity.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [17/48] Sell entry point eligibility (D1 gate, offline)"
if node "$ROOT/tests/sell-eligibility.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [18/48] Sell gate: out-of-order responses + wire size (D1, offline)"
if node "$ROOT/tests/sell-gate-ordering.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [19/48] Listing packet: title + condition + target-net + metadata (offline)"
if node "$ROOT/tests/listing-packet-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [20/48] Draft index recovery + packet schema version (offline)"
if node "$ROOT/tests/draft-index-recovery.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [21/48] C1 draft store — revisions, tombstones, schema safety (offline)"
if node "$ROOT/tests/draft-store.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [22/48] C1 draft CRUD end-to-end — create/read/edit/delete (offline)"
if node "$ROOT/tests/draft-crud-e2e.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [23/48] C2/C3 draft list + cap — hydration, paging, severity (offline)"
if node "$ROOT/tests/draft-list-cap.mjs"; then
  :
else
  FAIL=1
fi

echo ""
if [[ "${DRAFT_KV_LIVE:-0}" == "1" ]]; then
  echo "▶ [24/48] C1 draft persistence against the REAL store"
  if node "$ROOT/tests/draft-kv-live.mjs"; then
    :
  else
    FAIL=1
  fi
else
  echo "▶ [24/48] C1 real-store pass — SKIPPED (set DRAFT_KV_LIVE=1 + KV_REST_API_* to run)"
fi

if [[ "$LOCAL_ONLY" == "0" ]]; then
  echo ""
  echo "▶ [25/48] Prod endpoint smoke ($BASE)"
  if node "$ROOT/tests/endpoints-smoke.js" "--base=$BASE"; then
    :
  else
    FAIL=1
  fi
else
  echo ""
  echo "▶ [25/48] Prod endpoint smoke — SKIPPED (--local)"
fi

echo ""
if [[ "${COND_PILLS_BROWSER:-0}" == "1" ]]; then
  echo "▶ [26/48] Condition-applicability interaction (real browser)"
  if node "$ROOT/tests/condition-applicability.mjs"; then
    :
  else
    FAIL=1
  fi
else
  echo "▶ [26/48] Condition-applicability interaction — SKIPPED (set COND_PILLS_BROWSER=1 + serve the site at SITE_BASE to run)"
fi

echo ""
echo "▶ [27/48] D2.1 draft-list readiness (derivation + copy ownership)"
if node "$ROOT/tests/draft-readiness.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [28/48] D2.1 draft-list focus parameter (offset resolution + refusal)"
if node "$ROOT/tests/draft-focus.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [29/48] D2.1 drafts screen in a real browser (rows, blockers, stubs, no-nav)"
if node "$ROOT/tests/draft-list-screen.mjs"; then
  :
else
  FAIL=1
fi

echo ""
# 2026-09-07. Registered as D3 step 6 closeout. The suite existed and was green
# from step 2 onward but was only ever run by hand, so nothing here would have
# noticed it going red -- an unregistered suite is a suite that protects
# whichever branch the author last remembered to run it on.
echo "▶ [30/48] D3 draft review screen (fields, fee breakdown, freshness, TRS withholding)"
if node "$ROOT/tests/draft-review-screen.mjs"; then
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
echo "▶ [31/48] Top Rated Plus confirmation is scoped to one listing (4 acceptance states)"
if node "$ROOT/tests/trs-listing-scope.mjs"; then
  :
else
  FAIL=1
fi

# 2026-09-07: These two were written, passed, and were NOT wired in here -- the
# session record claimed contrast-tokens was "registered" when only its pass
# count had ever been observed by hand. A suite that is never invoked by the
# runner is not a guard, it is a file. Registering both, and renumbering to 33.
echo "▶ [32/48] Theme token contrast meets AA in both themes (runtime-resolved)"
if node "$ROOT/tests/contrast-tokens.mjs"; then
  :
else
  FAIL=1
fi

# Bidirectional: a venue missing from either side, or a date that disagrees
# across the two surfaces, is a published claim the code no longer backs.
echo "▶ [33/48] accuracy.html and the fee model agree on venues and audit dates"
if node "$ROOT/tests/accuracy-fee-parity.mjs"; then
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
echo "▶ [34/48] Review-screen fee rows are a dt/dd list with the withheld pair intact"
if node "$ROOT/tests/review-fee-dl.mjs"; then
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
echo "▶ [35/48] SOL-PLAT-007 asset extraction — inline JS/CSS stays split and hashed"
if node "$ROOT/tests/asset-extraction-2026-09-05.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [36/48] Sol-audit blockers — executes the shipped logic, not its text"
if node "$ROOT/tests/sol-remediation-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [37/48] Sol majors — flip and pack"
if node "$ROOT/tests/majors-flip-and-pack-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [38/48] Sol majors — data durability and tombstones"
if node "$ROOT/tests/durability-tombstones-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [39/48] Sol majors — scan hygiene"
if node "$ROOT/tests/scan-hygiene-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [40/48] Sol majors — entitlements and session integrity"
if node "$ROOT/tests/entitlements-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [41/48] Sol majors — accessibility, mobile targets, honest copy"
if node "$ROOT/tests/a11y-mobile-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [42/48] SOL-PLAT-011/012/013 — gold text AA, social meta, absolute og:url"
if node "$ROOT/tests/minors-011-012-013-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [43/48] Bulk-scan misfire — two bugs, four fixes"
if node "$ROOT/tests/bulk-scan-misfire.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [44/48] Bulk row regression — Bulbasaur qualifier"
if node "$ROOT/tests/bulk-bulbasaur-qualifier-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [45/48] Bulk row regression — Minun set/variant misfire"
if node "$ROOT/tests/bulk-minun-misfire-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [46/48] Grading upside: net comes from the shared fee model (BIAS-1)"
if node "$ROOT/tests/grading-upside-fees.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [47/48] Payout honesty: signed payout bars + four-state cost records (BIAS-6)"
if node "$ROOT/tests/payout-honesty.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [48/48] Every suite on disk is invoked or declared; slot numbering is derived"
if node "$ROOT/tests/test-registry.mjs"; then
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
