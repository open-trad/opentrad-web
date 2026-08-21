import { CAPABILITIES } from "@opentrad/contracts";
import { degrees, PDFDocument, type PDFImage, type PDFPage } from "pdf-lib";
import { convertEncodedImage, type ImageFormat, inspectImageBytes } from "../image/convertImage.js";
import type {
  LocalAggregateConversionRequest,
  LocalConversionRequest,
  LocalWorkerRequest,
} from "../protocol.js";
import type { LocalWorkerOutput } from "../worker.js";
import {
  extractPdfText,
  inspectPdf,
  PDF_LIMITS,
  type PdfInspection,
  renderPdfPage,
} from "./pdfjs.js";

const MiB = 1024 * 1024;
const IntrinsicArrayBuffer = ArrayBuffer;
const IntrinsicDate = Date;
const IntrinsicError = Error;
const IntrinsicString = String;
const IntrinsicTextEncoder = TextEncoder;
const IntrinsicUint8Array = Uint8Array;
const intrinsicAbortSignalAborted = Reflect.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)?.get;
const intrinsicArrayBufferByteLength = Reflect.getOwnPropertyDescriptor(
  IntrinsicArrayBuffer.prototype,
  "byteLength",
)?.get;
const intrinsicArrayBufferResizable = Reflect.getOwnPropertyDescriptor(
  IntrinsicArrayBuffer.prototype,
  "resizable",
)?.get;
const intrinsicArrayIsArray = Array.isArray;
const intrinsicArrayPrototype = Array.prototype;
const intrinsicFreeze = Object.freeze;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicNumberMaxSafeInteger = Number.MAX_SAFE_INTEGER;
const intrinsicMathMin = Math.min;
const intrinsicMathSqrt = Math.sqrt;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicTypedArrayPrototype = intrinsicGetPrototypeOf(IntrinsicUint8Array.prototype);
const intrinsicTypedArrayBuffer = intrinsicReflectGetOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "buffer",
)?.get;
const intrinsicTypedArrayByteLength = intrinsicReflectGetOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "byteLength",
)?.get;
const intrinsicTypedArrayByteOffset = intrinsicReflectGetOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "byteOffset",
)?.get;
const intrinsicUint8ArraySet = IntrinsicUint8Array.prototype.set;
const intrinsicTextEncode = IntrinsicTextEncoder.prototype.encode;

function capabilityInvalid(): never {
  throw new IntrinsicError("PDF_CAPABILITY_INVALID");
}

function aggregateCapability(id: "images.to.pdf" | "pdf.organize") {
  let found: (typeof CAPABILITIES)[number] | undefined;
  for (let index = 0; index < CAPABILITIES.length; index += 1) {
    const capability = CAPABILITIES[index];
    if (capability?.id !== id) continue;
    if (found) capabilityInvalid();
    found = capability;
  }
  if (!found || found.execution !== "browser") capabilityInvalid();
  return found;
}

function requiredLimit(value: unknown): number {
  if (!intrinsicNumberIsSafeInteger(value) || (value as number) < 1) capabilityInvalid();
  return value as number;
}

const pdfOrganizeCapability = aggregateCapability("pdf.organize");
const imagesToPdfCapability = aggregateCapability("images.to.pdf");
const pdfMaxInputBytes = requiredLimit(pdfOrganizeCapability.limits.maxInputBytes);
const pdfMaxTotalBytes = requiredLimit(pdfOrganizeCapability.limits.maxTotalBytes);
const pdfMaxFiles = requiredLimit(pdfOrganizeCapability.limits.maxFiles);
const pdfMaxPages = requiredLimit(pdfOrganizeCapability.limits.maxPages);
const imageMaxInputBytes = requiredLimit(imagesToPdfCapability.limits.maxInputBytes);
const imageMaxTotalBytes = requiredLimit(imagesToPdfCapability.limits.maxTotalBytes);
const imageMaxFiles = requiredLimit(imagesToPdfCapability.limits.maxFiles);
if (
  pdfMaxInputBytes !== 25 * MiB ||
  imageMaxInputBytes !== pdfMaxInputBytes ||
  pdfMaxTotalBytes !== 50 * MiB ||
  imageMaxTotalBytes !== pdfMaxTotalBytes ||
  pdfMaxFiles !== 20 ||
  pdfMaxPages !== 200 ||
  imageMaxFiles !== 80
) {
  capabilityInvalid();
}

