import { isolatedArraySchema } from "../../../safe-schema.js";
import { z } from "../../../zod.js";
import type { TemplateDefinitionV2 } from "../../common.js";
import { type DocumentModelV2, DocumentModelV2Schema } from "../../document-model.js";
import { formatMoneyMinorV2, IdentifierV2Schema, MoneyMinorV2Schema } from "../../money.js";
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
  attachmentEditorField,
  bidBaseEditorFields,
  bidProjectReferenceItemSpec,
  checkboxEditorField,
  itemCheckboxField,
  itemNumberField,
  itemSelectField,
  itemTextField,
  moneyEditorField,
  numberEditorField,
  repeatableEditorField,
  textEditorField,
} from "../editor-manifest.js";
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
        message: "Construction bid ids must be unique",
        path: [index, "id"],
      });
    }
    seen.add(value.id);
  });
}

const ProjectManagerSchema = strictBidObject({
  name: bidText(300, true),
  qualification: bidText(2_000, true),
  certificateNumber: bidText(500, true),
  experience: isolatedArraySchema(BidProjectReferenceV1Schema, { max: 100, refine: uniqueIds }),
  userConfirmedTruth: z.boolean(),
});

const KeyPersonSchema = strictBidObject({
  id: IdentifierV2Schema,
  name: bidText(300, true),
  role: bidText(300, true),
  qualification: bidText(2_000, true),
  experience: bidText(2_000, true),
  userConfirmedTruth: z.boolean(),
});

const LaborSchema = strictBidObject({
  trade: bidText(500, true),
  count: z.number().int().min(1).max(100_000),
  period: bidText(500, true),
});

const EquipmentSchema = strictBidObject({
  id: IdentifierV2Schema,
  name: bidText(500, true),
  model: bidText(500, true),
  quantity: z.number().int().min(1).max(100_000),
  ownership: z.enum(["owned", "leased", "planned"]),
  availability: bidText(2_000, true),
  userConfirmedTruth: z.boolean(),
});

const ConstructionSpecializedSchema = strictBidObject({
  projectScope: bidText(10_000, true),
  billOfQuantitiesRef: bidText(64),
  bidPriceMinor: MoneyMinorV2Schema,
  durationDays: z.number().int().min(1).max(3_650),
  qualityTarget: bidText(2_000, true),
  projectManager: ProjectManagerSchema,
  keyTechnicalPersonnel: isolatedArraySchema(KeyPersonSchema, { max: 100, refine: uniqueIds }),
  laborPlan: isolatedArraySchema(LaborSchema, { max: 100 }),
  equipmentList: isolatedArraySchema(EquipmentSchema, { max: 100, refine: uniqueIds }),
  constructionOrganization: bidText(10_000, true),
  schedulePlan: bidText(10_000, true),
  sitePlan: bidText(10_000, true).optional(),
  qualityPlan: bidText(10_000, true),
  safetyPlan: bidText(10_000, true),
  environmentPlan: bidText(10_000, true),
  emergencyPlan: bidText(10_000, true),
  subcontractPlan: bidText(10_000, true).optional(),
  materialsPlan: bidText(10_000, true).optional(),
  temporaryWorks: bidText(10_000, true).optional(),
});

export interface ConstructionWorksBidDraftV1 extends BidDraftBaseV1 {
  readonly templateId: "bid.construction.works.v1";
  readonly projectScope: string;
  readonly billOfQuantitiesRef: string;
  readonly bidPriceMinor: string;
  readonly durationDays: number;
  readonly qualityTarget: string;
  readonly projectManager: z.output<typeof ProjectManagerSchema>;
  readonly keyTechnicalPersonnel: readonly z.output<typeof KeyPersonSchema>[];
  readonly laborPlan: readonly z.output<typeof LaborSchema>[];
  readonly equipmentList: readonly z.output<typeof EquipmentSchema>[];
  readonly constructionOrganization: string;
  readonly schedulePlan: string;
  readonly sitePlan?: string;
  readonly qualityPlan: string;
  readonly safetyPlan: string;
  readonly environmentPlan: string;
  readonly emergencyPlan: string;
  readonly subcontractPlan?: string;
  readonly materialsPlan?: string;
  readonly temporaryWorks?: string;
}

