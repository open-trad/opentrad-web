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
import { DateV2Schema, ServiceLinesV2Schema, type ServiceLineV2 } from "../quote-common.js";
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

interface ServiceDeliverableV1 {
  readonly id: string;
  readonly name: string;
  readonly dueDate: string;
  readonly acceptanceStandard: string;
}

export interface CommercialServiceContractDraftV1 {
  readonly id: string;
  readonly templateId: "contract.service.commercial.v1";
  readonly templateVersion: "1.0.0";
  readonly meta: ContractMetaV2;
  readonly client: EntityPartyV2;
  readonly provider: EntityPartyV2;
  readonly engagement: {
    readonly type: "specific" | "general";
    readonly serviceMatter: string;
    readonly scope: string;
    readonly workRequirements: string;
    readonly serviceLocation: string;
    readonly startDate: string;
    readonly endDate: string;
    readonly reportingMethod: string;
    readonly clientDependencies: string;
  };
  readonly deliverables: readonly ServiceDeliverableV1[];
  readonly delegation: {
    readonly subcontractConsent: "allowed" | "written-consent" | "prohibited";
    readonly parallelEngagementConsent: "allowed" | "written-consent" | "prohibited";
  };
  readonly fees: {
    readonly currency?: "CNY" | "USD" | "EUR";
    readonly taxMode?: "tax-excluded" | "tax-included" | "tax-exempt";
    readonly model: "fixed" | "time-material" | "milestone";
    readonly lines: readonly ServiceLineV2[];
    readonly necessaryExpenses: string;
    readonly paymentSchedule: PaymentScheduleV1;
  };
  readonly acceptance: {
    readonly standard: string;
    readonly period: string;
    readonly deemedAcceptance?: string;
  };
  readonly rights: {
    readonly ipOwnership: "client" | "provider" | "shared" | "custom";
    readonly ipCustomText?: string;
    readonly dataHandling?: string;
    readonly personalDataInvolved: boolean;
    readonly personalDataTerms?: string;
    readonly confidentiality: string;
  };
  readonly agency: {
    readonly relationship: "no-agency" | "authorized-agency";
    readonly thirdPartyAuthority?: string;
  };
  readonly terminationAtWill: { readonly handling: string; readonly compensation: string };
  readonly generalTerms: ContractGeneralTermsV1;
  readonly signers: readonly ContractSignerV1[];
  readonly updatedAt: string;
}

const BusinessText = contractText(10_000);
const RequiredText = contractText(10_000, true);
const IsoInstantSchema = contractText(35, true).refine(
  (value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
  "Expected a canonical ISO instant",
);
const EngagementSchema = strictContractObject(
  {
    type: z.enum(["specific", "general"]),
    serviceMatter: BusinessText,
    scope: BusinessText,
    workRequirements: BusinessText,
    serviceLocation: BusinessText,
    startDate: DateV2Schema,
    endDate: DateV2Schema,
    reportingMethod: BusinessText,
    clientDependencies: BusinessText,
  },
  (engagement, addIssue) => {
    if (engagement.endDate < engagement.startDate) {
      addIssue({
        code: "custom",
        message: "Service end date must not precede start date",
        path: ["endDate"],
      });
    }
  },
);
const DeliverableSchema = strictContractObject({
  id: IdentifierV2Schema,
  name: RequiredText,
  dueDate: DateV2Schema,
  acceptanceStandard: RequiredText,
});
const DeliverablesSchema = isolatedArraySchema(DeliverableSchema, {
  min: 1,
  max: 100,
  refine: (rows, addIssue) => {
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      if (seen.has(row.id))
        addIssue({
          code: "custom",
          message: "Deliverable ids must be unique",
          path: [index, "id"],
        });
      seen.add(row.id);
    });
  },
});
const DelegationSchema = strictContractObject({
  subcontractConsent: z.enum(["allowed", "written-consent", "prohibited"]),
  parallelEngagementConsent: z.enum(["allowed", "written-consent", "prohibited"]),
});
const FeesSchema = strictContractObject({
  currency: CurrencyV2Schema.optional(),
  taxMode: TaxModeV2Schema.optional(),
  model: z.enum(["fixed", "time-material", "milestone"]),
  lines: ServiceLinesV2Schema,
  necessaryExpenses: BusinessText,
  paymentSchedule: PaymentScheduleV1Schema,
});
const AcceptanceSchema = strictContractObject({
  standard: BusinessText,
  period: BusinessText,
  deemedAcceptance: BusinessText.optional(),
});
const RightsSchema = strictContractObject(
  {
    ipOwnership: z.enum(["client", "provider", "shared", "custom"]),
    ipCustomText: BusinessText.optional(),
    dataHandling: BusinessText.optional(),
    personalDataInvolved: z.boolean(),
    personalDataTerms: BusinessText.optional(),
    confidentiality: BusinessText,
  },
  (rights, addIssue) => {
    if (rights.ipOwnership === "custom" && !rights.ipCustomText?.trim()) {
      addIssue({
        code: "custom",
        message: "Custom IP ownership requires authored terms",
        path: ["ipCustomText"],
      });
    }
    if (rights.ipOwnership !== "custom" && Object.hasOwn(rights, "ipCustomText")) {
      addIssue({
        code: "custom",
        message: "Custom IP terms require custom ownership",
        path: ["ipCustomText"],
      });
    }
  },
);
const AgencySchema = strictContractObject({
  relationship: z.enum(["no-agency", "authorized-agency"]),
  thirdPartyAuthority: BusinessText.optional(),
});
const TerminationAtWillSchema = strictContractObject({
  handling: BusinessText,
  compensation: BusinessText,
});

