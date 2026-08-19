# OpenTrad Production Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, sign, deploy, verify, and safely roll back OpenTrad at `https://opentrad.dynv6.net` without changing or degrading PaperBanana, Tensor Auto, OpenVac, global Docker configuration, or any existing Compose project.

**Architecture:** CI produces immutable API and worker images, SBOMs, vulnerability reports, and a signed release manifest. A dedicated unprivileged host account stages one release directory, checks DNS/OAuth/secrets and an existing-service baseline, then invokes narrowly allowlisted root scripts for Compose and Nginx. OpenTrad is its own Compose project; only the API binds `127.0.0.1:13300`, the worker has no network, job bytes live on tmpfs, and Nginx exposes the same-origin web/API surface. Deployment is an atomic static-directory switch followed by canary, privacy, load, and no-change checks.

**Tech Stack:** GitHub Actions, Node.js 24.19.0, pnpm 10.28.2, Docker Engine 29.7.1, Docker Compose 5.3.1 or newer, Buildx 0.36.1, Debian 12, Nginx 1.22.1, Certbot 2.1.0, Trivy 0.74.0, Syft 1.51.0, Cosign 3.1.3, LibreOffice 26.2.5, Pandoc 3.10.2, OCRmyPDF 17.10.0, Tesseract 5.5.3, qpdf 12.4.0, Poppler 26.08.0, libvips 8.18.5, and ClamAV 1.5.4.

---

## Locked production boundaries

- The only production hostname is `opentrad.dynv6.net`. GitHub Pages remains a static preview/project page and never calls production APIs.
- OpenTrad uses Compose project `opentrad`. Existing projects `openvac-production`, `paperbanana-hk`, and `tensor-auto` are inventory subjects only.
- Existing listeners `3010`, `13005`, `13200`, and `13201` are immutable. OpenTrad may add only `127.0.0.1:13300`; Nginx already owns public ports 80 and 443.
- Do not edit `/etc/docker/daemon.json`, Docker's systemd unit, global iptables/nftables, existing Compose files, existing Docker networks, or existing Nginx server blocks.
- Do not add the deploy account to the `docker` group. Root operations are exposed only through exact sudoers commands.
- Worker containers have `network_mode: none`, no Docker socket, a read-only root filesystem, dropped Linux capabilities, `no-new-privileges`, PID/CPU/memory limits, and tmpfs work directories.
- Source files and results never enter logs, SQLite backups, release artifacts, or image layers. Job bytes exist only on tmpfs and are removed immediately after download or within 15 minutes after failure/cancellation/non-download.
- The Alibaba Cloud host must be renewed before 2026-12-02. Renewal is an operator action outside this repository.
- Every external dependency gate fails closed with exit code 78 and a stable `PAUSE_*` code. A deploy cannot continue by accepting a guessed value.

## Corrected upstream versions and primary references

