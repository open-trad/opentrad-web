import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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
