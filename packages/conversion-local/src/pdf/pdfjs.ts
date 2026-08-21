import { AnnotationMode, GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const KiB = 1024;
const MiB = 1024 * KiB;
const IntrinsicArrayBuffer = ArrayBuffer;
const IntrinsicError = Error;
const IntrinsicMap = Map;
const IntrinsicSet = Set;
const IntrinsicString = String;
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
const intrinsicClearTimeout = globalThis.clearTimeout;
const intrinsicEventTargetAddEventListener = EventTarget.prototype.addEventListener;
const intrinsicEventTargetRemoveEventListener = EventTarget.prototype.removeEventListener;
const intrinsicFreeze = Object.freeze;
const intrinsicDefineProperty = Object.defineProperty;
const intrinsicDateNow = Date.now;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicNumberIsFinite = Number.isFinite;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicMathCeil = Math.ceil;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicSetTimeout = globalThis.setTimeout;
const intrinsicStringCharCodeAt = String.prototype.charCodeAt;
const intrinsicStringNormalize = String.prototype.normalize;
const intrinsicStringToLowerCase = String.prototype.toLowerCase;
const intrinsicMapPrototype = IntrinsicMap.prototype;
const intrinsicMapSize = intrinsicReflectGetOwnPropertyDescriptor(
  intrinsicMapPrototype,
  "size",
)?.get;
const intrinsicSetPrototype = IntrinsicSet.prototype;
const intrinsicSetSize = intrinsicReflectGetOwnPropertyDescriptor(
  intrinsicSetPrototype,
  "size",
)?.get;
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

type PdfFailureCode =
  | "LOCAL_CONVERSION_CANCELLED"
  | "PDF_DIMENSION_LIMIT"
  | "PDF_ENCRYPTED"
  | "PDF_FORMAT_INVALID"
  | "PDF_INPUT_INVALID"
  | "PDF_INPUT_TOO_LARGE"
  | "PDF_LOAD_FAILED"
  | "PDF_OBJECT_LIMIT"
  | "PDF_OPTIONS_INVALID"
  | "PDF_PAGE_LIMIT"
  | "PDF_PAGE_OUT_OF_RANGE"
  | "PDF_RENDER_LIMIT"
  | "PDF_SECURITY_VIOLATION"
  | "PDF_TEXT_LIMIT"
  | "PDF_TIMEOUT";

const sentinels = intrinsicObjectCreate(null) as Record<PdfFailureCode, object>;
for (const code of [
  "LOCAL_CONVERSION_CANCELLED",
  "PDF_DIMENSION_LIMIT",
  "PDF_ENCRYPTED",
  "PDF_FORMAT_INVALID",
  "PDF_INPUT_INVALID",
  "PDF_INPUT_TOO_LARGE",
  "PDF_LOAD_FAILED",
  "PDF_OBJECT_LIMIT",
  "PDF_OPTIONS_INVALID",
  "PDF_PAGE_LIMIT",
  "PDF_PAGE_OUT_OF_RANGE",
  "PDF_RENDER_LIMIT",
  "PDF_SECURITY_VIOLATION",
  "PDF_TEXT_LIMIT",
  "PDF_TIMEOUT",
] as const) {
  sentinels[code] = intrinsicFreeze(intrinsicObjectCreate(null));
}
intrinsicFreeze(sentinels);

function fail(code: PdfFailureCode): never {
  throw sentinels[code];
}

function fixedError(error: unknown, fallback: PdfFailureCode): Error {
  for (const code of intrinsicReflectOwnKeys(sentinels) as PdfFailureCode[]) {
    if (error === sentinels[code]) return new IntrinsicError(code);
  }
  return new IntrinsicError(fallback);
}

async function boundary<T>(work: () => Promise<T>, fallback: PdfFailureCode): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw fixedError(error, fallback);
  }
}

function makeFrozenNull<T extends Record<string, unknown>>(values: T): Readonly<T> {
  const output = intrinsicObjectCreate(null) as Record<string, unknown>;
  const keys = intrinsicReflectOwnKeys(values);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") fail("PDF_SECURITY_VIOLATION");
    const descriptor = intrinsicReflectGetOwnPropertyDescriptor(values, key);
    if (!descriptor || !("value" in descriptor)) fail("PDF_SECURITY_VIOLATION");
    intrinsicDefineProperty(output, key, { enumerable: true, value: descriptor.value });
  }
  return intrinsicFreeze(output) as Readonly<T>;
}

const documentOptions = intrinsicObjectCreate(null) as {
  isEvalSupported: false;
  stopEvent: true;
  useWorkerFetch: false;
};
documentOptions.isEvalSupported = false;
documentOptions.stopEvent = true;
documentOptions.useWorkerFetch = false;
export const PDFJS_DOCUMENT_OPTIONS = intrinsicFreeze(documentOptions);

const viewerOptions = intrinsicObjectCreate(null) as {
  disablePreferences: true;
  enableScripting: false;
};
viewerOptions.disablePreferences = true;
viewerOptions.enableScripting = false;
export const PDFJS_VIEWER_OPTIONS = intrinsicFreeze(viewerOptions);

const mutableLimits = intrinsicObjectCreate(null) as {
  maxInputBytes: number;
  maxObjectTokens: number;
  maxPageArea: number;
  maxPageDimension: number;
  maxPages: number;
  maxRenderDimension: number;
  maxRenderPixels: number;
  maxScale: number;
  maxTextChars: number;
  timeoutMs: number;
};
mutableLimits.maxInputBytes = 25 * MiB;
mutableLimits.maxObjectTokens = 10_000;
mutableLimits.maxPageArea = 40_000_000;
mutableLimits.maxPageDimension = 14_400;
mutableLimits.maxPages = 80;
mutableLimits.maxRenderDimension = 16_384;
mutableLimits.maxRenderPixels = 40_000_000;
mutableLimits.maxScale = 4;
mutableLimits.maxTextChars = 5_000_000;
mutableLimits.timeoutMs = 15_000;
export const PDF_LIMITS = intrinsicFreeze(mutableLimits);

function isRemoteWorkerUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length < 1 || value.length > 2_048) return true;
  const lower = value.toLowerCase();
  return (
    lower.startsWith("http:") ||
    lower.startsWith("https:") ||
    lower.startsWith("data:") ||
    lower.startsWith("blob:") ||
    lower.startsWith("//")
  );
}

const pdfJsDefaultWorkerUrl = GlobalWorkerOptions.workerSrc;
const nodeWorkerUrl =
  typeof pdfJsDefaultWorkerUrl === "string" && pdfJsDefaultWorkerUrl.length > 0
    ? pdfJsDefaultWorkerUrl
    : "./pdf.worker.mjs";
let browserWorkerUrl: string | undefined;

async function configurePdfWorker(): Promise<void> {
  try {
    if (typeof window === "undefined") {
      if (isRemoteWorkerUrl(nodeWorkerUrl)) fail("PDF_LOAD_FAILED");
      GlobalWorkerOptions.workerSrc = nodeWorkerUrl;
      return;
    }
    if (!browserWorkerUrl) {
      const workerModule = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
      const candidate = workerModule.default;
      if (isRemoteWorkerUrl(candidate)) fail("PDF_LOAD_FAILED");
      browserWorkerUrl = candidate;
    }
    GlobalWorkerOptions.workerSrc = browserWorkerUrl;
  } catch (error) {
    if (error === sentinels.PDF_LOAD_FAILED) throw error;
    fail("PDF_LOAD_FAILED");
  }
}

interface PdfJsLoadingTask {
  destroy(): Promise<void>;
  onPassword?: (...args: readonly unknown[]) => void;
  readonly promise: Promise<PdfJsDocument>;
}

interface PdfJsRenderTask {
  cancel(): void;
  readonly promise: Promise<void>;
}

interface PdfJsPage {
  cleanup(): boolean;
  getAnnotations(options?: { intent?: string }): Promise<unknown>;
  getJSActions(): Promise<unknown>;
  getTextContent(options?: Record<string, unknown>): Promise<unknown>;
  getViewport(options: { scale: number }): unknown;
  getXfa(): Promise<unknown>;
  render(options: Record<string, unknown>): PdfJsRenderTask;
  readonly rotate: unknown;
  readonly view: unknown;
}

interface PdfJsDocument {
  readonly allXfaHtml: unknown;
  destroy(): Promise<void>;
  getAttachments(): Promise<unknown>;
  getJSActions(): Promise<unknown>;
  getOpenAction(): Promise<unknown>;
  getOutline(): Promise<unknown>;
  getPage(pageNumber: number): Promise<PdfJsPage>;
  readonly isPureXfa: unknown;
  readonly numPages: unknown;
}

interface LoadedDocument {
  readonly deadline: number;
  readonly document: PdfJsDocument;
  readonly pageCount: number;
  readonly task: PdfJsLoadingTask;
}

export interface LoadLocalPdfOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface LocalPdfHandle {
  readonly destroy: () => Promise<void>;
  readonly pageCount: number;
}

export interface PdfPageInspection {
  readonly height: number;
  readonly pageNumber: number;
  readonly rotation: number;
  readonly width: number;
}

export interface PdfInspection {
  readonly pageCount: number;
  readonly pages: readonly PdfPageInspection[];
}

export interface PdfTextPage {
  readonly pageNumber: number;
  readonly text: string;
}

export interface PdfTextResult {
  readonly pageCount: number;
  readonly pages: readonly PdfTextPage[];
  readonly text: string;
}

function checkAbort(signal?: AbortSignal): void {
  if (!signal) return;
  if (!intrinsicAbortSignalAborted) fail("LOCAL_CONVERSION_CANCELLED");
  try {
    if (intrinsicReflectApply(intrinsicAbortSignalAborted, signal, []) === true) {
      fail("LOCAL_CONVERSION_CANCELLED");
    }
  } catch (error) {
    if (error === sentinels.LOCAL_CONVERSION_CANCELLED) throw error;
    fail("LOCAL_CONVERSION_CANCELLED");
  }
}

function currentTime(): number {
  const value = intrinsicReflectApply(intrinsicDateNow, undefined, []) as number;
  if (!intrinsicNumberIsFinite(value)) fail("PDF_TIMEOUT");
  return value;
}

function remainingTime(deadline: number): number {
  if (!intrinsicNumberIsFinite(deadline)) fail("PDF_TIMEOUT");
  const remaining = intrinsicReflectApply(intrinsicMathCeil, undefined, [
    deadline - currentTime(),
  ]) as number;
  if (
    !intrinsicNumberIsSafeInteger(remaining) ||
    remaining < 1 ||
    remaining > PDF_LIMITS.timeoutMs
  ) {
    fail("PDF_TIMEOUT");
  }
  return remaining;
}

function checkDeadline(deadline: number): void {
  remainingTime(deadline);
}

function bufferByteLength(value: ArrayBuffer): number {
  if (!intrinsicArrayBufferByteLength) fail("PDF_INPUT_INVALID");
  return intrinsicReflectApply(intrinsicArrayBufferByteLength, value, []) as number;
}

