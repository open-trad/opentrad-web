#!/bin/sh
set -eu

pause() {
  printf '%s\n' "PAUSE_ROLLBACK:$1" >&2
  exit 78
}

release_sha=${1:-}
printf '%s' "$release_sha" | grep -Eq '^[a-f0-9]{40}$' || pause INVALID_SHA
if test "${OPENTRAD_TEST_MODE:-0}" = 1; then
  test -n "${OPENTRAD_ROOT:-}" && test -n "${OPENTRAD_LIBEXEC:-}" \
    && test -n "${OPENTRAD_NGINX_ROOT:-}" || pause TEST_ROOT_MISSING
  opentrad_root=$OPENTRAD_ROOT
  libexec=$OPENTRAD_LIBEXEC
  nginx_root=$OPENTRAD_NGINX_ROOT
  install_root_directory() { install -d -m "$1" "$2"; }
  install_root_file() { install -m "$1" "$2" "$3"; }
elif test "$(id -u)" -eq 0; then
  opentrad_root=/opt/opentrad
  libexec=/usr/local/libexec/opentrad
  nginx_root=/etc/nginx
  install_root_directory() { install -d -o root -g root -m "$1" "$2"; }
  install_root_file() { install -o root -g root -m "$1" "$2" "$3"; }
else
  pause ROOT_REQUIRED
fi

release_dir="$opentrad_root/releases/$release_sha"
manifest="$release_dir/release-manifest.json"
verifier="$libexec/release/verify-manifest.mjs"
test -d "$release_dir" && test -f "$manifest" && test -f "$verifier" || pause ARTIFACT_MISSING
test -f "$release_dir/infra/nginx/opentrad.conf" \
  && test -f "$release_dir/infra/nginx/opentrad-security-headers.conf" || pause NGINX_ARTIFACT_MISSING

release_env="/run/opentrad-rollback-$release_sha.env"
if test "${OPENTRAD_TEST_MODE:-0}" = 1; then
  release_env="$opentrad_root/rollback-$release_sha.env"
fi
trap 'rm -f "$release_env" "$release_env.nginx"' EXIT HUP INT TERM
node "$verifier" "$manifest" --emit-compose-env "$release_env"
chmod 0600 "$release_env"

"$libexec/capture-baseline.sh" rollback-before "$release_sha"

docker compose --project-name opentrad \
  --project-directory "$release_dir/infra" \
  --env-file "$release_env" \
  -f "$release_dir/infra/compose.prod.yml" config --quiet
docker compose --project-name opentrad \
  --project-directory "$release_dir/infra" \
  --env-file "$release_env" \
  -f "$release_dir/infra/compose.prod.yml" pull
api_image="$(sed -n 's/^OPENTRAD_API_IMAGE=//p' "$release_env")"
printf '%s' "$api_image" | grep -Eq '^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$' || \
  pause API_IMAGE_INVALID
docker volume create opentrad_auth_data >/dev/null
docker run --rm --network none --user 0:0 --entrypoint /bin/sh \
  --mount type=volume,src=opentrad_auth_data,dst=/var/lib/opentrad \
  "$api_image" -c 'install -d -o 10001 -g 10100 -m 0700 /var/lib/opentrad'
docker compose --project-name opentrad \
  --project-directory "$release_dir/infra" \
  --env-file "$release_env" \
  -f "$release_dir/infra/compose.prod.yml" up -d --wait --wait-timeout 180
curl --fail --silent --show-error http://127.0.0.1:13300/api/health/ready >/dev/null

ln -sfn "$release_dir" "$opentrad_root/current.next"
node -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' \
  "$opentrad_root/current.next" "$opentrad_root/current"
rendered_nginx="$release_env.nginx"
sed "s/REPLACE_WITH_EXACT_RELEASE_SHA/$release_sha/g" \
  "$release_dir/infra/nginx/opentrad.conf" >"$rendered_nginx"
grep -Fq "REPLACE_WITH_EXACT_RELEASE_SHA" "$rendered_nginx" && pause NGINX_RENDER_FAILED
grep -Fq "$release_sha" "$rendered_nginx" || pause NGINX_RENDER_FAILED
for target_directory in sites-available sites-enabled snippets; do
  install_root_directory 0755 "$nginx_root/$target_directory"
done
install_root_file 0644 "$release_dir/infra/nginx/opentrad-security-headers.conf" \
  "$nginx_root/snippets/opentrad-security-headers.conf"
install_root_file 0644 "$rendered_nginx" "$nginx_root/sites-available/opentrad.conf"
ln -sfn "$nginx_root/sites-available/opentrad.conf" \
  "$nginx_root/sites-enabled/opentrad.conf"
nginx -t
systemctl reload nginx
"$libexec/run-canary.sh" "$release_sha"
"$libexec/capture-baseline.sh" rollback-after "$release_sha"
node "$libexec/compare-baseline.mjs" \
  "$opentrad_root/baselines/rollback-before-$release_sha.json" \
  "$opentrad_root/baselines/rollback-after-$release_sha.json" \
  "$opentrad_root/baselines/rollback-diff-$release_sha.json"

printf '%s\n' "ROLLBACK_OK:$release_sha"