const mutableLimits = intrinsicObjectCreate(null) as {
  maxImageSources: number;
  maxInputBytes: number;
  maxOutputBytes: number;
  maxPdfSources: number;
  maxPlanPages: number;
  maxTotalBytes: number;
};
mutableLimits.maxImageSources = imageMaxFiles;
mutableLimits.maxInputBytes = pdfMaxInputBytes;
mutableLimits.maxOutputBytes = pdfMaxTotalBytes;
mutableLimits.maxPdfSources = pdfMaxFiles;
mutableLimits.maxPlanPages = pdfMaxPages;
mutableLimits.maxTotalBytes = pdfMaxTotalBytes;

export const PDF_TRANSFORM_LIMITS = intrinsicFreeze(mutableLimits);

export interface PdfPagePlan {
  readonly page: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly source: number;
}

export interface PdfPageOrder {
  readonly page: number;
  readonly rotation: 0 | 90 | 180 | 270;
}

export interface PdfImageSource {
  readonly bytes: Uint8Array;
  readonly format: ImageFormat;
}

type TransformFailureCode =
  | "IMAGE_ALPHA_LIMIT"
  | "IMAGE_CHUNK_LIMIT"
  | "IMAGE_DATA_INVALID"
  | "IMAGE_DECODE_FAILED"
  | "IMAGE_DECODE_MISMATCH"
  | "IMAGE_ENCODE_FAILED"
  | "IMAGE_FORMAT_INVALID"
  | "IMAGE_FORMAT_MISMATCH"
  | "IMAGE_INPUT_TOO_LARGE"
  | "IMAGE_METADATA_LIMIT"
  | "IMAGE_MULTIFRAME_UNSUPPORTED"
  | "IMAGE_OUTPUT_TOO_LARGE"
  | "IMAGE_PIXEL_LIMIT"
  | "LOCAL_CONVERSION_CANCELLED"
  | "LOCAL_OPERATION_NOT_IMPLEMENTED"
  | "PDF_DIMENSION_LIMIT"
  | "PDF_ENCRYPTED"
  | "PDF_FORMAT_INVALID"
  | "PDF_IMAGE_LIMIT"
  | "PDF_INPUT_INVALID"
  | "PDF_INPUT_TOO_LARGE"
  | "PDF_OBJECT_LIMIT"
  | "PDF_OUTPUT_TOO_LARGE"
  | "PDF_PAGE_LIMIT"
  | "PDF_PAGE_OUT_OF_RANGE"
  | "PDF_PLAN_INVALID"
  | "PDF_PLAN_LIMIT"
  | "PDF_ROTATION_INVALID"
  | "PDF_SECURITY_VIOLATION"
  | "PDF_SOURCE_LIMIT"
  | "PDF_TIMEOUT"
  | "PDF_TOTAL_INPUT_TOO_LARGE"
  | "PDF_TRANSFORM_FAILED";

