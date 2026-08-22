import { CAPABILITIES } from "@opentrad/contracts";
import { PDFDocument } from "pdf-lib";
import { convertEncodedImage, inspectImageBytes } from "../image/convertImage.js";
import type { LocalAggregateConversionRequest, LocalWorkerRequest } from "../protocol.js";
import type { LocalWorkerOutput } from "../worker.js";

const IntrinsicError = Error;
const MAX_PAGE_AREA = 40_000_000;
const MAX_PAGE_DIMENSION = 14_400;

function failure(code: string): Error {
  return new IntrinsicError(code);
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw failure("LOCAL_CONVERSION_CANCELLED");
}

const capability = CAPABILITIES.find((item) => item.id === "images.to.pdf");
if (!capability || capability.execution !== "browser") throw failure("PDF_CAPABILITY_INVALID");
const configuredMaximumOutputBytes = capability.limits.maxTotalBytes;
if (!configuredMaximumOutputBytes) throw failure("PDF_CAPABILITY_INVALID");
const maximumOutputBytes: number = configuredMaximumOutputBytes;

function pageSize(
  width: number,
  height: number,
): { readonly height: number; readonly width: number } {
  const scale = Math.min(
    1,
    MAX_PAGE_DIMENSION / width,
    MAX_PAGE_DIMENSION / height,
    Math.sqrt(MAX_PAGE_AREA / (width * height)),
  );
  return Object.freeze({ height: height * scale, width: width * scale });
}

function metadata(document: PDFDocument): void {
  const epoch = new Date(0);
  document.setProducer("OpenTrad local PDF tools");
  document.setCreator("OpenTrad local PDF tools");
  document.setTitle("OpenTrad local PDF");
  document.setSubject("Locally transformed trade document");
  document.setKeywords(["OpenTrad", "local"]);
  document.setCreationDate(epoch);
  document.setModificationDate(epoch);
}

function isImagesRequest(
  request: LocalWorkerRequest,
): request is LocalAggregateConversionRequest & { readonly operation: "images.to.pdf" } {
  return "kind" in request && request.kind === "aggregate" && request.operation === "images.to.pdf";
}

export async function dispatchImagesToPdfConversion(
  request: LocalWorkerRequest,
  signal?: AbortSignal,
): Promise<LocalWorkerOutput> {
  if (!isImagesRequest(request)) throw failure("LOCAL_OPERATION_NOT_IMPLEMENTED");
  checkAbort(signal);
  const target = await PDFDocument.create({ updateMetadata: false });
  metadata(target);
  for (const file of request.files) {
    checkAbort(signal);
    const format = file.inputFormat;
    if (format !== "png" && format !== "jpg" && format !== "webp" && format !== "avif") {
      throw failure("IMAGE_FORMAT_INVALID");
    }
    const inspection = inspectImageBytes(file.bytes, format);
    let bytes = file.bytes;
    let embeddedFormat: "jpg" | "png" = format === "jpg" ? "jpg" : "png";
    if (format === "webp" || format === "avif") {
      bytes = await convertEncodedImage(bytes, format, "png", 80, signal);
      embeddedFormat = "png";
    }
    checkAbort(signal);
    const image =
      embeddedFormat === "jpg" ? await target.embedJpg(bytes) : await target.embedPng(bytes);
    const size = pageSize(inspection.width, inspection.height);
    const page = target.addPage([size.width, size.height]);
    page.drawImage(image, { height: size.height, width: size.width, x: 0, y: 0 });
  }
  checkAbort(signal);
  const bytes = await target.save({
    addDefaultPage: false,
    objectsPerTick: Number.MAX_SAFE_INTEGER,
    updateFieldAppearances: false,
    useObjectStreams: true,
  });
  if (bytes.byteLength > maximumOutputBytes) throw failure("PDF_OUTPUT_TOO_LARGE");
  return Object.freeze({
    bytes: Uint8Array.from(bytes),
    mediaType: "application/pdf",
  });
}
