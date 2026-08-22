import { isProxy } from "node:util/types";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import { copyExactUint8Array } from "../policies/bidArchive.js";

const MiB = 1024 * 1024;
const MAX_INPUT_BYTES = 25 * MiB;
const MAX_PAGE_COUNT = 10_000;
const MAX_DIMENSION = 16_384;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_ALPHA_PIXELS = 20_000_000;
const MAX_CHUNKS = 10_000;
const MAX_EXIF_BYTES = MiB;
const MAX_ICC_BYTES = 4 * MiB;
const MAX_GRAPH_DEPTH = 32;
const MAX_GRAPH_VALUES = 10_000;
const DEFAULT_TIMEOUT_MS = 10_000;

const intrinsicAbortAdd = AbortSignal.prototype.addEventListener;
const intrinsicAbortRemove = AbortSignal.prototype.removeEventListener;
const intrinsicAbortGetter = Reflect.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)?.get;
const intrinsicClearTimeout = clearTimeout;
const intrinsicDateNow = Date.now;
const intrinsicArrayIsArray = Array.isArray;
const intrinsicNumberIsFinite = Number.isFinite;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicObjectGetPrototypeOf = Object.getPrototypeOf;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicSetTimeout = setTimeout;
const intrinsicStringToLowerCase = String.prototype.toLowerCase;

type BidAttachmentMediaType = "application/pdf" | "image/png" | "image/jpeg";

export class BidAttachmentInspectionError extends Error {
  readonly code = "ATTACHMENT_INVALID" as const;

  constructor() {
    super("ATTACHMENT_INVALID");
    this.name = "BidAttachmentInspectionError";
  }
}

function invalid(): never {
  throw new BidAttachmentInspectionError();
}

function now(): number {
  const value = intrinsicReflectApply(intrinsicDateNow, undefined, []) as number;
  if (!intrinsicNumberIsFinite(value) || !intrinsicNumberIsSafeInteger(value) || value < 0) {
    invalid();
  }
  return value;
}

function aborted(signal: AbortSignal | undefined): boolean {
  if (!signal) return false;
  if (!intrinsicAbortGetter) invalid();
  try {
    return intrinsicReflectApply(intrinsicAbortGetter, signal, []) as boolean;
  } catch {
    return invalid();
  }
}

function checkBoundary(
  mediaType: unknown,
  maximumPages: unknown,
  absoluteDeadline: unknown,
  signal: AbortSignal | undefined,
): asserts mediaType is BidAttachmentMediaType {
  if (
    (mediaType !== "application/pdf" && mediaType !== "image/png" && mediaType !== "image/jpeg") ||
    !intrinsicNumberIsSafeInteger(maximumPages) ||
    (maximumPages as number) < 1 ||
    (maximumPages as number) > MAX_PAGE_COUNT ||
    !intrinsicNumberIsSafeInteger(absoluteDeadline) ||
    (absoluteDeadline as number) <= now() ||
    aborted(signal)
  ) {
    invalid();
  }
}

async function bounded<T>(
  promise: Promise<T>,
  deadline: number,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (aborted(signal)) invalid();
  const remaining = deadline - now();
  if (!intrinsicNumberIsSafeInteger(remaining) || remaining < 1 || remaining > DEFAULT_TIMEOUT_MS) {
    invalid();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let listener: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = intrinsicSetTimeout(() => reject(new BidAttachmentInspectionError()), remaining);
        if (signal) {
          listener = () => reject(new BidAttachmentInspectionError());
          intrinsicReflectApply(intrinsicAbortAdd, signal, ["abort", listener, { once: true }]);
        }
      }),
    ]);
  } finally {
    if (timer) intrinsicClearTimeout(timer);
    if (signal && listener) {
      intrinsicReflectApply(intrinsicAbortRemove, signal, ["abort", listener]);
    }
  }
}

function u16be(bytes: Uint8Array, offset: number): number {
  const high = bytes[offset];
  const low = bytes[offset + 1];
  if (high === undefined || low === undefined) invalid();
  return high * 256 + low;
}

function u32be(bytes: Uint8Array, offset: number): number {
  const a = bytes[offset];
  const b = bytes[offset + 1];
  const c = bytes[offset + 2];
  const d = bytes[offset + 3];
  if (a === undefined || b === undefined || c === undefined || d === undefined) invalid();
  return (((a * 256 + b) * 256 + c) * 256 + d) >>> 0;
}

