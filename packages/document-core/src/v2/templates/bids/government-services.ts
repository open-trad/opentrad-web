import { isolatedArraySchema } from "../../../safe-schema.js";
import { z } from "../../../zod.js";
import type { TemplateDefinitionV2 } from "../../common.js";
import { type DocumentModelV2, DocumentModelV2Schema } from "../../document-model.js";
import { calculateQuoteLinesV2, formatMoneyMinorV2, IdentifierV2Schema } from "../../money.js";
import type { TemplateEvaluationContext, TemplateRegistration } from "../../registry.js";
import type { RiskFindingV2 } from "../../risk.js";
import {
  type BidDraftBaseV1,
  BidProjectReferenceV1Schema,
  decideBidExport,
  evaluateBidDeadline,
  requiredBidContentFindings,
} from "../bid-common.js";
import {
  bidBaseEditorFields,
  bidProjectReferenceItemSpec,
  bidServicePriceLineItemSpec,
  itemAttachmentField,
  itemCheckboxField,
  itemDateField,
  itemStringListField,
  itemTextField,
  repeatableEditorField,
  textEditorField,
} from "../editor-manifest.js";
import { type ServiceLineV2, ServiceLineV2Schema } from "../quote-common.js";
import {
  bidFinding,
  bidLocalized,
  bidText,
  commonBidFindings,
  createBidBaseDraft,
  createBidBaseRepeatableItem,
  createSpecializedBidSchema,
  freezeBidFindings,
  projectBidBaseDraft,
  publicBidAttachmentManifest,
  REQUIREMENT_MATRIX_COLUMNS,
  requirementMatrixRows,
  sameBidData,
  show,
  strictBidObject,
} from "./government-goods.js";

function uniqueIds(
  values: readonly { readonly id: string }[],
  addIssue: (issue: { code: "custom"; message: string; path?: PropertyKey[] }) => void,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      addIssue({
        code: "custom",
        message: "Specialized bid ids must be unique",
        path: [index, "id"],
      });
    }
    seen.add(value.id);
  });
}

function realDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

const DateSchema = z.string().refine(realDate, "Expected a real YYYY-MM-DD date");

const WorkPackageSchema = strictBidObject({
  id: IdentifierV2Schema,
  name: bidText(500, true),
  activities: bidText(10_000, true),
  deliverables: isolatedArraySchema(bidText(1_000, true), { max: 100 }),
});

const DeliverableSchema = strictBidObject({
  id: IdentifierV2Schema,
  name: bidText(500, true),
  dueDate: DateSchema,
  acceptanceStandard: bidText(10_000, true),
});

const MilestoneSchema = strictBidObject({
  id: IdentifierV2Schema,
  name: bidText(500, true),
  date: DateSchema,
  dependency: bidText(2_000, true).optional(),
});

const SlaSchema = strictBidObject({
  id: IdentifierV2Schema,
  metric: bidText(500, true),
  target: bidText(500, true),
  measurement: bidText(2_000, true),
  remedy: bidText(2_000, true).optional(),
});

const StaffingSchema = strictBidObject({
  id: IdentifierV2Schema,
  name: bidText(300, true),
  role: bidText(300, true),
  qualification: bidText(2_000, true),
  experience: bidText(2_000, true),
  allocation: bidText(300, true),
  userConfirmedTruth: z.boolean(),
});

const PolicyDeclarationSchema = strictBidObject({
  id: IdentifierV2Schema,
  policyName: bidText(500, true),
  statement: bidText(10_000, true),
  evidenceAttachmentIds: isolatedArraySchema(IdentifierV2Schema, { max: 100 }),
  applicable: z.boolean(),
  userConfirmedTruth: z.boolean(),
});

const GovernmentServicesSpecializedSchema = strictBidObject({
  serviceUnderstanding: bidText(10_000, true),
  objectives: bidText(10_000, true),
  methodology: bidText(10_000, true),
  workPackages: isolatedArraySchema(WorkPackageSchema, { max: 100, refine: uniqueIds }),
  deliverables: isolatedArraySchema(DeliverableSchema, { max: 100, refine: uniqueIds }),
  milestones: isolatedArraySchema(MilestoneSchema, { max: 100, refine: uniqueIds }),
  sla: isolatedArraySchema(SlaSchema, { max: 100, refine: uniqueIds }),
  staffing: isolatedArraySchema(StaffingSchema, { max: 100, refine: uniqueIds }),
  projectManager: bidText(300, true),
  qualityPlan: bidText(10_000, true),
  riskPlan: bidText(10_000, true),
  securityPlan: bidText(10_000, true).optional(),
  privacyPlan: bidText(10_000, true).optional(),
  businessContinuity: bidText(10_000, true).optional(),
  acceptancePlan: bidText(10_000, true),
  servicePriceLines: isolatedArraySchema(ServiceLineV2Schema, { max: 100, refine: uniqueIds }),
  performanceEvidence: isolatedArraySchema(BidProjectReferenceV1Schema, {
    max: 100,
    refine: uniqueIds,
  }),
  policyDeclarations: isolatedArraySchema(PolicyDeclarationSchema, {
    max: 100,
    refine: uniqueIds,
  }),
});

