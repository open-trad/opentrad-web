import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("conversion-local package boundary", () => {
  it("exposes browser client, worker runtime and PDF safety through narrow ESM subpaths", () => {
    const packageJson = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    ) as { readonly exports?: Record<string, unknown> };

    expect(packageJson.exports?.["./pdf"]).toEqual({
      types: "./dist/pdf/pdfjs.d.ts",
      import: "./dist/pdf/pdfjs.js",
    });
    expect(packageJson.exports?.["./client"]).toEqual({
      types: "./dist/client.d.ts",
      import: "./dist/client.js",
    });
    expect(packageJson.exports?.["./worker-runtime"]).toEqual({
      types: "./dist/workerRuntime.d.ts",
      import: "./dist/workerRuntime.js",
    });
  });
});
