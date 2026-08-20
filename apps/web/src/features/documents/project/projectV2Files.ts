import { v2 } from "@opentrad/document-core";
import { Unzip, UnzipPassThrough } from "fflate";
import {
  type AttachmentMediaType,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
  validateAttachmentBytes,
} from "../storage/attachmentValidation";
import {
  type DocumentTemplateRegistry,
  documentStorageKey,
  validateDocumentEnvelope,
} from "../storage/documentRepository";
import {
  MAX_PROJECT_ZIP_BYTES,
  preflightProjectZip,
  type ZipPreflightReport,
} from "./zipPreflight";

export const PROJECT_V2_ZIP_MIME = "application/vnd.opentrad.project+zip";
const MAX_JSON_ENTRY_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const DANGEROUS_IDS = new Set(["__proto__", "constructor", "prototype"]);
const ATTACHMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export interface ProjectV2AttachmentFile {
  readonly id: string;
  readonly mediaType: AttachmentMediaType;
  readonly pageCount: number;
  readonly bytes: Uint8Array;
}

export interface ImportedProjectV2 {
  readonly envelope: v2.ProjectEnvelopeV2;
  readonly portableEnvelope: v2.ProjectEnvelopeV2;
  readonly model: v2.DocumentModelV2;
  readonly attachments: readonly ProjectV2AttachmentFile[];
  readonly requiresUserConfirmation: true;
}

export type ProjectV2ZipFileLike = {
  readonly size: number;
  readonly arrayBuffer: () => Promise<ArrayBuffer>;
};

interface ManifestFile {
  readonly id: string;
  readonly path: string;
  readonly mediaType: AttachmentMediaType;
  readonly byteLength: number;
  readonly pageCount: number;
}

interface ProjectZipManifest {
  readonly formatVersion: "2.0.0";
  readonly template: v2.ProjectEnvelopeV2["template"];
  readonly presentation: v2.ProjectEnvelopeV2["presentation"];
  readonly attachmentManifest: readonly v2.AttachmentRefV1[];
  readonly files: readonly ManifestFile[];
}

function projectError(message: string): Error {
  return new Error(message);
}

function ownData(object: object, key: PropertyKey): unknown {
  const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !("value" in descriptor)) throw projectError("附件输入无效");
  return descriptor.value;
}

function assertExactOwnKeys(object: object, expected: readonly string[], message: string): void {
  const actual = Reflect.ownKeys(object);
  if (
    actual.length !== expected.length ||
    expected.some((key) => !actual.includes(key)) ||
    actual.some((key) => typeof key !== "string")
  ) {
    throw projectError(message);
  }
  for (const key of expected) {
    const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !("value" in descriptor)) throw projectError(message);
  }
}

function snapshotAttachmentFiles(input: unknown): ProjectV2AttachmentFile[] {
  try {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype)
      throw new Error();
    if (input.length > 100 || Reflect.ownKeys(input).length !== input.length + 1) throw new Error();
    const result: ProjectV2AttachmentFile[] = [];
    const ids = new Set<string>();
    for (let index = 0; index < input.length; index += 1) {
      const item = ownData(input, String(index));
      if (item === null || typeof item !== "object" || Array.isArray(item)) throw new Error();
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new Error();
      assertExactOwnKeys(item, ["id", "mediaType", "pageCount", "bytes"], "附件输入无效");
      const id = ownData(item, "id");
      const mediaType = ownData(item, "mediaType");
      const pageCount = ownData(item, "pageCount");
      const attachmentBytes = ownData(item, "bytes");
      if (
        typeof id !== "string" ||
        !ATTACHMENT_ID.test(id) ||
        DANGEROUS_IDS.has(id.toLowerCase()) ||
        !["application/pdf", "image/png", "image/jpeg"].includes(mediaType as string) ||
        !Number.isSafeInteger(pageCount) ||
        (pageCount as number) < 1 ||
        !ArrayBuffer.isView(attachmentBytes) ||
        Object.prototype.toString.call(attachmentBytes) !== "[object Uint8Array]"
      ) {
        throw new Error();
      }
      if (ids.has(id)) throw new Error();
      ids.add(id);
      const sourceBytes = attachmentBytes as Uint8Array;
      const copiedBytes = new Uint8Array(sourceBytes.byteLength);
      copiedBytes.set(sourceBytes);
      result.push({
        id,
        mediaType: mediaType as AttachmentMediaType,
        pageCount: pageCount as number,
        bytes: copiedBytes,
      });
    }
    return result.sort((left, right) => left.id.localeCompare(right.id, "en"));
  } catch {
    throw projectError("附件输入无效");
  }
}

