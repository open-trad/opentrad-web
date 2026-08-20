import type {
  TemplateFieldManifestEntryV1,
  TemplateFieldOptionV1,
  TemplateFieldVisibleWhenV1,
  TemplateObjectListItemSpecV1,
  TemplateRepeatableItemFieldV1,
  TemplateStringListItemSpecV1,
} from "../common.js";

export const CURRENCY_OPTIONS = [
  { value: "CNY", label: "人民币" },
  { value: "USD", label: "美元" },
  { value: "EUR", label: "欧元" },
] as const;

export const TAX_MODE_OPTIONS = [
  { value: "tax-excluded", label: "不含税" },
  { value: "tax-included", label: "含税" },
  { value: "tax-exempt", label: "免税" },
] as const;

export const QUOTE_NATURE_OPTIONS = [
  { value: "invitation", label: "询价邀请" },
  { value: "binding-offer", label: "约束性报价" },
] as const;

export const ENTITY_TYPE_OPTIONS = [
  { value: "company", label: "公司" },
  { value: "organization", label: "组织" },
  { value: "individual", label: "个人" },
] as const;

export const TRANSPORT_MODE_OPTIONS = [
  { value: "air", label: "空运" },
  { value: "road", label: "公路" },
  { value: "rail", label: "铁路" },
  { value: "sea", label: "海运" },
  { value: "multimodal", label: "多式联运" },
] as const;

export const INCOTERMS_OPTIONS = [
  { value: "EXW", label: "EXW" },
  { value: "FCA", label: "FCA" },
  { value: "CPT", label: "CPT" },
  { value: "CIP", label: "CIP" },
  { value: "DAP", label: "DAP" },
  { value: "DPU", label: "DPU" },
  { value: "DDP", label: "DDP" },
  { value: "FAS", label: "FAS" },
  { value: "FOB", label: "FOB" },
  { value: "CFR", label: "CFR" },
  { value: "CIF", label: "CIF" },
] as const;

export const LANGUAGE_PRIORITY_OPTIONS = [
  { value: "zh-CN", label: "中文优先" },
  { value: "en-US", label: "英文优先" },
] as const;

function condition(visibleWhen?: TemplateFieldVisibleWhenV1) {
  return visibleWhen ? { visibleWhen } : {};
}

export function textEditorField(input: {
  readonly path: string;
  readonly section: string;
  readonly label: string;
  readonly required: boolean;
  readonly localized?: boolean;
  readonly multiline?: boolean;
  readonly visibleWhen?: TemplateFieldVisibleWhenV1;
}): TemplateFieldManifestEntryV1 {
  return {
    path: input.path,
    section: input.section,
    label: input.label,
    control: input.multiline ? "textarea" : "text",
    valueKind: input.localized ? "localized-text" : "string",
    required: input.required,
    ...condition(input.visibleWhen),
  };
}

export function dateEditorField(
  path: string,
  section: string,
  label: string,
  required: boolean,
): TemplateFieldManifestEntryV1 {
  return { path, section, label, control: "date", valueKind: "date", required };
}

export function datetimeEditorField(
  path: string,
  section: string,
  label: string,
  required: boolean,
): TemplateFieldManifestEntryV1 {
  return {
    path,
    section,
    label,
    control: "datetime",
    valueKind: "offset-datetime",
    required,
  };
}

export function numberEditorField(input: {
  readonly path: string;
  readonly section: string;
  readonly label: string;
  readonly required: boolean;
  readonly integer?: boolean;
}): TemplateFieldManifestEntryV1 {
  return {
    path: input.path,
    section: input.section,
    label: input.label,
    control: "number",
    valueKind: input.integer ? "integer" : "decimal-string",
    required: input.required,
  };
}

export function moneyEditorField(
  path: string,
  section: string,
  label: string,
  required: boolean,
): TemplateFieldManifestEntryV1 {
  return { path, section, label, control: "money", valueKind: "money-minor", required };
}

export function percentEditorField(
  path: string,
  section: string,
  label: string,
  required: boolean,
): TemplateFieldManifestEntryV1 {
  return { path, section, label, control: "percent", valueKind: "basis-points", required };
}

