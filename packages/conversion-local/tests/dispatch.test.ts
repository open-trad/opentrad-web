import { beforeEach, describe, expect, it, vi } from "vitest";

const dispatchMocks = vi.hoisted(() => ({
  document: vi.fn(),
  docx: vi.fn(),
  image: vi.fn(),
  pdf: vi.fn(),
  text: vi.fn(),
}));

vi.mock("../src/document/generateDocument.js", () => ({
  dispatchDocumentGeneration: dispatchMocks.document,
}));
vi.mock("../src/docx/convertDocx.js", () => ({
  dispatchDocxConversion: dispatchMocks.docx,
}));
vi.mock("../src/image/convertImage.js", () => ({
  dispatchImageConversion: dispatchMocks.image,
}));
vi.mock("../src/pdf/transformPdf.js", () => ({
  dispatchPdfConversion: dispatchMocks.pdf,
}));
vi.mock("../src/text/convertText.js", () => ({
  dispatchSemanticTextConversion: dispatchMocks.text,
}));

import { dispatchLocalConversion } from "../src/dispatch.js";

const output = Object.freeze({ bytes: new Uint8Array([1]), mediaType: "application/octet-stream" });

function single(operation: string) {
  return {
    bytes: new Uint8Array([1]),
    id: "00000000-0000-4000-8000-000000000001",
    inputFormat:
      operation === "docx.extract"
        ? "docx"
        : operation === "pdf.inspect"
          ? "pdf"
          : operation === "image.convert"
            ? "png"
            : "txt",
    operation,
    options: Object.freeze(Object.create(null)),
    outputFormat:
      operation === "document.generate"
        ? "docx"
        : operation === "docx.extract"
          ? "txt"
          : operation === "pdf.inspect"
            ? "txt"
            : operation === "image.convert"
              ? "jpg"
              : "md",
  } as never;
}

function aggregate(operation: "images.to.pdf" | "pdf.organize") {
  return {
    files: Object.freeze([]),
    id: "00000000-0000-4000-8000-000000000001",
    kind: "aggregate",
    operation,
    options: Object.freeze(Object.create(null)),
    outputFormat: "pdf",
  } as never;
}

describe("combined local conversion dispatcher", () => {
  beforeEach(() => {
    for (const dispatch of Object.values(dispatchMocks)) {
      dispatch.mockReset();
      dispatch.mockResolvedValue(output);
    }
  });

  it.each([
    ["text.semantic", "text"],
    ["document.generate", "document"],
    ["docx.extract", "docx"],
    ["pdf.inspect", "pdf"],
    ["image.convert", "image"],
  ] as const)("routes %s to its only implementation", async (operation, target) => {
    await expect(dispatchLocalConversion(single(operation))).resolves.toBe(output);
    expect(dispatchMocks[target]).toHaveBeenCalledTimes(1);
    expect(
      Object.values(dispatchMocks).reduce((sum, mock) => sum + mock.mock.calls.length, 0),
    ).toBe(1);
  });

  it.each(["pdf.organize", "images.to.pdf"] as const)(
    "routes aggregate %s to the PDF implementation",
    async (operation) => {
      await expect(dispatchLocalConversion(aggregate(operation))).resolves.toBe(output);
      expect(dispatchMocks.pdf).toHaveBeenCalledTimes(1);
      expect(
        Object.values(dispatchMocks).reduce((sum, mock) => sum + mock.mock.calls.length, 0),
      ).toBe(1);
    },
  );
});
