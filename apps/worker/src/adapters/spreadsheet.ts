import { isProxy } from "node:util/types";
import { Worker, type WorkerOptions } from "node:worker_threads";
import { inflateRawSync } from "node:zlib";
import { hardenWorkerValue } from "../manifest.js";

const MiB = 1024 * 1024;
const SpreadsheetError = Error;
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const CFB_MAGIC = Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
const ODS_MIMETYPE = "application/vnd.oasis.opendocument.spreadsheet";
const ZIP_LOCAL_SIGNATURE = 0x0403_4b50;
const ZIP_CENTRAL_SIGNATURE = 0x0201_4b50;
const ZIP_END_SIGNATURE = 0x0605_4b50;
const ZIP64_EXTRA = 0x0001;
const ZIP_AES_EXTRA = 0x9901;
const CFB_FREE = 0xffff_ffff;
const CFB_END = 0xffff_fffe;
const CFB_FAT = 0xffff_fffd;
const CFB_DIFAT = 0xffff_fffc;
const abortSignalAbortedGetter = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)?.get;
const abortAddEventListener = AbortSignal.prototype.addEventListener;
const abortRemoveEventListener = AbortSignal.prototype.removeEventListener;
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
const arrayBufferDetachedGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "detached",
)?.get;
const arrayBufferResizableGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "resizable",
)?.get;
const intrinsicUint8Array = Uint8Array;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const typedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteOffset",
)?.get;
const uint8ArraySet = Uint8Array.prototype.set;
const uint8ArraySubarray = Uint8Array.prototype.subarray;
const intrinsicTextEncoder = TextEncoder;
const textEncoderEncodeInto = TextEncoder.prototype.encodeInto;
const stringFromCharCode = String.fromCharCode;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringNormalize = String.prototype.normalize;
const stringSlice = String.prototype.slice;
const stringToLowerCase = String.prototype.toLowerCase;
const weakSetAdd = WeakSet.prototype.add;
const weakSetHas = WeakSet.prototype.has;

type SpreadsheetInputFormat = "xls" | "xlsx" | "ods";

interface ZipEntry {
  readonly name: string;
  readonly flags: number;
  readonly method: 0 | 8;
  readonly checksum: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
  readonly content: Uint8Array;
}

interface SpreadsheetLibrary {
  readonly read: (input: Uint8Array, options: Readonly<Record<string, unknown>>) => unknown;
}

interface SpreadsheetThread {
  on(event: "message", listener: (message: unknown) => void): unknown;
  on(event: "error", listener: (error: unknown) => void): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
  off(event: "message", listener: (message: unknown) => void): unknown;
  off(event: "error", listener: (error: unknown) => void): unknown;
  off(event: "exit", listener: (code: number) => void): unknown;
  postMessage(message: unknown, transfer: readonly ArrayBuffer[]): void;
  terminate(): Promise<number> | number;
}

interface SpreadsheetThreadRuntime {
  readonly createThread: (
    url: URL,
    options: Readonly<Record<string, unknown>>,
  ) => SpreadsheetThread;
  readonly setTimer: (callback: () => void, delay: number) => unknown;
  readonly clearTimer: (timer: unknown) => void;
}

interface SpreadsheetAdapterRequest {
  readonly input: Uint8Array;
  readonly inputFormat: SpreadsheetInputFormat;
  readonly outputFormat: "csv";
  readonly options: Readonly<{ sheetIndex?: number }>;
}

interface SpreadsheetPreflightEvidence {
  readonly format: SpreadsheetInputFormat;
  readonly sheetCount: number;
  readonly sheetNames: readonly string[] | null;
}

interface SpreadsheetThreadRequest {
  readonly id: string;
  readonly kind: "spreadsheet.to.csv";
  readonly input: ArrayBuffer;
  readonly inputFormat: SpreadsheetInputFormat;
  readonly outputFormat: "csv";
  readonly sheetIndex: number;
}

interface CellRange {
  readonly startColumn: number;
  readonly startRow: number;
  readonly endColumn: number;
  readonly endRow: number;
}

function fail(): never {
  throw new SpreadsheetError("CONVERSION_FAILED");
}

function exactKeys(input: object, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(input);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function exactArrayBuffer(input: unknown): input is ArrayBuffer {
  if (
    input === null ||
    typeof input !== "object" ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== ArrayBuffer.prototype ||
    !arrayBufferByteLengthGetter
  ) {
    return false;
  }
  try {
    if (arrayBufferDetachedGetter && Reflect.apply(arrayBufferDetachedGetter, input, []) === true) {
      return false;
    }
    if (
      arrayBufferResizableGetter &&
      Reflect.apply(arrayBufferResizableGetter, input, []) === true
    ) {
      return false;
    }
    Reflect.apply(arrayBufferByteLengthGetter, input, []);
    return true;
  } catch {
    return false;
  }
}

function arrayBufferLength(input: ArrayBuffer): number {
  if (!arrayBufferByteLengthGetter) fail();
  const length = Reflect.apply(arrayBufferByteLengthGetter, input, []);
  if (typeof length !== "number" || !Number.isSafeInteger(length)) fail();
  return length;
}

function u16(bytes: Uint8Array, offset: number): number {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 2 > bytes.byteLength) fail();
  const first = bytes[offset];
  const second = bytes[offset + 1];
  if (first === undefined || second === undefined) fail();
  return first | (second << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 4 > bytes.byteLength) fail();
  const first = bytes[offset];
  const second = bytes[offset + 1];
  const third = bytes[offset + 2];
  const fourth = bytes[offset + 3];
  if (first === undefined || second === undefined || third === undefined || fourth === undefined) {
    fail();
  }
  return (first | (second << 8) | (third << 16) | (fourth << 24)) >>> 0;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function exactUint8Array(input: unknown): input is Uint8Array {
  if (
    input === null ||
    typeof input !== "object" ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== intrinsicUint8Array.prototype ||
    !typedArrayBufferGetter ||
    !typedArrayByteLengthGetter ||
    !typedArrayByteOffsetGetter
  ) {
    return false;
  }
  try {
    const buffer = Reflect.apply(typedArrayBufferGetter, input, []);
    const byteLength = Reflect.apply(typedArrayByteLengthGetter, input, []);
    const byteOffset = Reflect.apply(typedArrayByteOffsetGetter, input, []);
    return (
      exactArrayBuffer(buffer) &&
      typeof byteLength === "number" &&
      Number.isSafeInteger(byteLength) &&
      byteLength >= 0 &&
      typeof byteOffset === "number" &&
      Number.isSafeInteger(byteOffset) &&
      byteOffset >= 0 &&
      byteOffset + byteLength <= arrayBufferLength(buffer)
    );
  } catch {
    return false;
  }
}

function uint8ArrayDetails(input: Uint8Array): {
  readonly buffer: ArrayBuffer;
  readonly byteLength: number;
  readonly byteOffset: number;
} {
  if (!exactUint8Array(input) || !typedArrayBufferGetter || !typedArrayByteLengthGetter) fail();
  if (!typedArrayByteOffsetGetter) fail();
  const buffer = Reflect.apply(typedArrayBufferGetter, input, []);
  const byteLength = Reflect.apply(typedArrayByteLengthGetter, input, []);
  const byteOffset = Reflect.apply(typedArrayByteOffsetGetter, input, []);
  if (!exactArrayBuffer(buffer)) fail();
  return { buffer, byteLength, byteOffset };
}

function copyBytes(input: Uint8Array): Uint8Array {
  const { byteLength } = uint8ArrayDetails(input);
  const output = new intrinsicUint8Array(byteLength);
  Reflect.apply(uint8ArraySet, output, [input]);
  return output;
}

function ownedBuffer(input: Uint8Array): ArrayBuffer {
  const { buffer, byteLength, byteOffset } = uint8ArrayDetails(input);
  if (byteOffset !== 0 || byteLength !== arrayBufferLength(buffer)) {
    fail();
  }
  return buffer;
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (input === null || typeof input !== "object" || isProxy(input) || Array.isArray(input)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function ownData(input: object, key: PropertyKey): unknown {
  const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
  if (!descriptor || !("value" in descriptor)) fail();
  return descriptor.value;
}

function exactArray(input: unknown): input is unknown[] {
  return (
    Array.isArray(input) && !isProxy(input) && Object.getPrototypeOf(input) === Array.prototype
  );
}

function denseStringArray(input: unknown): readonly string[] {
  if (!exactArray(input) || input.length < 1 || input.length > SPREADSHEET_POLICY.maxSheets) fail();
  const keys = Reflect.ownKeys(input);
  if (keys.length !== input.length + 1) fail();
  const output: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < input.length; index += 1) {
    const value = ownData(input, String(index));
    if (
      typeof value !== "string" ||
      value.length < 1 ||
      value.length > 256 ||
      value.includes("\0") ||
      seen.has(value)
    ) {
      fail();
    }
    seen.add(value);
    output.push(value);
  }
  return output;
}

function libraryRead(library: unknown): SpreadsheetLibrary["read"] {
  if (!isPlainRecord(library)) fail();
  const read = ownData(library, "read");
  if (typeof read !== "function") fail();
  return read as SpreadsheetLibrary["read"];
}

function spreadsheetColumn(column: string): number {
  if (!/^[A-Z]{1,3}$/u.test(column)) fail();
  let value = 0;
  for (let index = 0; index < column.length; index += 1) {
    value = value * 26 + (column.charCodeAt(index) - 64);
  }
  return value - 1;
}

function parseCellRange(input: unknown): CellRange {
  if (typeof input !== "string" || input.length > 32) fail();
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,5})(?::([A-Z]{1,3})([1-9][0-9]{0,5}))?$/u.exec(input);
  if (!match) fail();
  const startColumnText = match[1];
  const startRowText = match[2];
  if (!startColumnText || !startRowText) fail();
  const endColumnText = match[3] ?? startColumnText;
  const endRowText = match[4] ?? startRowText;
  const range = {
    startColumn: spreadsheetColumn(startColumnText),
    startRow: Number(startRowText) - 1,
    endColumn: spreadsheetColumn(endColumnText),
    endRow: Number(endRowText) - 1,
  };
  const rows = range.endRow - range.startRow + 1;
  const columns = range.endColumn - range.startColumn + 1;
  if (
    rows < 1 ||
    columns < 1 ||
    rows > SPREADSHEET_POLICY.maxRows ||
    columns > SPREADSHEET_POLICY.maxColumns ||
    rows * columns > SPREADSHEET_POLICY.maxCells
  ) {
    fail();
  }
  return range;
}

