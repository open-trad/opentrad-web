import { isolatedArraySchema } from "../../../safe-schema.js";
import type { z } from "../../../zod.js";
import type { TemplateDefinitionV2 } from "../../common.js";
import { type DocumentModelV2, DocumentModelV2Schema } from "../../document-model.js";
import {
  BasisPointsV2Schema,
  calculateQuoteLinesV2,
  formatMoneyMinorV2,
  IdentifierV2Schema,
  MoneyMinorV2Schema,
  QuantityV2Schema,
} from "../../money.js";
import type { TemplateEvaluationContext, TemplateRegistration } from "../../registry.js";
import type { RiskFindingV2 } from "../../risk.js";
import {
  type BidDraftBaseV1,
  DeviationEntryV1Schema,
  decideBidExport,
  evaluateBidDeadline,
  RequirementResponseV1Schema,
  requiredBidContentFindings,
} from "../bid-common.js";
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
  REQUIREMENT_MATRIX_COLUMNS,
  requirementMatrixRows,
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
        message: "Enterprise-goods ids must be unique",
        path: [index, "id"],
      });
    }
    seen.add(value.id);
  });
}

const GoodsOfferLineSchema = strictBidObject({
  id: IdentifierV2Schema,
  name: bidText(500, true),
  brand: bidText(300, true),
  model: bidText(300, true),
  manufacturer: bidText(500, true),
  origin: bidText(300, true),
  specification: bidText(10_000, true),
  quantity: QuantityV2Schema,
  unit: bidText(100, true),
  unitPriceMinor: MoneyMinorV2Schema,
  taxRateBps: BasisPointsV2Schema,
  policyAttributes: bidText(2_000, true).optional(),
});

const EnterpriseGoodsSpecializedSchema = strictBidObject({
  executiveSummary: bidText(10_000, true),
  goodsOfferLines: isolatedArraySchema(GoodsOfferLineSchema, { max: 100, refine: uniqueIds }),
  requirementMatrix: isolatedArraySchema(RequirementResponseV1Schema, {
    max: 500,
    refine: uniqueIds,
  }),
  commercialOffer: bidText(10_000, true),
  technicalOffer: bidText(10_000, true),
  deliveryPlan: bidText(10_000, true),
  qualityAssurance: bidText(10_000, true),
  inspectionAcceptance: bidText(10_000, true),
  warranty: bidText(10_000, true),
  afterSales: bidText(10_000, true),
  supplyContinuity: bidText(10_000, true).optional(),
  inventoryPlan: bidText(10_000, true).optional(),
  manufacturerSupport: bidText(10_000, true).optional(),
  contractAcceptanceDeviations: isolatedArraySchema(DeviationEntryV1Schema, { max: 200 }),
});

export interface EnterpriseGoodsBidDraftV1 extends BidDraftBaseV1 {
  readonly templateId: "bid.enterprise.goods.v1";
  readonly executiveSummary: string;
  readonly goodsOfferLines: readonly z.output<typeof GoodsOfferLineSchema>[];
  readonly requirementMatrix: readonly z.output<typeof RequirementResponseV1Schema>[];
  readonly commercialOffer: string;
  readonly technicalOffer: string;
  readonly deliveryPlan: string;
  readonly qualityAssurance: string;
  readonly inspectionAcceptance: string;
  readonly warranty: string;
  readonly afterSales: string;
  readonly supplyContinuity?: string;
  readonly inventoryPlan?: string;
  readonly manufacturerSupport?: string;
  readonly contractAcceptanceDeviations: BidDraftBaseV1["businessDeviations"];
}

const SPECIALIZED_KEYS = Object.freeze([
  "executiveSummary",
  "goodsOfferLines",
  "requirementMatrix",
  "commercialOffer",
  "technicalOffer",
  "deliveryPlan",
  "qualityAssurance",
  "inspectionAcceptance",
  "warranty",
  "afterSales",
  "supplyContinuity",
  "inventoryPlan",
  "manufacturerSupport",
  "contractAcceptanceDeviations",
]);

