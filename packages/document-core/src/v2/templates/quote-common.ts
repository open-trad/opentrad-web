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
} from "../common.js";
import {
  BasisPointsV2Schema,
  type CurrencyV2,
  CurrencyV2Schema,
  IdentifierV2Schema,
  MoneyMinorV2Schema,
  QuantityV2Schema,
  type TaxModeV2,
  TaxModeV2Schema,
} from "../money.js";

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const HTML_PATTERN = /<(?:!doctype|!--|\/?\s*[a-zA-Z][^>]*)>/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const QUOTE_NATURES_V2 = Object.freeze(["invitation", "binding-offer"] as const);
export type QuoteNatureV2 = (typeof QUOTE_NATURES_V2)[number];

export const INCOTERMS_2020_RULES = Object.freeze([
  "EXW",
  "FCA",
  "CPT",
  "CIP",
  "DAP",
  "DPU",
  "DDP",
  "FAS",
  "FOB",
  "CFR",
  "CIF",
] as const);
export type IncotermsRuleV2 = (typeof INCOTERMS_2020_RULES)[number];

export interface QuoteMetaV2 {
  readonly number: string;
  readonly title: string;
  readonly englishTitle?: string;
  readonly issueDate: string;
  readonly validUntil: string;
  readonly currency: CurrencyV2;
  readonly taxMode: TaxModeV2;
  readonly quoteNature: QuoteNatureV2;
  readonly language: DocumentLanguageV2;
  readonly layoutStyleId: LayoutStyleId;
}

export interface PartyV2 {
  readonly legalName: string;
  readonly englishName?: string;
  readonly entityType: "company" | "organization" | "individual";
  readonly registrationId?: string;
  readonly taxId?: string;
  readonly registeredAddress?: string;
  readonly postalAddress?: string;
  readonly legalRepresentative?: string;
  readonly authorizedRepresentative?: string;
  readonly contactName: string;
  readonly phone?: string;
  readonly email?: string;
  readonly bankAccountName?: string;
  readonly bankName?: string;
  readonly bankAccount?: string;
  readonly swiftCode?: string;
}

export interface GoodsLineV2 {
  readonly id: string;
  readonly name: string;
  readonly englishName?: string;
  readonly sku?: string;
  readonly specification?: string;
  readonly description?: string;
  readonly unit: string;
  readonly quantity: string;
  readonly unitPriceMinor: string;
  readonly discountBps: number;
  readonly taxRateBps: number;
  readonly countryOfOrigin?: string;
  readonly hsCodeUserSupplied?: string;
  readonly netWeightKg?: string;
  readonly grossWeightKg?: string;
  readonly lengthCm?: string;
  readonly widthCm?: string;
  readonly heightCm?: string;
}

export interface ServiceLineV2 {
  readonly id: string;
  readonly serviceName: string;
  readonly englishName?: string;
  readonly deliverable: string;
  readonly unit: string;
  readonly quantity: string;
  readonly unitPriceMinor: string;
  readonly discountBps: number;
  readonly taxRateBps: number;
  readonly estimatedHours?: string;
  readonly milestoneId?: string;
}

