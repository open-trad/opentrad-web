#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { chmod, copyFile, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

const [mode, lockPath, targetPath] = process.argv.slice(2);
if (!["--download", "--download-data", "--install"].includes(mode) || !lockPath || !targetPath) {
  process.stderr.write(
    "usage: fetch-toolchain.mjs --download|--download-data|--install LOCK TARGET\n",
  );
  process.exit(64);
}

const lock = JSON.parse(await readFile(resolve(lockPath), "utf8"));
const expectedToolIds = [
  "libreoffice",
  "pandoc",
  "ocrmypdf",
  "tesseract",
  "qpdf",
  "poppler",
  "libvips",
  "clamav",
];

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} failed`);
}

if (mode === "--download" || mode === "--download-data") {
  const entries = mode === "--download" ? lock.tools : lock.files;
  const expectedIds = mode === "--download" ? expectedToolIds : ["chi_sim", "eng", "osd"];
  if (
    lock.schemaVersion !== 1 ||
    !Array.isArray(entries) ||
    entries.map(({ id }) => id).join(",") !== expectedIds.join(",")
  ) {
    throw new Error("artifact lock schema/order mismatch");
  }
  mkdirSync(targetPath, { recursive: true });
  const checksumLines = [];
  for (const tool of entries) {
    if (!/^https:\/\//.test(tool.source) || !/^[a-f0-9]{64}$/.test(tool.sha256)) {
      throw new Error(`invalid locked artifact: ${tool.id}`);
    }
    const destination = join(
      targetPath,
      mode === "--download" ? `${tool.id}.artifact` : `${tool.id}.traineddata`,
    );
    const temporary = `${destination}.${process.pid}`;
    const response = await fetch(tool.source, {
      redirect: "follow",
      signal: AbortSignal.timeout(15 * 60_000),
      headers: { "user-agent": "OpenTrad-image-builder/1" },
    });
    if (!response.ok || !response.body) throw new Error(`download failed: ${tool.id}`);
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
    if (hash.digest("hex") !== tool.sha256) {
      rmSync(temporary, { force: true });
      throw new Error(`checksum mismatch: ${tool.id}`);
    }
    renameSync(temporary, destination);
    checksumLines.push(`${tool.sha256}  ${basename(destination)}`);
  }
  await writeFile(join(targetPath, "SHA256SUMS"), `${checksumLines.join("\n")}\n`, { mode: 0o444 });
} else {
  if (
    lock.schemaVersion !== 1 ||
    lock.tools.map(({ id }) => id).join(",") !== expectedToolIds.join(",")
  ) {
    throw new Error("toolchain lock schema/order mismatch");
  }
  const sourceRoot = resolve(targetPath, "src");
  const installRoot = resolve(targetPath, "root");
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(installRoot, { recursive: true });
  for (const tool of lock.tools) {
    if (tool.id === "clamav") continue;
    const artifact = resolve(dirname(lockPath), "downloads", `${tool.id}.artifact`);
    const extraction = join(sourceRoot, tool.id);
    mkdirSync(extraction, { recursive: true });
    run("tar", ["-xf", artifact, "-C", extraction, "--strip-components=1"]);
  }

  const libreofficeDebs = readdirSync(join(sourceRoot, "libreoffice", "DEBS"))
    .filter((name) => name.endsWith(".deb"))
    .sort();
  for (const deb of libreofficeDebs) {
    run("dpkg-deb", ["-x", join(sourceRoot, "libreoffice", "DEBS", deb), installRoot]);
  }
  mkdirSync(join(installRoot, "opt", "opentrad-tools", "bin"), { recursive: true });
  await copyFile(
    join(sourceRoot, "pandoc", "bin", "pandoc"),
    join(installRoot, "opt", "opentrad-tools", "bin", "pandoc"),
  );
  await chmod(join(installRoot, "opt", "opentrad-tools", "bin", "pandoc"), 0o555);
}

function dirname(path) {
  return path.slice(0, Math.max(path.lastIndexOf("/"), 0)) || ".";
}
