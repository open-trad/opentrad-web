import { isolatedArraySchema } from "../../../safe-schema.js";
import { z } from "../../../zod.js";
import type { EntityPartyV2, LocalizedText, TemplateDefinitionV2 } from "../../common.js";
import { type DocumentModelV2, DocumentModelV2Schema } from "../../document-model.js";
import {
  calculateProformaAdjustmentsV2,
  calculateQuoteLinesV2,
  formatMoneyMinorV2,
  IdentifierV2Schema,
  MoneyMinorV2Schema,
} from "../../money.js";
import type { TemplateRegistration } from "../../registry.js";
import type { RiskFindingV2 } from "../../risk.js";
import {
  DateV2Schema,
  GoodsLinesV2Schema,
  type GoodsLineV2,
  IncotermsRuleV2Schema,
  PartyV2Schema,
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
  partyDetails,
  quoteText,
  strictQuoteObject,
  utcDraftDates,
} from "./shared.js";

export interface ProformaInvoiceDraftV1 {
  readonly id: string;
  readonly templateId: "quotation.proforma.invoice.v1";
  readonly templateVersion: "1.0.0";
  readonly meta: QuoteMetaV2 & {
    readonly currency: "USD";
    readonly language: "zh-en";
    readonly layoutStyleId: "international-compact.v1";
  };
  readonly seller: EntityPartyV2;
  readonly buyer: EntityPartyV2;
  readonly consignee?: EntityPartyV2;
  readonly notifyParty?: EntityPartyV2;
  readonly buyerReference: string;
  readonly purchaseOrderReference?: string;
  readonly goodsLines: readonly GoodsLineV2[];
  readonly shipment: {
    readonly packageCount?: string;
    readonly totalNetWeightKg: string;
    readonly totalGrossWeightKg: string;
    readonly totalVolumeCbm?: string;
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
    readonly namedPlace?: string;
    readonly incotermsEdition: "2020";
    readonly transportMode: "air" | "road" | "rail" | "sea" | "multimodal";
    readonly estimatedShippingDate: string;
    readonly paymentTerms: string;
    readonly originCountry: string;
    readonly destinationCountry: string;
    readonly portOfLoading?: string;
    readonly portOfDischarge?: string;
    readonly insuranceArrangement?: string;
    readonly bankInstructions?: string;
    readonly languagePriority?: "zh-CN" | "en-US";
  };
  readonly charges: {
    readonly discountMinor?: string;
    readonly freightMinor?: string;
    readonly insuranceMinor?: string;
    readonly otherCharges: readonly {
      readonly id: string;
      readonly label: string;
      readonly amountMinor: string;
    }[];
  };
  readonly updatedAt: string;
}

const OptionalText = quoteText(10_000);
const RequiredText = quoteText(10_000, true);
const MeasurementSchema = WeightKgV2Schema;

const ShipmentSchema = strictQuoteObject(
  {
    packageCount: quoteText(300).optional(),
    totalNetWeightKg: MeasurementSchema,
    totalGrossWeightKg: MeasurementSchema,
    totalVolumeCbm: MeasurementSchema.optional(),
    incotermsRule: IncotermsRuleV2Schema.optional(),
    namedPlace: quoteText(500).optional(),
    incotermsEdition: z.literal("2020"),
    transportMode: z.enum(["air", "road", "rail", "sea", "multimodal"]),
    estimatedShippingDate: DateV2Schema,
    paymentTerms: RequiredText,
    originCountry: quoteText(200, true),
    destinationCountry: quoteText(200, true),
    portOfLoading: quoteText(300).optional(),
    portOfDischarge: quoteText(300).optional(),
    insuranceArrangement: OptionalText.optional(),
    bankInstructions: OptionalText.optional(),
    languagePriority: z.enum(["zh-CN", "en-US"]).optional(),
  },
  (shipment, addIssue) => {
    const decimalThousandths = (value: string) => {
      const [whole = "0", fraction = ""] = value.split(".");
      return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
    };
    if (
      decimalThousandths(shipment.totalGrossWeightKg) <
      decimalThousandths(shipment.totalNetWeightKg)
    ) {
      addIssue({
        code: "custom",
        message: "Gross weight must be greater than or equal to net weight",
        path: ["totalGrossWeightKg"],
      });
    }
  },
);

