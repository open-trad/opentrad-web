import { boundedCompositeSchema } from "../../boundaries.js";
import {
  isolatedArraySchema,
  isolatedObjectSchema,
  isolatedValueSchema,
} from "../../safe-schema.js";
import { z } from "../../zod.js";
import {
  type DocumentLanguageV2,
  DocumentLanguageV2Schema,
  type LayoutStyleId,
  LayoutStyleIdSchema,
  type LocalizedText,
} from "../common.js";
import { IdentifierV2Schema } from "../money.js";

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const HTML_PATTERN = /<(?:!doctype|!--|\/?\s*[a-zA-Z][^>]*)>/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TERMS_CHARACTERS = 50_000;
const MAX_SCHEDULE_CHARACTERS = 50_000;
const MAX_SIGNERS_CHARACTERS = 20_000;

export const CISG_CHOICES_V1 = Object.freeze(["apply", "exclude", "undecided"] as const);
export type CisgChoiceV1 = (typeof CISG_CHOICES_V1)[number];

interface ContractMetaBaseV2 {
  readonly contractNumber: string;
  readonly title: string;
  readonly signingDate: string;
  readonly signingPlace?: string;
  readonly copies: number;
  readonly layoutStyleId: LayoutStyleId;
}

type ContractEffectivenessV2 =
  | {
      readonly effectiveMode: "signature";
      readonly effectiveDate?: never;
      readonly effectiveCondition?: never;
    }
  | {
      readonly effectiveMode: "date";
      readonly effectiveDate: string;
      readonly effectiveCondition?: never;
    }
  | {
      readonly effectiveMode: "condition";
      readonly effectiveCondition: string;
      readonly effectiveDate?: never;
    };

type ContractLanguageV2 =
  | {
      readonly language: Exclude<DocumentLanguageV2, "zh-en">;
      readonly languagePriority?: never;
    }
  | {
      readonly language: "zh-en";
      readonly languagePriority: "zh-CN" | "en-US";
    };

export type ContractMetaV2 = ContractMetaBaseV2 & ContractEffectivenessV2 & ContractLanguageV2;

interface ContractGeneralTermsBaseV1 {
  readonly noticeAddresses: string;
  readonly confidentiality: string;
  readonly forceMajeure: string;
  readonly changeControl: string;
  readonly assignment?: string;
  readonly compliance?: string;
  readonly termination: string;
  readonly breachRemedies: string;
  readonly governingLaw: string;
  readonly severability: string;
  readonly entireAgreement: string;
  readonly otherTerms?: string;
}

type ContractDisputeTermsV1 =
  | {
      readonly disputeMethod: "court";
      readonly court: string;
      readonly arbitrationCommission?: never;
    }
  | {
      readonly disputeMethod: "arbitration";
      readonly arbitrationCommission: string;
      readonly court?: never;
    };

export type ContractGeneralTermsV1 = ContractGeneralTermsBaseV1 & ContractDisputeTermsV1;

export interface PaymentMilestoneV1 {
  readonly id: string;
  readonly trigger: string;
  readonly amountBps: number;
  readonly dueDays: number;
}
export type PaymentScheduleV1 = readonly PaymentMilestoneV1[];

export interface ContractSignerV1 {
  readonly partyId: string;
  readonly role: LocalizedText;
  readonly signatoryName?: string;
  readonly signatoryTitle?: string;
  readonly dateLabel: LocalizedText;
  readonly sealLabel: LocalizedText;
}
export type ContractSignersV1 = readonly ContractSignerV1[];

export interface BilingualContractTextV1 {
  readonly zhCN: string;
  readonly enUS: string;
}

interface SafeIssue {
  readonly code: "custom";
  readonly message: string;
  readonly path?: PropertyKey[];
}

type ObjectOutput<Shape extends z.ZodRawShape> = z.output<z.ZodObject<Shape>>;

