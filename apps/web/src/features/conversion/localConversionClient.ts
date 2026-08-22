import { CAPABILITIES, type ConversionCapability, type FileFormat } from "@opentrad/contracts";
import { LocalConversionClient, type LocalWorkerRequest } from "@opentrad/conversion-local/client";

export type LocalBrowserOperation =
  | "docx.extract"
  | "document.generate"
  | "image.convert"
  | "images.to.pdf"
  | "pdf.inspect"
  | "pdf.organize"
  | "text.semantic";

export interface LocalConversionSelection {
  readonly files: readonly File[];
  readonly operation: LocalBrowserOperation;
  readonly outputFormat: FileFormat;
}

export interface LocalConversionResult {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly downloadName: string;
  readonly mediaType: string;
  readonly outputFormat: FileFormat;
}

export interface LocalConversionRuntime {
  inspectPdf: (
    bytes: Uint8Array<ArrayBuffer>,
    signal: AbortSignal,
  ) => Promise<{ readonly pageCount: number }>;
  readFile: (file: File, signal: AbortSignal) => Promise<Uint8Array<ArrayBuffer>>;
  run: (request: LocalWorkerRequest, signal: AbortSignal) => Promise<unknown>;
}

const LOCAL_OPERATION_IDS = Object.freeze([
  "text.semantic",
  "document.generate",
  "docx.extract",
  "pdf.inspect",
  "pdf.organize",
  "image.convert",
  "images.to.pdf",
] as const);
const AGGREGATE_OPERATIONS = Object.freeze(["pdf.organize", "images.to.pdf"] as const);
const IntrinsicAbortSignal = AbortSignal;
const IntrinsicArrayBuffer = ArrayBuffer;
const IntrinsicError = Error;
const IntrinsicEventTarget = EventTarget;
const IntrinsicUint8Array = Uint8Array;
const intrinsicAbortSignalAborted = Reflect.getOwnPropertyDescriptor(
  IntrinsicAbortSignal.prototype,
  "aborted",
)?.get;
const intrinsicArrayIsArray = Array.isArray;
const intrinsicArrayPrototype = Array.prototype;
const intrinsicArrayBuffer = Blob.prototype.arrayBuffer;
const intrinsicArrayBufferByteLength = Reflect.getOwnPropertyDescriptor(
  IntrinsicArrayBuffer.prototype,
  "byteLength",
)?.get;
const intrinsicArrayBufferResizable = Reflect.getOwnPropertyDescriptor(
  IntrinsicArrayBuffer.prototype,
  "resizable",
)?.get;
const intrinsicBlobSize = Reflect.getOwnPropertyDescriptor(Blob.prototype, "size")?.get;
const intrinsicEventTargetAddEventListener = IntrinsicEventTarget.prototype.addEventListener;
const intrinsicEventTargetRemoveEventListener = IntrinsicEventTarget.prototype.removeEventListener;
const intrinsicFileName = Reflect.getOwnPropertyDescriptor(File.prototype, "name")?.get;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicReflectApply = Reflect.apply;
const intrinsicStringLastIndexOf = String.prototype.lastIndexOf;
const intrinsicStringSlice = String.prototype.slice;
const intrinsicStringToLowerCase = String.prototype.toLowerCase;
const intrinsicUint8ArrayPrototype = IntrinsicUint8Array.prototype;
const intrinsicUint8ArraySet = IntrinsicUint8Array.prototype.set;
const intrinsicTypedArrayPrototype = Object.getPrototypeOf(intrinsicUint8ArrayPrototype);
const intrinsicTypedArrayBuffer = Reflect.getOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "buffer",
)?.get;
const intrinsicTypedArrayByteLength = Reflect.getOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "byteLength",
)?.get;

function fixedError(code: string): Error {
  return new IntrinsicError(code);
}

