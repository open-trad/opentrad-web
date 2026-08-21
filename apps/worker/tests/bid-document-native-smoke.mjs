import { readFile } from "node:fs/promises";

globalThis.fetch = () => {
  throw new Error("network access is forbidden");
};

const { copyRenderedBidDocumentBytes, renderCompiledBidDocument } = await import(
  "../dist/policies/bidDocument.js"
);
const { compileCanonicalBidProject, createBidCompileRuntime } = await import(
  "../dist/policies/bidCompile.js"
);
const draft = JSON.parse(
  await readFile(
    new URL(
      "../../../packages/document-core/tests/fixtures/v2/bid-government-goods.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const attachments = draft.attachments.map(
  ({ localBlobKey: _localBlobKey, ...attachment }) => attachment,
);
const stableJson = (value) => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
};
const compiled = compileCanonicalBidProject(
  new TextEncoder().encode(
    stableJson({
      formatVersion: "2.0.0",
      template: {
        id: "bid.government.goods.v1",
        version: "1.0.0",
        basisDate: "2026-08-19",
      },
      draft,
      presentation: { layoutStyleId: "classic-formal.v1", languageView: "zh-CN" },
      attachmentManifest: attachments,
    }),
  ),
  { templateId: "bid.government.goods.v1", templateVersion: "1.0.0" },
  createBidCompileRuntime({ now: () => Date.parse("2026-08-20T04:00:00.000Z") }),
);
const expectedModel = JSON.parse(
  await readFile(
    new URL(
      "../../../tests/golds/templates-v2/artifacts/bid.government.goods.v1/default.model.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
if (JSON.stringify(compiled.model) !== JSON.stringify(expectedModel)) {
  throw new Error("native bid compile parity failed");
}
const jpeg = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAEAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD2vwP4V0658FeH53XDS6fbuf3UTcmNT1KEn6kk0UUV01Mny+Um3Qg2/wC7H/I+BxdSf1ipr1f5n//Z",
    "base64",
  ),
);
const pages = [
  { attachmentId: "proof-license", pageNumber: 1 },
  ...Array.from({ length: 8 }, (_value, index) => ({
    attachmentId: "proof-spec",
    pageNumber: index + 1,
  })),
].map(({ attachmentId, pageNumber }) => ({
  attachmentId,
  pageNumber,
  bytes: jpeg.slice(),
  widthPixels: 2,
  heightPixels: 4,
}));
const result = await renderCompiledBidDocument(compiled, pages);
const bytes = copyRenderedBidDocumentBytes(result);
if (
  result.attachmentPages !== 9 ||
  bytes[0] !== 0x50 ||
  bytes[1] !== 0x4b ||
  bytes[2] !== 0x03 ||
  bytes[3] !== 0x04
) {
  throw new Error("native bid document rendering failed");
}
