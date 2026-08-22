# OpenTrad production runbook

This runbook prepares and deploys only `https://opentrad.dynv6.net`. GitHub Pages is a preview-only static build; it must not call `opentrad.dynv6.net/api` or enable server conversion.

## Hard boundaries

- The Compose project is exactly `opentrad`; the only new listener is `127.0.0.1:13300`.
- OpenTrad must not modify global Docker configuration, Docker systemd units, firewall tables, existing networks, or existing service Compose files.
- OpenTrad must not mutate or restart the existing `openvac-production`, `paperbanana-hk`, or `tensor-auto` services. Ports `3010`, `13005`, `13200`, and `13201` are immutable inventory.
- Never add `opentrad-deploy` to the Docker group. It may invoke only the sudo commands installed by the reviewed sudoers file.
- A `PAUSE_*` message exits with status 78. Stop at that point; do not substitute a guessed host, address, OAuth value, secret, digest, or release SHA.

## One-time operator gates

Perform each write once, then run the read-only check directly below it.

1. In dynv6, create an A record for `opentrad.dynv6.net` using the public IPv4 address observed from the production host at execution time. This repository intentionally contains no address.

   ```bash
   dig +short A opentrad.dynv6.net
   dig +short A opentrad.dynv6.net @ns1.dynv6.com
   ```

   Both results must be the currently observed production public IPv4 address. Otherwise stop with `PAUSE_DNS:PUBLIC_A_MISMATCH`.

2. Create a GitHub OAuth App with these exact URLs:

   - Homepage URL: `https://opentrad.dynv6.net`
   - Authorization callback URL: `https://opentrad.dynv6.net/api/auth/callback/github`

   Verify the saved values in GitHub Settings. Do not print the client secret. A mismatch is `PAUSE_OAUTH:CALLBACK_MISMATCH`.

3. Prepare the Better Auth secret, GitHub client ID, GitHub client secret, and ACME email. Install them once through the no-echo installer in the ordered bootstrap sequence below, then verify metadata only:

   ```bash
   sudo find /opt/opentrad/secrets -maxdepth 1 -type f -printf '%f %m %u:%g\n'
   ```

   The three required files must be root-owned mode `0400`; the verification prints names and metadata only. Missing or unsafe files are `PAUSE_SECRETS:*`.

4. In repository settings, create the GitHub environment `production`, add a required reviewer, and enable self-review prevention. Environment secrets are limited to the dedicated host, user, SSH key, and known-hosts entries referenced by `deploy-production.yml`.

   Read-only discovery before changing any repository protection:

   ```bash
   gh api repos/open-trad/opentrad-web/actions/runs --jq '.workflow_runs[0].head_sha'
   gh api repos/open-trad/opentrad-web/commits/$(git rev-parse HEAD)/check-runs --jq '.check_runs[].name'
   gh api repos/open-trad/opentrad-web/environments/production
   ```

   Require successful `lint`, `typecheck`, `unit`, `build`, `e2e`, `infra-policy`, `license`, and `privacy` checks on the default branch, one approving review, dismissed stale reviews, and linear history. If a named check has not run successfully, stop with `PAUSE_GITHUB:REQUIRED_CHECK_NOT_DISCOVERED`; do not mutate branch protection.

5. Install the dedicated SSH public key for `opentrad-deploy`. Verify only its fingerprint against the separately approved fingerprint:

   ```bash
   sudo ssh-keygen -lf /home/opentrad-deploy/.ssh/authorized_keys
   ```

6. Confirm the cloud security group exposes only the approved SSH administration source plus public TCP 80 and 443. Use the cloud console's read-only rule view; do not broaden SSH to the public internet.

7. Renew the Alibaba Cloud server before **2026-12-02**. Renewal is outside this repository. Verify the new expiry in the cloud console before the release window.

## Host bootstrap and dry run

Run from the exact reviewed source SHA. These are the ordered commands; do not skip the external gate or baseline.

