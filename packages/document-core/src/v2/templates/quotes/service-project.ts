import { isolatedArraySchema } from "../../../safe-schema.js";
import { z } from "../../../zod.js";
import type { EntityPartyV2, TemplateDefinitionV2 } from "../../common.js";
import { type DocumentModelV2, DocumentModelV2Schema } from "../../document-model.js";
import {
  BasisPointsV2Schema,
  calculateQuoteLinesV2,
  formatMoneyMinorV2,
  IdentifierV2Schema,
} from "../../money.js";
import type { TemplateRegistration } from "../../registry.js";
import type { RiskFindingV2 } from "../../risk.js";
import {
  checkboxEditorField,
  dateEditorField,
  entityPartyEditorFields,
  itemMoneyField,
  itemNumberField,
  itemPercentField,
  itemTextField,
  quoteMetaEditorFields,
  repeatableEditorField,
  textEditorField,
} from "../editor-manifest.js";
import {
  DateV2Schema,
  PartyV2Schema,
  type QuoteMetaV2,
  QuoteMetaV2Schema,
  ServiceLinesV2Schema,
  type ServiceLineV2,
} from "../quote-common.js";
import {
  finding,
  findingsWatermark,
  freezeFindings,
  frozenQuoteSchema,
  hasPlaceholder,
  IsoInstantV2RawSchema,
  localized,
  partyDetails,
  quoteText,
  strictQuoteObject,
  utcDraftDates,
} from "./shared.js";

export interface ServiceProjectMilestoneV1 {
  readonly id: string;
  readonly title: string;
  readonly deliverable: string;
  readonly dueDescription: string;
  readonly acceptanceCriteria: string;
  readonly paymentBps?: number;
}

export interface ServiceProjectQuoteDraftV1 {
  readonly id: string;
  readonly templateId: "quotation.service.project.v1";
  readonly templateVersion: "1.0.0";
  readonly meta: QuoteMetaV2;
  readonly seller: EntityPartyV2;
  readonly buyer: EntityPartyV2;
  readonly project: {
    readonly projectName: string;
    readonly buyerReference?: string;
    readonly objective: string;
    readonly scope: string;
    readonly assumptions?: string;
    readonly exclusions?: string;
  };
  readonly serviceLines: readonly ServiceLineV2[];
  readonly milestones: readonly ServiceProjectMilestoneV1[];
  readonly terms: {
    readonly startDate?: string;
    readonly duration: string;
    readonly serviceLocation: string;
    readonly customerDependencies?: string;
    readonly expensePolicy: string;
    readonly acceptance: string;
    readonly payment: string;
    readonly intellectualProperty: string;
    readonly confidentiality?: string;
    readonly changeControl: string;
    readonly notes?: string;
  };
  readonly dataHandling: {
    readonly personalDataInvolved: boolean;
    readonly processingTerms?: string;
  };
  readonly updatedAt: string;
}

const OptionalText = quoteText(10_000);
const RequiredText = quoteText(10_000, true);

const ProjectSchema = strictQuoteObject({
  projectName: RequiredText,
  buyerReference: quoteText(300).optional(),
  objective: RequiredText,
  scope: RequiredText,
  assumptions: OptionalText.optional(),
  exclusions: OptionalText.optional(),
});

const MilestoneSchema = strictQuoteObject({
  id: IdentifierV2Schema,
  title: quoteText(300, true),
  deliverable: quoteText(1_000, true),
  dueDescription: quoteText(1_000, true),
  acceptanceCriteria: quoteText(2_000, true),
  paymentBps: BasisPointsV2Schema.optional(),
});

const MilestonesSchema = isolatedArraySchema(MilestoneSchema, {
  min: 1,
  max: 100,
  refine: (milestones, addIssue) => {
    const seen = new Set<string>();
    milestones.forEach((milestone, index) => {
      if (seen.has(milestone.id)) {
        addIssue({
          code: "custom",
          message: "Milestone ids must be unique",
          path: [index, "id"],
        });
      }
      seen.add(milestone.id);
    });
  },
});

