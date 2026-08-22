#!/bin/sh
set -eu

test "$(id -u)" -eq 0 || {
  printf '%s\n' "PAUSE_HOST:ROOT_REQUIRED" >&2
  exit 78
}

infra/deploy/install-host-tools.sh infra/deploy/host-tools.lock

runtime_group=opentrad-runtime
runtime_gid=10100
web_group=www-data
existing_runtime_group="$(getent group "$runtime_gid" | cut -d: -f1 || true)"
if test -n "$existing_runtime_group" && test "$existing_runtime_group" != "$runtime_group"; then
  printf '%s\n' "PAUSE_HOST:RUNTIME_GID_COLLISION" >&2
  exit 78
fi
getent group "$runtime_group" >/dev/null 2>&1 ||
  groupadd --system --gid "$runtime_gid" "$runtime_group"
if ! getent group "$web_group" >/dev/null 2>&1 || ! id "$web_group" >/dev/null 2>&1; then
  printf '%s\n' "PAUSE_HOST:WEB_IDENTITY_MISSING" >&2
  exit 78
fi

id opentrad-deploy >/dev/null 2>&1 ||
  useradd --system --create-home --home-dir /home/opentrad-deploy \
    --shell /bin/bash opentrad-deploy
if id -nG opentrad-deploy | tr ' ' '\n' | grep -Fxq docker; then
  printf '%s\n' "PAUSE_HOST:DEPLOY_USER_IN_DOCKER_GROUP" >&2
  exit 78
fi
usermod --append --groups "$web_group" opentrad-deploy

install -d -o root -g "$web_group" -m 0750 /opt/opentrad
install -d -o root -g root -m 0700 /opt/opentrad/secrets /opt/opentrad/backups
install -d -o opentrad-deploy -g opentrad-deploy -m 0750 /opt/opentrad/incoming
install -d -o root -g "$web_group" -m 0750 /opt/opentrad/releases
install -d -o root -g opentrad-deploy -m 0750 /opt/opentrad/baselines
install -d -o root -g root -m 0755 /var/www/letsencrypt /usr/local/libexec/opentrad
for secret_name in better_auth_secret github_client_id github_client_secret; do
  if test -e "/opt/opentrad/secrets/$secret_name"; then
    chown root:"$runtime_group" "/opt/opentrad/secrets/$secret_name"
    chmod 0440 "/opt/opentrad/secrets/$secret_name"
  fi
done
visudo -cf infra/deploy/opentrad-deploy.sudoers
install -o root -g root -m 0440 infra/deploy/opentrad-deploy.sudoers \
  /etc/sudoers.d/opentrad-deploy
for script_name in \
  capture-baseline.sh check-external-gates.sh cleanup-incoming-release.sh cleanup-releases.sh deploy-release.sh \
  install-host-tools.sh rollback-release.sh run-acceptance.sh run-canary.sh seal-release.sh; do
  install -o root -g root -m 0555 "infra/deploy/$script_name" \
    "/usr/local/libexec/opentrad/$script_name"
done
install -o root -g root -m 0444 infra/deploy/host-tools.lock \
  /usr/local/libexec/opentrad/host-tools.lock
install -o root -g root -m 0444 infra/deploy/compare-baseline.mjs \
  /usr/local/libexec/opentrad/compare-baseline.mjs
install -o root -g root -m 0555 infra/deploy/capture-latency.mjs \
  /usr/local/libexec/opentrad/capture-latency.mjs
install -o root -g root -m 0444 infra/deploy/build-load-profile.mjs \
  /usr/local/libexec/opentrad/build-load-profile.mjs
install -d -o root -g root -m 0755 /usr/local/libexec/opentrad/release
for release_script in \
  load-smoke.mjs post-deploy-report.mjs privacy-sentinel.mjs release-utils.mjs verify-manifest.mjs; do
  install -o root -g root -m 0444 "scripts/release/$release_script" \
    "/usr/local/libexec/opentrad/release/$release_script"
done
printf '%s\n' "HOST_BOOTSTRAP_OK"
