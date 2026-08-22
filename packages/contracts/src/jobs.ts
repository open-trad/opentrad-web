import { z } from "zod";
import { ConversionGradeSchema, MiB } from "./conversion.js";
import { safeSchema } from "./safety.js";

const intrinsicReflectApply = Reflect.apply;
const intrinsicObjectFreeze = Object.freeze;
const intrinsicStringToLowerCase = String.prototype.toLowerCase;
const intrinsicStringTrim = String.prototype.trim;

export const ConversionOperationSchema = z.enum([
  "office.to.pdf",
  "spreadsheet.to.csv",
  "structured.convert",
  "ocr.pdf",
  "ocr.image",
  "image.convert.hq",
  "pdf.repair",
  "pdf.text-to-docx",
  "bid.assemble",
]);
export type ConversionOperation = z.infer<typeof ConversionOperationSchema>;

export const JobStatusValueSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelling",
  "cancelled",
]);
export type JobStatusValue = z.infer<typeof JobStatusValueSchema>;

export const JobErrorCodeSchema = z.enum([
  "AUTH_REQUIRED",
  "ORIGIN_REJECTED",
  "PROCESSING_CONSENT_REQUIRED",
  "INVALID_REQUEST",
  "UNSUPPORTED_OPERATION",
  "UNSUPPORTED_FORMAT",
  "FILE_TOO_LARGE",
  "PAGE_LIMIT_EXCEEDED",
  "ENCRYPTED_INPUT",
  "MALWARE_DETECTED",
  "JOB_ALREADY_ACTIVE",
  "QUEUE_FULL",
  "DAILY_QUOTA_EXCEEDED",
  "IDEMPOTENCY_CONFLICT",
  "JOB_NOT_READY",
  "SCANNER_UNAVAILABLE",
  "CONVERSION_TIMEOUT",
  "CONVERSION_FAILED",
]);
export type JobErrorCode = z.infer<typeof JobErrorCodeSchema>;

export const BID_TEMPLATE_IDS = Object.freeze([
  "bid.government.goods.v1",
  "bid.government.services.v1",
  "bid.construction.works.v1",
  "bid.enterprise.goods.v1",
  "bid.enterprise.services.v1",
] as const);
export const BidTemplateIdSchema = z.enum(BID_TEMPLATE_IDS);
export type BidTemplateId = z.infer<typeof BidTemplateIdSchema>;
export const BidTemplateVersionSchema = z.literal("1.0.0");
export type BidTemplateVersion = z.infer<typeof BidTemplateVersionSchema>;

const EmptyOptionsSchema = z.strictObject({}).default({});
const OcrOptionsSchema = z
  .strictObject({ language: z.enum(["chi_sim", "eng", "chi_sim+eng"]).optional() })
  .default({});
const SpreadsheetOptionsSchema = z
  .strictObject({ sheetIndex: z.number().int().min(0).max(255).optional() })
  .default({});
const BidOptionsSchema = z.strictObject({
  templateId: BidTemplateIdSchema,
  templateVersion: BidTemplateVersionSchema,
});

const commonInputBytes = z
  .number()
  .int()
  .positive()
  .max(25 * MiB);
const request = <
  Operation extends ConversionOperation,
  Input extends z.ZodType,
  Output extends z.ZodType,
  Options extends z.ZodType,
>(
  operation: Operation,
  inputFormat: Input,
  outputFormat: Output,
  options: Options,
) =>
  z.strictObject({
    operation: z.literal(operation),
    inputFormat,
    outputFormat,
    inputBytes: commonInputBytes,
    options,
  });