export interface GovernmentServicesBidDraftV1 extends BidDraftBaseV1 {
  readonly templateId: "bid.government.services.v1";
  readonly serviceUnderstanding: string;
  readonly objectives: string;
  readonly methodology: string;
  readonly workPackages: readonly z.output<typeof WorkPackageSchema>[];
  readonly deliverables: readonly z.output<typeof DeliverableSchema>[];
  readonly milestones: readonly z.output<typeof MilestoneSchema>[];
  readonly sla: readonly z.output<typeof SlaSchema>[];
  readonly staffing: readonly z.output<typeof StaffingSchema>[];
  readonly projectManager: string;
  readonly qualityPlan: string;
  readonly riskPlan: string;
  readonly securityPlan?: string;
  readonly privacyPlan?: string;
  readonly businessContinuity?: string;
  readonly acceptancePlan: string;
  readonly servicePriceLines: readonly ServiceLineV2[];
  readonly performanceEvidence: BidDraftBaseV1["projectReferences"];
  readonly policyDeclarations: readonly z.output<typeof PolicyDeclarationSchema>[];
}

const SPECIALIZED_KEYS = Object.freeze([
  "serviceUnderstanding",
  "objectives",
  "methodology",
  "workPackages",
  "deliverables",
  "milestones",
  "sla",
  "staffing",
  "projectManager",
  "qualityPlan",
  "riskPlan",
  "securityPlan",
  "privacyPlan",
  "businessContinuity",
  "acceptancePlan",
  "servicePriceLines",
  "performanceEvidence",
  "policyDeclarations",
]);

export const GovernmentServicesBidDraftV1Schema = createSpecializedBidSchema(
  "bid.government.services.v1",
  SPECIALIZED_KEYS,
  GovernmentServicesSpecializedSchema,
  (draft, addIssue) => {
    const milestoneIds = new Set(draft.milestones.map((item) => item.id));
    draft.servicePriceLines.forEach((line, index) => {
      if (line.milestoneId !== undefined && !milestoneIds.has(line.milestoneId)) {
        addIssue({
          code: "custom",
          message: "Service-price milestone does not exist",
          path: ["servicePriceLines", index, "milestoneId"],
        });
      }
    });
    if (
      draft.staffing.length > 0 &&
      !draft.staffing.some((person) => person.name === draft.projectManager)
    ) {
      addIssue({
        code: "custom",
        message: "Project manager must identify a staffing row",
        path: ["projectManager"],
      });
    }
    const canonicalReferences = new Map(draft.projectReferences.map((item) => [item.id, item]));
    draft.performanceEvidence.forEach((item, index) => {
      const canonical = canonicalReferences.get(item.id);
      if (!canonical || !sameBidData(canonical, item)) {
        addIssue({
          code: "custom",
          message: "Performance evidence must match a canonical project reference",
          path: ["performanceEvidence", index],
        });
      }
    });
    const attachmentIds = new Set(draft.attachments.map((item) => item.id));
    draft.policyDeclarations.forEach((policy, index) => {
      policy.evidenceAttachmentIds.forEach((attachmentId, evidenceIndex) => {
        if (!attachmentIds.has(attachmentId)) {
          addIssue({
            code: "custom",
            message: "Policy evidence attachment does not exist",
            path: ["policyDeclarations", index, "evidenceAttachmentIds", evidenceIndex],
          });
        }
      });
    });
  },
);

