import mammoth from "mammoth";
import type { LocalConversionRequest } from "../protocol.js";
import { convertSemanticText } from "../text/convertText.js";
import { normalizeTextSource } from "../text/semanticDocument.js";
import type { LocalWorkerOutput } from "../worker.js";

const MiB = 1024 * 1024;
const DOCX_LIMITS = Object.freeze({
  __proto__: null,
  maxCompressionRatio: 100,
  maxEntries: 1_024,
  maxEntryBytes: 16 * MiB,
  maxInputBytes: 25 * MiB,
  maxTotalUncompressedBytes: 64 * MiB,
  maxXmlBytes: 6 * MiB,
  maxTotalXmlBytes: 20 * MiB,
});

type DocxOutput = "html" | "md" | "txt";
type DocxFailureCode =
  | "LOCAL_CONVERSION_CANCELLED"
  | "LOCAL_DOCX_CONVERSION_FAILED"
  | "LOCAL_DOCX_FORMAT_INVALID"
  | "LOCAL_DOCX_INVALID"
  | "LOCAL_DOCX_LIMIT_EXCEEDED"
  | "LOCAL_DOCX_SECURITY_VIOLATION";

interface ZipEntry {
  readonly compressedSize: number;
  readonly crc32: number;
  readonly dataEnd: number;
  readonly dataStart: number;
  readonly flags: number;
  readonly localOffset: number;
  readonly method: number;
  readonly name: string;
  readonly uncompressedSize: number;
}

const IntrinsicArrayBuffer = ArrayBuffer;
const IntrinsicAbortSignal = AbortSignal;
const IntrinsicDataView = DataView;
const IntrinsicError = Error;
const IntrinsicEventTarget = EventTarget;
const IntrinsicMap = Map;
const IntrinsicSet = Set;
const IntrinsicTextDecoder = TextDecoder;
const IntrinsicTextEncoder = TextEncoder;
const IntrinsicUint8Array = Uint8Array;
const intrinsicArrayBufferByteLength = Reflect.getOwnPropertyDescriptor(
  IntrinsicArrayBuffer.prototype,
  "byteLength",
)?.get;
const intrinsicArrayBufferResizable = Reflect.getOwnPropertyDescriptor(
  IntrinsicArrayBuffer.prototype,
  "resizable",
)?.get;
const intrinsicArrayBufferSlice = IntrinsicArrayBuffer.prototype.slice;
const intrinsicAbortSignalAborted = Reflect.getOwnPropertyDescriptor(
  IntrinsicAbortSignal.prototype,
  "aborted",
)?.get;
const intrinsicArrayMap = Array.prototype.map;
const intrinsicArrayPush = Array.prototype.push;
const intrinsicArraySort = Array.prototype.sort;
const intrinsicDataViewByteLength = Reflect.getOwnPropertyDescriptor(
  IntrinsicDataView.prototype,
  "byteLength",
)?.get;
const intrinsicDataViewGetUint16 = IntrinsicDataView.prototype.getUint16;
const intrinsicDataViewGetUint32 = IntrinsicDataView.prototype.getUint32;
const intrinsicEventTargetAddEventListener = IntrinsicEventTarget.prototype.addEventListener;
const intrinsicEventTargetRemoveEventListener = IntrinsicEventTarget.prototype.removeEventListener;
const intrinsicFreeze = Object.freeze;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicMapGet = IntrinsicMap.prototype.get;
const intrinsicMapSet = IntrinsicMap.prototype.set;
const intrinsicMathMax = Math.max;
const intrinsicNumberParseInt = Number.parseInt;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicObjectCreate = Object.create;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicRegExpExec = RegExp.prototype.exec;
const intrinsicRegExpTest = RegExp.prototype.test;
const intrinsicSetAdd = IntrinsicSet.prototype.add;
const intrinsicSetHas = IntrinsicSet.prototype.has;
const intrinsicStringEndsWith = String.prototype.endsWith;
const intrinsicStringFromCodePoint = String.fromCodePoint;
const intrinsicStringIncludes = String.prototype.includes;
const intrinsicStringIndexOf = String.prototype.indexOf;
const intrinsicStringLastIndexOf = String.prototype.lastIndexOf;
const intrinsicStringNormalize = String.prototype.normalize;
const intrinsicStringReplace = String.prototype.replace;
const intrinsicStringSlice = String.prototype.slice;
const intrinsicStringSplit = String.prototype.split;
const intrinsicStringStartsWith = String.prototype.startsWith;
const intrinsicStringToLowerCase = String.prototype.toLowerCase;
const intrinsicStringTrim = String.prototype.trim;
const intrinsicTextDecode = IntrinsicTextDecoder.prototype.decode;
const intrinsicTextEncode = IntrinsicTextEncoder.prototype.encode;
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
const intrinsicUint8ArraySlice = IntrinsicUint8Array.prototype.slice;
const intrinsicUint8ArraySet = IntrinsicUint8Array.prototype.set;

const cancelledSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const conversionSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const formatSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const invalidSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const limitSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const securitySentinel = intrinsicFreeze(intrinsicObjectCreate(null));

function fail(code: DocxFailureCode): never {
  switch (code) {
    case "LOCAL_CONVERSION_CANCELLED":
      throw cancelledSentinel;
    case "LOCAL_DOCX_CONVERSION_FAILED":
      throw conversionSentinel;
    case "LOCAL_DOCX_FORMAT_INVALID":
      throw formatSentinel;
    case "LOCAL_DOCX_INVALID":
      throw invalidSentinel;
    case "LOCAL_DOCX_LIMIT_EXCEEDED":
      throw limitSentinel;
    case "LOCAL_DOCX_SECURITY_VIOLATION":
      throw securitySentinel;
  }
}

function arrayPush<T>(target: T[], value: T): void {
  intrinsicReflectApply(intrinsicArrayPush, target, [value]);
}

function arrayMap<T, U>(target: readonly T[], mapper: (value: T, index: number) => U): U[] {
  return intrinsicReflectApply(intrinsicArrayMap, target, [mapper]) as U[];
}

function arraySort<T>(target: T[], compare: (left: T, right: T) => number): T[] {
  return intrinsicReflectApply(intrinsicArraySort, target, [compare]) as T[];
}

function stringEndsWith(value: string, suffix: string): boolean {
  return intrinsicReflectApply(intrinsicStringEndsWith, value, [suffix]) as boolean;
}

function stringIncludes(value: string, search: string): boolean {
  return intrinsicReflectApply(intrinsicStringIncludes, value, [search]) as boolean;
}

function stringIndexOf(value: string, search: string, position?: number): number {
  return intrinsicReflectApply(
    intrinsicStringIndexOf,
    value,
    position === undefined ? [search] : [search, position],
  ) as number;
}

function stringLastIndexOf(value: string, search: string): number {
  return intrinsicReflectApply(intrinsicStringLastIndexOf, value, [search]) as number;
}

function stringNormalize(value: string): string {
  return intrinsicReflectApply(intrinsicStringNormalize, value, ["NFKC"]) as string;
}

function stringReplace(value: string, search: string | RegExp, replacement: unknown): string {
  return intrinsicReflectApply(intrinsicStringReplace, value, [search, replacement]) as string;
}

function stringSlice(value: string, start: number, end?: number): string {
  return intrinsicReflectApply(
    intrinsicStringSlice,
    value,
    end === undefined ? [start] : [start, end],
  ) as string;
}

function stringSplit(value: string, separator: string): string[] {
  return intrinsicReflectApply(intrinsicStringSplit, value, [separator]) as string[];
}

function stringStartsWith(value: string, prefix: string, position?: number): boolean {
  return intrinsicReflectApply(
    intrinsicStringStartsWith,
    value,
    position === undefined ? [prefix] : [prefix, position],
  ) as boolean;
}

function stringToLowerCase(value: string): string {
  return intrinsicReflectApply(intrinsicStringToLowerCase, value, []) as string;
}

function stringTrim(value: string): string {
  return intrinsicReflectApply(intrinsicStringTrim, value, []) as string;
}

function regExpTest(expression: RegExp, value: string): boolean {
  return intrinsicReflectApply(intrinsicRegExpTest, expression, [value]) as boolean;
}

function signalAborted(signal?: AbortSignal): boolean {
  if (!signal) return false;
  if (!intrinsicAbortSignalAborted) fail("LOCAL_DOCX_CONVERSION_FAILED");
  try {
    return intrinsicReflectApply(intrinsicAbortSignalAborted, signal, []) === true;
  } catch {
    fail("LOCAL_DOCX_CONVERSION_FAILED");
  }
}

function publicSignalAborted(signal?: AbortSignal): boolean {
  try {
    return signalAborted(signal);
  } catch {
    return false;
  }
}

function publicError(error: unknown, signal?: AbortSignal): Error {
  if (error === cancelledSentinel || publicSignalAborted(signal)) {
    return new IntrinsicError("LOCAL_CONVERSION_CANCELLED");
  }
  if (error === formatSentinel) return new IntrinsicError("LOCAL_DOCX_FORMAT_INVALID");
  if (error === invalidSentinel) return new IntrinsicError("LOCAL_DOCX_INVALID");
  if (error === limitSentinel) return new IntrinsicError("LOCAL_DOCX_LIMIT_EXCEEDED");
  if (error === securitySentinel) return new IntrinsicError("LOCAL_DOCX_SECURITY_VIOLATION");
  return new IntrinsicError("LOCAL_DOCX_CONVERSION_FAILED");
}

