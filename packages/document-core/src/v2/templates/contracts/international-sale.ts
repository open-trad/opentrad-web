import { isolatedArraySchema } from "../../../safe-schema.js";
import { z } from "../../../zod.js";
import type { EntityPartyV2, LocalizedText, TemplateDefinitionV2 } from "../../common.js";
import { type DocumentModelV2, DocumentModelV2Schema } from "../../document-model.js";
import {
  BasisPointsV2Schema,
  CurrencyV2Schema,
  calculateQuoteLinesV2,
  formatMoneyMinorV2,
  IdentifierV2Schema,
  MoneyMinorV2Schema,
  QuantityV2Schema,
  TaxModeV2Schema,
} from "../../money.js";
import type { TemplateRegistration } from "../../registry.js";
import type { RiskFindingV2 } from "../../risk.js";
import {
  type BilingualContractTextV1,
  BilingualContractTextV1Schema,
  CisgChoiceV1Schema,
  type ContractMetaV2,
  ContractMetaV2Schema,
  ContractSignersV1Schema,
  type ContractSignerV1,
} from "../contract-common.js";
import {
  CURRENCY_OPTIONS,
  checkboxEditorField,
  contractMetaEditorFields,
  contractSignersEditorField,
  entityPartyEditorFields,
  INCOTERMS_OPTIONS,
  itemMoneyField,
  itemNumberField,
  itemPercentField,
  itemTextField,
  repeatableEditorField,
  selectEditorField,
  TAX_MODE_OPTIONS,
  TRANSPORT_MODE_OPTIONS,
  textEditorField,
} from "../editor-manifest.js";
import {
  DimensionCmV2Schema,
  HsCodeUserSuppliedV2Schema,
  IncotermsRuleV2Schema,
  WeightKgV2Schema,
} from "../quote-common.js";
import {
  ContractPartyV2Schema,
  contractDates,
  contractFinding,
  contractText,
  contractWatermarks,
  freezeContractFindings,
  frozenContractSchema,
  localized,
  partyDetails,
  signerBlocks,
  strictContractObject,
  validateSignerPartyReferences,
} from "./shared.js";

interface InternationalGoodsLineV1 {
  readonly id: string;
  readonly name: string;
  readonly englishName: string;
  readonly sku?: string;
  readonly specification?: BilingualContractTextV1;
  readonly description?: string;
  readonly unit: BilingualContractTextV1;
  readonly quantity: string;
  readonly unitPriceMinor: string;
  readonly discountBps: number;
  readonly taxRateBps: number;
  readonly countryOfOrigin?: string;
  readonly hsCodeUserSupplied?: string;
  readonly netWeightKg?: string;
  readonly grossWeightKg?: string;
  readonly lengthCm?: string;
  readonly widthCm?: string;
  readonly heightCm?: string;
}

export interface InternationalSaleContractDraftV1 {
  readonly id: string;
  readonly templateId: "contract.sale.international-bilingual.v1";
  readonly templateVersion: "1.0.0";
  readonly meta: Omit<ContractMetaV2, "language" | "languagePriority"> & {
    readonly language: "zh-en";
    readonly languagePriority?: "zh-CN" | "en-US";
  };
  readonly seller: EntityPartyV2;
  readonly buyer: EntityPartyV2;
  readonly goodsLines: readonly InternationalGoodsLineV1[];
  readonly price: {
    readonly currency?: "CNY" | "USD" | "EUR";
    readonly taxMode?: "tax-excluded" | "tax-included" | "tax-exempt";
    readonly adjustment?: BilingualContractTextV1;
  };
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
    readonly namedPlace?: BilingualContractTextV1;
    readonly incotermsEdition: "2020";
    readonly transportMode?: "air" | "road" | "rail" | "sea" | "multimodal";
    readonly shipmentWindow: BilingualContractTextV1;
    readonly partialShipment: boolean;
    readonly transshipment: boolean;
    readonly exportClearanceParty?: "seller" | "buyer";
    readonly importClearanceParty?: "seller" | "buyer";
    readonly insurance?: BilingualContractTextV1;
    readonly shippingDocuments: readonly BilingualContractTextV1[];
  };
  readonly acceptance: {
    readonly inspection: BilingualContractTextV1;
    readonly claimsPeriod: BilingualContractTextV1;
    readonly titleTransfer: BilingualContractTextV1;
    readonly riskTransfer: BilingualContractTextV1;
  };
  readonly payment: {
    readonly method?: "advance" | "open-account" | "letter-of-credit" | "collection" | "custom";
    readonly terms: BilingualContractTextV1;
    readonly letterOfCreditTerms?: BilingualContractTextV1;
    readonly bankCharges: BilingualContractTextV1;
  };
  readonly performance: {
    readonly packaging: BilingualContractTextV1;
    readonly shippingMarks: BilingualContractTextV1;
    readonly warranty: BilingualContractTextV1;
    readonly intellectualProperty: BilingualContractTextV1;
    readonly sanctionsAndExportControlAcknowledgement: BilingualContractTextV1;
    readonly forceMajeureAndHardship: BilingualContractTextV1;
    readonly breachRemedies: BilingualContractTextV1;
  };
  readonly legal: {
    readonly cisgChoice: "apply" | "exclude" | "undecided";
    readonly governingLaw?: BilingualContractTextV1;
    readonly disputeMethod?: "court" | "arbitration";
    readonly forum?: BilingualContractTextV1;
    readonly notices: BilingualContractTextV1;
  };
  readonly signers: readonly ContractSignerV1[];
  readonly updatedAt: string;
}

