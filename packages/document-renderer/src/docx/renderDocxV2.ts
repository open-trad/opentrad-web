import type {
  DocumentLanguageV2,
  DocumentModel,
  DocumentModelV2,
  LayoutStyleId,
  LocalizedText,
} from "@opentrad/document-core";
import {
  type AttachmentPageImage,
  AttachmentPageImagesValidationError,
  attachmentPageImageKey,
  type RenderDocxV2Options,
  type TrustedAttachmentPageImage,
  validateAttachmentPageImages,
} from "../attachmentPageImages.js";
import {
  attachmentStatusText,
  complianceRequirementText,
  documentCellValue,
  documentDisclaimerText,
  localizedTextValue,
} from "../normalizeModel.js";
import {
  A4_PORTRAIT_HEIGHT_TWIPS,
  A4_PORTRAIT_WIDTH_TWIPS,
  buildDocxPlanV2,
  type DocxPlanBlockV2,
  type DocxPlanV2,
} from "./buildDocxPlan.js";

export type { DocxPlanBlockV2, DocxPlanSectionV2, DocxPlanV2 } from "./buildDocxPlan.js";
export { buildDocxPlanV2 } from "./buildDocxPlan.js";

export const DOCX_V2_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const ATTACHMENT_PAGE_VERTICAL_RESERVE_TWIPS = 1_800;
const DOCUMENT_FONT = "Source Han Sans CN";
const TWIPS_PER_IMAGE_PIXEL = 15;
const ATTACHMENT_OVERLAY_CAVEAT_ZH_CN =
  "附件按页面图像嵌入，正文可编辑不表示附件可编辑或已重新识别";
const ATTACHMENT_OVERLAY_CAVEAT_EN_US =
  "Attachments are embedded as page images. An editable body does not mean attachments are editable or have been re-recognized.";

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

type Attachment = DocumentModelV2["attachmentManifest"][number];

export { AttachmentPageImagesValidationError };
export type { AttachmentPageImage, RenderDocxV2Options };

export class DocxV2GenerationError extends Error {
  readonly code = "DOCX_V2_GENERATION_FAILED" as const;

  constructor() {
    super("Word 文件生成失败，请检查文档内容后重试");
    this.name = "DocxV2GenerationError";
  }
}