function copyInput(input: unknown): Uint8Array<ArrayBuffer> {
  try {
    let source: Uint8Array;
    let length: number;
    if (
      input !== null &&
      typeof input === "object" &&
      intrinsicGetPrototypeOf(input) === IntrinsicArrayBuffer.prototype
    ) {
      if (!intrinsicArrayBufferByteLength) fail("PDF_INPUT_INVALID");
      length = intrinsicReflectApply(intrinsicArrayBufferByteLength, input, []) as number;
      if (
        intrinsicArrayBufferResizable &&
        intrinsicReflectApply(intrinsicArrayBufferResizable, input, []) === true
      ) {
        fail("PDF_INPUT_INVALID");
      }
      source = new IntrinsicUint8Array(input as ArrayBuffer);
    } else {
      if (
        input === null ||
        typeof input !== "object" ||
        intrinsicGetPrototypeOf(input) !== IntrinsicUint8Array.prototype ||
        !intrinsicTypedArrayByteLength ||
        !intrinsicTypedArrayByteOffset ||
        !intrinsicTypedArrayBuffer
      ) {
        fail("PDF_INPUT_INVALID");
      }
      length = intrinsicReflectApply(intrinsicTypedArrayByteLength, input, []) as number;
      const offset = intrinsicReflectApply(intrinsicTypedArrayByteOffset, input, []) as number;
      const buffer = intrinsicReflectApply(intrinsicTypedArrayBuffer, input, []) as unknown;
      if (
        offset !== 0 ||
        intrinsicGetPrototypeOf(buffer as object) !== IntrinsicArrayBuffer.prototype ||
        bufferByteLength(buffer as ArrayBuffer) !== length ||
        (intrinsicArrayBufferResizable &&
          intrinsicReflectApply(intrinsicArrayBufferResizable, buffer, []) === true)
      ) {
        fail("PDF_INPUT_INVALID");
      }
      source = input as Uint8Array;
    }
    if (!intrinsicNumberIsSafeInteger(length) || length < 1) fail("PDF_INPUT_INVALID");
    if (length > PDF_LIMITS.maxInputBytes) fail("PDF_INPUT_TOO_LARGE");
    const copy = new IntrinsicUint8Array(length);
    intrinsicReflectApply(intrinsicUint8ArraySet, copy, [source]);
    return copy;
  } catch (error) {
    if (error === sentinels.PDF_INPUT_TOO_LARGE || error === sentinels.PDF_INPUT_INVALID) {
      throw error;
    }
    fail("PDF_INPUT_INVALID");
  }
}

function asciiAt(bytes: Uint8Array, offset: number, value: string): boolean {
  if (offset < 0 || offset + value.length > bytes.byteLength) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = intrinsicReflectApply(intrinsicStringCharCodeAt, value, [index]) as number;
    if (bytes[offset + index] !== code) return false;
  }
  return true;
}

function findAscii(bytes: Uint8Array, value: string, start = 0): number {
  for (let offset = start; offset + value.length <= bytes.byteLength; offset += 1) {
    if (asciiAt(bytes, offset, value)) return offset;
  }
  return -1;
}

function lastAscii(bytes: Uint8Array, value: string, minimum = 0): number {
  for (let offset = bytes.byteLength - value.length; offset >= minimum; offset -= 1) {
    if (asciiAt(bytes, offset, value)) return offset;
  }
  return -1;
}

function preflight(bytes: Uint8Array<ArrayBuffer>): void {
  if (bytes.byteLength < 20 || !asciiAt(bytes, 0, "%PDF-")) fail("PDF_FORMAT_INVALID");
  const major = bytes[5] ?? 0;
  const dot = bytes[6] ?? 0;
  const minor = bytes[7] ?? 0;
  const validVersion =
    dot === 0x2e &&
    ((major === 0x31 && minor >= 0x30 && minor <= 0x37) || (major === 0x32 && minor === 0x30));
  if (!validVersion) fail("PDF_FORMAT_INVALID");
  const tailStart = Math.max(0, bytes.byteLength - 4_096);
  if (lastAscii(bytes, "%%EOF", tailStart) < 0 || lastAscii(bytes, "startxref", tailStart) < 0) {
    fail("PDF_FORMAT_INVALID");
  }

  let objects = 0;
  for (let offset = 0; offset + 4 <= bytes.byteLength; offset += 1) {
    if (
      (bytes[offset] === 0x20 || bytes[offset] === 0x0a || bytes[offset] === 0x0d) &&
      asciiAt(bytes, offset + 1, "obj")
    ) {
      objects += 1;
      if (objects > PDF_LIMITS.maxObjectTokens) fail("PDF_OBJECT_LIMIT");
    }
  }

  if (findAscii(bytes, "/Encrypt") >= 0) fail("PDF_ENCRYPTED");
  for (const token of [
    "/Type /EmbeddedFile",
    "/EmbeddedFiles",
    "/JavaScript",
    "/JS",
    "/OpenAction",
    "/XFA",
    "/Launch",
    "/URI",
    "http://",
    "https://",
    "javascript:",
    "file:",
  ]) {
    if (findAscii(bytes, token) >= 0) fail("PDF_SECURITY_VIOLATION");
  }
}

function destroyQuietly(value: { destroy(): Promise<void> } | undefined): void {
  if (!value) return;
  try {
    void value.destroy().catch(() => undefined);
  } catch {
    // Cleanup failure is never exposed or logged.
  }
}

async function destroyLoaded(loaded: LoadedDocument): Promise<void> {
  try {
    await loaded.document.destroy();
  } catch {
    // Continue with loading-task cleanup.
  }
  try {
    await loaded.task.destroy();
  } catch {
    // Cleanup errors are intentionally hidden.
  }
}