async function docxBoundary<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw publicError(error, signal);
  }
}

function checkAbort(signal?: AbortSignal): void {
  if (signalAborted(signal)) fail("LOCAL_CONVERSION_CANCELLED");
}

async function checkpoint(signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  await Promise.resolve();
  checkAbort(signal);
}

function byteLength(bytes: Uint8Array): number {
  if (!intrinsicTypedArrayByteLength) fail("LOCAL_DOCX_INVALID");
  return intrinsicReflectApply(intrinsicTypedArrayByteLength, bytes, []) as number;
}

function byteOffset(bytes: Uint8Array): number {
  if (!intrinsicTypedArrayByteOffset) fail("LOCAL_DOCX_INVALID");
  return intrinsicReflectApply(intrinsicTypedArrayByteOffset, bytes, []) as number;
}

function bytesBuffer(bytes: Uint8Array): ArrayBuffer {
  if (!intrinsicTypedArrayBuffer) fail("LOCAL_DOCX_INVALID");
  return intrinsicReflectApply(intrinsicTypedArrayBuffer, bytes, []) as ArrayBuffer;
}

function bytesSlice(
  bytes: Uint8Array<ArrayBuffer>,
  start: number,
  end?: number,
): Uint8Array<ArrayBuffer> {
  return intrinsicReflectApply(
    intrinsicUint8ArraySlice,
    bytes,
    end === undefined ? [start] : [start, end],
  ) as Uint8Array<ArrayBuffer>;
}

function setBytes(target: Uint8Array, source: Uint8Array, offset = 0): void {
  intrinsicReflectApply(intrinsicUint8ArraySet, target, [source, offset]);
}

function copyInput(input: unknown): Uint8Array<ArrayBuffer> {
  if (
    input === null ||
    typeof input !== "object" ||
    intrinsicGetPrototypeOf(input) !== IntrinsicUint8Array.prototype ||
    !intrinsicTypedArrayBuffer ||
    !intrinsicTypedArrayByteLength ||
    !intrinsicArrayBufferByteLength
  ) {
    fail("LOCAL_DOCX_INVALID");
  }
  const length = intrinsicReflectApply(intrinsicTypedArrayByteLength, input, []) as number;
  const buffer = intrinsicReflectApply(intrinsicTypedArrayBuffer, input, []) as unknown;
  if (
    !intrinsicNumberIsSafeInteger(length) ||
    length <= 0 ||
    intrinsicGetPrototypeOf(buffer as object) !== IntrinsicArrayBuffer.prototype
  ) {
    fail("LOCAL_DOCX_INVALID");
  }
  if (length > DOCX_LIMITS.maxInputBytes) fail("LOCAL_DOCX_LIMIT_EXCEEDED");
  const bufferLength = intrinsicReflectApply(intrinsicArrayBufferByteLength, buffer, []) as number;
  if (!intrinsicNumberIsSafeInteger(bufferLength) || bufferLength < length) {
    fail("LOCAL_DOCX_INVALID");
  }
  if (
    intrinsicArrayBufferResizable &&
    intrinsicReflectApply(intrinsicArrayBufferResizable, buffer, []) === true
  ) {
    fail("LOCAL_DOCX_INVALID");
  }
  const copy = new IntrinsicUint8Array(length);
  intrinsicReflectApply(intrinsicUint8ArraySet, copy, [input]);
  return copy;
}

function view(bytes: Uint8Array<ArrayBuffer>): DataView {
  return new IntrinsicDataView(bytesBuffer(bytes), byteOffset(bytes), byteLength(bytes));
}

function dataViewLength(data: DataView): number {
  if (!intrinsicDataViewByteLength) fail("LOCAL_DOCX_INVALID");
  return intrinsicReflectApply(intrinsicDataViewByteLength, data, []) as number;
}

function readU16(data: DataView, offset: number, end = dataViewLength(data)): number {
  if (!intrinsicNumberIsSafeInteger(offset) || offset < 0 || offset + 2 > end) {
    fail("LOCAL_DOCX_INVALID");
  }
  return intrinsicReflectApply(intrinsicDataViewGetUint16, data, [offset, true]) as number;
}

