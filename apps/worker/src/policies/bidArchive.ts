import { isProxy } from "node:util/types";
import {
  BidAssemblyManifestSchema,
  type BidTemplateId,
  type BidTemplateVersion,
  BID_TEMPLATE_IDS as CONTRACT_BID_TEMPLATE_IDS,
} from "@opentrad/contracts";

const MiB = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 52 * MiB;
const MAX_ATTACHMENT_BYTES = 25 * MiB;
const MAX_ATTACHMENT_TOTAL_BYTES = 50 * MiB;
const MAX_PORTABLE_ATTACHMENT_PAGES = 10_000;
const MAX_JSON_BYTES = MiB;
const MAX_ENTRIES = 102;
const MAX_CENTRAL_BYTES = 128 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_OPERATION_TIMEOUT_MS = 300_000;
const EOCD_BYTES = 22;
const CENTRAL_HEADER_BYTES = 46;
const LOCAL_HEADER_BYTES = 30;
const ATTACHMENT_PATH = /^attachments\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(?:pdf|png|jpg)$/u;
const ATTACHMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const BID_TEMPLATE_IDS = new Set<BidTemplateId>(CONTRACT_BID_TEMPLATE_IDS);
const decoder = new TextDecoder("utf-8", { fatal: true });
const IntrinsicUint8Array = Uint8Array;
const intrinsicArrayBufferPrototype = ArrayBuffer.prototype;
const intrinsicGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicObjectGetPrototypeOf = Object.getPrototypeOf;
const intrinsicReflectApply = Reflect.apply;
const intrinsicSetHas = Set.prototype.has;
const intrinsicUint8ArrayPrototype = Uint8Array.prototype;
const intrinsicTypedArrayPrototype = intrinsicObjectGetPrototypeOf(
  intrinsicUint8ArrayPrototype,
) as object;
const intrinsicTypedArrayTagGetter = intrinsicGetOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  Symbol.toStringTag,
)?.get;
const intrinsicTypedArrayBufferGetter = intrinsicGetOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "buffer",
)?.get;
const intrinsicTypedArrayByteLengthGetter = intrinsicGetOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "byteLength",
)?.get;
const intrinsicTypedArrayByteOffsetGetter = intrinsicGetOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "byteOffset",
)?.get;
const intrinsicArrayBufferByteLengthGetter = intrinsicGetOwnPropertyDescriptor(
  intrinsicArrayBufferPrototype,
  "byteLength",
)?.get;
const intrinsicArrayBufferResizableGetter = intrinsicGetOwnPropertyDescriptor(
  intrinsicArrayBufferPrototype,
  "resizable",
)?.get;
const intrinsicUint8ArraySet = intrinsicUint8ArrayPrototype.set;
const intrinsicWeakMapGet = WeakMap.prototype.get;
const intrinsicWeakMapSet = WeakMap.prototype.set;

type MediaType = "application/pdf" | "image/png" | "image/jpeg";

export class BidPolicyError extends Error {
  readonly code = "INVALID_REQUEST" as const;

  constructor() {
    super("INVALID_REQUEST");
    this.name = "BidPolicyError";
  }
}

function invalid(): never {
  throw new BidPolicyError();
}

function ownData(object: object, key: PropertyKey): unknown {
  const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !("value" in descriptor)) invalid();
  return descriptor.value;
}

function exactRecord(
  input: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input) || isProxy(input)) {
    return invalid();
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const keys = Reflect.ownKeys(input);
  if (
    keys.some((key) => typeof key !== "string") ||
    required.some((key) => !keys.includes(key)) ||
    keys.some(
      (key) => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)),
    )
  ) {
    invalid();
  }
  for (const key of keys) ownData(input, key);
  return input as Record<string, unknown>;
}

function exactArray(input: unknown, maximum: number): unknown[] {
  if (
    !Array.isArray(input) ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== Array.prototype ||
    input.length > maximum ||
    Reflect.ownKeys(input).length !== input.length + 1
  ) {
    return invalid();
  }
  for (let index = 0; index < input.length; index += 1) ownData(input, String(index));
  return input;
}

function stringValue(input: unknown, maximum: number, pattern?: RegExp): string {
  if (
    typeof input !== "string" ||
    input.length < 1 ||
    input.length > maximum ||
    (pattern !== undefined && !pattern.test(input))
  ) {
    return invalid();
  }
  return input;
}

