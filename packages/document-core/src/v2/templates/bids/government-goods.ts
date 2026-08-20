import { boundedCompositeSchema } from "../../../boundaries.js";
import { isolatedArraySchema, isolatedObjectSchema } from "../../../safe-schema.js";
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
import { type RiskFindingV2, RiskFindingV2Schema } from "../../risk.js";
import {
  type BidDraftBaseV1,
  BidDraftBaseV1Schema,
  decideBidExport,
  preflightBidCommon,
  type RequirementResponseV1,
  RequirementResponseV1Schema,
} from "../bid-common.js";

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export const BID_BASE_KEYS = Object.freeze([
  "id",
  "templateId",
  "templateVersion",
  "source",
  "bidder",
  "authorizedRepresentative",
  "consortiumMembers",
  "requirements",
  "qualifications",
  "evidenceRefs",
  "businessDeviations",
  "technicalDeviations",
  "projectReferences",
  "attachments",
  "priceDeclaration",
  "bidGuarantee",
  "signSealChecklist",
  "finalReviewers",
  "updatedAt",
] as const);

interface SafeIssue {
  readonly code: "custom";
  readonly message: string;
  readonly path?: PropertyKey[];
}

type ObjectOutput<Shape extends z.ZodRawShape> = z.output<z.ZodObject<Shape>>;

export function bidText(maximumLength: number, required = false) {
  const htmlPattern = /<(?:!doctype|!--|\/?\s*[a-zA-Z][^>]*)>/i;
  return z
    .string()
    .max(maximumLength)
    .refine((value) => !required || value.trim().length > 0, "Required text is blank")
    .refine((value) => {
      for (let index = 0; index < value.length; index += 1) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
          const next = value.charCodeAt(index + 1);
          if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return false;
          index += 1;
          continue;
        }
        if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
        if (codeUnit === 0x09 || codeUnit === 0x0a || codeUnit === 0x0d) continue;
        if (codeUnit < 0x20 || codeUnit === 0xfffe || codeUnit === 0xffff) return false;
      }
      return true;
    }, "Text is not XML 1.0 safe")
    .refine((value) => !htmlPattern.test(value), "HTML is not allowed");
}