export const GOVERNMENT_SERVICES_BID_DEFINITION = {
  id: "bid.government.services.v1",
  version: "1.0.0",
  category: "bid",
  name: "政府采购服务投标文件",
  summary: "覆盖理解、方法、交付、人员、SLA、质量、风险、隐私、验收、业绩和报价的服务投标底稿",
  basisDate: "2026-08-19",
  languages: ["zh-CN"],
  defaultLanguage: "zh-CN",
  allowedLayouts: ["classic-formal.v1"],
  defaultLayout: "classic-formal.v1",
  supportedOutputs: ["docx", "pdf", "json", "opentrad"],
  sourceKeys: ["mof-order-87", "mof-demand-management"],
  disclaimerProfile: "bid",
  fieldManifest: [
    ...bidBaseEditorFields({
      sourceSection: "source-baseline",
      bidderSection: "bidder",
      qualificationSection: "qualifications",
      priceSection: "service-price",
      deviationSection: "deviations",
      casesSection: "performance-evidence",
      finalReviewSection: "final-checklist",
    }),
    ...[
      ["serviceUnderstanding", "understanding-objectives", "项目理解", true],
      ["objectives", "understanding-objectives", "服务目标", true],
      ["methodology", "methodology", "服务方法", true],
      ["qualityPlan", "quality-sla", "质量方案", true],
      ["riskPlan", "risk", "风险方案", true],
      ["securityPlan", "security-privacy", "安全方案", false],
      ["privacyPlan", "security-privacy", "隐私方案", false],
      ["businessContinuity", "continuity", "业务连续性", false],
      ["acceptancePlan", "acceptance", "验收方案", true],
    ].map(([path, section, label, required]) =>
      textEditorField({
        path: String(path),
        section: String(section),
        label: String(label),
        required: Boolean(required),
        multiline: true,
      }),
    ),
    repeatableEditorField({
      path: "workPackages",
      section: "methodology",
      label: "工作包",
      required: false,
      minItems: 0,
      maxItems: 100,
      item: {
        kind: "object",
        idPath: "id",
        fields: [
          itemTextField({ path: "name", label: "名称", required: true }),
          itemTextField({ path: "activities", label: "活动", required: true, multiline: true }),
          itemStringListField({
            path: "deliverables",
            label: "交付内容",
            required: false,
            minItems: 0,
            maxItems: 100,
          }),
        ],
      },
    }),
    repeatableEditorField({
      path: "deliverables",
      section: "deliverables-schedule",
      label: "交付物",
      required: true,
      minItems: 0,
      maxItems: 100,
      item: {
        kind: "object",
        idPath: "id",
        fields: [
          itemTextField({ path: "name", label: "名称", required: true }),
          itemDateField("dueDate", "交付日期", true),
          itemTextField({
            path: "acceptanceStandard",
            label: "验收标准",
            required: true,
            multiline: true,
          }),
        ],
      },
    }),
    repeatableEditorField({
      path: "milestones",
      section: "deliverables-schedule",
      label: "里程碑",
      required: false,
      minItems: 0,
      maxItems: 100,
      item: {
        kind: "object",
        idPath: "id",
        fields: [
          itemTextField({ path: "name", label: "名称", required: true }),
          itemDateField("date", "日期", true),
          itemTextField({ path: "dependency", label: "依赖", required: false, multiline: true }),
        ],
      },
    }),
    repeatableEditorField({
      path: "sla",
      section: "quality-sla",
      label: "服务水平",
      required: true,
      minItems: 0,
      maxItems: 100,
      item: {
        kind: "object",
        idPath: "id",
        fields: [
          itemTextField({ path: "metric", label: "指标", required: true }),
          itemTextField({ path: "target", label: "目标", required: true }),
          itemTextField({
            path: "measurement",
            label: "测量方式",
            required: true,
            multiline: true,
          }),
          itemTextField({ path: "remedy", label: "补救措施", required: false, multiline: true }),
        ],
      },
    }),
    repeatableEditorField({
      path: "staffing",
      section: "staffing",
      label: "服务团队",
      required: true,
      minItems: 0,
      maxItems: 100,
      item: {
        kind: "object",
        idPath: "id",
        fields: [
          itemTextField({ path: "name", label: "姓名", required: true }),
          itemTextField({ path: "role", label: "角色", required: true }),
          itemTextField({ path: "qualification", label: "资质", required: true, multiline: true }),
          itemTextField({ path: "experience", label: "经验", required: true, multiline: true }),
          itemTextField({ path: "allocation", label: "投入安排", required: true }),
          itemCheckboxField("userConfirmedTruth", "用户确认真实", true),
        ],
      },
    }),
    textEditorField({
      path: "projectManager",
      section: "staffing",
      label: "项目经理姓名",
      required: true,
    }),
    repeatableEditorField({
      path: "servicePriceLines",
      section: "service-price",
      label: "服务报价",
      required: true,
      minItems: 0,
      maxItems: 100,
      item: bidServicePriceLineItemSpec("milestones"),
    }),
    repeatableEditorField({
      path: "performanceEvidence",
      section: "performance-evidence",
      label: "业绩证据",
      required: false,
      minItems: 0,
      maxItems: 100,
      item: bidProjectReferenceItemSpec(),
    }),
    repeatableEditorField({
      path: "policyDeclarations",
      section: "policy-declarations",
      label: "政府采购政策声明",
      required: false,
      minItems: 0,
      maxItems: 100,
      item: {
        kind: "object",
        idPath: "id",
        fields: [
          itemTextField({ path: "policyName", label: "政策名称", required: true }),
          itemTextField({ path: "statement", label: "声明", required: true, multiline: true }),
          itemAttachmentField({
            path: "evidenceAttachmentIds",
            label: "政策证明附件",
            required: false,
            multiple: true,
            maxItems: 100,
            role: "supporting",
            category: "qualification",
            includeInSubmissionDefault: true,
          }),
          itemCheckboxField("applicable", "适用", true),
          itemCheckboxField("userConfirmedTruth", "用户确认真实", true),
        ],
      },
    }),
  ],
} as const satisfies TemplateDefinitionV2;

