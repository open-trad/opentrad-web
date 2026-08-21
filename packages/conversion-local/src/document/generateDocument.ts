import { PDFDocument } from "pdf-lib";
import type { LocalConversionRequest, LocalTextEncoding } from "../protocol.js";
import { convertSemanticText } from "../text/convertText.js";
import type { LocalWorkerOutput } from "../worker.js";

type DocumentOutput = "docx" | "pdf";
type TextFormat = "html" | "md" | "txt";

const DOCX_MEDIA = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MEDIA = "application/pdf";
const MAX_TEXT_CODE_UNITS = 1_000_000;
const MAX_PARAGRAPHS = 5_000;
const PDF_PAGE_WIDTH = 1_240;
const PDF_PAGE_HEIGHT = 1_754;
const PDF_MARGIN = 90;
const PDF_LINE_HEIGHT = 42;
const PDF_LINES_PER_PAGE = 37;
const PDF_MAX_PAGES = 80;
const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
const IntrinsicAbortSignal = AbortSignal;
const IntrinsicError = Error;
const IntrinsicEventTarget = EventTarget;
const IntrinsicSegmenter = Intl.Segmenter;
const intrinsicAbortSignalAborted = Reflect.getOwnPropertyDescriptor(
  IntrinsicAbortSignal.prototype,
  "aborted",
)?.get;
const intrinsicEventTargetAddEventListener = IntrinsicEventTarget.prototype.addEventListener;
const intrinsicEventTargetRemoveEventListener = IntrinsicEventTarget.prototype.removeEventListener;
const intrinsicFreeze = Object.freeze;
const intrinsicObjectCreate = Object.create;
const intrinsicReflectApply = Reflect.apply;
const IntrinsicTextDecoder = TextDecoder;
const cancelledSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const formatSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const generationSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const limitSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const renderUnavailableSentinel = intrinsicFreeze(intrinsicObjectCreate(null));

function fail(code: string): never {
  switch (code) {
    case "LOCAL_CONVERSION_CANCELLED":
      throw cancelledSentinel;
    case "LOCAL_DOCUMENT_FORMAT_INVALID":
      throw formatSentinel;
    case "LOCAL_DOCUMENT_LIMIT":
      throw limitSentinel;
    case "LOCAL_DOCUMENT_RENDER_UNAVAILABLE":
      throw renderUnavailableSentinel;
    default:
      throw generationSentinel;
  }
}

function signalAborted(signal?: AbortSignal): boolean {
  if (!signal) return false;
  if (!intrinsicAbortSignalAborted) throw generationSentinel;
  try {
    return intrinsicReflectApply(intrinsicAbortSignalAborted, signal, []) === true;
  } catch {
    throw generationSentinel;
  }
}

function publicError(error: unknown, signal?: AbortSignal): Error {
  let aborted = false;
  try {
    aborted = signalAborted(signal);
  } catch {
    // A hostile signal is always normalized to the finite generation error.
  }
  if (error === cancelledSentinel || aborted) {
    return new IntrinsicError("LOCAL_CONVERSION_CANCELLED");
  }
  if (error === formatSentinel) return new IntrinsicError("LOCAL_DOCUMENT_FORMAT_INVALID");
  if (error === limitSentinel) return new IntrinsicError("LOCAL_DOCUMENT_LIMIT");
  if (error === renderUnavailableSentinel) {
    return new IntrinsicError("LOCAL_DOCUMENT_RENDER_UNAVAILABLE");
  }
  return new IntrinsicError("LOCAL_DOCUMENT_GENERATION_FAILED");
}

function checkAbort(signal?: AbortSignal): void {
  if (signalAborted(signal)) throw cancelledSentinel;
}

function waitForAbortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  checkAbort(signal);
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      intrinsicReflectApply(intrinsicEventTargetRemoveEventListener, signal, ["abort", onAbort]);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(cancelledSentinel);
    };
    try {
      intrinsicReflectApply(intrinsicEventTargetAddEventListener, signal, [
        "abort",
        onAbort,
        { once: true },
      ]);
    } catch {
      settled = true;
      reject(generationSentinel);
      return;
    }
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          checkAbort(signal);
          resolve(value);
        } catch (error) {
          reject(error);
        }
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

function isTextFormat(input: unknown): input is TextFormat {
  return input === "txt" || input === "md" || input === "html";
}

function isDocumentOutput(input: unknown): input is DocumentOutput {
  return input === "docx" || input === "pdf";
}

function linesFromText(text: string): readonly string[] {
  if (text.length > MAX_TEXT_CODE_UNITS) fail("LOCAL_DOCUMENT_LIMIT");
  const raw = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  if (raw.length > MAX_PARAGRAPHS) fail("LOCAL_DOCUMENT_LIMIT");
  return Object.freeze(raw);
}

async function plainText(
  bytes: Uint8Array,
  input: TextFormat,
  encoding: LocalTextEncoding,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  const converted = await convertSemanticText(bytes, input, "txt", encoding, signal);
  checkAbort(signal);
  const text = new IntrinsicTextDecoder("utf-8", { fatal: true }).decode(converted);
  return linesFromText(text);
}

