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
echo "▶ [1/31] Asset fingerprints (referenced bundles named after their bytes)"
if node "$ROOT/tests/asset-fingerprints.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [2/31] Syntax check (all inline <script> blocks)"
if node "$ROOT/tests/syntax-check.js"; then
  echo "  passed"
else
  echo "  FAILED"; FAIL=1
fi

echo ""
echo "▶ [3/31] Auth stack integrity"
if node "$ROOT/tests/auth-integrity.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [4/31] Scan-miss regression checks"
if node "$ROOT/tests/scan-miss.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [5/31] Deeplink + companion links (TCGplayer product URL, eBay sell CTAs)"
if node "$ROOT/tests/deeplink-companions.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [6/31] Copy truth checks"
if node "$ROOT/tests/copy-truth-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [7/31] Fee truth checks"
if node "$ROOT/tests/fee-truth-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [8/31] Stripe webhook P0 checks"
if node "$ROOT/tests/webhook-p0-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [9/31] Launch-audit regressions"
if node "$ROOT/tests/launch-audit-regressions.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [10/31] Variant selection (premium-printing bias)"
if node "$ROOT/tests/variant-selection.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [11/31] Sports price guard (host + parallel discipline)"
if node "$ROOT/tests/sports-price-guard.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [12/31] Quick Pricing + headline price"
if node "$ROOT/tests/quick-pricing.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [13/31] Sports parallel matching"
if node "$ROOT/tests/sports-parallel.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [14/31] Scanner fastpath + miss-logging"
if node "$ROOT/tests/scanner-fastpath.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [15/31] eBay auth + taxonomy (offline)"
if node "$ROOT/tests/ebay-auth-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [16/31] Card identity + SKU golden tests"
if node "$ROOT/tests/sku-identity.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [17/31] Sell entry point eligibility (D1 gate, offline)"
if node "$ROOT/tests/sell-eligibility.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [18/31] Sell gate: out-of-order responses + wire size (D1, offline)"
if node "$ROOT/tests/sell-gate-ordering.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [19/31] Listing packet: title + condition + target-net + metadata (offline)"
if node "$ROOT/tests/listing-packet-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [20/31] Draft index recovery + packet schema version (offline)"
if node "$ROOT/tests/draft-index-recovery.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [21/31] C1 draft store — revisions, tombstones, schema safety (offline)"
if node "$ROOT/tests/draft-store.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [22/31] C1 draft CRUD end-to-end — create/read/edit/delete (offline)"
if node "$ROOT/tests/draft-crud-e2e.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [23/31] C2/C3 draft list + cap — hydration, paging, severity (offline)"
if node "$ROOT/tests/draft-list-cap.mjs"; then
  :
else
  FAIL=1
fi

echo ""
if [[ "${DRAFT_KV_LIVE:-0}" == "1" ]]; then
  echo "▶ [24/31] C1 draft persistence against the REAL store"
  if node "$ROOT/tests/draft-kv-live.mjs"; then
    :
  else
    FAIL=1
  fi
else
  echo "▶ [24/31] C1 real-store pass — SKIPPED (set DRAFT_KV_LIVE=1 + KV_REST_API_* to run)"
fi

if [[ "$LOCAL_ONLY" == "0" ]]; then
  echo ""
  echo "▶ [25/31] Prod endpoint smoke ($BASE)"
  if node "$ROOT/tests/endpoints-smoke.js" "--base=$BASE"; then
    :
  else
    FAIL=1
  fi
else
  echo ""
  echo "▶ [25/31] Prod endpoint smoke — SKIPPED (--local)"
fi

echo ""
if [[ "${COND_PILLS_BROWSER:-0}" == "1" ]]; then
  echo "▶ [26/31] Condition-applicability interaction (real browser)"
  if node "$ROOT/tests/condition-applicability.mjs"; then
    :
  else
    FAIL=1
  fi
else
  echo "▶ [26/31] Condition-applicability interaction — SKIPPED (set COND_PILLS_BROWSER=1 + serve the site at SITE_BASE to run)"
fi

echo ""
echo "▶ [27/31] D2.1 draft-list readiness (derivation + copy ownership)"
if node "$ROOT/tests/draft-readiness.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [28/31] D2.1 draft-list focus parameter (offset resolution + refusal)"
if node "$ROOT/tests/draft-focus.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [29/31] D2.1 drafts screen in a real browser (rows, blockers, stubs, no-nav)"
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
echo "▶ [30/31] D3 draft review screen (fields, fee breakdown, freshness, TRS withholding)"
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
echo "▶ [31/31] Top Rated Plus confirmation is scoped to one listing (4 acceptance states)"
if node "$ROOT/tests/trs-listing-scope.mjs"; then
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
