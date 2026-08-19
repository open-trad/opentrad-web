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
    .refine((value) => !HTML_PATTERN.test(value), "HTML is not allowed");
}

function requiredPlainText(maxLength: number) {
  return plainText(maxLength).refine((value) => value.trim().length > 0, "Required text is blank");
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

export const TemplateDefinitionSchema = z.object({
  id: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_ID),
  version: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_VERSION),
  basisDate: z.literal(STANDARD_GOODS_QUOTE_BASIS_DATE),
  category: z.literal("quotation"),
  name: z.literal("标准货物报价单"),
  supportedCurrencies: z.tuple([z.literal("CNY"), z.literal("USD"), z.literal("EUR")]),
});

export type TemplateDefinition = z.infer<typeof TemplateDefinitionSchema>;

export type FixedTemplateDefinition = Readonly<Omit<TemplateDefinition, "supportedCurrencies">> & {
  readonly supportedCurrencies: readonly ["CNY", "USD", "EUR"];
};

const parsedStandardGoodsQuoteTemplate = TemplateDefinitionSchema.parse({
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

export const PartySchema = z.object({
  name: requiredPlainText(200),
  address: plainText(500).optional(),
  contactName: plainText(100).optional(),
  phone: plainText(50).optional(),
  email: plainText(254).optional(),
  taxId: plainText(100).optional(),
  bankName: plainText(200).optional(),
  bankAccount: plainText(100).optional(),
});

export type Party = z.infer<typeof PartySchema>;

export const LineItemSchema = z.object({
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

export type LineItem = z.infer<typeof LineItemSchema>;

export const StandardGoodsQuoteMetaSchema = z
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

export const StandardGoodsQuoteTermsSchema = z.object({
  delivery: plainText(4_000).optional(),
  payment: plainText(4_000).optional(),
  quality: plainText(4_000).optional(),
  warranty: plainText(4_000).optional(),
  notes: plainText(10_000).optional(),
});

const StandardGoodsQuoteLineItemsSchema = z
  .array(LineItemSchema)
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

export const StandardGoodsQuoteDraftSchema = z.object({
  id: IdentifierSchema,
  templateId: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_ID),
  templateVersion: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_VERSION),
  meta: StandardGoodsQuoteMetaSchema,
  seller: PartySchema,
  buyer: PartySchema,
  lineItems: StandardGoodsQuoteLineItemsSchema,
  terms: StandardGoodsQuoteTermsSchema.default({}),
  updatedAt: z.string().max(35).refine(isIsoDateTime, "Expected a real ISO date-time"),
});

export const DocumentDraftSchema = z.discriminatedUnion("templateId", [
  StandardGoodsQuoteDraftSchema,
]);

export type StandardGoodsQuoteDraft = z.infer<typeof StandardGoodsQuoteDraftSchema>;
export type DocumentDraft = z.infer<typeof DocumentDraftSchema>;

export function parseDocumentDraft(input: unknown): DocumentDraft {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    const lineItems = (input as { lineItems?: unknown }).lineItems;
    if (Array.isArray(lineItems) && lineItems.length > 100) {
      throw new RangeError("Document draft has a maximum of 100 line items");
    }
  }
  return DocumentDraftSchema.parse(input);
}

export const CalculatedLineAmountsSchema = z.object({
  lineId: IdentifierSchema,
  grossMinor: CalculatedMoneyMinorSchema,
  subtotalMinor: CalculatedMoneyMinorSchema,
  discountMinor: CalculatedMoneyMinorSchema,
  taxMinor: CalculatedMoneyMinorSchema,
  totalMinor: CalculatedMoneyMinorSchema,
});

export const CalculatedSummarySchema = z.object({
  grossMinor: CalculatedMoneyMinorSchema,
  subtotalMinor: CalculatedMoneyMinorSchema,
  discountMinor: CalculatedMoneyMinorSchema,
  taxMinor: CalculatedMoneyMinorSchema,
  totalMinor: CalculatedMoneyMinorSchema,
});

export const QuoteCalculationSchema = z.object({
  currency: CurrencySchema,
  taxMode: TaxModeSchema,
  lines: z.array(CalculatedLineAmountsSchema).min(1).max(100),
  summary: CalculatedSummarySchema,
});

export type CalculatedLineAmounts = z.infer<typeof CalculatedLineAmountsSchema>;
export type CalculatedSummary = z.infer<typeof CalculatedSummarySchema>;
export type QuoteCalculation = z.infer<typeof QuoteCalculationSchema>;

const DocumentNodeIdSchema = requiredPlainText(80);
const DocumentValueSchema = plainText(10_000);

export const DocumentHeadingNodeSchema = z.object({
  type: z.literal("heading"),
  id: DocumentNodeIdSchema,
  level: z.union([z.literal(1), z.literal(2)]),
  text: DocumentValueSchema,
});

export const DocumentMetadataNodeSchema = z.object({
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

export const DocumentPartiesNodeSchema = z.object({
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

export const DocumentTableNodeSchema = z.object({
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
        cells: z.record(DocumentNodeIdSchema, DocumentValueSchema),
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

const LabeledDocumentEntrySchema = z.object({
  id: DocumentNodeIdSchema,
  label: requiredPlainText(100),
  value: DocumentValueSchema,
});

export const DocumentTotalsNodeSchema = z.object({
  type: z.literal("totals"),
  id: DocumentNodeIdSchema,
  entries: z.array(LabeledDocumentEntrySchema).min(1).max(10),
});

export const DocumentTermsNodeSchema = z.object({
  type: z.literal("terms"),
  id: DocumentNodeIdSchema,
  entries: z.array(LabeledDocumentEntrySchema).min(1).max(10),
});

export const DocumentNoticeNodeSchema = z.object({
  type: z.literal("notice"),
  id: DocumentNodeIdSchema,
  paragraphs: z.array(DocumentValueSchema).min(1).max(10),
});

export const DocumentSignatureNodeSchema = z.object({
  type: z.literal("signature"),
  id: DocumentNodeIdSchema,
  signerLabel: requiredPlainText(100),
  dateLabel: requiredPlainText(100),
});

export const DocumentNodeSchema = z.discriminatedUnion("type", [
  DocumentHeadingNodeSchema,
  DocumentMetadataNodeSchema,
  DocumentPartiesNodeSchema,
  DocumentTableNodeSchema,
  DocumentTotalsNodeSchema,
  DocumentTermsNodeSchema,
  DocumentNoticeNodeSchema,
  DocumentSignatureNodeSchema,
]);

export const DocumentModelSchema = z.object({
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
  nodes: z.array(DocumentNodeSchema).min(1).max(30),
});

export type DocumentNode = z.infer<typeof DocumentNodeSchema>;
export type DocumentModel = z.infer<typeof DocumentModelSchema>;

export const RiskFindingSchema = z.object({
  code: requiredPlainText(100),
  severity: z.enum(["info", "warning", "error"]),
  message: requiredPlainText(1_000),
  path: z.array(requiredPlainText(100)).max(20).optional(),
});

export type RiskFinding = z.infer<typeof RiskFindingSchema>;

export const ProjectEnvelopeSchema = z.object({
  formatVersion: z.literal(PROJECT_FORMAT_VERSION),
  templateId: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_ID),
  templateVersion: z.literal(STANDARD_GOODS_QUOTE_TEMPLATE_VERSION),
  draft: DocumentDraftSchema,
  calculation: QuoteCalculationSchema,
});

export type OpenTradProjectEnvelope = z.infer<typeof ProjectEnvelopeSchema>;

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
