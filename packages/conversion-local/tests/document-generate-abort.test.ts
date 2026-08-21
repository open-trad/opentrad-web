import { expect, it, vi } from "vitest";

const docxMock = vi.hoisted(() => {
  let resolve: ((value: ArrayBuffer) => void) | undefined;
  const pending = new Promise<ArrayBuffer>((done) => {
    resolve = done;
  });
  return {
    pack: vi.fn(() => pending),
    resolve: (value: ArrayBuffer) => resolve?.(value),
  };
});

vi.mock("docx", () => ({
  Document: class Document {},
  Packer: { toArrayBuffer: docxMock.pack },
  Paragraph: class Paragraph {},
  TextRun: class TextRun {},
}));

import { generateDocument } from "../src/document/generateDocument.js";

it("rejects promptly on abort and ignores a late DOCX pack fulfillment", async () => {
  const controller = new AbortController();
  const pending = generateDocument(
    new TextEncoder().encode("OpenTrad"),
    "txt",
    "docx",
    "utf-8",
    controller.signal,
  );
  await vi.waitFor(() => expect(docxMock.pack).toHaveBeenCalledTimes(1));

  controller.abort();
  await expect(pending).rejects.toThrow("LOCAL_CONVERSION_CANCELLED");
  docxMock.resolve(new ArrayBuffer(4));
  await Promise.resolve();
});
