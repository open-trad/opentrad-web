import type { DocxPlanV2 } from "./docx/buildDocxPlan.js";

export const MAX_ATTACHMENT_PAGE_IMAGES = 80;
export const MAX_ATTACHMENT_IMAGE_DIMENSION_PIXELS = 16_384;
export const MAX_ATTACHMENT_IMAGE_PIXELS = 100_000_000;
export const MAX_ATTACHMENT_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENT_IMAGES_TOTAL_BYTES = 50 * 1024 * 1024;

const NATIVE_STRUCTURED_CLONE = globalThis.structuredClone.bind(globalThis);
const VALIDATION_FAILURE = Object.freeze(Object.create(null)) as object;
const INTRINSIC_APPLY = Reflect.apply;
const ARRAY_BUFFER_IS_VIEW = ArrayBuffer.isView;
const SAFE_UINT8_ARRAY = Uint8Array;
const SAFE_UINT8_ARRAY_SET = Uint8Array.prototype.set;
const TYPED_ARRAY_PROTOTYPE = Reflect.getPrototypeOf(Uint8Array.prototype) as object;

function captureGetter(
  prototype: object,
  key: PropertyKey,
): ((target: object) => unknown) | undefined {
  const getter = Reflect.getOwnPropertyDescriptor(prototype, key)?.get;
  return getter ? (target: object) => INTRINSIC_APPLY(getter, target, []) : undefined;
}

function requireGetter(prototype: object, key: PropertyKey): (target: object) => unknown {
  const getter = captureGetter(prototype, key);
  if (!getter) throw new Error(`Required intrinsic getter is unavailable: ${String(key)}`);
  return getter;
}

const TYPED_ARRAY_BUFFER = requireGetter(TYPED_ARRAY_PROTOTYPE, "buffer");
const TYPED_ARRAY_BYTE_LENGTH = requireGetter(TYPED_ARRAY_PROTOTYPE, "byteLength");
const TYPED_ARRAY_BYTE_OFFSET = requireGetter(TYPED_ARRAY_PROTOTYPE, "byteOffset");
const ARRAY_BUFFER_BYTE_LENGTH = requireGetter(ArrayBuffer.prototype, "byteLength");
const ARRAY_BUFFER_RESIZABLE = captureGetter(ArrayBuffer.prototype, "resizable");
const ARRAY_BUFFER_DETACHED = captureGetter(ArrayBuffer.prototype, "detached");

const IMAGE_KEYS = Object.freeze([
  "attachmentId",
  "pageNumber",
  "bytes",
  "widthPixels",
  "heightPixels",
] as const);

export interface AttachmentPageImage {
  readonly attachmentId: string;
  readonly pageNumber: number;
  readonly bytes: Uint8Array;
  readonly widthPixels: number;
  readonly heightPixels: number;
}

export interface RenderDocxV2Options {
  readonly attachmentPageImages?: readonly AttachmentPageImage[];
}

export interface TrustedAttachmentPageImage extends AttachmentPageImage {
  readonly bytes: Uint8Array;
}

interface InspectedJpegBytes {
  readonly buffer: ArrayBuffer;
  readonly byteLength: number;
  readonly byteOffset: number;
}

interface PendingAttachmentPageImage extends Omit<TrustedAttachmentPageImage, "bytes"> {
  readonly bytes: InspectedJpegBytes;
}

export class AttachmentPageImagesValidationError extends Error {
  readonly code = "ATTACHMENT_PAGE_IMAGES_INVALID" as const;

  constructor() {
    super("附件页图像输入无效");
    this.name = "AttachmentPageImagesValidationError";
  }
}

function fail(): never {
  throw VALIDATION_FAILURE;
}

function hasOnlyDataProperties(
  value: object,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
  ) {
    fail();
  }
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) fail();
    Object.defineProperty(output, key, {
      configurable: false,
      enumerable: true,
      value: descriptor.value,
      writable: false,
    });
  }
  return Object.freeze(output);
}

function exactDenseArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Reflect.getPrototypeOf(value) !== Array.prototype) fail();
  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor)) fail();
  const length = lengthDescriptor.value;
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > MAX_ATTACHMENT_PAGE_IMAGES
  ) {
    fail();
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) fail();
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) fail();
    Object.defineProperty(output, index, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }
  return output;
}

