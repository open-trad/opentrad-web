import { isolatedArraySchema } from "../../../safe-schema.js";
import { z } from "../../../zod.js";
import type { EntityPartyV2, TemplateDefinitionV2 } from "../../common.js";
import { type DocumentModelV2, DocumentModelV2Schema } from "../../document-model.js";
import {
  BasisPointsV2Schema,
  calculateQuoteLinesV2,
  formatMoneyMinorV2,
  IdentifierV2Schema,
  MoneyMinorV2Schema,
  QuantityV2Schema,
} from "../../money.js";
import type { TemplateRegistration } from "../../registry.js";
import type { RiskFindingV2 } from "../../risk.js";
import { PartyV2Schema, type QuoteMetaV2, QuoteMetaV2Schema } from "../quote-common.js";
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

export type OemChargeTypeV1 =
  | "unit-product"
  | "tooling"
  | "nre"
  | "sample"
  | "testing"
  | "packaging";

export interface OemChargeLineV1 {
  readonly id: string;
  readonly chargeType: OemChargeTypeV1;
  readonly name: string;
  readonly specification?: string;
  readonly unit: string;
  readonly quantity: string;
  readonly unitPriceMinor: string;
  readonly discountBps: number;
  readonly taxRateBps: number;
  readonly amortizationQuantity?: string;
}

export interface OemCustomQuoteDraftV1 {
  readonly id: string;
  readonly templateId: "quotation.oem.custom.v1";
  readonly templateVersion: "1.0.0";
  readonly meta: QuoteMetaV2;
  readonly seller: EntityPartyV2;
  readonly buyer: EntityPartyV2;
  readonly project: {
    readonly projectName: string;
    readonly productName: string;
    readonly customerModel?: string;
    readonly drawingVersion: string;
    readonly sampleBasis?: string;
    readonly annualForecast?: string;
    readonly moq: string;
    readonly prototypeQty?: string;
    readonly massProductionQty?: string;
    readonly buyerSuppliedMaterials: boolean;
  };
  readonly chargeLines: readonly OemChargeLineV1[];
  readonly terms: {
    readonly toolingRequired: boolean;
    readonly toolingOwnership?: string;
    readonly sampleApproval: string;
    readonly prototypeLeadTime?: string;
    readonly massProductionLeadTime: string;
    readonly qualityStandard: string;
    readonly acceptance: string;
    readonly engineeringChange: string;
    readonly packaging: string;
    readonly delivery: string;
    readonly payment: string;
    readonly warranty: string;
    readonly intellectualProperty: string;
    readonly confidentiality: string;
    readonly materialReceiptAndReturn?: string;
    readonly notes?: string;
  };
  readonly updatedAt: string;
}

const OptionalText = quoteText(10_000);
const RequiredText = quoteText(10_000, true);

const OemProjectSchema = strictQuoteObject({
  projectName: RequiredText,
  productName: RequiredText,
  customerModel: quoteText(300).optional(),
  drawingVersion: RequiredText,
  sampleBasis: OptionalText.optional(),
  annualForecast: OptionalText.optional(),
  moq: RequiredText,
  prototypeQty: OptionalText.optional(),
  massProductionQty: OptionalText.optional(),
  buyerSuppliedMaterials: z.boolean(),
});

const OemChargeLineSchema = strictQuoteObject({
  id: IdentifierV2Schema,
  chargeType: z.enum(["unit-product", "tooling", "nre", "sample", "testing", "packaging"]),
  name: quoteText(300, true),
  specification: quoteText(1_000).optional(),
  unit: quoteText(50, true),
  quantity: QuantityV2Schema,
  unitPriceMinor: MoneyMinorV2Schema,
  discountBps: BasisPointsV2Schema,
  taxRateBps: BasisPointsV2Schema,
  amortizationQuantity: QuantityV2Schema.optional(),
});

const OemChargeLinesSchema = isolatedArraySchema(OemChargeLineSchema, {
  min: 1,
  max: 100,
  refine: (lines, addIssue) => {
    const seen = new Set<string>();
    lines.forEach((line, index) => {
      if (seen.has(line.id)) {
        addIssue({
          code: "custom",
          message: "Charge-line ids must be unique",
          path: [index, "id"],
        });
      }
      seen.add(line.id);
    });
  },
});

