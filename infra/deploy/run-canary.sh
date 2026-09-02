#!/bin/sh
set -eu

pause() {
  printf '%s\n' "PAUSE_CANARY:$1" >&2
  exit 78
}

release_sha=${1:-}
printf '%s' "$release_sha" | grep -Eq '^[a-f0-9]{40}$' || pause INVALID_SHA
origin=https://opentrad.xyz
local_curl() {
  curl --http1.1 --max-time 30 \
    --resolve 'opentrad.xyz:443:127.0.0.1' "$@"
}
opentrad_root=/opt/opentrad
runtime_parent=/run
if test "${OPENTRAD_TEST_MODE:-0}" = 1; then
  opentrad_root=${OPENTRAD_ROOT:?OPENTRAD_ROOT is required in test mode}
  runtime_parent="$opentrad_root/run"
  install -d -m 0700 "$runtime_parent"
fi
runtime=$(mktemp -d "$runtime_parent/opentrad-canary.XXXXXX")
chmod 0700 "$runtime"
cookie_jar="$runtime/cookies"
cleanup_needed=0
marker_report_temp=
canary_report_temp=
cleanup() {
  if test "$cleanup_needed" -eq 1 && test -s "$cookie_jar" \
    && test -s "$runtime/delete-body.json"; then
    local_curl --silent --show-error --cookie "$cookie_jar" --header "origin: $origin" \
      --header 'sec-fetch-site: same-origin' \
      --header 'content-type: application/json' --output /dev/null \
      --data-binary @"$runtime/delete-body.json" "$origin/api/auth/delete-user" >/dev/null 2>&1 || true
  fi
  test -z "$marker_report_temp" || rm -f "$marker_report_temp"
  test -z "$canary_report_temp" || rm -f "$canary_report_temp"
  rm -rf "$runtime"
}
trap cleanup EXIT HUP INT TERM

fetch_page() {
  route=$1
  name=$2
  effective=$(curl --fail --silent --show-error --location \
    --dump-header "$runtime/$name.headers" --output "$runtime/$name.body" \
    --write-out '%{url_effective}' "$origin$route") || pause "FETCH_${name}"
  EFFECTIVE_URL="$effective" node -e '
    const value = new URL(process.env.EFFECTIVE_URL);
    if (value.protocol !== "https:" || value.hostname !== "opentrad.xyz") process.exit(1);
  ' || pause FINAL_ORIGIN
}

fetch_page / home
fetch_page /templates templates
fetch_page /api/v1/capabilities capabilities
for name in home templates; do
  grep -Eiq '^content-security-policy:' "$runtime/$name.headers" || pause CSP_MISSING
  grep -Eiq '^strict-transport-security:' "$runtime/$name.headers" || pause HSTS_MISSING
  grep -Eiq '^content-type:[[:space:]]*text/html' "$runtime/$name.headers" || pause HTML_MIME
  grep -Eiq '^cache-control:.*no-store' "$runtime/$name.headers" || pause HTML_CACHE
  grep -Eiq "^x-opentrad-release:[[:space:]]*$release_sha" "$runtime/$name.headers" || pause RELEASE_HEADER
done
grep -Eiq '^content-type:[[:space:]]*application/json' "$runtime/capabilities.headers" || pause API_MIME

username=$(node -e 'process.stdout.write(`c${require("node:crypto").randomBytes(8).toString("hex").slice(0,11)}`)')
password=$(node -e 'process.stdout.write(`Z9!${require("node:crypto").randomBytes(18).toString("base64url")}`)')
printf '{"username":"%s","password":"%s","acknowledgements":{"noPasswordRecovery":true}}' \
  "$username" "$password" >"$runtime/register-body.json"
printf '{"password":"%s"}' "$password" >"$runtime/delete-body.json"
chmod 0600 "$runtime/register-body.json" "$runtime/delete-body.json"
register_status=$(local_curl --silent --show-error --output "$runtime/register.json" \
  --write-out '%{http_code}' --cookie-jar "$cookie_jar" \
  --header 'content-type: application/json' --header "origin: $origin" \
  --header 'sec-fetch-site: same-origin' \
  --data-binary @"$runtime/register-body.json" \
  "$origin/api/v1/register")