function validateArrayKeys(input: unknown[], maximumIndex: number): void {
  for (const key of Reflect.ownKeys(input)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)) fail();
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index > maximumIndex) fail();
    ownData(input, key);
  }
}

const SAFE_CELL_KEYS = new Set(["t", "v", "w", "f", "z", "r"]);

interface SafeCellValue {
  readonly protectCsv: boolean;
  readonly value: string;
}

function safeCellText(input: unknown, seen: WeakSet<object>): SafeCellValue {
  if (!isPlainRecord(input)) fail();
  if (Reflect.apply(weakSetHas, seen, [input])) fail();
  Reflect.apply(weakSetAdd, seen, [input]);
  const keys = Reflect.ownKeys(input);
  for (const key of keys) {
    if (typeof key !== "string" || !SAFE_CELL_KEYS.has(key)) fail();
    ownData(input, key);
  }
  const type = ownData(input, "t");
  if (typeof type !== "string" || !["n", "s", "str", "b", "e", "z"].includes(type)) fail();
  const formulaDescriptor = Reflect.getOwnPropertyDescriptor(input, "f");
  if (formulaDescriptor) {
    if (!("value" in formulaDescriptor) || typeof formulaDescriptor.value !== "string") fail();
    if (
      formulaDescriptor.value.length > 8_192 ||
      /\[[^\]]+\]|(?:https?|ftp|file):|\\\\|\bDDE\s*\(/iu.test(formulaDescriptor.value)
    ) {
      fail();
    }
  }
  const richTextDescriptor = Reflect.getOwnPropertyDescriptor(input, "r");
  if (richTextDescriptor) {
    if (
      !("value" in richTextDescriptor) ||
      typeof richTextDescriptor.value !== "string" ||
      richTextDescriptor.value.length > 4 * MiB
    ) {
      fail();
    }
  }
  const valueDescriptor = Reflect.getOwnPropertyDescriptor(input, "v");
  if (formulaDescriptor) {
    if (!valueDescriptor || !("value" in valueDescriptor)) fail();
    const cached = valueDescriptor.value;
    const validCachedValue =
      (type === "n" && typeof cached === "number" && Number.isFinite(cached)) ||
      ((type === "s" || type === "str") && typeof cached === "string") ||
      (type === "b" && typeof cached === "boolean") ||
      (type === "e" && typeof cached === "number" && Number.isFinite(cached)) ||
      (type === "z" && (cached === null || cached === undefined));
    if (!validCachedValue) fail();
  }
  const formattedDescriptor = Reflect.getOwnPropertyDescriptor(input, "w");
  if (formattedDescriptor) {
    if (!("value" in formattedDescriptor) || typeof formattedDescriptor.value !== "string") fail();
    return { protectCsv: type === "s" || type === "str", value: formattedDescriptor.value };
  }
  const value =
    valueDescriptor && "value" in valueDescriptor ? valueDescriptor.value : ownData(input, "v");
  if (typeof value === "string") return { protectCsv: true, value };
  if (typeof value === "boolean") return { protectCsv: false, value: value ? "TRUE" : "FALSE" };
  if (typeof value === "number" && Number.isFinite(value)) {
    return { protectCsv: false, value: String(value) };
  }
  if ((type === "z" || type === "e") && (value === null || value === undefined)) {
    return { protectCsv: false, value: "" };
  }
  fail();
}

function defaultIgnorable(code: number): boolean {
  return (
    code === 0x00ad ||
    code === 0x034f ||
    code === 0x061c ||
    code === 0x115f ||
    code === 0x1160 ||
    code === 0x17b4 ||
    code === 0x17b5 ||
    (code >= 0x180b && code <= 0x180f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0x3164 ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    code === 0xfeff ||
    code === 0xffa0
  );
}

function dangerousCsvString(input: string): boolean {
  if (input.length > SPREADSHEET_POLICY.maxOutputBytes) fail();
  let normalized: string;
  try {
    normalized = Reflect.apply(stringNormalize, input, ["NFKC"]) as string;
  } catch {
    return fail();
  }
  let token = "";
  let started = false;
  for (let index = 0; index < normalized.length && token.length < 4; index += 1) {
    const code = Reflect.apply(stringCharCodeAt, normalized, [index]) as number;
    if (defaultIgnorable(code)) continue;
    if (!started && code <= 0x20) {
      if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
      continue;
    }
    started = true;
    if (token.length === 0 && (code === 0x3d || code === 0x2b || code === 0x2d || code === 0x40)) {
      return true;
    }
    token += Reflect.apply(stringFromCharCode, String, [code]) as string;
  }
  if (token.length < 4) return false;
  const prefix = Reflect.apply(stringSlice, token, [0, 4]) as string;
  return (Reflect.apply(stringToLowerCase, prefix, []) as string) === "sep=";
}

function protectedCsvValue(input: SafeCellValue): string {
  if (!input.protectCsv || !dangerousCsvString(input.value)) return input.value;
  if (input.value.length >= SPREADSHEET_POLICY.maxOutputBytes) fail();
  return `'${input.value}`;
}

interface CsvFieldPlan {
  readonly value: string;
  readonly utf8Bytes: number;
  readonly quotes: number;
  readonly quoted: boolean;
}

function csvFieldPlan(value: string, available: number): CsvFieldPlan {
  let utf8Bytes = 0;
  let quotes = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const code = Reflect.apply(stringCharCodeAt, value, [index]) as number;
    if (code === 0x22) {
      quotes += 1;
      quoted = true;
    } else if (code === 0x2c || code === 0x0d || code === 0x0a) {
      quoted = true;
    }
    if (code <= 0x7f) utf8Bytes += 1;
    else if (code <= 0x7ff) utf8Bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = Reflect.apply(stringCharCodeAt, value, [index + 1]) as number;
      if (next >= 0xdc00 && next <= 0xdfff) {
        utf8Bytes += 4;
        index += 1;
      } else {
        utf8Bytes += 3;
      }
    } else {
      utf8Bytes += 3;
    }
    const lowerBound = utf8Bytes + quotes + (quoted ? 2 : 0);
    if (!Number.isSafeInteger(lowerBound) || lowerBound > available) fail();
  }
  return { value, utf8Bytes, quotes, quoted };
}

function encodeUtf8Into(
  encoder: InstanceType<typeof intrinsicTextEncoder>,
  value: string,
  output: Uint8Array,
  initialOffset: number,
): number {
  let inputOffset = 0;
  let outputOffset = initialOffset;
  while (inputOffset < value.length) {
    let end = Math.min(value.length, inputOffset + 8_192);
    if (
      end < value.length &&
      end > inputOffset &&
      (Reflect.apply(stringCharCodeAt, value, [end - 1]) as number) >= 0xd800 &&
      (Reflect.apply(stringCharCodeAt, value, [end - 1]) as number) <= 0xdbff
    ) {
      end -= 1;
    }
    if (end === inputOffset) end += 1;
    const chunk = Reflect.apply(stringSlice, value, [inputOffset, end]) as string;
    const target = Reflect.apply(uint8ArraySubarray, output, [outputOffset]) as Uint8Array;
    const result = Reflect.apply(textEncoderEncodeInto, encoder, [chunk, target]) as {
      readonly read: number;
      readonly written: number;
    };
    if (result.read !== chunk.length || result.written < 0) fail();
    inputOffset = end;
    outputOffset += result.written;
  }
  return outputOffset;
}

function writeCsvField(
  encoder: InstanceType<typeof intrinsicTextEncoder>,
  plan: CsvFieldPlan,
  output: Uint8Array,
  initialOffset: number,
): number {
  let offset = initialOffset;
  if (!plan.quoted) return encodeUtf8Into(encoder, plan.value, output, offset);
  output[offset] = 0x22;
  offset += 1;
  let segmentStart = 0;
  for (let index = 0; index < plan.value.length; index += 1) {
    if ((Reflect.apply(stringCharCodeAt, plan.value, [index]) as number) !== 0x22) continue;
    if (index > segmentStart) {
      const segment = Reflect.apply(stringSlice, plan.value, [segmentStart, index]) as string;
      offset = encodeUtf8Into(encoder, segment, output, offset);
    }
    output[offset] = 0x22;
    output[offset + 1] = 0x22;
    offset += 2;
    segmentStart = index + 1;
  }
  if (segmentStart < plan.value.length) {
    const segment = Reflect.apply(stringSlice, plan.value, [segmentStart]) as string;
    offset = encodeUtf8Into(encoder, segment, output, offset);
  }
  output[offset] = 0x22;
  return offset + 1;
}

interface SelectedWorkbook {
  readonly complete: boolean;
  readonly selected: object;
  readonly worksheets: readonly object[];
}

