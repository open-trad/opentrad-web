import type { v2 } from "@opentrad/document-core";

export const MAX_ATTACHMENT_COUNT = 100;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024;
export const MAX_BID_ATTACHMENT_PAGES = 80;

export type AttachmentMediaType = "application/pdf" | "image/png" | "image/jpeg";

export interface StoredAttachmentV2 {
  readonly localBlobKey: string;
  readonly documentKey: string;
  readonly attachmentId: string;
  readonly mediaType: AttachmentMediaType;
  readonly byteLength: number;
  readonly pageCount: number;
  readonly pageCountConfirmed: boolean;
  readonly blob: Blob;
  readonly savedAt: string;
}

function attachmentError(message: string): Error {
  return new Error(message);
}

function isIsoDateTime(value: string): boolean {
  return (
    value.length <= 35 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function expectedLocalBlobKey(documentKey: string, attachmentId: string): string {
  return `${documentKey}#${attachmentId}`;
}

async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("附件读取失败"));
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error("附件读取失败"));
        return;
      }
      resolve(new Uint8Array(reader.result));
    };
    reader.readAsArrayBuffer(blob);
  });
}

export function validateAttachmentBytes(bytes: Uint8Array, mediaType: AttachmentMediaType): void {
  const isPdf =
    mediaType === "application/pdf" &&
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d;
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10] as const;
  const isPng =
    mediaType === "image/png" &&
    bytes.length >= pngSignature.length &&
    pngSignature.every((value, index) => bytes[index] === value);
  const isJpeg =
    mediaType === "image/jpeg" &&
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes.at(-2) === 0xff &&
    bytes.at(-1) === 0xd9;
  if (!isPdf && !isPng && !isJpeg) {
    throw attachmentError("附件内容与类型不一致");
  }
}

function assertDescriptorPagePolicy(
  descriptor: v2.AttachmentRefV1,
  pageCountConfirmed: boolean,
): number {
  if (descriptor.mediaType === "application/pdf") {
    if (descriptor.pageCount === undefined || !pageCountConfirmed) {
      throw attachmentError("请确认 PDF 页数；OpenTrad 不会自动解析页数");
    }
    return descriptor.pageCount;
  }
  if (descriptor.pageCount !== 1) {
    throw attachmentError("图片附件页数必须为 1");
  }
  return 1;
}

export async function prepareAttachmentPut(input: {
  readonly documentKey: string;
  readonly descriptor: v2.AttachmentRefV1;
  readonly blob: Blob;
  readonly pageCountConfirmed?: boolean;
  readonly savedAt: string;
}): Promise<StoredAttachmentV2> {
  const { descriptor } = input;
  if (descriptor.status !== "attached") {
    throw attachmentError("只有已附加状态可以保存 Blob");
  }
  const localBlobKey = expectedLocalBlobKey(input.documentKey, descriptor.id);
  if (descriptor.localBlobKey !== localBlobKey) {
    throw attachmentError("附件本地引用不一致");
  }
  if (input.blob.size === 0) throw attachmentError("附件不能为空");
  if (!Number.isSafeInteger(input.blob.size) || input.blob.size > MAX_ATTACHMENT_BYTES) {
    throw attachmentError("单个附件超过 25 MiB");
  }
  if (input.blob.type && input.blob.type !== descriptor.mediaType) {
    throw attachmentError("附件内容与类型不一致");
  }
  if (!isIsoDateTime(input.savedAt)) throw attachmentError("附件保存时间无效");
  const pageCount = assertDescriptorPagePolicy(
    descriptor,
    input.pageCountConfirmed === true || descriptor.mediaType !== "application/pdf",
  );
  const bytes = await readBlobBytes(input.blob);
  if (bytes.byteLength !== input.blob.size) throw attachmentError("附件字节长度不一致");
  validateAttachmentBytes(bytes, descriptor.mediaType);
  return {
    localBlobKey,
    documentKey: input.documentKey,
    attachmentId: descriptor.id,
    mediaType: descriptor.mediaType,
    byteLength: bytes.byteLength,
    pageCount,
    pageCountConfirmed: true,
    blob: input.blob,
    savedAt: input.savedAt,
  };
}