async function generateDocx(
  lines: readonly string[],
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const docx = await waitForAbortable(import("docx"), signal);
  const children: import("docx").Paragraph[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    children[index] = new docx.Paragraph({
      children: [new docx.TextRun({ font: "sans-serif", text: lines[index] ?? "" })],
      spacing: { after: 120, line: 360 },
    });
  }
  const document = new docx.Document({
    creator: "OpenTrad",
    description: "OpenTrad local document conversion",
    sections: [{ children }],
    title: "OpenTrad local document",
  });
  const output = await waitForAbortable(docx.Packer.toArrayBuffer(document), signal);
  return new Uint8Array(output);
}

function wrapPdfLines(
  context: OffscreenCanvasRenderingContext2D,
  lines: readonly string[],
): readonly string[] {
  const wrapped: string[] = [];
  const segmenter = new IntrinsicSegmenter("zh-CN", { granularity: "grapheme" });
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    if (line.length === 0) {
      wrapped.push("");
      continue;
    }
    let current = "";
    for (const item of segmenter.segment(line)) {
      const candidate = current + item.segment;
      if (current.length > 0 && context.measureText(candidate).width > PDF_CONTENT_WIDTH) {
        wrapped.push(current);
        current = item.segment;
      } else {
        current = candidate;
      }
      if (wrapped.length > PDF_LINES_PER_PAGE * PDF_MAX_PAGES) {
        fail("LOCAL_DOCUMENT_LIMIT");
      }
    }
    wrapped.push(current);
    if (wrapped.length > PDF_LINES_PER_PAGE * PDF_MAX_PAGES) {
      fail("LOCAL_DOCUMENT_LIMIT");
    }
  }
  return Object.freeze(wrapped);
}

async function generatePdf(
  lines: readonly string[],
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof OffscreenCanvas !== "function") fail("LOCAL_DOCUMENT_RENDER_UNAVAILABLE");
  const canvas = new OffscreenCanvas(PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT);
  const context = canvas.getContext("2d");
  if (!context) fail("LOCAL_DOCUMENT_RENDER_UNAVAILABLE");
  context.font = '30px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.textBaseline = "top";
  const wrapped = wrapPdfLines(context, lines);
  const pages = Math.max(1, Math.ceil(wrapped.length / PDF_LINES_PER_PAGE));
  if (pages > PDF_MAX_PAGES) fail("LOCAL_DOCUMENT_LIMIT");

  const target = await waitForAbortable(PDFDocument.create({ updateMetadata: false }), signal);
  const fixedDate = new Date("2000-01-01T00:00:00.000Z");
  target.setCreationDate(fixedDate);
  target.setModificationDate(fixedDate);
  target.setCreator("OpenTrad");
  target.setProducer("OpenTrad local conversion");
  target.setTitle("OpenTrad local document");

  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    checkAbort(signal);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT);
    context.fillStyle = "#10233f";
    const start = pageIndex * PDF_LINES_PER_PAGE;
    for (let lineIndex = 0; lineIndex < PDF_LINES_PER_PAGE; lineIndex += 1) {
      const line = wrapped[start + lineIndex];
      if (line === undefined) break;
      context.fillText(line, PDF_MARGIN, PDF_MARGIN + lineIndex * PDF_LINE_HEIGHT);
    }
    const blob = await waitForAbortable(canvas.convertToBlob({ type: "image/png" }), signal);
    const pngBytes = new Uint8Array(await waitForAbortable(blob.arrayBuffer(), signal));
    const png = await waitForAbortable(target.embedPng(pngBytes), signal);
    const page = target.addPage([595.28, 841.89]);
    page.drawImage(png, { height: 841.89, width: 595.28, x: 0, y: 0 });
  }
  return Uint8Array.from(
    await waitForAbortable(
      target.save({
        addDefaultPage: false,
        updateFieldAppearances: false,
        useObjectStreams: true,
      }),
      signal,
    ),
  );
}

export async function generateDocument(
  bytes: Uint8Array,
  input: TextFormat,
  output: DocumentOutput,
  encoding: LocalTextEncoding,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    if (!isTextFormat(input) || !isDocumentOutput(output)) {
      fail("LOCAL_DOCUMENT_FORMAT_INVALID");
    }
    if (encoding !== "utf-8" && encoding !== "gb18030") {
      fail("LOCAL_DOCUMENT_FORMAT_INVALID");
    }
    const lines = await plainText(bytes, input, encoding, signal);
    return output === "docx" ? await generateDocx(lines, signal) : await generatePdf(lines, signal);
  } catch (error) {
    throw publicError(error, signal);
  }
}

export async function dispatchDocumentGeneration(
  request: LocalConversionRequest,
  signal?: AbortSignal,
): Promise<LocalWorkerOutput> {
  if (
    request.operation !== "document.generate" ||
    !isTextFormat(request.inputFormat) ||
    !isDocumentOutput(request.outputFormat)
  ) {
    fail("LOCAL_OPERATION_NOT_IMPLEMENTED");
  }
  const bytes = await generateDocument(
    request.bytes,
    request.inputFormat,
    request.outputFormat,
    request.options.encoding ?? "utf-8",
    signal,
  );
  return Object.freeze({
    bytes,
    mediaType: request.outputFormat === "docx" ? DOCX_MEDIA : PDF_MEDIA,
  });
}