export function strictBidObject<const Shape extends z.ZodRawShape>(
  shape: Shape,
  refine?: (value: ObjectOutput<Shape>, addIssue: (issue: SafeIssue) => void) => void,
) {
  const isolated = isolatedObjectSchema(shape, refine);
  const allowedKeys = new Set(Object.keys(shape));
  return z.transform<unknown, ObjectOutput<Shape>>((input, context) => {
    try {
      if (input !== null && typeof input === "object" && !Array.isArray(input)) {
        const prototype = Object.getPrototypeOf(input);
        if (prototype !== Object.prototype && prototype !== null) {
          context.addIssue({ code: "custom", message: "Custom object prototypes are not allowed" });
        }
        for (const key of Reflect.ownKeys(input)) {
          const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
          if (
            typeof key !== "string" ||
            !allowedKeys.has(key) ||
            DANGEROUS_KEYS.has(key) ||
            !descriptor ||
            !("value" in descriptor) ||
            descriptor.value === undefined
          ) {
            context.addIssue({
              code: "custom",
              message: "Unknown, dangerous, accessor, or undefined bid field",
              path: typeof key === "string" ? [key] : [],
            });
          }
        }
      }
      if (context.issues.length > 0) return z.NEVER;
      const result = isolated.safeParse(input);
      if (!result.success) {
        for (const issue of result.error.issues) context.addIssue({ ...issue });
        return z.NEVER;
      }
      return result.data;
    } catch {
      context.addIssue({ code: "custom", message: "Bid object validation failed safely" });
      return z.NEVER;
    }
  });
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new Error("Validated bid output must contain only own data properties");
    }
    deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function defineData(target: object, key: PropertyKey, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

export function createSpecializedBidSchema<Specialized extends z.ZodType>(
  templateId: BidDraftBaseV1["templateId"],
  specializedKeys: readonly string[],
  specializedSchema: Specialized,
  crossValidate?: (
    draft: BidDraftBaseV1 & z.output<Specialized>,
    addIssue: (issue: SafeIssue) => void,
  ) => void,
) {
  const baseKeys = new Set<string>(BID_BASE_KEYS);
  const specializedKeySet = new Set(specializedKeys);
  const allowedKeys = new Set([...BID_BASE_KEYS, ...specializedKeys]);
  const combined = z.transform<unknown, BidDraftBaseV1 & z.output<Specialized>>(
    (input, context) => {
      try {
        if (input === null || typeof input !== "object" || Array.isArray(input)) {
          context.addIssue({ code: "custom", message: "Bid draft must be a plain object" });
          return z.NEVER;
        }
        const prototype = Object.getPrototypeOf(input);
        if (prototype !== Object.prototype && prototype !== null) {
          context.addIssue({
            code: "custom",
            message: "Custom bid draft prototypes are not allowed",
          });
          return z.NEVER;
        }
        const baseInput = Object.create(null) as Record<string, unknown>;
        const specializedInput = Object.create(null) as Record<string, unknown>;
        for (const key of Reflect.ownKeys(input)) {
          const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
          if (
            typeof key !== "string" ||
            !allowedKeys.has(key) ||
            DANGEROUS_KEYS.has(key) ||
            !descriptor ||
            !("value" in descriptor) ||
            descriptor.value === undefined
          ) {
            context.addIssue({
              code: "custom",
              message: "Unknown, dangerous, accessor, or undefined bid draft field",
              path: typeof key === "string" ? [key] : [],
            });
            continue;
          }
          if (baseKeys.has(key)) defineData(baseInput, key, descriptor.value);
          if (specializedKeySet.has(key)) defineData(specializedInput, key, descriptor.value);
        }
        if (context.issues.length > 0) return z.NEVER;
        const base = BidDraftBaseV1Schema.safeParse(baseInput);
        const specialized = specializedSchema.safeParse(specializedInput);
        if (!base.success) {
          for (const issue of base.error.issues) context.addIssue({ ...issue });
        }
        if (!specialized.success) {
          for (const issue of specialized.error.issues) context.addIssue({ ...issue });
        }
        if (!base.success || !specialized.success) return z.NEVER;
        if (base.data.templateId !== templateId) {
          context.addIssue({
            code: "custom",
            message: "Bid draft template id does not match its registration",
            path: ["templateId"],
          });
          return z.NEVER;
        }
        const output = Object.create(null) as BidDraftBaseV1 & z.output<Specialized>;
        for (const key of Reflect.ownKeys(base.data)) {
          const descriptor = Reflect.getOwnPropertyDescriptor(base.data, key);
          if (!descriptor || !("value" in descriptor)) throw new Error("Invalid base output");
          defineData(output, key, descriptor.value);
        }
        const specializedOutput = specialized.data as object;
        for (const key of Reflect.ownKeys(specializedOutput)) {
          const descriptor = Reflect.getOwnPropertyDescriptor(specializedOutput, key);
          if (!descriptor || !("value" in descriptor))
            throw new Error("Invalid specialized output");
          defineData(output, key, descriptor.value);
        }
        crossValidate?.(output, (issue) => context.addIssue({ ...issue }));
        return context.issues.length === 0 ? deepFreeze(output) : z.NEVER;
      } catch {
        context.addIssue({ code: "custom", message: "Bid draft validation failed safely" });
        return z.NEVER;
      }
    },
  );
  return boundedCompositeSchema(combined, {
    arrayLimits: {
      allowedMethods: 10,
      attachments: 100,
      businessDeviations: 200,
      clarificationAttachments: 100,
      clarificationIds: 100,
      consortiumMembers: 20,
      evidenceAttachmentIds: 100,
      evidenceRefIds: 100,
      evidenceRefs: 100,
      finalReviewers: 100,
      goodsOfferLines: 100,
      policyDeclarations: 100,
      projectReferences: 100,
      qualifications: 200,
      requirements: 500,
      signSealChecklist: 100,
      sourceRefIds: 100,
      technicalDeviations: 200,
      technicalMatrix: 500,
      businessMatrix: 500,
    },
    maxTotalValues: 12_000,
  });
}

export function bidLocalized(zhCN: string): LocalizedText {
  return { zhCN };
}

export function show(value: string | undefined): string {
  return value?.trim() ? value : "未提供";
}

export function bidFinding(code: string, message: string, path?: readonly string[]): RiskFindingV2 {
  return RiskFindingV2Schema.parse({
    code,
    severity: "error",
    impact: "blockSubmission",
    message,
    ...(path === undefined ? {} : { path }),
  });
}

export function freezeBidFindings(findings: readonly RiskFindingV2[]): readonly RiskFindingV2[] {
  return Object.freeze([...findings]);
}

export function commonBidFindings(draft: BidDraftBaseV1): RiskFindingV2[] {
  return [...preflightBidCommon(projectBidBaseDraft(draft))];
}

export function projectBidBaseDraft(draft: BidDraftBaseV1): BidDraftBaseV1 {
  const projected = Object.create(null) as Record<string, unknown>;
  for (const key of BID_BASE_KEYS) {
    const descriptor = Reflect.getOwnPropertyDescriptor(draft, key);
    if (descriptor && "value" in descriptor) defineData(projected, key, descriptor.value);
  }
  return BidDraftBaseV1Schema.parse(projected);
}

export function sourceRefLabel(draft: BidDraftBaseV1, ids: readonly string[]): string {
  const byId = new Map(draft.evidenceRefs.map((item) => [item.id, item]));
  return ids
    .map((id) => {
      const ref = byId.get(id);
      return ref?.kind === "solicitation" ? ref.sourceRef : id;
    })
    .join("；");
}

export function requirementMatrixRows(
  draft: BidDraftBaseV1,
  requirements: readonly RequirementResponseV1[],
) {
  return requirements.map((item) => ({
    id: item.id,
    sourceRef: sourceRefLabel(draft, item.sourceRefIds),
    substantial: item.substantial,
    cells: {
      requirement: bidLocalized(item.requirementText),
      response: bidLocalized(show(item.responseText)),
      offered: bidLocalized(show(item.offeredValue)),
      compliance: bidLocalized(item.compliance),
      evidence: bidLocalized(
        item.evidenceRefIds.length > 0 ? item.evidenceRefIds.join("；") : "未提供",
      ),
    },
  }));
}

export const REQUIREMENT_MATRIX_COLUMNS = Object.freeze([
  { id: "requirement", label: bidLocalized("招标要求"), width: "28%", align: "left" as const },
  { id: "response", label: bidLocalized("投标响应"), width: "28%", align: "left" as const },
  { id: "offered", label: bidLocalized("响应值"), width: "15%", align: "left" as const },
  { id: "compliance", label: bidLocalized("符合性"), width: "12%", align: "center" as const },
  { id: "evidence", label: bidLocalized("证据引用"), width: "17%", align: "left" as const },
]);

export function createBidBaseDraft(
  templateId: BidDraftBaseV1["templateId"],
  input: { readonly id: string; readonly now: string | Date },
) {
  const instant = new Date(input.now);
  if (!Number.isFinite(instant.getTime())) throw new Error("Expected a valid instant");
  const updatedAt = instant.toISOString();
  return {
    id: input.id,
    templateId,
    templateVersion: "1.0.0" as const,
    source: {
      issuer: "未绑定",
      projectName: "未绑定",
      projectNumber: "未绑定",
      versionLabel: "未绑定",
      issueDate: "",
      clarificationIds: [],
      versionEvidence: {
        clarificationAttachments: [],
        allClarificationsIncluded: false,
        userConfirmedExactVersion: false,
      },
      bidDeadline: "",
      bidValidityDays: 90,
      submissionMode: "electronic" as const,
      signatureRules: "未绑定",
      currency: "CNY" as const,
      taxBasis: "as-specified" as const,
      evaluationMethod: "other" as const,
      jointVentureAllowed: false,
      subcontractAllowed: false,
      submissionCopies: { original: 0, copies: 0, electronic: 1 },
      guaranteeRequirement: { required: false, allowedMethods: [], sourceRefIds: [] },
    },
    bidder: { legalName: "待填写", entityType: "company" as const, contactName: "待填写" },
    consortiumMembers: [],
    requirements: [],
    qualifications: [],
    evidenceRefs: [],
    businessDeviations: [],
    technicalDeviations: [],
    projectReferences: [],
    attachments: [],
    priceDeclaration: {
      itemizedTotalMinor: "0",
      bidLetterTotalMinor: "0",
      openingTotalMinor: "0",
      userConfirmed: false,
    },
    signSealChecklist: [],
    finalReviewers: [],
    updatedAt,
  };
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

const PlansSchema = strictBidObject({
  delivery: bidText(10_000, true),
  installation: bidText(10_000, true).optional(),
  training: bidText(10_000, true).optional(),
  acceptance: bidText(10_000, true),
  warranty: bidText(10_000, true),
  afterSales: bidText(10_000, true),
});

const PolicyDeclarationSchema = strictBidObject({
  id: IdentifierV2Schema,
  policyName: bidText(500, true),
  statement: bidText(10_000, true),
  evidenceAttachmentIds: isolatedArraySchema(IdentifierV2Schema, { max: 100 }),
  applicable: z.boolean(),
  userConfirmedTruth: z.boolean(),
});

function uniqueIds(
  values: readonly { readonly id: string }[],
  addIssue: (issue: SafeIssue) => void,
) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      addIssue({
        code: "custom",
        message: "Specialized bid ids must be unique",
        path: [index, "id"],
      });
    }
    seen.add(value.id);
  });
}

