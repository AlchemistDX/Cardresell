#!/usr/bin/env bash
# Run registered suites individually by index range, one process each, and
# append a one-line record per suite to audit/evidence/suite-record.txt.
#
# NOT a substitute for tests/run-all.sh and deliberately not it: the standing
# instruction is that run-all.sh is not to be run here. This exists so a claim
# like "every offline suite is green" can cite a per-suite record with a
# timestamp and an exit code, instead of a remembered impression.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/audit/evidence/suite-record.txt"
mkdir -p "$(dirname "$LOG")"

FROM="${1:?from index}"; TO="${2:?to index}"
mapfile -t FILES < <(grep -oP '\$ROOT/tests/\K[a-z0-9._-]+\.mjs' "$ROOT/tests/run-all.sh")

for ((i=FROM; i<=TO && i<=${#FILES[@]}; i++)); do
  f="${FILES[$((i-1))]}"
  out="$(cd "$ROOT" && timeout 300 node "tests/$f" 2>&1)"
  rc=$?
  # Last line carrying a pass/fail count, else the last nonempty line.
  line="$(printf '%s\n' "$out" | grep -Ei 'passed|PASS|FAIL' | tail -1)"
  [[ -z "$line" ]] && line="$(printf '%s\n' "$out" | grep -v '^$' | tail -1)"
  printf '%-45s rc=%-3s %s\n' "$f" "$rc" "${line:0:110}" | tee -a "$LOG"
done