const failureCodes = intrinsicObjectCreate(null) as Record<TransformFailureCode, true>;
for (const code of [
  "IMAGE_ALPHA_LIMIT",
  "IMAGE_CHUNK_LIMIT",
  "IMAGE_DATA_INVALID",
  "IMAGE_DECODE_FAILED",
  "IMAGE_DECODE_MISMATCH",
  "IMAGE_ENCODE_FAILED",
  "IMAGE_FORMAT_INVALID",
  "IMAGE_FORMAT_MISMATCH",
  "IMAGE_INPUT_TOO_LARGE",
  "IMAGE_METADATA_LIMIT",
  "IMAGE_MULTIFRAME_UNSUPPORTED",
  "IMAGE_OUTPUT_TOO_LARGE",
  "IMAGE_PIXEL_LIMIT",
  "LOCAL_CONVERSION_CANCELLED",
  "LOCAL_OPERATION_NOT_IMPLEMENTED",
  "PDF_DIMENSION_LIMIT",
  "PDF_ENCRYPTED",
  "PDF_FORMAT_INVALID",
  "PDF_IMAGE_LIMIT",
  "PDF_INPUT_INVALID",
  "PDF_INPUT_TOO_LARGE",
  "PDF_OBJECT_LIMIT",
  "PDF_OUTPUT_TOO_LARGE",
  "PDF_PAGE_LIMIT",
  "PDF_PAGE_OUT_OF_RANGE",
  "PDF_PLAN_INVALID",
  "PDF_PLAN_LIMIT",
  "PDF_ROTATION_INVALID",
  "PDF_SECURITY_VIOLATION",
  "PDF_SOURCE_LIMIT",
  "PDF_TIMEOUT",
  "PDF_TOTAL_INPUT_TOO_LARGE",
  "PDF_TRANSFORM_FAILED",
] as const) {
  failureCodes[code] = true;
}
intrinsicFreeze(failureCodes);

function failure(code: TransformFailureCode): Error {
  return new IntrinsicError(code);
}

function fixedFailure(error: unknown, fallback: TransformFailureCode): Error {
  if (error !== null && (typeof error === "object" || typeof error === "function")) {
    const descriptor = intrinsicReflectGetOwnPropertyDescriptor(error as object, "message");
    const message = descriptor && "value" in descriptor ? descriptor.value : undefined;
    if (typeof message === "string" && failureCodes[message as TransformFailureCode] === true) {
      return failure(message as TransformFailureCode);
    }
  }
  return failure(fallback);
}

async function boundary<T>(
  work: () => Promise<T>,
  fallback: TransformFailureCode = "PDF_TRANSFORM_FAILED",
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw fixedFailure(error, fallback);
  }
}

function checkAbort(signal?: AbortSignal): void {
  if (!signal) return;
  try {
    if (
      !intrinsicAbortSignalAborted ||
      intrinsicReflectApply(intrinsicAbortSignalAborted, signal, []) === true
    ) {
      throw failure("LOCAL_CONVERSION_CANCELLED");
    }
  } catch (error) {
    throw fixedFailure(error, "LOCAL_CONVERSION_CANCELLED");
  }
}

function byteLength(value: unknown): number {
  if (
    value === null ||
    typeof value !== "object" ||
    intrinsicGetPrototypeOf(value) !== IntrinsicUint8Array.prototype ||
    !intrinsicTypedArrayByteLength ||
    !intrinsicTypedArrayByteOffset ||
    !intrinsicTypedArrayBuffer ||
    !intrinsicArrayBufferByteLength
  ) {
    throw failure("PDF_INPUT_INVALID");
  }
  const length = intrinsicReflectApply(intrinsicTypedArrayByteLength, value, []) as number;
  const offset = intrinsicReflectApply(intrinsicTypedArrayByteOffset, value, []) as number;
  const buffer = intrinsicReflectApply(intrinsicTypedArrayBuffer, value, []) as unknown;
  if (
    !intrinsicNumberIsSafeInteger(length) ||
    length < 1 ||
    offset !== 0 ||
    buffer === null ||
    typeof buffer !== "object" ||
    intrinsicGetPrototypeOf(buffer) !== IntrinsicArrayBuffer.prototype ||
    intrinsicReflectApply(intrinsicArrayBufferByteLength, buffer, []) !== length ||
    (intrinsicArrayBufferResizable &&
      intrinsicReflectApply(intrinsicArrayBufferResizable, buffer, []) === true)
  ) {
    throw failure("PDF_INPUT_INVALID");
  }
  return length;
}

