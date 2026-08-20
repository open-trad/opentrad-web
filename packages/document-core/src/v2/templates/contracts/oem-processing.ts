import { isolatedArraySchema } from "../../../safe-schema.js";
import { z } from "../../../zod.js";
import type { EntityPartyV2, TemplateDefinitionV2 } from "../../common.js";
import { type DocumentModelV2, DocumentModelV2Schema } from "../../document-model.js";
import {
  CurrencyV2Schema,
  calculateQuoteLinesV2,
  formatMoneyMinorV2,
  IdentifierV2Schema,
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
import { GoodsLinesV2Schema, type GoodsLineV2 } from "../quote-common.js";
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

interface ToolingRowV1 {
  readonly id: string;
  readonly name: string;
  readonly owner: "principal" | "processor" | "shared";
  readonly custody: string;
  readonly maintenance: string;
  readonly returnOrDisposal: string;
}

export interface OemProcessingContractDraftV1 {
  readonly id: string;
  readonly templateId: "contract.oem.processing.v1";
  readonly templateVersion: "1.0.0";
  readonly meta: ContractMetaV2;
  readonly principal: EntityPartyV2;
  readonly processor: EntityPartyV2;
  readonly products: readonly GoodsLineV2[];
  readonly technical: {
    readonly packageVersion: string;
    readonly drawingAttachmentIds: readonly string[];
    readonly sampleApproval: string;
    readonly engineeringChange: string;
  };
  readonly materials: {
    readonly mode: "principal-supplied" | "processor-supplied" | "mixed";
    readonly items: readonly string[];
    readonly yieldTarget?: string;
    readonly scrapHandling?: string;
    readonly returnMethod?: string;
  };
  readonly tooling: readonly ToolingRowV1[];
  readonly production: {
    readonly currency?: "CNY" | "USD" | "EUR";
    readonly taxMode?: "tax-excluded" | "tax-included" | "tax-exempt";
    readonly schedule: string;
    readonly processingFeeLines: readonly GoodsLineV2[];
    readonly paymentSchedule: PaymentScheduleV1;
  };
  readonly quality: {
    readonly standard: string;
    readonly inspection: string;
    readonly nonconformingProduct: string;
    readonly traceability?: string;
    readonly recall?: string;
  };
  readonly intellectualProperty: {
    readonly backgroundIp: string;
    readonly foregroundIp: string;
    readonly licenseScope?: string;
    readonly confidentiality: string;
  };
  readonly subcontracting: string;
  readonly terminationCompensation: string;
  readonly generalTerms: ContractGeneralTermsV1;
  readonly signers: readonly ContractSignerV1[];
  readonly attachments: readonly AttachmentRefV1[];
  readonly updatedAt: string;
}

const BusinessText = contractText(10_000);
const RequiredText = contractText(10_000, true);
const IsoInstantSchema = contractText(35, true).refine(
  (value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
  "Expected a canonical ISO instant",
);
const TechnicalSchema = strictContractObject({
  packageVersion: BusinessText,
  drawingAttachmentIds: isolatedArraySchema(contractText(200, true), { max: 100 }),
  sampleApproval: BusinessText,
  engineeringChange: BusinessText,
});
const MaterialsSchema = strictContractObject({
  mode: z.enum(["principal-supplied", "processor-supplied", "mixed"]),
  items: isolatedArraySchema(contractText(1_000, true), { max: 100 }),
  yieldTarget: BusinessText.optional(),
  scrapHandling: BusinessText.optional(),
  returnMethod: BusinessText.optional(),
});
const ToolingRowSchema = strictContractObject({
  id: IdentifierV2Schema,
  name: contractText(500, true),
  owner: z.enum(["principal", "processor", "shared"]),
  custody: RequiredText,
  maintenance: RequiredText,
  returnOrDisposal: RequiredText,
});
const ToolingSchema = isolatedArraySchema(ToolingRowSchema, {
  max: 100,
  refine: (rows, addIssue) => {
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      if (seen.has(row.id))
        addIssue({ code: "custom", message: "Tooling ids must be unique", path: [index, "id"] });
      seen.add(row.id);
    });
  },
});
const ProductionSchema = strictContractObject({
  currency: CurrencyV2Schema.optional(),
  taxMode: TaxModeV2Schema.optional(),
  schedule: BusinessText,
  processingFeeLines: GoodsLinesV2Schema,
  paymentSchedule: PaymentScheduleV1Schema,
});
const QualitySchema = strictContractObject({
  standard: BusinessText,
  inspection: BusinessText,
  nonconformingProduct: BusinessText,
  traceability: BusinessText.optional(),
  recall: BusinessText.optional(),
});
const IntellectualPropertySchema = strictContractObject({
  backgroundIp: BusinessText,
  foregroundIp: BusinessText,
  licenseScope: BusinessText.optional(),
  confidentiality: BusinessText,
});

