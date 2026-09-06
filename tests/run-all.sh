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
echo "▶ [1/27] Asset fingerprints (referenced bundles named after their bytes)"
if node "$ROOT/tests/asset-fingerprints.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [2/27] Syntax check (all inline <script> blocks)"
if node "$ROOT/tests/syntax-check.js"; then
  echo "  passed"
else
  echo "  FAILED"; FAIL=1
fi

echo ""
echo "▶ [3/27] Auth stack integrity"
if node "$ROOT/tests/auth-integrity.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [4/27] Scan-miss regression checks"
if node "$ROOT/tests/scan-miss.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [5/27] Deeplink + companion links (TCGplayer product URL, eBay sell CTAs)"
if node "$ROOT/tests/deeplink-companions.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [6/27] Copy truth checks"
if node "$ROOT/tests/copy-truth-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [7/27] Fee truth checks"
if node "$ROOT/tests/fee-truth-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [8/27] Stripe webhook P0 checks"
if node "$ROOT/tests/webhook-p0-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [9/27] Launch-audit regressions"
if node "$ROOT/tests/launch-audit-regressions.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [10/27] Variant selection (premium-printing bias)"
if node "$ROOT/tests/variant-selection.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [11/27] Sports price guard (host + parallel discipline)"
if node "$ROOT/tests/sports-price-guard.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [12/27] Quick Pricing + headline price"
if node "$ROOT/tests/quick-pricing.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [13/27] Sports parallel matching"
if node "$ROOT/tests/sports-parallel.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [14/27] Scanner fastpath + miss-logging"
if node "$ROOT/tests/scanner-fastpath.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [15/27] eBay auth + taxonomy (offline)"
if node "$ROOT/tests/ebay-auth-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [16/27] Card identity + SKU golden tests"
if node "$ROOT/tests/sku-identity.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [17/27] Sell entry point eligibility (D1 gate, offline)"
if node "$ROOT/tests/sell-eligibility.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [18/27] Sell gate: out-of-order responses + wire size (D1, offline)"
if node "$ROOT/tests/sell-gate-ordering.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [19/27] Listing packet: title + condition + target-net + metadata (offline)"
if node "$ROOT/tests/listing-packet-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [20/27] Draft index recovery + packet schema version (offline)"
if node "$ROOT/tests/draft-index-recovery.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [21/27] C1 draft store — revisions, tombstones, schema safety (offline)"
if node "$ROOT/tests/draft-store.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [22/27] C1 draft CRUD end-to-end — create/read/edit/delete (offline)"
if node "$ROOT/tests/draft-crud-e2e.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [23/27] C2/C3 draft list + cap — hydration, paging, severity (offline)"
if node "$ROOT/tests/draft-list-cap.mjs"; then
  :
else
  FAIL=1
fi

echo ""
if [[ "${DRAFT_KV_LIVE:-0}" == "1" ]]; then
  echo "▶ [24/27] C1 draft persistence against the REAL store"
  if node "$ROOT/tests/draft-kv-live.mjs"; then
    :
  else
    FAIL=1
  fi
else
  echo "▶ [24/27] C1 real-store pass — SKIPPED (set DRAFT_KV_LIVE=1 + KV_REST_API_* to run)"
fi

if [[ "$LOCAL_ONLY" == "0" ]]; then
  echo ""
  echo "▶ [25/27] Prod endpoint smoke ($BASE)"
  if node "$ROOT/tests/endpoints-smoke.js" "--base=$BASE"; then
    :
  else
    FAIL=1
  fi
else
  echo ""
  echo "▶ [25/27] Prod endpoint smoke — SKIPPED (--local)"
fi

echo ""
if [[ "${COND_PILLS_BROWSER:-0}" == "1" ]]; then
  echo "▶ [26/27] Condition-applicability interaction (real browser)"
  if node "$ROOT/tests/condition-applicability.mjs"; then
    :
  else
    FAIL=1
  fi
else
  echo "▶ [26/27] Condition-applicability interaction — SKIPPED (set COND_PILLS_BROWSER=1 + serve the site at SITE_BASE to run)"
fi

echo ""
echo "▶ [27/27] D2.1 draft-list readiness (derivation + copy ownership)"
if node "$ROOT/tests/draft-readiness-2026-09-06.mjs"; then
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
