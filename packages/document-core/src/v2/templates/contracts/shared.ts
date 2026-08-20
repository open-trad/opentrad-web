import { boundedCompositeSchema } from "../../../boundaries.js";
import { isolatedArraySchema, isolatedObjectSchema } from "../../../safe-schema.js";
import { z } from "../../../zod.js";
import {
  type EntityPartyV2,
  EntityPartyV2Schema,
  type LocalizedText,
} from "../../common.js";
import type { DocumentSignerV2, WatermarkPolicyV2 } from "../../document-model.js";
import { AttachmentRefV1Schema, type AttachmentRefV1 } from "../../project.js";
import { type RiskFindingV2, RiskFindingV2Schema } from "../../risk.js";
import type { ContractSignerV1 } from "../contract-common.js";

const HTML_PATTERN = /<(?:!doctype|!--|\/?\s*[a-zA-Z][^>]*)>/i;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export interface SafeContractIssue {
  readonly code: "custom";
  readonly message: string;
  readonly path?: PropertyKey[];
}

type ObjectOutput<Shape extends z.ZodRawShape> = z.output<z.ZodObject<Shape>>;

function isXml10Text(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
    if (codeUnit === 0x09 || codeUnit === 0x0a || codeUnit === 0x0d) continue;
    if (codeUnit < 0x20 || codeUnit === 0xfffe || codeUnit === 0xffff) return false;
  }
  return true;
}

export function contractText(maximumLength: number, required = false) {
  return z
    .string()
    .max(maximumLength)
    .refine((value) => !required || value.trim().length > 0, "Required text is blank")
    .refine(isXml10Text, "Text is not XML 1.0 safe")
    .refine((value) => !HTML_PATTERN.test(value), "HTML is not allowed");
}

export function strictContractObject<const Shape extends z.ZodRawShape>(
  shape: Shape,
  refine?: (
    value: ObjectOutput<Shape>,
    addIssue: (issue: SafeContractIssue) => void,
  ) => void,
) {
  const isolated = isolatedObjectSchema(shape, refine);
  const allowedKeys = new Set(Object.keys(shape));
  return z.transform<unknown, ObjectOutput<Shape>>((input, context) => {
    try {
      if (input !== null && typeof input === "object" && !Array.isArray(input)) {
        const prototype = Object.getPrototypeOf(input);
        if (prototype !== Object.prototype && prototype !== null) {
          context.addIssue({ code: "custom", message: "Custom object prototypes are not allowed" });
        }
        for (const key of Reflect.ownKeys(input)) {
          const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
          if (
            typeof key !== "string" ||
            !allowedKeys.has(key) ||
            DANGEROUS_KEYS.has(key) ||
            !descriptor ||
            !("value" in descriptor)
          ) {
            context.addIssue({
              code: "custom",
              message: "Unknown, dangerous or accessor object key",
              path: typeof key === "string" ? [key] : [],
            });
          }
        }
      }
      if (context.issues.length > 0) return z.NEVER;
      const parsed = isolated.safeParse(input);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) context.addIssue({ ...issue });
        return z.NEVER;
      }
      return parsed.data;
    } catch {
      context.addIssue({ code: "custom", message: "Object validation failed safely" });
      return z.NEVER;
    }
  });
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new Error("Validated contract output must contain only own data properties");
    }
    deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

export function frozenContractSchema<T extends z.ZodType>(
  schema: T,
  policy: {
    readonly arrayLimits?: Readonly<Record<string, number>>;
    readonly maxTotalValues?: number;
  } = {},
) {
  const frozen = z.transform<unknown, z.output<T>>((input, context) => {
    const result = schema.safeParse(input);
    if (!result.success) {
      for (const issue of result.error.issues) context.addIssue({ ...issue });
      return z.NEVER;
    }
    return deepFreeze(result.data);
  });
  return boundedCompositeSchema(frozen, policy);
}

export const ContractPartyV2Schema = EntityPartyV2Schema;

const AttachmentRefsRawSchema = isolatedArraySchema(AttachmentRefV1Schema, {
  max: 100,
  refine: (attachments, addIssue) => {
    const seen = new Set<string>();
    attachments.forEach((attachment, index) => {
      if (seen.has(attachment.id)) {
        addIssue({
          code: "custom",
          message: "Attachment ids must be unique",
          path: [index, "id"],
        });
      }
      seen.add(attachment.id);
    });
  },
});
export const ContractAttachmentRefsSchema = frozenContractSchema(AttachmentRefsRawSchema, {
  arrayLimits: { attachments: 100 },
  maxTotalValues: 2_000,
});

