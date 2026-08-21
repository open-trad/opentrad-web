import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rendererRoot = join(repositoryRoot, "packages/document-renderer");
const rendererDist = join(rendererRoot, "dist");
if (dirname(rendererDist) !== rendererRoot || rendererDist !== resolve(rendererRoot, "dist")) {
  throw new Error("Unsafe renderer dist path");
}

const recoveryDirectory = mkdtempSync(join(rendererRoot, ".fresh-dist-smoke-"));
const recoveredDist = join(recoveryDirectory, "dist");
const hadExistingDist = existsSync(rendererDist);

try {
  if (hadExistingDist) renameSync(rendererDist, recoveredDist);
  execFileSync("pnpm", ["run", "build:document-prerequisites"], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  const entry = join(rendererDist, "index.js");
  if (!existsSync(entry)) throw new Error("Renderer dist was not rebuilt from a fresh checkout");
  const renderer = await import(`${pathToFileURL(entry).href}?fresh-dist-smoke`);
  if (typeof renderer.renderDocxV2 !== "function") {
    throw new Error("Fresh renderer dist has no renderDocxV2 export");
  }
  console.log("Fresh renderer dist prerequisite verified");
} finally {
  if (existsSync(rendererDist)) rmSync(rendererDist, { force: true, recursive: true });
  if (hadExistingDist && existsSync(recoveredDist)) renameSync(recoveredDist, rendererDist);
  rmSync(recoveryDirectory, { force: true, recursive: true });
}