const TermsSchema = strictQuoteObject({
  startDate: DateV2Schema.optional(),
  duration: OptionalText,
  serviceLocation: RequiredText,
  customerDependencies: OptionalText.optional(),
  expensePolicy: RequiredText,
  acceptance: OptionalText,
  payment: OptionalText,
  intellectualProperty: RequiredText,
  confidentiality: OptionalText.optional(),
  changeControl: RequiredText,
  notes: OptionalText.optional(),
});

const DataHandlingSchema = strictQuoteObject({
  personalDataInvolved: z.boolean(),
  processingTerms: OptionalText.optional(),
});

const ServiceProjectQuoteDraftRawSchema = strictQuoteObject(
  {
    id: IdentifierV2Schema,
    templateId: z.literal("quotation.service.project.v1"),
    templateVersion: z.literal("1.0.0"),
    meta: QuoteMetaV2Schema,
    seller: PartyV2Schema,
    buyer: PartyV2Schema,
    project: ProjectSchema,
    serviceLines: ServiceLinesV2Schema,
    milestones: MilestonesSchema,
    terms: TermsSchema,
    dataHandling: DataHandlingSchema,
    updatedAt: IsoInstantV2RawSchema,
  },
  (draft, addIssue) => {
    if (draft.meta.language !== "zh-CN") {
      addIssue({
        code: "custom",
        message: "Project service quotation supports zh-CN only",
        path: ["meta", "language"],
      });
    }
    const milestoneIds = new Set(draft.milestones.map((milestone) => milestone.id));
    draft.serviceLines.forEach((line, index) => {
      if (line.milestoneId !== undefined && !milestoneIds.has(line.milestoneId)) {
        addIssue({
          code: "custom",
          message: "Service line references an unknown milestone",
          path: ["serviceLines", index, "milestoneId"],
        });
      }
    });
  },
);

export const ServiceProjectQuoteDraftV1Schema = frozenQuoteSchema(
  ServiceProjectQuoteDraftRawSchema,
  { arrayLimits: { serviceLines: 100, milestones: 100 } },
);