function signalAborted(signal: AbortSignal): boolean {
  if (!intrinsicAbortSignalAborted) throw fixedError("LOCAL_CONVERSION_CANCELLED");
  try {
    return intrinsicReflectApply(intrinsicAbortSignalAborted, signal, []) === true;
  } catch {
    throw fixedError("LOCAL_CONVERSION_CANCELLED");
  }
}

function waitForAbortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signalAborted(signal)) return Promise.reject(fixedError("LOCAL_CONVERSION_CANCELLED"));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      intrinsicReflectApply(intrinsicEventTargetRemoveEventListener, signal, ["abort", onAbort]);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(fixedError("LOCAL_CONVERSION_CANCELLED"));
    };
    try {
      intrinsicReflectApply(intrinsicEventTargetAddEventListener, signal, [
        "abort",
        onAbort,
        { once: true },
      ]);
    } catch {
      settled = true;
      reject(fixedError("LOCAL_CONVERSION_CANCELLED"));
      return;
    }
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          if (signalAborted(signal)) reject(fixedError("LOCAL_CONVERSION_CANCELLED"));
          else resolve(value);
        } catch {
          reject(fixedError("LOCAL_CONVERSION_CANCELLED"));
        }
      },
      () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(fixedError("LOCAL_FILE_READ_FAILED"));
      },
    );
  });
}

function snapshotSelection(input: unknown): LocalConversionSelection {
  try {
    if (input === null || typeof input !== "object") throw fixedError("LOCAL_SELECTION_INVALID");
    const prototype = intrinsicGetPrototypeOf(input);
    if (prototype !== intrinsicObjectPrototype && prototype !== null) {
      throw fixedError("LOCAL_SELECTION_INVALID");
    }
    const keys = intrinsicReflectOwnKeys(input);
    if (keys.length !== 3) throw fixedError("LOCAL_SELECTION_INVALID");
    for (const expected of ["files", "operation", "outputFormat"] as const) {
      const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, expected);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw fixedError("LOCAL_SELECTION_INVALID");
      }
    }
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (key !== "files" && key !== "operation" && key !== "outputFormat") {
        throw fixedError("LOCAL_SELECTION_INVALID");
      }
    }
    return Object.freeze({
      files: intrinsicReflectGetOwnPropertyDescriptor(input, "files")?.value as readonly File[],
      operation: intrinsicReflectGetOwnPropertyDescriptor(input, "operation")
        ?.value as LocalBrowserOperation,
      outputFormat: intrinsicReflectGetOwnPropertyDescriptor(input, "outputFormat")
        ?.value as FileFormat,
    });
  } catch {
    throw fixedError("LOCAL_SELECTION_INVALID");
  }
}

function stringLastIndexOf(value: string, search: string): number {
  return intrinsicReflectApply(intrinsicStringLastIndexOf, value, [search]) as number;
}

function stringSlice(value: string, start: number): string {
  return intrinsicReflectApply(intrinsicStringSlice, value, [start]) as string;
}

function stringToLowerCase(value: string): string {
  return intrinsicReflectApply(intrinsicStringToLowerCase, value, []) as string;
}

function isLocalOperation(input: unknown): input is LocalBrowserOperation {
  if (typeof input !== "string") return false;
  for (let index = 0; index < LOCAL_OPERATION_IDS.length; index += 1) {
    if (LOCAL_OPERATION_IDS[index] === input) return true;
  }
  return false;
}

function isAggregate(operation: LocalBrowserOperation): boolean {
  for (let index = 0; index < AGGREGATE_OPERATIONS.length; index += 1) {
    if (AGGREGATE_OPERATIONS[index] === operation) return true;
  }
  return false;
}

function capabilityFor(operation: unknown): ConversionCapability | undefined {
  if (!isLocalOperation(operation)) return undefined;
  for (let index = 0; index < CAPABILITIES.length; index += 1) {
    const capability = CAPABILITIES[index];
    if (capability?.execution === "browser" && capability.id === operation) return capability;
  }
  return undefined;
}

