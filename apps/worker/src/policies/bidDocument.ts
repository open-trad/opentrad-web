import { isProxy } from "node:util/types";
import { v2 } from "@opentrad/document-core";
import { type AttachmentPageImage, DOCX_V2_MIME, renderDocxV2 } from "@opentrad/document-renderer";
import { copyExactUint8Array } from "./bidArchive.js";
import { requireBidCompileSnapshot } from "./bidCompile.js";

const MAX_DOCX_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_PAGES = 80;
const SNAPSHOT_KEYS = Object.freeze([
  "asOf",
  "findings",
  "language",
  "layoutStyleId",
  "model",
  "profile",
  "schemaVersion",
] as const);
const DocumentError = Error;
const intrinsicArrayIsArray = Array.isArray;
const intrinsicArrayPrototype = Array.prototype;
const intrinsicBlobArrayBuffer = Blob.prototype.arrayBuffer;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectDefineProperty = Object.defineProperty;
const intrinsicObjectFreeze = Object.freeze;
const intrinsicObjectGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicWeakMapGet = WeakMap.prototype.get;
const intrinsicWeakMapSet = WeakMap.prototype.set;

interface TrustedCompileSnapshot {
  readonly asOf: string;
  readonly findings: readonly v2.RiskFindingV2[];
  readonly language: v2.DocumentLanguageV2;
  readonly layoutStyleId: v2.LayoutStyleId;
  readonly model: v2.DocumentModelV2;
  readonly profile: "bid";
  readonly schemaVersion: "bid-compile-snapshot-v1";
}

export interface RenderedBidDocument {
  readonly attachmentPages: number;
  readonly byteLength: number;
  readonly mediaType: typeof DOCX_V2_MIME;
  readonly schemaVersion: "bid-rendered-document-v1";
}

const documentBytes = new WeakMap<object, Uint8Array>();

function fail(): never {
  throw new DocumentError("CONVERSION_FAILED");
}

function ownData(input: object, key: PropertyKey): unknown {
  const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, key);
  if (!descriptor || !("value" in descriptor)) fail();
  return descriptor.value;
}

function exactSnapshot(input: unknown): TrustedCompileSnapshot {
  const branded = requireBidCompileSnapshot(input);
  if (
    intrinsicObjectGetPrototypeOf(branded) !== intrinsicObjectPrototype &&
    intrinsicObjectGetPrototypeOf(branded) !== null
  ) {
    fail();
  }
  const keys = intrinsicReflectOwnKeys(branded);
  if (keys.length !== SNAPSHOT_KEYS.length) fail();
  for (const expected of SNAPSHOT_KEYS) {
    if (!keys.includes(expected)) fail();
  }
  const schemaVersion = ownData(branded, "schemaVersion");
  const profile = ownData(branded, "profile");
  const asOf = ownData(branded, "asOf");
  if (
    schemaVersion !== "bid-compile-snapshot-v1" ||
    profile !== "bid" ||
    typeof asOf !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(asOf)
  ) {
    fail();
  }
  const findingsInput = ownData(branded, "findings");
  if (
    !intrinsicArrayIsArray(findingsInput) ||
    isProxy(findingsInput) ||
    intrinsicObjectGetPrototypeOf(findingsInput) !== intrinsicArrayPrototype ||
    intrinsicReflectOwnKeys(findingsInput).length !== findingsInput.length + 1 ||
    findingsInput.length > 500
  ) {
    fail();
  }
  const findings: v2.RiskFindingV2[] = [];
  for (let index = 0; index < findingsInput.length; index += 1) {
    intrinsicObjectDefineProperty(findings, String(index), {
      enumerable: true,
      value: v2.RiskFindingV2Schema.parse(ownData(findingsInput, String(index))),
      writable: false,
    });
  }
  const language = v2.DocumentLanguageV2Schema.parse(ownData(branded, "language"));
  const layoutStyleId = v2.LayoutStyleIdSchema.parse(ownData(branded, "layoutStyleId"));
  const model = v2.DocumentModelV2Schema.parse(ownData(branded, "model"));
  if (model.language !== language) fail();
  for (const section of model.sections) {
    for (const block of section.blocks) {
      if (block.type === "attachmentPage") fail();
    }
  }
  return intrinsicObjectFreeze({
    asOf,
    findings: intrinsicObjectFreeze(findings),
    language,
    layoutStyleId,
    model,
    profile,
    schemaVersion,
  }) as TrustedCompileSnapshot;
}

function exactAttachmentPageCount(input: unknown): number {
  if (
    !intrinsicArrayIsArray(input) ||
    isProxy(input) ||
    intrinsicObjectGetPrototypeOf(input) !== intrinsicArrayPrototype ||
    input.length > MAX_ATTACHMENT_PAGES ||
    intrinsicReflectOwnKeys(input).length !== input.length + 1
  ) {
    fail();
  }
  for (let index = 0; index < input.length; index += 1) ownData(input, String(index));
  return input.length;
}

export async function renderCompiledBidDocument(
  snapshotInput: unknown,
  attachmentPageImagesInput: unknown,
): Promise<RenderedBidDocument> {
  try {
    const snapshot = exactSnapshot(snapshotInput);
    const attachmentPages = exactAttachmentPageCount(attachmentPageImagesInput);
    const blob = await renderDocxV2(snapshot.model, snapshot.layoutStyleId, snapshot.language, {
      attachmentPageImages: attachmentPageImagesInput as readonly AttachmentPageImage[],
    });
    const arrayBuffer = intrinsicReflectApply(
      intrinsicBlobArrayBuffer,
      blob,
      [],
    ) as Promise<ArrayBuffer>;
    const bytes = copyExactUint8Array(new Uint8Array(await arrayBuffer), MAX_DOCX_BYTES);
    if (
      bytes.byteLength < 4 ||
      bytes[0] !== 0x50 ||
      bytes[1] !== 0x4b ||
      bytes[2] !== 0x03 ||
      bytes[3] !== 0x04
    ) {
      fail();
    }
    const result = intrinsicObjectCreate(null) as RenderedBidDocument;
    intrinsicObjectDefineProperty(result, "attachmentPages", {
      enumerable: true,
      value: attachmentPages,
    });
    intrinsicObjectDefineProperty(result, "byteLength", {
      enumerable: true,
      value: bytes.byteLength,
    });
    intrinsicObjectDefineProperty(result, "mediaType", {
      enumerable: true,
      value: DOCX_V2_MIME,
    });
    intrinsicObjectDefineProperty(result, "schemaVersion", {
      enumerable: true,
      value: "bid-rendered-document-v1",
    });
    intrinsicObjectFreeze(result);
    intrinsicReflectApply(intrinsicWeakMapSet, documentBytes, [result, bytes]);
    return result;
  } catch {
    return fail();
  }
}

export function copyRenderedBidDocumentBytes(input: unknown): Uint8Array {
  try {
    if (input === null || typeof input !== "object" || isProxy(input)) fail();
    const stored = intrinsicReflectApply(intrinsicWeakMapGet, documentBytes, [input]);
    if (!(stored instanceof Uint8Array)) fail();
    return copyExactUint8Array(stored, MAX_DOCX_BYTES);
  } catch {
    return fail();
  }
}