const OemProcessingDraftRawSchema = strictContractObject(
  {
    id: IdentifierV2Schema,
    templateId: z.literal("contract.oem.processing.v1"),
    templateVersion: z.literal("1.0.0"),
    meta: ContractMetaV2Schema,
    principal: ContractPartyV2Schema,
    processor: ContractPartyV2Schema,
    products: GoodsLinesV2Schema,
    technical: TechnicalSchema,
    materials: MaterialsSchema,
    tooling: ToolingSchema,
    production: ProductionSchema,
    quality: QualitySchema,
    intellectualProperty: IntellectualPropertySchema,
    subcontracting: BusinessText,
    terminationCompensation: BusinessText,
    generalTerms: ContractGeneralTermsV1Schema,
    signers: ContractSignersV1Schema,
    attachments: ContractAttachmentRefsSchema,
    updatedAt: IsoInstantSchema,
  },
  (draft, addIssue) => {
    if (draft.meta.language !== "zh-CN" || draft.meta.layoutStyleId !== "classic-formal.v1") {
      addIssue({ code: "custom", message: "OEM contract presentation is fixed", path: ["meta"] });
    }
    validateSignerPartyReferences(draft.signers, ["principal", "processor"], addIssue);
    validateAttachmentReferences(
      draft.technical.drawingAttachmentIds,
      draft.attachments,
      ["technical", "drawingAttachmentIds"],
      addIssue,
    );
  },
);

export const OemProcessingContractDraftV1Schema = frozenContractSchema(
  OemProcessingDraftRawSchema,
  {
    arrayLimits: {
      products: 100,
      drawingAttachmentIds: 100,
      items: 100,
      tooling: 100,
      processingFeeLines: 100,
      paymentSchedule: 100,
      signers: 10,
      attachments: 100,
    },
    maxTotalValues: 8_000,
  },
);

export const OEM_PROCESSING_CONTRACT_DEFINITION = {
  id: "contract.oem.processing.v1",
  version: "1.0.0",
  category: "contract",
  name: "OEM加工合同",
  summary: "覆盖技术包、来料、模具、生产、知识产权和终止结算的加工合同草案",
  basisDate: "2026-08-19",
  languages: ["zh-CN"],
  defaultLanguage: "zh-CN",
  allowedLayouts: ["classic-formal.v1"],
  defaultLayout: "classic-formal.v1",
  supportedOutputs: ["docx", "pdf", "json", "opentrad"],
  sourceKeys: ["prc-civil-code", "samr-entrustment-2025"],
  disclaimerProfile: "contract",
  fieldManifest: [
    {
      path: "technical.packageVersion",
      section: "technical-documents",
      label: "技术包版本",
      control: "text",
      required: true,
    },
    {
      path: "technical.drawingAttachmentIds",
      section: "technical-documents",
      label: "图纸附件",
      control: "attachment",
      required: true,
    },
    {
      path: "materials.mode",
      section: "materials",
      label: "来料模式",
      control: "select",
      required: true,
    },
    { path: "tooling", section: "tooling", label: "模具", control: "repeatable", required: false },
    {
      path: "intellectualProperty.foregroundIp",
      section: "ip-license",
      label: "新增知识产权",
      control: "textarea",
      required: true,
    },
    {
      path: "terminationCompensation",
      section: "termination-compensation",
      label: "终止补偿",
      control: "textarea",
      required: true,
    },
  ],
} as const satisfies TemplateDefinitionV2;

function parseOemDraft(value: unknown): OemProcessingContractDraftV1 {
  return OemProcessingContractDraftV1Schema.parse(value) as OemProcessingContractDraftV1;
}

