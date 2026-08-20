import { isolatedArraySchema } from "../../../safe-schema.js";
import { z } from "../../../zod.js";
import type { LocalizedText, TemplateDefinitionV2 } from "../../common.js";
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
import {
  bilingualPartyEditorFields,
  checkboxEditorField,
  INCOTERMS_OPTIONS,
  itemMoneyField,
  itemNumberField,
  itemPercentField,
  itemTextField,
  LANGUAGE_PRIORITY_OPTIONS,
  quoteMetaEditorFields,
  repeatableEditorField,
  selectEditorField,
  TRANSPORT_MODE_OPTIONS,
  textEditorField,
} from "../editor-manifest.js";
import {
  HsCodeUserSuppliedV2Schema,
  IncotermsRuleV2Schema,
  type QuoteMetaV2,
  QuoteMetaV2Schema,
  WeightKgV2Schema,
} from "../quote-common.js";
import {
  finding,
  findingsWatermark,
  freezeFindings,
  frozenQuoteSchema,
  hasPlaceholder,
  IsoInstantV2RawSchema,
  localized,
  quoteText,
  strictQuoteObject,
  utcDraftDates,
} from "./shared.js";

export interface BilingualExportPartyV1 {
  readonly legalName: LocalizedText & { readonly enUS: string };
  readonly entityType: "company" | "organization" | "individual";
  readonly registrationId?: string;
  readonly registeredAddress?: LocalizedText & { readonly enUS: string };
  readonly contactName: LocalizedText & { readonly enUS: string };
  readonly phone?: string;
  readonly email?: string;
}

export interface BilingualExportGoodsLineV1 {
  readonly id: string;
  readonly name: LocalizedText & { readonly enUS: string };
  readonly sku?: string;
  readonly specification?: LocalizedText & { readonly enUS: string };
  readonly description?: LocalizedText & { readonly enUS: string };
  readonly unit: LocalizedText & { readonly enUS: string };
  readonly quantity: string;
  readonly unitPriceMinor: string;
  readonly discountBps: number;
  readonly taxRateBps: number;
  readonly countryOfOrigin?: LocalizedText & { readonly enUS: string };
  readonly hsCodeUserSupplied?: string;
  readonly netWeightKg?: string;
  readonly grossWeightKg?: string;
}

export interface ExportBilingualQuoteDraftV1 {
  readonly id: string;
  readonly templateId: "quotation.export.bilingual.v1";
  readonly templateVersion: "1.0.0";
  readonly meta: QuoteMetaV2 & {
    readonly currency: "USD";
    readonly language: "zh-en";
    readonly layoutStyleId: "international-compact.v1";
  };
  readonly seller: BilingualExportPartyV1;
  readonly buyer: BilingualExportPartyV1;
  readonly buyerReference?: LocalizedText & { readonly enUS: string };
  readonly goodsLines: readonly BilingualExportGoodsLineV1[];
  readonly trade: {
    readonly incotermsRule?:
      | "EXW"
      | "FCA"
      | "CPT"
      | "CIP"
      | "DAP"
      | "DPU"
      | "DDP"
      | "FAS"
      | "FOB"
      | "CFR"
      | "CIF";
    readonly namedPlace?: LocalizedText & { readonly enUS: string };
    readonly incotermsEdition: "2020";
    readonly transportMode: "air" | "road" | "rail" | "sea" | "multimodal";
    readonly originCountry: LocalizedText & { readonly enUS: string };
    readonly destinationCountry: LocalizedText & { readonly enUS: string };
    readonly portOfLoading?: LocalizedText & { readonly enUS: string };
    readonly portOfDischarge?: LocalizedText & { readonly enUS: string };
    readonly shipmentWindow: LocalizedText & { readonly enUS: string };
    readonly partialShipment: boolean;
    readonly transshipment: boolean;
    readonly exportPackaging: LocalizedText & { readonly enUS: string };
    readonly paymentMethod: LocalizedText & { readonly enUS: string };
    readonly bankCharges: LocalizedText & { readonly enUS: string };
    readonly insuranceArrangement?: LocalizedText & { readonly enUS: string };
    readonly inspection: LocalizedText & { readonly enUS: string };
    readonly documentList: readonly (LocalizedText & { readonly enUS: string })[];
    readonly languagePriority?: "zh-CN" | "en-US";
    readonly notes?: LocalizedText & { readonly enUS: string };
  };
  readonly updatedAt: string;
}

