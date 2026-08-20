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
  DeviationEntryV1Schema,
  decideBidExport,
  evaluateBidDeadline,
  requiredBidContentFindings,
} from "../bid-common.js";
import { type ServiceLineV2, ServiceLineV2Schema } from "../quote-common.js";
import {
  bidFinding,
  bidLocalized,
  bidText,
  commonBidFindings,
  createBidBaseDraft,
  createSpecializedBidSchema,
  freezeBidFindings,
  projectBidBaseDraft,
  publicBidAttachmentManifest,
  sameBidData,
  show,
  strictBidObject,
} from "./government-goods.js";

type AddIssue = (issue: { code: "custom"; message: string; path?: PropertyKey[] }) => void;

function uniqueIds(values: readonly { readonly id: string }[], addIssue: AddIssue): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      addIssue({
        code: "custom",
        message: "Enterprise-service ids must be unique",
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
const TeamMemberSchema = strictBidObject({
  id: IdentifierV2Schema,
  name: bidText(300, true),
  role: bidText(300, true),
  qualification: bidText(2_000, true),
  experience: bidText(2_000, true),
  allocation: bidText(300, true),
  userConfirmedTruth: z.boolean(),
});
const SlaSchema = strictBidObject({
  id: IdentifierV2Schema,
  metric: bidText(500, true),
  target: bidText(500, true),
  measurement: bidText(2_000, true),
  remedy: bidText(2_000, true).optional(),
});
const RiskSchema = strictBidObject({
  id: IdentifierV2Schema,
  risk: bidText(2_000, true),
  probability: z.enum(["low", "medium", "high"]),
  impact: z.enum(["low", "medium", "high"]),
  mitigation: bidText(5_000, true),
  owner: bidText(300, true),
});

const EnterpriseServicesSpecializedSchema = strictBidObject({
  executiveSummary: bidText(10_000, true),
  customerUnderstanding: bidText(10_000, true),
  objectives: bidText(10_000, true),
  scope: bidText(10_000, true),
  methodology: bidText(10_000, true),
  deliverables: isolatedArraySchema(DeliverableSchema, { max: 100, refine: uniqueIds }),
  milestones: isolatedArraySchema(MilestoneSchema, { max: 100, refine: uniqueIds }),
  team: isolatedArraySchema(TeamMemberSchema, { max: 100, refine: uniqueIds }),
  governance: bidText(10_000, true),
  communicationPlan: bidText(10_000, true),
  sla: isolatedArraySchema(SlaSchema, { max: 100, refine: uniqueIds }),
  qualityPlan: bidText(10_000, true),
  securityPrivacy: bidText(10_000, true).optional(),
  assumptions: isolatedArraySchema(bidText(2_000, true), { max: 100 }),
  dependencies: isolatedArraySchema(bidText(2_000, true), { max: 100 }),
  exclusions: isolatedArraySchema(bidText(2_000, true), { max: 100 }),
  servicePriceLines: isolatedArraySchema(ServiceLineV2Schema, { max: 100, refine: uniqueIds }),
  caseStudies: isolatedArraySchema(BidProjectReferenceV1Schema, { max: 100, refine: uniqueIds }),
  riskRegister: isolatedArraySchema(RiskSchema, { max: 100, refine: uniqueIds }),
  contractDeviations: isolatedArraySchema(DeviationEntryV1Schema, { max: 200 }),
});

export interface EnterpriseServicesBidDraftV1 extends BidDraftBaseV1 {
  readonly templateId: "bid.enterprise.services.v1";
  readonly executiveSummary: string;
  readonly customerUnderstanding: string;
  readonly objectives: string;
  readonly scope: string;
  readonly methodology: string;
  readonly deliverables: readonly z.output<typeof DeliverableSchema>[];
  readonly milestones: readonly z.output<typeof MilestoneSchema>[];
  readonly team: readonly z.output<typeof TeamMemberSchema>[];
  readonly governance: string;
  readonly communicationPlan: string;
  readonly sla: readonly z.output<typeof SlaSchema>[];
  readonly qualityPlan: string;
  readonly securityPrivacy?: string;
  readonly assumptions: readonly string[];
  readonly dependencies: readonly string[];
  readonly exclusions: readonly string[];
  readonly servicePriceLines: readonly ServiceLineV2[];
  readonly caseStudies: BidDraftBaseV1["projectReferences"];
  readonly riskRegister: readonly z.output<typeof RiskSchema>[];
  readonly contractDeviations: BidDraftBaseV1["businessDeviations"];
}

const SPECIALIZED_KEYS = Object.freeze([
  "executiveSummary",
  "customerUnderstanding",
  "objectives",
  "scope",
  "methodology",
  "deliverables",
  "milestones",
  "team",
  "governance",
  "communicationPlan",
  "sla",
  "qualityPlan",
  "securityPrivacy",
  "assumptions",
  "dependencies",
  "exclusions",
  "servicePriceLines",
  "caseStudies",
  "riskRegister",
  "contractDeviations",
]);

export const EnterpriseServicesBidDraftV1Schema = createSpecializedBidSchema(
  "bid.enterprise.services.v1",
  SPECIALIZED_KEYS,
  EnterpriseServicesSpecializedSchema,
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
    const canonicalCases = new Map(draft.projectReferences.map((item) => [item.id, item]));
    draft.caseStudies.forEach((item, index) => {
      const canonical = canonicalCases.get(item.id);
      if (!canonical || !sameBidData(canonical, item)) {
        addIssue({
          code: "custom",
          message: "Case study must match a canonical project reference",
          path: ["caseStudies", index],
        });
      }
    });
    const canonicalDeviations = new Map(
      draft.businessDeviations.map((item) => [item.requirementId, item]),
    );
    draft.contractDeviations.forEach((item, index) => {
      const canonical = canonicalDeviations.get(item.requirementId);
      if (!canonical || !sameBidData(canonical, item)) {
        addIssue({
          code: "custom",
          message: "Contract deviation must match a canonical business deviation",
          path: ["contractDeviations", index],
        });
      }
    });
  },
);

export const ENTERPRISE_SERVICES_BID_DEFINITION = {
  id: "bid.enterprise.services.v1",
  version: "1.0.0",
  category: "bid",
  name: "企业服务采购建议书",
  summary: "覆盖范围、方法、交付、团队治理、SLA、安全、价格、案例和风险的企业服务响应底稿",
  basisDate: "2026-08-19",
  languages: ["zh-CN"],
  defaultLanguage: "zh-CN",
  allowedLayouts: ["classic-formal.v1", "modern-business.v1"],
  defaultLayout: "modern-business.v1",
  supportedOutputs: ["docx", "pdf", "json", "opentrad"],
  sourceKeys: ["prc-tendering-law"],
  disclaimerProfile: "bid",
  fieldManifest: [
    { path: "scope", section: "scope", label: "服务范围", control: "textarea", required: true },
    {
      path: "methodology",
      section: "methodology",
      label: "服务方法",
      control: "textarea",
      required: true,
    },
    {
      path: "deliverables",
      section: "deliverables",
      label: "交付物",
      control: "repeatable",
      required: true,
    },
    {
      path: "team",
      section: "team-governance",
      label: "服务团队",
      control: "repeatable",
      required: true,
    },
    {
      path: "governance",
      section: "team-governance",
      label: "治理机制",
      control: "textarea",
      required: true,
    },
    {
      path: "sla",
      section: "sla-quality",
      label: "服务水平",
      control: "repeatable",
      required: true,
    },
    {
      path: "servicePriceLines",
      section: "commercial-offer",
      label: "服务报价",
      control: "repeatable",
      required: true,
    },
    {
      path: "riskRegister",
      section: "risks",
      label: "风险登记",
      control: "repeatable",
      required: true,
    },
    {
      path: "assumptions",
      section: "assumptions-dependencies-exclusions",
      label: "假设",
      control: "repeatable",
      required: false,
    },
    {
      path: "dependencies",
      section: "assumptions-dependencies-exclusions",
      label: "依赖",
      control: "repeatable",
      required: false,
    },
    {
      path: "exclusions",
      section: "assumptions-dependencies-exclusions",
      label: "排除项",
      control: "repeatable",
      required: false,
    },
  ],
} as const satisfies TemplateDefinitionV2;

const PLACEHOLDER = /^(?:\s*|待填写|待确认|未提供|未绑定)$/u;

function parseDraft(value: unknown): EnterpriseServicesBidDraftV1 {
  return EnterpriseServicesBidDraftV1Schema.parse(value) as EnterpriseServicesBidDraftV1;
}

function createDraft(input: { readonly id: string; readonly now: string | Date }) {
  return parseDraft({
    ...createBidBaseDraft("bid.enterprise.services.v1", input),
    executiveSummary: "待填写",
    customerUnderstanding: "待填写",
    objectives: "待填写",
    scope: "待填写",
    methodology: "待填写",
    deliverables: [],
    milestones: [],
    team: [],
    governance: "待填写",
    communicationPlan: "待填写",
    sla: [],
    qualityPlan: "待填写",
    assumptions: [],
    dependencies: [],
    exclusions: [],
    servicePriceLines: [],
    caseStudies: [],
    riskRegister: [],
    contractDeviations: [],
  });
}

function calculation(draft: EnterpriseServicesBidDraftV1) {
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

function analyze(draft: EnterpriseServicesBidDraftV1): readonly RiskFindingV2[] {
  const findings = commonBidFindings(draft);
  findings.push(
    ...requiredBidContentFindings([
      {
        path: [],
        value: {
          executiveSummary: draft.executiveSummary,
          customerUnderstanding: draft.customerUnderstanding,
          objectives: draft.objectives,
          scope: draft.scope,
          methodology: draft.methodology,
          governance: draft.governance,
          communicationPlan: draft.communicationPlan,
          qualityPlan: draft.qualityPlan,
        },
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
        path: ["team"],
        value: draft.team.map((item) => ({
          name: item.name,
          role: item.role,
          qualification: item.qualification,
          experience: item.experience,
          allocation: item.allocation,
        })),
      },
      {
        path: ["sla"],
        value: draft.sla.map((item) => ({
          metric: item.metric,
          target: item.target,
          measurement: item.measurement,
        })),
      },
      { path: ["assumptions"], value: draft.assumptions },
      { path: ["dependencies"], value: draft.dependencies },
      { path: ["exclusions"], value: draft.exclusions },
      {
        path: ["servicePriceLines"],
        value: draft.servicePriceLines.map((item) => ({
          serviceName: item.serviceName,
          deliverable: item.deliverable,
          unit: item.unit,
        })),
      },
      {
        path: ["caseStudies"],
        value: draft.caseStudies.map((item) => ({
          projectName: item.projectName,
          customer: item.customer,
          period: item.period,
          scope: item.scope,
        })),
      },
      {
        path: ["riskRegister"],
        value: draft.riskRegister.map((item) => ({
          risk: item.risk,
          mitigation: item.mitigation,
          owner: item.owner,
        })),
      },
      {
        path: ["contractDeviations"],
        value: draft.contractDeviations.map((item) => ({
          requirement: item.requirement,
          response: item.response,
          deviation: item.deviation,
        })),
      },
    ]),
  );
  for (const [field, value, code, label] of [
    [
      "executiveSummary",
      draft.executiveSummary,
      "BID_ENTERPRISE_SERVICE_SUMMARY_MISSING",
      "执行摘要",
    ],
    [
      "customerUnderstanding",
      draft.customerUnderstanding,
      "BID_ENTERPRISE_CUSTOMER_UNDERSTANDING_MISSING",
      "客户理解",
    ],
    ["objectives", draft.objectives, "BID_ENTERPRISE_SERVICE_OBJECTIVES_MISSING", "服务目标"],
    ["scope", draft.scope, "BID_ENTERPRISE_SERVICE_SCOPE_MISSING", "服务范围"],
    ["methodology", draft.methodology, "BID_ENTERPRISE_SERVICE_METHOD_MISSING", "服务方法"],
    ["governance", draft.governance, "BID_ENTERPRISE_GOVERNANCE_MISSING", "治理机制"],
    [
      "communicationPlan",
      draft.communicationPlan,
      "BID_ENTERPRISE_COMMUNICATION_MISSING",
      "沟通方案",
    ],
    ["qualityPlan", draft.qualityPlan, "BID_ENTERPRISE_SERVICE_QUALITY_MISSING", "质量方案"],
  ] as const) {
    if (PLACEHOLDER.test(value)) findings.push(bidFinding(code, `${label}尚未提供`, [field]));
  }
  const requireRows = (value: readonly unknown[], code: string, label: string, path: string) => {
    if (value.length === 0) findings.push(bidFinding(code, `${label}尚未提供`, [path]));
  };
  requireRows(
    draft.deliverables,
    "BID_ENTERPRISE_SERVICE_DELIVERABLES_MISSING",
    "交付物",
    "deliverables",
  );
  requireRows(draft.team, "BID_ENTERPRISE_SERVICE_TEAM_MISSING", "服务团队", "team");
  requireRows(draft.sla, "BID_ENTERPRISE_SERVICE_SLA_MISSING", "服务水平", "sla");
  requireRows(
    draft.servicePriceLines,
    "BID_ENTERPRISE_SERVICE_PRICE_MISSING",
    "服务报价明细",
    "servicePriceLines",
  );
  requireRows(
    draft.riskRegister,
    "BID_ENTERPRISE_SERVICE_RISKS_MISSING",
    "风险登记",
    "riskRegister",
  );
  draft.team.forEach((person, index) => {
    if (!person.userConfirmedTruth) {
      findings.push(
        bidFinding("BID_ENTERPRISE_SERVICE_TEAM_UNCONFIRMED", "团队资格和经历须由用户确认真实性", [
          "team",
          String(index),
        ]),
      );
    }
  });
  if (draft.source.taxBasis === "as-specified") {
    findings.push(
      bidFinding(
        "BID_ENTERPRISE_SERVICE_TAX_BASIS_UNRESOLVED",
        "须按企业采购文件确认服务报价含税口径",
        ["source", "taxBasis"],
      ),
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
      bidFinding("BID_ENTERPRISE_SERVICE_TOTAL_MISMATCH", "服务明细重算总价与报价声明不一致", [
        "priceDeclaration",
      ]),
    );
  }
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
  const listItems = (values: readonly string[]) => (values.length > 0 ? values : ["未提供"]);
  const deviations = [...draft.businessDeviations, ...draft.technicalDeviations];
  const sections = [
    {
      id: "draft-cover",
      blocks: [
        {
          type: "cover" as const,
          id: "enterprise-services-cover",
          title: bidLocalized("企业服务采购建议书"),
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
          id: "enterprise-services-source",
          entries: [
            {
              id: "project-number",
              label: bidLocalized("项目编号"),
              value: bidLocalized(show(draft.source.projectNumber)),
            },
            {
              id: "source-version",
              label: bidLocalized("采购文件版本"),
              value: bidLocalized(show(draft.source.versionLabel)),
            },
            {
              id: "source-file",
              label: bidLocalized("项目采购文件"),
              value: bidLocalized(show(draft.source.versionEvidence.mainSolicitationAttachmentId)),
            },
          ],
        },
        {
          type: "notice" as const,
          id: "enterprise-services-law-context",
          tone: "warning" as const,
          paragraphs: [
            bidLocalized(
              "《招标投标法》仅作为上下文来源；是否适用招标法律规则取决于项目和采购主体。本项目要求仅来自已绑定的企业采购文件及澄清。",
            ),
          ],
        },
      ],
    },
    {
      id: "toc",
      blocks: [{ type: "toc" as const, id: "enterprise-services-toc", maxDepth: 2 as const }],
    },
    {
      id: "proposal-letter",
      blocks: [
        {
          type: "declaration" as const,
          id: "enterprise-services-proposal-letter",
          title: bidLocalized("服务建议书函"),
          paragraphs: [
            bidLocalized(
              `我方就${show(draft.source.projectName)}提交服务建议书，范围、价格和条件以本文件各节及偏差表为准。`,
            ),
          ],
        },
      ],
    },
    section("executive-summary", draft.executiveSummary),
    section(
      "customer-understanding",
      `客户理解：${draft.customerUnderstanding}\n目标：${draft.objectives}`,
    ),
    section("scope", draft.scope),
    section("methodology", draft.methodology),
    {
      id: "deliverables",
      blocks: [
        table(
          "enterprise-service-deliverables",
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
      ],
    },
    {
      id: "schedule",
      blocks: [
        table(
          "enterprise-service-milestones",
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
      id: "team-governance",
      blocks: [
        table(
          "enterprise-service-team",
          [
            { id: "name", label: bidLocalized("姓名"), width: "18%", align: "left" },
            { id: "role", label: bidLocalized("角色"), width: "18%", align: "left" },
            { id: "qualification", label: bidLocalized("资格"), width: "27%", align: "left" },
            { id: "experience", label: bidLocalized("经历"), width: "27%", align: "left" },
            { id: "truth", label: bidLocalized("确认"), width: "10%", align: "center" },
          ],
          draft.team.map((item) => ({
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
        paragraph(
          "enterprise-service-governance",
          `治理：${draft.governance}\n沟通：${draft.communicationPlan}`,
        ),
      ],
    },
    {
      id: "sla-quality",
      blocks: [
        table(
          "enterprise-service-sla",
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
        paragraph("enterprise-service-quality", draft.qualityPlan),
      ],
    },
    section("security-privacy", show(draft.securityPrivacy)),
    {
      id: "assumptions-dependencies-exclusions",
      blocks: [
        {
          type: "list" as const,
          id: "enterprise-service-assumptions",
          ordered: false,
          items: listItems(draft.assumptions).map((item) => bidLocalized(`假设：${item}`)),
        },
        {
          type: "list" as const,
          id: "enterprise-service-dependencies",
          ordered: false,
          items: listItems(draft.dependencies).map((item) => bidLocalized(`依赖：${item}`)),
        },
        {
          type: "list" as const,
          id: "enterprise-service-exclusions",
          ordered: false,
          items: listItems(draft.exclusions).map((item) => bidLocalized(`排除项：${item}`)),
        },
      ],
    },
    {
      id: "commercial-offer",
      page: { orientation: "landscape" as const },
      blocks: [
        table(
          "enterprise-service-price",
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
        {
          type: "totals" as const,
          id: "enterprise-service-price-total",
          entries: [
            {
              id: "declared",
              label: bidLocalized("报价声明"),
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
      id: "cases",
      blocks: [
        table(
          "enterprise-service-cases",
          [
            { id: "project", label: bidLocalized("案例"), width: "30%", align: "left" },
            { id: "customer", label: bidLocalized("客户"), width: "25%", align: "left" },
            { id: "scope", label: bidLocalized("范围"), width: "30%", align: "left" },
            { id: "truth", label: bidLocalized("真实性"), width: "15%", align: "center" },
          ],
          draft.caseStudies.map((item) => ({
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
      id: "risks",
      blocks: [
        table(
          "enterprise-service-risks",
          [
            { id: "risk", label: bidLocalized("风险"), width: "28%", align: "left" },
            { id: "probability", label: bidLocalized("概率"), width: "12%", align: "center" },
            { id: "impact", label: bidLocalized("影响"), width: "12%", align: "center" },
            { id: "mitigation", label: bidLocalized("缓解措施"), width: "33%", align: "left" },
            { id: "owner", label: bidLocalized("责任人"), width: "15%", align: "left" },
          ],
          draft.riskRegister.map((item) => ({
            id: item.id,
            cells: {
              risk: bidLocalized(item.risk),
              probability: bidLocalized(item.probability),
              impact: bidLocalized(item.impact),
              mitigation: bidLocalized(item.mitigation),
              owner: bidLocalized(item.owner),
            },
          })),
        ),
      ],
    },
    {
      id: "deviations",
      blocks: [
        table(
          "enterprise-service-deviations",
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
          id: "enterprise-services-attachments",
          attachmentIds: draft.attachments
            .filter((item) => item.includedInSubmission)
            .map((item) => item.id),
        },
      ],
    },
    {
      id: "checklist",
      blocks: [
        {
          type: "list" as const,
          id: "enterprise-services-checklist",
          ordered: false,
          items: [
            ...draft.signSealChecklist.map((item) =>
              bidLocalized(`${item.label}：${item.confirmed ? "已确认" : "未确认"}`),
            ),
            bidLocalized(
              `合同偏差：${draft.contractDeviations.length > 0 ? `${draft.contractDeviations.length}项` : "无"}`,
            ),
            bidLocalized(
              `导出状态：${decision.mode}。submission-ready 不等于已签名、已上传或已由采购人认定合规。`,
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
          id: "enterprise-services-signatures",
          signers: [
            {
              role: bidLocalized("供应商授权代表"),
              name: show(draft.authorizedRepresentative),
              dateLabel: bidLocalized("签署日期"),
              sealLabel: bidLocalized("供应商盖章"),
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
    title: bidLocalized("企业服务采购建议书"),
    pageDefaults: {
      size: "A4",
      orientation: "portrait",
      marginsMm: { top: 16, right: 18, bottom: 16, left: 18 },
    },
    sections,
    watermarks: decision.watermarks,
    disclaimers: ["bid-authority"],
    attachmentManifest: publicBidAttachmentManifest(draft),
  }) as DocumentModelV2;
}

export const ENTERPRISE_SERVICES_BID_REGISTRATION: TemplateRegistration<
  EnterpriseServicesBidDraftV1,
  DocumentModelV2
> = Object.freeze({
  definition: ENTERPRISE_SERVICES_BID_DEFINITION,
  parseDraft,
  createDraft,
  compile,
  preflight(value: unknown, context?: TemplateEvaluationContext) {
    const draft = parseDraft(value);
    const deadline = evaluateBidDeadline(projectBidBaseDraft(draft), context);
    return freezeBidFindings([...analyze(draft), ...deadline.findings]);
  },
});