export function localized(zhCN: string, enUS?: string): LocalizedText {
  return enUS === undefined ? { zhCN } : { zhCN, enUS };
}

export function partyDetails(party: EntityPartyV2, bilingual = false): readonly LocalizedText[] {
  const values = [
    party.registrationId && [`登记号：${party.registrationId}`, `Registration ID: ${party.registrationId}`],
    party.taxId && [`税号：${party.taxId}`, `Tax ID: ${party.taxId}`],
    party.registeredAddress && [
      `注册地址：${party.registeredAddress}`,
      `Registered address: ${party.registeredAddress}`,
    ],
    [`联系人：${party.contactName}`, `Contact: ${party.contactName}`],
    party.phone && [`电话：${party.phone}`, `Phone: ${party.phone}`],
    party.email && [`邮箱：${party.email}`, `Email: ${party.email}`],
  ].filter((value): value is [string, string] => Boolean(value));
  return values.map(([zhCN, enUS]) => localized(zhCN, bilingual ? enUS : undefined));
}

export function contractFinding(
  code: string,
  severity: RiskFindingV2["severity"],
  impact: RiskFindingV2["impact"],
  message: string,
  path?: readonly string[],
): RiskFindingV2 {
  return RiskFindingV2Schema.parse({ code, severity, impact, message, path });
}

export function freezeContractFindings(
  findings: readonly RiskFindingV2[],
): readonly RiskFindingV2[] {
  return Object.freeze([...findings]);
}

export function contractWatermarks(
  findings: readonly RiskFindingV2[],
  bilingual = false,
): readonly WatermarkPolicyV2[] {
  if (
    !findings.some(
      (candidate) =>
        candidate.impact === "watermark" || candidate.impact === "blockSubmission",
    )
  ) {
    return [];
  }
  return [
    {
      id: "review-required",
      text: localized(
        bilingual ? "国际销售合同草案" : "合同审核稿 · 请先处理风险项",
        bilingual ? "DRAFT INTERNATIONAL SALE CONTRACT" : undefined,
      ),
      scope: "every-page",
    },
  ];
}

export function contractDates(now: string | Date): {
  readonly signingDate: string;
  readonly updatedAt: string;
} {
  const parsed = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(parsed.getTime())) throw new Error("无效时间");
  const updatedAt = parsed.toISOString();
  return { signingDate: updatedAt.slice(0, 10), updatedAt };
}

export function signerBlocks(
  signers: readonly ContractSignerV1[],
  parties: Readonly<Record<string, EntityPartyV2>>,
): readonly DocumentSignerV2[] {
  return signers.map((signer) => ({
    role: signer.role,
    name: signer.signatoryName || parties[signer.partyId]?.legalName || signer.partyId,
    dateLabel: signer.dateLabel,
    sealLabel: signer.sealLabel,
  }));
}

export function exportedAttachments(
  attachments: readonly AttachmentRefV1[],
): readonly AttachmentRefV1[] {
  return attachments.map((attachment) => {
    const { localBlobKey: _localBlobKey, ...safe } = attachment;
    return safe;
  });
}

export function validateSignerPartyReferences(
  signers: readonly ContractSignerV1[],
  allowedPartyIds: readonly string[],
  addIssue: (issue: SafeContractIssue) => void,
): void {
  const allowed = new Set(allowedPartyIds);
  signers.forEach((signer, index) => {
    if (!allowed.has(signer.partyId)) {
      addIssue({
        code: "custom",
        message: "Signer must reference an explicit contract party role",
        path: ["signers", index, "partyId"],
      });
    }
  });
  for (const partyId of allowedPartyIds) {
    if (!signers.some((signer) => signer.partyId === partyId)) {
      addIssue({
        code: "custom",
        message: "Every contract party must have a signer reference",
        path: ["signers"],
      });
    }
  }
}

export function validateAttachmentReferences(
  attachmentIds: readonly string[],
  attachments: readonly AttachmentRefV1[],
  path: readonly PropertyKey[],
  addIssue: (issue: SafeContractIssue) => void,
): void {
  const manifest = new Set(attachments.map((attachment) => attachment.id));
  const seen = new Set<string>();
  attachmentIds.forEach((id, index) => {
    if (seen.has(id)) {
      addIssue({ code: "custom", message: "Attachment references must be unique", path: [...path, index] });
    }
    if (!manifest.has(id)) {
      addIssue({ code: "custom", message: "Attachment reference is missing from manifest", path: [...path, index] });
    }
    seen.add(id);
  });
}