async function loadInternal(
  input: unknown,
  signal?: AbortSignal,
  timeoutInput?: number,
): Promise<LoadedDocument> {
  checkAbort(signal);
  const timeoutMs = timeoutInput ?? PDF_LIMITS.timeoutMs;
  if (
    !intrinsicNumberIsSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > PDF_LIMITS.timeoutMs
  ) {
    fail("PDF_TIMEOUT");
  }
  const deadline = currentTime() + timeoutMs;
  const bytes = copyInput(input);
  preflight(bytes);
  checkDeadline(deadline);
  await configurePdfWorker();
  checkDeadline(deadline);
  let task: PdfJsLoadingTask;
  try {
    const loadOptions = {
      data: bytes,
      disableAutoFetch: true,
      disableRange: true,
      disableStream: true,
      enableXfa: false,
      isEvalSupported: PDFJS_DOCUMENT_OPTIONS.isEvalSupported,
      maxImageSize: PDF_LIMITS.maxRenderPixels,
      stopAtErrors: true,
      useSystemFonts: false,
      useWasm: false,
      useWorkerFetch: PDFJS_DOCUMENT_OPTIONS.useWorkerFetch,
      verbosity: 0,
    } as unknown as Parameters<typeof getDocument>[0];
    task = getDocument(loadOptions) as unknown as PdfJsLoadingTask;
  } catch {
    fail("PDF_LOAD_FAILED");
  }

  return new Promise<LoadedDocument>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) intrinsicClearTimeout(timer);
      if (signal) {
        try {
          intrinsicReflectApply(intrinsicEventTargetRemoveEventListener, signal, [
            "abort",
            onAbort,
          ]);
        } catch {
          // Ignore hostile cleanup behavior.
        }
      }
    };
    const rejectOnce = (reason: object) => {
      if (settled) return;
      settled = true;
      cleanup();
      destroyQuietly(task);
      reject(reason);
    };
    const onAbort = () => rejectOnce(sentinels.LOCAL_CONVERSION_CANCELLED);
    task.promise.then(
      (document) => {
        if (settled) {
          destroyQuietly(document);
          return;
        }
        try {
          const rawPageCount = document.numPages;
          if (!intrinsicNumberIsSafeInteger(rawPageCount) || (rawPageCount as number) < 1) {
            fail("PDF_FORMAT_INVALID");
          }
          const pageCount = rawPageCount as number;
          if (pageCount > PDF_LIMITS.maxPages) fail("PDF_PAGE_LIMIT");
          settled = true;
          cleanup();
          checkDeadline(deadline);
          resolve({ deadline, document, pageCount, task });
        } catch (error) {
          rejectOnce(
            error === sentinels.PDF_PAGE_LIMIT || error === sentinels.PDF_FORMAT_INVALID
              ? (error as object)
              : sentinels.PDF_LOAD_FAILED,
          );
        }
      },
      () => rejectOnce(sentinels.PDF_LOAD_FAILED),
    );
    try {
      task.onPassword = () => rejectOnce(sentinels.PDF_ENCRYPTED);
      if (signal) {
        intrinsicReflectApply(intrinsicEventTargetAddEventListener, signal, [
          "abort",
          onAbort,
          { once: true },
        ]);
        checkAbort(signal);
      }
    } catch {
      rejectOnce(sentinels.LOCAL_CONVERSION_CANCELLED);
      return;
    }
    timer = intrinsicSetTimeout(() => rejectOnce(sentinels.PDF_TIMEOUT), remainingTime(deadline));
  });
}

export async function loadLocalPdf(
  input: Uint8Array | ArrayBuffer,
  options: LoadLocalPdfOptions = {},
): Promise<LocalPdfHandle> {
  return boundary(async () => {
    const parsedOptions = parseLoadOptions(options);
    const loaded = await loadInternal(input, parsedOptions.signal, parsedOptions.timeoutMs);
    let destroyed = false;
    const handle = intrinsicObjectCreate(null) as {
      destroy: () => Promise<void>;
      pageCount: number;
    };
    handle.pageCount = loaded.pageCount;
    handle.destroy = async () => {
      if (destroyed) return;
      destroyed = true;
      await destroyLoaded(loaded);
    };
    return intrinsicFreeze(handle);
  }, "PDF_LOAD_FAILED");
}

function nonEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (intrinsicArrayIsArray(value)) return value.length > 0;
  if (typeof value === "object") {
    const prototype = intrinsicGetPrototypeOf(value);
    if (prototype === intrinsicMapPrototype) {
      if (!intrinsicMapSize) fail("PDF_SECURITY_VIOLATION");
      return (intrinsicReflectApply(intrinsicMapSize, value, []) as number) > 0;
    }
    if (prototype === intrinsicSetPrototype) {
      if (!intrinsicSetSize) fail("PDF_SECURITY_VIOLATION");
      return (intrinsicReflectApply(intrinsicSetSize, value, []) as number) > 0;
    }
    return intrinsicReflectOwnKeys(value).length > 0;
  }
  return true;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || intrinsicArrayIsArray(value)) return false;
  const prototype = intrinsicGetPrototypeOf(value);
  return prototype === intrinsicObjectPrototype || prototype === null;
}

function ownData(value: object, key: string): unknown {
  const descriptor = intrinsicReflectGetOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) fail("PDF_SECURITY_VIOLATION");
  return descriptor.value;
}

const LOAD_OPTION_KEYS = intrinsicFreeze(["signal", "timeoutMs"] as const);
const EXTRACT_OPTION_KEYS = intrinsicFreeze(["pages", "signal", "timeoutMs"] as const);
const RENDER_OPTION_KEYS = intrinsicFreeze([
  "format",
  "pageNumber",
  "quality",
  "scale",
  "signal",
  "timeoutMs",
] as const);

function optionsInvalid(): never {
  fail("PDF_OPTIONS_INVALID");
}

