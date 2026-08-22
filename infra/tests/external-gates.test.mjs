import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(new URL("../..", import.meta.url).pathname);
const gateScript = join(repositoryRoot, "infra/deploy/check-external-gates.sh");

function executable(path, body) {
  writeFileSync(path, `#!/bin/sh\nset -eu\n${body}\n`, { mode: 0o755 });
}

function fixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "opentrad-external-gates-"));
  const binaryRoot = join(root, "bin");
  const runtimeRoot = join(root, "opentrad");
  const secrets = join(runtimeRoot, "secrets");
  mkdirSync(binaryRoot, { recursive: true });
  mkdirSync(secrets, { recursive: true });
  writeFileSync(
    join(runtimeRoot, "meminfo"),
    `MemAvailable: ${overrides.FAKE_AVAILABLE_MEMORY_KIB ?? "12000000"} kB\n`,
  );
  for (const name of [
    "better_auth_secret",
    "github_client_id",
    "github_client_secret",
    "acme_email",
  ]) {
    writeFileSync(join(secrets, name), `DO_NOT_PRINT_${name}\n`, { mode: 0o400 });
  }
  executable(
    join(binaryRoot, "curl"),
    `case "$*" in
  *api.ipify.org*) printf '%s' "\${FAKE_PUBLIC_IP:-203.0.113.10}" ;;
  *cloudflare-dns.com*) printf '{"Answer":[{"type":1,"data":"%s"}]}' "\${FAKE_DNS_IP:-203.0.113.10}" ;;
  *) exit 1 ;;
esac`,
  );
  executable(
    join(binaryRoot, "stat"),
    `test "$1" = "-c"
case "$2" in
  %a)
    case "$3" in
      */acme_email) printf '%s\n' "\${FAKE_SECRET_MODE:-400}" ;;
      *) printf '%s\n' "\${FAKE_SECRET_MODE:-440}" ;;
    esac ;;
  %g) printf '%s\n' "\${FAKE_SECRET_GID:-10100}" ;;
  *) exit 1 ;;
esac`,
  );
  executable(
    join(binaryRoot, "df"),
    `printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf 'fixture 20000000 1 %s 1%% /fixture\n' "\${FAKE_AVAILABLE_KIB:-13000000}"`,
  );
  executable(
    join(binaryRoot, "docker"),
    `if test "\${1:-}" = version; then
  printf '%s\n' "\${FAKE_DOCKER_VERSION:-29.7.1}"
elif test "\${1:-}" = compose && test "\${2:-}" = version; then
  printf '%s\n' "\${FAKE_COMPOSE_VERSION:-5.3.1}"
else
  exit 1
fi`,
  );
  executable(
    join(binaryRoot, "node"),
    `if test "\${1:-}" = --version; then
  printf '%s\n' "\${FAKE_NODE_VERSION:-v24.19.0}"
else
  exec "${process.execPath}" "$@"
fi`,
  );
  executable(
    join(binaryRoot, "cosign"),
    `printf 'GitVersion:    %s\n' "\${FAKE_COSIGN_VERSION:-v3.1.3}"`,
  );
  executable(
    join(binaryRoot, "sqlite3"),
    `printf '%s 2026-01-01 00:00:00 fixture\n' "\${FAKE_SQLITE_VERSION:-3.40.1}"`,
  );
  return { binaryRoot, root, runtimeRoot };
}

function run(overrides = {}, removeSecret) {
  const current = fixture(overrides);
  if (removeSecret) rmSync(join(current.runtimeRoot, "secrets", removeSecret));
  const result = spawnSync("/bin/sh", [gateScript], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...overrides,
      OPENTRAD_TEST_MODE: "1",
      OPENTRAD_TEST_ROOT: current.runtimeRoot,
      PATH: `${current.binaryRoot}:${process.env.PATH}`,
    },
  });
  rmSync(current.root, { force: true, recursive: true });
  return result;
}

test("external gates fail closed with stable codes and no secret output", () => {
  const scenarios = [
    [{ FAKE_DNS_IP: "203.0.113.11" }, undefined, "PAUSE_DNS:OPENTRAD_RECORD_NOT_READY"],
    [{}, "github_client_id", "PAUSE_OAUTH:GITHUB_APP_NOT_CONFIGURED"],
    [{ FAKE_SECRET_MODE: "644" }, undefined, "PAUSE_SECRETS:UNSAFE_MODE"],
    [{ FAKE_SECRET_GID: "100" }, undefined, "PAUSE_SECRETS:UNSAFE_GROUP"],
    [{ FAKE_AVAILABLE_KIB: "100" }, undefined, "PAUSE_HOST:INSUFFICIENT_DISK"],
    [{ FAKE_AVAILABLE_MEMORY_KIB: "100" }, undefined, "PAUSE_HOST:INSUFFICIENT_MEMORY"],
    [{ FAKE_DOCKER_VERSION: "28.9.0" }, undefined, "PAUSE_HOST:RUNTIME_VERSION"],
    [{ FAKE_COMPOSE_VERSION: "5.2.9" }, undefined, "PAUSE_HOST:RUNTIME_VERSION"],
    [{ FAKE_NODE_VERSION: "v22.0.0" }, undefined, "PAUSE_HOST:TOOL_VERSION"],
    [{ FAKE_COSIGN_VERSION: "v3.0.0" }, undefined, "PAUSE_HOST:TOOL_VERSION"],
    [{ FAKE_SQLITE_VERSION: "3.39.4" }, undefined, "PAUSE_HOST:TOOL_VERSION"],
  ];
  for (const [environment, missing, code] of scenarios) {
    const result = run(environment, missing);
    assert.equal(result.status, 78);
    assert.equal(result.stderr.trim(), code);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /DO_NOT_PRINT/u);
  }
});

test("external gates accept only the complete reviewed fixture", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "EXTERNAL_GATES_OK");
  assert.equal(result.stderr, "");
});
