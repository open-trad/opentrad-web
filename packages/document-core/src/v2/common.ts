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

export type TemplateFieldControlV1 =
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

export type TemplateFieldValueKindV1 =
  | "string"
  | "localized-text"
  | "date"
  | "offset-datetime"
  | "integer"
  | "decimal-string"
  | "money-minor"
  | "basis-points"
  | "boolean"
  | "enum"
  | "object-list"
  | "string-list"
  | "attachment-id"
  | "attachment-id-list";

export interface TemplateFieldOptionV1 {
  readonly value: string;
  readonly label: string;
}

export interface TemplateFieldVisibleWhenV1 {
  readonly path: string;
  readonly equals: string | boolean;
}

interface TemplateFieldBaseV1 {
  readonly path: string;
  readonly section: string;
  readonly label: string;
  readonly required: boolean;
  readonly visibleWhen?: TemplateFieldVisibleWhenV1;
}

type TemplateScalarEditorShapeV1 =
  | {
      readonly control: "text" | "textarea";
      readonly valueKind: "string" | "localized-text";
      readonly options?: never;
    }
  | {
      readonly control: "date";
      readonly valueKind: "date";
      readonly options?: never;
    }
  | {
      readonly control: "datetime";
      readonly valueKind: "offset-datetime";
      readonly options?: never;
    }
  | {
      readonly control: "number";
      readonly valueKind: "integer" | "decimal-string";
      readonly options?: never;
    }
  | {
      readonly control: "money";
      readonly valueKind: "money-minor";
      readonly options?: never;
    }
  | {
      readonly control: "percent";
      readonly valueKind: "basis-points";
      readonly options?: never;
    }
  | {
      readonly control: "select";
      readonly valueKind: "enum";
      readonly options: readonly TemplateFieldOptionV1[];
    }
  | {
      readonly control: "checkbox";
      readonly valueKind: "boolean";
      readonly options?: never;
    };

export interface TemplateAttachmentEditorMetadataV1 {
  readonly cardinality: "single" | "multiple";
  readonly maxItems: number;
  readonly descriptorPath: "attachments";
  readonly role: "source" | "submission" | "supporting";
  readonly category: "qualification" | "technical" | "commercial" | "other";
  readonly allowedMediaTypes: readonly ("application/pdf" | "image/png" | "image/jpeg")[];
  readonly pdfPageCount: "user-confirmed";
  readonly includeInSubmissionDefault: boolean;
}

interface TemplateRepeatableItemFieldBaseV1 {
  readonly path: string;
  readonly label: string;
  readonly required: boolean;
  readonly visibleWhen?: TemplateFieldVisibleWhenV1;
}

export type TemplateRepeatableItemFieldV1 = TemplateRepeatableItemFieldBaseV1 &
  (
    | TemplateScalarEditorShapeV1
    | ({
        readonly control: "attachment";
        readonly valueKind: "attachment-id" | "attachment-id-list";
        readonly options?: never;
      } & TemplateAttachmentEditorMetadataV1)
  );

export interface TemplateObjectListItemSpecV1 {
  readonly kind: "object";
  readonly idPath?: string;
  readonly fields: readonly TemplateRepeatableItemFieldV1[];
}

export interface TemplateStringListItemSpecV1 {
  readonly kind: "value";
  readonly label: string;
  readonly control: "text" | "textarea";
  readonly valueKind: "string";
}

type TemplateLegacyFieldManifestEntryV1 = TemplateFieldBaseV1 & {
  readonly control: TemplateFieldControlV1;
  readonly valueKind?: undefined;
  readonly options?: readonly TemplateFieldOptionV1[];
};

type TemplateRepeatableFieldManifestEntryV1 = TemplateFieldBaseV1 & {
  readonly control: "repeatable";
  readonly required: boolean;
  readonly minItems: number;
  readonly maxItems: number;
  readonly options?: never;
} & (
    | {
        readonly valueKind: "object-list";
        readonly item: TemplateObjectListItemSpecV1;
      }
    | {
        readonly valueKind: "string-list";
        readonly item: TemplateStringListItemSpecV1;
      }
  );

type TemplateAttachmentFieldManifestEntryV1 = TemplateFieldBaseV1 &
  TemplateAttachmentEditorMetadataV1 & {
    readonly control: "attachment";
    readonly valueKind: "attachment-id" | "attachment-id-list";
    readonly options?: never;
  };

export type TemplateFieldManifestEntryV1 = TemplateFieldBaseV1 &
  (
    | TemplateLegacyFieldManifestEntryV1
    | TemplateScalarEditorShapeV1
    | TemplateRepeatableFieldManifestEntryV1
    | TemplateAttachmentFieldManifestEntryV1
  );

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
  .refine((path) => path.split(".").length <= 4, "Field paths may contain at most four segments")
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