function asciiAt(bytes: Uint8Array, offset: number, value: string): boolean {
  if (offset < 0 || offset + value.length > bytes.byteLength) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc ^= bytes[offset] ?? 0;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validateDimensions(width: number, height: number, hasAlpha: boolean): void {
  if (
    !intrinsicNumberIsSafeInteger(width) ||
    !intrinsicNumberIsSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION
  ) {
    invalid();
  }
  const pixels = width * height;
  if (!intrinsicNumberIsSafeInteger(pixels) || pixels > MAX_IMAGE_PIXELS) invalid();
  if (hasAlpha && pixels > MAX_ALPHA_PIXELS) invalid();
}

function validatePdfDimensions(width: number, height: number): void {
  if (
    !intrinsicNumberIsFinite(width) ||
    !intrinsicNumberIsFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 14_400 ||
    height > 14_400 ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    invalid();
  }
}

function inspectPng(bytes: Uint8Array): void {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.byteLength < 45 || signature.some((value, index) => bytes[index] !== value)) invalid();
  let offset = 8;
  let chunks = 0;
  let sawIhdr = false;
  let sawIdat = false;
  let sawIend = false;
  let width = 0;
  let height = 0;
  let hasAlpha = false;
  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) invalid();
    const length = u32be(bytes, offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (!intrinsicNumberIsSafeInteger(chunkEnd) || chunkEnd > bytes.byteLength) invalid();
    chunks += 1;
    if (chunks > MAX_CHUNKS) invalid();
    const typeStart = offset + 4;
    const type = String.fromCharCode(
      bytes[typeStart] ?? 0,
      bytes[typeStart + 1] ?? 0,
      bytes[typeStart + 2] ?? 0,
      bytes[typeStart + 3] ?? 0,
    );
    if (crc32(bytes, typeStart, dataEnd) !== u32be(bytes, dataEnd)) invalid();
    if (type === "IHDR") {
      if (sawIhdr || chunks !== 1 || length !== 13) invalid();
      sawIhdr = true;
      width = u32be(bytes, dataStart);
      height = u32be(bytes, dataStart + 4);
      const bitDepth = bytes[dataStart + 8] ?? 0;
      const colorType = bytes[dataStart + 9] ?? 0;
      const validDepth =
        (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth)) ||
        (colorType === 2 && [8, 16].includes(bitDepth)) ||
        (colorType === 3 && [1, 2, 4, 8].includes(bitDepth)) ||
        ((colorType === 4 || colorType === 6) && [8, 16].includes(bitDepth));
      if (
        !validDepth ||
        bytes[dataStart + 10] !== 0 ||
        bytes[dataStart + 11] !== 0 ||
        ![0, 1].includes(bytes[dataStart + 12] ?? -1)
      ) {
        invalid();
      }
      hasAlpha = colorType === 4 || colorType === 6;
    } else if (!sawIhdr || sawIend) {
      invalid();
    } else if (type === "IDAT") {
      if (length < 1) invalid();
      sawIdat = true;
    } else if (type === "IEND") {
      if (!sawIdat || length !== 0 || chunkEnd !== bytes.byteLength) invalid();
      sawIend = true;
    } else if (type === "tRNS") {
      hasAlpha = true;
    } else if (["acTL", "fcTL", "fdAT", "iCCP", "eXIf"].includes(type)) {
      invalid();
    } else if ((bytes[typeStart] ?? 0) >= 0x41 && (bytes[typeStart] ?? 0) <= 0x5a) {
      if (type !== "PLTE") invalid();
    } else if (length > 64 * 1024) {
      invalid();
    }
    offset = chunkEnd;
  }
  if (!sawIhdr || !sawIdat || !sawIend) invalid();
  validateDimensions(width, height, hasAlpha);
}

function isSof(marker: number): boolean {
  return [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
    marker,
  );
}

