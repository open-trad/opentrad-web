import { CAPABILITIES, type FileFormat } from "@opentrad/contracts";
import { assertLocalFileLimit } from "./limits.js";

const LOCAL_OPERATIONS = Object.freeze([
  "text.semantic",
  "document.generate",
  "docx.extract",
  "pdf.inspect",
  "pdf.organize",
  "image.convert",
  "images.to.pdf",
] as const);

export type LocalOperation = (typeof LOCAL_OPERATIONS)[number];
export type LocalTextEncoding = "utf-8" | "gb18030";

export interface LocalConversionOptions {
  readonly encoding?: LocalTextEncoding;
  readonly quality?: number;
}

export interface LocalConversionRequest {
  readonly id: string;
  readonly operation: LocalOperation;
  readonly inputFormat: FileFormat;
  readonly outputFormat: FileFormat;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly options: LocalConversionOptions;
}

export type LocalConversionSuccess = Readonly<{
  id: string;
  ok: true;
  bytes: Uint8Array<ArrayBuffer>;
  mediaType: string;
}>;

export type LocalConversionFailure = Readonly<{
  id: string;
  ok: false;
  code: LocalErrorCode;
}>;

export type LocalConversionResponse = LocalConversionSuccess | LocalConversionFailure;

export const LOCAL_ERROR_CODES = Object.freeze([
  "LOCAL_CONVERSION_CANCELLED",
  "LOCAL_CONVERSION_FAILED",
  "LOCAL_CONVERSION_TIMEOUT",
  "LOCAL_FILE_TOO_LARGE",
  "LOCAL_OPERATION_NOT_IMPLEMENTED",
  "LOCAL_PROTOCOL_ERROR",
  "LOCAL_PROTOCOL_INVALID",
  "LOCAL_RESPONSE_ID_MISMATCH",
  "LOCAL_WORKER_ERROR",
] as const);
export type LocalErrorCode = (typeof LOCAL_ERROR_CODES)[number];

const REQUEST_KEYS = Object.freeze([
  "id",
  "operation",
  "inputFormat",
  "outputFormat",
  "bytes",
  "options",
] as const);
const REQUEST_REQUIRED_KEYS = Object.freeze([
  "id",
  "operation",
  "inputFormat",
  "outputFormat",
  "bytes",
] as const);
const SUCCESS_KEYS = Object.freeze(["id", "ok", "bytes", "mediaType"] as const);
const FAILURE_KEYS = Object.freeze(["id", "ok", "code"] as const);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const IntrinsicError = Error;
const IntrinsicUint8Array = Uint8Array;
const intrinsicArrayBufferPrototype = ArrayBuffer.prototype;
const intrinsicArrayBufferByteLength = Reflect.getOwnPropertyDescriptor(
  intrinsicArrayBufferPrototype,
  "byteLength",
)?.get;
const intrinsicArrayBufferResizable = Reflect.getOwnPropertyDescriptor(
  intrinsicArrayBufferPrototype,
  "resizable",
)?.get;
const intrinsicArrayIsArray = Array.isArray;
const intrinsicDefineProperty = Object.defineProperty;
const intrinsicFreeze = Object.freeze;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicRegExpTest = RegExp.prototype.test;
const intrinsicStringCharCodeAt = String.prototype.charCodeAt;
const intrinsicStringIndexOf = String.prototype.indexOf;
const intrinsicUint8ArrayPrototype = IntrinsicUint8Array.prototype;
const intrinsicUint8ArraySet = Uint8Array.prototype.set;
const intrinsicTypedArrayPrototype = intrinsicGetPrototypeOf(intrinsicUint8ArrayPrototype);
const intrinsicTypedArrayBuffer = intrinsicReflectGetOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "buffer",
)?.get;
const intrinsicTypedArrayByteLength = intrinsicReflectGetOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "byteLength",
)?.get;
const protocolInvalidSentinel = intrinsicFreeze(intrinsicObjectCreate(null));
const fileTooLargeSentinel = intrinsicFreeze(intrinsicObjectCreate(null));

