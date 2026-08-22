import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TOTAL_BYTES } from "../storage/attachmentValidation";

export const MAX_PROJECT_ZIP_BYTES = 52 * 1024 * 1024;
export const MIN_PROJECT_ZIP_ENTRIES = 2;
export const MAX_PROJECT_ZIP_ENTRIES = 102;
const MAX_JSON_ENTRY_BYTES = 1024 * 1024;
const EOCD_LENGTH = 22;
const CENTRAL_HEADER_LENGTH = 46;
const LOCAL_HEADER_LENGTH = 30;
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const ATTACHMENT_PATH = /^attachments\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(?:pdf|png|jpg)$/;
const DANGEROUS_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface ZipPreflightEntry {
  readonly path: string;
  readonly method: 0;
  readonly flags: 0;
  readonly modifiedTime: 0;
  readonly modifiedDate: 0;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly dataOffset: number;
  readonly extraLength: 0;
  readonly externalAttributes: 0;
}

export interface ZipPreflightReport {
  readonly byteLength: number;
  readonly centralDirectoryOffset: number;
  readonly centralDirectorySize: number;
  readonly entries: readonly ZipPreflightEntry[];
  readonly declaredAttachmentBytes: number;
}

function invalid(message: string): never {
  throw new Error(message);
}

function requireRange(bytes: Uint8Array, offset: number, length: number): DataView {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > bytes.byteLength
  ) {
    return invalid("项目包结构无效");
  }
  return new DataView(bytes.buffer, bytes.byteOffset + offset, length);
}

function u16(bytes: Uint8Array, offset: number): number {
  return requireRange(bytes, offset, 2).getUint16(0, true);
}

function u32(bytes: Uint8Array, offset: number): number {
  return requireRange(bytes, offset, 4).getUint32(0, true);
}

function decodeName(bytes: Uint8Array, offset: number, length: number): string {
  try {
    return textDecoder.decode(bytes.subarray(offset, offset + length));
  } catch {
    return invalid("项目包路径不是有效 UTF-8");
  }
}

function assertSafePath(path: string): void {
  if (
    path.length === 0 ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.endsWith("/") ||
    path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    invalid(path.endsWith("/") ? "项目包不得包含目录条目" : "项目包路径不安全");
  }
  const segments = path.split("/");
  if (
    segments.some((segment) => DANGEROUS_SEGMENTS.has((segment.split(".")[0] ?? "").toLowerCase()))
  ) {
    invalid("项目包路径不安全");
  }
}

function assertCanonicalLayout(paths: readonly string[]): void {
  if (paths[0] !== "manifest.json" || paths[1] !== "draft.json") {
    invalid("项目包条目顺序无效");
  }
  const attachmentPaths = paths.slice(2);
  if (attachmentPaths.some((path) => !ATTACHMENT_PATH.test(path))) {
    invalid("项目包路径不安全");
  }
  const sorted = [...attachmentPaths].sort(compareAscii);
  if (attachmentPaths.some((path, index) => path !== sorted[index])) {
    invalid("项目包条目顺序无效");
  }
}

function sameBytes(
  bytes: Uint8Array,
  firstOffset: number,
  secondOffset: number,
  length: number,
): boolean {
  for (let index = 0; index < length; index += 1) {
    if (bytes[firstOffset + index] !== bytes[secondOffset + index]) return false;
  }
  return true;
}

