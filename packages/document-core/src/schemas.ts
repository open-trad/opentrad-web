import { boundedCompositeSchema, snapshotCompositeInput } from "./boundaries.js";
import {
  isolatedArraySchema,
  isolatedDiscriminatedUnionSchema,
  isolatedObjectSchema,
  isolatedRecordSchema,
  isolatedTupleSchema,
  isolatedValueSchema,
} from "./safe-schema.js";
import { z } from "./zod.js";

export const STANDARD_GOODS_QUOTE_TEMPLATE_ID = "quotation.goods.standard.v1" as const;
export const STANDARD_GOODS_QUOTE_TEMPLATE_VERSION = "1.0.0" as const;
export const STANDARD_GOODS_QUOTE_BASIS_DATE = "2026-08-19" as const;
export const PROJECT_FORMAT_VERSION = "1.0.0" as const;

const HTML_PATTERN = /<(?:!doctype|!--|\/?\s*[a-zA-Z][^>]*)>/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function plainText(maxLength: number) {
  return z
    .string()
    .max(maxLength)
    .refine(isXml10Text, "Text contains characters forbidden by XML 1.0")
    .refine((value) => !HTML_PATTERN.test(value), "HTML is not allowed");
}

function requiredPlainText(maxLength: number) {
  return plainText(maxLength).refine((value) => value.trim().length > 0, "Required text is blank");
}

function isXml10Text(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || !Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
    if (codeUnit === 0x09 || codeUnit === 0x0a || codeUnit === 0x0d) {
      continue;
    }
    if (codeUnit < 0x20 || codeUnit === 0xfffe || codeUnit === 0xffff) {
      return false;
    }
  }
  return true;
}

function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function isIsoDateTime(value: string): boolean {
  return (
    ISO_DATE_TIME_PATTERN.test(value) &&
    isCalendarDate(value.slice(0, 10)) &&
    !Number.isNaN(Date.parse(value))
  );
}

const IdentifierSchema = requiredPlainText(64);
const DateRawSchema = z.string().refine(isCalendarDate, "Expected a real YYYY-MM-DD date");
const CurrencyRawSchema = z.enum(["CNY", "USD", "EUR"]);
const TaxModeRawSchema = z.enum(["tax-excluded", "tax-included", "tax-exempt"]);
const QuoteNatureRawSchema = z.enum(["invitation", "binding-offer"]);
const MoneyMinorRawSchema = z.string().regex(/^(?:0|[1-9]\d{0,17})$/);
const CalculatedMoneyMinorRawSchema = z.string().regex(/^(?:0|[1-9]\d{0,33})$/);
const QuantityRawSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/)
  .refine((value) => !/^0(?:\.0+)?$/.test(value), "Quantity must be positive");
const BasisPointsRawSchema = z.number().int().min(0).max(10_000);

export const DateSchema = isolatedValueSchema(DateRawSchema);
export const CurrencySchema = isolatedValueSchema(CurrencyRawSchema);
export const TaxModeSchema = isolatedValueSchema(TaxModeRawSchema);
export const QuoteNatureSchema = isolatedValueSchema(QuoteNatureRawSchema);
export const MoneyMinorSchema = isolatedValueSchema(MoneyMinorRawSchema);
export const CalculatedMoneyMinorSchema = isolatedValueSchema(CalculatedMoneyMinorRawSchema);
export const QuantitySchema = isolatedValueSchema(QuantityRawSchema);
export const BasisPointsSchema = isolatedValueSchema(BasisPointsRawSchema);

const TemplateDefinitionRawSchema = isolatedObjectSchema({
  id: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_ID),
  version: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_VERSION),
  basisDate: z.literal(STANDARD_GOODS_QUOTE_BASIS_DATE),
  category: z.literal("quotation"),
  name: z.literal("标准货物报价单"),
  supportedCurrencies: isolatedTupleSchema([z.literal("CNY"), z.literal("USD"), z.literal("EUR")]),
});
export const TemplateDefinitionSchema = boundedCompositeSchema(TemplateDefinitionRawSchema);

export type TemplateDefinition = z.infer<typeof TemplateDefinitionRawSchema>;

export type FixedTemplateDefinition = Readonly<Omit<TemplateDefinition, "supportedCurrencies">> & {
  readonly supportedCurrencies: readonly ["CNY", "USD", "EUR"];
};