const SPECIALIZED_KEYS = Object.freeze([
  "projectScope",
  "billOfQuantitiesRef",
  "bidPriceMinor",
  "durationDays",
  "qualityTarget",
  "projectManager",
  "keyTechnicalPersonnel",
  "laborPlan",
  "equipmentList",
  "constructionOrganization",
  "schedulePlan",
  "sitePlan",
  "qualityPlan",
  "safetyPlan",
  "environmentPlan",
  "emergencyPlan",
  "subcontractPlan",
  "materialsPlan",
  "temporaryWorks",
]);

const PLACEHOLDER = /^(?:\s*|待填写|待确认|未提供|未绑定)$/u;

export const ConstructionWorksBidDraftV1Schema = createSpecializedBidSchema(
  "bid.construction.works.v1",
  SPECIALIZED_KEYS,
  ConstructionSpecializedSchema,
  (draft, addIssue) => {
    const attachments = new Set(draft.attachments.map((item) => item.id));
    if (
      !PLACEHOLDER.test(draft.billOfQuantitiesRef) &&
      !attachments.has(draft.billOfQuantitiesRef)
    ) {
      addIssue({
        code: "custom",
        message: "Bill-of-quantities reference must identify an attachment",
        path: ["billOfQuantitiesRef"],
      });
    }
    const canonicalReferences = new Map(draft.projectReferences.map((item) => [item.id, item]));
    draft.projectManager.experience.forEach((item, index) => {
      const canonical = canonicalReferences.get(item.id);
      if (!canonical || !sameBidData(canonical, item)) {
        addIssue({
          code: "custom",
          message: "Project-manager experience must match a canonical project reference",
          path: ["projectManager", "experience", index],
        });
      }
    });
  },
);