export const SERVICE_PROJECT_QUOTE_DEFINITION = {
  id: "quotation.service.project.v1",
  version: "1.0.0",
  category: "quotation",
  name: "项目服务报价单",
  summary: "按服务项、里程碑、验收与数据处理安排形成项目报价",
  basisDate: "2026-08-19",
  languages: ["zh-CN"],
  defaultLanguage: "zh-CN",
  allowedLayouts: ["modern-business.v1", "classic-formal.v1"],
  defaultLayout: "modern-business.v1",
  supportedOutputs: ["docx", "pdf", "json", "opentrad"],
  sourceKeys: ["samr-contract-library", "prc-civil-code"],
  disclaimerProfile: "quotation",
  fieldManifest: [
    ...quoteMetaEditorFields({ section: "quote-meta", includeCurrency: true, bilingual: false }),
    ...entityPartyEditorFields({ prefix: "seller", section: "parties", label: "报价方" }),
    ...entityPartyEditorFields({ prefix: "buyer", section: "parties", label: "客户" }),
    textEditorField({
      path: "project.projectName",
      section: "project-overview",
      label: "项目名称",
      required: true,
    }),
    textEditorField({
      path: "project.buyerReference",
      section: "project-overview",
      label: "客户参考号",
      required: false,
    }),
    textEditorField({
      path: "project.objective",
      section: "project-overview",
      label: "项目目标",
      required: true,
      multiline: true,
    }),
    textEditorField({
      path: "project.scope",
      section: "scope",
      label: "服务范围",
      required: true,
      multiline: true,
    }),
    textEditorField({
      path: "project.assumptions",
      section: "assumptions",
      label: "项目假设",
      required: false,
      multiline: true,
    }),
    textEditorField({
      path: "project.exclusions",
      section: "exclusions",
      label: "排除事项",
      required: false,
      multiline: true,
    }),
    repeatableEditorField({
      path: "serviceLines",
      section: "service-lines",
      label: "服务报价项",
      required: true,
      minItems: 1,
      maxItems: 100,
      item: {
        kind: "object",
        idPath: "id",
        fields: [
          itemTextField({ path: "serviceName", label: "服务名称", required: true }),
          itemTextField({ path: "englishName", label: "英文名称", required: false }),
          itemTextField({ path: "deliverable", label: "交付物", required: true, multiline: true }),
          itemTextField({ path: "unit", label: "单位", required: true }),
          itemNumberField({ path: "quantity", label: "数量", required: true }),
          itemMoneyField("unitPriceMinor", "未税单价", true),
          itemPercentField("discountBps", "折扣", true),
          itemPercentField("taxRateBps", "税率", true),
          itemNumberField({ path: "estimatedHours", label: "预计工时", required: false }),
          itemTextField({ path: "milestoneId", label: "关联里程碑", required: false }),
        ],
      },
    }),
    repeatableEditorField({
      path: "milestones",
      section: "milestones",
      label: "项目里程碑",
      required: true,
      minItems: 1,
      maxItems: 100,
      item: {
        kind: "object",
        idPath: "id",
        fields: [
          itemTextField({ path: "title", label: "里程碑", required: true }),
          itemTextField({ path: "deliverable", label: "交付物", required: true, multiline: true }),
          itemTextField({
            path: "dueDescription",
            label: "到期说明",
            required: true,
            multiline: true,
          }),
          itemTextField({
            path: "acceptanceCriteria",
            label: "验收标准",
            required: true,
            multiline: true,
          }),
          itemPercentField("paymentBps", "付款占比", false),
        ],
      },
    }),
    dateEditorField("terms.startDate", "delivery-acceptance", "开始日期", false),
    textEditorField({
      path: "terms.duration",
      section: "delivery-acceptance",
      label: "项目周期",
      required: false,
    }),
    textEditorField({
      path: "terms.serviceLocation",
      section: "delivery-acceptance",
      label: "服务地点",
      required: true,
    }),
    textEditorField({
      path: "terms.customerDependencies",
      section: "delivery-acceptance",
      label: "客户依赖",
      required: false,
      multiline: true,
    }),
    textEditorField({
      path: "terms.expensePolicy",
      section: "payment-expenses",
      label: "费用政策",
      required: true,
      multiline: true,
    }),
    textEditorField({
      path: "terms.acceptance",
      section: "delivery-acceptance",
      label: "验收安排",
      required: false,
      multiline: true,
    }),
    textEditorField({
      path: "terms.payment",
      section: "payment-expenses",
      label: "付款安排",
      required: false,
      multiline: true,
    }),
    textEditorField({
      path: "terms.intellectualProperty",
      section: "ip-confidentiality",
      label: "知识产权",
      required: true,
      multiline: true,
    }),
    textEditorField({
      path: "terms.confidentiality",
      section: "ip-confidentiality",
      label: "保密",
      required: false,
      multiline: true,
    }),
    textEditorField({
      path: "terms.changeControl",
      section: "scope",
      label: "变更控制",
      required: true,
      multiline: true,
    }),
    textEditorField({
      path: "terms.notes",
      section: "quote-notice",
      label: "备注",
      required: false,
      multiline: true,
    }),
    checkboxEditorField({
      path: "dataHandling.personalDataInvolved",
      section: "ip-confidentiality",
      label: "是否涉及个人信息",
      required: true,
    }),
    textEditorField({
      path: "dataHandling.processingTerms",
      section: "ip-confidentiality",
      label: "个人信息处理条款",
      required: false,
      multiline: true,
      visibleWhen: { path: "dataHandling.personalDataInvolved", equals: true },
    }),
  ],
} as const satisfies TemplateDefinitionV2;

function parseServiceDraft(value: unknown): ServiceProjectQuoteDraftV1 {
  return ServiceProjectQuoteDraftV1Schema.parse(value) as ServiceProjectQuoteDraftV1;
}

