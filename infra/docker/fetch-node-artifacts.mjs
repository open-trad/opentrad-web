#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmodSync, createWriteStream, mkdirSync, renameSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";

const [lockPath, targetDirectory] = process.argv.slice(2);
if (!lockPath || !targetDirectory) {
  process.stderr.write("usage: fetch-node-artifacts.mjs LOCK TARGET_DIRECTORY\n");
  process.exit(64);
}

function pause(reason) {
  process.stderr.write(`PAUSE_SUPPLY_CHAIN:NODE_ARTIFACT_${reason}\n`);
  process.exitCode = 78;
}

const expected = {
  id: "xlsx",
  version: "0.20.3",
  source: "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
  sha256: "8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8",
  pnpmIntegrity:
    "sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==",
};

let lock;
try {
  lock = JSON.parse(await readFile(resolve(lockPath), "utf8"));
} catch {
  pause("LOCK_INVALID");
}

if (
  process.exitCode !== 78 &&
  (lock.schemaVersion !== 1 ||
    !Array.isArray(lock.artifacts) ||
    lock.artifacts.length !== 1 ||
    JSON.stringify(lock.artifacts[0]) !== JSON.stringify(expected))
) {
  pause("LOCK_INVALID");
}

if (process.exitCode !== 78) {
  const target = resolve(targetDirectory, "xlsx.tgz");
  const temporary = `${target}.${process.pid}.partial`;
  mkdirSync(targetDirectory, { recursive: true });
  try {
    const response = await fetch(expected.source, {
      redirect: "error",
      signal: AbortSignal.timeout(5 * 60_000),
      headers: { "user-agent": "OpenTrad-image-builder/1" },
    });
    if (!response.ok || !response.body || response.url !== expected.source) {
      throw new Error("download failed");
    }
    const sha256 = createHash("sha256");
    const sha512 = createHash("sha512");
    const hashingStream = new TransformStream({
      transform(chunk, controller) {
        sha256.update(chunk);
        sha512.update(chunk);
        controller.enqueue(chunk);
      },
    });
    await pipeline(
      response.body.pipeThrough(hashingStream),
      createWriteStream(temporary, { flags: "wx" }),
    );
    const pnpmIntegrity = `sha512-${sha512.digest("base64")}`;
    if (sha256.digest("hex") !== expected.sha256 || pnpmIntegrity !== expected.pnpmIntegrity) {
      throw new Error("checksum mismatch");
    }
    renameSync(temporary, target);
    chmodSync(target, 0o444);
  } catch {
    rmSync(temporary, { force: true });
    rmSync(target, { force: true });
    pause("FETCH_OR_CHECKSUM_FAILED:xlsx");
  }
}
