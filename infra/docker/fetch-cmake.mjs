#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, renameSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";

const [lockPath, targetPath] = process.argv.slice(2);
if (!lockPath || !targetPath) {
  process.stderr.write("usage: fetch-cmake.mjs LOCK TARGET\n");
  process.exit(64);
}

const lock = JSON.parse(await readFile(resolve(lockPath), "utf8"));
const expectedSource =
  "https://github.com/Kitware/CMake/releases/download/v3.31.10/cmake-3.31.10-linux-x86_64.tar.gz";
if (
  lock.schemaVersion !== 1 ||
  lock.id !== "cmake" ||
  lock.version !== "3.31.10" ||
  lock.source !== expectedSource ||
  lock.license !== "BSD-3-Clause" ||
  !/^[a-f0-9]{64}$/.test(lock.sha256) ||
  Object.keys(lock).sort().join(",") !== "id,license,schemaVersion,sha256,source,version"
) {
  throw new Error("invalid CMake lock");
}

const archive = resolve(targetPath, `cmake-${process.pid}.tar.gz`);
const temporary = `${archive}.partial`;
mkdirSync(targetPath, { recursive: true });
try {
  const response = await fetch(lock.source, {
    redirect: "follow",
    signal: AbortSignal.timeout(15 * 60_000),
    headers: { "user-agent": "OpenTrad-image-builder/1" },
  });
  if (!response.ok || !response.body) throw new Error("CMake download failed");
  const hash = createHash("sha256");
  const hashingStream = new TransformStream({
    transform(chunk, controller) {
      hash.update(chunk);
      controller.enqueue(chunk);
    },
  });
  await pipeline(
    response.body.pipeThrough(hashingStream),
    createWriteStream(temporary, { flags: "wx" }),
  );
  if (hash.digest("hex") !== lock.sha256) throw new Error("CMake checksum mismatch");
  renameSync(temporary, archive);
  const extraction = spawnSync("tar", ["-xzf", archive, "-C", targetPath, "--strip-components=1"], {
    stdio: "inherit",
  });
  if (extraction.status !== 0) throw new Error("CMake extraction failed");
} finally {
  rmSync(temporary, { force: true });
  rmSync(archive, { force: true });
}
