import { z } from "../../../zod.js";
import type { EntityPartyV2, TemplateDefinitionV2 } from "../../common.js";
import { type DocumentModelV2, DocumentModelV2Schema } from "../../document-model.js";
import {
  CurrencyV2Schema,
  calculateQuoteLinesV2,
  formatMoneyMinorV2,
  TaxModeV2Schema,
} from "../../money.js";
import type { AttachmentRefV1 } from "../../project.js";
import type { TemplateRegistration } from "../../registry.js";
import type { RiskFindingV2 } from "../../risk.js";
import {
  type ContractGeneralTermsV1,
  ContractGeneralTermsV1Schema,
  type ContractMetaV2,
  ContractMetaV2Schema,
  ContractSignersV1Schema,
  type ContractSignerV1,
} from "../contract-common.js";
import {
  attachmentEditorField,
  CURRENCY_OPTIONS,
  checkboxEditorField,
  contractGeneralTermsEditorFields,
  contractMetaEditorFields,
  contractSignersEditorField,
  dateEditorField,
  entityPartyEditorFields,
  numberEditorField,
  selectEditorField,
  standardGoodsLinesEditorField,
  TAX_MODE_OPTIONS,
  textEditorField,
} from "../editor-manifest.js";
import { DateV2Schema, GoodsLinesV2Schema, type GoodsLineV2 } from "../quote-common.js";
import {
  ContractAttachmentRefsSchema,
  ContractPartyV2Schema,
  contractDates,
  contractFinding,
  contractText,
  contractWatermarks,
  exportedAttachments,
  freezeContractFindings,
  frozenContractSchema,
  localized,
  partyDetails,
  signerBlocks,
  strictContractObject,
  validateAttachmentReferences,
  validateSignerPartyReferences,
} from "./shared.js";

export interface FrameworkSupplyContractDraftV1 {
  readonly id: string;
  readonly templateId: "contract.supply.framework.v1";
  readonly templateVersion: "1.0.0";
  readonly meta: ContractMetaV2;
  readonly supplier: EntityPartyV2;
  readonly purchaser: EntityPartyV2;
  readonly term: { readonly startDate: string; readonly endDate: string };
  readonly catalogLines: readonly GoodsLineV2[];
  readonly pricing: {
    readonly currency?: "CNY" | "USD" | "EUR";
    readonly taxMode?: "tax-excluded" | "tax-included" | "tax-exempt";
    readonly priceMethod: string;
    readonly adjustmentTrigger: string;
    readonly adjustmentNoticeDays: number;
  };
  readonly forecast: {
    readonly frequency: string;
    readonly binding: boolean;
    readonly minimumPurchaseCommitment?: string;
    readonly exclusivity?: string;
  };
  readonly riskAcknowledgements: { readonly commercialRiskConfirmed: boolean };
  readonly ordering: {
    readonly formation: string;
    readonly approval: string;
    readonly documentPriority: string;
    readonly moq: string;
    readonly leadTime: string;
    readonly capacityCommitment?: string;
    readonly inventoryPolicy?: string;
  };
  readonly performance: {
    readonly delivery: string;
    readonly acceptance: string;
    readonly reconciliationCycle: string;
    readonly invoice: string;
    readonly settlement: string;
    readonly quality: string;
    readonly warranty: string;
    readonly supplyContinuity: string;
    readonly transitionAssistance?: string;
  };
  readonly orderTemplateAttachmentId?: string;
  readonly generalTerms: ContractGeneralTermsV1;
  readonly signers: readonly ContractSignerV1[];
  readonly attachments: readonly AttachmentRefV1[];
  readonly updatedAt: string;
}