function copyAggregate(
  inputs: readonly Uint8Array[],
  kind: "image" | "pdf",
): Uint8Array<ArrayBuffer>[] {
  const maxSources =
    kind === "image" ? PDF_TRANSFORM_LIMITS.maxImageSources : PDF_TRANSFORM_LIMITS.maxPdfSources;
  const source = exactDenseArray(
    inputs,
    maxSources,
    kind === "image" ? "PDF_IMAGE_LIMIT" : "PDF_SOURCE_LIMIT",
  );
  const lengths: number[] = [];
  let total = 0;
  for (let index = 0; index < source.length; index += 1) {
    const length = byteLength(denseValue(source, index));
    if (length > PDF_TRANSFORM_LIMITS.maxInputBytes) throw failure("PDF_INPUT_TOO_LARGE");
    total += length;
    if (!intrinsicNumberIsSafeInteger(total) || total > PDF_TRANSFORM_LIMITS.maxTotalBytes) {
      throw failure("PDF_TOTAL_INPUT_TOO_LARGE");
    }
    lengths[index] = length;
  }
  const copies: Uint8Array<ArrayBuffer>[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const copy = new IntrinsicUint8Array(lengths[index] as number);
    intrinsicReflectApply(intrinsicUint8ArraySet, copy, [denseValue(source, index)]);
    copies[index] = copy;
  }
  return copies;
}

function ownValue(input: object, key: string): unknown {
  const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, key);
  if (!descriptor || !("value" in descriptor)) throw failure("PDF_PLAN_INVALID");
  return descriptor.value;
}

function exactDenseArray(
  input: unknown,
  maximum: number,
  limitCode: "PDF_IMAGE_LIMIT" | "PDF_PLAN_LIMIT" | "PDF_SOURCE_LIMIT",
): readonly unknown[] {
  if (!intrinsicArrayIsArray(input) || intrinsicGetPrototypeOf(input) !== intrinsicArrayPrototype) {
    throw failure("PDF_PLAN_INVALID");
  }
  const lengthDescriptor = intrinsicReflectGetOwnPropertyDescriptor(input, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor)) throw failure("PDF_PLAN_INVALID");
  const rawLength = lengthDescriptor.value;
  if (!intrinsicNumberIsSafeInteger(rawLength)) throw failure("PDF_PLAN_INVALID");
  const length = rawLength as number;
  if (length < 1 || length > maximum) throw failure(limitCode);
  const keys = intrinsicReflectOwnKeys(input);
  if (keys.length !== length + 1) throw failure("PDF_PLAN_INVALID");
  for (let index = 0; index < length; index += 1) denseValue(input, index);
  return input;
}

function denseValue(input: readonly unknown[], index: number): unknown {
  const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, IntrinsicString(index));
  if (!descriptor || !("value" in descriptor)) throw failure("PDF_PLAN_INVALID");
  return descriptor.value;
}

function exactRecord(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object") throw failure("PDF_PLAN_INVALID");
  const prototype = intrinsicGetPrototypeOf(input);
  if (prototype !== intrinsicObjectPrototype && prototype !== null) {
    throw failure("PDF_PLAN_INVALID");
  }
  const keys = intrinsicReflectOwnKeys(input);
  if (keys.length !== allowed.length) throw failure("PDF_PLAN_INVALID");
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") throw failure("PDF_PLAN_INVALID");
    let accepted = false;
    for (let allowedIndex = 0; allowedIndex < allowed.length; allowedIndex += 1) {
      if (key === allowed[allowedIndex]) accepted = true;
    }
    if (!accepted) throw failure("PDF_PLAN_INVALID");
    ownValue(input, key);
  }
  return input as Record<string, unknown>;
}

function planItems(input: readonly PdfPagePlan[]): PdfPagePlan[] {
  const rawPlan = exactDenseArray(input, PDF_TRANSFORM_LIMITS.maxPlanPages, "PDF_PLAN_LIMIT");
  const output: PdfPagePlan[] = [];
  for (let index = 0; index < rawPlan.length; index += 1) {
    const item = exactRecord(denseValue(rawPlan, index), ["page", "rotation", "source"]);
    const page = ownValue(item, "page");
    const rotation = ownValue(item, "rotation");
    const sourceIndex = ownValue(item, "source");
    if (
      !intrinsicNumberIsSafeInteger(page) ||
      (page as number) < 0 ||
      !intrinsicNumberIsSafeInteger(sourceIndex) ||
      (sourceIndex as number) < 0
    ) {
      throw failure("PDF_PAGE_OUT_OF_RANGE");
    }
    if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) {
      throw failure("PDF_ROTATION_INVALID");
    }
    const safe = intrinsicObjectCreate(null) as {
      page: number;
      rotation: 0 | 90 | 180 | 270;
      source: number;
    };
    safe.page = page as number;
    safe.rotation = rotation;
    safe.source = sourceIndex as number;
    output[index] = intrinsicFreeze(safe);
  }
  return output;
}

