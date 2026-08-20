import { z } from "zod";
import { safeSchema } from "./safety.js";

export const MiB = 1024 * 1024;

export const FileFormatSchema = z.enum([
  "txt",
  "md",
  "html",
  "doc",
  "docx",
  "odt",
  "rtf",
  "xls",
  "xlsx",
  "ods",
  "csv",
  "ppt",
  "pptx",
  "odp",
  "pdf",
  "png",
  "jpg",
  "webp",
  "avif",
  "opentrad",
]);
export type FileFormat = z.infer<typeof FileFormatSchema>;

export const ConversionGradeSchema = z.enum(["A", "B", "C"]);
export type ConversionGrade = z.infer<typeof ConversionGradeSchema>;

const ConversionLimitsRawSchema = z
  .strictObject({
    maxInputBytes: z
      .number()
      .int()
      .positive()
      .max(52 * MiB),
    maxAttachmentBytes: z
      .number()
      .int()
      .positive()
      .max(25 * MiB)
      .optional(),
    maxTotalBytes: z
      .number()
      .int()
      .positive()
      .max(50 * MiB)
      .optional(),
    maxFiles: z.number().int().positive().max(100).optional(),
    maxIncludedFiles: z.number().int().positive().max(100).optional(),
    maxPages: z.number().int().positive().max(10_000).optional(),
  })
  .superRefine((limits, context) => {
    if (
      limits.maxIncludedFiles !== undefined &&
      (limits.maxFiles === undefined || limits.maxIncludedFiles > limits.maxFiles)
    ) {
      context.addIssue({ code: "custom", message: "Included-file limit exceeds file limit" });
    }
    if (
      limits.maxAttachmentBytes !== undefined &&
      limits.maxTotalBytes !== undefined &&
      limits.maxAttachmentBytes > limits.maxTotalBytes
    ) {
      context.addIssue({ code: "custom", message: "Attachment limit exceeds total limit" });
    }
  });

function hasDuplicateStrings(values: readonly string[]): boolean {
  for (let index = 0; index < values.length; index += 1) {
    for (let prior = 0; prior < index; prior += 1) {
      if (values[index] === values[prior]) return true;
    }
  }
  return false;
}

const ConversionCapabilityRawSchema = z
  .strictObject({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(80),
    inputFormats: z.array(FileFormatSchema).min(1).max(20),
    outputFormats: z.array(FileFormatSchema).min(1).max(20),
    execution: z.enum(["browser", "server"]),
    quality: ConversionGradeSchema,
    authRequired: z.boolean(),
    consentRequired: z.boolean(),
    limits: ConversionLimitsRawSchema,
    caveatCodes: z.array(z.string().min(1).max(64)).max(8),
  })
  .superRefine((capability, context) => {
    const protectedExecution = capability.execution === "server";
    if (
      capability.authRequired !== protectedExecution ||
      capability.consentRequired !== protectedExecution
    ) {
      context.addIssue({ code: "custom", message: "Execution boundary is inconsistent" });
    }
    if (hasDuplicateStrings(capability.inputFormats)) {
      context.addIssue({ code: "custom", message: "Input formats must be unique" });
    }
    if (hasDuplicateStrings(capability.outputFormats)) {
      context.addIssue({ code: "custom", message: "Output formats must be unique" });
    }
  });

export const ConversionCapabilitySchema = safeSchema(ConversionCapabilityRawSchema);
export type ConversionCapability = z.infer<typeof ConversionCapabilitySchema>;

const capabilityInputs = [
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

const parsedCapabilities: ConversionCapability[] = [];
for (let index = 0; index < capabilityInputs.length; index += 1) {
  Object.defineProperty(parsedCapabilities, index, {
    configurable: true,
    enumerable: true,
    value: ConversionCapabilitySchema.parse(capabilityInputs[index]),
    writable: true,
  });
}
export const CAPABILITIES: readonly ConversionCapability[] = Object.freeze(parsedCapabilities);