function integerValue(input: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(input) || (input as number) < minimum || (input as number) > maximum) {
    return invalid();
  }
  return input as number;
}

export interface BidArchiveRequest {
  readonly templateId: BidTemplateId;
  readonly templateVersion: BidTemplateVersion;
}

export function parseBidArchiveRequest(input: unknown): BidArchiveRequest {
  const record = exactRecord(input, ["templateId", "templateVersion"]);
  const templateId = stringValue(record.templateId, 200) as BidTemplateId;
  if (
    !intrinsicReflectApply(intrinsicSetHas, BID_TEMPLATE_IDS, [templateId]) ||
    record.templateVersion !== "1.0.0"
  ) {
    invalid();
  }
  return hardenBidValue({ templateId, templateVersion: "1.0.0" }) as BidArchiveRequest;
}

function nativeTypedArrayMetadata(value: unknown): {
  readonly buffer: ArrayBuffer;
  readonly byteLength: number;
  readonly byteOffset: number;
  readonly kind: string;
} {
  if (
    !intrinsicTypedArrayTagGetter ||
    !intrinsicTypedArrayBufferGetter ||
    !intrinsicTypedArrayByteLengthGetter ||
    !intrinsicTypedArrayByteOffsetGetter
  )
    invalid();
  return {
    kind: intrinsicReflectApply(intrinsicTypedArrayTagGetter, value, []) as string,
    buffer: intrinsicReflectApply(intrinsicTypedArrayBufferGetter, value, []) as ArrayBuffer,
    byteLength: intrinsicReflectApply(intrinsicTypedArrayByteLengthGetter, value, []) as number,
    byteOffset: intrinsicReflectApply(intrinsicTypedArrayByteOffsetGetter, value, []) as number,
  };
}

export function copyExactUint8Array(input: unknown, maximum = MAX_ARCHIVE_BYTES): Uint8Array {
  try {
    if (input === null || typeof input !== "object" || isProxy(input)) invalid();
    if (intrinsicObjectGetPrototypeOf(input) !== intrinsicUint8ArrayPrototype) invalid();
    const metadata = nativeTypedArrayMetadata(input);
    if (metadata.kind !== "Uint8Array") invalid();
    if (intrinsicObjectGetPrototypeOf(metadata.buffer) !== intrinsicArrayBufferPrototype) invalid();
    if (!intrinsicArrayBufferByteLengthGetter) invalid();
    const backingLength = intrinsicReflectApply(
      intrinsicArrayBufferByteLengthGetter,
      metadata.buffer,
      [],
    ) as number;
    if (
      intrinsicArrayBufferResizableGetter &&
      intrinsicReflectApply(intrinsicArrayBufferResizableGetter, metadata.buffer, []) === true
    )
      invalid();
    if (
      !Number.isSafeInteger(metadata.byteLength) ||
      !Number.isSafeInteger(metadata.byteOffset) ||
      metadata.byteLength < 0 ||
      metadata.byteOffset < 0 ||
      metadata.byteLength > maximum ||
      metadata.byteOffset + metadata.byteLength > backingLength
    ) {
      invalid();
    }
    const copy = new IntrinsicUint8Array(metadata.byteLength);
    intrinsicReflectApply(intrinsicUint8ArraySet, copy, [input]);
    const after = nativeTypedArrayMetadata(input);
    if (
      after.buffer !== metadata.buffer ||
      after.byteLength !== metadata.byteLength ||
      after.byteOffset !== metadata.byteOffset
    ) {
      invalid();
    }
    return copy;
  } catch {
    return invalid();
  }
}

export interface BidArchiveInspection {
  readonly pageCount: number;
}

export interface BidArchiveRuntime {
  readonly inspectAttachment: (
    bytes: Uint8Array,
    mediaType: MediaType,
    maximumPages: number,
    absoluteDeadline: number,
    signal: AbortSignal | undefined,
  ) => Promise<BidArchiveInspection>;
  readonly now: () => number;
}

const archiveRuntimeBrand = new WeakSet<object>();

export function createBidArchiveRuntime(input: unknown): BidArchiveRuntime {
  try {
    const record = exactRecord(input, ["inspectAttachment", "now"]);
    const inspectAttachment = record.inspectAttachment;
    const now = record.now;
    if (typeof inspectAttachment !== "function" || typeof now !== "function") invalid();
    const runtime = Object.create(null) as BidArchiveRuntime;
    Object.defineProperties(runtime, {
      inspectAttachment: { enumerable: true, value: inspectAttachment },
      now: { enumerable: true, value: now },
    });
    Object.freeze(runtime);
    archiveRuntimeBrand.add(runtime);
    return runtime;
  } catch {
    return invalid();
  }
}

