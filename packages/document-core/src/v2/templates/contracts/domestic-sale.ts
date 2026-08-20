import { isolatedArraySchema } from "../../../safe-schema.js";
import { z } from "../../../zod.js";
import type { EntityPartyV2, TemplateDefinitionV2 } from "../../common.js";
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
  type PaymentScheduleV1,
  PaymentScheduleV1Schema,
} from "../contract-common.js";
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
  validateSignerPartyReferences,
} from "./shared.js";

interface DomesticGoodsLineV1 {
  readonly id: string;
  readonly name: string;
  readonly sku?: string;
  readonly specification?: string;
  readonly description?: string;
  readonly unit: string;
  readonly quantity: string;
  readonly unitPriceMinor: string;
  readonly discountBps: number;
  readonly taxRateBps?: number;
  readonly brand?: string;
  readonly manufacturer?: string;
  readonly qualityStandard: string;
}

export interface DomesticSaleContractDraftV1 {
  readonly id: string;
  readonly templateId: "contract.sale.domestic-b2b.v1";
  readonly templateVersion: "1.0.0";
  readonly meta: ContractMetaV2;
  readonly seller: EntityPartyV2;
  readonly buyer: EntityPartyV2;
  readonly goodsLines: readonly DomesticGoodsLineV1[];
  readonly price: {
    readonly currency?: "CNY" | "USD" | "EUR";
    readonly taxMode?: "tax-excluded" | "tax-included" | "tax-exempt";
    readonly invoiceType?: "vat-special" | "vat-general" | "other";
    readonly invoiceTiming: string;
    readonly paymentSchedule: PaymentScheduleV1;
    readonly retentionBps?: number;
  };
  readonly delivery: {
    readonly method: "seller-delivery" | "buyer-pickup" | "carrier";
    readonly time: string;
    readonly place: string;
    readonly packaging: string;
    readonly freightAllocation: string;
    readonly insuranceAllocation?: string;
    readonly titleTransfer: string;
    readonly riskTransfer: string;
    readonly documents: readonly string[];
  };
  readonly acceptance: {
    readonly inspectionStandard: string;
    readonly inspectionMethod: string;
    readonly inspectionPeriod: string;
    readonly objectionMethod: string;
    readonly warranty: string;
    readonly afterSales: string;
  };
  readonly generalTerms: ContractGeneralTermsV1;
  readonly signers: readonly ContractSignerV1[];
  readonly attachments: readonly AttachmentRefV1[];
  readonly updatedAt: string;
}

