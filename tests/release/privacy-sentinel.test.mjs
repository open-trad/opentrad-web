import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("privacy sentinel detects text and binary leaks without disclosing marker values", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "opentrad-release-fixture-"));
  try {
    const logs = join(fixture, "logs");
    const tmpfs = join(fixture, "tmpfs");
    await mkdir(logs);
    await mkdir(tmpfs);
    const marker = "PRIVATE-BODY-6e426936";
    await writeFile(join(logs, "api.log"), `safe-prefix:${marker}:safe-suffix`);

    const { inspectPrivacy } = await import(
      new URL("../../scripts/release/privacy-sentinel.mjs", import.meta.url)
    );
    const result = await inspectPrivacy({
      roots: [
        { kind: "api-log", path: logs },
        { kind: "job-tmpfs", path: tmpfs, mustBeEmpty: true },
      ],
      markers: [{ id: "body", value: marker }],
      allowlistedRoots: [fixture],
    });

    assert.equal(result.ok, false);
    assert.deepEqual(
      result.findings.map((finding) => finding.markerId),
      ["body"],
    );
    assert.doesNotMatch(JSON.stringify(result), new RegExp(marker));
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("privacy sentinel passes clean fixture roots and rejects residue in tmpfs", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "opentrad-release-fixture-"));
  try {
    const tmpfs = join(fixture, "tmpfs");
    await mkdir(tmpfs);
    const { inspectPrivacy } = await import(
      new URL("../../scripts/release/privacy-sentinel.mjs", import.meta.url)
    );
    const clean = await inspectPrivacy({
      roots: [{ kind: "job-tmpfs", path: tmpfs, mustBeEmpty: true }],
      markers: [{ id: "filename", value: "private-name.docx" }],
      allowlistedRoots: [fixture],
    });
    assert.equal(clean.ok, true);

    await writeFile(join(tmpfs, "unexpected.bin"), "not a marker");
    const residue = await inspectPrivacy({
      roots: [{ kind: "job-tmpfs", path: tmpfs, mustBeEmpty: true }],
      markers: [{ id: "filename", value: "private-name.docx" }],
      allowlistedRoots: [fixture],
    });
    assert.equal(residue.ok, false);
    assert.equal(residue.findings[0].markerId, "RESIDUE");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("production remote profile covers logs, SQLite, evidence, backups, journal, and empty job tmpfs", async () => {
  const { productionRootDescriptors } = await import(
    new URL("../../scripts/release/privacy-sentinel.mjs", import.meta.url)
  );
  assert.deepEqual(
    productionRootDescriptors({
      authVolume: "/var/lib/docker/volumes/opentrad_auth_data/_data",
      captureRoot: "/run/opentrad/privacy-scan",
      jobVolume: "/var/lib/docker/volumes/opentrad_job_ram/_data",
    }),
    [
      { kind: "auth-database", path: "/var/lib/docker/volumes/opentrad_auth_data/_data" },
      {
        kind: "job-tmpfs",
        path: "/var/lib/docker/volumes/opentrad_job_ram/_data",
        mustBeEmpty: true,
      },
      { kind: "nginx-log", path: "/var/log/nginx" },
      { kind: "release", path: "/opt/opentrad/releases" },
      { kind: "baseline", path: "/opt/opentrad/baselines" },
      { kind: "backup", path: "/opt/opentrad/backups" },
      { kind: "acceptance", path: "/opt/opentrad/reports" },
      { kind: "container-journal", path: "/run/opentrad/privacy-scan" },
    ],
  );
});

test("streaming scan detects a marker split across bounded chunks", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "opentrad-stream-fixture-"));
  try {
    const path = join(fixture, "large.log");
    const marker = "PRIVATE-CROSS-CHUNK-9f176fa1";
    await writeFile(path, Buffer.concat([Buffer.alloc(65_530, 120), Buffer.from(marker)]));
    const { scanFile } = await import(
      new URL("../../scripts/release/privacy-sentinel.mjs", import.meta.url)
    );
    const findings = await scanFile(path, [{ id: "body", value: marker }], fixture, "large-log");
    assert.deepEqual(findings, [{ kind: "large-log", markerId: "body", path: "large.log" }]);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
