#!/bin/sh
set -eu

pause() {
  printf '%s\n' "PAUSE_INCOMING_CLEANUP:$1" >&2
  exit 78
}

release_sha=${1:-}
run_id=${2:-}
run_attempt=${3:-}
printf '%s' "$release_sha" | grep -Eq '^[a-f0-9]{40}$' || pause INVALID_SHA
printf '%s' "$run_id" | grep -Eq '^[1-9][0-9]*$' || pause INVALID_RUN_ID
printf '%s' "$run_attempt" | grep -Eq '^[1-9][0-9]*$' || pause INVALID_RUN_ATTEMPT

test_mode=${OPENTRAD_TEST_MODE:-0}
if test "$test_mode" = 1; then
  test -n "${OPENTRAD_ROOT:-}" || pause TEST_ROOT_MISSING
else
  test "$(id -u)" -eq 0 || pause ROOT_REQUIRED
fi

opentrad_root=${OPENTRAD_ROOT:-/opt/opentrad}
staging="$opentrad_root/incoming/${release_sha}.incoming-${run_id}-${run_attempt}"
if test -e "$staging" || test -L "$staging"; then
  rm -rf -- "$staging"
fi
test ! -e "$staging" && test ! -L "$staging" || pause CLEANUP_FAILED
printf '%s\n' "INCOMING_CLEANED:$release_sha"