const TemplateFieldControlRawSchema = z.enum([
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
]);
const TemplateFieldValueKindRawSchema = z.enum([
  "string",
  "localized-text",
  "date",
  "offset-datetime",
  "integer",
  "decimal-string",
  "money-minor",
  "basis-points",
  "boolean",
  "enum",
  "object-list",
  "string-list",
  "attachment-id",
  "attachment-id-list",
]);
const TemplateFieldOptionsRawSchema = isolatedArraySchema(TemplateFieldOptionRawSchema, {
  max: 100,
});
const AttachmentMediaTypeRawSchema = z.enum(["application/pdf", "image/png", "image/jpeg"]);
const AttachmentMediaTypesRawSchema = isolatedArraySchema(AttachmentMediaTypeRawSchema, {
  min: 1,
  max: 3,
  refine: uniqueValues,
});
const EditorArrayBoundRawSchema = z.number().int().min(0).max(100);

const SCALAR_CONTROL_VALUE_KINDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  text: Object.freeze(["string", "localized-text"]),
  textarea: Object.freeze(["string", "localized-text"]),
  date: Object.freeze(["date"]),
  datetime: Object.freeze(["offset-datetime"]),
  number: Object.freeze(["integer", "decimal-string"]),
  money: Object.freeze(["money-minor"]),
  percent: Object.freeze(["basis-points"]),
  select: Object.freeze(["enum"]),
  checkbox: Object.freeze(["boolean"]),
});
const LIST_METADATA_KEYS = ["minItems", "maxItems", "item"] as const;
const ATTACHMENT_METADATA_KEYS = [
  "cardinality",
  "maxItems",
  "descriptorPath",
  "role",
  "category",
  "allowedMediaTypes",
  "pdfPageCount",
  "includeInSubmissionDefault",
] as const;

function hasOwnValue(value: object, key: PropertyKey): boolean {
  return Object.hasOwn(value, key);
}

function rejectPresentKeys(
  value: object,
  keys: readonly string[],
  addIssue: (issue: SafeIssue) => void,
): void {
  for (const key of keys) {
    if (hasOwnValue(value, key)) {
      addIssue({
        code: "custom",
        message: `${key} is not allowed for this editor field`,
        path: [key],
      });
    }
  }
}

function validateOptions(
  field: Record<string, unknown>,
  addIssue: (issue: SafeIssue) => void,
): void {
  const options = field.options;
  if (!Array.isArray(options) || options.length === 0) {
    addIssue({
      code: "custom",
      message: "Select fields require non-empty options",
      path: ["options"],
    });
    return;
  }
  uniqueValues(
    options.map((option) => (option as { value: string }).value),
    (issue) => addIssue({ ...issue, path: ["options", ...(issue.path ?? [])] }),
  );
}

function validateAttachmentMetadata(
  field: Record<string, unknown>,
  addIssue: (issue: SafeIssue) => void,
): void {
  for (const key of ATTACHMENT_METADATA_KEYS) {
    if (!hasOwnValue(field, key)) {
      addIssue({ code: "custom", message: `Attachment fields require ${key}`, path: [key] });
    }
  }
  const valueKind = field.valueKind;
  if (valueKind === "attachment-id") {
    if (field.cardinality !== "single" || field.maxItems !== 1) {
      addIssue({
        code: "custom",
        message: "Single attachment ids require single cardinality and maxItems 1",
      });
    }
  } else if (
    valueKind === "attachment-id-list" &&
    (field.cardinality !== "multiple" || typeof field.maxItems !== "number" || field.maxItems < 1)
  ) {
    addIssue({
      code: "custom",
      message: "Attachment id lists require multiple cardinality and a positive maxItems",
    });
  }
}

function validateTypedScalarOrAttachment(
  field: Record<string, unknown>,
  addIssue: (issue: SafeIssue) => void,
): void {
  const control = field.control;
  const valueKind = field.valueKind;
  if (typeof control !== "string" || typeof valueKind !== "string") return;
  const allowedKinds = SCALAR_CONTROL_VALUE_KINDS[control];
  if (allowedKinds) {
    if (!allowedKinds.includes(valueKind)) {
      addIssue({ code: "custom", message: "control and valueKind do not match" });
    }
    if (control === "select") validateOptions(field, addIssue);
    else if (hasOwnValue(field, "options")) {
      addIssue({
        code: "custom",
        message: "Only select fields may define options",
        path: ["options"],
      });
    }
    rejectPresentKeys(field, [...LIST_METADATA_KEYS, ...ATTACHMENT_METADATA_KEYS], addIssue);
    return;
  }
  if (control === "attachment") {
    if (valueKind !== "attachment-id" && valueKind !== "attachment-id-list") {
      addIssue({ code: "custom", message: "Attachment control requires an attachment valueKind" });
    }
    if (hasOwnValue(field, "options")) {
      addIssue({
        code: "custom",
        message: "Attachment fields may not define options",
        path: ["options"],
      });
    }
    rejectPresentKeys(field, ["minItems", "item"], addIssue);
    validateAttachmentMetadata(field, addIssue);
    return;
  }
  addIssue({ code: "custom", message: "Expected a scalar or attachment editor field" });
}

