#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { atomicWrite, canonicalJson } from "./release-utils.mjs";

function reportError() {
  const error = new Error("PAUSE_RELEASE:TRIVY_REPORT_INVALID");
  error.code = "PAUSE_RELEASE:TRIVY_REPORT_INVALID";
  return error;
}

function own(input, key) {
  return Object.hasOwn(input, key);
}

export function normalizeTrivyReport(report) {
  if (
    report === null ||
    typeof report !== "object" ||
    Array.isArray(report) ||
    report.SchemaVersion !== 2 ||
    report.ArtifactType !== "container_image" ||
    typeof report.ArtifactName !== "string" ||
    report.ArtifactName.length === 0 ||
    !Array.isArray(report.Results) ||
    report.Results.length === 0
  ) {
    throw reportError();
  }
  const results = report.Results.map((result) => {
    if (
      result === null ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      typeof result.Target !== "string" ||
      result.Target.length === 0 ||
      !["lang-pkgs", "os-pkgs"].includes(result.Class) ||
      typeof result.Type !== "string" ||
      result.Type.length === 0 ||
      !Array.isArray(result.Packages) ||
      result.Packages.length === 0 ||
      result.Packages.some(
        (entry) => entry === null || typeof entry !== "object" || Array.isArray(entry),
      ) ||
      (own(result, "Vulnerabilities") && !Array.isArray(result.Vulnerabilities))
    ) {
      throw reportError();
    }
    return { ...result, Vulnerabilities: result.Vulnerabilities ?? [] };
  });
  return Object.freeze({ ...report, Results: results });
}

async function main() {
  if (process.argv.length !== 4) throw reportError();
  const input = resolve(process.argv[2]);
  const output = resolve(process.argv[3]);
  if (input === output) throw reportError();
  let report;
  try {
    report = JSON.parse(await readFile(input, "utf8"));
  } catch {
    throw reportError();
  }
  await atomicWrite(output, canonicalJson(normalizeTrivyReport(report)));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error?.code ?? "PAUSE_RELEASE:TRIVY_REPORT_INVALID"}\n`);
    process.exitCode = 1;
  });
}