const browserCapabilities: ConversionCapability[] = [];
for (let index = 0; index < CAPABILITIES.length; index += 1) {
  const capability = CAPABILITIES[index];
  if (capability?.execution === "browser" && isLocalOperation(capability.id)) {
    browserCapabilities.push(capability);
  }
}
export const LOCAL_BROWSER_CAPABILITIES: readonly ConversionCapability[] =
  Object.freeze(browserCapabilities);

const inputExtensionGroups = Object.freeze([
  { extensions: [".txt"], format: "txt" },
  { extensions: [".md", ".markdown"], format: "md" },
  { extensions: [".html", ".htm"], format: "html" },
  { extensions: [".docx"], format: "docx" },
  { extensions: [".pdf"], format: "pdf" },
  { extensions: [".png"], format: "png" },
  { extensions: [".jpg", ".jpeg"], format: "jpg" },
  { extensions: [".webp"], format: "webp" },
  { extensions: [".avif"], format: "avif" },
] as const);
const localInputFormats = new Set<string>();
for (let capabilityIndex = 0; capabilityIndex < browserCapabilities.length; capabilityIndex += 1) {
  const capability = browserCapabilities[capabilityIndex];
  if (!capability) continue;
  for (let formatIndex = 0; formatIndex < capability.inputFormats.length; formatIndex += 1) {
    const format = capability.inputFormats[formatIndex];
    if (format) localInputFormats.add(format);
  }
}
const localAcceptExtensions: string[] = [];
for (let index = 0; index < inputExtensionGroups.length; index += 1) {
  const group = inputExtensionGroups[index];
  if (!group || !localInputFormats.has(group.format)) continue;
  for (let extensionIndex = 0; extensionIndex < group.extensions.length; extensionIndex += 1) {
    const extension = group.extensions[extensionIndex];
    if (extension) localAcceptExtensions.push(extension);
  }
}
export const LOCAL_FILE_ACCEPT = localAcceptExtensions.join(",");

function outputAllowed(capability: ConversionCapability, output: unknown): output is FileFormat {
  if (typeof output !== "string") return false;
  for (let index = 0; index < capability.outputFormats.length; index += 1) {
    if (capability.outputFormats[index] === output) return true;
  }
  return false;
}

function fileSize(file: File): number {
  if (!intrinsicBlobSize) throw fixedError("LOCAL_SELECTION_INVALID");
  try {
    const size = intrinsicReflectApply(intrinsicBlobSize, file, []) as number;
    if (!Number.isSafeInteger(size) || size < 1) throw fixedError("LOCAL_SELECTION_INVALID");
    return size;
  } catch {
    throw fixedError("LOCAL_SELECTION_INVALID");
  }
}

function fileName(file: File): string {
  if (!intrinsicFileName) throw fixedError("LOCAL_SELECTION_INVALID");
  try {
    return intrinsicReflectApply(intrinsicFileName, file, []) as string;
  } catch {
    throw fixedError("LOCAL_SELECTION_INVALID");
  }
}

function inferFormat(file: File): FileFormat | undefined {
  const name = stringToLowerCase(fileName(file));
  const dot = stringLastIndexOf(name, ".");
  if (dot < 0) return undefined;
  const extension = stringSlice(name, dot + 1);
  switch (extension) {
    case "txt":
    case "html":
    case "docx":
    case "pdf":
    case "png":
    case "webp":
    case "avif":
      return extension;
    case "md":
    case "markdown":
      return "md";
    case "htm":
      return "html";
    case "jpg":
    case "jpeg":
      return "jpg";
    default:
      return undefined;
  }
}

function inputAllowed(capability: ConversionCapability, input: FileFormat): boolean {
  for (let index = 0; index < capability.inputFormats.length; index += 1) {
    if (capability.inputFormats[index] === input) return true;
  }
  return false;
}