function createServiceDraft(input: {
  readonly id: string;
  readonly now: string | Date;
}): ServiceProjectQuoteDraftV1 {
  const dates = utcDraftDates(input.now);
  return parseServiceDraft({
    id: input.id,
    templateId: "quotation.service.project.v1",
    templateVersion: "1.0.0",
    meta: {
      number: "待填写",
      title: "项目服务报价单",
      issueDate: dates.issueDate,
      validUntil: dates.validUntil,
      currency: "CNY",
      taxMode: "tax-excluded",
      quoteNature: "invitation",
      language: "zh-CN",
      layoutStyleId: "modern-business.v1",
    },
    seller: {
      legalName: "待填写",
      entityType: "company",
      contactName: "待填写",
    },
    buyer: {
      legalName: "待填写",
      entityType: "company",
      contactName: "待填写",
    },
    project: {
      projectName: "待填写",
      objective: "待填写",
      scope: "待填写",
      assumptions: "",
      exclusions: "",
    },
    serviceLines: [
      {
        id: "service-1",
        serviceName: "待填写",
        deliverable: "待填写",
        unit: "项",
        quantity: "1",
        unitPriceMinor: "0",
        discountBps: 0,
        taxRateBps: 0,
        milestoneId: "milestone-1",
      },
    ],
    milestones: [
      {
        id: "milestone-1",
        title: "待填写",
        deliverable: "待填写",
        dueDescription: "待填写",
        acceptanceCriteria: "待填写",
      },
    ],
    terms: {
      duration: "待填写",
      serviceLocation: "待填写",
      expensePolicy: "待填写",
      acceptance: "待填写",
      payment: "待填写",
      intellectualProperty: "待填写",
      changeControl: "待填写",
    },
    dataHandling: { personalDataInvolved: false },
    updatedAt: dates.updatedAt,
  });
}

function analyzeServiceDraft(draft: ServiceProjectQuoteDraftV1): readonly RiskFindingV2[] {
  const findings: RiskFindingV2[] = [];
  if (hasPlaceholder(draft)) {
    findings.push(
      finding("QUOTE_UNRESOLVED_PLACEHOLDER", "error", "watermark", "报价单仍包含待填写内容"),
    );
  }
  if (draft.meta.quoteNature === "invitation") {
    findings.push(
      finding(
        "QUOTE_INVITATION_NON_BINDING",
        "info",
        "advisory",
        "询价邀请不构成具有约束力的要约",
        ["meta", "quoteNature"],
      ),
    );
  } else {
    if (draft.terms.duration.trim().length === 0) {
      findings.push(
        finding(
          "SERVICE_BINDING_DURATION_MISSING",
          "error",
          "blockSubmission",
          "约束性服务报价必须约定项目周期",
          ["terms", "duration"],
        ),
      );
    }
    if (draft.terms.acceptance.trim().length === 0) {
      findings.push(
        finding(
          "SERVICE_BINDING_ACCEPTANCE_MISSING",
          "error",
          "blockSubmission",
          "约束性服务报价必须约定验收方式",
          ["terms", "acceptance"],
        ),
      );
    }
    if (draft.terms.payment.trim().length === 0) {
      findings.push(
        finding(
          "SERVICE_BINDING_PAYMENT_MISSING",
          "error",
          "blockSubmission",
          "约束性服务报价必须约定付款方式",
          ["terms", "payment"],
        ),
      );
    }
  }
  if (
    draft.dataHandling.personalDataInvolved &&
    (!draft.dataHandling.processingTerms || draft.dataHandling.processingTerms.trim().length === 0)
  ) {
    findings.push(
      finding(
        "SERVICE_PERSONAL_DATA_TERMS_MISSING",
        "error",
        "blockSubmission",
        "涉及个人信息时必须约定处理范围和责任",
        ["dataHandling", "processingTerms"],
      ),
    );
  }
  const allocated = draft.milestones.filter((milestone) => milestone.paymentBps !== undefined);
  const allocationTotal = allocated.reduce(
    (total, milestone) => total + (milestone.paymentBps ?? 0),
    0,
  );
  if (allocated.length !== draft.milestones.length || allocationTotal !== 10_000) {
    findings.push(
      finding(
        "SERVICE_MILESTONE_PAYMENT_INCOMPLETE",
        "warning",
        "watermark",
        "里程碑付款比例未完整分配为 100%",
        ["milestones"],
      ),
    );
  }
  return freezeFindings(findings);
}

