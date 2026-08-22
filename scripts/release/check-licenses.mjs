#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileAsync } from "./release-utils.mjs";

const ALLOWED = new Set([
  "0BSD",
  "Apache-2.0",
  "Artistic-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "ISC",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "Python-2.0",
  "Unlicense",
  "WTFPL",
  "Zlib",
]);
const DENIED =
  /(?:BUSL|Commons-Clause|Elastic|LicenseRef|NC|NOASSERTION|SEE LICENSE|SSPL|UNLICENSED|UNKNOWN)/i;
const REVIEWED_EXCEPTIONS = new Map([["duck", "BSD"]]);

function licenseAllowed(name, expression) {
  if (REVIEWED_EXCEPTIONS.get(name) === expression) return true;
  if (DENIED.test(expression)) return false;
  return expression
    .replace(/[()]/g, " ")
    .split(/\s+OR\s+/i)
    .some((alternative) =>
      alternative
        .split(/\s+(?:AND|WITH)\s+/i)
        .map((value) => value.trim())
        .filter(Boolean)
        .every((value) => ALLOWED.has(value)),
    );
}

export function evaluateLicenses(packages) {
  const rejected = [];
  for (const entry of packages) {
    const name = typeof entry.name === "string" ? entry.name : "invalid-package";
    const license = typeof entry.license === "string" ? entry.license.trim() : "UNKNOWN";
    if (!licenseAllowed(name, license)) {
      rejected.push({ license, name });
    }
  }
  rejected.sort((left, right) => left.name.localeCompare(right.name));
  return Object.freeze({ checked: packages.length, ok: rejected.length === 0, rejected });
}

function normalizeReport(report) {
  if (Array.isArray(report)) return report;
  const output = [];
  for (const [license, packages] of Object.entries(report ?? {})) {
    if (!Array.isArray(packages)) continue;
    for (const value of packages) {
      const name = typeof value === "string" ? value : value?.name;
      if (typeof name === "string") output.push({ license, name });
    }
  }
  return output;
}

async function productionPackages() {
  const { stdout } = await execFileAsync("pnpm", ["licenses", "list", "--prod", "--json"], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return normalizeReport(JSON.parse(stdout));
}

async function main() {
  try {
    const args = process.argv.slice(2);
    let packages;
    if (args.length === 1 && args[0] === "--fixture-mode") {
      packages = [
        { name: "fixture-mit", license: "MIT" },
        { name: "fixture-apache", license: "Apache-2.0" },
        { name: "fixture-mpl", license: "MPL-2.0" },
      ];
    } else if (args.length === 1 && args[0] === "--fixture-denied") {
      packages = [{ name: "fixture-denied", license: "SSPL-1.0" }];
    } else if (args.length === 0) packages = await productionPackages();
    else {
      const error = new Error("PAUSE_LICENSE:ARGUMENT_INVALID");
      error.code = "PAUSE_LICENSE:ARGUMENT_INVALID";
      error.exitCode = 78;
      throw error;
    }
    const result = evaluateLicenses(packages);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const code = error?.code?.startsWith?.("PAUSE_")
      ? error.code
      : "PAUSE_LICENSE:REPORT_UNAVAILABLE";
    process.stderr.write(`${code}\n`);
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 78;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