const CommercialServiceDraftRawSchema = strictContractObject(
  {
    id: IdentifierV2Schema,
    templateId: z.literal("contract.service.commercial.v1"),
    templateVersion: z.literal("1.0.0"),
    meta: ContractMetaV2Schema,
    client: ContractPartyV2Schema,
    provider: ContractPartyV2Schema,
    engagement: EngagementSchema,
    deliverables: DeliverablesSchema,
    delegation: DelegationSchema,
    fees: FeesSchema,
    acceptance: AcceptanceSchema,
    rights: RightsSchema,
    agency: AgencySchema,
    terminationAtWill: TerminationAtWillSchema,
    generalTerms: ContractGeneralTermsV1Schema,
    signers: ContractSignersV1Schema,
    updatedAt: IsoInstantSchema,
  },
  (draft, addIssue) => {
    if (
      draft.meta.language !== "zh-CN" ||
      !["modern-business.v1", "classic-formal.v1"].includes(draft.meta.layoutStyleId)
    ) {
      addIssue({
        code: "custom",
        message: "Commercial service presentation is invalid",
        path: ["meta"],
      });
    }
    validateSignerPartyReferences(draft.signers, ["client", "provider"], addIssue);
  },
);

export const CommercialServiceContractDraftV1Schema = frozenContractSchema(
  CommercialServiceDraftRawSchema,
  {
    arrayLimits: { deliverables: 100, lines: 100, paymentSchedule: 100, signers: 10 },
    maxTotalValues: 7_000,
  },
);

export const COMMERCIAL_SERVICE_CONTRACT_DEFINITION = {
  id: "contract.service.commercial.v1",
  version: "1.0.0",
  category: "contract",
  name: "商务服务合同",
  summary: "覆盖交付物、委托安排、数据、代理权限和任意解除的服务合同草案",
  basisDate: "2026-08-19",
  languages: ["zh-CN"],
  defaultLanguage: "zh-CN",
  allowedLayouts: ["modern-business.v1", "classic-formal.v1"],
  defaultLayout: "modern-business.v1",
  supportedOutputs: ["docx", "pdf", "json", "opentrad"],
  sourceKeys: ["samr-entrustment-2025", "prc-civil-code"],
  disclaimerProfile: "contract",
  fieldManifest: [
    {
      path: "engagement.serviceMatter",
      section: "service-matter",
      label: "服务事项",
      control: "textarea",
      required: true,
    },
    {
      path: "deliverables",
      section: "deliverables-reporting",
      label: "交付物",
      control: "repeatable",
      required: true,
    },
    {
      path: "fees.lines",
      section: "fees-expenses-payment",
      label: "服务费明细",
      control: "repeatable",
      required: true,
    },
    {
      path: "rights.personalDataInvolved",
      section: "ip-data-confidentiality",
      label: "涉及个人信息",
      control: "checkbox",
      required: true,
    },
    {
      path: "agency.relationship",
      section: "agency-third-party",
      label: "代理关系",
      control: "select",
      required: true,
    },
    {
      path: "terminationAtWill.compensation",
      section: "termination-at-will",
      label: "任意解除补偿",
      control: "textarea",
      required: true,
    },
  ],
} as const satisfies TemplateDefinitionV2;