const BilingualTextSchema = strictQuoteObject({
  zhCN: quoteText(10_000, true),
  enUS: quoteText(10_000, true),
});

const BilingualPartySchema = strictQuoteObject({
  legalName: BilingualTextSchema,
  entityType: z.enum(["company", "organization", "individual"]),
  registrationId: quoteText(100).optional(),
  registeredAddress: BilingualTextSchema.optional(),
  contactName: BilingualTextSchema,
  phone: quoteText(50).optional(),
  email: quoteText(254).optional(),
});

const BilingualGoodsLineSchema = strictQuoteObject({
  id: IdentifierV2Schema,
  name: BilingualTextSchema,
  sku: quoteText(100).optional(),
  specification: BilingualTextSchema.optional(),
  description: BilingualTextSchema.optional(),
  unit: BilingualTextSchema,
  quantity: QuantityV2Schema,
  unitPriceMinor: MoneyMinorV2Schema,
  discountBps: BasisPointsV2Schema,
  taxRateBps: BasisPointsV2Schema,
  countryOfOrigin: BilingualTextSchema.optional(),
  hsCodeUserSupplied: HsCodeUserSuppliedV2Schema.optional(),
  netWeightKg: WeightKgV2Schema.optional(),
  grossWeightKg: WeightKgV2Schema.optional(),
});

const BilingualGoodsLinesSchema = isolatedArraySchema(BilingualGoodsLineSchema, {
  min: 1,
  max: 100,
  refine: (lines, addIssue) => {
    const seen = new Set<string>();
    lines.forEach((line, index) => {
      if (seen.has(line.id)) {
        addIssue({ code: "custom", message: "Goods-line ids must be unique", path: [index, "id"] });
      }
      seen.add(line.id);
    });
  },
});

const TradeSchema = strictQuoteObject({
  incotermsRule: IncotermsRuleV2Schema.optional(),
  namedPlace: BilingualTextSchema.optional(),
  incotermsEdition: z.literal("2020"),
  transportMode: z.enum(["air", "road", "rail", "sea", "multimodal"]),
  originCountry: BilingualTextSchema,
  destinationCountry: BilingualTextSchema,
  portOfLoading: BilingualTextSchema.optional(),
  portOfDischarge: BilingualTextSchema.optional(),
  shipmentWindow: BilingualTextSchema,
  partialShipment: z.boolean(),
  transshipment: z.boolean(),
  exportPackaging: BilingualTextSchema,
  paymentMethod: BilingualTextSchema,
  bankCharges: BilingualTextSchema,
  insuranceArrangement: BilingualTextSchema.optional(),
  inspection: BilingualTextSchema,
  documentList: isolatedArraySchema(BilingualTextSchema, { min: 1, max: 100 }),
  languagePriority: z.enum(["zh-CN", "en-US"]).optional(),
  notes: BilingualTextSchema.optional(),
});

const ExportBilingualQuoteDraftRawSchema = strictQuoteObject(
  {
    id: IdentifierV2Schema,
    templateId: z.literal("quotation.export.bilingual.v1"),
    templateVersion: z.literal("1.0.0"),
    meta: QuoteMetaV2Schema,
    seller: BilingualPartySchema,
    buyer: BilingualPartySchema,
    buyerReference: BilingualTextSchema.optional(),
    goodsLines: BilingualGoodsLinesSchema,
    trade: TradeSchema,
    updatedAt: IsoInstantV2RawSchema,
  },
  (draft, addIssue) => {
    if (draft.meta.currency !== "USD") {
      addIssue({
        code: "custom",
        message: "Export quotation currency must be USD",
        path: ["meta", "currency"],
      });
    }
    if (draft.meta.language !== "zh-en") {
      addIssue({
        code: "custom",
        message: "Export quotation must be bilingual",
        path: ["meta", "language"],
      });
    }
    if (draft.meta.layoutStyleId !== "international-compact.v1") {
      addIssue({
        code: "custom",
        message: "Export quotation must use the international layout",
        path: ["meta", "layoutStyleId"],
      });
    }
  },
);

export const ExportBilingualQuoteDraftV1Schema = frozenQuoteSchema(
  ExportBilingualQuoteDraftRawSchema,
  { arrayLimits: { goodsLines: 100, documentList: 100 } },
);