const GovernmentGoodsSpecializedSchema = strictBidObject({
  coreProduct: bidText(500, true).optional(),
  goodsOfferLines: isolatedArraySchema(GoodsOfferLineSchema, {
    max: 100,
    refine: uniqueIds,
  }),
  technicalMatrix: isolatedArraySchema(RequirementResponseV1Schema, {
    max: 500,
    refine: uniqueIds,
  }),
  businessMatrix: isolatedArraySchema(RequirementResponseV1Schema, {
    max: 500,
    refine: uniqueIds,
  }),
  plans: PlansSchema,
  policyDeclarations: isolatedArraySchema(PolicyDeclarationSchema, {
    max: 100,
    refine: uniqueIds,
  }),
});

export interface GovernmentGoodsBidDraftV1 extends BidDraftBaseV1 {
  readonly templateId: "bid.government.goods.v1";
  readonly coreProduct?: string;
  readonly goodsOfferLines: readonly z.output<typeof GoodsOfferLineSchema>[];
  readonly technicalMatrix: readonly RequirementResponseV1[];
  readonly businessMatrix: readonly RequirementResponseV1[];
  readonly plans: z.output<typeof PlansSchema>;
  readonly policyDeclarations: readonly z.output<typeof PolicyDeclarationSchema>[];
}