const parsedStandardGoodsQuoteTemplate = TemplateDefinitionRawSchema.parse({
  id: STANDARD_GOODS_QUOTE_TEMPLATE_ID,
  version: STANDARD_GOODS_QUOTE_TEMPLATE_VERSION,
  basisDate: STANDARD_GOODS_QUOTE_BASIS_DATE,
  category: "quotation",
  name: "标准货物报价单",
  supportedCurrencies: ["CNY", "USD", "EUR"],
});
Object.freeze(parsedStandardGoodsQuoteTemplate.supportedCurrencies);
export const STANDARD_GOODS_QUOTE_TEMPLATE = Object.freeze(
  parsedStandardGoodsQuoteTemplate,
) as FixedTemplateDefinition;

const PartyRawSchema = isolatedObjectSchema({
  name: requiredPlainText(200),
  address: plainText(500).optional(),
  contactName: plainText(100).optional(),
  phone: plainText(50).optional(),
  email: plainText(254).optional(),
  taxId: plainText(100).optional(),
  bankName: plainText(200).optional(),
  bankAccount: plainText(100).optional(),
});
export const PartySchema = boundedCompositeSchema(PartyRawSchema);

export type Party = z.infer<typeof PartyRawSchema>;

const LineItemRawSchema = isolatedObjectSchema({
  id: IdentifierSchema,
  name: requiredPlainText(300),
  sku: plainText(100).optional(),
  specification: plainText(500).optional(),
  description: plainText(1_000).optional(),
  unit: requiredPlainText(50),
  quantity: QuantityRawSchema,
  unitPriceMinor: MoneyMinorRawSchema,
  discountBps: BasisPointsRawSchema.default(0),
  taxRateBps: BasisPointsRawSchema.default(0),
});
export const LineItemSchema = boundedCompositeSchema(LineItemRawSchema);

export type LineItem = z.infer<typeof LineItemRawSchema>;

const StandardGoodsQuoteMetaRawSchema = isolatedObjectSchema(
  {
    number: requiredPlainText(64),
    issueDate: DateRawSchema,
    validUntil: DateRawSchema,
    currency: CurrencyRawSchema,
    taxMode: TaxModeRawSchema,
    quoteNature: QuoteNatureRawSchema,
    language: z.literal("zh-CN"),
    layout: z.literal("classic"),
  },
  (meta, addIssue) => {
    if (meta.validUntil < meta.issueDate) {
      addIssue({
        code: "custom",
        message: "validUntil must be on or after issueDate",
        path: ["validUntil"],
      });
    }
  },
);
export const StandardGoodsQuoteMetaSchema = boundedCompositeSchema(StandardGoodsQuoteMetaRawSchema);

const StandardGoodsQuoteTermsRawSchema = isolatedObjectSchema({
  delivery: plainText(4_000).optional(),
  payment: plainText(4_000).optional(),
  quality: plainText(4_000).optional(),
  warranty: plainText(4_000).optional(),
  notes: plainText(10_000).optional(),
});
export const StandardGoodsQuoteTermsSchema = boundedCompositeSchema(
  StandardGoodsQuoteTermsRawSchema,
);

const StandardGoodsQuoteLineItemsRawSchema = isolatedArraySchema(LineItemRawSchema, {
  min: 1,
  max: 100,
  refine: (lineItems, addIssue) => {
    const seenIds = new Set<string>();
    lineItems.forEach((line, index) => {
      if (seenIds.has(line.id)) {
        addIssue({
          code: "custom",
          message: "Line item ids must be unique",
          path: [index, "id"],
        });
      }
      seenIds.add(line.id);
    });
  },
});

const StandardGoodsQuoteDraftRawSchema = isolatedObjectSchema({
  id: IdentifierSchema,
  templateId: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_ID),
  templateVersion: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_VERSION),
  meta: StandardGoodsQuoteMetaRawSchema,
  seller: PartyRawSchema,
  buyer: PartyRawSchema,
  lineItems: StandardGoodsQuoteLineItemsRawSchema,
  terms: StandardGoodsQuoteTermsRawSchema.default(
    () => Object.create(null) as z.output<typeof StandardGoodsQuoteTermsRawSchema>,
  ),
  updatedAt: z.string().max(35).refine(isIsoDateTime, "Expected a real ISO date-time"),
});
export const StandardGoodsQuoteDraftSchema = boundedCompositeSchema(
  StandardGoodsQuoteDraftRawSchema,
);