export const EnterpriseGoodsBidDraftV1Schema = createSpecializedBidSchema(
  "bid.enterprise.goods.v1",
  SPECIALIZED_KEYS,
  EnterpriseGoodsSpecializedSchema,
  (draft, addIssue) => {
    const requirements = new Map(draft.requirements.map((item) => [item.id, item]));
    draft.requirementMatrix.forEach((item, index) => {
      const canonical = requirements.get(item.id);
      if (!canonical || !sameBidData(canonical, item)) {
        addIssue({
          code: "custom",
          message: "Enterprise requirement matrix must reference canonical requirements",
          path: ["requirementMatrix", index, "id"],
        });
      }
    });
    const canonicalDeviations = new Map(
      draft.businessDeviations.map((item) => [item.requirementId, item]),
    );
    draft.contractAcceptanceDeviations.forEach((item, index) => {
      const canonical = canonicalDeviations.get(item.requirementId);
      if (!canonical || !sameBidData(canonical, item)) {
        addIssue({
          code: "custom",
          message: "Contract-acceptance deviation must match a canonical business deviation",
          path: ["contractAcceptanceDeviations", index],
        });
      }
    });
  },
);

export const ENTERPRISE_GOODS_BID_DEFINITION = {
  id: "bid.enterprise.goods.v1",
  version: "1.0.0",
  category: "bid",
  name: "企业货物采购投标文件",
  summary: "覆盖货物方案、需求矩阵、商业条件、交付、质量、验收、售后与供应连续性的企业采购响应底稿",
  basisDate: "2026-08-19",
  languages: ["zh-CN"],
  defaultLanguage: "zh-CN",
  allowedLayouts: ["classic-formal.v1", "modern-business.v1"],
  defaultLayout: "modern-business.v1",
  supportedOutputs: ["docx", "pdf", "json", "opentrad"],
  sourceKeys: ["prc-tendering-law"],
  disclaimerProfile: "bid",
  fieldManifest: [
    {
      path: "executiveSummary",
      section: "executive-summary",
      label: "方案摘要",
      control: "textarea",
      required: true,
    },
    {
      path: "goodsOfferLines",
      section: "goods-offer",
      label: "货物方案",
      control: "repeatable",
      required: true,
    },
    {
      path: "requirementMatrix",
      section: "requirements-matrix",
      label: "需求响应矩阵",
      control: "repeatable",
      required: true,
    },
    {
      path: "commercialOffer",
      section: "commercial-terms",
      label: "商业方案",
      control: "textarea",
      required: true,
    },
    {
      path: "deliveryPlan",
      section: "delivery",
      label: "交付方案",
      control: "textarea",
      required: true,
    },
    {
      path: "qualityAssurance",
      section: "quality-acceptance",
      label: "质量保证",
      control: "textarea",
      required: true,
    },
    {
      path: "inspectionAcceptance",
      section: "quality-acceptance",
      label: "检验验收",
      control: "textarea",
      required: true,
    },
    {
      path: "afterSales",
      section: "warranty-aftersales",
      label: "售后方案",
      control: "textarea",
      required: true,
    },
  ],
} as const satisfies TemplateDefinitionV2;

const PLACEHOLDER = /^(?:\s*|待填写|待确认|未提供|未绑定)$/u;

function parseDraft(value: unknown): EnterpriseGoodsBidDraftV1 {
  return EnterpriseGoodsBidDraftV1Schema.parse(value) as EnterpriseGoodsBidDraftV1;
}

function createDraft(input: { readonly id: string; readonly now: string | Date }) {
  return parseDraft({
    ...createBidBaseDraft("bid.enterprise.goods.v1", input),
    executiveSummary: "待填写",
    goodsOfferLines: [],
    requirementMatrix: [],
    commercialOffer: "待填写",
    technicalOffer: "待填写",
    deliveryPlan: "待填写",
    qualityAssurance: "待填写",
    inspectionAcceptance: "待填写",
    warranty: "待填写",
    afterSales: "待填写",
    contractAcceptanceDeviations: [],
  });
}

function calculation(draft: EnterpriseGoodsBidDraftV1) {
  if (draft.goodsOfferLines.length === 0 || draft.source.taxBasis === "as-specified")
    return undefined;
  return calculateQuoteLinesV2(
    draft.goodsOfferLines.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      discountBps: 0,
      taxRateBps: line.taxRateBps,
    })),
    { currency: draft.source.currency, taxMode: draft.source.taxBasis },
  );
}

