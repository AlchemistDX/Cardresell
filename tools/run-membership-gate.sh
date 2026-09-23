#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:?Pass an evidence directory outside the repository}"
mkdir -p "$OUT"
status=0
printf 'suite\texit\n' > "$OUT/results.tsv"
for suite in membership-environment membership-bootstrap membership-customer membership-lifecycle membership-lifecycle-stripe membership-reversal-stripe \
  membership-account-routes membership-fulfillment membership-paid-enrollment \
  membership-consumption membership-ledger membership-payments membership-bindings \
  membership-stripe membership-checkout membership-checkout-stripe \
  membership-purchase-routes membership-shop-identity membership-routes \
  membership-scan-intent launch-membership-config test-registry test-scan \
  webhook-p0-offline id-confirmation-atomic entitlements-2026-09-04 sol-remediation-2026-09-04
do
  (cd "$ROOT" && node "tests/$suite.mjs") > "$OUT/$suite.log" 2>&1
  result=$?
  printf '%s\t%s\n' "$suite" "$result" >> "$OUT/results.tsv"
  printf '%s: exit %s\n' "$suite" "$result"
  tail -2 "$OUT/$suite.log"
  if [ "$result" -ne 0 ]; then status=1; fi
done
for check in authentication enrollment-flow enrollment-provisioner free-issuance preflight writer-readiness
do
  name="membership-$check"
  (cd "$ROOT" && node "tools/check-$name.mjs") > "$OUT/$name.log" 2>&1
  result=$?
  printf '%s\t%s\n' "$name" "$result" >> "$OUT/results.tsv"
  printf '%s: exit %s\n' "$name" "$result"
  tail -2 "$OUT/$name.log"
  if [ "$result" -ne 0 ]; then status=1; fi
done
exit "$status"