function createOemDraft(input: { readonly id: string; readonly now: string | Date }) {
  const dates = contractDates(input.now);
  return parseOemDraft({
    id: input.id,
    templateId: "contract.oem.processing.v1",
    templateVersion: "1.0.0",
    meta: {
      contractNumber: "待填写",
      title: "OEM加工合同",
      signingDate: dates.signingDate,
      effectiveMode: "signature",
      copies: 2,
      language: "zh-CN",
      layoutStyleId: "classic-formal.v1",
    },
    principal: { legalName: "待填写", entityType: "company", contactName: "待填写" },
    processor: { legalName: "待填写", entityType: "company", contactName: "待填写" },
    products: [
      {
        id: "product-1",
        name: "待填写",
        unit: "待填写",
        quantity: "1",
        unitPriceMinor: "0",
        discountBps: 0,
        taxRateBps: 0,
      },
    ],
    technical: {
      packageVersion: "",
      drawingAttachmentIds: [],
      sampleApproval: "",
      engineeringChange: "",
    },
    materials: { mode: "processor-supplied", items: [] },
    tooling: [],
    production: {
      schedule: "",
      processingFeeLines: [
        {
          id: "fee-1",
          name: "待填写",
          unit: "待填写",
          quantity: "1",
          unitPriceMinor: "0",
          discountBps: 0,
          taxRateBps: 0,
        },
      ],
      paymentSchedule: [{ id: "payment", trigger: "待填写", amountBps: 10_000, dueDays: 0 }],
    },
    quality: { standard: "", inspection: "", nonconformingProduct: "" },
    intellectualProperty: { backgroundIp: "", foregroundIp: "", confidentiality: "" },
    subcontracting: "",
    terminationCompensation: "",
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
        partyId: "principal",
        role: localized("委托方"),
        dateLabel: localized("日期"),
        sealLabel: localized("盖章"),
      },
      {
        partyId: "processor",
        role: localized("加工方"),
        dateLabel: localized("日期"),
        sealLabel: localized("盖章"),
      },
    ],
    attachments: [],
    updatedAt: dates.updatedAt,
  });
}

function analyzeOemDraft(draft: OemProcessingContractDraftV1): readonly RiskFindingV2[] {
  const findings: RiskFindingV2[] = [];
  const block = (missing: boolean, code: string, message: string, path: readonly string[]) => {
    if (missing) findings.push(contractFinding(code, "error", "blockSubmission", message, path));
  };
  block(!draft.production.currency, "CONTRACT_CURRENCY_MISSING", "必须由用户选择合同币种", [
    "production",
    "currency",
  ]);
  block(!draft.production.taxMode, "CONTRACT_TAX_MODE_MISSING", "必须由用户选择含税口径", [
    "production",
    "taxMode",
  ]);
  const supplied =
    draft.materials.mode === "principal-supplied" || draft.materials.mode === "mixed";
  block(
    supplied && !draft.materials.yieldTarget?.trim(),
    "OEM_MATERIAL_YIELD_MISSING",
    "委托方供料或混合供料必须约定良率",
    ["materials", "yieldTarget"],
  );
  block(
    supplied && !draft.materials.scrapHandling?.trim(),
    "OEM_MATERIAL_SCRAP_MISSING",
    "委托方供料或混合供料必须约定废料处理",
    ["materials", "scrapHandling"],
  );
  block(
    supplied && !draft.materials.returnMethod?.trim(),
    "OEM_MATERIAL_RETURN_MISSING",
    "委托方供料或混合供料必须约定余料返还",
    ["materials", "returnMethod"],
  );
  block(
    !draft.intellectualProperty.backgroundIp.trim(),
    "OEM_BACKGROUND_IP_MISSING",
    "必须约定背景知识产权",
    ["intellectualProperty", "backgroundIp"],
  );
  block(
    !draft.intellectualProperty.foregroundIp.trim(),
    "OEM_FOREGROUND_IP_MISSING",
    "必须约定新增知识产权",
    ["intellectualProperty", "foregroundIp"],
  );
  block(!draft.subcontracting.trim(), "OEM_SUBCONTRACTING_MISSING", "必须约定分包规则", [
    "subcontracting",
  ]);
  block(
    !draft.technical.engineeringChange.trim(),
    "OEM_ENGINEERING_CHANGE_MISSING",
    "必须约定工程变更流程",
    ["technical", "engineeringChange"],
  );
  block(
    !draft.terminationCompensation.trim(),
    "OEM_TERMINATION_COMPENSATION_MISSING",
    "必须约定终止补偿和在制品结算",
    ["terminationCompensation"],
  );
  return freezeContractFindings(findings);
}