function exactOptions(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  try {
    if (!plainRecord(input)) optionsInvalid();
    const keys = intrinsicReflectOwnKeys(input);
    if (keys.length > allowed.length) optionsInvalid();
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== "string") optionsInvalid();
      let accepted = false;
      for (let allowedIndex = 0; allowedIndex < allowed.length; allowedIndex += 1) {
        if (allowed[allowedIndex] === key) accepted = true;
      }
      if (!accepted) optionsInvalid();
      const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, key);
      if (!descriptor || !("value" in descriptor)) optionsInvalid();
    }
    return input;
  } catch (error) {
    if (error === sentinels.PDF_OPTIONS_INVALID) throw error;
    optionsInvalid();
  }
}

function readOptional(source: Record<string, unknown>, key: string): unknown {
  const descriptor = intrinsicReflectGetOwnPropertyDescriptor(source, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) optionsInvalid();
  return descriptor.value;
}

function copyBaseOptions(source: Record<string, unknown>, output: Record<string, unknown>): void {
  const signal = readOptional(source, "signal");
  if (signal !== undefined) {
    try {
      if (
        signal === null ||
        typeof signal !== "object" ||
        intrinsicGetPrototypeOf(signal) !== AbortSignal.prototype ||
        !intrinsicAbortSignalAborted
      ) {
        optionsInvalid();
      }
      intrinsicReflectApply(intrinsicAbortSignalAborted, signal, []);
    } catch (error) {
      if (error === sentinels.PDF_OPTIONS_INVALID) throw error;
      optionsInvalid();
    }
    intrinsicDefineProperty(output, "signal", { enumerable: true, value: signal });
  }
  const timeoutMs = readOptional(source, "timeoutMs");
  if (timeoutMs !== undefined) {
    if (
      !intrinsicNumberIsSafeInteger(timeoutMs) ||
      (timeoutMs as number) < 1 ||
      (timeoutMs as number) > PDF_LIMITS.timeoutMs
    ) {
      optionsInvalid();
    }
    intrinsicDefineProperty(output, "timeoutMs", { enumerable: true, value: timeoutMs });
  }
}

function parseLoadOptions(input: unknown): LoadLocalPdfOptions {
  const source = exactOptions(input, LOAD_OPTION_KEYS);
  const output = intrinsicObjectCreate(null) as Record<string, unknown>;
  copyBaseOptions(source, output);
  return intrinsicFreeze(output) as LoadLocalPdfOptions;
}

function parsePageSelection(input: unknown): readonly number[] {
  try {
    if (
      !intrinsicArrayIsArray(input) ||
      intrinsicGetPrototypeOf(input) !== intrinsicArrayPrototype
    ) {
      optionsInvalid();
    }
    const lengthDescriptor = intrinsicReflectGetOwnPropertyDescriptor(input, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor)) optionsInvalid();
    const rawLength = lengthDescriptor.value;
    if (!intrinsicNumberIsSafeInteger(rawLength)) optionsInvalid();
    const length = rawLength as number;
    if (length < 1 || length > PDF_LIMITS.maxPages) {
      optionsInvalid();
    }
    const keys = intrinsicReflectOwnKeys(input);
    if (keys.length !== length + 1) optionsInvalid();
    const output: number[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, IntrinsicString(index));
      if (
        !descriptor ||
        !("value" in descriptor) ||
        !intrinsicNumberIsSafeInteger(descriptor.value)
      ) {
        optionsInvalid();
      }
      output[index] = descriptor.value;
    }
    return intrinsicFreeze(output);
  } catch (error) {
    if (error === sentinels.PDF_OPTIONS_INVALID) throw error;
    optionsInvalid();
  }
}

function parseExtractOptions(input: unknown): ExtractPdfTextOptions {
  const source = exactOptions(input, EXTRACT_OPTION_KEYS);
  const output = intrinsicObjectCreate(null) as Record<string, unknown>;
  copyBaseOptions(source, output);
  const pages = readOptional(source, "pages");
  if (pages !== undefined) {
    intrinsicDefineProperty(output, "pages", {
      enumerable: true,
      value: parsePageSelection(pages),
    });
  }
  return intrinsicFreeze(output) as ExtractPdfTextOptions;
}

function parseRenderOptions(input: unknown): RenderPdfPageOptions {
  const source = exactOptions(input, RENDER_OPTION_KEYS);
  const output = intrinsicObjectCreate(null) as Record<string, unknown>;
  copyBaseOptions(source, output);
  const pageNumber = readOptional(source, "pageNumber");
  if (!intrinsicNumberIsSafeInteger(pageNumber)) {
    optionsInvalid();
  }
  intrinsicDefineProperty(output, "pageNumber", { enumerable: true, value: pageNumber });
  const format = readOptional(source, "format");
  if (format !== undefined) {
    if (format !== "png" && format !== "jpg") optionsInvalid();
    intrinsicDefineProperty(output, "format", { enumerable: true, value: format });
  }
  const quality = readOptional(source, "quality");
  if (quality !== undefined) {
    if (typeof quality !== "number") optionsInvalid();
    intrinsicDefineProperty(output, "quality", { enumerable: true, value: quality });
  }
  const scale = readOptional(source, "scale");
  if (scale !== undefined) {
    if (!finiteNumber(scale)) {
      optionsInvalid();
    }
    intrinsicDefineProperty(output, "scale", { enumerable: true, value: scale });
  }
  return intrinsicFreeze(output) as unknown as RenderPdfPageOptions;
}