const GOVERNMENT_GOODS_SPECIALIZED_KEYS = Object.freeze([
  "coreProduct",
  "goodsOfferLines",
  "technicalMatrix",
  "businessMatrix",
  "plans",
  "policyDeclarations",
]);

export const GovernmentGoodsBidDraftV1Schema = createSpecializedBidSchema(
  "bid.government.goods.v1",
  GOVERNMENT_GOODS_SPECIALIZED_KEYS,
  GovernmentGoodsSpecializedSchema,
  (draft, addIssue) => {
    const requirementIds = new Set(draft.requirements.map((item) => item.id));
    const attachmentIds = new Set(draft.attachments.map((item) => item.id));
    const matrixIds = new Set<string>();
    for (const [field, expectedCategory, matrix] of [
      ["technicalMatrix", "technical", draft.technicalMatrix],
      ["businessMatrix", "commercial", draft.businessMatrix],
    ] as const) {
      matrix.forEach((item, index) => {
        if (!requirementIds.has(item.id)) {
          addIssue({
            code: "custom",
            message: "Matrix row must reference a canonical requirement",
            path: [field, index, "id"],
          });
        }
        if (matrixIds.has(item.id)) {
          addIssue({
            code: "custom",
            message: "Requirement can appear in only one specialized matrix",
            path: [field, index, "id"],
          });
        }
        matrixIds.add(item.id);
        if (item.category !== expectedCategory) {
          addIssue({
            code: "custom",
            message: "Matrix row category does not match the matrix",
            path: [field, index, "category"],
          });
        }
      });
    }
    draft.policyDeclarations.forEach((policy, policyIndex) => {
      policy.evidenceAttachmentIds.forEach((attachmentId, evidenceIndex) => {
        if (!attachmentIds.has(attachmentId)) {
          addIssue({
            code: "custom",
            message: "Policy evidence attachment does not exist",
            path: ["policyDeclarations", policyIndex, "evidenceAttachmentIds", evidenceIndex],
          });
        }
      });
    });
  },
);

