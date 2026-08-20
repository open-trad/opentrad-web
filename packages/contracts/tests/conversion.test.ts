import { describe, expect, it } from "vitest";
import * as contracts from "../src/index.js";

const api = contracts as Record<string, unknown>;
const MiB = 1024 * 1024;
const EXPECTED_CAPABILITIES = [
  {
    id: "text.semantic",
    label: "文本语义转换",
    inputFormats: ["txt", "md", "html"],
    outputFormats: ["txt", "md", "html"],
    execution: "browser",
    quality: "A",
    authRequired: false,
    consentRequired: false,
    limits: { maxInputBytes: 10 * MiB },
    caveatCodes: [],
  },
  {
    id: "document.generate",
    label: "生成 DOCX/PDF",
    inputFormats: ["txt", "md", "html"],
    outputFormats: ["docx", "pdf"],
    execution: "browser",
    quality: "B",
    authRequired: false,
    consentRequired: false,
    limits: { maxInputBytes: 10 * MiB },
    caveatCodes: ["LAYOUT_REFLOW"],
  },
  {
    id: "docx.extract",
    label: "提取 DOCX 内容",
    inputFormats: ["docx"],
    outputFormats: ["html", "md", "txt"],
    execution: "browser",
    quality: "B",
    authRequired: false,
    consentRequired: false,
    limits: { maxInputBytes: 25 * MiB },
    caveatCodes: ["LAYOUT_REFLOW"],
  },
  {
    id: "pdf.inspect",
    label: "PDF 预览与提取",
    inputFormats: ["pdf"],
    outputFormats: ["txt", "png", "jpg"],
    execution: "browser",
    quality: "B",
    authRequired: false,
    consentRequired: false,
    limits: { maxInputBytes: 25 * MiB, maxPages: 80 },
    caveatCodes: ["SCANNED_TEXT_MAY_BE_EMPTY"],
  },
  {
    id: "pdf.organize",
    label: "PDF 页面整理",
    inputFormats: ["pdf"],
    outputFormats: ["pdf"],
    execution: "browser",
    quality: "A",
    authRequired: false,
    consentRequired: false,
    limits: { maxInputBytes: 25 * MiB, maxFiles: 20, maxPages: 200 },
    caveatCodes: [],
  },
  {
    id: "image.convert",
    label: "图片转换与压缩",
    inputFormats: ["png", "jpg", "webp", "avif"],
    outputFormats: ["png", "jpg", "webp", "avif"],
    execution: "browser",
    quality: "A",
    authRequired: false,
    consentRequired: false,
    limits: { maxInputBytes: 25 * MiB },
    caveatCodes: ["LOSSY_TARGET_MAY_REDUCE_QUALITY"],
  },
  {
    id: "images.to.pdf",
    label: "图片合成 PDF",
    inputFormats: ["png", "jpg", "webp", "avif"],
    outputFormats: ["pdf"],
    execution: "browser",
    quality: "A",
    authRequired: false,
    consentRequired: false,
    limits: { maxInputBytes: 25 * MiB, maxTotalBytes: 50 * MiB, maxFiles: 80 },
    caveatCodes: [],
  },
  {
    id: "office.to.pdf",
    label: "Office 转 PDF",
    inputFormats: ["doc", "docx", "odt", "rtf", "xls", "xlsx", "ods", "ppt", "pptx", "odp"],
    outputFormats: ["pdf"],
    execution: "server",
    quality: "B",
    authRequired: true,
    consentRequired: true,
    limits: { maxInputBytes: 25 * MiB },
    caveatCodes: ["LAYOUT_MAY_DIFFER_FROM_SOURCE_APP"],
  },
  {
    id: "spreadsheet.to.csv",
    label: "表格转 CSV",
    inputFormats: ["xls", "xlsx", "ods"],
    outputFormats: ["csv"],
    execution: "server",
    quality: "B",
    authRequired: true,
    consentRequired: true,
    limits: { maxInputBytes: 25 * MiB },
    caveatCodes: ["ONE_SHEET_PER_RESULT"],
  },
  {
    id: "structured.convert",
    label: "结构化文档转换",
    inputFormats: ["docx", "odt", "rtf", "html", "md"],
    outputFormats: ["docx", "odt", "rtf", "html", "md"],
    execution: "server",
    quality: "B",
    authRequired: true,
    consentRequired: true,
    limits: { maxInputBytes: 25 * MiB },
    caveatCodes: ["LAYOUT_REFLOW"],
  },
  {
    id: "ocr.pdf",
    label: "扫描 PDF OCR",
    inputFormats: ["pdf"],
    outputFormats: ["pdf", "txt"],
    execution: "server",
    quality: "B",
    authRequired: true,
    consentRequired: true,
    limits: { maxInputBytes: 25 * MiB, maxPages: 20 },
    caveatCodes: ["OCR_REQUIRES_REVIEW"],
  },
  {
    id: "ocr.image",
    label: "图片 OCR",
    inputFormats: ["png", "jpg", "webp"],
    outputFormats: ["txt", "pdf"],
    execution: "server",
    quality: "B",
    authRequired: true,
    consentRequired: true,
    limits: { maxInputBytes: 25 * MiB },
    caveatCodes: ["OCR_REQUIRES_REVIEW"],
  },
  {
    id: "image.convert.hq",
    label: "高质量图片转换",
    inputFormats: ["png", "jpg", "webp", "avif"],
    outputFormats: ["png", "jpg", "webp", "avif"],
    execution: "server",
    quality: "A",
    authRequired: true,
    consentRequired: true,
    limits: { maxInputBytes: 25 * MiB },
    caveatCodes: [],
  },
  {
    id: "pdf.repair",
    label: "PDF 结构修复",
    inputFormats: ["pdf"],
    outputFormats: ["pdf"],
    execution: "server",
    quality: "B",
    authRequired: true,
    consentRequired: true,
    limits: { maxInputBytes: 25 * MiB, maxPages: 80 },
    caveatCodes: ["UNRECOVERABLE_CONTENT_MAY_BE_DROPPED"],
  },
  {
    id: "pdf.text-to-docx",
    label: "PDF 文字提取到 Word（实验）",
    inputFormats: ["pdf"],
    outputFormats: ["docx"],
    execution: "server",
    quality: "C",
    authRequired: true,
    consentRequired: true,
    limits: { maxInputBytes: 25 * MiB, maxPages: 80 },
    caveatCodes: ["EXPERIMENTAL_REFLOW", "NO_LAYOUT_FIDELITY_PROMISE"],
  },
  {
    id: "bid.assemble",
    label: "标书附件组装",
    inputFormats: ["opentrad"],
    outputFormats: ["docx", "pdf"],
    execution: "server",
    quality: "B",
    authRequired: true,
    consentRequired: true,
    limits: {
      maxInputBytes: 52 * MiB,
      maxAttachmentBytes: 25 * MiB,
      maxTotalBytes: 50 * MiB,
      maxFiles: 100,
      maxIncludedFiles: 40,
      maxPages: 80,
    },
    caveatCodes: ["ATTACHMENTS_EMBED_AS_PAGE_IMAGES"],
  },
] as const;

