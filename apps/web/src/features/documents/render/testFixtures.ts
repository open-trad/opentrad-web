import type { DocumentModelV2 } from "@opentrad/document-core";

export function createEveryBlockModel(): DocumentModelV2 {
  return {
    schemaVersion: "2.0.0",
    documentId: "every-block",
    template: {
      id: "quotation.service.project.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
    },
    documentKind: "quotation",
    language: "zh-en",
    title: { zhCN: "服务报价", enUS: "SERVICE QUOTATION" },
    pageDefaults: {
      size: "A4",
      orientation: "portrait",
      marginsMm: { top: 18, right: 16, bottom: 18, left: 16 },
    },
    sections: [
      {
        id: "all-blocks",
        blocks: [
          {
            type: "cover",
            id: "cover",
            title: { zhCN: "封面", enUS: "Cover" },
            subtitle: { zhCN: "本地生成", enUS: "Generated locally" },
          },
          {
            type: "heading",
            id: "heading",
            level: 1,
            text: { zhCN: "第一章", enUS: "Chapter 1" },
          },
          {
            type: "paragraph",
            id: "paragraph",
            text: { zhCN: "正文", enUS: "Body" },
          },
          {
            type: "keyValueGrid",
            id: "grid",
            entries: [
              {
                id: "number",
                label: { zhCN: "编号", enUS: "No." },
                value: { zhCN: "Q-1", enUS: "Q-1" },
              },
            ],
          },
          {
            type: "parties",
            id: "parties",
            parties: [
              {
                id: "seller",
                role: { zhCN: "卖方", enUS: "Seller" },
                name: { zhCN: "示例卖方", enUS: "Example Seller" },
                details: [
                  { zhCN: "地址：宁波", enUS: "Address: Ningbo" },
                  { zhCN: "联系人：张三", enUS: "Contact: Zhang San" },
                ],
              },
            ],
          },
          {
            type: "table",
            id: "table",
            columns: [
              {
                id: "name",
                label: { zhCN: "名称", enUS: "Name" },
                width: "100%",
                align: "left",
              },
            ],
            rows: [
              {
                id: "row-1",
                cells: { name: { zhCN: "服务", enUS: "Service" } },
              },
            ],
            repeatHeader: true,
            pagePolicy: { allowRowSplit: false, keepHeaderWithRows: 1 },
          },
          {
            type: "totals",
            id: "totals",
            entries: [
              {
                id: "total",
                label: { zhCN: "合计", enUS: "Total" },
                value: { zhCN: "CNY 1.00", enUS: "CNY 1.00" },
              },
            ],
          },
          {
            type: "clauseGroup",
            id: "clauses",
            title: { zhCN: "条款", enUS: "Terms" },
            clauses: [
              {
                id: "payment",
                number: "1",
                title: { zhCN: "付款", enUS: "Payment" },
                paragraphs: [{ zhCN: "现付", enUS: "Pay now" }],
              },
            ],
          },
          {
            type: "list",
            id: "list",
            ordered: true,
            items: [{ zhCN: "附件一", enUS: "Appendix 1" }],
          },
          {
            type: "notice",
            id: "notice",
            tone: "warning",
            paragraphs: [{ zhCN: "请审阅", enUS: "Review required" }],
          },
          {
            type: "declaration",
            id: "declaration",
            title: { zhCN: "声明", enUS: "Declaration" },
            paragraphs: [{ zhCN: "内容真实", enUS: "Information is true" }],
          },
          { type: "toc", id: "toc", maxDepth: 3 },
          {
            type: "complianceMatrix",
            id: "matrix",
            columns: [
              {
                id: "response",
                label: { zhCN: "响应", enUS: "Response" },
                width: "100%",
                align: "left",
              },
            ],
            rows: [
              {
                id: "requirement-1",
                sourceRef: "3.1",
                substantial: true,
                cells: { response: { zhCN: "满足", enUS: "Comply" } },
              },
            ],
          },
          {
            type: "attachmentIndex",
            id: "attachment-index",
            attachmentIds: ["attachment-1"],
          },
          {
            type: "attachmentPage",
            id: "attachment-page",
            attachmentId: "attachment-1",
            pageNumber: 1,
          },
          {
            type: "signatureGroup",
            id: "signatures",
            signers: [
              {
                role: { zhCN: "报价方", enUS: "Offeror" },
                name: "示例公司",
                dateLabel: { zhCN: "日期", enUS: "Date" },
                sealLabel: { zhCN: "盖章", enUS: "Seal" },
              },
            ],
          },
          { type: "pageBreak", id: "page-break" },
        ],
      },
    ],
    watermarks: [
      {
        id: "local-draft",
        text: { zhCN: "内部底稿", enUS: "INTERNAL DRAFT" },
        scope: "first-page",
      },
    ],
    disclaimers: ["quotation-non-advice"],
    attachmentManifest: [
      {
        id: "attachment-1",
        category: "other",
        displayName: "附件一.pdf",
        mediaType: "application/pdf",
        pageCount: 1,
        required: false,
        status: "attached",
        includedInSubmission: true,
      },
    ],
  };
}