function readU32(data: DataView, offset: number, end = dataViewLength(data)): number {
  if (!intrinsicNumberIsSafeInteger(offset) || offset < 0 || offset + 4 > end) {
    fail("LOCAL_DOCX_INVALID");
  }
  return intrinsicReflectApply(intrinsicDataViewGetUint32, data, [offset, true]) as number;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (byteLength(left) !== byteLength(right)) return false;
  for (let index = 0; index < byteLength(left); index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function strictUtf8(bytes: Uint8Array): string {
  try {
    return intrinsicReflectApply(
      intrinsicTextDecode,
      new IntrinsicTextDecoder("utf-8", { fatal: true, ignoreBOM: false }),
      [bytes],
    ) as string;
  } catch {
    fail("LOCAL_DOCX_INVALID");
  }
}

function validateExtra(extra: Uint8Array<ArrayBuffer>): void {
  const data = view(extra);
  let offset = 0;
  const length = byteLength(extra);
  while (offset < length) {
    if (offset + 4 > length) fail("LOCAL_DOCX_INVALID");
    const id = readU16(data, offset);
    const size = readU16(data, offset + 2);
    if (id === 0x0001) fail("LOCAL_DOCX_INVALID");
    offset += 4;
    if (offset + size > length) fail("LOCAL_DOCX_INVALID");
    offset += size;
  }
}

function safeEntryName(name: string): string {
  let normalized: string;
  try {
    normalized = stringNormalize(name);
  } catch {
    fail("LOCAL_DOCX_INVALID");
  }
  if (
    normalized.length === 0 ||
    stringIncludes(normalized, "\0") ||
    stringIncludes(normalized, "\\") ||
    stringStartsWith(normalized, "/") ||
    regExpTest(/^[a-z]:\//iu, normalized)
  ) {
    fail("LOCAL_DOCX_SECURITY_VIOLATION");
  }
  const segments = stringSplit(normalized, "/");
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] ?? "";
    if (
      segment === "." ||
      segment === ".." ||
      (segment.length === 0 && index < segments.length - 1)
    ) {
      fail("LOCAL_DOCX_SECURITY_VIOLATION");
    }
  }
  return normalized;
}

function isXmlEntry(name: string): boolean {
  const lower = stringToLowerCase(name);
  return stringEndsWith(lower, ".xml") || stringEndsWith(lower, ".rels");
}

function rejectDangerousEntryName(name: string): void {
  const lower = stringToLowerCase(name);
  if (
    regExpTest(/(^|\/)embeddings\//u, lower) ||
    regExpTest(/(^|\/)activex\//u, lower) ||
    regExpTest(/(^|\/)vbaproject(?:signature)?\.bin$/u, lower) ||
    regExpTest(/(^|\/)(?:vba|macros?)(?:\/|\.)/u, lower) ||
    regExpTest(/(^|\/)afchunk[^/]*$/u, lower)
  ) {
    fail("LOCAL_DOCX_SECURITY_VIOLATION");
  }
}

function findEocd(bytes: Uint8Array<ArrayBuffer>, data: DataView): number {
  const length = byteLength(bytes);
  const minimum = intrinsicReflectApply(intrinsicMathMax, Math, [0, length - 65_557]) as number;
  for (let offset = length - 22; offset >= minimum; offset -= 1) {
    if (readU32(data, offset) !== 0x06054b50) continue;
    const commentLength = readU16(data, offset + 20);
    if (offset + 22 + commentLength === length) return offset;
  }
  fail("LOCAL_DOCX_INVALID");
}

function parseArchive(bytes: Uint8Array<ArrayBuffer>, signal?: AbortSignal): ZipEntry[] {
  checkAbort(signal);
  const data = view(bytes);
  const eocd = findEocd(bytes, data);
  if (
    readU16(data, eocd + 4) !== 0 ||
    readU16(data, eocd + 6) !== 0 ||
    readU16(data, eocd + 8) !== readU16(data, eocd + 10)
  ) {
    fail("LOCAL_DOCX_INVALID");
  }
  const count = readU16(data, eocd + 10);
  const centralSize = readU32(data, eocd + 12);
  const centralOffset = readU32(data, eocd + 16);
  if (
    count === 0 ||
    count === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    fail("LOCAL_DOCX_INVALID");
  }
  if (count > DOCX_LIMITS.maxEntries) fail("LOCAL_DOCX_LIMIT_EXCEEDED");
  if (centralOffset + centralSize !== eocd) fail("LOCAL_DOCX_INVALID");
  if (eocd >= 20 && readU32(data, eocd - 20) === 0x07064b50) fail("LOCAL_DOCX_INVALID");

  const entries: ZipEntry[] = [];
  const names = new IntrinsicSet<string>();
  let offset = centralOffset;
  let totalUncompressed = 0;
  let totalXml = 0;

  for (let index = 0; index < count; index += 1) {
    checkAbort(signal);
    if (readU32(data, offset, eocd) !== 0x02014b50 || offset + 46 > eocd) {
      fail("LOCAL_DOCX_INVALID");
    }
    const versionMadeBy = readU16(data, offset + 4, eocd);
    const flags = readU16(data, offset + 8, eocd);
    const method = readU16(data, offset + 10, eocd);
    const crc = readU32(data, offset + 16, eocd);
    const compressedSize = readU32(data, offset + 20, eocd);
    const uncompressedSize = readU32(data, offset + 24, eocd);
    const nameLength = readU16(data, offset + 28, eocd);
    const extraLength = readU16(data, offset + 30, eocd);
    const commentLength = readU16(data, offset + 32, eocd);
    const disk = readU16(data, offset + 34, eocd);
    const externalAttributes = readU32(data, offset + 38, eocd);
    const localOffset = readU32(data, offset + 42, eocd);
    const recordEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (
      recordEnd > eocd ||
      disk !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff
    ) {
      fail("LOCAL_DOCX_INVALID");
    }
    if ((flags & 0x2049) !== 0 || (method !== 0 && method !== 8)) {
      fail("LOCAL_DOCX_INVALID");
    }
    const nameBytes = bytesSlice(bytes, offset + 46, offset + 46 + nameLength);
    const name = safeEntryName(strictUtf8(nameBytes));
    const folded = stringToLowerCase(name);
    if (intrinsicReflectApply(intrinsicSetHas, names, [folded]) as boolean) {
      fail("LOCAL_DOCX_SECURITY_VIOLATION");
    }
    intrinsicReflectApply(intrinsicSetAdd, names, [folded]);
    rejectDangerousEntryName(name);
    validateExtra(
      bytesSlice(bytes, offset + 46 + nameLength, offset + 46 + nameLength + extraLength),
    );
    const unixMode = externalAttributes >>> 16;
    const host = versionMadeBy >>> 8;
    if ((host === 3 || host === 19) && (unixMode & 0xf000) === 0xa000) {
      fail("LOCAL_DOCX_SECURITY_VIOLATION");
    }

    if (uncompressedSize > DOCX_LIMITS.maxEntryBytes) fail("LOCAL_DOCX_LIMIT_EXCEEDED");
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > DOCX_LIMITS.maxTotalUncompressedBytes) {
      fail("LOCAL_DOCX_LIMIT_EXCEEDED");
    }
    if (
      (compressedSize === 0 && uncompressedSize > 0) ||
      uncompressedSize > compressedSize * DOCX_LIMITS.maxCompressionRatio
    ) {
      fail("LOCAL_DOCX_LIMIT_EXCEEDED");
    }
    if (isXmlEntry(name)) {
      if (uncompressedSize > DOCX_LIMITS.maxXmlBytes) fail("LOCAL_DOCX_LIMIT_EXCEEDED");
      totalXml += uncompressedSize;
      if (totalXml > DOCX_LIMITS.maxTotalXmlBytes) fail("LOCAL_DOCX_LIMIT_EXCEEDED");
    }
    if (method === 0 && compressedSize !== uncompressedSize) fail("LOCAL_DOCX_INVALID");

    if (
      localOffset + 30 > centralOffset ||
      readU32(data, localOffset, centralOffset) !== 0x04034b50
    ) {
      fail("LOCAL_DOCX_INVALID");
    }
    const localFlags = readU16(data, localOffset + 6, centralOffset);
    const localMethod = readU16(data, localOffset + 8, centralOffset);
    const localCrc = readU32(data, localOffset + 14, centralOffset);
    const localCompressedSize = readU32(data, localOffset + 18, centralOffset);
    const localUncompressedSize = readU32(data, localOffset + 22, centralOffset);
    const localNameLength = readU16(data, localOffset + 26, centralOffset);
    const localExtraLength = readU16(data, localOffset + 28, centralOffset);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (
      localFlags !== flags ||
      localMethod !== method ||
      localCrc !== crc ||
      localCompressedSize !== compressedSize ||
      localUncompressedSize !== uncompressedSize ||
      dataStart > centralOffset ||
      dataEnd > centralOffset
    ) {
      fail("LOCAL_DOCX_INVALID");
    }
    const localNameBytes = bytesSlice(bytes, localOffset + 30, localOffset + 30 + localNameLength);
    if (!equalBytes(localNameBytes, nameBytes)) fail("LOCAL_DOCX_INVALID");
    validateExtra(
      bytesSlice(
        bytes,
        localOffset + 30 + localNameLength,
        localOffset + 30 + localNameLength + localExtraLength,
      ),
    );

    arrayPush(entries, {
      compressedSize,
      crc32: crc,
      dataEnd,
      dataStart,
      flags,
      localOffset,
      method,
      name,
      uncompressedSize,
    });
    offset = recordEnd;
  }
  if (offset !== eocd) fail("LOCAL_DOCX_INVALID");

  const spans = arraySort(
    arrayMap(entries, (entry) => ({ end: entry.dataEnd, start: entry.localOffset })),
    (left, right) => left.start - right.start,
  );
  for (let index = 1; index < spans.length; index += 1) {
    const previous = spans[index - 1];
    const current = spans[index];
    if (previous && current && current.start < previous.end) fail("LOCAL_DOCX_INVALID");
  }
  return entries;
}

function calculateCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  const length = byteLength(bytes);
  for (let index = 0; index < length; index += 1) {
    crc ^= bytes[index] ?? 0;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function waitForAbortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  checkAbort(signal);
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(cancelledSentinel);
    intrinsicReflectApply(intrinsicEventTargetAddEventListener, signal, [
      "abort",
      onAbort,
      {
        once: true,
      },
    ]);
    promise.then(
      (value) => {
        intrinsicReflectApply(intrinsicEventTargetRemoveEventListener, signal, ["abort", onAbort]);
        if (signalAborted(signal)) reject(cancelledSentinel);
        else resolve(value);
      },
      (error: unknown) => {
        intrinsicReflectApply(intrinsicEventTargetRemoveEventListener, signal, ["abort", onAbort]);
        reject(error);
      },
    );
  });
}