const OtherChargeSchema = strictQuoteObject({
  id: IdentifierV2Schema,
  label: quoteText(300, true),
  amountMinor: MoneyMinorV2Schema,
});

const OtherChargesSchema = isolatedArraySchema(OtherChargeSchema, {
  max: 100,
  refine: (charges, addIssue) => {
    const seen = new Set<string>();
    charges.forEach((charge, index) => {
      if (seen.has(charge.id)) {
        addIssue({
          code: "custom",
          message: "Other-charge ids must be unique",
          path: [index, "id"],
        });
      }
      seen.add(charge.id);
    });
  },
});

const ChargesSchema = strictQuoteObject({
  discountMinor: MoneyMinorV2Schema.optional(),
  freightMinor: MoneyMinorV2Schema.optional(),
  insuranceMinor: MoneyMinorV2Schema.optional(),
  otherCharges: OtherChargesSchema,
});

const ProformaInvoiceDraftRawSchema = strictQuoteObject(
  {
    id: IdentifierV2Schema,
    templateId: z.literal("quotation.proforma.invoice.v1"),
    templateVersion: z.literal("1.0.0"),
    meta: QuoteMetaV2Schema,
    seller: PartyV2Schema,
    buyer: PartyV2Schema,
    consignee: PartyV2Schema.optional(),
    notifyParty: PartyV2Schema.optional(),
    buyerReference: quoteText(300, true),
    purchaseOrderReference: quoteText(300).optional(),
    goodsLines: GoodsLinesV2Schema,
    shipment: ShipmentSchema,
    charges: ChargesSchema,
    updatedAt: IsoInstantV2RawSchema,
  },
  (draft, addIssue) => {
    if (draft.meta.currency !== "USD") {
      addIssue({
        code: "custom",
        message: "Pro forma invoice currency must be USD",
        path: ["meta", "currency"],
      });
    }
    if (draft.meta.language !== "zh-en") {
      addIssue({
        code: "custom",
        message: "Pro forma invoice must be bilingual",
        path: ["meta", "language"],
      });
    }
    if (draft.meta.layoutStyleId !== "international-compact.v1") {
      addIssue({
        code: "custom",
        message: "Pro forma invoice must use the international layout",
        path: ["meta", "layoutStyleId"],
      });
    }
    const thousandths = (value: string) => {
      const [whole = "0", fraction = ""] = value.split(".");
      return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
    };
    draft.goodsLines.forEach((line, index) => {
      if (
        line.netWeightKg !== undefined &&
        line.grossWeightKg !== undefined &&
        thousandths(line.grossWeightKg) < thousandths(line.netWeightKg)
      ) {
        addIssue({
          code: "custom",
          message: "Goods gross weight must be greater than or equal to net weight",
          path: ["goodsLines", index, "grossWeightKg"],
        });
      }
    });
  },
);

export const ProformaInvoiceDraftV1Schema = frozenQuoteSchema(ProformaInvoiceDraftRawSchema, {
  arrayLimits: { goodsLines: 100, otherCharges: 100 },
});

