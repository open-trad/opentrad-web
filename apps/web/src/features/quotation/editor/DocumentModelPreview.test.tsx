import { compileStandardGoodsQuote, createStandardGoodsQuoteDraft } from "@opentrad/document-core";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocumentModelPreview } from "./DocumentModelPreview";

describe("DocumentModelPreview", () => {
  it("exhaustively renders the compiled heading, metadata, parties, table, totals, terms, notices and signature", () => {
    const draft = createStandardGoodsQuoteDraft({
      id: "draft-preview-all-nodes",
      now: "2026-08-19T10:00:00.000Z",
    });
    draft.meta.number = "QT-PREVIEW-001";
    draft.seller.name = "宁波远航贸易有限公司";
    draft.buyer.name = "海湾采购集团";
    const firstLine = draft.lineItems[0];
    if (!firstLine) throw new Error("Expected the standard draft to contain one line");
    draft.lineItems[0] = {
      ...firstLine,
      name: "工业级节能电机",
      quantity: "2",
      unitPriceMinor: "8500",
      discountBps: 500,
      taxRateBps: 1300,
    };
    draft.terms.delivery = "收到订单后 20 个工作日";

    render(<DocumentModelPreview model={compileStandardGoodsQuote(draft)} />);

    const preview = screen.getByRole("article", { name: "标准货物报价单文档" });
    expect(within(preview).getByRole("heading", { name: "标准货物报价单" })).toBeVisible();
    expect(within(preview).getByText("QT-PREVIEW-001")).toBeVisible();
    expect(within(preview).getByText("宁波远航贸易有限公司")).toBeVisible();
    expect(within(preview).getByText("海湾采购集团")).toBeVisible();
    expect(within(preview).getByRole("columnheader", { name: "商品名称" })).toBeVisible();
    expect(within(preview).getByText("工业级节能电机")).toBeVisible();
    expect(within(preview).getByText("价税合计")).toBeVisible();
    expect(within(preview).getByText("收到订单后 20 个工作日")).toBeVisible();
    expect(within(preview).getByText(/不构成法律、税务或会计意见/)).toBeVisible();
    expect(within(preview).getByText("报价方签署/盖章")).toBeVisible();
  });
});
