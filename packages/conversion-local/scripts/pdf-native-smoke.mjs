import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdfText, inspectPdf } from "../dist/index.js";

const source = await PDFDocument.create();
const font = await source.embedFont(StandardFonts.Helvetica);
const page = source.addPage([200, 300]);
page.drawText("OpenTrad native dist", { font, size: 12 });
const bytes = new Uint8Array(await source.save({ useObjectStreams: false }));
const inspection = await inspectPdf(bytes);
const extracted = await extractPdfText(bytes);

if (inspection.pageCount !== 1 || !extracted.text.includes("OpenTrad native dist")) {
  throw new Error("PDF_NATIVE_SMOKE_FAILED");
}
