# OpenTrad production runbook

This runbook prepares and deploys only `https://opentrad.xyz`. GitHub Pages is a preview-only static build; it must not call `opentrad.xyz/api` or enable server conversion.

## Hard boundaries

- The Compose project is exactly `opentrad`; the only new listener is `127.0.0.1:13300`.
- OpenTrad must not modify global Docker configuration, Docker systemd units, firewall tables, existing networks, or existing service Compose files.
- OpenTrad must not mutate or restart the existing `openvac-production`, `paperbanana-hk`, or `tensor-auto` services. Ports `3010`, `13005`, `13200`, and `13201` are immutable inventory.
- Never add `opentrad-deploy` to the Docker group. It may invoke only the sudo commands installed by the reviewed sudoers file.
- A `PAUSE_*` message exits with status 78. Stop at that point; do not substitute a guessed host, address, OAuth value, secret, digest, or release SHA.

## One-time operator gates

Perform each write once, then run the read-only check directly below it.

1. In Alibaba Cloud DNS, create an A record for the root record `@` of `opentrad.xyz` using the public IPv4 address observed from the production host at execution time. This repository intentionally contains no address.

   ```bash
   dig +short A opentrad.xyz
   dig +short A opentrad.xyz @dns3.hichina.com
   ```

   Both results must be the currently observed production public IPv4 address. Otherwise stop with `PAUSE_DNS:PUBLIC_A_MISMATCH`.

2. Create a GitHub OAuth App with these exact URLs:

   - Homepage URL: `https://opentrad.xyz`
   - Authorization callback URL: `https://opentrad.xyz/api/auth/callback/github`

   Verify the saved values in GitHub Settings. Do not print the client secret. A mismatch is `PAUSE_OAUTH:CALLBACK_MISMATCH`.

3. Prepare the Better Auth secret, GitHub client ID, GitHub client secret, and ACME email. Install them once through the no-echo installer in the ordered bootstrap sequence below, then verify metadata only:

   ```bash
   sudo find /opt/opentrad/secrets -maxdepth 1 -type f -printf '%f %m %u:%g\n'
   ```

   The four required files are `better_auth_secret`, `github_client_id`, `github_client_secret`, and `acme_email`. The first three must be owned by `root:opentrad-runtime` with mode `0440`; `acme_email` must be owned by `root:root` with mode `0400`. The directory remains `root:root` mode `0700`. The verification prints names and metadata only. Missing or unsafe files are `PAUSE_SECRETS:*`.

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
sudo docker compose --project-name opentrad -f infra/compose.prod.yml config --quiet
sudo docker compose --project-name opentrad -f infra/compose.prod.yml --dry-run up -d
```

`install-host-tools.sh infra/deploy/host-tools.lock` must run before bootstrap and before external gates. It installs the checksum-locked Node and Cosign versions plus `sqlite3`; stop on any `PAUSE_HOST_TOOLS:*` result. Bootstrap repeats that installation idempotently, but it is not a substitute for the explicit preflight.

After DNS is correct and before the first application deployment, enable only the HTTP challenge site, obtain the certificate with the host's existing Certbot installation, and then leave the final HTTPS-site switch to the reviewed deploy state machine. Never enable both OpenTrad site files together.

```bash
sudo install -o root -g root -m 0644 infra/nginx/opentrad-http.conf /etc/nginx/sites-available/opentrad-http.conf
sudo ln -sfn /etc/nginx/sites-available/opentrad-http.conf /etc/nginx/sites-enabled/opentrad-http.conf
sudo rm -f /etc/nginx/sites-enabled/opentrad.conf
sudo nginx -t
sudo systemctl reload nginx
sudo install -d -o root -g root -m 0700 /run/opentrad
sudo sh -c 'set -eu; trap "rm -f /run/opentrad/certbot.ini" EXIT HUP INT TERM; umask 077; printf "email = %s\n" "$(cat /opt/opentrad/secrets/acme_email)" > /run/opentrad/certbot.ini; certbot --config /run/opentrad/certbot.ini certonly --webroot --webroot-path /var/www/letsencrypt --domain opentrad.xyz --non-interactive --agree-tos'
sudo test -s /etc/letsencrypt/live/opentrad.xyz/fullchain.pem
sudo test -s /etc/letsencrypt/live/opentrad.xyz/privkey.pem
sudo certbot renew --dry-run
```

Any missing certificate, failed `nginx -t`, reload failure, or renewal dry-run failure is `PAUSE_TLS:*`. After deployment, require TLS 1.2 and 1.3 to connect and reject older protocol versions; inspect the certificate hostname and expiry without printing key material.

```bash
openssl s_client -connect opentrad.xyz:443 -servername opentrad.xyz -tls1_2 </dev/null
openssl s_client -connect opentrad.xyz:443 -servername opentrad.xyz -tls1_3 </dev/null
```

Read-only host checks:

```bash
sudo ss -ltnp
sudo docker compose ls --format json
sudo docker ps --format '{{.ID}} {{.Names}} {{.Status}} {{.Ports}}'
sudo nginx -t
```

The dry run may reference only project `opentrad` and listener `127.0.0.1:13300`. Any existing-service delta is `PAUSE_BASELINE:EXISTING_SERVICE_CHANGED`.

## Exact release and deploy

Release and deployment accept a 40-character commit, never a branch or floating tag. Manual release and deploy dispatches must run from `refs/heads/main`; the only tag identity permitted by the verifier is the explicit `v1.0.0` tag, and its commit must also be reachable from protected `origin/main`. The release workflow builds production mode with `VITE_DEPLOYMENT_MODE=production` and `VITE_SERVER_FEATURES_ENABLED=true`, then signs both OpenTrad image digests and attests the image and web subjects. The upstream ClamAV image has no repository-verifiable signing identity in this release contract, so it fails closed unless its locked digest, Trivy report, and SPDX SBOM all verify and the manifest records `upstream-unsigned-digest-pinned-trivy-gated`. The protected deployment job independently proves main ancestry and verifies all hashes, signatures, and attestations before transfer.

CI uploads only to `/opt/opentrad/incoming/<SHA>.incoming-<run-id>-<attempt>`. It seals through the fixed root-owned `seal-release.sh` sudo interface. On every failed upload or seal, it invokes only the fixed `cleanup-incoming-release.sh` sudo interface; operators and CI must never directly remove `.incoming` paths.

After the protected workflow stages the release, the only privileged deployment entry point is:

```bash
sudo /usr/local/libexec/opentrad/deploy-release.sh 0123456789abcdef0123456789abcdef01234567
```

The SHA above is syntax-only. Use the approved release SHA that exists on the host and whose manifest verifies. To verify without deploying:

```bash
node /opt/opentrad/releases/0123456789abcdef0123456789abcdef01234567/scripts/release/verify-manifest.mjs /opt/opentrad/releases/0123456789abcdef0123456789abcdef01234567/release-manifest.json
```

## Acceptance and stop decisions

Deployment success and formal acceptance are separate records. A deployment report may state that the release switched and canary passed, but it must not set formal `accepted: true`. Invoke the fixed wrapper only after the deploy state machine has written the SHA-bound deployment, canary, and privacy-marker evidence. The wrapper builds its load profile from the pre-deploy baseline and uses the marker file produced by that canary's one real accepted upload; it never accepts an operator-supplied random marker. It creates `/opt/opentrad/reports/acceptance-<SHA>.json` only after baseline, canary, load, and privacy all pass:

```bash
sudo /usr/local/libexec/opentrad/capture-baseline.sh acceptance
sudo install -d -o root -g root -m 0700 /opt/opentrad/reports
sudo /usr/local/libexec/opentrad/run-acceptance.sh 0123456789abcdef0123456789abcdef01234567
node /opt/opentrad/current/scripts/release/post-deploy-report.mjs --verify 0123456789abcdef0123456789abcdef01234567 /opt/opentrad/reports/acceptance-0123456789abcdef0123456789abcdef01234567.json
```

The root-owned wrapper opens the two profile files by descriptor and internally runs `load-smoke.mjs --target https://opentrad.xyz --profile-fd 3` followed by `privacy-sentinel.mjs --remote-profile production --markers-fd 3`. These exact commands belong in the trusted wrapper, not in an operator shell where credential-bearing profile contents could be expanded or logged.

