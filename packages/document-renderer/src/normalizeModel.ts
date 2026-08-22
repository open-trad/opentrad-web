import {
  type DisclaimerRefV2,
  type DocumentBlockV2,
  type DocumentLanguageV2,
  type DocumentModel,
  DocumentModelSchema,
  type DocumentModelV2,
  DocumentModelV2Schema,
  type DocumentNode,
  type LocalizedText,
  STANDARD_GOODS_QUOTE_BASIS_DATE,
} from "@opentrad/document-core";

export interface LocalizedTextPart {
  readonly language: "zh-CN" | "en-US";
  readonly text: string;
}

const CONTENT_LABELS = {
  toc: { zhCN: "目录", enUS: "Table of contents" },
  substantial: { zhCN: "实质性要求", enUS: "Substantial requirement" },
  nonSubstantial: { zhCN: "非实质性要求", enUS: "Non-substantial requirement" },
  attachmentAttached: { zhCN: "已附加", enUS: "Attached" },
  attachmentMissing: { zhCN: "缺失", enUS: "Missing" },
  attachmentRejected: { zhCN: "已拒绝", enUS: "Rejected" },
} as const satisfies Record<string, LocalizedText>;

const DISCLAIMER_TEXT = {
  "quotation-non-advice": {
    zhCN: "本文件由 OpenTrad 辅助生成，不构成法律、税务或会计意见。",
    enUS: "Generated with OpenTrad. This document is not legal, tax, or accounting advice.",
  },
  "contract-generation-note": {
    zhCN: "本文件为根据用户输入生成的合同草案，签署前请进行专业审阅。",
    enUS: "This contract draft was generated from user input and should be professionally reviewed before signing.",
  },
  "international-choice-warning": {
    zhCN: "国际交易条款、适用法律与争议解决方式须由交易双方自行确认。",
    enUS: "The parties must confirm the trade terms, governing law and dispute resolution for the international transaction.",
  },
  "bid-authority": {
    zhCN: "投标文件须以招标文件及有权机构的最终要求为准。",
    enUS: "The tender documents and final requirements of the competent authority prevail.",
  },
} as const satisfies Record<DisclaimerRefV2, LocalizedText>;

const V1_COMPATIBILITY_MODELS = new WeakSet<object>();

function defineDataProperty(target: object, key: PropertyKey, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function createEmptyLocalizedText(): LocalizedText {
  const value = Object.create(null) as LocalizedText;
  defineDataProperty(value, "zhCN", "");
  return Object.freeze(value);
}

const EMPTY_LOCALIZED_TEXT = createEmptyLocalizedText();

function localized(zhCN: string): LocalizedText {
  return { zhCN };
}

function assertNever(value: never): never {
  throw new Error(`Unsupported V1 document node: ${String(value)}`);
}

function cloneFrozenDataGraph<T>(value: T, active = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  if (active.has(value)) throw new Error("内部兼容文档不能包含循环引用");
  active.add(value);

  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new Error("内部兼容文档数组原型无效");
      }
      const output: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor)) {
          throw new Error("内部兼容文档数组必须稠密且仅含数据属性");
        }
        defineDataProperty(output, index, cloneFrozenDataGraph(descriptor.value, active));
      }
      const expectedKeys = new Set(["length", ...value.map((_, index) => String(index))]);
      if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !expectedKeys.has(key))) {
        throw new Error("内部兼容文档数组包含额外属性");
      }
      return Object.freeze(output) as T;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("内部兼容文档对象原型无效");
    }
    const output = Object.create(null) as Record<PropertyKey, unknown>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new Error("内部兼容文档不能包含符号键");
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) {
        throw new Error("内部兼容文档只能包含数据属性");
      }
      defineDataProperty(output, key, cloneFrozenDataGraph(descriptor.value, active));
    }
    return Object.freeze(output) as T;
  } finally {
    active.delete(value);
  }
}

