import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function renderCompose() {
  const temporary = mkdtempSync(join(tmpdir(), "opentrad-compose-policy-"));
  const environmentPath = join(temporary, "test.env");
  const clamavImage = readFileSync(join(root, "infra/docker/base-images.lock"), "utf8")
    .split("\n")
    .find((line) => line.startsWith("CLAMAV_IMAGE="))
    ?.slice("CLAMAV_IMAGE=".length);
  writeFileSync(
    environmentPath,
    [
      `OPENTRAD_API_IMAGE=example.invalid/opentrad-api@sha256:${"1".repeat(64)}`,
      `OPENTRAD_WORKER_IMAGE=example.invalid/opentrad-worker@sha256:${"2".repeat(64)}`,
      `OPENTRAD_CLAMAV_IMAGE=${clamavImage}`,
    ].join("\n"),
  );
  try {
    return JSON.parse(
      execFileSync(
        "docker",
        [
          "compose",
          "--project-name",
          "opentrad",
          "--env-file",
          environmentPath,
          "-f",
          "infra/compose.prod.yml",
          "config",
          "--format",
          "json",
        ],
        { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

test("production Compose has exactly three isolated services", () => {
  const rendered = renderCompose();
  assert.deepEqual(Object.keys(rendered.services).sort(), ["api", "clamav", "worker"]);
  assert.equal(rendered.name, "opentrad");
  assert.doesNotMatch(JSON.stringify(rendered), /openvac-production|paperbanana-hk|tensor-auto/);
  for (const network of Object.values(rendered.networks)) {
    assert.notEqual(network.external, true);
  }
});

test("only the API publishes the dedicated loopback port", () => {
  const { services } = renderCompose();
  assert.deepEqual(services.api.ports, [
    { mode: "ingress", target: 3000, published: "13300", protocol: "tcp", host_ip: "127.0.0.1" },
  ]);
  assert.equal(services.worker.ports, undefined);
  assert.equal(services.clamav.ports, undefined);
  assert.doesNotMatch(JSON.stringify(services), /3010|13005|13200|13201/);
});

test("API and worker use numeric identities and hard resource boundaries", () => {
  const { services } = renderCompose();
  for (const [name, user] of [
    ["api", "10001:10001"],
    ["worker", "10002:10002"],
  ]) {
    const service = services[name];
    assert.equal(service.user, user);
    assert.deepEqual(service.group_add, ["10100"]);
    assert.equal(service.read_only, true);
    assert.deepEqual(service.cap_drop, ["ALL"]);
    assert.deepEqual(service.security_opt, ["no-new-privileges:true"]);
    assert.ok(service.pids_limit > 0);
    assert.ok(service.cpus > 0);
    assert.ok(service.mem_limit > 0);
  }
  assert.equal(services.worker.network_mode, "none");
});

test("jobs are shared only through a bounded noexec tmpfs volume", () => {
  const rendered = renderCompose();
  const options = rendered.volumes.job_ram.driver_opts;
  assert.equal(options.type, "tmpfs");
  assert.equal(options.device, "tmpfs");
  for (const value of ["size=2g", "gid=10100", "nodev", "nosuid", "noexec"]) {
    assert.ok(options.o.split(",").includes(value), `missing tmpfs option: ${value}`);
  }

  for (const service of Object.values(rendered.services)) {
    for (const volume of service.volumes ?? []) {
      assert.notEqual(volume.source, "/var/run/docker.sock");
      assert.ok(volume.type !== "bind" || volume.target !== "/jobs");
    }
  }
  assert.deepEqual(
    rendered.services.api.volumes
      .filter(({ target }) => target === "/jobs")
      .map(({ source }) => source),
    ["job_ram"],
  );
  assert.deepEqual(
    rendered.services.worker.volumes
      .filter(({ target }) => target === "/jobs")
      .map(({ source }) => source),
    ["job_ram"],
  );
});

test("only API and ClamAV share the internal scan network", () => {
  const rendered = renderCompose();
  assert.equal(rendered.networks.scan.internal, true);
  assert.equal(rendered.networks.scan.name, "opentrad_scan");
  assert.deepEqual(Object.keys(rendered.services.api.networks).sort(), ["egress", "scan"]);
  assert.deepEqual(Object.keys(rendered.services.clamav.networks).sort(), ["egress", "scan"]);
  assert.equal(rendered.services.worker.networks, undefined);
});

test("active API environment never ships the trusted-proxy placeholder", () => {
  const rendered = renderCompose();
  assert.doesNotMatch(JSON.stringify(rendered.services.api.environment), /REPLACE_WITH_/);
  assert.equal(rendered.services.api.environment.OPENTRAD_TRUSTED_PROXY_CIDR, undefined);
});

test("release images and readiness use the verified production contracts", () => {
  const { services } = renderCompose();
  assert.match(services.clamav.image, /^clamav\/clamav:1\.5\.4@sha256:[a-f0-9]{64}$/);
  assert.match(JSON.stringify(services.api.healthcheck.test), /\/api\/health\/ready/);
  assert.match(JSON.stringify(services.api.healthcheck.test), /OPENTRAD_PUBLIC_ORIGIN/);
  assert.match(JSON.stringify(services.api.healthcheck.test), /node:http/);
  const workerHealth = JSON.stringify(services.worker.healthcheck.test);
  assert.match(workerHealth, /test -x \/jobs/);
  for (const directory of ["queued", "running", "outbox"]) {
    assert.match(workerHealth, new RegExp(`test -w /jobs/${directory}`));
  }
  assert.match(workerHealth, /test -r \/jobs\/control/);
  assert.doesNotMatch(workerHealth, /test -w \/jobs(?:\s|&)/);
});
