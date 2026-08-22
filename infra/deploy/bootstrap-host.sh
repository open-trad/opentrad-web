#!/bin/sh
set -eu

test "$(id -u)" -eq 0 || {
  printf '%s\n' "PAUSE_HOST:ROOT_REQUIRED" >&2
  exit 78
}

infra/deploy/install-host-tools.sh infra/deploy/host-tools.lock

id opentrad-deploy >/dev/null 2>&1 ||
  useradd --system --create-home --home-dir /home/opentrad-deploy \
    --shell /bin/bash opentrad-deploy
if id -nG opentrad-deploy | tr ' ' '\n' | grep -Fxq docker; then
  printf '%s\n' "PAUSE_HOST:DEPLOY_USER_IN_DOCKER_GROUP" >&2
  exit 78
fi

install -d -o root -g opentrad-deploy -m 0750 /opt/opentrad
install -d -o root -g root -m 0700 /opt/opentrad/secrets /opt/opentrad/backups
install -d -o opentrad-deploy -g opentrad-deploy -m 0750 \
  /opt/opentrad/releases /opt/opentrad/baselines
install -d -o root -g root -m 0755 /var/www/letsencrypt /usr/local/libexec/opentrad
visudo -cf infra/deploy/opentrad-deploy.sudoers
install -o root -g root -m 0440 infra/deploy/opentrad-deploy.sudoers \
  /etc/sudoers.d/opentrad-deploy
for script_name in \
  capture-baseline.sh check-external-gates.sh cleanup-releases.sh deploy-release.sh \
  install-host-tools.sh rollback-release.sh run-canary.sh; do
  install -o root -g root -m 0555 "infra/deploy/$script_name" \
    "/usr/local/libexec/opentrad/$script_name"
done
install -o root -g root -m 0444 infra/deploy/host-tools.lock \
  /usr/local/libexec/opentrad/host-tools.lock
install -o root -g root -m 0444 infra/deploy/compare-baseline.mjs \
  /usr/local/libexec/opentrad/compare-baseline.mjs
printf '%s\n' "HOST_BOOTSTRAP_OK"