function show(value?: string): string {
  return value?.trim() ? value : "待填写";
}

function compileOemDraft(value: unknown): DocumentModelV2 {
  const draft = parseOemDraft(value);
  const findings = analyzeOemDraft(draft);
  const calculation =
    draft.production.currency && draft.production.taxMode
      ? calculateQuoteLinesV2(
          draft.production.processingFeeLines.map((line) => ({
            id: line.id,
            quantity: line.quantity,
            unitPriceMinor: line.unitPriceMinor,
            discountBps: line.discountBps,
            taxRateBps: line.taxRateBps,
          })),
          { currency: draft.production.currency, taxMode: draft.production.taxMode },
        )
      : undefined;
  const calculated = new Map(calculation?.lines.map((line) => [line.lineId, line.totalMinor]));
  const money = (minor: string) =>
    draft.production.currency ? formatMoneyMinorV2(minor, draft.production.currency) : "待选择币种";
  const paragraph = (id: string, value: string) => ({
    type: "paragraph" as const,
    id: `${id}-text`,
    text: localized(value),
  });
  const section = (id: string, value: string) => ({ id, blocks: [paragraph(id, value)] });
  const goodsTable = (id: string, lines: readonly GoodsLineV2[], amounts = false) => ({
    type: "table" as const,
    id,
    columns: [
      { id: "name", label: localized("项目"), width: "40%", align: "left" as const },
      { id: "quantity", label: localized("数量"), width: "20%", align: "right" as const },
      { id: "unitPrice", label: localized("单价"), width: "20%", align: "right" as const },
      { id: "amount", label: localized("金额"), width: "20%", align: "right" as const },
    ],
    rows: lines.map((line) => ({
      id: line.id,
      cells: {
        name: localized(`${line.name}${line.specification ? ` / ${line.specification}` : ""}`),
        quantity: localized(`${line.quantity} ${line.unit}`),
        unitPrice: localized(amounts ? money(line.unitPriceMinor) : "不作为产品销售价"),
        amount: localized(
          amounts && calculated.has(line.id) ? money(calculated.get(line.id) ?? "0") : "不适用",
        ),
      },
    })),
    repeatHeader: true,
    pagePolicy: { allowRowSplit: false, keepHeaderWithRows: 1 },
  });
  const sections = [
    {
      id: "cover",
      blocks: [
        {
          type: "cover" as const,
          id: "oem-cover",
          title: localized(draft.meta.title),
          subtitle: localized(draft.meta.contractNumber),
        },
      ],
    },
    section("meta", `合同编号：${draft.meta.contractNumber}；签署日期：${draft.meta.signingDate}`),
    {
      id: "parties",
      blocks: [
        {
          type: "parties" as const,
          id: "oem-parties",
          parties: [
            {
              id: "principal",
              role: localized("委托方"),
              name: localized(draft.principal.legalName),
              details: partyDetails(draft.principal),
            },
            {
              id: "processor",
              role: localized("加工方"),
              name: localized(draft.processor.legalName),
              details: partyDetails(draft.processor),
            },
          ],
        },
      ],
    },
    { id: "commissioned-products", blocks: [goodsTable("products-table", draft.products)] },
    {
      id: "technical-documents",
      blocks: [
        paragraph("technical-documents", `技术包版本：${show(draft.technical.packageVersion)}`),
        {
          type: "attachmentIndex" as const,
          id: "drawing-index",
          attachmentIds: draft.technical.drawingAttachmentIds,
        },
      ],
    },
    section("sample-approval", show(draft.technical.sampleApproval)),
    section(
      "materials",
      `模式：${draft.materials.mode}；物料：${draft.materials.items.join("；") || "待填写"}；良率：${show(draft.materials.yieldTarget)}；废料：${show(draft.materials.scrapHandling)}；返还：${show(draft.materials.returnMethod)}`,
    ),
    {
      id: "tooling",
      blocks: [
        {
          type: "table" as const,
          id: "tooling-table",
          columns: [
            { id: "name", label: localized("模具"), width: "22%", align: "left" as const },
            { id: "owner", label: localized("权属"), width: "18%", align: "center" as const },
            { id: "custody", label: localized("保管"), width: "20%", align: "left" as const },
            { id: "maintenance", label: localized("维护"), width: "20%", align: "left" as const },
            { id: "return", label: localized("返还/处置"), width: "20%", align: "left" as const },
          ],
          rows: draft.tooling.map((tool) => ({
            id: tool.id,
            cells: {
              name: localized(tool.name),
              owner: localized(tool.owner),
              custody: localized(tool.custody),
              maintenance: localized(tool.maintenance),
              return: localized(tool.returnOrDisposal),
            },
          })),
          repeatHeader: true,
          pagePolicy: { allowRowSplit: false, keepHeaderWithRows: 1 },
        },
      ],
    },
    section("production-schedule", show(draft.production.schedule)),
    {
      id: "fees-payment",
      blocks: [
        goodsTable("fee-table", draft.production.processingFeeLines, true),
        paragraph(
          "production-tax-mode",
          `币种：${draft.production.currency ?? "待选择"}；计税口径：${draft.production.taxMode ?? "待选择"}`,
        ),
        {
          type: "totals" as const,
          id: "fee-total",
          entries: [
            {
              id: "total",
              label: localized("加工费合计"),
              value: localized(
                calculation ? money(calculation.summary.totalMinor) : "待完善计价选择",
              ),
            },
          ],
        },
        {
          type: "list" as const,
          id: "oem-payment",
          ordered: true,
          items: draft.production.paymentSchedule.map((item) =>
            localized(
              `${item.trigger}：${(item.amountBps / 100).toFixed(2)}%，${item.dueDays}日内`,
            ),
          ),
        },
      ],
    },
    section(
      "quality-inspection",
      `质量标准：${show(draft.quality.standard)}；检验：${show(draft.quality.inspection)}；追溯：${show(draft.quality.traceability)}`,
    ),
    section(
      "nonconformance-recall",
      `不合格品：${show(draft.quality.nonconformingProduct)}；召回：${show(draft.quality.recall)}`,
    ),
    section("engineering-change", show(draft.technical.engineeringChange)),
    section(
      "ip-license",
      `背景知识产权：${show(draft.intellectualProperty.backgroundIp)}；新增知识产权：${show(draft.intellectualProperty.foregroundIp)}；许可：${show(draft.intellectualProperty.licenseScope)}`,
    ),
    section(
      "confidentiality-subcontracting",
      `保密：${show(draft.intellectualProperty.confidentiality)}；分包：${show(draft.subcontracting)}`,
    ),
    section("termination-compensation", show(draft.terminationCompensation)),
    {
      id: "general-terms",
      blocks: [
        {
          type: "list" as const,
          id: "oem-general",
          ordered: false,
          items: [
            localized(draft.generalTerms.changeControl),
            localized(draft.generalTerms.forceMajeure),
            localized(draft.generalTerms.breachRemedies),
            localized(draft.generalTerms.termination),
            localized(draft.generalTerms.governingLaw),
            localized(draft.generalTerms.noticeAddresses),
          ],
        },
      ],
    },
    {
      id: "attachments",
      blocks: [
        {
          type: "attachmentIndex" as const,
          id: "oem-attachment-index",
          attachmentIds: draft.attachments.map((attachment) => attachment.id),
        },
      ],
    },
    {
      id: "signatures",
      blocks: [
        {
          type: "signatureGroup" as const,
          id: "oem-signatures",
          signers: signerBlocks(draft.signers, {
            principal: draft.principal,
            processor: draft.processor,
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
    attachmentManifest: exportedAttachments(draft.attachments),
  }) as DocumentModelV2;
}

export const OEM_PROCESSING_CONTRACT_REGISTRATION: TemplateRegistration<
  OemProcessingContractDraftV1,
  DocumentModelV2
> = Object.freeze({
  definition: OEM_PROCESSING_CONTRACT_DEFINITION,
  parseDraft: parseOemDraft,
  createDraft: createOemDraft,
  compile: compileOemDraft,
  preflight(value: unknown) {
    return analyzeOemDraft(parseOemDraft(value));
  },
});