function assertNoActiveGraph(value: unknown, depth = 0, count = { value: 0 }): void {
  if (value === null || value === undefined) return;
  if (depth > 32 || count.value > 10_000) fail("PDF_SECURITY_VIOLATION");
  if (typeof value !== "object") return;
  if (intrinsicArrayIsArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      count.value += 1;
      const descriptor = intrinsicReflectGetOwnPropertyDescriptor(value, IntrinsicString(index));
      if (!descriptor || !("value" in descriptor)) fail("PDF_SECURITY_VIOLATION");
      assertNoActiveGraph(descriptor.value, depth + 1, count);
    }
    return;
  }
  if (!plainRecord(value)) fail("PDF_SECURITY_VIOLATION");
  const keys = intrinsicReflectOwnKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") fail("PDF_SECURITY_VIOLATION");
    const item = ownData(value, key);
    const lowered = intrinsicReflectApply(intrinsicStringToLowerCase, key, []) as string;
    if (
      (lowered === "url" ||
        lowered === "unsafeurl" ||
        lowered === "action" ||
        lowered === "attachment" ||
        lowered === "file" ||
        lowered === "jsactions") &&
      nonEmpty(item)
    ) {
      fail("PDF_SECURITY_VIOLATION");
    }
    count.value += 1;
    assertNoActiveGraph(item, depth + 1, count);
  }
}

async function waitAbortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  onAbort?: () => void,
  deadline?: number,
): Promise<T> {
  if (deadline === undefined) fail("PDF_TIMEOUT");
  const timeoutMs = remainingTime(deadline);
  if (signal) checkAbort(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) intrinsicClearTimeout(timer);
      if (signal) {
        try {
          intrinsicReflectApply(intrinsicEventTargetRemoveEventListener, signal, ["abort", abort]);
        } catch {
          // Fixed public result is preserved.
        }
      }
    };
    const settle = (work: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      work();
    };
    const abort = () => {
      try {
        onAbort?.();
      } catch {
        // Cancellation continues.
      }
      settle(() => reject(sentinels.LOCAL_CONVERSION_CANCELLED));
    };
    const timeout = () => {
      try {
        onAbort?.();
      } catch {
        // Timeout still settles with a fixed public error.
      }
      settle(() => reject(sentinels.PDF_TIMEOUT));
    };
    try {
      if (signal) {
        intrinsicReflectApply(intrinsicEventTargetAddEventListener, signal, [
          "abort",
          abort,
          { once: true },
        ]);
        checkAbort(signal);
      }
    } catch {
      abort();
      return;
    }
    timer = intrinsicSetTimeout(timeout, timeoutMs);
    promise.then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error)),
    );
  });
}

async function checkDocumentGraph(
  document: PdfJsDocument,
  signal?: AbortSignal,
  deadline?: number,
): Promise<void> {
  if (deadline === undefined) fail("PDF_TIMEOUT");
  checkAbort(signal);
  let pureXfa: unknown;
  let allXfa: unknown;
  try {
    pureXfa = document.isPureXfa;
    allXfa = document.allXfaHtml;
  } catch {
    fail("PDF_SECURITY_VIOLATION");
  }
  if (pureXfa === true || (allXfa !== null && allXfa !== undefined)) {
    fail("PDF_SECURITY_VIOLATION");
  }
  const checks = [
    document.getAttachments(),
    document.getJSActions(),
    document.getOpenAction(),
    document.getOutline(),
  ];
  for (let index = 0; index < checks.length; index += 1) {
    let value: unknown;
    try {
      value = await waitAbortable(checks[index] as Promise<unknown>, signal, undefined, deadline);
    } catch (error) {
      if (error === sentinels.LOCAL_CONVERSION_CANCELLED || error === sentinels.PDF_TIMEOUT) {
        throw error;
      }
      fail("PDF_SECURITY_VIOLATION");
    }
    if (index < 3 && nonEmpty(value)) fail("PDF_SECURITY_VIOLATION");
    if (index === 3) assertNoActiveGraph(value);
  }
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && intrinsicNumberIsFinite(value);
}

async function inspectPage(
  document: PdfJsDocument,
  pageNumber: number,
  signal?: AbortSignal,
  deadline?: number,
): Promise<{ inspection: PdfPageInspection; page: PdfJsPage }> {
  if (deadline === undefined) fail("PDF_TIMEOUT");
  let page: PdfJsPage;
  try {
    page = await waitAbortable(document.getPage(pageNumber), signal, undefined, deadline);
  } catch (error) {
    if (error === sentinels.LOCAL_CONVERSION_CANCELLED || error === sentinels.PDF_TIMEOUT) {
      throw error;
    }
    fail("PDF_SECURITY_VIOLATION");
  }
  try {
    const view = page.view;
    if (!intrinsicArrayIsArray(view) || view.length !== 4) fail("PDF_SECURITY_VIOLATION");
    for (let index = 0; index < 4; index += 1) {
      if (!finiteNumber(view[index])) fail("PDF_DIMENSION_LIMIT");
    }
    const pageWidth = Math.abs((view[2] as number) - (view[0] as number));
    const pageHeight = Math.abs((view[3] as number) - (view[1] as number));
    if (
      pageWidth <= 0 ||
      pageHeight <= 0 ||
      pageWidth > PDF_LIMITS.maxPageDimension ||
      pageHeight > PDF_LIMITS.maxPageDimension ||
      pageWidth * pageHeight > PDF_LIMITS.maxPageArea
    ) {
      fail("PDF_DIMENSION_LIMIT");
    }
    const viewport = page.getViewport({ scale: 1 }) as Record<string, unknown>;
    if (viewport === null || typeof viewport !== "object") fail("PDF_DIMENSION_LIMIT");
    const width = viewport.width;
    const height = viewport.height;
    const rotation = page.rotate;
    if (
      !finiteNumber(width) ||
      !finiteNumber(height) ||
      width <= 0 ||
      height <= 0 ||
      width > PDF_LIMITS.maxPageDimension ||
      height > PDF_LIMITS.maxPageDimension ||
      width * height > PDF_LIMITS.maxPageArea ||
      !intrinsicNumberIsSafeInteger(rotation) ||
      ![0, 90, 180, 270].includes(rotation as number)
    ) {
      fail("PDF_DIMENSION_LIMIT");
    }
    const pageChecks = [
      page.getJSActions(),
      page.getXfa(),
      page.getAnnotations({ intent: "display" }),
    ];
    for (let index = 0; index < pageChecks.length; index += 1) {
      const value = await waitAbortable(
        pageChecks[index] as Promise<unknown>,
        signal,
        undefined,
        deadline,
      );
      if (index < 2 && nonEmpty(value)) fail("PDF_SECURITY_VIOLATION");
      if (index === 2) assertNoActiveGraph(value);
    }
    return {
      inspection: makeFrozenNull({ height, pageNumber, rotation: rotation as number, width }),
      page,
    };
  } catch (error) {
    try {
      page.cleanup();
    } catch {
      // Preserve fixed error.
    }
    if (error === sentinels.LOCAL_CONVERSION_CANCELLED || error === sentinels.PDF_TIMEOUT) {
      throw error;
    }
    if (error === sentinels.PDF_DIMENSION_LIMIT || error === sentinels.PDF_SECURITY_VIOLATION) {
      throw error;
    }
    fail("PDF_SECURITY_VIOLATION");
  }
}

