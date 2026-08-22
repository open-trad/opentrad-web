import { boundedCompositeSchema } from "../boundaries.js";
import {
  isolatedArraySchema,
  isolatedDiscriminatedUnionSchema,
  isolatedObjectSchema,
  isolatedRecordSchema,
} from "../safe-schema.js";
import { z } from "../zod.js";
import {
  type DocumentLanguageV2,
  DocumentLanguageV2Schema,
  type LocalizedText,
  type TemplateIdV2,
  TemplateIdV2Schema,
  type TemplateVersionV2,
  TemplateVersionV2Schema,
} from "./common.js";
import { type AttachmentRefV1, AttachmentRefV1Schema } from "./project.js";

interface SafeIssue {
  readonly code: "custom";
  readonly message: string;
  readonly path?: PropertyKey[];
}

type ObjectOutput<Shape extends z.ZodRawShape> = z.output<z.ZodObject<Shape>>;

const HTML_PATTERN = /<(?:!doctype|!--|\/?\s*[a-zA-Z][^>]*)>/i;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

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
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
    if (codeUnit === 0x09 || codeUnit === 0x0a || codeUnit === 0x0d) continue;
    if (codeUnit < 0x20 || codeUnit === 0xfffe || codeUnit === 0xffff) return false;
  }
  return true;
}

function safeText(maximumLength: number, required = false) {
  return z
    .string()
    .max(maximumLength)
    .refine((value) => !required || value.trim().length > 0, "Required text is blank")
    .refine(isXml10Text, "Text is not XML 1.0 safe")
    .refine((value) => !HTML_PATTERN.test(value), "HTML is not allowed");
}

const IdentifierSchema = safeText(200, true).regex(
  IDENTIFIER_PATTERN,
  "Expected a safe identifier",
);

function strictIsolatedObjectSchema<const Shape extends z.ZodRawShape>(
  shape: Shape,
  refine?: (value: ObjectOutput<Shape>, addIssue: (issue: SafeIssue) => void) => void,
) {
  const isolated = isolatedObjectSchema(shape, refine);
  const allowedKeys = new Set(Object.keys(shape));
  return z.transform<unknown, ObjectOutput<Shape>>((input, context) => {
    try {
      if (input !== null && typeof input === "object" && !Array.isArray(input)) {
        for (const key of Reflect.ownKeys(input)) {
          if (typeof key !== "string" || !allowedKeys.has(key)) {
            context.addIssue({
              code: "custom",
              message: "Unknown object key",
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
      return result.data as ObjectOutput<Shape>;
    } catch {
      context.addIssue({ code: "custom", message: "Object validation failed safely" });
      return z.NEVER;
    }
  });
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor))
      throw new Error("Validated output is not data-only");
    deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function uniqueIds(
  values: readonly { readonly id: string }[],
  addIssue: (issue: SafeIssue) => void,
  label: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      addIssue({ code: "custom", message: `${label} id must be unique`, path: [index, "id"] });
    }
    seen.add(value.id);
  });
}

function uniqueStrings(
  values: readonly string[],
  addIssue: (issue: SafeIssue) => void,
  label: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      addIssue({ code: "custom", message: `${label} must be unique`, path: [index] });
    }
    seen.add(value);
  });
}

export interface BlockBaseV2 {
  readonly id: string;
}

export interface CoverBlockV2 extends BlockBaseV2 {
  readonly type: "cover";
  readonly title: LocalizedText;
  readonly subtitle?: LocalizedText;
}

export interface HeadingBlockV2 extends BlockBaseV2 {
  readonly type: "heading";
  readonly level: 1 | 2 | 3;
  readonly text: LocalizedText;
}

export interface ParagraphBlockV2 extends BlockBaseV2 {
  readonly type: "paragraph";
  readonly text: LocalizedText;
}

export interface KeyValueGridEntryV2 {
  readonly id: string;
  readonly label: LocalizedText;
  readonly value: LocalizedText;
}

export interface KeyValueGridBlockV2 extends BlockBaseV2 {
  readonly type: "keyValueGrid";
  readonly entries: readonly KeyValueGridEntryV2[];
}

