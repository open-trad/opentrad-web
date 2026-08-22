#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const lockPath = process.argv[2];
if (!lockPath) {
  process.stderr.write("usage: verify-poppler-build-packages.mjs LOCK\n");
  process.exit(64);
}

function pause(reason) {
  process.stderr.write(`PAUSE_SUPPLY_CHAIN:POPPLER_BUILD_PACKAGES_${reason}\n`);
  process.exit(78);
}

let lock;
try {
  lock = JSON.parse(readFileSync(lockPath, "utf8"));
} catch {
  pause("LOCK_INVALID");
}

if (
  lock.schemaVersion !== 1 ||
  lock.architecture !== "amd64" ||
  !Array.isArray(lock.packages) ||
  lock.packages.length !== 2
) {
  pause("LOCK_INVALID");
}

const expectedPackages = new Map([
  [
    "liblcms2-dev",
    {
      version: "2.14-2+deb12u1",
      md5ManifestSha256: "41c748511463b4139952484001e2dc2257149741a3cecafc83e90c22ef7fd53f",
    },
  ],
  [
    "libopenjp2-7-dev",
    {
      version: "2.5.0-2+deb12u3",
      md5ManifestSha256: "ba67062afca20cf6965fc41090417dea794923a9d32997538a47ac5edb4ea22f",
    },
  ],
]);
const seenPackages = new Set();

for (const dependency of lock.packages) {
  const expected = expectedPackages.get(dependency.name);
  if (
    !expected ||
    seenPackages.has(dependency.name) ||
    dependency.version !== expected.version ||
    dependency.architecture !== "amd64" ||
    dependency.md5ManifestSha256 !== expected.md5ManifestSha256
  ) {
    pause("LOCK_INVALID");
  }
  seenPackages.add(dependency.name);

  let installed;
  try {
    const fieldPrefix = "$";
    installed = execFileSync(
      "dpkg-query",
      [
        "-W",
        `-f=${fieldPrefix}{binary:Package}\\t${fieldPrefix}{Version}\\t${fieldPrefix}{Architecture}\\n`,
        dependency.name,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    pause(`MISSING:${dependency.name}`);
  }
  const [binaryName, version, architecture] = installed.split("\t");
  if (
    binaryName.replace(/:[a-z0-9]+$/, "") !== dependency.name ||
    version !== dependency.version ||
    architecture !== dependency.architecture
  ) {
    pause(`MISMATCH:${dependency.name}`);
  }

  const manifestPath = [
    `/var/lib/dpkg/info/${binaryName}.md5sums`,
    `/var/lib/dpkg/info/${dependency.name}.md5sums`,
  ].find((candidate) => existsSync(candidate));
  if (!manifestPath) pause(`MANIFEST_MISSING:${dependency.name}`);
  const digest = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
  if (digest !== dependency.md5ManifestSha256) {
    pause(`MANIFEST_MISMATCH:${dependency.name}`);
  }
}