function parseCommercialServiceDraft(value: unknown): CommercialServiceContractDraftV1 {
  return CommercialServiceContractDraftV1Schema.parse(value) as CommercialServiceContractDraftV1;
}

function createCommercialServiceDraft(input: { readonly id: string; readonly now: string | Date }) {
  const dates = contractDates(input.now);
  return parseCommercialServiceDraft({
    id: input.id,
    templateId: "contract.service.commercial.v1",
    templateVersion: "1.0.0",
    meta: {
      contractNumber: "待填写",
      title: "商务服务合同",
      signingDate: dates.signingDate,
      effectiveMode: "signature",
      copies: 2,
      language: "zh-CN",
      layoutStyleId: "modern-business.v1",
    },
    client: { legalName: "待填写", entityType: "company", contactName: "待填写" },
    provider: { legalName: "待填写", entityType: "company", contactName: "待填写" },
    engagement: {
      type: "specific",
      serviceMatter: "",
      scope: "",
      workRequirements: "",
      serviceLocation: "",
      startDate: dates.signingDate,
      endDate: dates.signingDate,
      reportingMethod: "",
      clientDependencies: "",
    },
    deliverables: [
      {
        id: "deliverable-1",
        name: "待填写",
        dueDate: dates.signingDate,
        acceptanceStandard: "待填写",
      },
    ],
    delegation: {
      subcontractConsent: "written-consent",
      parallelEngagementConsent: "written-consent",
    },
    fees: {
      model: "fixed",
      lines: [
        {
          id: "service-1",
          serviceName: "待填写",
          deliverable: "待填写",
          unit: "待填写",
          quantity: "1",
          unitPriceMinor: "0",
          discountBps: 0,
          taxRateBps: 0,
        },
      ],
      necessaryExpenses: "",
      paymentSchedule: [{ id: "payment", trigger: "待填写", amountBps: 10_000, dueDays: 0 }],
    },
    acceptance: { standard: "", period: "" },
    rights: { ipOwnership: "client", personalDataInvolved: false, confidentiality: "" },
    agency: { relationship: "no-agency" },
    terminationAtWill: { handling: "", compensation: "" },
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
        partyId: "client",
        role: localized("客户"),
        dateLabel: localized("日期"),
        sealLabel: localized("盖章"),
      },
      {
        partyId: "provider",
        role: localized("服务方"),
        dateLabel: localized("日期"),
        sealLabel: localized("盖章"),
      },
    ],
    updatedAt: dates.updatedAt,
  });
}

function hasPersonalDataElements(value: string): boolean {
  return [
    /目的/,
    /范围/,
    /(?:保存|保留).*期限|期限.*(?:保存|保留)/,
    /访问/,
    /删除/,
    /事件.*通知|通知.*事件/,
  ].every((pattern) => pattern.test(value));
}

function hasAgencyScopeAndDuration(value: string): boolean {
  return (
    /(?:权限)?范围/.test(value) &&
    /(?:授权)?期限|\d{4}-\d{2}-\d{2}.*(?:至|-).*\d{4}-\d{2}-\d{2}/.test(value)
  );
}