function exactFiles(input: unknown, maximum: number): readonly File[] {
  try {
    if (
      !intrinsicArrayIsArray(input) ||
      intrinsicGetPrototypeOf(input) !== intrinsicArrayPrototype
    ) {
      throw fixedError("LOCAL_SELECTION_INVALID");
    }
    const lengthDescriptor = intrinsicReflectGetOwnPropertyDescriptor(input, "length");
    const rawLength =
      lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
    if (
      !Number.isSafeInteger(rawLength) ||
      (rawLength as number) < 1 ||
      (rawLength as number) > maximum
    ) {
      throw fixedError("LOCAL_SELECTION_INVALID");
    }
    const length = rawLength as number;
    const keys = intrinsicReflectOwnKeys(input);
    if (keys.length !== length + 1) throw fixedError("LOCAL_SELECTION_INVALID");
    const files: File[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, String(index));
      if (
        !descriptor ||
        !("value" in descriptor) ||
        descriptor.value === null ||
        typeof descriptor.value !== "object"
      ) {
        throw fixedError("LOCAL_SELECTION_INVALID");
      }
      const file = descriptor.value as File;
      fileName(file);
      fileSize(file);
      files[index] = file;
    }
    return Object.freeze(files);
  } catch {
    throw fixedError("LOCAL_SELECTION_INVALID");
  }
}

function requestOptions(
  operation: LocalBrowserOperation,
  outputFormat: FileFormat,
): Record<string, number | string> {
  if (operation === "text.semantic" || operation === "document.generate") {
    return { encoding: "utf-8" };
  }
  if (operation === "image.convert") return { quality: 85 };
  if (operation === "pdf.inspect" && outputFormat === "png") {
    return { pageNumber: 1, scale: 1 };
  }
  if (operation === "pdf.inspect" && outputFormat === "jpg") {
    return { pageNumber: 1, quality: 85, scale: 1 };
  }
  return {};
}

function expectedMediaType(format: FileFormat): string | undefined {
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
    default:
      return undefined;
  }
}

function snapshotResponse(
  input: unknown,
  expectedId: string,
  outputFormat: FileFormat,
): { readonly bytes: unknown; readonly mediaType: string } {
  try {
    if (input === null || typeof input !== "object") throw fixedError("LOCAL_RESULT_INVALID");
    const prototype = intrinsicGetPrototypeOf(input);
    if (prototype !== intrinsicObjectPrototype && prototype !== null) {
      throw fixedError("LOCAL_RESULT_INVALID");
    }
    const keys = intrinsicReflectOwnKeys(input);
    if (keys.length !== 4) throw fixedError("LOCAL_RESULT_INVALID");
    for (const expected of ["bytes", "id", "mediaType", "ok"] as const) {
      const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, expected);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw fixedError("LOCAL_RESULT_INVALID");
      }
    }
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (key !== "bytes" && key !== "id" && key !== "mediaType" && key !== "ok") {
        throw fixedError("LOCAL_RESULT_INVALID");
      }
    }
    const ok = intrinsicReflectGetOwnPropertyDescriptor(input, "ok")?.value;
    const id = intrinsicReflectGetOwnPropertyDescriptor(input, "id")?.value;
    const mediaType = intrinsicReflectGetOwnPropertyDescriptor(input, "mediaType")?.value;
    const rawBytes = intrinsicReflectGetOwnPropertyDescriptor(input, "bytes")?.value;
    const requiredMediaType = expectedMediaType(outputFormat);
    if (
      ok !== true ||
      id !== expectedId ||
      typeof mediaType !== "string" ||
      requiredMediaType === undefined ||
      mediaType !== requiredMediaType
    ) {
      throw fixedError("LOCAL_RESULT_INVALID");
    }
    if (
      rawBytes === null ||
      typeof rawBytes !== "object" ||
      intrinsicGetPrototypeOf(rawBytes) !== intrinsicUint8ArrayPrototype ||
      !intrinsicTypedArrayBuffer ||
      !intrinsicTypedArrayByteLength ||
      !intrinsicArrayBufferByteLength
    ) {
      throw fixedError("LOCAL_RESULT_INVALID");
    }
    const byteLength = intrinsicReflectApply(intrinsicTypedArrayByteLength, rawBytes, []) as number;
    const buffer = intrinsicReflectApply(intrinsicTypedArrayBuffer, rawBytes, []) as unknown;
    if (
      !Number.isSafeInteger(byteLength) ||
      byteLength < 1 ||
      buffer === null ||
      typeof buffer !== "object" ||
      intrinsicGetPrototypeOf(buffer) !== IntrinsicArrayBuffer.prototype ||
      (intrinsicReflectApply(intrinsicArrayBufferByteLength, buffer, []) as number) < byteLength ||
      (intrinsicArrayBufferResizable &&
        intrinsicReflectApply(intrinsicArrayBufferResizable, buffer, []) === true)
    ) {
      throw fixedError("LOCAL_RESULT_INVALID");
    }
    const bytes = new IntrinsicUint8Array(byteLength);
    intrinsicReflectApply(intrinsicUint8ArraySet, bytes, [rawBytes]);
    return Object.freeze({ bytes, mediaType });
  } catch {
    throw fixedError("LOCAL_RESULT_INVALID");
  }
}

