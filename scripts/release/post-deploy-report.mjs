#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite, canonicalJson } from "./release-utils.mjs";

function pause(code) {
  const error = new Error(code);
  error.code = code;
  error.exitCode = 78;
  throw error;
}

export function verifyAcceptanceReport(input, expectedSha) {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    input.schemaVersion !== 1 ||
    input.sourceSha !== expectedSha ||
    input.accepted !== true
  ) {
    pause("PAUSE_REPORT:ACCEPTANCE_INVALID");
  }
  if (Object.keys(input).sort().join(",") !== "accepted,createdAt,gates,schemaVersion,sourceSha") {
    pause("PAUSE_REPORT:ACCEPTANCE_INVALID");
  }
  const expectedGates = ["baseline", "canary", "load", "privacy"];
  if (
    input.gates === null ||
    typeof input.gates !== "object" ||
    Array.isArray(input.gates) ||
    Object.keys(input.gates).sort().join(",") !== expectedGates.join(",") ||
    expectedGates.some((gate) => input.gates[gate] !== true)
  ) {
    pause("PAUSE_REPORT:ACCEPTANCE_INCOMPLETE");
  }
  if (
    typeof input.createdAt !== "string" ||
    Number.isNaN(Date.parse(input.createdAt)) ||
    new Date(input.createdAt).toISOString() !== input.createdAt
  ) {
    pause("PAUSE_REPORT:ACCEPTANCE_INVALID");
  }
  return Object.freeze(input);
}

export function verifyDeploymentReport(input, expectedSha) {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(",") !==
      "createdAt,deployed,failedStage,schemaVersion,sourceSha" ||
    input.schemaVersion !== 1 ||
    input.sourceSha !== expectedSha ||
    input.deployed !== true ||
    input.failedStage !== null ||
    typeof input.createdAt !== "string" ||
    Number.isNaN(Date.parse(input.createdAt)) ||
    new Date(input.createdAt).toISOString() !== input.createdAt
  ) {
    pause("PAUSE_REPORT:DEPLOYMENT_INVALID");
  }
  return Object.freeze(input);
}

async function main() {
  try {
    if (process.argv[2] === "--verify-deployment") {
      const [, sha, reportPath, ...extra] = process.argv.slice(2);
      if (!/^[a-f0-9]{40}$/.test(sha ?? "") || !reportPath || extra.length > 0) {
        pause("PAUSE_REPORT:ARGUMENT_INVALID");
      }
      verifyDeploymentReport(JSON.parse(await readFile(resolve(reportPath), "utf8")), sha);
      process.stdout.write(`REPORT_VERIFIED:${sha}:deployed\n`);
      return;
    }
    if (process.argv[2] === "--verify") {
      const [, sha, reportPath, ...extra] = process.argv.slice(2);
      if (!/^[a-f0-9]{40}$/.test(sha ?? "") || !reportPath || extra.length > 0) {
        pause("PAUSE_REPORT:ARGUMENT_INVALID");
      }
      verifyAcceptanceReport(JSON.parse(await readFile(resolve(reportPath), "utf8")), sha);
      process.stdout.write(`REPORT_VERIFIED:${sha}:accepted\n`);
      return;
    }
    const [sha, baselinePath, canaryPath, privacyPath, loadPath, outputPath] =
      process.argv.slice(2);
    if (!/^[a-f0-9]{40}$/.test(sha ?? "") || !outputPath) pause("PAUSE_REPORT:ARGUMENT_INVALID");
    const [baseline, canary, privacy, load] = await Promise.all(
      [baselinePath, canaryPath, privacyPath, loadPath].map(async (path) =>
        JSON.parse(await readFile(resolve(path), "utf8")),
      ),
    );
    const report = {
      schemaVersion: 1,
      sourceSha: sha,
      accepted:
        baseline.ok === true && canary.ok === true && privacy.ok === true && load.ok === true,
      gates: {
        baseline: baseline.ok === true,
        canary: canary.ok === true,
        load: load.ok === true,
        privacy: privacy.ok === true,
      },
      createdAt: new Date().toISOString(),
    };
    if (report.accepted) verifyAcceptanceReport(report, sha);
    await atomicWrite(resolve(outputPath), canonicalJson(report), 0o600);
    process.stdout.write(`REPORT_CREATED:${sha}:${report.accepted ? "accepted" : "rejected"}\n`);
    if (!report.accepted) process.exitCode = 1;
  } catch (error) {
    const code = error?.code?.startsWith?.("PAUSE_") ? error.code : "PAUSE_REPORT:FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 78;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
