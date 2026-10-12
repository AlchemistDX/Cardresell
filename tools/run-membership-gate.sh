#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:?Pass an evidence directory outside the repository}"
mkdir -p "$OUT"
status=0
# Require both successful exit and an explicit completed suite. A zero exit
# from a prematurely ended process is not evidence of a successful run.
run_check() {
  local path="$1" log="$2" result=0
  (cd "$ROOT" && timeout "${SUITE_TIMEOUT:-900}" node "$path") > "$log" 2>&1 || result=$?
  if [ "$result" -eq 0 ] && { ! grep -q 'SUITE COMPLETE, exit=0' "$log" || grep -Eq 'SUITE DID NOT COMPLETE|INCOMPLETE RUN|SUITE SKIPPED' "$log"; }; then
    printf '\nGATE FAILURE: missing full successful completion\n' >> "$log"
    result=1
  fi
  return "$result"
}
printf 'suite\texit\n' > "$OUT/results.tsv"
for suite in membership-environment membership-bootstrap membership-customer membership-lifecycle membership-lifecycle-stripe membership-reversal-stripe \
  membership-account-routes membership-fulfillment membership-paid-enrollment \
  membership-consumption membership-ledger membership-payments membership-bindings \
  membership-stripe membership-checkout membership-checkout-stripe \
  membership-purchase-routes membership-venue-access membership-shop-identity membership-routes \
  membership-scan-intent launch-membership-config test-registry test-scan \
  webhook-p0-offline id-confirmation-atomic entitlements-2026-09-04 sol-remediation-2026-09-04
do
  run_check "tests/$suite.mjs" "$OUT/$suite.log"
  result=$?
  printf '%s\t%s\n' "$suite" "$result" >> "$OUT/results.tsv"
  printf '%s: exit %s\n' "$suite" "$result"
  tail -2 "$OUT/$suite.log"
  if [ "$result" -ne 0 ]; then status=1; fi
done
for check in authentication enrollment-flow enrollment-provisioner free-issuance preflight writer-readiness owner-migration owner-import cutover
do
  name="membership-$check"
  run_check "tools/check-$name.mjs" "$OUT/$name.log"
  result=$?
  printf '%s\t%s\n' "$name" "$result" >> "$OUT/results.tsv"
  printf '%s: exit %s\n' "$name" "$result"
  tail -2 "$OUT/$name.log"
  if [ "$result" -ne 0 ]; then status=1; fi
done
run_check "tools/check-preview-writer-cutover.mjs" "$OUT/preview-writer-cutover.log"
result=$?
printf 'preview-writer-cutover\t%s\n' "$result" >> "$OUT/results.tsv"
tail -2 "$OUT/preview-writer-cutover.log"
if [ "$result" -ne 0 ]; then status=1; fi
exit "$status"