function invalid(): never {
  throw protocolInvalidSentinel;
}

function fixedProtocolError(code: "LOCAL_FILE_TOO_LARGE" | "LOCAL_PROTOCOL_INVALID"): Error {
  return new IntrinsicError(code);
}

function defineData(target: object, key: string, value: unknown): void {
  intrinsicDefineProperty(target, key, { enumerable: true, value });
}

function plainObject(input: unknown): input is Record<string, unknown> {
  if (input === null || typeof input !== "object" || intrinsicArrayIsArray(input)) return false;
  const prototype = intrinsicGetPrototypeOf(input);
  return prototype === intrinsicObjectPrototype || prototype === null;
}

function ownData(input: object, key: PropertyKey): unknown {
  const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, key);
  if (!descriptor || !("value" in descriptor)) invalid();
  return descriptor.value;
}

function exactObject(
  input: unknown,
  allowed: readonly string[],
  required: readonly string[],
): Record<string, unknown> {
  if (!plainObject(input)) invalid();
  const keys = intrinsicReflectOwnKeys(input);
  if (keys.length < required.length || keys.length > allowed.length) invalid();
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") invalid();
    let allowedKey = false;
    for (let allowedIndex = 0; allowedIndex < allowed.length; allowedIndex += 1) {
      if (allowed[allowedIndex] === key) {
        allowedKey = true;
        break;
      }
    }
    if (!allowedKey) invalid();
    ownData(input, key);
  }
  for (let index = 0; index < required.length; index += 1) {
    const key = required[index];
    if (!key || !intrinsicReflectGetOwnPropertyDescriptor(input, key)) invalid();
    ownData(input, key);
  }
  return input;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === 36 &&
    Boolean(intrinsicReflectApply(intrinsicRegExpTest, UUID, [value]))
  );
}

function isLocalOperation(value: unknown): value is LocalOperation {
  if (typeof value !== "string") return false;
  for (let index = 0; index < LOCAL_OPERATIONS.length; index += 1) {
    if (LOCAL_OPERATIONS[index] === value) return true;
  }
  return false;
}

function isFileFormat(value: unknown): value is FileFormat {
  if (typeof value !== "string") return false;
  for (let capabilityIndex = 0; capabilityIndex < CAPABILITIES.length; capabilityIndex += 1) {
    const capability = CAPABILITIES[capabilityIndex];
    if (!capability) continue;
    for (let index = 0; index < capability.inputFormats.length; index += 1) {
      if (capability.inputFormats[index] === value) return true;
    }
    for (let index = 0; index < capability.outputFormats.length; index += 1) {
      if (capability.outputFormats[index] === value) return true;
    }
  }
  return false;
}

function formatsMatch(operation: LocalOperation, input: FileFormat, output: FileFormat): boolean {
  for (let index = 0; index < CAPABILITIES.length; index += 1) {
    const capability = CAPABILITIES[index];
    if (capability?.id !== operation || capability.execution !== "browser") continue;
    let inputAllowed = false;
    let outputAllowed = false;
    for (let inputIndex = 0; inputIndex < capability.inputFormats.length; inputIndex += 1) {
      if (capability.inputFormats[inputIndex] === input) inputAllowed = true;
    }
    for (let outputIndex = 0; outputIndex < capability.outputFormats.length; outputIndex += 1) {
      if (capability.outputFormats[outputIndex] === output) outputAllowed = true;
    }
    return inputAllowed && outputAllowed;
  }
  return false;
}