function stripHash(color: string): string {
  return color.startsWith("#") ? color.slice(1) : color;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported V2 document block: ${String(value)}`);
}

function requiredWidth(widths: readonly number[], index: number): number {
  const width = widths[index];
  if (width === undefined) throw new Error("DOCX 表格列宽无效");
  return width;
}

function fitAttachmentPageImage(
  image: TrustedAttachmentPageImage,
  availableWidthTwips: number,
  availableHeightTwips: number,
): { readonly width: number; readonly height: number } {
  const maximumWidth = Math.max(1, Math.floor(availableWidthTwips / TWIPS_PER_IMAGE_PIXEL));
  const maximumHeight = Math.max(
    1,
    Math.floor(
      (availableHeightTwips - ATTACHMENT_PAGE_VERTICAL_RESERVE_TWIPS) / TWIPS_PER_IMAGE_PIXEL,
    ),
  );
  const scale = Math.min(1, maximumWidth / image.widthPixels, maximumHeight / image.heightPixels);
  return Object.freeze({
    width: Math.max(1, Math.floor(image.widthPixels * scale)),
    height: Math.max(1, Math.floor(image.heightPixels * scale)),
  });
}

export async function renderDocxV2(
  input: DocumentModel | DocumentModelV2,
  layoutStyleId: LayoutStyleId = "modern-business.v1",
  languageView: DocumentLanguageV2 = "zh-CN",
  options?: RenderDocxV2Options,
): Promise<Blob> {
  const plan = buildDocxPlanV2(input, layoutStyleId, languageView);
  const attachmentPageImages = validateAttachmentPageImages(plan, options);
  try {
    const docx = await import("docx");
    return await renderDocxPlanV2(plan, docx, attachmentPageImages);
  } catch {
    throw new DocxV2GenerationError();
  }
}

async function renderDocxPlanV2(
  plan: DocxPlanV2,
  docx: typeof import("docx"),
  attachmentPageImages: ReadonlyMap<string, TrustedAttachmentPageImage>,
): Promise<Blob> {
  const profile = plan.profile;
  const ink = stripHash(profile.colors.ink);
  const accent = stripHash(profile.colors.accent);
  const muted = stripHash(profile.colors.muted);
  const rule = stripHash(profile.colors.rule);
  const headerFill = stripHash(profile.table.headerFill);
  const headerText = stripHash(profile.table.headerText);
  const bodySize = Math.round(profile.typography.bodyPt * 2);
  const smallSize = Math.round(profile.typography.smallPt * 2);
  const titleSize = Math.round(profile.typography.titlePt * 2);
  const headingSize = Math.round(profile.typography.headingPt * 2);
  const blockAfter = Math.round(profile.spacing.blockAfterPt * 20);
  const paragraphAfter = Math.round(profile.spacing.paragraphAfterPt * 20);
  const cellPadding = Math.round(profile.spacing.cellPaddingPt * 20);
  const border = { color: rule, size: 4, style: docx.BorderStyle.SINGLE };
  const tableBorders = {
    top: border,
    bottom: border,
    left: border,
    right: border,
    insideHorizontal: border,
    insideVertical: border,
  };
  const attachments = new Map(
    plan.attachmentManifest.map((attachment) => [attachment.id, attachment] as const),
  );
  const label = (value: LocalizedText) => localizedTextValue(value, plan.languageView);

  function textRuns(
    text: string,
    options: Omit<import("docx").IRunOptions, "break" | "text"> = {},
  ): import("docx").TextRun[] {
    return text.split("\n").map(
      (line, index) =>
        new docx.TextRun({
          ...options,
          text: line,
          break: index === 0 ? undefined : 1,
        }),
    );
  }

  function paragraph(
    text: string,
    options: {
      readonly alignment?: (typeof docx.AlignmentType)[keyof typeof docx.AlignmentType];
      readonly bold?: boolean;
      readonly color?: string;
      readonly size?: number;
      readonly before?: number;
      readonly after?: number;
      readonly keepNext?: boolean;
      readonly italics?: boolean;
      readonly heading?: (typeof docx.HeadingLevel)[keyof typeof docx.HeadingLevel];
      readonly style?: string;
      readonly shading?: string;
    } = {},
  ): import("docx").Paragraph {
    return new docx.Paragraph({
      alignment: options.alignment,
      heading: options.heading,
      style: options.style,
      keepNext: options.keepNext,
      shading: options.shading ? { fill: options.shading } : undefined,
      spacing: {
        before: options.before ?? 0,
        after: options.after ?? paragraphAfter,
        line: 276,
      },
      children: textRuns(text, {
        bold: options.bold,
        italics: options.italics,
        color: options.color ?? ink,
        size: options.size ?? bodySize,
        font: DOCUMENT_FONT,
        language: {
          value: plan.languageView === "en-US" ? "en-US" : "zh-CN",
          eastAsia: "zh-CN",
        },
      }),
    });
  }

  function tableCell(
    text: string,
    width: number,
    options: {
      readonly bold?: boolean;
      readonly fill?: string;
      readonly color?: string;
      readonly alignment?: (typeof docx.AlignmentType)[keyof typeof docx.AlignmentType];
      readonly keepNext?: boolean;
    } = {},
  ): import("docx").TableCell {
    return new docx.TableCell({
      width: { size: width, type: docx.WidthType.DXA },
      margins: {
        top: cellPadding,
        right: cellPadding,
        bottom: cellPadding,
        left: cellPadding,
      },
      verticalAlign: docx.VerticalAlign.CENTER,
      shading: options.fill ? { fill: options.fill } : undefined,
      children: [
        new docx.Paragraph({
          alignment: options.alignment,
          keepNext: options.keepNext,
          spacing: { after: 0, line: 260 },
          children: textRuns(text, {
            bold: options.bold,
            color: options.color ?? ink,
            size: bodySize,
            font: DOCUMENT_FONT,
            language: {
              value: plan.languageView === "en-US" ? "en-US" : "zh-CN",
              eastAsia: "zh-CN",
            },
          }),
        }),
      ],
    });
  }

  function fixedTable(
    widths: readonly number[],
    rows: readonly import("docx").TableRow[],
  ): import("docx").Table {
    return new docx.Table({
      width: { size: widths.reduce((sum, width) => sum + width, 0), type: docx.WidthType.DXA },
      layout: docx.TableLayoutType.FIXED,
      columnWidths: widths,
      borders: tableBorders,
      rows,
    });
  }

  function pairTable(
    entries: readonly { readonly label: string; readonly value: string }[],
    availableWidth: number,
  ): import("docx").Table {
    const labelWidth = Math.round(availableWidth * 0.35);
    const widths = [labelWidth, availableWidth - labelWidth];
    return fixedTable(
      widths,
      entries.map(
        (entry) =>
          new docx.TableRow({
            cantSplit: true,
            children: [
              tableCell(entry.label, requiredWidth(widths, 0), {
                bold: true,
                fill: headerFill,
                color: headerText,
              }),
              tableCell(entry.value, requiredWidth(widths, 1)),
            ],
          }),
      ),
    );
  }

  function requireAttachment(attachmentId: string): Attachment {
    const attachment = attachments.get(attachmentId);
    if (!attachment) throw new Error("附件引用无效");
    return attachment;
  }

  function attachmentPageTitle(attachment: Attachment, pageNumber: number): string {
    const pageLabel =
      plan.languageView === "en-US"
        ? `${label(LABELS.page)} ${pageNumber}`
        : plan.languageView === "zh-en"
          ? `第 ${pageNumber} 页 / Page ${pageNumber}`
          : `第 ${pageNumber} 页`;
    return `${attachment.displayName} · ${pageLabel}`;
  }

  function attachmentImageParagraph(
    pageImage: TrustedAttachmentPageImage,
    availableWidth: number,
    availableHeight: number,
  ): import("docx").Paragraph {
    return new docx.Paragraph({
      alignment: docx.AlignmentType.CENTER,
      spacing: { after: blockAfter },
      children: [
        new docx.ImageRun({
          type: "jpg",
          data: pageImage.bytes,
          transformation: fitAttachmentPageImage(pageImage, availableWidth, availableHeight),
        }),
      ],
    });
  }

  function headingLevel(level: 1 | 2 | 3) {
    if (level === 1) return docx.HeadingLevel.HEADING_1;
    if (level === 2) return docx.HeadingLevel.HEADING_2;
    return docx.HeadingLevel.HEADING_3;
  }

  function renderDataTable(
    block: Extract<DocxPlanBlockV2, { type: "table" }>,
  ): import("docx").Table {
    const rows = [
      new docx.TableRow({
        tableHeader: block.repeatHeader,
        cantSplit: true,
        children: block.columns.map((column, index) =>
          tableCell(label(column.label), requiredWidth(block.columnWidthsTwips, index), {
            bold: true,
            fill: headerFill,
            color: headerText,
            alignment: docx.AlignmentType.CENTER,
            keepNext: block.pagePolicy.keepHeaderWithRows > 0,
          }),
        ),
      }),
      ...block.rows.map(
        (row, rowIndex) =>
          new docx.TableRow({
            cantSplit: block.cantSplitRows,
            children: block.columns.map((column, columnIndex) =>
              tableCell(
                localizedTextValue(documentCellValue(row.cells, column.id), plan.languageView),
                requiredWidth(block.columnWidthsTwips, columnIndex),
                {
                  alignment:
                    column.align === "center"
                      ? docx.AlignmentType.CENTER
                      : column.align === "right"
                        ? docx.AlignmentType.RIGHT
                        : docx.AlignmentType.LEFT,
                  fill:
                    profile.table.striped && rowIndex % 2 === 1
                      ? stripHash(profile.colors.paper)
                      : undefined,
                  keepNext: rowIndex < block.pagePolicy.keepHeaderWithRows,
                },
              ),
            ),
          }),
      ),
    ];
    return fixedTable(block.columnWidthsTwips, rows);
  }

  function renderComplianceTable(
    block: Extract<DocxPlanBlockV2, { type: "complianceMatrix" }>,
  ): import("docx").Table {
    const headers = [
      label(LABELS.sourceReference),
      label(LABELS.requirementType),
      ...block.columns.map((column) => label(column.label)),
    ];
    const rows = [
      new docx.TableRow({
        tableHeader: true,
        cantSplit: true,
        children: headers.map((text, index) =>
          tableCell(text, requiredWidth(block.columnWidthsTwips, index), {
            bold: true,
            fill: headerFill,
            color: headerText,
            alignment: docx.AlignmentType.CENTER,
            keepNext: true,
          }),
        ),
      }),
      ...block.rows.map(
        (row) =>
          new docx.TableRow({
            cantSplit: true,
            children: [
              tableCell(row.sourceRef, requiredWidth(block.columnWidthsTwips, 0)),
              tableCell(
                complianceRequirementText(row.substantial, plan.languageView),
                requiredWidth(block.columnWidthsTwips, 1),
              ),
              ...block.columns.map((column, index) =>
                tableCell(
                  localizedTextValue(documentCellValue(row.cells, column.id), plan.languageView),
                  requiredWidth(block.columnWidthsTwips, index + 2),
                ),
              ),
            ],
          }),
      ),
    ];
    return fixedTable(block.columnWidthsTwips, rows);
  }

  function renderBlock(
    block: DocxPlanBlockV2,
    availableWidth: number,
    availableHeight: number,
  ): import("docx").FileChild[] {
    switch (block.type) {
      case "cover":
        return [
          paragraph(label(block.title), {
            alignment: docx.AlignmentType.CENTER,
            bold: true,
            color: accent,
            size: titleSize,
            after: blockAfter,
            keepNext: true,
            style: "Title",
          }),
          ...(block.subtitle
            ? [
                paragraph(label(block.subtitle), {
                  alignment: docx.AlignmentType.CENTER,
                  color: muted,
                  size: headingSize,
                  after: blockAfter,
                }),
              ]
            : []),
        ];
      case "heading":
        return [
          paragraph(label(block.text), {
            bold: true,
            color: accent,
            size: headingSize,
            before: blockAfter,
            after: paragraphAfter,
            keepNext: true,
            heading: headingLevel(block.level),
          }),
        ];
      case "paragraph":
        return [paragraph(label(block.text))];
      case "keyValueGrid":
        if (block.entries.length === 0) return [paragraph("", { after: blockAfter })];
        return [
          pairTable(
            block.entries.map((entry) => ({
              label: label(entry.label),
              value: label(entry.value),
            })),
            availableWidth,
          ),
          paragraph("", { after: blockAfter }),
        ];
      case "parties": {
        if (block.parties.length === 0) return [paragraph("", { after: blockAfter })];
        const baseWidth = Math.floor(availableWidth / block.parties.length);
        const widths = block.parties.map((_, index) =>
          index === block.parties.length - 1
            ? availableWidth - baseWidth * (block.parties.length - 1)
            : baseWidth,
        );
        return [
          fixedTable(widths, [
            new docx.TableRow({
              cantSplit: true,
              children: block.parties.map((party, index) =>
                tableCell(
                  [label(party.role), label(party.name), ...party.details.map(label)].join("\n"),
                  requiredWidth(widths, index),
                  { bold: true },
                ),
              ),
            }),
          ]),
          paragraph("", { after: blockAfter }),
        ];
      }
      case "table":
        return [renderDataTable(block), paragraph("", { after: blockAfter })];
      case "totals":
        if (block.entries.length === 0) return [paragraph("", { after: blockAfter })];
        return [
          pairTable(
            block.entries.map((entry) => ({
              label: label(entry.label),
              value: label(entry.value),
            })),
            availableWidth,
          ),
          paragraph("", { after: blockAfter }),
        ];
      case "clauseGroup":
        return [
          paragraph(label(block.title), {
            heading: docx.HeadingLevel.HEADING_1,
            bold: true,
            color: accent,
            size: headingSize,
            keepNext: true,
          }),
          ...block.clauses.flatMap((clause) => [
            paragraph(`${clause.number} ${label(clause.title)}`, {
              heading: docx.HeadingLevel.HEADING_2,
              bold: true,
              size: bodySize,
              keepNext: true,
            }),
            ...clause.paragraphs.map((value) => paragraph(label(value))),
          ]),
        ];
      case "list":
        return block.items.map((item, index) =>
          paragraph(`${block.ordered ? `${index + 1}.` : "•"} ${label(item)}`),
        );
      case "notice":
        return block.paragraphs.map((value) =>
          paragraph(label(value), {
            bold: block.tone !== "info",
            color: block.tone === "danger" ? "8B1E1E" : accent,
            shading: block.tone === "danger" ? "F7E5E5" : headerFill,
          }),
        );
      case "declaration":
        return [
          paragraph(label(block.title), {
            heading: docx.HeadingLevel.HEADING_1,
            bold: true,
            color: accent,
            size: headingSize,
            keepNext: true,
          }),
          ...block.paragraphs.map((value) => paragraph(label(value))),
        ];
      case "toc":
        return [
          paragraph(label(LABELS.toc), {
            bold: true,
            color: accent,
            size: headingSize,
            keepNext: true,
          }),
          new docx.TableOfContents(label(LABELS.toc), {
            hyperlink: true,
            headingStyleRange: `1-${block.maxDepth}`,
          }),
        ];
      case "complianceMatrix":
        return [renderComplianceTable(block), paragraph("", { after: blockAfter })];
      case "attachmentIndex": {
        const nameWidth = Math.round(availableWidth * 0.7);
        const widths = [nameWidth, availableWidth - nameWidth];
        return [
          fixedTable(widths, [
            new docx.TableRow({
              tableHeader: true,
              cantSplit: true,
              children: [
                tableCell(label(LABELS.attachment), requiredWidth(widths, 0), {
                  bold: true,
                  fill: headerFill,
                  color: headerText,
                  keepNext: true,
                }),
                tableCell(label(LABELS.status), requiredWidth(widths, 1), {
                  bold: true,
                  fill: headerFill,
                  color: headerText,
                  keepNext: true,
                }),
              ],
            }),
            ...block.attachmentIds.map((attachmentId) => {
              const attachment = requireAttachment(attachmentId);
              return new docx.TableRow({
                cantSplit: true,
                children: [
                  tableCell(attachment.displayName, requiredWidth(widths, 0)),
                  tableCell(
                    attachmentStatusText(attachment, plan.languageView),
                    requiredWidth(widths, 1),
                  ),
                ],
              });
            }),
          ]),
          paragraph("", { after: blockAfter }),
        ];
      }
      case "attachmentPage": {
        const attachment = requireAttachment(block.attachmentId);
        const pageImage = attachmentPageImages.get(
          attachmentPageImageKey(block.attachmentId, block.pageNumber),
        );
        return [
          paragraph(attachmentPageTitle(attachment, block.pageNumber), {
            bold: true,
            color: accent,
            size: headingSize,
            keepNext: true,
          }),
          ...(pageImage
            ? [attachmentImageParagraph(pageImage, availableWidth, availableHeight)]
            : [
                paragraph(label(LABELS.localAttachmentPlaceholder), {
                  alignment: docx.AlignmentType.CENTER,
                  color: muted,
                  italics: true,
                  after: blockAfter,
                }),
              ]),
        ];
      }
      case "signatureGroup": {
        const baseWidth = Math.floor(availableWidth / block.signers.length);
        const widths = block.signers.map((_, index) =>
          index === block.signers.length - 1
            ? availableWidth - baseWidth * (block.signers.length - 1)
            : baseWidth,
        );
        return [
          fixedTable(widths, [
            new docx.TableRow({
              cantSplit: true,
              children: block.signers.map((signer, index) =>
                tableCell(
                  [
                    label(signer.role),
                    signer.name,
                    `${label(signer.dateLabel)}：________________`,
                    ...(signer.sealLabel ? [`${label(signer.sealLabel)}：________________`] : []),
                  ].join("\n"),
                  requiredWidth(widths, index),
                ),
              ),
            }),
          ]),
          paragraph("", { after: blockAfter }),
        ];
      }
      case "pageBreak":
        return [new docx.Paragraph({ children: [new docx.PageBreak()] })];
      default:
        return assertNever(block);
    }
  }

  function footer(): import("docx").Footer {
    return new docx.Footer({
      children: [
        new docx.Paragraph({
          alignment: docx.AlignmentType.CENTER,
          children: [
            new docx.TextRun({
              text: `${plan.footer.text} · `,
              color: muted,
              size: smallSize,
              font: DOCUMENT_FONT,
            }),
            new docx.TextRun({
              children: [docx.PageNumber.CURRENT],
              color: muted,
              size: smallSize,
              font: DOCUMENT_FONT,
            }),
            new docx.TextRun({ text: " / ", color: muted, size: smallSize, font: DOCUMENT_FONT }),
            new docx.TextRun({
              children: [docx.PageNumber.TOTAL_PAGES],
              color: muted,
              size: smallSize,
              font: DOCUMENT_FONT,
            }),
          ],
        }),
      ],
    });
  }

  function watermarkHeader(
    watermarks: DocxPlanV2["watermarks"],
  ): import("docx").Header | undefined {
    if (watermarks.length === 0) return undefined;
    const runs = watermarks.map(
      (watermark, index) =>
        new docx.WpsShapeRun({
          type: "wps",
          transformation: {
            width: 520,
            height: 90,
            rotation: -35,
            offset: { left: index * 12, top: index * 12 },
          },
          floating: {
            horizontalPosition: {
              relative: docx.HorizontalPositionRelativeFrom.PAGE,
              align: docx.HorizontalPositionAlign.CENTER,
            },
            verticalPosition: {
              relative: docx.VerticalPositionRelativeFrom.PAGE,
              align: docx.VerticalPositionAlign.CENTER,
            },
            behindDocument: true,
            allowOverlap: true,
            wrap: { type: docx.TextWrappingType.NONE },
            zIndex: -1 - index,
          },
          altText: {
            name: `OpenTrad watermark ${watermark.id}`,
            title: "OpenTrad watermark",
            description: "OpenTrad local document watermark",
          },
          children: [
            new docx.Paragraph({
              alignment: docx.AlignmentType.CENTER,
              children: [
                new docx.TextRun({
                  text: watermark.text,
                  bold: true,
                  color: "D0D5D3",
                  size: 72,
                  font: DOCUMENT_FONT,
                }),
              ],
            }),
          ],
          nonVisualProperties: { txBox: "1" },
          bodyProperties: {
            verticalAnchor: docx.VerticalAnchor.CENTER,
            margins: { top: 0, right: 0, bottom: 0, left: 0 },
            noAutoFit: true,
          },
        }),
    );
    return new docx.Header({ children: [new docx.Paragraph({ children: runs })] });
  }

  const everyPageWatermarks = plan.watermarks.filter(
    (watermark) => watermark.scope === "every-page",
  );
  const firstPageWatermarks = plan.watermarks.filter(
    (watermark) => watermark.scope === "first-page",
  );
  const sections = plan.sections.map((section, sectionIndex): import("docx").ISectionOptions => {
    const children: import("docx").FileChild[] = [];
    if (sectionIndex === 0) {
      children.push(
        paragraph(plan.title, {
          alignment: docx.AlignmentType.CENTER,
          bold: true,
          color: accent,
          size: titleSize,
          after: blockAfter,
          keepNext: true,
          style: "Title",
        }),
      );
    }
    const availableWidth =
      section.widthTwips - section.marginsTwips.left - section.marginsTwips.right;
    const availableHeight =
      section.heightTwips - section.marginsTwips.top - section.marginsTwips.bottom;
    for (const block of section.blocks) {
      children.push(...renderBlock(block, availableWidth, availableHeight));
    }
    if (sectionIndex === plan.sections.length - 1 && plan.disclaimers.length > 0) {
      children.push(
        paragraph(label(LABELS.disclaimer), {
          bold: true,
          color: accent,
          size: headingSize,
          before: blockAfter,
          keepNext: true,
        }),
        ...plan.disclaimers.map((disclaimer) =>
          paragraph(documentDisclaimerText(disclaimer, plan.languageView), {
            color: muted,
            size: smallSize,
          }),
        ),
      );
    }
    if (sectionIndex === plan.sections.length - 1 && attachmentPageImages.size > 0) {
      for (const pageImage of attachmentPageImages.values()) {
        const attachment = requireAttachment(pageImage.attachmentId);
        children.push(
          new docx.Paragraph({ children: [new docx.PageBreak()] }),
          paragraph(attachmentPageTitle(attachment, pageImage.pageNumber), {
            bold: true,
            color: accent,
            size: headingSize,
            keepNext: true,
          }),
          paragraph(`${ATTACHMENT_OVERLAY_CAVEAT_ZH_CN}\n${ATTACHMENT_OVERLAY_CAVEAT_EN_US}`, {
            color: muted,
            size: smallSize,
            keepNext: true,
          }),
          attachmentImageParagraph(pageImage, availableWidth, availableHeight),
        );
      }
    }

    const defaultHeader = watermarkHeader(everyPageWatermarks);
    const firstHeader =
      sectionIndex === 0
        ? watermarkHeader([...everyPageWatermarks, ...firstPageWatermarks])
        : undefined;
    return {
      headers:
        defaultHeader || firstHeader
          ? {
              ...(defaultHeader ? { default: defaultHeader } : {}),
              ...(firstHeader ? { first: firstHeader } : {}),
            }
          : undefined,
      footers: { default: footer() },
      properties: {
        type: docx.SectionType.NEXT_PAGE,
        titlePage: sectionIndex === 0 && firstPageWatermarks.length > 0,
        page: {
          // docx swaps these two values for LANDSCAPE internally, so always pass canonical A4.
          size: {
            width: A4_PORTRAIT_WIDTH_TWIPS,
            height: A4_PORTRAIT_HEIGHT_TWIPS,
            orientation:
              section.orientation === "landscape"
                ? docx.PageOrientation.LANDSCAPE
                : docx.PageOrientation.PORTRAIT,
          },
          margin: section.marginsTwips,
        },
      },
      children,
    };
  });

  const document = new docx.Document({
    title: plan.title,
    creator: "OpenTrad",
    description: "OpenTrad local document export",
    features: { updateFields: plan.updateFields },
    sections,
  });
  const bytes = await docx.Packer.toArrayBuffer(document);
  return new Blob([bytes], { type: DOCX_V2_MIME });
}
