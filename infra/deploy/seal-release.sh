#!/bin/sh
set -eu

pause() {
  printf '%s\n' "PAUSE_SEAL:$1" >&2
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
incoming="$opentrad_root/incoming/${release_sha}.incoming-${run_id}-${run_attempt}"
final="$opentrad_root/releases/$release_sha"
test -d "$incoming" || pause STAGING_MISSING
test ! -e "$final" || pause RELEASE_EXISTS
test -f "$incoming/release-manifest.json" || pause MANIFEST_MISSING

test -z "$(find "$incoming" -type l -print -quit)" || pause SYMLINK_REJECTED
test -z "$(find "$incoming" ! -type f ! -type d -print -quit)" || pause SPECIAL_FILE_REJECTED
test -z "$(find "$incoming" -type f -links +1 -print -quit)" || pause HARDLINK_REJECTED

mv -- "$incoming" "$final"
if test "$test_mode" != 1; then chown -R root:root "$final"; fi
find "$final" -type d -exec chmod 0555 {} +
find "$final" -type f -exec chmod 0444 {} +
if test "$test_mode" != 1; then
  test "$(stat -c '%U:%G' "$final")" = root:root || pause OWNERSHIP_FAILED
  test "$(stat -c '%a' "$final")" = 555 || pause MODE_FAILED
fi
printf '%s\n' "RELEASE_SEALED:$release_sha"