const CreateJobRequestRawSchema = z.discriminatedUnion("operation", [
  request(
    "office.to.pdf",
    z.enum(["doc", "docx", "odt", "rtf", "xls", "xlsx", "ods", "ppt", "pptx", "odp"]),
    z.literal("pdf"),
    EmptyOptionsSchema,
  ),
  request(
    "spreadsheet.to.csv",
    z.enum(["xls", "xlsx", "ods"]),
    z.literal("csv"),
    SpreadsheetOptionsSchema,
  ),
  request(
    "structured.convert",
    z.enum(["docx", "odt", "rtf", "html", "md"]),
    z.enum(["docx", "odt", "rtf", "html", "md"]),
    EmptyOptionsSchema,
  ),
  request("ocr.pdf", z.literal("pdf"), z.enum(["pdf", "txt"]), OcrOptionsSchema),
  request("ocr.image", z.enum(["png", "jpg", "webp"]), z.enum(["txt", "pdf"]), OcrOptionsSchema),
  request(
    "image.convert.hq",
    z.enum(["png", "jpg", "webp", "avif"]),
    z.enum(["png", "jpg", "webp", "avif"]),
    EmptyOptionsSchema,
  ),
  request("pdf.repair", z.literal("pdf"), z.literal("pdf"), EmptyOptionsSchema),
  request("pdf.text-to-docx", z.literal("pdf"), z.literal("docx"), EmptyOptionsSchema),
  z.strictObject({
    operation: z.literal("bid.assemble"),
    inputFormat: z.literal("opentrad"),
    outputFormat: z.enum(["docx", "pdf"]),
    inputBytes: z
      .number()
      .int()
      .positive()
      .max(52 * MiB),
    options: BidOptionsSchema,
  }),
]);

export const CreateJobRequestSchema = safeSchema(CreateJobRequestRawSchema);
export type CreateJobRequest = z.infer<typeof CreateJobRequestSchema>;

export type JobResultMediaType =
  | "application/pdf"
  | "application/rtf"
  | "application/vnd.oasis.opendocument.text"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "image/avif"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "text/csv"
  | "text/html"
  | "text/markdown"
  | "text/plain";

export const JOB_RESULT_MEDIA_TYPES = intrinsicObjectFreeze([
  "application/pdf",
  "application/rtf",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
] as const satisfies readonly JobResultMediaType[]);

export function jobResultMediaType(outputFormat: unknown): JobResultMediaType {
  switch (outputFormat) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "odt":
      return "application/vnd.oasis.opendocument.text";
    case "rtf":
      return "application/rtf";
    case "html":
      return "text/html";
    case "md":
      return "text/markdown";
    case "csv":
      return "text/csv";
    case "txt":
      return "text/plain";
    case "png":
      return "image/png";
    case "jpg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    default:
      throw new Error("JOB_RESULT_MEDIA_INVALID");
  }
}

export function isJobResultMediaType(input: unknown): input is JobResultMediaType {
  if (typeof input !== "string") return false;
  for (let index = 0; index < JOB_RESULT_MEDIA_TYPES.length; index += 1) {
    if (JOB_RESULT_MEDIA_TYPES[index] === input) return true;
  }
  return false;
}

const CitationSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) => intrinsicReflectApply(intrinsicStringTrim, value, []) === value,
    "Citation must be trimmed",
  );

const AttachmentIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u)
  .refine((value) => {
    const normalized = intrinsicReflectApply(intrinsicStringToLowerCase, value, []) as string;
    return normalized !== "__proto__" && normalized !== "constructor" && normalized !== "prototype";
  });

const BidAssemblyAttachmentBase = {
  id: AttachmentIdSchema,
  category: z.enum(["qualification", "technical", "commercial", "other"]),
  displayName: z.string().min(1).max(500),
  mediaType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
  required: z.boolean(),
  sourceRef: CitationSchema.optional(),
} as const;

const BidAssemblyAttachmentRawSchema = z.discriminatedUnion("status", [
  z.strictObject({
    ...BidAssemblyAttachmentBase,
    status: z.literal("attached"),
    byteLength: z
      .number()
      .int()
      .positive()
      .max(25 * MiB),
    pageCount: z.number().int().positive().max(10_000),
    includedInSubmission: z.boolean(),
  }),
  z.strictObject({
    ...BidAssemblyAttachmentBase,
    status: z.enum(["missing", "rejected"]),
    includedInSubmission: z.literal(false),
  }),
]);