function selectedWorksheet(
  workbook: unknown,
  sheetNames: readonly string[],
  selected: string,
  allowSelectedOnly: boolean,
): SelectedWorkbook {
  if (!isPlainRecord(workbook)) fail();
  const returnedNames = denseStringArray(ownData(workbook, "SheetNames"));
  if (
    returnedNames.length !== sheetNames.length ||
    returnedNames.some((name, index) => name !== sheetNames[index])
  ) {
    fail();
  }
  const sheets = ownData(workbook, "Sheets");
  if (!isPlainRecord(sheets)) fail();
  const sheetKeys = Reflect.ownKeys(sheets);
  const selectedOnly = sheetKeys.length === 1 && sheetKeys[0] === selected;
  const fullWorkbook =
    sheetKeys.length === sheetNames.length &&
    sheetKeys.every((name, index) => name === sheetNames[index]);
  if (!fullWorkbook && (!allowSelectedOnly || !selectedOnly)) fail();
  const worksheets: object[] = [];
  const seen = new Set<object>();
  for (const name of sheetKeys) {
    if (typeof name !== "string") fail();
    const worksheet = ownData(sheets, name);
    if (!isPlainRecord(worksheet) || seen.has(worksheet)) fail();
    seen.add(worksheet);
    worksheets.push(worksheet);
  }
  const worksheet = ownData(sheets, selected);
  if (!isPlainRecord(worksheet)) fail();
  return { complete: fullWorkbook, selected: worksheet, worksheets };
}

interface WorksheetResult {
  readonly output?: Uint8Array;
  readonly rows: number;
  readonly columns: number;
  readonly cells: number;
  readonly strings: number;
  readonly records: number;
}

function mergeCoordinate(
  input: unknown,
  maximumColumn: number,
  maximumRow: number,
): {
  readonly column: number;
  readonly row: number;
} {
  if (!isPlainRecord(input) || !exactKeys(input, ["c", "r"])) fail();
  const column = ownData(input, "c");
  const row = ownData(input, "r");
  if (
    !Number.isSafeInteger(column) ||
    !Number.isSafeInteger(row) ||
    (column as number) < 0 ||
    (row as number) < 0 ||
    (column as number) > maximumColumn ||
    (row as number) > maximumRow
  ) {
    fail();
  }
  return { column: column as number, row: row as number };
}

function validateMerges(input: unknown, range: CellRange): void {
  if (!exactArray(input) || input.length > SPREADSHEET_POLICY.maxCells) fail();
  validateArrayKeys(input, input.length - 1);
  for (let index = 0; index < input.length; index += 1) {
    const merge = ownData(input, String(index));
    if (!isPlainRecord(merge) || !exactKeys(merge, ["s", "e"])) fail();
    const start = mergeCoordinate(ownData(merge, "s"), range.endColumn, range.endRow);
    const end = mergeCoordinate(ownData(merge, "e"), range.endColumn, range.endRow);
    if (
      start.column < range.startColumn ||
      start.row < range.startRow ||
      end.column < start.column ||
      end.row < start.row
    ) {
      fail();
    }
  }
}

function worksheetCsv(worksheet: object, emit: boolean): WorksheetResult {
  const allowedWorksheetKeys = new Set(["!data", "!ref", "!fullref", "!margins", "!merges"]);
  for (const key of Reflect.ownKeys(worksheet)) {
    if (typeof key !== "string" || !allowedWorksheetKeys.has(key)) fail();
    ownData(worksheet, key);
  }
  if (Reflect.getOwnPropertyDescriptor(worksheet, "!fullref")) fail();
  const marginsDescriptor = Reflect.getOwnPropertyDescriptor(worksheet, "!margins");
  if (marginsDescriptor) {
    if (!("value" in marginsDescriptor) || !isPlainRecord(marginsDescriptor.value)) fail();
    const allowedMargins = new Set(["left", "right", "top", "bottom", "header", "footer"]);
    for (const key of Reflect.ownKeys(marginsDescriptor.value)) {
      if (typeof key !== "string" || !allowedMargins.has(key)) fail();
      const value = ownData(marginsDescriptor.value, key);
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10) fail();
    }
  }
  const range = parseCellRange(ownData(worksheet, "!ref"));
  const mergesDescriptor = Reflect.getOwnPropertyDescriptor(worksheet, "!merges");
  if (mergesDescriptor) {
    if (!("value" in mergesDescriptor)) fail();
    validateMerges(mergesDescriptor.value, range);
  }
  const data = ownData(worksheet, "!data");
  if (!exactArray(data) || data.length > SPREADSHEET_POLICY.maxRows + 1) fail();
  validateArrayKeys(data, range.endRow);

  const seen = new WeakSet<object>();
  const plannedRows: Array<Array<CsvFieldPlan | undefined>> = [];
  let outputBytes = emit ? 3 : 0;
  let strings = 0;
  let records = 0;
  for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex += 1) {
    const rowDescriptor = Reflect.getOwnPropertyDescriptor(data, String(rowIndex));
    let row: unknown[] | undefined;
    if (rowDescriptor) {
      if (!("value" in rowDescriptor) || !exactArray(rowDescriptor.value)) fail();
      row = rowDescriptor.value;
      validateArrayKeys(row, range.endColumn);
    }
    const fields: Array<CsvFieldPlan | undefined> = [];
    if (emit) {
      outputBytes += range.endColumn - range.startColumn + 2;
      if (outputBytes > SPREADSHEET_POLICY.maxOutputBytes) fail();
    }
    for (let columnIndex = range.startColumn; columnIndex <= range.endColumn; columnIndex += 1) {
      const cellDescriptor = row
        ? Reflect.getOwnPropertyDescriptor(row, String(columnIndex))
        : undefined;
      if (!cellDescriptor) {
        if (emit) fields.push(undefined);
      } else {
        if (!("value" in cellDescriptor)) fail();
        const cell = safeCellText(cellDescriptor.value, seen);
        const value = protectedCsvValue(cell);
        strings += 1;
        records += 1;
        if (emit) {
          const plan = csvFieldPlan(value, SPREADSHEET_POLICY.maxOutputBytes - outputBytes);
          outputBytes += plan.utf8Bytes + plan.quotes + (plan.quoted ? 2 : 0);
          if (outputBytes > SPREADSHEET_POLICY.maxOutputBytes) fail();
          fields.push(plan);
        }
      }
    }
    records += 1;
    if (emit) plannedRows.push(fields);
  }
  let output: Uint8Array | undefined;
  if (emit) {
    output = new intrinsicUint8Array(outputBytes);
    output[0] = 0xef;
    output[1] = 0xbb;
    output[2] = 0xbf;
    const encoder = new intrinsicTextEncoder();
    let offset = 3;
    for (const row of plannedRows) {
      for (let column = 0; column < row.length; column += 1) {
        if (column > 0) {
          output[offset] = 0x2c;
          offset += 1;
        }
        const plan = row[column];
        if (plan) offset = writeCsvField(encoder, plan, output, offset);
      }
      output[offset] = 0x0d;
      output[offset + 1] = 0x0a;
      offset += 2;
    }
    if (offset !== outputBytes) fail();
  }
  return {
    ...(output ? { output } : {}),
    rows: range.endRow - range.startRow + 1,
    columns: range.endColumn - range.startColumn + 1,
    cells: (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1),
    strings,
    records,
  };
}

function validatedWorkbookCsv(selection: SelectedWorkbook): Uint8Array {
  const totals = emptyWorkbookTotals();
  let output: Uint8Array | undefined;
  for (const worksheet of selection.worksheets) {
    const result = worksheetCsv(worksheet, worksheet === selection.selected);
    addWorkbookTotals(totals, result);
    if (result.output) {
      if (output) fail();
      output = result.output;
    }
  }
  if (!output) fail();
  return output;
}

function convertSpreadsheetSyncUnchecked(
  input: unknown,
  format: SpreadsheetInputFormat,
  sheetIndex: number | undefined,
  library: unknown,
): Uint8Array {
  if (!exactUint8Array(input)) fail();
  const selectedIndex = sheetIndex ?? 0;
  if (!Number.isSafeInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > 255) fail();
  const firstCopy = copyBytes(input);
  const evidence = preflightSpreadsheet(firstCopy, format);
  const read = libraryRead(library);
  const metadata = Reflect.apply(read, library, [
    firstCopy,
    mutableSheetJsOptions(METADATA_PARSE_OPTIONS),
  ]);
  if (!isPlainRecord(metadata)) fail();
  const sheetNames = denseStringArray(ownData(metadata, "SheetNames"));
  const namesMismatch =
    evidence.sheetNames === null
      ? false
      : evidence.sheetNames.some((name, index) => name !== sheetNames[index]);
  if (sheetNames.length !== evidence.sheetCount || namesMismatch) {
    fail();
  }
  const selectedName = sheetNames[selectedIndex];
  if (selectedName === undefined) fail();
  const secondCopy = copyBytes(input);
  const workbook = Reflect.apply(read, library, [
    secondCopy,
    mutableSheetJsOptions(SELECTED_PARSE_OPTIONS, { sheets: [selectedName] }),
  ]);
  let selection = selectedWorksheet(workbook, sheetNames, selectedName, true);
  if (!selection.complete) {
    const fullCopy = copyBytes(input);
    const fullWorkbook = Reflect.apply(read, library, [
      fullCopy,
      mutableSheetJsOptions(SELECTED_PARSE_OPTIONS),
    ]);
    selection = selectedWorksheet(fullWorkbook, sheetNames, selectedName, false);
  }
  return validatedWorkbookCsv(selection);
}

