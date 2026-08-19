import { boundedCompositeSchema, snapshotCompositeInput } from "./boundaries.js";
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
      if (next < 0xdc00 || next > 0xdfff) {
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
export const DateSchema = z.string().refine(isCalendarDate, "Expected a real YYYY-MM-DD date");
export const CurrencySchema = z.enum(["CNY", "USD", "EUR"]);
export const TaxModeSchema = z.enum(["tax-excluded", "tax-included", "tax-exempt"]);
export const QuoteNatureSchema = z.enum(["invitation", "binding-offer"]);
export const MoneyMinorSchema = z.string().regex(/^(?:0|[1-9]\d{0,17})$/);
export const CalculatedMoneyMinorSchema = z.string().regex(/^(?:0|[1-9]\d{0,33})$/);
export const QuantitySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/)
  .refine((value) => !/^0(?:\.0+)?$/.test(value), "Quantity must be positive");
export const BasisPointsSchema = z.number().int().min(0).max(10_000);

const TemplateDefinitionRawSchema = z.object({
  id: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_ID),
  version: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_VERSION),
  basisDate: z.literal(STANDARD_GOODS_QUOTE_BASIS_DATE),
  category: z.literal("quotation"),
  name: z.literal("标准货物报价单"),
  supportedCurrencies: z.tuple([z.literal("CNY"), z.literal("USD"), z.literal("EUR")]),
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

const PartyRawSchema = z.object({
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

const LineItemRawSchema = z.object({
  id: IdentifierSchema,
  name: requiredPlainText(300),
  sku: plainText(100).optional(),
  specification: plainText(500).optional(),
  description: plainText(1_000).optional(),
  unit: requiredPlainText(50),
  quantity: QuantitySchema,
  unitPriceMinor: MoneyMinorSchema,
  discountBps: BasisPointsSchema.default(0),
  taxRateBps: BasisPointsSchema.default(0),
});
export const LineItemSchema = boundedCompositeSchema(LineItemRawSchema);

export type LineItem = z.infer<typeof LineItemRawSchema>;

const StandardGoodsQuoteMetaRawSchema = z
  .object({
    number: requiredPlainText(64),
    issueDate: DateSchema,
    validUntil: DateSchema,
    currency: CurrencySchema,
    taxMode: TaxModeSchema,
    quoteNature: QuoteNatureSchema,
    language: z.literal("zh-CN"),
    layout: z.literal("classic"),
  })
  .superRefine((meta, context) => {
    if (meta.validUntil < meta.issueDate) {
      context.addIssue({
        code: "custom",
        message: "validUntil must be on or after issueDate",
        path: ["validUntil"],
      });
    }
  });
export const StandardGoodsQuoteMetaSchema = boundedCompositeSchema(StandardGoodsQuoteMetaRawSchema);

const StandardGoodsQuoteTermsRawSchema = z.object({
  delivery: plainText(4_000).optional(),
  payment: plainText(4_000).optional(),
  quality: plainText(4_000).optional(),
  warranty: plainText(4_000).optional(),
  notes: plainText(10_000).optional(),
});
export const StandardGoodsQuoteTermsSchema = boundedCompositeSchema(
  StandardGoodsQuoteTermsRawSchema,
);

const StandardGoodsQuoteLineItemsRawSchema = z
  .array(LineItemRawSchema)
  .min(1)
  .max(100)
  .superRefine((lineItems, context) => {
    const seenIds = new Set<string>();
    lineItems.forEach((line, index) => {
      if (seenIds.has(line.id)) {
        context.addIssue({
          code: "custom",
          message: "Line item ids must be unique",
          path: [index, "id"],
        });
      }
      seenIds.add(line.id);
    });
  });

const StandardGoodsQuoteDraftRawSchema = z.object({
  id: IdentifierSchema,
  templateId: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_ID),
  templateVersion: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_VERSION),
  meta: StandardGoodsQuoteMetaRawSchema,
  seller: PartyRawSchema,
  buyer: PartyRawSchema,
  lineItems: StandardGoodsQuoteLineItemsRawSchema,
  terms: StandardGoodsQuoteTermsRawSchema.default({}),
  updatedAt: z.string().max(35).refine(isIsoDateTime, "Expected a real ISO date-time"),
});
export const StandardGoodsQuoteDraftSchema = boundedCompositeSchema(
  StandardGoodsQuoteDraftRawSchema,
);

