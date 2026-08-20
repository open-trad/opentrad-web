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

export function dynamicMultiSelectEditorField(input: {
  readonly path: string;
  readonly section: string;
  readonly label: string;
  readonly required: boolean;
  readonly minItems: number;
  readonly maxItems: number;
  readonly optionSourcePath: string;
  readonly optionValuePath: string;
  readonly optionLabelPath: string;
  readonly optionFilter?: TemplateFieldVisibleWhenV1;
}): TemplateFieldManifestEntryV1 {
  return {
    path: input.path,
    section: input.section,
    label: input.label,
    control: "select",
    valueKind: "string-list",
    required: input.required,
    multiple: true,
    minItems: input.minItems,
    maxItems: input.maxItems,
    optionSourcePath: input.optionSourcePath,
    optionValuePath: input.optionValuePath,
    optionLabelPath: input.optionLabelPath,
    ...(input.optionFilter ? { optionFilter: input.optionFilter } : {}),
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
  readonly visibleWhen?: TemplateFieldVisibleWhenV1;
}): TemplateRepeatableItemFieldV1 {
  return {
    path: input.path,
    label: input.label,
    control: input.multiline ? "textarea" : "text",
    valueKind: input.localized ? "localized-text" : "string",
    required: input.required,
    ...condition(input.visibleWhen),
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

export function itemDynamicSelectField(input: {
  readonly path: string;
  readonly label: string;
  readonly required: boolean;
  readonly optionSourcePath: string;
  readonly optionValuePath: string;
  readonly optionLabelPath: string;
  readonly optionFilter?: TemplateFieldVisibleWhenV1;
}): TemplateRepeatableItemFieldV1 {
  return {
    path: input.path,
    label: input.label,
    control: "select",
    valueKind: "string",
    required: input.required,
    multiple: false,
    optionSourcePath: input.optionSourcePath,
    optionValuePath: input.optionValuePath,
    optionLabelPath: input.optionLabelPath,
    ...(input.optionFilter ? { optionFilter: input.optionFilter } : {}),
  };
}

export function itemDynamicMultiSelectField(input: {
  readonly path: string;
  readonly label: string;
  readonly required: boolean;
  readonly minItems: number;
  readonly maxItems: number;
  readonly optionSourcePath: string;
  readonly optionValuePath: string;
  readonly optionLabelPath: string;
  readonly optionFilter?: TemplateFieldVisibleWhenV1;
}): TemplateRepeatableItemFieldV1 {
  return {
    path: input.path,
    label: input.label,
    control: "select",
    valueKind: "string-list",
    required: input.required,
    multiple: true,
    minItems: input.minItems,
    maxItems: input.maxItems,
    optionSourcePath: input.optionSourcePath,
    optionValuePath: input.optionValuePath,
    optionLabelPath: input.optionLabelPath,
    ...(input.optionFilter ? { optionFilter: input.optionFilter } : {}),
  };
}

export function itemStringListField(input: {
  readonly path: string;
  readonly label: string;
  readonly required: boolean;
  readonly minItems: number;
  readonly maxItems: number;
  readonly multiline?: boolean;
}): TemplateRepeatableItemFieldV1 {
  return {
    path: input.path,
    label: input.label,
    control: "repeatable",
    valueKind: "string-list",
    required: input.required,
    minItems: input.minItems,
    maxItems: input.maxItems,
    item: {
      kind: "value",
      label: input.label,
      control: input.multiline ? "textarea" : "text",
      valueKind: "string",
    },
  };
}

export function itemCheckboxField(
  path: string,
  label: string,
  required: boolean,
): TemplateRepeatableItemFieldV1 {
  return { path, label, control: "checkbox", valueKind: "boolean", required };
}

export function itemAttachmentField(input: {
  readonly path: string;
  readonly label: string;
  readonly required: boolean;
  readonly multiple: boolean;
  readonly maxItems: number;
  readonly role: "source" | "submission" | "supporting";
  readonly category: "qualification" | "technical" | "commercial" | "other";
  readonly includeInSubmissionDefault: boolean;
  readonly visibleWhen?: TemplateFieldVisibleWhenV1;
}): TemplateRepeatableItemFieldV1 {
  return {
    path: input.path,
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
    ...condition(input.visibleWhen),
  };
}

export function bidRequirementItemSpec(): TemplateObjectListItemSpecV1 {
  return {
    kind: "object",
    idPath: "id",
    fields: [
      itemDynamicMultiSelectField({
        path: "sourceRefIds",
        label: "招标文件来源",
        required: true,
        minItems: 1,
        maxItems: 100,
        optionSourcePath: "evidenceRefs",
        optionValuePath: "id",
        optionLabelPath: "sourceRef",
        optionFilter: { path: "kind", equals: "solicitation" },
      }),
      itemSelectField({
        path: "category",
        label: "类别",
        required: true,
        options: [
          { value: "qualification", label: "资格" },
          { value: "commercial", label: "商务" },
          { value: "technical", label: "技术" },
          { value: "service", label: "服务" },
          { value: "price", label: "价格" },
          { value: "submission", label: "提交" },
        ],
      }),
      itemTextField({
        path: "requirementText",
        label: "要求内容",
        required: true,
        multiline: true,
      }),
      itemCheckboxField("substantial", "实质性要求", true),
      itemSelectField({
        path: "responseStatus",
        label: "响应状态",
        required: true,
        options: [
          { value: "not-started", label: "未开始" },
          { value: "drafted", label: "已起草" },
          { value: "reviewed", label: "已复核" },
        ],
      }),
      itemTextField({ path: "responseText", label: "响应内容", required: true, multiline: true }),
      itemTextField({ path: "offeredValue", label: "响应值", required: false }),
      itemSelectField({
        path: "compliance",
        label: "符合性",
        required: true,
        options: [
          { value: "yes", label: "符合" },
          { value: "partial", label: "部分符合" },
          { value: "no", label: "不符合" },
          { value: "unreviewed", label: "未复核" },
        ],
      }),
      itemDynamicMultiSelectField({
        path: "evidenceRefIds",
        label: "证明材料引用",
        required: false,
        minItems: 0,
        maxItems: 100,
        optionSourcePath: "evidenceRefs",
        optionValuePath: "id",
        optionLabelPath: "label",
        optionFilter: { path: "kind", equals: "proof" },
      }),
      itemTextField({ path: "owner", label: "责任人", required: false }),
      itemSelectField({
        path: "reviewStatus",
        label: "复核结论",
        required: true,
        options: [
          { value: "pending", label: "待复核" },
          { value: "accepted", label: "接受" },
          { value: "rejected", label: "拒绝" },
        ],
      }),
    ],
  };
}

export function bidDeviationItemSpec(): TemplateObjectListItemSpecV1 {
  return {
    kind: "object",
    idPath: "requirementId",
    fields: [
      itemDynamicSelectField({
        path: "requirementId",
        label: "要求",
        required: true,
        optionSourcePath: "requirements",
        optionValuePath: "id",
        optionLabelPath: "requirementText",
      }),
      itemDynamicMultiSelectField({
        path: "sourceRefIds",
        label: "招标文件来源",
        required: true,
        minItems: 1,
        maxItems: 100,
        optionSourcePath: "evidenceRefs",
        optionValuePath: "id",
        optionLabelPath: "sourceRef",
        optionFilter: { path: "kind", equals: "solicitation" },
      }),
      itemSelectField({
        path: "type",
        label: "偏差类型",
        required: true,
        options: [
          { value: "business", label: "商务" },
          { value: "technical", label: "技术" },
        ],
      }),
      itemTextField({ path: "requirement", label: "原要求", required: true, multiline: true }),
      itemTextField({ path: "response", label: "响应", required: true, multiline: true }),
      itemTextField({ path: "deviation", label: "偏差说明", required: true, multiline: true }),
    ],
  };
}

export function bidProjectReferenceItemSpec(): TemplateObjectListItemSpecV1 {
  return {
    kind: "object",
    idPath: "id",
    fields: [
      itemTextField({ path: "projectName", label: "项目名称", required: true }),
      itemTextField({ path: "customer", label: "客户", required: true }),
      itemTextField({ path: "period", label: "期间", required: true }),
      itemTextField({ path: "scope", label: "范围", required: true, multiline: true }),
      itemAttachmentField({
        path: "evidenceAttachmentId",
        label: "业绩证明",
        required: false,
        multiple: false,
        maxItems: 1,
        role: "supporting",
        category: "qualification",
        includeInSubmissionDefault: true,
      }),
      itemCheckboxField("userConfirmedTruth", "用户确认真实", true),
    ],
  };
}

export function bidGoodsOfferLineItemSpec(): TemplateObjectListItemSpecV1 {
  return {
    kind: "object",
    idPath: "id",
    fields: [
      itemTextField({ path: "name", label: "名称", required: true }),
      itemTextField({ path: "brand", label: "品牌", required: true }),
      itemTextField({ path: "model", label: "型号", required: true }),
      itemTextField({ path: "manufacturer", label: "制造商", required: true }),
      itemTextField({ path: "origin", label: "产地", required: true }),
      itemTextField({ path: "specification", label: "规格参数", required: true, multiline: true }),
      itemNumberField({ path: "quantity", label: "数量", required: true }),
      itemTextField({ path: "unit", label: "单位", required: true }),
      itemMoneyField("unitPriceMinor", "单价", true),
      itemPercentField("taxRateBps", "税率", true),
      itemTextField({
        path: "policyAttributes",
        label: "政策属性",
        required: false,
        multiline: true,
      }),
    ],
  };
}

export function bidServicePriceLineItemSpec(
  milestoneSourcePath: string,
): TemplateObjectListItemSpecV1 {
  return {
    kind: "object",
    idPath: "id",
    fields: [
      itemTextField({ path: "serviceName", label: "服务名称", required: true }),
      itemTextField({ path: "englishName", label: "英文名称", required: false }),
      itemTextField({ path: "deliverable", label: "交付内容", required: true, multiline: true }),
      itemTextField({ path: "unit", label: "单位", required: true }),
      itemNumberField({ path: "quantity", label: "数量", required: true }),
      itemMoneyField("unitPriceMinor", "单价", true),
      itemPercentField("discountBps", "折扣", true),
      itemPercentField("taxRateBps", "税率", true),
      itemNumberField({ path: "estimatedHours", label: "预计工时", required: false }),
      itemDynamicSelectField({
        path: "milestoneId",
        label: "里程碑",
        required: false,
        optionSourcePath: milestoneSourcePath,
        optionValuePath: "id",
        optionLabelPath: "name",
      }),
    ],
  };
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

export function bidBaseEditorFields(input: {
  readonly sourceSection: string;
  readonly bidderSection: string;
  readonly qualificationSection: string;
  readonly priceSection: string;
  readonly deviationSection: string;
  readonly casesSection: string;
  readonly finalReviewSection: string;
  readonly guaranteeSection?: string;
}): readonly TemplateFieldManifestEntryV1[] {
  const text = (
    path: string,
    section: string,
    label: string,
    required: boolean,
    multiline = false,
  ) => textEditorField({ path, section, label, required, multiline });
  const source = input.sourceSection;
  const bidder = input.bidderSection;
  const finalReview = input.finalReviewSection;
  return [
    text("source.issuer", source, "采购人/招标人", true),
    text("source.agency", source, "采购代理机构", false),
    text("source.projectName", source, "项目名称", true),
    text("source.projectNumber", source, "项目编号", true),
    text("source.packageNumber", source, "包号", false),
    text("source.versionLabel", source, "招标文件版本", true),
    dateEditorField("source.issueDate", source, "发布日期", true),
    repeatableEditorField({
      path: "source.clarificationIds",
      section: source,
      label: "澄清编号",
      required: false,
      minItems: 0,
      maxItems: 100,
      item: { kind: "value", label: "澄清编号", control: "text", valueKind: "string" },
    }),
    attachmentEditorField({
      path: "source.versionEvidence.mainSolicitationAttachmentId",
      section: source,
      label: "项目招标文件",
      required: true,
      multiple: false,
      maxItems: 1,
      role: "source",
      category: "other",
      includeInSubmissionDefault: false,
    }),
    repeatableEditorField({
      path: "source.versionEvidence.clarificationAttachments",
      section: source,
      label: "澄清附件",
      required: false,
      minItems: 0,
      maxItems: 100,
      item: {
        kind: "object",
        idPath: "clarificationId",
        fields: [
          itemAttachmentField({
            path: "attachmentId",
            label: "澄清附件",
            required: true,
            multiple: false,
            maxItems: 1,
            role: "source",
            category: "other",
            includeInSubmissionDefault: false,
          }),
        ],
      },
    }),
    checkboxEditorField({
      path: "source.versionEvidence.allClarificationsIncluded",
      section: source,
      label: "已纳入全部澄清",
      required: true,
    }),
    checkboxEditorField({
      path: "source.versionEvidence.userConfirmedExactVersion",
      section: source,
      label: "用户确认版本准确",
      required: true,
    }),
    datetimeEditorField("source.bidDeadline", source, "投标截止时间", true),
    datetimeEditorField("source.openingTime", source, "开标时间", false),
    text("source.openingPlace", source, "开标地点", false),
    numberEditorField({
      path: "source.bidValidityDays",
      section: source,
      label: "投标有效期天数",
      required: true,
      integer: true,
    }),
    selectEditorField({
      path: "source.submissionMode",
      section: source,
      label: "提交方式",
      required: true,
      options: [
        { value: "paper", label: "纸质" },
        { value: "electronic", label: "电子" },
        { value: "both", label: "纸质与电子" },
      ],
    }),
    text("source.signatureRules", source, "签署规则", true, true),
    text("source.sealingRules", source, "密封规则", false, true),
    selectEditorField({
      path: "source.currency",
      section: source,
      label: "币种",
      required: true,
      options: CURRENCY_OPTIONS,
    }),
    selectEditorField({
      path: "source.taxBasis",
      section: source,
      label: "计税口径",
      required: true,
      options: [...TAX_MODE_OPTIONS, { value: "as-specified", label: "按招标文件" }],
    }),
    selectEditorField({
      path: "source.evaluationMethod",
      section: source,
      label: "评审方法",
      required: true,
      options: [
        { value: "lowest-price", label: "最低价法" },
        { value: "comprehensive-score", label: "综合评分法" },
        { value: "comprehensive-evaluation", label: "综合评估法" },
        { value: "other", label: "其他" },
      ],
    }),
    moneyEditorField("source.maximumPriceMinor", source, "最高限价", false),
    checkboxEditorField({
      path: "source.jointVentureAllowed",
      section: source,
      label: "允许联合体",
      required: true,
    }),
    checkboxEditorField({
      path: "source.subcontractAllowed",
      section: source,
      label: "允许分包",
      required: true,
    }),
    numberEditorField({
      path: "source.submissionCopies.original",
      section: source,
      label: "正本份数",
      required: true,
      integer: true,
    }),
    numberEditorField({
      path: "source.submissionCopies.copies",
      section: source,
      label: "副本份数",
      required: true,
      integer: true,
    }),
    numberEditorField({
      path: "source.submissionCopies.electronic",
      section: source,
      label: "电子份数",
      required: true,
      integer: true,
    }),
    checkboxEditorField({
      path: "source.guaranteeRequirement.required",
      section: input.guaranteeSection ?? source,
      label: "要求投标保证",
      required: true,
    }),
    repeatableEditorField({
      path: "source.guaranteeRequirement.allowedMethods",
      section: input.guaranteeSection ?? source,
      label: "保证方式",
      required: false,
      minItems: 0,
      maxItems: 10,
      item: { kind: "value", label: "保证方式", control: "text", valueKind: "string" },
    }),
    moneyEditorField(
      "source.guaranteeRequirement.amountMinor",
      input.guaranteeSection ?? source,
      "保证金额",
      false,
    ),
    dynamicMultiSelectEditorField({
      path: "source.guaranteeRequirement.sourceRefIds",
      section: input.guaranteeSection ?? source,
      label: "保证要求来源引用",
      required: false,
      minItems: 0,
      maxItems: 100,
      optionSourcePath: "evidenceRefs",
      optionValuePath: "id",
      optionLabelPath: "sourceRef",
      optionFilter: { path: "kind", equals: "solicitation" },
    }),
    ...entityPartyEditorFields({ prefix: "bidder", section: bidder, label: "投标人" }),
    text("authorizedRepresentative", bidder, "授权代表", false),
    repeatableEditorField({
      path: "consortiumMembers",
      section: bidder,
      label: "联合体成员",
      required: false,
      minItems: 0,
      maxItems: 20,
      item: {
        kind: "object",
        fields: [
          itemTextField({ path: "legalName", label: "名称", required: true }),
          itemTextField({ path: "englishName", label: "英文名称", required: false }),
          itemSelectField({
            path: "entityType",
            label: "主体类型",
            required: true,
            options: ENTITY_TYPE_OPTIONS,
          }),
          itemTextField({ path: "registrationId", label: "登记号", required: false }),
          itemTextField({ path: "taxId", label: "税号", required: false }),
          itemTextField({ path: "registeredAddress", label: "注册地址", required: false }),
          itemTextField({ path: "postalAddress", label: "通讯地址", required: false }),
          itemTextField({ path: "legalRepresentative", label: "法定代表人", required: false }),
          itemTextField({ path: "authorizedRepresentative", label: "授权代表", required: false }),
          itemTextField({ path: "contactName", label: "联系人", required: true }),
          itemTextField({ path: "phone", label: "电话", required: false }),
          itemTextField({ path: "email", label: "邮箱", required: false }),
          itemTextField({ path: "bankAccountName", label: "账户名", required: false }),
          itemTextField({ path: "bankName", label: "开户行", required: false }),
          itemTextField({ path: "bankAccount", label: "账号", required: false }),
          itemTextField({ path: "swiftCode", label: "SWIFT", required: false }),
        ],
      },
    }),
    repeatableEditorField({
      path: "requirements",
      section: source,
      label: "招标要求",
      required: false,
      minItems: 0,
      maxItems: 100,
      item: {
        kind: "object",
        idPath: "id",
        fields: [
          itemDynamicMultiSelectField({
            path: "sourceRefIds",
            label: "招标文件来源",
            required: true,
            minItems: 1,
            maxItems: 100,
            optionSourcePath: "evidenceRefs",
            optionValuePath: "id",
            optionLabelPath: "sourceRef",
            optionFilter: { path: "kind", equals: "solicitation" },
          }),
          itemSelectField({
            path: "category",
            label: "类别",
            required: true,
            options: [
              { value: "qualification", label: "资格" },
              { value: "commercial", label: "商务" },
              { value: "technical", label: "技术" },
              { value: "service", label: "服务" },
              { value: "price", label: "价格" },
              { value: "submission", label: "提交" },
            ],
          }),
          itemTextField({
            path: "requirementText",
            label: "要求内容",
            required: true,
            multiline: true,
          }),
          itemCheckboxField("substantial", "实质性要求", true),
          itemSelectField({
            path: "responseStatus",
            label: "响应状态",
            required: true,
            options: [
              { value: "not-started", label: "未开始" },
              { value: "drafted", label: "已起草" },
              { value: "reviewed", label: "已复核" },
            ],
          }),
          itemTextField({
            path: "responseText",
            label: "响应内容",
            required: true,
            multiline: true,
          }),
          itemTextField({ path: "offeredValue", label: "响应值", required: false }),
          itemSelectField({
            path: "compliance",
            label: "符合性",
            required: true,
            options: [
              { value: "yes", label: "符合" },
              { value: "partial", label: "部分符合" },
              { value: "no", label: "不符合" },
              { value: "unreviewed", label: "未复核" },
            ],
          }),
          itemDynamicMultiSelectField({
            path: "evidenceRefIds",
            label: "证明材料引用",
            required: false,
            minItems: 0,
            maxItems: 100,
            optionSourcePath: "evidenceRefs",
            optionValuePath: "id",
            optionLabelPath: "label",
            optionFilter: { path: "kind", equals: "proof" },
          }),
          itemTextField({ path: "owner", label: "责任人", required: false }),
          itemSelectField({
            path: "reviewStatus",
            label: "复核结论",
            required: true,
            options: [
              { value: "pending", label: "待复核" },
              { value: "accepted", label: "接受" },
              { value: "rejected", label: "拒绝" },
            ],
          }),
        ],
      },
    }),
    repeatableEditorField({
      path: "qualifications",
      section: input.qualificationSection,
      label: "资格项",
      required: false,
      minItems: 0,
      maxItems: 100,
      item: {
        kind: "object",
        idPath: "id",
        fields: [
          itemDynamicMultiSelectField({
            path: "sourceRefIds",
            label: "招标文件来源",
            required: true,
            minItems: 1,
            maxItems: 100,
            optionSourcePath: "evidenceRefs",
            optionValuePath: "id",
            optionLabelPath: "sourceRef",
            optionFilter: { path: "kind", equals: "solicitation" },
          }),
          itemTextField({ path: "name", label: "资格名称", required: true }),
          itemCheckboxField("required", "必须", true),
          itemTextField({ path: "issuer", label: "发证机构", required: false }),
          itemTextField({ path: "certificateNumber", label: "证书编号", required: false }),
          itemDateField("validUntil", "有效期至", false),
          itemAttachmentField({
            path: "attachmentId",
            label: "证明附件",
            required: false,
            multiple: false,
            maxItems: 1,
            role: "supporting",
            category: "qualification",
            includeInSubmissionDefault: true,
            visibleWhen: { path: "status", equals: "attached" },
          }),
          itemSelectField({
            path: "status",
            label: "状态",
            required: true,
            options: [
              { value: "missing", label: "缺失" },
              { value: "attached", label: "已附" },
              { value: "not-applicable", label: "不适用" },
            ],
          }),
          itemCheckboxField("userConfirmedTruth", "用户确认真实", true),
        ],
      },
    }),
    repeatableEditorField({
      path: "evidenceRefs",
      section: source,
      label: "证据引用",
      required: false,
      minItems: 0,
      maxItems: 100,
      item: {
        kind: "object",
        idPath: "id",
        fields: [
          itemSelectField({
            path: "kind",
            label: "证据类型",
            required: true,
            options: [
              { value: "solicitation", label: "招标文件" },
              { value: "proof", label: "证明材料" },
            ],
          }),
          itemTextField({
            path: "sourceRef",
            label: "来源定位",
            required: false,
            visibleWhen: { path: "kind", equals: "solicitation" },
          }),
          itemAttachmentField({
            path: "attachmentId",
            label: "附件",
            required: true,
            multiple: false,
            maxItems: 1,
            role: "supporting",
            category: "other",
            includeInSubmissionDefault: true,
          }),
          itemNumberField({ path: "page", label: "页码", required: true, integer: true }),
          itemTextField({
            path: "label",
            label: "证据标签",
            required: false,
            visibleWhen: { path: "kind", equals: "proof" },
          }),
        ],
      },
    }),
    ...["businessDeviations", "technicalDeviations"].map((path) =>
      repeatableEditorField({
        path,
        section: input.deviationSection,
        label: path === "businessDeviations" ? "商务偏差" : "技术偏差",
        required: false,
        minItems: 0,
        maxItems: 100,
        item: {
          kind: "object",
          idPath: "requirementId",
          fields: [
            itemDynamicSelectField({
              path: "requirementId",
              label: "要求",
              required: true,
              optionSourcePath: "requirements",
              optionValuePath: "id",
              optionLabelPath: "requirementText",
            }),
            itemDynamicMultiSelectField({
              path: "sourceRefIds",
              label: "招标文件来源",
              required: true,
              minItems: 1,
              maxItems: 100,
              optionSourcePath: "evidenceRefs",
              optionValuePath: "id",
              optionLabelPath: "sourceRef",
              optionFilter: { path: "kind", equals: "solicitation" },
            }),
            itemSelectField({
              path: "type",
              label: "偏差类型",
              required: true,
              options: [
                { value: "business", label: "商务" },
                { value: "technical", label: "技术" },
              ],
            }),
            itemTextField({
              path: "requirement",
              label: "原要求",
              required: true,
              multiline: true,
            }),
            itemTextField({ path: "response", label: "响应", required: true, multiline: true }),
            itemTextField({
              path: "deviation",
              label: "偏差说明",
              required: true,
              multiline: true,
            }),
          ],
        },
      }),
    ),
    repeatableEditorField({
      path: "projectReferences",
      section: input.casesSection,
      label: "项目业绩",
      required: false,
      minItems: 0,
      maxItems: 100,
      item: {
        kind: "object",
        idPath: "id",
        fields: [
          itemTextField({ path: "projectName", label: "项目名称", required: true }),
          itemTextField({ path: "customer", label: "客户", required: true }),
          itemTextField({ path: "period", label: "期间", required: true }),
          itemTextField({ path: "scope", label: "范围", required: true, multiline: true }),
          itemAttachmentField({
            path: "evidenceAttachmentId",
            label: "业绩证明",
            required: false,
            multiple: false,
            maxItems: 1,
            role: "supporting",
            category: "qualification",
            includeInSubmissionDefault: true,
          }),
          itemCheckboxField("userConfirmedTruth", "用户确认真实", true),
        ],
      },
    }),
    moneyEditorField("priceDeclaration.itemizedTotalMinor", input.priceSection, "明细合计", true),
    moneyEditorField(
      "priceDeclaration.bidLetterTotalMinor",
      input.priceSection,
      "投标函总价",
      true,
    ),
    moneyEditorField(
      "priceDeclaration.openingTotalMinor",
      input.priceSection,
      "开标一览总价",
      true,
    ),
    checkboxEditorField({
      path: "priceDeclaration.userConfirmed",
      section: input.priceSection,
      label: "用户确认价格一致",
      required: true,
    }),
    text("bidGuarantee.method", input.guaranteeSection ?? source, "保证方式", false),
    moneyEditorField(
      "bidGuarantee.amountMinor",
      input.guaranteeSection ?? source,
      "保证金额",
      false,
    ),
    text("bidGuarantee.reference", input.guaranteeSection ?? source, "保证编号", false),
    attachmentEditorField({
      path: "bidGuarantee.attachmentId",
      section: input.guaranteeSection ?? source,
      label: "保证附件",
      required: false,
      multiple: false,
      maxItems: 1,
      role: "supporting",
      category: "commercial",
      includeInSubmissionDefault: true,
    }),
    checkboxEditorField({
      path: "bidGuarantee.userConfirmed",
      section: input.guaranteeSection ?? source,
      label: "用户确认保证信息",
      required: false,
    }),
    repeatableEditorField({
      path: "signSealChecklist",
      section: finalReview,
      label: "签章检查清单",
      required: false,
      minItems: 0,
      maxItems: 100,
      item: {
        kind: "object",
        idPath: "id",
        fields: [
          itemDynamicMultiSelectField({
            path: "sourceRefIds",
            label: "招标文件来源",
            required: true,
            minItems: 1,
            maxItems: 100,
            optionSourcePath: "evidenceRefs",
            optionValuePath: "id",
            optionLabelPath: "sourceRef",
            optionFilter: { path: "kind", equals: "solicitation" },
          }),
          itemTextField({ path: "label", label: "检查项", required: true }),
          itemCheckboxField("required", "必须", true),
          itemCheckboxField("confirmed", "已确认", true),
        ],
      },
    }),
    repeatableEditorField({
      path: "finalReviewers",
      section: finalReview,
      label: "最终复核人",
      required: false,
      minItems: 0,
      maxItems: 100,
      item: {
        kind: "object",
        fields: [
          itemTextField({ path: "name", label: "姓名", required: true }),
          itemTextField({ path: "role", label: "角色", required: true }),
          {
            path: "reviewedAt",
            label: "复核时间",
            control: "datetime",
            valueKind: "offset-datetime",
            required: true,
          },
        ],
      },
    }),
  ];
}