function copyBytes(input: unknown, allowEmpty: boolean): Uint8Array<ArrayBuffer> {
  if (
    input === null ||
    typeof input !== "object" ||
    intrinsicGetPrototypeOf(input) !== intrinsicUint8ArrayPrototype ||
    !intrinsicTypedArrayBuffer ||
    !intrinsicTypedArrayByteLength ||
    !intrinsicArrayBufferByteLength
  ) {
    invalid();
  }
  try {
    const byteLength = intrinsicReflectApply(intrinsicTypedArrayByteLength, input, []) as number;
    const buffer = intrinsicReflectApply(intrinsicTypedArrayBuffer, input, []) as unknown;
    if (
      !intrinsicNumberIsSafeInteger(byteLength) ||
      byteLength < 0 ||
      (!allowEmpty && byteLength === 0) ||
      intrinsicGetPrototypeOf(buffer as object) !== intrinsicArrayBufferPrototype
    ) {
      invalid();
    }
    const bufferByteLength = intrinsicReflectApply(
      intrinsicArrayBufferByteLength,
      buffer,
      [],
    ) as number;
    if (!intrinsicNumberIsSafeInteger(bufferByteLength) || bufferByteLength < byteLength) invalid();
    if (
      intrinsicArrayBufferResizable &&
      intrinsicReflectApply(intrinsicArrayBufferResizable, buffer, []) === true
    ) {
      invalid();
    }
    const copy = new IntrinsicUint8Array(byteLength);
    intrinsicReflectApply(intrinsicUint8ArraySet, copy, [input]);
    return copy;
  } catch {
    invalid();
  }
}

function parseOptions(operation: LocalOperation, input: unknown): LocalConversionOptions {
  const allowed =
    operation === "text.semantic" || operation === "document.generate"
      ? (["encoding"] as const)
      : operation === "image.convert"
        ? (["quality"] as const)
        : ([] as const);
  const source =
    input === undefined ? intrinsicObjectCreate(null) : exactObject(input, allowed, []);
  const output = intrinsicObjectCreate(null) as Record<string, unknown>;
  for (let index = 0; index < allowed.length; index += 1) {
    const key = allowed[index];
    if (!key) continue;
    const descriptor = intrinsicReflectGetOwnPropertyDescriptor(source, key);
    if (!descriptor) continue;
    if (!("value" in descriptor)) invalid();
    if (key === "encoding") {
      if (descriptor.value !== "utf-8" && descriptor.value !== "gb18030") invalid();
    } else if (
      !intrinsicNumberIsSafeInteger(descriptor.value) ||
      (descriptor.value as number) < 1 ||
      (descriptor.value as number) > 100
    ) {
      invalid();
    }
    defineData(output, key, descriptor.value);
  }
  return intrinsicFreeze(output) as LocalConversionOptions;
}

export function parseLocalConversionRequest(input: unknown): LocalConversionRequest {
  try {
    const source = exactObject(input, REQUEST_KEYS, REQUEST_REQUIRED_KEYS);
    const id = ownData(source, "id");
    const operation = ownData(source, "operation");
    const inputFormat = ownData(source, "inputFormat");
    const outputFormat = ownData(source, "outputFormat");
    if (
      !isUuid(id) ||
      !isLocalOperation(operation) ||
      !isFileFormat(inputFormat) ||
      !isFileFormat(outputFormat) ||
      !formatsMatch(operation, inputFormat, outputFormat)
    ) {
      invalid();
    }
    const rawBytes = ownData(source, "bytes");
    if (
      rawBytes === null ||
      typeof rawBytes !== "object" ||
      intrinsicGetPrototypeOf(rawBytes) !== intrinsicUint8ArrayPrototype ||
      !intrinsicTypedArrayByteLength
    ) {
      invalid();
    }
    const byteLength = intrinsicReflectApply(intrinsicTypedArrayByteLength, rawBytes, []) as number;
    try {
      assertLocalFileLimit(operation, byteLength);
    } catch {
      throw fileTooLargeSentinel;
    }
    const bytes = copyBytes(rawBytes, false);
    const optionsDescriptor = intrinsicReflectGetOwnPropertyDescriptor(source, "options");
    const options = parseOptions(
      operation,
      optionsDescriptor && "value" in optionsDescriptor ? optionsDescriptor.value : undefined,
    );
    const output = intrinsicObjectCreate(null) as Record<string, unknown>;
    defineData(output, "id", id);
    defineData(output, "operation", operation);
    defineData(output, "inputFormat", inputFormat);
    defineData(output, "outputFormat", outputFormat);
    defineData(output, "bytes", bytes);
    defineData(output, "options", options);
    return intrinsicFreeze(output) as unknown as LocalConversionRequest;
  } catch (error) {
    if (error === fileTooLargeSentinel) throw fixedProtocolError("LOCAL_FILE_TOO_LARGE");
    throw fixedProtocolError("LOCAL_PROTOCOL_INVALID");
  }
}