function parseDraft(value: unknown): GovernmentServicesBidDraftV1 {
  return GovernmentServicesBidDraftV1Schema.parse(value) as GovernmentServicesBidDraftV1;
}

function createDraft(input: { readonly id: string; readonly now: string | Date }) {
  return parseDraft({
    ...createBidBaseDraft("bid.government.services.v1", input),
    serviceUnderstanding: "待填写",
    objectives: "待填写",
    methodology: "待填写",
    workPackages: [],
    deliverables: [],
    milestones: [],
    sla: [],
    staffing: [],
    projectManager: "待填写",
    qualityPlan: "待填写",
    riskPlan: "待填写",
    acceptancePlan: "待填写",
    servicePriceLines: [],
    performanceEvidence: [],
    policyDeclarations: [],
  });
}

function calculation(draft: GovernmentServicesBidDraftV1) {
  if (draft.servicePriceLines.length === 0 || draft.source.taxBasis === "as-specified")
    return undefined;
  return calculateQuoteLinesV2(
    draft.servicePriceLines.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      discountBps: line.discountBps,
      taxRateBps: line.taxRateBps,
    })),
    { currency: draft.source.currency, taxMode: draft.source.taxBasis },
  );
}

function analyze(draft: GovernmentServicesBidDraftV1): readonly RiskFindingV2[] {
  const findings = commonBidFindings(draft);
  const placeholder = /^(?:\s*|待填写|待确认|未提供|未绑定)$/u;
  for (const [field, value, code, label] of [
    [
      "serviceUnderstanding",
      draft.serviceUnderstanding,
      "BID_SERVICE_UNDERSTANDING_MISSING",
      "服务理解",
    ],
    ["objectives", draft.objectives, "BID_SERVICE_OBJECTIVES_MISSING", "服务目标"],
    ["methodology", draft.methodology, "BID_SERVICE_METHODOLOGY_MISSING", "服务方法"],
    ["projectManager", draft.projectManager, "BID_SERVICE_MANAGER_MISSING", "项目经理"],
    ["qualityPlan", draft.qualityPlan, "BID_SERVICE_QUALITY_PLAN_MISSING", "质量方案"],
    ["riskPlan", draft.riskPlan, "BID_SERVICE_RISK_PLAN_MISSING", "风险方案"],
    ["acceptancePlan", draft.acceptancePlan, "BID_SERVICE_ACCEPTANCE_PLAN_MISSING", "验收方案"],
  ] as const) {
    if (placeholder.test(value)) findings.push(bidFinding(code, `${label}尚未提供`, [field]));
  }
  findings.push(
    ...requiredBidContentFindings([
      {
        path: [],
        value: {
          serviceUnderstanding: draft.serviceUnderstanding,
          objectives: draft.objectives,
          methodology: draft.methodology,
          projectManager: draft.projectManager,
          qualityPlan: draft.qualityPlan,
          riskPlan: draft.riskPlan,
          acceptancePlan: draft.acceptancePlan,
        },
      },
      {
        path: ["workPackages"],
        value: draft.workPackages.map((item) => ({
          name: item.name,
          activities: item.activities,
          deliverables: item.deliverables,
        })),
      },
      {
        path: ["deliverables"],
        value: draft.deliverables.map((item) => ({
          name: item.name,
          acceptanceStandard: item.acceptanceStandard,
        })),
      },
      {
        path: ["milestones"],
        value: draft.milestones.map((item) => ({ name: item.name })),
      },
      {
        path: ["sla"],
        value: draft.sla.map((item) => ({
          metric: item.metric,
          target: item.target,
          measurement: item.measurement,
        })),
      },
      {
        path: ["staffing"],
        value: draft.staffing.map((item) => ({
          name: item.name,
          role: item.role,
          qualification: item.qualification,
          experience: item.experience,
          allocation: item.allocation,
        })),
      },
      {
        path: ["servicePriceLines"],
        value: draft.servicePriceLines.map((item) => ({
          serviceName: item.serviceName,
          deliverable: item.deliverable,
          unit: item.unit,
        })),
      },
      {
        path: ["performanceEvidence"],
        value: draft.performanceEvidence.map((item) => ({
          projectName: item.projectName,
          customer: item.customer,
          period: item.period,
          scope: item.scope,
        })),
      },
      {
        path: ["policyDeclarations"],
        value: draft.policyDeclarations.map((item) => ({
          policyName: item.policyName,
          statement: item.statement,
        })),
      },
    ]),
  );
  const requireRows = (value: readonly unknown[], code: string, message: string, path: string) => {
    if (value.length === 0) findings.push(bidFinding(code, message, [path]));
  };
  requireRows(
    draft.workPackages,
    "BID_SERVICE_WORK_PACKAGES_MISSING",
    "服务工作包尚未提供",
    "workPackages",
  );
  requireRows(
    draft.deliverables,
    "BID_SERVICE_DELIVERABLES_MISSING",
    "服务交付物尚未提供",
    "deliverables",
  );
  requireRows(draft.staffing, "BID_SERVICE_STAFFING_MISSING", "服务人员配置尚未提供", "staffing");
  requireRows(draft.sla, "BID_SERVICE_SLA_MISSING", "服务水平指标尚未提供", "sla");
  requireRows(
    draft.servicePriceLines,
    "BID_SERVICE_PRICE_LINES_MISSING",
    "服务报价明细尚未提供",
    "servicePriceLines",
  );
  draft.staffing.forEach((person, index) => {
    if (!person.userConfirmedTruth) {
      findings.push(
        bidFinding("BID_SERVICE_STAFF_TRUTH_UNCONFIRMED", "人员资质和经历必须由用户确认真实性", [
          "staffing",
          String(index),
        ]),
      );
    }
  });
  draft.performanceEvidence.forEach((reference, index) => {
    if (!reference.userConfirmedTruth) {
      findings.push(
        bidFinding("BID_SERVICE_PERFORMANCE_TRUTH_UNCONFIRMED", "业绩信息必须由用户确认真实性", [
          "performanceEvidence",
          String(index),
        ]),
      );
    }
  });
  if (draft.source.taxBasis === "as-specified") {
    findings.push(
      bidFinding("BID_SERVICE_TAX_BASIS_UNRESOLVED", "须按项目招标文件确认服务报价含税口径", [
        "source",
        "taxBasis",
      ]),
    );
  }
  const exact = calculation(draft);
  if (
    exact &&
    [
      draft.priceDeclaration.itemizedTotalMinor,
      draft.priceDeclaration.bidLetterTotalMinor,
      draft.priceDeclaration.openingTotalMinor,
    ].some((total) => total !== exact.summary.totalMinor)
  ) {
    findings.push(
      bidFinding("BID_SERVICE_CALCULATED_TOTAL_MISMATCH", "服务报价重算总价与投标报价声明不一致", [
        "priceDeclaration",
      ]),
    );
  }
  const attachments = new Map(draft.attachments.map((item) => [item.id, item]));
  draft.policyDeclarations.forEach((policy, index) => {
    if (
      policy.applicable &&
      (!policy.userConfirmedTruth ||
        policy.evidenceAttachmentIds.length === 0 ||
        policy.evidenceAttachmentIds.some((id) => {
          const attachment = attachments.get(id);
          return attachment?.status !== "attached" || !attachment.includedInSubmission;
        }))
    ) {
      findings.push(
        bidFinding("BID_SERVICE_POLICY_UNVERIFIED", "适用的政策声明须经用户确认并有证据附件", [
          "policyDeclarations",
          String(index),
        ]),
      );
    }
  });
  return freezeBidFindings(findings);
}