function inspectJpeg(bytes: Uint8Array): { readonly height: number; readonly width: number } {
  if (bytes.byteLength < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8) invalid();
  let offset = 2;
  let chunks = 0;
  let sawSof = false;
  let sawScan = false;
  let sawEoi = false;
  let width = 0;
  let height = 0;
  let exifBytes = 0;
  let iccBytes = 0;
  while (offset < bytes.byteLength) {
    if (bytes[offset] !== 0xff) invalid();
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    if (marker === undefined || marker === 0x00 || marker === 0xd8) invalid();
    offset += 1;
    if (marker === 0xd9) {
      sawEoi = true;
      if (offset !== bytes.byteLength) invalid();
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) invalid();
    if (offset + 2 > bytes.byteLength) invalid();
    const segmentLength = u16be(bytes, offset);
    if (segmentLength < 2) invalid();
    const dataStart = offset + 2;
    const dataEnd = offset + segmentLength;
    if (dataEnd > bytes.byteLength) invalid();
    chunks += 1;
    if (chunks > MAX_CHUNKS) invalid();
    if (isSof(marker)) {
      if (sawSof || (marker !== 0xc0 && marker !== 0xc2) || segmentLength < 8) invalid();
      sawSof = true;
      if (bytes[dataStart] !== 8) invalid();
      height = u16be(bytes, dataStart + 1);
      width = u16be(bytes, dataStart + 3);
    } else if (marker === 0xe1 && asciiAt(bytes, dataStart, "Exif\0\0")) {
      exifBytes += dataEnd - dataStart;
    } else if (marker === 0xe2 && asciiAt(bytes, dataStart, "MPF\0")) {
      invalid();
    } else if (marker === 0xe2 && asciiAt(bytes, dataStart, "ICC_PROFILE\0")) {
      iccBytes += dataEnd - dataStart;
    }
    if (exifBytes > MAX_EXIF_BYTES || iccBytes > MAX_ICC_BYTES) invalid();
    if (marker === 0xda) {
      if (!sawSof) invalid();
      sawScan = true;
      offset = dataEnd;
      while (offset < bytes.byteLength) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        let next = offset + 1;
        while (bytes[next] === 0xff) next += 1;
        const entropyMarker = bytes[next];
        if (entropyMarker === undefined) invalid();
        if (entropyMarker === 0x00 || (entropyMarker >= 0xd0 && entropyMarker <= 0xd7)) {
          offset = next + 1;
          continue;
        }
        break;
      }
    } else {
      offset = dataEnd;
    }
  }
  if (!sawSof || !sawScan || !sawEoi) invalid();
  validateDimensions(width, height, false);
  return { height, width };
}

function nonEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "object") {
    if (isProxy(value)) invalid();
    if (intrinsicArrayIsArray(value)) return value.length > 0;
    return intrinsicReflectOwnKeys(value).length > 0;
  }
  return true;
}

function inspectActiveGraph(
  value: unknown,
  depth = 0,
  budget: { value: number } = { value: 0 },
): void {
  if (value === null || value === undefined) return;
  if (depth > MAX_GRAPH_DEPTH || budget.value > MAX_GRAPH_VALUES) invalid();
  if (typeof value !== "object") return;
  if (isProxy(value)) invalid();
  if (intrinsicArrayIsArray(value)) {
    const keys = intrinsicReflectOwnKeys(value);
    if (keys.length !== value.length + 1 || keys[value.length] !== "length") invalid();
    for (let index = 0; index < value.length; index += 1) {
      const key = `${index}`;
      if (keys[index] !== key) invalid();
      const descriptor = intrinsicReflectGetOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) invalid();
      budget.value += 1;
      inspectActiveGraph(descriptor.value, depth + 1, budget);
    }
    return;
  }
  const prototype = intrinsicObjectGetPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  for (const key of intrinsicReflectOwnKeys(value)) {
    if (typeof key !== "string") invalid();
    const descriptor = intrinsicReflectGetOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) invalid();
    const lowered = intrinsicReflectApply(intrinsicStringToLowerCase, key, []) as string;
    if (
      ["action", "attachment", "file", "jsactions", "unsafeurl", "url"].includes(lowered) &&
      nonEmpty(descriptor.value)
    ) {
      invalid();
    }
    budget.value += 1;
    inspectActiveGraph(descriptor.value, depth + 1, budget);
  }
}

/** Test-only hostile PDF graph seam. Deliberately omitted from the package barrel. */
export function inspectBidActiveGraphForTesting(input: unknown): void {
  try {
    inspectActiveGraph(input);
  } catch {
    throw new BidAttachmentInspectionError();
  }
}