describe("conversion capabilities", () => {
  it("publishes the complete local-first matrix", () => {
    expect(api.CAPABILITIES).toEqual(EXPECTED_CAPABILITIES);
  });

  it("locks experimental PDF to Word to grade C", () => {
    const capabilities = api.CAPABILITIES as
      | readonly {
          readonly id: string;
          readonly quality: string;
          readonly caveatCodes: readonly string[];
        }[]
      | undefined;
    const capability = capabilities?.find((item) => item.id === "pdf.text-to-docx");
    expect(capability?.quality).toBe("C");
    expect(capability?.caveatCodes).toContain("EXPERIMENTAL_REFLOW");
  });

  it("admits bid assembly only from a canonical OpenTrad archive", () => {
    const capabilities = api.CAPABILITIES as
      | readonly {
          readonly id: string;
          readonly inputFormats: readonly string[];
          readonly outputFormats: readonly string[];
          readonly limits: Readonly<Record<string, number>>;
        }[]
      | undefined;
    const capability = capabilities?.find((item) => item.id === "bid.assemble");
    expect(capability).toMatchObject({
      inputFormats: ["opentrad"],
      outputFormats: ["docx", "pdf"],
      limits: {
        maxInputBytes: 52 * MiB,
        maxAttachmentBytes: 25 * MiB,
        maxTotalBytes: 50 * MiB,
        maxFiles: 100,
        maxIncludedFiles: 40,
        maxPages: 80,
      },
    });
  });

  it("rejects unknown fields without invoking accessors", () => {
    const schema = api.ConversionCapabilitySchema as { parse(input: unknown): unknown } | undefined;
    let getterCalls = 0;
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.assign(hostile, (api.CAPABILITIES as readonly unknown[] | undefined)?.[0]);
    Object.defineProperty(hostile, "sourceFilename", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "private.docx";
      },
    });
    expect(() => schema?.parse(hostile)).toThrow();
    expect(getterCalls).toBe(0);
  });

  it("returns deeply frozen empty-prototype capability snapshots", () => {
    const schema = api.ConversionCapabilitySchema as
      | { parse(input: unknown): Record<string, unknown> }
      | undefined;
    const first = (api.CAPABILITIES as readonly unknown[] | undefined)?.[0];
    const parsed = schema?.parse(first);
    expect(parsed).toBeDefined();
    expect(Object.getPrototypeOf(parsed as object)).toBeNull();
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed?.limits)).toBe(true);
    expect(Object.isFrozen(parsed?.inputFormats)).toBe(true);
    expect(Object.isFrozen(api.CAPABILITIES)).toBe(true);
  });

  it("rejects internally contradictory capability limits", () => {
    const schema = api.ConversionCapabilitySchema as { parse(input: unknown): unknown };
    const bid = (api.CAPABILITIES as readonly Record<string, unknown>[]).at(-1) as Record<
      string,
      unknown
    >;
    for (const limits of [
      { ...(bid.limits as object), maxFiles: 40, maxIncludedFiles: 41 },
      { ...(bid.limits as object), maxAttachmentBytes: 26 * MiB, maxTotalBytes: 25 * MiB },
    ]) {
      expect(() => schema.parse({ ...bid, limits })).toThrow();
    }
  });
});
