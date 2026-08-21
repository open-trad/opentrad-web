import avifDecode from "@jsquash/avif/decode.js";
import avifEncode from "@jsquash/avif/encode.js";
import jpegDecode from "@jsquash/jpeg/decode.js";
import jpegEncode from "@jsquash/jpeg/encode.js";
import webpDecode from "@jsquash/webp/decode.js";
import webpEncode from "@jsquash/webp/encode.js";
import type { LocalConversionRequest } from "../protocol.js";
import type { LocalWorkerOutput } from "../worker.js";

const KiB = 1024;
const MiB = 1024 * KiB;
const IntrinsicArrayBuffer = ArrayBuffer;
const IntrinsicBlob = Blob;
const IntrinsicCompressionStream = globalThis.CompressionStream;
const IntrinsicError = Error;
const IntrinsicImageData = typeof ImageData === "undefined" ? undefined : ImageData;
const IntrinsicUint8Array = Uint8Array;
const IntrinsicUint8ClampedArray = Uint8ClampedArray;
const intrinsicArrayBufferByteLength = Reflect.getOwnPropertyDescriptor(
  IntrinsicArrayBuffer.prototype,
  "byteLength",
)?.get;
const intrinsicArrayBufferResizable = Reflect.getOwnPropertyDescriptor(
  IntrinsicArrayBuffer.prototype,
  "resizable",
)?.get;
const intrinsicFreeze = Object.freeze;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicMathFloor = Math.floor;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicStringCharCodeAt = String.prototype.charCodeAt;
const intrinsicStringFromCharCode = String.fromCharCode;
const intrinsicAbortSignalAborted = Reflect.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)?.get;
const intrinsicEventTargetAddEventListener = EventTarget.prototype.addEventListener;
const intrinsicEventTargetRemoveEventListener = EventTarget.prototype.removeEventListener;
const intrinsicImageDataPrototype = IntrinsicImageData?.prototype;
const intrinsicImageDataData = intrinsicImageDataPrototype
  ? Reflect.getOwnPropertyDescriptor(intrinsicImageDataPrototype, "data")?.get
  : undefined;
const intrinsicImageDataHeight = intrinsicImageDataPrototype
  ? Reflect.getOwnPropertyDescriptor(intrinsicImageDataPrototype, "height")?.get
  : undefined;
const intrinsicImageDataWidth = intrinsicImageDataPrototype
  ? Reflect.getOwnPropertyDescriptor(intrinsicImageDataPrototype, "width")?.get
  : undefined;
const intrinsicTypedArrayPrototype = intrinsicGetPrototypeOf(IntrinsicUint8Array.prototype);
const intrinsicTypedArrayBuffer = intrinsicReflectGetOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "buffer",
)?.get;
const intrinsicTypedArrayByteLength = intrinsicReflectGetOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "byteLength",
)?.get;
const intrinsicUint8ArraySet = IntrinsicUint8Array.prototype.set;
const intrinsicUint8ClampedArraySet = IntrinsicUint8ClampedArray.prototype.set;

export type ImageFormat = "png" | "jpg" | "webp" | "avif";

const mutableLimits = intrinsicObjectCreate(null) as {
  maxAlphaPixels: number;
  maxChunks: number;
  maxDimension: number;
  maxExifBytes: number;
  maxFrames: number;
  maxIccBytes: number;
  maxInputBytes: number;
  maxOutputBytes: number;
  maxPixels: number;
};
mutableLimits.maxAlphaPixels = 20_000_000;
mutableLimits.maxChunks = 4_096;
mutableLimits.maxDimension = 16_384;
mutableLimits.maxExifBytes = 256 * KiB;
mutableLimits.maxFrames = 1;
mutableLimits.maxIccBytes = 512 * KiB;
mutableLimits.maxInputBytes = 25 * MiB;
mutableLimits.maxOutputBytes = 25 * MiB;
mutableLimits.maxPixels = 40_000_000;

export const IMAGE_LIMITS = intrinsicFreeze(mutableLimits);

export interface ImageInspection {
  readonly exifBytes: number;
  readonly format: ImageFormat;
  readonly frameCount: 1;
  readonly hasAlpha: boolean;
  readonly height: number;
  readonly iccBytes: number;
  readonly pixels: number;
  readonly width: number;
}

type ImageFailureCode =
  | "IMAGE_ALPHA_LIMIT"
  | "IMAGE_CANVAS_UNAVAILABLE"
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
  | "IMAGE_QUALITY_INVALID"
  | "LOCAL_CONVERSION_CANCELLED";

const alphaSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const canvasSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const chunkSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const dataSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const decodeSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const decodeMismatchSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const encodeSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const formatSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const formatMismatchSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const inputLimitSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const metadataSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const multiframeSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const outputLimitSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const pixelSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const qualitySentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const cancelledSentinel = intrinsicFreeze(intrinsicObjectCreate(null));

function raise(code: ImageFailureCode): never {
  switch (code) {
    case "IMAGE_ALPHA_LIMIT":
      throw alphaSentinel;
    case "IMAGE_CANVAS_UNAVAILABLE":
      throw canvasSentinel;
    case "IMAGE_CHUNK_LIMIT":
      throw chunkSentinel;
    case "IMAGE_DATA_INVALID":
      throw dataSentinel;
    case "IMAGE_DECODE_FAILED":
      throw decodeSentinel;
    case "IMAGE_DECODE_MISMATCH":
      throw decodeMismatchSentinel;
    case "IMAGE_ENCODE_FAILED":
      throw encodeSentinel;
    case "IMAGE_FORMAT_INVALID":
      throw formatSentinel;
    case "IMAGE_FORMAT_MISMATCH":
      throw formatMismatchSentinel;
    case "IMAGE_INPUT_TOO_LARGE":
      throw inputLimitSentinel;
    case "IMAGE_METADATA_LIMIT":
      throw metadataSentinel;
    case "IMAGE_MULTIFRAME_UNSUPPORTED":
      throw multiframeSentinel;
    case "IMAGE_OUTPUT_TOO_LARGE":
      throw outputLimitSentinel;
    case "IMAGE_PIXEL_LIMIT":
      throw pixelSentinel;
    case "IMAGE_QUALITY_INVALID":
      throw qualitySentinel;
    case "LOCAL_CONVERSION_CANCELLED":
      throw cancelledSentinel;
  }
}

function publicError(error: unknown): Error {
  if (error === alphaSentinel) return new IntrinsicError("IMAGE_ALPHA_LIMIT");
  if (error === canvasSentinel) return new IntrinsicError("IMAGE_CANVAS_UNAVAILABLE");
  if (error === chunkSentinel) return new IntrinsicError("IMAGE_CHUNK_LIMIT");
  if (error === dataSentinel) return new IntrinsicError("IMAGE_DATA_INVALID");
  if (error === decodeSentinel) return new IntrinsicError("IMAGE_DECODE_FAILED");
  if (error === decodeMismatchSentinel) return new IntrinsicError("IMAGE_DECODE_MISMATCH");
  if (error === encodeSentinel) return new IntrinsicError("IMAGE_ENCODE_FAILED");
  if (error === formatSentinel) return new IntrinsicError("IMAGE_FORMAT_INVALID");
  if (error === formatMismatchSentinel) return new IntrinsicError("IMAGE_FORMAT_MISMATCH");
  if (error === inputLimitSentinel) return new IntrinsicError("IMAGE_INPUT_TOO_LARGE");
  if (error === metadataSentinel) return new IntrinsicError("IMAGE_METADATA_LIMIT");
  if (error === multiframeSentinel) return new IntrinsicError("IMAGE_MULTIFRAME_UNSUPPORTED");
  if (error === outputLimitSentinel) return new IntrinsicError("IMAGE_OUTPUT_TOO_LARGE");
  if (error === pixelSentinel) return new IntrinsicError("IMAGE_PIXEL_LIMIT");
  if (error === qualitySentinel) return new IntrinsicError("IMAGE_QUALITY_INVALID");
  if (error === cancelledSentinel) return new IntrinsicError("LOCAL_CONVERSION_CANCELLED");
  return new IntrinsicError("IMAGE_FORMAT_INVALID");
}

function boundarySync<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    throw publicError(error);
  }
}

async function boundary<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw publicError(error);
  }
}