function analyzeCommercialServiceDraft(
  draft: CommercialServiceContractDraftV1,
): readonly RiskFindingV2[] {
  const findings: RiskFindingV2[] = [];
  const block = (missing: boolean, code: string, message: string, path: readonly string[]) => {
    if (missing) findings.push(contractFinding(code, "error", "blockSubmission", message, path));
  };
  block(!draft.fees.currency, "CONTRACT_CURRENCY_MISSING", "必须由用户选择合同币种", [
    "fees",
    "currency",
  ]);
  block(!draft.fees.taxMode, "CONTRACT_TAX_MODE_MISSING", "必须由用户选择含税口径", [
    "fees",
    "taxMode",
  ]);
  block(
    draft.rights.personalDataInvolved &&
      !hasPersonalDataElements(draft.rights.personalDataTerms ?? ""),
    "SERVICE_PERSONAL_DATA_TERMS_INCOMPLETE",
    "涉及个人信息时须约定目的、范围、保存期限、访问、删除和事件通知",
    ["rights", "personalDataTerms"],
  );
  block(
    draft.agency.relationship === "authorized-agency" &&
      !hasAgencyScopeAndDuration(draft.agency.thirdPartyAuthority ?? ""),
    "SERVICE_AGENCY_AUTHORITY_MISSING",
    "授权代理必须填写对第三方权限的范围与期限",
    ["agency", "thirdPartyAuthority"],
  );
  block(
    !draft.terminationAtWill.handling.trim(),
    "SERVICE_TERMINATION_HANDLING_MISSING",
    "必须填写任意解除后的处理安排",
    ["terminationAtWill", "handling"],
  );
  block(
    !draft.terminationAtWill.compensation.trim(),
    "SERVICE_TERMINATION_COMPENSATION_MISSING",
    "必须填写任意解除补偿安排",
    ["terminationAtWill", "compensation"],
  );
  return freezeContractFindings(findings);
}

function show(value?: string): string {
  return value?.trim() ? value : "待填写";
}

