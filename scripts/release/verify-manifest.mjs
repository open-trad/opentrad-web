#!/usr/bin/env node
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite, execFileAsync, fail, sha256File, sha256Tree } from "./release-utils.mjs";

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const API_IMAGE = /^ghcr\.io\/open-trad\/opentrad-api@sha256:[a-f0-9]{64}$/;
const WORKER_IMAGE = /^ghcr\.io\/open-trad\/opentrad-worker@sha256:[a-f0-9]{64}$/;
const CLAMAV_IMAGE = /^(?:docker\.io\/)?clamav\/clamav@sha256:[a-f0-9]{64}$/;
const KEYS = Object.freeze([
  "apiImage",
  "clamavImage",
  "createdAt",
  "evidenceSha256",
  "schemaVersion",
  "sourceSha",
  "webSha256",
  "workerImage",
]);

function manifestError(field) {
  const error = new TypeError(`Invalid release manifest field: ${field}`);
  error.code = "PAUSE_RELEASE:MANIFEST_INVALID";
  return error;
}

export const ReleaseManifestSchema = Object.freeze({
  parse(input) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw manifestError("root");
    }
    const keys = Object.keys(input).sort();
    if (keys.length !== KEYS.length || keys.some((key, index) => key !== KEYS[index])) {
      throw manifestError("keys");
    }
    if (input.schemaVersion !== 1) throw manifestError("schemaVersion");
    if (typeof input.sourceSha !== "string" || !SHA.test(input.sourceSha)) {
      throw manifestError("sourceSha");
    }
    if (
      input.evidenceSha256 === null ||
      typeof input.evidenceSha256 !== "object" ||
      Array.isArray(input.evidenceSha256)
    ) {
      throw manifestError("evidenceSha256");
    }
    const evidenceKeys = Object.keys(input.evidenceSha256).sort();
    const expectedEvidenceKeys = ["apiSbom", "trivyApi", "trivyWorker", "webSbom", "workerSbom"];
    if (
      evidenceKeys.length !== expectedEvidenceKeys.length ||
      evidenceKeys.some((key, index) => key !== expectedEvidenceKeys[index])
    ) {
      throw manifestError("evidenceSha256.keys");
    }
    for (const field of [
      "webSha256",
      ...expectedEvidenceKeys.map((key) => `evidenceSha256.${key}`),
    ]) {
      const value =
        field === "webSha256" ? input.webSha256 : input.evidenceSha256[field.split(".")[1]];
      if (typeof value !== "string" || !DIGEST.test(value)) {
        throw manifestError(field);
      }
    }
    if (typeof input.apiImage !== "string" || !API_IMAGE.test(input.apiImage)) {
      throw manifestError("apiImage");
    }
    if (typeof input.workerImage !== "string" || !WORKER_IMAGE.test(input.workerImage)) {
      throw manifestError("workerImage");
    }
    if (typeof input.clamavImage !== "string" || !CLAMAV_IMAGE.test(input.clamavImage)) {
      throw manifestError("clamavImage");
    }
    if (
      typeof input.createdAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.createdAt) ||
      Number.isNaN(Date.parse(input.createdAt)) ||
      new Date(input.createdAt).toISOString() !== input.createdAt
    ) {
      throw manifestError("createdAt");
    }
    return Object.freeze(Object.fromEntries(KEYS.map((key) => [key, input[key]])));
  },
});

