import { describe, expect, it } from "vitest";
import {
  compileStandardGoodsQuote,
  createStandardGoodsQuoteDraft,
  parseProject,
  STANDARD_GOODS_QUOTE_TEMPLATE,
  serializeProject,
} from "../src/index";

describe("immutable V1 compatibility surface", () => {
  it("keeps exact identity, AST order and project format", () => {
    const draft = createStandardGoodsQuoteDraft({
      id: "compat-v1",
      now: "2026-08-19T00:00:00.000Z",
    });
    const model = compileStandardGoodsQuote(draft);
    const project = parseProject(serializeProject(draft));

    expect(STANDARD_GOODS_QUOTE_TEMPLATE).toEqual({
      id: "quotation.goods.standard.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
      category: "quotation",
      name: "标准货物报价单",
      supportedCurrencies: ["CNY", "USD", "EUR"],
    });
    expect(model.schemaVersion).toBe("1.0.0");
    expect(model.nodes.map((node) => node.id)).toEqual([
      "title",
      "quotation-meta",
      "parties",
      "line-items",
      "totals",
      "notice",
      "signature",
    ]);
    expect(project.formatVersion).toBe("1.0.0");
    expect(project.draft).toEqual(draft);
  });
});