function isLocalErrorCode(value: unknown): value is LocalErrorCode {
  if (typeof value !== "string") return false;
  for (let index = 0; index < LOCAL_ERROR_CODES.length; index += 1) {
    if (LOCAL_ERROR_CODES[index] === value) return true;
  }
  return false;
}

function validMediaType(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 100) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = intrinsicReflectApply(intrinsicStringCharCodeAt, value, [index]) as number;
    if (code <= 0x20 || code >= 0x7f) return false;
  }
  return (
    (intrinsicReflectApply(intrinsicStringIndexOf, value, ["/"]) as number) >= 0 &&
    (intrinsicReflectApply(intrinsicStringIndexOf, value, [";"]) as number) === -1
  );
}

export function parseLocalConversionResponse(input: unknown): LocalConversionResponse {
  try {
    if (!plainObject(input)) invalid();
    const ok = ownData(input, "ok");
    if (ok === true) {
      const source = exactObject(input, SUCCESS_KEYS, SUCCESS_KEYS);
      const id = ownData(source, "id");
      const mediaType = ownData(source, "mediaType");
      if (!isUuid(id) || !validMediaType(mediaType)) invalid();
      const output = intrinsicObjectCreate(null) as Record<string, unknown>;
      defineData(output, "id", id);
      defineData(output, "ok", true);
      defineData(output, "bytes", copyBytes(ownData(source, "bytes"), true));
      defineData(output, "mediaType", mediaType);
      return intrinsicFreeze(output) as unknown as LocalConversionSuccess;
    }
    if (ok === false) {
      const source = exactObject(input, FAILURE_KEYS, FAILURE_KEYS);
      const id = ownData(source, "id");
      const code = ownData(source, "code");
      if (!isUuid(id) || !isLocalErrorCode(code)) invalid();
      const output = intrinsicObjectCreate(null) as Record<string, unknown>;
      defineData(output, "id", id);
      defineData(output, "ok", false);
      defineData(output, "code", code);
      return intrinsicFreeze(output) as unknown as LocalConversionFailure;
    }
    invalid();
  } catch {
    throw fixedProtocolError("LOCAL_PROTOCOL_INVALID");
  }
}

export function readLocalMessageId(input: unknown): string | undefined {
  try {
    if (!plainObject(input)) return undefined;
    const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, "id");
    return descriptor && "value" in descriptor && isUuid(descriptor.value)
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

export function mediaTypeMatchesOutput(format: FileFormat, mediaType: string): boolean {
  switch (format) {
    case "txt":
      return mediaType === "text/plain";
    case "md":
      return mediaType === "text/markdown";
    case "html":
      return mediaType === "text/html";
    case "docx":
      return (
        mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
    case "pdf":
      return mediaType === "application/pdf";
    case "png":
      return mediaType === "image/png";
    case "jpg":
      return mediaType === "image/jpeg";
    case "webp":
      return mediaType === "image/webp";
    case "avif":
      return mediaType === "image/avif";
    case "doc":
    case "odt":
    case "rtf":
    case "xls":
    case "xlsx":
    case "ods":
    case "csv":
    case "ppt":
    case "pptx":
    case "odp":
    case "opentrad":
      return false;
  }
}
