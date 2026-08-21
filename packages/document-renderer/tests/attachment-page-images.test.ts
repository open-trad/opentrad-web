import { Buffer } from "node:buffer";
import { inflateRawSync } from "node:zlib";
import { type DocumentModelV2, DocumentModelV2Schema } from "@opentrad/document-core";
import { describe, expect, it, vi } from "vitest";
import {
  AttachmentPageImagesValidationError,
  MAX_ATTACHMENT_IMAGE_BYTES,
  MAX_ATTACHMENT_IMAGES_TOTAL_BYTES,
  validateAttachmentPageImages,
} from "../src/attachmentPageImages";
import { buildDocxPlanV2 } from "../src/docx/buildDocxPlan";
import { renderDocxV2 } from "../src/docx/renderDocxV2";

const REAL_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAEAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD2vwP4V0658FeH53XDS6fbuf3UTcmNT1KEn6kk0UUV01Mny+Um3Qg2/wC7H/I+BxdSf1ipr1f5n//Z";
const VALID_JPEG = Uint8Array.from(Buffer.from(REAL_JPEG_BASE64, "base64"));
const LEGACY_FAKE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x4f, 0x54, 0xff, 0xd9]);

function createAttachmentModel(pageCounts: readonly number[] = [1]): DocumentModelV2 {
  const attachmentManifest = pageCounts.map((pageCount, index) => ({
    id: `attachment-${index + 1}`,
    category: "other" as const,
    displayName: `附件${index + 1}.pdf`,
    mediaType: "application/pdf" as const,
    pageCount,
    required: false,
    status: "attached" as const,
    includedInSubmission: true,
  }));
  return DocumentModelV2Schema.parse({
    schemaVersion: "2.0.0",
    documentId: "renderer-attachment-fixture",
    template: {
      id: "bid.government.goods.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
    },
    documentKind: "bid",
    language: "zh-CN",
    title: { zhCN: "附件渲染测试", enUS: "Attachment rendering test" },
    pageDefaults: {
      size: "A4",
      orientation: "portrait",
      marginsMm: { top: 18, right: 16, bottom: 18, left: 16 },
    },
    sections: [
      {
        id: "editable-bid-body",
        blocks: [
          {
            type: "paragraph",
            id: "editable-body-end",
            text: { zhCN: "可编辑正文末尾", enUS: "End of editable body" },
          },
          {
            type: "attachmentIndex",
            id: "submission-attachment-index",
            attachmentIds: attachmentManifest.map((attachment) => attachment.id),
          },
        ],
      },
    ],
    watermarks: [],
    disclaimers: [],
    attachmentManifest,
  });
}

function createAttachmentPagePlaceholderModel(
  pageCounts: readonly number[] = [1],
): DocumentModelV2 {
  const model = createAttachmentModel(pageCounts);
  return DocumentModelV2Schema.parse({
    ...model,
    sections: [
      ...model.sections,
      {
        id: "attachment-pages",
        blocks: model.attachmentManifest.flatMap((attachment) =>
          Array.from({ length: attachment.pageCount ?? 0 }, (_, pageIndex) => ({
            type: "attachmentPage" as const,
            id: `${attachment.id}-page-${pageIndex + 1}`,
            attachmentId: attachment.id,
            pageNumber: pageIndex + 1,
          })),
        ),
      },
    ],
  });
}

function withAttachmentManifest(
  model: DocumentModelV2,
  attachmentManifest: DocumentModelV2["attachmentManifest"],
): DocumentModelV2 {
  return DocumentModelV2Schema.parse({ ...model, attachmentManifest });
}

function validImage(
  bytes: Uint8Array = VALID_JPEG.slice(),
  attachmentId = "attachment-1",
  pageNumber = 1,
  widthPixels = 2,
  heightPixels = 4,
) {
  return {
    attachmentId,
    pageNumber,
    bytes,
    widthPixels,
    heightPixels,
  };
}