function projectServiceLines(lines: readonly ServiceLineV2[]) {
  return lines.map((line) => ({
    id: line.id,
    quantity: line.quantity,
    unitPriceMinor: line.unitPriceMinor,
    discountBps: line.discountBps,
    taxRateBps: line.taxRateBps,
  }));
}

function compileServiceDraft(value: unknown): DocumentModelV2 {
  const draft = parseServiceDraft(value);
  const analysis = analyzeServiceDraft(draft);
  const calculation = calculateQuoteLinesV2(projectServiceLines(draft.serviceLines), {
    currency: draft.meta.currency,
    taxMode: draft.meta.taxMode,
  });
  const amountByLine = new Map(calculation.lines.map((line) => [line.lineId, line]));
  const sections = [
    {
      id: "title",
      blocks: [
        {
          type: "cover" as const,
          id: "service-title-cover",
          title: localized(draft.meta.title, draft.meta.englishTitle),
          subtitle: localized(draft.project.projectName),
        },
      ],
    },
    {
      id: "quote-meta",
      blocks: [
        {
          type: "keyValueGrid" as const,
          id: "service-meta-grid",
          entries: [
            { id: "number", label: localized("报价编号"), value: localized(draft.meta.number) },
            { id: "issue", label: localized("报价日期"), value: localized(draft.meta.issueDate) },
            { id: "valid", label: localized("有效期至"), value: localized(draft.meta.validUntil) },
            { id: "currency", label: localized("币种"), value: localized(draft.meta.currency) },
          ],
        },
      ],
    },
    {
      id: "parties",
      blocks: [
        {
          type: "parties" as const,
          id: "service-parties-block",
          parties: [
            {
              id: "seller",
              role: localized("报价方", "Seller"),
              name: localized(draft.seller.legalName, draft.seller.englishName),
              details: partyDetails(draft.seller),
            },
            {
              id: "buyer",
              role: localized("客户", "Buyer"),
              name: localized(draft.buyer.legalName, draft.buyer.englishName),
              details: partyDetails(draft.buyer),
            },
          ],
        },
      ],
    },
    {
      id: "project-overview",
      blocks: [
        {
          type: "keyValueGrid" as const,
          id: "service-project-grid",
          entries: [
            {
              id: "project-name",
              label: localized("项目名称"),
              value: localized(draft.project.projectName),
            },
            {
              id: "buyer-reference",
              label: localized("客户参考号"),
              value: localized(draft.project.buyerReference || "未提供"),
            },
            {
              id: "objective",
              label: localized("项目目标"),
              value: localized(draft.project.objective),
            },
          ],
        },
      ],
    },
    {
      id: "scope",
      blocks: [
        {
          type: "heading" as const,
          id: "scope-heading",
          level: 1 as const,
          text: localized("服务范围"),
        },
        { type: "paragraph" as const, id: "scope-text", text: localized(draft.project.scope) },
      ],
    },
    {
      id: "service-lines",
      blocks: [
        {
          type: "table" as const,
          id: "service-lines-table",
          columns: [
            { id: "service", label: localized("服务项"), width: "22%", align: "left" as const },
            { id: "deliverable", label: localized("交付物"), width: "24%", align: "left" as const },
            { id: "quantity", label: localized("数量"), width: "12%", align: "right" as const },
            { id: "unitPrice", label: localized("单价"), width: "18%", align: "right" as const },
            { id: "total", label: localized("含税合计"), width: "24%", align: "right" as const },
          ],
          rows: draft.serviceLines.map((line) => ({
            id: line.id,
            cells: {
              service: localized(line.serviceName, line.englishName),
              deliverable: localized(line.deliverable),
              quantity: localized(`${line.quantity} ${line.unit}`),
              unitPrice: localized(formatMoneyMinorV2(line.unitPriceMinor, draft.meta.currency)),
              total: localized(
                formatMoneyMinorV2(
                  amountByLine.get(line.id)?.totalMinor ?? "0",
                  draft.meta.currency,
                ),
              ),
            },
          })),
          repeatHeader: true,
          pagePolicy: { allowRowSplit: false, keepHeaderWithRows: 1 },
        },
      ],
    },
    {
      id: "milestones",
      blocks: [
        {
          type: "table" as const,
          id: "service-milestones-table",
          columns: [
            { id: "title", label: localized("里程碑"), width: "20%", align: "left" as const },
            { id: "deliverable", label: localized("交付物"), width: "25%", align: "left" as const },
            { id: "due", label: localized("时间"), width: "25%", align: "left" as const },
            {
              id: "acceptance",
              label: localized("验收标准"),
              width: "20%",
              align: "left" as const,
            },
            { id: "payment", label: localized("付款比例"), width: "10%", align: "right" as const },
          ],
          rows: draft.milestones.map((milestone) => ({
            id: milestone.id,
            cells: {
              title: localized(milestone.title),
              deliverable: localized(milestone.deliverable),
              due: localized(milestone.dueDescription),
              acceptance: localized(milestone.acceptanceCriteria),
              payment: localized(
                milestone.paymentBps === undefined
                  ? "未约定"
                  : `${(milestone.paymentBps / 100).toFixed(2)}%`,
              ),
            },
          })),
          repeatHeader: true,
          pagePolicy: { allowRowSplit: false, keepHeaderWithRows: 1 },
        },
      ],
    },
    {
      id: "totals",
      blocks: [
        {
          type: "totals" as const,
          id: "service-totals-block",
          entries: [
            {
              id: "subtotal",
              label: localized("未税小计"),
              value: localized(
                formatMoneyMinorV2(calculation.summary.subtotalMinor, draft.meta.currency),
              ),
            },
            {
              id: "tax",
              label: localized("税额"),
              value: localized(
                formatMoneyMinorV2(calculation.summary.taxMinor, draft.meta.currency),
              ),
            },
            {
              id: "total",
              label: localized("报价总额"),
              value: localized(
                formatMoneyMinorV2(calculation.summary.totalMinor, draft.meta.currency),
              ),
            },
          ],
        },
      ],
    },
    {
      id: "assumptions",
      blocks: [
        {
          type: "heading" as const,
          id: "assumptions-heading",
          level: 1 as const,
          text: localized("报价假设"),
        },
        {
          type: "paragraph" as const,
          id: "assumptions-text",
          text: localized(draft.project.assumptions?.trim() || "未约定"),
        },
      ],
    },
    {
      id: "exclusions",
      blocks: [
        {
          type: "heading" as const,
          id: "exclusions-heading",
          level: 1 as const,
          text: localized("不包含事项"),
        },
        {
          type: "paragraph" as const,
          id: "exclusions-text",
          text: localized(draft.project.exclusions?.trim() || "未约定"),
        },
      ],
    },
    {
      id: "delivery-acceptance",
      blocks: [
        {
          type: "keyValueGrid" as const,
          id: "service-delivery-grid",
          entries: [
            {
              id: "start",
              label: localized("开始日期"),
              value: localized(draft.terms.startDate || "未约定"),
            },
            {
              id: "duration",
              label: localized("项目周期"),
              value: localized(draft.terms.duration || "未约定"),
            },
            {
              id: "location",
              label: localized("服务地点"),
              value: localized(draft.terms.serviceLocation),
            },
            {
              id: "acceptance",
              label: localized("验收"),
              value: localized(draft.terms.acceptance || "未约定"),
            },
          ],
        },
      ],
    },
    {
      id: "payment-expenses",
      blocks: [
        {
          type: "keyValueGrid" as const,
          id: "service-payment-grid",
          entries: [
            {
              id: "payment",
              label: localized("付款"),
              value: localized(draft.terms.payment || "未约定"),
            },
            {
              id: "expenses",
              label: localized("费用政策"),
              value: localized(draft.terms.expensePolicy),
            },
            {
              id: "dependencies",
              label: localized("客户配合"),
              value: localized(draft.terms.customerDependencies || "未约定"),
            },
          ],
        },
      ],
    },
    {
      id: "ip-confidentiality",
      blocks: [
        {
          type: "keyValueGrid" as const,
          id: "service-ip-grid",
          entries: [
            {
              id: "ip",
              label: localized("知识产权"),
              value: localized(draft.terms.intellectualProperty),
            },
            {
              id: "confidentiality",
              label: localized("保密"),
              value: localized(draft.terms.confidentiality || "未约定"),
            },
            {
              id: "change",
              label: localized("变更控制"),
              value: localized(draft.terms.changeControl),
            },
            {
              id: "personal-data",
              label: localized("个人信息"),
              value: localized(
                draft.dataHandling.personalDataInvolved
                  ? draft.dataHandling.processingTerms?.trim() || "涉及但未约定处理条款"
                  : "不涉及",
              ),
            },
          ],
        },
      ],
    },
    {
      id: "quote-notice",
      blocks: [
        {
          type: "notice" as const,
          id: "service-quote-notice",
          tone: "info" as const,
          paragraphs: [
            localized(draft.terms.notes || "本报价的最终约束力以双方后续签署文件为准。"),
          ],
        },
      ],
    },
    {
      id: "signature",
      blocks: [
        {
          type: "signatureGroup" as const,
          id: "service-signatures",
          signers: [
            {
              role: localized("报价方"),
              name: draft.seller.legalName,
              dateLabel: localized("日期"),
              sealLabel: localized("盖章"),
            },
            {
              role: localized("客户确认"),
              name: draft.buyer.legalName,
              dateLabel: localized("日期"),
              sealLabel: localized("盖章"),
            },
          ],
        },
      ],
    },
  ];

  return DocumentModelV2Schema.parse({
    schemaVersion: "2.0.0",
    documentId: draft.id,
    template: {
      id: draft.templateId,
      version: draft.templateVersion,
      basisDate: "2026-08-19",
    },
    documentKind: "quotation",
    language: draft.meta.language,
    title: localized(draft.meta.title, draft.meta.englishTitle),
    pageDefaults: {
      size: "A4",
      orientation: "portrait",
      marginsMm: { top: 18, right: 16, bottom: 18, left: 16 },
    },
    sections,
    watermarks: findingsWatermark(analysis),
    disclaimers: ["quotation-non-advice"],
    attachmentManifest: [],
  }) as DocumentModelV2;
}

function createServiceRepeatableItem(
  path: string,
  input: { readonly id: string; readonly now: string | Date; readonly draft: unknown },
): unknown {
  if (path === "serviceLines") {
    return {
      id: input.id,
      serviceName: "待填写",
      deliverable: "待填写",
      unit: "项",
      quantity: "1",
      unitPriceMinor: "0",
      discountBps: 0,
      taxRateBps: 0,
    };
  }
  if (path === "milestones") {
    return {
      id: input.id,
      title: "待填写",
      deliverable: "待填写",
      dueDescription: "待填写",
      acceptanceCriteria: "待填写",
    };
  }
  throw new Error("不支持的重复项路径");
}

export const SERVICE_PROJECT_QUOTE_REGISTRATION: TemplateRegistration<unknown, DocumentModelV2> =
  Object.freeze({
    definition: SERVICE_PROJECT_QUOTE_DEFINITION,
    parseDraft: parseServiceDraft,
    createDraft: createServiceDraft,
    createRepeatableItem: createServiceRepeatableItem,
    compile: compileServiceDraft,
    preflight(value: unknown) {
      return analyzeServiceDraft(parseServiceDraft(value));
    },
  });