export const EXPORT_BILINGUAL_QUOTE_DEFINITION = {
  id: "quotation.export.bilingual.v1",
  version: "1.0.0",
  category: "quotation",
  name: "中英双语出口报价单",
  summary: "由用户分别提供中英文商业信息，并显式选择 Incoterms 2020 条件的出口报价",
  basisDate: "2026-08-19",
  languages: ["zh-en"],
  defaultLanguage: "zh-en",
  allowedLayouts: ["international-compact.v1"],
  defaultLayout: "international-compact.v1",
  supportedOutputs: ["docx", "pdf", "json", "opentrad"],
  sourceKeys: ["icc-incoterms-2020", "prc-civil-code"],
  disclaimerProfile: "international",
  fieldManifest: [
    ...quoteMetaEditorFields({ section: "quote-meta", includeCurrency: false, bilingual: true }),
    ...bilingualPartyEditorFields({
      prefix: "seller",
      section: "bilingual-parties",
      label: "卖方",
    }),
    ...bilingualPartyEditorFields({ prefix: "buyer", section: "bilingual-parties", label: "买方" }),
    textEditorField({
      path: "buyerReference",
      section: "quote-meta",
      label: "买方参考",
      required: false,
      localized: true,
    }),
    repeatableEditorField({
      path: "goodsLines",
      section: "goods-table",
      label: "双语货品",
      required: true,
      minItems: 1,
      maxItems: 100,
      item: {
        kind: "object",
        idPath: "id",
        fields: [
          itemTextField({ path: "name", label: "货品名称", required: true, localized: true }),
          itemTextField({ path: "sku", label: "SKU", required: false }),
          itemTextField({ path: "specification", label: "规格", required: false, localized: true }),
          itemTextField({
            path: "description",
            label: "描述",
            required: false,
            localized: true,
            multiline: true,
          }),
          itemTextField({ path: "unit", label: "单位", required: true, localized: true }),
          itemNumberField({ path: "quantity", label: "数量", required: true }),
          itemMoneyField("unitPriceMinor", "单价", true),
          itemPercentField("discountBps", "折扣", true),
          itemPercentField("taxRateBps", "税率", true),
          itemTextField({
            path: "countryOfOrigin",
            label: "原产国",
            required: false,
            localized: true,
          }),
          itemTextField({ path: "hsCodeUserSupplied", label: "HS编码", required: false }),
          itemNumberField({ path: "netWeightKg", label: "净重kg", required: false }),
          itemNumberField({ path: "grossWeightKg", label: "毛重kg", required: false }),
        ],
      },
    }),
    selectEditorField({
      path: "trade.incotermsRule",
      section: "trade-term",
      label: "Incoterms 规则",
      required: false,
      options: INCOTERMS_OPTIONS,
    }),
    textEditorField({
      path: "trade.namedPlace",
      section: "trade-term",
      label: "指定地点",
      required: false,
      localized: true,
    }),
    selectEditorField({
      path: "trade.transportMode",
      section: "transport-shipment",
      label: "运输方式",
      required: true,
      options: TRANSPORT_MODE_OPTIONS,
    }),
    textEditorField({
      path: "trade.originCountry",
      section: "transport-shipment",
      label: "原产国",
      required: true,
      localized: true,
    }),
    textEditorField({
      path: "trade.destinationCountry",
      section: "transport-shipment",
      label: "目的国",
      required: true,
      localized: true,
    }),
    textEditorField({
      path: "trade.portOfLoading",
      section: "transport-shipment",
      label: "装运港",
      required: false,
      localized: true,
    }),
    textEditorField({
      path: "trade.portOfDischarge",
      section: "transport-shipment",
      label: "卸货港",
      required: false,
      localized: true,
    }),
    textEditorField({
      path: "trade.shipmentWindow",
      section: "transport-shipment",
      label: "装运期",
      required: true,
      localized: true,
    }),
    checkboxEditorField({
      path: "trade.partialShipment",
      section: "transport-shipment",
      label: "允许分批装运",
      required: true,
    }),
    checkboxEditorField({
      path: "trade.transshipment",
      section: "transport-shipment",
      label: "允许转运",
      required: true,
    }),
    textEditorField({
      path: "trade.exportPackaging",
      section: "packaging-inspection",
      label: "出口包装",
      required: true,
      localized: true,
      multiline: true,
    }),
    textEditorField({
      path: "trade.paymentMethod",
      section: "payment-bank-charges",
      label: "付款方式",
      required: true,
      localized: true,
      multiline: true,
    }),
    textEditorField({
      path: "trade.bankCharges",
      section: "payment-bank-charges",
      label: "银行费用",
      required: true,
      localized: true,
      multiline: true,
    }),
    textEditorField({
      path: "trade.insuranceArrangement",
      section: "packaging-inspection",
      label: "保险安排",
      required: false,
      localized: true,
      multiline: true,
    }),
    textEditorField({
      path: "trade.inspection",
      section: "packaging-inspection",
      label: "检验",
      required: true,
      localized: true,
      multiline: true,
    }),
    repeatableEditorField({
      path: "trade.documentList",
      section: "document-list",
      label: "单据清单",
      required: true,
      minItems: 1,
      maxItems: 100,
      item: {
        kind: "object",
        fields: [
          itemTextField({ path: "zhCN", label: "中文单据", required: true }),
          itemTextField({ path: "enUS", label: "英文单据", required: true }),
        ],
      },
    }),
    selectEditorField({
      path: "trade.languagePriority",
      section: "language-priority",
      label: "语言优先",
      required: false,
      options: LANGUAGE_PRIORITY_OPTIONS,
    }),
    textEditorField({
      path: "trade.notes",
      section: "incoterms-notice",
      label: "备注",
      required: false,
      localized: true,
      multiline: true,
    }),
  ],
} as const satisfies TemplateDefinitionV2;

