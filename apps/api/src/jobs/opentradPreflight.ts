import { lstat, open } from "node:fs/promises";
import { BidAssemblyManifestSchema, type BidTemplateId } from "@opentrad/contracts";
import { inspectPdfBytes } from "./pdfInspector.js";

const MAX_ARCHIVE_BYTES = 52 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_ENTRIES = 102;
const MAX_CENTRAL_BYTES = 128 * 1024;
const EOCD_BYTES = 22;
const CENTRAL_HEADER_BYTES = 46;
const LOCAL_HEADER_BYTES = 30;
const PREFLIGHT_TIMEOUT_MS = 10_000;
const ATTACHMENT_PATH = /^attachments\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(?:pdf|png|jpg)$/u;
const textDecoder = new TextDecoder("utf-8", { fatal: true });

interface Entry {
  readonly path: string;
  readonly crc32: number;
  readonly size: number;
  readonly localOffset: number;
  readonly dataOffset: number;
}

export interface OpenTradPreflightReport {
  readonly attachmentBytes: number;
  readonly attachmentCount: number;
  readonly bodyBytes: number;
  readonly entryCount: number;
}

export interface OpenTradPreflightRuntime {
  readonly inspectPdf: (
    input: Uint8Array,
    maximumPages: number,
    signal: AbortSignal | undefined,
    absoluteDeadline: number,
  ) => Promise<{ readonly pageCount: number }>;
  readonly now: () => number;
}

interface PreflightBudget {
  readonly deadline: number;
  readonly now: () => number;
  readonly signal?: AbortSignal;
}

export class OpenTradPreflightError extends Error {
  readonly code = "INVALID_REQUEST";

  constructor() {
    super("INVALID_REQUEST");
  }
}

function invalid(): never {
  throw new OpenTradPreflightError();
}

function runtimeSnapshot(input: OpenTradPreflightRuntime | undefined): OpenTradPreflightRuntime {
  if (input === undefined) return { inspectPdf: inspectPdfBytes, now: Date.now };
  if (
    input === null ||
    typeof input !== "object" ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== 2
  ) {
    return invalid();
  }
  const inspectDescriptor = Reflect.getOwnPropertyDescriptor(input, "inspectPdf");
  const nowDescriptor = Reflect.getOwnPropertyDescriptor(input, "now");
  if (
    !inspectDescriptor ||
    !("value" in inspectDescriptor) ||
    typeof inspectDescriptor.value !== "function" ||
    !nowDescriptor ||
    !("value" in nowDescriptor) ||
    typeof nowDescriptor.value !== "function"
  ) {
    return invalid();
  }
  return { inspectPdf: inspectDescriptor.value, now: nowDescriptor.value };
}

function checkBudget(budget: PreflightBudget): void {
  if (budget.signal?.aborted) invalid();
  let now: number;
  try {
    now = Reflect.apply(budget.now, undefined, []);
  } catch {
    invalid();
  }
  if (!Number.isSafeInteger(now) || now < 0 || now >= budget.deadline) invalid();
}

function u16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.byteLength) return invalid();
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}

function u32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.byteLength) return invalid();
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

async function readExact(
  handle: Awaited<ReturnType<typeof open>>,
  length: number,
  position: number,
  budget: PreflightBudget,
): Promise<Buffer> {
  checkBudget(budget);
  if (
    !Number.isSafeInteger(length) ||
    !Number.isSafeInteger(position) ||
    length < 0 ||
    position < 0
  ) {
    return invalid();
  }
  const output = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    checkBudget(budget);
    const read = await handle.read(output, offset, length - offset, position + offset);
    checkBudget(budget);
    if (read.bytesRead <= 0) return invalid();
    offset += read.bytesRead;
  }
  return output;
}

function safePath(path: string): void {
  if (
    path.length < 1 ||
    path.length > 256 ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    /^[A-Za-z]:/u.test(path)
  ) {
    invalid();
  }
  const segments = path.split("/");
  for (const segment of segments) {
    const normalized = (segment.split(".")[0] ?? "").toLowerCase();
    if (
      segment === "" ||
      segment === "." ||
      segment === ".." ||
      normalized === "__proto__" ||
      normalized === "constructor" ||
      normalized === "prototype"
    ) {
      invalid();
    }
  }
}

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

