#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { inventoryDebianPackages } from "./inventory-debian-packages.mjs";

const lockPath = process.argv[2];
if (!lockPath) process.exit(64);
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
assert.equal(lock.schemaVersion, 1);
assert.equal(lock.architecture, "amd64");
assert.deepEqual(inventoryDebianPackages(), lock.packages);

for (const dependency of lock.packages) {
  const candidates = [
    `/var/lib/dpkg/info/${dependency.name}:${dependency.architecture}.md5sums`,
    `/var/lib/dpkg/info/${dependency.name}.md5sums`,
  ];
  const manifestPath = candidates.find((candidate) => existsSync(candidate));
  if (!manifestPath) continue;
  for (const line of readFileSync(manifestPath, "utf8").trim().split("\n").filter(Boolean)) {
    const [expected, relativePath] = line.split(/\s+/, 2);
    const absolutePath = `/${relativePath}`;
    if (!existsSync(absolutePath)) continue;
    const actual = createHash("md5").update(readFileSync(absolutePath)).digest("hex");
    assert.equal(actual, expected, absolutePath);
  }
}