function portableAttachment(attachment: v2.AttachmentRefV1): v2.AttachmentRefV1 {
  const { localBlobKey: _localBlobKey, ...portable } = attachment;
  return portable;
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function extension(mediaType: AttachmentMediaType): "pdf" | "png" | "jpg" {
  return mediaType === "application/pdf" ? "pdf" : mediaType === "image/png" ? "png" : "jpg";
}

function validateFilesAgainstEnvelope(
  envelope: v2.ProjectEnvelopeV2,
  files: readonly ProjectV2AttachmentFile[],
): void {
  const byId = new Map(files.map((file) => [file.id, file]));
  let totalBytes = 0;
  for (const descriptor of envelope.attachmentManifest) {
    const file = byId.get(descriptor.id);
    const expectedLocalKey = `${documentStorageKey(envelope)}#${descriptor.id}`;
    if (descriptor.status === "attached") {
      if (descriptor.localBlobKey !== undefined && descriptor.localBlobKey !== expectedLocalKey) {
        throw projectError("附件本地引用不一致");
      }
      if (!file) throw projectError("已附加附件缺少文件");
      if (
        file.mediaType !== descriptor.mediaType ||
        file.pageCount !== descriptor.pageCount ||
        (descriptor.mediaType !== "application/pdf" && descriptor.pageCount !== 1)
      ) {
        throw projectError("附件描述不一致");
      }
      if (file.bytes.byteLength === 0) throw projectError("附件不能为空");
      if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
        throw projectError("单个附件超过 25 MiB");
      }
      validateAttachmentBytes(file.bytes, file.mediaType);
      totalBytes += file.bytes.byteLength;
      if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
        throw projectError("项目包附件超过 50 MiB");
      }
      byId.delete(descriptor.id);
    } else {
      if (descriptor.localBlobKey !== undefined) throw projectError("附件本地引用不一致");
      if (file) throw projectError("未附加附件不得包含文件");
    }
  }
  if (byId.size > 0) throw projectError("附件文件未在清单中声明");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw projectError("项目包包含无效数字");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  throw projectError("项目包包含无法序列化的值");
}

let crcTable: Uint32Array | undefined;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let value = 0; value < 256; value += 1) {
      let current = value;
      for (let bit = 0; bit < 8; bit += 1) {
        current = (current & 1) !== 0 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
      }
      crcTable[value] = current >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const value of bytes) crc = (crcTable[(crc ^ value) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function buildCanonicalZip(entries: readonly { path: string; data: Uint8Array }[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const path = encoder.encode(entry.path);
    const checksum = crc32(entry.data);
    const local = new Uint8Array(30 + path.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, entry.data.byteLength, true);
    localView.setUint32(22, entry.data.byteLength, true);
    localView.setUint16(26, path.byteLength, true);
    local.set(path, 30);
    localParts.push(local, entry.data);

    const central = new Uint8Array(46 + path.byteLength);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, entry.data.byteLength, true);
    centralView.setUint32(24, entry.data.byteLength, true);
    centralView.setUint16(28, path.byteLength, true);
    centralView.setUint32(42, localOffset, true);
    central.set(path, 46);
    centralParts.push(central);
    localOffset += local.byteLength + entry.data.byteLength;
  }
  const localBytes = concat(localParts);
  const centralBytes = concat(centralParts);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralBytes.byteLength, true);
  eocdView.setUint32(16, localBytes.byteLength, true);
  const archive = concat([localBytes, centralBytes, eocd]);
  if (archive.byteLength > MAX_PROJECT_ZIP_BYTES) throw projectError("项目包超过 52 MiB");
  return archive;
}

function manifestFor(
  envelope: v2.ProjectEnvelopeV2,
  files: readonly ProjectV2AttachmentFile[],
): ProjectZipManifest {
  return {
    formatVersion: "2.0.0",
    template: envelope.template,
    presentation: envelope.presentation,
    attachmentManifest: envelope.attachmentManifest.map(portableAttachment),
    files: files.map((file) => ({
      id: file.id,
      path: `attachments/${file.id}.${extension(file.mediaType)}`,
      mediaType: file.mediaType,
      byteLength: file.bytes.byteLength,
      pageCount: file.pageCount,
    })),
  };
}

export async function exportProjectV2Zip(input: {
  readonly envelope: unknown;
  readonly attachments: unknown;
  readonly registry: DocumentTemplateRegistry;
}): Promise<Blob> {
  const { envelope } = validateDocumentEnvelope(input.envelope, input.registry);
  const files = snapshotAttachmentFiles(input.attachments);
  validateFilesAgainstEnvelope(envelope, files);
  const portableEnvelope = v2.ProjectEnvelopeV2Schema.parse({
    ...envelope,
    attachmentManifest: envelope.attachmentManifest.map(portableAttachment),
  });
  const manifest = manifestFor(portableEnvelope, files);
  const entries = [
    { path: "manifest.json", data: encoder.encode(stableJson(manifest)) },
    { path: "draft.json", data: encoder.encode(v2.serializeProjectV2(portableEnvelope)) },
    ...files.map((file) => ({
      path: `attachments/${file.id}.${extension(file.mediaType)}`,
      data: file.bytes,
    })),
  ];
  const archive = buildCanonicalZip(entries);
  preflightProjectZip(archive);
  const blobBytes = new Uint8Array(archive.byteLength);
  blobBytes.set(archive);
  return new Blob([blobBytes.buffer], { type: PROJECT_V2_ZIP_MIME });
}