interface Budget {
  readonly deadline: number;
  readonly now: () => number;
  readonly signal?: AbortSignal;
  last: number;
}

function signalAborted(signal: AbortSignal | undefined): boolean {
  if (signal === undefined) return false;
  if (
    signal === null ||
    typeof signal !== "object" ||
    isProxy(signal) ||
    Object.getPrototypeOf(signal) !== AbortSignal.prototype
  )
    invalid();
  const getter = Reflect.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
  if (!getter) invalid();
  return intrinsicReflectApply(getter, signal, []) as boolean;
}

function readNow(now: () => number): number {
  let value: unknown;
  try {
    value = intrinsicReflectApply(now, undefined, []);
  } catch {
    return invalid();
  }
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid();
  return value as number;
}

function checkBudget(budget: Budget): void {
  if (signalAborted(budget.signal)) invalid();
  const current = readNow(budget.now);
  if (current < budget.last || current >= budget.deadline) invalid();
  budget.last = current;
}

function awaitWithinBudget(input: unknown, budget: Budget): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const signal = budget.signal;
    const removeEventListener = EventTarget.prototype.removeEventListener;
    const onAbort = () => finish(reject, new BidPolicyError());
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      if (signal !== undefined) {
        intrinsicReflectApply(removeEventListener, signal, ["abort", onAbort]);
      }
    };
    const finish = (callback: (value: never) => void, value: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value as never);
    };
    const remaining = budget.deadline - budget.last;
    if (!Number.isSafeInteger(remaining) || remaining <= 0) {
      finish(reject, new BidPolicyError());
      return;
    }
    timer = setTimeout(() => finish(reject, new BidPolicyError()), remaining);
    if (signal !== undefined) {
      intrinsicReflectApply(EventTarget.prototype.addEventListener, signal, [
        "abort",
        onAbort,
        { once: true },
      ]);
      if (signalAborted(signal)) {
        finish(reject, new BidPolicyError());
        return;
      }
    }
    Promise.resolve(input).then(
      (value) => finish(resolve, value),
      () => finish(reject, new BidPolicyError()),
    );
  });
}

function u16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.byteLength) invalid();
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}

function u32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.byteLength) invalid();
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, budget: Budget): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if ((index & 0xffff) === 0) checkBudget(budget);
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ (bytes[index] as number)) & 0xff] as number);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function safePath(path: string): void {
  if (
    path.length < 1 ||
    path.length > 256 ||
    path.normalize("NFC") !== path ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    /^[A-Za-z]:/u.test(path)
  ) {
    invalid();
  }
  for (const segment of path.split("/")) {
    const lowered = (segment.split(".")[0] ?? "").toLowerCase();
    if (
      segment === "" ||
      segment === "." ||
      segment === ".." ||
      lowered === "__proto__" ||
      lowered === "constructor" ||
      lowered === "prototype"
    ) {
      invalid();
    }
  }
}

interface Entry {
  readonly crc: number;
  readonly dataOffset: number;
  readonly path: string;
  readonly size: number;
}