const DocumentDraftRawSchema = isolatedDiscriminatedUnionSchema("templateId", {
  [STANDARD_GOODS_QUOTE_TEMPLATE_ID]: StandardGoodsQuoteDraftRawSchema,
});
export const DocumentDraftSchema = boundedCompositeSchema(DocumentDraftRawSchema);

export type StandardGoodsQuoteDraft = z.infer<typeof StandardGoodsQuoteDraftRawSchema>;
export type DocumentDraft = z.infer<typeof DocumentDraftRawSchema>;

export function parseDocumentDraft(input: unknown): DocumentDraft {
  return DocumentDraftSchema.parse(input);
}

const CalculatedLineAmountsRawSchema = isolatedObjectSchema({
  lineId: IdentifierSchema,
  grossMinor: CalculatedMoneyMinorRawSchema,
  subtotalMinor: CalculatedMoneyMinorRawSchema,
  discountMinor: CalculatedMoneyMinorRawSchema,
  taxMinor: CalculatedMoneyMinorRawSchema,
  totalMinor: CalculatedMoneyMinorRawSchema,
});
export const CalculatedLineAmountsSchema = boundedCompositeSchema(CalculatedLineAmountsRawSchema);

const CalculatedSummaryRawSchema = isolatedObjectSchema({
  grossMinor: CalculatedMoneyMinorRawSchema,
  subtotalMinor: CalculatedMoneyMinorRawSchema,
  discountMinor: CalculatedMoneyMinorRawSchema,
  taxMinor: CalculatedMoneyMinorRawSchema,
  totalMinor: CalculatedMoneyMinorRawSchema,
});
export const CalculatedSummarySchema = boundedCompositeSchema(CalculatedSummaryRawSchema);

const QuoteCalculationRawSchema = isolatedObjectSchema({
  currency: CurrencyRawSchema,
  taxMode: TaxModeRawSchema,
  lines: isolatedArraySchema(CalculatedLineAmountsRawSchema, { min: 1, max: 100 }),
  summary: CalculatedSummaryRawSchema,
});
export const QuoteCalculationSchema = boundedCompositeSchema(QuoteCalculationRawSchema);

export type CalculatedLineAmounts = z.infer<typeof CalculatedLineAmountsRawSchema>;
export type CalculatedSummary = z.infer<typeof CalculatedSummaryRawSchema>;
export type QuoteCalculation = z.infer<typeof QuoteCalculationRawSchema>;

const DocumentNodeIdSchema = requiredPlainText(80);
const DocumentValueSchema = plainText(10_000);

const DocumentHeadingNodeRawSchema = isolatedObjectSchema({
  type: z.literal("heading"),
  id: DocumentNodeIdSchema,
  level: z.union([z.literal(1), z.literal(2)]),
  text: DocumentValueSchema,
});
export const DocumentHeadingNodeSchema = boundedCompositeSchema(DocumentHeadingNodeRawSchema);

const DocumentMetadataEntryRawSchema = isolatedObjectSchema({
  id: DocumentNodeIdSchema,
  label: requiredPlainText(100),
  value: DocumentValueSchema,
});

const DocumentMetadataNodeRawSchema = isolatedObjectSchema({
  type: z.literal("metadata"),
  id: DocumentNodeIdSchema,
  entries: isolatedArraySchema(DocumentMetadataEntryRawSchema, { min: 1, max: 20 }),
});
export const DocumentMetadataNodeSchema = boundedCompositeSchema(DocumentMetadataNodeRawSchema, {
  arrayLimits: { entries: 20 },
});

const DocumentPartyRawSchema = isolatedObjectSchema({
  role: z.enum(["seller", "buyer"]),
  label: requiredPlainText(100),
  name: requiredPlainText(200),
  details: isolatedArraySchema(DocumentValueSchema, { max: 20 }),
});