const RequiredText = contractText(10_000, true);
const BusinessText = contractText(10_000);
const IsoInstantSchema = contractText(35, true).refine(
  (value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
  "Expected a canonical ISO instant",
);

const DomesticGoodsLineSchema = strictContractObject({
  id: IdentifierV2Schema,
  name: contractText(500, true),
  sku: contractText(300).optional(),
  specification: contractText(2_000).optional(),
  description: contractText(5_000).optional(),
  unit: contractText(100, true),
  quantity: QuantityV2Schema,
  unitPriceMinor: MoneyMinorV2Schema,
  discountBps: BasisPointsV2Schema,
  taxRateBps: BasisPointsV2Schema.optional(),
  brand: contractText(300).optional(),
  manufacturer: contractText(500).optional(),
  qualityStandard: RequiredText,
});

const DomesticGoodsLinesSchema = isolatedArraySchema(DomesticGoodsLineSchema, {
  min: 1,
  max: 100,
  refine: (lines, addIssue) => {
    const seen = new Set<string>();
    lines.forEach((line, index) => {
      if (seen.has(line.id)) {
        addIssue({ code: "custom", message: "Goods line ids must be unique", path: [index, "id"] });
      }
      seen.add(line.id);
    });
  },
});

const PriceSchema = strictContractObject({
  currency: CurrencyV2Schema.optional(),
  taxMode: TaxModeV2Schema.optional(),
  invoiceType: z.enum(["vat-special", "vat-general", "other"]).optional(),
  invoiceTiming: BusinessText,
  paymentSchedule: PaymentScheduleV1Schema,
  retentionBps: BasisPointsV2Schema.optional(),
});

const DeliverySchema = strictContractObject({
  method: z.enum(["seller-delivery", "buyer-pickup", "carrier"]),
  time: BusinessText,
  place: BusinessText,
  packaging: BusinessText,
  freightAllocation: BusinessText,
  insuranceAllocation: BusinessText.optional(),
  titleTransfer: BusinessText,
  riskTransfer: BusinessText,
  documents: isolatedArraySchema(contractText(500, true), { max: 50 }),
});

const AcceptanceSchema = strictContractObject({
  inspectionStandard: BusinessText,
  inspectionMethod: BusinessText,
  inspectionPeriod: BusinessText,
  objectionMethod: BusinessText,
  warranty: BusinessText,
  afterSales: BusinessText,
});

const DomesticSaleContractDraftRawSchema = strictContractObject(
  {
    id: IdentifierV2Schema,
    templateId: z.literal("contract.sale.domestic-b2b.v1"),
    templateVersion: z.literal("1.0.0"),
    meta: ContractMetaV2Schema,
    seller: ContractPartyV2Schema,
    buyer: ContractPartyV2Schema,
    goodsLines: DomesticGoodsLinesSchema,
    price: PriceSchema,
    delivery: DeliverySchema,
    acceptance: AcceptanceSchema,
    generalTerms: ContractGeneralTermsV1Schema,
    signers: ContractSignersV1Schema,
    attachments: ContractAttachmentRefsSchema,
    updatedAt: IsoInstantSchema,
  },
  (draft, addIssue) => {
    if (draft.meta.language !== "zh-CN" || draft.meta.layoutStyleId !== "classic-formal.v1") {
      addIssue({
        code: "custom",
        message: "Domestic contract presentation is fixed",
        path: ["meta"],
      });
    }
    validateSignerPartyReferences(draft.signers, ["seller", "buyer"], addIssue);
  },
);

export const DomesticSaleContractDraftV1Schema = frozenContractSchema(
  DomesticSaleContractDraftRawSchema,
  {
    arrayLimits: {
      goodsLines: 100,
      paymentSchedule: 100,
      signers: 10,
      attachments: 100,
      documents: 50,
    },
    maxTotalValues: 6_000,
  },
);

export const DOMESTIC_SALE_CONTRACT_DEFINITION = {
  id: "contract.sale.domestic-b2b.v1",
  version: "1.0.0",
  category: "contract",
  name: "国内货物销售合同",
  summary: "用于境内企业间货物销售安排的可编辑合同草案",
  basisDate: "2026-08-19",
  languages: ["zh-CN"],
  defaultLanguage: "zh-CN",
  allowedLayouts: ["classic-formal.v1"],
  defaultLayout: "classic-formal.v1",
  supportedOutputs: ["docx", "pdf", "json", "opentrad"],
  sourceKeys: ["prc-civil-code", "samr-contract-library"],
  disclaimerProfile: "contract",
  fieldManifest: [
    {
      path: "goodsLines",
      section: "subject-goods",
      label: "商品明细",
      control: "repeatable",
      required: true,
    },
    {
      path: "price.currency",
      section: "price-tax-invoice",
      label: "币种",
      control: "select",
      required: true,
    },
    {
      path: "price.taxMode",
      section: "price-tax-invoice",
      label: "计税口径",
      control: "select",
      required: true,
    },
    {
      path: "price.invoiceType",
      section: "price-tax-invoice",
      label: "发票类型",
      control: "select",
      required: true,
    },
    {
      path: "delivery.riskTransfer",
      section: "title-risk",
      label: "风险转移",
      control: "textarea",
      required: true,
    },
    {
      path: "acceptance.inspectionPeriod",
      section: "inspection-acceptance",
      label: "检验期限",
      control: "textarea",
      required: true,
    },
  ],
} as const satisfies TemplateDefinitionV2;

function parseDomesticDraft(value: unknown): DomesticSaleContractDraftV1 {
  return DomesticSaleContractDraftV1Schema.parse(value) as DomesticSaleContractDraftV1;
}

function createDomesticDraft(input: { readonly id: string; readonly now: string | Date }) {
  const dates = contractDates(input.now);
  return parseDomesticDraft({
    id: input.id,
    templateId: "contract.sale.domestic-b2b.v1",
    templateVersion: "1.0.0",
    meta: {
      contractNumber: "待填写",
      title: "国内货物销售合同",
      signingDate: dates.signingDate,
      effectiveMode: "signature",
      copies: 2,
      language: "zh-CN",
      layoutStyleId: "classic-formal.v1",
    },
    seller: { legalName: "待填写", entityType: "company", contactName: "待填写" },
    buyer: { legalName: "待填写", entityType: "company", contactName: "待填写" },
    goodsLines: [
      {
        id: "goods-1",
        name: "待填写",
        unit: "待填写",
        quantity: "1",
        unitPriceMinor: "0",
        discountBps: 0,
        qualityStandard: "待填写",
      },
    ],
    price: {
      invoiceTiming: "",
      paymentSchedule: [{ id: "payment", trigger: "待填写", amountBps: 10_000, dueDays: 0 }],
    },
    delivery: {
      method: "seller-delivery",
      time: "",
      place: "",
      packaging: "",
      freightAllocation: "",
      titleTransfer: "",
      riskTransfer: "",
      documents: [],
    },
    acceptance: {
      inspectionStandard: "",
      inspectionMethod: "",
      inspectionPeriod: "",
      objectionMethod: "",
      warranty: "",
      afterSales: "",
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
        partyId: "seller",
        role: localized("卖方"),
        dateLabel: localized("签署日期"),
        sealLabel: localized("盖章"),
      },
      {
        partyId: "buyer",
        role: localized("买方"),
        dateLabel: localized("签署日期"),
        sealLabel: localized("盖章"),
      },
    ],
    attachments: [],
    updatedAt: dates.updatedAt,
  });
}

