export type TemplateCategory = "报价单" | "合同" | "标书" | "发票" | "装箱单";

export type DocumentTemplate = {
  id: string;
  title: string;
  category: TemplateCategory;
  format: "A4" | "Letter";
  pages: number;
  description: string;
  accent: "green" | "blue" | "copper";
  editorPath?: string;
};

export const templates: DocumentTemplate[] = [
  {
    id: "general-quote",
    title: "通用报价单",
    category: "报价单",
    format: "A4",
    pages: 2,
    description: "适用于常规商品询报价，字段清晰完整。",
    accent: "green",
    editorPath: "/editor/standard-goods-quote",
  },
  {
    id: "cross-border-quote",
    title: "跨境商品报价单",
    category: "报价单",
    format: "A4",
    pages: 3,
    description: "包含币种、贸易术语和交付信息。",
    accent: "blue",
  },
  {
    id: "sales-contract",
    title: "国际销售合同",
    category: "合同",
    format: "A4",
    pages: 6,
    description: "面向国际货物销售的标准条款结构。",
    accent: "green",
  },
  {
    id: "service-contract",
    title: "服务合同模板",
    category: "合同",
    format: "A4",
    pages: 4,
    description: "清晰约定服务范围、交付和付款节点。",
    accent: "blue",
  },
  {
    id: "technical-tender",
    title: "技术标书模板",
    category: "标书",
    format: "A4",
    pages: 18,
    description: "技术响应、实施计划与团队能力框架。",
    accent: "copper",
  },
  {
    id: "business-tender",
    title: "商务标书模板",
    category: "标书",
    format: "A4",
    pages: 15,
    description: "商务资质、报价清单和投标函结构。",
    accent: "copper",
  },
  {
    id: "commercial-invoice",
    title: "商业发票",
    category: "发票",
    format: "Letter",
    pages: 1,
    description: "出口结算与清关常用商业发票。",
    accent: "blue",
  },
  {
    id: "packing-list",
    title: "标准装箱单",
    category: "装箱单",
    format: "A4",
    pages: 2,
    description: "记录箱数、尺寸、毛重和净重。",
    accent: "green",
  },
];