function validatePlanBounds(
  plan: readonly PdfPagePlan[],
  inspections: readonly PdfInspection[],
): void {
  for (let index = 0; index < plan.length; index += 1) {
    const item = plan[index] as PdfPagePlan;
    const inspection = inspections[item.source];
    if (!inspection || item.page >= inspection.pageCount) {
      throw failure("PDF_PAGE_OUT_OF_RANGE");
    }
  }
}

async function inspectSources(
  sources: readonly Uint8Array<ArrayBuffer>[],
  signal?: AbortSignal,
): Promise<PdfInspection[]> {
  const inspections: PdfInspection[] = [];
  for (let index = 0; index < sources.length; index += 1) {
    checkAbort(signal);
    inspections[index] = await inspectPdf(sources[index] as Uint8Array<ArrayBuffer>, { signal });
  }
  return inspections;
}

async function loadSources(
  sources: readonly Uint8Array<ArrayBuffer>[],
  signal?: AbortSignal,
): Promise<PDFDocument[]> {
  const loaded: PDFDocument[] = [];
  for (let index = 0; index < sources.length; index += 1) {
    checkAbort(signal);
    loaded[index] = await PDFDocument.load(sources[index] as Uint8Array<ArrayBuffer>, {
      capNumbers: true,
      ignoreEncryption: false,
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
    checkAbort(signal);
  }
  return loaded;
}

function configureDeterministicMetadata(document: PDFDocument): void {
  const epoch = new IntrinsicDate(0);
  document.setProducer("OpenTrad local PDF tools");
  document.setCreator("OpenTrad local PDF tools");
  document.setTitle("OpenTrad local PDF");
  document.setSubject("Locally transformed trade document");
  document.setKeywords(["OpenTrad", "local"]);
  document.setCreationDate(epoch);
  document.setModificationDate(epoch);
}

async function saveChecked(document: PDFDocument): Promise<Uint8Array<ArrayBuffer>> {
  const output = await document.save({
    addDefaultPage: false,
    objectsPerTick: intrinsicNumberMaxSafeInteger,
    updateFieldAppearances: false,
    useObjectStreams: true,
  });
  if (output.byteLength > PDF_TRANSFORM_LIMITS.maxOutputBytes) {
    throw failure("PDF_OUTPUT_TOO_LARGE");
  }
  const copy = new IntrinsicUint8Array(output.byteLength);
  intrinsicReflectApply(intrinsicUint8ArraySet, copy, [output]);
  return copy;
}

async function buildDocument(
  loaded: readonly PDFDocument[],
  plan: readonly PdfPagePlan[],
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  checkAbort(signal);
  const target = await PDFDocument.create({ updateMetadata: false });
  configureDeterministicMetadata(target);
  for (let index = 0; index < plan.length; index += 1) {
    checkAbort(signal);
    const item = plan[index] as PdfPagePlan;
    const source = loaded[item.source];
    if (!source) throw failure("PDF_PAGE_OUT_OF_RANGE");
    const copied = await target.copyPages(source, [item.page]);
    checkAbort(signal);
    const page = copied[0];
    if (!page) throw failure("PDF_TRANSFORM_FAILED");
    page.setRotation(degrees(item.rotation));
    target.addPage(page);
  }
  checkAbort(signal);
  return saveChecked(target);
}

async function organizePrepared(
  sources: readonly Uint8Array<ArrayBuffer>[],
  plan: readonly PdfPagePlan[],
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const inspections = await inspectSources(sources, signal);
  validatePlanBounds(plan, inspections);
  const loaded = await loadSources(sources, signal);
  return buildDocument(loaded, plan, signal);
}

export async function organizePdf(
  sources: readonly Uint8Array[],
  plan: readonly PdfPagePlan[],
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  return boundary(async () => {
    checkAbort(signal);
    const copiedSources = copyAggregate(sources, "pdf");
    const safePlan = planItems(plan);
    return organizePrepared(copiedSources, safePlan, signal);
  });
}

export async function mergePdfs(
  sources: readonly Uint8Array[],
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  return boundary(async () => {
    checkAbort(signal);
    const copiedSources = copyAggregate(sources, "pdf");
    const inspections = await inspectSources(copiedSources, signal);
    let pageCount = 0;
    const plan: PdfPagePlan[] = [];
    for (let source = 0; source < inspections.length; source += 1) {
      const inspection = inspections[source] as PdfInspection;
      pageCount += inspection.pageCount;
      if (pageCount > PDF_TRANSFORM_LIMITS.maxPlanPages) throw failure("PDF_PLAN_LIMIT");
      for (let page = 0; page < inspection.pageCount; page += 1) {
        const rotation = inspection.pages[page]?.rotation;
        if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) {
          throw failure("PDF_ROTATION_INVALID");
        }
        plan[plan.length] = { page, rotation, source };
      }
    }
    const loaded = await loadSources(copiedSources, signal);
    return buildDocument(loaded, plan, signal);
  });
}

function splitGroups(input: readonly (readonly number[])[]): readonly (readonly number[])[] {
  const groups = exactDenseArray(input, PDF_TRANSFORM_LIMITS.maxPlanPages, "PDF_PLAN_LIMIT");
  let total = 0;
  const output: number[][] = [];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = exactDenseArray(
      denseValue(groups, groupIndex),
      PDF_TRANSFORM_LIMITS.maxPlanPages,
      "PDF_PLAN_LIMIT",
    );
    total += group.length;
    if (total > PDF_TRANSFORM_LIMITS.maxPlanPages) throw failure("PDF_PLAN_LIMIT");
    const safe: number[] = [];
    for (let pageIndex = 0; pageIndex < group.length; pageIndex += 1) {
      const page = denseValue(group, pageIndex);
      if (!intrinsicNumberIsSafeInteger(page) || (page as number) < 0) {
        throw failure("PDF_PAGE_OUT_OF_RANGE");
      }
      safe[pageIndex] = page as number;
    }
    output[groupIndex] = safe;
  }
  return output;
}