function jpegWithSize(byteLength: number): Uint8Array {
  if (byteLength < VALID_JPEG.length) throw new Error("JPEG target size is too small");
  let remaining = byteLength - VALID_JPEG.length;
  const segments: Uint8Array[] = [];
  while (remaining > 0) {
    let segmentLength = Math.min(65_537, remaining);
    const following = remaining - segmentLength;
    if (following > 0 && following < 4) segmentLength -= 4 - following;
    if (segmentLength < 4) throw new Error("JPEG padding cannot encode the requested size");
    const segment = new Uint8Array(segmentLength);
    const declaredLength = segmentLength - 2;
    segment.set([0xff, 0xfe, declaredLength >> 8, declaredLength & 0xff]);
    segments.push(segment);
    remaining -= segmentLength;
  }
  const output = new Uint8Array(byteLength);
  output.set(VALID_JPEG.subarray(0, 2), 0);
  let offset = 2;
  for (const segment of segments) {
    output.set(segment, offset);
    offset += segment.length;
  }
  output.set(VALID_JPEG.subarray(2), offset);
  return output;
}

function sofOffset(bytes: Uint8Array): number {
  for (let index = 2; index < bytes.length - 1; index += 1) {
    if (bytes[index] === 0xff && (bytes[index + 1] === 0xc0 || bytes[index + 1] === 0xc2)) {
      return index;
    }
  }
  throw new Error("Real JPEG fixture has no supported SOF marker");
}

function withSofDimensions(bytes: Uint8Array, width: number, height: number): Uint8Array {
  const output = bytes.slice();
  const offset = sofOffset(output);
  output[offset + 5] = height >> 8;
  output[offset + 6] = height & 0xff;
  output[offset + 7] = width >> 8;
  output[offset + 8] = width & 0xff;
  return output;
}