export function preflightProjectZip(bytes: Uint8Array): ZipPreflightReport {
  if (!(bytes instanceof Uint8Array)) invalid("项目包结构无效");
  if (bytes.byteLength > MAX_PROJECT_ZIP_BYTES) invalid("项目包超过 52 MiB");
  if (bytes.byteLength < EOCD_LENGTH) invalid("项目包结构无效");
  const eocdOffset = bytes.byteLength - EOCD_LENGTH;
  if (u32(bytes, eocdOffset) !== 0x06054b50) invalid("项目包 EOCD 无效或包含注释");
  const diskNumber = u16(bytes, eocdOffset + 4);
  const centralDisk = u16(bytes, eocdOffset + 6);
  const entriesOnDisk = u16(bytes, eocdOffset + 8);
  const entryCount = u16(bytes, eocdOffset + 10);
  const centralSize = u32(bytes, eocdOffset + 12);
  const centralOffset = u32(bytes, eocdOffset + 16);
  const eocdCommentLength = u16(bytes, eocdOffset + 20);
  if (
    entryCount === 0xffff ||
    entriesOnDisk === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    invalid("项目包不支持 Zip64");
  }
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    invalid("项目包不支持多磁盘 ZIP");
  }
  if (eocdCommentLength !== 0) invalid("项目包不得包含注释");
  if (entryCount < MIN_PROJECT_ZIP_ENTRIES || entryCount > MAX_PROJECT_ZIP_ENTRIES) {
    invalid("项目包条目数量无效");
  }
  if (centralOffset + centralSize !== eocdOffset) invalid("项目包中央目录范围无效");

  const centralEnd = centralOffset + centralSize;
  let cursor = centralOffset;
  let declaredAttachmentBytes = 0;
  const entries: Array<
    ZipPreflightEntry & { readonly nameOffset: number; readonly nameLength: number }
  > = [];
  const paths = new Set<string>();
  const normalizedPaths = new Set<string>();
  for (let index = 0; index < entryCount; index += 1) {
    if (u32(bytes, cursor) !== 0x02014b50) invalid("项目包中央目录无效");
    requireRange(bytes, cursor, CENTRAL_HEADER_LENGTH);
    const madeBy = u16(bytes, cursor + 4);
    const needed = u16(bytes, cursor + 6);
    const flags = u16(bytes, cursor + 8);
    const method = u16(bytes, cursor + 10);
    const modifiedTime = u16(bytes, cursor + 12);
    const modifiedDate = u16(bytes, cursor + 14);
    const crc32 = u32(bytes, cursor + 16);
    const compressedSize = u32(bytes, cursor + 20);
    const uncompressedSize = u32(bytes, cursor + 24);
    const nameLength = u16(bytes, cursor + 28);
    const extraLength = u16(bytes, cursor + 30);
    const commentLength = u16(bytes, cursor + 32);
    const diskStart = u16(bytes, cursor + 34);
    const internalAttributes = u16(bytes, cursor + 36);
    const externalAttributes = u32(bytes, cursor + 38);
    const localHeaderOffset = u32(bytes, cursor + 42);
    const nameOffset = cursor + CENTRAL_HEADER_LENGTH;
    const nextCursor = nameOffset + nameLength + extraLength + commentLength;
    requireRange(bytes, cursor, nextCursor - cursor);
    if (nextCursor > centralEnd) invalid("项目包中央目录范围无效");
    const path = decodeName(bytes, nameOffset, nameLength);
    const unixType = (externalAttributes >>> 16) & 0xf000;
    if ([0x2000, 0x6000, 0xa000].includes(unixType)) {
      invalid("项目包不得包含链接或设备条目");
    }
    if (unixType === 0x4000 || path.endsWith("/")) invalid("项目包不得包含目录条目");
    if ((flags & 1) !== 0) invalid("项目包不得加密");
    if (flags !== 0) invalid("项目包标志位无效");
    if (method !== 0) invalid("项目包仅支持 STORE 条目");
    if (extraLength !== 0) invalid("项目包不得包含额外字段");
    if (commentLength !== 0) invalid("项目包不得包含条目注释");
    if (diskStart !== 0) invalid("项目包不支持多磁盘 ZIP");
    if (
      madeBy !== 20 ||
      needed !== 20 ||
      modifiedTime !== 0 ||
      modifiedDate !== 0 ||
      internalAttributes !== 0 ||
      externalAttributes !== 0
    ) {
      invalid("项目包元数据非规范");
    }
    if (compressedSize !== uncompressedSize) invalid("STORE 条目长度无效");
    assertSafePath(path);
    if (paths.has(path)) invalid("项目包路径重复");
    paths.add(path);
    const normalized = path.normalize("NFC");
    if (normalizedPaths.has(normalized)) invalid("项目包路径归一化冲突");
    normalizedPaths.add(normalized);
    if (path.startsWith("attachments/")) {
      if (uncompressedSize > MAX_ATTACHMENT_BYTES) invalid("单个附件超过 25 MiB");
      declaredAttachmentBytes += uncompressedSize;
      if (declaredAttachmentBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
        invalid("项目包附件超过 50 MiB");
      }
    } else if (uncompressedSize > MAX_JSON_ENTRY_BYTES) {
      invalid("项目 JSON 超过 1 MiB");
    }
    entries.push({
      path,
      method: 0,
      flags: 0,
      modifiedTime: 0,
      modifiedDate: 0,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      dataOffset: 0,
      extraLength: 0,
      externalAttributes: 0,
      nameOffset,
      nameLength,
    });
    cursor = nextCursor;
  }
  if (cursor !== centralEnd) invalid("项目包中央目录范围无效");
  assertCanonicalLayout(entries.map((entry) => entry.path));

  let expectedLocalOffset = 0;
  const validatedEntries: ZipPreflightEntry[] = [];
  for (const entry of entries) {
    if (entry.localHeaderOffset !== expectedLocalOffset) invalid("项目包结构不连续");
    const offset = entry.localHeaderOffset;
    if (u32(bytes, offset) !== 0x04034b50) invalid("项目包本地头无效");
    requireRange(bytes, offset, LOCAL_HEADER_LENGTH);
    const localNeeded = u16(bytes, offset + 4);
    const localFlags = u16(bytes, offset + 6);
    const localMethod = u16(bytes, offset + 8);
    const localTime = u16(bytes, offset + 10);
    const localDate = u16(bytes, offset + 12);
    const localCrc = u32(bytes, offset + 14);
    const localCompressedSize = u32(bytes, offset + 18);
    const localUncompressedSize = u32(bytes, offset + 22);
    const localNameLength = u16(bytes, offset + 26);
    const localExtraLength = u16(bytes, offset + 28);
    const localNameOffset = offset + LOCAL_HEADER_LENGTH;
    requireRange(bytes, localNameOffset, localNameLength + localExtraLength);
    if (
      localNeeded !== 20 ||
      localFlags !== entry.flags ||
      localMethod !== entry.method ||
      localTime !== entry.modifiedTime ||
      localDate !== entry.modifiedDate ||
      localCrc !== entry.crc32 ||
      localCompressedSize !== entry.compressedSize ||
      localUncompressedSize !== entry.uncompressedSize ||
      localNameLength !== entry.nameLength ||
      localExtraLength !== 0 ||
      !sameBytes(bytes, localNameOffset, entry.nameOffset, entry.nameLength)
    ) {
      invalid("项目包本地头与中央目录不一致");
    }
    const dataOffset = localNameOffset + localNameLength;
    const dataEnd = dataOffset + entry.compressedSize;
    if (dataEnd > centralOffset) invalid("项目包条目范围无效");
    expectedLocalOffset = dataEnd;
    validatedEntries.push({
      path: entry.path,
      method: 0,
      flags: 0,
      modifiedTime: 0,
      modifiedDate: 0,
      crc32: entry.crc32,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
      localHeaderOffset: entry.localHeaderOffset,
      dataOffset,
      extraLength: 0,
      externalAttributes: 0,
    });
  }
  if (expectedLocalOffset !== centralOffset) invalid("项目包结构不连续");
  return {
    byteLength: bytes.byteLength,
    centralDirectoryOffset: centralOffset,
    centralDirectorySize: centralSize,
    entries: validatedEntries,
    declaredAttachmentBytes,
  };
}
