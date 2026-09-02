#!/bin/sh
set -eu

pause() {
  printf '%s\n' "$1" >&2
  exit 78
}

runtime_root=/opt/opentrad
if test -n "${OPENTRAD_TEST_ROOT:-}"; then
  test "${OPENTRAD_TEST_MODE:-}" = 1 || pause "PAUSE_HOST:TEST_ROOT_REJECTED"
  runtime_root=$OPENTRAD_TEST_ROOT
fi

public_ip="$(curl --fail --silent --show-error --max-time 5 https://api.ipify.org)" ||
  pause "PAUSE_DNS:PUBLIC_IP_UNAVAILABLE"
dns_ip="$(
  curl --fail --silent --show-error --max-time 5 \
    -H 'accept: application/dns-json' \
    'https://cloudflare-dns.com/dns-query?name=opentrad.xyz&type=A' |
    node -e '
      let body = "";
      process.stdin.on("data", (chunk) => { body += chunk; });
      process.stdin.on("end", () => {
        try {
          const json = JSON.parse(body);
          const answers = Array.isArray(json.Answer) ? json.Answer : [];
          const records = answers.filter((item) => item && item.type === 1 && typeof item.data === "string");
          if (records.length !== 1) process.exit(2);
          process.stdout.write(records[0].data);
        } catch {
          process.exit(2);
        }
      });
    '
)" || pause "PAUSE_DNS:OPENTRAD_RECORD_NOT_READY"
test "$dns_ip" = "$public_ip" || pause "PAUSE_DNS:OPENTRAD_RECORD_NOT_READY"

for secret_name in better_auth_secret github_client_id github_client_secret; do
  secret_file="$runtime_root/secrets/$secret_name"
  test -s "$secret_file" || pause "PAUSE_OAUTH:GITHUB_APP_NOT_CONFIGURED"
  test "$(stat -c '%a' "$secret_file")" = 440 || pause "PAUSE_SECRETS:UNSAFE_MODE"
  test "$(stat -c '%g' "$secret_file")" = 10100 || pause "PAUSE_SECRETS:UNSAFE_GROUP"
done
acme_file="$runtime_root/secrets/acme_email"
test -s "$acme_file" || pause "PAUSE_TLS:ACME_EMAIL_NOT_CONFIGURED"
test "$(stat -c '%a' "$acme_file")" = 400 || pause "PAUSE_SECRETS:UNSAFE_MODE"

available_kib="$(df -Pk "$runtime_root" | awk 'NR == 2 { print $4 }')"
case "$available_kib" in
  '' | *[!0-9]*) pause "PAUSE_HOST:INSUFFICIENT_DISK" ;;
esac
test "$available_kib" -ge 12582912 || pause "PAUSE_HOST:INSUFFICIENT_DISK"

meminfo=/proc/meminfo
if test "${OPENTRAD_TEST_MODE:-0}" = 1; then meminfo="$runtime_root/meminfo"; fi
available_memory_kib="$(awk '/^MemAvailable:/ { print $2; exit }' "$meminfo" 2>/dev/null || true)"
case "$available_memory_kib" in
  '' | *[!0-9]*) pause "PAUSE_HOST:INSUFFICIENT_MEMORY" ;;
esac
test "$available_memory_kib" -ge 10485760 || pause "PAUSE_HOST:INSUFFICIENT_MEMORY"

docker_version="$(docker version --format '{{.Server.Version}}')" ||
  pause "PAUSE_HOST:RUNTIME_VERSION"
printf '%s\n' "$docker_version" | awk -F. '
  ($1 > 29) || ($1 == 29 && $2 > 7) || ($1 == 29 && $2 == 7 && $3 >= 1) { ok = 1 }
  END { exit ok ? 0 : 1 }
' || pause "PAUSE_HOST:RUNTIME_VERSION"
compose_version="$(docker compose version --short)" || pause "PAUSE_HOST:RUNTIME_VERSION"
printf '%s\n' "$compose_version" | awk -F. '
  ($1 > 5) || ($1 == 5 && $2 > 3) || ($1 == 5 && $2 == 3 && $3 >= 1) { ok = 1 }
  END { exit ok ? 0 : 1 }
' || pause "PAUSE_HOST:RUNTIME_VERSION"

test "$(node --version)" = v24.19.0 || pause "PAUSE_HOST:TOOL_VERSION"
cosign version 2>/dev/null | grep -Eq 'GitVersion:[[:space:]]+v3\.1\.3' \
  || pause "PAUSE_HOST:TOOL_VERSION"
sqlite3 --version | awk -F. '
  ($1 > 3) || ($1 == 3 && $2 >= 40) { ok = 1 }
  END { exit ok ? 0 : 1 }
' || pause "PAUSE_HOST:TOOL_VERSION"

printf '%s\n' "EXTERNAL_GATES_OK"