const BusinessText = contractText(10_000);
const IsoInstantSchema = contractText(35, true).refine(
  (value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
  "Expected a canonical ISO instant",
);
const TermSchema = strictContractObject(
  { startDate: DateV2Schema, endDate: DateV2Schema },
  (term, addIssue) => {
    if (term.endDate < term.startDate) {
      addIssue({
        code: "custom",
        message: "Framework term end must not precede start",
        path: ["endDate"],
      });
    }
  },
);
const PricingSchema = strictContractObject({
  currency: CurrencyV2Schema.optional(),
  taxMode: TaxModeV2Schema.optional(),
  priceMethod: BusinessText,
  adjustmentTrigger: BusinessText,
  adjustmentNoticeDays: z.number().int().min(0).max(36_500),
});
const ForecastSchema = strictContractObject({
  frequency: BusinessText,
  binding: z.boolean(),
  minimumPurchaseCommitment: BusinessText.optional(),
  exclusivity: BusinessText.optional(),
});
const RiskAcknowledgementsSchema = strictContractObject({ commercialRiskConfirmed: z.boolean() });
const OrderingSchema = strictContractObject({
  formation: BusinessText,
  approval: BusinessText,
  documentPriority: BusinessText,
  moq: BusinessText,
  leadTime: BusinessText,
  capacityCommitment: BusinessText.optional(),
  inventoryPolicy: BusinessText.optional(),
});
const PerformanceSchema = strictContractObject({
  delivery: BusinessText,
  acceptance: BusinessText,
  reconciliationCycle: BusinessText,
  invoice: BusinessText,
  settlement: BusinessText,
  quality: BusinessText,
  warranty: BusinessText,
  supplyContinuity: BusinessText,
  transitionAssistance: BusinessText.optional(),
});

const FrameworkSupplyDraftRawSchema = strictContractObject(
  {
    id: contractText(64, true).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/),
    templateId: z.literal("contract.supply.framework.v1"),
    templateVersion: z.literal("1.0.0"),
    meta: ContractMetaV2Schema,
    supplier: ContractPartyV2Schema,
    purchaser: ContractPartyV2Schema,
    term: TermSchema,
    catalogLines: GoodsLinesV2Schema,
    pricing: PricingSchema,
    forecast: ForecastSchema,
    riskAcknowledgements: RiskAcknowledgementsSchema,
    ordering: OrderingSchema,
    performance: PerformanceSchema,
    orderTemplateAttachmentId: contractText(200, true).optional(),
    generalTerms: ContractGeneralTermsV1Schema,
    signers: ContractSignersV1Schema,
    attachments: ContractAttachmentRefsSchema,
    updatedAt: IsoInstantSchema,
  },
  (draft, addIssue) => {
    if (draft.meta.language !== "zh-CN" || draft.meta.layoutStyleId !== "classic-formal.v1") {
      addIssue({
        code: "custom",
        message: "Framework contract presentation is fixed",
        path: ["meta"],
      });
    }
    validateSignerPartyReferences(draft.signers, ["supplier", "purchaser"], addIssue);
    if (draft.orderTemplateAttachmentId) {
      validateAttachmentReferences(
        [draft.orderTemplateAttachmentId],
        draft.attachments,
        ["orderTemplateAttachmentId"],
        addIssue,
      );
    }
  },
);

export const FrameworkSupplyContractDraftV1Schema = frozenContractSchema(
  FrameworkSupplyDraftRawSchema,
  {
    arrayLimits: { catalogLines: 100, signers: 10, attachments: 100 },
    maxTotalValues: 6_000,
  },
);

