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
echo "▶ [1/13] Syntax check (all inline <script> blocks)"
if node "$ROOT/tests/syntax-check.js"; then
  echo "  passed"
else
  echo "  FAILED"; FAIL=1
fi

echo ""
echo "▶ [2/13] Auth stack integrity"
if node "$ROOT/tests/auth-integrity.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [3/13] Scan-miss regression checks"
if node "$ROOT/tests/scan-miss.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [4/13] Deeplink + companion links (TCGplayer product URL, eBay sell CTAs)"
if node "$ROOT/tests/deeplink-companions.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [5/13] Copy truth checks"
if node "$ROOT/tests/copy-truth-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [6/13] Fee truth checks"
if node "$ROOT/tests/fee-truth-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [7/13] Stripe webhook P0 checks"
if node "$ROOT/tests/webhook-p0-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [8/13] Launch-audit regressions"
if node "$ROOT/tests/launch-audit-regressions.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [9/13] Variant selection (premium-printing bias)"
if node "$ROOT/tests/variant-selection.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [10/13] Sports price guard (host + parallel discipline)"
if node "$ROOT/tests/sports-price-guard.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [11/13] Quick Pricing + headline price"
if node "$ROOT/tests/quick-pricing.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [12/13] Scanner fastpath + miss-logging"
if node "$ROOT/tests/scanner-fastpath.mjs"; then
  :
else
  FAIL=1
fi

if [[ "$LOCAL_ONLY" == "0" ]]; then
  echo ""
  echo "▶ [13/13] Prod endpoint smoke ($BASE)"
  if node "$ROOT/tests/endpoints-smoke.js" "--base=$BASE"; then
    :
  else
    FAIL=1
  fi
else
  echo ""
  echo "▶ [13/13] Prod endpoint smoke — SKIPPED (--local)"
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
