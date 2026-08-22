#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const image = process.argv[2];
if (!image || !/^[a-z0-9./:_-]+$/i.test(image)) {
  process.stderr.write("usage: resolve-debian-lock.mjs IMAGE\n");
  process.exit(64);
}

const directory = dirname(fileURLToPath(import.meta.url));
const inventoryScript = resolve(directory, "inventory-debian-packages.mjs");
const output = execFileSync(
  "docker",
  [
    "run",
    "--rm",
    "--platform",
    "linux/amd64",
    "--network",
    "none",
    "--read-only",
    "-v",
    `${inventoryScript}:/tmp/inventory-debian-packages.mjs:ro`,
    image,
    "node",
    "/tmp/inventory-debian-packages.mjs",
  ],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const lock = JSON.parse(output);
if (
  lock.schemaVersion !== 1 ||
  lock.architecture !== "amd64" ||
  !Array.isArray(lock.packages) ||
  lock.packages.length < 100
) {
  process.stderr.write("PAUSE_SUPPLY_CHAIN:DEBIAN_INVENTORY_INVALID\n");
  process.exit(78);
}

const temporary = resolve(directory, `.debian-packages.lock.json.${process.pid}`);
try {
  writeFileSync(temporary, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o644, flag: "wx" });
  renameSync(temporary, resolve(directory, "debian-packages.lock.json"));
} finally {
  rmSync(temporary, { force: true });
}