export function checkboxEditorField(input: {
  readonly path: string;
  readonly section: string;
  readonly label: string;
  readonly required: boolean;
  readonly visibleWhen?: TemplateFieldVisibleWhenV1;
}): TemplateFieldManifestEntryV1 {
  return {
    path: input.path,
    section: input.section,
    label: input.label,
    control: "checkbox",
    valueKind: "boolean",
    required: input.required,
    ...condition(input.visibleWhen),
  };
}

export function selectEditorField(input: {
  readonly path: string;
  readonly section: string;
  readonly label: string;
  readonly required: boolean;
  readonly options: readonly TemplateFieldOptionV1[];
  readonly visibleWhen?: TemplateFieldVisibleWhenV1;
}): TemplateFieldManifestEntryV1 {
  return {
    path: input.path,
    section: input.section,
    label: input.label,
    control: "select",
    valueKind: "enum",
    required: input.required,
    options: input.options,
    ...condition(input.visibleWhen),
  };
}

export function repeatableEditorField(input: {
  readonly path: string;
  readonly section: string;
  readonly label: string;
  readonly required: boolean;
  readonly minItems: number;
  readonly maxItems: number;
  readonly item: TemplateObjectListItemSpecV1 | TemplateStringListItemSpecV1;
}): TemplateFieldManifestEntryV1 {
  return input.item.kind === "object"
    ? {
        path: input.path,
        section: input.section,
        label: input.label,
        control: "repeatable",
        valueKind: "object-list",
        required: input.required,
        minItems: input.minItems,
        maxItems: input.maxItems,
        item: input.item,
      }
    : {
        path: input.path,
        section: input.section,
        label: input.label,
        control: "repeatable",
        valueKind: "string-list",
        required: input.required,
        minItems: input.minItems,
        maxItems: input.maxItems,
        item: input.item,
      };
}

export function itemTextField(input: {
  readonly path: string;
  readonly label: string;
  readonly required: boolean;
  readonly localized?: boolean;
  readonly multiline?: boolean;
}): TemplateRepeatableItemFieldV1 {
  return {
    path: input.path,
    label: input.label,
    control: input.multiline ? "textarea" : "text",
    valueKind: input.localized ? "localized-text" : "string",
    required: input.required,
  };
}

export function itemNumberField(input: {
  readonly path: string;
  readonly label: string;
  readonly required: boolean;
  readonly integer?: boolean;
}): TemplateRepeatableItemFieldV1 {
  return {
    path: input.path,
    label: input.label,
    control: "number",
    valueKind: input.integer ? "integer" : "decimal-string",
    required: input.required,
  };
}

export function itemMoneyField(
  path: string,
  label: string,
  required: boolean,
): TemplateRepeatableItemFieldV1 {
  return { path, label, control: "money", valueKind: "money-minor", required };
}

export function itemPercentField(
  path: string,
  label: string,
  required: boolean,
): TemplateRepeatableItemFieldV1 {
  return { path, label, control: "percent", valueKind: "basis-points", required };
}

export function itemSelectField(input: {
  readonly path: string;
  readonly label: string;
  readonly required: boolean;
  readonly options: readonly TemplateFieldOptionV1[];
}): TemplateRepeatableItemFieldV1 {
  return {
    path: input.path,
    label: input.label,
    control: "select",
    valueKind: "enum",
    required: input.required,
    options: input.options,
  };
}

export function itemCheckboxField(
  path: string,
  label: string,
  required: boolean,
): TemplateRepeatableItemFieldV1 {
  return { path, label, control: "checkbox", valueKind: "boolean", required };
}

export function quoteMetaEditorFields(input: {
  readonly section: string;
  readonly includeCurrency: boolean;
  readonly bilingual: boolean;
}): readonly TemplateFieldManifestEntryV1[] {
  return [
    textEditorField({ path: "meta.number", section: input.section, label: "编号", required: true }),
    textEditorField({ path: "meta.title", section: input.section, label: "标题", required: true }),
    textEditorField({
      path: "meta.englishTitle",
      section: input.section,
      label: "英文标题",
      required: input.bilingual,
    }),
    dateEditorField("meta.issueDate", input.section, "出具日期", true),
    dateEditorField("meta.validUntil", input.section, "有效期至", true),
    ...(input.includeCurrency
      ? [
          selectEditorField({
            path: "meta.currency",
            section: input.section,
            label: "币种",
            required: true,
            options: CURRENCY_OPTIONS,
          }),
        ]
      : []),
    selectEditorField({
      path: "meta.taxMode",
      section: input.section,
      label: "计税口径",
      required: true,
      options: TAX_MODE_OPTIONS,
    }),
    selectEditorField({
      path: "meta.quoteNature",
      section: input.section,
      label: "报价性质",
      required: true,
      options: QUOTE_NATURE_OPTIONS,
    }),
  ];
}