function checkAbort(signal?: AbortSignal): void {
  if (!signal) return;
  if (!intrinsicAbortSignalAborted) raise("LOCAL_CONVERSION_CANCELLED");
  try {
    if (intrinsicReflectApply(intrinsicAbortSignalAborted, signal, []) === true) {
      raise("LOCAL_CONVERSION_CANCELLED");
    }
  } catch (error) {
    if (error === cancelledSentinel) throw error;
    raise("LOCAL_CONVERSION_CANCELLED");
  }
}

async function checkpoint(signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  await Promise.resolve();
  checkAbort(signal);
}

function waitForAbortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  checkAbort(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      try {
        intrinsicReflectApply(intrinsicEventTargetRemoveEventListener, signal, ["abort", onAbort]);
      } catch {
        // The caller observes only the fixed cancellation/conversion result.
      }
    };
    const settle = (work: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      work();
    };
    const onAbort = () => settle(() => reject(cancelledSentinel));
    try {
      intrinsicReflectApply(intrinsicEventTargetAddEventListener, signal, [
        "abort",
        onAbort,
        { once: true },
      ]);
      checkAbort(signal);
    } catch {
      settle(() => reject(cancelledSentinel));
      return;
    }
    promise.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}

function byteLength(bytes: Uint8Array): number {
  if (!intrinsicTypedArrayByteLength) raise("IMAGE_FORMAT_INVALID");
  return intrinsicReflectApply(intrinsicTypedArrayByteLength, bytes, []) as number;
}

function copyBytes(
  input: unknown,
  maximum: number,
  limitCode: ImageFailureCode,
): Uint8Array<ArrayBuffer> {
  if (
    input === null ||
    typeof input !== "object" ||
    intrinsicGetPrototypeOf(input) !== IntrinsicUint8Array.prototype ||
    !intrinsicTypedArrayBuffer ||
    !intrinsicTypedArrayByteLength ||
    !intrinsicArrayBufferByteLength
  ) {
    raise("IMAGE_FORMAT_INVALID");
  }
  const length = intrinsicReflectApply(intrinsicTypedArrayByteLength, input, []) as number;
  const buffer = intrinsicReflectApply(intrinsicTypedArrayBuffer, input, []) as unknown;
  if (
    !intrinsicNumberIsSafeInteger(length) ||
    length < 1 ||
    length > maximum ||
    intrinsicGetPrototypeOf(buffer as object) !== IntrinsicArrayBuffer.prototype
  ) {
    if (length > maximum) raise(limitCode);
    raise("IMAGE_FORMAT_INVALID");
  }
  const backingLength = intrinsicReflectApply(intrinsicArrayBufferByteLength, buffer, []) as number;
  if (!intrinsicNumberIsSafeInteger(backingLength) || backingLength < length) {
    raise("IMAGE_FORMAT_INVALID");
  }
  if (
    intrinsicArrayBufferResizable &&
    intrinsicReflectApply(intrinsicArrayBufferResizable, buffer, []) === true
  ) {
    raise("IMAGE_FORMAT_INVALID");
  }
  const copy = new IntrinsicUint8Array(length);
  intrinsicReflectApply(intrinsicUint8ArraySet, copy, [input]);
  return copy;
}

function u16be(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > byteLength(bytes)) raise("IMAGE_FORMAT_INVALID");
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function u24le(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 3 > byteLength(bytes)) raise("IMAGE_FORMAT_INVALID");
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function u32be(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > byteLength(bytes)) raise("IMAGE_FORMAT_INVALID");
  return (
    ((bytes[offset] ?? 0) * 0x1000000 +
      ((bytes[offset + 1] ?? 0) << 16) +
      ((bytes[offset + 2] ?? 0) << 8) +
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function u32le(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > byteLength(bytes)) raise("IMAGE_FORMAT_INVALID");
  return (
    ((bytes[offset] ?? 0) +
      ((bytes[offset + 1] ?? 0) << 8) +
      ((bytes[offset + 2] ?? 0) << 16) +
      (bytes[offset + 3] ?? 0) * 0x1000000) >>>
    0
  );
}

function asciiAt(bytes: Uint8Array, offset: number, expected: string): boolean {
  if (offset < 0 || offset + expected.length > byteLength(bytes)) return false;
  for (let index = 0; index < expected.length; index += 1) {
    const code = intrinsicReflectApply(intrinsicStringCharCodeAt, expected, [index]) as number;
    if (bytes[offset + index] !== code) return false;
  }
  return true;
}

function exactBytes(bytes: Uint8Array, expected: readonly number[]): boolean {
  if (byteLength(bytes) < expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[index] !== expected[index]) return false;
  }
  return true;
}

function checkPixelLimit(width: number, height: number, hasAlpha = false): number {
  if (
    !intrinsicNumberIsSafeInteger(width) ||
    !intrinsicNumberIsSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > IMAGE_LIMITS.maxDimension ||
    height > IMAGE_LIMITS.maxDimension
  ) {
    raise("IMAGE_PIXEL_LIMIT");
  }
  const pixels = width * height;
  if (!intrinsicNumberIsSafeInteger(pixels) || pixels > IMAGE_LIMITS.maxPixels) {
    raise("IMAGE_PIXEL_LIMIT");
  }
  if (hasAlpha && pixels > IMAGE_LIMITS.maxAlphaPixels) raise("IMAGE_ALPHA_LIMIT");
  return pixels;
}