async function verifyCrc(
  handle: Awaited<ReturnType<typeof open>>,
  entry: Entry,
  budget: PreflightBudget,
): Promise<void> {
  let crc = 0xffffffff;
  let offset = 0;
  const buffer = Buffer.alloc(Math.min(64 * 1024, Math.max(entry.size, 1)));
  while (offset < entry.size) {
    checkBudget(budget);
    const length = Math.min(buffer.byteLength, entry.size - offset);
    const result = await handle.read(buffer, 0, length, entry.dataOffset + offset);
    checkBudget(budget);
    if (result.bytesRead !== length) invalid();
    for (let index = 0; index < length; index += 1) {
      crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ (buffer[index] as number)) & 0xff] as number);
    }
    offset += length;
  }
  if ((crc ^ 0xffffffff) >>> 0 !== entry.crc32) invalid();
}

function extension(mediaType: string): string {
  if (mediaType === "application/pdf") return "pdf";
  if (mediaType === "image/png") return "png";
  if (mediaType === "image/jpeg") return "jpg";
  return invalid();
}

interface OuterAttachment {
  readonly id: string;
  readonly category: string;
  readonly displayName: string;
  readonly mediaType: string;
  readonly pageCount?: number;
  readonly required: boolean;
  readonly sourceRef?: string;
  readonly status: "missing" | "attached" | "rejected";
  readonly includedInSubmission: boolean;
}

interface OuterFile {
  readonly id: string;
  readonly path: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly pageCount: number;
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    return invalid();
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string") ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    keys.some(
      (key) => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)),
    )
  ) {
    invalid();
  }
  for (const key of keys) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) invalid();
  }
}

function stringValue(value: unknown, maximum = 500): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) return invalid();
  return value;
}

function integerValue(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    return invalid();
  }
  return value as number;
}

function parseOuterAttachment(value: unknown): OuterAttachment {
  const record = plainRecord(value);
  exactKeys(
    record,
    ["id", "category", "displayName", "mediaType", "required", "status", "includedInSubmission"],
    ["pageCount", "sourceRef"],
  );
  const id = stringValue(record.id, 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(id)) invalid();
  const category = stringValue(record.category, 32);
  if (!new Set(["qualification", "technical", "commercial", "other"]).has(category)) invalid();
  const mediaType = stringValue(record.mediaType, 64);
  extension(mediaType);
  const status = stringValue(record.status, 16);
  if (status !== "missing" && status !== "attached" && status !== "rejected") invalid();
  if (
    typeof record.required !== "boolean" ||
    typeof record.includedInSubmission !== "boolean" ||
    (status !== "attached" && record.includedInSubmission)
  ) {
    invalid();
  }
  const pageCount =
    record.pageCount === undefined ? undefined : integerValue(record.pageCount, 10_000);
  if (status === "attached" && pageCount === undefined) invalid();
  const sourceRef = record.sourceRef === undefined ? undefined : stringValue(record.sourceRef, 500);
  return {
    id,
    category,
    displayName: stringValue(record.displayName),
    mediaType,
    ...(pageCount === undefined ? {} : { pageCount }),
    required: record.required,
    ...(sourceRef === undefined ? {} : { sourceRef }),
    status,
    includedInSubmission: record.includedInSubmission,
  };
}

function parseOuterFile(value: unknown): OuterFile {
  const record = plainRecord(value);
  exactKeys(record, ["id", "path", "mediaType", "byteLength", "pageCount"]);
  const id = stringValue(record.id, 200);
  const mediaType = stringValue(record.mediaType, 64);
  const suffix = extension(mediaType);
  const path = stringValue(record.path, 256);
  if (path !== `attachments/${id}.${suffix}`) invalid();
  return {
    id,
    path,
    mediaType,
    byteLength: integerValue(record.byteLength, MAX_ATTACHMENT_BYTES),
    pageCount: integerValue(record.pageCount, 10_000),
  };
}