export function entityPartyEditorFields(input: {
  readonly prefix: string;
  readonly section: string;
  readonly label: string;
  readonly optionalParent?: boolean;
}): readonly TemplateFieldManifestEntryV1[] {
  const required = !input.optionalParent;
  const path = (key: string) => `${input.prefix}.${key}`;
  return [
    textEditorField({
      path: path("legalName"),
      section: input.section,
      label: `${input.label}名称`,
      required,
    }),
    textEditorField({
      path: path("englishName"),
      section: input.section,
      label: `${input.label}英文名称`,
      required: false,
    }),
    selectEditorField({
      path: path("entityType"),
      section: input.section,
      label: `${input.label}主体类型`,
      required,
      options: ENTITY_TYPE_OPTIONS,
    }),
    textEditorField({
      path: path("registrationId"),
      section: input.section,
      label: `${input.label}登记号`,
      required: false,
    }),
    textEditorField({
      path: path("taxId"),
      section: input.section,
      label: `${input.label}税号`,
      required: false,
    }),
    textEditorField({
      path: path("registeredAddress"),
      section: input.section,
      label: `${input.label}注册地址`,
      required: false,
    }),
    textEditorField({
      path: path("postalAddress"),
      section: input.section,
      label: `${input.label}通讯地址`,
      required: false,
    }),
    textEditorField({
      path: path("legalRepresentative"),
      section: input.section,
      label: `${input.label}法定代表人`,
      required: false,
    }),
    textEditorField({
      path: path("authorizedRepresentative"),
      section: input.section,
      label: `${input.label}授权代表`,
      required: false,
    }),
    textEditorField({
      path: path("contactName"),
      section: input.section,
      label: `${input.label}联系人`,
      required,
    }),
    textEditorField({
      path: path("phone"),
      section: input.section,
      label: `${input.label}电话`,
      required: false,
    }),
    textEditorField({
      path: path("email"),
      section: input.section,
      label: `${input.label}邮箱`,
      required: false,
    }),
    textEditorField({
      path: path("bankAccountName"),
      section: input.section,
      label: `${input.label}账户名`,
      required: false,
    }),
    textEditorField({
      path: path("bankName"),
      section: input.section,
      label: `${input.label}开户行`,
      required: false,
    }),
    textEditorField({
      path: path("bankAccount"),
      section: input.section,
      label: `${input.label}账号`,
      required: false,
    }),
    textEditorField({
      path: path("swiftCode"),
      section: input.section,
      label: `${input.label}SWIFT`,
      required: false,
    }),
  ];
}

export function bilingualPartyEditorFields(input: {
  readonly prefix: string;
  readonly section: string;
  readonly label: string;
}): readonly TemplateFieldManifestEntryV1[] {
  const path = (key: string) => `${input.prefix}.${key}`;
  return [
    textEditorField({
      path: path("legalName"),
      section: input.section,
      label: `${input.label}名称`,
      required: true,
      localized: true,
    }),
    selectEditorField({
      path: path("entityType"),
      section: input.section,
      label: `${input.label}主体类型`,
      required: true,
      options: ENTITY_TYPE_OPTIONS,
    }),
    textEditorField({
      path: path("registrationId"),
      section: input.section,
      label: `${input.label}登记号`,
      required: false,
    }),
    textEditorField({
      path: path("registeredAddress"),
      section: input.section,
      label: `${input.label}注册地址`,
      required: false,
      localized: true,
    }),
    textEditorField({
      path: path("contactName"),
      section: input.section,
      label: `${input.label}联系人`,
      required: true,
      localized: true,
    }),
    textEditorField({
      path: path("phone"),
      section: input.section,
      label: `${input.label}电话`,
      required: false,
    }),
    textEditorField({
      path: path("email"),
      section: input.section,
      label: `${input.label}邮箱`,
      required: false,
    }),
  ];
}