export function assertPixelLimit(width: number, height: number): void {
  boundarySync(() => {
    checkPixelLimit(width, height);
  });
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc ^= bytes[offset] ?? 0;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface MutableInspection {
  exifBytes: number;
  format: ImageFormat;
  frameCount: 1;
  hasAlpha: boolean;
  height: number;
  iccBytes: number;
  width: number;
}

function parsePng(bytes: Uint8Array<ArrayBuffer>): MutableInspection {
  if (!exactBytes(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) raise("IMAGE_FORMAT_INVALID");
  let offset = 8;
  let chunks = 0;
  let width = 0;
  let height = 0;
  let hasAlpha = false;
  let exifBytes = 0;
  const iccBytes = 0;
  let sawIhdr = false;
  let sawIdat = false;
  let sawIend = false;
  const length = byteLength(bytes);
  while (offset < length) {
    if (offset + 12 > length) raise("IMAGE_FORMAT_INVALID");
    const size = u32be(bytes, offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    const chunkEnd = dataEnd + 4;
    if (!intrinsicNumberIsSafeInteger(chunkEnd) || dataEnd < dataStart || chunkEnd > length) {
      raise("IMAGE_FORMAT_INVALID");
    }
    chunks += 1;
    if (chunks > IMAGE_LIMITS.maxChunks) raise("IMAGE_CHUNK_LIMIT");
    const typeOffset = offset + 4;
    const storedCrc = u32be(bytes, dataEnd);
    if (crc32(bytes, typeOffset, dataEnd) !== storedCrc) raise("IMAGE_FORMAT_INVALID");
    if (asciiAt(bytes, typeOffset, "IHDR")) {
      if (sawIhdr || chunks !== 1 || size !== 13) raise("IMAGE_FORMAT_INVALID");
      sawIhdr = true;
      width = u32be(bytes, dataStart);
      height = u32be(bytes, dataStart + 4);
      const bitDepth = bytes[dataStart + 8] ?? 0;
      const colorType = bytes[dataStart + 9] ?? 0;
      const validDepth =
        (colorType === 0 &&
          (bitDepth === 1 ||
            bitDepth === 2 ||
            bitDepth === 4 ||
            bitDepth === 8 ||
            bitDepth === 16)) ||
        (colorType === 2 && (bitDepth === 8 || bitDepth === 16)) ||
        (colorType === 3 &&
          (bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8)) ||
        ((colorType === 4 || colorType === 6) && (bitDepth === 8 || bitDepth === 16));
      if (
        !validDepth ||
        bytes[dataStart + 10] !== 0 ||
        bytes[dataStart + 11] !== 0 ||
        ((bytes[dataStart + 12] ?? 2) !== 0 && bytes[dataStart + 12] !== 1)
      ) {
        raise("IMAGE_FORMAT_INVALID");
      }
      hasAlpha = colorType === 4 || colorType === 6;
    } else if (asciiAt(bytes, typeOffset, "IDAT")) {
      if (!sawIhdr || sawIend) raise("IMAGE_FORMAT_INVALID");
      sawIdat = true;
    } else if (asciiAt(bytes, typeOffset, "IEND")) {
      if (!sawIhdr || !sawIdat || sawIend || size !== 0 || chunkEnd !== length) {
        raise("IMAGE_FORMAT_INVALID");
      }
      sawIend = true;
    } else if (
      asciiAt(bytes, typeOffset, "acTL") ||
      asciiAt(bytes, typeOffset, "fcTL") ||
      asciiAt(bytes, typeOffset, "fdAT")
    ) {
      raise("IMAGE_MULTIFRAME_UNSUPPORTED");
    } else if (asciiAt(bytes, typeOffset, "tRNS")) {
      hasAlpha = true;
    } else if (asciiAt(bytes, typeOffset, "eXIf")) {
      exifBytes += size;
    } else if (asciiAt(bytes, typeOffset, "iCCP")) {
      // PNG stores ICC data compressed. The synchronous admission API cannot prove the
      // expanded profile budget, and conversion strips metadata, so fail closed.
      raise("IMAGE_METADATA_LIMIT");
    }
    if (exifBytes > IMAGE_LIMITS.maxExifBytes || iccBytes > IMAGE_LIMITS.maxIccBytes) {
      raise("IMAGE_METADATA_LIMIT");
    }
    offset = chunkEnd;
  }
  if (!sawIhdr || !sawIdat || !sawIend) raise("IMAGE_FORMAT_INVALID");
  return { exifBytes, format: "png", frameCount: 1, hasAlpha, height, iccBytes, width };
}

function isJpegSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function parseJpeg(bytes: Uint8Array<ArrayBuffer>): MutableInspection {
  const length = byteLength(bytes);
  if (length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) raise("IMAGE_FORMAT_INVALID");
  let offset = 2;
  let chunks = 0;
  let width = 0;
  let height = 0;
  let exifBytes = 0;
  let iccBytes = 0;
  let iccCount = 0;
  let expectedIccCount = 0;
  let sawSof = false;
  let sawEoi = false;
  const iccSeen = intrinsicObjectCreate(null) as Record<number, boolean>;
  while (offset < length) {
    if (bytes[offset] !== 0xff) raise("IMAGE_FORMAT_INVALID");
    while (offset < length && bytes[offset] === 0xff) offset += 1;
    if (offset >= length) raise("IMAGE_FORMAT_INVALID");
    const marker = bytes[offset] ?? 0;
    offset += 1;
    if (marker === 0xd9) {
      sawEoi = true;
      if (offset !== length) raise("IMAGE_FORMAT_INVALID");
      break;
    }
    if (
      marker === 0xd8 ||
      marker === 0x00 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      raise("IMAGE_FORMAT_INVALID");
    }
    if (offset + 2 > length) raise("IMAGE_FORMAT_INVALID");
    const segmentSize = u16be(bytes, offset);
    if (segmentSize < 2) raise("IMAGE_FORMAT_INVALID");
    const dataStart = offset + 2;
    const dataEnd = offset + segmentSize;
    if (dataEnd > length || dataEnd < dataStart) raise("IMAGE_FORMAT_INVALID");
    chunks += 1;
    if (chunks > IMAGE_LIMITS.maxChunks) raise("IMAGE_CHUNK_LIMIT");
    if (isJpegSof(marker)) {
      if (sawSof || segmentSize < 8) raise("IMAGE_MULTIFRAME_UNSUPPORTED");
      sawSof = true;
      height = u16be(bytes, dataStart + 1);
      width = u16be(bytes, dataStart + 3);
    } else if (marker === 0xe1 && asciiAt(bytes, dataStart, "Exif\0\0")) {
      exifBytes += dataEnd - dataStart;
    } else if (marker === 0xe2 && asciiAt(bytes, dataStart, "MPF\0")) {
      raise("IMAGE_MULTIFRAME_UNSUPPORTED");
    } else if (marker === 0xe2 && asciiAt(bytes, dataStart, "ICC_PROFILE\0")) {
      const sequence = bytes[dataStart + 12] ?? 0;
      const total = bytes[dataStart + 13] ?? 0;
      if (sequence < 1 || total < 1 || sequence > total || iccSeen[sequence]) {
        raise("IMAGE_FORMAT_INVALID");
      }
      if (expectedIccCount !== 0 && expectedIccCount !== total) raise("IMAGE_FORMAT_INVALID");
      expectedIccCount = total;
      iccSeen[sequence] = true;
      iccCount += 1;
      iccBytes += dataEnd - dataStart;
    }
    if (exifBytes > IMAGE_LIMITS.maxExifBytes || iccBytes > IMAGE_LIMITS.maxIccBytes) {
      raise("IMAGE_METADATA_LIMIT");
    }
    if (marker === 0xda) {
      offset = dataEnd;
      while (offset < length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        let next = offset + 1;
        while (next < length && bytes[next] === 0xff) next += 1;
        if (next >= length) raise("IMAGE_FORMAT_INVALID");
        const entropyMarker = bytes[next] ?? 0;
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
  if (!sawSof || !sawEoi || (expectedIccCount !== 0 && iccCount !== expectedIccCount)) {
    raise("IMAGE_FORMAT_INVALID");
  }
  return { exifBytes, format: "jpg", frameCount: 1, hasAlpha: false, height, iccBytes, width };
}

function parseWebp(bytes: Uint8Array<ArrayBuffer>): MutableInspection {
  const length = byteLength(bytes);
  if (
    length < 20 ||
    !asciiAt(bytes, 0, "RIFF") ||
    !asciiAt(bytes, 8, "WEBP") ||
    u32le(bytes, 4) + 8 !== length
  ) {
    raise("IMAGE_FORMAT_INVALID");
  }
  let offset = 12;
  let chunks = 0;
  let width = 0;
  let height = 0;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let hasAlpha = false;
  let exifBytes = 0;
  let iccBytes = 0;
  let imageChunks = 0;
  let sawVp8x = false;
  let vp8xAlpha: boolean | undefined;
  while (offset < length) {
    if (offset + 8 > length) raise("IMAGE_FORMAT_INVALID");
    const size = u32le(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    const chunkEnd = dataEnd + (size & 1);
    if (!intrinsicNumberIsSafeInteger(chunkEnd) || chunkEnd > length || dataEnd < dataStart) {
      raise("IMAGE_FORMAT_INVALID");
    }
    chunks += 1;
    if (chunks > IMAGE_LIMITS.maxChunks) raise("IMAGE_CHUNK_LIMIT");
    if (asciiAt(bytes, offset, "VP8X")) {
      if (sawVp8x || size !== 10 || chunks !== 1) raise("IMAGE_FORMAT_INVALID");
      sawVp8x = true;
      const flags = bytes[dataStart] ?? 0;
      if ((flags & 0xc1) !== 0) raise("IMAGE_FORMAT_INVALID");
      if ((flags & 0x02) !== 0) raise("IMAGE_MULTIFRAME_UNSUPPORTED");
      vp8xAlpha = (flags & 0x10) !== 0;
      hasAlpha = vp8xAlpha;
      canvasWidth = u24le(bytes, dataStart + 4) + 1;
      canvasHeight = u24le(bytes, dataStart + 7) + 1;
    } else if (asciiAt(bytes, offset, "ANIM") || asciiAt(bytes, offset, "ANMF")) {
      raise("IMAGE_MULTIFRAME_UNSUPPORTED");
    } else if (asciiAt(bytes, offset, "VP8L")) {
      if (size < 5 || bytes[dataStart] !== 0x2f) raise("IMAGE_FORMAT_INVALID");
      imageChunks += 1;
      const b1 = bytes[dataStart + 1] ?? 0;
      const b2 = bytes[dataStart + 2] ?? 0;
      const b3 = bytes[dataStart + 3] ?? 0;
      const b4 = bytes[dataStart + 4] ?? 0;
      const losslessAlpha = (b4 & 0x10) !== 0;
      if ((b4 & 0xe0) !== 0 || (vp8xAlpha !== undefined && vp8xAlpha !== losslessAlpha)) {
        raise("IMAGE_FORMAT_INVALID");
      }
      width = 1 + b1 + ((b2 & 0x3f) << 8);
      height = 1 + (b2 >>> 6) + (b3 << 2) + ((b4 & 0x0f) << 10);
      hasAlpha = losslessAlpha;
    } else if (asciiAt(bytes, offset, "VP8 ")) {
      if (
        size < 10 ||
        bytes[dataStart + 3] !== 0x9d ||
        bytes[dataStart + 4] !== 0x01 ||
        bytes[dataStart + 5] !== 0x2a
      ) {
        raise("IMAGE_FORMAT_INVALID");
      }
      imageChunks += 1;
      width = ((bytes[dataStart + 6] ?? 0) | ((bytes[dataStart + 7] ?? 0) << 8)) & 0x3fff;
      height = ((bytes[dataStart + 8] ?? 0) | ((bytes[dataStart + 9] ?? 0) << 8)) & 0x3fff;
    } else if (asciiAt(bytes, offset, "EXIF")) {
      exifBytes += size;
    } else if (asciiAt(bytes, offset, "ICCP")) {
      iccBytes += size;
    }
    if (exifBytes > IMAGE_LIMITS.maxExifBytes || iccBytes > IMAGE_LIMITS.maxIccBytes) {
      raise("IMAGE_METADATA_LIMIT");
    }
    offset = chunkEnd;
  }
  if (offset !== length || imageChunks !== 1 || width <= 0 || height <= 0) {
    raise("IMAGE_FORMAT_INVALID");
  }
  if (sawVp8x && (width !== canvasWidth || height !== canvasHeight)) {
    raise("IMAGE_FORMAT_INVALID");
  }
  return { exifBytes, format: "webp", frameCount: 1, hasAlpha, height, iccBytes, width };
}

function ascii4(bytes: Uint8Array, offset: number): string {
  if (offset < 0 || offset + 4 > byteLength(bytes)) raise("IMAGE_FORMAT_INVALID");
  let output = "";
  for (let index = 0; index < 4; index += 1) {
    const value = bytes[offset + index] ?? 0;
    if (value < 0x20 || value > 0x7e) raise("IMAGE_FORMAT_INVALID");
    output += intrinsicReflectApply(intrinsicStringFromCharCode, String, [value]) as string;
  }
  return output;
}

interface AvifItem {
  readonly id: number;
  readonly type: string;
}

interface AvifExtent {
  readonly end: number;
  readonly start: number;
}

interface AvifProperty {
  readonly height?: number;
  readonly isAlphaAux?: boolean;
  readonly type: string;
  readonly width?: number;
}

function avifFullBox(
  bytes: Uint8Array,
  start: number,
  end: number,
): { flags: number; version: number } {
  if (start + 4 > end) raise("IMAGE_FORMAT_INVALID");
  return {
    flags:
      ((bytes[start + 1] ?? 0) << 16) | ((bytes[start + 2] ?? 0) << 8) | (bytes[start + 3] ?? 0),
    version: bytes[start] ?? 0,
  };
}

function avifVariableUint(bytes: Uint8Array, start: number, size: number, end: number): number {
  if (!intrinsicNumberIsSafeInteger(size) || size < 0 || size > 8 || start + size > end) {
    raise("IMAGE_FORMAT_INVALID");
  }
  let value = 0;
  for (let index = 0; index < size; index += 1) {
    value = value * 256 + (bytes[start + index] ?? 0);
    if (!intrinsicNumberIsSafeInteger(value)) raise("IMAGE_FORMAT_INVALID");
  }
  return value;
}

function avifChildEnd(bytes: Uint8Array, offset: number, end: number): number {
  if (offset + 8 > end) raise("IMAGE_FORMAT_INVALID");
  const size = u32be(bytes, offset);
  const childEnd = offset + size;
  if (size < 8 || size === 1 || !intrinsicNumberIsSafeInteger(childEnd) || childEnd > end) {
    raise("IMAGE_FORMAT_INVALID");
  }
  return childEnd;
}

function parseAvifItemInfo(bytes: Uint8Array, start: number, end: number): AvifItem[] {
  const fullBox = avifFullBox(bytes, start, end);
  if (fullBox.flags !== 0 || (fullBox.version !== 0 && fullBox.version !== 1)) {
    raise("IMAGE_FORMAT_INVALID");
  }
  let cursor = start + 4;
  const declaredCount = fullBox.version === 0 ? u16be(bytes, cursor) : u32be(bytes, cursor);
  cursor += fullBox.version === 0 ? 2 : 4;
  if (declaredCount < 1 || declaredCount > 2) raise("IMAGE_MULTIFRAME_UNSUPPORTED");
  const items: AvifItem[] = [];
  const ids = intrinsicObjectCreate(null) as Record<number, true>;
  while (cursor < end) {
    const childEnd = avifChildEnd(bytes, cursor, end);
    if (ascii4(bytes, cursor + 4) !== "infe") raise("IMAGE_FORMAT_INVALID");
    const childStart = cursor + 8;
    const childFullBox = avifFullBox(bytes, childStart, childEnd);
    if (childFullBox.flags !== 0 || (childFullBox.version !== 2 && childFullBox.version !== 3)) {
      raise("IMAGE_FORMAT_INVALID");
    }
    let itemCursor = childStart + 4;
    const id = childFullBox.version === 2 ? u16be(bytes, itemCursor) : u32be(bytes, itemCursor);
    itemCursor += childFullBox.version === 2 ? 2 : 4;
    const protectionIndex = u16be(bytes, itemCursor);
    itemCursor += 2;
    if (id === 0 || protectionIndex !== 0 || ids[id]) raise("IMAGE_FORMAT_INVALID");
    const type = ascii4(bytes, itemCursor);
    itemCursor += 4;
    let sawNameEnd = false;
    for (; itemCursor < childEnd; itemCursor += 1) {
      if (bytes[itemCursor] === 0) {
        sawNameEnd = true;
        break;
      }
    }
    if (!sawNameEnd) raise("IMAGE_FORMAT_INVALID");
    if (type === "Exif") raise("IMAGE_METADATA_LIMIT");
    ids[id] = true;
    items[items.length] = intrinsicFreeze({ id, type });
    cursor = childEnd;
  }
  if (cursor !== end || items.length !== declaredCount || items.length < 1) {
    raise("IMAGE_FORMAT_INVALID");
  }
  return items;
}

function parseAvifPrimaryItem(bytes: Uint8Array, start: number, end: number): number {
  const fullBox = avifFullBox(bytes, start, end);
  if (fullBox.flags !== 0 || (fullBox.version !== 0 && fullBox.version !== 1)) {
    raise("IMAGE_FORMAT_INVALID");
  }
  const cursor = start + 4;
  const id = fullBox.version === 0 ? u16be(bytes, cursor) : u32be(bytes, cursor);
  if (id === 0 || cursor + (fullBox.version === 0 ? 2 : 4) !== end) {
    raise("IMAGE_FORMAT_INVALID");
  }
  return id;
}

function parseAvifAssociations(
  bytes: Uint8Array,
  start: number,
  end: number,
): Record<number, number[]> {
  const fullBox = avifFullBox(bytes, start, end);
  if ((fullBox.version !== 0 && fullBox.version !== 1) || (fullBox.flags & ~1) !== 0) {
    raise("IMAGE_FORMAT_INVALID");
  }
  const wide = (fullBox.flags & 1) !== 0;
  let cursor = start + 4;
  const entryCount = u32be(bytes, cursor);
  cursor += 4;
  if (entryCount < 1 || entryCount > 2) raise("IMAGE_MULTIFRAME_UNSUPPORTED");
  const associations = intrinsicObjectCreate(null) as Record<number, number[]>;
  for (let entry = 0; entry < entryCount; entry += 1) {
    const id = fullBox.version === 0 ? u16be(bytes, cursor) : u32be(bytes, cursor);
    cursor += fullBox.version === 0 ? 2 : 4;
    if (id === 0 || associations[id] || cursor >= end) raise("IMAGE_FORMAT_INVALID");
    const associationCount = bytes[cursor] ?? 0;
    cursor += 1;
    const indices: number[] = [];
    for (let index = 0; index < associationCount; index += 1) {
      const encoded = wide ? u16be(bytes, cursor) : (bytes[cursor] ?? 0);
      cursor += wide ? 2 : 1;
      const propertyIndex = encoded & (wide ? 0x7fff : 0x7f);
      if (propertyIndex === 0) raise("IMAGE_FORMAT_INVALID");
      indices[indices.length] = propertyIndex;
    }
    associations[id] = indices;
  }
  if (cursor !== end) raise("IMAGE_FORMAT_INVALID");
  return associations;
}

function parseAvifLocations(
  bytes: Uint8Array,
  start: number,
  end: number,
): Record<number, AvifExtent[]> {
  const fullBox = avifFullBox(bytes, start, end);
  if (fullBox.flags !== 0 || fullBox.version > 2) raise("IMAGE_FORMAT_INVALID");
  let cursor = start + 4;
  if (cursor + 2 > end) raise("IMAGE_FORMAT_INVALID");
  const first = bytes[cursor] ?? 0;
  const second = bytes[cursor + 1] ?? 0;
  cursor += 2;
  const offsetSize = first >>> 4;
  const lengthSize = first & 0x0f;
  const baseOffsetSize = second >>> 4;
  const indexSize = fullBox.version === 0 ? 0 : second & 0x0f;
  const itemCount = fullBox.version < 2 ? u16be(bytes, cursor) : u32be(bytes, cursor);
  cursor += fullBox.version < 2 ? 2 : 4;
  if (itemCount < 1 || itemCount > 2) raise("IMAGE_MULTIFRAME_UNSUPPORTED");
  const locations = intrinsicObjectCreate(null) as Record<number, AvifExtent[]>;
  for (let item = 0; item < itemCount; item += 1) {
    const id = fullBox.version < 2 ? u16be(bytes, cursor) : u32be(bytes, cursor);
    cursor += fullBox.version < 2 ? 2 : 4;
    if (id === 0 || locations[id]) raise("IMAGE_FORMAT_INVALID");
    if (fullBox.version > 0) {
      const constructionMethod = u16be(bytes, cursor) & 0x0f;
      cursor += 2;
      if (constructionMethod !== 0) raise("IMAGE_FORMAT_INVALID");
    }
    const dataReferenceIndex = u16be(bytes, cursor);
    cursor += 2;
    if (dataReferenceIndex !== 0) raise("IMAGE_FORMAT_INVALID");
    const baseOffset = avifVariableUint(bytes, cursor, baseOffsetSize, end);
    cursor += baseOffsetSize;
    const extentCount = u16be(bytes, cursor);
    cursor += 2;
    if (extentCount < 1) raise("IMAGE_FORMAT_INVALID");
    const extents: AvifExtent[] = [];
    for (let extent = 0; extent < extentCount; extent += 1) {
      if (indexSize > 0) cursor += indexSize;
      const extentOffset = avifVariableUint(bytes, cursor, offsetSize, end);
      cursor += offsetSize;
      const extentLength = avifVariableUint(bytes, cursor, lengthSize, end);
      cursor += lengthSize;
      const extentEnd = baseOffset + extentOffset + extentLength;
      if (
        extentLength < 1 ||
        !intrinsicNumberIsSafeInteger(extentEnd) ||
        extentEnd > byteLength(bytes)
      ) {
        raise("IMAGE_FORMAT_INVALID");
      }
      extents[extents.length] = intrinsicFreeze({
        end: extentEnd,
        start: baseOffset + extentOffset,
      });
    }
    locations[id] = extents;
  }
  if (cursor !== end) raise("IMAGE_FORMAT_INVALID");
  return locations;
}

function parseAvifReferences(
  bytes: Uint8Array,
  start: number,
  end: number,
): Record<number, number> {
  const fullBox = avifFullBox(bytes, start, end);
  if (fullBox.flags !== 0 || (fullBox.version !== 0 && fullBox.version !== 1)) {
    raise("IMAGE_FORMAT_INVALID");
  }
  let cursor = start + 4;
  const references = intrinsicObjectCreate(null) as Record<number, number>;
  let referenceEntries = 0;
  while (cursor < end) {
    referenceEntries += 1;
    if (referenceEntries > 1) raise("IMAGE_MULTIFRAME_UNSUPPORTED");
    const childEnd = avifChildEnd(bytes, cursor, end);
    if (ascii4(bytes, cursor + 4) !== "auxl") raise("IMAGE_FORMAT_INVALID");
    let childCursor = cursor + 8;
    const fromId = fullBox.version === 0 ? u16be(bytes, childCursor) : u32be(bytes, childCursor);
    childCursor += fullBox.version === 0 ? 2 : 4;
    const referenceCount = u16be(bytes, childCursor);
    childCursor += 2;
    if (fromId === 0 || references[fromId] || referenceCount !== 1) {
      raise("IMAGE_FORMAT_INVALID");
    }
    const toId = fullBox.version === 0 ? u16be(bytes, childCursor) : u32be(bytes, childCursor);
    childCursor += fullBox.version === 0 ? 2 : 4;
    if (toId === 0 || childCursor !== childEnd) raise("IMAGE_FORMAT_INVALID");
    references[fromId] = toId;
    cursor = childEnd;
  }
  return references;
}

function parseAvif(bytes: Uint8Array<ArrayBuffer>): MutableInspection {
  const length = byteLength(bytes);
  if (length < 24 || !asciiAt(bytes, 4, "ftyp")) raise("IMAGE_FORMAT_INVALID");
  let boxCount = 0;
  let width = 0;
  let height = 0;
  let hasAlpha = false;
  const exifBytes = 0;
  let iccBytes = 0;
  let sawAvif = false;
  let sawFtyp = false;
  let sawMeta = false;
  let sawMdat = false;
  let mdatStart = 0;
  let mdatEnd = 0;
  let primaryItemId = 0;
  let items: AvifItem[] | undefined;
  let associations: Record<number, number[]> | undefined;
  let locations: Record<number, AvifExtent[]> | undefined;
  let references = intrinsicObjectCreate(null) as Record<number, number>;
  const properties: Array<AvifProperty | undefined> = [undefined];
  const stack: Array<{ end: number; kind: "container" | "ipco" | "root"; offset: number }> = [
    { end: length, kind: "root", offset: 0 },
  ];
  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    if (!current) raise("IMAGE_FORMAT_INVALID");
    if (current.offset === current.end) {
      stack.length -= 1;
      continue;
    }
    if (current.offset + 8 > current.end) raise("IMAGE_FORMAT_INVALID");
    const size = u32be(bytes, current.offset);
    if (size === 0 || size === 1 || size < 8) raise("IMAGE_FORMAT_INVALID");
    const end = current.offset + size;
    if (!intrinsicNumberIsSafeInteger(end) || end > current.end) raise("IMAGE_FORMAT_INVALID");
    const type = ascii4(bytes, current.offset + 4);
    const dataStart = current.offset + 8;
    current.offset = end;
    boxCount += 1;
    if (boxCount > IMAGE_LIMITS.maxChunks) raise("IMAGE_CHUNK_LIMIT");
    let propertyIndex = 0;
    if (current.kind === "ipco") {
      propertyIndex = properties.length;
      properties[propertyIndex] = intrinsicFreeze({ type });
    }
    if (type === "ftyp") {
      if (
        current.kind !== "root" ||
        boxCount !== 1 ||
        sawFtyp ||
        dataStart + 8 > end ||
        (end - dataStart) % 4 !== 0
      ) {
        raise("IMAGE_FORMAT_INVALID");
      }
      sawFtyp = true;
      for (let brandOffset = dataStart; brandOffset + 4 <= end; brandOffset += 4) {
        if (brandOffset === dataStart + 4) continue;
        const brand = ascii4(bytes, brandOffset);
        if (brand === "avis") raise("IMAGE_MULTIFRAME_UNSUPPORTED");
        if (brand === "avif") sawAvif = true;
      }
    } else if (type === "meta") {
      const fullBox = avifFullBox(bytes, dataStart, end);
      if (current.kind !== "root" || sawMeta || fullBox.version !== 0 || fullBox.flags !== 0) {
        raise("IMAGE_FORMAT_INVALID");
      }
      sawMeta = true;
      stack[stack.length] = { end, kind: "container", offset: dataStart + 4 };
    } else if (type === "iprp") {
      if (current.kind !== "container") raise("IMAGE_FORMAT_INVALID");
      stack[stack.length] = { end, kind: "container", offset: dataStart };
    } else if (type === "ipco") {
      if (current.kind !== "container") raise("IMAGE_FORMAT_INVALID");
      stack[stack.length] = { end, kind: "ipco", offset: dataStart };
    } else if (type === "pitm") {
      if (current.kind !== "container" || primaryItemId !== 0) raise("IMAGE_FORMAT_INVALID");
      primaryItemId = parseAvifPrimaryItem(bytes, dataStart, end);
    } else if (type === "iinf") {
      if (current.kind !== "container" || items) raise("IMAGE_FORMAT_INVALID");
      items = parseAvifItemInfo(bytes, dataStart, end);
    } else if (type === "ipma") {
      if (current.kind !== "container" || associations) raise("IMAGE_FORMAT_INVALID");
      associations = parseAvifAssociations(bytes, dataStart, end);
    } else if (type === "iloc") {
      if (current.kind !== "container" || locations) raise("IMAGE_FORMAT_INVALID");
      locations = parseAvifLocations(bytes, dataStart, end);
    } else if (type === "iref") {
      if (current.kind !== "container") raise("IMAGE_FORMAT_INVALID");
      references = parseAvifReferences(bytes, dataStart, end);
    } else if (type === "ispe") {
      if (current.kind !== "ipco" || end - dataStart !== 12) raise("IMAGE_FORMAT_INVALID");
      const fullBox = avifFullBox(bytes, dataStart, end);
      if (fullBox.version !== 0 || fullBox.flags !== 0) raise("IMAGE_FORMAT_INVALID");
      properties[propertyIndex] = intrinsicFreeze({
        height: u32be(bytes, dataStart + 8),
        type,
        width: u32be(bytes, dataStart + 4),
      });
    } else if (type === "auxC") {
      if (current.kind !== "ipco") raise("IMAGE_FORMAT_INVALID");
      const fullBox = avifFullBox(bytes, dataStart, end);
      const alphaType = "urn:mpeg:mpegB:cicp:systems:auxiliary:alpha";
      const typeStart = dataStart + 4;
      if (
        fullBox.version !== 0 ||
        fullBox.flags !== 0 ||
        typeStart + alphaType.length + 1 !== end ||
        !asciiAt(bytes, typeStart, alphaType) ||
        bytes[end - 1] !== 0
      ) {
        raise("IMAGE_FORMAT_INVALID");
      }
      properties[propertyIndex] = intrinsicFreeze({ isAlphaAux: true, type });
    } else if (type === "Exif") {
      raise("IMAGE_METADATA_LIMIT");
    } else if (type === "colr" && dataStart + 4 <= end) {
      const colorType = ascii4(bytes, dataStart);
      if (colorType === "prof" || colorType === "rICC") iccBytes += end - dataStart - 4;
    } else if (type === "mdat") {
      if (current.kind !== "root" || sawMdat) raise("IMAGE_FORMAT_INVALID");
      sawMdat = true;
      mdatStart = dataStart;
      mdatEnd = end;
    } else if (type === "moov" || type === "trak") {
      raise("IMAGE_MULTIFRAME_UNSUPPORTED");
    }
    if (exifBytes > IMAGE_LIMITS.maxExifBytes || iccBytes > IMAGE_LIMITS.maxIccBytes) {
      raise("IMAGE_METADATA_LIMIT");
    }
    if (stack.length >= 16) raise("IMAGE_FORMAT_INVALID");
  }
  if (
    !sawFtyp ||
    !sawAvif ||
    !sawMeta ||
    !sawMdat ||
    primaryItemId === 0 ||
    !items ||
    !associations ||
    !locations
  ) {
    raise("IMAGE_FORMAT_INVALID");
  }
  let primaryFound = false;
  let imageItems = 0;
  const itemDimensions = intrinsicObjectCreate(null) as Record<
    number,
    { readonly hasAlphaProperty: boolean; readonly height: number; readonly width: number }
  >;
  const admittedExtents: AvifExtent[] = [];
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex];
    const itemExtents = item ? locations[item.id] : undefined;
    if (!item || item.type !== "av01" || !itemExtents) raise("IMAGE_FORMAT_INVALID");
    for (let extentIndex = 0; extentIndex < itemExtents.length; extentIndex += 1) {
      const extent = itemExtents[extentIndex];
      if (!extent || extent.start < mdatStart || extent.end > mdatEnd) {
        raise("IMAGE_FORMAT_INVALID");
      }
      for (let admittedIndex = 0; admittedIndex < admittedExtents.length; admittedIndex += 1) {
        const admitted = admittedExtents[admittedIndex];
        if (admitted && extent.start < admitted.end && admitted.start < extent.end) {
          raise("IMAGE_FORMAT_INVALID");
        }
      }
      admittedExtents[admittedExtents.length] = extent;
    }
    imageItems += 1;
    if (item.id === primaryItemId) primaryFound = true;
    const itemAssociations = associations[item.id];
    if (!itemAssociations) raise("IMAGE_FORMAT_INVALID");
    let itemIspe = 0;
    let itemHasAlphaProperty = false;
    let itemWidth = 0;
    let itemHeight = 0;
    for (
      let associationIndex = 0;
      associationIndex < itemAssociations.length;
      associationIndex += 1
    ) {
      const property = properties[itemAssociations[associationIndex] ?? 0];
      if (!property) raise("IMAGE_FORMAT_INVALID");
      if (property.type === "ispe") {
        itemIspe += 1;
        itemWidth = property.width ?? 0;
        itemHeight = property.height ?? 0;
      } else if (property.type === "auxC") {
        itemHasAlphaProperty = property.isAlphaAux === true;
      }
    }
    if (itemIspe !== 1) raise("IMAGE_FORMAT_INVALID");
    checkPixelLimit(itemWidth, itemHeight, itemHasAlphaProperty);
    itemDimensions[item.id] = intrinsicFreeze({
      hasAlphaProperty: itemHasAlphaProperty,
      height: itemHeight,
      width: itemWidth,
    });
    if (item.id !== primaryItemId) {
      if (!itemHasAlphaProperty || references[item.id] !== primaryItemId) {
        raise("IMAGE_MULTIFRAME_UNSUPPORTED");
      }
      hasAlpha = true;
    } else if (itemHasAlphaProperty) {
      raise("IMAGE_FORMAT_INVALID");
    }
  }
  if (
    intrinsicReflectOwnKeys(associations).length !== items.length ||
    intrinsicReflectOwnKeys(locations).length !== items.length ||
    intrinsicReflectOwnKeys(references).length !== imageItems - 1
  ) {
    raise("IMAGE_FORMAT_INVALID");
  }
  const primaryDimensions = itemDimensions[primaryItemId];
  if (!primaryDimensions) raise("IMAGE_FORMAT_INVALID");
  width = primaryDimensions.width;
  height = primaryDimensions.height;
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex];
    const dimensions = item ? itemDimensions[item.id] : undefined;
    if (!dimensions || dimensions.width !== width || dimensions.height !== height) {
      raise("IMAGE_FORMAT_INVALID");
    }
  }
  if (!primaryFound || imageItems > 2 || width <= 0 || height <= 0) {
    raise("IMAGE_FORMAT_INVALID");
  }
  if (imageItems === 2 && !hasAlpha) raise("IMAGE_MULTIFRAME_UNSUPPORTED");
  return { exifBytes, format: "avif", frameCount: 1, hasAlpha, height, iccBytes, width };
}

function detectFormat(bytes: Uint8Array<ArrayBuffer>): ImageFormat {
  if (exactBytes(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) return "png";
  if (byteLength(bytes) >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) return "webp";
  if (asciiAt(bytes, 4, "ftyp")) return "avif";
  raise("IMAGE_FORMAT_INVALID");
}

function inspectionOutput(value: MutableInspection): ImageInspection {
  const pixels = checkPixelLimit(value.width, value.height, value.hasAlpha);
  const output = intrinsicObjectCreate(null) as Record<string, unknown>;
  output.exifBytes = value.exifBytes;
  output.format = value.format;
  output.frameCount = 1;
  output.hasAlpha = value.hasAlpha;
  output.height = value.height;
  output.iccBytes = value.iccBytes;
  output.pixels = pixels;
  output.width = value.width;
  return intrinsicFreeze(output) as unknown as ImageInspection;
}

function inspectInternal(
  input: Uint8Array<ArrayBuffer>,
  declaredFormat?: ImageFormat,
): ImageInspection {
  const detected = detectFormat(input);
  if (declaredFormat !== undefined && declaredFormat !== detected) {
    raise("IMAGE_FORMAT_MISMATCH");
  }
  const parsed =
    detected === "png"
      ? parsePng(input)
      : detected === "jpg"
        ? parseJpeg(input)
        : detected === "webp"
          ? parseWebp(input)
          : parseAvif(input);
  return inspectionOutput(parsed);
}

export function inspectImageBytes(
  input: Uint8Array,
  declaredFormat?: ImageFormat,
): ImageInspection {
  return boundarySync(() => {
    if (
      declaredFormat !== undefined &&
      declaredFormat !== "png" &&
      declaredFormat !== "jpg" &&
      declaredFormat !== "webp" &&
      declaredFormat !== "avif"
    ) {
      raise("IMAGE_FORMAT_INVALID");
    }
    return inspectInternal(
      copyBytes(input, IMAGE_LIMITS.maxInputBytes, "IMAGE_INPUT_TOO_LARGE"),
      declaredFormat,
    );
  });
}

interface SafeImageData {
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  readonly height: number;
  readonly width: number;
}

function ownData(input: object, key: string): unknown {
  const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, key);
  if (!descriptor || !("value" in descriptor)) raise("IMAGE_DATA_INVALID");
  return descriptor.value;
}

function copyImageData(input: unknown, signal?: AbortSignal): SafeImageData {
  if (input === null || typeof input !== "object") raise("IMAGE_DATA_INVALID");
  const prototype = intrinsicGetPrototypeOf(input);
  let width: unknown;
  let height: unknown;
  let rawData: unknown;
  if (intrinsicImageDataPrototype && prototype === intrinsicImageDataPrototype) {
    if (!intrinsicImageDataData || !intrinsicImageDataHeight || !intrinsicImageDataWidth) {
      raise("IMAGE_DATA_INVALID");
    }
    width = intrinsicReflectApply(intrinsicImageDataWidth, input, []);
    height = intrinsicReflectApply(intrinsicImageDataHeight, input, []);
    rawData = intrinsicReflectApply(intrinsicImageDataData, input, []);
  } else {
    if (prototype !== intrinsicObjectPrototype && prototype !== null) raise("IMAGE_DATA_INVALID");
    const keys = intrinsicReflectOwnKeys(input);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (
        typeof key !== "string" ||
        (key !== "data" && key !== "width" && key !== "height" && key !== "colorSpace")
      ) {
        raise("IMAGE_DATA_INVALID");
      }
    }
    width = ownData(input, "width");
    height = ownData(input, "height");
    rawData = ownData(input, "data");
  }
  const pixels = checkPixelLimit(width as number, height as number);
  if (
    rawData === null ||
    typeof rawData !== "object" ||
    intrinsicGetPrototypeOf(rawData) !== IntrinsicUint8ClampedArray.prototype ||
    !intrinsicTypedArrayByteLength ||
    !intrinsicTypedArrayBuffer
  ) {
    raise("IMAGE_DATA_INVALID");
  }
  const length = intrinsicReflectApply(intrinsicTypedArrayByteLength, rawData, []) as number;
  const buffer = intrinsicReflectApply(intrinsicTypedArrayBuffer, rawData, []) as unknown;
  if (
    length !== pixels * 4 ||
    intrinsicGetPrototypeOf(buffer as object) !== IntrinsicArrayBuffer.prototype ||
    !intrinsicArrayBufferByteLength
  ) {
    raise("IMAGE_DATA_INVALID");
  }
  const backingLength = intrinsicReflectApply(intrinsicArrayBufferByteLength, buffer, []) as number;
  if (
    !intrinsicNumberIsSafeInteger(backingLength) ||
    backingLength < length ||
    (intrinsicArrayBufferResizable &&
      intrinsicReflectApply(intrinsicArrayBufferResizable, buffer, []) === true)
  ) {
    raise("IMAGE_DATA_INVALID");
  }
  const data = new IntrinsicUint8ClampedArray(length);
  intrinsicReflectApply(intrinsicUint8ClampedArraySet, data, [rawData]);
  let hasAlpha = false;
  for (let offset = 3; offset < length; offset += 4) {
    if (data[offset] !== 0xff) hasAlpha = true;
    if ((offset & 0x3fff) === 3) checkAbort(signal);
  }
  if (hasAlpha && pixels > IMAGE_LIMITS.maxAlphaPixels) raise("IMAGE_ALPHA_LIMIT");
  return { data, height: height as number, width: width as number };
}

function validateQuality(quality: unknown): number {
  if (
    !intrinsicNumberIsSafeInteger(quality) ||
    (quality as number) < 1 ||
    (quality as number) > 100
  ) {
    raise("IMAGE_QUALITY_INVALID");
  }
  return quality as number;
}

function flattenForJpeg(image: SafeImageData): SafeImageData {
  const data = new IntrinsicUint8ClampedArray(image.data.length);
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset + 3] ?? 0xff;
    const inverse = 0xff - alpha;
    data[offset] = intrinsicMathFloor(((image.data[offset] ?? 0) * alpha + 0xff * inverse) / 0xff);
    data[offset + 1] = intrinsicMathFloor(
      ((image.data[offset + 1] ?? 0) * alpha + 0xff * inverse) / 0xff,
    );
    data[offset + 2] = intrinsicMathFloor(
      ((image.data[offset + 2] ?? 0) * alpha + 0xff * inverse) / 0xff,
    );
    data[offset + 3] = 0xff;
  }
  return { data, height: image.height, width: image.width };
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part) total += byteLength(part);
  }
  if (!intrinsicNumberIsSafeInteger(total) || total > IMAGE_LIMITS.maxOutputBytes) {
    raise("IMAGE_OUTPUT_TOO_LARGE");
  }
  const output = new IntrinsicUint8Array(total);
  let offset = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) continue;
    intrinsicReflectApply(intrinsicUint8ArraySet, output, [part, offset]);
    offset += byteLength(part);
  }
  return output;
}

