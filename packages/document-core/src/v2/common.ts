import { boundedCompositeSchema } from "../boundaries.js";
import { isolatedArraySchema, isolatedObjectSchema, isolatedValueSchema } from "../safe-schema.js";
import { z } from "../zod.js";
import { OFFICIAL_SOURCES, type OfficialSourceKey } from "./source-basis.js";

export const TEMPLATE_IDS_V2 = Object.freeze([
  "quotation.service.project.v1",
  "quotation.oem.custom.v1",
  "quotation.export.bilingual.v1",
  "quotation.proforma.invoice.v1",
  "contract.sale.domestic-b2b.v1",
  "contract.supply.framework.v1",
  "contract.oem.processing.v1",
  "contract.service.commercial.v1",
  "contract.sale.international-bilingual.v1",
  "bid.government.goods.v1",
  "bid.government.services.v1",
  "bid.construction.works.v1",
  "bid.enterprise.goods.v1",
  "bid.enterprise.services.v1",
] as const);

export type TemplateIdV2 = (typeof TEMPLATE_IDS_V2)[number];
export type TemplateVersionV2 = "1.0.0";
export type TemplateCategoryV2 = "quotation" | "contract" | "bid";
export type DocumentLanguageV2 = "zh-CN" | "en-US" | "zh-en";
export type LayoutStyleId = "classic-formal.v1" | "modern-business.v1" | "international-compact.v1";
export type SupportedOutputV2 = "docx" | "pdf" | "json" | "opentrad";

export interface LocalizedText {
  readonly zhCN: string;
  readonly enUS?: string;
}

export interface TemplateFieldManifestEntryV1 {
  readonly path: string;
  readonly section: string;
  readonly label: string;
  readonly control:
    | "text"
    | "textarea"
    | "date"
    | "datetime"
    | "number"
    | "money"
    | "percent"
    | "select"
    | "checkbox"
    | "repeatable"
    | "attachment";
  readonly required: boolean;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly visibleWhen?: { readonly path: string; readonly equals: string | boolean };
}

export interface TemplateDefinitionV2 {
  readonly id: TemplateIdV2;
  readonly version: TemplateVersionV2;
  readonly category: TemplateCategoryV2;
  readonly name: string;
  readonly summary: string;
  readonly basisDate: "2026-08-19";
  readonly languages: readonly DocumentLanguageV2[];
  readonly defaultLanguage: DocumentLanguageV2;
  readonly allowedLayouts: readonly LayoutStyleId[];
  readonly defaultLayout: LayoutStyleId;
  readonly supportedOutputs: readonly SupportedOutputV2[];
  readonly sourceKeys: readonly OfficialSourceKey[];
  readonly disclaimerProfile: "quotation" | "contract" | "international" | "bid";
  readonly fieldManifest: readonly TemplateFieldManifestEntryV1[];
}

export interface EntityPartyV2 {
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

const HTML_PATTERN = /<(?:!doctype|!--|\/?\s*[a-zA-Z][^>]*)>/i;
const SAFE_FIELD_PATH_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/;
const DANGEROUS_PATH_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

function isXml10Text(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || !Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
    if (codeUnit === 0x09 || codeUnit === 0x0a || codeUnit === 0x0d) continue;
    if (codeUnit < 0x20 || codeUnit === 0xfffe || codeUnit === 0xffff) return false;
  }
  return true;
}

function plainText(maxLength: number) {
  return z
    .string()
    .max(maxLength)
    .refine(isXml10Text, "Text contains characters forbidden by XML 1.0")
    .refine((value) => !HTML_PATTERN.test(value), "HTML is not allowed");
}

function requiredPlainText(maxLength: number) {
  return plainText(maxLength).refine((value) => value.trim().length > 0, "Required text is blank");
}

function uniqueValues(values: readonly string[], addIssue: (issue: SafeIssue) => void): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      addIssue({ code: "custom", message: "Entries must be unique", path: [index] });
    }
    seen.add(value);
  });
}

interface SafeIssue {
  code: "custom";
  message: string;
  path?: PropertyKey[];
}

const TemplateIdV2RawSchema = z.enum(TEMPLATE_IDS_V2);
const TemplateVersionV2RawSchema = z.literal("1.0.0");
const TemplateCategoryV2RawSchema = z.enum(["quotation", "contract", "bid"]);
const DocumentLanguageV2RawSchema = z.enum(["zh-CN", "en-US", "zh-en"]);
const LayoutStyleIdRawSchema = z.enum([
  "classic-formal.v1",
  "modern-business.v1",
  "international-compact.v1",
]);
const SupportedOutputV2RawSchema = z.enum(["docx", "pdf", "json", "opentrad"]);
const OfficialSourceKeyRawSchema = z.enum(
  Object.keys(OFFICIAL_SOURCES) as [OfficialSourceKey, ...OfficialSourceKey[]],
);
const DisclaimerProfileRawSchema = z.enum(["quotation", "contract", "international", "bid"]);

export const TemplateIdV2Schema = isolatedValueSchema(TemplateIdV2RawSchema);
export const TemplateVersionV2Schema = isolatedValueSchema(TemplateVersionV2RawSchema);
export const TemplateCategoryV2Schema = isolatedValueSchema(TemplateCategoryV2RawSchema);
export const DocumentLanguageV2Schema = isolatedValueSchema(DocumentLanguageV2RawSchema);
export const LayoutStyleIdSchema = isolatedValueSchema(LayoutStyleIdRawSchema);
export const SupportedOutputV2Schema = isolatedValueSchema(SupportedOutputV2RawSchema);