export const FRAMEWORK_SUPPLY_CONTRACT_DEFINITION = {
  id: "contract.supply.framework.v1",
  version: "1.0.0",
  category: "contract",
  name: "框架供应合同",
  summary: "覆盖目录、预测、订单优先级和连续供应安排的框架合同草案",
  basisDate: "2026-08-19",
  languages: ["zh-CN"],
  defaultLanguage: "zh-CN",
  allowedLayouts: ["classic-formal.v1"],
  defaultLayout: "classic-formal.v1",
  supportedOutputs: ["docx", "pdf", "json", "opentrad"],
  sourceKeys: ["prc-civil-code", "samr-contract-library"],
  disclaimerProfile: "contract",
  fieldManifest: [
    ...contractMetaEditorFields({ section: "meta" }),
    ...entityPartyEditorFields({ prefix: "supplier", section: "parties", label: "供应方" }),
    ...entityPartyEditorFields({ prefix: "purchaser", section: "parties", label: "采购方" }),
    dateEditorField("term.startDate", "term", "期限开始日", true),
    dateEditorField("term.endDate", "term", "期限结束日", true),
    standardGoodsLinesEditorField({
      path: "catalogLines",
      section: "catalog-price",
      label: "供应目录",
    }),
    selectEditorField({
      path: "pricing.currency",
      section: "catalog-price",
      label: "币种",
      required: true,
      options: CURRENCY_OPTIONS,
    }),
    selectEditorField({
      path: "pricing.taxMode",
      section: "catalog-price",
      label: "计税口径",
      required: true,
      options: TAX_MODE_OPTIONS,
    }),
    textEditorField({
      path: "pricing.priceMethod",
      section: "catalog-price",
      label: "定价方式",
      required: true,
      multiline: true,
    }),
    textEditorField({
      path: "pricing.adjustmentTrigger",
      section: "catalog-price",
      label: "调价触发条件",
      required: true,
      multiline: true,
    }),
    numberEditorField({
      path: "pricing.adjustmentNoticeDays",
      section: "catalog-price",
      label: "调价通知天数",
      required: true,
      integer: true,
    }),
    textEditorField({
      path: "forecast.frequency",
      section: "forecast",
      label: "预测频率",
      required: true,
      multiline: true,
    }),
    checkboxEditorField({
      path: "forecast.binding",
      section: "forecast",
      label: "预测具有约束力",
      required: true,
    }),
    textEditorField({
      path: "forecast.minimumPurchaseCommitment",
      section: "minimum-or-exclusivity",
      label: "最低采购承诺",
      required: false,
      multiline: true,
    }),
    textEditorField({
      path: "forecast.exclusivity",
      section: "minimum-or-exclusivity",
      label: "排他安排",
      required: false,
      multiline: true,
    }),
    checkboxEditorField({
      path: "riskAcknowledgements.commercialRiskConfirmed",
      section: "framework-purpose",
      label: "商业风险已确认",
      required: true,
    }),
    ...(
      [
        ["formation", "订单成立", "orders-priority"],
        ["approval", "订单审批", "orders-priority"],
        ["documentPriority", "文件优先级", "orders-priority"],
        ["moq", "最小订购量", "orders-priority"],
        ["leadTime", "交期", "orders-priority"],
        ["capacityCommitment", "产能承诺", "capacity-inventory"],
        ["inventoryPolicy", "库存政策", "capacity-inventory"],
      ] as const
    ).map(([path, label, section]) =>
      textEditorField({
        path: `ordering.${path}`,
        section,
        label,
        required: !["capacityCommitment", "inventoryPolicy"].includes(path),
        multiline: true,
      }),
    ),
    ...(
      [
        ["delivery", "交付", "delivery-acceptance"],
        ["acceptance", "验收", "delivery-acceptance"],
        ["reconciliationCycle", "对账周期", "reconciliation-payment"],
        ["invoice", "开票", "reconciliation-payment"],
        ["settlement", "结算", "reconciliation-payment"],
        ["quality", "质量", "quality-warranty"],
        ["warranty", "质保", "quality-warranty"],
        ["supplyContinuity", "连续供应", "continuity"],
        ["transitionAssistance", "过渡协助", "change-termination-transition"],
      ] as const
    ).map(([path, label, section]) =>
      textEditorField({
        path: `performance.${path}`,
        section,
        label,
        required: path !== "transitionAssistance",
        multiline: true,
      }),
    ),
    attachmentEditorField({
      path: "orderTemplateAttachmentId",
      section: "order-template",
      label: "订单模板",
      required: false,
      multiple: false,
      maxItems: 1,
      role: "supporting",
      category: "commercial",
      includeInSubmissionDefault: false,
    }),
    ...contractGeneralTermsEditorFields({ sectionFor: () => "general-terms" }),
    contractSignersEditorField({
      section: "signatures",
      partyOptions: [
        { value: "supplier", label: "供应方" },
        { value: "purchaser", label: "采购方" },
      ],
    }),
  ],
} as const satisfies TemplateDefinitionV2;

function parseFrameworkDraft(value: unknown): FrameworkSupplyContractDraftV1 {
  return FrameworkSupplyContractDraftV1Schema.parse(value) as FrameworkSupplyContractDraftV1;
}