test "$register_status" = 201 || pause REGISTER
cleanup_needed=1

marker_seed=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))')
filename_marker="canary-filename-$marker_seed"
body_marker="canary-body-$marker_seed"
input_target_bytes=$(node -e 'process.stdout.write(String(require("node:crypto").randomInt(131072, 262145)))')
metadata_marker="$input_target_bytes.000000"
printf '[{"id":"filename","value":"%s"},{"id":"body","value":"%s"},{"id":"metadata","value":"%s"}]\n' \
  "$filename_marker" "$body_marker" "$metadata_marker" >"$runtime/markers.json"
printf '%s\n%s\n%s\n' "$filename_marker" "$body_marker" "$metadata_marker" \
  >"$runtime/marker-values.txt"
chmod 0600 "$runtime/markers.json" "$runtime/marker-values.txt"
printf '%s\n' "$body_marker" >"$runtime/input.md"
current_bytes=$(wc -c <"$runtime/input.md" | tr -d ' ')
padding_bytes=$((input_target_bytes - current_bytes))
test "$padding_bytes" -ge 0 || pause MARKER_INVALID
dd if=/dev/zero bs=1 count="$padding_bytes" 2>/dev/null | tr '\000' x >>"$runtime/input.md"
input_bytes=$(wc -c <"$runtime/input.md" | tr -d ' ')
test "$input_bytes" = "$input_target_bytes" || pause INPUT_SIZE
idempotency_key=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("base64url"))')
metadata="{\"operation\":\"structured.convert\",\"inputFormat\":\"md\",\"outputFormat\":\"docx\",\"inputBytes\":$metadata_marker,\"options\":{}}"

submit() {
  output=$1
  local_curl --fail --silent --show-error --cookie "$cookie_jar" \
    --header "origin: $origin" \
    --header 'sec-fetch-site: same-origin' \
    --header "idempotency-key: $idempotency_key" \
    --header "x-opentrad-job-request: $metadata" \
    --header 'x-opentrad-processing-consent: server-v1' \
    --form "file=@-;filename=$filename_marker.md;type=text/markdown" \
    --output "$output" "$origin/api/v1/jobs" <"$runtime/input.md"
}
submit "$runtime/job-first.json" || pause JOB_SUBMIT
submit "$runtime/job-second.json" || pause JOB_REPLAY
job_id=$(node -e '
  const fs = require("node:fs");
  const first = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).job?.id;
  const second = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).job?.id;
  if (!/^[0-9a-f-]{36}$/u.test(first) || first !== second) process.exit(1);
  process.stdout.write(first);
' "$runtime/job-first.json" "$runtime/job-second.json") || pause IDEMPOTENCY

complete=0
attempt=0
while test "$attempt" -lt 60; do
  local_curl --fail --silent --show-error --cookie "$cookie_jar" \
    --header "origin: $origin" --output "$runtime/job-status.json" \
    "$origin/api/v1/jobs/$job_id" || pause JOB_STATUS
  status=$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).job?.status ?? "")' "$runtime/job-status.json")
  case "$status" in
    succeeded) complete=1; break ;;
    failed | cancelled) pause JOB_TERMINAL ;;
  esac
  attempt=$((attempt + 1))
  sleep 2
done
test "$complete" -eq 1 || pause JOB_TIMEOUT

local_curl --fail --silent --show-error --cookie "$cookie_jar" --header "origin: $origin" \
  --dump-header "$runtime/result.headers" --output "$runtime/result.docx" \
  "$origin/api/v1/jobs/$job_id/result" || pause RESULT_DOWNLOAD
test "$(od -An -tx1 -N2 "$runtime/result.docx" | tr -d ' \n')" = 504b || pause RESULT_MAGIC
grep -Eiq '^content-type:[[:space:]]*application/vnd.openxmlformats-officedocument.wordprocessingml.document' \
  "$runtime/result.headers" || pause RESULT_MIME