async function inspectPdf(
  bytes: Uint8Array,
  maximumPages: number,
  deadline: number,
  signal: AbortSignal | undefined,
): Promise<number> {
  const task = getDocument({
    data: bytes,
    disableAutoFetch: true,
    disableFontFace: true,
    disableRange: true,
    disableStream: true,
    enableScripting: false,
    enableXfa: false,
    isEvalSupported: false,
    stopAtErrors: true,
    useSystemFonts: false,
    useWasm: false,
    useWorkerFetch: false,
    verbosity: VerbosityLevel.ERRORS,
  } as unknown as Parameters<typeof getDocument>[0]);
  let document: Awaited<typeof task.promise> | undefined;
  try {
    document = await bounded(task.promise, deadline, signal);
    const pageCount = document.numPages;
    if (!intrinsicNumberIsSafeInteger(pageCount) || pageCount < 1 || pageCount > maximumPages) {
      invalid();
    }
    let isPureXfa: unknown;
    let allXfaHtml: unknown;
    try {
      isPureXfa = document.isPureXfa;
      allXfaHtml = document.allXfaHtml;
    } catch {
      return invalid();
    }
    if (isPureXfa === true || nonEmpty(allXfaHtml)) invalid();
    const [attachments, scripts, openAction, outline] = await Promise.all([
      bounded(document.getAttachments(), deadline, signal),
      bounded(document.getJSActions(), deadline, signal),
      bounded(document.getOpenAction(), deadline, signal),
      bounded(document.getOutline(), deadline, signal),
    ]);
    if (nonEmpty(attachments) || nonEmpty(scripts) || nonEmpty(openAction)) invalid();
    inspectActiveGraph(outline);
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await bounded(document.getPage(pageNumber), deadline, signal);
      try {
        const view = page.view;
        if (!Array.isArray(view) || view.length !== 4) invalid();
        const width = Math.abs(Number(view[2]) - Number(view[0]));
        const height = Math.abs(Number(view[3]) - Number(view[1]));
        validatePdfDimensions(width, height);
        const [pageScripts, pageXfa, annotations] = await Promise.all([
          bounded(page.getJSActions(), deadline, signal),
          bounded(page.getXfa(), deadline, signal),
          bounded(page.getAnnotations({ intent: "display" }), deadline, signal),
        ]);
        if (nonEmpty(pageScripts) || nonEmpty(pageXfa)) invalid();
        inspectActiveGraph(annotations);
      } finally {
        page.cleanup();
      }
    }
    return pageCount;
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

export function inspectBidRasterJpegBytes(
  input: unknown,
): Readonly<{ readonly heightPixels: number; readonly widthPixels: number }> {
  try {
    const bytes = copyExactUint8Array(input, MAX_INPUT_BYTES);
    const dimensions = inspectJpeg(bytes);
    return Object.freeze(
      Object.assign(Object.create(null), {
        heightPixels: dimensions.height,
        widthPixels: dimensions.width,
      }),
    );
  } catch {
    throw new BidAttachmentInspectionError();
  }
}

export async function inspectBidAttachmentBytes(
  input: unknown,
  mediaTypeInput: unknown,
  maximumPagesInput: unknown,
  signal?: AbortSignal,
  absoluteDeadlineInput?: number,
): Promise<Readonly<{ readonly pageCount: number }>> {
  try {
    const current = now();
    const absoluteDeadline = absoluteDeadlineInput ?? current + DEFAULT_TIMEOUT_MS;
    checkBoundary(mediaTypeInput, maximumPagesInput, absoluteDeadline, signal);
    const bytes = copyExactUint8Array(input, MAX_INPUT_BYTES);
    let pageCount = 1;
    if (mediaTypeInput === "application/pdf") {
      pageCount = await inspectPdf(bytes, maximumPagesInput as number, absoluteDeadline, signal);
    } else if (mediaTypeInput === "image/png") {
      inspectPng(bytes);
      if (maximumPagesInput !== 1) invalid();
    } else {
      inspectJpeg(bytes);
      if (maximumPagesInput !== 1) invalid();
    }
    return Object.freeze(Object.assign(Object.create(null), { pageCount }));
  } catch {
    throw new BidAttachmentInspectionError();
  }
}
