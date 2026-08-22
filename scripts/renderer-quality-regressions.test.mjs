import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootPackage = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));

test("root workflows build every exported workspace package before its consumers", () => {
  assert.equal(
    rootPackage.scripts["build:document-prerequisites"],
    "pnpm --filter @opentrad/contracts build && pnpm --filter @opentrad/document-core build && pnpm --filter @opentrad/document-renderer build",
  );
  assert.equal(
    rootPackage.scripts["build:workspace-prerequisites"],
    "pnpm run build:document-prerequisites && pnpm --filter @opentrad/conversion-local build",
  );
  for (const name of ["dev", "golds:generate", "golds:verify"]) {
    assert.match(rootPackage.scripts[name], /^pnpm run build:document-prerequisites && /u, name);
  }
  assert.match(rootPackage.scripts.typecheck, /^pnpm run build:workspace-prerequisites && /u);
  assert.match(
    rootPackage.scripts.test,
    /^pnpm run build:workspace-prerequisites && pnpm --filter @opentrad\/web build && /u,
  );
  assert.equal(
    rootPackage.scripts["test:fresh-renderer-dist"],
    "node scripts/fresh-renderer-dist-smoke.mjs",
  );
});

test("renderer package serially pins omitted-seam output to an independent committed DOCX", () => {
  assert.equal(
    JSON.parse(
      readFileSync(join(repositoryRoot, "packages/document-renderer/package.json"), "utf8"),
    ).scripts.test,
    "vitest run && node scripts/committed-baseline-smoke.mjs",
  );

  const baselineSmoke = readFileSync(
    join(repositoryRoot, "packages/document-renderer/scripts/committed-baseline-smoke.mjs"),
    "utf8",
  );
  assert.match(baselineSmoke, /default\.docx/u);
  assert.match(baselineSmoke, /createHash/u);
  assert.match(baselineSmoke, /default\.model\.json/u);

  const webBoundary = readFileSync(
    join(repositoryRoot, "apps/web/src/features/documents/render/documentRendererPackage.test.ts"),
    "utf8",
  );
  assert.doesNotMatch(webBoundary, /default\.docx|createHash|default\.model\.json/u);
});