second_status=$(local_curl --silent --show-error --cookie "$cookie_jar" --header "origin: $origin" \
  --output /dev/null --write-out '%{http_code}' "$origin/api/v1/jobs/$job_id/result")
case "$second_status" in 404 | 409) ;; *) pause RESULT_REPLAY ;; esac

delete_status=$(local_curl --silent --show-error --cookie "$cookie_jar" --header "origin: $origin" \
  --header 'sec-fetch-site: same-origin' \
  --header 'content-type: application/json' --output "$runtime/delete.json" --write-out '%{http_code}' \
  --data-binary @"$runtime/delete-body.json" "$origin/api/auth/delete-user")
case "$delete_status" in 200 | 204) ;; *) pause ACCOUNT_DELETE ;; esac
cleanup_needed=0

database_volume=$(docker volume inspect opentrad_auth_data --format '{{.Mountpoint}}' 2>/dev/null || true)
test -n "$database_volume" && test -f "$database_volume/opentrad.sqlite" || pause DATABASE_MISSING
sqlite3 -cmd '.timeout 5000' "$database_volume/opentrad.sqlite" \
  'PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null
if grep -aFq "$username" "$database_volume/opentrad.sqlite" \
  || grep -aFq -f "$runtime/marker-values.txt" "$database_volume/opentrad.sqlite" \
  || { test -f "$database_volume/opentrad.sqlite-wal" && grep -aFq "$username" "$database_volume/opentrad.sqlite-wal"; } \
  || { test -f "$database_volume/opentrad.sqlite-wal" && grep -aFq -f "$runtime/marker-values.txt" "$database_volume/opentrad.sqlite-wal"; } \
  || { test -f "$database_volume/opentrad.sqlite-shm" && grep -aFq "$username" "$database_volume/opentrad.sqlite-shm"; } \
  || { test -f "$database_volume/opentrad.sqlite-shm" && grep -aFq -f "$runtime/marker-values.txt" "$database_volume/opentrad.sqlite-shm"; }; then
  pause PRIVACY_DATABASE
fi
for container_name in opentrad-api-1 opentrad-worker-1 opentrad-clamav-1; do
  if docker logs "$container_name" 2>&1 | grep -aFq "$username" \
    || docker logs "$container_name" 2>&1 | grep -aFq -f "$runtime/marker-values.txt"; then
    pause PRIVACY_LOG
  fi
done
for log_file in /var/log/nginx/access.log /var/log/nginx/error.log; do
  if test -r "$log_file" \
    && { grep -aFq "$username" "$log_file" \
      || grep -aFq -f "$runtime/marker-values.txt" "$log_file"; }; then
    pause PRIVACY_LOG
  fi
done
if command -v journalctl >/dev/null 2>&1 \
  && { journalctl -u nginx --since '-15 minutes' --no-pager 2>/dev/null | grep -aFq "$username" \
    || journalctl -u nginx --since '-15 minutes' --no-pager 2>/dev/null \
      | grep -aFq -f "$runtime/marker-values.txt"; }; then
  pause PRIVACY_LOG
fi

report_directory="$opentrad_root/reports"
if test "${OPENTRAD_TEST_MODE:-0}" = 1; then
  install -d -m 0700 "$report_directory"
else
  install -d -o root -g opentrad-deploy -m 0750 "$report_directory"
fi
marker_report_temp=$(mktemp "$report_directory/.markers-$release_sha.XXXXXX")
canary_report_temp=$(mktemp "$report_directory/.canary-$release_sha.XXXXXX")
install -m 0600 "$runtime/markers.json" "$marker_report_temp"
printf '{"ok":true,"sourceSha":"%s"}\n' "$release_sha" >"$canary_report_temp"
chmod 0600 "$marker_report_temp" "$canary_report_temp"
if test "${OPENTRAD_TEST_MODE:-0}" != 1; then
  chown root:root "$marker_report_temp" "$canary_report_temp"
fi
mv -f "$marker_report_temp" "$report_directory/markers-$release_sha.json"
marker_report_temp=
mv -f "$canary_report_temp" "$report_directory/canary-$release_sha.json"
canary_report_temp=

printf '%s\n' "CANARY_OK:$release_sha"