function numberBytes(value: number): Uint8Array<ArrayBuffer> {
  return new IntrinsicUint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function asciiBytes(value: string): Uint8Array<ArrayBuffer> {
  const output = new IntrinsicUint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    output[index] = intrinsicReflectApply(intrinsicStringCharCodeAt, value, [index]) as number;
  }
  return output;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const name = asciiBytes(type);
  const body = concatenate([name, data]);
  return concatenate([
    numberBytes(byteLength(data)),
    body,
    numberBytes(crc32(body, 0, byteLength(body))),
  ]);
}

async function collectStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let cancelReader = false;
  try {
    while (true) {
      checkAbort(signal);
      const item = await waitForAbortable(reader.read(), signal);
      if (item.done) break;
      if (!(item.value instanceof IntrinsicUint8Array)) raise("IMAGE_ENCODE_FAILED");
      total += byteLength(item.value);
      if (total > IMAGE_LIMITS.maxOutputBytes) raise("IMAGE_OUTPUT_TOO_LARGE");
      chunks[chunks.length] = item.value;
    }
  } catch (error) {
    cancelReader = true;
    throw error;
  } finally {
    if (cancelReader) {
      try {
        void reader.cancel().catch(() => undefined);
      } catch {
        // The stream is already abandoned and the public error remains fixed.
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // Continue returning only the fixed conversion result.
    }
  }
  return concatenate(chunks);
}