const DocumentPartiesNodeRawSchema = isolatedObjectSchema({
  type: z.literal("parties"),
  id: DocumentNodeIdSchema,
  parties: isolatedArraySchema(DocumentPartyRawSchema, { min: 2, max: 2 }),
});
export const DocumentPartiesNodeSchema = boundedCompositeSchema(DocumentPartiesNodeRawSchema);

const DocumentTableCellsRawSchema = isolatedRecordSchema(
  DocumentNodeIdSchema,
  DocumentValueSchema,
  20,
);

const DocumentTableColumnRawSchema = isolatedObjectSchema({
  id: DocumentNodeIdSchema,
  label: requiredPlainText(100),
  align: z.enum(["left", "center", "right"]),
  width: requiredPlainText(20),
});

const DocumentTableRowRawSchema = isolatedObjectSchema({
  id: DocumentNodeIdSchema,
  cells: DocumentTableCellsRawSchema,
});

const DocumentTablePagePolicyRawSchema = isolatedObjectSchema({
  allowRowSplit: z.boolean(),
  keepHeaderWithRows: z.number().int().min(1).max(10),
});

const DocumentTableNodeRawSchema = isolatedObjectSchema({
  type: z.literal("table"),
  id: DocumentNodeIdSchema,
  columns: isolatedArraySchema(DocumentTableColumnRawSchema, { min: 1, max: 20 }),
  rows: isolatedArraySchema(DocumentTableRowRawSchema, { min: 1, max: 100 }),
  repeatHeader: z.boolean(),
  pagePolicy: DocumentTablePagePolicyRawSchema,
});
export const DocumentTableNodeSchema = boundedCompositeSchema(DocumentTableNodeRawSchema);

const LabeledDocumentEntryRawSchema = isolatedObjectSchema({
  id: DocumentNodeIdSchema,
  label: requiredPlainText(100),
  value: DocumentValueSchema,
});

const DocumentTotalsNodeRawSchema = isolatedObjectSchema({
  type: z.literal("totals"),
  id: DocumentNodeIdSchema,
  entries: isolatedArraySchema(LabeledDocumentEntryRawSchema, { min: 1, max: 10 }),
});
export const DocumentTotalsNodeSchema = boundedCompositeSchema(DocumentTotalsNodeRawSchema, {
  arrayLimits: { entries: 10 },
});

const DocumentTermsNodeRawSchema = isolatedObjectSchema({
  type: z.literal("terms"),
  id: DocumentNodeIdSchema,
  entries: isolatedArraySchema(LabeledDocumentEntryRawSchema, { min: 1, max: 10 }),
});
export const DocumentTermsNodeSchema = boundedCompositeSchema(DocumentTermsNodeRawSchema, {
  arrayLimits: { entries: 10 },
});

const DocumentNoticeNodeRawSchema = isolatedObjectSchema({
  type: z.literal("notice"),
  id: DocumentNodeIdSchema,
  paragraphs: isolatedArraySchema(DocumentValueSchema, { min: 1, max: 10 }),
});
export const DocumentNoticeNodeSchema = boundedCompositeSchema(DocumentNoticeNodeRawSchema);

const DocumentSignatureNodeRawSchema = isolatedObjectSchema({
  type: z.literal("signature"),
  id: DocumentNodeIdSchema,
  signerLabel: requiredPlainText(100),
  dateLabel: requiredPlainText(100),
});
export const DocumentSignatureNodeSchema = boundedCompositeSchema(DocumentSignatureNodeRawSchema);

const DocumentNodeRawSchema = isolatedDiscriminatedUnionSchema("type", {
  heading: DocumentHeadingNodeRawSchema,
  metadata: DocumentMetadataNodeRawSchema,
  notice: DocumentNoticeNodeRawSchema,
  parties: DocumentPartiesNodeRawSchema,
  signature: DocumentSignatureNodeRawSchema,
  table: DocumentTableNodeRawSchema,
  terms: DocumentTermsNodeRawSchema,
  totals: DocumentTotalsNodeRawSchema,
});
export const DocumentNodeSchema = boundedCompositeSchema(DocumentNodeRawSchema);

const DocumentMarginsRawSchema = isolatedObjectSchema({
  top: z.number().int().min(0).max(50),
  right: z.number().int().min(0).max(50),
  bottom: z.number().int().min(0).max(50),
  left: z.number().int().min(0).max(50),
});