function parseOuterManifest(
  value: unknown,
  options: { readonly templateId: BidTemplateId; readonly templateVersion: "1.0.0" },
): {
  readonly attachments: readonly OuterAttachment[];
  readonly bidAssembly: ReturnType<typeof BidAssemblyManifestSchema.parse>;
  readonly files: readonly OuterFile[];
  readonly presentation: { readonly layoutStyleId: string; readonly languageView: string };
} {
  const outer = plainRecord(value);
  exactKeys(outer, [
    "formatVersion",
    "template",
    "presentation",
    "attachmentManifest",
    "files",
    "bidAssembly",
  ]);
  if (outer.formatVersion !== "2.0.0") invalid();
  const template = plainRecord(outer.template);
  exactKeys(template, ["id", "version", "basisDate"]);
  if (
    template.id !== options.templateId ||
    template.version !== options.templateVersion ||
    template.basisDate !== "2026-08-19"
  ) {
    invalid();
  }
  const presentation = plainRecord(outer.presentation);
  exactKeys(presentation, ["layoutStyleId", "languageView"]);
  if (
    !new Set(["classic-formal.v1", "modern-business.v1", "international-compact.v1"]).has(
      presentation.layoutStyleId as string,
    ) ||
    !new Set(["zh-CN", "en-US", "zh-en"]).has(presentation.languageView as string)
  ) {
    invalid();
  }
  if (
    !Array.isArray(outer.attachmentManifest) ||
    outer.attachmentManifest.length > 100 ||
    !Array.isArray(outer.files) ||
    outer.files.length > 100
  ) {
    invalid();
  }
  const attachments = outer.attachmentManifest.map(parseOuterAttachment);
  const files = outer.files.map(parseOuterFile);
  const attachmentIds = new Set<string>();
  const fileIds = new Set<string>();
  for (const attachment of attachments) {
    if (attachmentIds.has(attachment.id)) invalid();
    attachmentIds.add(attachment.id);
  }
  for (const file of files) {
    if (fileIds.has(file.id)) invalid();
    fileIds.add(file.id);
  }
  let bidAssembly: ReturnType<typeof BidAssemblyManifestSchema.parse>;
  try {
    bidAssembly = BidAssemblyManifestSchema.parse(outer.bidAssembly);
  } catch {
    return invalid();
  }
  if (
    bidAssembly.templateId !== options.templateId ||
    bidAssembly.templateVersion !== options.templateVersion ||
    bidAssembly.attachmentManifest.length !== attachments.length
  ) {
    invalid();
  }
  for (let index = 0; index < attachments.length; index += 1) {
    const outerAttachment = attachments[index];
    const bidAttachment = bidAssembly.attachmentManifest[index];
    if (
      !outerAttachment ||
      !bidAttachment ||
      outerAttachment.id !== bidAttachment.id ||
      outerAttachment.category !== bidAttachment.category ||
      outerAttachment.displayName !== bidAttachment.displayName ||
      outerAttachment.mediaType !== bidAttachment.mediaType ||
      outerAttachment.required !== bidAttachment.required ||
      outerAttachment.status !== bidAttachment.status ||
      outerAttachment.includedInSubmission !== bidAttachment.includedInSubmission ||
      outerAttachment.sourceRef !== bidAttachment.sourceRef
    ) {
      invalid();
    }
    const file = files.find((candidate) => candidate.id === outerAttachment.id);
    if (outerAttachment.status === "attached") {
      if (
        !file ||
        bidAttachment.status !== "attached" ||
        outerAttachment.pageCount !== bidAttachment.pageCount ||
        file.pageCount !== bidAttachment.pageCount ||
        file.mediaType !== bidAttachment.mediaType ||
        file.byteLength !== bidAttachment.byteLength
      ) {
        invalid();
      }
    } else if (file !== undefined) {
      invalid();
    }
  }
  if (
    files.length !== attachments.filter((attachment) => attachment.status === "attached").length
  ) {
    invalid();
  }
  return {
    attachments,
    bidAssembly,
    files,
    presentation: {
      layoutStyleId: presentation.layoutStyleId as string,
      languageView: presentation.languageView as string,
    },
  };
}

