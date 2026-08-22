import {
  type DocumentBlockV2,
  type DocumentLanguageV2,
  type DocumentModel,
  type DocumentModelV2,
  type LayoutStyleId,
  type LocalizedText,
  v2,
} from "@opentrad/document-core";
import type {
  Content,
  ContentSection,
  ContextPageSize,
  DynamicBackground,
  DynamicContent,
  TDocumentDefinitions,
} from "pdfmake/interfaces";
import {
  attachmentStatusText,
  complianceRequirementText,
  documentCellValue,
  documentDisclaimerText,
  localizedTextValue,
  normalizeDocumentModel,
} from "../normalizeModel";
import { allocateComplianceMatrixWidthsTwips, allocatePercentageWidthsTwips } from "../tableWidths";

const PDF_FONT = "SourceHanSansCN";
const WIDTH_VALIDATION_UNITS = 10_000;

const LABELS = {
  toc: { zhCN: "目录", enUS: "Table of contents" },
  sourceReference: { zhCN: "来源条款", enUS: "Source reference" },
  requirementType: { zhCN: "要求性质", enUS: "Requirement type" },
  attachment: { zhCN: "附件", enUS: "Attachment" },
  status: { zhCN: "状态", enUS: "Status" },
  localAttachmentPlaceholder: {
    zhCN: "本地附件占位符",
    enUS: "Local attachment placeholder",
  },
  page: { zhCN: "页", enUS: "Page" },
  disclaimer: { zhCN: "使用提示", enUS: "Disclaimer" },
} as const satisfies Record<string, LocalizedText>;

type PresentationProfile = ReturnType<typeof v2.getPresentationProfile>;
type Attachment = DocumentModelV2["attachmentManifest"][number];

interface PdfContext {
  readonly languageView: DocumentLanguageV2;
  readonly profile: PresentationProfile;
  readonly attachments: ReadonlyMap<string, Attachment>;
  readonly tocDepth: number;
}

function millimetresToPoints(value: number): number {
  return (value * 72) / 25.4;
}

