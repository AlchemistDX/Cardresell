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
echo "▶ [1/57] Asset fingerprints (referenced bundles named after their bytes)"
if suite "$ROOT/tests/asset-fingerprints.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [2/57] Syntax check (all inline <script> blocks)"
if suite "$ROOT/tests/syntax-check.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [3/57] Auth stack integrity"
if suite "$ROOT/tests/auth-integrity.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [4/57] Scan-miss regression checks"
if suite "$ROOT/tests/scan-miss.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [5/57] Deeplink + companion links (TCGplayer product URL, eBay sell CTAs)"
if suite "$ROOT/tests/deeplink-companions.js"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [6/57] Copy truth checks"
if suite "$ROOT/tests/copy-truth-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [7/57] Fee truth checks"
if suite "$ROOT/tests/fee-truth-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [8/57] Stripe webhook P0 checks"
if suite "$ROOT/tests/webhook-p0-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [9/57] Launch-audit regressions"
if suite "$ROOT/tests/launch-audit-regressions.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [10/57] Variant selection (premium-printing bias)"
if suite "$ROOT/tests/variant-selection.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [11/57] Sports price guard (host + parallel discipline)"
if suite "$ROOT/tests/sports-price-guard.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [12/57] Quick Pricing + headline price"
if suite "$ROOT/tests/quick-pricing.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [13/57] Sports parallel matching"
if suite "$ROOT/tests/sports-parallel.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [14/57] Scanner fastpath + miss-logging"
if suite "$ROOT/tests/scanner-fastpath.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [15/57] eBay auth + taxonomy (offline)"
if suite "$ROOT/tests/ebay-auth-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [16/57] Card identity + SKU golden tests"
if suite "$ROOT/tests/sku-identity.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [17/57] Sell entry point eligibility (D1 gate, offline)"
if suite "$ROOT/tests/sell-eligibility.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [18/57] Sell gate: out-of-order responses + wire size (D1, offline)"
if suite "$ROOT/tests/sell-gate-ordering.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [19/57] Listing packet: title + condition + target-net + metadata (offline)"
if suite "$ROOT/tests/listing-packet-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [20/57] Draft index recovery + packet schema version (offline)"
if suite "$ROOT/tests/draft-index-recovery.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [21/57] C1 draft store — revisions, tombstones, schema safety (offline)"
if suite "$ROOT/tests/draft-store.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [22/57] C1 draft CRUD end-to-end — create/read/edit/delete (offline)"
if suite "$ROOT/tests/draft-crud-e2e.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [23/57] C2/C3 draft list + cap — hydration, paging, severity (offline)"
if suite "$ROOT/tests/draft-list-cap.mjs"; then
  :
else
  FAIL=1
fi

echo ""
if [[ "${DRAFT_KV_LIVE:-0}" == "1" ]]; then
  echo "▶ [24/57] C1 draft persistence against the REAL store"
  if suite "$ROOT/tests/draft-kv-live.mjs"; then
    :
  else
    FAIL=1
  fi
else
  echo "▶ [24/57] C1 real-store pass — SKIPPED (set DRAFT_KV_LIVE=1 + KV_REST_API_* to run)"
fi

if [[ "$LOCAL_ONLY" == "0" ]]; then
  echo ""
  echo "▶ [25/57] Prod endpoint smoke ($BASE)"
  if suite "$ROOT/tests/endpoints-smoke.js" "--base=$BASE"; then
    :
  else
    FAIL=1
  fi
else
  echo ""
  echo "▶ [25/57] Prod endpoint smoke — SKIPPED (--local)"
fi

echo ""
if [[ "${COND_PILLS_BROWSER:-0}" == "1" ]]; then
  echo "▶ [26/57] Condition-applicability interaction (real browser)"
  if suite "$ROOT/tests/condition-applicability.mjs"; then
    :
  else
    FAIL=1
  fi
else
  echo "▶ [26/57] Condition-applicability interaction — SKIPPED (set COND_PILLS_BROWSER=1 + serve the site at SITE_BASE to run)"
fi

