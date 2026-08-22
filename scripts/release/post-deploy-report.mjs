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

async function main() {
  try {
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