function withDuplicateSof(bytes: Uint8Array): Uint8Array {
  const offset = sofOffset(bytes);
  const declaredLength = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
  const segmentEnd = offset + 2 + declaredLength;
  const segment = bytes.slice(offset, segmentEnd);
  const output = new Uint8Array(bytes.length + segment.length);
  output.set(bytes.subarray(0, segmentEnd), 0);
  output.set(segment, segmentEnd);
  output.set(bytes.subarray(segmentEnd), segmentEnd + segment.length);
  return output;
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

async function unzipDocx(blob: Blob): Promise<ReadonlyMap<string, Uint8Array>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOfCentralDirectory = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index -= 1) {
    if (readUint32(view, index) === 0x06054b50) {
      endOfCentralDirectory = index;
      break;
    }
  }
  if (endOfCentralDirectory < 0) throw new Error("DOCX ZIP central directory is missing");

  const entryCount = view.getUint16(endOfCentralDirectory + 10, true);
  let centralOffset = readUint32(view, endOfCentralDirectory + 16);
  const decoder = new TextDecoder();
  const entries = new Map<string, Uint8Array>();
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (readUint32(view, centralOffset) !== 0x02014b50) {
      throw new Error("DOCX ZIP central entry is invalid");
    }
    const compression = view.getUint16(centralOffset + 10, true);
    const compressedSize = readUint32(view, centralOffset + 20);
    const nameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = readUint32(view, centralOffset + 42);
    const name = decoder.decode(
      bytes.subarray(centralOffset + 46, centralOffset + 46 + nameLength),
    );
    if (readUint32(view, localOffset) !== 0x04034b50) {
      throw new Error("DOCX ZIP local entry is invalid");
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    const content =
      compression === 0
        ? compressed.slice()
        : compression === 8
          ? new Uint8Array(inflateRawSync(compressed))
          : (() => {
              throw new Error("DOCX ZIP compression method is unsupported");
            })();
    entries.set(name, content);
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function textEntry(entries: ReadonlyMap<string, Uint8Array>, name: string): string {
  const bytes = entries.get(name);
  if (!bytes) throw new Error(`${name} is missing`);
  return new TextDecoder().decode(bytes);
}

describe("trusted attachment page image seam", () => {
  it("embeds a supplied local JPEG for a schema-valid bid model without attachmentPage blocks", async () => {
    const model = createAttachmentModel();
    const plan = buildDocxPlanV2(model, "classic-formal.v1", "zh-CN");
    const modelBefore = JSON.stringify(model);
    const planBefore = JSON.stringify(plan);
    const jpeg = VALID_JPEG.slice();
    const attachmentPageImages = [
      {
        attachmentId: "attachment-1",
        pageNumber: 1,
        bytes: jpeg,
        widthPixels: 2,
        heightPixels: 4,
      },
    ];
    expect(validateAttachmentPageImages(plan, { attachmentPageImages })).toHaveLength(1);
    const blob = await renderDocxV2(model, "classic-formal.v1", "zh-CN", {
      attachmentPageImages,
    });
    const entries = await unzipDocx(blob);
    const documentXml = textEntry(entries, "word/document.xml");
    const media = Array.from(entries).find(([name]) => /^word\/media\/.*\.jpg$/u.test(name));

    expect(model.sections.flatMap((section) => section.blocks)).not.toContainEqual(
      expect.objectContaining({ type: "attachmentPage" }),
    );
    expect(plan.blockKinds).not.toContain("attachmentPage");
    expect(documentXml).not.toContain("本地附件占位符");
    expect(documentXml).toMatch(/<a:blip\b[^>]*r:embed=/u);
    expect(media?.[1]).toEqual(jpeg);
    expect(JSON.stringify(model)).toBe(modelBefore);
    expect(JSON.stringify(plan)).toBe(planBefore);
  });

  it("rejects a provider when the validated model already contains attachmentPage blocks", async () => {
    await expect(
      renderDocxV2(createAttachmentPagePlaceholderModel(), "classic-formal.v1", "zh-CN", {
        attachmentPageImages: [validImage()],
      }),
    ).rejects.toThrow(AttachmentPageImagesValidationError);
  });

  it("preserves the legacy attachmentPage placeholder when the provider is omitted", async () => {
    const blob = await renderDocxV2(
      createAttachmentPagePlaceholderModel(),
      "classic-formal.v1",
      "zh-CN",
    );
    const entries = await unzipDocx(blob);
    const documentXml = textEntry(entries, "word/document.xml");

    expect(documentXml).toContain("本地附件占位符");
    expect(Array.from(entries).some(([name]) => /^word\/media\/.*\.jpg$/u.test(name))).toBe(false);
  });

  it("does not require a provider merely because an included attachment is in the manifest", async () => {
    const model = createAttachmentModel();
    const blob = await renderDocxV2(model, "classic-formal.v1", "zh-CN");
    const documentXml = textEntry(await unzipDocx(blob), "word/document.xml");

    expect(documentXml).toContain("附件1.pdf");
    expect(documentXml).not.toContain("本地附件占位符");
  });

  it("accepts only an empty provider when no manifest attachment is included", async () => {
    const source = createAttachmentModel();
    const model = withAttachmentManifest(
      source,
      source.attachmentManifest.map((attachment) => ({
        ...attachment,
        status: "missing" as const,
        includedInSubmission: false,
      })),
    );

    await expect(
      renderDocxV2(model, "classic-formal.v1", "zh-CN", { attachmentPageImages: [] }),
    ).resolves.toBeInstanceOf(Blob);
    await expect(
      renderDocxV2(model, "classic-formal.v1", "zh-CN", {
        attachmentPageImages: [validImage()],
      }),
    ).rejects.toThrow(AttachmentPageImagesValidationError);
  });

  it("appends ordered attachment pages after the editable body with a bilingual caveat and page breaks", async () => {
    const model = createAttachmentModel([2, 1]);
    const images = [
      validImage(VALID_JPEG.slice(), "attachment-1", 1),
      validImage(VALID_JPEG.slice(), "attachment-1", 2),
      validImage(VALID_JPEG.slice(), "attachment-2", 1),
    ];
    const blob = await renderDocxV2(model, "classic-formal.v1", "zh-en", {
      attachmentPageImages: images,
    });
    const documentXml = textEntry(await unzipDocx(blob), "word/document.xml");
    const orderedText = [
      "可编辑正文末尾",
      "附件1.pdf · 第 1 页 / Page 1",
      "附件1.pdf · 第 2 页 / Page 2",
      "附件2.pdf · 第 1 页 / Page 1",
    ];
    const positions = orderedText.map((text) => documentXml.indexOf(text));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(documentXml).toContain("附件按页面图像嵌入，正文可编辑不表示附件可编辑或已重新识别");
    expect(documentXml).toContain(
      "Attachments are embedded as page images. An editable body does not mean attachments are editable or have been re-recognized.",
    );
    expect(documentXml.match(/<w:br\b[^>]*w:type="page"[^>]*\/>/gu)).toHaveLength(3);
    expect(documentXml.match(/<a:blip\b[^>]*r:embed=/gu)).toHaveLength(3);
  });

  it("copies trusted JPEG bytes before the asynchronous DOCX engine runs", async () => {
    const jpeg = VALID_JPEG.slice();
    const expected = jpeg.slice();
    const pending = renderDocxV2(createAttachmentModel(), "classic-formal.v1", "zh-CN", {
      attachmentPageImages: [validImage(jpeg)],
    });
    jpeg.fill(0);
    const entries = await unzipDocx(await pending);
    const media = Array.from(entries).find(([name]) => /^word\/media\/.*\.jpg$/u.test(name));

    expect(media?.[1]).toEqual(expected);
  });

  it.each([
    ["non-JPEG bytes", { ...validImage(), bytes: new Uint8Array([1, 2, 3, 4]) }],
    ["zero width", { ...validImage(), widthPixels: 0 }],
    ["non-finite height", { ...validImage(), heightPixels: Number.POSITIVE_INFINITY }],
    ["excessive pixels", { ...validImage(), widthPixels: 20_000, heightPixels: 20_000 }],
    ["extra URI field", { ...validImage(), url: "https://invalid.example/attachment.jpg" }],
    ["extra path field", { ...validImage(), path: "/tmp/attachment.jpg" }],
    ["local blob key field", { ...validImage(), localBlobKey: "attachment:page:1" }],
    ["function field", { ...validImage(), load: () => VALID_JPEG }],
  ])("rejects %s with one finite validation error", async (_label, image) => {
    await expect(
      renderDocxV2(createAttachmentModel(), "classic-formal.v1", "zh-CN", {
        attachmentPageImages: [image],
      }),
    ).rejects.toThrow("附件页图像输入无效");
  });

  it("rejects sparse, duplicate, missing, and oversized page arrays", async () => {
    const sparse = new Array(1) as ReturnType<typeof validImage>[];
    const duplicate = [validImage(), validImage()];
    const oversized = Array.from({ length: 81 }, () => validImage());

    for (const attachmentPageImages of [sparse, duplicate, [], oversized]) {
      await expect(
        renderDocxV2(createAttachmentModel(), "classic-formal.v1", "zh-CN", {
          attachmentPageImages,
        }),
      ).rejects.toThrow("附件页图像输入无效");
    }
  });

  it("requires exact included-manifest page order and rejects extras", async () => {
    const model = createAttachmentModel([2, 1]);
    const images = [
      validImage(),
      { ...validImage(), pageNumber: 2 },
      { ...validImage(), attachmentId: "attachment-2" },
    ];
    const [firstImage, secondImage, thirdImage] = images;
    if (!firstImage || !secondImage || !thirdImage) throw new Error("Expected image fixtures");

    await expect(
      renderDocxV2(model, "classic-formal.v1", "zh-CN", {
        attachmentPageImages: [thirdImage, firstImage, secondImage],
      }),
    ).rejects.toThrow("附件页图像输入无效");
    await expect(
      renderDocxV2(model, "classic-formal.v1", "zh-CN", {
        attachmentPageImages: [...images, { ...validImage(), attachmentId: "attachment-extra" }],
      }),
    ).rejects.toThrow("附件页图像输入无效");
  });

  it("rejects included attachments with unavailable status or invalid pageCount", async () => {
    const source = createAttachmentModel();
    const unavailable = withAttachmentManifest(
      source,
      source.attachmentManifest.map((attachment) => ({
        ...attachment,
        status: "missing" as const,
      })),
    );
    const missingPageCount = withAttachmentManifest(
      source,
      source.attachmentManifest.map(({ pageCount: _pageCount, ...attachment }) => attachment),
    );
    const excessivePageCount = withAttachmentManifest(
      source,
      source.attachmentManifest.map((attachment) => ({ ...attachment, pageCount: 81 })),
    );

    for (const model of [unavailable, missingPageCount, excessivePageCount]) {
      await expect(
        renderDocxV2(model, "classic-formal.v1", "zh-CN", {
          attachmentPageImages: [],
        }),
      ).rejects.toThrow(AttachmentPageImagesValidationError);
    }
  });

  it("enforces an exact 50 MiB aggregate business limit", () => {
    const exactPlan = buildDocxPlanV2(createAttachmentModel([2]));
    const exactLimit = [
      validImage(jpegWithSize(MAX_ATTACHMENT_IMAGE_BYTES), "attachment-1", 1),
      validImage(jpegWithSize(MAX_ATTACHMENT_IMAGE_BYTES), "attachment-1", 2),
    ];
    expect(MAX_ATTACHMENT_IMAGES_TOTAL_BYTES).toBe(50 * 1024 * 1024);
    expect(
      validateAttachmentPageImages(exactPlan, { attachmentPageImages: exactLimit }),
    ).toHaveLength(2);

    const overPlan = buildDocxPlanV2(createAttachmentModel([3]));
    const overLimit = [...exactLimit, validImage(new Uint8Array([0xff]), "attachment-1", 3)];
    expect(() =>
      validateAttachmentPageImages(overPlan, { attachmentPageImages: overLimit }),
    ).toThrow("附件页图像输入无效");
  });

  it("uses intrinsic typed-array slots without invoking shadows and rejects shared backing", () => {
    const plan = buildDocxPlanV2(createAttachmentModel());
    let getterReads = 0;
    const shared = new Uint8Array(new SharedArrayBuffer(VALID_JPEG.length));
    shared.set(VALID_JPEG);
    Object.defineProperty(shared, "buffer", {
      configurable: true,
      get() {
        getterReads += 1;
        return new ArrayBuffer(VALID_JPEG.length);
      },
    });
    const shadowLength = VALID_JPEG.slice();
    Object.defineProperty(shadowLength, "byteLength", {
      configurable: true,
      get() {
        getterReads += 1;
        return VALID_JPEG.length;
      },
    });

    for (const bytes of [shared, shadowLength]) {
      expect(() =>
        validateAttachmentPageImages(plan, { attachmentPageImages: [validImage(bytes)] }),
      ).toThrow(AttachmentPageImagesValidationError);
    }
    expect(getterReads).toBe(0);
  });

  it("rejects detached and resizable buffers with the fixed validation error", () => {
    const plan = buildDocxPlanV2(createAttachmentModel());
    const detached = VALID_JPEG.slice();
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(() =>
      validateAttachmentPageImages(plan, { attachmentPageImages: [validImage(detached)] }),
    ).toThrow(AttachmentPageImagesValidationError);

    if ("resizable" in ArrayBuffer.prototype) {
      const ResizableArrayBuffer = ArrayBuffer as typeof ArrayBuffer & {
        new (length: number, options: { readonly maxByteLength: number }): ArrayBuffer;
      };
      const buffer = new ResizableArrayBuffer(VALID_JPEG.length, {
        maxByteLength: VALID_JPEG.length * 2,
      });
      const bytes = new Uint8Array(buffer);
      bytes.set(VALID_JPEG);
      expect(() =>
        validateAttachmentPageImages(plan, { attachmentPageImages: [validImage(bytes)] }),
      ).toThrow(AttachmentPageImagesValidationError);
    }
  });

  it("uses captured Uint8Array construction and set after prototype poisoning", () => {
    const plan = buildDocxPlanV2(createAttachmentModel());
    const container = new Uint8Array(VALID_JPEG.length + 8);
    container.set(VALID_JPEG, 4);
    const slice = new Uint8Array(container.buffer, 4, VALID_JPEG.length);
    const originalSet = Uint8Array.prototype.set;
    Object.defineProperty(Uint8Array.prototype, "set", {
      configurable: true,
      value() {
        throw new Error("SECRET_POISONED_SET");
      },
      writable: true,
    });
    try {
      const validated = validateAttachmentPageImages(plan, {
        attachmentPageImages: [validImage(slice)],
      });
      expect(validated.get("attachment-1:1")?.bytes).toEqual(VALID_JPEG);
    } finally {
      Object.defineProperty(Uint8Array.prototype, "set", {
        configurable: true,
        value: originalSet,
        writable: true,
      });
    }
  });

  it.each([
    ["legacy fake header", LEGACY_FAKE_JPEG],
    ["declared dimension mismatch", VALID_JPEG, 3, 4],
    [
      "invalid segment length",
      (() => {
        const bytes = VALID_JPEG.slice();
        bytes[4] = 0;
        bytes[5] = 1;
        return bytes;
      })(),
    ],
    [
      "truncated segment",
      (() => {
        const bytes = VALID_JPEG.slice();
        bytes[4] = 0xff;
        bytes[5] = 0xff;
        return bytes;
      })(),
    ],
    ["multiple SOF markers", withDuplicateSof(VALID_JPEG)],
  ])("rejects malformed JPEG structure: %s", (_label, bytes, width = 2, height = 4) => {
    const plan = buildDocxPlanV2(createAttachmentModel());
    expect(() =>
      validateAttachmentPageImages(plan, {
        attachmentPageImages: [validImage(bytes, "attachment-1", 1, width, height)],
      }),
    ).toThrow(AttachmentPageImagesValidationError);
  });

  it("fits a tall real-JPEG header within both A4 content dimensions", async () => {
    const tallJpeg = withSofDimensions(VALID_JPEG, 2, 2_000);
    const model = createAttachmentModel();
    const blob = await renderDocxV2(model, "classic-formal.v1", "zh-CN", {
      attachmentPageImages: [validImage(tallJpeg, "attachment-1", 1, 2, 2_000)],
    });
    const xml = textEntry(await unzipDocx(blob), "word/document.xml");
    const extent = /<wp:extent\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/u.exec(xml);
    if (!extent?.[1] || !extent[2]) throw new Error("DOCX image extent is missing");
    const widthEmu = Number(extent[1]);
    const heightEmu = Number(extent[2]);
    const availableWidthEmu = (11_906 - 907 - 907) * 635;
    const availableHeightEmu = (16_838 - 1_020 - 1_020) * 635;

    expect(widthEmu).toBeGreaterThan(0);
    expect(heightEmu).toBeGreaterThan(0);
    expect(widthEmu).toBeLessThanOrEqual(availableWidthEmu);
    expect(heightEmu).toBeLessThan(availableHeightEmu);
  });

  it("rejects transparent Proxy wrappers for options, arrays, and image records", () => {
    const plan = buildDocxPlanV2(createAttachmentModel());
    const image = validImage();
    const array = [image];
    const candidates = [
      new Proxy({ attachmentPageImages: array }, {}),
      { attachmentPageImages: new Proxy(array, {}) },
      { attachmentPageImages: [new Proxy(image, {})] },
    ];

    for (const options of candidates) {
      expect(() => validateAttachmentPageImages(plan, options)).toThrow(
        AttachmentPageImagesValidationError,
      );
    }
  });

  it("normalizes malicious trap throws without inspecting the attacker value", () => {
    const plan = buildDocxPlanV2(createAttachmentModel());
    const attackerThrow = new Proxy(Object.create(null) as object, {
      get() {
        throw new Error("SECRET_ATTACKER_GET");
      },
      getPrototypeOf() {
        throw new Error("SECRET_ATTACKER_PROTOTYPE");
      },
    });
    const options = new Proxy(
      { attachmentPageImages: [validImage()] },
      {
        getPrototypeOf() {
          throw attackerThrow;
        },
      },
    );

    let failure: unknown;
    try {
      validateAttachmentPageImages(plan, options);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AttachmentPageImagesValidationError);
    expect(failure).toMatchObject({
      code: "ATTACHMENT_PAGE_IMAGES_INVALID",
      message: "附件页图像输入无效",
      name: "AttachmentPageImagesValidationError",
    });
    expect(String(failure)).not.toContain("SECRET_");
  });

  it("rejects hostile accessors and proxies without reading input or touching the network", async () => {
    let getterReads = 0;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(accessor, {
      attachmentId: {
        enumerable: true,
        get() {
          getterReads += 1;
          throw new Error("SECRET_ACCESSOR");
        },
      },
      pageNumber: { enumerable: true, value: 1 },
      bytes: { enumerable: true, value: VALID_JPEG.slice() },
      widthPixels: { enumerable: true, value: 1200 },
      heightPixels: { enumerable: true, value: 1600 },
    });
    const proxy = new Proxy(validImage(), {
      get() {
        getterReads += 1;
        throw new Error("SECRET_PROXY_READ");
      },
      getOwnPropertyDescriptor() {
        throw new Error("SECRET_PROXY_DESCRIPTOR");
      },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    try {
      for (const image of [accessor, proxy]) {
        const failure = await renderDocxV2(createAttachmentModel(), "classic-formal.v1", "zh-CN", {
          attachmentPageImages: [image as ReturnType<typeof validImage>],
        }).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(Error);
        expect(String(failure)).toContain("附件页图像输入无效");
        expect(String(failure)).not.toContain("SECRET_");
      }
      expect(getterReads).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
