import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as workerExports from "../src/index.js";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));

describe("worker package boundary", () => {
  it("exports only the package root and keeps runner internals out of the public barrel", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { exports?: unknown };
    expect(packageJson.exports).toEqual({
      ".": {
        default: "./dist/index.js",
        types: "./dist/index.d.ts",
      },
    });
    expect(workerExports).not.toHaveProperty("runCommand");
    expect(workerExports).not.toHaveProperty("createInternalProcessSpec");
    expect(workerExports).not.toHaveProperty("FIXED_PROCESS_ENVIRONMENT");
    expect(workerExports).not.toHaveProperty("MAX_CAPTURE_BYTES");
    expect(workerExports).not.toHaveProperty("PROCESS_GROUP_GRACE_MS");
    expect(workerExports).toHaveProperty("resolveServerConversionPlan");
    expect(workerExports).not.toHaveProperty("resolveWorkspacePaths");
    expect(workerExports).not.toHaveProperty("officeToPdf");
    expect(workerExports).not.toHaveProperty("pandocConvert");
    expect(workerExports).toHaveProperty("convertSpreadsheetToCsv");
    expect(workerExports).toHaveProperty("SPREADSHEET_POLICY");
    expect(workerExports).toHaveProperty("LIBRARY_POLICY");
    expect(workerExports).not.toHaveProperty("__spreadsheetTest");
    expect(workerExports).not.toHaveProperty("handleSpreadsheetThreadMessage");
  });

  it("makes native Node reject deep processRunner imports", () => {
    const script = `
      import("@opentrad/worker/processRunner").then(
        () => process.exit(91),
        (error) => process.exit(error && error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED" ? 0 : 92),
      );
    `;
    expect(() =>
      execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
        cwd: packageDirectory,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("makes native Node reject deep policy imports", () => {
    const script = `
      import("@opentrad/worker/policies/workspace").then(
        () => process.exit(91),
        (error) => process.exit(error && error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED" ? 0 : 92),
      );
    `;
    expect(() =>
      execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
        cwd: packageDirectory,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("keeps a build-first native attachment-inspector smoke in the package gates", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, unknown> };
    expect(packageJson.scripts?.["test:native-bid-attachment"]).toBe(
      "pnpm build && node tests/bid-attachment-native-smoke.mjs",
    );
    expect(packageJson.scripts?.["test:native-bid-document"]).toBe(
      "pnpm build && node tests/bid-document-native-smoke.mjs",
    );
  });
});
