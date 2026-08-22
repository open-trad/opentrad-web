import { PDFDocument } from "pdf-lib";

globalThis.fetch = () => {
  throw new Error("network access is forbidden");
};

const { inspectBidAttachmentBytes } = await import("../dist/adapters/bidAttachmentInspector.js");
const document = await PDFDocument.create();
document.addPage([595.28, 841.89]);
document.addPage([841.89, 595.28]);
const bytes = await document.save({ useObjectStreams: true });
const result = await inspectBidAttachmentBytes(bytes, "application/pdf", 2);
if (result.pageCount !== 2 || Object.getPrototypeOf(result) !== null || !Object.isFrozen(result)) {
  throw new Error("native bid attachment inspection failed");
}