export const CONSTRUCTION_WORKS_BID_DEFINITION = {
  id: "bid.construction.works.v1",
  version: "1.0.0",
  category: "bid",
  name: "建设工程施工投标文件",
  summary: "引用实际工程量清单，呈现施工组织、工期、人员、机械、质量、安全环保和分包方案的投标底稿",
  basisDate: "2026-08-19",
  languages: ["zh-CN"],
  defaultLanguage: "zh-CN",
  allowedLayouts: ["classic-formal.v1"],
  defaultLayout: "classic-formal.v1",
  supportedOutputs: ["docx", "pdf", "json", "opentrad"],
  sourceKeys: ["prc-tendering-law", "ndrc-standard-construction", "ndrc-tenderer-responsibility"],
  disclaimerProfile: "bid",
  fieldManifest: [
    ...bidBaseEditorFields({
      sourceSection: "source-baseline",
      bidderSection: "bidder",
      qualificationSection: "qualifications",
      priceSection: "priced-boq",
      deviationSection: "deviations",
      casesSection: "experience",
      finalReviewSection: "final-checklist",
      guaranteeSection: "bid-guarantee",
    }),
    textEditorField({
      path: "projectScope",
      section: "construction-organization",
      label: "项目范围",
      required: true,
      multiline: true,
    }),
    attachmentEditorField({
      path: "billOfQuantitiesRef",
      section: "priced-boq",
      label: "实际工程量清单附件",
      required: true,
      multiple: false,
      maxItems: 1,
      role: "submission",
      category: "commercial",
      includeInSubmissionDefault: true,
    }),
    moneyEditorField("bidPriceMinor", "bid-letter-and-appendix", "投标总价", true),
    numberEditorField({
      path: "durationDays",
      section: "schedule",
      label: "投标工期",
      required: true,
      integer: true,
    }),
    textEditorField({
      path: "qualityTarget",
      section: "quality",
      label: "质量目标",
      required: true,
      multiline: true,
    }),
    textEditorField({
      path: "projectManager.name",
      section: "project-manager",
      label: "项目经理",
      required: true,
    }),
    textEditorField({
      path: "projectManager.qualification",
      section: "project-manager",
      label: "项目经理资质",
      required: true,
      multiline: true,
    }),
    textEditorField({
      path: "projectManager.certificateNumber",
      section: "project-manager",
      label: "项目经理证书号",
      required: true,
    }),
    repeatableEditorField({
      path: "projectManager.experience",
      section: "project-manager",
      label: "项目经理业绩",
      required: false,
      minItems: 0,
      maxItems: 100,
      item: bidProjectReferenceItemSpec(),
    }),
    checkboxEditorField({
      path: "projectManager.userConfirmedTruth",
      section: "project-manager",
      label: "用户确认项目经理信息真实",
      required: true,
    }),
    repeatableEditorField({
      path: "keyTechnicalPersonnel",
      section: "key-personnel",
      label: "关键技术人员",
      required: true,
      minItems: 0,
      maxItems: 100,
      item: {
        kind: "object",
        idPath: "id",
        fields: [
          itemTextField({ path: "name", label: "姓名", required: true }),
          itemTextField({ path: "role", label: "岗位", required: true }),
          itemTextField({ path: "qualification", label: "资质", required: true, multiline: true }),
          itemTextField({ path: "experience", label: "经验", required: true, multiline: true }),
          itemCheckboxField("userConfirmedTruth", "用户确认真实", true),
        ],
      },
    }),
    repeatableEditorField({
      path: "laborPlan",
      section: "labor",
      label: "劳动力计划",
      required: false,
      minItems: 0,
      maxItems: 100,
      item: {
        kind: "object",
        fields: [
          itemTextField({ path: "trade", label: "工种", required: true }),
          itemNumberField({ path: "count", label: "人数", required: true, integer: true }),
          itemTextField({ path: "period", label: "投入期间", required: true }),
        ],
      },
    }),
    repeatableEditorField({
      path: "equipmentList",
      section: "equipment",
      label: "施工机械",
      required: true,
      minItems: 0,
      maxItems: 100,
      item: {
        kind: "object",
        idPath: "id",
        fields: [
          itemTextField({ path: "name", label: "名称", required: true }),
          itemTextField({ path: "model", label: "型号", required: true }),
          itemNumberField({ path: "quantity", label: "数量", required: true, integer: true }),
          itemSelectField({
            path: "ownership",
            label: "权属",
            required: true,
            options: [
              { value: "owned", label: "自有" },
              { value: "leased", label: "租赁" },
              { value: "planned", label: "拟投入" },
            ],
          }),
          itemTextField({ path: "availability", label: "可用性", required: true, multiline: true }),
          itemCheckboxField("userConfirmedTruth", "用户确认真实", true),
        ],
      },
    }),
    ...[
      ["constructionOrganization", "construction-organization", "施工组织", true],
      ["schedulePlan", "schedule", "进度方案", true],
      ["sitePlan", "site-plan", "现场方案", false],
      ["qualityPlan", "quality", "质量方案", true],
      ["safetyPlan", "safety-environment", "安全方案", true],
      ["environmentPlan", "safety-environment", "环境方案", true],
      ["emergencyPlan", "safety-environment", "应急方案", true],
      ["subcontractPlan", "subcontract", "分包方案", false],
      ["materialsPlan", "materials", "材料方案", false],
      ["temporaryWorks", "site-plan", "临时工程", false],
    ].map(([path, section, label, required]) =>
      textEditorField({
        path: String(path),
        section: String(section),
        label: String(label),
        required: Boolean(required),
        multiline: true,
      }),
    ),
  ],
} as const satisfies TemplateDefinitionV2;

function parseDraft(value: unknown): ConstructionWorksBidDraftV1 {
  return ConstructionWorksBidDraftV1Schema.parse(value) as ConstructionWorksBidDraftV1;
}

function createDraft(input: { readonly id: string; readonly now: string | Date }) {
  return parseDraft({
    ...createBidBaseDraft("bid.construction.works.v1", input),
    projectScope: "待填写",
    billOfQuantitiesRef: "",
    bidPriceMinor: "0",
    durationDays: 1,
    qualityTarget: "待填写",
    projectManager: {
      name: "待填写",
      qualification: "待填写",
      certificateNumber: "待填写",
      experience: [],
      userConfirmedTruth: false,
    },
    keyTechnicalPersonnel: [],
    laborPlan: [],
    equipmentList: [],
    constructionOrganization: "待填写",
    schedulePlan: "待填写",
    qualityPlan: "待填写",
    safetyPlan: "待填写",
    environmentPlan: "待填写",
    emergencyPlan: "待填写",
  });
}