async function encodePng(
  image: SafeImageData,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const rowBytes = image.width * 4;
  const raw = new IntrinsicUint8Array((rowBytes + 1) * image.height);
  for (let row = 0; row < image.height; row += 1) {
    const destination = row * (rowBytes + 1) + 1;
    const source = row * rowBytes;
    raw[destination - 1] = 0;
    for (let index = 0; index < rowBytes; index += 1)
      raw[destination + index] = image.data[source + index] ?? 0;
    if ((row & 0xff) === 0) checkAbort(signal);
  }
  let compressed: Uint8Array<ArrayBuffer>;
  try {
    if (typeof IntrinsicCompressionStream !== "function") raise("IMAGE_CANVAS_UNAVAILABLE");
    const compressor = new IntrinsicCompressionStream("deflate");
    const stream = new IntrinsicBlob([raw]).stream().pipeThrough(compressor);
    compressed = await collectStream(stream, signal);
  } catch (error) {
    if (error === cancelledSentinel || error === outputLimitSentinel) throw error;
    raise("IMAGE_ENCODE_FAILED");
  }
  const ihdr = concatenate([
    numberBytes(image.width),
    numberBytes(image.height),
    new IntrinsicUint8Array([8, 6, 0, 0, 0]),
  ]);
  return concatenate([
    new IntrinsicUint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new IntrinsicUint8Array()),
  ]);
}

function arrayBufferBytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (
    value === null ||
    typeof value !== "object" ||
    intrinsicGetPrototypeOf(value) !== IntrinsicArrayBuffer.prototype ||
    !intrinsicArrayBufferByteLength
  ) {
    raise("IMAGE_ENCODE_FAILED");
  }
  const length = intrinsicReflectApply(intrinsicArrayBufferByteLength, value, []) as number;
  if (length > IMAGE_LIMITS.maxOutputBytes) raise("IMAGE_OUTPUT_TOO_LARGE");
  if (!intrinsicNumberIsSafeInteger(length) || length < 1) raise("IMAGE_ENCODE_FAILED");
  const source = new IntrinsicUint8Array(value as ArrayBuffer);
  const copy = new IntrinsicUint8Array(length);
  intrinsicReflectApply(intrinsicUint8ArraySet, copy, [source]);
  return copy;
}

async function encodeInternal(
  imageInput: unknown,
  target: unknown,
  qualityInput: unknown,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  if (target !== "png" && target !== "jpg" && target !== "webp" && target !== "avif") {
    raise("IMAGE_FORMAT_INVALID");
  }
  checkAbort(signal);
  const quality = validateQuality(qualityInput);
  const image = copyImageData(imageInput, signal);
  await checkpoint(signal);
  let output: Uint8Array<ArrayBuffer>;
  try {
    if (target === "png") {
      output = await encodePng(image, signal);
    } else if (target === "avif") {
      output = arrayBufferBytes(
        await waitForAbortable(
          avifEncode(image as ImageData, {
            bitDepth: 8,
            lossless: false,
            quality,
            qualityAlpha: quality,
            speed: 6,
            subsample: 1,
          }),
          signal,
        ),
      );
    } else if (target === "webp") {
      output = arrayBufferBytes(
        await waitForAbortable(
          webpEncode(image as ImageData, {
            alpha_quality: quality,
            exact: 1,
            lossless: 0,
            method: 4,
            quality,
          }),
          signal,
        ),
      );
    } else {
      output = arrayBufferBytes(
        await waitForAbortable(
          jpegEncode(flattenForJpeg(image) as ImageData, {
            arithmetic: false,
            baseline: true,
            optimize_coding: true,
            progressive: false,
            quality,
          }),
          signal,
        ),
      );
    }
  } catch (error) {
    if (error === cancelledSentinel || error === outputLimitSentinel) throw error;
    raise("IMAGE_ENCODE_FAILED");
  }
  checkAbort(signal);
  try {
    const inspected = inspectInternal(output, target);
    if (inspected.width !== image.width || inspected.height !== image.height) {
      raise("IMAGE_ENCODE_FAILED");
    }
  } catch (error) {
    if (error === outputLimitSentinel) throw error;
    raise("IMAGE_ENCODE_FAILED");
  }
  return output;
}

