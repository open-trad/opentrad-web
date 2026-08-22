# OpenTrad production deployment

This directory deploys only `opentrad.dynv6.net` as Compose project `opentrad`. It must not
modify the existing `openvac-production`, `paperbanana-hk`, or `tensor-auto` projects. Their
published ports `3010`, `13005`, `13200`, and `13201` are immutable; OpenTrad alone may add
`127.0.0.1:13300`.

## First host bootstrap

Run from a reviewed release checkout as root:

```sh
infra/deploy/install-host-tools.sh infra/deploy/host-tools.lock
infra/deploy/bootstrap-host.sh
infra/deploy/install-secrets.sh
/usr/local/libexec/opentrad/capture-baseline.sh manual-preflight
```

`install-secrets.sh` prompts without echo and writes only root-owned mode `0400` files. Never
put the Better Auth secret, GitHub OAuth values, or ACME email in a command line, Compose file,
release artifact, log, or CI output.

After the DNS A record resolves only to the host's public IPv4 address, install
`infra/nginx/opentrad-http.conf` as the only OpenTrad Nginx site, test and reload Nginx, then
obtain the certificate with the existing Certbot webroot flow at `/var/www/letsencrypt`.
Do not enable `opentrad-http.conf` and `opentrad.conf` together. The deploy state machine
installs the final HTTPS site only after the signed release has started and passed local
readiness.

## Release

The release directory name and argument are the exact lowercase 40-character Git SHA. CI must
produce a verified manifest, immutable image digests, SBOMs, vulnerability evidence, the built
web tree, and all referenced scripts under:

```text
/opt/opentrad/releases/<sha>
```

The unprivileged deploy account may stage that directory, but it is not a member of the Docker
group. Start the release only through the exact sudo allowlist:

```sh
sudo /usr/local/libexec/opentrad/deploy-release.sh <sha>
```

The state machine runs external gates, before/after baselines, manifest verification, Compose
render/dry-run, digest pulls, SQLite integrity/backup, migration dry-run/apply, readiness,
atomic static switch, Nginx validation/reload, authenticated one-shot conversion canary,
privacy cleanup, existing-service comparison, and bounded release cleanup in that order.

Success is exactly `RELEASE_OK:<sha>`. Any `PAUSE_*` is a stop condition, not permission to
bypass a gate.

## Rollback

Rollback accepts only a verified prior release directory. It switches static assets and exact
API/worker image digests, waits for readiness, reloads the OpenTrad Nginx site, and reruns the
canary:

```sh
sudo /usr/local/libexec/opentrad/rollback-release.sh <prior-sha>
```

It never runs `compose down -v`, prunes Docker, restores SQLite, or touches another Compose
project.

Database restore is separate break-glass work. First select an integrity-checked backup, take a
new copy of the live database, stop only `opentrad_api` and `opentrad_worker`, restore through
SQLite's `.restore`, run `PRAGMA integrity_check`, and start only those two services. Record the
incident and exact backup SHA before proceeding; never infer database rollback from an image
rollback.

## Acceptance

After deployment, verify the public HTTPS origin, OAuth login, a local-only conversion, an
authenticated server conversion and one-shot download, mobile layout, security headers, and
certificate renewal simulation. Then capture the named acceptance baseline:

```sh
sudo /usr/local/libexec/opentrad/capture-baseline.sh acceptance
```

Compare all three existing projects, their container IDs/digests/networks/ports/restart and
health state, host listeners, and five consecutive latency windows before calling the release
complete.