const IsoInstantSchema = contractText(35, true).refine(
  (value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
  "Expected a canonical ISO instant",
);
const InternationalGoodsLineSchema = strictContractObject({
  id: IdentifierV2Schema,
  name: contractText(500, true),
  englishName: contractText(500, true),
  sku: contractText(300).optional(),
  specification: BilingualContractTextV1Schema.optional(),
  description: contractText(5_000).optional(),
  unit: BilingualContractTextV1Schema,
  quantity: QuantityV2Schema,
  unitPriceMinor: MoneyMinorV2Schema,
  discountBps: BasisPointsV2Schema,
  taxRateBps: BasisPointsV2Schema,
  countryOfOrigin: contractText(300).optional(),
  hsCodeUserSupplied: HsCodeUserSuppliedV2Schema.optional(),
  netWeightKg: WeightKgV2Schema.optional(),
  grossWeightKg: WeightKgV2Schema.optional(),
  lengthCm: DimensionCmV2Schema.optional(),
  widthCm: DimensionCmV2Schema.optional(),
  heightCm: DimensionCmV2Schema.optional(),
});
const InternationalGoodsLinesSchema = isolatedArraySchema(InternationalGoodsLineSchema, {
  min: 1,
  max: 100,
  refine: (lines, addIssue) => {
    const seen = new Set<string>();
    lines.forEach((line, index) => {
      if (seen.has(line.id))
        addIssue({ code: "custom", message: "Goods line ids must be unique", path: [index, "id"] });
      seen.add(line.id);
    });
  },
});
const PriceSchema = strictContractObject({
  currency: CurrencyV2Schema.optional(),
  taxMode: TaxModeV2Schema.optional(),
  adjustment: BilingualContractTextV1Schema.optional(),
});
const TradeSchema = strictContractObject({
  incotermsRule: IncotermsRuleV2Schema.optional(),
  namedPlace: BilingualContractTextV1Schema.optional(),
  incotermsEdition: z.literal("2020"),
  transportMode: z.enum(["air", "road", "rail", "sea", "multimodal"]).optional(),
  shipmentWindow: BilingualContractTextV1Schema,
  partialShipment: z.boolean(),
  transshipment: z.boolean(),
  exportClearanceParty: z.enum(["seller", "buyer"]).optional(),
  importClearanceParty: z.enum(["seller", "buyer"]).optional(),
  insurance: BilingualContractTextV1Schema.optional(),
  shippingDocuments: isolatedArraySchema(BilingualContractTextV1Schema, { max: 100 }),
});
const AcceptanceSchema = strictContractObject({
  inspection: BilingualContractTextV1Schema,
  claimsPeriod: BilingualContractTextV1Schema,
  titleTransfer: BilingualContractTextV1Schema,
  riskTransfer: BilingualContractTextV1Schema,
});
const PaymentSchema = strictContractObject(
  {
    method: z
      .enum(["advance", "open-account", "letter-of-credit", "collection", "custom"])
      .optional(),
    terms: BilingualContractTextV1Schema,
    letterOfCreditTerms: BilingualContractTextV1Schema.optional(),
    bankCharges: BilingualContractTextV1Schema,
  },
  (payment, addIssue) => {
    if (payment.method === "letter-of-credit" && !payment.letterOfCreditTerms) {
      addIssue({
        code: "custom",
        message: "Letter of credit requires authored bilingual terms",
        path: ["letterOfCreditTerms"],
      });
    }
    if (payment.method !== "letter-of-credit" && Object.hasOwn(payment, "letterOfCreditTerms")) {
      addIssue({
        code: "custom",
        message: "Letter-of-credit terms require that payment method",
        path: ["letterOfCreditTerms"],
      });
    }
  },
);
const PerformanceSchema = strictContractObject({
  packaging: BilingualContractTextV1Schema,
  shippingMarks: BilingualContractTextV1Schema,
  warranty: BilingualContractTextV1Schema,
  intellectualProperty: BilingualContractTextV1Schema,
  sanctionsAndExportControlAcknowledgement: BilingualContractTextV1Schema,
  forceMajeureAndHardship: BilingualContractTextV1Schema,
  breachRemedies: BilingualContractTextV1Schema,
});
const LegalSchema = strictContractObject({
  cisgChoice: CisgChoiceV1Schema,
  governingLaw: BilingualContractTextV1Schema.optional(),
  disputeMethod: z.enum(["court", "arbitration"]).optional(),
  forum: BilingualContractTextV1Schema.optional(),
  notices: BilingualContractTextV1Schema,
});

type InternationalContractMetaV1 = InternationalSaleContractDraftV1["meta"];
const INTERNATIONAL_META_KEYS = new Set([
  "contractNumber",
  "title",
  "signingDate",
  "signingPlace",
  "effectiveMode",
  "effectiveDate",
  "effectiveCondition",
  "copies",
  "language",
  "languagePriority",
  "layoutStyleId",
]);

const InternationalContractMetaV1Schema = z.transform<unknown, InternationalContractMetaV1>(
  (input, context) => {
    try {
      if (input === null || typeof input !== "object" || Array.isArray(input)) {
        context.addIssue({
          code: "custom",
          message: "International contract metadata must be an object",
        });
        return z.NEVER;
      }
      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) {
        context.addIssue({ code: "custom", message: "Custom metadata prototypes are not allowed" });
        return z.NEVER;
      }
      const snapshot = Object.create(null) as Record<string, unknown>;
      for (const key of Reflect.ownKeys(input)) {
        const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
        if (
          typeof key !== "string" ||
          !INTERNATIONAL_META_KEYS.has(key) ||
          !descriptor ||
          !("value" in descriptor)
        ) {
          context.addIssue({
            code: "custom",
            message: "Unknown or accessor metadata key",
            path: typeof key === "string" ? [key] : [],
          });
          continue;
        }
        Object.defineProperty(snapshot, key, {
          configurable: true,
          enumerable: true,
          value: descriptor.value,
          writable: true,
        });
      }
      if (context.issues.length > 0) return z.NEVER;
      const hasPriority =
        Object.hasOwn(snapshot, "languagePriority") && snapshot.languagePriority !== undefined;
      const candidate = hasPriority
        ? snapshot
        : Object.assign(Object.create(null), snapshot, { languagePriority: "zh-CN" });
      const parsed = ContractMetaV2Schema.safeParse(candidate);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) context.addIssue({ ...issue });
        return z.NEVER;
      }
      if (parsed.data.language !== "zh-en") {
        context.addIssue({ code: "custom", message: "International contracts must be bilingual" });
        return z.NEVER;
      }
      if (hasPriority) return parsed.data as InternationalContractMetaV1;
      const { languagePriority: _languagePriority, ...withoutPriority } = parsed.data;
      return Object.assign(Object.create(null), withoutPriority) as InternationalContractMetaV1;
    } catch {
      context.addIssue({ code: "custom", message: "Metadata validation failed safely" });
      return z.NEVER;
    }
  },
);