function parseEntries(bytes: Uint8Array, budget: Budget): readonly Entry[] {
  if (bytes.byteLength < EOCD_BYTES) invalid();
  const eocdOffset = bytes.byteLength - EOCD_BYTES;
  if (
    u32(bytes, eocdOffset) !== 0x06054b50 ||
    u16(bytes, eocdOffset + 4) !== 0 ||
    u16(bytes, eocdOffset + 6) !== 0 ||
    u16(bytes, eocdOffset + 8) !== u16(bytes, eocdOffset + 10) ||
    u16(bytes, eocdOffset + 20) !== 0
  ) {
    invalid();
  }
  const count = u16(bytes, eocdOffset + 10);
  const centralSize = u32(bytes, eocdOffset + 12);
  const centralOffset = u32(bytes, eocdOffset + 16);
  if (
    count < 2 ||
    count > MAX_ENTRIES ||
    centralSize > MAX_CENTRAL_BYTES ||
    centralOffset + centralSize !== eocdOffset
  ) {
    invalid();
  }
  const candidates: Array<{
    readonly crc: number;
    readonly localOffset: number;
    readonly path: string;
    readonly size: number;
  }> = [];
  const paths = new Set<string>();
  const normalizedPaths = new Set<string>();
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    checkBudget(budget);
    if (u32(bytes, cursor) !== 0x02014b50 || cursor + CENTRAL_HEADER_BYTES > eocdOffset) invalid();
    const madeBy = u16(bytes, cursor + 4);
    const needed = u16(bytes, cursor + 6);
    const flags = u16(bytes, cursor + 8);
    const method = u16(bytes, cursor + 10);
    const modifiedTime = u16(bytes, cursor + 12);
    const modifiedDate = u16(bytes, cursor + 14);
    const crc = u32(bytes, cursor + 16);
    const compressedSize = u32(bytes, cursor + 20);
    const size = u32(bytes, cursor + 24);
    const nameLength = u16(bytes, cursor + 28);
    const extraLength = u16(bytes, cursor + 30);
    const commentLength = u16(bytes, cursor + 32);
    const disk = u16(bytes, cursor + 34);
    const internalAttributes = u16(bytes, cursor + 36);
    const externalAttributes = u32(bytes, cursor + 38);
    const localOffset = u32(bytes, cursor + 42);
    const next = cursor + CENTRAL_HEADER_BYTES + nameLength + extraLength + commentLength;
    if (
      next > eocdOffset ||
      madeBy !== 20 ||
      needed !== 20 ||
      flags !== 0 ||
      method !== 0 ||
      modifiedTime !== 0 ||
      modifiedDate !== 0 ||
      compressedSize !== size ||
      nameLength < 1 ||
      extraLength !== 0 ||
      commentLength !== 0 ||
      disk !== 0 ||
      internalAttributes !== 0 ||
      externalAttributes !== 0
    ) {
      invalid();
    }
    let path: string;
    try {
      path = decoder.decode(
        bytes.subarray(cursor + CENTRAL_HEADER_BYTES, cursor + CENTRAL_HEADER_BYTES + nameLength),
      );
    } catch {
      return invalid();
    }
    safePath(path);
    const normalized = path.normalize("NFC");
    if (paths.has(path) || normalizedPaths.has(normalized)) invalid();
    paths.add(path);
    normalizedPaths.add(normalized);
    candidates.push({ crc, localOffset, path, size });
    cursor = next;
  }
  if (cursor !== eocdOffset || cursor !== centralOffset + centralSize) invalid();
  if (candidates[0]?.path !== "manifest.json" || candidates[1]?.path !== "draft.json") invalid();
  const attachmentPaths = candidates.slice(2).map((entry) => entry.path);
  const sorted = [...attachmentPaths].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  if (attachmentPaths.some((path, index) => !ATTACHMENT_PATH.test(path) || path !== sorted[index]))
    invalid();

  const entries: Entry[] = [];
  let expectedOffset = 0;
  for (const candidate of candidates) {
    checkBudget(budget);
    if (
      candidate.localOffset !== expectedOffset ||
      u32(bytes, candidate.localOffset) !== 0x04034b50
    )
      invalid();
    const nameLength = u16(bytes, candidate.localOffset + 26);
    const extraLength = u16(bytes, candidate.localOffset + 28);
    if (
      u16(bytes, candidate.localOffset + 4) !== 20 ||
      u16(bytes, candidate.localOffset + 6) !== 0 ||
      u16(bytes, candidate.localOffset + 8) !== 0 ||
      u16(bytes, candidate.localOffset + 10) !== 0 ||
      u16(bytes, candidate.localOffset + 12) !== 0 ||
      u32(bytes, candidate.localOffset + 14) !== candidate.crc ||
      u32(bytes, candidate.localOffset + 18) !== candidate.size ||
      u32(bytes, candidate.localOffset + 22) !== candidate.size ||
      extraLength !== 0
    ) {
      invalid();
    }
    const expectedName = new TextEncoder().encode(candidate.path);
    const nameOffset = candidate.localOffset + LOCAL_HEADER_BYTES;
    if (nameLength !== expectedName.byteLength) invalid();
    for (let index = 0; index < nameLength; index += 1) {
      if (bytes[nameOffset + index] !== expectedName[index]) invalid();
    }
    const dataOffset = nameOffset + nameLength;
    expectedOffset = dataOffset + candidate.size;
    if (expectedOffset > centralOffset) invalid();
    entries.push({ crc: candidate.crc, dataOffset, path: candidate.path, size: candidate.size });
  }
  if (expectedOffset !== centralOffset) invalid();
  return entries;
}