async function inflateEntry(
  archive: Uint8Array<ArrayBuffer>,
  entry: ZipEntry,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const compressed = bytesSlice(archive, entry.dataStart, entry.dataEnd);
  if (entry.method === 0) return compressed;
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    const stream = new Blob([compressed])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    reader = stream.getReader();
  } catch {
    fail("LOCAL_DOCX_INVALID");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let complete = false;
  try {
    while (true) {
      checkAbort(signal);
      const result = await waitForAbortable(reader.read(), signal);
      if (result.done) break;
      const chunk = result.value;
      total += byteLength(chunk);
      if (total > entry.uncompressedSize || total > DOCX_LIMITS.maxEntryBytes) {
        fail("LOCAL_DOCX_LIMIT_EXCEEDED");
      }
      arrayPush(chunks, chunk);
    }
    complete = true;
  } catch (error) {
    try {
      void reader.cancel().catch(() => undefined);
    } catch {
      // Cancellation is best-effort; preserve only the fixed conversion failure.
    }
    if (error === cancelledSentinel || error === limitSentinel) throw error;
    fail("LOCAL_DOCX_INVALID");
  } finally {
    if (complete) reader.releaseLock();
  }
  if (total !== entry.uncompressedSize) fail("LOCAL_DOCX_INVALID");
  const output = new IntrinsicUint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    setBytes(output, chunk, offset);
    offset += byteLength(chunk);
  }
  return output;
}

