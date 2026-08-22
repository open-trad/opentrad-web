#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, renameSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";

const [lockPath, targetPath] = process.argv.slice(2);
if (!lockPath || !targetPath) {
  process.stderr.write("usage: fetch-gperf.mjs LOCK TARGET\n");
  process.exit(64);
}

const lock = JSON.parse(await readFile(resolve(lockPath), "utf8"));
const expectedSource = "https://ftp.gnu.org/gnu/gperf/gperf-3.1.tar.gz";
if (
  lock.schemaVersion !== 1 ||
  lock.id !== "gperf" ||
  lock.version !== "3.1" ||
  lock.source !== expectedSource ||
  lock.license !== "GPL-3.0-or-later" ||
  !/^[a-f0-9]{64}$/.test(lock.sha256) ||
  Object.keys(lock).sort().join(",") !== "id,license,schemaVersion,sha256,source,version"
) {
  throw new Error("invalid gperf lock");
}

const archive = resolve(targetPath, `gperf-${process.pid}.tar.gz`);
const temporary = `${archive}.partial`;
mkdirSync(targetPath, { recursive: true });
try {
  const response = await fetch(lock.source, {
    redirect: "follow",
    signal: AbortSignal.timeout(15 * 60_000),
    headers: { "user-agent": "OpenTrad-image-builder/1" },
  });
  if (!response.ok || !response.body) throw new Error("gperf download failed");
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
  if (hash.digest("hex") !== lock.sha256) throw new Error("gperf checksum mismatch");
  renameSync(temporary, archive);
  const extraction = spawnSync("tar", ["-xzf", archive, "-C", targetPath, "--strip-components=1"], {
    stdio: "inherit",
  });
  if (extraction.status !== 0) throw new Error("gperf extraction failed");
} finally {
  rmSync(temporary, { force: true });
  rmSync(archive, { force: true });
}
