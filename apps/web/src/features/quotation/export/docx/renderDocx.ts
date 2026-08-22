import {
  type DocumentModel,
  DocumentModelSchema,
  type DocumentNode,
} from "@opentrad/document-core";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const A4_WIDTH_TWIPS = 11_906;
const A4_HEIGHT_TWIPS = 16_838;
const DOCUMENT_FONT = "Source Han Sans CN";

type NodeOfType<T extends DocumentNode["type"]> = Extract<DocumentNode, { type: T }>;

export type DocxRenderBlock =
  | NodeOfType<"heading">
  | NodeOfType<"metadata">
  | NodeOfType<"parties">
  | (NodeOfType<"table"> & {
      columnWidthsTwips: number[];
      cantSplitRows: boolean;
    })
  | NodeOfType<"totals">
  | NodeOfType<"terms">
  | NodeOfType<"notice">
  | NodeOfType<"signature">;

export interface DocxRenderPlan {
  page: {
    widthTwips: number;
    heightTwips: number;
    marginsTwips: { top: number; right: number; bottom: number; left: number };
  };
  font: typeof DOCUMENT_FONT;
  blocks: DocxRenderBlock[];
  footer: { text: string; includePageNumbers: true };
}

function millimetresToTwips(value: number): number {
  return Math.round((value * 1_440) / 25.4);
}

function fixedColumnWidths(columns: NodeOfType<"table">["columns"], available: number): number[] {
  const percentages = columns.map((column) => {
    const match = /^(\d+(?:\.\d+)?)%$/.exec(column.width);
    if (!match) {
      throw new Error("Document table contains an invalid percentage width");
    }
    return Number(match[1]);
  });
  const total = percentages.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 100) > 0.001) {
    throw new Error("Document table column widths must total 100%");
  }
  let allocated = 0;
  return percentages.map((percentage, index) => {
    if (index === percentages.length - 1) {
      return available - allocated;
    }
    const width = Math.round((available * percentage) / 100);
    allocated += width;
    return width;
  });
}

function assertNever(value: never): never {
  throw new Error(`Unsupported document node: ${String(value)}`);
}

export function buildDocxRenderPlan(input: DocumentModel): DocxRenderPlan {
  const model = DocumentModelSchema.parse(input);
  const marginsTwips = {
    top: millimetresToTwips(model.page.marginsMm.top),
    right: millimetresToTwips(model.page.marginsMm.right),
    bottom: millimetresToTwips(model.page.marginsMm.bottom),
    left: millimetresToTwips(model.page.marginsMm.left),
  };
  const availableWidth = A4_WIDTH_TWIPS - marginsTwips.left - marginsTwips.right;
  const blocks = model.nodes.map((node): DocxRenderBlock => {
    switch (node.type) {
      case "heading":
      case "metadata":
      case "parties":
      case "totals":
      case "terms":
      case "notice":
      case "signature":
        return node;
      case "table":
        return {
          ...node,
          columnWidthsTwips: fixedColumnWidths(node.columns, availableWidth),
          cantSplitRows: !node.pagePolicy.allowRowSplit,
        };
      default:
        return assertNever(node);
    }
  });

  return {
    page: {
      widthTwips: A4_WIDTH_TWIPS,
      heightTwips: A4_HEIGHT_TWIPS,
      marginsTwips,
    },
    font: DOCUMENT_FONT,
    blocks,
    footer: { text: "OpenTrad 开源商贸 · 本地生成", includePageNumbers: true },
  };
}

export class DocxGenerationError extends Error {
  readonly code = "DOCX_GENERATION_FAILED" as const;

  constructor() {
    super("Word 文件生成失败，请检查文档内容后重试");
    this.name = "DocxGenerationError";
  }
}

export async function renderDocxBlob(input: DocumentModel): Promise<Blob> {
  const plan = buildDocxRenderPlan(input);
  try {
    return await renderDocxPlan(plan);
  } catch {
    throw new DocxGenerationError();
  }
}