export interface DocumentPartyV2 {
  readonly id: string;
  readonly role: LocalizedText;
  readonly name: LocalizedText;
  readonly details: readonly LocalizedText[];
}

export interface PartiesBlockV2 extends BlockBaseV2 {
  readonly type: "parties";
  readonly parties: readonly DocumentPartyV2[];
}

export interface TableColumnV2 {
  readonly id: string;
  readonly label: LocalizedText;
  readonly width: string;
  readonly align: "left" | "center" | "right";
}

export interface TableRowV2 {
  readonly id: string;
  readonly cells: Readonly<Record<string, LocalizedText>>;
}

export interface TableBlockV2 extends BlockBaseV2 {
  readonly type: "table";
  readonly columns: readonly TableColumnV2[];
  readonly rows: readonly TableRowV2[];
  readonly repeatHeader: boolean;
  readonly pagePolicy: {
    readonly allowRowSplit: boolean;
    readonly keepHeaderWithRows: number;
  };
}

export interface TotalsEntryV2 {
  readonly id: string;
  readonly label: LocalizedText;
  readonly value: LocalizedText;
}

export interface TotalsBlockV2 extends BlockBaseV2 {
  readonly type: "totals";
  readonly entries: readonly TotalsEntryV2[];
}

export interface DocumentClauseV2 {
  readonly id: string;
  readonly number: string;
  readonly title: LocalizedText;
  readonly paragraphs: readonly LocalizedText[];
}

export interface ClauseGroupBlockV2 extends BlockBaseV2 {
  readonly type: "clauseGroup";
  readonly title: LocalizedText;
  readonly clauses: readonly DocumentClauseV2[];
}

export interface ListBlockV2 extends BlockBaseV2 {
  readonly type: "list";
  readonly ordered: boolean;
  readonly items: readonly LocalizedText[];
}

export interface NoticeBlockV2 extends BlockBaseV2 {
  readonly type: "notice";
  readonly tone: "info" | "warning" | "danger";
  readonly paragraphs: readonly LocalizedText[];
}

export interface DeclarationBlockV2 extends BlockBaseV2 {
  readonly type: "declaration";
  readonly title: LocalizedText;
  readonly paragraphs: readonly LocalizedText[];
}

export interface TocBlockV2 extends BlockBaseV2 {
  readonly type: "toc";
  readonly maxDepth: 1 | 2 | 3;
}

export interface ComplianceMatrixRowV2 {
  readonly id: string;
  readonly sourceRef: string;
  readonly substantial: boolean;
  readonly cells: Readonly<Record<string, LocalizedText>>;
}

export interface ComplianceMatrixBlockV2 extends BlockBaseV2 {
  readonly type: "complianceMatrix";
  readonly columns: readonly TableColumnV2[];
  readonly rows: readonly ComplianceMatrixRowV2[];
}

export interface AttachmentIndexBlockV2 extends BlockBaseV2 {
  readonly type: "attachmentIndex";
  readonly attachmentIds: readonly string[];
}

export interface AttachmentPageBlockV2 extends BlockBaseV2 {
  readonly type: "attachmentPage";
  readonly attachmentId: string;
  readonly pageNumber: number;
}

export interface DocumentSignerV2 {
  readonly role: LocalizedText;
  readonly name: string;
  readonly dateLabel: LocalizedText;
  readonly sealLabel?: LocalizedText;
}

export interface SignatureGroupBlockV2 extends BlockBaseV2 {
  readonly type: "signatureGroup";
  readonly signers: readonly DocumentSignerV2[];
}

export interface PageBreakBlockV2 extends BlockBaseV2 {
  readonly type: "pageBreak";
}

export interface WatermarkPolicyV2 {
  readonly id: string;
  readonly text: LocalizedText;
  readonly scope: "every-page" | "first-page";
}

export type DisclaimerRefV2 =
  | "quotation-non-advice"
  | "contract-generation-note"
  | "international-choice-warning"
  | "bid-authority";