export interface IncotermsSelectionV2 {
  readonly rule: IncotermsRuleV2;
  readonly edition: "2020";
  readonly namedPlace: string;
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
          if (typeof key !== "string" || !allowedKeys.has(key) || DANGEROUS_KEYS.has(key)) {
            context.addIssue({
              code: "custom",
              message: "Unknown or dangerous object key",
              path: typeof key === "string" ? [key] : [],
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
  policy: { readonly arrayLimits?: Readonly<Record<string, number>> } = {},
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

const DateV2RawSchema = z.string().refine(isCalendarDate, "Expected a real YYYY-MM-DD date");
const QuoteNatureV2RawSchema = z.enum(QUOTE_NATURES_V2);
const MeasurementV2RawSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,5})(?:\.\d{1,3})?$/)
  .refine((value) => !/^0(?:\.0+)?$/.test(value), "Measurement must be positive");
const HsCodeUserSuppliedV2RawSchema = z
  .string()
  .max(32)
  .regex(/^[0-9]+(?:[. -][0-9]+){0,3}$/)
  .refine(
    (value) => value.replace(/[. -]/g, "").length <= 12,
    "HS code must contain at most twelve ASCII digits",
  );
const IncotermsRuleV2RawSchema = z.enum(INCOTERMS_2020_RULES);
const IncotermsEdition2020V2RawSchema = z.literal("2020");

export const DateV2Schema = isolatedValueSchema(DateV2RawSchema);
export const QuoteNatureV2Schema = isolatedValueSchema(QuoteNatureV2RawSchema);
export const WeightKgV2Schema = isolatedValueSchema(MeasurementV2RawSchema);
export const DimensionCmV2Schema = isolatedValueSchema(MeasurementV2RawSchema);
export const HsCodeUserSuppliedV2Schema = isolatedValueSchema(HsCodeUserSuppliedV2RawSchema);
export const IncotermsRuleV2Schema = isolatedValueSchema(IncotermsRuleV2RawSchema);
export const IncotermsEdition2020V2Schema = isolatedValueSchema(IncotermsEdition2020V2RawSchema);

const QuoteMetaV2RawSchema = strictIsolatedObjectSchema(
  {
    number: safeText(64, true),
    title: safeText(300, true),
    englishTitle: safeText(300, true).optional(),
    issueDate: DateV2RawSchema,
    validUntil: DateV2RawSchema,
    currency: CurrencyV2Schema,
    taxMode: TaxModeV2Schema,
    quoteNature: QuoteNatureV2RawSchema,
    language: DocumentLanguageV2Schema,
    layoutStyleId: LayoutStyleIdSchema,
  },
  (meta, addIssue) => {
    if (meta.validUntil < meta.issueDate) {
      addIssue({
        code: "custom",
        message: "validUntil must be on or after issueDate",
        path: ["validUntil"],
      });
    }
    if (meta.language === "zh-en" && !meta.englishTitle) {
      addIssue({
        code: "custom",
        message: "Bilingual quotation metadata requires an English title",
        path: ["englishTitle"],
      });
    }
  },
);
export const QuoteMetaV2Schema = frozenCompositeSchema(QuoteMetaV2RawSchema);

const PartyV2RawSchema = strictIsolatedObjectSchema({
  legalName: safeText(200, true),
  englishName: safeText(200).optional(),
  entityType: z.enum(["company", "organization", "individual"]),
  registrationId: safeText(100).optional(),
  taxId: safeText(100).optional(),
  registeredAddress: safeText(500).optional(),
  postalAddress: safeText(500).optional(),
  legalRepresentative: safeText(100).optional(),
  authorizedRepresentative: safeText(100).optional(),
  contactName: safeText(100, true),
  phone: safeText(50).optional(),
  email: safeText(254).optional(),
  bankAccountName: safeText(200).optional(),
  bankName: safeText(200).optional(),
  bankAccount: safeText(100).optional(),
  swiftCode: safeText(50).optional(),
});
export const PartyV2Schema = frozenCompositeSchema(PartyV2RawSchema);

const GoodsLineV2RawSchema = strictIsolatedObjectSchema({
  id: IdentifierV2Schema,
  name: safeText(300, true),
  englishName: safeText(300).optional(),
  sku: safeText(100).optional(),
  specification: safeText(500).optional(),
  description: safeText(2_000).optional(),
  unit: safeText(50, true),
  quantity: QuantityV2Schema,
  unitPriceMinor: MoneyMinorV2Schema,
  discountBps: BasisPointsV2Schema,
  taxRateBps: BasisPointsV2Schema,
  countryOfOrigin: safeText(100).optional(),
  hsCodeUserSupplied: HsCodeUserSuppliedV2RawSchema.optional(),
  netWeightKg: MeasurementV2RawSchema.optional(),
  grossWeightKg: MeasurementV2RawSchema.optional(),
  lengthCm: MeasurementV2RawSchema.optional(),
  widthCm: MeasurementV2RawSchema.optional(),
  heightCm: MeasurementV2RawSchema.optional(),
});
export const GoodsLineV2Schema = frozenCompositeSchema(GoodsLineV2RawSchema);

const ServiceLineV2RawSchema = strictIsolatedObjectSchema({
  id: IdentifierV2Schema,
  serviceName: safeText(300, true),
  englishName: safeText(300).optional(),
  deliverable: safeText(1_000, true),
  unit: safeText(50, true),
  quantity: QuantityV2Schema,
  unitPriceMinor: MoneyMinorV2Schema,
  discountBps: BasisPointsV2Schema,
  taxRateBps: BasisPointsV2Schema,
  estimatedHours: QuantityV2Schema.optional(),
  milestoneId: IdentifierV2Schema.optional(),
});
export const ServiceLineV2Schema = frozenCompositeSchema(ServiceLineV2RawSchema);

function uniqueLineIds(
  values: readonly { readonly id: string }[],
  addIssue: (issue: SafeIssue) => void,
): void {
  const seen = new Set<string>();
  values.forEach((line, index) => {
    if (seen.has(line.id)) {
      addIssue({ code: "custom", message: "Line ids must be unique", path: [index, "id"] });
    }
    seen.add(line.id);
  });
}

const GoodsLinesV2RawSchema = isolatedArraySchema(GoodsLineV2RawSchema, {
  min: 1,
  max: 100,
  refine: uniqueLineIds,
});
export const GoodsLinesV2Schema = frozenCompositeSchema(GoodsLinesV2RawSchema, {
  arrayLimits: { lines: 100 },
});

const ServiceLinesV2RawSchema = isolatedArraySchema(ServiceLineV2RawSchema, {
  min: 1,
  max: 100,
  refine: uniqueLineIds,
});
export const ServiceLinesV2Schema = frozenCompositeSchema(ServiceLinesV2RawSchema, {
  arrayLimits: { lines: 100 },
});

const IncotermsSelectionV2RawSchema = strictIsolatedObjectSchema({
  rule: IncotermsRuleV2RawSchema,
  edition: IncotermsEdition2020V2RawSchema,
  namedPlace: safeText(300, true),
});
export const IncotermsSelectionV2Schema = frozenCompositeSchema(IncotermsSelectionV2RawSchema);