function text(value: LocalizedText, context: PdfContext): string {
  return localizedTextValue(value, context.languageView);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported V2 document block: ${String(value)}`);
}

function requireAttachment(
  attachments: ReadonlyMap<string, Attachment>,
  attachmentId: string,
): Attachment {
  const attachment = attachments.get(attachmentId);
  if (!attachment) throw new Error("附件引用无效");
  return attachment;
}

function tableCell(
  value: string,
  context: PdfContext,
  options: {
    readonly alignment?: "left" | "center" | "right";
    readonly bold?: boolean;
    readonly fillColor?: string;
    readonly color?: string;
  } = {},
): Content {
  return {
    text: value,
    alignment: options.alignment,
    bold: options.bold,
    color: options.color ?? context.profile.colors.ink,
    fillColor: options.fillColor,
    font: PDF_FONT,
    fontSize: context.profile.typography.smallPt,
    margin: [
      context.profile.spacing.cellPaddingPt,
      context.profile.spacing.cellPaddingPt,
      context.profile.spacing.cellPaddingPt,
      context.profile.spacing.cellPaddingPt,
    ],
  };
}

function headerCell(
  value: string,
  context: PdfContext,
  alignment: "left" | "center" | "right" = "center",
): Content {
  return tableCell(value, context, {
    alignment,
    bold: true,
    fillColor: context.profile.table.headerFill,
    color: context.profile.table.headerText,
  });
}

function emptyBlock(): Content {
  return { text: "" };
}

function blockToPdfContent(block: DocumentBlockV2, context: PdfContext): Content {
  const profile = context.profile;
  const blockAfter = profile.spacing.blockAfterPt;
  switch (block.type) {
    case "cover":
      return {
        stack: [
          {
            text: text(block.title, context),
            style: "coverTitle",
          },
          ...(block.subtitle
            ? [
                {
                  text: text(block.subtitle, context),
                  alignment: "center" as const,
                  color: profile.colors.muted,
                  font: PDF_FONT,
                  margin: [0, 4, 0, 0] as [number, number, number, number],
                },
              ]
            : []),
        ],
        margin: [0, 0, 0, blockAfter],
        unbreakable: true,
      };
    case "heading":
      return {
        text: text(block.text, context),
        style: `heading${block.level}`,
        tocItem: block.level <= context.tocDepth,
      };
    case "paragraph":
      return {
        text: text(block.text, context),
        margin: [0, 0, 0, profile.spacing.paragraphAfterPt],
      };
    case "keyValueGrid":
      if (block.entries.length === 0) return emptyBlock();
      return {
        table: {
          widths: ["32%", "68%"],
          dontBreakRows: true,
          body: block.entries.map((entry) => [
            tableCell(text(entry.label, context), context, {
              bold: true,
              color: profile.colors.accent,
              fillColor: profile.colors.paper,
            }),
            tableCell(text(entry.value, context), context),
          ]),
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, blockAfter],
      };
    case "parties":
      if (block.parties.length === 0) return emptyBlock();
      return {
        columnGap: 10,
        columns: block.parties.map((party, index) => ({
          width: "*",
          fillColor: index % 2 === 0 ? profile.colors.paper : profile.table.headerFill,
          margin: [6, 6, 6, 6],
          stack: [
            {
              text: text(party.role, context),
              bold: true,
              color: profile.colors.accent,
              font: PDF_FONT,
              fontSize: profile.typography.smallPt,
            },
            {
              text: text(party.name, context),
              bold: true,
              font: PDF_FONT,
              margin: [0, 3, 0, 3],
            },
            ...party.details.map((detail) => ({
              text: text(detail, context),
              font: PDF_FONT,
              fontSize: profile.typography.smallPt,
            })),
          ],
        })),
        margin: [0, 0, 0, blockAfter],
      };
    case "table": {
      allocatePercentageWidthsTwips(
        block.columns.map((column) => column.width),
        WIDTH_VALIDATION_UNITS,
      );
      return {
        table: {
          headerRows: block.repeatHeader ? 1 : 0,
          dontBreakRows: !block.pagePolicy.allowRowSplit,
          keepWithHeaderRows: block.pagePolicy.keepHeaderWithRows,
          widths: block.columns.map((column) => column.width),
          body: [
            block.columns.map((column) =>
              headerCell(text(column.label, context), context, column.align),
            ),
            ...block.rows.map((row, rowIndex) =>
              block.columns.map((column) =>
                tableCell(text(documentCellValue(row.cells, column.id), context), context, {
                  alignment: column.align,
                  fillColor:
                    profile.table.striped && rowIndex % 2 === 1 ? profile.colors.paper : undefined,
                }),
              ),
            ),
          ],
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, blockAfter],
      };
    }
    case "totals":
      if (block.entries.length === 0) return emptyBlock();
      return {
        table: {
          widths: ["70%", "30%"],
          dontBreakRows: true,
          body: block.entries.map((entry, index) => {
            const grandTotal = index === block.entries.length - 1;
            return [
              tableCell(text(entry.label, context), context, {
                alignment: "right",
                bold: grandTotal,
              }),
              tableCell(text(entry.value, context), context, {
                alignment: "right",
                bold: grandTotal,
                color: grandTotal ? profile.colors.accent : profile.colors.ink,
                fillColor: grandTotal ? profile.table.headerFill : undefined,
              }),
            ];
          }),
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, blockAfter],
      };
    case "clauseGroup":
      return {
        stack: [
          { text: text(block.title, context), style: "heading2" },
          ...block.clauses.flatMap((clause) => [
            {
              text: `${clause.number} ${text(clause.title, context)}`,
              bold: true,
              color: profile.colors.accent,
              font: PDF_FONT,
              margin: [0, 2, 0, 2] as [number, number, number, number],
            },
            ...clause.paragraphs.map((paragraph) => ({
              text: text(paragraph, context),
              font: PDF_FONT,
              margin: [0, 0, 0, profile.spacing.paragraphAfterPt] as [
                number,
                number,
                number,
                number,
              ],
            })),
          ]),
        ],
        margin: [0, 0, 0, blockAfter],
      };
    case "list":
      return {
        ...(block.ordered
          ? { ol: block.items.map((item) => text(item, context)) }
          : { ul: block.items.map((item) => text(item, context)) }),
        margin: [0, 0, 0, blockAfter],
      };
    case "notice":
      return {
        stack: block.paragraphs.map((paragraph) => ({
          text: text(paragraph, context),
          font: PDF_FONT,
          color:
            block.tone === "danger"
              ? "#8C2F24"
              : block.tone === "warning"
                ? "#805A16"
                : profile.colors.muted,
          bold: block.tone === "danger",
          margin: [0, 0, 0, profile.spacing.paragraphAfterPt],
        })),
        fillColor: profile.colors.paper,
        margin: [6, 6, 6, blockAfter],
      };
    case "declaration":
      return {
        stack: [
          { text: text(block.title, context), style: "heading2" },
          ...block.paragraphs.map((paragraph) => ({
            text: text(paragraph, context),
            font: PDF_FONT,
            margin: [0, 0, 0, profile.spacing.paragraphAfterPt] as [number, number, number, number],
          })),
        ],
        margin: [0, 0, 0, blockAfter],
      };
    case "toc":
      return {
        toc: {
          title: {
            text: text(LABELS.toc, context),
            style: "heading1",
            tocItem: false,
          },
        },
        margin: [0, 0, 0, blockAfter],
      };
    case "complianceMatrix": {
      const widths = allocateComplianceMatrixWidthsTwips(
        block.columns.map((column) => column.width),
        WIDTH_VALIDATION_UNITS,
      ).map((width) => `${width / 100}%`);
      return {
        table: {
          headerRows: 1,
          dontBreakRows: true,
          keepWithHeaderRows: 1,
          widths,
          body: [
            [
              headerCell(text(LABELS.sourceReference, context), context, "left"),
              headerCell(text(LABELS.requirementType, context), context),
              ...block.columns.map((column) =>
                headerCell(text(column.label, context), context, column.align),
              ),
            ],
            ...block.rows.map((row, rowIndex) => [
              tableCell(row.sourceRef, context, {
                fillColor:
                  profile.table.striped && rowIndex % 2 === 1 ? profile.colors.paper : undefined,
              }),
              tableCell(complianceRequirementText(row.substantial, context.languageView), context, {
                alignment: "center",
              }),
              ...block.columns.map((column) =>
                tableCell(text(documentCellValue(row.cells, column.id), context), context, {
                  alignment: column.align,
                }),
              ),
            ]),
          ],
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, blockAfter],
      };
    }
    case "attachmentIndex":
      if (block.attachmentIds.length === 0) return emptyBlock();
      return {
        table: {
          headerRows: 1,
          dontBreakRows: true,
          keepWithHeaderRows: 1,
          widths: ["75%", "25%"],
          body: [
            [
              headerCell(text(LABELS.attachment, context), context, "left"),
              headerCell(text(LABELS.status, context), context),
            ],
            ...block.attachmentIds.map((attachmentId) => {
              const attachment = requireAttachment(context.attachments, attachmentId);
              return [
                tableCell(attachment.displayName, context),
                tableCell(attachmentStatusText(attachment, context.languageView), context, {
                  alignment: "center",
                }),
              ];
            }),
          ],
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, blockAfter],
      };
    case "attachmentPage": {
      const attachment = requireAttachment(context.attachments, block.attachmentId);
      return {
        stack: [
          { text: attachment.displayName, style: "heading2" },
          {
            text: localizedTextValue(
              { zhCN: `第 ${block.pageNumber} 页`, enUS: `Page ${block.pageNumber}` },
              context.languageView,
            ),
            font: PDF_FONT,
          },
          {
            text: text(LABELS.localAttachmentPlaceholder, context),
            font: PDF_FONT,
            color: profile.colors.muted,
            margin: [0, 8, 0, 0],
          },
        ],
        margin: [0, 0, 0, blockAfter],
        unbreakable: true,
      };
    }
    case "signatureGroup":
      return {
        table: {
          widths: block.signers.map(() => "*"),
          dontBreakRows: true,
          body: [
            block.signers.map((signer) => ({
              stack: [
                {
                  text: text(signer.role, context),
                  bold: true,
                  color: profile.colors.accent,
                  font: PDF_FONT,
                },
                { text: `${signer.name}：________________`, font: PDF_FONT },
                { text: `${text(signer.dateLabel, context)}：________________`, font: PDF_FONT },
                ...(signer.sealLabel
                  ? [
                      {
                        text: `${text(signer.sealLabel, context)}：________________`,
                        font: PDF_FONT,
                      },
                    ]
                  : []),
              ],
              margin: [6, 6, 6, 6],
            })),
          ],
        },
        layout: "lightHorizontalLines",
        margin: [0, 8, 0, 0],
        unbreakable: true,
      };
    case "pageBreak":
      return { text: "", pageBreak: "after" };
    default:
      return assertNever(block);
  }
}

function footerText(languageView: DocumentLanguageV2): string {
  if (languageView === "zh-CN") return "OpenTrad 开源商贸 · 本地生成";
  if (languageView === "en-US") return "OpenTrad · Generated locally";
  return "OpenTrad 开源商贸 · 本地生成 / OpenTrad · Generated locally";
}

function createFooter(languageView: DocumentLanguageV2, muted: string): DynamicContent {
  return (currentPage, pageCount) => ({
    text: `${footerText(languageView)} · ${currentPage} / ${pageCount}`,
    alignment: "center",
    color: muted,
    font: PDF_FONT,
    fontSize: 7,
    margin: [0, 10, 0, 0],
  });
}

function watermarkPosition(
  index: number,
  pageSize: ContextPageSize,
): { readonly x: number; readonly y: number } {
  const column = index % 2;
  const row = Math.floor(index / 2);
  return {
    x: Math.round(pageSize.width * (0.1 + column * 0.34)),
    y: Math.round(pageSize.height * (0.28 + row * 0.18 + column * 0.08)),
  };
}

function createBackground(model: DocumentModelV2, context: PdfContext): DynamicBackground {
  return (currentPage, pageSize) => {
    const visibleWatermarks = model.watermarks.filter(
      (watermark) => watermark.scope === "every-page" || currentPage === 1,
    );
    return [
      {
        font: PDF_FONT,
        canvas: [
          {
            type: "rect",
            x: 0,
            y: 0,
            w: pageSize.width,
            h: pageSize.height,
            color: context.profile.colors.paper,
          },
        ],
      },
      ...visibleWatermarks.map((watermark, index) => ({
        text: text(watermark.text, context),
        absolutePosition: watermarkPosition(index, pageSize),
        angle: -32,
        opacity: 0.13,
        bold: true,
        color: context.profile.colors.muted,
        font: PDF_FONT,
        fontSize: 34,
      })),
    ];
  };
}

function trimTrailingPageBreaks(blocks: readonly DocumentBlockV2[]): readonly DocumentBlockV2[] {
  let end = blocks.length;
  while (end > 0 && blocks[end - 1]?.type === "pageBreak") end -= 1;
  return blocks.slice(0, end);
}

export function buildPdfDefinitionV2(
  input: DocumentModel | DocumentModelV2,
  layoutStyleId: LayoutStyleId = "modern-business.v1",
  languageView: DocumentLanguageV2 = "zh-CN",
): TDocumentDefinitions {
  const model = normalizeDocumentModel(input);
  const validatedLanguage = v2.DocumentLanguageV2Schema.parse(languageView);
  const profile = v2.getPresentationProfile(layoutStyleId);
  const attachments = new Map(
    model.attachmentManifest.map((attachment) => [attachment.id, attachment] as const),
  );
  const tocDepth = model.sections
    .flatMap((section) => section.blocks)
    .reduce((depth, block) => (block.type === "toc" ? Math.max(depth, block.maxDepth) : depth), 0);
  const context: PdfContext = {
    languageView: validatedLanguage,
    profile,
    attachments,
    tocDepth,
  };
  const title = localizedTextValue(model.title, validatedLanguage);
  const pageMargins: [number, number, number, number] = [
    millimetresToPoints(model.pageDefaults.marginsMm.left),
    millimetresToPoints(model.pageDefaults.marginsMm.top),
    millimetresToPoints(model.pageDefaults.marginsMm.right),
    millimetresToPoints(model.pageDefaults.marginsMm.bottom),
  ];
  const footer = createFooter(validatedLanguage, profile.colors.muted);
  const background = createBackground(model, context);
  const sourceSections =
    model.sections.length > 0
      ? model.sections
      : [{ id: "pdf-empty-fallback", blocks: [] as readonly DocumentBlockV2[] }];
  const content: ContentSection[] = sourceSections.map((section, sectionIndex) => {
    const stack: Content[] = [];
    if (sectionIndex === 0) {
      stack.push({ text: title, style: "documentTitle", font: PDF_FONT });
    }
    for (const block of trimTrailingPageBreaks(section.blocks)) {
      stack.push({ id: block.id, text: "", font: PDF_FONT });
      stack.push(blockToPdfContent(block, context));
    }
    if (sectionIndex === sourceSections.length - 1 && model.disclaimers.length > 0) {
      stack.push({
        text: localizedTextValue(LABELS.disclaimer, validatedLanguage),
        style: "heading2",
        font: PDF_FONT,
      });
      stack.push(
        ...model.disclaimers.map((disclaimer) => ({
          text: documentDisclaimerText(disclaimer, validatedLanguage),
          color: profile.colors.muted,
          font: PDF_FONT,
          fontSize: profile.typography.smallPt,
          margin: [0, 0, 0, profile.spacing.paragraphAfterPt] as [number, number, number, number],
        })),
      );
    }
    if (stack.length === 0) stack.push({ text: "", font: PDF_FONT });
    return {
      section: { stack },
      pageSize: "A4",
      pageOrientation: section.page?.orientation ?? model.pageDefaults.orientation,
      pageMargins,
      footer,
      background,
    };
  });

  return {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins,
    info: {
      title,
      author: "OpenTrad",
      subject: "OpenTrad local document export",
      creator: "OpenTrad",
      producer: "OpenTrad",
    },
    language:
      validatedLanguage === "zh-CN" ? "zh-CN" : validatedLanguage === "en-US" ? "en-US" : "zh-CN",
    defaultStyle: {
      font: PDF_FONT,
      fontSize: profile.typography.bodyPt,
      color: profile.colors.ink,
      lineHeight: 1.25,
    },
    styles: {
      documentTitle: {
        font: PDF_FONT,
        fontSize: profile.typography.titlePt,
        bold: true,
        color: profile.colors.accent,
        alignment: "center",
        margin: [0, 0, 0, profile.spacing.blockAfterPt],
      },
      coverTitle: {
        font: PDF_FONT,
        fontSize: profile.typography.titlePt,
        bold: true,
        color: profile.colors.accent,
        alignment: "center",
        margin: [0, 12, 0, 8],
      },
      heading1: {
        font: PDF_FONT,
        fontSize: profile.typography.headingPt,
        bold: true,
        color: profile.colors.accent,
        margin: [0, profile.spacing.blockAfterPt, 0, profile.spacing.paragraphAfterPt],
      },
      heading2: {
        font: PDF_FONT,
        fontSize: Math.max(profile.typography.bodyPt + 1, profile.typography.headingPt - 1),
        bold: true,
        color: profile.colors.accent,
        margin: [0, profile.spacing.blockAfterPt, 0, profile.spacing.paragraphAfterPt],
      },
      heading3: {
        font: PDF_FONT,
        fontSize: profile.typography.bodyPt,
        bold: true,
        color: profile.colors.accent,
        margin: [0, profile.spacing.paragraphAfterPt, 0, profile.spacing.paragraphAfterPt],
      },
    },
    footer,
    background,
    content,
  };
}
