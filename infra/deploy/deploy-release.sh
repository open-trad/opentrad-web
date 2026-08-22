#!/bin/sh
set -eu

pause() {
  printf '%s\n' "PAUSE_RELEASE:$1" >&2
  exit 78
}

release_sha=${1:-}
printf '%s' "$release_sha" | grep -Eq '^[a-f0-9]{40}$' || pause INVALID_SHA

if test "${OPENTRAD_TEST_MODE:-0}" = 1; then
  test -n "${OPENTRAD_ROOT:-}" || pause TEST_ROOT_MISSING
  test -n "${OPENTRAD_LIBEXEC:-}" || pause TEST_LIBEXEC_MISSING
  test -n "${OPENTRAD_NGINX_ROOT:-}" || pause TEST_NGINX_ROOT_MISSING
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
test -d "$release_dir" || pause ARTIFACT_MISSING
manifest="$release_dir/release-manifest.json"
verifier="$libexec/release/verify-manifest.mjs"
test -f "$manifest" && test -f "$verifier" || pause MANIFEST_MISSING
test -f "$release_dir/infra/nginx/opentrad.conf" \
  && test -f "$release_dir/infra/nginx/opentrad-security-headers.conf" || pause NGINX_ARTIFACT_MISSING

release_env="/run/opentrad-release-$release_sha.env"
if test "${OPENTRAD_TEST_MODE:-0}" = 1; then
  release_env="$opentrad_root/release-$release_sha.env"
fi
deploy_stage=external-gates
deploy_completed=false
report_directory="$opentrad_root/reports"
if test "${OPENTRAD_TEST_MODE:-0}" = 1; then
  install -d -m 0750 "$report_directory"
else
  install -d -o root -g opentrad-deploy -m 0750 "$report_directory"
fi
write_deploy_report() {
  REPORT_DEPLOYED="$deploy_completed" REPORT_FILE="$report_directory/$release_sha.json" \
    REPORT_SHA="$release_sha" REPORT_STAGE="$deploy_stage" node --input-type=module - <<'NODE'
import { chmodSync, renameSync, writeFileSync } from "node:fs";
const report = {
  createdAt: new Date().toISOString(),
  deployed: process.env.REPORT_DEPLOYED === "true",
  failedStage: process.env.REPORT_DEPLOYED === "true" ? null : process.env.REPORT_STAGE,
  schemaVersion: 1,
  sourceSha: process.env.REPORT_SHA,
};
const output = process.env.REPORT_FILE;
const temporary = `${output}.tmp-${process.pid}`;
writeFileSync(temporary, `${JSON.stringify(report)}\n`, { mode: 0o600 });
chmodSync(temporary, 0o600);
renameSync(temporary, output);
NODE
  if test "${OPENTRAD_TEST_MODE:-0}" != 1; then
    chown root:opentrad-deploy "$report_directory/$release_sha.json"
    chmod 0640 "$report_directory/$release_sha.json"
  fi
}
deployment_exit() {
  status=$?
  trap - EXIT HUP INT TERM
  write_deploy_report || true
  rm -f "$release_env" "$release_env.nginx"
  exit "$status"
}
trap deployment_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

"$libexec/check-external-gates.sh"
deploy_stage=before-baseline
"$libexec/capture-baseline.sh" before "$release_sha"

deploy_stage=manifest
node "$verifier" "$manifest" --emit-compose-env "$release_env"
chmod 0600 "$release_env"

compose() {
  docker compose --project-name opentrad \
    --project-directory "$release_dir/infra" \
    --env-file "$release_env" \
    -f "$release_dir/infra/compose.prod.yml" "$@"
}

deploy_stage=compose-render
compose config --quiet
compose --dry-run up -d
deploy_stage=image-pull
compose pull

deploy_stage=auth-volume-init
api_image="$(sed -n 's/^OPENTRAD_API_IMAGE=//p' "$release_env")"
printf '%s' "$api_image" | grep -Eq '^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$' || \
  pause API_IMAGE_INVALID
docker volume create opentrad_auth_data >/dev/null
docker run --rm --network none --user 0:0 --entrypoint /bin/sh \
  --mount type=volume,src=opentrad_auth_data,dst=/var/lib/opentrad \
  "$api_image" -c 'install -d -o 10001 -g 10100 -m 0700 /var/lib/opentrad'

database_volume=$(docker volume inspect opentrad_auth_data --format '{{.Mountpoint}}' 2>/dev/null || true)
if test -n "$database_volume" && test -f "$database_volume/opentrad.sqlite"; then
  deploy_stage=database-backup
  sqlite3 "$database_volume/opentrad.sqlite" 'PRAGMA integrity_check;' | grep -Fx ok >/dev/null
  install -d -o root -g root -m 0700 "$opentrad_root/backups"
  backup="$opentrad_root/backups/opentrad-$release_sha.sqlite"
  sqlite3 "$database_volume/opentrad.sqlite" ".backup '$backup'"
  chmod 0600 "$backup"
fi

deploy_stage=migration-dry-run
compose run --rm --no-deps api node /app/dist/db/migrate.js \
  --database /var/lib/opentrad/opentrad.sqlite --dry-run
deploy_stage=migration-apply
compose run --rm --no-deps api node /app/dist/db/migrate.js \
  --database /var/lib/opentrad/opentrad.sqlite --apply

deploy_stage=compose-up
compose up -d --wait --wait-timeout 180
deploy_stage=readiness
curl --fail --silent --show-error http://127.0.0.1:13300/api/health/ready >/dev/null

deploy_stage=static-switch
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
deploy_stage=nginx
nginx -t
systemctl reload nginx
deploy_stage=canary
"$libexec/run-canary.sh" "$release_sha"
deploy_stage=after-baseline
"$libexec/capture-baseline.sh" after "$release_sha"
deploy_stage=baseline-compare
node "$libexec/compare-baseline.mjs" \
  "$opentrad_root/baselines/before-$release_sha.json" \
  "$opentrad_root/baselines/after-$release_sha.json" \
  "$opentrad_root/baselines/diff-$release_sha.json"
deploy_stage=cleanup
"$libexec/cleanup-releases.sh" "$release_sha"

deploy_stage=deployed
deploy_completed=true
printf '%s\n' "DEPLOY_OK:$release_sha"