function convertSpreadsheetSync(
  input: unknown,
  format: SpreadsheetInputFormat,
  sheetIndex: number | undefined,
  library: unknown,
): Uint8Array {
  try {
    return convertSpreadsheetSyncUnchecked(input, format, sheetIndex, library);
  } catch {
    fail();
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return textDecoder.decode(bytes);
  } catch {
    fail();
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) fail();
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function validateZipExtra(bytes: Uint8Array): void {
  let offset = 0;
  while (offset < bytes.byteLength) {
    if (offset + 4 > bytes.byteLength) fail();
    const id = u16(bytes, offset);
    const size = u16(bytes, offset + 2);
    offset += 4;
    if (offset + size > bytes.byteLength || id === ZIP64_EXTRA || id === ZIP_AES_EXTRA) fail();
    offset += size;
  }
}

function validateZipName(rawName: Uint8Array, flags: number): string {
  if (rawName.byteLength === 0 || rawName.byteLength > 512) fail();
  if ((flags & 0x0800) === 0) {
    for (const byte of rawName) if (byte < 0x20 || byte > 0x7e) fail();
  }
  const name = decodeUtf8(rawName);
  if (
    name.length === 0 ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.includes(":") ||
    name.includes("%")
  ) {
    fail();
  }
  const segments = name.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    if (!name.endsWith("/") || segments.at(-1) !== "") fail();
    const directorySegments = segments.slice(0, -1);
    if (
      directorySegments.length === 0 ||
      directorySegments.some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      fail();
    }
  }
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) fail();
  }
  return name;
}

function findZipEnd(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (u32(bytes, offset) === ZIP_END_SIGNATURE) {
      const commentLength = u16(bytes, offset + 20);
      if (offset + 22 + commentLength === bytes.byteLength) return offset;
    }
  }
  fail();
}

function inflateEntry(compressed: Uint8Array, entry: Omit<ZipEntry, "content">): Uint8Array {
  let output: Uint8Array;
  try {
    output =
      entry.method === 0
        ? new Uint8Array(compressed)
        : new Uint8Array(
            inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize + 1 }),
          );
  } catch {
    fail();
  }
  if (output.byteLength !== entry.uncompressedSize || crc32(output) !== entry.checksum) fail();
  return output;
}

function parseZip(bytes: Uint8Array): readonly ZipEntry[] {
  const endOffset = findZipEnd(bytes);
  if (u16(bytes, endOffset + 4) !== 0 || u16(bytes, endOffset + 6) !== 0) fail();
  const diskEntries = u16(bytes, endOffset + 8);
  const totalEntries = u16(bytes, endOffset + 10);
  const centralSize = u32(bytes, endOffset + 12);
  const centralOffset = u32(bytes, endOffset + 16);
  if (
    diskEntries !== totalEntries ||
    totalEntries < 1 ||
    totalEntries > SPREADSHEET_POLICY.zip.maxEntries ||
    centralOffset + centralSize !== endOffset
  ) {
    fail();
  }

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  const localRanges: Array<readonly [number, number]> = [];
  let totalUncompressed = 0;
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (u32(bytes, offset) !== ZIP_CENTRAL_SIGNATURE || offset + 46 > endOffset) fail();
    const flags = u16(bytes, offset + 8);
    const methodValue = u16(bytes, offset + 10);
    const checksum = u32(bytes, offset + 16);
    const compressedSize = u32(bytes, offset + 20);
    const uncompressedSize = u32(bytes, offset + 24);
    const nameLength = u16(bytes, offset + 28);
    const extraLength = u16(bytes, offset + 30);
    const commentLength = u16(bytes, offset + 32);
    const diskStart = u16(bytes, offset + 34);
    const localOffset = u32(bytes, offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (
      end > endOffset ||
      diskStart !== 0 ||
      (flags & ~0x0800) !== 0 ||
      (methodValue !== 0 && methodValue !== 8) ||
      compressedSize === 0xffff_ffff ||
      uncompressedSize === 0xffff_ffff
    ) {
      fail();
    }
    const method = methodValue as 0 | 8;
    const name = validateZipName(bytes.subarray(offset + 46, offset + 46 + nameLength), flags);
    validateZipExtra(
      bytes.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength),
    );
    const canonicalName = name.toLowerCase();
    if (names.has(canonicalName)) fail();
    names.add(canonicalName);

    totalUncompressed += uncompressedSize;
    if (
      totalUncompressed > SPREADSHEET_POLICY.zip.maxUncompressedBytes ||
      (uncompressedSize > 0 && compressedSize === 0) ||
      (compressedSize > 0 &&
        uncompressedSize / compressedSize > SPREADSHEET_POLICY.zip.maxCompressionRatio)
    ) {
      fail();
    }

    if (localOffset + 30 > centralOffset || u32(bytes, localOffset) !== ZIP_LOCAL_SIGNATURE) fail();
    const localFlags = u16(bytes, localOffset + 6);
    const localMethod = u16(bytes, localOffset + 8);
    const localChecksum = u32(bytes, localOffset + 14);
    const localCompressedSize = u32(bytes, localOffset + 18);
    const localUncompressedSize = u32(bytes, localOffset + 22);
    const localNameLength = u16(bytes, localOffset + 26);
    const localExtraLength = u16(bytes, localOffset + 28);
    const localHeaderEnd = localOffset + 30 + localNameLength + localExtraLength;
    const localEnd = localHeaderEnd + compressedSize;
    if (
      localEnd > centralOffset ||
      localFlags !== flags ||
      localMethod !== method ||
      localChecksum !== checksum ||
      localCompressedSize !== compressedSize ||
      localUncompressedSize !== uncompressedSize ||
      localNameLength !== nameLength ||
      !equalBytes(
        bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength),
        bytes.subarray(offset + 46, offset + 46 + nameLength),
      )
    ) {
      fail();
    }
    validateZipExtra(bytes.subarray(localOffset + 30 + localNameLength, localHeaderEnd));
    localRanges.push([localOffset, localEnd]);
    const metadata = {
      name,
      flags,
      method,
      checksum,
      compressedSize,
      uncompressedSize,
      localOffset,
    };
    const content = inflateEntry(bytes.subarray(localHeaderEnd, localEnd), metadata);
    entries.push({ ...metadata, content });
    offset = end;
  }
  if (offset !== endOffset) fail();
  localRanges.sort((left, right) => left[0] - right[0]);
  if (localRanges[0]?.[0] !== 0) fail();
  for (let index = 1; index < localRanges.length; index += 1) {
    const previous = localRanges[index - 1];
    const current = localRanges[index];
    if (!previous || !current || previous[1] !== current[0]) fail();
  }
  if (localRanges.at(-1)?.[1] !== centralOffset) fail();
  return entries;
}

function xmlHasExternalReference(xml: string): boolean {
  if (
    /TargetMode\s*=\s*["']External["']/iu.test(xml) ||
    /<(?:\w+:)?(?:externalLink|ddeLink|oleObject|connection)\b/iu.test(xml)
  ) {
    return true;
  }
  const references = xml.matchAll(/xlink:href\s*=\s*["']([^"']*)["']/giu);
  for (const reference of references) {
    const captured = reference[1];
    if (captured === undefined) return true;
    const target = captured.trim();
    if (
      target.startsWith("/") ||
      target.startsWith("\\") ||
      target.startsWith("//") ||
      target.includes("..") ||
      /^[a-z][a-z0-9+.-]*:/iu.test(target)
    ) {
      return true;
    }
  }
  return false;
}

function xlsxRelationshipHasActiveType(xml: string): boolean {
  for (const relationship of xml.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/giu)) {
    const attributes = relationship[1] ?? "";
    const type = /\bType\s*=\s*["']([^"']+)["']/iu.exec(attributes)?.[1];
    if (
      type !== undefined &&
      /\/(?:vbaProject|activeX|oleObject|externalLink|connections|customUI)$/iu.test(type)
    ) {
      return true;
    }
  }
  return false;
}

interface WorkbookTotals {
  rows: number;
  columns: number;
  cells: number;
  strings: number;
  records: number;
}

function emptyWorkbookTotals(): WorkbookTotals {
  return { rows: 0, columns: 0, cells: 0, strings: 0, records: 0 };
}

function addWorkbookTotals(totals: WorkbookTotals, additions: Partial<WorkbookTotals>): void {
  totals.rows += additions.rows ?? 0;
  totals.columns += additions.columns ?? 0;
  totals.cells += additions.cells ?? 0;
  totals.strings += additions.strings ?? 0;
  totals.records += additions.records ?? 0;
  const limits = SPREADSHEET_POLICY.workbook;
  if (
    !Number.isSafeInteger(totals.rows) ||
    !Number.isSafeInteger(totals.columns) ||
    !Number.isSafeInteger(totals.cells) ||
    !Number.isSafeInteger(totals.strings) ||
    !Number.isSafeInteger(totals.records) ||
    totals.rows > limits.maxTotalRows ||
    totals.columns > limits.maxTotalColumns ||
    totals.cells > limits.maxTotalCells ||
    totals.strings > limits.maxStrings ||
    totals.records > limits.maxRecords
  ) {
    fail();
  }
}

function countXmlRecords(xml: string): number {
  let records = 0;
  for (const _match of xml.matchAll(
    /<(?![!?/])(?:[A-Za-z_][A-Za-z0-9_.-]*:)?[A-Za-z_][A-Za-z0-9_.-]*(?=[\s/>])/gu,
  )) {
    records += 1;
    if (records > SPREADSHEET_POLICY.workbook.maxRecords) fail();
  }
  return records;
}

function decodeXmlAttribute(input: string): string {
  if (input.length > 2_048 || /[<>]/u.test(input)) fail();
  const output = input.replace(
    /&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-f]+);/giu,
    (entity): string => {
      const normalized = entity.toLowerCase();
      if (normalized === "&amp;") return "&";
      if (normalized === "&lt;") return "<";
      if (normalized === "&gt;") return ">";
      if (normalized === "&quot;") return '"';
      if (normalized === "&apos;") return "'";
      const hexadecimal = normalized.startsWith("&#x");
      const digits = normalized.slice(hexadecimal ? 3 : 2, -1);
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
      if (
        !Number.isSafeInteger(codePoint) ||
        codePoint < 1 ||
        codePoint > 0x10_ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        fail();
      }
      return String.fromCodePoint(codePoint);
    },
  );
  if (output.includes("&") || output.length < 1 || output.length > 256 || output.includes("\0")) {
    fail();
  }
  return output;
}

