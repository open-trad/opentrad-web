import {
  type DocumentModel,
  DocumentModelSchema,
  type DocumentNode,
} from "@opentrad/document-core";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

const PDF_FONT = "SourceHanSansCN";
const INK = "#20312E";
const GREEN = "#285B50";
const LIGHT_GREEN = "#E9EFEA";
const WARM_WHITE = "#F7F5EE";
const COMPACT_CELL_MARGIN: [number, number, number, number] = [1, 3, 1, 3];

function millimetresToPoints(value: number): number {
  return (value * 72) / 25.4;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported document node: ${String(value)}`);
}

function nodeContent(node: DocumentNode): Content {
  switch (node.type) {
    case "heading":
      return {
        text: node.text,
        style: node.level === 1 ? "documentTitle" : "sectionHeading",
      };
    case "metadata":
      return {
        margin: [0, 0, 0, 10],
        layout: "lightHorizontalLines",
        table: {
          widths: [88, "*"],
          body: node.entries.map((entry) => [
            { text: entry.label, bold: true, color: GREEN, fillColor: LIGHT_GREEN },
            { text: entry.value, color: INK },
          ]),
        },
      };
    case "parties":
      return {
        margin: [0, 0, 0, 10],
        columnGap: 12,
        columns: node.parties.map((party, index) => ({
          width: "*",
          margin: [8, 8, 8, 8],
          fillColor: index === 0 ? LIGHT_GREEN : WARM_WHITE,
          stack: [
            { text: party.label, bold: true, color: GREEN, fontSize: 9 },
            { text: party.name, bold: true, color: INK, fontSize: 11, margin: [0, 3, 0, 4] },
            ...party.details.map((detail) => ({ text: detail, color: INK, fontSize: 8 })),
          ],
        })),
      };
    case "table":
      return {
        margin: [0, 0, 0, 10],
        layout: "lightHorizontalLines",
        table: {
          headerRows: node.repeatHeader ? 1 : 0,
          dontBreakRows: !node.pagePolicy.allowRowSplit,
          keepWithHeaderRows: node.pagePolicy.keepHeaderWithRows,
          widths: node.columns.map((column) => column.width),
          body: [
            node.columns.map((column) => ({
              text: column.label,
              bold: true,
              color: "#FFFFFF",
              fillColor: GREEN,
              alignment: "center" as const,
              fontSize: 6.5,
              margin: COMPACT_CELL_MARGIN,
            })),
            ...node.rows.map((row) =>
              node.columns.map((column) => ({
                text: row.cells[column.id] ?? "",
                color: INK,
                alignment: column.align,
                fontSize: 6.5,
                margin: COMPACT_CELL_MARGIN,
              })),
            ),
          ],
        },
      };
    case "totals":
      return {
        margin: [0, 0, 0, 10],
        layout: "lightHorizontalLines",
        table: {
          widths: ["70%", "30%"],
          body: node.entries.map((entry, index) => {
            const isGrandTotal = index === node.entries.length - 1;
            return [
              {
                text: entry.label,
                bold: isGrandTotal,
                alignment: "right" as const,
                color: INK,
              },
              {
                text: entry.value,
                bold: isGrandTotal,
                alignment: "right" as const,
                color: isGrandTotal ? GREEN : INK,
                fillColor: isGrandTotal ? LIGHT_GREEN : undefined,
              },
            ];
          }),
        },
      };
    case "terms":
      return {
        margin: [0, 0, 0, 8],
        stack: [
          { text: "条款与备注", style: "sectionHeading" },
          ...node.entries.flatMap<Content>((entry, index) => [
            { text: `${index + 1} ${entry.label}`, bold: true, color: GREEN, margin: [0, 4, 0, 2] },
            { text: entry.value, color: INK, margin: [0, 0, 0, 3] },
          ]),
        ],
      };
    case "notice":
      return {
        margin: [0, 4, 0, 10],
        stack: node.paragraphs.map((paragraph) => ({
          text: paragraph,
          italics: true,
          color: "#596560",
          fontSize: 8,
          margin: [0, 0, 0, 3],
        })),
      };
    case "signature":
      return {
        margin: [0, 16, 0, 0],
        layout: "noBorders",
        unbreakable: true,
        table: {
          widths: ["65%", "35%"],
          body: [
            [
              { text: `${node.signerLabel}：________________`, bold: true, color: INK },
              { text: `${node.dateLabel}：________________`, bold: true, color: INK },
            ],
          ],
        },
      };
    default:
      return assertNever(node);
  }
}

export function buildPdfDefinition(input: DocumentModel): TDocumentDefinitions {
  const model = DocumentModelSchema.parse(input);
  return {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [
      millimetresToPoints(model.page.marginsMm.left),
      millimetresToPoints(model.page.marginsMm.top),
      millimetresToPoints(model.page.marginsMm.right),
      millimetresToPoints(model.page.marginsMm.bottom),
    ],
    info: {
      title: "标准货物报价单",
      author: "OpenTrad",
      subject: "浏览器本地生成的商贸报价单",
      creator: "OpenTrad",
      producer: "OpenTrad",
    },
    defaultStyle: {
      font: PDF_FONT,
      fontSize: 9,
      color: INK,
      lineHeight: 1.25,
    },
    styles: {
      documentTitle: {
        font: PDF_FONT,
        fontSize: 20,
        bold: true,
        color: GREEN,
        alignment: "center",
        margin: [0, 0, 0, 14],
      },
      sectionHeading: {
        font: PDF_FONT,
        fontSize: 12,
        bold: true,
        color: GREEN,
        margin: [0, 10, 0, 5],
      },
    },
    footer: (currentPage, pageCount) => ({
      text: `OpenTrad 开源商贸 · 本地生成 · 第 ${currentPage} / ${pageCount} 页`,
      alignment: "center",
      color: "#6E7773",
      fontSize: 7,
      margin: [0, 12, 0, 0],
    }),
    content: model.nodes.map(nodeContent),
  };
}
