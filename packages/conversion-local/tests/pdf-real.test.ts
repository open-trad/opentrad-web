import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { extractPdfText, inspectPdf } from "../src/pdf/pdfjs.js";

describe("real PDF.js integration", () => {
  it("inspects and extracts a real in-memory pdf-lib document with the locked parser", async () => {
    const source = await PDFDocument.create();
    const font = await source.embedFont(StandardFonts.Helvetica);
    const page = source.addPage([200, 300]);
    page.drawText("OpenTrad real parser", { font, size: 12, x: 20, y: 260 });
    const bytes = new Uint8Array(await source.save({ useObjectStreams: false }));

    const inspection = await inspectPdf(bytes);
    expect(inspection).toEqual({
      pageCount: 1,
      pages: [{ height: 300, pageNumber: 1, rotation: 0, width: 200 }],
    });

    const extracted = await extractPdfText(bytes);
    expect(extracted.pageCount).toBe(1);
    expect(extracted.text).toContain("OpenTrad real parser");
  });
});