function concatenateChunks(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function streamStoreEntries(
  bytes: Uint8Array,
  report: ZipPreflightReport,
): Promise<Map<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    const expected = new Map(report.entries.map((entry) => [entry.path, entry]));
    const output = new Map<string, Uint8Array>();
    let pending = 0;
    let pushedFinal = false;
    let failed = false;
    let actualAttachmentBytes = 0;
    const fail = (error: unknown) => {
      if (failed) return;
      failed = true;
      reject(error instanceof Error ? error : projectError("项目包解压失败"));
    };
    const finish = () => {
      if (!failed && pushedFinal && pending === 0) {
        if (output.size !== expected.size) {
          fail(projectError("项目包解压条目不完整"));
          return;
        }
        resolve(output);
      }
    };
    const unzip = new Unzip((file) => {
      const metadata = expected.get(file.name);
      if (!metadata || output.has(file.name)) {
        fail(projectError("项目包解压条目不一致"));
        file.terminate();
        return;
      }
      pending += 1;
      let actualBytes = 0;
      const chunks: Uint8Array[] = [];
      file.ondata = (error, chunk, final) => {
        if (failed) return;
        if (error) {
          fail(error);
          return;
        }
        actualBytes += chunk.byteLength;
        const limit = file.name.startsWith("attachments/")
          ? MAX_ATTACHMENT_BYTES
          : MAX_JSON_ENTRY_BYTES;
        if (actualBytes > limit || actualBytes > metadata.uncompressedSize) {
          fail(
            projectError(
              file.name.startsWith("attachments/") ? "单个附件超过 25 MiB" : "项目 JSON 超过 1 MiB",
            ),
          );
          file.terminate();
          return;
        }
        chunks.push(new Uint8Array(chunk));
        if (!final) return;
        if (actualBytes !== metadata.uncompressedSize) {
          fail(projectError("项目包声明长度与实际长度不一致"));
          return;
        }
        const combined = concatenateChunks(chunks, actualBytes);
        if (crc32(combined) !== metadata.crc32) {
          fail(projectError("项目包 CRC 校验失败"));
          return;
        }
        if (file.name.startsWith("attachments/")) {
          actualAttachmentBytes += actualBytes;
          if (actualAttachmentBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
            fail(projectError("项目包附件超过 50 MiB"));
            return;
          }
        }
        output.set(file.name, combined);
        pending -= 1;
        finish();
      };
      try {
        file.start();
      } catch (error) {
        fail(error);
      }
    });
    unzip.register(UnzipPassThrough);
    try {
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        const end = Math.min(offset + chunkSize, bytes.byteLength);
        unzip.push(bytes.subarray(offset, end), end === bytes.byteLength);
      }
      pushedFinal = true;
      finish();
    } catch (error) {
      fail(error);
    }
  });
}

function decodeJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    throw projectError(`${label} 不是有效 UTF-8 JSON`);
  }
}

function parseManifest(input: unknown): ProjectZipManifest {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error();
    assertExactOwnKeys(
      input,
      ["formatVersion", "template", "presentation", "attachmentManifest", "files"],
      "项目包 manifest 无效",
    );
    if (ownData(input, "formatVersion") !== "2.0.0") throw new Error();
    const template = ownData(input, "template");
    const presentation = ownData(input, "presentation");
    const attachmentManifest = ownData(input, "attachmentManifest");
    const files = ownData(input, "files");
    if (!Array.isArray(files) || files.length > 100) throw new Error();
    const parsedFiles: ManifestFile[] = files.map((file) => {
      if (file === null || typeof file !== "object" || Array.isArray(file)) throw new Error();
      assertExactOwnKeys(
        file,
        ["id", "path", "mediaType", "byteLength", "pageCount"],
        "项目包 manifest 无效",
      );
      const parsed = {
        id: ownData(file, "id"),
        path: ownData(file, "path"),
        mediaType: ownData(file, "mediaType"),
        byteLength: ownData(file, "byteLength"),
        pageCount: ownData(file, "pageCount"),
      };
      if (
        typeof parsed.id !== "string" ||
        typeof parsed.path !== "string" ||
        !["application/pdf", "image/png", "image/jpeg"].includes(parsed.mediaType as string) ||
        !Number.isSafeInteger(parsed.byteLength) ||
        (parsed.byteLength as number) < 1 ||
        !Number.isSafeInteger(parsed.pageCount) ||
        (parsed.pageCount as number) < 1
      ) {
        throw new Error();
      }
      return parsed as ManifestFile;
    });
    const envelope = v2.ProjectEnvelopeV2Schema.parse({
      formatVersion: "2.0.0",
      template,
      draft: {
        id: "manifest-placeholder",
        templateId: (template as v2.ProjectEnvelopeV2["template"]).id,
        templateVersion: (template as v2.ProjectEnvelopeV2["template"]).version,
      },
      presentation,
      attachmentManifest,
    });
    return {
      formatVersion: "2.0.0",
      template: envelope.template,
      presentation: envelope.presentation,
      attachmentManifest: envelope.attachmentManifest,
      files: parsedFiles,
    };
  } catch {
    throw projectError("项目包 manifest 无效");
  }
}