function ownStringProperty(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor && typeof descriptor.value === "string"
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function ownV1CellValue(cells: Readonly<Record<string, string>>, columnId: string): string {
  return ownStringProperty(cells, columnId) ?? "";
}

function mapV1Cells(
  columns: readonly { readonly id: string }[],
  cells: Readonly<Record<string, string>>,
): Readonly<Record<string, LocalizedText>> {
  const output = Object.create(null) as Record<string, LocalizedText>;
  for (const column of columns) {
    defineDataProperty(output, column.id, localized(ownV1CellValue(cells, column.id)));
  }
  return output;
}

function convertV1Node(node: DocumentNode): DocumentBlockV2 {
  switch (node.type) {
    case "heading":
      return { type: "heading", id: node.id, level: node.level, text: localized(node.text) };
    case "metadata":
      return {
        type: "keyValueGrid",
        id: node.id,
        entries: node.entries.map((entry) => ({
          id: entry.id,
          label: localized(entry.label),
          value: localized(entry.value),
        })),
      };
    case "parties":
      return {
        type: "parties",
        id: node.id,
        parties: node.parties.map((party) => ({
          id: party.role,
          role: localized(party.label),
          name: localized(party.name),
          details: party.details.map(localized),
        })),
      };
    case "table":
      return {
        type: "table",
        id: node.id,
        columns: node.columns.map((column) => ({
          id: column.id,
          label: localized(column.label),
          width: column.width,
          align: column.align,
        })),
        rows: node.rows.map((row) => ({
          id: row.id,
          cells: mapV1Cells(node.columns, row.cells),
        })),
        repeatHeader: node.repeatHeader,
        pagePolicy: {
          allowRowSplit: node.pagePolicy.allowRowSplit,
          keepHeaderWithRows: node.pagePolicy.keepHeaderWithRows,
        },
      };
    case "totals":
      return {
        type: "totals",
        id: node.id,
        entries: node.entries.map((entry) => ({
          id: entry.id,
          label: localized(entry.label),
          value: localized(entry.value),
        })),
      };
    case "terms":
      return {
        type: "clauseGroup",
        id: node.id,
        title: localized("条款与备注"),
        clauses: node.entries.map((entry, index) => ({
          id: entry.id,
          number: String(index + 1),
          title: localized(entry.label),
          paragraphs: [localized(entry.value)],
        })),
      };
    case "notice":
      return {
        type: "notice",
        id: node.id,
        tone: "info",
        paragraphs: node.paragraphs.map(localized),
      };
    case "signature":
      return {
        type: "signatureGroup",
        id: node.id,
        signers: [
          {
            role: localized(node.signerLabel),
            name: "________________",
            dateLabel: localized(node.dateLabel),
          },
        ],
      };
    default:
      return assertNever(node);
  }
}

function ownSchemaVersion(input: unknown): unknown {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(input, "schemaVersion");
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeDocumentModel(input: DocumentModel | DocumentModelV2): DocumentModelV2 {
  if (input !== null && typeof input === "object" && V1_COMPATIBILITY_MODELS.has(input)) {
    return input as DocumentModelV2;
  }
  const schemaVersion = ownSchemaVersion(input);
  if (schemaVersion === "2.0.0") {
    return DocumentModelV2Schema.parse(input);
  }
  if (schemaVersion !== "1.0.0") {
    throw new Error("不支持的文档模型版本");
  }

  const v1 = DocumentModelSchema.parse(input);
  const compatibilityModel: DocumentModelV2 = {
    schemaVersion: "2.0.0",
    documentId: v1.documentId,
    template: {
      id: v1.templateId,
      version: v1.templateVersion,
      basisDate: STANDARD_GOODS_QUOTE_BASIS_DATE,
    },
    documentKind: "quotation",
    language: "zh-CN",
    title: { zhCN: "标准货物报价单" },
    pageDefaults: {
      size: v1.page.size,
      orientation: v1.page.orientation,
      marginsMm: {
        top: v1.page.marginsMm.top,
        right: v1.page.marginsMm.right,
        bottom: v1.page.marginsMm.bottom,
        left: v1.page.marginsMm.left,
      },
    },
    sections: [
      {
        id: "v1-content",
        blocks: v1.nodes.map(convertV1Node),
      },
    ],
    watermarks: [],
    // The V1 compiler already carries this exact notice as visible content.
    disclaimers: [],
    attachmentManifest: [],
  };
  const normalized = cloneFrozenDataGraph(compatibilityModel);
  V1_COMPATIBILITY_MODELS.add(normalized);
  return normalized;
}

export function localizedTextParts(
  text: LocalizedText,
  languageView: DocumentLanguageV2,
): readonly LocalizedTextPart[] {
  const chinese = ownStringProperty(text, "zhCN") ?? "";
  const ownEnglish = ownStringProperty(text, "enUS");
  const english = ownEnglish?.trim() ? ownEnglish : undefined;
  if (languageView === "zh-CN" || english === undefined) {
    return [{ language: "zh-CN", text: chinese }];
  }
  if (languageView === "en-US") {
    return [{ language: "en-US", text: english }];
  }
  if (english === chinese) {
    return [{ language: "zh-CN", text: chinese }];
  }
  return [
    { language: "zh-CN", text: chinese },
    { language: "en-US", text: english },
  ];
}

export function documentCellValue(
  cells: Readonly<Record<string, LocalizedText>>,
  columnId: string,
): LocalizedText {
  if (cells === null || typeof cells !== "object") return EMPTY_LOCALIZED_TEXT;
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(cells, columnId);
    if (!descriptor || !("value" in descriptor)) return EMPTY_LOCALIZED_TEXT;
    const candidate = descriptor.value as unknown;
    return ownStringProperty(candidate, "zhCN") === undefined
      ? EMPTY_LOCALIZED_TEXT
      : (candidate as LocalizedText);
  } catch {
    return EMPTY_LOCALIZED_TEXT;
  }
}

export function localizedTextValue(
  text: LocalizedText,
  languageView: DocumentLanguageV2,
  separator = " / ",
): string {
  return localizedTextParts(text, languageView)
    .map((part) => part.text)
    .join(separator);
}

export function documentDisclaimerText(
  disclaimer: DisclaimerRefV2,
  languageView: DocumentLanguageV2,
): string {
  return localizedTextValue(DISCLAIMER_TEXT[disclaimer], languageView);
}

export function complianceRequirementText(
  substantial: boolean,
  languageView: DocumentLanguageV2,
): string {
  return localizedTextValue(
    substantial ? CONTENT_LABELS.substantial : CONTENT_LABELS.nonSubstantial,
    languageView,
  );
}

type Attachment = DocumentModelV2["attachmentManifest"][number];

function attachmentStatusLocalizedText(attachment: Attachment): LocalizedText {
  if (attachment.status === "attached") return CONTENT_LABELS.attachmentAttached;
  if (attachment.status === "missing") return CONTENT_LABELS.attachmentMissing;
  return CONTENT_LABELS.attachmentRejected;
}

export function attachmentStatusText(
  attachment: Attachment,
  languageView: DocumentLanguageV2,
): string {
  return localizedTextValue(attachmentStatusLocalizedText(attachment), languageView);
}

function requireAttachment(
  attachments: ReadonlyMap<string, Attachment>,
  attachmentId: string,
): Attachment {
  const attachment = attachments.get(attachmentId);
  if (!attachment) throw new Error("附件引用无效");
  return attachment;
}

function collectBlockSemanticText(
  block: DocumentBlockV2,
  attachments: ReadonlyMap<string, Attachment>,
  languageView: DocumentLanguageV2,
): string[] {
  const text = (value: LocalizedText) => localizedTextValue(value, languageView);
  switch (block.type) {
    case "cover":
      return [text(block.title), ...(block.subtitle ? [text(block.subtitle)] : [])];
    case "heading":
      return [text(block.text)];
    case "paragraph":
      return [text(block.text)];
    case "keyValueGrid":
      return block.entries.flatMap((entry) => [text(entry.label), text(entry.value)]);
    case "parties":
      return block.parties.flatMap((party) => [
        text(party.role),
        text(party.name),
        ...party.details.map(text),
      ]);
    case "table":
      return [
        ...block.columns.map((column) => text(column.label)),
        ...block.rows.flatMap((row) =>
          block.columns.map((column) => text(documentCellValue(row.cells, column.id))),
        ),
      ];
    case "totals":
      return block.entries.flatMap((entry) => [text(entry.label), text(entry.value)]);
    case "clauseGroup":
      return [
        text(block.title),
        ...block.clauses.flatMap((clause) => [
          clause.number,
          text(clause.title),
          ...clause.paragraphs.map(text),
        ]),
      ];
    case "list":
      return block.items.map(text);
    case "notice":
      return block.paragraphs.map(text);
    case "declaration":
      return [text(block.title), ...block.paragraphs.map(text)];
    case "toc":
      return [text(CONTENT_LABELS.toc)];
    case "complianceMatrix":
      return [
        ...block.columns.map((column) => text(column.label)),
        ...block.rows.flatMap((row) => [
          row.sourceRef,
          complianceRequirementText(row.substantial, languageView),
          ...block.columns.map((column) => text(documentCellValue(row.cells, column.id))),
        ]),
      ];
    case "attachmentIndex":
      return block.attachmentIds.flatMap((attachmentId) => {
        const attachment = requireAttachment(attachments, attachmentId);
        return [attachment.displayName, attachmentStatusText(attachment, languageView)];
      });
    case "attachmentPage": {
      const attachment = requireAttachment(attachments, block.attachmentId);
      return [
        attachment.displayName,
        localizedTextValue(
          { zhCN: `第 ${block.pageNumber} 页`, enUS: `Page ${block.pageNumber}` },
          languageView,
        ),
      ];
    }
    case "signatureGroup":
      return block.signers.flatMap((signer) => [
        text(signer.role),
        signer.name,
        text(signer.dateLabel),
        ...(signer.sealLabel ? [text(signer.sealLabel)] : []),
      ]);
    case "pageBreak":
      return [];
    default:
      return assertNever(block);
  }
}

export function semanticTextDigest(
  input: DocumentModel | DocumentModelV2,
  languageView: DocumentLanguageV2,
): string {
  const model = normalizeDocumentModel(input);
  const attachments = new Map(
    model.attachmentManifest.map((attachment) => [attachment.id, attachment] as const),
  );
  const values = [
    localizedTextValue(model.title, languageView),
    ...model.sections.flatMap((section) =>
      section.blocks.flatMap((block) => collectBlockSemanticText(block, attachments, languageView)),
    ),
    ...model.disclaimers.map((disclaimer) => documentDisclaimerText(disclaimer, languageView)),
  ];
  return values
    .map((value) => value.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export const DOCUMENT_CONTENT_LABELS = CONTENT_LABELS;
export const DOCUMENT_DISCLAIMER_TEXT = DISCLAIMER_TEXT;