const DocumentDraftRawSchema = z.discriminatedUnion("templateId", [
  StandardGoodsQuoteDraftRawSchema,
]);
export const DocumentDraftSchema = boundedCompositeSchema(DocumentDraftRawSchema);

export type StandardGoodsQuoteDraft = z.infer<typeof StandardGoodsQuoteDraftRawSchema>;
export type DocumentDraft = z.infer<typeof DocumentDraftRawSchema>;

export function parseDocumentDraft(input: unknown): DocumentDraft {
  return DocumentDraftSchema.parse(input);
}

const CalculatedLineAmountsRawSchema = z.object({
  lineId: IdentifierSchema,
  grossMinor: CalculatedMoneyMinorSchema,
  subtotalMinor: CalculatedMoneyMinorSchema,
  discountMinor: CalculatedMoneyMinorSchema,
  taxMinor: CalculatedMoneyMinorSchema,
  totalMinor: CalculatedMoneyMinorSchema,
});
export const CalculatedLineAmountsSchema = boundedCompositeSchema(CalculatedLineAmountsRawSchema);

const CalculatedSummaryRawSchema = z.object({
  grossMinor: CalculatedMoneyMinorSchema,
  subtotalMinor: CalculatedMoneyMinorSchema,
  discountMinor: CalculatedMoneyMinorSchema,
  taxMinor: CalculatedMoneyMinorSchema,
  totalMinor: CalculatedMoneyMinorSchema,
});
export const CalculatedSummarySchema = boundedCompositeSchema(CalculatedSummaryRawSchema);

const QuoteCalculationRawSchema = z.object({
  currency: CurrencySchema,
  taxMode: TaxModeSchema,
  lines: z.array(CalculatedLineAmountsRawSchema).min(1).max(100),
  summary: CalculatedSummaryRawSchema,
});
export const QuoteCalculationSchema = boundedCompositeSchema(QuoteCalculationRawSchema);

export type CalculatedLineAmounts = z.infer<typeof CalculatedLineAmountsRawSchema>;
export type CalculatedSummary = z.infer<typeof CalculatedSummaryRawSchema>;
export type QuoteCalculation = z.infer<typeof QuoteCalculationRawSchema>;

const DocumentNodeIdSchema = requiredPlainText(80);
const DocumentValueSchema = plainText(10_000);

const DocumentHeadingNodeRawSchema = z.object({
  type: z.literal("heading"),
  id: DocumentNodeIdSchema,
  level: z.union([z.literal(1), z.literal(2)]),
  text: DocumentValueSchema,
});
export const DocumentHeadingNodeSchema = boundedCompositeSchema(DocumentHeadingNodeRawSchema);

const DocumentMetadataNodeRawSchema = z.object({
  type: z.literal("metadata"),
  id: DocumentNodeIdSchema,
  entries: z
    .array(
      z.object({
        id: DocumentNodeIdSchema,
        label: requiredPlainText(100),
        value: DocumentValueSchema,
      }),
    )
    .min(1)
    .max(20),
});
export const DocumentMetadataNodeSchema = boundedCompositeSchema(DocumentMetadataNodeRawSchema, {
  arrayLimits: { entries: 20 },
});

const DocumentPartiesNodeRawSchema = z.object({
  type: z.literal("parties"),
  id: DocumentNodeIdSchema,
  parties: z
    .array(
      z.object({
        role: z.enum(["seller", "buyer"]),
        label: requiredPlainText(100),
        name: requiredPlainText(200),
        details: z.array(DocumentValueSchema).max(20),
      }),
    )
    .length(2),
});
export const DocumentPartiesNodeSchema = boundedCompositeSchema(DocumentPartiesNodeRawSchema);

const DocumentTableCellsRawSchema = z
  .record(DocumentNodeIdSchema, DocumentValueSchema)
  .refine((cells) => Object.keys(cells).length <= 20, "Table rows support at most 20 cells");

const DocumentTableNodeRawSchema = z.object({
  type: z.literal("table"),
  id: DocumentNodeIdSchema,
  columns: z
    .array(
      z.object({
        id: DocumentNodeIdSchema,
        label: requiredPlainText(100),
        align: z.enum(["left", "center", "right"]),
        width: requiredPlainText(20),
      }),
    )
    .min(1)
    .max(20),
  rows: z
    .array(
      z.object({
        id: DocumentNodeIdSchema,
        cells: DocumentTableCellsRawSchema,
      }),
    )
    .min(1)
    .max(100),
  repeatHeader: z.boolean(),
  pagePolicy: z.object({
    allowRowSplit: z.boolean(),
    keepHeaderWithRows: z.number().int().min(1).max(10),
  }),
});
export const DocumentTableNodeSchema = boundedCompositeSchema(DocumentTableNodeRawSchema);

