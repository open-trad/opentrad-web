import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LIBRARY_POLICY } from "../src/libraryPolicy.js";

const SHEETJS_SOURCE = "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz";

describe("worker built-in library policy", () => {
  it("pins the official SheetJS CE 0.20.3 artifact and its lockfile integrity", async () => {
    expect(LIBRARY_POLICY.sheetjs).toEqual({
      id: "sheetjs",
      package: "xlsx",
      version: "0.20.3",
      source: SHEETJS_SOURCE,
      integrity:
        "sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==",
      license: "Apache-2.0",
      network: "none",
    });

    const lockPath = fileURLToPath(new URL("../../../pnpm-lock.yaml", import.meta.url));
    const lock = await readFile(lockPath, "utf8");
    expect(lock).toContain(`${SHEETJS_SOURCE}:`);
    expect(lock).toContain(`integrity: ${LIBRARY_POLICY.sheetjs.integrity}`);
  });

  it("is recursively frozen, null-prototype, and JSON serializable", () => {
    expect(Object.getPrototypeOf(LIBRARY_POLICY)).toBeNull();
    expect(Object.getPrototypeOf(LIBRARY_POLICY.sheetjs)).toBeNull();
    expect(Object.isFrozen(LIBRARY_POLICY)).toBe(true);
    expect(Object.isFrozen(LIBRARY_POLICY.sheetjs)).toBe(true);
    expect(() => JSON.stringify(LIBRARY_POLICY)).not.toThrow();
    expect(Reflect.ownKeys(LIBRARY_POLICY)).toEqual(["sheetjs"]);
  });
});