const InternationalSaleDraftRawSchema = strictContractObject(
  {
    id: IdentifierV2Schema,
    templateId: z.literal("contract.sale.international-bilingual.v1"),
    templateVersion: z.literal("1.0.0"),
    meta: InternationalContractMetaV1Schema,
    seller: ContractPartyV2Schema,
    buyer: ContractPartyV2Schema,
    goodsLines: InternationalGoodsLinesSchema,
    price: PriceSchema,
    trade: TradeSchema,
    acceptance: AcceptanceSchema,
    payment: PaymentSchema,
    performance: PerformanceSchema,
    legal: LegalSchema,
    signers: ContractSignersV1Schema,
    updatedAt: IsoInstantSchema,
  },
  (draft, addIssue) => {
    if (
      draft.meta.language !== "zh-en" ||
      draft.meta.layoutStyleId !== "international-compact.v1"
    ) {
      addIssue({
        code: "custom",
        message: "International sale presentation is fixed",
        path: ["meta"],
      });
    }
    if (!draft.seller.englishName?.trim()) {
      addIssue({
        code: "custom",
        message: "Seller English name is required",
        path: ["seller", "englishName"],
      });
    }
    if (!draft.buyer.englishName?.trim()) {
      addIssue({
        code: "custom",
        message: "Buyer English name is required",
        path: ["buyer", "englishName"],
      });
    }
    validateSignerPartyReferences(draft.signers, ["seller", "buyer"], addIssue);
    draft.signers.forEach((signer, index) => {
      if (
        !signer.role.enUS?.trim() ||
        !signer.dateLabel.enUS?.trim() ||
        !signer.sealLabel.enUS?.trim()
      ) {
        addIssue({
          code: "custom",
          message: "International signer labels require authored English",
          path: ["signers", index],
        });
      }
    });
  },
);

export const InternationalSaleContractDraftV1Schema = frozenContractSchema(
  InternationalSaleDraftRawSchema,
  {
    arrayLimits: { goodsLines: 100, shippingDocuments: 100, signers: 10 },
    maxTotalValues: 8_000,
  },
);

