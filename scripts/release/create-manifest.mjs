#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  atomicWrite,
  canonicalJson,
  execFileAsync,
  fail,
  sha256File,
  sha256Tree,
} from "./release-utils.mjs";
import { ReleaseManifestSchema } from "./verify-manifest.mjs";

function argumentsFrom(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (
      ![
        "--api-image",
        "--api-sbom",
        "--infra",
        "--output",
        "--release-scripts",
        "--trivy-api",
        "--trivy-worker",
        "--web",
        "--web-sbom",
        "--worker-image",
        "--worker-sbom",
      ].includes(token)
    ) {
      fail("PAUSE_RELEASE:ARGUMENT_INVALID", token, 78);
    }
    const value = argv[++index];
    if (!value) fail("PAUSE_RELEASE:ARGUMENT_INVALID", token, 78);
    options[token.slice(2).replace(/-([a-z])/g, (_, character) => character.toUpperCase())] = value;
  }
  for (const key of [
    "web",
    "infra",
    "releaseScripts",
    "webSbom",
    "apiSbom",
    "workerSbom",
    "trivyApi",
    "trivyWorker",
    "apiImage",
    "workerImage",
    "output",
  ]) {
    if (!options[key]) fail(`PAUSE_RELEASE:${key.toUpperCase()}_REQUIRED`, undefined, 78);
  }
  return options;
}

async function exactImage(reference, expectedRepository) {
  if (reference.startsWith(`${expectedRepository}@sha256:`)) return reference;
  if (!reference.startsWith(`${expectedRepository}:`)) {
    fail("PAUSE_RELEASE:IMAGE_REPOSITORY_INVALID", undefined, 78);
  }
  const { stdout } = await execFileAsync("docker", [
    "buildx",
    "imagetools",
    "inspect",
    reference,
    "--format",
    "{{json .Manifest}}",
  ]);
  const manifest = JSON.parse(stdout);
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.digest ?? "")) {
    fail("PAUSE_RELEASE:IMAGE_DIGEST_UNRESOLVED", undefined, 78);
  }
  return `${expectedRepository}@${manifest.digest}`;
}

async function clamavImage() {
  const lock = await readFile(resolve("infra/docker/base-images.lock"), "utf8");
  const matches = lock.match(/^CLAMAV_IMAGE=(.+)$/m);
  if (
    !matches ||
    !/^(?:docker\.io\/)?clamav\/clamav:1\.5\.4@sha256:[a-f0-9]{64}$/.test(matches[1])
  ) {
    fail("PAUSE_RELEASE:CLAMAV_LOCK_INVALID", undefined, 78);
  }
  return matches[1].replace("clamav/clamav:1.5.4@", "clamav/clamav@");
}

async function main() {
  try {
    const options = argumentsFrom(process.argv.slice(2));
    const sourceSha = process.env.GITHUB_SHA ?? "";
    if (!/^[a-f0-9]{40}$/.test(sourceSha)) fail("PAUSE_RELEASE:INVALID_SHA", undefined, 78);
    const [{ stdout: head }, { stdout: status }] = await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"]),
      execFileAsync("git", ["status", "--porcelain", "--untracked-files=no"]),
    ]);
    if (head.trim() !== sourceSha) fail("PAUSE_RELEASE:SOURCE_SHA_MISMATCH");
    if (status.trim() !== "") fail("PAUSE_RELEASE:DIRTY_CHECKOUT", undefined, 78);

    const manifest = ReleaseManifestSchema.parse({
      schemaVersion: 2,
      sourceSha,
      webSha256: (await stat(resolve(options.web))).isDirectory()
        ? await sha256Tree(resolve(options.web))
        : await sha256File(resolve(options.web)),
      infraSha256: await sha256Tree(resolve(options.infra)),
      releaseScriptsSha256: await sha256Tree(resolve(options.releaseScripts)),
      apiImage: await exactImage(options.apiImage, "ghcr.io/open-trad/opentrad-api"),
      workerImage: await exactImage(options.workerImage, "ghcr.io/open-trad/opentrad-worker"),
      clamavImage: await clamavImage(),
      evidenceSha256: {
        apiSbom: await sha256File(resolve(options.apiSbom)),
        trivyApi: await sha256File(resolve(options.trivyApi)),
        trivyWorker: await sha256File(resolve(options.trivyWorker)),
        webSbom: await sha256File(resolve(options.webSbom)),
        workerSbom: await sha256File(resolve(options.workerSbom)),
      },
      createdAt: new Date().toISOString(),
    });
    await atomicWrite(resolve(options.output), canonicalJson(manifest), 0o644);
    process.stdout.write(`MANIFEST_CREATED:${sourceSha}\n`);
  } catch (error) {
    const code = error?.code?.startsWith?.("PAUSE_") ? error.code : "PAUSE_RELEASE:CREATE_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