const OemTermsSchema = strictQuoteObject({
  toolingRequired: z.boolean(),
  toolingOwnership: OptionalText.optional(),
  sampleApproval: RequiredText,
  prototypeLeadTime: OptionalText.optional(),
  massProductionLeadTime: RequiredText,
  qualityStandard: RequiredText,
  acceptance: RequiredText,
  engineeringChange: OptionalText,
  packaging: RequiredText,
  delivery: RequiredText,
  payment: RequiredText,
  warranty: RequiredText,
  intellectualProperty: OptionalText,
  confidentiality: RequiredText,
  materialReceiptAndReturn: OptionalText.optional(),
  notes: OptionalText.optional(),
});

const OemCustomQuoteDraftRawSchema = strictQuoteObject({
  id: IdentifierV2Schema,
  templateId: z.literal("quotation.oem.custom.v1"),
  templateVersion: z.literal("1.0.0"),
  meta: QuoteMetaV2Schema,
  seller: PartyV2Schema,
  buyer: PartyV2Schema,
  project: OemProjectSchema,
  chargeLines: OemChargeLinesSchema,
  terms: OemTermsSchema,
  updatedAt: IsoInstantV2RawSchema,
});

export const OemCustomQuoteDraftV1Schema = frozenQuoteSchema(OemCustomQuoteDraftRawSchema, {
  arrayLimits: { chargeLines: 100 },
});

export const OEM_CUSTOM_QUOTE_DEFINITION = {
  id: "quotation.oem.custom.v1",
  version: "1.0.0",
  category: "quotation",
  name: "OEM 定制报价单",
  summary: "覆盖量产单价、模具/NRE、来料、样品、质量与工程变更的定制报价",
  basisDate: "2026-08-19",
  languages: ["zh-CN", "en-US", "zh-en"],
  defaultLanguage: "zh-CN",
  allowedLayouts: ["modern-business.v1", "classic-formal.v1"],
  defaultLayout: "modern-business.v1",
  supportedOutputs: ["docx", "pdf", "json", "opentrad"],
  sourceKeys: ["samr-contract-library", "prc-civil-code"],
  disclaimerProfile: "quotation",
  fieldManifest: [
    {
      path: "project.projectName",
      section: "oem-basis",
      label: "项目名称",
      control: "text",
      required: true,
    },
    {
      path: "chargeLines",
      section: "charge-lines",
      label: "费用项目",
      control: "repeatable",
      required: true,
    },
    {
      path: "terms.toolingRequired",
      section: "tooling",
      label: "是否需要模具",
      control: "checkbox",
      required: true,
    },
    {
      path: "project.buyerSuppliedMaterials",
      section: "materials",
      label: "是否买方来料",
      control: "checkbox",
      required: true,
    },
  ],
} as const satisfies TemplateDefinitionV2;

function parseOemDraft(value: unknown): OemCustomQuoteDraftV1 {
  return OemCustomQuoteDraftV1Schema.parse(value) as OemCustomQuoteDraftV1;
}

function createOemDraft(input: {
  readonly id: string;
  readonly now: string | Date;
}): OemCustomQuoteDraftV1 {
  const dates = utcDraftDates(input.now);
  return parseOemDraft({
    id: input.id,
    templateId: "quotation.oem.custom.v1",
    templateVersion: "1.0.0",
    meta: {
      number: "待填写",
      title: "OEM 定制报价单",
      issueDate: dates.issueDate,
      validUntil: dates.validUntil,
      currency: "CNY",
      taxMode: "tax-excluded",
      quoteNature: "invitation",
      language: "zh-CN",
      layoutStyleId: "modern-business.v1",
    },
    seller: { legalName: "待填写", entityType: "company", contactName: "待填写" },
    buyer: { legalName: "待填写", entityType: "company", contactName: "待填写" },
    project: {
      projectName: "待填写",
      productName: "待填写",
      drawingVersion: "待填写",
      moq: "待填写",
      buyerSuppliedMaterials: false,
    },
    chargeLines: [
      {
        id: "charge-1",
        chargeType: "unit-product",
        name: "待填写",
        unit: "件",
        quantity: "1",
        unitPriceMinor: "0",
        discountBps: 0,
        taxRateBps: 0,
      },
    ],
    terms: {
      toolingRequired: false,
      sampleApproval: "待填写",
      massProductionLeadTime: "待填写",
      qualityStandard: "待填写",
      acceptance: "待填写",
      engineeringChange: "",
      packaging: "待填写",
      delivery: "待填写",
      payment: "待填写",
      warranty: "待填写",
      intellectualProperty: "",
      confidentiality: "待填写",
    },
    updatedAt: dates.updatedAt,
  });
}