The wrapper's temporary load profile is root-only and contains exactly three `existingServices` entries derived from the recorded baseline. Each entry contains a non-secret ID, the observed container name, its HTTPS health URL, and the measured pre-release `baselineP95Ms`. Do not commit, edit, or guess these production values. The runner creates 12 temporary accounts and 1 KiB fixtures internally, respects registration rate limits, runs a 60-second ramp, five-minute hold, 60-second drain, and up-to-15-minute retention check, then attempts deletion of every temporary account. It stops submissions immediately on a threshold breach and emits only numeric metrics and stable failure codes.

`/opt/opentrad/reports/markers-<SHA>.json` is created root-only by the authenticated canary after its upload is accepted. Its three values are the unique token embedded in that fixture's filename, the token in its body, and the preserved metadata value. The acceptance wrapper requires the matching SHA-bound marker report and passes it only by file descriptor. Never replace it with a random or otherwise unuploaded marker: absence of a value the service never processed proves nothing. The production profile discovers the `opentrad_auth_data` and `opentrad_job_ram` volume mountpoints, captures logs into `/run`, and scans all required evidence without placing marker values on the command line.

- If canary fails, stop and pause traffic changes. Preserve sanitized numeric/status evidence, then have the operator choose rollback; never auto-restore the database.
- If load fails, stop new submissions and pause. Record only numeric metrics and opaque job IDs, compare the before/after baseline, and let the operator choose rollback.
- If privacy fails, stop and pause immediately, follow the privacy incident runbook, and do not copy any matched content into evidence.
- A green local build, preview Page, release workflow, or deployment report is not production acceptance. Acceptance additionally requires the protected deployment plus a verified formal report whose baseline, canary, privacy, and load gates are all exactly `true`; a missing report or missing/false gate fails the workflow.

Cleanup may retain the current release and two verified predecessors. It must never run Docker system or volume prune.