function parseArguments(argv) {
  const options = { fixtureMode: false, verifyGithubAttestations: false };
  if (argv.length < 1) fail("PAUSE_RELEASE:MANIFEST_PATH_REQUIRED", undefined, 78);
  options.manifestPath = resolve(argv[0]);
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--fixture-mode") options.fixtureMode = true;
    else if (token === "--verify-github-attestations") options.verifyGithubAttestations = true;
    else if (
      [
        "--api-sbom",
        "--emit-compose-env",
        "--manifest-bundle",
        "--repository",
        "--trivy-api",
        "--trivy-worker",
        "--web",
        "--web-bundle",
        "--web-root",
        "--web-sbom",
        "--worker-sbom",
      ].includes(token)
    ) {
      const value = argv[++index];
      if (!value) fail("PAUSE_RELEASE:ARGUMENT_INVALID", token, 78);
      const key = {
        "--emit-compose-env": "composeEnvPath",
        "--api-sbom": "apiSbomPath",
        "--manifest-bundle": "manifestBundlePath",
        "--repository": "repositoryPath",
        "--trivy-api": "trivyApiPath",
        "--trivy-worker": "trivyWorkerPath",
        "--web": "webPath",
        "--web-bundle": "webBundlePath",
        "--web-root": "webRootPath",
        "--web-sbom": "webSbomPath",
        "--worker-sbom": "workerSbomPath",
      }[token];
      options[key] = resolve(value);
    } else fail("PAUSE_RELEASE:ARGUMENT_INVALID", token, 78);
  }
  return options;
}

async function verifyImageExists(image) {
  await execFileAsync("docker", [
    "buildx",
    "imagetools",
    "inspect",
    image,
    "--format",
    "{{json .Manifest}}",
  ]);
}

async function verifyCosign(image) {
  await execFileAsync("cosign", [
    "verify",
    "--certificate-identity-regexp",
    "^https://github.com/open-trad/opentrad-web/.github/workflows/release-images.yml@refs/(tags|heads)/",
    "--certificate-oidc-issuer",
    "https://token.actions.githubusercontent.com",
    image,
  ]);
}

async function verifyBlob(subject, bundle) {
  await execFileAsync("cosign", [
    "verify-blob",
    "--bundle",
    bundle,
    "--certificate-identity-regexp",
    "^https://github.com/open-trad/opentrad-web/.github/workflows/release-images.yml@refs/(tags|heads)/",
    "--certificate-oidc-issuer",
    "https://token.actions.githubusercontent.com",
    subject,
  ]);
}

async function verifyAttestation(subject, repository) {
  await execFileAsync("gh", [
    "attestation",
    "verify",
    subject,
    "--repo",
    repository,
    "--cert-identity-regex",
    "^https://github.com/open-trad/opentrad-web/.github/workflows/release-images.yml@refs/(tags|heads)/",
    "--signer-workflow",
    "open-trad/opentrad-web/.github/workflows/release-images.yml",
    "--deny-self-hosted-runners",
  ]);
}

