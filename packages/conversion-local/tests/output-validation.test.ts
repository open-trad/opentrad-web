import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { expect, it } from "vitest";
import { generateDocument } from "../src/document/generateDocument.js";
import { validateLocalOutput } from "../src/output/validateOutput.js";

it("loads each heavy parser only for the selected result media", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/output/validateOutput.ts", import.meta.url)),
    "utf8",
  );
  expect(source).not.toMatch(/^import .*inspectPdf/mu);
  expect(source).not.toMatch(/^import .*inspectDocx/mu);
  expect(source).not.toMatch(/^import .*inspectImageBytes/mu);
  expect(source).toContain('await import("../pdf/pdfjs.js")');
  expect(source).toContain('await import("../docx/convertDocx.js")');
  expect(source).toContain('await import("../image/convertImage.js")');
});

it.each([
  ["pdf", new TextEncoder().encode("%PDF-")],
  ["docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
  ["png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
  ["jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xd9])],
  ["webp", new TextEncoder().encode("RIFF0000WEBP")],
  ["avif", new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 97, 118, 105, 102, 0, 0, 0, 0])],
] as const)("rejects a truncated %s output despite matching magic", async (format, bytes) => {
  await expect(validateLocalOutput(bytes, format, new AbortController().signal)).rejects.toThrow(
    "LOCAL_RESULT_INVALID",
  );
});

it("rejects an already-cancelled text validation", async () => {
  const controller = new AbortController();
  controller.abort();

  await expect(
    validateLocalOutput(new TextEncoder().encode("private"), "txt", controller.signal),
  ).rejects.toThrow("LOCAL_CONVERSION_CANCELLED");
});

it("accepts complete text, PDF, DOCX and PNG outputs and returns copied bytes", async () => {
  const document = await PDFDocument.create({ updateMetadata: false });
  document.addPage([200, 300]);
  const pdf = Uint8Array.from(
    await document.save({
      addDefaultPage: false,
      updateFieldAppearances: false,
      useObjectStreams: true,
    }),
  );
  const docx = await generateDocument(
    new TextEncoder().encode("OpenTrad 本地文档"),
    "txt",
    "docx",
    "utf-8",
  );
  const png = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAAXNSR0IArs4c6QAAAAlwSFlzAAAOvgAADr4B6kKxwAAAABNJREFUKFNj/M+ADzDhlWUYqdIAQSwBE8U+X40AAAAASUVORK5CYII=",
      "base64",
    ),
  );

  for (const [format, bytes] of [
    ["txt", new TextEncoder().encode("OpenTrad")],
    ["pdf", pdf],
    ["docx", docx],
    ["png", png],
  ] as const) {
    const validated = await validateLocalOutput(bytes, format, new AbortController().signal);
    expect(validated).toEqual(bytes);
    expect(validated).not.toBe(bytes);
  }
});