const LabeledDocumentEntryRawSchema = z.object({
  id: DocumentNodeIdSchema,
  label: requiredPlainText(100),
  value: DocumentValueSchema,
});

const DocumentTotalsNodeRawSchema = z.object({
  type: z.literal("totals"),
  id: DocumentNodeIdSchema,
  entries: z.array(LabeledDocumentEntryRawSchema).min(1).max(10),
});
export const DocumentTotalsNodeSchema = boundedCompositeSchema(DocumentTotalsNodeRawSchema, {
  arrayLimits: { entries: 10 },
});

const DocumentTermsNodeRawSchema = z.object({
  type: z.literal("terms"),
  id: DocumentNodeIdSchema,
  entries: z.array(LabeledDocumentEntryRawSchema).min(1).max(10),
});
export const DocumentTermsNodeSchema = boundedCompositeSchema(DocumentTermsNodeRawSchema, {
  arrayLimits: { entries: 10 },
});

const DocumentNoticeNodeRawSchema = z.object({
  type: z.literal("notice"),
  id: DocumentNodeIdSchema,
  paragraphs: z.array(DocumentValueSchema).min(1).max(10),
});
export const DocumentNoticeNodeSchema = boundedCompositeSchema(DocumentNoticeNodeRawSchema);

const DocumentSignatureNodeRawSchema = z.object({
  type: z.literal("signature"),
  id: DocumentNodeIdSchema,
  signerLabel: requiredPlainText(100),
  dateLabel: requiredPlainText(100),
});
export const DocumentSignatureNodeSchema = boundedCompositeSchema(DocumentSignatureNodeRawSchema);

const DocumentNodeRawSchema = z.discriminatedUnion("type", [
  DocumentHeadingNodeRawSchema,
  DocumentMetadataNodeRawSchema,
  DocumentPartiesNodeRawSchema,
  DocumentTableNodeRawSchema,
  DocumentTotalsNodeRawSchema,
  DocumentTermsNodeRawSchema,
  DocumentNoticeNodeRawSchema,
  DocumentSignatureNodeRawSchema,
]);
export const DocumentNodeSchema = boundedCompositeSchema(DocumentNodeRawSchema);

const DocumentModelRawSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  documentId: IdentifierSchema,
  templateId: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_ID),
  templateVersion: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_VERSION),
  locale: z.literal("zh-CN"),
  page: z.object({
    size: z.literal("A4"),
    orientation: z.literal("portrait"),
    marginsMm: z.object({
      top: z.number().int().min(0).max(50),
      right: z.number().int().min(0).max(50),
      bottom: z.number().int().min(0).max(50),
      left: z.number().int().min(0).max(50),
    }),
  }),
  nodes: z.array(DocumentNodeRawSchema).min(1).max(30),
});
export const DocumentModelSchema = boundedCompositeSchema(DocumentModelRawSchema);

export type DocumentNode = z.infer<typeof DocumentNodeRawSchema>;
export type DocumentModel = z.infer<typeof DocumentModelRawSchema>;

const RiskFindingRawSchema = z.object({
  code: requiredPlainText(100),
  severity: z.enum(["info", "warning", "error"]),
  message: requiredPlainText(1_000),
  path: z.array(requiredPlainText(100)).max(20).optional(),
});
export const RiskFindingSchema = boundedCompositeSchema(RiskFindingRawSchema);

export type RiskFinding = z.infer<typeof RiskFindingRawSchema>;

const ProjectEnvelopeRawSchema = z.object({
  formatVersion: z.literal(PROJECT_FORMAT_VERSION),
  templateId: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_ID),
  templateVersion: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_VERSION),
  draft: DocumentDraftRawSchema,
  calculation: QuoteCalculationRawSchema,
});
export const ProjectEnvelopeSchema = boundedCompositeSchema(ProjectEnvelopeRawSchema);

export type OpenTradProjectEnvelope = z.infer<typeof ProjectEnvelopeRawSchema>;

const ProjectEnvelopeInputRawSchema = z.object({
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