async function inspectLoaded(loaded: LoadedDocument, signal?: AbortSignal): Promise<PdfInspection> {
  await checkDocumentGraph(loaded.document, signal, loaded.deadline);
  const pages: PdfPageInspection[] = [];
  for (let pageNumber = 1; pageNumber <= loaded.pageCount; pageNumber += 1) {
    const checked = await inspectPage(loaded.document, pageNumber, signal, loaded.deadline);
    pages[pages.length] = checked.inspection;
    try {
      checked.page.cleanup();
    } catch {
      fail("PDF_SECURITY_VIOLATION");
    }
  }
  intrinsicFreeze(pages);
  return makeFrozenNull({ pageCount: loaded.pageCount, pages });
}

export async function inspectPdf(
  input: Uint8Array | ArrayBuffer,
  options: LoadLocalPdfOptions = {},
): Promise<PdfInspection> {
  return boundary(async () => {
    const parsedOptions = parseLoadOptions(options);
    const loaded = await loadInternal(input, parsedOptions.signal, parsedOptions.timeoutMs);
    try {
      return await inspectLoaded(loaded, parsedOptions.signal);
    } finally {
      await destroyLoaded(loaded);
    }
  }, "PDF_SECURITY_VIOLATION");
}

export interface ExtractPdfTextOptions extends LoadLocalPdfOptions {
  readonly pages?: readonly number[];
}

function normalizeText(value: string): string {
  let normalized: string;
  try {
    normalized = intrinsicReflectApply(intrinsicStringNormalize, value, ["NFKC"]) as string;
  } catch {
    fail("PDF_SECURITY_VIOLATION");
  }
  let output = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const code = intrinsicReflectApply(intrinsicStringCharCodeAt, normalized, [index]) as number;
    if (code === 0x0d) {
      if (normalized.charCodeAt(index + 1) === 0x0a) index += 1;
      output += "\n";
    } else if (code === 0x0a) {
      output += "\n";
    } else if (code === 0x09) {
      output += " ";
    } else if (code >= 0x20 && code !== 0x7f) {
      output += normalized[index] ?? "";
    }
    if (output.length > PDF_LIMITS.maxTextChars) fail("PDF_TEXT_LIMIT");
  }
  return output;
}

function selectedPages(input: readonly number[] | undefined, pageCount: number): number[] {
  if (input === undefined) {
    const pages: number[] = [];
    for (let page = 1; page <= pageCount; page += 1) pages[pages.length] = page;
    return pages;
  }
  if (!intrinsicArrayIsArray(input) || input.length < 1 || input.length > pageCount) {
    fail("PDF_PAGE_OUT_OF_RANGE");
  }
  const pages: number[] = [];
  const seen = intrinsicObjectCreate(null) as Record<number, true>;
  for (let index = 0; index < input.length; index += 1) {
    const page = input[index];
    if (!intrinsicNumberIsSafeInteger(page) || page < 1 || page > pageCount || seen[page]) {
      fail("PDF_PAGE_OUT_OF_RANGE");
    }
    seen[page] = true;
    pages[pages.length] = page;
  }
  return pages;
}

function joinTextParts(parts: readonly string[]): string {
  let output = "";
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? "";
    if (part.length === 0) continue;
    if (output.length > 0) {
      const previous = output[output.length - 1];
      const first = part[0];
      if (previous !== " " && previous !== "\n" && first !== " " && first !== "\n") {
        output += " ";
      }
    }
    output += part;
  }
  return output;
}