export const INTERNATIONAL_SALE_CONTRACT_DEFINITION = {
  id: "contract.sale.international-bilingual.v1",
  version: "1.0.0",
  category: "contract",
  name: "国际货物销售合同（中英双语）",
  summary: "由用户明确选择贸易、清关、CISG、适用法、争议解决和语言优先的双语合同草案",
  basisDate: "2026-08-19",
  languages: ["zh-en"],
  defaultLanguage: "zh-en",
  allowedLayouts: ["international-compact.v1"],
  defaultLayout: "international-compact.v1",
  supportedOutputs: ["docx", "pdf", "json", "opentrad"],
  sourceKeys: ["uncitral-cisg", "icc-incoterms-2020"],
  disclaimerProfile: "international",
  fieldManifest: [
    ...contractMetaEditorFields({ section: "meta", languagePrioritySection: "language-priority" }),
    ...entityPartyEditorFields({
      prefix: "seller",
      section: "bilingual-parties",
      label: "卖方",
      englishNameRequired: true,
    }),
    ...entityPartyEditorFields({
      prefix: "buyer",
      section: "bilingual-parties",
      label: "买方",
      englishNameRequired: true,
    }),
    repeatableEditorField({
      path: "goodsLines",
      section: "goods",
      label: "双语货品明细",
      required: true,
      minItems: 1,
      maxItems: 100,
      item: {
        kind: "object",
        idPath: "id",
        fields: [
          itemTextField({ path: "name", label: "中文名称", required: true }),
          itemTextField({ path: "englishName", label: "英文名称", required: true }),
          itemTextField({ path: "sku", label: "SKU", required: false }),
          itemTextField({ path: "specification", label: "规格", required: false, localized: true }),
          itemTextField({ path: "description", label: "说明", required: false, multiline: true }),
          itemTextField({ path: "unit", label: "单位", required: true, localized: true }),
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
    }),
    selectEditorField({
      path: "price.currency",
      section: "price",
      label: "币种",
      required: true,
      options: CURRENCY_OPTIONS,
    }),
    selectEditorField({
      path: "price.taxMode",
      section: "price",
      label: "计税口径",
      required: true,
      options: TAX_MODE_OPTIONS,
    }),
    textEditorField({
      path: "price.adjustment",
      section: "price",
      label: "价格调整",
      required: false,
      localized: true,
      multiline: true,
    }),
    selectEditorField({
      path: "trade.incotermsRule",
      section: "incoterms-delivery-risk",
      label: "Incoterms 2020规则",
      required: true,
      options: INCOTERMS_OPTIONS,
    }),
    textEditorField({
      path: "trade.namedPlace",
      section: "incoterms-delivery-risk",
      label: "指定地点",
      required: true,
      localized: true,
    }),
    selectEditorField({
      path: "trade.transportMode",
      section: "shipment",
      label: "运输方式",
      required: true,
      options: TRANSPORT_MODE_OPTIONS,
    }),
    textEditorField({
      path: "trade.shipmentWindow",
      section: "shipment",
      label: "装运期",
      required: true,
      localized: true,
      multiline: true,
    }),
    checkboxEditorField({
      path: "trade.partialShipment",
      section: "shipment",
      label: "允许分批装运",
      required: true,
    }),
    checkboxEditorField({
      path: "trade.transshipment",
      section: "shipment",
      label: "允许转运",
      required: true,
    }),
    selectEditorField({
      path: "trade.exportClearanceParty",
      section: "clearance-insurance",
      label: "出口清关方",
      required: true,
      options: [
        { value: "seller", label: "卖方" },
        { value: "buyer", label: "买方" },
      ],
    }),
    selectEditorField({
      path: "trade.importClearanceParty",
      section: "clearance-insurance",
      label: "进口清关方",
      required: true,
      options: [
        { value: "seller", label: "卖方" },
        { value: "buyer", label: "买方" },
      ],
    }),
    textEditorField({
      path: "trade.insurance",
      section: "clearance-insurance",
      label: "保险",
      required: true,
      localized: true,
      multiline: true,
    }),
    repeatableEditorField({
      path: "trade.shippingDocuments",
      section: "documents",
      label: "装运单证",
      required: false,
      minItems: 0,
      maxItems: 100,
      item: {
        kind: "object",
        fields: [
          itemTextField({ path: "zhCN", label: "中文", required: true }),
          itemTextField({ path: "enUS", label: "英文", required: true }),
        ],
      },
    }),
    ...(
      [
        ["inspection", "检验", "inspection-claims"],
        ["claimsPeriod", "索赔期限", "inspection-claims"],
        ["titleTransfer", "所有权转移", "title"],
        ["riskTransfer", "风险转移", "title"],
      ] as const
    ).map(([path, label, section]) =>
      textEditorField({
        path: `acceptance.${path}`,
        section,
        label,
        required: true,
        localized: true,
        multiline: true,
      }),
    ),
    selectEditorField({
      path: "payment.method",
      section: "payment-bank",
      label: "付款方式",
      required: true,
      options: [
        { value: "advance", label: "预付款" },
        { value: "open-account", label: "赊账" },
        { value: "letter-of-credit", label: "信用证" },
        { value: "collection", label: "托收" },
        { value: "custom", label: "自定义" },
      ],
    }),
    textEditorField({
      path: "payment.terms",
      section: "payment-bank",
      label: "付款条款",
      required: true,
      localized: true,
      multiline: true,
    }),
    textEditorField({
      path: "payment.letterOfCreditTerms",
      section: "payment-bank",
      label: "信用证条款",
      required: false,
      localized: true,
      multiline: true,
      visibleWhen: { path: "payment.method", equals: "letter-of-credit" },
    }),
    textEditorField({
      path: "payment.bankCharges",
      section: "payment-bank",
      label: "银行费用",
      required: true,
      localized: true,
      multiline: true,
    }),
    ...(
      [
        ["packaging", "包装", "packaging-marks"],
        ["shippingMarks", "唛头", "packaging-marks"],
        ["warranty", "质保", "warranty-ip"],
        ["intellectualProperty", "知识产权", "warranty-ip"],
        ["sanctionsAndExportControlAcknowledgement", "制裁与出口管制确认", "compliance"],
        ["forceMajeureAndHardship", "不可抗力与情势变更", "force-majeure-hardship"],
        ["breachRemedies", "违约救济", "breach-remedies"],
      ] as const
    ).map(([path, label, section]) =>
      textEditorField({
        path: `performance.${path}`,
        section,
        label,
        required: true,
        localized: true,
        multiline: true,
      }),
    ),
    selectEditorField({
      path: "legal.cisgChoice",
      section: "cisg-governing-law",
      label: "CISG选择",
      required: true,
      options: [
        { value: "apply", label: "适用" },
        { value: "exclude", label: "排除" },
        { value: "undecided", label: "待决定" },
      ],
    }),
    textEditorField({
      path: "legal.governingLaw",
      section: "cisg-governing-law",
      label: "适用法",
      required: true,
      localized: true,
      multiline: true,
    }),
    selectEditorField({
      path: "legal.disputeMethod",
      section: "dispute",
      label: "争议解决方式",
      required: true,
      options: [
        { value: "court", label: "诉讼" },
        { value: "arbitration", label: "仲裁" },
      ],
    }),
    textEditorField({
      path: "legal.forum",
      section: "dispute",
      label: "争议解决机构",
      required: true,
      localized: true,
      multiline: true,
    }),
    textEditorField({
      path: "legal.notices",
      section: "notices",
      label: "通知",
      required: true,
      localized: true,
      multiline: true,
    }),
    contractSignersEditorField({
      section: "signatures",
      bilingual: true,
      partyOptions: [
        { value: "seller", label: "卖方" },
        { value: "buyer", label: "买方" },
      ],
    }),
  ],
} as const satisfies TemplateDefinitionV2;

function parseInternationalDraft(value: unknown): InternationalSaleContractDraftV1 {
  return InternationalSaleContractDraftV1Schema.parse(value) as InternationalSaleContractDraftV1;
}

const tbd: BilingualContractTextV1 = { zhCN: "待填写", enUS: "TBD" };

function createInternationalDraft(input: { readonly id: string; readonly now: string | Date }) {
  const dates = contractDates(input.now);
  return parseInternationalDraft({
    id: input.id,
    templateId: "contract.sale.international-bilingual.v1",
    templateVersion: "1.0.0",
    meta: {
      contractNumber: "待填写",
      title: "国际货物销售合同",
      signingDate: dates.signingDate,
      effectiveMode: "signature",
      copies: 2,
      language: "zh-en",
      layoutStyleId: "international-compact.v1",
    },
    seller: {
      legalName: "待填写",
      englishName: "TBD",
      entityType: "company",
      contactName: "待填写",
    },
    buyer: {
      legalName: "待填写",
      englishName: "TBD",
      entityType: "company",
      contactName: "待填写",
    },
    goodsLines: [
      {
        id: "goods-1",
        name: "待填写",
        englishName: "TBD",
        unit: tbd,
        quantity: "1",
        unitPriceMinor: "0",
        discountBps: 0,
        taxRateBps: 0,
      },
    ],
    price: {},
    trade: {
      incotermsEdition: "2020",
      shipmentWindow: tbd,
      partialShipment: false,
      transshipment: false,
      shippingDocuments: [],
    },
    acceptance: { inspection: tbd, claimsPeriod: tbd, titleTransfer: tbd, riskTransfer: tbd },
    payment: { terms: tbd, bankCharges: tbd },
    performance: {
      packaging: tbd,
      shippingMarks: tbd,
      warranty: tbd,
      intellectualProperty: tbd,
      sanctionsAndExportControlAcknowledgement: tbd,
      forceMajeureAndHardship: tbd,
      breachRemedies: tbd,
    },
    legal: { cisgChoice: "undecided", notices: tbd },
    signers: [
      {
        partyId: "seller",
        role: localized("卖方", "Seller"),
        dateLabel: localized("日期", "Date"),
        sealLabel: localized("盖章", "Seal"),
      },
      {
        partyId: "buyer",
        role: localized("买方", "Buyer"),
        dateLabel: localized("日期", "Date"),
        sealLabel: localized("盖章", "Seal"),
      },
    ],
    updatedAt: dates.updatedAt,
  });
}

const SEA_ONLY_RULES = new Set(["FAS", "FOB", "CFR", "CIF"]);

function analyzeInternationalDraft(
  draft: InternationalSaleContractDraftV1,
): readonly RiskFindingV2[] {
  const findings: RiskFindingV2[] = [];
  const block = (missing: boolean, code: string, message: string, path: readonly string[]) => {
    if (missing) findings.push(contractFinding(code, "error", "blockSubmission", message, path));
  };
  block(!draft.price.currency, "CONTRACT_CURRENCY_MISSING", "必须由用户选择合同币种", [
    "price",
    "currency",
  ]);
  block(!draft.price.taxMode, "CONTRACT_TAX_MODE_MISSING", "必须由用户选择计税口径", [
    "price",
    "taxMode",
  ]);
  block(
    !draft.trade.incotermsRule || !draft.trade.namedPlace,
    "INCOTERMS_SELECTION_MISSING",
    "必须由用户选择Incoterms 2020规则和指定地点",
    ["trade", "incotermsRule"],
  );
  block(!draft.trade.transportMode, "INTERNATIONAL_TRANSPORT_MISSING", "必须由用户选择运输方式", [
    "trade",
    "transportMode",
  ]);
  block(
    !draft.trade.exportClearanceParty,
    "INTERNATIONAL_EXPORT_CLEARANCE_UNDECIDED",
    "必须由用户选择出口清关责任方",
    ["trade", "exportClearanceParty"],
  );
  block(
    !draft.trade.importClearanceParty,
    "INTERNATIONAL_IMPORT_CLEARANCE_UNDECIDED",
    "必须由用户选择进口清关责任方",
    ["trade", "importClearanceParty"],
  );
  block(!draft.trade.insurance, "INTERNATIONAL_INSURANCE_MISSING", "必须由用户填写保险安排", [
    "trade",
    "insurance",
  ]);
  if (
    draft.trade.incotermsRule &&
    SEA_ONLY_RULES.has(draft.trade.incotermsRule) &&
    draft.trade.transportMode !== "sea"
  ) {
    findings.push(
      contractFinding(
        "INCOTERMS_SEA_MODE_REQUIRED",
        "error",
        "blockSubmission",
        "所选规则仅适用于海运或内河运输",
        ["trade", "transportMode"],
      ),
    );
  }
  block(!draft.payment.method, "INTERNATIONAL_PAYMENT_METHOD_MISSING", "必须由用户选择付款方式", [
    "payment",
    "method",
  ]);
  block(
    draft.legal.cisgChoice === "undecided",
    "INTERNATIONAL_CISG_UNDECIDED",
    "必须由用户决定是否适用或排除CISG",
    ["legal", "cisgChoice"],
  );
  block(
    !draft.legal.governingLaw,
    "INTERNATIONAL_GOVERNING_LAW_UNDECIDED",
    "必须由用户填写适用法",
    ["legal", "governingLaw"],
  );
  block(
    !draft.legal.disputeMethod,
    "INTERNATIONAL_DISPUTE_METHOD_UNDECIDED",
    "必须由用户选择争议解决方式",
    ["legal", "disputeMethod"],
  );
  block(
    !draft.legal.forum,
    "INTERNATIONAL_DISPUTE_FORUM_UNDECIDED",
    "必须由用户填写法院或仲裁机构及地点",
    ["legal", "forum"],
  );
  block(
    !draft.meta.languagePriority,
    "INTERNATIONAL_LANGUAGE_PRIORITY_UNDECIDED",
    "必须由用户选择合同优先语言",
    ["meta", "languagePriority"],
  );
  if (draft.goodsLines.some((line) => line.hsCodeUserSupplied)) {
    findings.push(
      contractFinding(
        "HS_CODE_USER_SUPPLIED_UNVERIFIED",
        "warning",
        "advisory",
        "HS编码由用户提供，系统未验证归类",
        ["goodsLines"],
      ),
    );
  }
  return freezeContractFindings(findings);
}

function unresolved(zhCN: string, enUS: string): LocalizedText {
  return localized(`待填写：${zhCN}`, `TBD: ${enUS}`);
}

function compileInternationalDraft(value: unknown): DocumentModelV2 {
  const draft = parseInternationalDraft(value);
  const findings = analyzeInternationalDraft(draft);
  const calculation =
    draft.price.currency && draft.price.taxMode
      ? calculateQuoteLinesV2(
          draft.goodsLines.map((line) => ({
            id: line.id,
            quantity: line.quantity,
            unitPriceMinor: line.unitPriceMinor,
            discountBps: line.discountBps,
            taxRateBps: line.taxRateBps,
          })),
          { currency: draft.price.currency, taxMode: draft.price.taxMode },
        )
      : undefined;
  const calculated = new Map(calculation?.lines.map((line) => [line.lineId, line.totalMinor]));
  const money = (minor: string) =>
    draft.price.currency ? formatMoneyMinorV2(minor, draft.price.currency) : "TBD";
  const bi = (zhCN: string, enUS: string): LocalizedText => ({ zhCN, enUS });
  const paragraph = (id: string, value: LocalizedText) => ({
    type: "paragraph" as const,
    id: `${id}-text`,
    text: value,
  });
  const section = (id: string, value: LocalizedText) => ({ id, blocks: [paragraph(id, value)] });
  const partyLabel = (value: "seller" | "buyer" | undefined) =>
    value === "seller"
      ? bi("卖方", "Seller")
      : value === "buyer"
        ? bi("买方", "Buyer")
        : unresolved("责任方", "responsible party");
  const sections = [
    {
      id: "bilingual-cover",
      blocks: [
        {
          type: "cover" as const,
          id: "international-cover",
          title: bi("国际货物销售合同", "INTERNATIONAL SALE OF GOODS CONTRACT"),
          subtitle: bi(draft.meta.contractNumber, draft.meta.contractNumber),
        },
      ],
    },
    {
      id: "meta",
      blocks: [
        {
          type: "keyValueGrid" as const,
          id: "international-meta",
          entries: [
            {
              id: "number",
              label: bi("合同编号", "Contract No."),
              value: bi(draft.meta.contractNumber, draft.meta.contractNumber),
            },
            {
              id: "date",
              label: bi("签署日期", "Signing Date"),
              value: bi(draft.meta.signingDate, draft.meta.signingDate),
            },
            {
              id: "place",
              label: bi("签署地点", "Signing Place"),
              value: bi(draft.meta.signingPlace ?? "待填写", draft.meta.signingPlace ?? "TBD"),
            },
          ],
        },
      ],
    },
    {
      id: "bilingual-parties",
      blocks: [
        {
          type: "parties" as const,
          id: "international-parties",
          parties: [
            {
              id: "seller",
              role: bi("卖方", "Seller"),
              name: bi(draft.seller.legalName, draft.seller.englishName ?? "TBD"),
              details: partyDetails(draft.seller, true),
            },
            {
              id: "buyer",
              role: bi("买方", "Buyer"),
              name: bi(draft.buyer.legalName, draft.buyer.englishName ?? "TBD"),
              details: partyDetails(draft.buyer, true),
            },
          ],
        },
      ],
    },
    section(
      "definitions",
      bi(
        "“货物”指本合同货品表所列产品；“Incoterms 2020”指国际商会发布的2020版规则。",
        '"Goods" means the products in the goods table; "Incoterms 2020" means the 2020 rules published by the ICC.',
      ),
    ),
    {
      id: "goods",
      blocks: [
        {
          type: "table" as const,
          id: "international-goods",
          columns: [
            { id: "name", label: bi("货物", "Goods"), width: "28%", align: "left" as const },
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
              name: bi(line.name, line.englishName),
              spec: line.specification ?? bi("未提供", "Not provided"),
              quantity: bi(
                `${line.quantity} ${line.unit.zhCN}`,
                `${line.quantity} ${line.unit.enUS}`,
              ),
              unitPrice: bi(money(line.unitPriceMinor), money(line.unitPriceMinor)),
              amount: calculated.has(line.id)
                ? bi(money(calculated.get(line.id) ?? "0"), money(calculated.get(line.id) ?? "0"))
                : unresolved("金额", "amount"),
            },
          })),
          repeatHeader: true,
          pagePolicy: { allowRowSplit: false, keepHeaderWithRows: 1 },
        },
      ],
    },
    {
      id: "price",
      blocks: [
        paragraph(
          "international-tax-mode",
          bi(
            `币种：${draft.price.currency ?? "待选择"}；计税口径：${draft.price.taxMode ?? "待选择"}`,
            `Currency: ${draft.price.currency ?? "TBD"}; tax mode: ${draft.price.taxMode ?? "TBD"}`,
          ),
        ),
        {
          type: "totals" as const,
          id: "international-total",
          entries: [
            {
              id: "total",
              label: bi("合同总价", "Contract Total"),
              value: calculation
                ? bi(money(calculation.summary.totalMinor), money(calculation.summary.totalMinor))
                : unresolved("合同总价", "contract total"),
            },
          ],
        },
        paragraph(
          "price-adjustment",
          draft.price.adjustment ?? unresolved("价格调整", "price adjustment"),
        ),
      ],
    },
    section(
      "incoterms-delivery-risk",
      bi(
        `贸易术语：${draft.trade.incotermsRule ?? "待选择"} Incoterms 2020；指定地点：${draft.trade.namedPlace?.zhCN ?? "待填写"}；${draft.acceptance.riskTransfer.zhCN}`,
        `Trade term: ${draft.trade.incotermsRule ?? "TBD"} Incoterms 2020; named place: ${draft.trade.namedPlace?.enUS ?? "TBD"}; ${draft.acceptance.riskTransfer.enUS}`,
      ),
    ),
    section(
      "shipment",
      bi(
        `装运期：${draft.trade.shipmentWindow.zhCN}；运输方式：${draft.trade.transportMode ?? "待选择"}；分批：${draft.trade.partialShipment ? "允许" : "不允许"}；转运：${draft.trade.transshipment ? "允许" : "不允许"}`,
        `Shipment window: ${draft.trade.shipmentWindow.enUS}; mode: ${draft.trade.transportMode ?? "TBD"}; partial shipment: ${draft.trade.partialShipment ? "allowed" : "not allowed"}; transshipment: ${draft.trade.transshipment ? "allowed" : "not allowed"}`,
      ),
    ),
    section(
      "clearance-insurance",
      bi(
        `出口清关：${partyLabel(draft.trade.exportClearanceParty).zhCN}；进口清关：${partyLabel(draft.trade.importClearanceParty).zhCN}；保险：${draft.trade.insurance?.zhCN ?? "待填写"}`,
        `Export clearance: ${partyLabel(draft.trade.exportClearanceParty).enUS}; import clearance: ${partyLabel(draft.trade.importClearanceParty).enUS}; insurance: ${draft.trade.insurance?.enUS ?? "TBD"}`,
      ),
    ),
    {
      id: "documents",
      blocks: [
        {
          type: "list" as const,
          id: "shipping-documents",
          ordered: false,
          items:
            draft.trade.shippingDocuments.length > 0
              ? draft.trade.shippingDocuments
              : [unresolved("装运单据", "shipping documents")],
        },
      ],
    },
    section(
      "inspection-claims",
      bi(
        `${draft.acceptance.inspection.zhCN}；${draft.acceptance.claimsPeriod.zhCN}`,
        `${draft.acceptance.inspection.enUS}; ${draft.acceptance.claimsPeriod.enUS}`,
      ),
    ),
    section("title", draft.acceptance.titleTransfer),
    section(
      "payment-bank",
      bi(
        `方式：${draft.payment.method ?? "待选择"}；${draft.payment.terms.zhCN}；${draft.payment.letterOfCreditTerms?.zhCN ?? "信用证条款不适用或待填写"}；${draft.payment.bankCharges.zhCN}`,
        `Method: ${draft.payment.method ?? "TBD"}; ${draft.payment.terms.enUS}; ${draft.payment.letterOfCreditTerms?.enUS ?? "L/C terms not applicable or TBD"}; ${draft.payment.bankCharges.enUS}`,
      ),
    ),
    section(
      "packaging-marks",
      bi(
        `${draft.performance.packaging.zhCN}；${draft.performance.shippingMarks.zhCN}`,
        `${draft.performance.packaging.enUS}; ${draft.performance.shippingMarks.enUS}`,
      ),
    ),
    section(
      "warranty-ip",
      bi(
        `${draft.performance.warranty.zhCN}；${draft.performance.intellectualProperty.zhCN}`,
        `${draft.performance.warranty.enUS}; ${draft.performance.intellectualProperty.enUS}`,
      ),
    ),
    section("compliance", draft.performance.sanctionsAndExportControlAcknowledgement),
    section("force-majeure-hardship", draft.performance.forceMajeureAndHardship),
    section("breach-remedies", draft.performance.breachRemedies),
    section(
      "cisg-governing-law",
      bi(
        `CISG选择：${draft.legal.cisgChoice}；适用法：${draft.legal.governingLaw?.zhCN ?? "待填写"}`,
        `CISG choice: ${draft.legal.cisgChoice}; governing law: ${draft.legal.governingLaw?.enUS ?? "TBD"}`,
      ),
    ),
    section(
      "dispute",
      bi(
        `方式：${draft.legal.disputeMethod ?? "待选择"}；机构/地点：${draft.legal.forum?.zhCN ?? "待填写"}`,
        `Method: ${draft.legal.disputeMethod ?? "TBD"}; forum/seat: ${draft.legal.forum?.enUS ?? "TBD"}`,
      ),
    ),
    section(
      "language-priority",
      draft.meta.languagePriority === "zh-CN"
        ? bi(
            "中英文不一致时，以中文为准。",
            "If the Chinese and English texts conflict, the Chinese text prevails.",
          )
        : draft.meta.languagePriority === "en-US"
          ? bi(
              "中英文不一致时，以英文为准。",
              "If the Chinese and English texts conflict, the English text prevails.",
            )
          : unresolved("优先语言", "priority language"),
    ),
    section("notices", draft.legal.notices),
    {
      id: "signatures",
      blocks: [
        {
          type: "signatureGroup" as const,
          id: "international-signatures",
          signers: signerBlocks(draft.signers, { seller: draft.seller, buyer: draft.buyer }),
        },
      ],
    },
  ];
  return DocumentModelV2Schema.parse({
    schemaVersion: "2.0.0",
    documentId: draft.id,
    template: { id: draft.templateId, version: draft.templateVersion, basisDate: "2026-08-19" },
    documentKind: "contract",
    language: "zh-en",
    title: bi("国际货物销售合同", "INTERNATIONAL SALE OF GOODS CONTRACT"),
    pageDefaults: {
      size: "A4",
      orientation: "portrait",
      marginsMm: { top: 14, right: 12, bottom: 14, left: 12 },
    },
    sections,
    watermarks: contractWatermarks(findings, true),
    disclaimers: ["international-choice-warning"],
    attachmentManifest: [],
  }) as DocumentModelV2;
}

