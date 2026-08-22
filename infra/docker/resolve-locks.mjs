#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dockerDirectory = dirname(fileURLToPath(import.meta.url));

const images = [
  ["NODE_IMAGE", "node:24.19.0-bookworm-slim"],
  ["DEBIAN_IMAGE", "debian:12.15-slim"],
  ["CLAMAV_IMAGE", "clamav/clamav:1.5.4"],
  ["NGINX_IMAGE", "nginx:1.22.1"],
];

const tools = [
  {
    id: "libreoffice",
    version: "26.2.5",
    source:
      "https://download.documentfoundation.org/libreoffice/stable/26.2.5/deb/x86_64/LibreOffice_26.2.5_Linux_x86-64_deb.tar.gz",
    license: "MPL-2.0",
  },
  {
    id: "pandoc",
    version: "3.10.2",
    source:
      "https://github.com/jgm/pandoc/releases/download/3.10.2/pandoc-3.10.2-linux-amd64.tar.gz",
    license: "GPL-2.0-or-later",
  },
  {
    id: "ocrmypdf",
    version: "17.10.0",
    source: "https://files.pythonhosted.org/packages/source/o/ocrmypdf/ocrmypdf-17.10.0.tar.gz",
    license: "MPL-2.0",
  },
  {
    id: "tesseract",
    version: "5.5.3",
    source: "https://github.com/tesseract-ocr/tesseract/archive/refs/tags/5.5.3.tar.gz",
    license: "Apache-2.0",
  },
  {
    id: "qpdf",
    version: "12.4.0",
    source: "https://github.com/qpdf/qpdf/releases/download/v12.4.0/qpdf-12.4.0.tar.gz",
    license: "Apache-2.0",
  },
  {
    id: "poppler",
    version: "26.08.0",
    source: "https://poppler.freedesktop.org/poppler-26.08.0.tar.xz",
    license: "GPL-2.0-or-later",
  },
  {
    id: "libvips",
    version: "8.18.5",
    source: "https://github.com/libvips/libvips/releases/download/v8.18.5/vips-8.18.5.tar.xz",
    license: "LGPL-2.1-or-later",
  },
  {
    id: "clamav",
    version: "1.5.4",
    source:
      "https://github.com/Cisco-Talos/clamav/releases/download/clamav-1.5.4/clamav-1.5.4.tar.gz",
    license: "GPL-2.0-only",
  },
];

const buildSupportTools = [
  {
    id: "cmake",
    version: "3.31.10",
    source:
      "https://github.com/Kitware/CMake/releases/download/v3.31.10/cmake-3.31.10-linux-x86_64.tar.gz",
    license: "BSD-3-Clause",
  },
  {
    id: "freetype",
    version: "2.13.3",
    source: "https://download-mirror.savannah.gnu.org/releases/freetype/freetype-2.13.3.tar.xz",
    license: "FTL OR GPL-2.0-only",
  },
  {
    id: "fontconfig",
    version: "2.15.0",
    source: "https://github.com/fontconfig/fontconfig/archive/refs/tags/2.15.0.tar.gz",
    license: "MIT",
  },
  {
    id: "expat",
    version: "2.7.1",
    source: "https://github.com/libexpat/libexpat/releases/download/R_2_7_1/expat-2.7.1.tar.xz",
    license: "MIT",
  },
  {
    id: "gperf",
    version: "3.1",
    source: "https://ftp.gnu.org/gnu/gperf/gperf-3.1.tar.gz",
    license: "GPL-3.0-or-later",
  },
];

const allowedHosts = new Set([
  "download.documentfoundation.org",
  "github.com",
  "files.pythonhosted.org",
  "poppler.freedesktop.org",
  "download-mirror.savannah.gnu.org",
  "www.freedesktop.org",
  "ftp.gnu.org",
]);

function pause(code) {
  process.stderr.write(`${code}\n`);
  process.exitCode = 78;
}

function resolveImageDigest(reference) {
  try {
    // This validates that the registry returned a parseable manifest rather than
    // accepting a digest copied from an untrusted text source.
    JSON.parse(
      execFileSync(
        "docker",
        ["buildx", "imagetools", "inspect", "--format", "{{json .Manifest}}", reference],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 },
      ),
    );
    const inspection = execFileSync("docker", ["buildx", "imagetools", "inspect", reference], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
    const digest = inspection.match(/^Digest:\s+(sha256:[a-f0-9]{64})$/m)?.[1];
    if (!digest) throw new Error("manifest digest missing");
    return `${reference}@${digest}`;
  } catch {
    return undefined;
  }
}