const TemplateRepeatableItemFieldRawSchema = isolatedObjectSchema(
  {
    path: FieldPathRawSchema,
    label: requiredPlainText(300),
    control: TemplateFieldControlRawSchema,
    valueKind: TemplateFieldValueKindRawSchema,
    required: z.boolean(),
    options: TemplateFieldOptionsRawSchema.optional(),
    visibleWhen: TemplateFieldVisibleWhenRawSchema.optional(),
    cardinality: z.enum(["single", "multiple"]).optional(),
    maxItems: EditorArrayBoundRawSchema.optional(),
    descriptorPath: z.literal("attachments").optional(),
    role: z.enum(["source", "submission", "supporting"]).optional(),
    category: z.enum(["qualification", "technical", "commercial", "other"]).optional(),
    allowedMediaTypes: AttachmentMediaTypesRawSchema.optional(),
    pdfPageCount: z.literal("user-confirmed").optional(),
    includeInSubmissionDefault: z.boolean().optional(),
  },
  (field, addIssue) => validateTypedScalarOrAttachment(field as Record<string, unknown>, addIssue),
);

const TemplateObjectListItemRawSchema = isolatedObjectSchema({
  kind: z.literal("object"),
  idPath: FieldPathRawSchema.optional(),
  fields: isolatedArraySchema(TemplateRepeatableItemFieldRawSchema, {
    min: 1,
    max: 100,
    refine: (fields, addIssue) =>
      uniqueValues(
        fields.map((field) => field.path),
        addIssue,
      ),
  }),
});
const TemplateStringListItemRawSchema = isolatedObjectSchema({
  kind: z.literal("value"),
  label: requiredPlainText(300),
  control: z.enum(["text", "textarea"]),
  valueKind: z.literal("string"),
});
const TemplateRepeatableItemRawSchema = z.union([
  TemplateObjectListItemRawSchema,
  TemplateStringListItemRawSchema,
]);

const TemplateFieldManifestEntryV1RawSchema = isolatedObjectSchema(
  {
    path: FieldPathRawSchema,
    section: requiredPlainText(100),
    label: requiredPlainText(300),
    control: TemplateFieldControlRawSchema,
    valueKind: TemplateFieldValueKindRawSchema.optional(),
    required: z.boolean(),
    options: TemplateFieldOptionsRawSchema.optional(),
    visibleWhen: TemplateFieldVisibleWhenRawSchema.optional(),
    minItems: EditorArrayBoundRawSchema.optional(),
    maxItems: EditorArrayBoundRawSchema.optional(),
    item: TemplateRepeatableItemRawSchema.optional(),
    cardinality: z.enum(["single", "multiple"]).optional(),
    descriptorPath: z.literal("attachments").optional(),
    role: z.enum(["source", "submission", "supporting"]).optional(),
    category: z.enum(["qualification", "technical", "commercial", "other"]).optional(),
    allowedMediaTypes: AttachmentMediaTypesRawSchema.optional(),
    pdfPageCount: z.literal("user-confirmed").optional(),
    includeInSubmissionDefault: z.boolean().optional(),
  },
  (field, addIssue) => {
    const record = field as Record<string, unknown>;
    if (record.valueKind === undefined) {
      rejectPresentKeys(record, [...LIST_METADATA_KEYS, ...ATTACHMENT_METADATA_KEYS], addIssue);
      if (Array.isArray(record.options)) {
        uniqueValues(
          record.options.map((option) => (option as { value: string }).value),
          (issue) => addIssue({ ...issue, path: ["options", ...(issue.path ?? [])] }),
        );
      }
      return;
    }
    if (record.control === "repeatable") {
      if (record.valueKind !== "object-list" && record.valueKind !== "string-list") {
        addIssue({ code: "custom", message: "Repeatable control requires a list valueKind" });
      }
      if (
        typeof record.minItems !== "number" ||
        typeof record.maxItems !== "number" ||
        record.minItems > record.maxItems
      ) {
        addIssue({ code: "custom", message: "Repeatable fields require ordered item bounds" });
      }
      const item = record.item as Record<string, unknown> | undefined;
      if (!item) {
        addIssue({
          code: "custom",
          message: "Repeatable fields require an item spec",
          path: ["item"],
        });
      } else if (
        (record.valueKind === "object-list" && item.kind !== "object") ||
        (record.valueKind === "string-list" && item.kind !== "value")
      ) {
        addIssue({
          code: "custom",
          message: "List valueKind and item spec do not match",
          path: ["item"],
        });
      }
      if (hasOwnValue(record, "options")) {
        addIssue({
          code: "custom",
          message: "Repeatable fields may not define options",
          path: ["options"],
        });
      }
      rejectPresentKeys(
        record,
        ATTACHMENT_METADATA_KEYS.filter((key) => key !== "maxItems"),
        addIssue,
      );
      return;
    }
    rejectPresentKeys(record, ["minItems", "item"], addIssue);
    validateTypedScalarOrAttachment(record, addIssue);
  },
);
export const TemplateFieldManifestEntryV1Schema = boundedCompositeSchema(
  TemplateFieldManifestEntryV1RawSchema,
  { arrayLimits: { options: 100 } },
) as z.ZodType<TemplateFieldManifestEntryV1>;

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

