import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("conversion-local package boundary", () => {
  it("exposes the PDF safety wrapper through a narrow ESM subpath", () => {
    const packageJson = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    ) as { readonly exports?: Record<string, unknown> };

    expect(packageJson.exports?.["./pdf"]).toEqual({
      types: "./dist/pdf/pdfjs.d.ts",
      import: "./dist/pdf/pdfjs.js",
    });
  });
});