echo ""
echo "▶ [27/57] D2.1 draft-list readiness (derivation + copy ownership)"
if suite "$ROOT/tests/draft-readiness.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [28/57] D2.1 draft-list focus parameter (offset resolution + refusal)"
if suite "$ROOT/tests/draft-focus.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [29/57] D2.1 drafts screen in a real browser (rows, blockers, stubs, no-nav)"
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
echo "▶ [30/57] D3 draft review screen (fields, fee breakdown, freshness, TRS withholding)"
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
echo "▶ [31/57] Top Rated Plus confirmation is scoped to one listing (4 acceptance states)"
if suite "$ROOT/tests/trs-listing-scope.mjs"; then
  :
else
  FAIL=1
fi

# 2026-09-07: These two were written, passed, and were NOT wired in here -- the
# session record claimed contrast-tokens was "registered" when only its pass
# count had ever been observed by hand. A suite that is never invoked by the
# runner is not a guard, it is a file. Registering both, and renumbering to 33.
echo "▶ [32/57] Theme token contrast meets AA in both themes (runtime-resolved)"
if suite "$ROOT/tests/contrast-tokens.mjs"; then
  :
else
  FAIL=1
fi

# Bidirectional: a venue missing from either side, or a date that disagrees
# across the two surfaces, is a published claim the code no longer backs.
echo "▶ [33/57] accuracy.html and the fee model agree on venues and audit dates"
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
echo "▶ [34/57] Review-screen fee rows are a dt/dd list with the withheld pair intact"
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
echo "▶ [35/57] SOL-PLAT-007 asset extraction — inline JS/CSS stays split and hashed"
if suite "$ROOT/tests/asset-extraction-2026-09-05.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [36/57] Sol-audit blockers — executes the shipped logic, not its text"
if suite "$ROOT/tests/sol-remediation-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [37/57] Sol majors — flip and pack"
if suite "$ROOT/tests/majors-flip-and-pack-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [38/57] Sol majors — data durability and tombstones"
if suite "$ROOT/tests/durability-tombstones-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [39/57] Sol majors — scan hygiene"
if suite "$ROOT/tests/scan-hygiene-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [40/57] Sol majors — entitlements and session integrity"
if suite "$ROOT/tests/entitlements-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [41/57] Sol majors — accessibility, mobile targets, honest copy"
if suite "$ROOT/tests/a11y-mobile-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [42/57] SOL-PLAT-011/012/013 — gold text AA, social meta, absolute og:url"
if suite "$ROOT/tests/minors-011-012-013-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [43/57] Bulk-scan misfire — two bugs, four fixes"
if suite "$ROOT/tests/bulk-scan-misfire.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [44/57] Bulk row regression — Bulbasaur qualifier"
if suite "$ROOT/tests/bulk-bulbasaur-qualifier-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [45/57] Bulk row regression — Minun set/variant misfire"
if suite "$ROOT/tests/bulk-minun-misfire-2026-09-04.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [46/57] Grading upside: net comes from the shared fee model (BIAS-1)"
if suite "$ROOT/tests/grading-upside-fees.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [47/57] Payout honesty: signed payout bars + four-state cost records (BIAS-6)"
if suite "$ROOT/tests/payout-honesty.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [48/57] Decision restatements — shipped copy still matches the decisions of record"
if suite "$ROOT/tests/decision-restatements.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [49/57] TPL proxy contract (offline, mocked upstream) [CH-3]"
if suite "$ROOT/tests/tpl-proxy-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [50/57] TPL cache + aggregate spending allowance (offline, mocked store) [CH-3/R4]"
if suite "$ROOT/tests/tpl-budget-offline.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [51/57] eBay notification verification token fails closed [CH-2]"
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
echo "▶ [52/57] Draft lifecycle pointer — generations, reservations, fencing (offline)"
if suite "$ROOT/tests/draft-lifecycle.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [53/57] An omitted generation is legacy generation 0, then compared like any other"
if suite "$ROOT/tests/draft-generation-omission.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [54/57] Draft delete in a real browser — 410 shows the deleted state, no auto-retry"
if suite "$ROOT/tests/draft-delete-browser.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [55/57] TPL outcome rendering"
if suite "$ROOT/tests/tpl-outcome-render.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [56/57] Collection escaping: hostile values stay inside their attributes"
if suite "$ROOT/tests/collection-escaping-browser.mjs"; then
  :
else
  FAIL=1
fi

echo ""
echo "▶ [57/57] Every suite on disk is invoked or declared; slot numbering is derived"
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