interface AttachmentDescriptor {
  readonly category: "qualification" | "technical" | "commercial" | "other";
  readonly displayName: string;
  readonly id: string;
  readonly includedInSubmission: boolean;
  readonly mediaType: MediaType;
  readonly pageCount?: number;
  readonly required: boolean;
  readonly sourceRef?: string;
  readonly status: "missing" | "attached" | "rejected";
}

interface ManifestFile {
  readonly byteLength: number;
  readonly id: string;
  readonly mediaType: MediaType;
  readonly pageCount: number;
  readonly path: string;
}

function extension(mediaType: MediaType): "pdf" | "png" | "jpg" {
  return mediaType === "application/pdf" ? "pdf" : mediaType === "image/png" ? "png" : "jpg";
}

function parseAttachment(input: unknown): AttachmentDescriptor {
  const record = exactRecord(
    input,
    ["id", "category", "displayName", "mediaType", "required", "status", "includedInSubmission"],
    ["pageCount", "sourceRef"],
  );
  const id = stringValue(record.id, 200, ATTACHMENT_ID);
  const lowered = id.toLowerCase();
  if (lowered === "__proto__" || lowered === "constructor" || lowered === "prototype") invalid();
  const category = stringValue(record.category, 32) as AttachmentDescriptor["category"];
  if (!new Set(["qualification", "technical", "commercial", "other"]).has(category)) invalid();
  const mediaType = stringValue(record.mediaType, 64) as MediaType;
  extension(mediaType);
  const status = stringValue(record.status, 16) as AttachmentDescriptor["status"];
  if (!new Set(["missing", "attached", "rejected"]).has(status)) invalid();
  if (typeof record.required !== "boolean" || typeof record.includedInSubmission !== "boolean")
    invalid();
  if (status !== "attached" && record.includedInSubmission) invalid();
  const pageCount =
    record.pageCount === undefined
      ? undefined
      : integerValue(record.pageCount, 1, MAX_PORTABLE_ATTACHMENT_PAGES);
  if ((status === "attached") !== (pageCount !== undefined)) invalid();
  const sourceRef = record.sourceRef === undefined ? undefined : stringValue(record.sourceRef, 500);
  return {
    id,
    category,
    displayName: stringValue(record.displayName, 500),
    mediaType,
    ...(pageCount === undefined ? {} : { pageCount }),
    required: record.required,
    ...(sourceRef === undefined ? {} : { sourceRef }),
    status,
    includedInSubmission: record.includedInSubmission,
  };
}

function parseFile(input: unknown): ManifestFile {
  const record = exactRecord(input, ["id", "path", "mediaType", "byteLength", "pageCount"]);
  const id = stringValue(record.id, 200, ATTACHMENT_ID);
  const mediaType = stringValue(record.mediaType, 64) as MediaType;
  const path = stringValue(record.path, 256);
  if (path !== `attachments/${id}.${extension(mediaType)}`) invalid();
  return {
    id,
    path,
    mediaType,
    byteLength: integerValue(record.byteLength, 1, MAX_ATTACHMENT_BYTES),
    pageCount: integerValue(record.pageCount, 1, MAX_PORTABLE_ATTACHMENT_PAGES),
  };
}

function sameAttachment(left: AttachmentDescriptor, right: AttachmentDescriptor): boolean {
  return (
    left.id === right.id &&
    left.category === right.category &&
    left.displayName === right.displayName &&
    left.mediaType === right.mediaType &&
    left.pageCount === right.pageCount &&
    left.required === right.required &&
    left.sourceRef === right.sourceRef &&
    left.status === right.status &&
    left.includedInSubmission === right.includedInSubmission
  );
}

function parseIdentity(input: unknown, request: BidArchiveRequest): void {
  const template = exactRecord(input, ["id", "version", "basisDate"]);
  if (
    template.id !== request.templateId ||
    template.version !== request.templateVersion ||
    template.basisDate !== "2026-08-19"
  ) {
    invalid();
  }
}

function parsePresentation(input: unknown): {
  readonly languageView: string;
  readonly layoutStyleId: string;
} {
  const presentation = exactRecord(input, ["layoutStyleId", "languageView"]);
  const layoutStyleId = stringValue(presentation.layoutStyleId, 100);
  const languageView = stringValue(presentation.languageView, 20);
  if (
    !new Set(["classic-formal.v1", "modern-business.v1", "international-compact.v1"]).has(
      layoutStyleId,
    )
  )
    invalid();
  if (!new Set(["zh-CN", "en-US", "zh-en"]).has(languageView)) invalid();
  return { layoutStyleId, languageView };
}