function analyze(draft: ConstructionWorksBidDraftV1): readonly RiskFindingV2[] {
  const findings = commonBidFindings(draft);
  for (const [field, value, code, label] of [
    ["projectScope", draft.projectScope, "BID_CONSTRUCTION_SCOPE_MISSING", "项目范围"],
    ["qualityTarget", draft.qualityTarget, "BID_CONSTRUCTION_QUALITY_TARGET_MISSING", "质量目标"],
    [
      "constructionOrganization",
      draft.constructionOrganization,
      "BID_CONSTRUCTION_ORGANIZATION_MISSING",
      "施工组织",
    ],
    ["schedulePlan", draft.schedulePlan, "BID_CONSTRUCTION_SCHEDULE_MISSING", "进度方案"],
    ["qualityPlan", draft.qualityPlan, "BID_CONSTRUCTION_QUALITY_PLAN_MISSING", "质量方案"],
    ["safetyPlan", draft.safetyPlan, "BID_CONSTRUCTION_SAFETY_PLAN_MISSING", "安全方案"],
    [
      "environmentPlan",
      draft.environmentPlan,
      "BID_CONSTRUCTION_ENVIRONMENT_PLAN_MISSING",
      "环保方案",
    ],
    ["emergencyPlan", draft.emergencyPlan, "BID_CONSTRUCTION_EMERGENCY_PLAN_MISSING", "应急方案"],
  ] as const) {
    if (PLACEHOLDER.test(value)) findings.push(bidFinding(code, `${label}尚未提供`, [field]));
  }
  findings.push(
    ...requiredBidContentFindings([
      {
        path: [],
        value: {
          projectScope: draft.projectScope,
          qualityTarget: draft.qualityTarget,
          constructionOrganization: draft.constructionOrganization,
          schedulePlan: draft.schedulePlan,
          qualityPlan: draft.qualityPlan,
          safetyPlan: draft.safetyPlan,
          environmentPlan: draft.environmentPlan,
          emergencyPlan: draft.emergencyPlan,
        },
      },
      {
        path: ["projectManager"],
        value: {
          name: draft.projectManager.name,
          qualification: draft.projectManager.qualification,
          certificateNumber: draft.projectManager.certificateNumber,
          experience: draft.projectManager.experience.map((item) => ({
            projectName: item.projectName,
            customer: item.customer,
            period: item.period,
            scope: item.scope,
          })),
        },
      },
      {
        path: ["keyTechnicalPersonnel"],
        value: draft.keyTechnicalPersonnel.map((item) => ({
          name: item.name,
          role: item.role,
          qualification: item.qualification,
          experience: item.experience,
        })),
      },
      {
        path: ["laborPlan"],
        value: draft.laborPlan.map((item) => ({ trade: item.trade, period: item.period })),
      },
      {
        path: ["equipmentList"],
        value: draft.equipmentList.map((item) => ({
          name: item.name,
          model: item.model,
          availability: item.availability,
        })),
      },
    ]),
  );
  const boq = draft.attachments.find((item) => item.id === draft.billOfQuantitiesRef);
  if (
    PLACEHOLDER.test(draft.billOfQuantitiesRef) ||
    boq?.status !== "attached" ||
    !boq.includedInSubmission
  ) {
    findings.push(
      bidFinding("BID_CONSTRUCTION_BOQ_NOT_READY", "必须引用已附加并纳入投标文件的实际工程量清单", [
        "billOfQuantitiesRef",
      ]),
    );
  }
  if (
    [
      draft.bidPriceMinor,
      draft.priceDeclaration.itemizedTotalMinor,
      draft.priceDeclaration.bidLetterTotalMinor,
      draft.priceDeclaration.openingTotalMinor,
    ].some((value) => value !== draft.bidPriceMinor)
  ) {
    findings.push(
      bidFinding("BID_CONSTRUCTION_PRICE_MISMATCH", "施工投标总价与报价声明不一致", [
        "bidPriceMinor",
      ]),
    );
  }
  if (
    !draft.projectManager.userConfirmedTruth ||
    PLACEHOLDER.test(draft.projectManager.name) ||
    PLACEHOLDER.test(draft.projectManager.qualification) ||
    PLACEHOLDER.test(draft.projectManager.certificateNumber)
  ) {
    findings.push(
      bidFinding(
        "BID_CONSTRUCTION_MANAGER_UNCONFIRMED",
        "项目经理身份、资格和证书须由用户提供并确认真实性",
        ["projectManager"],
      ),
    );
  }
  if (draft.keyTechnicalPersonnel.length === 0) {
    findings.push(
      bidFinding("BID_CONSTRUCTION_PERSONNEL_MISSING", "至少需要一名用户提供的关键技术人员", [
        "keyTechnicalPersonnel",
      ]),
    );
  }
  draft.keyTechnicalPersonnel.forEach((person, index) => {
    if (!person.userConfirmedTruth) {
      findings.push(
        bidFinding(
          "BID_CONSTRUCTION_PERSONNEL_UNCONFIRMED",
          "关键技术人员资格和经历须由用户确认真实性",
          ["keyTechnicalPersonnel", String(index)],
        ),
      );
    }
  });
  if (draft.equipmentList.length === 0) {
    findings.push(
      bidFinding("BID_CONSTRUCTION_EQUIPMENT_MISSING", "至少需要一项用户提供的施工机械", [
        "equipmentList",
      ]),
    );
  }
  draft.equipmentList.forEach((equipment, index) => {
    if (!equipment.userConfirmedTruth) {
      findings.push(
        bidFinding("BID_CONSTRUCTION_EQUIPMENT_UNCONFIRMED", "机械信息及可用性须由用户确认真实性", [
          "equipmentList",
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
  const money = (minor: string) => formatMoneyMinorV2(minor, draft.source.currency);
  const paragraph = (id: string, text: string) => ({
    type: "paragraph" as const,
    id,
    text: bidLocalized(text),
  });
  const section = (id: string, text: string, landscape = false) => ({
    id,
    ...(landscape ? { page: { orientation: "landscape" as const } } : {}),
    blocks: [paragraph(`${id}-text`, text)],
  });
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
  const deviationTable = (id: string, values: ConstructionWorksBidDraftV1["businessDeviations"]) =>
    table(
      id,
      [
        { id: "source", label: bidLocalized("来源"), width: "20%", align: "left" },
        { id: "requirement", label: bidLocalized("原要求"), width: "30%", align: "left" },
        { id: "response", label: bidLocalized("投标响应"), width: "30%", align: "left" },
        { id: "deviation", label: bidLocalized("偏差"), width: "20%", align: "left" },
      ],
      values.map((item) => ({
        id: `${id}-${item.requirementId}`,
        cells: {
          source: bidLocalized(item.sourceRefIds.join("；")),
          requirement: bidLocalized(item.requirement),
          response: bidLocalized(item.response),
          deviation: bidLocalized(item.deviation),
        },
      })),
    );
  const sections = [
    {
      id: "internal-cover",
      blocks: [
        {
          type: "cover" as const,
          id: "construction-cover",
          title: bidLocalized("建设工程施工投标文件"),
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
          id: "construction-source",
          entries: [
            {
              id: "project-number",
              label: bidLocalized("项目编号"),
              value: bidLocalized(show(draft.source.projectNumber)),
            },
            {
              id: "source-version",
              label: bidLocalized("招标文件版本"),
              value: bidLocalized(show(draft.source.versionLabel)),
            },
            {
              id: "source-file",
              label: bidLocalized("项目招标文件"),
              value: bidLocalized(show(draft.source.versionEvidence.mainSolicitationAttachmentId)),
            },
            {
              id: "boq-file",
              label: bidLocalized("实际工程量清单"),
              value: bidLocalized(show(draft.billOfQuantitiesRef)),
            },
          ],
        },
        {
          type: "notice" as const,
          id: "construction-source-notice",
          tone: "warning" as const,
          paragraphs: [
            bidLocalized(
              "模板依据不等于本项目招标文件；工程量、资格、人员经历和标准条款均不得由模板补造。",
            ),
          ],
        },
      ],
    },
    { id: "toc", blocks: [{ type: "toc" as const, id: "construction-toc", maxDepth: 2 as const }] },
    {
      id: "bid-letter-and-appendix",
      blocks: [
        {
          type: "declaration" as const,
          id: "construction-bid-letter",
          title: bidLocalized("投标函及附录"),
          paragraphs: [
            bidLocalized(
              `项目：${show(draft.source.projectName)}；投标总价：${money(draft.bidPriceMinor)}；工期：${draft.durationDays}日历天；质量目标：${draft.qualityTarget}。`,
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
          id: "construction-authorization",
          title: bidLocalized("授权信息"),
          paragraphs: [
            bidLocalized(
              `授权代表：${show(draft.authorizedRepresentative)}。授权与签章状态须人工核验。`,
            ),
          ],
        },
      ],
    },
    {
      id: "qualifications",
      blocks: [
        table(
          "construction-qualifications",
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
    section(
      "guarantee",
      draft.source.guaranteeRequirement.required
        ? `要求方式：${draft.source.guaranteeRequirement.allowedMethods.join("、")}；要求金额：${money(draft.source.guaranteeRequirement.amountMinor ?? "0")}；投标保证记录：${draft.bidGuarantee ? `${draft.bidGuarantee.method}/${draft.bidGuarantee.reference}` : "未提供"}`
        : "项目招标文件记录为不要求投标保证金。",
    ),
    {
      id: "priced-boq",
      page: { orientation: "landscape" as const },
      blocks: [
        {
          type: "notice" as const,
          id: "priced-boq-reference",
          tone: "info" as const,
          paragraphs: [
            bidLocalized(
              `本节仅引用用户附加的实际工程量清单 ${show(draft.billOfQuantitiesRef)}，模板不生成或改写工程量。`,
            ),
          ],
        },
        {
          type: "totals" as const,
          id: "construction-price-total",
          entries: [
            {
              id: "bid-price",
              label: bidLocalized("投标总价"),
              value: bidLocalized(money(draft.bidPriceMinor)),
            },
          ],
        },
      ],
    },
    {
      id: "commercial-deviations",
      page: { orientation: "landscape" as const },
      blocks: [deviationTable("commercial-deviation-table", draft.businessDeviations)],
    },
    {
      id: "technical-deviations",
      page: { orientation: "landscape" as const },
      blocks: [deviationTable("technical-deviation-table", draft.technicalDeviations)],
    },
    section(
      "construction-organization",
      `${draft.projectScope}\n${draft.constructionOrganization}`,
    ),
    section("schedule", `投标工期：${draft.durationDays}日历天。${draft.schedulePlan}`),
    {
      id: "site-resources",
      blocks: [
        section(
          "site-plan-inner",
          `现场：${show(draft.sitePlan)}；材料：${show(draft.materialsPlan)}；临时工程：${show(draft.temporaryWorks)}`,
        ).blocks[0],
        table(
          "labor-plan-table",
          [
            { id: "trade", label: bidLocalized("工种/班组"), width: "40%", align: "left" },
            { id: "count", label: bidLocalized("人数"), width: "20%", align: "right" },
            { id: "period", label: bidLocalized("期间"), width: "40%", align: "left" },
          ],
          draft.laborPlan.map((item, index) => ({
            id: `labor-${index + 1}`,
            cells: {
              trade: bidLocalized(item.trade),
              count: bidLocalized(String(item.count)),
              period: bidLocalized(item.period),
            },
          })),
        ),
      ],
    },
    {
      id: "project-manager",
      blocks: [
        {
          type: "keyValueGrid" as const,
          id: "project-manager-grid",
          entries: [
            {
              id: "manager-name",
              label: bidLocalized("姓名"),
              value: bidLocalized(draft.projectManager.name),
            },
            {
              id: "manager-qualification",
              label: bidLocalized("资格"),
              value: bidLocalized(draft.projectManager.qualification),
            },
            {
              id: "manager-certificate",
              label: bidLocalized("证书编号"),
              value: bidLocalized(draft.projectManager.certificateNumber),
            },
            {
              id: "manager-truth",
              label: bidLocalized("真实性"),
              value: bidLocalized(
                draft.projectManager.userConfirmedTruth ? "已由用户确认" : "未确认",
              ),
            },
          ],
        },
      ],
    },
    {
      id: "key-personnel",
      blocks: [
        table(
          "key-personnel-table",
          [
            { id: "name", label: bidLocalized("姓名"), width: "20%", align: "left" },
            { id: "role", label: bidLocalized("角色"), width: "20%", align: "left" },
            { id: "qualification", label: bidLocalized("资格"), width: "30%", align: "left" },
            { id: "experience", label: bidLocalized("经历"), width: "30%", align: "left" },
          ],
          draft.keyTechnicalPersonnel.map((item) => ({
            id: item.id,
            cells: {
              name: bidLocalized(item.name),
              role: bidLocalized(item.role),
              qualification: bidLocalized(item.qualification),
              experience: bidLocalized(item.experience),
            },
          })),
        ),
      ],
    },
    {
      id: "equipment",
      page: { orientation: "landscape" as const },
      blocks: [
        table(
          "equipment-table",
          [
            { id: "name", label: bidLocalized("机械"), width: "25%", align: "left" },
            { id: "model", label: bidLocalized("型号"), width: "20%", align: "left" },
            { id: "quantity", label: bidLocalized("数量"), width: "15%", align: "right" },
            { id: "ownership", label: bidLocalized("来源"), width: "15%", align: "center" },
            { id: "availability", label: bidLocalized("可用性"), width: "25%", align: "left" },
          ],
          draft.equipmentList.map((item) => ({
            id: item.id,
            cells: {
              name: bidLocalized(item.name),
              model: bidLocalized(item.model),
              quantity: bidLocalized(String(item.quantity)),
              ownership: bidLocalized(item.ownership),
              availability: bidLocalized(item.availability),
            },
          })),
        ),
      ],
    },
    section("quality", `质量目标：${draft.qualityTarget}\n质量方案：${draft.qualityPlan}`),
    section(
      "safety-environment",
      `安全：${draft.safetyPlan}\n环保：${draft.environmentPlan}\n应急：${draft.emergencyPlan}`,
    ),
    section("subcontract", show(draft.subcontractPlan)),
    {
      id: "experience",
      blocks: [
        table(
          "manager-experience-table",
          [
            { id: "project", label: bidLocalized("项目"), width: "30%", align: "left" },
            { id: "customer", label: bidLocalized("建设单位"), width: "25%", align: "left" },
            { id: "period", label: bidLocalized("期间"), width: "20%", align: "left" },
            { id: "scope", label: bidLocalized("范围"), width: "25%", align: "left" },
          ],
          draft.projectManager.experience.map((item) => ({
            id: item.id,
            cells: {
              project: bidLocalized(item.projectName),
              customer: bidLocalized(item.customer),
              period: bidLocalized(item.period),
              scope: bidLocalized(item.scope),
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
          id: "construction-attachments",
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
          id: "construction-final-checklist",
          ordered: false,
          items: [
            ...draft.signSealChecklist.map((item) =>
              bidLocalized(`${item.label}：${item.confirmed ? "已确认" : "未确认"}`),
            ),
            bidLocalized(
              `导出状态：${decision.mode}。submission-ready 不等于已签名、已上传、工程量正确或已由招标人认定合规。`,
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
          id: "construction-signatures",
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
    title: bidLocalized("建设工程施工投标文件"),
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

export const CONSTRUCTION_WORKS_BID_REGISTRATION: TemplateRegistration<
  ConstructionWorksBidDraftV1,
  DocumentModelV2
> = Object.freeze({
  definition: CONSTRUCTION_WORKS_BID_DEFINITION,
  parseDraft,
  createDraft,
  createRepeatableItem(
    path: string,
    input: { readonly id: string; readonly now: string | Date; readonly draft: unknown },
  ) {
    const common = createBidBaseRepeatableItem(path, input);
    if (common !== undefined) return common;
    if (path === "projectManager.experience") {
      const item = (input.draft as ConstructionWorksBidDraftV1).projectReferences.find(
        (entry) => entry.id === input.id,
      );
      if (!item) throw new Error("缺少对应项目业绩");
      return item;
    }
    if (path === "keyTechnicalPersonnel") {
      return {
        id: input.id,
        name: "待填写",
        role: "待填写",
        qualification: "待填写",
        experience: "待填写",
        userConfirmedTruth: false,
      };
    }
    if (path === "laborPlan") {
      return { trade: "待填写", count: 1, period: "待填写" };
    }
    if (path === "equipmentList") {
      return {
        id: input.id,
        name: "待填写",
        model: "待填写",
        quantity: 1,
        ownership: "planned",
        availability: "待填写",
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