function exactXmlNames(tags: readonly RegExpMatchArray[], attribute: string): readonly string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const expression = new RegExp(`(?:^|\\s)${attribute}\\s*=\\s*(["'])(.*?)\\1`, "giu");
  for (const tag of tags) {
    const attributes = tag[1];
    if (attributes === undefined) fail();
    const matches = Array.from(attributes.matchAll(expression));
    if (matches.length !== 1 || matches[0]?.[2] === undefined) fail();
    const name = decodeXmlAttribute(matches[0][2]);
    if (seen.has(name)) fail();
    seen.add(name);
    names.push(name);
  }
  if (names.length < 1 || names.length > SPREADSHEET_POLICY.maxSheets) fail();
  return names;
}

function inspectXlsxWorkbook(entries: readonly ZipEntry[], workbookXml: string): readonly string[] {
  const sheetTags = Array.from(workbookXml.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/giu));
  const sheetNames = exactXmlNames(sheetTags, "name");
  const sheetCount = sheetNames.length;
  if (sheetCount < 1 || sheetCount > SPREADSHEET_POLICY.maxSheets) fail();
  const worksheets = entries.filter((entry) => /^xl\/worksheets\/[^/]+\.xml$/iu.test(entry.name));
  if (worksheets.length !== sheetCount) fail();

  const totals = emptyWorkbookTotals();
  addWorkbookTotals(totals, { records: countXmlRecords(workbookXml) });
  for (const entry of entries) {
    if (!entry.name.toLowerCase().endsWith(".xml") || worksheets.includes(entry)) continue;
    const xml = decodeUtf8(entry.content);
    const stringRecords =
      entry.name === "xl/sharedStrings.xml"
        ? Array.from(xml.matchAll(/<(?:\w+:)?si(?=[\s/>])/giu)).length
        : 0;
    addWorkbookTotals(totals, { records: countXmlRecords(xml), strings: stringRecords });
  }
  for (const worksheet of worksheets) {
    const xml = decodeUtf8(worksheet.content);
    const dimensions = Array.from(
      xml.matchAll(/<(?:\w+:)?dimension\b[^>]*\bref\s*=\s*["']([^"']+)["'][^>]*>/giu),
    );
    if (dimensions.length !== 1) fail();
    const reference = dimensions[0]?.[1];
    if (!reference) fail();
    const range = parseCellRange(reference);
    const rows = range.endRow - range.startRow + 1;
    const columns = range.endColumn - range.startColumn + 1;
    const cells = rows * columns;
    const rowRecords = Array.from(xml.matchAll(/<(?:\w+:)?row(?=[\s/>])/giu)).length;
    const cellRecords = Array.from(xml.matchAll(/<(?:\w+:)?c(?=[\s/>])/giu)).length;
    if (rowRecords > rows || cellRecords > cells) fail();
    const inlineStrings = Array.from(xml.matchAll(/<(?:\w+:)?is(?=[\s/>])/giu)).length;
    for (const formula of xml.matchAll(/<(?:\w+:)?f\b[^>]*>([\s\S]*?)<\/(?:\w+:)?f>/giu)) {
      const value = formula[1] ?? "";
      if (/\[[^\]]+\]|(?:https?|ftp|file):|\\\\|\bDDE\s*\(/iu.test(value)) fail();
    }
    addWorkbookTotals(totals, {
      rows,
      columns,
      cells,
      strings: inlineStrings,
      records: countXmlRecords(xml),
    });
  }
  return sheetNames;
}

function repeatedAttribute(attributes: string, name: string): number {
  const matches = Array.from(
    attributes.matchAll(new RegExp(`\\b${name}\\s*=\\s*["']([0-9]+)["']`, "giu")),
  );
  if (matches.length === 0) return 1;
  if (matches.length !== 1) fail();
  const value = Number(matches[0]?.[1]);
  if (!Number.isSafeInteger(value) || value < 1) fail();
  return value;
}

function inspectOdsWorkbook(contentXml: string): readonly string[] {
  const sheetTags = Array.from(contentXml.matchAll(/<table:table(?=[\s/>])([^>]*)>/giu));
  const sheetNames = exactXmlNames(sheetTags, "table:name");
  const tables = Array.from(
    contentXml.matchAll(/<table:table(?=[\s>])[^>]*>([\s\S]*?)<\/table:table>/giu),
  );
  if (tables.length !== sheetTags.length) fail();
  const totals = emptyWorkbookTotals();
  addWorkbookTotals(totals, { records: countXmlRecords(contentXml) });

  for (const table of tables) {
    const body = table[1];
    if (body === undefined) fail();
    const rows = Array.from(
      body.matchAll(/<table:table-row\b([^>]*)>([\s\S]*?)<\/table:table-row>/giu),
    );
    if (rows.length < 1) fail();
    let sheetRows = 0;
    let sheetColumns = 0;
    let sheetCells = 0;
    let sheetStrings = 0;
    for (const row of rows) {
      const rowAttributes = row[1];
      const rowBody = row[2];
      if (rowAttributes === undefined || rowBody === undefined) fail();
      const rowRepeat = repeatedAttribute(rowAttributes, "table:number-rows-repeated");
      const cells = Array.from(
        rowBody.matchAll(
          /<table:(?:table-cell|covered-table-cell)\b([^>]*)(?:\/>|>([\s\S]*?)<\/table:(?:table-cell|covered-table-cell)>)/giu,
        ),
      );
      let rowColumns = 0;
      let rowStrings = 0;
      for (const cell of cells) {
        const cellAttributes = cell[1];
        if (cellAttributes === undefined) fail();
        const columnRepeat = repeatedAttribute(cellAttributes, "table:number-columns-repeated");
        rowColumns += columnRepeat;
        const cellBody = cell[2] ?? "";
        const stringCount = Array.from(cellBody.matchAll(/<text:p(?=[\s/>])/giu)).length;
        rowStrings += stringCount * columnRepeat;
        const formulaMatch = /\btable:formula\s*=\s*["']([^"']*)["']/iu.exec(cellAttributes);
        const formula = formulaMatch?.[1];
        if (
          formula &&
          /\[[^\]]*#(?:[^\]]+)\]|(?:https?|ftp|file):|\\\\|\bDDE\s*\(/iu.test(formula)
        ) {
          fail();
        }
      }
      if (rowColumns > SPREADSHEET_POLICY.maxColumns) fail();
      sheetRows += rowRepeat;
      sheetColumns = Math.max(sheetColumns, rowColumns);
      sheetCells += rowRepeat * rowColumns;
      sheetStrings += rowRepeat * rowStrings;
      if (
        !Number.isSafeInteger(sheetRows) ||
        !Number.isSafeInteger(sheetCells) ||
        !Number.isSafeInteger(sheetStrings) ||
        sheetRows > SPREADSHEET_POLICY.maxRows ||
        sheetCells > SPREADSHEET_POLICY.maxCells
      ) {
        fail();
      }
    }
    addWorkbookTotals(totals, {
      rows: sheetRows,
      columns: sheetColumns,
      cells: sheetCells,
      strings: sheetStrings,
    });
  }
  return sheetNames;
}

function preflightXlsx(entries: readonly ZipEntry[]): SpreadsheetPreflightEvidence {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const contentTypes = byName.get("[Content_Types].xml");
  const workbook = byName.get("xl/workbook.xml");
  if (!contentTypes || !workbook) fail();
  const contentTypesXml = decodeUtf8(contentTypes.content);
  let workbookContentTypes = 0;
  for (const override of contentTypesXml.matchAll(/<(?:\w+:)?Override\b([^>]*)\/?>/giu)) {
    const attributes = override[1] ?? "";
    const partName = /\bPartName\s*=\s*["']([^"']+)["']/iu.exec(attributes)?.[1];
    if (partName !== "/xl/workbook.xml") continue;
    const contentType = /\bContentType\s*=\s*["']([^"']+)["']/iu.exec(attributes)?.[1];
    if (
      contentType !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
    ) {
      fail();
    }
    workbookContentTypes += 1;
  }
  if (workbookContentTypes !== 1) fail();
  const workbookXml = decodeUtf8(workbook.content);
  const sheetNames = inspectXlsxWorkbook(entries, workbookXml);
  const activeName =
    /(^|\/)(?:vba|macros?|embeddings?|activex|externallinks?|connections?|querytables?|customui)(?:\/|\.|$)|\.bin$/iu;
  for (const entry of entries) {
    if (activeName.test(entry.name)) fail();
    if (entry.name.toLowerCase().endsWith(".xml") || entry.name.toLowerCase().endsWith(".rels")) {
      const xml = decodeUtf8(entry.content);
      if (entry.name === "[Content_Types].xml") {
        if (xmlHasExternalReference(xml)) fail();
        continue;
      }
      if (
        xmlHasExternalReference(xml) ||
        (entry.name.toLowerCase().endsWith(".rels") && xlsxRelationshipHasActiveType(xml))
      ) {
        fail();
      }
    }
  }
  return hardenWorkerValue({ format: "xlsx" as const, sheetCount: sheetNames.length, sheetNames });
}