export async function splitPdf(
  source: Uint8Array,
  groups: readonly (readonly number[])[],
  signal?: AbortSignal,
): Promise<readonly Uint8Array<ArrayBuffer>[]> {
  return boundary(async () => {
    checkAbort(signal);
    const copied = copyAggregate([source], "pdf")[0] as Uint8Array<ArrayBuffer>;
    const safeGroups = splitGroups(groups);
    const inspection = (await inspectSources([copied], signal))[0] as PdfInspection;
    for (let groupIndex = 0; groupIndex < safeGroups.length; groupIndex += 1) {
      const group = safeGroups[groupIndex] as readonly number[];
      for (let pageIndex = 0; pageIndex < group.length; pageIndex += 1) {
        const page = group[pageIndex] as number;
        if (page >= inspection.pageCount) throw failure("PDF_PAGE_OUT_OF_RANGE");
      }
    }
    const loaded = await loadSources([copied], signal);
    const outputs: Uint8Array<ArrayBuffer>[] = [];
    let totalOutput = 0;
    for (let groupIndex = 0; groupIndex < safeGroups.length; groupIndex += 1) {
      const group = safeGroups[groupIndex] as readonly number[];
      const plan: PdfPagePlan[] = [];
      for (let pageIndex = 0; pageIndex < group.length; pageIndex += 1) {
        const page = group[pageIndex] as number;
        const rotation = inspection.pages[page]?.rotation;
        if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) {
          throw failure("PDF_ROTATION_INVALID");
        }
        plan[pageIndex] = { page, rotation, source: 0 };
      }
      const output = await buildDocument(loaded, plan, signal);
      totalOutput += output.byteLength;
      if (totalOutput > PDF_TRANSFORM_LIMITS.maxOutputBytes) {
        throw failure("PDF_OUTPUT_TOO_LARGE");
      }
      outputs[groupIndex] = output;
    }
    return intrinsicFreeze(outputs);
  });
}