export const GOVERNMENT_GOODS_BID_DEFINITION = {
  id: "bid.government.goods.v1",
  version: "1.0.0",
  category: "bid",
  name: "政府采购货物投标文件",
  summary: "以项目招标文件及澄清版本为唯一项目依据的政府采购货物投标底稿",
  basisDate: "2026-08-19",
  languages: ["zh-CN"],
  defaultLanguage: "zh-CN",
  allowedLayouts: ["classic-formal.v1"],
  defaultLayout: "classic-formal.v1",
  supportedOutputs: ["docx", "pdf", "json", "opentrad"],
  sourceKeys: ["mof-order-87", "mof-demand-management"],
  disclaimerProfile: "bid",
  fieldManifest: [
    {
      path: "source.versionEvidence.mainSolicitationAttachmentId",
      section: "source-baseline",
      label: "项目招标文件",
      control: "attachment",
      required: true,
    },
    {
      path: "goodsOfferLines",
      section: "itemized-price",
      label: "货物明细",
      control: "repeatable",
      required: true,
    },
    {
      path: "technicalMatrix",
      section: "technical-response",
      label: "技术响应矩阵",
      control: "repeatable",
      required: true,
    },
    {
      path: "businessMatrix",
      section: "business-response",
      label: "商务响应矩阵",
      control: "repeatable",
      required: true,
    },
    {
      path: "policyDeclarations",
      section: "policy-declarations",
      label: "政府采购政策声明",
      control: "repeatable",
      required: false,
    },
    {
      path: "plans.delivery",
      section: "delivery-installation",
      label: "交付方案",
      control: "textarea",
      required: true,
    },
    {
      path: "plans.acceptance",
      section: "training-acceptance",
      label: "验收方案",
      control: "textarea",
      required: true,
    },
    {
      path: "plans.warranty",
      section: "warranty-aftersales",
      label: "质保方案",
      control: "textarea",
      required: true,
    },
  ],
} as const satisfies TemplateDefinitionV2;

function parseGovernmentGoodsDraft(value: unknown): GovernmentGoodsBidDraftV1 {
  return GovernmentGoodsBidDraftV1Schema.parse(value) as GovernmentGoodsBidDraftV1;
}

function createGovernmentGoodsDraft(input: { readonly id: string; readonly now: string | Date }) {
  return parseGovernmentGoodsDraft({
    ...createBidBaseDraft("bid.government.goods.v1", input),
    goodsOfferLines: [],
    technicalMatrix: [],
    businessMatrix: [],
    plans: {
      delivery: "待填写",
      installation: "待填写",
      training: "待填写",
      acceptance: "待填写",
      warranty: "待填写",
      afterSales: "待填写",
    },
    policyDeclarations: [],
  });
}

