#!/bin/sh
set -eu

pause() {
  printf '%s\n' "PAUSE_HOST_TOOLS:$1" >&2
  exit 78
}

test "$(id -u)" -eq 0 || pause ROOT_REQUIRED
test "$(uname -m)" = x86_64 || pause ARCHITECTURE_UNSUPPORTED
lock_file=${1:-infra/deploy/host-tools.lock}
test -f "$lock_file" || pause LOCK_MISSING

lock_value() {
  key=$1
  value=$(sed -n "s/^$key=//p" "$lock_file")
  test -n "$value" && test "$(printf '%s\n' "$value" | wc -l | tr -d ' ')" = 1 \
    || pause LOCK_INVALID
  printf '%s' "$value"
}

node_version=$(lock_value NODE_VERSION)
node_sha256=$(lock_value NODE_LINUX_X64_SHA256)
cosign_version=$(lock_value COSIGN_VERSION)
cosign_sha256=$(lock_value COSIGN_LINUX_AMD64_SHA256)
printf '%s' "$node_version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || pause LOCK_INVALID
printf '%s' "$cosign_version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || pause LOCK_INVALID
printf '%s' "$node_sha256$cosign_sha256" | grep -Eq '^[a-f0-9]{128}$' || pause LOCK_INVALID

temporary=$(mktemp -d /run/opentrad-host-tools.XXXXXX)
chmod 0700 "$temporary"
trap 'rm -rf "$temporary"' EXIT HUP INT TERM

node_archive="node-v$node_version-linux-x64.tar.xz"
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
  "https://nodejs.org/dist/v$node_version/$node_archive" --output "$temporary/$node_archive"
printf '%s  %s\n' "$node_sha256" "$temporary/$node_archive" | sha256sum -c - >/dev/null \
  || pause NODE_CHECKSUM
tar -xJf "$temporary/$node_archive" -C "$temporary"
node_target="/opt/opentrad/tooling/node-v$node_version"
install -d -o root -g root -m 0755 /opt/opentrad/tooling
if test -x "$node_target/bin/node" \
  && test "$($node_target/bin/node --version)" = "v$node_version"; then
  :
elif test -e "$node_target"; then
  pause NODE_TARGET_CONFLICT
else
  node_next="$node_target.next"
  test ! -e "$node_next" || pause NODE_TARGET_CONFLICT
  mv "$temporary/node-v$node_version-linux-x64" "$node_next"
  chown -R root:root "$node_next"
  find "$node_next" -type d -exec chmod 0755 {} +
  mv -T "$node_next" "$node_target"
fi
ln -sfn "$node_target/bin/node" /usr/local/bin/node

cosign_binary="$temporary/cosign-linux-amd64"
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
  "https://github.com/sigstore/cosign/releases/download/v$cosign_version/cosign-linux-amd64" \
  --output "$cosign_binary"
printf '%s  %s\n' "$cosign_sha256" "$cosign_binary" | sha256sum -c - >/dev/null \
  || pause COSIGN_CHECKSUM
cosign_target="/opt/opentrad/tooling/cosign-v$cosign_version"
if test -x "$cosign_target" \
  && "$cosign_target" version 2>/dev/null | grep -Eq "GitVersion:[[:space:]]+v$cosign_version"; then
  :
elif test -e "$cosign_target"; then
  pause COSIGN_TARGET_CONFLICT
else
  install -o root -g root -m 0555 "$cosign_binary" "$cosign_target"
fi
ln -sfn "/opt/opentrad/tooling/cosign-v$cosign_version" /usr/local/bin/cosign

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends sqlite3 >/dev/null

test "$(node --version)" = "v$node_version" || pause NODE_VERSION
cosign version 2>/dev/null | grep -Eq "GitVersion:[[:space:]]+v$cosign_version" \
  || pause COSIGN_VERSION
sqlite3 --version | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+' || pause SQLITE_VERSION
printf '%s\n' "HOST_TOOLS_OK"