async function renderDocxPlan(plan: DocxRenderPlan): Promise<Blob> {
  const docx = await import("docx");
  const children: Array<import("docx").Paragraph | import("docx").Table> = [];
  const border = { color: "B9C7C0", size: 4, style: docx.BorderStyle.SINGLE };
  const tableBorders = {
    top: border,
    bottom: border,
    left: border,
    right: border,
    insideHorizontal: border,
    insideVertical: border,
  };

  function runs(
    text: string,
    properties: Omit<import("docx").IRunOptions, "break" | "text"> = {},
  ): import("docx").TextRun[] {
    return text.split("\n").map(
      (line, index) =>
        new docx.TextRun({
          ...properties,
          text: line,
          break: index === 0 ? undefined : 1,
        }),
    );
  }

  function paragraph(
    text: string,
    options: {
      alignment?: (typeof docx.AlignmentType)[keyof typeof docx.AlignmentType];
      bold?: boolean;
      color?: string;
      size?: number;
      before?: number;
      after?: number;
      keepNext?: boolean;
      italics?: boolean;
    } = {},
  ): import("docx").Paragraph {
    return new docx.Paragraph({
      alignment: options.alignment,
      keepNext: options.keepNext,
      spacing: { before: options.before ?? 0, after: options.after ?? 100, line: 276 },
      children: runs(text, {
        bold: options.bold,
        italics: options.italics,
        color: options.color ?? "20312E",
        size: options.size ?? 19,
        font: DOCUMENT_FONT,
        language: { value: "zh-CN", eastAsia: "zh-CN" },
      }),
    });
  }

  function tableCell(
    text: string,
    width: number,
    options: {
      bold?: boolean;
      fill?: string;
      color?: string;
      alignment?: (typeof docx.AlignmentType)[keyof typeof docx.AlignmentType];
      size?: number;
    } = {},
  ): import("docx").TableCell {
    return new docx.TableCell({
      width: { size: width, type: docx.WidthType.DXA },
      margins: { top: 90, right: 90, bottom: 90, left: 90 },
      verticalAlign: docx.VerticalAlign.CENTER,
      shading: options.fill ? { fill: options.fill } : undefined,
      children: [
        paragraph(text, {
          bold: options.bold,
          color: options.color,
          alignment: options.alignment,
          size: options.size,
          after: 0,
        }),
      ],
    });
  }

  function simpleTable(
    rows: Array<Array<{ text: string; width: number; bold?: boolean; fill?: string }>>,
    widths: number[],
  ): import("docx").Table {
    return new docx.Table({
      width: { size: widths.reduce((sum, value) => sum + value, 0), type: docx.WidthType.DXA },
      layout: docx.TableLayoutType.FIXED,
      columnWidths: widths,
      borders: tableBorders,
      rows: rows.map(
        (row) =>
          new docx.TableRow({
            cantSplit: true,
            children: row.map((cell) =>
              tableCell(cell.text, cell.width, { bold: cell.bold, fill: cell.fill }),
            ),
          }),
      ),
    });
  }

  const availableWidth =
    plan.page.widthTwips - plan.page.marginsTwips.left - plan.page.marginsTwips.right;

  for (const block of plan.blocks) {
    switch (block.type) {
      case "heading":
        children.push(
          paragraph(block.text, {
            alignment: block.level === 1 ? docx.AlignmentType.CENTER : docx.AlignmentType.LEFT,
            bold: true,
            color: block.level === 1 ? "163C35" : "20312E",
            size: block.level === 1 ? 36 : 24,
            before: block.level === 1 ? 0 : 180,
            after: block.level === 1 ? 220 : 100,
            keepNext: true,
          }),
        );
        break;
      case "metadata": {
        const labelWidth = Math.round(availableWidth * 0.2);
        const valueWidth = availableWidth - labelWidth;
        children.push(
          simpleTable(
            block.entries.map((entry) => [
              { text: entry.label, width: labelWidth, bold: true, fill: "E9EFEA" },
              { text: entry.value, width: valueWidth },
            ]),
            [labelWidth, valueWidth],
          ),
          paragraph("", { after: 100 }),
        );
        break;
      }
      case "parties": {
        const leftWidth = Math.round(availableWidth / 2);
        const widths = [leftWidth, availableWidth - leftWidth];
        children.push(
          new docx.Table({
            width: { size: availableWidth, type: docx.WidthType.DXA },
            layout: docx.TableLayoutType.FIXED,
            columnWidths: widths,
            borders: tableBorders,
            rows: [
              new docx.TableRow({
                cantSplit: true,
                children: block.parties.map(
                  (party, index) =>
                    new docx.TableCell({
                      width: { size: widths[index] ?? leftWidth, type: docx.WidthType.DXA },
                      margins: { top: 140, right: 140, bottom: 140, left: 140 },
                      shading: { fill: index === 0 ? "F1F4EF" : "F7F5EE" },
                      verticalAlign: docx.VerticalAlign.CENTER,
                      children: [
                        paragraph(party.label, { bold: true, color: "2F6D5D", after: 60 }),
                        paragraph(party.name, { bold: true, size: 21, after: 80 }),
                        ...party.details.map((detail) =>
                          paragraph(detail, { size: 17, after: 30 }),
                        ),
                      ],
                    }),
                ),
              }),
            ],
          }),
          paragraph("", { after: 100 }),
        );
        break;
      }
      case "table": {
        const header = new docx.TableRow({
          tableHeader: block.repeatHeader,
          cantSplit: true,
          children: block.columns.map((column, index) =>
            tableCell(column.label, block.columnWidthsTwips[index] ?? 1, {
              bold: true,
              fill: "285B50",
              color: "FFFFFF",
              alignment: docx.AlignmentType.CENTER,
              size: 14,
            }),
          ),
        });
        const body = block.rows.map(
          (row) =>
            new docx.TableRow({
              cantSplit: block.cantSplitRows,
              children: block.columns.map((column, index) =>
                tableCell(row.cells[column.id] ?? "", block.columnWidthsTwips[index] ?? 1, {
                  alignment:
                    column.align === "right"
                      ? docx.AlignmentType.RIGHT
                      : column.align === "center"
                        ? docx.AlignmentType.CENTER
                        : docx.AlignmentType.LEFT,
                  size: 14,
                }),
              ),
            }),
        );
        children.push(
          new docx.Table({
            width: { size: availableWidth, type: docx.WidthType.DXA },
            layout: docx.TableLayoutType.FIXED,
            columnWidths: block.columnWidthsTwips,
            borders: tableBorders,
            rows: [header, ...body],
          }),
          paragraph("", { after: 80 }),
        );
        break;
      }
      case "totals": {
        const labelWidth = Math.round(availableWidth * 0.7);
        const valueWidth = availableWidth - labelWidth;
        children.push(
          simpleTable(
            block.entries.map((entry, index) => [
              { text: entry.label, width: labelWidth, bold: index === block.entries.length - 1 },
              {
                text: entry.value,
                width: valueWidth,
                bold: index === block.entries.length - 1,
                fill: index === block.entries.length - 1 ? "E2ECE6" : undefined,
              },
            ]),
            [labelWidth, valueWidth],
          ),
          paragraph("", { after: 100 }),
        );
        break;
      }
      case "terms":
        children.push(
          paragraph("条款与备注", {
            bold: true,
            color: "2F6D5D",
            size: 24,
            keepNext: true,
            before: 80,
            after: 60,
          }),
        );
        for (const [index, entry] of block.entries.entries()) {
          children.push(
            paragraph(`${index + 1} ${entry.label}`, {
              bold: true,
              color: "2F6D5D",
              keepNext: true,
              after: 40,
            }),
            paragraph(entry.value, { after: 100 }),
          );
        }
        break;
      case "notice":
        for (const notice of block.paragraphs) {
          children.push(paragraph(notice, { italics: true, color: "596560", size: 16, after: 60 }));
        }
        break;
      case "signature": {
        const leftWidth = Math.round(availableWidth * 0.65);
        children.push(
          paragraph("", { before: 180, after: 80 }),
          simpleTable(
            [
              [
                { text: `${block.signerLabel}：________________`, width: leftWidth, bold: true },
                {
                  text: `${block.dateLabel}：________________`,
                  width: availableWidth - leftWidth,
                  bold: true,
                },
              ],
            ],
            [leftWidth, availableWidth - leftWidth],
          ),
        );
        break;
      }
      default:
        assertNever(block);
    }
  }

  const footer = new docx.Footer({
    children: [
      new docx.Paragraph({
        alignment: docx.AlignmentType.CENTER,
        spacing: { before: 80, after: 0 },
        children: [
          new docx.TextRun({ text: `${plan.footer.text} · 第 `, font: DOCUMENT_FONT, size: 15 }),
          new docx.TextRun({ children: [docx.PageNumber.CURRENT], font: DOCUMENT_FONT, size: 15 }),
          new docx.TextRun({ text: " / ", font: DOCUMENT_FONT, size: 15 }),
          new docx.TextRun({
            children: [docx.PageNumber.TOTAL_PAGES],
            font: DOCUMENT_FONT,
            size: 15,
          }),
          new docx.TextRun({ text: " 页", font: DOCUMENT_FONT, size: 15 }),
        ],
      }),
    ],
  });

  const document = new docx.Document({
    creator: "OpenTrad",
    title: "标准货物报价单",
    description: "由 OpenTrad 在浏览器本地生成的报价单",
    features: { updateFields: true },
    styles: {
      default: {
        document: {
          run: { font: DOCUMENT_FONT, size: 19, color: "20312E" },
          paragraph: { spacing: { after: 100, line: 276 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: plan.page.widthTwips,
              height: plan.page.heightTwips,
              orientation: docx.PageOrientation.PORTRAIT,
            },
            margin: {
              ...plan.page.marginsTwips,
              header: 480,
              footer: 480,
              gutter: 0,
            },
          },
        },
        footers: { default: footer },
        children,
      },
    ],
  });

  return docx.Packer.toBlob(document);
}