const LocalizedTextRawSchema = isolatedObjectSchema({
  zhCN: requiredPlainText(10_000),
  enUS: plainText(10_000).optional(),
});
export const LocalizedTextSchema = boundedCompositeSchema(LocalizedTextRawSchema);

const FieldPathRawSchema = requiredPlainText(300)
  .regex(SAFE_FIELD_PATH_PATTERN, "Expected a safe dot-separated field path")
  .refine(
    (path) => path.split(".").every((segment) => !DANGEROUS_PATH_SEGMENTS.has(segment)),
    "Dangerous field path segment",
  );

const TemplateFieldOptionRawSchema = isolatedObjectSchema({
  value: requiredPlainText(200),
  label: requiredPlainText(300),
});

const TemplateFieldVisibleWhenRawSchema = isolatedObjectSchema({
  path: FieldPathRawSchema,
  equals: z.union([plainText(300), z.boolean()]),
});

const TemplateFieldManifestEntryV1RawSchema = isolatedObjectSchema({
  path: FieldPathRawSchema,
  section: requiredPlainText(100),
  label: requiredPlainText(300),
  control: z.enum([
    "text",
    "textarea",
    "date",
    "datetime",
    "number",
    "money",
    "percent",
    "select",
    "checkbox",
    "repeatable",
    "attachment",
  ]),
  required: z.boolean(),
  options: isolatedArraySchema(TemplateFieldOptionRawSchema, { max: 100 }).optional(),
  visibleWhen: TemplateFieldVisibleWhenRawSchema.optional(),
});
export const TemplateFieldManifestEntryV1Schema = boundedCompositeSchema(
  TemplateFieldManifestEntryV1RawSchema,
  { arrayLimits: { options: 100 } },
);

const LanguagesRawSchema = isolatedArraySchema(DocumentLanguageV2RawSchema, {
  min: 1,
  max: 3,
  refine: uniqueValues,
});
const LayoutsRawSchema = isolatedArraySchema(LayoutStyleIdRawSchema, {
  min: 1,
  max: 3,
  refine: uniqueValues,
});
const OutputsRawSchema = isolatedArraySchema(SupportedOutputV2RawSchema, {
  min: 1,
  max: 4,
  refine: uniqueValues,
});
const SourcesRawSchema = isolatedArraySchema(OfficialSourceKeyRawSchema, {
  min: 1,
  max: 11,
  refine: uniqueValues,
});
const FieldManifestRawSchema = isolatedArraySchema(TemplateFieldManifestEntryV1RawSchema, {
  max: 100,
  refine: (fields, addIssue) =>
    uniqueValues(
      fields.map((field) => field.path),
      addIssue,
    ),
});

const TemplateDefinitionV2RawSchema = isolatedObjectSchema(
  {
    id: TemplateIdV2RawSchema,
    version: TemplateVersionV2RawSchema,
    category: TemplateCategoryV2RawSchema,
    name: requiredPlainText(300),
    summary: requiredPlainText(1_000),
    basisDate: z.literal("2026-08-19"),
    languages: LanguagesRawSchema,
    defaultLanguage: DocumentLanguageV2RawSchema,
    allowedLayouts: LayoutsRawSchema,
    defaultLayout: LayoutStyleIdRawSchema,
    supportedOutputs: OutputsRawSchema,
    sourceKeys: SourcesRawSchema,
    disclaimerProfile: DisclaimerProfileRawSchema,
    fieldManifest: FieldManifestRawSchema,
  },
  (definition, addIssue) => {
    if (!definition.languages.includes(definition.defaultLanguage)) {
      addIssue({
        code: "custom",
        message: "Default language must be allowed",
        path: ["defaultLanguage"],
      });
    }
    if (!definition.allowedLayouts.includes(definition.defaultLayout)) {
      addIssue({
        code: "custom",
        message: "Default layout must be allowed",
        path: ["defaultLayout"],
      });
    }
    if (!definition.id.startsWith(`${definition.category}.`)) {
      addIssue({
        code: "custom",
        message: "Template category must match its id",
        path: ["category"],
      });
    }
  },
);
export const TemplateDefinitionV2Schema = boundedCompositeSchema(TemplateDefinitionV2RawSchema, {
  arrayLimits: {
    languages: 3,
    allowedLayouts: 3,
    supportedOutputs: 4,
    sourceKeys: 11,
    fieldManifest: 100,
    options: 100,
  },
});

const EntityPartyV2RawSchema = isolatedObjectSchema({
  legalName: requiredPlainText(200),
  englishName: plainText(200).optional(),
  entityType: z.enum(["company", "organization", "individual"]),
  registrationId: plainText(100).optional(),
  taxId: plainText(100).optional(),
  registeredAddress: plainText(500).optional(),
  postalAddress: plainText(500).optional(),
  legalRepresentative: plainText(100).optional(),
  authorizedRepresentative: plainText(100).optional(),
  contactName: requiredPlainText(100),
  phone: plainText(50).optional(),
  email: plainText(254).optional(),
  bankAccountName: plainText(200).optional(),
  bankName: plainText(200).optional(),
  bankAccount: plainText(100).optional(),
  swiftCode: plainText(50).optional(),
});
export const EntityPartyV2Schema = boundedCompositeSchema(EntityPartyV2RawSchema);

export const ClauseTextV2Schema = isolatedValueSchema(plainText(10_000));