const BidAssemblyManifestRawSchema = z
  .strictObject({
    templateId: BidTemplateIdSchema,
    templateVersion: BidTemplateVersionSchema,
    body: z.strictObject({
      byteLength: z
        .number()
        .int()
        .positive()
        .max(1 * MiB),
      pageCount: z.number().int().positive().max(80),
    }),
    attachmentManifest: z.array(BidAssemblyAttachmentRawSchema).max(100),
  })
  .superRefine((manifest, context) => {
    let totalAttachmentBytes = 0;
    let includedFiles = 0;
    let totalPages = manifest.body.pageCount;
    for (let index = 0; index < manifest.attachmentManifest.length; index += 1) {
      const attachment = manifest.attachmentManifest[index];
      if (!attachment) continue;
      let duplicate = false;
      for (let prior = 0; prior < index; prior += 1) {
        if (manifest.attachmentManifest[prior]?.id === attachment.id) {
          duplicate = true;
          break;
        }
      }
      if (duplicate) {
        context.addIssue({
          code: "custom",
          message: "Attachment ids must be unique",
          path: ["attachmentManifest", index, "id"],
        });
      }
      if (attachment.status === "attached") totalAttachmentBytes += attachment.byteLength;
      if (attachment.status === "attached" && attachment.includedInSubmission) {
        includedFiles += 1;
        totalPages += attachment.pageCount;
      }
    }
    if (includedFiles > 40) {
      context.addIssue({ code: "custom", message: "At most 40 attachments may be submitted" });
    }
    if (totalAttachmentBytes > 50 * MiB) {
      context.addIssue({ code: "custom", message: "Attachment byte budget exceeded" });
    }
    if (totalPages > 80) {
      context.addIssue({ code: "custom", message: "Bid page budget exceeded" });
    }
  });

export const BidAssemblyManifestSchema = safeSchema(BidAssemblyManifestRawSchema);
export type BidAssemblyManifest = z.infer<typeof BidAssemblyManifestSchema>;

type JobPhase = "admission" | "queued" | "converting" | "finalizing";

function phaseMatchesStatus(status: JobStatusValue, phase: JobPhase): boolean {
  switch (status) {
    case "queued":
      return phase === "admission" || phase === "queued";
    case "running":
      return phase === "converting" || phase === "finalizing";
    case "cancelling":
      return phase === "queued" || phase === "converting" || phase === "finalizing";
    case "succeeded":
    case "failed":
    case "cancelled":
      return false;
  }
}

function qualityForOperation(operation: ConversionOperation): "A" | "B" | "C" {
  switch (operation) {
    case "image.convert.hq":
      return "A";
    case "pdf.text-to-docx":
      return "C";
    case "office.to.pdf":
    case "spreadsheet.to.csv":
    case "structured.convert":
    case "ocr.pdf":
    case "ocr.image":
    case "pdf.repair":
    case "bid.assemble":
      return "B";
  }
}

export function jobResultMediaTypeMatchesOperation(
  operation: ConversionOperation,
  mediaType: unknown,
): mediaType is JobResultMediaType {
  if (!isJobResultMediaType(mediaType)) return false;
  const docx = jobResultMediaType("docx");
  switch (operation) {
    case "office.to.pdf":
    case "pdf.repair":
      return mediaType === jobResultMediaType("pdf");
    case "spreadsheet.to.csv":
      return mediaType === jobResultMediaType("csv");
    case "structured.convert":
      return (
        mediaType === docx ||
        mediaType === jobResultMediaType("odt") ||
        mediaType === jobResultMediaType("rtf") ||
        mediaType === jobResultMediaType("html") ||
        mediaType === jobResultMediaType("md")
      );
    case "ocr.pdf":
    case "ocr.image":
      return mediaType === jobResultMediaType("pdf") || mediaType === jobResultMediaType("txt");
    case "image.convert.hq":
      return (
        mediaType === jobResultMediaType("png") ||
        mediaType === jobResultMediaType("jpg") ||
        mediaType === jobResultMediaType("webp") ||
        mediaType === jobResultMediaType("avif")
      );
    case "pdf.text-to-docx":
      return mediaType === docx;
    case "bid.assemble":
      return mediaType === jobResultMediaType("pdf") || mediaType === docx;
  }
}