export const PROFORMA_INVOICE_DEFINITION = {
  id: "quotation.proforma.invoice.v1",
  version: "1.0.0",
  category: "quotation",
  name: "形式发票",
  summary: "供交易沟通和机构申报参考的形式发票，不替代正式票据或运输单据",
  basisDate: "2026-08-19",
  languages: ["zh-en"],
  defaultLanguage: "zh-en",
  allowedLayouts: ["international-compact.v1"],
  defaultLayout: "international-compact.v1",
  supportedOutputs: ["docx", "pdf", "json", "opentrad"],
  sourceKeys: ["trade-gov-proforma", "icc-incoterms-2020"],
  disclaimerProfile: "international",
  fieldManifest: [
    {
      path: "meta.validUntil",
      section: "invoice-meta",
      label: "有效期至",
      control: "date",
      required: true,
    },
    {
      path: "buyerReference",
      section: "invoice-meta",
      label: "买方参考号",
      control: "text",
      required: true,
    },
    {
      path: "goodsLines",
      section: "goods-table",
      label: "货品明细",
      control: "repeatable",
      required: true,
    },
    {
      path: "shipment.transportMode",
      section: "payment-shipping",
      label: "运输方式",
      control: "select",
      required: true,
      options: [
        { value: "air", label: "空运" },
        { value: "road", label: "公路" },
        { value: "rail", label: "铁路" },
        { value: "sea", label: "海运" },
        { value: "multimodal", label: "多式联运" },
      ],
    },
    {
      path: "shipment.incotermsRule",
      section: "sale-term",
      label: "Incoterms 规则",
      control: "select",
      required: false,
      options: [
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
      ],
    },
    {
      path: "shipment.namedPlace",
      section: "sale-term",
      label: "指定地点",
      control: "text",
      required: false,
    },
    {
      path: "shipment.estimatedShippingDate",
      section: "payment-shipping",
      label: "预计装运日期",
      control: "date",
      required: true,
    },
    {
      path: "shipment.paymentTerms",
      section: "payment-shipping",
      label: "付款条件",
      control: "textarea",
      required: true,
    },
    {
      path: "shipment.insuranceArrangement",
      section: "payment-shipping",
      label: "保险安排",
      control: "textarea",
      required: false,
    },
    {
      path: "charges.otherCharges",
      section: "charges",
      label: "其他费用",
      control: "repeatable",
      required: false,
    },
  ],
} as const satisfies TemplateDefinitionV2;

function parseProformaDraft(value: unknown): ProformaInvoiceDraftV1 {
  return ProformaInvoiceDraftV1Schema.parse(value) as ProformaInvoiceDraftV1;
}

function createProformaDraft(input: {
  readonly id: string;
  readonly now: string | Date;
}): ProformaInvoiceDraftV1 {
  const dates = utcDraftDates(input.now);
  return parseProformaDraft({
    id: input.id,
    templateId: "quotation.proforma.invoice.v1",
    templateVersion: "1.0.0",
    meta: {
      number: "待填写",
      title: "形式发票",
      englishTitle: "PRO FORMA INVOICE",
      issueDate: dates.issueDate,
      validUntil: dates.validUntil,
      currency: "USD",
      taxMode: "tax-exempt",
      quoteNature: "invitation",
      language: "zh-en",
      layoutStyleId: "international-compact.v1",
    },
    seller: { legalName: "待填写", entityType: "company", contactName: "待填写" },
    buyer: { legalName: "待填写", entityType: "company", contactName: "待填写" },
    buyerReference: "待填写",
    goodsLines: [
      {
        id: "goods-1",
        name: "待填写",
        unit: "pcs",
        quantity: "1",
        unitPriceMinor: "0",
        discountBps: 0,
        taxRateBps: 0,
      },
    ],
    shipment: {
      totalNetWeightKg: "1",
      totalGrossWeightKg: "1",
      incotermsEdition: "2020",
      transportMode: "multimodal",
      estimatedShippingDate: dates.validUntil,
      paymentTerms: "待填写",
      originCountry: "待填写",
      destinationCountry: "待填写",
    },
    charges: { otherCharges: [] },
    updatedAt: dates.updatedAt,
  });
}

const SEA_ONLY_RULES = new Set(["FAS", "FOB", "CFR", "CIF"]);