function inspectJpegBytes(value: unknown): InspectedJpegBytes {
  if (!ARRAY_BUFFER_IS_VIEW(value) || Reflect.getPrototypeOf(value) !== Uint8Array.prototype)
    fail();
  for (const key of ["buffer", "byteLength", "byteOffset"] as const) {
    if (Reflect.getOwnPropertyDescriptor(value, key)) fail();
  }
  const buffer = TYPED_ARRAY_BUFFER(value);
  const byteLength = TYPED_ARRAY_BYTE_LENGTH(value);
  const byteOffset = TYPED_ARRAY_BYTE_OFFSET(value);
  if (
    typeof byteLength !== "number" ||
    typeof byteOffset !== "number" ||
    !Number.isSafeInteger(byteLength) ||
    !Number.isSafeInteger(byteOffset)
  ) {
    fail();
  }
  if (buffer === null || typeof buffer !== "object") fail();
  if (Reflect.getPrototypeOf(buffer) !== ArrayBuffer.prototype) fail();
  const bufferByteLength = ARRAY_BUFFER_BYTE_LENGTH(buffer);
  if (
    typeof bufferByteLength !== "number" ||
    !Number.isSafeInteger(bufferByteLength) ||
    byteLength < 1 ||
    byteLength > MAX_ATTACHMENT_IMAGE_BYTES ||
    byteOffset < 0 ||
    byteOffset + byteLength > bufferByteLength ||
    ARRAY_BUFFER_DETACHED?.(buffer) === true ||
    ARRAY_BUFFER_RESIZABLE?.(buffer) === true
  ) {
    fail();
  }
  return { buffer: buffer as ArrayBuffer, byteLength, byteOffset };
}

function copyJpegBytes(bytes: InspectedJpegBytes): Uint8Array {
  const source = new SAFE_UINT8_ARRAY(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const copy = new SAFE_UINT8_ARRAY(bytes.byteLength);
  INTRINSIC_APPLY(SAFE_UINT8_ARRAY_SET, copy, [source]);
  return copy;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  const high = bytes[offset];
  const low = bytes[offset + 1];
  if (high === undefined || low === undefined) fail();
  return high * 256 + low;
}

function isSofMarker(marker: number): boolean {
  return [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
    marker,
  );
}

function parseJpegDimensions(bytes: Uint8Array): {
  readonly width: number;
  readonly height: number;
} {
  if (bytes.length < 6 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail();
  let offset = 2;
  let inScan = false;
  let sawScan = false;
  let width: number | undefined;
  let height: number | undefined;

  while (offset < bytes.length) {
    if (inScan) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
      if (offset >= bytes.length) fail();
      const markerStart = offset;
      offset += 1;
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset];
      if (marker === undefined) fail();
      if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 1;
        continue;
      }
      inScan = false;
      offset = markerStart;
      continue;
    }

    if (bytes[offset] !== 0xff) fail();
    offset += 1;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    if (marker === undefined || marker === 0x00 || marker === 0xd8) fail();
    const markerStart = offset - 1;
    offset += 1;

    if (marker === 0xd9) {
      if (!sawScan || width === undefined || height === undefined || offset !== bytes.length)
        fail();
      return { width, height };
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) fail();

    const segmentLength = readUint16(bytes, offset);
    if (segmentLength < 2) fail();
    const segmentEnd = markerStart + 2 + segmentLength;
    if (segmentEnd > bytes.length) fail();

    if (isSofMarker(marker)) {
      if ((marker !== 0xc0 && marker !== 0xc2) || width !== undefined || height !== undefined)
        fail();
      const precision = bytes[markerStart + 4];
      const components = bytes[markerStart + 9];
      if (
        precision !== 8 ||
        components === undefined ||
        components < 1 ||
        segmentLength !== 8 + components * 3
      ) {
        fail();
      }
      height = readUint16(bytes, markerStart + 5);
      width = readUint16(bytes, markerStart + 7);
      if (width < 1 || height < 1) fail();
    }

    if (marker === 0xda) {
      if (width === undefined || height === undefined) fail();
      sawScan = true;
      inScan = true;
    }
    offset = segmentEnd;
  }
  return fail();
}

function exactPositiveInteger(value: unknown, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > maximum
  ) {
    fail();
  }
  return value;
}