export async function convertImage(
  image: ImageData,
  target: ImageFormat,
  quality: number,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  return boundary(() => encodeInternal(image, target, quality, signal));
}

function tightArrayBuffer(bytes: Uint8Array<ArrayBuffer>): ArrayBuffer {
  const copy = new IntrinsicUint8Array(byteLength(bytes));
  intrinsicReflectApply(intrinsicUint8ArraySet, copy, [bytes]);
  if (!intrinsicTypedArrayBuffer) raise("IMAGE_DECODE_FAILED");
  return intrinsicReflectApply(intrinsicTypedArrayBuffer, copy, []) as ArrayBuffer;
}

async function decodePngNative(
  bytes: Uint8Array<ArrayBuffer>,
  inspection: ImageInspection,
  signal?: AbortSignal,
): Promise<ImageData> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    raise("IMAGE_CANVAS_UNAVAILABLE");
  }
  checkAbort(signal);
  let bitmap: ImageBitmap | undefined;
  let bitmapPromise: Promise<ImageBitmap> | undefined;
  try {
    bitmapPromise = createImageBitmap(new IntrinsicBlob([bytes], { type: "image/png" }));
    try {
      bitmap = await waitForAbortable(bitmapPromise, signal);
    } catch (error) {
      if (error === cancelledSentinel) {
        void bitmapPromise.then(
          (lateBitmap) => {
            try {
              lateBitmap.close();
            } catch {
              // A late local bitmap is best-effort cleanup only.
            }
          },
          () => undefined,
        );
      }
      throw error;
    }
    checkAbort(signal);
    if (bitmap.width !== inspection.width || bitmap.height !== inspection.height) {
      raise("IMAGE_DECODE_MISMATCH");
    }
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) raise("IMAGE_CANVAS_UNAVAILABLE");
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  } catch (error) {
    if (
      error === cancelledSentinel ||
      error === canvasSentinel ||
      error === decodeMismatchSentinel
    ) {
      throw error;
    }
    raise("IMAGE_DECODE_FAILED");
  } finally {
    try {
      bitmap?.close();
    } catch {
      // The bitmap is local and cleanup errors are not observable by callers.
    }
  }
  raise("IMAGE_DECODE_FAILED");
}