interface ParsedOuter {
  readonly attachments: readonly AttachmentDescriptor[];
  readonly bidAssembly: ReturnType<typeof BidAssemblyManifestSchema.parse>;
  readonly files: readonly ManifestFile[];
  readonly presentation: { readonly languageView: string; readonly layoutStyleId: string };
}

function parseOuter(input: unknown, request: BidArchiveRequest): ParsedOuter {
  const outer = exactRecord(input, [
    "formatVersion",
    "template",
    "presentation",
    "attachmentManifest",
    "files",
    "bidAssembly",
  ]);
  if (outer.formatVersion !== "2.0.0") invalid();
  parseIdentity(outer.template, request);
  const presentation = parsePresentation(outer.presentation);
  const attachments = exactArray(outer.attachmentManifest, 100).map(parseAttachment);
  const files = exactArray(outer.files, 100).map(parseFile);
  if (new Set(attachments.map((item) => item.id)).size !== attachments.length) invalid();
  if (new Set(files.map((item) => item.id)).size !== files.length) invalid();
  let bidAssembly: ReturnType<typeof BidAssemblyManifestSchema.parse>;
  try {
    bidAssembly = BidAssemblyManifestSchema.parse(outer.bidAssembly);
  } catch {
    return invalid();
  }
  if (
    bidAssembly.templateId !== request.templateId ||
    bidAssembly.templateVersion !== request.templateVersion ||
    bidAssembly.attachmentManifest.length !== attachments.length
  ) {
    invalid();
  }
  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index];
    const bidAttachment = bidAssembly.attachmentManifest[index];
    if (!attachment || !bidAttachment || !sameAttachment(attachment, bidAttachment)) invalid();
    const file = files.find((candidate) => candidate.id === attachment.id);
    if (attachment.status === "attached") {
      if (
        !file ||
        bidAttachment.status !== "attached" ||
        file.mediaType !== attachment.mediaType ||
        file.pageCount !== attachment.pageCount ||
        file.pageCount !== bidAttachment.pageCount ||
        file.byteLength !== bidAttachment.byteLength
      ) {
        invalid();
      }
    } else if (file !== undefined) {
      invalid();
    }
  }
  if (files.length !== attachments.filter((item) => item.status === "attached").length) invalid();
  return { attachments, bidAssembly, files, presentation };
}

function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    return invalid();
  }
}

function validateDraft(bytes: Uint8Array, request: BidArchiveRequest, outer: ParsedOuter): void {
  const envelope = exactRecord(decodeJson(bytes), [
    "formatVersion",
    "template",
    "draft",
    "presentation",
    "attachmentManifest",
  ]);
  if (envelope.formatVersion !== "2.0.0") invalid();
  parseIdentity(envelope.template, request);
  const presentation = parsePresentation(envelope.presentation);
  if (
    presentation.layoutStyleId !== outer.presentation.layoutStyleId ||
    presentation.languageView !== outer.presentation.languageView
  ) {
    invalid();
  }
  const draft = exactRecord(
    envelope.draft,
    ["id", "templateId", "templateVersion"],
    Reflect.ownKeys(envelope.draft as object).filter(
      (key): key is string =>
        typeof key === "string" && !["id", "templateId", "templateVersion"].includes(key),
    ),
  );
  stringValue(draft.id, 200);
  if (draft.templateId !== request.templateId || draft.templateVersion !== request.templateVersion)
    invalid();
  const attachments = exactArray(envelope.attachmentManifest, 100).map(parseAttachment);
  if (attachments.length !== outer.attachments.length) invalid();
  for (let index = 0; index < attachments.length; index += 1) {
    if (
      !attachments[index] ||
      !outer.attachments[index] ||
      !sameAttachment(
        attachments[index] as AttachmentDescriptor,
        outer.attachments[index] as AttachmentDescriptor,
      )
    )
      invalid();
  }
}

