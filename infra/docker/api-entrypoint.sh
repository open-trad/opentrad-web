#!/bin/sh
set -eu

read_secret() {
  variable_name="$1"
  secret_path="$2"
  test -r "$secret_path" || {
    printf '%s\n' "PAUSE_RUNTIME:SECRET_UNREADABLE:$variable_name" >&2
    exit 78
  }
  secret_value="$(cat "$secret_path")"
  test -n "$secret_value" || {
    printf '%s\n' "PAUSE_RUNTIME:SECRET_EMPTY:$variable_name" >&2
    exit 78
  }
  export "$variable_name=$secret_value"
}

read_secret BETTER_AUTH_SECRET /run/secrets/better_auth_secret
read_secret GITHUB_CLIENT_ID /run/secrets/github_client_id
read_secret GITHUB_CLIENT_SECRET /run/secrets/github_client_secret

if test -z "${OPENTRAD_TRUSTED_PROXY_CIDR:-}"; then
  trusted_proxy_gateway="$(node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const rows = readFileSync("/proc/net/route", "utf8").trim().split("\n").slice(1);
    const route = rows.map((row) => row.trim().split(/\s+/)).find((fields) =>
      fields.length >= 4 && fields[1] === "00000000" && (Number.parseInt(fields[3], 16) & 2) === 2
    );
    const encoded = route?.[2];
    if (!encoded || !/^[A-Fa-f0-9]{8}$/.test(encoded)) process.exit(78);
    const octets = encoded.match(/../g).reverse().map((part) => Number.parseInt(part, 16));
    if (octets.every((octet) => octet === 0)) process.exit(78);
    process.stdout.write(octets.join("."));
  ')" || {
    printf '%s\n' 'PAUSE_RUNTIME:TRUSTED_PROXY_UNAVAILABLE' >&2
    exit 78
  }
  test -n "$trusted_proxy_gateway" || {
    printf '%s\n' 'PAUSE_RUNTIME:TRUSTED_PROXY_UNAVAILABLE' >&2
    exit 78
  }
  export OPENTRAD_TRUSTED_PROXY_CIDR="$trusted_proxy_gateway/32"
fi

exec node dist/server.js