export const INTERNATIONAL_SALE_CONTRACT_REGISTRATION: TemplateRegistration<
  InternationalSaleContractDraftV1,
  DocumentModelV2
> = Object.freeze({
  definition: INTERNATIONAL_SALE_CONTRACT_DEFINITION,
  parseDraft: parseInternationalDraft,
  createDraft: createInternationalDraft,
  createRepeatableItem(
    path: string,
    input: { readonly id: string; readonly now: string | Date; readonly draft: unknown },
  ) {
    if (path === "goodsLines") {
      return {
        id: input.id,
        name: "待填写",
        englishName: "TBD",
        unit: { zhCN: "件", enUS: "pcs" },
        quantity: "1",
        unitPriceMinor: "0",
        discountBps: 0,
        taxRateBps: 0,
      };
    }
    if (path === "trade.shippingDocuments") return { zhCN: "待填写", enUS: "TBD" };
    if (path === "signers") {
      return {
        partyId: input.id,
        role: { zhCN: "签署方", enUS: "Signatory" },
        dateLabel: { zhCN: "日期", enUS: "Date" },
        sealLabel: { zhCN: "盖章", enUS: "Seal" },
      };
    }
    throw new Error("不支持的重复项路径");
  },
  compile: compileInternationalDraft,
  preflight(value: unknown) {
    return analyzeInternationalDraft(parseInternationalDraft(value));
  },
});