function magicMatches(bytes: Uint8Array, mediaType: MediaType): boolean {
  if (mediaType === "application/pdf") {
    return bytes.byteLength >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";
  }
  if (mediaType === "image/png") {
    const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return magic.every((value, index) => bytes[index] === value);
  }
  return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function parseInspection(input: unknown): BidArchiveInspection {
  const inspection = exactRecord(input, ["pageCount"]);
  return {
    pageCount: integerValue(inspection.pageCount, 1, MAX_PORTABLE_ATTACHMENT_PAGES),
  };
}

export function hardenBidValue<T>(input: T): T {
  if (input === null || typeof input !== "object" || input instanceof Uint8Array) return input;
  if (Array.isArray(input)) {
    const output: unknown[] = [];
    for (const value of input) output.push(hardenBidValue(value));
    return Object.freeze(output) as T;
  }
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string") invalid();
    const value = ownData(input, key);
    Object.defineProperty(output, key, { enumerable: true, value: hardenBidValue(value) });
  }
  return Object.freeze(output) as T;
}

export interface BidArchiveAttachmentSnapshot {
  readonly byteLength: number;
  readonly id: string;
  readonly includedInSubmission: boolean;
  readonly mediaType: MediaType;
  readonly pageCount: number;
  readonly path: string;
  readonly sourceRef?: string;
}

export interface BidArchiveEvidence {
  readonly archiveBytes: number;
  readonly attachedBytes: number;
  readonly attachedCount: number;
  readonly bodyBytes: number;
  readonly bodyPageCountHint: number;
  readonly entryCount: number;
  readonly includedBytes: number;
  readonly includedCount: number;
}

export interface CanonicalBidArchive {
  readonly attachments: readonly BidArchiveAttachmentSnapshot[];
  readonly evidence: BidArchiveEvidence;
}

interface CanonicalBidArchiveBytes {
  readonly attachments: readonly {
    readonly bytes: Uint8Array;
    readonly id: string;
  }[];
  readonly draft: Uint8Array;
}

const canonicalBidArchiveBytes = new WeakMap<object, CanonicalBidArchiveBytes>();

function storedArchiveBytes(input: unknown): CanonicalBidArchiveBytes {
  if (input === null || typeof input !== "object" || isProxy(input)) invalid();
  const stored = intrinsicReflectApply(intrinsicWeakMapGet, canonicalBidArchiveBytes, [input]);
  if (!stored) invalid();
  return stored;
}

export function copyCanonicalBidDraftBytes(input: unknown): Uint8Array {
  try {
    return copyExactUint8Array(storedArchiveBytes(input).draft, MAX_JSON_BYTES);
  } catch {
    return invalid();
  }
}

export function copyCanonicalBidAttachmentBytes(
  input: unknown,
  index: unknown,
  id: unknown,
): Uint8Array {
  try {
    const stored = storedArchiveBytes(input);
    if (!Number.isSafeInteger(index) || (index as number) < 0 || typeof id !== "string") invalid();
    const attachment = stored.attachments[index as number];
    if (!attachment || attachment.id !== id) invalid();
    return copyExactUint8Array(attachment.bytes, MAX_ATTACHMENT_BYTES);
  } catch {
    return invalid();
  }
}

