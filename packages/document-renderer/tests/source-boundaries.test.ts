import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("document-renderer package boundaries", () => {
  it("never imports upward into an application from package source or tests", () => {
    for (const path of [
      ...sourceFiles(join(PACKAGE_ROOT, "src")),
      ...sourceFiles(join(PACKAGE_ROOT, "tests")),
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source, relative(PACKAGE_ROOT, path)).not.toMatch(
        /(?:from\s*|import\s*\()["'][^"']*apps\//u,
      );
    }
  });

  it("uses Node-compatible .js suffixes for every relative source import and re-export", () => {
    for (const path of sourceFiles(join(PACKAGE_ROOT, "src"))) {
      const source = readFileSync(path, "utf8");
      const specifiers = Array.from(
        source.matchAll(/(?:from\s*|import\s*\()["'](\.[^"']+)["']/gu),
        (match) => match[1] ?? "",
      );
      expect(
        specifiers.every((specifier) => specifier.endsWith(".js")),
        relative(PACKAGE_ROOT, path),
      ).toBe(true);
    }
  });
});