function downloadName(operation: LocalBrowserOperation, output: FileFormat): string {
  return `opentrad-local-${operation.replaceAll(".", "-")}.${output}`;
}

function createDefaultRuntime(): LocalConversionRuntime {
  const client = new LocalConversionClient(
    () =>
      new Worker(new URL("./localConversion.worker.ts", import.meta.url), {
        name: "opentrad-local-conversion",
        type: "module",
      }),
  );
  return Object.freeze({
    inspectPdf: async (bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal) => {
      const { inspectPdf } = await import("@opentrad/conversion-local/pdf");
      return inspectPdf(bytes, { signal });
    },
    readFile: async (file: File, signal: AbortSignal) => {
      if (typeof intrinsicArrayBuffer !== "function") throw fixedError("LOCAL_FILE_READ_FAILED");
      let pending: Promise<ArrayBuffer>;
      try {
        pending = intrinsicReflectApply(intrinsicArrayBuffer, file, []) as Promise<ArrayBuffer>;
      } catch {
        throw fixedError("LOCAL_FILE_READ_FAILED");
      }
      const bytes = new Uint8Array(await waitForAbortable(pending, signal));
      if (signalAborted(signal)) throw fixedError("LOCAL_CONVERSION_CANCELLED");
      return bytes;
    },
    run: async (request: LocalWorkerRequest, signal: AbortSignal) => {
      let output: { readonly bytes: Uint8Array; readonly mediaType: string };
      switch (request.operation) {
        case "text.semantic":
          output = await (
            await import("@opentrad/conversion-local/text")
          ).dispatchSemanticTextConversion(request, signal);
          break;
        case "document.generate":
          if ("kind" in request) throw fixedError("LOCAL_SELECTION_INVALID");
          output = await (
            await import("@opentrad/conversion-local/document")
          ).dispatchDocumentGeneration(request, signal);
          break;
        case "pdf.inspect":
        case "pdf.organize":
        case "images.to.pdf":
          output = await (
            await import("@opentrad/conversion-local/pdf-transform")
          ).dispatchPdfConversion(request, signal);
          break;
        default:
          return client.run(request, signal);
      }
      return Object.freeze({
        bytes: output.bytes,
        id: request.id,
        mediaType: output.mediaType,
        ok: true as const,
      });
    },
  });
}

let defaultRuntime: LocalConversionRuntime | undefined;

export function defaultLocalConversionRuntime(): LocalConversionRuntime {
  defaultRuntime ??= createDefaultRuntime();
  return defaultRuntime;
}

