import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildLoadProfile } from "../deploy/build-load-profile.mjs";
import { captureLatency, summarizeLatency } from "../deploy/capture-latency.mjs";
import { compareExisting } from "../deploy/compare-baseline.mjs";

const immutable = {
  containerId: "sha256:existing-container",
  health: "healthy",
  imageDigest: "sha256:existing-image",
  networks: ["paperbanana_default:network-id"],
  publishedPorts: ["127.0.0.1:13005->3000/tcp"],
  restartCount: 0,
  state: "running",
};

function snapshot() {
  return {
    containers: { "paperbanana-api": { ...immutable, cpuPercent: 1, startedAt: "before" } },
    latencyP95: { "paperbanana-api": { baselineMs: 100, windowsMs: [100, 100, 100] } },
    listeners: ["127.0.0.1:13005"],
    networks: ["paperbanana_default"],
  };
}

test("comparison ignores transient samples and allows only scoped OpenTrad additions", () => {
  const before = snapshot();
  const after = snapshot();
  after.containers["paperbanana-api"].cpuPercent = 99;
  after.containers["paperbanana-api"].startedAt = "after";
  after.containers["opentrad-api"] = {
    ...immutable,
    containerId: "sha256:opentrad",
    networks: ["opentrad_egress:new-network"],
    publishedPorts: ["127.0.0.1:13300->3000/tcp"],
  };
  after.listeners.push("127.0.0.1:13300");
  after.networks.push("opentrad_egress");
  assert.deepEqual(compareExisting(before, after), []);
});

test("latency capture records five bounded windows and a deterministic p95 per existing service", async () => {
  let calls = 0;
  const result = await captureLatency({
    fetchImpl: async () => {
      calls += 1;
      return { status: 200 };
    },
    targets: [{ id: "fixture", url: "http://127.0.0.1:1/" }],
  });
  assert.equal(calls, 5);
  assert.equal(result.fixture.windowsMs.length, 5);
  assert.ok(result.fixture.baselineMs > 0);
  assert.deepEqual(summarizeLatency([5, 1, 4, 2, 3]), {
    baselineMs: 5,
    windowsMs: [5, 1, 4, 2, 3],
  });
});

test("load profile binds the four immutable existing containers to measured HTTPS baselines", () => {
  const latencyP95 = Object.fromEntries(
    ["openvac-web", "paperbanana-auth", "tensor-auto-web", "tensor-auto-api"].map((id) => [
      id,
      { baselineMs: 100, windowsMs: [100, 100, 100, 100, 100] },
    ]),
  );
  const profile = buildLoadProfile({ latencyP95 });
  assert.equal(profile.existingServices.length, 4);
  assert.ok(profile.existingServices.every((service) => service.url.startsWith("https://")));
  assert.ok(profile.existingServices.every((service) => service.baselineP95Ms === 100));
  assert.throws(() => buildLoadProfile({ latencyP95: {} }), /BASELINE_LATENCY_MISSING/u);
});

test("comparison rejects every immutable existing-service mutation", () => {
  for (const field of [
    "containerId",
    "imageDigest",
    "publishedPorts",
    "networks",
    "restartCount",
    "state",
    "health",
  ]) {
    const before = snapshot();
    const after = snapshot();
    after.containers["paperbanana-api"][field] = field === "restartCount" ? 1 : "changed";
    assert.deepEqual(
      compareExisting(before, after).map((difference) => difference.field),
      [field],
    );
  }
});

test("comparison rejects unscoped additions and five consecutive latency regressions", () => {
  const before = snapshot();
  const after = snapshot();
  after.containers.attacker = { ...immutable };
  after.listeners.push("0.0.0.0:13300");
  after.networks.push("shared-production");
  after.latencyP95["paperbanana-api"] = {
    baselineMs: 100,
    windowsMs: [121, 122, 123, 124, 125],
  };
  assert.deepEqual(
    compareExisting(before, after)
      .map((difference) => difference.field)
      .sort(),
    ["addition", "latencyP95", "listener", "network"],
  );
});

test("CLI emits a sanitized JSON difference without modifying external state", () => {
  const root = mkdtempSync(join(tmpdir(), "opentrad-baseline-"));
  const beforePath = join(root, "before.json");
  const afterPath = join(root, "after.json");
  const before = snapshot();
  const after = snapshot();
  after.containers["paperbanana-api"].health = "unhealthy";
  writeFileSync(beforePath, JSON.stringify(before));
  writeFileSync(afterPath, JSON.stringify(after));
  const differencePath = join(root, "diff-0123456789abcdef0123456789abcdef01234567.json");
  const result = spawnSync(
    process.execPath,
    [
      new URL("../deploy/compare-baseline.mjs", import.meta.url).pathname,
      beforePath,
      afterPath,
      differencePath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), [
    { actual: "unhealthy", expected: "healthy", field: "health", name: "paperbanana-api" },
  ]);
  assert.deepEqual(JSON.parse(readFileSync(differencePath, "utf8")), JSON.parse(result.stdout));
  assert.equal(statSync(differencePath).mode & 0o777, 0o600);
  assert.equal(result.stderr, "");
  rmSync(root, { force: true, recursive: true });
});

test("rollback difference evidence uses its own root-only path", () => {
  const root = mkdtempSync(join(tmpdir(), "opentrad-rollback-baseline-"));
  const beforePath = join(root, "before.json");
  const afterPath = join(root, "after.json");
  writeFileSync(beforePath, JSON.stringify(snapshot()));
  writeFileSync(afterPath, JSON.stringify(snapshot()));
  const differencePath = join(root, "rollback-diff-0123456789abcdef0123456789abcdef01234567.json");
  const result = spawnSync(
    process.execPath,
    [
      new URL("../deploy/compare-baseline.mjs", import.meta.url).pathname,
      beforePath,
      afterPath,
      differencePath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(differencePath, "utf8")), []);
  assert.equal(statSync(differencePath).mode & 0o777, 0o600);
  rmSync(root, { force: true, recursive: true });
});

test("production baseline evidence is generated inside a root-owned directory", () => {
  const bootstrap = readFileSync(new URL("../deploy/bootstrap-host.sh", import.meta.url), "utf8");
  const capture = readFileSync(new URL("../deploy/capture-baseline.sh", import.meta.url), "utf8");
  assert.match(
    bootstrap,
    /install -d -o root -g opentrad-deploy -m 0750 \/opt\/opentrad\/baselines/,
  );
  assert.match(capture, /install -d -o root -g opentrad-deploy -m 0750 "\$baseline_root"/);
  assert.match(capture, /chown root:opentrad-deploy "\$baseline_root\/\$baseline_name"/);
  assert.doesNotMatch(
    `${bootstrap}\n${capture}`,
    /install -d -o opentrad-deploy -g opentrad-deploy[^\n]*baselines/,
  );
});