function createFrameworkDraft(input: { readonly id: string; readonly now: string | Date }) {
  const dates = contractDates(input.now);
  const nextYear = `${Number(dates.signingDate.slice(0, 4)) + 1}${dates.signingDate.slice(4)}`;
  return parseFrameworkDraft({
    id: input.id,
    templateId: "contract.supply.framework.v1",
    templateVersion: "1.0.0",
    meta: {
      contractNumber: "待填写",
      title: "框架供应合同",
      signingDate: dates.signingDate,
      effectiveMode: "signature",
      copies: 2,
      language: "zh-CN",
      layoutStyleId: "classic-formal.v1",
    },
    supplier: { legalName: "待填写", entityType: "company", contactName: "待填写" },
    purchaser: { legalName: "待填写", entityType: "company", contactName: "待填写" },
    term: { startDate: dates.signingDate, endDate: nextYear },
    catalogLines: [
      {
        id: "catalog-1",
        name: "待填写",
        unit: "待填写",
        quantity: "1",
        unitPriceMinor: "0",
        discountBps: 0,
        taxRateBps: 0,
      },
    ],
    pricing: { priceMethod: "", adjustmentTrigger: "", adjustmentNoticeDays: 0 },
    forecast: { frequency: "", binding: false },
    riskAcknowledgements: { commercialRiskConfirmed: false },
    ordering: { formation: "", approval: "", documentPriority: "", moq: "", leadTime: "" },
    performance: {
      delivery: "",
      acceptance: "",
      reconciliationCycle: "",
      invoice: "",
      settlement: "",
      quality: "",
      warranty: "",
      supplyContinuity: "",
    },
    generalTerms: {
      noticeAddresses: "待填写",
      confidentiality: "待填写",
      forceMajeure: "待填写",
      changeControl: "待填写",
      termination: "待填写",
      breachRemedies: "待填写",
      governingLaw: "待填写",
      disputeMethod: "court",
      court: "待填写",
      severability: "待填写",
      entireAgreement: "待填写",
    },
    signers: [
      {
        partyId: "supplier",
        role: localized("供应商"),
        dateLabel: localized("日期"),
        sealLabel: localized("盖章"),
      },
      {
        partyId: "purchaser",
        role: localized("采购方"),
        dateLabel: localized("日期"),
        sealLabel: localized("盖章"),
      },
    ],
    attachments: [],
    updatedAt: dates.updatedAt,
  });
}

function analyzeFrameworkDraft(draft: FrameworkSupplyContractDraftV1): readonly RiskFindingV2[] {
  const findings: RiskFindingV2[] = [];
  const block = (missing: boolean, code: string, message: string, path: readonly string[]) => {
    if (missing) findings.push(contractFinding(code, "error", "blockSubmission", message, path));
  };
  block(!draft.pricing.currency, "CONTRACT_CURRENCY_MISSING", "必须由用户选择合同币种", [
    "pricing",
    "currency",
  ]);
  block(!draft.pricing.taxMode, "CONTRACT_TAX_MODE_MISSING", "必须由用户选择含税口径", [
    "pricing",
    "taxMode",
  ]);
  block(
    !draft.forecast.frequency.trim(),
    "FRAMEWORK_FORECAST_FREQUENCY_MISSING",
    "必须填写预测频率",
    ["forecast", "frequency"],
  );
  block(
    !draft.ordering.documentPriority.trim(),
    "FRAMEWORK_ORDER_PRIORITY_MISSING",
    "必须填写订单与框架文件优先级",
    ["ordering", "documentPriority"],
  );
  block(
    !draft.performance.supplyContinuity.trim(),
    "FRAMEWORK_CONTINUITY_MISSING",
    "必须填写连续供应安排",
    ["performance", "supplyContinuity"],
  );
  if (
    (draft.forecast.minimumPurchaseCommitment?.trim() || draft.forecast.exclusivity?.trim()) &&
    !draft.riskAcknowledgements.commercialRiskConfirmed
  ) {
    findings.push(
      contractFinding(
        "FRAMEWORK_COMMERCIAL_RISK_UNCONFIRMED",
        "warning",
        "watermark",
        "最低采购或独家安排须经用户单独确认",
        ["riskAcknowledgements", "commercialRiskConfirmed"],
      ),
    );
  }
  return freezeContractFindings(findings);
}

function text(value?: string): string {
  return value?.trim() ? value : "待填写";
}

