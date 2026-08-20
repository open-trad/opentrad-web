import {
  createStandardGoodsQuoteDraft,
  type StandardGoodsQuoteDraft,
} from "@opentrad/document-core";
import { describe, expect, it } from "vitest";
import { prepareQuotationArtifacts } from "../../project/projectFiles";
import { buildPdfDefinition } from "./buildPdfDefinition";

function fullDraft(): StandardGoodsQuoteDraft {
  const value = createStandardGoodsQuoteDraft({
    id: "pdf-definition",
    now: "2026-08-19T10:00:00.000Z",
  });
  value.meta.number = "QT-20260819-001";
  value.seller.name = "宁波远航贸易有限公司";
  value.buyer.name = "上海采购有限公司";
  const firstLine = value.lineItems[0];
  if (!firstLine) {
    throw new Error("Expected a quotation line item");
  }
  value.lineItems[0] = {
    ...firstLine,
    name: "工业真空泵",
    quantity: "2",
    unitPriceMinor: "10000",
    discountBps: 500,
    taxRateBps: 1300,
  };
  value.terms = {
    delivery: "收到预付款后 20 天。",
    payment: "30% 预付款，发货前付清余款。",
    quality: "按技术规格验收。",
    warranty: "验收后 12 个月。",
    notes: "中文备注。",
  };
  return value;
}

describe("pdfmake DocumentModel definition", () => {
  it("uses A4 portrait geometry, embedded-font name, and every model node", () => {
    const model = prepareQuotationArtifacts(fullDraft()).model;
    const before = JSON.stringify(model);
    const definition = buildPdfDefinition(model);
    const serialized = JSON.stringify(definition);

    expect(definition.pageSize).toBe("A4");
    expect(definition.pageOrientation).toBe("portrait");
    expect(definition.pageMargins).toEqual([
      expect.closeTo(45.354, 3),
      expect.closeTo(51.024, 3),
      expect.closeTo(45.354, 3),
      expect.closeTo(51.024, 3),
    ]);
    expect(definition.defaultStyle).toMatchObject({ font: "SourceHanSansCN" });
    for (const text of [
      "标准货物报价单",
      "QT-20260819-001",
      "宁波远航贸易有限公司",
      "上海采购有限公司",
      "工业真空泵",
      "价税合计",
      "条款与备注",
      "1 交货条款",
      "5 备注",
      "收到预付款后 20 天。",
      "不构成法律、税务或会计意见",
      "报价方签署/盖章",
    ]) {
      expect(serialized).toContain(text);
    }
    expect(JSON.stringify(model)).toBe(before);
  });

  it("maps repeat-header and row pagination policy onto the line-item table", () => {
    const definition = buildPdfDefinition(prepareQuotationArtifacts(fullDraft()).model);
    const content = Array.isArray(definition.content) ? definition.content : [definition.content];
    const tableNode = content.find((item) => {
      if (typeof item !== "object" || item === null || !("table" in item) || !item.table) {
        return false;
      }
      return item.table.headerRows === 1;
    });
    if (
      !tableNode ||
      typeof tableNode !== "object" ||
      !("table" in tableNode) ||
      !tableNode.table
    ) {
      throw new Error("Expected a pdfmake table node");
    }
    const table = tableNode.table;

    expect(table.headerRows).toBe(1);
    expect(table.dontBreakRows).toBe(true);
    expect(table.keepWithHeaderRows).toBe(1);
    expect(table.widths).toEqual(["5%", "17%", "13%", "8%", "11%", "8%", "7%", "11%", "9%", "11%"]);
  });
});