export type DocumentBlockV2 =
  | CoverBlockV2
  | HeadingBlockV2
  | ParagraphBlockV2
  | KeyValueGridBlockV2
  | PartiesBlockV2
  | TableBlockV2
  | TotalsBlockV2
  | ClauseGroupBlockV2
  | ListBlockV2
  | NoticeBlockV2
  | DeclarationBlockV2
  | TocBlockV2
  | ComplianceMatrixBlockV2
  | AttachmentIndexBlockV2
  | AttachmentPageBlockV2
  | SignatureGroupBlockV2
  | PageBreakBlockV2;

export interface DocumentSectionV2 {
  readonly id: string;
  readonly page?: { readonly orientation: "portrait" | "landscape" };
  readonly blocks: readonly DocumentBlockV2[];
}

export interface DocumentModelV2 {
  readonly schemaVersion: "2.0.0";
  readonly documentId: string;
  readonly template: {
    readonly id: TemplateIdV2 | "quotation.goods.standard.v1";
    readonly version: TemplateVersionV2;
    readonly basisDate: "2026-08-19";
  };
  readonly documentKind: "quotation" | "contract" | "bid";
  readonly language: DocumentLanguageV2;
  readonly title: LocalizedText;
  readonly pageDefaults: {
    readonly size: "A4";
    readonly orientation: "portrait";
    readonly marginsMm: {
      readonly top: number;
      readonly right: number;
      readonly bottom: number;
      readonly left: number;
    };
  };
  readonly sections: readonly DocumentSectionV2[];
  readonly watermarks: readonly WatermarkPolicyV2[];
  readonly disclaimers: readonly DisclaimerRefV2[];
  readonly attachmentManifest: readonly AttachmentRefV1[];
}

const BlockBaseShape = { id: IdentifierSchema } as const;

const StrictLocalizedTextSchema = strictIsolatedObjectSchema({
  zhCN: safeText(10_000, true),
  enUS: safeText(10_000).optional(),
});

const CoverBlockV2Schema = strictIsolatedObjectSchema({
  type: z.literal("cover"),
  ...BlockBaseShape,
  title: StrictLocalizedTextSchema,
  subtitle: StrictLocalizedTextSchema.optional(),
});

const HeadingBlockV2Schema = strictIsolatedObjectSchema({
  type: z.literal("heading"),
  ...BlockBaseShape,
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  text: StrictLocalizedTextSchema,
});

const ParagraphBlockV2Schema = strictIsolatedObjectSchema({
  type: z.literal("paragraph"),
  ...BlockBaseShape,
  text: StrictLocalizedTextSchema,
});

const KeyValueGridEntryV2Schema = strictIsolatedObjectSchema({
  id: IdentifierSchema,
  label: StrictLocalizedTextSchema,
  value: StrictLocalizedTextSchema,
});

const KeyValueGridBlockV2Schema = strictIsolatedObjectSchema(
  {
    type: z.literal("keyValueGrid"),
    ...BlockBaseShape,
    entries: isolatedArraySchema(KeyValueGridEntryV2Schema, { max: 100 }),
  },
  (block, addIssue) => uniqueIds(block.entries, addIssue, "Key-value entry"),
);

const DocumentPartyV2Schema = strictIsolatedObjectSchema({
  id: IdentifierSchema,
  role: StrictLocalizedTextSchema,
  name: StrictLocalizedTextSchema,
  details: isolatedArraySchema(StrictLocalizedTextSchema, { max: 100 }),
});

const PartiesBlockV2Schema = strictIsolatedObjectSchema(
  {
    type: z.literal("parties"),
    ...BlockBaseShape,
    parties: isolatedArraySchema(DocumentPartyV2Schema, { max: 100 }),
  },
  (block, addIssue) => uniqueIds(block.parties, addIssue, "Party"),
);

const TableColumnV2Schema = strictIsolatedObjectSchema({
  id: IdentifierSchema,
  label: StrictLocalizedTextSchema,
  width: safeText(50, true),
  align: z.enum(["left", "center", "right"]),
});

const LocalizedCellRecordSchema = isolatedRecordSchema(
  IdentifierSchema,
  StrictLocalizedTextSchema,
  20,
);

const TableRowV2Schema = strictIsolatedObjectSchema({
  id: IdentifierSchema,
  cells: LocalizedCellRecordSchema,
});