function preflightOds(entries: readonly ZipEntry[]): SpreadsheetPreflightEvidence {
  const first = entries.find((entry) => entry.localOffset === 0);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  if (
    !first ||
    first.name !== "mimetype" ||
    first.method !== 0 ||
    decodeUtf8(first.content) !== ODS_MIMETYPE ||
    !byName.has("content.xml")
  ) {
    fail();
  }
  const activeName =
    /(^|\/)(?:scripts?|basic|objects?|objectreplacements?|embeddings?)(?:\/|\.|$)/iu;
  const contentXml = decodeUtf8(byName.get("content.xml")?.content ?? new Uint8Array());
  const sheetNames = inspectOdsWorkbook(contentXml);
  for (const entry of entries) {
    if (activeName.test(entry.name)) fail();
    if (entry.name.toLowerCase().endsWith(".xml")) {
      const xml = decodeUtf8(entry.content);
      const withoutEmptyScripts = xml.replaceAll(/<office:scripts\s*\/>/giu, "");
      if (
        xmlHasExternalReference(xml) ||
        /<(?:office:)?(?:scripts|dde-source)\b/iu.test(withoutEmptyScripts)
      ) {
        fail();
      }
    }
  }
  return hardenWorkerValue({ format: "ods" as const, sheetCount: sheetNames.length, sheetNames });
}

function readCfbSector(bytes: Uint8Array, sectorSize: number, sectorId: number): Uint8Array {
  const sectorCount = (bytes.byteLength - 512) / sectorSize;
  if (!Number.isSafeInteger(sectorId) || sectorId < 0 || sectorId >= sectorCount) fail();
  const offset = 512 + sectorId * sectorSize;
  return bytes.subarray(offset, offset + sectorSize);
}

function decodeCfbName(entry: Uint8Array): string {
  const nameBytes = u16(entry, 64);
  if (nameBytes < 2 || nameBytes > 64 || nameBytes % 2 !== 0) fail();
  if (u16(entry, nameBytes - 2) !== 0) fail();
  let name = "";
  for (let offset = 0; offset < nameBytes - 2; offset += 2) {
    const code = u16(entry, offset);
    if (code === 0) fail();
    name += String.fromCharCode(code);
  }
  return name;
}

function cfbRegularStream(
  bytes: Uint8Array,
  sectorSize: number,
  fat: readonly number[],
  startSector: number,
  size: number,
): Uint8Array {
  if (!Number.isSafeInteger(size) || size < 0 || size > SPREADSHEET_POLICY.maxInputBytes) fail();
  if (size === 0) return new Uint8Array();
  const parts: Uint8Array[] = [];
  const visited = new Set<number>();
  let sectorId = startSector;
  let available = 0;
  while (sectorId !== CFB_END) {
    if (sectorId >= fat.length || visited.has(sectorId)) fail();
    visited.add(sectorId);
    const sector = readCfbSector(bytes, sectorSize, sectorId);
    parts.push(sector);
    available += sector.byteLength;
    const next = fat[sectorId];
    if (next === undefined || next === CFB_FREE || next === CFB_FAT || next === CFB_DIFAT) fail();
    sectorId = next;
    if (parts.length > fat.length || available >= size + sectorSize) fail();
  }
  if (available < size || available >= size + sectorSize) fail();
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    const count = Math.min(part.byteLength, size - offset);
    if (count > 0) output.set(part.subarray(0, count), offset);
    offset += count;
  }
  if (offset !== size) fail();
  return output;
}

function cfbMiniStream(
  rootMiniStream: Uint8Array,
  miniFat: readonly number[],
  startSector: number,
  size: number,
): Uint8Array {
  const miniSectorSize = 64;
  if (!Number.isSafeInteger(size) || size < 1 || size > SPREADSHEET_POLICY.maxInputBytes) fail();
  const output = new Uint8Array(size);
  const visited = new Set<number>();
  let sectorId = startSector;
  let offset = 0;
  while (sectorId !== CFB_END) {
    if (sectorId >= miniFat.length || visited.has(sectorId)) fail();
    visited.add(sectorId);
    const sourceOffset = sectorId * miniSectorSize;
    if (sourceOffset + miniSectorSize > rootMiniStream.byteLength) fail();
    const count = Math.min(miniSectorSize, size - offset);
    if (count > 0) output.set(rootMiniStream.subarray(sourceOffset, sourceOffset + count), offset);
    offset += count;
    const next = miniFat[sectorId];
    if (next === undefined || next === CFB_FREE || next === CFB_FAT || next === CFB_DIFAT) fail();
    sectorId = next;
    if (visited.size > miniFat.length || offset >= size + miniSectorSize) fail();
  }
  if (offset !== size) fail();
  return output;
}

const BIFF_SINGLE_CELL_RECORDS = new Set([
  0x0002, 0x0006, 0x0201, 0x0203, 0x0204, 0x0205, 0x0207, 0x027e, 0x00fd,
]);

function inspectBiffWorkbook(workbook: Uint8Array): number {
  const totals = emptyWorkbookTotals();
  let offset = 0;
  let sheets = 0;
  let worksheetDimensions = 0;
  let physicalCells = 0;
  let inWorksheet = false;
  while (offset < workbook.byteLength) {
    if (offset + 4 > workbook.byteLength) fail();
    const id = u16(workbook, offset);
    const length = u16(workbook, offset + 2);
    const payloadOffset = offset + 4;
    const end = payloadOffset + length;
    if (length > 8_224 || end > workbook.byteLength) fail();
    addWorkbookTotals(totals, { records: 1 });

    if (id === 0x0809) {
      if (length < 4) fail();
      const substreamType = u16(workbook, payloadOffset + 2);
      inWorksheet = substreamType === 0x0010;
    } else if (id === 0x000a) {
      inWorksheet = false;
    } else if (id === 0x0085) {
      sheets += 1;
      if (sheets > SPREADSHEET_POLICY.maxSheets) fail();
    } else if (id === 0x0200 && inWorksheet) {
      if (length < 12) fail();
      const firstRow = u32(workbook, payloadOffset);
      const lastRow = u32(workbook, payloadOffset + 4);
      const firstColumn = u16(workbook, payloadOffset + 8);
      const lastColumn = u16(workbook, payloadOffset + 10);
      const rows = lastRow - firstRow;
      const columns = lastColumn - firstColumn;
      if (
        lastRow < firstRow ||
        lastColumn < firstColumn ||
        rows < 1 ||
        columns < 1 ||
        rows > SPREADSHEET_POLICY.maxRows ||
        columns > SPREADSHEET_POLICY.maxColumns ||
        rows * columns > SPREADSHEET_POLICY.maxCells
      ) {
        fail();
      }
      worksheetDimensions += 1;
      addWorkbookTotals(totals, { rows, columns, cells: rows * columns });
    } else if (id === 0x00fc) {
      if (length < 8) fail();
      const uniqueStrings = u32(workbook, payloadOffset + 4);
      addWorkbookTotals(totals, { strings: uniqueStrings });
    } else if (id === 0x01ae) {
      if (length < 4) fail();
      const marker = u16(workbook, payloadOffset + 2);
      if (marker !== 0x0401 && marker !== 0x3a01) fail();
    } else if (id === 0x0023) {
      fail();
    }

    if (inWorksheet && BIFF_SINGLE_CELL_RECORDS.has(id)) {
      physicalCells += 1;
    } else if (inWorksheet && id === 0x00bd) {
      if (length < 12 || (length - 6) % 6 !== 0) fail();
      physicalCells += (length - 6) / 6;
    } else if (inWorksheet && id === 0x00be) {
      if (length < 8 || (length - 6) % 2 !== 0) fail();
      physicalCells += (length - 6) / 2;
    }
    if (
      !Number.isSafeInteger(physicalCells) ||
      physicalCells > SPREADSHEET_POLICY.workbook.maxTotalCells
    ) {
      fail();
    }

    if (inWorksheet && id === 0x0006) {
      if (length < 22) fail();
      const tokenLength = u16(workbook, payloadOffset + 20);
      const tokenStart = payloadOffset + 22;
      if (tokenStart + tokenLength > end) fail();
      // External BIFF references require a non-internal SUPBOOK (rejected above).
      // Token bytes are length-delimited but cannot be scanned bytewise because operands may
      // legitimately contain the same byte values as 3D token opcodes.
    }
    offset = end;
  }
  if (offset !== workbook.byteLength || sheets < 1 || worksheetDimensions !== sheets) fail();
  return sheets;
}