function compile(value: unknown, context?: TemplateEvaluationContext): DocumentModelV2 {
  const draft = parseDraft(value);
  const deadline = evaluateBidDeadline(projectBidBaseDraft(draft), context);
  const findings = freezeBidFindings([...analyze(draft), ...deadline.findings]);
  const decision = decideBidExport({
    draft: projectBidBaseDraft(draft),
    findings,
    ...(deadline.asOf === undefined ? {} : { asOf: deadline.asOf }),
  });
  const exact = calculation(draft);
  const totals = new Map(exact?.lines.map((item) => [item.lineId, item.totalMinor]));
  const money = (minor: string) => formatMoneyMinorV2(minor, draft.source.currency);
  const paragraph = (id: string, text: string) => ({
    type: "paragraph" as const,
    id,
    text: bidLocalized(text),
  });
  const section = (id: string, text: string) => ({ id, blocks: [paragraph(`${id}-text`, text)] });
  const table = (
    id: string,
    columns: readonly {
      id: string;
      label: ReturnType<typeof bidLocalized>;
      width: string;
      align: "left" | "center" | "right";
    }[],
    rows: readonly { id: string; cells: Record<string, ReturnType<typeof bidLocalized>> }[],
  ) => ({
    type: "table" as const,
    id,
    columns,
    rows,
    repeatHeader: true,
    pagePolicy: { allowRowSplit: false, keepHeaderWithRows: 1 },
  });
  const deviations = [...draft.businessDeviations, ...draft.technicalDeviations];
  const sections = [
    {
      id: "draft-cover",
      blocks: [
        {
          type: "cover" as const,
          id: "government-services-cover",
          title: bidLocalized("政府采购服务投标文件"),
          subtitle: bidLocalized(
            `${show(draft.source.projectName)} · ${show(draft.source.packageNumber)}`,
          ),
        },
      ],
    },
    {
      id: "source-baseline",
      blocks: [
        {
          type: "keyValueGrid" as const,
          id: "government-services-source",
          entries: [
            {
              id: "project-number",
              label: bidLocalized("项目编号"),
              value: bidLocalized(show(draft.source.projectNumber)),
            },
            {
              id: "version-label",
              label: bidLocalized("文件版本"),
              value: bidLocalized(show(draft.source.versionLabel)),
            },
            {
              id: "deadline",
              label: bidLocalized("投标截止"),
              value: bidLocalized(show(draft.source.bidDeadline)),
            },
            {
              id: "source-file",
              label: bidLocalized("项目招标文件"),
              value: bidLocalized(show(draft.source.versionEvidence.mainSolicitationAttachmentId)),
            },
          ],
        },
        {
          type: "notice" as const,
          id: "government-services-source-notice",
          tone: "warning" as const,
          paragraphs: [
            bidLocalized(
              "财政部来源仅作为模板结构依据；不得替代本项目招标文件、澄清或采购人的具体要求。",
            ),
          ],
        },
      ],
    },
    {
      id: "toc",
      blocks: [{ type: "toc" as const, id: "government-services-toc", maxDepth: 2 as const }],
    },
    {
      id: "bid-letter",
      blocks: [
        {
          type: "declaration" as const,
          id: "government-services-bid-letter",
          title: bidLocalized("投标函"),
          paragraphs: [
            bidLocalized(
              `我方就${show(draft.source.projectName)}提交服务投标文件，响应内容以项目文件及本投标文件为准。`,
            ),
          ],
        },
      ],
    },
    {
      id: "authorization",
      blocks: [
        {
          type: "declaration" as const,
          id: "government-services-authorization",
          title: bidLocalized("授权信息"),
          paragraphs: [
            bidLocalized(
              `授权代表：${show(draft.authorizedRepresentative)}。授权和签章须人工核验。`,
            ),
          ],
        },
      ],
    },
    {
      id: "qualifications",
      blocks: [
        table(
          "government-services-qualifications",
          [
            { id: "name", label: bidLocalized("资格项"), width: "45%", align: "left" },
            { id: "status", label: bidLocalized("状态"), width: "25%", align: "center" },
            { id: "truth", label: bidLocalized("真实性"), width: "30%", align: "center" },
          ],
          draft.qualifications.map((item) => ({
            id: item.id,
            cells: {
              name: bidLocalized(item.name),
              status: bidLocalized(item.status),
              truth: bidLocalized(item.userConfirmedTruth ? "已确认" : "未确认"),
            },
          })),
        ),
      ],
    },
    {
      id: "policy-declarations",
      blocks: [
        table(
          "government-services-policy-status",
          [
            { id: "policy", label: bidLocalized("政策"), width: "35%", align: "left" },
            { id: "status", label: bidLocalized("状态"), width: "25%", align: "center" },
            { id: "statement", label: bidLocalized("经确认声明"), width: "40%", align: "left" },
          ],
          draft.policyDeclarations.map((item) => ({
            id: item.id,
            cells: {
              policy: bidLocalized(item.policyName),
              status: bidLocalized(
                item.applicable
                  ? item.userConfirmedTruth
                    ? "适用且已确认"
                    : "适用但未确认"
                  : "不适用",
              ),
              statement: bidLocalized(
                item.applicable && item.userConfirmedTruth ? item.statement : "未形成肯定声明",
              ),
            },
          })),
        ),
      ],
    },
    {
      id: "opening-price",
      blocks: [
        {
          type: "totals" as const,
          id: "government-services-opening-price",
          entries: [
            {
              id: "declared",
              label: bidLocalized("开标报价"),
              value: bidLocalized(money(draft.priceDeclaration.openingTotalMinor)),
            },
            {
              id: "calculated",
              label: bidLocalized("服务明细重算"),
              value: bidLocalized(exact ? money(exact.summary.totalMinor) : "无法重算"),
            },
          ],
        },
      ],
    },
    {
      id: "service-price",
      page: { orientation: "landscape" as const },
      blocks: [
        table(
          "government-services-price-table",
          [
            { id: "service", label: bidLocalized("服务"), width: "28%", align: "left" },
            { id: "deliverable", label: bidLocalized("交付物"), width: "28%", align: "left" },
            { id: "quantity", label: bidLocalized("数量"), width: "14%", align: "right" },
            { id: "unitPrice", label: bidLocalized("单价"), width: "15%", align: "right" },
            { id: "total", label: bidLocalized("重算金额"), width: "15%", align: "right" },
          ],
          draft.servicePriceLines.map((line) => ({
            id: line.id,
            cells: {
              service: bidLocalized(line.serviceName),
              deliverable: bidLocalized(line.deliverable),
              quantity: bidLocalized(`${line.quantity} ${line.unit}`),
              unitPrice: bidLocalized(money(line.unitPriceMinor)),
              total: bidLocalized(
                totals.has(line.id) ? money(totals.get(line.id) ?? "0") : "无法重算",
              ),
            },
          })),
        ),
      ],
    },
    {
      id: "requirement-response",
      page: { orientation: "landscape" as const },
      blocks: [
        {
          type: "complianceMatrix" as const,
          id: "government-services-requirements",
          columns: REQUIREMENT_MATRIX_COLUMNS,
          rows: requirementMatrixRows(draft, draft.requirements),
        },
      ],
    },
    section(
      "understanding-objectives",
      `项目理解：${draft.serviceUnderstanding}\n目标：${draft.objectives}`,
    ),
    {
      id: "methodology",
      blocks: [
        paragraph("methodology-text", draft.methodology),
        {
          type: "list" as const,
          id: "work-packages",
          ordered: true,
          items: draft.workPackages.map((item) =>
            bidLocalized(
              `${item.name}：${item.activities}；交付：${item.deliverables.join("、") || "未提供"}`,
            ),
          ),
        },
      ],
    },
    {
      id: "deliverables-schedule",
      blocks: [
        table(
          "deliverables-table",
          [
            { id: "name", label: bidLocalized("交付物"), width: "35%", align: "left" },
            { id: "due", label: bidLocalized("日期"), width: "20%", align: "center" },
            { id: "acceptance", label: bidLocalized("验收标准"), width: "45%", align: "left" },
          ],
          draft.deliverables.map((item) => ({
            id: item.id,
            cells: {
              name: bidLocalized(item.name),
              due: bidLocalized(item.dueDate),
              acceptance: bidLocalized(item.acceptanceStandard),
            },
          })),
        ),
        table(
          "milestones-table",
          [
            { id: "name", label: bidLocalized("里程碑"), width: "35%", align: "left" },
            { id: "date", label: bidLocalized("日期"), width: "25%", align: "center" },
            { id: "dependency", label: bidLocalized("依赖"), width: "40%", align: "left" },
          ],
          draft.milestones.map((item) => ({
            id: item.id,
            cells: {
              name: bidLocalized(item.name),
              date: bidLocalized(item.date),
              dependency: bidLocalized(show(item.dependency)),
            },
          })),
        ),
      ],
    },
    {
      id: "staffing",
      blocks: [
        table(
          "staffing-table",
          [
            { id: "name", label: bidLocalized("姓名"), width: "18%", align: "left" },
            { id: "role", label: bidLocalized("角色"), width: "18%", align: "left" },
            { id: "qualification", label: bidLocalized("资格"), width: "27%", align: "left" },
            { id: "experience", label: bidLocalized("经历"), width: "27%", align: "left" },
            { id: "truth", label: bidLocalized("确认"), width: "10%", align: "center" },
          ],
          draft.staffing.map((item) => ({
            id: item.id,
            cells: {
              name: bidLocalized(item.name),
              role: bidLocalized(item.role),
              qualification: bidLocalized(item.qualification),
              experience: bidLocalized(item.experience),
              truth: bidLocalized(item.userConfirmedTruth ? "已确认" : "未确认"),
            },
          })),
        ),
      ],
    },
    {
      id: "quality-sla",
      blocks: [
        paragraph("quality-plan", draft.qualityPlan),
        table(
          "sla-table",
          [
            { id: "metric", label: bidLocalized("指标"), width: "25%", align: "left" },
            { id: "target", label: bidLocalized("目标"), width: "20%", align: "left" },
            { id: "measurement", label: bidLocalized("测量"), width: "30%", align: "left" },
            { id: "remedy", label: bidLocalized("处置"), width: "25%", align: "left" },
          ],
          draft.sla.map((item) => ({
            id: item.id,
            cells: {
              metric: bidLocalized(item.metric),
              target: bidLocalized(item.target),
              measurement: bidLocalized(item.measurement),
              remedy: bidLocalized(show(item.remedy)),
            },
          })),
        ),
      ],
    },
    section(
      "risk-security-privacy",
      `风险：${draft.riskPlan}\n安全：${show(draft.securityPlan)}\n隐私：${show(draft.privacyPlan)}\n业务连续性：${show(draft.businessContinuity)}`,
    ),
    section("acceptance", draft.acceptancePlan),
    {
      id: "performance-evidence",
      blocks: [
        table(
          "performance-evidence-table",
          [
            { id: "project", label: bidLocalized("项目"), width: "30%", align: "left" },
            { id: "customer", label: bidLocalized("客户"), width: "25%", align: "left" },
            { id: "scope", label: bidLocalized("范围"), width: "30%", align: "left" },
            { id: "truth", label: bidLocalized("真实性"), width: "15%", align: "center" },
          ],
          draft.performanceEvidence.map((item) => ({
            id: item.id,
            cells: {
              project: bidLocalized(item.projectName),
              customer: bidLocalized(item.customer),
              scope: bidLocalized(item.scope),
              truth: bidLocalized(item.userConfirmedTruth ? "已确认" : "未确认"),
            },
          })),
        ),
      ],
    },
    {
      id: "deviations",
      blocks: [
        table(
          "government-services-deviations",
          [
            { id: "type", label: bidLocalized("类型"), width: "15%", align: "center" },
            { id: "requirement", label: bidLocalized("原要求"), width: "30%", align: "left" },
            { id: "response", label: bidLocalized("响应"), width: "30%", align: "left" },
            { id: "deviation", label: bidLocalized("偏差"), width: "25%", align: "left" },
          ],
          deviations.map((item) => ({
            id: `deviation-${item.requirementId}`,
            cells: {
              type: bidLocalized(item.type),
              requirement: bidLocalized(item.requirement),
              response: bidLocalized(item.response),
              deviation: bidLocalized(item.deviation),
            },
          })),
        ),
      ],
    },
    {
      id: "attachments",
      blocks: [
        {
          type: "attachmentIndex" as const,
          id: "government-services-attachments",
          attachmentIds: draft.attachments
            .filter((item) => item.includedInSubmission)
            .map((item) => item.id),
        },
      ],
    },
    {
      id: "final-checklist",
      blocks: [
        {
          type: "list" as const,
          id: "government-services-checklist",
          ordered: false,
          items: [
            ...draft.signSealChecklist.map((item) =>
              bidLocalized(`${item.label}：${item.confirmed ? "已确认" : "未确认"}`),
            ),
            bidLocalized(
              `导出状态：${decision.mode}。submission-ready 不等于已签名、已上传或已由主管机关认定合规。`,
            ),
          ],
        },
      ],
    },
    {
      id: "signatures",
      blocks: [
        {
          type: "signatureGroup" as const,
          id: "government-services-signatures",
          signers: [
            {
              role: bidLocalized("投标人授权代表"),
              name: show(draft.authorizedRepresentative),
              dateLabel: bidLocalized("签署日期"),
              sealLabel: bidLocalized("投标人盖章"),
            },
          ],
        },
      ],
    },
  ];
  return DocumentModelV2Schema.parse({
    schemaVersion: "2.0.0",
    documentId: draft.id,
    template: { id: draft.templateId, version: draft.templateVersion, basisDate: "2026-08-19" },
    documentKind: "bid",
    language: "zh-CN",
    title: bidLocalized("政府采购服务投标文件"),
    pageDefaults: {
      size: "A4",
      orientation: "portrait",
      marginsMm: { top: 18, right: 18, bottom: 18, left: 18 },
    },
    sections,
    watermarks: decision.watermarks,
    disclaimers: ["bid-authority"],
    attachmentManifest: publicBidAttachmentManifest(draft),
  }) as DocumentModelV2;
}