function expectedAttachmentPages(plan: DocxPlanV2): readonly {
  readonly attachmentId: string;
  readonly pageNumber: number;
}[] {
  if (
    plan.sections.some((section) => section.blocks.some((block) => block.type === "attachmentPage"))
  ) {
    fail();
  }

  const expected: { readonly attachmentId: string; readonly pageNumber: number }[] = [];
  for (const attachment of plan.attachmentManifest) {
    if (!attachment.includedInSubmission) continue;
    if (attachment.status !== "attached") fail();
    const pageCount = exactPositiveInteger(attachment.pageCount, MAX_ATTACHMENT_PAGE_IMAGES);
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      expected.push({ attachmentId: attachment.id, pageNumber });
    }
  }
  if (expected.length > MAX_ATTACHMENT_PAGE_IMAGES) fail();
  return expected;
}

export function attachmentPageImageKey(attachmentId: string, pageNumber: number): string {
  return `${attachmentId}:${pageNumber}`;
}

export function validateAttachmentPageImages(
  plan: DocxPlanV2,
  options: RenderDocxV2Options | undefined,
): ReadonlyMap<string, TrustedAttachmentPageImage> {
  if (options === undefined) return new Map();

  try {
    const optionKeys = Reflect.ownKeys(options);
    const prototype = Reflect.getPrototypeOf(options);
    if (prototype !== Object.prototype && prototype !== null) fail();
    if (optionKeys.some((key) => key !== "attachmentPageImages") || optionKeys.length > 1) {
      fail();
    }
    const imagesDescriptor = Reflect.getOwnPropertyDescriptor(options, "attachmentPageImages");
    if (imagesDescriptor && !("value" in imagesDescriptor)) fail();

    const input = imagesDescriptor ? exactDenseArray(imagesDescriptor.value) : [];
    const expected = imagesDescriptor ? expectedAttachmentPages(plan) : [];
    if (input.length !== expected.length) fail();

    const snapshots: PendingAttachmentPageImage[] = [];
    let totalBytes = 0;
    const uniqueKeys = new Set<string>();

    for (let index = 0; index < input.length; index += 1) {
      const candidate = input[index];
      if (candidate === null || typeof candidate !== "object") fail();
      const record = hasOnlyDataProperties(candidate, IMAGE_KEYS);
      const attachmentId = record.attachmentId;
      const pageNumber = exactPositiveInteger(record.pageNumber, MAX_ATTACHMENT_PAGE_IMAGES);
      const widthPixels = exactPositiveInteger(
        record.widthPixels,
        MAX_ATTACHMENT_IMAGE_DIMENSION_PIXELS,
      );
      const heightPixels = exactPositiveInteger(
        record.heightPixels,
        MAX_ATTACHMENT_IMAGE_DIMENSION_PIXELS,
      );
      if (typeof attachmentId !== "string" || attachmentId.length === 0) fail();
      if (widthPixels * heightPixels > MAX_ATTACHMENT_IMAGE_PIXELS) fail();
      const bytes = inspectJpegBytes(record.bytes);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_ATTACHMENT_IMAGES_TOTAL_BYTES) fail();

      const expectedPage = expected[index];
      if (
        !expectedPage ||
        attachmentId !== expectedPage.attachmentId ||
        pageNumber !== expectedPage.pageNumber
      ) {
        fail();
      }
      const key = attachmentPageImageKey(attachmentId, pageNumber);
      if (uniqueKeys.has(key)) fail();
      uniqueKeys.add(key);
      snapshots.push({ attachmentId, pageNumber, bytes, widthPixels, heightPixels });
    }

    NATIVE_STRUCTURED_CLONE(options);

    const output = new Map<string, TrustedAttachmentPageImage>();
    for (const snapshot of snapshots) {
      const bytes = copyJpegBytes(snapshot.bytes);
      const dimensions = parseJpegDimensions(bytes);
      if (
        dimensions.width !== snapshot.widthPixels ||
        dimensions.height !== snapshot.heightPixels
      ) {
        fail();
      }
      const key = attachmentPageImageKey(snapshot.attachmentId, snapshot.pageNumber);
      output.set(
        key,
        Object.freeze({
          attachmentId: snapshot.attachmentId,
          pageNumber: snapshot.pageNumber,
          bytes,
          widthPixels: snapshot.widthPixels,
          heightPixels: snapshot.heightPixels,
        }),
      );
    }
    return output;
  } catch {
    throw new AttachmentPageImagesValidationError();
  }
}