function analyze(draft: EnterpriseGoodsBidDraftV1): readonly RiskFindingV2[] {
  const findings = commonBidFindings(draft);
  findings.push(
    ...requiredBidContentFindings([
      {
        path: [],
        value: {
          executiveSummary: draft.executiveSummary,
          commercialOffer: draft.commercialOffer,
          technicalOffer: draft.technicalOffer,
          deliveryPlan: draft.deliveryPlan,
          qualityAssurance: draft.qualityAssurance,
          inspectionAcceptance: draft.inspectionAcceptance,
          warranty: draft.warranty,
          afterSales: draft.afterSales,
        },
      },
      {
        path: ["goodsOfferLines"],
        value: draft.goodsOfferLines.map((item) => ({
          name: item.name,
          brand: item.brand,
          model: item.model,
          manufacturer: item.manufacturer,
          origin: item.origin,
          specification: item.specification,
          unit: item.unit,
        })),
      },
      {
        path: ["requirementMatrix"],
        value: draft.requirementMatrix.map((item) => ({
          requirementText: item.requirementText,
          responseText: item.responseText,
        })),
      },
      {
        path: ["contractAcceptanceDeviations"],
        value: draft.contractAcceptanceDeviations.map((item) => ({
          requirement: item.requirement,
          response: item.response,
          deviation: item.deviation,
        })),
      },
    ]),
  );
  if (draft.goodsOfferLines.length === 0) {
    findings.push(
      bidFinding("BID_ENTERPRISE_GOODS_LINES_MISSING", "至少需要一项用户提供的货物方案", [
        "goodsOfferLines",
      ]),
    );
  }
  if (draft.requirementMatrix.length === 0) {
    findings.push(
      bidFinding("BID_ENTERPRISE_REQUIREMENT_MATRIX_MISSING", "企业采购需求响应矩阵尚未提供", [
        "requirementMatrix",
      ]),
    );
  }
  for (const [field, value, code, label] of [
    ["executiveSummary", draft.executiveSummary, "BID_ENTERPRISE_SUMMARY_MISSING", "方案摘要"],
    [
      "commercialOffer",
      draft.commercialOffer,
      "BID_ENTERPRISE_COMMERCIAL_OFFER_MISSING",
      "商业方案",
    ],
    ["technicalOffer", draft.technicalOffer, "BID_ENTERPRISE_TECHNICAL_OFFER_MISSING", "技术方案"],
    ["deliveryPlan", draft.deliveryPlan, "BID_ENTERPRISE_DELIVERY_MISSING", "交付方案"],
    ["qualityAssurance", draft.qualityAssurance, "BID_ENTERPRISE_QUALITY_MISSING", "质量保证"],
    [
      "inspectionAcceptance",
      draft.inspectionAcceptance,
      "BID_ENTERPRISE_ACCEPTANCE_MISSING",
      "检验验收",
    ],
    ["warranty", draft.warranty, "BID_ENTERPRISE_WARRANTY_MISSING", "质保方案"],
    ["afterSales", draft.afterSales, "BID_ENTERPRISE_AFTERSALES_MISSING", "售后方案"],
  ] as const) {
    if (PLACEHOLDER.test(value)) findings.push(bidFinding(code, `${label}尚未提供`, [field]));
  }
  if (draft.source.taxBasis === "as-specified") {
    findings.push(
      bidFinding("BID_ENTERPRISE_GOODS_TAX_BASIS_UNRESOLVED", "须按企业采购文件确认报价含税口径", [
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
      bidFinding("BID_ENTERPRISE_GOODS_TOTAL_MISMATCH", "货物方案重算总价与报价声明不一致", [
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
  const deviations = [...draft.businessDeviations, ...draft.technicalDeviations];
  const sections = [
    {
      id: "draft-cover",
      blocks: [
        {
          type: "cover" as const,
          id: "enterprise-goods-cover",
          title: bidLocalized("企业货物采购投标文件"),
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
          id: "enterprise-goods-source",
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
          id: "enterprise-goods-law-context",
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
      blocks: [{ type: "toc" as const, id: "enterprise-goods-toc", maxDepth: 2 as const }],
    },
    {
      id: "offer-letter",
      blocks: [
        {
          type: "declaration" as const,
          id: "enterprise-goods-offer-letter",
          title: bidLocalized("报价函"),
          paragraphs: [
            bidLocalized(
              `我方就${show(draft.source.projectName)}提交货物采购响应，价格和条件以本文件各表为准。`,
            ),
          ],
        },
      ],
    },
    {
      id: "bidder-profile",
      blocks: [
        {
          type: "parties" as const,
          id: "enterprise-goods-bidder",
          parties: [
            {
              id: "bidder",
              role: bidLocalized("供应商"),
              name: bidLocalized(draft.bidder.legalName),
              details: [
                bidLocalized(`联系人：${draft.bidder.contactName}`),
                bidLocalized(`登记号：${show(draft.bidder.registrationId)}`),
              ],
            },
          ],
        },
      ],
    },
    {
      id: "qualifications",
      blocks: [
        table(
          "enterprise-goods-qualifications",
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
    section("executive-summary", draft.executiveSummary),
    {
      id: "price",
      blocks: [
        {
          type: "totals" as const,
          id: "enterprise-goods-price",
          entries: [
            {
              id: "declared",
              label: bidLocalized("报价声明"),
              value: bidLocalized(money(draft.priceDeclaration.openingTotalMinor)),
            },
            {
              id: "calculated",
              label: bidLocalized("货物明细重算"),
              value: bidLocalized(exact ? money(exact.summary.totalMinor) : "无法重算"),
            },
          ],
        },
      ],
    },
    {
      id: "goods-offer",
      page: { orientation: "landscape" as const },
      blocks: [
        table(
          "enterprise-goods-offer-table",
          [
            { id: "name", label: bidLocalized("货物"), width: "18%", align: "left" },
            { id: "brandModel", label: bidLocalized("品牌型号"), width: "18%", align: "left" },
            { id: "makerOrigin", label: bidLocalized("制造商/产地"), width: "20%", align: "left" },
            { id: "spec", label: bidLocalized("规格"), width: "20%", align: "left" },
            { id: "quantity", label: bidLocalized("数量"), width: "10%", align: "right" },
            { id: "total", label: bidLocalized("重算金额"), width: "14%", align: "right" },
          ],
          draft.goodsOfferLines.map((line) => ({
            id: line.id,
            cells: {
              name: bidLocalized(line.name),
              brandModel: bidLocalized(`${line.brand} / ${line.model}`),
              makerOrigin: bidLocalized(`${line.manufacturer} / ${line.origin}`),
              spec: bidLocalized(line.specification),
              quantity: bidLocalized(`${line.quantity} ${line.unit}`),
              total: bidLocalized(
                totals.has(line.id) ? money(totals.get(line.id) ?? "0") : "无法重算",
              ),
            },
          })),
        ),
      ],
    },
    {
      id: "requirements-matrix",
      page: { orientation: "landscape" as const },
      blocks: [
        {
          type: "complianceMatrix" as const,
          id: "enterprise-goods-requirements",
          columns: REQUIREMENT_MATRIX_COLUMNS,
          rows: requirementMatrixRows(draft, draft.requirementMatrix),
        },
      ],
    },
    section("technical-solution", draft.technicalOffer),
    section("delivery", draft.deliveryPlan),
    section(
      "quality-acceptance",
      `质量保证：${draft.qualityAssurance}\n检验验收：${draft.inspectionAcceptance}`,
    ),
    section("warranty-aftersales", `质保：${draft.warranty}\n售后：${draft.afterSales}`),
    section(
      "continuity",
      `供应连续性：${show(draft.supplyContinuity)}\n库存方案：${show(draft.inventoryPlan)}\n厂商支持：${show(draft.manufacturerSupport)}`,
    ),
    section("commercial-terms", draft.commercialOffer),
    {
      id: "deviations",
      blocks: [
        table(
          "enterprise-goods-deviations",
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
      id: "cases",
      blocks: [
        table(
          "enterprise-goods-cases",
          [
            { id: "project", label: bidLocalized("案例"), width: "30%", align: "left" },
            { id: "customer", label: bidLocalized("客户"), width: "25%", align: "left" },
            { id: "scope", label: bidLocalized("范围"), width: "30%", align: "left" },
            { id: "truth", label: bidLocalized("真实性"), width: "15%", align: "center" },
          ],
          draft.projectReferences.map((item) => ({
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
      id: "attachments",
      blocks: [
        {
          type: "attachmentIndex" as const,
          id: "enterprise-goods-attachments",
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
          id: "enterprise-goods-checklist",
          ordered: false,
          items: [
            ...draft.signSealChecklist.map((item) =>
              bidLocalized(`${item.label}：${item.confirmed ? "已确认" : "未确认"}`),
            ),
            bidLocalized(
              `合同接受偏差：${draft.contractAcceptanceDeviations.length > 0 ? `${draft.contractAcceptanceDeviations.length}项` : "无"}`,
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
          id: "enterprise-goods-signatures",
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
    title: bidLocalized("企业货物采购投标文件"),
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

export const ENTERPRISE_GOODS_BID_REGISTRATION: TemplateRegistration<
  EnterpriseGoodsBidDraftV1,
  DocumentModelV2
> = Object.freeze({
  definition: ENTERPRISE_GOODS_BID_DEFINITION,
  parseDraft,
  createDraft,
  compile,
  preflight(value: unknown, context?: TemplateEvaluationContext) {
    const draft = parseDraft(value);
    const deadline = evaluateBidDeadline(projectBidBaseDraft(draft), context);
    return freezeBidFindings([...analyze(draft), ...deadline.findings]);
  },
});