const TablePagePolicyV2Schema = strictIsolatedObjectSchema({
  allowRowSplit: z.boolean(),
  keepHeaderWithRows: z.number().int().min(0).max(20),
});

function validateTabularBlock(
  block: {
    readonly columns: readonly { readonly id: string }[];
    readonly rows: readonly {
      readonly id: string;
      readonly cells: Readonly<Record<string, unknown>>;
    }[];
  },
  addIssue: (issue: SafeIssue) => void,
): void {
  uniqueIds(block.columns, addIssue, "Column");
  uniqueIds(block.rows, addIssue, "Row");
  const columnIds = new Set(block.columns.map((column) => column.id));
  block.rows.forEach((row, rowIndex) => {
    const cellIds = Object.keys(row.cells);
    if (cellIds.length !== columnIds.size || cellIds.some((cellId) => !columnIds.has(cellId))) {
      addIssue({
        code: "custom",
        message: "Table cells must exactly match the declared columns",
        path: ["rows", rowIndex, "cells"],
      });
    }
  });
}

const TableBlockV2Schema = strictIsolatedObjectSchema(
  {
    type: z.literal("table"),
    ...BlockBaseShape,
    columns: isolatedArraySchema(TableColumnV2Schema, { min: 1, max: 20 }),
    rows: isolatedArraySchema(TableRowV2Schema, { max: 500 }),
    repeatHeader: z.boolean(),
    pagePolicy: TablePagePolicyV2Schema,
  },
  validateTabularBlock,
);

const TotalsEntryV2Schema = strictIsolatedObjectSchema({
  id: IdentifierSchema,
  label: StrictLocalizedTextSchema,
  value: StrictLocalizedTextSchema,
});

const TotalsBlockV2Schema = strictIsolatedObjectSchema(
  {
    type: z.literal("totals"),
    ...BlockBaseShape,
    entries: isolatedArraySchema(TotalsEntryV2Schema, { max: 100 }),
  },
  (block, addIssue) => uniqueIds(block.entries, addIssue, "Total entry"),
);

const DocumentClauseV2Schema = strictIsolatedObjectSchema({
  id: IdentifierSchema,
  number: safeText(50, true),
  title: StrictLocalizedTextSchema,
  paragraphs: isolatedArraySchema(StrictLocalizedTextSchema, { max: 100 }),
});

const ClauseGroupBlockV2Schema = strictIsolatedObjectSchema(
  {
    type: z.literal("clauseGroup"),
    ...BlockBaseShape,
    title: StrictLocalizedTextSchema,
    clauses: isolatedArraySchema(DocumentClauseV2Schema, { max: 100 }),
  },
  (block, addIssue) => uniqueIds(block.clauses, addIssue, "Clause"),
);

const ListBlockV2Schema = strictIsolatedObjectSchema({
  type: z.literal("list"),
  ...BlockBaseShape,
  ordered: z.boolean(),
  items: isolatedArraySchema(StrictLocalizedTextSchema, { max: 100 }),
});

const NoticeBlockV2Schema = strictIsolatedObjectSchema({
  type: z.literal("notice"),
  ...BlockBaseShape,
  tone: z.enum(["info", "warning", "danger"]),
  paragraphs: isolatedArraySchema(StrictLocalizedTextSchema, { min: 1, max: 100 }),
});

const DeclarationBlockV2Schema = strictIsolatedObjectSchema({
  type: z.literal("declaration"),
  ...BlockBaseShape,
  title: StrictLocalizedTextSchema,
  paragraphs: isolatedArraySchema(StrictLocalizedTextSchema, { min: 1, max: 100 }),
});