function decodeXmlAttribute(value: string): string {
  return stringReplace(
    value,
    /&(?:#x([0-9a-f]+)|#([0-9]+)|amp|apos|gt|lt|quot);/giu,
    (entity: string, hex: string | undefined, decimal: string | undefined) => {
      if (hex !== undefined) {
        return intrinsicReflectApply(intrinsicStringFromCodePoint, String, [
          intrinsicReflectApply(intrinsicNumberParseInt, Number, [hex, 16]),
        ]) as string;
      }
      if (decimal !== undefined) {
        return intrinsicReflectApply(intrinsicStringFromCodePoint, String, [
          intrinsicReflectApply(intrinsicNumberParseInt, Number, [decimal, 10]),
        ]) as string;
      }
      switch (stringToLowerCase(entity)) {
        case "&amp;":
          return "&";
        case "&apos;":
          return "'";
        case "&gt;":
          return ">";
        case "&lt;":
          return "<";
        case "&quot;":
          return '"';
        default:
          fail("LOCAL_DOCX_INVALID");
      }
    },
  );
}

function relationshipAttributes(tag: string): Map<string, string> {
  const attributes = new IntrinsicMap<string, string>();
  const withoutName = stringReplace(tag, /^<\s*(?:[\w.-]+:)?relationship\b/iu, "");
  const body = stringReplace(withoutName, /\/?>\s*$/u, "");
  const expression = /([\w.-]+(?::[\w.-]+)?)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu;
  let match = intrinsicReflectApply(intrinsicRegExpExec, expression, [
    body,
  ]) as RegExpExecArray | null;
  while (match !== null) {
    const key = stringToLowerCase(match[1] ?? "");
    intrinsicReflectApply(intrinsicMapSet, attributes, [
      key,
      decodeXmlAttribute(match[2] ?? match[3] ?? ""),
    ]);
    match = intrinsicReflectApply(intrinsicRegExpExec, expression, [
      body,
    ]) as RegExpExecArray | null;
  }
  return attributes;
}

function xmlTagsByLocalName(source: string, expectedLocalName: string): string[] {
  const tags: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = stringIndexOf(source, "<", cursor);
    if (start < 0) break;
    if (stringStartsWith(source, "<!--", start)) {
      const end = stringIndexOf(source, "-->", start + 4);
      if (end < 0) fail("LOCAL_DOCX_INVALID");
      cursor = end + 3;
      continue;
    }
    if (stringStartsWith(source, "<![CDATA[", start)) {
      const end = stringIndexOf(source, "]]>", start + 9);
      if (end < 0) fail("LOCAL_DOCX_INVALID");
      cursor = end + 3;
      continue;
    }
    if (stringStartsWith(source, "<?", start)) {
      const end = stringIndexOf(source, "?>", start + 2);
      if (end < 0) fail("LOCAL_DOCX_INVALID");
      cursor = end + 2;
      continue;
    }

    let nameStart = start + 1;
    const closing = source[nameStart] === "/";
    if (closing) nameStart += 1;
    while (regExpTest(/\s/u, source[nameStart] ?? "")) nameStart += 1;
    let nameEnd = nameStart;
    while (regExpTest(/[\w.:-]/u, source[nameEnd] ?? "")) nameEnd += 1;
    if (nameEnd === nameStart) fail("LOCAL_DOCX_INVALID");

    let quote = "";
    let end = nameEnd;
    for (; end < source.length; end += 1) {
      const character = source[end] ?? "";
      if (quote.length > 0) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      } else if (character === "<") {
        fail("LOCAL_DOCX_INVALID");
      }
    }
    if (end >= source.length || quote.length > 0) fail("LOCAL_DOCX_INVALID");
    const qualifiedName = stringToLowerCase(stringSlice(source, nameStart, nameEnd));
    const localName = stringSlice(qualifiedName, stringLastIndexOf(qualifiedName, ":") + 1);
    if (!closing && localName === expectedLocalName) {
      arrayPush(tags, stringSlice(source, start, end + 1));
    }
    cursor = end + 1;
  }
  return tags;
}