```bash
sudo sh infra/deploy/install-host-tools.sh infra/deploy/host-tools.lock
sudo sh infra/deploy/bootstrap-host.sh
sudo sh infra/deploy/install-secrets.sh
sudo /usr/local/libexec/opentrad/check-external-gates.sh
sudo /usr/local/libexec/opentrad/capture-baseline.sh manual-preflight
docker compose --project-name opentrad -f infra/compose.prod.yml config --quiet
docker compose --project-name opentrad -f infra/compose.prod.yml --dry-run up -d
```

`install-host-tools.sh infra/deploy/host-tools.lock` must run before bootstrap and before external gates. It installs the checksum-locked Node and Cosign versions plus `sqlite3`; stop on any `PAUSE_HOST_TOOLS:*` result. Bootstrap repeats that installation idempotently, but it is not a substitute for the explicit preflight.

Read-only host checks:

```bash
sudo ss -ltnp
docker compose ls --format json
docker ps --format '{{.ID}} {{.Names}} {{.Status}} {{.Ports}}'
sudo nginx -t
```

The dry run may reference only project `opentrad` and listener `127.0.0.1:13300`. Any existing-service delta is `PAUSE_BASELINE:EXISTING_SERVICE_CHANGED`.

## Exact release and deploy

Release and deployment accept a 40-character commit, never a branch or floating tag. The release workflow builds production mode with `VITE_DEPLOYMENT_MODE=production` and `VITE_SERVER_API_ENABLED=true`, then signs both image digests and attests the image and web subjects. The protected deployment job verifies all evidence before transfer.

After the protected workflow stages the release, the only privileged deployment entry point is:

```bash
sudo /usr/local/libexec/opentrad/deploy-release.sh 0123456789abcdef0123456789abcdef01234567
```

The SHA above is syntax-only. Use the approved release SHA that exists on the host and whose manifest verifies. To verify without deploying:

```bash
node /opt/opentrad/releases/0123456789abcdef0123456789abcdef01234567/scripts/release/verify-manifest.mjs /opt/opentrad/releases/0123456789abcdef0123456789abcdef01234567/release-manifest.json
```

## Acceptance and stop decisions

Capture the post-deploy baseline and run the bounded gates:

```bash
sudo /usr/local/libexec/opentrad/capture-baseline.sh acceptance
sudo install -d -o root -g root -m 0700 /opt/opentrad/reports
sudo sh -c 'node /opt/opentrad/current/scripts/release/load-smoke.mjs --target https://opentrad.dynv6.net --profile-fd 3 3</run/opentrad/load-profile.json'
sudo sh -c 'node /opt/opentrad/current/scripts/release/privacy-sentinel.mjs --remote-profile production --markers-fd 3 3</run/opentrad/privacy-markers.json'
```

`/run/opentrad/load-profile.json` is a root-owned mode-`0600` object with exactly three `existingServices` entries. Each entry contains a non-secret ID, the observed container name, its HTTPS health URL, and the measured pre-release `baselineP95Ms`. Do not commit or guess these production values. The runner creates 12 temporary accounts and 1 KiB fixtures internally, respects registration rate limits, runs a 60-second ramp, five-minute hold, 60-second drain, and up-to-15-minute retention check, then attempts deletion of every temporary account. It stops submissions immediately on a threshold breach and emits only numeric metrics and stable failure codes.

`/run/opentrad/privacy-markers.json` is root-owned mode `0600` and contains only the operator-generated marker ID/value objects. The production profile discovers the `opentrad_auth_data` and `opentrad_job_ram` volume mountpoints, captures logs into `/run`, and scans all required evidence without placing markers on the command line.

- If canary fails, stop and pause traffic changes. Preserve sanitized numeric/status evidence, then have the operator choose rollback; never auto-restore the database.
- If load fails, stop new submissions and pause. Record only numeric metrics and opaque job IDs, compare the before/after baseline, and let the operator choose rollback.
- If privacy fails, stop and pause immediately, follow the privacy incident runbook, and do not copy any matched content into evidence.
- A green local build, preview Page, or release workflow is not production acceptance. Acceptance additionally requires the protected deployment, canary, privacy, load, and unchanged-existing-services results.

Cleanup may retain the current release and two verified predecessors. It must never run Docker system or volume prune.