function compileFrameworkDraft(value: unknown): DocumentModelV2 {
  const draft = parseFrameworkDraft(value);
  const findings = analyzeFrameworkDraft(draft);
  const publicAttachments = exportedAttachments(draft.attachments);
  const publicAttachmentIds = new Set(publicAttachments.map((attachment) => attachment.id));
  const calculation =
    draft.pricing.currency && draft.pricing.taxMode
      ? calculateQuoteLinesV2(
          draft.catalogLines.map((line) => ({
            id: line.id,
            quantity: line.quantity,
            unitPriceMinor: line.unitPriceMinor,
            discountBps: line.discountBps,
            taxRateBps: line.taxRateBps,
          })),
          { currency: draft.pricing.currency, taxMode: draft.pricing.taxMode },
        )
      : undefined;
  const calculated = new Map(calculation?.lines.map((line) => [line.lineId, line.totalMinor]));
  const money = (minor: string) =>
    draft.pricing.currency ? formatMoneyMinorV2(minor, draft.pricing.currency) : "待选择币种";
  const paragraph = (id: string, value: string) => ({
    type: "paragraph" as const,
    id,
    text: localized(value),
  });
  const section = (id: string, value: string) => ({ id, blocks: [paragraph(`${id}-text`, value)] });
  const sections = [
    {
      id: "cover",
      blocks: [
        {
          type: "cover" as const,
          id: "framework-cover",
          title: localized(draft.meta.title),
          subtitle: localized(draft.meta.contractNumber),
        },
      ],
    },
    {
      id: "meta",
      blocks: [
        {
          type: "keyValueGrid" as const,
          id: "framework-meta",
          entries: [
            {
              id: "number",
              label: localized("合同编号"),
              value: localized(draft.meta.contractNumber),
            },
            { id: "start", label: localized("开始日期"), value: localized(draft.term.startDate) },
            { id: "end", label: localized("结束日期"), value: localized(draft.term.endDate) },
          ],
        },
      ],
    },
    {
      id: "parties",
      blocks: [
        {
          type: "parties" as const,
          id: "framework-parties",
          parties: [
            {
              id: "supplier",
              role: localized("供应商"),
              name: localized(draft.supplier.legalName),
              details: partyDetails(draft.supplier),
            },
            {
              id: "purchaser",
              role: localized("采购方"),
              name: localized(draft.purchaser.legalName),
              details: partyDetails(draft.purchaser),
            },
          ],
        },
      ],
    },
    section(
      "framework-purpose",
      "本合同约定持续供应的一般规则；具体交易以依约成立的采购订单为准。",
    ),
    section("term", `${draft.term.startDate}至${draft.term.endDate}`),
    {
      id: "catalog-price",
      blocks: [
        {
          type: "table" as const,
          id: "catalog-table",
          columns: [
            { id: "name", label: localized("目录商品"), width: "35%", align: "left" as const },
            { id: "quantity", label: localized("参考数量"), width: "20%", align: "right" as const },
            {
              id: "unitPrice",
              label: localized("目录单价"),
              width: "20%",
              align: "right" as const,
            },
            { id: "amount", label: localized("参考金额"), width: "25%", align: "right" as const },
          ],
          rows: draft.catalogLines.map((line) => ({
            id: line.id,
            cells: {
              name: localized(line.name),
              quantity: localized(`${line.quantity} ${line.unit}`),
              unitPrice: localized(money(line.unitPriceMinor)),
              amount: localized(
                calculated.has(line.id) ? money(calculated.get(line.id) ?? "0") : "待完善计价选择",
              ),
            },
          })),
          repeatHeader: true,
          pagePolicy: { allowRowSplit: false, keepHeaderWithRows: 1 },
        },
        {
          type: "paragraph" as const,
          id: "pricing-method",
          text: localized(
            `价格机制：${text(draft.pricing.priceMethod)}；调整触发：${text(draft.pricing.adjustmentTrigger)}；提前${draft.pricing.adjustmentNoticeDays}日通知。`,
          ),
        },
        {
          type: "paragraph" as const,
          id: "pricing-tax-mode",
          text: localized(
            `币种：${draft.pricing.currency ?? "待选择"}；计税口径：${draft.pricing.taxMode ?? "待选择"}`,
          ),
        },
        {
          type: "totals" as const,
          id: "catalog-total",
          entries: [
            {
              id: "total",
              label: localized("目录参考合计"),
              value: localized(
                calculation ? money(calculation.summary.totalMinor) : "待完善计价选择",
              ),
            },
          ],
        },
      ],
    },
    section(
      "forecast",
      `${draft.forecast.frequency || "待填写"}。${draft.forecast.binding ? "双方明确约定该预测具有约束力。" : "预测和目录不当然构成采购义务。"}`,
    ),
    section(
      "minimum-or-exclusivity",
      `最低采购：${text(draft.forecast.minimumPurchaseCommitment)}；独家：${text(draft.forecast.exclusivity)}`,
    ),
    section(
      "orders-priority",
      `订单成立：${text(draft.ordering.formation)}；审批：${text(draft.ordering.approval)}；文件优先级：${text(draft.ordering.documentPriority)}`,
    ),
    section(
      "capacity-inventory",
      `MOQ：${text(draft.ordering.moq)}；交期：${text(draft.ordering.leadTime)}；产能：${text(draft.ordering.capacityCommitment)}；库存：${text(draft.ordering.inventoryPolicy)}`,
    ),
    section(
      "delivery-acceptance",
      `交付：${text(draft.performance.delivery)}；验收：${text(draft.performance.acceptance)}`,
    ),
    section(
      "reconciliation-payment",
      `对账：${text(draft.performance.reconciliationCycle)}；发票：${text(draft.performance.invoice)}；结算：${text(draft.performance.settlement)}`,
    ),
    section(
      "quality-warranty",
      `质量：${text(draft.performance.quality)}；质保：${text(draft.performance.warranty)}`,
    ),
    section("continuity", text(draft.performance.supplyContinuity)),
    section(
      "change-termination-transition",
      `变更：${draft.generalTerms.changeControl}；终止：${draft.generalTerms.termination}；过渡：${text(draft.performance.transitionAssistance)}`,
    ),
    {
      id: "general-terms",
      blocks: [
        {
          type: "list" as const,
          id: "framework-general-list",
          ordered: false,
          items: [
            localized(draft.generalTerms.confidentiality),
            localized(draft.generalTerms.forceMajeure),
            localized(draft.generalTerms.breachRemedies),
            localized(draft.generalTerms.governingLaw),
            localized(draft.generalTerms.noticeAddresses),
          ],
        },
      ],
    },
    {
      id: "order-template",
      blocks: [
        {
          type: "attachmentIndex" as const,
          id: "order-template-index",
          attachmentIds:
            draft.orderTemplateAttachmentId &&
            publicAttachmentIds.has(draft.orderTemplateAttachmentId)
              ? [draft.orderTemplateAttachmentId]
              : [],
        },
      ],
    },
    {
      id: "signatures",
      blocks: [
        {
          type: "signatureGroup" as const,
          id: "framework-signatures",
          signers: signerBlocks(draft.signers, {
            supplier: draft.supplier,
            purchaser: draft.purchaser,
          }),
        },
      ],
    },
  ];
  return DocumentModelV2Schema.parse({
    schemaVersion: "2.0.0",
    documentId: draft.id,
    template: { id: draft.templateId, version: draft.templateVersion, basisDate: "2026-08-19" },
    documentKind: "contract",
    language: "zh-CN",
    title: localized(draft.meta.title),
    pageDefaults: {
      size: "A4",
      orientation: "portrait",
      marginsMm: { top: 18, right: 20, bottom: 18, left: 20 },
    },
    sections,
    watermarks: contractWatermarks(findings),
    disclaimers: ["contract-generation-note"],
    attachmentManifest: publicAttachments,
  }) as DocumentModelV2;
}

export const FRAMEWORK_SUPPLY_CONTRACT_REGISTRATION: TemplateRegistration<
  FrameworkSupplyContractDraftV1,
  DocumentModelV2
> = Object.freeze({
  definition: FRAMEWORK_SUPPLY_CONTRACT_DEFINITION,
  parseDraft: parseFrameworkDraft,
  createDraft: createFrameworkDraft,
  createRepeatableItem(
    path: string,
    input: { readonly id: string; readonly now: string | Date; readonly draft: unknown },
  ) {
    if (path === "catalogLines") {
      return {
        id: input.id,
        name: "待填写",
        unit: "件",
        quantity: "1",
        unitPriceMinor: "0",
        discountBps: 0,
        taxRateBps: 0,
      };
    }
    if (path === "signers") {
      return {
        partyId: input.id,
        role: { zhCN: "签署方" },
        dateLabel: { zhCN: "日期" },
        sealLabel: { zhCN: "盖章" },
      };
    }
    throw new Error("不支持的重复项路径");
  },
  compile: compileFrameworkDraft,
  preflight(value: unknown) {
    return analyzeFrameworkDraft(parseFrameworkDraft(value));
  },
});