export async function extractPdfText(
  input: Uint8Array | ArrayBuffer,
  options: ExtractPdfTextOptions = {},
): Promise<PdfTextResult> {
  return boundary(async () => {
    const parsedOptions = parseExtractOptions(options);
    const loaded = await loadInternal(input, parsedOptions.signal, parsedOptions.timeoutMs);
    try {
      await inspectLoaded(loaded, parsedOptions.signal);
      const selection = selectedPages(parsedOptions.pages, loaded.pageCount);
      const pages: PdfTextPage[] = [];
      let total = "";
      for (let index = 0; index < selection.length; index += 1) {
        const pageNumber = selection[index] as number;
        const checked = await inspectPage(
          loaded.document,
          pageNumber,
          parsedOptions.signal,
          loaded.deadline,
        );
        try {
          const content = await waitAbortable(
            checked.page.getTextContent(),
            parsedOptions.signal,
            undefined,
            loaded.deadline,
          );
          if (!plainRecord(content)) fail("PDF_SECURITY_VIOLATION");
          const items = ownData(content, "items");
          if (!intrinsicArrayIsArray(items)) fail("PDF_SECURITY_VIOLATION");
          const parts: string[] = [];
          for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
            const item = items[itemIndex];
            if (!plainRecord(item)) fail("PDF_SECURITY_VIOLATION");
            const string = ownData(item, "str");
            if (typeof string !== "string") continue;
            parts[parts.length] = normalizeText(string);
          }
          const text = joinTextParts(parts);
          total += `${total.length > 0 ? "\n\n" : ""}${text}`;
          if (total.length > PDF_LIMITS.maxTextChars) fail("PDF_TEXT_LIMIT");
          pages[pages.length] = makeFrozenNull({ pageNumber, text });
        } finally {
          try {
            checked.page.cleanup();
          } catch {
            // Fixed boundary result is preserved.
          }
        }
      }
      intrinsicFreeze(pages);
      return makeFrozenNull({ pageCount: pages.length, pages, text: total });
    } finally {
      await destroyLoaded(loaded);
    }
  }, "PDF_SECURITY_VIOLATION");
}

export interface RenderPdfPageOptions extends LoadLocalPdfOptions {
  readonly format?: "jpg" | "png";
  readonly pageNumber: number;
  readonly quality?: number;
  readonly scale?: number;
}

export async function renderPdfPage(
  input: Uint8Array | ArrayBuffer,
  options: RenderPdfPageOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  return boundary(async () => {
    const parsedOptions = parseRenderOptions(options);
    const format = parsedOptions.format ?? "png";
    const quality = parsedOptions.quality ?? 85;
    const scale = parsedOptions.scale ?? 1;
    if (
      (format !== "png" && format !== "jpg") ||
      !finiteNumber(scale) ||
      scale <= 0 ||
      scale > PDF_LIMITS.maxScale ||
      !intrinsicNumberIsSafeInteger(quality) ||
      quality < 1 ||
      quality > 100 ||
      (format === "png" && parsedOptions.quality !== undefined)
    ) {
      fail("PDF_RENDER_LIMIT");
    }
    const loaded = await loadInternal(input, parsedOptions.signal, parsedOptions.timeoutMs);
    let page: PdfJsPage | undefined;
    let canvas: OffscreenCanvas | undefined;
    try {
      if (
        !intrinsicNumberIsSafeInteger(parsedOptions.pageNumber) ||
        parsedOptions.pageNumber < 1 ||
        parsedOptions.pageNumber > loaded.pageCount
      ) {
        fail("PDF_PAGE_OUT_OF_RANGE");
      }
      try {
        await inspectLoaded(loaded, parsedOptions.signal);
      } catch (error) {
        if (error === sentinels.PDF_DIMENSION_LIMIT) fail("PDF_RENDER_LIMIT");
        throw error;
      }
      let checked: Awaited<ReturnType<typeof inspectPage>>;
      try {
        checked = await inspectPage(
          loaded.document,
          parsedOptions.pageNumber,
          parsedOptions.signal,
          loaded.deadline,
        );
      } catch (error) {
        if (error === sentinels.PDF_DIMENSION_LIMIT) fail("PDF_RENDER_LIMIT");
        throw error;
      }
      page = checked.page;
      const viewport = page.getViewport({ scale }) as Record<string, unknown>;
      const width = viewport.width;
      const height = viewport.height;
      if (
        !finiteNumber(width) ||
        !finiteNumber(height) ||
        !intrinsicNumberIsSafeInteger(width) ||
        !intrinsicNumberIsSafeInteger(height) ||
        width <= 0 ||
        height <= 0 ||
        width > PDF_LIMITS.maxRenderDimension ||
        height > PDF_LIMITS.maxRenderDimension ||
        width * height > PDF_LIMITS.maxRenderPixels ||
        typeof OffscreenCanvas !== "function"
      ) {
        fail("PDF_RENDER_LIMIT");
      }
      canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d", { willReadFrequently: false });
      if (!context) fail("PDF_RENDER_LIMIT");
      const renderTask = page.render({
        annotationMode: AnnotationMode.DISABLE,
        canvas,
        canvasContext: context,
        intent: "display",
        viewport,
      });
      await waitAbortable(
        renderTask.promise,
        parsedOptions.signal,
        () => renderTask.cancel(),
        loaded.deadline,
      );
      const blobOptions =
        format === "jpg" ? { quality: quality / 100, type: "image/jpeg" } : { type: "image/png" };
      const blob = await waitAbortable(
        canvas.convertToBlob(blobOptions),
        parsedOptions.signal,
        undefined,
        loaded.deadline,
      );
      if (blob.size > PDF_LIMITS.maxInputBytes) fail("PDF_RENDER_LIMIT");
      const result = new IntrinsicUint8Array(
        await waitAbortable(blob.arrayBuffer(), parsedOptions.signal, undefined, loaded.deadline),
      );
      const validPng =
        result.byteLength >= 8 &&
        result[0] === 137 &&
        asciiAt(result, 1, "PNG") &&
        result[4] === 13 &&
        result[5] === 10 &&
        result[6] === 26 &&
        result[7] === 10;
      const validJpeg =
        result.byteLength >= 4 &&
        result[0] === 255 &&
        result[1] === 216 &&
        result[2] === 255 &&
        result[result.byteLength - 2] === 255 &&
        result[result.byteLength - 1] === 217;
      if ((format === "png" && !validPng) || (format === "jpg" && !validJpeg)) {
        fail("PDF_RENDER_LIMIT");
      }
      return result;
    } finally {
      if (page) {
        try {
          page.cleanup();
        } catch {
          // Cleanup remains best effort.
        }
      }
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      await destroyLoaded(loaded);
    }
  }, "PDF_RENDER_LIMIT");
}