export async function reorderPdf(
  source: Uint8Array,
  order: readonly PdfPageOrder[],
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  return boundary(async () => {
    const sourceOrder = exactDenseArray(order, PDF_TRANSFORM_LIMITS.maxPlanPages, "PDF_PLAN_LIMIT");
    const plan: PdfPagePlan[] = [];
    for (let index = 0; index < sourceOrder.length; index += 1) {
      const item = exactRecord(denseValue(sourceOrder, index), ["page", "rotation"]);
      const page = ownValue(item, "page");
      const rotation = ownValue(item, "rotation");
      plan[index] = { page: page as number, rotation: rotation as 0, source: 0 };
    }
    return organizePdf([source], plan, signal);
  });
}

interface SafeImageSource {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly format: ImageFormat;
}

function imageSources(input: readonly PdfImageSource[]): SafeImageSource[] {
  const source = exactDenseArray(input, PDF_TRANSFORM_LIMITS.maxImageSources, "PDF_IMAGE_LIMIT");
  const rawBytes: Uint8Array[] = [];
  const formats: ImageFormat[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const item = exactRecord(denseValue(source, index), ["bytes", "format"]);
    const bytes = ownValue(item, "bytes");
    const format = ownValue(item, "format");
    if (format !== "png" && format !== "jpg" && format !== "webp" && format !== "avif") {
      throw failure("IMAGE_FORMAT_INVALID");
    }
    rawBytes[index] = bytes as Uint8Array;
    formats[index] = format;
  }
  const copies = copyAggregate(rawBytes, "image");
  const output: SafeImageSource[] = [];
  for (let index = 0; index < copies.length; index += 1) {
    output[index] = {
      bytes: copies[index] as Uint8Array<ArrayBuffer>,
      format: formats[index] as ImageFormat,
    };
  }
  return output;
}

function safePageSize(width: number, height: number): { height: number; width: number } {
  const dimensionScale = intrinsicReflectApply(intrinsicMathMin, undefined, [
    1,
    PDF_LIMITS.maxPageDimension / width,
    PDF_LIMITS.maxPageDimension / height,
  ]) as number;
  const areaScale = intrinsicReflectApply(intrinsicMathMin, undefined, [
    1,
    intrinsicReflectApply(intrinsicMathSqrt, undefined, [
      PDF_LIMITS.maxPageArea / (width * height),
    ]),
  ]) as number;
  const scale = intrinsicReflectApply(intrinsicMathMin, undefined, [
    dimensionScale,
    areaScale,
  ]) as number;
  return { height: height * scale, width: width * scale };
}

async function embedImage(
  target: PDFDocument,
  source: SafeImageSource,
  signal?: AbortSignal,
): Promise<{ image: PDFImage; page: PDFPage }> {
  checkAbort(signal);
  const inspection = inspectImageBytes(source.bytes, source.format);
  let bytes = source.bytes;
  let format = source.format;
  if (format === "webp" || format === "avif") {
    bytes = await convertEncodedImage(bytes, format, "png", 80, signal);
    format = "png";
  }
  checkAbort(signal);
  const image = format === "jpg" ? await target.embedJpg(bytes) : await target.embedPng(bytes);
  checkAbort(signal);
  const size = safePageSize(inspection.width, inspection.height);
  const page = target.addPage([size.width, size.height]);
  page.drawImage(image, { height: size.height, width: size.width, x: 0, y: 0 });
  return { image, page };
}

export async function imagesToPdf(
  sources: readonly PdfImageSource[],
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  return boundary(async () => {
    checkAbort(signal);
    const copiedSources = imageSources(sources);
    const target = await PDFDocument.create({ updateMetadata: false });
    configureDeterministicMetadata(target);
    for (let index = 0; index < copiedSources.length; index += 1) {
      await embedImage(target, copiedSources[index] as SafeImageSource, signal);
    }
    checkAbort(signal);
    return saveChecked(target);
  });
}