function analyzeOemDraft(draft: OemCustomQuoteDraftV1): readonly RiskFindingV2[] {
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
  }
  const hasToolingLine = draft.chargeLines.some((line) => line.chargeType === "tooling");
  const hasOwnershipLine = draft.chargeLines.some(
    (line) => line.chargeType === "tooling" || line.chargeType === "nre",
  );
  if (draft.terms.toolingRequired !== hasToolingLine) {
    findings.push(
      finding(
        "OEM_TOOLING_FLAG_INCONSISTENT",
        "error",
        "blockSubmission",
        "模具需求标志与模具费用行不一致",
        ["terms", "toolingRequired"],
      ),
    );
  }
  if (hasOwnershipLine && !draft.terms.toolingOwnership?.trim()) {
    findings.push(
      finding(
        "OEM_TOOLING_OWNERSHIP_MISSING",
        "error",
        "blockSubmission",
        "模具或 NRE 费用必须约定成果和工装归属",
        ["terms", "toolingOwnership"],
      ),
    );
  }
  if (draft.project.buyerSuppliedMaterials && !draft.terms.materialReceiptAndReturn?.trim()) {
    findings.push(
      finding(
        "OEM_BUYER_MATERIAL_TERMS_MISSING",
        "error",
        "blockSubmission",
        "买方来料必须约定收料、损耗、余料和不良料退还",
        ["terms", "materialReceiptAndReturn"],
      ),
    );
  }
  if (!draft.terms.intellectualProperty.trim()) {
    findings.push(
      finding("OEM_IP_TERMS_MISSING", "warning", "watermark", "尚未约定知识产权归属", [
        "terms",
        "intellectualProperty",
      ]),
    );
  }
  if (!draft.terms.engineeringChange.trim()) {
    findings.push(
      finding("OEM_CHANGE_CONTROL_MISSING", "warning", "watermark", "尚未约定工程变更控制", [
        "terms",
        "engineeringChange",
      ]),
    );
  }
  return freezeFindings(findings);
}

