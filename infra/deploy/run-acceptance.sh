#!/bin/sh
set -eu

pause() {
  printf '%s\n' "PAUSE_ACCEPTANCE:$1" >&2
  exit 78
}

release_sha=${1:-}
printf '%s' "$release_sha" | grep -Eq '^[a-f0-9]{40}$' || pause INVALID_SHA

if test "${OPENTRAD_TEST_MODE:-0}" = 1; then
  test -n "${OPENTRAD_ROOT:-}" && test -n "${OPENTRAD_LIBEXEC:-}" || pause TEST_ROOT_MISSING
  opentrad_root=$OPENTRAD_ROOT
  libexec=$OPENTRAD_LIBEXEC
elif test "$(id -u)" -eq 0; then
  opentrad_root=/opt/opentrad
  libexec=/usr/local/libexec/opentrad
else
  pause ROOT_REQUIRED
fi

reports="$opentrad_root/reports"
baselines="$opentrad_root/baselines"
deployment="$reports/$release_sha.json"
canary="$reports/canary-$release_sha.json"
markers="$reports/markers-$release_sha.json"
before="$baselines/before-$release_sha.json"
acceptance="$baselines/acceptance.json"
for required in "$deployment" "$canary" "$markers" "$before"; do
  test -s "$required" || pause EVIDENCE_MISSING
done
node -e '
  const value = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (value.deployed !== true || value.sourceSha !== process.argv[2]) process.exit(78);
' "$deployment" "$release_sha" || pause DEPLOYMENT_INVALID

runtime_parent=/run
if test "${OPENTRAD_TEST_MODE:-0}" = 1; then
  runtime_parent="$opentrad_root/run"
  install -d -m 0700 "$runtime_parent"
fi
runtime="$(mktemp -d "$runtime_parent/opentrad-acceptance.XXXXXX")"
chmod 0700 "$runtime"
marker_runtime="$runtime/markers.json"
restore_marker() {
  if test -f "$marker_runtime" && ! test -e "$markers"; then
    marker_temporary="$markers.tmp-$$"
    install -m 0600 "$marker_runtime" "$marker_temporary"
    if test "${OPENTRAD_TEST_MODE:-0}" != 1; then
      chown root:root "$marker_temporary"
    fi
    mv "$marker_temporary" "$markers"
  fi
}
acceptance_exit() {
  status=$?
  trap - EXIT HUP INT TERM
  restore_marker || true
  rm -rf "$runtime"
  exit "$status"
}
trap acceptance_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
profile="$runtime/load-profile.json"
load="$runtime/load.json"
privacy="$runtime/privacy.json"
baseline="$runtime/baseline.json"

node "$libexec/build-load-profile.mjs" "$before" "$profile"
if ! node "$libexec/release/load-smoke.mjs" \
  --target https://opentrad.dns.army --profile-fd 3 3<"$profile" >"$load"; then
  node -e '
    try {
      const value = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
      const failures = value?.failures;
      if (
        !Array.isArray(failures) ||
        failures.length < 1 ||
        failures.some((code) => typeof code !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(code))
      ) throw new Error();
      process.stderr.write(`${JSON.stringify({ failures: [...new Set(failures)].sort() })}\n`);
    } catch {
      process.exitCode = 78;
    }
  ' "$load" || true
  pause LOAD_FAILED
fi

# The marker evidence contains the private canary strings by design. Validate it,
# hold a root-only copy outside every production scan root, and restore it after
# the scan so the sentinel measures residue rather than its own input document.
marker_production=1
if test "${OPENTRAD_TEST_MODE:-0}" = 1; then marker_production=0; fi
MARKER_FILE="$markers" MARKER_PRODUCTION="$marker_production" node --input-type=module - <<'NODE'
import { lstatSync } from "node:fs";

const info = lstatSync(process.env.MARKER_FILE);
if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) process.exit(78);
if (process.env.MARKER_PRODUCTION === "1" && (info.uid !== 0 || (info.mode & 0o777) !== 0o600)) {
  process.exit(78);
}
NODE
install -m 0600 "$markers" "$marker_runtime"
cmp -s "$markers" "$marker_runtime" || pause MARKER_COPY_FAILED
rm -f "$markers"
node "$libexec/release/privacy-sentinel.mjs" \
  --remote-profile production --markers-fd 3 3<"$marker_runtime" >/dev/null
restore_marker
printf '%s\n' '{"ok":true}' >"$privacy"

"$libexec/capture-baseline.sh" acceptance
if ! node "$libexec/compare-baseline.mjs" "$before" "$acceptance" \
  >"$runtime/baseline-diff.json"; then
  pause BASELINE_CHANGED
fi
node -e '
  const differences = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (!Array.isArray(differences) || differences.length !== 0) process.exit(78);
' "$runtime/baseline-diff.json" || pause BASELINE_CHANGED
printf '%s\n' '{"ok":true}' >"$baseline"

output="$reports/acceptance-$release_sha.json"
node "$libexec/release/post-deploy-report.mjs" \
  "$release_sha" "$baseline" "$canary" "$privacy" "$load" "$output"
if test "${OPENTRAD_TEST_MODE:-0}" != 1; then
  chown root:opentrad-deploy "$output"
  chmod 0640 "$output"
fi
printf '%s\n' "ACCEPTANCE_OK:$release_sha"