function parseExportDraft(value: unknown): ExportBilingualQuoteDraftV1 {
  return ExportBilingualQuoteDraftV1Schema.parse(value) as ExportBilingualQuoteDraftV1;
}

function bi(zhCN: string, enUS: string) {
  return { zhCN, enUS };
}

function createExportDraft(input: {
  readonly id: string;
  readonly now: string | Date;
}): ExportBilingualQuoteDraftV1 {
  const dates = utcDraftDates(input.now);
  return parseExportDraft({
    id: input.id,
    templateId: "quotation.export.bilingual.v1",
    templateVersion: "1.0.0",
    meta: {
      number: "待填写",
      title: "双语出口报价单",
      englishTitle: "Bilingual Export Quotation",
      issueDate: dates.issueDate,
      validUntil: dates.validUntil,
      currency: "USD",
      taxMode: "tax-exempt",
      quoteNature: "invitation",
      language: "zh-en",
      layoutStyleId: "international-compact.v1",
    },
    seller: {
      legalName: bi("待填写", "TBD"),
      entityType: "company",
      contactName: bi("待填写", "TBD"),
    },
    buyer: {
      legalName: bi("待填写", "TBD"),
      entityType: "company",
      contactName: bi("待填写", "TBD"),
    },
    goodsLines: [
      {
        id: "goods-1",
        name: bi("待填写", "TBD"),
        unit: bi("件", "pcs"),
        quantity: "1",
        unitPriceMinor: "0",
        discountBps: 0,
        taxRateBps: 0,
      },
    ],
    trade: {
      incotermsEdition: "2020",
      transportMode: "multimodal",
      originCountry: bi("待填写", "TBD"),
      destinationCountry: bi("待填写", "TBD"),
      shipmentWindow: bi("待填写", "TBD"),
      partialShipment: false,
      transshipment: false,
      exportPackaging: bi("待填写", "TBD"),
      paymentMethod: bi("待填写", "TBD"),
      bankCharges: bi("待填写", "TBD"),
      inspection: bi("待填写", "TBD"),
      documentList: [bi("待填写", "TBD")],
    },
    updatedAt: dates.updatedAt,
  });
}

const SEA_ONLY_RULES = new Set(["FAS", "FOB", "CFR", "CIF"]);

