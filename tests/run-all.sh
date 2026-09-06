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
echo "▶ [1/18] Syntax check (all inline <script> blocks)"
if node "$ROOT/tests/syntax-check.js"; then
  echo "  passed"
else
  echo "  FAILED"; FAIL=1
fi

echo ""
echo "▶ [2/18] Auth stack integrity"
if node "$ROOT/tests/auth-integrity.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [3/18] Scan-miss regression checks"
if node "$ROOT/tests/scan-miss.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [4/18] Deeplink + companion links (TCGplayer product URL, eBay sell CTAs)"
if node "$ROOT/tests/deeplink-companions.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [5/18] Copy truth checks"
if node "$ROOT/tests/copy-truth-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [6/18] Fee truth checks"
if node "$ROOT/tests/fee-truth-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [7/18] Stripe webhook P0 checks"
if node "$ROOT/tests/webhook-p0-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [8/18] Launch-audit regressions"
if node "$ROOT/tests/launch-audit-regressions.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [9/18] Variant selection (premium-printing bias)"
if node "$ROOT/tests/variant-selection.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [10/18] Sports price guard (host + parallel discipline)"
if node "$ROOT/tests/sports-price-guard.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [11/18] Quick Pricing + headline price"
if node "$ROOT/tests/quick-pricing.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [12/18] Sports parallel matching"
if node "$ROOT/tests/sports-parallel.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [13/18] Scanner fastpath + miss-logging"
if node "$ROOT/tests/scanner-fastpath.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [14/18] eBay auth + taxonomy (offline)"
if node "$ROOT/tests/ebay-auth-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [15/18] Card identity + SKU golden tests"
if node "$ROOT/tests/sku-identity.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [16/18] Listing packet: title + condition + target-net + metadata (offline)"
if node "$ROOT/tests/listing-packet-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [17/18] Draft index recovery + packet schema version (offline)"
if node "$ROOT/tests/draft-index-recovery.mjs"; then
  :
else
  FAIL=1
fi

if [[ "$LOCAL_ONLY" == "0" ]]; then
  echo ""
  echo "▶ [18/18] Prod endpoint smoke ($BASE)"
  if node "$ROOT/tests/endpoints-smoke.js" "--base=$BASE"; then
    :
  else
    FAIL=1
  fi
else
  echo ""
  echo "▶ [18/18] Prod endpoint smoke — SKIPPED (--local)"
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