const DocumentPageRawSchema = isolatedObjectSchema({
  size: z.literal("A4"),
  orientation: z.literal("portrait"),
  marginsMm: DocumentMarginsRawSchema,
});

const DocumentModelRawSchema = isolatedObjectSchema({
  schemaVersion: z.literal("1.0.0"),
  documentId: IdentifierSchema,
  templateId: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_ID),
  templateVersion: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_VERSION),
  locale: z.literal("zh-CN"),
  page: DocumentPageRawSchema,
  nodes: isolatedArraySchema(DocumentNodeRawSchema, { min: 1, max: 30 }),
});
export const DocumentModelSchema = boundedCompositeSchema(DocumentModelRawSchema);

export type DocumentNode = z.infer<typeof DocumentNodeRawSchema>;
export type DocumentModel = z.infer<typeof DocumentModelRawSchema>;

const RiskFindingRawSchema = isolatedObjectSchema({
  code: requiredPlainText(100),
  severity: z.enum(["info", "warning", "error"]),
  message: requiredPlainText(1_000),
  path: isolatedArraySchema(requiredPlainText(100), { max: 20 }).optional(),
});
export const RiskFindingSchema = boundedCompositeSchema(RiskFindingRawSchema);

export type RiskFinding = z.infer<typeof RiskFindingRawSchema>;

const ProjectEnvelopeRawSchema = isolatedObjectSchema({
  formatVersion: z.literal(PROJECT_FORMAT_VERSION),
  templateId: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_ID),
  templateVersion: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_VERSION),
  draft: DocumentDraftRawSchema,
  calculation: QuoteCalculationRawSchema,
});
export const ProjectEnvelopeSchema = boundedCompositeSchema(ProjectEnvelopeRawSchema);

export type OpenTradProjectEnvelope = z.infer<typeof ProjectEnvelopeRawSchema>;

const ProjectEnvelopeInputRawSchema = isolatedObjectSchema({
  formatVersion: z.literal(PROJECT_FORMAT_VERSION),
  templateId: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_ID),
  templateVersion: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_VERSION),
  draft: DocumentDraftRawSchema,
  calculation: z.unknown().optional(),
});

export function parseProjectEnvelopeInput(input: unknown) {
  return ProjectEnvelopeInputRawSchema.parse(snapshotCompositeInput(input));
}

export interface CreateStandardGoodsQuoteDraftInput {
  id: string;
  now: string | Date;
}

export function createStandardGoodsQuoteDraft({
  id,
  now,
}: CreateStandardGoodsQuoteDraftInput): StandardGoodsQuoteDraft {
  const parsedId = IdentifierSchema.parse(id);
  if (typeof now !== "string" && !(now instanceof Date)) {
    throw new TypeError("now must be an ISO date-time string or Date");
  }
  if (typeof now === "string" && !isIsoDateTime(now)) {
    throw new TypeError("now must be a valid ISO date-time");
  }
  const instant = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(instant.getTime())) {
    throw new TypeError("now must be a valid date-time");
  }

  const updatedAt = instant.toISOString();
  const issueDate = updatedAt.slice(0, 10);
  const validity = new Date(`${issueDate}T00:00:00.000Z`);
  validity.setUTCDate(validity.getUTCDate() + 30);
  const validUntil = validity.toISOString().slice(0, 10);
  const numberId = parsedId.slice(0, 52);
  const lineId = `${parsedId.slice(0, 55)}-line-1`;

  return StandardGoodsQuoteDraftSchema.parse({
    id: parsedId,
    templateId: STANDARD_GOODS_QUOTE_TEMPLATE_ID,
    templateVersion: STANDARD_GOODS_QUOTE_TEMPLATE_VERSION,
    meta: {
      number: `QT-${issueDate.replaceAll("-", "")}-${numberId}`,
      issueDate,
      validUntil,
      currency: "CNY",
      taxMode: "tax-excluded",
      quoteNature: "invitation",
      language: "zh-CN",
      layout: "classic",
    },
    seller: { name: "报价方" },
    buyer: { name: "采购方" },
    lineItems: [
      {
        id: lineId,
        name: "商品",
        unit: "件",
        quantity: "1",
        unitPriceMinor: "0",
        discountBps: 0,
        taxRateBps: 0,
      },
    ],
    terms: {},
    updatedAt,
  });
}
