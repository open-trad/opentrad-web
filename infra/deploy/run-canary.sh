#!/bin/sh
set -eu

pause() {
  printf '%s\n' "PAUSE_CANARY:$1" >&2
  exit 78
}

release_sha=${1:-}
printf '%s' "$release_sha" | grep -Eq '^[a-f0-9]{40}$' || pause INVALID_SHA
origin=https://opentrad.dynv6.net
runtime=$(mktemp -d /run/opentrad-canary.XXXXXX)
chmod 0700 "$runtime"
cookie_jar="$runtime/cookies"
cleanup_needed=0
cleanup() {
  if test "$cleanup_needed" -eq 1 && test -s "$cookie_jar" \
    && test -s "$runtime/delete-body.json"; then
    curl --silent --show-error --cookie "$cookie_jar" --header "origin: $origin" \
      --header 'content-type: application/json' --output /dev/null \
      --data-binary @"$runtime/delete-body.json" "$origin/api/auth/delete-user" >/dev/null 2>&1 || true
  fi
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
    if (value.protocol !== "https:" || value.hostname !== "opentrad.dynv6.net") process.exit(1);
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
register_status=$(curl --silent --show-error --output "$runtime/register.json" \
  --write-out '%{http_code}' --cookie-jar "$cookie_jar" \
  --header 'content-type: application/json' --header "origin: $origin" \
  --data-binary @"$runtime/register-body.json" \
  "$origin/api/v1/register")
test "$register_status" = 201 || pause REGISTER
cleanup_needed=1

node -e '
  const fs = require("node:fs");
  const marker = "# OpenTrad production canary\n";
  fs.writeFileSync(process.argv[1], marker + "x".repeat(1024 - Buffer.byteLength(marker)));
' "$runtime/input.md"
input_bytes=$(wc -c <"$runtime/input.md" | tr -d ' ')
idempotency_key=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("base64url"))')
metadata="{\"operation\":\"structured.convert\",\"inputFormat\":\"md\",\"outputFormat\":\"docx\",\"inputBytes\":$input_bytes,\"options\":{}}"

submit() {
  output=$1
  curl --fail --silent --show-error --cookie "$cookie_jar" \
    --header "origin: $origin" \
    --header "idempotency-key: $idempotency_key" \
    --header "x-opentrad-job-request: $metadata" \
    --header 'x-opentrad-processing-consent: server-v1' \
    --form 'file=@-;filename=upload.bin;type=text/markdown' \
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
  curl --fail --silent --show-error --cookie "$cookie_jar" \
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

curl --fail --silent --show-error --cookie "$cookie_jar" --header "origin: $origin" \
  --dump-header "$runtime/result.headers" --output "$runtime/result.docx" \
  "$origin/api/v1/jobs/$job_id/result" || pause RESULT_DOWNLOAD
test "$(od -An -tx1 -N2 "$runtime/result.docx" | tr -d ' \n')" = 504b || pause RESULT_MAGIC
grep -Eiq '^content-type:[[:space:]]*application/vnd.openxmlformats-officedocument.wordprocessingml.document' \
  "$runtime/result.headers" || pause RESULT_MIME
second_status=$(curl --silent --show-error --cookie "$cookie_jar" --header "origin: $origin" \
  --output /dev/null --write-out '%{http_code}' "$origin/api/v1/jobs/$job_id/result")
case "$second_status" in 404 | 409) ;; *) pause RESULT_REPLAY ;; esac

delete_status=$(curl --silent --show-error --cookie "$cookie_jar" --header "origin: $origin" \
  --header 'content-type: application/json' --output "$runtime/delete.json" --write-out '%{http_code}' \
  --data-binary @"$runtime/delete-body.json" "$origin/api/auth/delete-user")
case "$delete_status" in 200 | 204) ;; *) pause ACCOUNT_DELETE ;; esac
cleanup_needed=0

database_volume=$(docker volume inspect opentrad_auth_data --format '{{.Mountpoint}}' 2>/dev/null || true)
test -n "$database_volume" && test -f "$database_volume/opentrad.sqlite" || pause DATABASE_MISSING
sqlite3 -cmd '.timeout 5000' "$database_volume/opentrad.sqlite" \
  'PRAGMA wal_checkpoint(TRUNCATE); VACUUM;' >/dev/null
if grep -aFq "$username" "$database_volume/opentrad.sqlite" \
  || { test -f "$database_volume/opentrad.sqlite-wal" && grep -aFq "$username" "$database_volume/opentrad.sqlite-wal"; } \
  || { test -f "$database_volume/opentrad.sqlite-shm" && grep -aFq "$username" "$database_volume/opentrad.sqlite-shm"; }; then
  pause PRIVACY_DATABASE
fi
for container_name in opentrad-api-1 opentrad-worker-1 opentrad-clamav-1; do
  if docker logs "$container_name" 2>&1 | grep -Fq "$username"; then pause PRIVACY_LOG; fi
done
for log_file in /var/log/nginx/access.log /var/log/nginx/error.log; do
  if test -r "$log_file" && grep -aFq "$username" "$log_file"; then pause PRIVACY_LOG; fi
done
if command -v journalctl >/dev/null 2>&1 \
  && journalctl -u nginx --since '-15 minutes' --no-pager 2>/dev/null | grep -Fq "$username"; then
  pause PRIVACY_LOG
fi

printf '%s\n' "CANARY_OK:$release_sha"