function preflightXls(bytes: Uint8Array): SpreadsheetPreflightEvidence {
  if (
    bytes.byteLength < 1_536 ||
    !equalBytes(bytes.subarray(0, CFB_MAGIC.byteLength), CFB_MAGIC) ||
    u16(bytes, 28) !== 0xfffe ||
    u16(bytes, 32) !== 6
  ) {
    fail();
  }
  const majorVersion = u16(bytes, 26);
  const sectorShift = u16(bytes, 30);
  if (
    (majorVersion !== 3 && majorVersion !== 4) ||
    (majorVersion === 3 && sectorShift !== 9) ||
    (majorVersion === 4 && sectorShift !== 12)
  ) {
    fail();
  }
  const sectorSize = 2 ** sectorShift;
  if ((bytes.byteLength - 512) % sectorSize !== 0) fail();
  const sectorCount = (bytes.byteLength - 512) / sectorSize;
  const fatCount = u32(bytes, 44);
  const firstDirectorySector = u32(bytes, 48);
  const firstDifatSector = u32(bytes, 68);
  const difatSectorCount = u32(bytes, 72);
  if (fatCount < 1 || fatCount > sectorCount || firstDirectorySector >= sectorCount) fail();

  const fatSectorIds: number[] = [];
  for (let offset = 76; offset < 512; offset += 4) {
    const sectorId = u32(bytes, offset);
    if (sectorId !== CFB_FREE) fatSectorIds.push(sectorId);
  }
  let difatSector = firstDifatSector;
  const visitedDifat = new Set<number>();
  for (let index = 0; index < difatSectorCount; index += 1) {
    if (difatSector >= sectorCount || visitedDifat.has(difatSector)) fail();
    visitedDifat.add(difatSector);
    const sector = readCfbSector(bytes, sectorSize, difatSector);
    for (let offset = 0; offset < sectorSize - 4; offset += 4) {
      const sectorId = u32(sector, offset);
      if (sectorId !== CFB_FREE) fatSectorIds.push(sectorId);
    }
    difatSector = u32(sector, sectorSize - 4);
  }
  if (
    (difatSectorCount === 0 && firstDifatSector !== CFB_END) ||
    (difatSectorCount > 0 && difatSector !== CFB_END) ||
    fatSectorIds.length !== fatCount ||
    new Set(fatSectorIds).size !== fatSectorIds.length ||
    fatSectorIds.some((sectorId) => sectorId >= sectorCount)
  ) {
    fail();
  }

  const fat: number[] = [];
  for (const sectorId of fatSectorIds) {
    const sector = readCfbSector(bytes, sectorSize, sectorId);
    for (let offset = 0; offset < sectorSize; offset += 4) fat.push(u32(sector, offset));
  }
  const directoryParts: Uint8Array[] = [];
  const visitedDirectory = new Set<number>();
  let directorySector = firstDirectorySector;
  while (directorySector !== CFB_END) {
    if (
      directorySector >= sectorCount ||
      directorySector >= fat.length ||
      visitedDirectory.has(directorySector)
    ) {
      fail();
    }
    visitedDirectory.add(directorySector);
    directoryParts.push(readCfbSector(bytes, sectorSize, directorySector));
    const next = fat[directorySector];
    if (next === undefined) fail();
    if (next === CFB_FREE || next === CFB_FAT || next === CFB_DIFAT) fail();
    directorySector = next;
  }
  if (directoryParts.length === 0 || directoryParts.length > sectorCount) fail();

  const allowedStreams = new Set([
    "workbook",
    "book",
    "\u0001compobj",
    "\u0001ole",
    "\u0005summaryinformation",
    "\u0005documentsummaryinformation",
  ]);
  const seenNames = new Set<string>();
  let workbookStreams = 0;
  let roots = 0;
  let rootStreamStart: number | undefined;
  let rootStreamSize: number | undefined;
  let workbookStreamStart: number | undefined;
  let workbookStreamSize: number | undefined;
  for (const sector of directoryParts) {
    for (let offset = 0; offset < sector.byteLength; offset += 128) {
      const entry = sector.subarray(offset, offset + 128);
      const type = entry[66];
      if (type === 0) continue;
      if (type !== 2 && type !== 5) fail();
      const name = decodeCfbName(entry);
      const normalized = name.toLowerCase();
      if (seenNames.has(normalized)) fail();
      seenNames.add(normalized);
      if (type === 5) {
        if (normalized !== "root entry") fail();
        roots += 1;
        rootStreamStart = u32(entry, 116);
        rootStreamSize = u32(entry, 120) + (majorVersion === 4 ? u32(entry, 124) * 2 ** 32 : 0);
        continue;
      }
      if (!allowedStreams.has(normalized)) fail();
      const streamSize = u32(entry, 120) + (majorVersion === 4 ? u32(entry, 124) * 2 ** 32 : 0);
      if (
        (normalized === "\u0001compobj" && (streamSize < 1 || streamSize > 512)) ||
        (normalized === "\u0001ole" && streamSize !== 20) ||
        ((normalized === "\u0005summaryinformation" ||
          normalized === "\u0005documentsummaryinformation") &&
          streamSize > 64 * 1024)
      ) {
        fail();
      }
      if (normalized === "workbook" || normalized === "book") {
        workbookStreams += 1;
        workbookStreamStart = u32(entry, 116);
        workbookStreamSize = streamSize;
        if (streamSize < 1) fail();
      }
    }
  }
  if (roots !== 1 || workbookStreams !== 1) fail();
  if (
    rootStreamStart === undefined ||
    rootStreamSize === undefined ||
    workbookStreamStart === undefined ||
    workbookStreamSize === undefined ||
    u32(bytes, 56) !== 4_096
  ) {
    fail();
  }

  let workbookBytes: Uint8Array;
  if (workbookStreamSize < 4_096) {
    const firstMiniFatSector = u32(bytes, 60);
    const miniFatSectorCount = u32(bytes, 64);
    if (
      rootStreamSize < 1 ||
      rootStreamStart >= sectorCount ||
      miniFatSectorCount < 1 ||
      miniFatSectorCount > sectorCount ||
      firstMiniFatSector >= sectorCount
    ) {
      fail();
    }
    const rootMiniStream = cfbRegularStream(
      bytes,
      sectorSize,
      fat,
      rootStreamStart,
      rootStreamSize,
    );
    const miniFatBytes = cfbRegularStream(
      bytes,
      sectorSize,
      fat,
      firstMiniFatSector,
      miniFatSectorCount * sectorSize,
    );
    const miniFat: number[] = [];
    for (let offset = 0; offset < miniFatBytes.byteLength; offset += 4) {
      miniFat.push(u32(miniFatBytes, offset));
    }
    workbookBytes = cfbMiniStream(rootMiniStream, miniFat, workbookStreamStart, workbookStreamSize);
  } else {
    if (workbookStreamStart >= sectorCount) fail();
    workbookBytes = cfbRegularStream(
      bytes,
      sectorSize,
      fat,
      workbookStreamStart,
      workbookStreamSize,
    );
  }
  const sheetCount = inspectBiffWorkbook(workbookBytes);
  return hardenWorkerValue({ format: "xls" as const, sheetCount, sheetNames: null });
}

function preflightSpreadsheetUnchecked(
  input: unknown,
  format: SpreadsheetInputFormat,
): SpreadsheetPreflightEvidence {
  if (
    !exactUint8Array(input) ||
    input.byteLength < 1 ||
    input.byteLength > SPREADSHEET_POLICY.maxInputBytes
  ) {
    fail();
  }
  if (format === "xls") {
    return preflightXls(input);
  }
  if (input.byteLength < 22 || u32(input, 0) !== ZIP_LOCAL_SIGNATURE) fail();
  const entries = parseZip(input);
  return format === "xlsx" ? preflightXlsx(entries) : preflightOds(entries);
}

function preflightSpreadsheet(
  input: unknown,
  format: SpreadsheetInputFormat,
): SpreadsheetPreflightEvidence {
  try {
    return preflightSpreadsheetUnchecked(input, format);
  } catch {
    fail();
  }
}

export const SPREADSHEET_POLICY = hardenWorkerValue({
  operation: "spreadsheet.to.csv" as const,
  inputFormats: ["xls", "xlsx", "ods"] as const,
  outputFormat: "csv" as const,
  maxInputBytes: 25 * MiB,
  maxSheets: 256,
  maxRows: 100_000,
  maxColumns: 256,
  maxCells: 1_000_000,
  maxOutputBytes: 25 * MiB,
  workbook: {
    maxTotalRows: 100_000,
    maxTotalColumns: 65_536,
    maxTotalCells: 1_000_000,
    maxStrings: 1_000_000,
    maxRecords: 2_000_000,
  },
  zip: {
    maxEntries: 2_048,
    maxUncompressedBytes: 64 * MiB,
    maxCompressionRatio: 100,
  },
  csv: {
    encoding: "utf-8" as const,
    bom: true,
    delimiter: "," as const,
    lineEnding: "\r\n" as const,
    finalLineEnding: true,
  },
  thread: {
    timeoutMs: 30_000,
    network: "none" as const,
  },
});

const METADATA_PARSE_OPTIONS = hardenWorkerValue({
  type: "array" as const,
  bookSheets: true,
  bookProps: false,
  bookVBA: false,
  cellDates: false,
  cellFormula: false,
  cellHTML: false,
  cellNF: false,
  cellText: false,
  dense: true,
  WTF: true,
});

const SELECTED_PARSE_OPTIONS = hardenWorkerValue({
  type: "array" as const,
  bookDeps: false,
  bookFiles: false,
  bookVBA: false,
  cellDates: false,
  cellFormula: true,
  cellHTML: false,
  cellNF: true,
  cellStyles: false,
  cellText: true,
  dense: true,
  sheetRows: 100_001,
  WTF: true,
});

function mutableSheetJsOptions(
  policy: Readonly<Record<string, unknown>>,
  additions?: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const output = Object.create(null) as Record<string, unknown>;
  for (const source of additions ? [policy, additions] : [policy]) {
    for (const key of Reflect.ownKeys(source)) {
      if (typeof key !== "string") fail();
      const value = ownData(source, key);
      output[key] = Array.isArray(value) ? Array.from(value) : value;
    }
  }
  return output;
}

const THREAD_OPTIONS = hardenWorkerValue({
  argv: [] as string[],
  env: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" },
  execArgv: [] as string[],
  name: "opentrad-spreadsheet",
  resourceLimits: {
    maxOldGenerationSizeMb: 256,
    maxYoungGenerationSizeMb: 32,
    stackSizeMb: 4,
  },
  stderr: true,
  stdout: true,
});

let requestSequence = 0;

function signalAborted(signal: unknown): boolean {
  if (
    signal === null ||
    typeof signal !== "object" ||
    isProxy(signal) ||
    Object.getPrototypeOf(signal) !== AbortSignal.prototype ||
    !abortSignalAbortedGetter
  ) {
    fail();
  }
  try {
    return Reflect.apply(abortSignalAbortedGetter, signal, []) as boolean;
  } catch {
    fail();
  }
}