function inspectXml(name: string, source: string): void {
  const lower = stringToLowerCase(source);
  if (
    stringIncludes(lower, "<!doctype") ||
    stringIncludes(lower, "<!entity") ||
    stringIncludes(lower, "<xi:include")
  ) {
    fail("LOCAL_DOCX_SECURITY_VIOLATION");
  }
  if (xmlTagsByLocalName(source, "altchunk").length > 0) {
    fail("LOCAL_DOCX_SECURITY_VIOLATION");
  }
  if (stringToLowerCase(name) === "[content_types].xml") {
    const decodedContentTypes = decodeXmlAttribute(source);
    if (
      regExpTest(
        /macroenabled|vbaproject|oleobject|activex|attachedtoolbars|application\/vnd\.ms-office/iu,
        decodedContentTypes,
      )
    ) {
      fail("LOCAL_DOCX_SECURITY_VIOLATION");
    }
  }
  if (!stringEndsWith(stringToLowerCase(name), ".rels")) return;
  const tags = xmlTagsByLocalName(source, "relationship");
  for (const tag of tags) {
    const attributes = relationshipAttributes(tag);
    const rawMode = intrinsicReflectApply(intrinsicMapGet, attributes, ["targetmode"]) as
      | string
      | undefined;
    const rawTarget = intrinsicReflectApply(intrinsicMapGet, attributes, ["target"]) as
      | string
      | undefined;
    const rawType = intrinsicReflectApply(intrinsicMapGet, attributes, ["type"]) as
      | string
      | undefined;
    const mode = rawMode === undefined ? undefined : stringToLowerCase(stringTrim(rawMode));
    const target = rawTarget === undefined ? "" : stringNormalize(stringTrim(rawTarget));
    const type = rawType === undefined ? "" : stringToLowerCase(stringTrim(rawType));
    const suffixStart =
      (intrinsicReflectApply(intrinsicMathMax, Math, [
        stringLastIndexOf(type, "/"),
        stringLastIndexOf(type, "#"),
      ]) as number) + 1;
    const suffix = stringSlice(type, suffixStart);
    if (
      mode === "external" ||
      stringStartsWith(target, "//") ||
      stringStartsWith(target, "\\\\") ||
      regExpTest(/^[a-z][a-z0-9+.-]*:/iu, target) ||
      suffix === "vbaproject" ||
      suffix === "oleobject" ||
      suffix === "activex" ||
      suffix === "activexcontrol" ||
      suffix === "activexcontrolbinary" ||
      suffix === "control" ||
      suffix === "attachedtemplate" ||
      suffix === "afchunk"
    ) {
      fail("LOCAL_DOCX_SECURITY_VIOLATION");
    }
  }
}