async function decodeInternal(
  bytes: Uint8Array<ArrayBuffer>,
  inspection: ImageInspection,
  signal?: AbortSignal,
): Promise<SafeImageData> {
  let decoded: unknown;
  try {
    const buffer = tightArrayBuffer(bytes);
    if (inspection.format === "jpg") {
      decoded = await waitForAbortable(jpegDecode(buffer, { preserveOrientation: false }), signal);
    } else if (inspection.format === "webp") {
      decoded = await waitForAbortable(webpDecode(buffer), signal);
    } else if (inspection.format === "avif") {
      decoded = await waitForAbortable(avifDecode(buffer, { bitDepth: 8 }), signal);
    } else {
      decoded = await decodePngNative(bytes, inspection, signal);
    }
  } catch (error) {
    if (
      error === cancelledSentinel ||
      error === canvasSentinel ||
      error === decodeMismatchSentinel
    ) {
      throw error;
    }
    raise("IMAGE_DECODE_FAILED");
  }
  checkAbort(signal);
  const image = copyImageData(decoded, signal);
  if (image.width !== inspection.width || image.height !== inspection.height) {
    raise("IMAGE_DECODE_MISMATCH");
  }
  return image;
}

async function convertEncodedInternal(
  input: unknown,
  inputFormat: unknown,
  outputFormat: unknown,
  quality: unknown,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  if (
    (inputFormat !== "png" &&
      inputFormat !== "jpg" &&
      inputFormat !== "webp" &&
      inputFormat !== "avif") ||
    (outputFormat !== "png" &&
      outputFormat !== "jpg" &&
      outputFormat !== "webp" &&
      outputFormat !== "avif")
  ) {
    raise("IMAGE_FORMAT_INVALID");
  }
  checkAbort(signal);
  const bytes = copyBytes(input, IMAGE_LIMITS.maxInputBytes, "IMAGE_INPUT_TOO_LARGE");
  const inspection = inspectInternal(bytes, inputFormat);
  await checkpoint(signal);
  const decoded = await decodeInternal(bytes, inspection, signal);
  await checkpoint(signal);
  return encodeInternal(decoded, outputFormat, quality, signal);
}

export async function convertEncodedImage(
  input: Uint8Array,
  inputFormat: ImageFormat,
  outputFormat: ImageFormat,
  quality: number,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  return boundary(() => convertEncodedInternal(input, inputFormat, outputFormat, quality, signal));
}

function mediaType(format: ImageFormat): string {
  switch (format) {
    case "png":
      return "image/png";
    case "jpg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
  }
  raise("IMAGE_FORMAT_INVALID");
}

export async function dispatchImageConversion(
  request: LocalConversionRequest,
  signal?: AbortSignal,
): Promise<LocalWorkerOutput> {
  if (request.operation !== "image.convert") {
    throw new IntrinsicError("LOCAL_OPERATION_NOT_IMPLEMENTED");
  }
  const input = request.inputFormat;
  const output = request.outputFormat;
  if (
    (input !== "png" && input !== "jpg" && input !== "webp" && input !== "avif") ||
    (output !== "png" && output !== "jpg" && output !== "webp" && output !== "avif")
  ) {
    throw new IntrinsicError("IMAGE_FORMAT_INVALID");
  }
  const bytes = await convertEncodedImage(
    request.bytes,
    input,
    output,
    request.options.quality ?? 80,
    signal,
  );
  const result = intrinsicObjectCreate(null) as { bytes: Uint8Array; mediaType: string };
  result.bytes = bytes;
  result.mediaType = mediaType(output);
  return intrinsicFreeze(result);
}