function validateRecordShape(record: StoredAttachmentV2): void {
  if (
    typeof record.localBlobKey !== "string" ||
    typeof record.documentKey !== "string" ||
    typeof record.attachmentId !== "string" ||
    !["application/pdf", "image/png", "image/jpeg"].includes(record.mediaType) ||
    !Number.isSafeInteger(record.byteLength) ||
    record.byteLength < 1 ||
    !Number.isSafeInteger(record.pageCount) ||
    record.pageCount < 1 ||
    record.pageCountConfirmed !== true ||
    !(record.blob instanceof Blob) ||
    !isIsoDateTime(record.savedAt)
  ) {
    throw attachmentError("附件记录已损坏");
  }
}

export async function validateAttachmentInventory(input: {
  readonly documentKey: string;
  readonly documentKind: "quotation" | "contract" | "bid";
  readonly descriptors: readonly v2.AttachmentRefV1[];
  readonly records: readonly StoredAttachmentV2[];
}): Promise<void> {
  if (input.descriptors.length > MAX_ATTACHMENT_COUNT) {
    throw attachmentError("附件数量超过 100 个");
  }
  const descriptors = new Map<string, v2.AttachmentRefV1>();
  for (const descriptor of input.descriptors) {
    if (descriptors.has(descriptor.id)) throw attachmentError("附件标识重复");
    descriptors.set(descriptor.id, descriptor);
    const expectedKey = expectedLocalBlobKey(input.documentKey, descriptor.id);
    if (descriptor.status === "attached") {
      if (descriptor.localBlobKey !== expectedKey) throw attachmentError("附件本地引用不一致");
    } else {
      if (descriptor.localBlobKey !== undefined) throw attachmentError("附件本地引用不一致");
      if (descriptor.includedInSubmission) throw attachmentError("未附加附件不得纳入提交");
    }
  }

  const records = new Map<string, StoredAttachmentV2>();
  let totalBytes = 0;
  let totalPages = 0;
  for (const record of input.records) {
    validateRecordShape(record);
    if (records.has(record.attachmentId)) throw attachmentError("附件 Blob 标识重复");
    records.set(record.attachmentId, record);
    const descriptor = descriptors.get(record.attachmentId);
    if (!descriptor || descriptor.status !== "attached") {
      throw attachmentError("未附加的附件不得保存 Blob");
    }
    if (
      record.documentKey !== input.documentKey ||
      record.localBlobKey !== expectedLocalBlobKey(input.documentKey, record.attachmentId)
    ) {
      throw attachmentError("附件本地引用不一致");
    }
    if (
      record.mediaType !== descriptor.mediaType ||
      record.pageCount !== descriptor.pageCount ||
      record.byteLength !== record.blob.size
    ) {
      throw attachmentError("附件描述与 Blob 不一致");
    }
    if (record.byteLength > MAX_ATTACHMENT_BYTES) throw attachmentError("单个附件超过 25 MiB");
    if (descriptor.mediaType !== "application/pdf" && record.pageCount !== 1) {
      throw attachmentError("图片附件页数必须为 1");
    }
    const bytes = await readBlobBytes(record.blob);
    if (bytes.byteLength !== record.byteLength) throw attachmentError("附件字节长度不一致");
    validateAttachmentBytes(bytes, record.mediaType);
    totalBytes += record.byteLength;
    totalPages += record.pageCount;
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
      throw attachmentError("附件总大小超过 50 MiB");
    }
  }
  for (const descriptor of input.descriptors) {
    if (descriptor.status === "attached" && !records.has(descriptor.id)) {
      throw attachmentError("已附加附件缺少 Blob");
    }
  }
  if (input.documentKind === "bid" && totalPages > MAX_BID_ATTACHMENT_PAGES) {
    throw attachmentError("投标附件页数超过 80 页");
  }
}