function sameAttachment(left: OuterAttachment, right: OuterAttachment): boolean {
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

function validateDraftEnvelope(
  bytes: Uint8Array,
  options: { readonly templateId: BidTemplateId; readonly templateVersion: "1.0.0" },
  outer: ReturnType<typeof parseOuterManifest>,
): void {
  let value: unknown;
  try {
    value = JSON.parse(textDecoder.decode(bytes));
  } catch {
    invalid();
  }
  const envelope = plainRecord(value);
  exactKeys(envelope, ["formatVersion", "template", "draft", "presentation", "attachmentManifest"]);
  if (envelope.formatVersion !== "2.0.0") invalid();
  const template = plainRecord(envelope.template);
  exactKeys(template, ["id", "version", "basisDate"]);
  if (
    template.id !== options.templateId ||
    template.version !== options.templateVersion ||
    template.basisDate !== "2026-08-19"
  ) {
    invalid();
  }
  const draft = plainRecord(envelope.draft);
  if (
    typeof draft.id !== "string" ||
    draft.id.length < 1 ||
    draft.id.length > 200 ||
    draft.templateId !== options.templateId ||
    draft.templateVersion !== options.templateVersion
  ) {
    invalid();
  }
  const presentation = plainRecord(envelope.presentation);
  exactKeys(presentation, ["layoutStyleId", "languageView"]);
  if (
    presentation.layoutStyleId !== outer.presentation.layoutStyleId ||
    presentation.languageView !== outer.presentation.languageView
  ) {
    invalid();
  }
  if (
    !Array.isArray(envelope.attachmentManifest) ||
    envelope.attachmentManifest.length !== outer.attachments.length
  ) {
    invalid();
  }
  const draftAttachments = envelope.attachmentManifest.map(parseOuterAttachment);
  for (let index = 0; index < draftAttachments.length; index += 1) {
    const draftAttachment = draftAttachments[index];
    const outerAttachment = outer.attachments[index];
    if (!draftAttachment || !outerAttachment || !sameAttachment(draftAttachment, outerAttachment)) {
      invalid();
    }
  }
}

function attachmentMagic(bytes: Uint8Array, mediaType: string): boolean {
  if (mediaType === "application/pdf")
    return Buffer.from(bytes).subarray(0, 5).toString() === "%PDF-";
  if (mediaType === "image/png") {
    return Buffer.from(bytes)
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mediaType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return false;
}

export async function preflightOpenTradArchive(
  path: string,
  options: { readonly templateId: BidTemplateId; readonly templateVersion: "1.0.0" },
  signal?: AbortSignal,
  runtimeInput?: OpenTradPreflightRuntime,
): Promise<OpenTradPreflightReport> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const runtime = runtimeSnapshot(runtimeInput);
    const startedAt = Reflect.apply(runtime.now, undefined, []);
    if (!Number.isSafeInteger(startedAt) || startedAt < 0) invalid();
    const budget: PreflightBudget = {
      deadline: startedAt + PREFLIGHT_TIMEOUT_MS,
      now: runtime.now,
      ...(signal === undefined ? {} : { signal }),
    };
    checkBudget(budget);
    const link = await lstat(path);
    checkBudget(budget);
    if (
      !link.isFile() ||
      link.isSymbolicLink() ||
      link.size < EOCD_BYTES ||
      link.size > MAX_ARCHIVE_BYTES
    ) {
      invalid();
    }
    handle = await open(path, "r");
    const fileInfo = await handle.stat();
    checkBudget(budget);
    if (!fileInfo.isFile() || fileInfo.size !== link.size) invalid();
    const eocd = await readExact(handle, EOCD_BYTES, fileInfo.size - EOCD_BYTES, budget);
    if (
      u32(eocd, 0) !== 0x06054b50 ||
      u16(eocd, 4) !== 0 ||
      u16(eocd, 6) !== 0 ||
      u16(eocd, 8) !== u16(eocd, 10) ||
      u16(eocd, 20) !== 0
    ) {
      invalid();
    }
    const count = u16(eocd, 10);
    const centralSize = u32(eocd, 12);
    const centralOffset = u32(eocd, 16);
    if (
      count < 2 ||
      count > MAX_ENTRIES ||
      centralSize > MAX_CENTRAL_BYTES ||
      centralOffset + centralSize !== fileInfo.size - EOCD_BYTES
    ) {
      invalid();
    }
    const central = await readExact(handle, centralSize, centralOffset, budget);
    const entries: Entry[] = [];
    const paths = new Set<string>();
    const normalizedPaths = new Set<string>();
    let cursor = 0;
    for (let index = 0; index < count; index += 1) {
      checkBudget(budget);
      if (u32(central, cursor) !== 0x02014b50 || cursor + CENTRAL_HEADER_BYTES > central.length) {
        invalid();
      }
      const madeBy = u16(central, cursor + 4);
      const needed = u16(central, cursor + 6);
      const flags = u16(central, cursor + 8);
      const method = u16(central, cursor + 10);
      const modifiedTime = u16(central, cursor + 12);
      const modifiedDate = u16(central, cursor + 14);
      const checksum = u32(central, cursor + 16);
      const compressed = u32(central, cursor + 20);
      const size = u32(central, cursor + 24);
      const nameLength = u16(central, cursor + 28);
      const extraLength = u16(central, cursor + 30);
      const commentLength = u16(central, cursor + 32);
      const disk = u16(central, cursor + 34);
      const internalAttributes = u16(central, cursor + 36);
      const externalAttributes = u32(central, cursor + 38);
      const localOffset = u32(central, cursor + 42);
      const next = cursor + CENTRAL_HEADER_BYTES + nameLength + extraLength + commentLength;
      if (
        next > central.length ||
        madeBy !== 20 ||
        needed !== 20 ||
        flags !== 0 ||
        method !== 0 ||
        modifiedTime !== 0 ||
        modifiedDate !== 0 ||
        compressed !== size ||
        nameLength < 1 ||
        extraLength !== 0 ||
        commentLength !== 0 ||
        disk !== 0 ||
        internalAttributes !== 0 ||
        externalAttributes !== 0
      ) {
        invalid();
      }
      let entryPath: string;
      try {
        entryPath = textDecoder.decode(
          central.subarray(
            cursor + CENTRAL_HEADER_BYTES,
            cursor + CENTRAL_HEADER_BYTES + nameLength,
          ),
        );
      } catch {
        return invalid();
      }
      safePath(entryPath);
      const normalized = entryPath.normalize("NFC");
      if (paths.has(entryPath) || normalizedPaths.has(normalized)) invalid();
      paths.add(entryPath);
      normalizedPaths.add(normalized);
      entries.push({ crc32: checksum, dataOffset: 0, localOffset, path: entryPath, size });
      cursor = next;
    }
    if (
      cursor !== central.length ||
      entries[0]?.path !== "manifest.json" ||
      entries[1]?.path !== "draft.json"
    ) {
      invalid();
    }
    const attachmentPaths = entries.slice(2).map((entry) => entry.path);
    const sortedPaths = [...attachmentPaths].sort();
    if (
      attachmentPaths.some(
        (pathValue, index) => !ATTACHMENT_PATH.test(pathValue) || pathValue !== sortedPaths[index],
      )
    ) {
      invalid();
    }

    let expectedOffset = 0;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index] as Entry;
      if (entry.localOffset !== expectedOffset) invalid();
      const header = await readExact(handle, LOCAL_HEADER_BYTES, entry.localOffset, budget);
      const nameLength = u16(header, 26);
      if (
        u32(header, 0) !== 0x04034b50 ||
        u16(header, 4) !== 20 ||
        u16(header, 6) !== 0 ||
        u16(header, 8) !== 0 ||
        u16(header, 10) !== 0 ||
        u16(header, 12) !== 0 ||
        u32(header, 14) !== entry.crc32 ||
        u32(header, 18) !== entry.size ||
        u32(header, 22) !== entry.size ||
        u16(header, 28) !== 0
      ) {
        invalid();
      }
      const name = await readExact(
        handle,
        nameLength,
        entry.localOffset + LOCAL_HEADER_BYTES,
        budget,
      );
      if (!name.equals(Buffer.from(entry.path, "utf8"))) invalid();
      const dataOffset = entry.localOffset + LOCAL_HEADER_BYTES + nameLength;
      entries[index] = { ...entry, dataOffset };
      expectedOffset = dataOffset + entry.size;
      if (expectedOffset > centralOffset) invalid();
    }
    if (expectedOffset !== centralOffset) invalid();
    const manifestEntry = entries[0] as Entry;
    if (manifestEntry.size < 2 || manifestEntry.size > MAX_JSON_BYTES) invalid();
    const manifestBytes = await readExact(
      handle,
      manifestEntry.size,
      manifestEntry.dataOffset,
      budget,
    );
    let parsedOuter: ReturnType<typeof parseOuterManifest>;
    try {
      parsedOuter = parseOuterManifest(JSON.parse(textDecoder.decode(manifestBytes)), options);
    } catch {
      return invalid();
    }
    const parsed = parsedOuter.bidAssembly;
    if (
      parsed.templateId !== options.templateId ||
      parsed.templateVersion !== options.templateVersion ||
      entries[1]?.size !== parsed.body.byteLength
    ) {
      invalid();
    }
    const draftEntry = entries[1] as Entry;
    const draftBytes = await readExact(handle, draftEntry.size, draftEntry.dataOffset, budget);
    validateDraftEnvelope(draftBytes, options, parsedOuter);
    const expectedAttachments: Array<{ path: string; size: number }> = [];
    let attachmentBytes = 0;
    let actualIncludedPages = parsed.body.pageCount;
    for (let index = 0; index < parsed.attachmentManifest.length; index += 1) {
      const attachment = parsed.attachmentManifest[index];
      if (!attachment || attachment.status !== "attached") continue;
      const outerFile = parsedOuter.files.find((file) => file.id === attachment.id);
      if (!outerFile) invalid();
      expectedAttachments.push({ path: outerFile.path, size: outerFile.byteLength });
      attachmentBytes += attachment.byteLength;
      if (
        attachment.byteLength > MAX_ATTACHMENT_BYTES ||
        attachmentBytes > MAX_ATTACHMENT_TOTAL_BYTES
      ) {
        invalid();
      }
    }
    expectedAttachments.sort((left, right) => left.path.localeCompare(right.path, "en"));
    if (expectedAttachments.length !== entries.length - 2) invalid();
    for (let index = 0; index < expectedAttachments.length; index += 1) {
      const expected = expectedAttachments[index];
      const actual = entries[index + 2];
      if (!expected || !actual || expected.path !== actual.path || expected.size !== actual.size) {
        invalid();
      }
      const outerFile = parsedOuter.files.find((file) => file.path === actual.path);
      if (!outerFile) invalid();
      const magic = await readExact(handle, Math.min(actual.size, 12), actual.dataOffset, budget);
      if (!attachmentMagic(magic, outerFile.mediaType)) invalid();
      if (outerFile.mediaType === "application/pdf") {
        const attachment = parsed.attachmentManifest.find(
          (candidate) => candidate.id === outerFile.id,
        );
        if (!attachment) invalid();
        const pdf = await readExact(handle, actual.size, actual.dataOffset, budget);
        const inspection = await Reflect.apply(runtime.inspectPdf, undefined, [
          pdf,
          attachment.includedInSubmission ? 80 : 10_000,
          signal,
          budget.deadline,
        ]);
        checkBudget(budget);
        if (inspection.pageCount !== outerFile.pageCount) invalid();
        if (attachment.includedInSubmission) actualIncludedPages += inspection.pageCount;
      } else {
        if (outerFile.pageCount !== 1) invalid();
        const attachment = parsed.attachmentManifest.find(
          (candidate) => candidate.id === outerFile.id,
        );
        if (attachment?.includedInSubmission) actualIncludedPages += outerFile.pageCount;
      }
      if (actualIncludedPages > 80) invalid();
    }
    for (const entry of entries) await verifyCrc(handle, entry, budget);
    checkBudget(budget);
    return Object.freeze({
      attachmentBytes,
      attachmentCount: expectedAttachments.length,
      bodyBytes: parsed.body.byteLength,
      entryCount: entries.length,
    });
  } catch (error) {
    if (error instanceof OpenTradPreflightError) throw error;
    throw new OpenTradPreflightError();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