function compileCommercialServiceDraft(value: unknown): DocumentModelV2 {
  const draft = parseCommercialServiceDraft(value);
  const findings = analyzeCommercialServiceDraft(draft);
  const calculation =
    draft.fees.currency && draft.fees.taxMode
      ? calculateQuoteLinesV2(
          draft.fees.lines.map((line) => ({
            id: line.id,
            quantity: line.quantity,
            unitPriceMinor: line.unitPriceMinor,
            discountBps: line.discountBps,
            taxRateBps: line.taxRateBps,
          })),
          { currency: draft.fees.currency, taxMode: draft.fees.taxMode },
        )
      : undefined;
  const calculated = new Map(calculation?.lines.map((line) => [line.lineId, line.totalMinor]));
  const money = (minor: string) =>
    draft.fees.currency ? formatMoneyMinorV2(minor, draft.fees.currency) : "待选择币种";
  const paragraph = (id: string, value: string) => ({
    type: "paragraph" as const,
    id: `${id}-text`,
    text: localized(value),
  });
  const section = (id: string, value: string) => ({ id, blocks: [paragraph(id, value)] });
  const sections = [
    {
      id: "cover",
      blocks: [
        {
          type: "cover" as const,
          id: "service-cover",
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
          id: "service-parties",
          parties: [
            {
              id: "client",
              role: localized("客户"),
              name: localized(draft.client.legalName),
              details: partyDetails(draft.client),
            },
            {
              id: "provider",
              role: localized("服务方"),
              name: localized(draft.provider.legalName),
              details: partyDetails(draft.provider),
            },
          ],
        },
      ],
    },
    section(
      "service-matter",
      `类型：${draft.engagement.type}；事项：${show(draft.engagement.serviceMatter)}；范围：${show(draft.engagement.scope)}`,
    ),
    section("work-requirements", show(draft.engagement.workRequirements)),
    section(
      "term-location",
      `${draft.engagement.startDate}至${draft.engagement.endDate}；地点：${show(draft.engagement.serviceLocation)}`,
    ),
    {
      id: "deliverables-reporting",
      blocks: [
        {
          type: "table" as const,
          id: "deliverables-table",
          columns: [
            { id: "name", label: localized("交付物"), width: "35%", align: "left" as const },
            { id: "due", label: localized("到期日"), width: "20%", align: "center" as const },
            { id: "standard", label: localized("验收标准"), width: "45%", align: "left" as const },
          ],
          rows: draft.deliverables.map((item) => ({
            id: item.id,
            cells: {
              name: localized(item.name),
              due: localized(item.dueDate),
              standard: localized(item.acceptanceStandard),
            },
          })),
          repeatHeader: true,
          pagePolicy: { allowRowSplit: false, keepHeaderWithRows: 1 },
        },
        paragraph("reporting-method", `汇报方式：${show(draft.engagement.reportingMethod)}`),
      ],
    },
    section("client-dependencies", show(draft.engagement.clientDependencies)),
    section(
      "subcontract-parallel-engagement",
      `转委托：${draft.delegation.subcontractConsent}；平行委托：${draft.delegation.parallelEngagementConsent}`,
    ),
    {
      id: "fees-expenses-payment",
      blocks: [
        {
          type: "table" as const,
          id: "service-fees-table",
          columns: [
            { id: "service", label: localized("服务"), width: "30%", align: "left" as const },
            {
              id: "deliverable",
              label: localized("交付内容"),
              width: "25%",
              align: "left" as const,
            },
            { id: "quantity", label: localized("数量"), width: "15%", align: "right" as const },
            { id: "unitPrice", label: localized("单价"), width: "15%", align: "right" as const },
            { id: "amount", label: localized("金额"), width: "15%", align: "right" as const },
          ],
          rows: draft.fees.lines.map((line) => ({
            id: line.id,
            cells: {
              service: localized(line.serviceName),
              deliverable: localized(line.deliverable),
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
        paragraph(
          "service-tax-mode",
          `币种：${draft.fees.currency ?? "待选择"}；计税口径：${draft.fees.taxMode ?? "待选择"}`,
        ),
        {
          type: "totals" as const,
          id: "service-total",
          entries: [
            {
              id: "total",
              label: localized("服务费合计"),
              value: localized(
                calculation ? money(calculation.summary.totalMinor) : "待完善计价选择",
              ),
            },
          ],
        },
        paragraph("necessary-expenses", `必要费用：${show(draft.fees.necessaryExpenses)}`),
        {
          type: "list" as const,
          id: "service-payment",
          ordered: true,
          items: draft.fees.paymentSchedule.map((item) =>
            localized(
              `${item.trigger}：${(item.amountBps / 100).toFixed(2)}%，${item.dueDays}日内`,
            ),
          ),
        },
      ],
    },
    section(
      "acceptance",
      `标准：${show(draft.acceptance.standard)}；期限：${show(draft.acceptance.period)}；逾期处理：${show(draft.acceptance.deemedAcceptance)}`,
    ),
    section(
      "ip-data-confidentiality",
      `知识产权：${draft.rights.ipOwnership === "custom" ? show(draft.rights.ipCustomText) : draft.rights.ipOwnership}；数据：${show(draft.rights.dataHandling)}；个人信息：${draft.rights.personalDataInvolved ? show(draft.rights.personalDataTerms) : "不涉及"}；保密：${show(draft.rights.confidentiality)}`,
    ),
    section(
      "agency-third-party",
      `关系：${draft.agency.relationship}；第三方权限：${show(draft.agency.thirdPartyAuthority)}`,
    ),
    section(
      "rights-obligations",
      "客户应按约提供资料与协助；服务方应按约完成服务并报告影响履约的事项。",
    ),
    section("breach", draft.generalTerms.breachRemedies),
    section(
      "termination-at-will",
      `处理：${show(draft.terminationAtWill.handling)}；补偿：${show(draft.terminationAtWill.compensation)}`,
    ),
    {
      id: "general-terms",
      blocks: [
        {
          type: "list" as const,
          id: "service-general",
          ordered: false,
          items: [
            localized(draft.generalTerms.changeControl),
            localized(draft.generalTerms.forceMajeure),
            localized(draft.generalTerms.termination),
            localized(draft.generalTerms.governingLaw),
            localized(draft.generalTerms.noticeAddresses),
          ],
        },
      ],
    },
    {
      id: "signatures",
      blocks: [
        {
          type: "signatureGroup" as const,
          id: "service-signatures",
          signers: signerBlocks(draft.signers, { client: draft.client, provider: draft.provider }),
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
      marginsMm: { top: 16, right: 18, bottom: 16, left: 18 },
    },
    sections,
    watermarks: contractWatermarks(findings),
    disclaimers: ["contract-generation-note"],
    attachmentManifest: [],
  }) as DocumentModelV2;
}

export const COMMERCIAL_SERVICE_CONTRACT_REGISTRATION: TemplateRegistration<
  CommercialServiceContractDraftV1,
  DocumentModelV2
> = Object.freeze({
  definition: COMMERCIAL_SERVICE_CONTRACT_DEFINITION,
  parseDraft: parseCommercialServiceDraft,
  createDraft: createCommercialServiceDraft,
  compile: compileCommercialServiceDraft,
  preflight(value: unknown) {
    return analyzeCommercialServiceDraft(parseCommercialServiceDraft(value));
  },
});