async function parseArchive(
  input: unknown,
  requestInput: unknown,
  signal: AbortSignal | undefined,
  runtime: BidArchiveRuntime,
  absoluteDeadlineInput?: number,
): Promise<CanonicalBidArchive> {
  if (!archiveRuntimeBrand.has(runtime)) invalid();
  const startedAt = readNow(runtime.now);
  if (startedAt > Number.MAX_SAFE_INTEGER - MAX_OPERATION_TIMEOUT_MS) invalid();
  const deadline = absoluteDeadlineInput ?? startedAt + TIMEOUT_MS;
  if (
    !Number.isSafeInteger(deadline) ||
    deadline <= startedAt ||
    deadline > startedAt + MAX_OPERATION_TIMEOUT_MS
  ) {
    invalid();
  }
  const budget: Budget = {
    deadline,
    now: runtime.now,
    ...(signal === undefined ? {} : { signal }),
    last: startedAt,
  };
  checkBudget(budget);
  const request = parseBidArchiveRequest(requestInput);
  const bytes = copyExactUint8Array(input);
  checkBudget(budget);
  if (bytes.byteLength < EOCD_BYTES) invalid();
  const entries = parseEntries(bytes, budget);
  for (const entry of entries) {
    const data = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.size);
    if (crc32(data, budget) !== entry.crc) invalid();
  }
  const manifestEntry = entries[0] as Entry;
  const draftEntry = entries[1] as Entry;
  if (
    manifestEntry.size < 1 ||
    manifestEntry.size > MAX_JSON_BYTES ||
    draftEntry.size < 1 ||
    draftEntry.size > MAX_JSON_BYTES
  ) {
    invalid();
  }
  const manifestBytes = bytes.subarray(
    manifestEntry.dataOffset,
    manifestEntry.dataOffset + manifestEntry.size,
  );
  const draftBytesView = bytes.subarray(
    draftEntry.dataOffset,
    draftEntry.dataOffset + draftEntry.size,
  );
  const outer = parseOuter(decodeJson(manifestBytes), request);
  if (outer.bidAssembly.body.byteLength !== draftEntry.size) invalid();
  validateDraft(draftBytesView, request, outer);

  const entryByPath = new Map(entries.slice(2).map((entry) => [entry.path, entry]));
  if (entryByPath.size !== outer.files.length || entries.length !== outer.files.length + 2)
    invalid();
  let attachedBytes = 0;
  let includedBytes = 0;
  let includedCount = 0;
  let includedPages = outer.bidAssembly.body.pageCount;
  const attachments: BidArchiveAttachmentSnapshot[] = [];
  const storedAttachments: Array<{ readonly bytes: Uint8Array; readonly id: string }> = [];
  for (const descriptor of outer.attachments) {
    if (descriptor.status !== "attached") continue;
    checkBudget(budget);
    const file = outer.files.find((candidate) => candidate.id === descriptor.id);
    if (!file) invalid();
    const entry = entryByPath.get(file.path);
    if (!entry || entry.size !== file.byteLength) invalid();
    attachedBytes += entry.size;
    if (entry.size > MAX_ATTACHMENT_BYTES || attachedBytes > MAX_ATTACHMENT_TOTAL_BYTES) invalid();
    if (descriptor.includedInSubmission) {
      includedBytes += entry.size;
      includedCount += 1;
      includedPages += file.pageCount;
      if (includedPages > 80) invalid();
    }
    const attachmentBytes = bytes.slice(entry.dataOffset, entry.dataOffset + entry.size);
    if (!magicMatches(attachmentBytes, file.mediaType)) invalid();
    if (file.mediaType !== "application/pdf" && file.pageCount !== 1) invalid();
    let inspected: BidArchiveInspection;
    try {
      const pendingInspection = intrinsicReflectApply(runtime.inspectAttachment, undefined, [
        attachmentBytes.slice(),
        file.mediaType,
        file.mediaType === "application/pdf"
          ? descriptor.includedInSubmission
            ? 80
            : MAX_PORTABLE_ATTACHMENT_PAGES
          : 1,
        budget.deadline,
        signal,
      ]);
      inspected = parseInspection(await awaitWithinBudget(pendingInspection, budget));
    } catch {
      return invalid();
    }
    checkBudget(budget);
    if (
      inspected.pageCount !== file.pageCount ||
      (file.mediaType !== "application/pdf" && inspected.pageCount !== 1)
    )
      invalid();
    attachments.push({
      id: file.id,
      path: file.path,
      mediaType: file.mediaType,
      pageCount: inspected.pageCount,
      byteLength: attachmentBytes.byteLength,
      includedInSubmission: descriptor.includedInSubmission,
      ...(descriptor.sourceRef === undefined ? {} : { sourceRef: descriptor.sourceRef }),
    });
    storedAttachments.push({ id: file.id, bytes: attachmentBytes });
  }
  if (includedCount > 40) invalid();
  checkBudget(budget);
  const result = hardenBidValue({
    attachments,
    evidence: {
      archiveBytes: bytes.byteLength,
      attachedBytes,
      attachedCount: attachments.length,
      bodyBytes: draftEntry.size,
      bodyPageCountHint: outer.bidAssembly.body.pageCount,
      entryCount: entries.length,
      includedBytes,
      includedCount,
    },
  });
  intrinsicReflectApply(intrinsicWeakMapSet, canonicalBidArchiveBytes, [
    result,
    {
      attachments: Object.freeze(storedAttachments),
      draft: copyExactUint8Array(draftBytesView, MAX_JSON_BYTES),
    },
  ]);
  return result;
}

export async function parseCanonicalBidArchive(
  input: unknown,
  request: unknown,
  signal: AbortSignal | undefined,
  runtime: BidArchiveRuntime,
  absoluteDeadline?: number,
): Promise<CanonicalBidArchive> {
  try {
    return await parseArchive(input, request, signal, runtime, absoluteDeadline);
  } catch {
    throw new BidPolicyError();
  }
}