export const GOVERNMENT_SERVICES_BID_REGISTRATION: TemplateRegistration<
  GovernmentServicesBidDraftV1,
  DocumentModelV2
> = Object.freeze({
  definition: GOVERNMENT_SERVICES_BID_DEFINITION,
  parseDraft,
  createDraft,
  createRepeatableItem(
    path: string,
    input: { readonly id: string; readonly now: string | Date; readonly draft: unknown },
  ) {
    const common = createBidBaseRepeatableItem(path, input);
    if (common !== undefined) return common;
    if (path === "workPackages") {
      return { id: input.id, name: "待填写", activities: "待填写", deliverables: [] };
    }
    if (path === "deliverables") {
      return { id: input.id, name: "待填写", dueDate: "2026-08-20", acceptanceStandard: "待填写" };
    }
    if (path === "milestones") {
      return { id: input.id, name: "待填写", date: "2026-08-20" };
    }
    if (path === "sla") {
      return { id: input.id, metric: "待填写", target: "待填写", measurement: "待填写" };
    }
    if (path === "staffing") {
      return {
        id: input.id,
        name: "待填写",
        role: "待填写",
        qualification: "待填写",
        experience: "待填写",
        allocation: "待填写",
        userConfirmedTruth: false,
      };
    }
    if (path === "servicePriceLines") {
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
    if (path === "performanceEvidence") {
      const item = (input.draft as GovernmentServicesBidDraftV1).projectReferences.find(
        (entry) => entry.id === input.id,
      );
      if (!item) throw new Error("缺少对应项目业绩");
      return item;
    }
    if (path === "policyDeclarations") {
      return {
        id: input.id,
        policyName: "待填写",
        statement: "待填写",
        evidenceAttachmentIds: [],
        applicable: false,
        userConfirmedTruth: false,
      };
    }
    throw new Error("不支持的重复项路径");
  },
  compile,
  preflight(value: unknown, context?: TemplateEvaluationContext) {
    const draft = parseDraft(value);
    const deadline = evaluateBidDeadline(projectBidBaseDraft(draft), context);
    return freezeBidFindings([...analyze(draft), ...deadline.findings]);
  },
});
