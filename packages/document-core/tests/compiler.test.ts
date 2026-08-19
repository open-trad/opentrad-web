import { describe, expect, it } from "vitest";
import type { DocumentModel, StandardGoodsQuoteDraft } from "../src/index";
import * as coreModule from "../src/index";

type DocumentNode = DocumentModel["nodes"][number];
type NodeOfType<T extends DocumentNode["type"]> = Extract<DocumentNode, { type: T }>;

function firstLine(draft: StandardGoodsQuoteDraft) {
  const line = draft.lineItems[0];
  if (!line) {
    throw new Error("Expected the draft fixture to contain one line item");
  }
  return line;
}

function draft(): StandardGoodsQuoteDraft {
  const input = coreModule.createStandardGoodsQuoteDraft({
    id: "compile-quote",
    now: "2026-08-19T10:00:00.000Z",
  });
  input.meta.number = "QT-20260819-001";
  input.meta.validUntil = "2026-09-30";
  input.seller = {
    name: "宁波义星科技有限公司",
    address: "浙江省宁波市",
    contactName: "王经理",
    phone: "+86 574 0000 0000",
  };
  input.buyer = {
    name: "Global Buyer GmbH",
    address: "Hamburg, Germany",
    contactName: "Anna",
    email: "anna@example.com",
  };
  input.lineItems[0] = {
    ...firstLine(input),
    name: "工业真空泵",
    specification: "OV-100 / 220V",
    quantity: "2",
    unit: "台",
    unitPriceMinor: "5000",
    discountBps: 1000,
    taxRateBps: 1300,
  };
  return input;
}

function compile(input: unknown): DocumentModel {
  const compiler = (coreModule as Record<string, unknown>).compileStandardGoodsQuote as (
    draft: unknown,
  ) => DocumentModel;
  return compiler(input);
}

function node<T extends DocumentNode["type"]>(model: DocumentModel, type: T): NodeOfType<T> {
  const found = model.nodes.find((candidate) => candidate.type === type);
  expect(found).toBeDefined();
  return found as NodeOfType<T>;
}

