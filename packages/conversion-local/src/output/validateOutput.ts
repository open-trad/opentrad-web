import type { FileFormat } from "@opentrad/contracts";
import type { ImageFormat } from "../image/convertImage.js";
import { parseLocalConversionResponse } from "../protocol.js";

const VALIDATED_FORMATS = Object.freeze([
  "txt",
  "md",
  "html",
  "docx",
  "pdf",
  "png",
  "jpg",
  "webp",
  "avif",
] as const);
const VALIDATION_ID = "00000000-0000-4000-8000-000000000001";
const IntrinsicAbortSignal = AbortSignal;
const IntrinsicError = Error;
const IntrinsicTextDecoder = TextDecoder;
const intrinsicCreate = Object.create;
const intrinsicFreeze = Object.freeze;
const intrinsicAbortSignalAborted = Reflect.getOwnPropertyDescriptor(
  IntrinsicAbortSignal.prototype,
  "aborted",
)?.get;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const cancelledSentinel = intrinsicFreeze(intrinsicCreate(null));

type ValidatedFormat = (typeof VALIDATED_FORMATS)[number];

function fail(): never {
  throw new IntrinsicError("LOCAL_RESULT_INVALID");
}

function cancel(): never {
  throw cancelledSentinel;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (!signal) return;
  if (!intrinsicAbortSignalAborted) cancel();
  try {
    if (intrinsicReflectApply(intrinsicAbortSignalAborted, signal, []) === true) cancel();
  } catch (error) {
    if (error === cancelledSentinel) throw error;
    cancel();
  }
}

function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  if (error === cancelledSentinel) return true;
  try {
    if (signal && intrinsicAbortSignalAborted) {
      if (intrinsicReflectApply(intrinsicAbortSignalAborted, signal, []) === true) return true;
    }
    if (error !== null && typeof error === "object") {
      const message = intrinsicReflectGetOwnPropertyDescriptor(error, "message");
      return Boolean(
        message && "value" in message && message.value === "LOCAL_CONVERSION_CANCELLED",
      );
    }
  } catch {
    return true;
  }
  return false;
}

function isValidatedFormat(input: unknown): input is ValidatedFormat {
  if (typeof input !== "string") return false;
  for (let index = 0; index < VALIDATED_FORMATS.length; index += 1) {
    if (VALIDATED_FORMATS[index] === input) return true;
  }
  return false;
}

function mediaType(format: ValidatedFormat): string {
  switch (format) {
    case "txt":
      return "text/plain";
    case "md":
      return "text/markdown";
    case "html":
      return "text/html";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
  }
}

function isImage(format: ValidatedFormat): format is ImageFormat {
  return format === "png" || format === "jpg" || format === "webp" || format === "avif";
}

export async function validateLocalOutput(
  input: unknown,
  format: FileFormat,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    assertNotAborted(signal);
    if (!isValidatedFormat(format)) fail();
    const response = parseLocalConversionResponse({
      bytes: input,
      id: VALIDATION_ID,
      mediaType: mediaType(format),
      ok: true,
    });
    if (!response.ok) fail();
    const bytes = response.bytes;
    if (format === "pdf") {
      const { inspectPdf } = await import("../pdf/pdfjs.js");
      await inspectPdf(bytes, { signal });
    } else if (format === "docx") {
      const { inspectDocx } = await import("../docx/convertDocx.js");
      await inspectDocx(bytes, signal);
    } else if (isImage(format)) {
      const { inspectImageBytes } = await import("../image/convertImage.js");
      inspectImageBytes(bytes, format);
    } else {
      new IntrinsicTextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    assertNotAborted(signal);
    return bytes;
  } catch (error) {
    if (isCancellation(error, signal)) throw new IntrinsicError("LOCAL_CONVERSION_CANCELLED");
    fail();
  }
}