function calculateGoods(draft: GovernmentGoodsBidDraftV1) {
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

function analyzeGovernmentGoodsDraft(draft: GovernmentGoodsBidDraftV1): readonly RiskFindingV2[] {
  const findings = commonBidFindings(draft);
  if (draft.goodsOfferLines.length === 0) {
    findings.push(
      bidFinding("BID_GOODS_LINES_MISSING", "至少需要一项由用户提供的货物报价明细", [
        "goodsOfferLines",
      ]),
    );
  }
  if (draft.technicalMatrix.length === 0) {
    findings.push(
      bidFinding("BID_TECHNICAL_MATRIX_MISSING", "技术响应矩阵尚未提供", ["technicalMatrix"]),
    );
  }
  if (draft.businessMatrix.length === 0) {
    findings.push(
      bidFinding("BID_BUSINESS_MATRIX_MISSING", "商务响应矩阵尚未提供", ["businessMatrix"]),
    );
  }
  if (draft.source.taxBasis === "as-specified") {
    findings.push(
      bidFinding("BID_GOODS_TAX_BASIS_UNRESOLVED", "须按项目招标文件确认报价含税口径", [
        "source",
        "taxBasis",
      ]),
    );
  }
  const calculation = calculateGoods(draft);
  if (
    calculation &&
    [
      draft.priceDeclaration.itemizedTotalMinor,
      draft.priceDeclaration.bidLetterTotalMinor,
      draft.priceDeclaration.openingTotalMinor,
    ].some((total) => total !== calculation.summary.totalMinor)
  ) {
    findings.push(
      bidFinding("BID_GOODS_CALCULATED_TOTAL_MISMATCH", "货物明细重算总价与投标报价声明不一致", [
        "priceDeclaration",
      ]),
    );
  }
  const attachments = new Map(draft.attachments.map((item) => [item.id, item]));
  draft.policyDeclarations.forEach((policy, index) => {
    if (
      policy.applicable &&
      (!policy.userConfirmedTruth ||
        policy.evidenceAttachmentIds.length === 0 ||
        policy.evidenceAttachmentIds.some((id) => {
          const attachment = attachments.get(id);
          return attachment?.status !== "attached" || !attachment.includedInSubmission;
        }))
    ) {
      findings.push(
        bidFinding(
          "BID_POLICY_DECLARATION_UNVERIFIED",
          "适用的政策声明须经用户确认并具有已纳入的证据附件",
          ["policyDeclarations", String(index)],
        ),
      );
    }
  });
  return freezeBidFindings(findings);
}

function compileGovernmentGoodsDraft(value: unknown): DocumentModelV2 {
  const draft = parseGovernmentGoodsDraft(value);
  const findings = analyzeGovernmentGoodsDraft(draft);
  const decision = decideBidExport({
    draft: projectBidBaseDraft(draft),
    findings,
    asOf: draft.updatedAt,
  });
  const calculation = calculateGoods(draft);
  const calculatedLines = new Map(calculation?.lines.map((line) => [line.lineId, line.totalMinor]));
  const money = (minor: string) => formatMoneyMinorV2(minor, draft.source.currency);
  const paragraph = (id: string, text: string) => ({
    type: "paragraph" as const,
    id,
    text: bidLocalized(text),
  });
  const simpleSection = (id: string, text: string) => ({
    id,
    blocks: [paragraph(`${id}-text`, text)],
  });
  const confirmedPolicies = draft.policyDeclarations.filter(
    (policy) => policy.applicable && policy.userConfirmedTruth,
  );
  const deviations = [...draft.businessDeviations, ...draft.technicalDeviations];
  const sections = [
    {
      id: "draft-cover",
      blocks: [
        {
          type: "cover" as const,
          id: "government-goods-cover",
          title: bidLocalized("政府采购货物投标文件"),
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
          id: "government-goods-source",
          entries: [
            {
              id: "project-number",
              label: bidLocalized("项目编号"),
              value: bidLocalized(show(draft.source.projectNumber)),
            },
            {
              id: "version-label",
              label: bidLocalized("文件版本"),
              value: bidLocalized(show(draft.source.versionLabel)),
            },
            {
              id: "deadline",
              label: bidLocalized("投标截止"),
              value: bidLocalized(show(draft.source.bidDeadline)),
            },
            {
              id: "source-attachment",
              label: bidLocalized("项目招标文件附件"),
              value: bidLocalized(show(draft.source.versionEvidence.mainSolicitationAttachmentId)),
            },
          ],
        },
        {
          type: "notice" as const,
          id: "government-goods-source-notice",
          tone: "warning" as const,
          paragraphs: [
            bidLocalized(
              "财政部规范仅作为模板结构依据；本项目要求只来自已绑定的招标文件及其澄清，不得以模板依据替代项目文件。",
            ),
          ],
        },
      ],
    },
    {
      id: "toc",
      blocks: [{ type: "toc" as const, id: "government-goods-toc", maxDepth: 2 as const }],
    },
    {
      id: "bid-letter",
      blocks: [
        {
          type: "declaration" as const,
          id: "government-goods-bid-letter",
          title: bidLocalized("投标函"),
          paragraphs: [
            bidLocalized(
              `我方就${show(draft.source.projectName)}提交投标文件；报价、有效期和响应内容以本文件各表及项目招标文件为准。`,
            ),
          ],
        },
      ],
    },
    {
      id: "legal-representative",
      blocks: [
        {
          type: "keyValueGrid" as const,
          id: "legal-representative-grid",
          entries: [
            {
              id: "legal-name",
              label: bidLocalized("投标人"),
              value: bidLocalized(draft.bidder.legalName),
            },
            {
              id: "legal-representative-name",
              label: bidLocalized("法定代表人"),
              value: bidLocalized(show(draft.bidder.legalRepresentative)),
            },
          ],
        },
      ],
    },
    {
      id: "authorization",
      blocks: [
        {
          type: "declaration" as const,
          id: "authorization-declaration",
          title: bidLocalized("授权信息"),
          paragraphs: [
            bidLocalized(
              `授权代表：${show(draft.authorizedRepresentative)}。授权事实与签章状态须由投标人自行核验。`,
            ),
          ],
        },
      ],
    },
    {
      id: "qualification-index",
      blocks: [
        {
          type: "attachmentIndex" as const,
          id: "qualification-attachment-index",
          attachmentIds: draft.qualifications.flatMap((item) =>
            item.attachmentId ? [item.attachmentId] : [],
          ),
        },
      ],
    },
    {
      id: "qualifications",
      blocks: [
        {
          type: "table" as const,
          id: "qualifications-table",
          columns: [
            { id: "name", label: bidLocalized("资格项"), width: "35%", align: "left" as const },
            { id: "status", label: bidLocalized("状态"), width: "20%", align: "center" as const },
            {
              id: "certificate",
              label: bidLocalized("证书编号"),
              width: "25%",
              align: "left" as const,
            },
            {
              id: "truth",
              label: bidLocalized("真实性确认"),
              width: "20%",
              align: "center" as const,
            },
          ],
          rows: draft.qualifications.map((item) => ({
            id: item.id,
            cells: {
              name: bidLocalized(item.name),
              status: bidLocalized(item.status),
              certificate: bidLocalized(show(item.certificateNumber)),
              truth: bidLocalized(item.userConfirmedTruth ? "已由用户确认" : "未确认"),
            },
          })),
          repeatHeader: true,
          pagePolicy: { allowRowSplit: false, keepHeaderWithRows: 1 },
        },
      ],
    },
    {
      id: "policy-declarations",
      blocks: [
        {
          type: "table" as const,
          id: "confirmed-policy-declarations",
          columns: [
            { id: "policy", label: bidLocalized("政策"), width: "25%", align: "left" as const },
            {
              id: "statement",
              label: bidLocalized("经用户确认的声明"),
              width: "55%",
              align: "left" as const,
            },
            {
              id: "evidence",
              label: bidLocalized("证据附件"),
              width: "20%",
              align: "left" as const,
            },
          ],
          rows: confirmedPolicies.map((policy) => ({
            id: policy.id,
            cells: {
              policy: bidLocalized(policy.policyName),
              statement: bidLocalized(policy.statement),
              evidence: bidLocalized(policy.evidenceAttachmentIds.join("；") || "未提供"),
            },
          })),
          repeatHeader: true,
          pagePolicy: { allowRowSplit: false, keepHeaderWithRows: 1 },
        },
      ],
    },
    {
      id: "opening-price",
      blocks: [
        {
          type: "totals" as const,
          id: "opening-price-total",
          entries: [
            {
              id: "opening-total",
              label: bidLocalized("开标一览报价"),
              value: bidLocalized(money(draft.priceDeclaration.openingTotalMinor)),
            },
            {
              id: "calculated-total",
              label: bidLocalized("货物明细重算"),
              value: bidLocalized(calculation ? money(calculation.summary.totalMinor) : "无法重算"),
            },
          ],
        },
      ],
    },
    {
      id: "itemized-price",
      page: { orientation: "landscape" as const },
      blocks: [
        {
          type: "table" as const,
          id: "goods-itemized-price",
          columns: [
            { id: "name", label: bidLocalized("货物"), width: "18%", align: "left" as const },
            {
              id: "brandModel",
              label: bidLocalized("品牌型号"),
              width: "18%",
              align: "left" as const,
            },
            {
              id: "manufacturer",
              label: bidLocalized("制造商/产地"),
              width: "20%",
              align: "left" as const,
            },
            { id: "quantity", label: bidLocalized("数量"), width: "12%", align: "right" as const },
            { id: "unitPrice", label: bidLocalized("单价"), width: "14%", align: "right" as const },
            { id: "total", label: bidLocalized("重算金额"), width: "18%", align: "right" as const },
          ],
          rows: draft.goodsOfferLines.map((line) => ({
            id: line.id,
            cells: {
              name: bidLocalized(line.name),
              brandModel: bidLocalized(`${line.brand} / ${line.model}`),
              manufacturer: bidLocalized(`${line.manufacturer} / ${line.origin}`),
              quantity: bidLocalized(`${line.quantity} ${line.unit}`),
              unitPrice: bidLocalized(money(line.unitPriceMinor)),
              total: bidLocalized(
                calculatedLines.has(line.id)
                  ? money(calculatedLines.get(line.id) ?? "0")
                  : "无法重算",
              ),
            },
          })),
          repeatHeader: true,
          pagePolicy: { allowRowSplit: false, keepHeaderWithRows: 1 },
        },
      ],
    },
    {
      id: "technical-response",
      page: { orientation: "landscape" as const },
      blocks: [
        {
          type: "complianceMatrix" as const,
          id: "technical-response-matrix",
          columns: REQUIREMENT_MATRIX_COLUMNS,
          rows: requirementMatrixRows(draft, draft.technicalMatrix),
        },
      ],
    },
    {
      id: "business-response",
      page: { orientation: "landscape" as const },
      blocks: [
        {
          type: "complianceMatrix" as const,
          id: "business-response-matrix",
          columns: REQUIREMENT_MATRIX_COLUMNS,
          rows: requirementMatrixRows(draft, draft.businessMatrix),
        },
      ],
    },
    simpleSection(
      "delivery-installation",
      `交付：${draft.plans.delivery}；安装：${show(draft.plans.installation)}`,
    ),
    simpleSection(
      "training-acceptance",
      `培训：${show(draft.plans.training)}；验收：${draft.plans.acceptance}`,
    ),
    simpleSection(
      "warranty-aftersales",
      `质保：${draft.plans.warranty}；售后：${draft.plans.afterSales}`,
    ),
    {
      id: "deviations",
      blocks: [
        {
          type: "table" as const,
          id: "bid-deviations-table",
          columns: [
            { id: "type", label: bidLocalized("类型"), width: "15%", align: "center" as const },
            {
              id: "requirement",
              label: bidLocalized("原要求"),
              width: "30%",
              align: "left" as const,
            },
            {
              id: "response",
              label: bidLocalized("我方响应"),
              width: "30%",
              align: "left" as const,
            },
            { id: "deviation", label: bidLocalized("偏差"), width: "25%", align: "left" as const },
          ],
          rows: deviations.map((item) => ({
            id: `deviation-${item.requirementId}`,
            cells: {
              type: bidLocalized(item.type),
              requirement: bidLocalized(item.requirement),
              response: bidLocalized(item.response),
              deviation: bidLocalized(item.deviation),
            },
          })),
          repeatHeader: true,
          pagePolicy: { allowRowSplit: false, keepHeaderWithRows: 1 },
        },
      ],
    },
    {
      id: "attachments",
      blocks: [
        {
          type: "attachmentIndex" as const,
          id: "submission-attachment-index",
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
          id: "government-goods-final-checklist",
          ordered: false,
          items: [
            ...draft.signSealChecklist.map((item) =>
              bidLocalized(`${item.label}：${item.confirmed ? "已确认" : "未确认"}`),
            ),
            ...draft.policyDeclarations.map((item) =>
              bidLocalized(
                `${item.policyName}：${item.applicable ? (item.userConfirmedTruth ? "适用且已确认" : "适用但未确认") : "不适用"}`,
              ),
            ),
            bidLocalized(
              `导出状态：${decision.mode}。submission-ready 仅表示本地校验通过，不等于已签名、已上传或已由主管机关认定合规。`,
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
          id: "government-goods-signatures",
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
    title: bidLocalized("政府采购货物投标文件"),
    pageDefaults: {
      size: "A4",
      orientation: "portrait",
      marginsMm: { top: 18, right: 18, bottom: 18, left: 18 },
    },
    sections,
    watermarks: decision.watermarks,
    disclaimers: ["bid-authority"],
    attachmentManifest: draft.attachments,
  }) as DocumentModelV2;
}

export const GOVERNMENT_GOODS_BID_REGISTRATION: TemplateRegistration<
  GovernmentGoodsBidDraftV1,
  DocumentModelV2
> = Object.freeze({
  definition: GOVERNMENT_GOODS_BID_DEFINITION,
  parseDraft: parseGovernmentGoodsDraft,
  createDraft: createGovernmentGoodsDraft,
  compile: compileGovernmentGoodsDraft,
  preflight(value: unknown) {
    const draft = parseGovernmentGoodsDraft(value);
    return analyzeGovernmentGoodsDraft(draft);
  },
});