async function preflight(archive: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<void> {
  const entries = parseArchive(archive, signal);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || stringEndsWith(entry.name, "/")) continue;
    await checkpoint(signal);
    const decompressed = await inflateEntry(archive, entry, signal);
    if (
      byteLength(decompressed) !== entry.uncompressedSize ||
      calculateCrc32(decompressed) !== entry.crc32
    ) {
      fail("LOCAL_DOCX_INVALID");
    }
    if (!isXmlEntry(entry.name)) continue;
    const xml = normalizeTextSource(strictUtf8(decompressed), signal);
    inspectXml(entry.name, xml);
  }
  const names = new IntrinsicSet<string>();
  for (const entry of entries) {
    intrinsicReflectApply(intrinsicSetAdd, names, [stringToLowerCase(entry.name)]);
  }
  if (
    !(intrinsicReflectApply(intrinsicSetHas, names, ["[content_types].xml"]) as boolean) ||
    !(intrinsicReflectApply(intrinsicSetHas, names, ["_rels/.rels"]) as boolean) ||
    !(intrinsicReflectApply(intrinsicSetHas, names, ["word/document.xml"]) as boolean)
  ) {
    fail("LOCAL_DOCX_INVALID");
  }
  await checkpoint(signal);
}

function asArrayBuffer(bytes: Uint8Array<ArrayBuffer>): ArrayBuffer {
  return intrinsicReflectApply(intrinsicArrayBufferSlice, bytesBuffer(bytes), [
    byteOffset(bytes),
    byteOffset(bytes) + byteLength(bytes),
  ]) as ArrayBuffer;
}

function isOutput(value: unknown): value is DocxOutput {
  return value === "html" || value === "md" || value === "txt";
}

async function convertInternal(
  input: unknown,
  output: unknown,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!isOutput(output)) fail("LOCAL_DOCX_FORMAT_INVALID");
  checkAbort(signal);
  const bytes = copyInput(input);
  await preflight(bytes, signal);
  checkAbort(signal);
  const arrayBuffer = asArrayBuffer(bytes);
  if (output === "txt") {
    const result = await waitForAbortable(mammoth.extractRawText({ arrayBuffer }), signal);
    if (result === null || typeof result !== "object" || typeof result.value !== "string") {
      fail("LOCAL_DOCX_CONVERSION_FAILED");
    }
    const source = intrinsicReflectApply(intrinsicTextEncode, new IntrinsicTextEncoder(), [
      result.value,
    ]) as Uint8Array<ArrayBuffer>;
    return convertSemanticText(source, "txt", "txt", "utf-8", signal);
  }
  const result = await waitForAbortable(
    mammoth.convertToHtml(
      { arrayBuffer },
      { externalFileAccess: false, includeDefaultStyleMap: true },
    ),
    signal,
  );
  if (result === null || typeof result !== "object" || typeof result.value !== "string") {
    fail("LOCAL_DOCX_CONVERSION_FAILED");
  }
  const source = intrinsicReflectApply(intrinsicTextEncode, new IntrinsicTextEncoder(), [
    result.value,
  ]) as Uint8Array<ArrayBuffer>;
  return convertSemanticText(source, "html", output, "utf-8", signal);
}

export async function convertDocx(
  bytes: Uint8Array,
  output: DocxOutput,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  return docxBoundary(() => convertInternal(bytes, output, signal), signal);
}

function mediaType(output: DocxOutput): string {
  switch (output) {
    case "html":
      return "text/html";
    case "md":
      return "text/markdown";
    case "txt":
      return "text/plain";
  }
}

export async function dispatchDocxConversion(
  request: LocalConversionRequest,
  signal?: AbortSignal,
): Promise<LocalWorkerOutput> {
  if (request.operation !== "docx.extract") {
    throw new IntrinsicError("LOCAL_OPERATION_NOT_IMPLEMENTED");
  }
  if (request.inputFormat !== "docx" || !isOutput(request.outputFormat)) {
    throw new IntrinsicError("LOCAL_DOCX_FORMAT_INVALID");
  }
  const result = intrinsicObjectCreate(null) as { bytes: Uint8Array; mediaType: string };
  result.bytes = await convertDocx(request.bytes, request.outputFormat, signal);
  result.mediaType = mediaType(request.outputFormat);
  return intrinsicFreeze(result);
}

export { DOCX_LIMITS };
