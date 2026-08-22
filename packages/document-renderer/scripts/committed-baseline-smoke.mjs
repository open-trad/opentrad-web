import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DocumentModelV2Schema } from "@opentrad/document-core";
import { renderDocxV2 } from "../dist/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const baselineDirectory = join(
  repositoryRoot,
  "tests/golds/templates-v2/artifacts/quotation.service.project.v1",
);
const baselineDocxSha256 = "e8015e5433f2da622406b41572973686fc37c0a0bf04de8e7c2eacdbf7b4cce7";
const fixedTime = Date.parse("2026-08-19T00:00:00.000Z");
const NativeDate = Date;

class FixedDate extends NativeDate {
  constructor(value) {
    super(value ?? fixedTime);
  }

  static now() {
    return fixedTime;
  }
}

const [modelJson, committedDocx] = await Promise.all([
  readFile(join(baselineDirectory, "default.model.json"), "utf8"),
  readFile(join(baselineDirectory, "default.docx")),
]);
const committedHash = createHash("sha256").update(committedDocx).digest("hex");
assert.equal(committedHash, baselineDocxSha256, "committed DOCX baseline hash changed");

globalThis.Date = FixedDate;
try {
  const model = DocumentModelV2Schema.parse(JSON.parse(modelJson));
  const rendered = await renderDocxV2(model, "modern-business.v1", "zh-CN");
  const renderedBytes = new Uint8Array(await rendered.arrayBuffer());
  assert.equal(
    createHash("sha256").update(renderedBytes).digest("hex"),
    committedHash,
    "omitted-seam renderer output diverged from the committed DOCX baseline",
  );
} finally {
  globalThis.Date = NativeDate;
}

console.log("Committed omitted-seam DOCX baseline verified");
