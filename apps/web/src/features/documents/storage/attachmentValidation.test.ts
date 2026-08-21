import { Blob as NodeBlob } from "node:buffer";
import type { v2 } from "@opentrad/document-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_TOTAL_BYTES,
  MAX_BID_ATTACHMENT_PAGES,
  prepareAttachmentPut,
  validateAttachmentBytes,
  validateAttachmentInventory,
} from "./attachmentValidation";

const MiB = 1024 * 1024;

beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
});

function pdfBlob(size: number): Blob {
  if (size === 0) return new Blob([], { type: "application/pdf" });
  const header = new TextEncoder().encode("%PDF-");
  return new Blob([header.slice(0, size), new Uint8Array(Math.max(0, size - header.length))], {
    type: "application/pdf",
  });
}

function descriptor(id: string, overrides: Partial<v2.AttachmentRefV1> = {}): v2.AttachmentRefV1 {
  return {
    id,
    category: "technical",
    displayName: `${id}.pdf`,
    mediaType: "application/pdf",
    pageCount: 1,
    required: false,
    status: "attached",
    includedInSubmission: true,
    localBlobKey: `bid.government.goods.v1@1.0.0:bid-1#${id}`,
    ...overrides,
  };
}

describe("attachment validation", () => {
  it.each([
    ["PDF", new TextEncoder().encode("%PDF-1.7\n%%EOF"), "application/pdf"],
    ["PNG", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]), "image/png"],
    ["JPEG", new Uint8Array([0xff, 0xd8, 0, 0xff, 0xd9]), "image/jpeg"],
  ] as const)("accepts a real %s signature", (_label, bytes, mediaType) => {
    expect(() => validateAttachmentBytes(bytes, mediaType)).not.toThrow();
  });

  it.each([
    [new Uint8Array(), "application/pdf"],
    [new TextEncoder().encode("<script>"), "application/pdf"],
    [new TextEncoder().encode("%PDF-1.7"), "image/png"],
    [new Uint8Array([0x4d, 0x5a]), "image/jpeg"],
    [new TextEncoder().encode("<svg/>"), "image/svg+xml"],
  ] as const)(
    "rejects empty, mismatched, executable, and unknown attachment bytes",
    (bytes, mediaType) => {
      expect(() => validateAttachmentBytes(bytes, mediaType as never)).toThrow(
        "附件内容与类型不一致",
      );
    },
  );

  it("enforces the inclusive single-file byte boundary before storage", async () => {
    const documentKey = "quotation.service.project.v1@1.0.0:quote-1";
    const base = descriptor("spec", {
      localBlobKey: `${documentKey}#spec`,
      pageCount: 1,
    });

    await expect(
      prepareAttachmentPut({
        documentKey,
        descriptor: base,
        blob: pdfBlob(1),
        pageCountConfirmed: true,
        savedAt: "2026-08-20T08:00:00.000Z",
      }),
    ).rejects.toThrow("附件内容与类型不一致");
    await expect(
      prepareAttachmentPut({
        documentKey,
        descriptor: base,
        blob: pdfBlob(25 * MiB),
        pageCountConfirmed: true,
        savedAt: "2026-08-20T08:00:00.000Z",
      }),
    ).resolves.toMatchObject({ byteLength: MAX_ATTACHMENT_BYTES });
    await expect(
      prepareAttachmentPut({
        documentKey,
        descriptor: base,
        blob: pdfBlob(25 * MiB + 1),
        pageCountConfirmed: true,
        savedAt: "2026-08-20T08:00:00.000Z",
      }),
    ).rejects.toThrow("单个附件超过 25 MiB");
    await expect(
      prepareAttachmentPut({
        documentKey,
        descriptor: base,
        blob: pdfBlob(0),
        pageCountConfirmed: true,
        savedAt: "2026-08-20T08:00:00.000Z",
      }),
    ).rejects.toThrow("附件不能为空");
  });

  it("requires confirmed PDF pages and caps only included bid pages at 80", async () => {
    const documentKey = "bid.government.goods.v1@1.0.0:bid-1";
    await expect(
      prepareAttachmentPut({
        documentKey,
        descriptor: descriptor("pdf", { pageCount: 80 }),
        blob: pdfBlob(10),
        pageCountConfirmed: false,
        savedAt: "2026-08-20T08:00:00.000Z",
      }),
    ).rejects.toThrow("请确认 PDF 页数");

    const image = descriptor("image", {
      mediaType: "image/png",
      pageCount: 2,
      localBlobKey: `${documentKey}#image`,
    });
    await expect(
      prepareAttachmentPut({
        documentKey,
        descriptor: image,
        blob: new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
          type: "image/png",
        }),
        savedAt: "2026-08-20T08:00:00.000Z",
      }),
    ).rejects.toThrow("图片附件页数必须为 1");

    const record80 = await prepareAttachmentPut({
      documentKey,
      descriptor: descriptor("pages", { pageCount: 80 }),
      blob: pdfBlob(10),
      pageCountConfirmed: true,
      savedAt: "2026-08-20T08:00:00.000Z",
    });
    await expect(
      validateAttachmentInventory({
        documentKey,
        documentKind: "bid",
        descriptors: [descriptor("pages", { pageCount: 80 })],
        records: [record80],
      }),
    ).resolves.toBeUndefined();
    await expect(
      validateAttachmentInventory({
        documentKey,
        documentKind: "bid",
        descriptors: [descriptor("pages", { pageCount: 81, includedInSubmission: true })],
        records: [{ ...record80, pageCount: 81 }],
      }),
    ).rejects.toThrow("投标附件页数超过 80 页");
    await expect(
      validateAttachmentInventory({
        documentKey,
        documentKind: "bid",
        descriptors: [descriptor("pages", { pageCount: 110, includedInSubmission: false })],
        records: [{ ...record80, pageCount: 110 }],
      }),
    ).resolves.toBeUndefined();
    expect(MAX_BID_ATTACHMENT_PAGES).toBe(80);
  });

  it("enforces count and aggregate boundaries and exact descriptor/blob references", async () => {
    const documentKey = "bid.government.goods.v1@1.0.0:bid-1";
    const make = (id: string, size: number) => ({
      localBlobKey: `${documentKey}#${id}`,
      documentKey,
      attachmentId: id,
      mediaType: "application/pdf" as const,
      byteLength: size,
      pageCount: 1,
      pageCountConfirmed: true,
      blob: pdfBlob(size),
      savedAt: "2026-08-20T08:00:00.000Z",
    });
    const hundred = Array.from({ length: MAX_ATTACHMENT_COUNT }, (_, index) =>
      descriptor(`a-${index}`),
    );
    await expect(
      validateAttachmentInventory({
        documentKey,
        documentKind: "quotation",
        descriptors: hundred,
        records: hundred.map((entry) => make(entry.id, 5)),
      }),
    ).resolves.toBeUndefined();
    await expect(
      validateAttachmentInventory({
        documentKey,
        documentKind: "quotation",
        descriptors: [...hundred, descriptor("a-100")],
        records: [...hundred.map((entry) => make(entry.id, 5)), make("a-100", 5)],
      }),
    ).rejects.toThrow("附件数量超过 100 个");

    const first = descriptor("first", { pageCount: 1 });
    const second = descriptor("second", { pageCount: 1 });
    await expect(
      validateAttachmentInventory({
        documentKey,
        documentKind: "quotation",
        descriptors: [first, second],
        records: [make("first", 25 * MiB), make("second", 25 * MiB)],
      }),
    ).resolves.toBeUndefined();
    const third = descriptor("third", { pageCount: 1 });
    await expect(
      validateAttachmentInventory({
        documentKey,
        documentKind: "quotation",
        descriptors: [first, second, third],
        records: [make("first", 25 * MiB), make("second", 25 * MiB - 4), make("third", 5)],
      }),
    ).rejects.toThrow("附件总大小超过 50 MiB");
    expect(MAX_ATTACHMENT_TOTAL_BYTES).toBe(50 * MiB);

    await expect(
      validateAttachmentInventory({
        documentKey,
        documentKind: "quotation",
        descriptors: [
          descriptor("missing", {
            status: "missing",
            localBlobKey: undefined,
            includedInSubmission: false,
          }),
        ],
        records: [make("missing", 1)],
      }),
    ).rejects.toThrow("未附加的附件不得保存 Blob");
    await expect(
      validateAttachmentInventory({
        documentKey,
        documentKind: "quotation",
        descriptors: [descriptor("wrong", { localBlobKey: "wrong-key" })],
        records: [make("wrong", 1)],
      }),
    ).rejects.toThrow("附件本地引用不一致");
  });
});
