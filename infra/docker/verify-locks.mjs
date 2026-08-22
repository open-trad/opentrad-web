#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const directory = new URL("./", import.meta.url);
const imageLines = readFileSync(new URL("base-images.lock", directory), "utf8").trim().split("\n");
const expectedImages = [
  ["NODE_IMAGE", "node:24.19.0-bookworm-slim"],
  ["DEBIAN_IMAGE", "debian:12.12-slim"],
  ["CLAMAV_IMAGE", "clamav/clamav:1.5.4"],
  ["NGINX_IMAGE", "nginx:1.22.1"],
];
assert.equal(imageLines.length, expectedImages.length);
for (const [index, [name, reference]] of expectedImages.entries()) {
  assert.match(
    imageLines[index],
    new RegExp(`^${name}=${reference.replaceAll(".", "\\.")}@sha256:[a-f0-9]{64}$`),
  );
}

const expectedTools = new Map([
  ["libreoffice", ["26.2.5", "MPL-2.0"]],
  ["pandoc", ["3.10.2", "GPL-2.0-or-later"]],
  ["ocrmypdf", ["17.10.0", "MPL-2.0"]],
  ["tesseract", ["5.5.3", "Apache-2.0"]],
  ["qpdf", ["12.4.0", "Apache-2.0"]],
  ["poppler", ["26.08.0", "GPL-2.0-or-later"]],
  ["libvips", ["8.18.5", "LGPL-2.1-or-later"]],
  ["clamav", ["1.5.4", "GPL-2.0-only"]],
]);
const lock = JSON.parse(readFileSync(new URL("toolchain.lock.json", directory), "utf8"));
assert.deepEqual(Object.keys(lock).sort(), ["schemaVersion", "tools"]);
assert.equal(lock.schemaVersion, 1);
assert.equal(lock.tools.length, expectedTools.size);
for (const [index, tool] of lock.tools.entries()) {
  const expected = expectedTools.get(tool.id);
  assert.ok(expected, `unexpected tool at index ${index}`);
  assert.deepEqual(Object.keys(tool).sort(), ["id", "license", "sha256", "source", "version"]);
  assert.equal(tool.version, expected[0]);
  assert.equal(tool.license, expected[1]);
  assert.match(tool.source, /^https:\/\/[a-z0-9./_~%-]+$/i);
  assert.match(tool.sha256, /^[a-f0-9]{64}$/);
}
assert.deepEqual(
  lock.tools.map(({ id }) => id),
  [...expectedTools.keys()],
);

const cmakeLock = JSON.parse(readFileSync(new URL("cmake.lock.json", directory), "utf8"));
assert.deepEqual(Object.keys(cmakeLock).sort(), [
  "id",
  "license",
  "schemaVersion",
  "sha256",
  "source",
  "version",
]);
assert.equal(cmakeLock.schemaVersion, 1);
assert.equal(cmakeLock.id, "cmake");
assert.equal(cmakeLock.version, "3.31.10");
assert.equal(cmakeLock.license, "BSD-3-Clause");
assert.equal(
  cmakeLock.source,
  "https://github.com/Kitware/CMake/releases/download/v3.31.10/cmake-3.31.10-linux-x86_64.tar.gz",
);
assert.match(cmakeLock.sha256, /^[a-f0-9]{64}$/);

const freetypeLock = JSON.parse(readFileSync(new URL("freetype.lock.json", directory), "utf8"));
assert.deepEqual(Object.keys(freetypeLock).sort(), [
  "id",
  "license",
  "schemaVersion",
  "sha256",
  "source",
  "version",
]);
assert.equal(freetypeLock.schemaVersion, 1);
assert.equal(freetypeLock.id, "freetype");
assert.equal(freetypeLock.version, "2.13.3");
assert.equal(freetypeLock.license, "FTL OR GPL-2.0-only");
assert.equal(
  freetypeLock.source,
  "https://download.savannah.gnu.org/releases/freetype/freetype-2.13.3.tar.xz",
);
assert.match(freetypeLock.sha256, /^[a-f0-9]{64}$/);

const fontconfigLock = JSON.parse(readFileSync(new URL("fontconfig.lock.json", directory), "utf8"));
assert.deepEqual(Object.keys(fontconfigLock).sort(), [
  "id",
  "license",
  "schemaVersion",
  "sha256",
  "source",
  "version",
]);
assert.equal(fontconfigLock.schemaVersion, 1);
assert.equal(fontconfigLock.id, "fontconfig");
assert.equal(fontconfigLock.version, "2.15.0");
assert.equal(fontconfigLock.license, "MIT");
assert.equal(
  fontconfigLock.source,
  "https://www.freedesktop.org/software/fontconfig/release/fontconfig-2.15.0.tar.xz",
);
assert.match(fontconfigLock.sha256, /^[a-f0-9]{64}$/);

const expatLock = JSON.parse(readFileSync(new URL("expat.lock.json", directory), "utf8"));
assert.deepEqual(Object.keys(expatLock).sort(), [
  "id",
  "license",
  "schemaVersion",
  "sha256",
  "source",
  "version",
]);
assert.equal(expatLock.schemaVersion, 1);
assert.equal(expatLock.id, "expat");
assert.equal(expatLock.version, "2.7.1");
assert.equal(expatLock.license, "MIT");
assert.equal(
  expatLock.source,
  "https://github.com/libexpat/libexpat/releases/download/R_2_7_1/expat-2.7.1.tar.xz",
);
assert.match(expatLock.sha256, /^[a-f0-9]{64}$/);

const gperfLock = JSON.parse(readFileSync(new URL("gperf.lock.json", directory), "utf8"));
assert.deepEqual(Object.keys(gperfLock).sort(), [
  "id",
  "license",
  "schemaVersion",
  "sha256",
  "source",
  "version",
]);
assert.equal(gperfLock.schemaVersion, 1);
assert.equal(gperfLock.id, "gperf");
assert.equal(gperfLock.version, "3.1");
assert.equal(gperfLock.license, "GPL-3.0-or-later");
assert.equal(gperfLock.source, "https://ftp.gnu.org/gnu/gperf/gperf-3.1.tar.gz");
assert.match(gperfLock.sha256, /^[a-f0-9]{64}$/);

const nodeArtifactsLock = JSON.parse(
  readFileSync(new URL("node-artifacts.lock.json", directory), "utf8"),
);
assert.deepEqual(nodeArtifactsLock, {
  schemaVersion: 1,
  artifacts: [
    {
      id: "xlsx",
      version: "0.20.3",
      source: "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
      sha256: "8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8",
      pnpmIntegrity:
        "sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==",
    },
  ],
});