function workerOutput(bytes: Uint8Array<ArrayBuffer>, mediaType: string): LocalWorkerOutput {
  const output = intrinsicObjectCreate(null) as { bytes: Uint8Array; mediaType: string };
  output.bytes = bytes;
  output.mediaType = mediaType;
  return intrinsicFreeze(output);
}

function isAggregateRequest(
  request: LocalWorkerRequest,
): request is LocalAggregateConversionRequest {
  return "kind" in request && request.kind === "aggregate";
}

async function dispatchAggregate(
  request: LocalAggregateConversionRequest,
  signal?: AbortSignal,
): Promise<LocalWorkerOutput> {
  if (request.operation === "pdf.organize") {
    const plan = request.options.pagePlan;
    if (!plan) throw failure("PDF_PLAN_INVALID");
    const sources: Uint8Array<ArrayBuffer>[] = [];
    for (let index = 0; index < request.files.length; index += 1) {
      const file = request.files[index];
      if (!file || file.inputFormat !== "pdf") throw failure("PDF_INPUT_INVALID");
      sources[index] = file.bytes;
    }
    const bytes = await organizePdf(sources, plan, signal);
    return workerOutput(bytes, "application/pdf");
  }
  if (request.operation === "images.to.pdf") {
    const sources: PdfImageSource[] = [];
    for (let index = 0; index < request.files.length; index += 1) {
      const file = request.files[index];
      if (!file) throw failure("PDF_INPUT_INVALID");
      const format = file.inputFormat;
      if (format !== "png" && format !== "jpg" && format !== "webp" && format !== "avif") {
        throw failure("IMAGE_FORMAT_INVALID");
      }
      sources[index] = { bytes: file.bytes, format };
    }
    const bytes = await imagesToPdf(sources, signal);
    return workerOutput(bytes, "application/pdf");
  }
  throw new IntrinsicError("LOCAL_OPERATION_NOT_IMPLEMENTED");
}

async function dispatchSingle(
  request: LocalConversionRequest,
  signal?: AbortSignal,
): Promise<LocalWorkerOutput> {
  if (request.operation !== "pdf.inspect") {
    throw new IntrinsicError("LOCAL_OPERATION_NOT_IMPLEMENTED");
  }
  if (request.inputFormat !== "pdf") throw failure("PDF_INPUT_INVALID");
  if (request.outputFormat === "txt") {
    const extracted = await extractPdfText(request.bytes, { signal });
    const bytes = intrinsicReflectApply(intrinsicTextEncode, new IntrinsicTextEncoder(), [
      extracted.text,
    ]) as Uint8Array<ArrayBuffer>;
    return workerOutput(bytes, "text/plain");
  }
  if (request.outputFormat !== "png" && request.outputFormat !== "jpg") {
    throw new IntrinsicError("LOCAL_OPERATION_NOT_IMPLEMENTED");
  }
  const pageNumber = request.options.pageNumber;
  if (!intrinsicNumberIsSafeInteger(pageNumber) || (pageNumber as number) < 1) {
    throw failure("PDF_PAGE_OUT_OF_RANGE");
  }
  const format = request.outputFormat;
  const bytes = await renderPdfPage(request.bytes, {
    format,
    pageNumber: pageNumber as number,
    ...(format === "jpg" && request.options.quality !== undefined
      ? { quality: request.options.quality }
      : {}),
    ...(request.options.scale !== undefined ? { scale: request.options.scale } : {}),
    signal,
  });
  return workerOutput(bytes, format === "png" ? "image/png" : "image/jpeg");
}

export async function dispatchPdfConversion(
  request: LocalWorkerRequest,
  signal?: AbortSignal,
): Promise<LocalWorkerOutput> {
  return boundary(async () =>
    isAggregateRequest(request)
      ? dispatchAggregate(request, signal)
      : dispatchSingle(request, signal),
  );
}
