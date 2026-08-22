#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const lockPath = process.argv[2];
if (!lockPath) process.exit(64);
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
assert.equal(lock.schemaVersion, 1);
assert.equal(lock.architecture, "amd64");

for (const dependency of lock.packages) {
  const fieldPrefix = "$";
  const row = execFileSync(
    "dpkg-query",
    ["-W", `-f=${fieldPrefix}{Version}\t${fieldPrefix}{Architecture}`, dependency.name],
    { encoding: "utf8" },
  );
  assert.equal(row, `${dependency.version}\t${dependency.architecture}`, dependency.name);
  const candidates = [
    `/var/lib/dpkg/info/${dependency.name}:${dependency.architecture}.md5sums`,
    `/var/lib/dpkg/info/${dependency.name}.md5sums`,
  ];
  const manifestPath = candidates.find((candidate) => existsSync(candidate));
  const manifest = manifestPath ? readFileSync(manifestPath) : Buffer.alloc(0);
  assert.equal(
    createHash("sha256").update(manifest).digest("hex"),
    dependency.md5ManifestSha256,
    dependency.name,
  );
  for (const line of manifest.toString("utf8").trim().split("\n").filter(Boolean)) {
    const [expected, relativePath] = line.split(/\s+/, 2);
    const absolutePath = `/${relativePath}`;
    if (!existsSync(absolutePath)) continue;
    assert.equal(
      createHash("md5").update(readFileSync(absolutePath)).digest("hex"),
      expected,
      absolutePath,
    );
  }
}