- [Node.js 24.19.0 archive](https://nodejs.org/en/blog/release/v24.19.0)
- [Docker Engine release notes](https://docs.docker.com/engine/release-notes/29/)
- [Docker Compose releases](https://github.com/docker/compose/releases)
- [Docker Buildx releases](https://github.com/docker/buildx/releases)
- [LibreOffice 26.2.5 announcement](https://blog.documentfoundation.org/blog/2026/07/24/libreoffice-26-2-5/)
- [Pandoc releases](https://pandoc.org/releases.html)
- [OCRmyPDF releases](https://github.com/ocrmypdf/OCRmyPDF/releases)
- [Tesseract releases](https://github.com/tesseract-ocr/tesseract/releases)
- [qpdf releases](https://github.com/qpdf/qpdf/releases)
- [Poppler releases](https://poppler.freedesktop.org/releases.html)
- [libvips releases](https://github.com/libvips/libvips/releases)
- [ClamAV downloads](https://www.clamav.net/downloads)
- [Trivy releases](https://github.com/aquasecurity/trivy/releases)
- [Syft releases](https://github.com/anchore/syft/releases)
- [Cosign releases](https://github.com/sigstore/cosign/releases)
- [GitHub artifact attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations)
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [dynv6 API](https://dynv6.com/docs/apis)
- [Certbot Nginx instructions](https://certbot.eff.org/instructions?ws=nginx&os=debianbuster)
- [Nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [Docker container hardening guidance](https://docs.docker.com/engine/security/)

## File map

### Supply chain and images

- Create `infra/docker/base-images.lock` — immutable OCI digest references for Node, Debian, and ClamAV.
- Create `infra/docker/toolchain.lock.json` — source URLs, semantic versions, SHA-256 values, licenses, and installed paths.
- Create `infra/docker/resolve-locks.mjs` — deterministic lock resolver that rejects missing upstream checksums.
- Create `infra/docker/verify-locks.mjs` — schema, checksum, license, and version invariant checks.
- Create `infra/docker/api.Dockerfile` — non-root runtime for the Fastify API.
- Create `infra/docker/api-entrypoint.sh` — reads runtime secrets from files and starts the API.
- Create `infra/docker/worker.Dockerfile` — pinned document toolchain and non-root worker runtime.
- Create `infra/docker/worker-entrypoint.sh` — verifies the toolchain before starting the worker.
- Create `infra/docker/clamd.conf` — local scan socket configuration with bounded limits.
- Create `infra/docker/verify-images.sh` — runtime UID, version, filesystem, and network-policy smoke assertions.

### Runtime isolation

- Create `infra/compose.prod.yml` — isolated API, worker, and ClamAV production project.
- Create `infra/runtime/api.env.example` — non-secret runtime keys with exact safe defaults.
- Create `infra/runtime/worker.env.example` — non-secret worker limits with exact safe defaults.
- Create `infra/runtime/README.md` — volume ownership and secret-file contract.
- Create `infra/tests/compose-policy.test.mjs` — rendered-Compose policy assertions.
- Create `infra/tests/image-policy.test.mjs` — Dockerfile and image smoke policy.

### Edge and TLS

- Create `infra/nginx/opentrad-http.conf` — ACME/bootstrap HTTP server.
- Create `infra/nginx/opentrad.conf` — final HTTPS static and reverse-proxy server.
- Create `infra/nginx/security-headers.conf` — CSP and browser security policy.
- Create `infra/nginx/test-nginx.sh` — containerized syntax/policy test.

### Host operations

- Create `infra/deploy/bootstrap-host.sh` — dedicated account/directories/sudoers installer.
- Create `infra/deploy/opentrad-deploy.sudoers` — exact root command allowlist.
- Create `infra/deploy/install-secrets.sh` — no-echo secret installation with mode 0400.
- Create `infra/deploy/check-external-gates.sh` — DNS, OAuth, secret, disk, and version gates.
- Create `infra/deploy/capture-baseline.sh` — normalized existing-service inventory.
- Create `infra/deploy/compare-baseline.mjs` — fail-closed no-change comparison.
- Create `infra/deploy/deploy-release.sh` — staged migration, Compose, static switch, and canary.
- Create `infra/deploy/rollback-release.sh` — previous static/images rollback without implicit database restore.
- Create `infra/deploy/run-canary.sh` — anonymous, authenticated, export, and header checks.
- Create `infra/deploy/cleanup-releases.sh` — keep current plus two older releases without Docker prune.
- Create `infra/deploy/README.md` — operator contract and exact command sequence.
- Create `infra/tests/external-gates.test.mjs`, `infra/tests/baseline.test.mjs`, and `infra/tests/deploy-order.test.mjs`.

### Release automation and proof

- Create `.github/workflows/release-images.yml` — build, scan, SBOM, sign, attest, and manifest.
- Create `.github/workflows/deploy-production.yml` — protected-environment deployment of an exact release SHA.
- Modify `.github/workflows/ci.yml` — add infra, license, privacy, and release-contract jobs.
- Modify `.github/workflows/deploy-pages.yml` — build explicitly in preview mode.
- Create `scripts/release/create-manifest.mjs` — exact web/API/worker/SBOM digest manifest.
- Create `scripts/release/verify-manifest.mjs` — signature and digest verification.
- Create `scripts/release/resolve-actions.mjs` — fail-closed GitHub Action tag-to-commit resolver.
- Create `scripts/release/check-licenses.mjs` — AGPL-compatible runtime dependency policy.
- Create `scripts/release/privacy-sentinel.mjs` — content-marker absence assertions.
- Create `scripts/release/load-smoke.mjs` — bounded queue and latency test.
- Create `scripts/release/post-deploy-report.mjs` — machine-readable acceptance report.
- Create `tests/release/release-contract.test.ts` — manifest and workflow contract.
- Create `tests/release/privacy-sentinel.test.ts` and `tests/release/load-smoke.test.ts`.
- Create `docs/operations/production-runbook.md`, `docs/operations/rollback-runbook.md`, and `docs/operations/privacy-runbook.md`.

## Task 1: Lock every release input before building

- [ ] **Step 1: Write the failing lock schema test**

Create `infra/tests/image-policy.test.mjs`:

~~~js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);

test("base images are digest pinned", () => {
  const lines = readFileSync(new URL("infra/docker/base-images.lock", root), "utf8")
    .trim()
    .split("\n");
  assert.deepEqual(lines.map((line) => line.split("=")[0]), [
    "NODE_IMAGE",
    "DEBIAN_IMAGE",
    "CLAMAV_IMAGE",
  ]);
  for (const line of lines) {
    assert.match(line, /^[A-Z_]+=.+@sha256:[a-f0-9]{64}$/);
  }
});

test("toolchain versions and checksums are exact", async () => {
  const lock = JSON.parse(
    readFileSync(new URL("infra/docker/toolchain.lock.json", root), "utf8"),
  );
  assert.deepEqual(
    Object.fromEntries(lock.tools.map((tool) => [tool.id, tool.version])),
    {
      libreoffice: "26.2.5",
      pandoc: "3.10.2",
      ocrmypdf: "17.10.0",
      tesseract: "5.5.3",
      qpdf: "12.4.0",
      poppler: "26.08.0",
      libvips: "8.18.5",
      clamav: "1.5.4",
    },
  );
  for (const tool of lock.tools) {
    assert.match(tool.source, /^https:\/\/[a-z0-9./_-]+$/i);
    assert.match(tool.sha256, /^[a-f0-9]{64}$/);
    assert.ok(tool.license.length > 2);
  }
});
~~~

- [ ] **Step 2: Run it and prove RED**

Run:

~~~bash
node --test infra/tests/image-policy.test.mjs
~~~

Expected: FAIL because `base-images.lock` and `toolchain.lock.json` do not exist.

- [ ] **Step 3: Implement deterministic lock resolution**

Create `infra/docker/resolve-locks.mjs`. It must:

1. run `docker buildx imagetools inspect --format '{{json .Manifest}}'` for `node:24.19.0-bookworm-slim`, `debian:12.12-slim`, and `clamav/clamav:1.5.4`;
2. require a manifest digest matching `sha256:[a-f0-9]{64}`;
3. fetch only the primary release metadata linked above;
4. accept a checksum only when it is published by that upstream or derivable from a reproducibly downloaded official artifact;
5. write both lock files atomically in sorted order; and
6. print a stable code such as `PAUSE_SUPPLY_CHAIN:CHECKSUM_UNAVAILABLE:libreoffice` using the exact allowlisted tool ID and exit 78 if any checksum cannot be verified.

Validate generated entries against this schema:

~~~ts
const ToolchainEntrySchema = z.object({
  id: z.enum([
    "libreoffice",
    "pandoc",
    "ocrmypdf",
    "tesseract",
    "qpdf",
    "poppler",
    "libvips",
    "clamav",
  ]),
  version: z.string().min(1),
  source: z.string().url().startsWith("https://"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  license: z.string().min(3),
}).strict();
~~~

- [ ] **Step 4: Resolve and verify**

Run:

~~~bash
node infra/docker/resolve-locks.mjs
node infra/docker/verify-locks.mjs
node --test infra/tests/image-policy.test.mjs
~~~

Expected GREEN: three digest-pinned base images and eight exact tool entries pass. Expected safe pause: exit 78 with one stable `PAUSE_SUPPLY_CHAIN` line and no partial lock-file change.

- [ ] **Step 5: Commit the supply-chain boundary**

~~~bash
git add infra/docker/base-images.lock infra/docker/toolchain.lock.json infra/docker/resolve-locks.mjs infra/docker/verify-locks.mjs infra/tests/image-policy.test.mjs
git commit -m "build: lock production image and conversion inputs"
~~~

## Task 2: Build minimal non-root API and worker images

- [ ] **Step 1: Extend the image policy test and prove RED**

Append assertions that both Dockerfiles:

- use an ARG populated from `base-images.lock`;
- have no floating `latest` tag;
- end with numeric non-root users 10001 and 10002;
- define read-only-compatible writable paths only under `/run/opentrad` and `/work`;
- contain no `curl | sh`, Docker socket, SSH key, or runtime package installation; and
- make the worker entrypoint call every tool's version command.

Run:

~~~bash
node --test infra/tests/image-policy.test.mjs
~~~

Expected: FAIL because the Dockerfiles and entrypoints are absent.

- [ ] **Step 2: Implement the API image**

Create `infra/docker/api.Dockerfile`:

~~~dockerfile
ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS build
WORKDIR /src
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/conversion-worker/package.json packages/conversion-worker/package.json
RUN pnpm fetch --frozen-lockfile
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm --filter @opentrad/api... build
RUN pnpm --filter @opentrad/api deploy --prod /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --gid 10001 opentrad-api \
 && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin opentrad-api \
 && mkdir -p /run/opentrad \
 && chown 10001:10001 /run/opentrad
COPY --from=build --chown=10001:10001 /out/ ./
COPY --chown=10001:10001 infra/docker/api-entrypoint.sh /usr/local/bin/opentrad-api
USER 10001:10001
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/opentrad-api"]
~~~

Create `infra/docker/api-entrypoint.sh`:

~~~sh
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
exec node apps/api/dist/server.js
~~~

- [ ] **Step 3: Implement the worker image**

Create `infra/docker/worker.Dockerfile` with two stages. The build stage downloads only URLs in `toolchain.lock.json`, verifies `sha256sum -c` before unpacking/installing, and creates a runtime root from exact artifacts. The final stage must be equivalent to:

~~~dockerfile
ARG DEBIAN_IMAGE
FROM ${DEBIAN_IMAGE} AS runtime
ENV HOME=/run/opentrad \
    XDG_CACHE_HOME=/run/opentrad/cache \
    TMPDIR=/work
RUN groupadd --gid 10002 opentrad-worker \
 && useradd --uid 10002 --gid 10002 --no-create-home --shell /usr/sbin/nologin opentrad-worker \
 && mkdir -p /run/opentrad /work \
 && chown -R 10002:10002 /run/opentrad /work
COPY --from=toolchain /opt/opentrad-tools /opt/opentrad-tools
COPY --from=toolchain /usr/lib /usr/lib
COPY --from=toolchain /usr/share /usr/share
COPY --chown=10002:10002 apps/worker/dist /app
COPY --chown=10002:10002 infra/docker/worker-entrypoint.sh /usr/local/bin/opentrad-worker
USER 10002:10002
ENTRYPOINT ["/usr/local/bin/opentrad-worker"]
~~~

The entrypoint runs the following exact probes before `node /app/server.js`:

~~~sh
libreoffice --version | grep -F '26.2.5'
pandoc --version | head -n 1 | grep -F '3.10.2'
ocrmypdf --version | grep -F '17.10.0'
tesseract --version 2>&1 | head -n 1 | grep -F '5.5.3'
qpdf --version | grep -F '12.4.0'
pdftoppm -v 2>&1 | grep -F '26.08.0'
vips --version | grep -F '8.18.5'
~~~

- [ ] **Step 4: Configure bounded ClamAV**

Create `infra/docker/clamd.conf`:

~~~conf
Foreground yes
TCPSocket 3310
TCPAddr 0.0.0.0
MaxFileSize 55M
MaxScanSize 55M
StreamMaxLength 55M
MaxRecursion 16
MaxFiles 10000
ReadTimeout 120
CommandReadTimeout 15
SendBufTimeout 120
LogTime yes
LogVerbose no
LogClean no
~~~

- [ ] **Step 5: Build and prove GREEN**

Run:

~~~bash
set -a
. infra/docker/base-images.lock
set +a
docker build --build-arg NODE_IMAGE="$NODE_IMAGE" -f infra/docker/api.Dockerfile -t opentrad-api:test .
docker build --build-arg DEBIAN_IMAGE="$DEBIAN_IMAGE" -f infra/docker/worker.Dockerfile -t opentrad-worker:test .
sh infra/docker/verify-images.sh opentrad-api:test opentrad-worker:test
node --test infra/tests/image-policy.test.mjs
~~~

Expected GREEN: both images report their exact non-root UID, the worker reports all seven tool versions, writes outside declared tmpfs paths fail, and neither image contains the source tree or secret-like files.

- [ ] **Step 6: Commit**

~~~bash
git add infra/docker infra/tests/image-policy.test.mjs
git commit -m "build: harden api and conversion worker images"
~~~

## Task 3: Define an isolated production Compose project

- [ ] **Step 1: Write rendered-Compose policy tests**

Create `infra/tests/compose-policy.test.mjs`. Load `docker compose --project-name opentrad --env-file test.env -f infra/compose.prod.yml config --format json` and assert:

- exactly `api`, `worker`, and `clamav` services;
- only API publishes a port and its target is `127.0.0.1:13300`;
- worker has `network_mode: none`;
- no service mounts `/var/run/docker.sock` or a host job path;
- API/worker use `read_only`, `cap_drop: [ALL]`, `no-new-privileges:true`, numeric user, PID/CPU/memory limits;
- the jobs volume is a 2 GiB `tmpfs` volume with `nodev,nosuid,noexec`;
- API and worker share only numeric supplemental group 10100 for the job tmpfs;
- only ClamAV and API share internal `scan`; and
- no network is external and no existing project name appears.

Run:

~~~bash
node --test infra/tests/compose-policy.test.mjs
~~~

Expected: FAIL because `infra/compose.prod.yml` does not exist.

- [ ] **Step 2: Implement the Compose specification**

Create `infra/compose.prod.yml`:

~~~yaml
name: opentrad

services:
  api:
    image: ${OPENTRAD_API_IMAGE:?OPENTRAD_API_IMAGE is required}
    user: "10001:10001"
    group_add: ["10100"]
    read_only: true
    init: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    pids_limit: 128
    cpus: 0.50
    mem_limit: 512m
    restart: unless-stopped
    ports:
      - "127.0.0.1:13300:3000"
    env_file: ./runtime/api.env.example
    environment:
      OPENTRAD_DATABASE_PATH: /var/lib/opentrad/opentrad.sqlite
      OPENTRAD_JOB_ROOT: /jobs
      OPENTRAD_CLAMD_HOST: clamav
      OPENTRAD_CLAMD_PORT: "3310"
    secrets:
      - better_auth_secret
      - github_client_id
      - github_client_secret
    volumes:
      - auth_data:/var/lib/opentrad
      - job_ram:/jobs
    tmpfs:
      - /run/opentrad:rw,nodev,nosuid,noexec,size=32m,uid=10001,gid=10001,mode=0700
    networks: [egress, scan]
    depends_on:
      clamav:
        condition: service_healthy
    healthcheck:
      test: [CMD, node, apps/api/dist/healthcheck.js]
      interval: 10s
      timeout: 3s
      retries: 12

  worker:
    image: ${OPENTRAD_WORKER_IMAGE:?OPENTRAD_WORKER_IMAGE is required}
    user: "10002:10002"
    group_add: ["10100"]
    read_only: true
    init: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    pids_limit: 256
    cpus: 1.25
    mem_limit: 3g
    restart: unless-stopped
    network_mode: none
    env_file: ./runtime/worker.env.example
    environment:
      OPENTRAD_JOB_ROOT: /jobs
    volumes:
      - job_ram:/jobs
    tmpfs:
      - /run/opentrad:rw,nodev,nosuid,noexec,size=64m,uid=10002,gid=10002,mode=0700
      - /work:rw,nodev,nosuid,noexec,size=2g,uid=10002,gid=10002,mode=0700
    healthcheck:
      test: [CMD, node, /app/healthcheck.js]
      interval: 10s
      timeout: 3s
      retries: 12

  clamav:
    image: ${CLAMAV_IMAGE:?CLAMAV_IMAGE is required}
    read_only: true
    init: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    pids_limit: 128
    cpus: 0.50
    mem_limit: 1280m
    restart: unless-stopped
    volumes:
      - clam_db:/var/lib/clamav
      - ./docker/clamd.conf:/etc/clamav/clamd.conf:ro
    tmpfs:
      - /run/clamav:rw,nodev,nosuid,noexec,size=16m
      - /tmp:rw,nodev,nosuid,noexec,size=64m
    networks: [egress, scan]
    healthcheck:
      test: [CMD-SHELL, clamdscan --ping 1]
      interval: 30s
      timeout: 5s
      retries: 20

networks:
  egress: {}
  scan:
    internal: true

volumes:
  auth_data:
  clam_db:
  job_ram:
    driver: local
    driver_opts:
      type: tmpfs
      device: tmpfs
      o: size=2g,uid=10001,gid=10100,mode=0770,nodev,nosuid,noexec

secrets:
  better_auth_secret:
    file: /opt/opentrad/secrets/better_auth_secret
  github_client_id:
    file: /opt/opentrad/secrets/github_client_id
  github_client_secret:
    file: /opt/opentrad/secrets/github_client_secret
~~~

The API passes admitted job manifests through `job_ram`; the worker polls that same volume through supplemental group 10100. API egress is required for GitHub OAuth token exchange and ClamAV egress is required for signature updates. Only the worker is networkless. ClamAV sees uploads only through the API streaming protocol, never through a persistent mount.

- [ ] **Step 3: Add exact non-secret environment contracts**

Create `infra/runtime/api.env.example`:

~~~dotenv
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
BETTER_AUTH_URL=https://opentrad.dynv6.net
TRUSTED_ORIGINS=https://opentrad.dynv6.net
SESSION_TTL_SECONDS=604800
JOB_TTL_SECONDS=900
MAX_ACTIVE_GLOBAL=1
MAX_QUEUED_GLOBAL=1
MAX_ACTIVE_PER_USER=1
MAX_JOBS_PER_USER_DAY=10
~~~

Create `infra/runtime/worker.env.example`:

~~~dotenv
NODE_ENV=production
WORKER_POLL_MILLISECONDS=250
WORKER_MAX_RUNTIME_SECONDS=600
WORKER_MAX_OUTPUT_BYTES=57671680
WORKER_ALLOW_NETWORK=false
~~~

- [ ] **Step 4: Render, inspect, and prove GREEN**

Run:

~~~bash
cp infra/runtime/api.env.example /tmp/opentrad-api.env
cp infra/runtime/worker.env.example /tmp/opentrad-worker.env
OPENTRAD_API_IMAGE=opentrad-api:test \
OPENTRAD_WORKER_IMAGE=opentrad-worker:test \
CLAMAV_IMAGE="$CLAMAV_IMAGE" \
docker compose --project-name opentrad -f infra/compose.prod.yml config --quiet
node --test infra/tests/compose-policy.test.mjs
~~~

Expected GREEN: policy assertions pass, `docker compose config --services` returns exactly three names, and no host operation occurs.

- [ ] **Step 5: Commit**

~~~bash
git add infra/compose.prod.yml infra/runtime infra/tests/compose-policy.test.mjs
git commit -m "ops: isolate the production compose project"
~~~

## Task 4: Add HTTP bootstrap, TLS termination, and same-origin routing

- [ ] **Step 1: Write the failing Nginx policy test**

Create `infra/nginx/test-nginx.sh`. It must render both configurations in `nginx:1.22.1` and assert:

~~~sh
#!/bin/sh
set -eu
for config in opentrad-http.conf opentrad.conf; do
  docker run --rm \
    -v "$PWD/infra/nginx/$config:/etc/nginx/conf.d/default.conf:ro" \
    -v "$PWD/infra/nginx/security-headers.conf:/etc/nginx/snippets/security-headers.conf:ro" \
    nginx:1.22.1 nginx -t
done
grep -F 'proxy_pass http://127.0.0.1:13300' infra/nginx/opentrad.conf
grep -F 'client_max_body_size 55m' infra/nginx/opentrad.conf
grep -F 'proxy_request_buffering off' infra/nginx/opentrad.conf
! grep -Eq '3010|13005|13200|13201' infra/nginx/opentrad*.conf
~~~

Run:

~~~bash
sh infra/nginx/test-nginx.sh
~~~

Expected: FAIL because the configurations do not exist.

- [ ] **Step 2: Implement the ACME bootstrap server**

Create `infra/nginx/opentrad-http.conf`:

~~~nginx
server {
    listen 80;
    listen [::]:80;
    server_name opentrad.dynv6.net;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type text/plain;
    }

    location / {
        return 308 https://$host$request_uri;
    }
}
~~~

- [ ] **Step 3: Implement security headers and final HTTPS routing**

Create `infra/nginx/security-headers.conf`:

~~~nginx
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy strict-origin-when-cross-origin always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
add_header Cross-Origin-Opener-Policy same-origin always;
add_header Cross-Origin-Resource-Policy same-origin always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header Content-Security-Policy "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' blob: data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; media-src 'self' blob:; manifest-src 'self'" always;
~~~

The narrow `wasm-unsafe-eval` allowance is for bundled local converters. PDF.js still sets `isEvalSupported: false` and scripting remains disabled as specified in the conversion/auth plan.

Create `infra/nginx/opentrad.conf`:

~~~nginx
server {
    listen 80;
    listen [::]:80;
    server_name opentrad.dynv6.net;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
    }
    location / {
        return 308 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name opentrad.dynv6.net;

    ssl_certificate /etc/letsencrypt/live/opentrad.dynv6.net/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/opentrad.dynv6.net/privkey.pem;
    include /etc/nginx/snippets/security-headers.conf;

    root /opt/opentrad/current/web;
    index index.html;
    client_max_body_size 55m;

    location = /index.html {
        add_header Cache-Control "no-store";
        try_files $uri =404;
    }

    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    location ^~ /api/ {
        proxy_pass http://127.0.0.1:13300;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_connect_timeout 3s;
        proxy_read_timeout 630s;
        proxy_send_timeout 630s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
~~~

- [ ] **Step 4: Prove GREEN and commit**

Run:

~~~bash
sh infra/nginx/test-nginx.sh
~~~

Expected GREEN: Nginx syntax passes, the API routes only to loopback 13300, and forbidden existing ports are absent.

~~~bash
git add infra/nginx
git commit -m "ops: add opentrad tls and same-origin routing"
~~~

## Task 5: Make external dependencies explicit safe pause gates

- [ ] **Step 1: Write failing exit-code tests**

Create `infra/tests/external-gates.test.mjs`. Spawn `check-external-gates.sh` with fake command binaries first on `PATH` and assert:

- wrong/missing DNS prints `PAUSE_DNS:OPENTRAD_RECORD_NOT_READY` and exits 78;
- absent OAuth files print `PAUSE_OAUTH:GITHUB_APP_NOT_CONFIGURED` and exit 78;
- a secret mode other than 0400 prints `PAUSE_SECRETS:UNSAFE_MODE` and exits 78;
- less than 12 GiB free prints `PAUSE_HOST:INSUFFICIENT_DISK` and exits 78;
- Docker/Compose below the locked minima prints `PAUSE_HOST:RUNTIME_VERSION` and exits 78;
- no failure prints secret contents, DNS credentials, or OAuth values.

Run:

~~~bash
node --test infra/tests/external-gates.test.mjs
~~~

Expected: FAIL because the gate script is absent.

- [ ] **Step 2: Implement deterministic gates**

Create `infra/deploy/check-external-gates.sh`:

~~~sh
#!/bin/sh
set -eu

pause() {
  printf '%s\n' "$1" >&2
  exit 78
}

public_ip="$(curl --fail --silent --show-error --max-time 5 https://api.ipify.org)" ||
  pause "PAUSE_DNS:PUBLIC_IP_UNAVAILABLE"
dns_ip="$(curl --fail --silent --show-error --max-time 5 \
  -H 'accept: application/dns-json' \
  'https://cloudflare-dns.com/dns-query?name=opentrad.dynv6.net&type=A' |
  node -e '
    let body="";
    process.stdin.on("data", (chunk) => body += chunk);
    process.stdin.on("end", () => {
      const json=JSON.parse(body);
      const answer=(json.Answer || []).find((item) => item.type === 1);
      if (!answer) process.exit(2);
      process.stdout.write(answer.data);
    });
  ')" || pause "PAUSE_DNS:OPENTRAD_RECORD_NOT_READY"
test "$dns_ip" = "$public_ip" ||
  pause "PAUSE_DNS:OPENTRAD_RECORD_NOT_READY"

for secret in better_auth_secret github_client_id github_client_secret; do
  path="/opt/opentrad/secrets/$secret"
  test -s "$path" || pause "PAUSE_OAUTH:GITHUB_APP_NOT_CONFIGURED"
  test "$(stat -c '%a' "$path")" = 400 ||
    pause "PAUSE_SECRETS:UNSAFE_MODE"
done
test -s /opt/opentrad/secrets/acme_email ||
  pause "PAUSE_TLS:ACME_EMAIL_NOT_CONFIGURED"
test "$(stat -c '%a' /opt/opentrad/secrets/acme_email)" = 400 ||
  pause "PAUSE_SECRETS:UNSAFE_MODE"

available_kib="$(df -Pk /opt/opentrad | awk 'NR==2 {print $4}')"
test "$available_kib" -ge 12582912 ||
  pause "PAUSE_HOST:INSUFFICIENT_DISK"
docker version --format '{{.Server.Version}}' | grep -Eq '^29\.' ||
  pause "PAUSE_HOST:RUNTIME_VERSION"
docker compose version --short | awk -F. '
  ($1 > 5) || ($1 == 5 && $2 >= 3) {ok=1}
  END {exit ok ? 0 : 1}
' || pause "PAUSE_HOST:RUNTIME_VERSION"
printf '%s\n' "EXTERNAL_GATES_OK"
~~~

The operator creates the dynv6 A record through the dynv6 console or API and creates a GitHub OAuth App with:

- Homepage URL: `https://opentrad.dynv6.net`
- Authorization callback URL: `https://opentrad.dynv6.net/api/auth/callback/github`

The script verifies results only; it never asks for a dynv6 token or GitHub client secret on the command line.

- [ ] **Step 3: Implement no-echo secret installation**

Create `infra/deploy/install-secrets.sh`. It reads each confidential value using `read -r -s`, rejects empty/newline values, writes through a root-owned temporary file, applies owner `root:root` and mode 0400, atomically renames into `/opt/opentrad/secrets`, clears shell variables, and prints names only. It must generate `better_auth_secret` locally from 32 cryptographically random bytes; the two GitHub values are entered by the operator. It reads `acme_email` normally, validates one `@` with no whitespace/control characters, and stores it with the same ownership/mode.

- [ ] **Step 4: Implement dedicated account bootstrap**

Create `infra/deploy/bootstrap-host.sh` with idempotent operations:

~~~sh
#!/bin/sh
set -eu
id opentrad-deploy >/dev/null 2>&1 ||
  useradd --system --create-home --home-dir /home/opentrad-deploy \
    --shell /bin/bash opentrad-deploy
getent group docker | grep -q 'opentrad-deploy' &&
  { printf '%s\n' 'PAUSE_HOST:DEPLOY_USER_IN_DOCKER_GROUP' >&2; exit 78; }
install -d -o root -g opentrad-deploy -m 0750 /opt/opentrad
install -d -o root -g root -m 0700 /opt/opentrad/secrets
install -d -o opentrad-deploy -g opentrad-deploy -m 0750 \
  /opt/opentrad/releases /opt/opentrad/baselines
install -d -o root -g root -m 0755 /var/www/letsencrypt
visudo -cf infra/deploy/opentrad-deploy.sudoers
install -o root -g root -m 0440 infra/deploy/opentrad-deploy.sudoers \
  /etc/sudoers.d/opentrad-deploy
~~~

The sudoers file allows only versioned, root-owned copies of `deploy-release.sh`, `rollback-release.sh`, `capture-baseline.sh`, and `nginx -t`/`systemctl reload nginx`. It provides no shell, editor, Docker CLI wildcard, Compose wildcard, or arbitrary path argument.

- [ ] **Step 5: Prove GREEN and commit**

Run:

~~~bash
node --test infra/tests/external-gates.test.mjs
shellcheck infra/deploy/*.sh
~~~

Expected GREEN: every simulated missing dependency exits 78 with one stable code; the success fixture prints `EXTERNAL_GATES_OK`.

~~~bash
git add infra/deploy/bootstrap-host.sh infra/deploy/install-secrets.sh infra/deploy/check-external-gates.sh infra/deploy/opentrad-deploy.sudoers infra/tests/external-gates.test.mjs
git commit -m "ops: add fail-closed production setup gates"
~~~

## Task 6: Capture and protect the existing-service baseline

- [ ] **Step 1: Write failing normalization and comparison tests**

Create `infra/tests/baseline.test.mjs` with fixtures for the three existing projects. Assert that comparison:

- ignores container start timestamps and transient CPU samples;
- rejects changed existing container ID, image digest, published port, network membership, restart count, health, or running state;
- allows only new names beginning `opentrad-`, loopback port 13300, and networks beginning `opentrad_`;
- rejects any existing service latency increase above 20 percent for five consecutive minutes; and
- emits a JSON difference and exits nonzero without modifying Docker.

Run:

~~~bash
node --test infra/tests/baseline.test.mjs
~~~

Expected: FAIL because baseline scripts are absent.

- [ ] **Step 2: Implement normalized inventory capture**

Create `infra/deploy/capture-baseline.sh`. It writes one JSON document using:

~~~bash
docker ps --no-trunc --format '{{json .}}'
docker inspect $(docker ps -q)
docker network ls --format '{{json .}}'
docker compose ls --format json
ss -lntp
docker stats --no-stream --format '{{json .}}'
df -Pk / /opt/opentrad
free -b
~~~

Normalize in Node.js: sort maps/arrays, keep existing project/container names, IDs, immutable image digests, published ports, network IDs, restart counts, state/health, and resource snapshot. Exclude OpenTrad objects from the before snapshot and never include environment variables, labels containing secret values, bind-mounted file contents, or command arguments.

- [ ] **Step 3: Implement comparison**

Create `infra/deploy/compare-baseline.mjs` with:

~~~js
const immutableExistingFields = [
  "containerId",
  "imageDigest",
  "publishedPorts",
  "networks",
  "restartCount",
  "state",
  "health",
];

export function compareExisting(before, after) {
  const differences = [];
  for (const [name, expected] of Object.entries(before.containers)) {
    const actual = after.containers[name];
    if (!actual) differences.push({ name, field: "present", expected: true, actual: false });
    for (const field of immutableExistingFields) {
      if (JSON.stringify(expected[field]) !== JSON.stringify(actual?.[field])) {
        differences.push({ name, field, expected: expected[field], actual: actual?.[field] });
      }
    }
  }
  return differences;
}
~~~

The CLI exits 1 for any difference and writes a diff file whose basename is the already validated 40-character release SHA, without secrets.

- [ ] **Step 4: Prove GREEN and commit**

Run:

~~~bash
node --test infra/tests/baseline.test.mjs
~~~

Expected GREEN: allowed additions pass; every existing-service mutation fails with its exact field.

~~~bash
git add infra/deploy/capture-baseline.sh infra/deploy/compare-baseline.mjs infra/tests/baseline.test.mjs
git commit -m "ops: protect existing host services during release"
~~~

## Task 7: Implement ordered deploy, canary, cleanup, and rollback

- [ ] **Step 1: Write the failing operation-order test**

Create `infra/tests/deploy-order.test.mjs` with fake binaries and an append-only command log. Assert this strict order:

1. validate 40-character lowercase release SHA;
2. external gates;
3. before baseline;
4. manifest signature/digests;
5. Compose render and dry-run;
6. image pull by signed digest;
7. SQLite integrity check and backup;
8. migration dry-run, then migration;
9. Compose up;
10. health wait;
11. static symlink switch;
12. Nginx test/reload;
13. canary;
14. after baseline and comparison;
15. cleanup only after all checks pass.

Run:

~~~bash
node --test infra/tests/deploy-order.test.mjs
~~~

Expected: FAIL because deploy and rollback scripts are absent.

- [ ] **Step 2: Implement deploy as a fail-fast state machine**

Create `infra/deploy/deploy-release.sh` with:

~~~sh
#!/bin/sh
set -eu
release_sha="${1:-}"
printf '%s' "$release_sha" | grep -Eq '^[a-f0-9]{40}$' ||
  { printf '%s\n' 'PAUSE_RELEASE:INVALID_SHA' >&2; exit 78; }
release_dir="/opt/opentrad/releases/$release_sha"
test -d "$release_dir" ||
  { printf '%s\n' 'PAUSE_RELEASE:ARTIFACT_MISSING' >&2; exit 78; }

/usr/local/libexec/opentrad/check-external-gates.sh
/usr/local/libexec/opentrad/capture-baseline.sh before "$release_sha"
release_env="/run/opentrad-release-$release_sha.env"
trap 'rm -f "$release_env"' EXIT HUP INT TERM
node "$release_dir/scripts/verify-manifest.mjs" \
  "$release_dir/release-manifest.json" \
  --emit-compose-env "$release_env"
chmod 0600 "$release_env"

compose() {
  docker compose --project-name opentrad \
    --project-directory "$release_dir/infra" \
    --env-file "$release_env" \
    -f "$release_dir/infra/compose.prod.yml" "$@"
}
compose config --quiet
compose --dry-run up -d
compose pull

database_volume="$(docker volume inspect opentrad_auth_data --format '{{.Mountpoint}}' 2>/dev/null || true)"
if test -n "$database_volume" && test -f "$database_volume/opentrad.sqlite"; then
  sqlite3 "$database_volume/opentrad.sqlite" 'PRAGMA integrity_check;' | grep -Fx ok
  install -d -o root -g root -m 0700 /opt/opentrad/backups
  sqlite3 "$database_volume/opentrad.sqlite" \
    ".backup '/opt/opentrad/backups/opentrad-$release_sha.sqlite'"
fi
compose run --rm --no-deps api node apps/api/dist/migrate.js \
  --database /var/lib/opentrad/opentrad.sqlite --dry-run
compose run --rm --no-deps api node apps/api/dist/migrate.js \
  --database /var/lib/opentrad/opentrad.sqlite --apply

compose up -d --wait --wait-timeout 180
curl --fail --silent --show-error http://127.0.0.1:13300/api/health/ready >/dev/null

ln -sfn "$release_dir" /opt/opentrad/current.next
mv -Tf /opt/opentrad/current.next /opt/opentrad/current
nginx -t
systemctl reload nginx
/usr/local/libexec/opentrad/run-canary.sh "$release_sha"
/usr/local/libexec/opentrad/capture-baseline.sh after "$release_sha"
node /usr/local/libexec/opentrad/compare-baseline.mjs \
  "/opt/opentrad/baselines/before-$release_sha.json" \
  "/opt/opentrad/baselines/after-$release_sha.json"
/usr/local/libexec/opentrad/cleanup-releases.sh "$release_sha"
~~~

- [ ] **Step 3: Implement representative canaries**

Create `infra/deploy/run-canary.sh`. It must:

- fetch `/`, `/templates`, and `/api/v1/capabilities`;
- assert HTTPS, final hostname, expected release header, CSP, HSTS, MIME, and no cache on HTML;
- register a uniquely generated 12-character test username/password through the same-origin API;
- submit one generated 1 KiB text-to-DOCX job with consent and an idempotency key;
- prove a duplicate key returns the same job ID;
- wait until complete, download once, verify DOCX ZIP magic, then prove the second result download is unavailable;
- delete the canary account/session and prove no canary username appears in API logs or SQLite text pages; and
- print `CANARY_OK:` followed by the validated 40-character release SHA only after all assertions.

All canary bytes are generated in tmpfs and destroyed by a trap.

- [ ] **Step 4: Implement rollback without implicit data rewind**

Create `infra/deploy/rollback-release.sh`. It accepts an exact prior SHA that exists in `/opt/opentrad/releases`, verifies its manifest, switches the static symlink, sets exact prior API/worker digest variables, runs `compose up -d --wait`, tests/reloads Nginx, and runs canary. It never runs `down -v` and never restores SQLite automatically.

Database restore is a separate documented break-glass command that first stops only `opentrad_api` and `opentrad_worker`, copies the live DB aside, runs `sqlite3 .restore` from a selected integrity-checked backup, then starts only those two services.

- [ ] **Step 5: Implement bounded cleanup**

Create `infra/deploy/cleanup-releases.sh`. It keeps the current release and two most recent verified prior directories, refuses paths outside `/opt/opentrad/releases/[a-f0-9]{40}`, and deletes nothing if the current symlink cannot be resolved. It never invokes `docker system prune`, `docker volume prune`, or removal of non-OpenTrad images/networks/volumes.

- [ ] **Step 6: Prove GREEN and commit**

Run:

~~~bash
node --test infra/tests/deploy-order.test.mjs
shellcheck infra/deploy/*.sh
~~~

Expected GREEN: success order matches exactly; injected failure at each step prevents all later mutating steps; rollback never invokes a volume deletion or implicit database restore.

~~~bash
git add infra/deploy/deploy-release.sh infra/deploy/rollback-release.sh infra/deploy/run-canary.sh infra/deploy/cleanup-releases.sh infra/tests/deploy-order.test.mjs
git commit -m "ops: add atomic deploy canary and rollback"
~~~

## Task 8: Produce signed images, SBOMs, and an immutable release manifest

- [ ] **Step 1: Write the failing release-contract tests**

Create `tests/release/release-contract.test.ts`:

~~~ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ReleaseManifestSchema } from "../../scripts/release/verify-manifest";

describe("production release contract", () => {
  it("binds one source SHA to content-addressed artifacts", () => {
    const manifest = ReleaseManifestSchema.parse({
      schemaVersion: 1,
      sourceSha: "a".repeat(40),
      webSha256: "b".repeat(64),
      apiImage: "ghcr.io/open-trad/opentrad-api@sha256:" + "c".repeat(64),
      workerImage: "ghcr.io/open-trad/opentrad-worker@sha256:" + "d".repeat(64),
      clamavImage: "clamav/clamav@sha256:" + "f".repeat(64),
      sbomSha256: "e".repeat(64),
      createdAt: "2026-08-19T00:00:00.000Z",
    });
    expect(manifest.sourceSha).toHaveLength(40);
  });

  it("pins every GitHub Action to a commit", () => {
    for (const path of [
      ".github/workflows/ci.yml",
      ".github/workflows/deploy-pages.yml",
      ".github/workflows/release-images.yml",
      ".github/workflows/deploy-production.yml",
    ]) {
      const yaml = readFileSync(path, "utf8");
      for (const match of yaml.matchAll(/uses:\s*[^@\s]+@([^\s]+)/g)) {
        expect(match[1]).toMatch(/^[a-f0-9]{40}$/);
      }
    }
  });
});
~~~

Run:

~~~bash
pnpm exec vitest run tests/release/release-contract.test.ts
~~~

Expected: FAIL because the release scripts/workflows do not exist and existing action references are not all immutable.

- [ ] **Step 2: Implement manifest creation and verification**

Create `scripts/release/create-manifest.mjs` using this schema:

~~~ts
export const ReleaseManifestSchema = z.object({
  schemaVersion: z.literal(1),
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  webSha256: z.string().regex(/^[a-f0-9]{64}$/),
  apiImage: z.string().regex(/^ghcr\.io\/open-trad\/opentrad-api@sha256:[a-f0-9]{64}$/),
  workerImage: z.string().regex(/^ghcr\.io\/open-trad\/opentrad-worker@sha256:[a-f0-9]{64}$/),
  clamavImage: z.string().regex(/^(docker\.io\/)?clamav\/clamav@sha256:[a-f0-9]{64}$/),
  sbomSha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
}).strict();
~~~

The creator accepts only `GITHUB_SHA` plus files produced in the current job, hashes sorted web output and the SPDX JSON SBOM, resolves pushed image digests with `docker buildx imagetools inspect`, copies the checked-in ClamAV digest from the verified base-image lock, serializes canonical JSON, and refuses a dirty checkout.

The verifier:

1. parses the strict schema;
2. checks `git rev-parse HEAD` equals `sourceSha`;
3. checks local web/SBOM hashes;
4. verifies API, worker, and ClamAV image manifests exist at their digests;
5. runs `cosign verify --certificate-identity-regexp '^https://github.com/open-trad/opentrad-web/.github/workflows/release-images.yml@refs/(tags|heads)/' --certificate-oidc-issuer https://token.actions.githubusercontent.com` for the two OpenTrad-built images; and
6. runs GitHub artifact-attestation verification.

- [ ] **Step 3: Resolve GitHub Action references without guessing**

Create `scripts/release/resolve-actions.mjs` with an allowlist of action and reviewed tag:

~~~js
const allowed = {
  "actions/checkout": "v4.2.2",
  "actions/setup-node": "v4.4.0",
  "actions/upload-artifact": "v4.6.2",
  "actions/download-artifact": "v4.3.0",
  "docker/setup-buildx-action": "v3.11.1",
  "docker/login-action": "v3.4.0",
  "docker/build-push-action": "v6.18.0",
  "aquasecurity/trivy-action": "0.33.1",
  "anchore/sbom-action": "0.20.5",
  "sigstore/cosign-installer": "v3.10.0",
};
~~~

For each entry, resolve the reviewed tag's peeled commit through the GitHub API, require a 40-character commit SHA, verify the repository owner/name, and rewrite only matching `uses` entries. If an action/tag is absent, rate-limited, or outside the allowlist, print `PAUSE_CI:ACTION_PIN_UNRESOLVED:actions-checkout` using the exact allowlisted action ID and exit 78 without modifying a workflow.

- [ ] **Step 4: Implement image release workflow**

Create `.github/workflows/release-images.yml` with:

- triggers `workflow_dispatch` with required 40-character `release_sha` input and tags matching `v[0-9]+.[0-9]+.[0-9]+`;
- checks out exactly the requested SHA and proves `git rev-parse HEAD` equals it;
- permissions `contents: read`, `packages: write`, `id-token: write`, and `attestations: write` only;
- Node 24.19.0 and pnpm 10.28.2;
- `pnpm install --frozen-lockfile`, lint, typecheck, unit, build, E2E, infra policy, license, and privacy checks;
- multi-stage API/worker builds from checked-in locks;
- GHCR pushes tagged by source SHA, immediately converted to digest references;
- Trivy 0.74.0 failure on unfixed CRITICAL/HIGH runtime findings, with a reviewed expiring ignore file for unavoidable CVEs;
- Syft 1.51.0 SPDX JSON for web and both images;
- keyless Cosign 3.1.3 signatures and GitHub attestations;
- canonical release manifest plus all scan/SBOM evidence as immutable artifacts; and
- no production SSH key, OAuth secret, dynv6 token, or runtime Better Auth secret.

Resolve action pins, then run:

~~~bash
node scripts/release/resolve-actions.mjs
actionlint .github/workflows/*.yml
pnpm exec vitest run tests/release/release-contract.test.ts
~~~

Expected GREEN: every `uses` reference is a 40-character SHA and the workflow graph has no production mutation.

- [ ] **Step 5: Implement protected deployment workflow**

Create `.github/workflows/deploy-production.yml`:

- `workflow_dispatch` requires a 40-character `release_sha`;
- job uses GitHub environment `production` with required reviewer and no self-approval;
- downloads only the manifest/evidence for that SHA;
- verifies signature/attestation before any SSH transfer;
- connects with the dedicated deploy key, uploads to a new exact SHA directory, verifies remote hashes, and calls the fixed sudo deploy command;
- captures the final acceptance report and baseline diff as artifacts even on failure; and
- never accepts a branch name, tag name, floating image tag, or arbitrary remote command.

- [ ] **Step 6: Extend CI and keep Pages explicitly preview-only**

Modify `.github/workflows/ci.yml` to run:

~~~bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
node --test infra/tests/*.test.mjs
pnpm run test:e2e
node scripts/release/check-licenses.mjs
node scripts/release/privacy-sentinel.mjs --fixture-mode
~~~

Modify `.github/workflows/deploy-pages.yml` so the build step sets:

~~~yaml
env:
  VITE_DEPLOYMENT_MODE: preview
  VITE_SERVER_API_ENABLED: "false"
~~~

The release build sets `VITE_DEPLOYMENT_MODE=production` and `VITE_SERVER_API_ENABLED=true`. Tests fail if a Pages artifact contains `opentrad.dynv6.net/api`.

- [ ] **Step 7: Prove GREEN and commit**

Run:

~~~bash
node scripts/release/resolve-actions.mjs
actionlint .github/workflows/*.yml
pnpm exec vitest run tests/release/release-contract.test.ts
node scripts/release/check-licenses.mjs
~~~

Expected GREEN: immutable action pins, strict manifest round-trip, accepted license report, and preview/production separation.

~~~bash
git add .github/workflows scripts/release tests/release/release-contract.test.ts
git commit -m "ci: sign and attest immutable production releases"
~~~

## Task 9: Prove queue limits, privacy deletion, and host stability

- [ ] **Step 1: Write failing privacy and load tests**

Create `tests/release/privacy-sentinel.test.ts` with unique markers for source filename, body, and metadata. It must fail if any marker appears in:

- API/worker/ClamAV/Nginx logs;
- SQLite main, WAL, SHM, or text dump;
- release manifest, SBOM, scan report, baseline, acceptance report, or backup;
- job tmpfs after download/cancel/failure/timeout/TTL/container restart; or
- host journal messages for OpenTrad units.

Create `tests/release/load-smoke.test.ts` that simulates 12 authenticated users and asserts global running count at most one, queued count at most one, per-user active count at most one, and 10 accepted jobs per user/day.

Run:

~~~bash
pnpm exec vitest run tests/release/privacy-sentinel.test.ts tests/release/load-smoke.test.ts
~~~

Expected: FAIL because the sentinel and load runner do not exist.

- [ ] **Step 2: Implement the privacy sentinel**

Create `scripts/release/privacy-sentinel.mjs`. It accepts an explicit list of roots and marker values via inherited file descriptors, not command-line arguments. It:

- verifies every root resolves beneath an allowlisted OpenTrad path;
- scans text and binary streams without printing matched content;
- reports only `artifact kind + sanitized path + marker ID`;
- checks SQLite via `PRAGMA integrity_check` and a controlled dump;
- asserts tmpfs job directories are empty;
- exits 1 on any match and exits 78 when an expected path cannot be inspected.

- [ ] **Step 3: Implement bounded load smoke**

Create `scripts/release/load-smoke.mjs`. Generate 12 small fixtures in tmpfs, ramp for 60 seconds, hold for 5 minutes, and drain for 60 seconds. Record:

- API 5xx below 1 percent;
- health/readiness success 100 percent;
- queue invariant one running plus one queued globally;
- worker memory below 2 GiB and zero OOM kills;
- existing-service restart counts unchanged;
- each existing service's p95 latency no more than 20 percent above its before baseline for five consecutive one-minute windows; and
- all jobs terminal/deleted within the 15-minute retention contract.

On threshold breach, stop submissions, preserve only numeric metrics/IDs, and invoke no rollback automatically; return a machine-readable failure for the operator's rollback decision.

- [ ] **Step 4: Test restart residue**

Add an integration test that creates running, queued, cancelled, failed, downloaded, and expired jobs; restarts only `opentrad-api` and `opentrad-worker`; waits 15 minutes; then asserts:

- no source/result bytes remain under job tmpfs;
- metadata terminal states are consistent;
- no job is resurrected;
- ClamAV receives no replay;
- no existing container's ID or restart count changed.

- [ ] **Step 5: Prove GREEN and commit**

Run:

~~~bash
pnpm exec vitest run tests/release/privacy-sentinel.test.ts tests/release/load-smoke.test.ts
node scripts/release/privacy-sentinel.mjs --fixture-mode
node scripts/release/load-smoke.mjs --fixture-mode
~~~

Expected GREEN: injected sentinel leaks are detected without content disclosure, the queue never exceeds limits, and threshold failures are deterministic.

~~~bash
git add scripts/release/privacy-sentinel.mjs scripts/release/load-smoke.mjs tests/release
git commit -m "test: enforce production privacy and load gates"
~~~

## Task 10: Document exact operations and repository protections

- [ ] **Step 1: Write failing runbook content checks**

Add a test to `tests/release/release-contract.test.ts` that requires:

- exact DNS and OAuth URLs;
- exact bootstrap, dry-run, deploy, rollback, restore, privacy, and baseline commands;
- explicit exit-78 pause behavior;
- host renewal date 2026-12-02;
- no global Docker change and no existing-service mutation statements;
- production environment approval and branch protection;
- operator decision points after failed canary/load/privacy checks.

Run the test and expect RED because the runbooks are absent.

- [ ] **Step 2: Write the production runbook**

Create `docs/operations/production-runbook.md` with this ordered command surface:

~~~bash
sudo install -o root -g root -m 0755 infra/deploy/*.sh /usr/local/libexec/opentrad/
sudo sh infra/deploy/bootstrap-host.sh
sudo sh infra/deploy/install-secrets.sh
sudo /usr/local/libexec/opentrad/check-external-gates.sh
sudo /usr/local/libexec/opentrad/capture-baseline.sh manual-preflight
docker compose --project-name opentrad -f infra/compose.prod.yml config --quiet
docker compose --project-name opentrad -f infra/compose.prod.yml --dry-run up -d
~~~

Document the one-time operator actions:

1. create the dynv6 A record `opentrad.dynv6.net` pointing to the currently observed production public IPv4 address;
2. create the GitHub OAuth App with the exact homepage and callback from Task 5;
3. install the three secret files through the no-echo script;
4. configure GitHub environment `production` with a required reviewer and self-review prevention;
5. install the dedicated SSH public key for `opentrad-deploy`;
6. confirm security-group inbound rules expose only required SSH administration plus HTTP/HTTPS;
7. renew the Alibaba Cloud server before 2026-12-02.

Each action is followed by a read-only verification command. If it fails, stop on the matching `PAUSE_*` code.

- [ ] **Step 3: Write rollback and privacy runbooks**

Create `docs/operations/rollback-runbook.md` with:

~~~bash
sudo /usr/local/libexec/opentrad/rollback-release.sh 0123456789abcdef0123456789abcdef01234567
~~~

The 40-character SHA is a documented syntactically valid example and the script still requires that exact release to exist and verify. Explain that SQLite restore is separately authorized because it discards newer account/job metadata; show backup integrity, live copy, stop-two-containers, restore, start-two-containers, and canary commands.

Create `docs/operations/privacy-runbook.md` with incident freeze, tmpfs inspection, sentinel invocation, log/backup scope, evidence sanitization, key rotation, and deletion-verification commands. It must forbid copying a user's file or document text into an incident ticket.

- [ ] **Step 4: Configure repository gates only after discovering check names**

Use GitHub CLI read-only queries first:

~~~bash
gh api repos/open-trad/opentrad-web/actions/runs --jq '.workflow_runs[0].head_sha'
gh api repos/open-trad/opentrad-web/commits/$(git rev-parse HEAD)/check-runs \
  --jq '.check_runs[].name'
~~~

Require successful `lint`, `typecheck`, `unit`, `build`, `e2e`, `infra-policy`, `license`, and `privacy` checks on the default branch, one approving review, dismissed stale reviews, linear history, and production environment approval. If any named check has not executed successfully, print `PAUSE_GITHUB:REQUIRED_CHECK_NOT_DISCOVERED` and do not mutate branch protection.

- [ ] **Step 5: Prove GREEN and commit**

Run:

~~~bash
pnpm exec vitest run tests/release/release-contract.test.ts
markdownlint docs/operations/*.md infra/deploy/README.md
~~~

Expected GREEN: every gate/action/command is discoverable and no runbook contains a secret value.

~~~bash
git add docs/operations infra/deploy/README.md tests/release/release-contract.test.ts
git commit -m "docs: add production and rollback runbooks"
~~~

## Task 11: Execute the formal release with two safe pause points

- [ ] **Step 1: Verify the release candidate locally**

Run from a clean default-branch checkout:

~~~bash
test -z "$(git status --porcelain)"
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm run test:e2e
node --test infra/tests/*.test.mjs
node scripts/release/check-licenses.mjs
node scripts/release/privacy-sentinel.mjs --fixture-mode
git diff --check
~~~

Expected GREEN: all commands exit zero and the checkout stays clean. Stop if any command changes a tracked file.

- [ ] **Step 2: Perform code and security review**

Use superpowers:requesting-code-review for correctness, then a separate security review focused on upload consent, auth origins/CSRF, idempotency, command allowlists, filesystem paths, Compose privileges, secret exposure, and rollback. Resolve every high/critical finding with a failing regression test and a separate commit.

- [ ] **Step 3: Merge and create immutable release evidence**

After required reviews/checks:

~~~bash
git fetch origin
git merge-base --is-ancestor origin/main HEAD
release_sha="$(git rev-parse HEAD)"
gh workflow run release-images.yml --ref main -f "release_sha=$release_sha"
~~~

Wait for completion, download the manifest/SBOM/scan artifacts, and run `scripts/release/verify-manifest.mjs` locally. Expected: signatures, attestations, source SHA, web hash, and image digests all verify.

- [ ] **Step 4: Safe pause gate A — external ownership**

Before host mutation, require:

~~~bash
ssh opentrad-production 'sudo /usr/local/libexec/opentrad/check-external-gates.sh'
~~~

Expected: `EXTERNAL_GATES_OK`. Any `PAUSE_DNS`, `PAUSE_OAUTH`, `PAUSE_SECRETS`, or `PAUSE_HOST` result ends the release. The user completes the corresponding console action; rerun the full gate afterward.

- [ ] **Step 5: Install bootstrap HTTP and obtain TLS**

Capture the before baseline, install only the new OpenTrad HTTP server file, and run:

~~~bash
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot \
  --webroot-path /var/www/letsencrypt \
  --domain opentrad.dynv6.net \
  --agree-tos --no-eff-email --email-file /opt/opentrad/secrets/acme_email \
  --dry-run
sudo certbot certonly --webroot \
  --webroot-path /var/www/letsencrypt \
  --domain opentrad.dynv6.net \
  --agree-tos --no-eff-email --email-file /opt/opentrad/secrets/acme_email
sudo install -o root -g root -m 0644 infra/nginx/opentrad.conf /etc/nginx/sites-available/opentrad.conf
sudo ln -s /etc/nginx/sites-available/opentrad.conf /etc/nginx/sites-enabled/opentrad.conf
sudo nginx -t
sudo systemctl reload nginx
~~~

If the installed Certbot does not support `--email-file`, read the email interactively without echo and invoke Certbot in the same root shell; never commit or log it.

- [ ] **Step 6: Deploy the exact SHA through the protected environment**

~~~bash
release_sha="$(git rev-parse HEAD)"
gh workflow run deploy-production.yml \
  -f "release_sha=$release_sha" \
  --ref main
~~~

Expected: required reviewer approves, manifest verifies remotely, all three containers become healthy, static symlink switches once, canary passes, and the existing-service comparison is empty.

- [ ] **Step 7: Safe pause gate B — accept or roll back**

Run:

~~~bash
curl --fail --silent --show-error https://opentrad.dynv6.net/api/health/ready
node scripts/release/load-smoke.mjs --target https://opentrad.dynv6.net
node scripts/release/privacy-sentinel.mjs --remote-profile production
ssh opentrad-production 'sudo /usr/local/libexec/opentrad/capture-baseline.sh acceptance'
~~~

Accept only if:

- anonymous home/templates/local tools work;
- username and GitHub sign-in work;
- consent is required before upload;
- the server canary generates/downloads/deletes a DOCX;
- PDF.js remains 6.2.108 with scripting/eval disabled;
- load/privacy/restart-residue gates pass;
- no existing container ID, port, network, restart count, health, or five-minute p95 threshold regresses; and
- DNS, certificate chain, HSTS/CSP, Pages preview, and source repository URL all match the release.

If a gate fails, stop traffic-changing work and run the exact prior-SHA rollback. Restore SQLite only with separate user authorization when the schema cannot run backward.

- [ ] **Step 8: Publish release evidence**

Create a GitHub Release for the verified tag containing the signed manifest, SPDX SBOM, sanitized Trivy report, test summary, acceptance report, baseline difference, rollback SHA, and AGPL source link. Exclude SSH/DNS/OAuth values, IP inventory, usernames, file names, document text, and job IDs.

- [ ] **Step 9: Final commit boundary**

No production-discovered source change is made directly on the host. If a change was necessary, return it to a branch with RED/GREEN tests, repeat Tasks 1–11 from a new SHA, and publish a new patch release.

## Final self-review

### Coverage findings

- [ ] Confirm the file map covers Dockerfiles, digest/checksum locks, Compose, Nginx/TLS, host bootstrap, secrets, external gates, baseline comparison, deploy, canary, rollback, cleanup, workflows, SBOM/license/scan, privacy, load, and all three runbooks.
- [ ] Confirm the plan preserves Compose project isolation, loopback-only port 13300, worker no-network/no-socket/read-only controls, tmpfs jobs, fixed resources, and unchanged existing projects/networks/global Docker.
- [ ] Confirm dynv6, GitHub OAuth, ACME email, production reviewer, deploy SSH key, and server renewal are explicit operator actions with deterministic read-only verification and exit-78 pause gates.
- [ ] Confirm release identity is one 40-character source SHA bound to hashed web output, digest-pinned images, SBOM, signatures, and attestations.
- [ ] Confirm rollback never deletes volumes, never invokes global prune, never changes existing services, and never restores SQLite implicitly.

### Placeholder and ambiguity findings

- [ ] Run:

~~~bash
for encoded in \
  VE9ETw== VEJE aW1wbGVtZW50IGxhdGVy ZmlsbCBpbiBkZXRhaWxz \
  U2ltaWxhciB0byBUYXNr QWRkIGFwcHJvcHJpYXRlIGVycm9yIGhhbmRsaW5n \
  V3JpdGUgdGVzdHMgZm9yIHRoZSBhYm92ZQ==; do
  marker="$(printf '%s' "$encoded" | base64 --decode)"
  rg -n -F "$marker" docs/superpowers/plans/2026-08-19-opentrad-production-release.md && exit 1
done
~~~

Expected: no output. Every runtime value is either derived from the signed manifest/current host, read from a root-owned secret file, or guarded by a named exit-78 pause.

### Type and command consistency findings

- [ ] Verify every referenced file appears in the file map and one task, every script name matches its invocation, and all image/environment keys match `infra/compose.prod.yml`.
- [ ] Verify the TypeScript manifest schema matches the JSON creator/verifier and GitHub workflow inputs.
- [ ] Verify all shell with dynamic input quotes paths/arguments, validates release SHA/path ancestry, and passes ShellCheck.
- [ ] Verify all YAML passes `docker compose config` and `actionlint`, all Markdown passes `markdownlint`, and `git diff --check` reports no whitespace errors.
- [ ] Verify version strings match the corrected upstream table and Plan 1: Node 24.19.0, LibreOffice 26.2.5, Pandoc 3.10.2, OCRmyPDF 17.10.0, Tesseract 5.5.3, qpdf 12.4.0, Poppler 26.08.0, libvips 8.18.5, ClamAV 1.5.4, PDF.js 6.2.108, and Better Auth 1.7.1.