function compileOemDraft(value: unknown): DocumentModelV2 {
  const draft = parseOemDraft(value);
  const analysis = analyzeOemDraft(draft);
  const calculation = calculateQuoteLinesV2(
    draft.chargeLines.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      discountBps: line.discountBps,
      taxRateBps: line.taxRateBps,
    })),
    { currency: draft.meta.currency, taxMode: draft.meta.taxMode },
  );
  const amountByLine = new Map(calculation.lines.map((line) => [line.lineId, line]));
  const grid = (id: string, entries: Array<{ id: string; label: string; value: string }>) => ({
    type: "keyValueGrid" as const,
    id,
    entries: entries.map((entry) => ({
      id: entry.id,
      label: localized(entry.label),
      value: localized(entry.value || "未约定"),
    })),
  });
  const sections = [
    {
      id: "title",
      blocks: [
        {
          type: "cover" as const,
          id: "oem-title-cover",
          title: localized(draft.meta.title, draft.meta.englishTitle),
          subtitle: localized(draft.project.projectName),
        },
      ],
    },
    {
      id: "quote-meta",
      blocks: [
        grid("oem-meta-grid", [
          { id: "number", label: "报价编号", value: draft.meta.number },
          { id: "issue", label: "报价日期", value: draft.meta.issueDate },
          { id: "valid", label: "有效期至", value: draft.meta.validUntil },
          { id: "currency", label: "币种", value: draft.meta.currency },
        ]),
      ],
    },
    {
      id: "parties",
      blocks: [
        {
          type: "parties" as const,
          id: "oem-parties-block",
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
      id: "oem-basis",
      blocks: [
        grid("oem-basis-grid", [
          { id: "project", label: "项目名称", value: draft.project.projectName },
          { id: "product", label: "产品名称", value: draft.project.productName },
          { id: "model", label: "客户型号", value: draft.project.customerModel || "未提供" },
          { id: "forecast", label: "年度预测", value: draft.project.annualForecast || "未提供" },
          { id: "moq", label: "最小起订量", value: draft.project.moq },
        ]),
      ],
    },
    {
      id: "technical-basis",
      blocks: [
        grid("oem-technical-grid", [
          { id: "drawing", label: "图纸版本", value: draft.project.drawingVersion },
          { id: "sample", label: "样品依据", value: draft.project.sampleBasis || "未约定" },
        ]),
      ],
    },
    {
      id: "charge-lines",
      blocks: [
        {
          type: "table" as const,
          id: "oem-charge-table",
          columns: [
            { id: "type", label: localized("费用类型"), width: "16%", align: "left" as const },
            { id: "name", label: localized("名称"), width: "24%", align: "left" as const },
            { id: "spec", label: localized("规格"), width: "20%", align: "left" as const },
            { id: "quantity", label: localized("数量"), width: "12%", align: "right" as const },
            { id: "unitPrice", label: localized("单价"), width: "14%", align: "right" as const },
            { id: "total", label: localized("含税合计"), width: "14%", align: "right" as const },
          ],
          rows: draft.chargeLines.map((line) => ({
            id: line.id,
            cells: {
              type: localized(line.chargeType),
              name: localized(line.name),
              spec: localized(line.specification || "未提供"),
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
      id: "totals",
      blocks: [
        {
          type: "totals" as const,
          id: "oem-totals",
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
      id: "sample-and-leadtime",
      blocks: [
        grid("oem-sample-grid", [
          { id: "approval", label: "样品确认", value: draft.terms.sampleApproval },
          { id: "prototype", label: "试制周期", value: draft.terms.prototypeLeadTime || "未约定" },
          { id: "production", label: "量产周期", value: draft.terms.massProductionLeadTime },
        ]),
      ],
    },
    {
      id: "tooling",
      blocks: [
        grid("oem-tooling-grid", [
          {
            id: "required",
            label: "需要模具/工装",
            value: draft.terms.toolingRequired ? "是" : "否",
          },
          {
            id: "ownership",
            label: "模具/NRE 归属",
            value: draft.terms.toolingOwnership || "未约定",
          },
        ]),
      ],
    },
    {
      id: "materials",
      blocks: [
        grid("oem-material-grid", [
          {
            id: "supplied",
            label: "买方来料",
            value: draft.project.buyerSuppliedMaterials ? "是" : "否",
          },
          {
            id: "receipt-return",
            label: "收料与退料",
            value: draft.terms.materialReceiptAndReturn || "未约定",
          },
        ]),
      ],
    },
    {
      id: "quality-acceptance",
      blocks: [
        grid("oem-quality-grid", [
          { id: "standard", label: "质量标准", value: draft.terms.qualityStandard },
          { id: "acceptance", label: "验收", value: draft.terms.acceptance },
        ]),
      ],
    },
    {
      id: "change-ip-confidentiality",
      blocks: [
        grid("oem-rights-grid", [
          { id: "change", label: "工程变更", value: draft.terms.engineeringChange || "未约定" },
          { id: "ip", label: "知识产权", value: draft.terms.intellectualProperty || "未约定" },
          { id: "confidentiality", label: "保密", value: draft.terms.confidentiality },
        ]),
      ],
    },
    {
      id: "delivery-payment-warranty",
      blocks: [
        grid("oem-commercial-grid", [
          { id: "packaging", label: "包装", value: draft.terms.packaging },
          { id: "delivery", label: "交付", value: draft.terms.delivery },
          { id: "payment", label: "付款", value: draft.terms.payment },
          { id: "warranty", label: "质保", value: draft.terms.warranty },
        ]),
      ],
    },
    {
      id: "quote-notice",
      blocks: [
        {
          type: "notice" as const,
          id: "oem-notice",
          tone: "info" as const,
          paragraphs: [
            localized(
              draft.terms.notes || "预测和目录不当然构成采购义务，最终以双方正式订单或合同为准。",
            ),
          ],
        },
      ],
    },
    {
      id: "signature",
      blocks: [
        {
          type: "signatureGroup" as const,
          id: "oem-signatures",
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
    template: { id: draft.templateId, version: draft.templateVersion, basisDate: "2026-08-19" },
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

export const OEM_CUSTOM_QUOTE_REGISTRATION: TemplateRegistration<unknown, DocumentModelV2> =
  Object.freeze({
    definition: OEM_CUSTOM_QUOTE_DEFINITION,
    parseDraft: parseOemDraft,
    createDraft: createOemDraft,
    compile: compileOemDraft,
    preflight(value: unknown) {
      return analyzeOemDraft(parseOemDraft(value));
    },
  });