describe("standard quotation DocumentModel compiler", () => {
  it("emits the stable business document node sequence", () => {
    const input = draft();
    input.terms = {
      delivery: "收到订单后 20 个工作日内交货。",
      payment: "30% 预付款，发货前付清余款。",
      quality: "按双方确认的技术规格验收。",
      warranty: "验收后 12 个月。",
      notes: "第一行备注。\n第二行备注。",
    };

    const model = compile(input);

    expect(model.nodes.map((item) => item.id)).toEqual([
      "title",
      "quotation-meta",
      "parties",
      "line-items",
      "totals",
      "terms",
      "notice",
      "signature",
    ]);
    expect(coreModule.DocumentModelSchema.parse(model)).toEqual(model);
    expect(node(model, "heading")).toMatchObject({
      id: "title",
      level: 1,
      text: "标准货物报价单",
    });
  });

  it("includes number, dates, both parties, and every provided business term", () => {
    const input = draft();
    input.terms = {
      delivery: "海运至上海港。",
      payment: "装运前付清。",
      quality: "出厂检验。",
      warranty: "12 个月。",
      notes: "中文备注第一行。\n中文备注第二行。",
    };
    const model = compile(input);

    expect(node(model, "metadata").entries).toEqual(
      expect.arrayContaining([
        { id: "quote-number", label: "报价编号", value: "QT-20260819-001" },
        { id: "issue-date", label: "报价日期", value: "2026-08-19" },
        { id: "valid-until", label: "有效期至", value: "2026-09-30" },
      ]),
    );
    expect(node(model, "parties").parties).toEqual([
      expect.objectContaining({ role: "seller", name: "宁波义星科技有限公司" }),
      expect.objectContaining({ role: "buyer", name: "Global Buyer GmbH" }),
    ]);
    expect(node(model, "terms").entries).toEqual([
      { id: "delivery", label: "交货条款", value: "海运至上海港。" },
      { id: "payment", label: "付款条款", value: "装运前付清。" },
      { id: "quality", label: "质量与检验", value: "出厂检验。" },
      { id: "warranty", label: "质保条款", value: "12 个月。" },
      {
        id: "notes",
        label: "备注",
        value: "中文备注第一行。\n中文备注第二行。",
      },
    ]);
  });

  it("builds a repeatable table with stable columns and calculated display amounts", () => {
    const model = compile(draft());
    const table = node(model, "table");

    expect(table.id).toBe("line-items");
    expect(table.columns.map((column) => column.id)).toEqual([
      "sequence",
      "item",
      "specification",
      "quantity",
      "unit-price",
      "discount",
      "tax-rate",
      "subtotal",
      "tax",
      "total",
    ]);
    expect(
      table.columns.reduce((total, column) => total + Number.parseInt(column.width, 10), 0),
    ).toBe(100);
    expect(table.repeatHeader).toBe(true);
    expect(table.pagePolicy).toEqual({ allowRowSplit: false, keepHeaderWithRows: 1 });
    expect(table.rows[0]?.cells).toMatchObject({
      sequence: "1",
      item: "工业真空泵",
      specification: "OV-100 / 220V",
      quantity: "2 台",
      "unit-price": "CNY 50.00",
      discount: "10.00%",
      "tax-rate": "13.00%",
      subtotal: "CNY 90.00",
      tax: "CNY 11.70",
      total: "CNY 101.70",
    });
    expect(node(model, "totals").entries.at(-1)).toEqual({
      id: "total",
      label: "价税合计",
      value: "CNY 101.70",
    });
  });

  it("preserves sku, specification, and description together in the item table", () => {
    const input = draft();
    const line = firstLine(input);
    line.sku = "SKU-OV-100";
    line.specification = "OV-100 / 220V";
    line.description = "适用于连续工业真空工况。";

    const table = node(compile(input), "table");
    expect(table.rows[0]?.cells.specification).toBe(
      "SKU-OV-100\nOV-100 / 220V\n适用于连续工业真空工况。",
    );
  });

  it("omits non-applicable tax columns and tax input cannot alter an exempt total", () => {
    const input = draft();
    input.meta.taxMode = "tax-exempt";
    firstLine(input).taxRateBps = 10_000;
    const model = compile(input);
    const table = node(model, "table");

    expect(table.columns.map((column) => column.id)).not.toContain("tax-rate");
    expect(table.columns.map((column) => column.id)).not.toContain("tax");
    expect(
      table.columns.reduce((total, column) => total + Number.parseInt(column.width, 10), 0),
    ).toBe(100);
    expect(table.rows[0]?.cells).not.toHaveProperty("tax-rate");
    expect(table.rows[0]?.cells).not.toHaveProperty("tax");
    expect(table.rows[0]?.cells.total).toBe("CNY 90.00");
  });

  it("omits blank optional terms and keeps quote nature, advice, and signature nodes", () => {
    const input = draft();
    input.terms = { delivery: "   ", notes: "" };
    input.meta.quoteNature = "binding-offer";
    const model = compile(input);

    expect(model.nodes.some((item) => item.type === "terms")).toBe(false);
    expect(node(model, "notice").paragraphs).toEqual([
      "本报价为约束性要约，在有效期内按所列条件生效。",
      "本文件由 OpenTrad 辅助生成，不构成法律、税务或会计意见。",
    ]);
    expect(node(model, "signature")).toMatchObject({
      id: "signature",
      signerLabel: "报价方签署/盖章",
      dateLabel: "签署日期",
    });
  });

  it("revalidates input and never displays a caller-supplied derived total", () => {
    const input = draft() as StandardGoodsQuoteDraft & {
      calculation: { summary: { totalMinor: string } };
    };
    input.calculation = { summary: { totalMinor: "999999999999" } };

    const model = compile(input);
    expect(JSON.stringify(model)).not.toContain("999999999999");
    expect(node(model, "totals").entries.at(-1)?.value).toBe("CNY 101.70");
  });

  it("rejects duplicate line ids before they can alias calculated AST rows", () => {
    const input = draft();
    const initial = firstLine(input);
    input.lineItems = [
      initial,
      {
        ...initial,
        name: "另一项商品",
        unitPriceMinor: "999999",
      },
    ];

    expect(() => compile(input)).toThrow();
  });
});