const TocBlockV2Schema = strictIsolatedObjectSchema({
  type: z.literal("toc"),
  ...BlockBaseShape,
  maxDepth: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

const ComplianceMatrixRowV2Schema = strictIsolatedObjectSchema({
  id: IdentifierSchema,
  sourceRef: safeText(500, true),
  substantial: z.boolean(),
  cells: LocalizedCellRecordSchema,
});

const ComplianceMatrixBlockV2Schema = strictIsolatedObjectSchema(
  {
    type: z.literal("complianceMatrix"),
    ...BlockBaseShape,
    columns: isolatedArraySchema(TableColumnV2Schema, { min: 1, max: 20 }),
    rows: isolatedArraySchema(ComplianceMatrixRowV2Schema, { max: 500 }),
  },
  validateTabularBlock,
);

const AttachmentIndexBlockV2Schema = strictIsolatedObjectSchema(
  {
    type: z.literal("attachmentIndex"),
    ...BlockBaseShape,
    attachmentIds: isolatedArraySchema(IdentifierSchema, { max: 100 }),
  },
  (block, addIssue) => uniqueStrings(block.attachmentIds, addIssue, "Attachment reference"),
);

const AttachmentPageBlockV2Schema = strictIsolatedObjectSchema({
  type: z.literal("attachmentPage"),
  ...BlockBaseShape,
  attachmentId: IdentifierSchema,
  pageNumber: z.number().int().min(1).max(10_000),
});

const DocumentSignerV2Schema = strictIsolatedObjectSchema({
  role: StrictLocalizedTextSchema,
  name: safeText(300, true),
  dateLabel: StrictLocalizedTextSchema,
  sealLabel: StrictLocalizedTextSchema.optional(),
});

const SignatureGroupBlockV2Schema = strictIsolatedObjectSchema({
  type: z.literal("signatureGroup"),
  ...BlockBaseShape,
  signers: isolatedArraySchema(DocumentSignerV2Schema, { min: 1, max: 10 }),
});

const PageBreakBlockV2Schema = strictIsolatedObjectSchema({
  type: z.literal("pageBreak"),
  ...BlockBaseShape,
});

const DocumentBlockV2RawSchema = isolatedDiscriminatedUnionSchema("type", {
  cover: CoverBlockV2Schema,
  heading: HeadingBlockV2Schema,
  paragraph: ParagraphBlockV2Schema,
  keyValueGrid: KeyValueGridBlockV2Schema,
  parties: PartiesBlockV2Schema,
  table: TableBlockV2Schema,
  totals: TotalsBlockV2Schema,
  clauseGroup: ClauseGroupBlockV2Schema,
  list: ListBlockV2Schema,
  notice: NoticeBlockV2Schema,
  declaration: DeclarationBlockV2Schema,
  toc: TocBlockV2Schema,
  complianceMatrix: ComplianceMatrixBlockV2Schema,
  attachmentIndex: AttachmentIndexBlockV2Schema,
  attachmentPage: AttachmentPageBlockV2Schema,
  signatureGroup: SignatureGroupBlockV2Schema,
  pageBreak: PageBreakBlockV2Schema,
});

const SectionPageV2Schema = strictIsolatedObjectSchema({
  orientation: z.enum(["portrait", "landscape"]),
});

const DocumentSectionV2Schema = strictIsolatedObjectSchema({
  id: IdentifierSchema,
  page: SectionPageV2Schema.optional(),
  blocks: isolatedArraySchema(DocumentBlockV2RawSchema, { max: 100 }),
});

const WatermarkPolicyV2Schema = strictIsolatedObjectSchema({
  id: IdentifierSchema,
  text: StrictLocalizedTextSchema,
  scope: z.enum(["every-page", "first-page"]),
});

const TemplateIdentityV2Schema = strictIsolatedObjectSchema({
  id: z.union([TemplateIdV2Schema, z.literal("quotation.goods.standard.v1")]),
  version: TemplateVersionV2Schema,
  basisDate: z.literal("2026-08-19"),
});

const MarginsMmV2Schema = strictIsolatedObjectSchema({
  top: z.number().min(0).max(100),
  right: z.number().min(0).max(100),
  bottom: z.number().min(0).max(100),
  left: z.number().min(0).max(100),
});

const PageDefaultsV2Schema = strictIsolatedObjectSchema({
  size: z.literal("A4"),
  orientation: z.literal("portrait"),
  marginsMm: MarginsMmV2Schema,
});

const DisclaimerRefV2Schema = z.enum([
  "quotation-non-advice",
  "contract-generation-note",
  "international-choice-warning",
  "bid-authority",
]);

function validateModel(
  model: {
    readonly template: { readonly id: string };
    readonly documentKind: string;
    readonly sections: readonly {
      readonly id: string;
      readonly blocks: readonly DocumentBlockV2[];
    }[];
    readonly watermarks: readonly WatermarkPolicyV2[];
    readonly disclaimers: readonly string[];
    readonly attachmentManifest: readonly AttachmentRefV1[];
  },
  addIssue: (issue: SafeIssue) => void,
): void {
  if (!model.template.id.startsWith(`${model.documentKind}.`)) {
    addIssue({
      code: "custom",
      message: "Document kind must match the template id",
      path: ["documentKind"],
    });
  }

  uniqueIds(model.sections, addIssue, "Section");
  uniqueIds(model.watermarks, addIssue, "Watermark");
  uniqueIds(model.attachmentManifest, addIssue, "Attachment");
  uniqueStrings(model.disclaimers, addIssue, "Disclaimer reference");

  const blocks = model.sections.flatMap((section) => section.blocks);
  uniqueIds(blocks, addIssue, "Block");
  const attachments = new Map(
    model.attachmentManifest.map((attachment) => [attachment.id, attachment] as const),
  );

  model.sections.forEach((section, sectionIndex) => {
    section.blocks.forEach((block, blockIndex) => {
      const blockPath = ["sections", sectionIndex, "blocks", blockIndex];
      if (block.type === "attachmentIndex") {
        block.attachmentIds.forEach((attachmentId, attachmentIndex) => {
          if (!attachments.has(attachmentId)) {
            addIssue({
              code: "custom",
              message: "Attachment index references an unknown attachment",
              path: [...blockPath, "attachmentIds", attachmentIndex],
            });
          }
        });
      }
      if (block.type === "attachmentPage") {
        const attachment = attachments.get(block.attachmentId);
        if (!attachment) {
          addIssue({
            code: "custom",
            message: "Attachment page references an unknown attachment",
            path: [...blockPath, "attachmentId"],
          });
        } else if (attachment.pageCount !== undefined && block.pageNumber > attachment.pageCount) {
          addIssue({
            code: "custom",
            message: "Attachment page exceeds the attachment page count",
            path: [...blockPath, "pageNumber"],
          });
        }
      }
    });
  });
}

const DocumentModelV2RawSchema = strictIsolatedObjectSchema(
  {
    schemaVersion: z.literal("2.0.0"),
    documentId: IdentifierSchema,
    template: TemplateIdentityV2Schema,
    documentKind: z.enum(["quotation", "contract", "bid"]),
    language: DocumentLanguageV2Schema,
    title: StrictLocalizedTextSchema,
    pageDefaults: PageDefaultsV2Schema,
    sections: isolatedArraySchema(DocumentSectionV2Schema, { max: 100 }),
    watermarks: isolatedArraySchema(WatermarkPolicyV2Schema, { max: 100 }),
    disclaimers: isolatedArraySchema(DisclaimerRefV2Schema, { max: 4 }),
    attachmentManifest: isolatedArraySchema(AttachmentRefV1Schema, { max: 100 }),
  },
  validateModel,
);

const FrozenDocumentModelV2Schema = z.transform<unknown, DocumentModelV2>((input, context) => {
  const result = DocumentModelV2RawSchema.safeParse(input);
  if (!result.success) {
    for (const issue of result.error.issues) context.addIssue({ ...issue });
    return z.NEVER;
  }
  return deepFreeze(result.data) as unknown as DocumentModelV2;
});

// A bilingual 20-column × 500-row compliance matrix snapshots to 32,693 values.
// The remaining allowance covers the bounded envelope, 100 attachments and 100 watermarks.
const MAX_DOCUMENT_MODEL_V2_VALUES = 40_000;

export const DocumentModelV2Schema = boundedCompositeSchema(FrozenDocumentModelV2Schema, {
  maxTotalValues: MAX_DOCUMENT_MODEL_V2_VALUES,
  arrayLimits: {
    sections: 100,
    blocks: 100,
    entries: 100,
    parties: 100,
    details: 100,
    columns: 20,
    rows: 500,
    clauses: 100,
    paragraphs: 100,
    items: 100,
    attachmentIds: 100,
    signers: 10,
    watermarks: 100,
    disclaimers: 4,
    attachmentManifest: 100,
  },
});