function visibleValueType(field: Record<string, unknown>): "boolean" | "string" | undefined {
  if (field.valueKind === undefined) {
    if (field.control === "checkbox") return "boolean";
    if (
      field.control === "text" ||
      field.control === "textarea" ||
      field.control === "date" ||
      field.control === "datetime" ||
      field.control === "select"
    ) {
      return "string";
    }
    return undefined;
  }
  if (field.valueKind === "boolean") {
    return "boolean";
  }
  if (
    field.valueKind === "string" ||
    field.valueKind === "date" ||
    field.valueKind === "offset-datetime" ||
    field.valueKind === "decimal-string" ||
    field.valueKind === "money-minor" ||
    field.valueKind === "attachment-id" ||
    field.valueKind === "enum"
  ) {
    return "string";
  }
  return undefined;
}

function validateVisibleConditions(
  fields: readonly Record<string, unknown>[],
  addIssue: (issue: SafeIssue) => void,
  prefix: readonly PropertyKey[],
): void {
  const byPath = new Map(fields.map((field) => [field.path, field]));
  fields.forEach((field, index) => {
    const visibleWhen = field.visibleWhen as
      | { readonly path: string; readonly equals: string | boolean }
      | undefined;
    if (!visibleWhen) return;
    const issuePath = [...prefix, index, "visibleWhen"];
    if (visibleWhen.path === field.path) {
      addIssue({
        code: "custom",
        message: "A field may not conditionally reference itself",
        path: issuePath,
      });
      return;
    }
    const condition = byPath.get(visibleWhen.path);
    if (!condition) {
      addIssue({
        code: "custom",
        message: "Visible conditions require an exact manifest path",
        path: issuePath,
      });
      return;
    }
    const expectedType = visibleValueType(condition);
    if (expectedType === undefined || typeof visibleWhen.equals !== expectedType) {
      addIssue({
        code: "custom",
        message: "Visible condition value type does not match its field",
        path: issuePath,
      });
      return;
    }
    if (condition.valueKind === "enum") {
      const options = condition.options as readonly { readonly value: string }[] | undefined;
      if (!options?.some((option) => option.value === visibleWhen.equals)) {
        addIssue({
          code: "custom",
          message: "Visible enum condition must equal a declared option",
          path: issuePath,
        });
      }
    }
  });
}

function editorSpecSize(fields: readonly Record<string, unknown>[]): number {
  let count = 0;
  for (const field of fields) {
    count += 1;
    if (Array.isArray(field.options)) count += field.options.length;
    if (Array.isArray(field.allowedMediaTypes)) count += field.allowedMediaTypes.length;
    const item = field.item as Record<string, unknown> | undefined;
    if (!item) continue;
    count += 1;
    if (!Array.isArray(item.fields)) continue;
    count += item.fields.length;
    for (const subfield of item.fields as Record<string, unknown>[]) {
      if (Array.isArray(subfield.options)) count += subfield.options.length;
      if (Array.isArray(subfield.allowedMediaTypes)) count += subfield.allowedMediaTypes.length;
    }
  }
  return count;
}

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
    const fields = definition.fieldManifest as unknown as readonly Record<string, unknown>[];
    if (editorSpecSize(fields) > 500) {
      addIssue({
        code: "custom",
        message: "Editor manifest exceeds the aggregate 500-entry spec budget",
        path: ["fieldManifest"],
      });
    }
    validateVisibleConditions(fields, addIssue, ["fieldManifest"]);
    fields.forEach((field, fieldIndex) => {
      const item = field.item as Record<string, unknown> | undefined;
      if (item?.kind !== "object" || !Array.isArray(item.fields)) return;
      validateVisibleConditions(item.fields as Record<string, unknown>[], addIssue, [
        "fieldManifest",
        fieldIndex,
        "item",
        "fields",
      ]);
    });
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
    fields: 100,
    allowedMediaTypes: 3,
  },
}) as z.ZodType<TemplateDefinitionV2>;

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