export function analyzeExportTradeDraft(
  draft: ExportBilingualQuoteDraftV1,
): readonly RiskFindingV2[] {
  const findings: RiskFindingV2[] = [];
  if (hasPlaceholder(draft)) {
    findings.push(
      finding(
        "QUOTE_UNRESOLVED_PLACEHOLDER",
        "error",
        "watermark",
        "报价单仍包含未解决的双语占位内容",
      ),
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
  if (!draft.trade.incotermsRule || !draft.trade.namedPlace) {
    findings.push(
      finding(
        "INCOTERMS_SELECTION_MISSING",
        "error",
        "blockSubmission",
        "必须由用户选择 Incoterms 2020 规则并填写指定地点",
        ["trade", "incotermsRule"],
      ),
    );
  }
  const rule = draft.trade.incotermsRule;
  if ((rule === "CIF" || rule === "CIP") && !draft.trade.insuranceArrangement) {
    findings.push(
      finding(
        "INCOTERMS_CIF_CIP_INSURANCE_MISSING",
        "error",
        "blockSubmission",
        "CIF/CIP 必须明确保险安排",
        ["trade", "insuranceArrangement"],
      ),
    );
  }
  if (rule && SEA_ONLY_RULES.has(rule) && draft.trade.transportMode !== "sea") {
    findings.push(
      finding(
        "INCOTERMS_SEA_MODE_REQUIRED",
        "error",
        "blockSubmission",
        "FAS/FOB/CFR/CIF 仅适用于海运或内河运输",
        ["trade", "transportMode"],
      ),
    );
  }
  if (
    rule &&
    SEA_ONLY_RULES.has(rule) &&
    (!draft.trade.portOfLoading || !draft.trade.portOfDischarge)
  ) {
    findings.push(
      finding(
        "INCOTERMS_PORT_MISSING",
        "error",
        "blockSubmission",
        "海运规则必须明确装运港和卸货港",
        ["trade"],
      ),
    );
  }
  if (rule === "EXW") {
    findings.push(
      finding(
        "INCOTERMS_EXW_CLEARANCE_ADVISORY",
        "warning",
        "advisory",
        "EXW 下买方通常承担出口清关安排，应确认是否可行",
        ["trade", "incotermsRule"],
      ),
    );
  }
  if (rule === "DDP") {
    findings.push(
      finding(
        "INCOTERMS_DDP_IMPORT_ADVISORY",
        "warning",
        "advisory",
        "DDP 下卖方承担进口相关义务，应确认当地合规能力",
        ["trade", "incotermsRule"],
      ),
    );
  }
  if (draft.goodsLines.some((line) => line.hsCodeUserSupplied !== undefined)) {
    findings.push(
      finding(
        "HS_CODE_USER_SUPPLIED_UNVERIFIED",
        "warning",
        "advisory",
        "HS 编码由用户提供，系统未验证归类",
        ["goodsLines"],
      ),
    );
  }
  if (!draft.trade.languagePriority) {
    findings.push(
      finding(
        "LANGUAGE_PRIORITY_MISSING",
        "error",
        "blockSubmission",
        "必须由用户选择中英文冲突时的优先语言",
        ["trade", "languagePriority"],
      ),
    );
  }
  return freezeFindings(findings);
}

function compileExportDraft(value: unknown): DocumentModelV2 {
  const draft = parseExportDraft(value);
  const findings = analyzeExportTradeDraft(draft);
  const calculation = calculateQuoteLinesV2(
    draft.goodsLines.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      discountBps: line.discountBps,
      taxRateBps: line.taxRateBps,
    })),
    { currency: "USD", taxMode: draft.meta.taxMode },
  );
  const amountByLine = new Map(calculation.lines.map((line) => [line.lineId, line]));
  const grid = (
    id: string,
    entries: Array<{ id: string; label: LocalizedText; value: LocalizedText }>,
  ) => ({
    type: "keyValueGrid" as const,
    id,
    entries,
  });
  const sections = [
    {
      id: "bilingual-title",
      blocks: [
        {
          type: "cover" as const,
          id: "export-title-cover",
          title: localized(draft.meta.title, draft.meta.englishTitle),
          subtitle: bi("出口报价", "EXPORT QUOTATION"),
        },
      ],
    },
    {
      id: "quote-meta",
      blocks: [
        grid("export-meta-grid", [
          {
            id: "number",
            label: bi("报价编号", "Quotation No."),
            value: bi(draft.meta.number, draft.meta.number),
          },
          {
            id: "issue",
            label: bi("报价日期", "Issue Date"),
            value: bi(draft.meta.issueDate, draft.meta.issueDate),
          },
          {
            id: "valid",
            label: bi("有效期至", "Valid Until"),
            value: bi(draft.meta.validUntil, draft.meta.validUntil),
          },
          { id: "currency", label: bi("币种", "Currency"), value: bi("美元", "USD") },
        ]),
      ],
    },
    {
      id: "bilingual-parties",
      blocks: [
        {
          type: "parties" as const,
          id: "export-parties",
          parties: [
            {
              id: "seller",
              role: bi("卖方", "Seller"),
              name: draft.seller.legalName,
              details: [
                draft.seller.registeredAddress ?? bi("地址未提供", "Address not provided"),
                draft.seller.contactName,
              ],
            },
            {
              id: "buyer",
              role: bi("买方", "Buyer"),
              name: draft.buyer.legalName,
              details: [
                draft.buyer.registeredAddress ?? bi("地址未提供", "Address not provided"),
                draft.buyer.contactName,
              ],
            },
          ],
        },
      ],
    },
    {
      id: "goods-table",
      blocks: [
        {
          type: "table" as const,
          id: "export-goods-table",
          columns: [
            { id: "name", label: bi("货品", "Goods"), width: "27%", align: "left" as const },
            {
              id: "spec",
              label: bi("规格", "Specification"),
              width: "23%",
              align: "left" as const,
            },
            {
              id: "quantity",
              label: bi("数量", "Quantity"),
              width: "15%",
              align: "right" as const,
            },
            {
              id: "unitPrice",
              label: bi("单价", "Unit Price"),
              width: "17%",
              align: "right" as const,
            },
            { id: "total", label: bi("金额", "Amount"), width: "18%", align: "right" as const },
          ],
          rows: draft.goodsLines.map((line) => ({
            id: line.id,
            cells: {
              name: line.name,
              spec: line.specification ?? bi("未提供", "Not provided"),
              quantity: bi(
                `${line.quantity} ${line.unit.zhCN}`,
                `${line.quantity} ${line.unit.enUS}`,
              ),
              unitPrice: bi(
                formatMoneyMinorV2(line.unitPriceMinor, "USD"),
                formatMoneyMinorV2(line.unitPriceMinor, "USD"),
              ),
              total: bi(
                formatMoneyMinorV2(amountByLine.get(line.id)?.totalMinor ?? "0", "USD"),
                formatMoneyMinorV2(amountByLine.get(line.id)?.totalMinor ?? "0", "USD"),
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
          id: "export-totals",
          entries: [
            {
              id: "subtotal",
              label: bi("小计", "Subtotal"),
              value: bi(
                formatMoneyMinorV2(calculation.summary.subtotalMinor, "USD"),
                formatMoneyMinorV2(calculation.summary.subtotalMinor, "USD"),
              ),
            },
            {
              id: "tax",
              label: bi("税额", "Tax"),
              value: bi(
                formatMoneyMinorV2(calculation.summary.taxMinor, "USD"),
                formatMoneyMinorV2(calculation.summary.taxMinor, "USD"),
              ),
            },
            {
              id: "total",
              label: bi("总额", "Total"),
              value: bi(
                formatMoneyMinorV2(calculation.summary.totalMinor, "USD"),
                formatMoneyMinorV2(calculation.summary.totalMinor, "USD"),
              ),
            },
          ],
        },
      ],
    },
    {
      id: "trade-term",
      blocks: [
        grid("export-trade-grid", [
          {
            id: "rule",
            label: bi("贸易术语", "Trade Term"),
            value: bi(
              draft.trade.incotermsRule ?? "未选择",
              draft.trade.incotermsRule ?? "Not selected",
            ),
          },
          {
            id: "place",
            label: bi("指定地点", "Named Place"),
            value: draft.trade.namedPlace ?? bi("未选择", "Not selected"),
          },
          {
            id: "edition",
            label: bi("版本", "Edition"),
            value: bi("Incoterms 2020", "Incoterms 2020"),
          },
        ]),
      ],
    },
    {
      id: "transport-shipment",
      blocks: [
        grid("export-transport-grid", [
          {
            id: "mode",
            label: bi("运输方式", "Transport Mode"),
            value: bi(draft.trade.transportMode, draft.trade.transportMode),
          },
          { id: "origin", label: bi("原产国", "Origin Country"), value: draft.trade.originCountry },
          {
            id: "destination",
            label: bi("目的国", "Destination Country"),
            value: draft.trade.destinationCountry,
          },
          {
            id: "window",
            label: bi("装运期", "Shipment Window"),
            value: draft.trade.shipmentWindow,
          },
          {
            id: "partial-shipment",
            label: bi("分批装运", "Partial Shipment"),
            value: draft.trade.partialShipment
              ? bi("允许", "Allowed")
              : bi("不允许", "Not allowed"),
          },
          {
            id: "transshipment",
            label: bi("转运", "Transshipment"),
            value: draft.trade.transshipment ? bi("允许", "Allowed") : bi("不允许", "Not allowed"),
          },
        ]),
      ],
    },
    {
      id: "packaging-inspection",
      blocks: [
        grid("export-packaging-grid", [
          {
            id: "packaging",
            label: bi("出口包装", "Export Packaging"),
            value: draft.trade.exportPackaging,
          },
          { id: "inspection", label: bi("检验", "Inspection"), value: draft.trade.inspection },
          {
            id: "insurance",
            label: bi("保险", "Insurance"),
            value: draft.trade.insuranceArrangement ?? bi("未约定", "Not agreed"),
          },
        ]),
      ],
    },
    {
      id: "payment-bank-charges",
      blocks: [
        grid("export-payment-grid", [
          {
            id: "payment",
            label: bi("付款方式", "Payment Method"),
            value: draft.trade.paymentMethod,
          },
          { id: "charges", label: bi("银行费用", "Bank Charges"), value: draft.trade.bankCharges },
        ]),
      ],
    },
    {
      id: "document-list",
      blocks: [
        {
          type: "list" as const,
          id: "export-documents",
          ordered: false,
          items: draft.trade.documentList,
        },
      ],
    },
    {
      id: "language-priority",
      blocks: [
        grid("export-language-grid", [
          {
            id: "priority",
            label: bi("语言优先", "Language Priority"),
            value: bi(
              draft.trade.languagePriority ?? "未选择",
              draft.trade.languagePriority ?? "Not selected",
            ),
          },
        ]),
      ],
    },
    {
      id: "incoterms-notice",
      blocks: [
        {
          type: "notice" as const,
          id: "export-incoterms-notice",
          tone: "warning" as const,
          paragraphs: [
            bi(
              "Incoterms 2020 仅分配交付、风险、费用与相关义务；付款、所有权、违约救济、适用法律和争议解决不在规则范围内。",
              "Incoterms 2020 allocates delivery, risk, costs and related obligations only; it does not govern payment, title, remedies, governing law or dispute resolution.",
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
          id: "export-signatures",
          signers: [
            {
              role: bi("卖方", "Seller"),
              name: draft.seller.legalName.enUS,
              dateLabel: bi("日期", "Date"),
              sealLabel: bi("盖章", "Seal"),
            },
            {
              role: bi("买方确认", "Buyer Acknowledgement"),
              name: draft.buyer.legalName.enUS,
              dateLabel: bi("日期", "Date"),
              sealLabel: bi("盖章", "Seal"),
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
    language: "zh-en",
    title: localized(draft.meta.title, draft.meta.englishTitle),
    pageDefaults: {
      size: "A4",
      orientation: "portrait",
      marginsMm: { top: 14, right: 12, bottom: 14, left: 12 },
    },
    sections,
    watermarks: findingsWatermark(findings),
    disclaimers: ["international-choice-warning"],
    attachmentManifest: [],
  }) as DocumentModelV2;
}

function createExportRepeatableItem(
  path: string,
  input: { readonly id: string; readonly now: string | Date; readonly draft: unknown },
): unknown {
  if (path === "goodsLines") {
    return {
      id: input.id,
      name: bi("待填写", "TBD"),
      unit: bi("件", "pcs"),
      quantity: "1",
      unitPriceMinor: "0",
      discountBps: 0,
      taxRateBps: 0,
    };
  }
  if (path === "trade.documentList") return bi("待填写", "TBD");
  throw new Error("不支持的重复项路径");
}

export const EXPORT_BILINGUAL_QUOTE_REGISTRATION: TemplateRegistration<unknown, DocumentModelV2> =
  Object.freeze({
    definition: EXPORT_BILINGUAL_QUOTE_DEFINITION,
    parseDraft: parseExportDraft,
    createDraft: createExportDraft,
    createRepeatableItem: createExportRepeatableItem,
    compile: compileExportDraft,
    preflight(value: unknown) {
      return analyzeExportTradeDraft(parseExportDraft(value));
    },
  });