const JobStatusRawSchema = z
  .strictObject({
    id: z.string().uuid(),
    operation: ConversionOperationSchema,
    status: JobStatusValueSchema,
    quality: ConversionGradeSchema,
    createdAt: z.string().datetime(),
    startedAt: z.string().datetime().optional(),
    expiresAt: z.string().datetime(),
    queuePosition: z.union([z.literal(0), z.literal(1)]).optional(),
    progress: z
      .strictObject({
        phase: z.enum(["admission", "queued", "converting", "finalizing"]),
        completed: z.number().int().nonnegative(),
        total: z.number().int().positive(),
      })
      .optional(),
    result: z
      .strictObject({
        ready: z.literal(true),
        mediaType: z.string().min(1).max(100),
        sizeBytes: z.number().int().nonnegative(),
      })
      .optional(),
    error: z.strictObject({ code: JobErrorCodeSchema, retryable: z.boolean() }).optional(),
  })
  .superRefine((job, context) => {
    if (job.status === "succeeded" && job.result === undefined) {
      context.addIssue({ code: "custom", message: "Succeeded jobs require a result" });
    }
    if (job.status === "failed" && job.error === undefined) {
      context.addIssue({ code: "custom", message: "Failed jobs require an error" });
    }
    if (job.status !== "succeeded" && job.result !== undefined) {
      context.addIssue({ code: "custom", message: "Only succeeded jobs expose a result" });
    }
    if (job.status !== "failed" && job.error !== undefined) {
      context.addIssue({ code: "custom", message: "Only failed jobs expose an error" });
    }
    if (job.progress !== undefined && job.progress.completed > job.progress.total) {
      context.addIssue({ code: "custom", message: "Job progress exceeds its total" });
    }
    if (job.progress !== undefined && !phaseMatchesStatus(job.status, job.progress.phase)) {
      context.addIssue({ code: "custom", message: "Job progress phase does not match status" });
    }
    if (job.quality !== qualityForOperation(job.operation)) {
      context.addIssue({ code: "custom", message: "Job quality does not match operation" });
    }
    if (
      job.result !== undefined &&
      !jobResultMediaTypeMatchesOperation(job.operation, job.result.mediaType)
    ) {
      context.addIssue({ code: "custom", message: "Result media type does not match operation" });
    }
  });

export const JobStatusSchema = safeSchema(JobStatusRawSchema);
export type JobStatus = z.infer<typeof JobStatusSchema>;

const idempotency = <
  Operation extends ConversionOperation,
  Input extends z.ZodType,
  Output extends z.ZodType,
  Options extends z.ZodType,
>(
  operation: Operation,
  inputFormat: Input,
  outputFormat: Output,
  options: Options,
  inputBytes: z.ZodNumber = commonInputBytes,
) =>
  z.strictObject({
    operation: z.literal(operation),
    inputFormat,
    outputFormat,
    inputBytes,
    options,
  });

const IdempotencyShapeRawSchema = z.discriminatedUnion("operation", [
  idempotency(
    "office.to.pdf",
    z.enum(["doc", "docx", "odt", "rtf", "xls", "xlsx", "ods", "ppt", "pptx", "odp"]),
    z.literal("pdf"),
    EmptyOptionsSchema,
  ),
  idempotency(
    "spreadsheet.to.csv",
    z.enum(["xls", "xlsx", "ods"]),
    z.literal("csv"),
    SpreadsheetOptionsSchema,
  ),
  idempotency(
    "structured.convert",
    z.enum(["docx", "odt", "rtf", "html", "md"]),
    z.enum(["docx", "odt", "rtf", "html", "md"]),
    EmptyOptionsSchema,
  ),
  idempotency("ocr.pdf", z.literal("pdf"), z.enum(["pdf", "txt"]), OcrOptionsSchema),
  idempotency(
    "ocr.image",
    z.enum(["png", "jpg", "webp"]),
    z.enum(["txt", "pdf"]),
    OcrOptionsSchema,
  ),
  idempotency(
    "image.convert.hq",
    z.enum(["png", "jpg", "webp", "avif"]),
    z.enum(["png", "jpg", "webp", "avif"]),
    EmptyOptionsSchema,
  ),
  idempotency("pdf.repair", z.literal("pdf"), z.literal("pdf"), EmptyOptionsSchema),
  idempotency("pdf.text-to-docx", z.literal("pdf"), z.literal("docx"), EmptyOptionsSchema),
  idempotency(
    "bid.assemble",
    z.literal("opentrad"),
    z.enum(["docx", "pdf"]),
    BidOptionsSchema,
    z
      .number()
      .int()
      .positive()
      .max(52 * MiB),
  ),
]);
export const IdempotencyShapeSchema = safeSchema(IdempotencyShapeRawSchema);
export type IdempotencyShape = z.infer<typeof IdempotencyShapeSchema>;

export function createIdempotencyShape(input: unknown): IdempotencyShape {
  const request = CreateJobRequestSchema.parse(input);
  return IdempotencyShapeSchema.parse({
    operation: request.operation,
    inputFormat: request.inputFormat,
    outputFormat: request.outputFormat,
    inputBytes: request.inputBytes,
    options: request.options,
  });
}