function parseAdapterRequest(input: unknown): SpreadsheetAdapterRequest {
  if (
    !isPlainRecord(input) ||
    !exactKeys(input, ["input", "inputFormat", "outputFormat", "options"])
  ) {
    fail();
  }
  const source = ownData(input, "input");
  const inputFormat = ownData(input, "inputFormat");
  const outputFormat = ownData(input, "outputFormat");
  const options = ownData(input, "options");
  const sourceLength = exactUint8Array(source) ? uint8ArrayDetails(source).byteLength : -1;
  if (
    !exactUint8Array(source) ||
    sourceLength < 1 ||
    sourceLength > SPREADSHEET_POLICY.maxInputBytes ||
    (inputFormat !== "xls" && inputFormat !== "xlsx" && inputFormat !== "ods") ||
    outputFormat !== "csv" ||
    !isPlainRecord(options)
  ) {
    fail();
  }
  const optionKeys = Reflect.ownKeys(options);
  if (optionKeys.length > 1 || (optionKeys.length === 1 && optionKeys[0] !== "sheetIndex")) {
    fail();
  }
  const sheetIndex = optionKeys.length === 0 ? undefined : ownData(options, "sheetIndex");
  if (
    sheetIndex !== undefined &&
    (typeof sheetIndex !== "number" ||
      !Number.isSafeInteger(sheetIndex) ||
      sheetIndex < 0 ||
      sheetIndex > 255)
  ) {
    fail();
  }
  return {
    input: copyBytes(source),
    inputFormat,
    outputFormat,
    options: sheetIndex === undefined ? {} : { sheetIndex },
  };
}

function parseThreadRuntime(input: unknown): SpreadsheetThreadRuntime {
  if (!isPlainRecord(input) || !exactKeys(input, ["createThread", "setTimer", "clearTimer"])) {
    fail();
  }
  const createThread = ownData(input, "createThread");
  const setTimer = ownData(input, "setTimer");
  const clearTimer = ownData(input, "clearTimer");
  if (
    typeof createThread !== "function" ||
    typeof setTimer !== "function" ||
    typeof clearTimer !== "function"
  ) {
    fail();
  }
  return {
    createThread: (url, options) => Reflect.apply(createThread, input, [url, options]),
    setTimer: (callback, delay) => Reflect.apply(setTimer, input, [callback, delay]),
    clearTimer: (timer) => {
      Reflect.apply(clearTimer, input, [timer]);
    },
  } as SpreadsheetThreadRuntime;
}

function nextRequestId(): string {
  if (requestSequence >= Number.MAX_SAFE_INTEGER) fail();
  requestSequence += 1;
  return `spreadsheet-${requestSequence}`;
}

function terminateThread(thread: SpreadsheetThread): void {
  try {
    void Promise.resolve(thread.terminate()).catch(() => undefined);
  } catch {}
}

function parseThreadOutput(input: unknown, expectedId: string): Uint8Array {
  if (!isPlainRecord(input) || !exactKeys(input, ["id", "ok", "output"])) fail();
  if (ownData(input, "id") !== expectedId || ownData(input, "ok") !== true) fail();
  const buffer = ownData(input, "output");
  if (!exactArrayBuffer(buffer)) fail();
  const length = arrayBufferLength(buffer);
  if (length < 5 || length > SPREADSHEET_POLICY.maxOutputBytes) fail();
  const bytes = new intrinsicUint8Array(buffer);
  if (
    bytes[0] !== 0xef ||
    bytes[1] !== 0xbb ||
    bytes[2] !== 0xbf ||
    bytes[length - 2] !== 0x0d ||
    bytes[length - 1] !== 0x0a
  ) {
    fail();
  }
  return copyBytes(bytes);
}

function isFixedThreadFailure(input: unknown, expectedId: string): boolean {
  return (
    isPlainRecord(input) &&
    exactKeys(input, ["id", "ok", "code"]) &&
    ownData(input, "id") === expectedId &&
    ownData(input, "ok") === false &&
    ownData(input, "code") === "CONVERSION_FAILED"
  );
}

function createSpreadsheetAdapter(runtimeInput: unknown) {
  const runtime = parseThreadRuntime(runtimeInput);
  return function run(input: unknown, signal: AbortSignal): Promise<Uint8Array> {
    let request: SpreadsheetAdapterRequest;
    try {
      if (signalAborted(signal)) return Promise.reject(new SpreadsheetError("JOB_CANCELLED"));
      request = parseAdapterRequest(input);
    } catch {
      return Promise.reject(new SpreadsheetError("CONVERSION_FAILED"));
    }

    return new Promise((resolve, reject) => {
      let thread: SpreadsheetThread;
      try {
        thread = runtime.createThread(
          new URL("../threads/spreadsheetThread.js", import.meta.url),
          THREAD_OPTIONS,
        );
      } catch {
        reject(new SpreadsheetError("CONVERSION_FAILED"));
        return;
      }
      const id = nextRequestId();
      let settled = false;
      let timer: unknown;
      const finish = (
        code: "JOB_CANCELLED" | "CONVERSION_TIMEOUT" | "CONVERSION_FAILED" | undefined,
        output?: Uint8Array,
        terminate = false,
      ) => {
        if (settled) return;
        settled = true;
        try {
          if (timer !== undefined) runtime.clearTimer(timer);
        } catch {}
        try {
          Reflect.apply(abortRemoveEventListener, signal, ["abort", onAbort]);
        } catch {}
        try {
          thread.off("message", onMessage);
        } catch {}
        try {
          thread.off("error", onError);
        } catch {}
        try {
          thread.off("exit", onExit);
        } catch {}
        if (terminate) terminateThread(thread);
        if (code) reject(new SpreadsheetError(code));
        else if (output) resolve(output);
        else reject(new SpreadsheetError("CONVERSION_FAILED"));
      };
      const onAbort = () => finish("JOB_CANCELLED", undefined, true);
      const onError = () => finish("CONVERSION_FAILED", undefined, true);
      const onExit = () => finish("CONVERSION_FAILED", undefined, true);
      const onMessage = (message: unknown) => {
        try {
          if (isFixedThreadFailure(message, id)) {
            finish("CONVERSION_FAILED", undefined, true);
            return;
          }
          finish(undefined, parseThreadOutput(message, id));
        } catch {
          finish("CONVERSION_FAILED", undefined, true);
        }
      };
      try {
        thread.on("message", onMessage);
        thread.on("error", onError);
        thread.on("exit", onExit);
        Reflect.apply(abortAddEventListener, signal, ["abort", onAbort, { once: true }]);
        if (signalAborted(signal)) {
          finish("JOB_CANCELLED", undefined, true);
          return;
        }
        const createdTimer = runtime.setTimer(
          () => finish("CONVERSION_TIMEOUT", undefined, true),
          SPREADSHEET_POLICY.thread.timeoutMs,
        );
        timer = createdTimer;
        if (settled) {
          try {
            runtime.clearTimer(createdTimer);
          } catch {}
          return;
        }
        const message: SpreadsheetThreadRequest = Object.freeze({
          id,
          kind: "spreadsheet.to.csv" as const,
          input: ownedBuffer(request.input),
          inputFormat: request.inputFormat,
          outputFormat: "csv" as const,
          sheetIndex: request.options.sheetIndex ?? 0,
        });
        thread.postMessage(message, [message.input]);
      } catch {
        finish("CONVERSION_FAILED", undefined, true);
      }
    });
  };
}

const defaultThreadRuntime: SpreadsheetThreadRuntime = {
  createThread(url, options) {
    const worker = new Worker(url, options as WorkerOptions);
    worker.stdout?.resume();
    worker.stderr?.resume();
    return worker as unknown as SpreadsheetThread;
  },
  setTimer(callback, delay) {
    return setTimeout(callback, delay);
  },
  clearTimer(timer) {
    clearTimeout(timer as ReturnType<typeof setTimeout>);
  },
};

const defaultSpreadsheetAdapter = createSpreadsheetAdapter(defaultThreadRuntime);

function parseThreadRequest(input: unknown): SpreadsheetThreadRequest {
  if (
    !isPlainRecord(input) ||
    !exactKeys(input, ["id", "kind", "input", "inputFormat", "outputFormat", "sheetIndex"])
  ) {
    fail();
  }
  const id = ownData(input, "id");
  const kind = ownData(input, "kind");
  const buffer = ownData(input, "input");
  const inputFormat = ownData(input, "inputFormat");
  const outputFormat = ownData(input, "outputFormat");
  const sheetIndex = ownData(input, "sheetIndex");
  if (
    typeof id !== "string" ||
    !/^spreadsheet-[1-9][0-9]*$/u.test(id) ||
    id.length > 64 ||
    kind !== "spreadsheet.to.csv" ||
    !exactArrayBuffer(buffer) ||
    arrayBufferLength(buffer) < 1 ||
    arrayBufferLength(buffer) > SPREADSHEET_POLICY.maxInputBytes ||
    (inputFormat !== "xls" && inputFormat !== "xlsx" && inputFormat !== "ods") ||
    outputFormat !== "csv" ||
    typeof sheetIndex !== "number" ||
    !Number.isSafeInteger(sheetIndex) ||
    sheetIndex < 0 ||
    sheetIndex > 255
  ) {
    fail();
  }
  return { id, kind, input: buffer, inputFormat, outputFormat, sheetIndex };
}

export function handleSpreadsheetThreadMessage(
  input: unknown,
  library: unknown,
): {
  readonly id: string;
  readonly ok: boolean;
  readonly output?: ArrayBuffer;
  readonly code?: "CONVERSION_FAILED";
} {
  const request = parseThreadRequest(input);
  try {
    const output = convertSpreadsheetSync(
      new intrinsicUint8Array(request.input),
      request.inputFormat,
      request.sheetIndex,
      library,
    );
    return { id: request.id, ok: true, output: ownedBuffer(output) };
  } catch {
    return { id: request.id, ok: false, code: "CONVERSION_FAILED" };
  }
}

export async function convertSpreadsheetToCsv(
  request: unknown,
  signal: AbortSignal,
): Promise<Uint8Array> {
  return defaultSpreadsheetAdapter(request, signal);
}

export const __spreadsheetTest = Object.freeze({
  createAdapter: createSpreadsheetAdapter,
  convertSync: convertSpreadsheetSync,
  handleThreadMessage: handleSpreadsheetThreadMessage,
  preflight: preflightSpreadsheet,
});