function analyzeDomesticDraft(draft: DomesticSaleContractDraftV1): readonly RiskFindingV2[] {
  const findings: RiskFindingV2[] = [];
  const required = (missing: boolean, code: string, message: string, path: readonly string[]) => {
    if (missing) findings.push(contractFinding(code, "error", "blockSubmission", message, path));
  };
  required(!draft.price.currency, "CONTRACT_CURRENCY_MISSING", "必须由用户选择合同币种", [
    "price",
    "currency",
  ]);
  required(!draft.price.taxMode, "CONTRACT_TAX_MODE_MISSING", "必须由用户选择含税口径", [
    "price",
    "taxMode",
  ]);
  required(!draft.price.invoiceType, "DOMESTIC_INVOICE_TYPE_MISSING", "必须由用户选择发票类型", [
    "price",
    "invoiceType",
  ]);
  required(
    !draft.price.invoiceTiming.trim(),
    "DOMESTIC_INVOICE_TIMING_MISSING",
    "必须填写开票时点",
    ["price", "invoiceTiming"],
  );
  required(
    !draft.delivery.riskTransfer.trim(),
    "DOMESTIC_RISK_TRANSFER_MISSING",
    "必须填写风险转移规则",
    ["delivery", "riskTransfer"],
  );
  required(
    !draft.acceptance.inspectionPeriod.trim(),
    "DOMESTIC_INSPECTION_PERIOD_MISSING",
    "必须填写检验期限",
    ["acceptance", "inspectionPeriod"],
  );
  required(
    !draft.acceptance.objectionMethod.trim(),
    "DOMESTIC_OBJECTION_METHOD_MISSING",
    "必须填写异议方式",
    ["acceptance", "objectionMethod"],
  );
  required(
    draft.goodsLines.some((line) => line.taxRateBps === undefined),
    "DOMESTIC_TAX_RATE_MISSING",
    "税率须由用户逐项填写",
    ["goodsLines"],
  );
  return freezeContractFindings(findings);
}

function display(value: string | undefined): string {
  return value?.trim() ? value : "待填写";
}