export async function runLocalConversion(
  selection: LocalConversionSelection,
  runtime: LocalConversionRuntime,
  signal: AbortSignal,
): Promise<LocalConversionResult> {
  const selected = snapshotSelection(selection);
  const capability = capabilityFor(selected.operation);
  if (!capability || !outputAllowed(capability, selected.outputFormat)) {
    throw fixedError("LOCAL_SELECTION_INVALID");
  }
  const maximumFiles = capability.limits.maxFiles ?? 1;
  const files = exactFiles(selected.files, maximumFiles);
  if (!isAggregate(selected.operation) && files.length !== 1) {
    throw fixedError("LOCAL_SELECTION_INVALID");
  }
  const formats: FileFormat[] = [];
  let totalBytes = 0;
  for (let index = 0; index < files.length; index += 1) {
    const current = files[index];
    if (!current) throw fixedError("LOCAL_SELECTION_INVALID");
    const format = inferFormat(current);
    const size = fileSize(current);
    if (!format || !inputAllowed(capability, format) || size > capability.limits.maxInputBytes) {
      throw fixedError("LOCAL_SELECTION_INVALID");
    }
    totalBytes += size;
    if (
      capability.limits.maxTotalBytes !== undefined &&
      totalBytes > capability.limits.maxTotalBytes
    ) {
      throw fixedError("LOCAL_SELECTION_INVALID");
    }
    formats[index] = format;
  }

  const byteInputs: Uint8Array<ArrayBuffer>[] = [];
  for (let index = 0; index < files.length; index += 1) {
    if (signalAborted(signal)) throw fixedError("LOCAL_CONVERSION_CANCELLED");
    const current = files[index];
    if (!current) throw fixedError("LOCAL_SELECTION_INVALID");
    byteInputs[index] = await runtime.readFile(current, signal);
  }

  const id = crypto.randomUUID();
  let request: LocalWorkerRequest;
  if (selected.operation === "pdf.organize") {
    const pagePlan: { page: number; rotation: 0; source: number }[] = [];
    for (let source = 0; source < byteInputs.length; source += 1) {
      const bytes = byteInputs[source];
      if (!bytes) throw fixedError("LOCAL_SELECTION_INVALID");
      const inspection = await runtime.inspectPdf(bytes, signal);
      for (let page = 0; page < inspection.pageCount; page += 1) {
        pagePlan.push({ page, rotation: 0, source });
        if (
          capability.limits.maxPages !== undefined &&
          pagePlan.length > capability.limits.maxPages
        ) {
          throw fixedError("LOCAL_SELECTION_INVALID");
        }
      }
    }
    request = {
      files: byteInputs.map((bytes, index) => ({ bytes, inputFormat: formats[index] as "pdf" })),
      id,
      kind: "aggregate",
      operation: "pdf.organize",
      options: { pagePlan },
      outputFormat: "pdf",
    };
  } else if (selected.operation === "images.to.pdf") {
    request = {
      files: byteInputs.map((bytes, index) => ({ bytes, inputFormat: formats[index] as "png" })),
      id,
      kind: "aggregate",
      operation: "images.to.pdf",
      options: {},
      outputFormat: "pdf",
    };
  } else {
    const bytes = byteInputs[0];
    const inputFormat = formats[0];
    if (!bytes || !inputFormat) throw fixedError("LOCAL_SELECTION_INVALID");
    request = {
      bytes,
      id,
      inputFormat,
      operation: selected.operation,
      options: requestOptions(selected.operation, selected.outputFormat),
      outputFormat: selected.outputFormat,
    };
  }
  const response = snapshotResponse(await runtime.run(request, signal), id, selected.outputFormat);
  const { validateLocalOutput } = await import("@opentrad/conversion-local/validation");
  const outputBytes = await validateLocalOutput(response.bytes, selected.outputFormat, signal);
  return Object.freeze({
    bytes: outputBytes,
    downloadName: downloadName(selected.operation, selected.outputFormat),
    mediaType: response.mediaType,
    outputFormat: selected.outputFormat,
  });
}
