#!/bin/sh
set -eu

api_image="${1:?API image is required}"
worker_image="${2:?worker image is required}"

assert_uid() {
  image="$1"
  expected="$2"
  actual="$(docker run --rm --entrypoint /usr/bin/id "$image" -u)"
  test "$actual" = "$expected"
}

assert_read_only() {
  image="$1"
  docker run --rm --read-only --entrypoint /bin/sh "$image" -c \
    'if touch /opentrad-policy-write 2>/dev/null; then exit 1; fi'
}

assert_clean_image() {
  image="$1"
  docker run --rm --entrypoint /bin/sh "$image" -c \
    'test ! -e /src && test ! -e /app/src && test ! -e /app/tests && test ! -e /root/.ssh && test ! -e /run/secrets/better_auth_secret'
}

assert_uid "$api_image" 10001
assert_uid "$worker_image" 10002
assert_read_only "$api_image"
assert_read_only "$worker_image"
assert_clean_image "$api_image"
assert_clean_image "$worker_image"

docker run --rm --network none --read-only \
  --env OPENTRAD_VERIFY_ONLY=true \
  --tmpfs /run/opentrad:rw,nodev,nosuid,noexec,size=64m,uid=10002,gid=10002,mode=0700 \
  --tmpfs /work:rw,nodev,nosuid,noexec,size=2g,uid=10002,gid=10002,mode=0700 \
  "$worker_image"
