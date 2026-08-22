#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function inventoryDebianPackages() {
  const fieldPrefix = "$";
  const rows = execFileSync(
    "dpkg-query",
    [
      "-W",
      `-f=${fieldPrefix}{binary:Package}\\t${fieldPrefix}{Version}\\t${fieldPrefix}{Architecture}\\n`,
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);

  return rows
    .map((row) => {
      const [binaryName, version, architecture] = row.split("\t");
      const name = binaryName.replace(/:[a-z0-9]+$/, "");
      const candidates = [
        `/var/lib/dpkg/info/${binaryName}.md5sums`,
        `/var/lib/dpkg/info/${name}.md5sums`,
      ];
      const manifestPath = candidates.find((candidate) => existsSync(candidate));
      const manifest = manifestPath ? readFileSync(manifestPath) : Buffer.alloc(0);
      return {
        name,
        version,
        architecture,
        md5ManifestSha256: createHash("sha256").update(manifest).digest("hex"),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(
    `${JSON.stringify({ schemaVersion: 1, architecture: "amd64", packages: inventoryDebianPackages() })}\n`,
  );
}