async function verifyWebArchive(archive, webRoot) {
  const [{ stdout: names }, { stdout: listing }] = await Promise.all([
    execFileAsync("tar", ["-tf", archive]),
    execFileAsync("tar", ["-tvf", archive]),
  ]);
  for (const raw of names.split("\n").filter(Boolean)) {
    const name = raw.replace(/^\.\//, "");
    if (raw.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) {
      fail("PAUSE_RELEASE:WEB_ARCHIVE_PATH_INVALID");
    }
  }
  for (const line of listing.split("\n").filter(Boolean)) {
    if (!/^[d-]/.test(line)) fail("PAUSE_RELEASE:WEB_ARCHIVE_LINK_REJECTED");
  }
  const temporary = await mkdtemp(join(tmpdir(), "opentrad-web-verify-"));
  try {
    await execFileAsync("tar", [
      "--no-same-owner",
      "--no-same-permissions",
      "-xf",
      archive,
      "-C",
      temporary,
    ]);
    if ((await sha256Tree(temporary)) !== (await sha256Tree(webRoot))) {
      fail("PAUSE_RELEASE:WEB_ARCHIVE_CONTENT_MISMATCH");
    }
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
}

export async function verifyManifest(options) {
  const manifest = ReleaseManifestSchema.parse(
    JSON.parse(await readFile(options.manifestPath, "utf8")),
  );
  const releaseRoot = dirname(options.manifestPath);
  const webPath = options.webPath ?? resolve(releaseRoot, "web.tar");
  const webRootPath = options.webRootPath ?? resolve(releaseRoot, "web");
  const evidencePaths = {
    apiSbom: options.apiSbomPath ?? resolve(releaseRoot, "sbom-api.spdx.json"),
    trivyApi: options.trivyApiPath ?? resolve(releaseRoot, "trivy-api.json"),
    trivyWorker: options.trivyWorkerPath ?? resolve(releaseRoot, "trivy-worker.json"),
    webSbom: options.webSbomPath ?? resolve(releaseRoot, "sbom-web.spdx.json"),
    workerSbom: options.workerSbomPath ?? resolve(releaseRoot, "sbom-worker.spdx.json"),
  };
  const manifestBundlePath =
    options.manifestBundlePath ?? resolve(releaseRoot, "release-manifest.sigstore.json");
  const webBundlePath = options.webBundlePath ?? resolve(releaseRoot, "web.sigstore.json");
  const repositoryPath = options.repositoryPath ?? releaseRoot;
  const webInfo = await stat(webPath);
  const webHash = webInfo.isDirectory() ? await sha256Tree(webPath) : await sha256File(webPath);
  if (webHash !== manifest.webSha256) fail("PAUSE_RELEASE:WEB_DIGEST_MISMATCH");
  for (const [kind, evidencePath] of Object.entries(evidencePaths)) {
    if ((await sha256File(evidencePath)) !== manifest.evidenceSha256[kind]) {
      fail("PAUSE_RELEASE:EVIDENCE_DIGEST_MISMATCH");
    }
  }

  if (!options.fixtureMode) {
    if (!webInfo.isFile()) fail("PAUSE_RELEASE:WEB_ARCHIVE_REQUIRED", undefined, 78);
    await verifyWebArchive(webPath, webRootPath);
    await verifyBlob(options.manifestPath, manifestBundlePath);
    await verifyBlob(webPath, webBundlePath);
    try {
      const { stdout } = await execFileAsync("git", ["-C", repositoryPath, "rev-parse", "HEAD"]);
      if (stdout.trim() !== manifest.sourceSha) fail("PAUSE_RELEASE:SOURCE_SHA_MISMATCH");
    } catch (error) {
      if (error?.code === "PAUSE_RELEASE:SOURCE_SHA_MISMATCH") throw error;
      // A staged production bundle has no .git directory. The verified manifest
      // attestation above is the trusted binding for its exact sourceSha.
    }
    for (const image of [manifest.apiImage, manifest.workerImage, manifest.clamavImage]) {
      await verifyImageExists(image);
    }
    for (const image of [manifest.apiImage, manifest.workerImage]) await verifyCosign(image);
    if (options.verifyGithubAttestations) {
      await verifyAttestation(options.manifestPath, "open-trad/opentrad-web");
      await verifyAttestation(webPath, "open-trad/opentrad-web");
      await verifyAttestation(`oci://${manifest.apiImage}`, "open-trad/opentrad-web");
      await verifyAttestation(`oci://${manifest.workerImage}`, "open-trad/opentrad-web");
    }
  }

  if (options.composeEnvPath) {
    const contents = [
      `OPENTRAD_RELEASE_SHA=${manifest.sourceSha}`,
      `OPENTRAD_API_IMAGE=${manifest.apiImage}`,
      `OPENTRAD_WORKER_IMAGE=${manifest.workerImage}`,
      `OPENTRAD_CLAMAV_IMAGE=${manifest.clamavImage}`,
      "",
    ].join("\n");
    await atomicWrite(options.composeEnvPath, contents, 0o600);
    await chmod(options.composeEnvPath, 0o600);
  }
  return manifest;
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const manifest = await verifyManifest(options);
    process.stdout.write(`MANIFEST_OK:${manifest.sourceSha}\n`);
  } catch (error) {
    const code = error?.code?.startsWith?.("PAUSE_") ? error.code : "PAUSE_RELEASE:VERIFY_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
