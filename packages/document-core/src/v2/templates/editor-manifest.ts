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

export const EFFECTIVE_MODE_OPTIONS = [
  { value: "signature", label: "签署生效" },
  { value: "date", label: "指定日期生效" },
  { value: "condition", label: "条件成就生效" },
] as const;

export const DISPUTE_METHOD_OPTIONS = [
  { value: "court", label: "诉讼" },
  { value: "arbitration", label: "仲裁" },
] as const;

export const ATTACHMENT_MEDIA_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;

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

export function attachmentEditorField(input: {
  readonly path: string;
  readonly section: string;
  readonly label: string;
  readonly required: boolean;
  readonly multiple: boolean;
  readonly maxItems: number;
  readonly role: "source" | "submission" | "supporting";
  readonly category: "qualification" | "technical" | "commercial" | "other";
  readonly includeInSubmissionDefault: boolean;
}): TemplateFieldManifestEntryV1 {
  return {
    path: input.path,
    section: input.section,
    label: input.label,
    control: "attachment",
    valueKind: input.multiple ? "attachment-id-list" : "attachment-id",
    required: input.required,
    cardinality: input.multiple ? "multiple" : "single",
    maxItems: input.maxItems,
    descriptorPath: "attachments",
    role: input.role,
    category: input.category,
    allowedMediaTypes: ATTACHMENT_MEDIA_TYPES,
    pdfPageCount: "user-confirmed",
    includeInSubmissionDefault: input.includeInSubmissionDefault,
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

export function itemDateField(
  path: string,
  label: string,
  required: boolean,
): TemplateRepeatableItemFieldV1 {
  return { path, label, control: "date", valueKind: "date", required };
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
  readonly englishNameRequired?: boolean;
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
      required: input.englishNameRequired ?? false,
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

export function contractMetaEditorFields(input: {
  readonly section: string;
  readonly languagePrioritySection?: string;
}): readonly TemplateFieldManifestEntryV1[] {
  return [
    textEditorField({
      path: "meta.contractNumber",
      section: input.section,
      label: "合同编号",
      required: true,
    }),
    textEditorField({
      path: "meta.title",
      section: input.section,
      label: "合同标题",
      required: true,
    }),
    dateEditorField("meta.signingDate", input.section, "签署日期", true),
    textEditorField({
      path: "meta.signingPlace",
      section: input.section,
      label: "签署地点",
      required: false,
    }),
    selectEditorField({
      path: "meta.effectiveMode",
      section: input.section,
      label: "生效方式",
      required: true,
      options: EFFECTIVE_MODE_OPTIONS,
    }),
    dateEditorField("meta.effectiveDate", input.section, "生效日期", false),
    {
      ...textEditorField({
        path: "meta.effectiveCondition",
        section: input.section,
        label: "生效条件",
        required: false,
        multiline: true,
      }),
      visibleWhen: { path: "meta.effectiveMode", equals: "condition" },
    },
    numberEditorField({
      path: "meta.copies",
      section: input.section,
      label: "合同份数",
      required: true,
      integer: true,
    }),
    ...(input.languagePrioritySection
      ? [
          selectEditorField({
            path: "meta.languagePriority",
            section: input.languagePrioritySection,
            label: "优先语言",
            required: true,
            options: LANGUAGE_PRIORITY_OPTIONS,
          }),
        ]
      : []),
  ].map((field) =>
    field.path === "meta.effectiveDate"
      ? { ...field, visibleWhen: { path: "meta.effectiveMode", equals: "date" } }
      : field,
  ) as readonly TemplateFieldManifestEntryV1[];
}

export function standardGoodsLinesEditorField(input: {
  readonly path: string;
  readonly section: string;
  readonly label: string;
}): TemplateFieldManifestEntryV1 {
  return repeatableEditorField({
    ...input,
    required: true,
    minItems: 1,
    maxItems: 100,
    item: {
      kind: "object",
      idPath: "id",
      fields: [
        itemTextField({ path: "name", label: "名称", required: true }),
        itemTextField({ path: "englishName", label: "英文名称", required: false }),
        itemTextField({ path: "sku", label: "SKU", required: false }),
        itemTextField({ path: "specification", label: "规格", required: false }),
        itemTextField({ path: "description", label: "说明", required: false, multiline: true }),
        itemTextField({ path: "unit", label: "单位", required: true }),
        itemNumberField({ path: "quantity", label: "数量", required: true }),
        itemMoneyField("unitPriceMinor", "单价", true),
        itemPercentField("discountBps", "折扣", true),
        itemPercentField("taxRateBps", "税率", true),
        itemTextField({ path: "countryOfOrigin", label: "原产地", required: false }),
        itemTextField({ path: "hsCodeUserSupplied", label: "HS编码", required: false }),
        itemNumberField({ path: "netWeightKg", label: "净重kg", required: false }),
        itemNumberField({ path: "grossWeightKg", label: "毛重kg", required: false }),
        itemNumberField({ path: "lengthCm", label: "长度cm", required: false }),
        itemNumberField({ path: "widthCm", label: "宽度cm", required: false }),
        itemNumberField({ path: "heightCm", label: "高度cm", required: false }),
      ],
    },
  });
}

export function paymentScheduleEditorField(
  path: string,
  section: string,
): TemplateFieldManifestEntryV1 {
  return repeatableEditorField({
    path,
    section,
    label: "付款进度",
    required: true,
    minItems: 1,
    maxItems: 100,
    item: {
      kind: "object",
      idPath: "id",
      fields: [
        itemTextField({ path: "trigger", label: "付款触发条件", required: true }),
        itemPercentField("amountBps", "付款比例", true),
        itemNumberField({ path: "dueDays", label: "到期天数", required: true, integer: true }),
      ],
    },
  });
}

export function contractSignersEditorField(input: {
  readonly section: string;
  readonly partyOptions: readonly TemplateFieldOptionV1[];
  readonly bilingual?: boolean;
}): TemplateFieldManifestEntryV1 {
  return repeatableEditorField({
    path: "signers",
    section: input.section,
    label: "签署方",
    required: true,
    minItems: 2,
    maxItems: 2,
    item: {
      kind: "object",
      idPath: "partyId",
      fields: [
        itemSelectField({
          path: "partyId",
          label: "签署主体",
          required: true,
          options: input.partyOptions,
        }),
        itemTextField({ path: "role", label: "签署角色", required: true, localized: true }),
        itemTextField({ path: "signatoryName", label: "签署人", required: false }),
        itemTextField({ path: "signatoryTitle", label: "职务", required: false }),
        itemTextField({
          path: "dateLabel",
          label: "日期标签",
          required: true,
          localized: true,
        }),
        itemTextField({
          path: "sealLabel",
          label: "盖章标签",
          required: true,
          localized: true,
        }),
      ],
    },
  });
}

export function contractGeneralTermsEditorFields(input: {
  readonly sectionFor: (path: string) => string;
}): readonly TemplateFieldManifestEntryV1[] {
  const field = (path: string, label: string, required: boolean) =>
    textEditorField({
      path: `generalTerms.${path}`,
      section: input.sectionFor(path),
      label,
      required,
      multiline: true,
    });
  return [
    field("noticeAddresses", "通知地址", true),
    field("confidentiality", "保密", true),
    field("forceMajeure", "不可抗力", true),
    field("changeControl", "变更管理", true),
    field("assignment", "权利义务转让", false),
    field("compliance", "合规义务", false),
    field("termination", "终止", true),
    field("breachRemedies", "违约救济", true),
    field("governingLaw", "适用法律", true),
    selectEditorField({
      path: "generalTerms.disputeMethod",
      section: input.sectionFor("disputeMethod"),
      label: "争议解决方式",
      required: true,
      options: DISPUTE_METHOD_OPTIONS,
    }),
    {
      ...field("court", "管辖法院", false),
      visibleWhen: { path: "generalTerms.disputeMethod", equals: "court" },
    },
    {
      ...field("arbitrationCommission", "仲裁委员会", false),
      visibleWhen: { path: "generalTerms.disputeMethod", equals: "arbitration" },
    },
    field("severability", "可分割性", true),
    field("entireAgreement", "完整协议", true),
    field("otherTerms", "其他约定", false),
  ];
}
