#!/usr/bin/env bash
# tools/run-ebay-live.sh
#
# Runs the live eBay harness without any credential reaching shell history,
# the process argument list, or a file. Replaces the inline
# `EBAY_CERT_ID=… node tests/ebay-live.mjs` form, which leaks all three values
# into history and into `ps` for every user on the machine.
#
#   bash tools/run-ebay-live.sh
#
# Values are read from hidden prompts, exported only into the child process,
# and gone when it exits. Nothing is written to disk.

set -u
set +x                      # no tracing: tracing would print the exports
set +o history 2>/dev/null || true
unset HISTFILE

# If the shell was started with tracing or verbose on, refuse rather than leak.
case "$-" in
  *x*|*v*) echo "refusing to run: shell tracing/verbose is on. Start a clean shell." >&2; exit 1 ;;
esac

if [ ! -f tests/ebay-live.mjs ]; then
  echo "run this from the repository root (tests/ebay-live.mjs not found)" >&2
  exit 1
fi

read_secret() {           # $1 = prompt, $2 = variable name
  local _v
  printf '%s' "$1" >&2
  IFS= read -rs _v
  printf '\n' >&2
  if [ -z "$_v" ]; then
    echo "empty value — aborting rather than letting the harness fall back" >&2
    exit 1
  fi
  # Reject pasted whitespace at the edges: that defect is the reason this
  # window exists, and a harness fed a padded value tests the wrong string.
  case "$_v" in
    *[[:space:]]) echo "value has trailing whitespace — re-paste it cleanly" >&2; exit 1 ;;
    [[:space:]]*) echo "value has leading whitespace — re-paste it cleanly"  >&2; exit 1 ;;
  esac
  printf -v "$2" '%s' "$_v" 2>/dev/null || eval "$2=\$_v"
}

read_secret 'eBay App ID (hidden): '             EBAY_APP_ID
read_secret 'eBay Cert ID (hidden): '            EBAY_CERT_ID
read_secret 'eBay verification token (hidden): ' EBAY_VERIFICATION_TOKEN

echo "running tests/ebay-live.mjs — record every failure, warning and skipped branch" >&2
echo "the pass condition is EVERY REQUIRED CHECK, not a count" >&2

EBAY_LIVE=1 \
EBAY_APP_ID="$EBAY_APP_ID" \
EBAY_CERT_ID="$EBAY_CERT_ID" \
EBAY_VERIFICATION_TOKEN="$EBAY_VERIFICATION_TOKEN" \
  node tests/ebay-live.mjs
status=$?

unset EBAY_APP_ID EBAY_CERT_ID EBAY_VERIFICATION_TOKEN
exit $status
