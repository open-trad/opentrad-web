import { boundedCompositeSchema, snapshotCompositeInput } from "../boundaries.js";
import { parseProject } from "../project.js";
import type { OpenTradProjectEnvelope } from "../schemas.js";
import { z } from "../zod.js";
import {
  type DocumentLanguageV2,
  DocumentLanguageV2Schema,
  type LayoutStyleId,
  LayoutStyleIdSchema,
  type TemplateIdV2,
  TemplateIdV2Schema,
  type TemplateVersionV2,
  TemplateVersionV2Schema,
} from "./common.js";

export const PROJECT_FORMAT_VERSION_V2 = "2.0.0" as const;
export const MAX_PROJECT_V2_BYTES = 1_048_576;

export interface AttachmentRefV1 {
  readonly id: string;
  readonly category: "qualification" | "technical" | "commercial" | "other";
  readonly displayName: string;
  readonly mediaType: "application/pdf" | "image/png" | "image/jpeg";
  readonly pageCount?: number;
  readonly required: boolean;
  readonly sourceRef?: string;
  readonly localBlobKey?: string;
  readonly status: "missing" | "attached" | "rejected";
  readonly includedInSubmission: boolean;
}

export interface ProjectDraftV2 {
  readonly id: string;
  readonly templateId: TemplateIdV2;
  readonly templateVersion: TemplateVersionV2;
  [key: string]: unknown;
}

export interface ProjectEnvelopeV2 {
  readonly formatVersion: typeof PROJECT_FORMAT_VERSION_V2;
  readonly template: {
    readonly id: TemplateIdV2;
    readonly version: TemplateVersionV2;
    readonly basisDate: "2026-08-19";
  };
  readonly draft: ProjectDraftV2;
  readonly presentation: {
    readonly layoutStyleId: LayoutStyleId;
    readonly languageView: DocumentLanguageV2;
  };
  readonly attachmentManifest: readonly AttachmentRefV1[];
}

export type OpenTradProject = OpenTradProjectEnvelope | ProjectEnvelopeV2;

const HTML_PATTERN = /<(?:!doctype|!--|\/?\s*[a-zA-Z][^>]*)>/i;
const ATTACHMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const textEncoder = new TextEncoder();

function isXml10Text(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
    if (codeUnit === 0x09 || codeUnit === 0x0a || codeUnit === 0x0d) continue;
    if (codeUnit < 0x20 || codeUnit === 0xfffe || codeUnit === 0xffff) return false;
  }
  return true;
}

function plainText(maximumLength: number, required = false) {
  return z
    .string()
    .max(maximumLength)
    .refine((value) => !required || value.trim().length > 0, "Required text is blank")
    .refine(isXml10Text, "Text is not XML 1.0 safe")
    .refine((value) => !HTML_PATTERN.test(value), "HTML is not allowed");
}

const AttachmentRefV1RawSchema = z.strictObject({
  id: plainText(200, true).regex(
    ATTACHMENT_ID_PATTERN,
    "Attachment id must be a safe archive path segment",
  ),
  category: z.enum(["qualification", "technical", "commercial", "other"]),
  displayName: plainText(500, true),
  mediaType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
  pageCount: z.number().int().min(1).max(10_000).optional(),
  required: z.boolean(),
  sourceRef: plainText(500, true).optional(),
  localBlobKey: plainText(500, true).optional(),
  status: z.enum(["missing", "attached", "rejected"]),
  includedInSubmission: z.boolean(),
});

export const AttachmentRefV1Schema = boundedCompositeSchema(
  AttachmentRefV1RawSchema.transform(
    (attachment) => snapshotCompositeInput(attachment) as AttachmentRefV1,
  ),
);

const ProjectDraftV2RawSchema = z
  .strictObject({
    id: plainText(200, true),
    templateId: plainText(200, true),
    templateVersion: plainText(50, true),
  })
  .catchall(z.json());

const ProjectEnvelopeV2RawSchema = z
  .strictObject({
    formatVersion: z.literal(PROJECT_FORMAT_VERSION_V2),
    template: z.strictObject({
      id: TemplateIdV2Schema,
      version: TemplateVersionV2Schema,
      basisDate: z.literal("2026-08-19"),
    }),
    draft: ProjectDraftV2RawSchema,
    presentation: z.strictObject({
      layoutStyleId: LayoutStyleIdSchema,
      languageView: DocumentLanguageV2Schema,
    }),
    attachmentManifest: z.array(AttachmentRefV1RawSchema).max(100),
  })
  .superRefine((envelope, context) => {
    if (envelope.template.id !== envelope.draft.templateId) {
      context.addIssue({
        code: "custom",
        message: "项目包模板版本不一致",
        path: ["draft", "templateId"],
      });
    }
    if (envelope.template.version !== envelope.draft.templateVersion) {
      context.addIssue({
        code: "custom",
        message: "项目包模板版本不一致",
        path: ["draft", "templateVersion"],
      });
    }

    const attachmentIds = new Set<string>();
    envelope.attachmentManifest.forEach((attachment, index) => {
      if (attachmentIds.has(attachment.id)) {
        context.addIssue({
          code: "custom",
          message: "项目包附件标识重复",
          path: ["attachmentManifest", index, "id"],
        });
      }
      attachmentIds.add(attachment.id);
    });
  })
  .transform(
    (envelope) =>
      snapshotCompositeInput(envelope, {
        arrayLimits: { attachmentManifest: 100 },
      }) as ProjectEnvelopeV2,
  );

export const ProjectEnvelopeV2Schema = boundedCompositeSchema(ProjectEnvelopeV2RawSchema, {
  arrayLimits: { attachmentManifest: 100 },
});

function assertProjectSize(serialized: string): void {
  if (
    serialized.length > MAX_PROJECT_V2_BYTES ||
    textEncoder.encode(serialized).byteLength > MAX_PROJECT_V2_BYTES
  ) {
    throw new Error("项目包超过 1 MiB");
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("项目包包含非有限数字");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  throw new Error("项目包包含无法序列化的值");
}

export function serializeProjectV2(input: unknown): string {
  const envelope = ProjectEnvelopeV2Schema.parse(input);
  const serialized = stableJson(envelope);
  assertProjectSize(serialized);
  return serialized;
}

function parseJson(serialized: string): unknown {
  try {
    return JSON.parse(serialized);
  } catch {
    throw new Error("项目包不是有效的 JSON");
  }
}

function ownFormatVersion(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const descriptor = Reflect.getOwnPropertyDescriptor(value, "formatVersion");
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

export function parseOpenTradProject(serialized: string): OpenTradProject {
  if (typeof serialized !== "string") {
    throw new TypeError("项目包必须是 JSON 字符串");
  }
  assertProjectSize(serialized);
  const parsed = parseJson(serialized);
  const formatVersion = ownFormatVersion(parsed);

  if (formatVersion === "1.0.0") {
    return parseProject(serialized);
  }
  if (formatVersion === PROJECT_FORMAT_VERSION_V2) {
    return ProjectEnvelopeV2Schema.parse(parsed);
  }
  throw new Error("不支持的项目包格式版本");
}