async function readZipInput(input: Uint8Array | ProjectV2ZipFileLike): Promise<Uint8Array> {
  if (input instanceof Uint8Array) {
    if (input.byteLength > MAX_PROJECT_ZIP_BYTES) throw projectError("项目包超过 52 MiB");
    return new Uint8Array(input);
  }
  if (
    input === null ||
    typeof input !== "object" ||
    !Number.isSafeInteger(input.size) ||
    input.size < 0 ||
    input.size > MAX_PROJECT_ZIP_BYTES
  ) {
    throw projectError(
      input?.size && input.size > MAX_PROJECT_ZIP_BYTES ? "项目包超过 52 MiB" : "项目包输入无效",
    );
  }
  const buffer = await input.arrayBuffer();
  if (buffer.byteLength !== input.size) throw projectError("项目包读取长度不一致");
  return new Uint8Array(buffer);
}

export async function importProjectV2Zip(
  input: Uint8Array | ProjectV2ZipFileLike,
  options: { readonly registry: DocumentTemplateRegistry },
): Promise<ImportedProjectV2> {
  const zipBytes = await readZipInput(input);
  const report = preflightProjectZip(zipBytes);
  const entries = await streamStoreEntries(zipBytes, report);
  const manifestBytes = entries.get("manifest.json");
  const draftBytes = entries.get("draft.json");
  if (!manifestBytes || !draftBytes) throw projectError("项目包缺少 manifest 或 draft");
  const manifest = parseManifest(decodeJson(manifestBytes, "manifest.json"));
  let parsedProject: v2.OpenTradProject;
  try {
    parsedProject = v2.parseOpenTradProject(decoder.decode(draftBytes));
  } catch {
    throw projectError("draft.json 项目数据无效");
  }
  if (parsedProject.formatVersion !== "2.0.0") throw projectError("项目包必须使用 V2 格式");
  const portableEnvelope = v2.ProjectEnvelopeV2Schema.parse(parsedProject);
  if (
    !sameJson(manifest.template, portableEnvelope.template) ||
    !sameJson(manifest.presentation, portableEnvelope.presentation) ||
    !sameJson(manifest.attachmentManifest, portableEnvelope.attachmentManifest)
  ) {
    throw projectError("manifest 与 draft 描述不一致");
  }
  const attachmentFiles: ProjectV2AttachmentFile[] = manifest.files.map((file) => {
    if (file.path !== `attachments/${file.id}.${extension(file.mediaType)}`) {
      throw projectError("manifest 附件路径不一致");
    }
    const data = entries.get(file.path);
    if (!data || data.byteLength !== file.byteLength) {
      throw projectError("manifest 附件长度不一致");
    }
    validateAttachmentBytes(data, file.mediaType);
    return { id: file.id, mediaType: file.mediaType, pageCount: file.pageCount, bytes: data };
  });
  const expectedEntryPaths = [
    "manifest.json",
    "draft.json",
    ...manifest.files.map((file) => file.path),
  ];
  if (!sameJson([...entries.keys()], expectedEntryPaths)) {
    throw projectError("manifest 与 ZIP 条目不一致");
  }
  validateFilesAgainstEnvelope(portableEnvelope, attachmentFiles);
  const { model } = validateDocumentEnvelope(portableEnvelope, options.registry);
  const key = documentStorageKey(portableEnvelope);
  const envelope = v2.ProjectEnvelopeV2Schema.parse({
    ...portableEnvelope,
    attachmentManifest: portableEnvelope.attachmentManifest.map((attachment) =>
      attachment.status === "attached"
        ? { ...attachment, localBlobKey: `${key}#${attachment.id}` }
        : attachment,
    ),
  });
  return {
    envelope,
    portableEnvelope,
    model,
    attachments: attachmentFiles,
    requiresUserConfirmation: true,
  };
}