function analyzeProformaDraft(draft: ProformaInvoiceDraftV1): readonly RiskFindingV2[] {
  const findings: RiskFindingV2[] = [];
  if (hasPlaceholder(draft)) {
    findings.push(
      finding("QUOTE_UNRESOLVED_PLACEHOLDER", "error", "watermark", "形式发票仍包含待填写内容"),
    );
  }
  if (draft.meta.quoteNature === "invitation") {
    findings.push(
      finding(
        "QUOTE_INVITATION_NON_BINDING",
        "info",
        "advisory",
        "形式发票草案不构成具有约束力的要约",
        ["meta", "quoteNature"],
      ),
    );
  }
  const rule = draft.shipment.incotermsRule;
  if (!rule || !draft.shipment.namedPlace) {
    findings.push(
      finding(
        "INCOTERMS_SELECTION_MISSING",
        "error",
        "blockSubmission",
        "必须由用户选择 Incoterms 2020 规则并填写指定地点",
        ["shipment", "incotermsRule"],
      ),
    );
  }
  if ((rule === "CIF" || rule === "CIP") && !draft.shipment.insuranceArrangement?.trim()) {
    findings.push(
      finding(
        "INCOTERMS_CIF_CIP_INSURANCE_MISSING",
        "error",
        "blockSubmission",
        "CIF/CIP 必须明确独立保险安排",
        ["shipment", "insuranceArrangement"],
      ),
    );
  }
  if (rule && SEA_ONLY_RULES.has(rule) && draft.shipment.transportMode !== "sea") {
    findings.push(
      finding(
        "INCOTERMS_SEA_MODE_REQUIRED",
        "error",
        "blockSubmission",
        "FAS/FOB/CFR/CIF 仅适用于海运或内河运输",
        ["shipment", "transportMode"],
      ),
    );
  }
  if (
    rule &&
    SEA_ONLY_RULES.has(rule) &&
    (!draft.shipment.portOfLoading || !draft.shipment.portOfDischarge)
  ) {
    findings.push(
      finding(
        "INCOTERMS_PORT_MISSING",
        "error",
        "blockSubmission",
        "海运规则必须明确装运港和卸货港",
        ["shipment"],
      ),
    );
  }
  if (rule === "EXW") {
    findings.push(
      finding(
        "INCOTERMS_EXW_CLEARANCE_ADVISORY",
        "warning",
        "advisory",
        "EXW 下应确认买方能否完成出口清关",
        ["shipment", "incotermsRule"],
      ),
    );
  }
  if (rule === "DDP") {
    findings.push(
      finding(
        "INCOTERMS_DDP_IMPORT_ADVISORY",
        "warning",
        "advisory",
        "DDP 下应确认卖方的进口合规能力",
        ["shipment", "incotermsRule"],
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
  if (!draft.shipment.languagePriority) {
    findings.push(
      finding(
        "LANGUAGE_PRIORITY_MISSING",
        "error",
        "blockSubmission",
        "必须由用户选择中英文冲突时的优先语言",
        ["shipment", "languagePriority"],
      ),
    );
  }
  if (draft.shipment.bankInstructions?.trim()) {
    findings.push(
      finding(
        "BANK_INSTRUCTIONS_USER_SUPPLIED_UNVERIFIED",
        "warning",
        "advisory",
        "银行指示由用户提供，系统未验证账户或收款机构",
        ["shipment", "bankInstructions"],
      ),
    );
  }
  return freezeFindings(findings);
}

function compileProformaDraft(value: unknown): DocumentModelV2 {
  const draft = parseProformaDraft(value);
  const findings = analyzeProformaDraft(draft);
  const lines = calculateQuoteLinesV2(
    draft.goodsLines.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      discountBps: line.discountBps,
      taxRateBps: line.taxRateBps,
    })),
    { currency: "USD", taxMode: draft.meta.taxMode },
  );
  const adjustments = calculateProformaAdjustmentsV2({
    currency: "USD",
    linesTotalMinor: lines.summary.totalMinor,
    documentDiscountMinor: draft.charges.discountMinor,
    freightMinor: draft.charges.freightMinor,
    insuranceMinor: draft.charges.insuranceMinor,
    otherCharges: draft.charges.otherCharges,
  });
  const amountByLine = new Map(lines.lines.map((line) => [line.lineId, line]));
  const bi = (zhCN: string, enUS = zhCN): LocalizedText => ({ zhCN, enUS });
  const grid = (
    id: string,
    entries: Array<{ id: string; label: LocalizedText; value: LocalizedText }>,
  ) => ({ type: "keyValueGrid" as const, id, entries });
  const party = (id: string, role: LocalizedText, value?: EntityPartyV2) => ({
    id,
    role,
    name: value ? localized(value.legalName, value.englishName) : bi("未提供", "Not provided"),
    details: value ? partyDetails(value) : [],
  });
  const sections = [
    {
      id: "proforma-banner",
      blocks: [
        {
          type: "cover" as const,
          id: "pi-cover",
          title: bi("形式发票", "PRO FORMA INVOICE"),
          subtitle: bi("非正式票据", "NOT A FINAL COMMERCIAL OR TAX INVOICE"),
        },
      ],
    },
    {
      id: "invoice-meta",
      blocks: [
        grid("pi-meta-grid", [
          { id: "number", label: bi("形式发票号", "PI No."), value: bi(draft.meta.number) },
          { id: "issue", label: bi("签发日期", "Issue Date"), value: bi(draft.meta.issueDate) },
          { id: "valid", label: bi("有效期至", "Valid Until"), value: bi(draft.meta.validUntil) },
          {
            id: "buyer-ref",
            label: bi("买方参考", "Buyer Reference"),
            value: bi(draft.buyerReference),
          },
          {
            id: "po-ref",
            label: bi("订单参考", "PO Reference"),
            value: bi(
              draft.purchaseOrderReference || "未提供",
              draft.purchaseOrderReference || "Not provided",
            ),
          },
        ]),
      ],
    },
    {
      id: "exporter-importer",
      blocks: [
        {
          type: "parties" as const,
          id: "pi-main-parties",
          parties: [
            party("seller", bi("出口方", "Exporter"), draft.seller),
            party("buyer", bi("进口方", "Importer"), draft.buyer),
          ],
        },
      ],
    },
    {
      id: "consignee-notify",
      blocks: [
        {
          type: "parties" as const,
          id: "pi-shipment-parties",
          parties: [
            party("consignee", bi("收货人", "Consignee"), draft.consignee),
            party("notify", bi("通知方", "Notify Party"), draft.notifyParty),
          ],
        },
      ],
    },
    {
      id: "goods-table",
      blocks: [
        {
          type: "table" as const,
          id: "pi-goods-table",
          columns: [
            { id: "name", label: bi("货品", "Goods"), width: "28%", align: "left" as const },
            {
              id: "spec",
              label: bi("规格", "Specification"),
              width: "22%",
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
            { id: "amount", label: bi("金额", "Amount"), width: "18%", align: "right" as const },
          ],
          rows: draft.goodsLines.map((line) => ({
            id: line.id,
            cells: {
              name: localized(line.name, line.englishName),
              spec: bi(line.specification || "未提供", line.specification || "Not provided"),
              quantity: bi(`${line.quantity} ${line.unit}`),
              unitPrice: bi(formatMoneyMinorV2(line.unitPriceMinor, "USD")),
              amount: bi(formatMoneyMinorV2(amountByLine.get(line.id)?.totalMinor ?? "0", "USD")),
            },
          })),
          repeatHeader: true,
          pagePolicy: { allowRowSplit: false, keepHeaderWithRows: 1 },
        },
      ],
    },
    {
      id: "weights-dimensions",
      blocks: [
        grid("pi-weight-grid", [
          {
            id: "packages",
            label: bi("包装件数", "Packages"),
            value: bi(
              draft.shipment.packageCount || "未提供",
              draft.shipment.packageCount || "Not provided",
            ),
          },
          {
            id: "net",
            label: bi("总净重", "Total Net Weight"),
            value: bi(`${draft.shipment.totalNetWeightKg} kg`),
          },
          {
            id: "gross",
            label: bi("总毛重", "Total Gross Weight"),
            value: bi(`${draft.shipment.totalGrossWeightKg} kg`),
          },
          {
            id: "volume",
            label: bi("总体积", "Total Volume"),
            value: bi(
              draft.shipment.totalVolumeCbm ? `${draft.shipment.totalVolumeCbm} cbm` : "未提供",
              draft.shipment.totalVolumeCbm
                ? `${draft.shipment.totalVolumeCbm} cbm`
                : "Not provided",
            ),
          },
        ]),
      ],
    },
    {
      id: "charges",
      blocks: [
        grid("pi-charges-grid", [
          {
            id: "discount",
            label: bi("单据折扣", "Document Discount"),
            value: bi(formatMoneyMinorV2(adjustments.documentDiscountMinor, "USD")),
          },
          {
            id: "freight",
            label: bi("运费", "Freight"),
            value: bi(formatMoneyMinorV2(adjustments.freightMinor, "USD")),
          },
          {
            id: "insurance",
            label: bi("保险费", "Insurance Charge"),
            value: bi(formatMoneyMinorV2(adjustments.insuranceMinor, "USD")),
          },
          {
            id: "other",
            label: bi("其他费用", "Other Charges"),
            value: bi(formatMoneyMinorV2(adjustments.otherChargesMinor, "USD")),
          },
        ]),
      ],
    },
    {
      id: "totals",
      blocks: [
        {
          type: "totals" as const,
          id: "pi-totals",
          entries: [
            {
              id: "lines",
              label: bi("货品合计", "Goods Total"),
              value: bi(formatMoneyMinorV2(adjustments.linesTotalMinor, "USD")),
            },
            {
              id: "total",
              label: bi("形式发票总额", "Pro Forma Total"),
              value: bi(formatMoneyMinorV2(adjustments.totalMinor, "USD")),
            },
          ],
        },
      ],
    },
    {
      id: "sale-term",
      blocks: [
        grid("pi-sale-term-grid", [
          {
            id: "rule",
            label: bi("贸易术语", "Trade Term"),
            value: bi(
              draft.shipment.incotermsRule ?? "未选择",
              draft.shipment.incotermsRule ?? "Not selected",
            ),
          },
          {
            id: "place",
            label: bi("指定地点", "Named Place"),
            value: bi(
              draft.shipment.namedPlace ?? "未选择",
              draft.shipment.namedPlace ?? "Not selected",
            ),
          },
          { id: "edition", label: bi("版本", "Edition"), value: bi("Incoterms 2020") },
        ]),
      ],
    },
    {
      id: "payment-shipping",
      blocks: [
        grid("pi-payment-shipping-grid", [
          {
            id: "payment",
            label: bi("付款条款", "Payment Terms"),
            value: bi(draft.shipment.paymentTerms),
          },
          {
            id: "ship-date",
            label: bi("预计装运日", "Estimated Shipping Date"),
            value: bi(draft.shipment.estimatedShippingDate),
          },
          {
            id: "mode",
            label: bi("运输方式", "Transport Mode"),
            value: bi(draft.shipment.transportMode),
          },
          {
            id: "insurance",
            label: bi("保险安排", "Insurance Arrangement"),
            value: bi(
              draft.shipment.insuranceArrangement || "未约定",
              draft.shipment.insuranceArrangement || "Not agreed",
            ),
          },
        ]),
      ],
    },
    {
      id: "bank-instructions",
      blocks: [
        {
          type: "notice" as const,
          id: "pi-bank-notice",
          tone: "warning" as const,
          paragraphs: [
            bi(
              draft.shipment.bankInstructions || "未提供银行指示",
              draft.shipment.bankInstructions || "Bank instructions not provided",
            ),
            bi(
              "银行信息由用户提供，付款前应通过独立渠道核验。",
              "Bank details are user supplied and must be verified independently before payment.",
            ),
          ],
        },
      ],
    },
    {
      id: "proforma-declaration",
      blocks: [
        {
          type: "declaration" as const,
          id: "pi-declaration",
          title: bi("形式发票声明", "Pro Forma Declaration"),
          paragraphs: [
            bi(
              "不替代税务发票、正式商业发票、付款凭证或运输单据，具体机构要求为准",
              "This document does not replace a tax invoice, final commercial invoice, proof of payment or transport document; applicable authority requirements prevail.",
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
          id: "pi-signatures",
          signers: [
            {
              role: bi("出口方", "Exporter"),
              name: draft.seller.englishName || draft.seller.legalName,
              dateLabel: bi("日期", "Date"),
              sealLabel: bi("盖章", "Seal"),
            },
            {
              role: bi("进口方确认", "Importer Acknowledgement"),
              name: draft.buyer.englishName || draft.buyer.legalName,
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

export const PROFORMA_INVOICE_REGISTRATION: TemplateRegistration<unknown, DocumentModelV2> =
  Object.freeze({
    definition: PROFORMA_INVOICE_DEFINITION,
    parseDraft: parseProformaDraft,
    createDraft: createProformaDraft,
    compile: compileProformaDraft,
    preflight(value: unknown) {
      return analyzeProformaDraft(parseProformaDraft(value));
    },
  });
