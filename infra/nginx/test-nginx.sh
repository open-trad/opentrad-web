#!/bin/sh
set -eu

script_directory="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repository_root="$(CDPATH= cd -- "$script_directory/../.." && pwd)"
. "$repository_root/infra/docker/base-images.lock"

for config in opentrad-http.conf opentrad.conf; do
  test -f "$PWD/infra/nginx/$config" || {
    printf '%s\n' "missing nginx configuration: $config" >&2
    exit 1
  }
done
test -f "$PWD/infra/nginx/opentrad-security-headers.conf" || {
  printf '%s\n' "missing nginx configuration: opentrad-security-headers.conf" >&2
  exit 1
}

grep -F 'proxy_pass http://127.0.0.1:13300' infra/nginx/opentrad.conf
grep -F 'client_max_body_size 55m' infra/nginx/opentrad.conf
grep -F 'proxy_request_buffering off' infra/nginx/opentrad.conf
grep -F 'include /etc/nginx/snippets/opentrad-security-headers.conf' infra/nginx/opentrad.conf
grep -F 'X-OpenTrad-Release $opentrad_release always' infra/nginx/opentrad-security-headers.conf
grep -F 'set $opentrad_release "REPLACE_WITH_EXACT_RELEASE_SHA"' infra/nginx/opentrad.conf
grep -F 'ssl_protocols TLSv1.2 TLSv1.3' infra/nginx/opentrad.conf
grep -F 'return 308 https://opentrad.dns.army$request_uri' infra/nginx/opentrad.conf
grep -F 'return 308 https://opentrad.dns.army$request_uri' infra/nginx/opentrad-http.conf
grep -A4 -F 'location / {' infra/nginx/opentrad.conf | grep -F 'Cache-Control "no-store"'
! grep -Eq '3010|13005|13200|13201' infra/nginx/opentrad*.conf

test "${STATIC_ONLY:-false}" = true && exit 0

docker image inspect "$NGINX_IMAGE" >/dev/null 2>&1 || {
  printf '%s\n' 'PAUSE_TEST_IMAGE:NGINX_1_22_1_UNAVAILABLE' >&2
  exit 78
}
command -v openssl >/dev/null 2>&1 || {
  printf '%s\n' 'PAUSE_TEST_RUNTIME:OPENSSL_UNAVAILABLE' >&2
  exit 78
}

temporary="$(mktemp -d "${TMPDIR:-/tmp}/opentrad-nginx.XXXXXX")"
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
mkdir -p "$temporary/live/opentrad.dns.army"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj '/CN=opentrad.dns.army' \
  -keyout "$temporary/live/opentrad.dns.army/privkey.pem" \
  -out "$temporary/live/opentrad.dns.army/fullchain.pem" >/dev/null 2>&1

for config in opentrad-http.conf opentrad.conf; do
  docker run --rm --platform linux/amd64 --pull=never \
    -v "$PWD/infra/nginx/$config:/etc/nginx/conf.d/default.conf:ro" \
    -v "$PWD/infra/nginx/opentrad-security-headers.conf:/etc/nginx/snippets/opentrad-security-headers.conf:ro" \
    -v "$temporary:/etc/letsencrypt:ro" \
    "$NGINX_IMAGE" nginx -t
done