function strictIsolatedObjectSchema<const Shape extends z.ZodRawShape>(
  shape: Shape,
  refine?: (value: ObjectOutput<Shape>, addIssue: (issue: SafeIssue) => void) => void,
) {
  const isolated = isolatedObjectSchema(shape, refine);
  const allowedKeys = new Set(Object.keys(shape));
  return z.transform<unknown, ObjectOutput<Shape>>((input, context) => {
    try {
      if (input !== null && typeof input === "object" && !Array.isArray(input)) {
        for (const key of Reflect.ownKeys(input)) {
          const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
          if (typeof key !== "string" || !allowedKeys.has(key) || DANGEROUS_KEYS.has(key)) {
            context.addIssue({
              code: "custom",
              message: "Unknown or dangerous object key",
              path: typeof key === "string" ? [key] : [],
            });
          } else if (descriptor && "value" in descriptor && descriptor.value === undefined) {
            context.addIssue({
              code: "custom",
              message: "Undefined is not JSON-safe",
              path: [key],
            });
          }
        }
      }
      if (context.issues.length > 0) return z.NEVER;
      const result = isolated.safeParse(input);
      if (!result.success) {
        for (const issue of result.error.issues) context.addIssue({ ...issue });
        return z.NEVER;
      }
      return result.data;
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
      throw new Error("Validated output must contain only own data properties");
    }
    deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function frozenCompositeSchema<T extends z.ZodType>(
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

function safeText(maximumLength: number, required = false) {
  return z
    .string()
    .max(maximumLength)
    .refine((value) => !required || value.trim().length > 0, "Required text is blank")
    .refine(isXml10Text, "Text is not XML 1.0 safe")
    .refine((value) => !HTML_PATTERN.test(value), "HTML is not allowed");
}

function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function ownStringCharacters(value: object): number {
  let total = 0;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor && typeof descriptor.value === "string") {
      total += descriptor.value.length;
    }
  }
  return total;
}

function localizedTextCharacters(value: LocalizedText): number {
  return value.zhCN.length + (value.enUS?.length ?? 0);
}

const DateV2RawSchema = z.string().refine(isCalendarDate, "Expected a real YYYY-MM-DD date");
const ContractEffectiveModeV2RawSchema = z.enum(["signature", "date", "condition"]);
const LanguagePriorityV2RawSchema = z.enum(["zh-CN", "en-US"]);
const DisputeMethodV1RawSchema = z.enum(["court", "arbitration"]);
const CisgChoiceV1RawSchema = z.enum(CISG_CHOICES_V1);

export const CisgChoiceV1Schema = isolatedValueSchema(CisgChoiceV1RawSchema);

const ContractMetaV2RawSchema = strictIsolatedObjectSchema(
  {
    contractNumber: safeText(64, true),
    title: safeText(300, true),
    signingDate: DateV2RawSchema,
    signingPlace: safeText(300).optional(),
    effectiveMode: ContractEffectiveModeV2RawSchema,
    effectiveDate: DateV2RawSchema.optional(),
    effectiveCondition: safeText(2_000, true).optional(),
    copies: z.number().int().min(1).max(100),
    language: DocumentLanguageV2Schema,
    languagePriority: LanguagePriorityV2RawSchema.optional(),
    layoutStyleId: LayoutStyleIdSchema,
  },
  (meta, addIssue) => {
    const hasEffectiveDate = Object.hasOwn(meta, "effectiveDate");
    const hasEffectiveCondition = Object.hasOwn(meta, "effectiveCondition");
    if (meta.effectiveMode === "signature" && (hasEffectiveDate || hasEffectiveCondition)) {
      addIssue({
        code: "custom",
        message: "Signature effectiveness cannot include date or condition",
        path: ["effectiveMode"],
      });
    }
    if (meta.effectiveMode === "date" && (!hasEffectiveDate || hasEffectiveCondition)) {
      addIssue({
        code: "custom",
        message: "Date effectiveness requires only effectiveDate",
        path: ["effectiveDate"],
      });
    }
    if (meta.effectiveMode === "condition" && (!hasEffectiveCondition || hasEffectiveDate)) {
      addIssue({
        code: "custom",
        message: "Conditional effectiveness requires only effectiveCondition",
        path: ["effectiveCondition"],
      });
    }
    const hasLanguagePriority = Object.hasOwn(meta, "languagePriority");
    if (meta.language === "zh-en" && !hasLanguagePriority) {
      addIssue({
        code: "custom",
        message: "Bilingual contracts require languagePriority",
        path: ["languagePriority"],
      });
    }
    if (meta.language !== "zh-en" && hasLanguagePriority) {
      addIssue({
        code: "custom",
        message: "Monolingual contracts cannot include languagePriority",
        path: ["languagePriority"],
      });
    }
  },
);
export const ContractMetaV2Schema = frozenCompositeSchema(
  ContractMetaV2RawSchema,
) as z.ZodType<ContractMetaV2>;

const ContractGeneralTermsV1RawSchema = strictIsolatedObjectSchema(
  {
    noticeAddresses: safeText(10_000, true),
    confidentiality: safeText(10_000, true),
    forceMajeure: safeText(10_000, true),
    changeControl: safeText(10_000, true),
    assignment: safeText(10_000).optional(),
    compliance: safeText(10_000).optional(),
    termination: safeText(10_000, true),
    breachRemedies: safeText(10_000, true),
    governingLaw: safeText(10_000, true),
    disputeMethod: DisputeMethodV1RawSchema,
    court: safeText(1_000, true).optional(),
    arbitrationCommission: safeText(1_000, true).optional(),
    severability: safeText(10_000, true),
    entireAgreement: safeText(10_000, true),
    otherTerms: safeText(10_000).optional(),
  },
  (terms, addIssue) => {
    const hasCourt = Object.hasOwn(terms, "court");
    const hasArbitrationCommission = Object.hasOwn(terms, "arbitrationCommission");
    if (terms.disputeMethod === "court" && (!hasCourt || hasArbitrationCommission)) {
      addIssue({
        code: "custom",
        message: "Court disputes require only court",
        path: ["court"],
      });
    }
    if (terms.disputeMethod === "arbitration" && (!hasArbitrationCommission || hasCourt)) {
      addIssue({
        code: "custom",
        message: "Arbitration disputes require only arbitrationCommission",
        path: ["arbitrationCommission"],
      });
    }
    if (ownStringCharacters(terms) > MAX_TERMS_CHARACTERS) {
      addIssue({ code: "custom", message: "Contract terms exceed the aggregate text budget" });
    }
  },
);
export const ContractGeneralTermsV1Schema = frozenCompositeSchema(
  ContractGeneralTermsV1RawSchema,
) as z.ZodType<ContractGeneralTermsV1>;

const PaymentMilestoneV1RawSchema = strictIsolatedObjectSchema({
  id: IdentifierV2Schema,
  trigger: safeText(1_000, true),
  amountBps: z.number().int().min(0).max(10_000),
  dueDays: z.number().int().min(0).max(36_500),
});
export const PaymentMilestoneV1Schema = frozenCompositeSchema(
  PaymentMilestoneV1RawSchema,
) as z.ZodType<PaymentMilestoneV1>;

function refinePaymentSchedule(
  milestones: PaymentMilestoneV1[],
  addIssue: (issue: SafeIssue) => void,
): void {
  const seen = new Set<string>();
  let totalAmountBps = 0;
  let totalCharacters = 0;
  milestones.forEach((item, index) => {
    if (seen.has(item.id)) {
      addIssue({ code: "custom", message: "Milestone ids must be unique", path: [index, "id"] });
    }
    seen.add(item.id);
    totalAmountBps += item.amountBps;
    totalCharacters += item.id.length + item.trigger.length;
  });
  if (totalAmountBps !== 10_000) {
    addIssue({ code: "custom", message: "Payment schedule must total exactly 10000 bps" });
  }
  if (totalCharacters > MAX_SCHEDULE_CHARACTERS) {
    addIssue({ code: "custom", message: "Payment schedule exceeds the aggregate text budget" });
  }
}

const PaymentScheduleV1RawSchema = isolatedArraySchema(PaymentMilestoneV1RawSchema, {
  min: 1,
  max: 100,
  refine: refinePaymentSchedule,
});
export const PaymentScheduleV1Schema = frozenCompositeSchema(PaymentScheduleV1RawSchema, {
  arrayLimits: { paymentSchedule: 100 },
  maxTotalValues: 1_000,
}) as z.ZodType<PaymentScheduleV1>;

const ContractLocalizedTextV1RawSchema = strictIsolatedObjectSchema({
  zhCN: safeText(10_000, true),
  enUS: safeText(10_000).optional(),
});

const ContractSignerV1RawSchema = strictIsolatedObjectSchema({
  partyId: IdentifierV2Schema,
  role: ContractLocalizedTextV1RawSchema,
  signatoryName: safeText(200).optional(),
  signatoryTitle: safeText(200).optional(),
  dateLabel: ContractLocalizedTextV1RawSchema,
  sealLabel: ContractLocalizedTextV1RawSchema,
});
export const ContractSignerV1Schema = frozenCompositeSchema(
  ContractSignerV1RawSchema,
) as z.ZodType<ContractSignerV1>;

function refineContractSigners(
  signers: ContractSignerV1[],
  addIssue: (issue: SafeIssue) => void,
): void {
  const seen = new Set<string>();
  let totalCharacters = 0;
  signers.forEach((item, index) => {
    if (seen.has(item.partyId)) {
      addIssue({
        code: "custom",
        message: "Signer party ids must be unique",
        path: [index, "partyId"],
      });
    }
    seen.add(item.partyId);
    totalCharacters +=
      item.partyId.length +
      localizedTextCharacters(item.role) +
      (item.signatoryName?.length ?? 0) +
      (item.signatoryTitle?.length ?? 0) +
      localizedTextCharacters(item.dateLabel) +
      localizedTextCharacters(item.sealLabel);
  });
  if (totalCharacters > MAX_SIGNERS_CHARACTERS) {
    addIssue({ code: "custom", message: "Contract signers exceed the aggregate text budget" });
  }
}

const ContractSignersV1RawSchema = isolatedArraySchema(ContractSignerV1RawSchema, {
  min: 1,
  max: 10,
  refine: refineContractSigners,
});
export const ContractSignersV1Schema = frozenCompositeSchema(ContractSignersV1RawSchema, {
  arrayLimits: { signers: 10 },
  maxTotalValues: 200,
}) as z.ZodType<ContractSignersV1>;

const BilingualContractTextV1RawSchema = strictIsolatedObjectSchema({
  zhCN: safeText(10_000, true),
  enUS: safeText(10_000, true),
});
export const BilingualContractTextV1Schema = frozenCompositeSchema(
  BilingualContractTextV1RawSchema,
) as z.ZodType<BilingualContractTextV1>;