function compileDomesticDraft(value: unknown): DocumentModelV2 {
  const draft = parseDomesticDraft(value);
  const findings = analyzeDomesticDraft(draft);
  const publicAttachments = exportedAttachments(draft.attachments);
  const calculation =
    draft.price.currency &&
    draft.price.taxMode &&
    draft.goodsLines.every((line) => line.taxRateBps !== undefined)
      ? calculateQuoteLinesV2(
          draft.goodsLines.map((line) => ({
            id: line.id,
            quantity: line.quantity,
            unitPriceMinor: line.unitPriceMinor,
            discountBps: line.discountBps,
            taxRateBps: line.taxRateBps as number,
          })),
          { currency: draft.price.currency, taxMode: draft.price.taxMode },
        )
      : undefined;
  const calculatedById = new Map(calculation?.lines.map((line) => [line.lineId, line]));
  const money = (minor: string) =>
    draft.price.currency ? formatMoneyMinorV2(minor, draft.price.currency) : "待选择币种";
  const sections = [
    {
      id: "cover",
      blocks: [
        {
          type: "cover" as const,
          id: "contract-cover",
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
          id: "contract-meta",
          entries: [
            {
              id: "number",
              label: localized("合同编号"),
              value: localized(draft.meta.contractNumber),
            },
            { id: "date", label: localized("签署日期"), value: localized(draft.meta.signingDate) },
            {
              id: "place",
              label: localized("签署地点"),
              value: localized(display(draft.meta.signingPlace)),
            },
            {
              id: "copies",
              label: localized("合同份数"),
              value: localized(String(draft.meta.copies)),
            },
          ],
        },
      ],
    },
    {
      id: "parties",
      blocks: [
        {
          type: "parties" as const,
          id: "contract-parties",
          parties: [
            {
              id: "seller",
              role: localized("卖方"),
              name: localized(draft.seller.legalName),
              details: partyDetails(draft.seller),
            },
            {
              id: "buyer",
              role: localized("买方"),
              name: localized(draft.buyer.legalName),
              details: partyDetails(draft.buyer),
            },
          ],
        },
      ],
    },
    {
      id: "subject-goods",
      blocks: [
        {
          type: "table" as const,
          id: "goods-table",
          columns: [
            { id: "name", label: localized("商品"), width: "24%", align: "left" as const },
            {
              id: "spec",
              label: localized("品牌/规格/标准"),
              width: "30%",
              align: "left" as const,
            },
            { id: "quantity", label: localized("数量"), width: "14%", align: "right" as const },
            { id: "unitPrice", label: localized("单价"), width: "14%", align: "right" as const },
            { id: "amount", label: localized("金额"), width: "18%", align: "right" as const },
          ],
          rows: draft.goodsLines.map((line) => ({
            id: line.id,
            cells: {
              name: localized(line.name),
              spec: localized(
                [line.brand, line.manufacturer, line.specification, line.qualityStandard]
                  .filter(Boolean)
                  .join(" / "),
              ),
              quantity: localized(`${line.quantity} ${line.unit}`),
              unitPrice: localized(money(line.unitPriceMinor)),
              amount: localized(
                calculatedById.has(line.id)
                  ? money(calculatedById.get(line.id)?.totalMinor ?? "0")
                  : "待完善计价选择",
              ),
            },
          })),
          repeatHeader: true,
          pagePolicy: { allowRowSplit: false, keepHeaderWithRows: 1 },
        },
      ],
    },
    {
      id: "price-tax-invoice",
      blocks: [
        {
          type: "keyValueGrid" as const,
          id: "price-grid",
          entries: [
            {
              id: "currency",
              label: localized("币种"),
              value: localized(draft.price.currency ?? "待选择"),
            },
            {
              id: "tax",
              label: localized("含税口径"),
              value: localized(draft.price.taxMode ?? "待选择"),
            },
            {
              id: "invoice",
              label: localized("发票类型"),
              value: localized(draft.price.invoiceType ?? "待选择"),
            },
            {
              id: "timing",
              label: localized("开票时点"),
              value: localized(display(draft.price.invoiceTiming)),
            },
          ],
        },
        {
          type: "totals" as const,
          id: "contract-total",
          entries: [
            {
              id: "total",
              label: localized("合同总价"),
              value: localized(
                calculation ? money(calculation.summary.totalMinor) : "待完善计价选择",
              ),
            },
          ],
        },
      ],
    },
    {
      id: "payment",
      blocks: [
        {
          type: "list" as const,
          id: "payment-schedule",
          ordered: true,
          items: draft.price.paymentSchedule.map((item) =>
            localized(
              `${item.trigger}：${(item.amountBps / 100).toFixed(2)}%，${item.dueDays}日内`,
            ),
          ),
        },
        ...(draft.price.retentionBps === undefined
          ? []
          : [
              {
                type: "notice" as const,
                id: "retention-note",
                tone: "info" as const,
                paragraphs: [
                  localized(
                    `留存比例为 ${(draft.price.retentionBps / 100).toFixed(2)}%；留存比例属于付款进度分配，不从合同总价重复扣减。`,
                  ),
                ],
              },
            ]),
      ],
    },
    {
      id: "delivery-packaging",
      blocks: [
        {
          type: "clauseGroup" as const,
          id: "delivery-clauses",
          title: localized("交付与包装"),
          clauses: [
            {
              id: "delivery",
              number: "1",
              title: localized("交付"),
              paragraphs: [
                localized(
                  `${display(draft.delivery.time)}；${display(draft.delivery.place)}；${draft.delivery.method}`,
                ),
              ],
            },
            {
              id: "packaging",
              number: "2",
              title: localized("包装与费用"),
              paragraphs: [
                localized(
                  `${display(draft.delivery.packaging)}；运费：${display(draft.delivery.freightAllocation)}；保险：${display(draft.delivery.insuranceAllocation)}`,
                ),
              ],
            },
          ],
        },
      ],
    },
    {
      id: "title-risk",
      blocks: [
        {
          type: "paragraph" as const,
          id: "title-transfer",
          text: localized(`所有权转移：${display(draft.delivery.titleTransfer)}`),
        },
        {
          type: "paragraph" as const,
          id: "risk-transfer",
          text: localized(`风险转移：${display(draft.delivery.riskTransfer)}`),
        },
      ],
    },
    {
      id: "inspection-acceptance",
      blocks: [
        {
          type: "clauseGroup" as const,
          id: "inspection-clauses",
          title: localized("检验与异议"),
          clauses: [
            {
              id: "inspection",
              number: "1",
              title: localized("检验"),
              paragraphs: [
                localized(
                  `${display(draft.acceptance.inspectionStandard)}；${display(draft.acceptance.inspectionMethod)}；期限：${display(draft.acceptance.inspectionPeriod)}`,
                ),
              ],
            },
            {
              id: "objection",
              number: "2",
              title: localized("异议"),
              paragraphs: [localized(display(draft.acceptance.objectionMethod))],
            },
          ],
        },
      ],
    },
    {
      id: "quality-warranty",
      blocks: [
        {
          type: "paragraph" as const,
          id: "quality-warranty-text",
          text: localized(
            `质保：${display(draft.acceptance.warranty)}；售后：${display(draft.acceptance.afterSales)}`,
          ),
        },
      ],
    },
    {
      id: "parties-obligations",
      blocks: [
        {
          type: "paragraph" as const,
          id: "obligations-text",
          text: localized("双方应按约提供履约所需资料、协助并及时通知影响履约的事项。"),
        },
      ],
    },
    {
      id: "breach-termination",
      blocks: [
        {
          type: "clauseGroup" as const,
          id: "breach-termination-clauses",
          title: localized("违约与解除"),
          clauses: [
            {
              id: "breach",
              number: "1",
              title: localized("违约责任"),
              paragraphs: [localized(draft.generalTerms.breachRemedies)],
            },
            {
              id: "termination",
              number: "2",
              title: localized("解除"),
              paragraphs: [localized(draft.generalTerms.termination)],
            },
          ],
        },
      ],
    },
    {
      id: "force-majeure",
      blocks: [
        {
          type: "paragraph" as const,
          id: "force-majeure-text",
          text: localized(draft.generalTerms.forceMajeure),
        },
      ],
    },
    {
      id: "notices",
      blocks: [
        {
          type: "paragraph" as const,
          id: "notices-text",
          text: localized(draft.generalTerms.noticeAddresses),
        },
      ],
    },
    {
      id: "governing-law-dispute",
      blocks: [
        {
          type: "paragraph" as const,
          id: "law-dispute-text",
          text: localized(
            `${draft.generalTerms.governingLaw}；${draft.generalTerms.disputeMethod === "court" ? draft.generalTerms.court : draft.generalTerms.arbitrationCommission}`,
          ),
        },
      ],
    },
    {
      id: "miscellaneous",
      blocks: [
        {
          type: "list" as const,
          id: "misc-list",
          ordered: false,
          items: [
            localized(draft.generalTerms.confidentiality),
            localized(draft.generalTerms.changeControl),
            localized(draft.generalTerms.severability),
            localized(draft.generalTerms.entireAgreement),
          ],
        },
      ],
    },
    {
      id: "attachments",
      blocks: [
        {
          type: "attachmentIndex" as const,
          id: "attachment-index",
          attachmentIds: publicAttachments.map((attachment) => attachment.id),
        },
      ],
    },
    {
      id: "signatures",
      blocks: [
        {
          type: "signatureGroup" as const,
          id: "contract-signatures",
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

export const DOMESTIC_SALE_CONTRACT_REGISTRATION: TemplateRegistration<
  DomesticSaleContractDraftV1,
  DocumentModelV2
> = Object.freeze({
  definition: DOMESTIC_SALE_CONTRACT_DEFINITION,
  parseDraft: parseDomesticDraft,
  createDraft: createDomesticDraft,
  compile: compileDomesticDraft,
  preflight(value: unknown) {
    return analyzeDomesticDraft(parseDomesticDraft(value));
  },
});