async function sha256OfficialArtifact(tool) {
  const url = new URL(tool.source);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) return undefined;

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15 * 60_000),
      headers: { "user-agent": "OpenTrad-lock-resolver/1" },
    });
    if (!response.ok || !response.body) return undefined;
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > 512 * 1024 * 1024) return undefined;

    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 512 * 1024 * 1024) return undefined;
      hash.update(chunk);
    }
    if (
      bytes === 0 ||
      (Number.isFinite(declaredLength) && declaredLength > 0 && bytes !== declaredLength)
    ) {
      return undefined;
    }
    return hash.digest("hex");
  } catch {
    return undefined;
  }
}

function validateTool(tool) {
  const allowedIds = [...tools.map(({ id }) => id), ...buildSupportTools.map(({ id }) => id)];
  if (
    !allowedIds.includes(tool.id) ||
    typeof tool.version !== "string" ||
    tool.version.length === 0 ||
    typeof tool.source !== "string" ||
    !tool.source.startsWith("https://") ||
    !/^[a-f0-9]{64}$/.test(tool.sha256) ||
    typeof tool.license !== "string" ||
    tool.license.length < 3 ||
    Object.keys(tool).sort().join(",") !== "id,license,sha256,source,version"
  ) {
    throw new Error(`invalid lock entry: ${tool.id}`);
  }
}

async function main() {
  const resolvedImages = [];
  for (const [name, reference] of images) {
    const resolved = resolveImageDigest(reference);
    if (!resolved) {
      pause(`PAUSE_SUPPLY_CHAIN:DIGEST_UNAVAILABLE:${name}`);
      return;
    }
    resolvedImages.push(`${name}=${resolved}`);
  }

  const resolvedTools = [];
  for (const tool of tools) {
    const sha256 = await sha256OfficialArtifact(tool);
    if (!sha256) {
      pause(`PAUSE_SUPPLY_CHAIN:CHECKSUM_UNAVAILABLE:${tool.id}`);
      return;
    }
    const resolvedTool = { ...tool, sha256 };
    validateTool(resolvedTool);
    resolvedTools.push(resolvedTool);
  }
  const resolvedBuildSupportTools = [];
  for (const tool of buildSupportTools) {
    const sha256 = await sha256OfficialArtifact(tool);
    if (!sha256) {
      pause(`PAUSE_SUPPLY_CHAIN:CHECKSUM_UNAVAILABLE:${tool.id}`);
      return;
    }
    validateTool({ ...tool, sha256 });
    resolvedBuildSupportTools.push({ schemaVersion: 1, ...tool, sha256 });
  }

  mkdirSync(dockerDirectory, { recursive: true });
  const nonce = `${process.pid}`;
  const imageTemporary = resolve(dockerDirectory, `.base-images.lock.${nonce}`);
  const toolTemporary = resolve(dockerDirectory, `.toolchain.lock.json.${nonce}`);
  const buildSupportTemporaries = buildSupportTools.map(({ id }) =>
    resolve(dockerDirectory, `.${id}.lock.json.${nonce}`),
  );
  try {
    writeFileSync(imageTemporary, `${resolvedImages.join("\n")}\n`, { mode: 0o644, flag: "wx" });
    writeFileSync(
      toolTemporary,
      `${JSON.stringify({ schemaVersion: 1, tools: resolvedTools }, null, 2)}\n`,
      { mode: 0o644, flag: "wx" },
    );
    for (const [index, lock] of resolvedBuildSupportTools.entries()) {
      writeFileSync(buildSupportTemporaries[index], `${JSON.stringify(lock, null, 2)}\n`, {
        mode: 0o644,
        flag: "wx",
      });
    }
    renameSync(imageTemporary, resolve(dockerDirectory, "base-images.lock"));
    renameSync(toolTemporary, resolve(dockerDirectory, "toolchain.lock.json"));
    for (const [index, { id }] of buildSupportTools.entries()) {
      renameSync(buildSupportTemporaries[index], resolve(dockerDirectory, `${id}.lock.json`));
    }
  } finally {
    rmSync(imageTemporary, { force: true });
    rmSync(toolTemporary, { force: true });
    for (const path of buildSupportTemporaries) rmSync(path, { force: true });
  }
}

await main();
