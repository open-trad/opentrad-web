import {
  createStandardGoodsQuoteDraft,
  type DocumentModel,
  type StandardGoodsQuoteDraft,
} from "@opentrad/document-core";
import { describe, expect, it } from "vitest";
import { prepareQuotationArtifacts } from "../../project/projectFiles";
import { buildDocxRenderPlan, DOCX_MIME, renderDocxBlob } from "./renderDocx";

function fullDraft(): StandardGoodsQuoteDraft {
  const value = createStandardGoodsQuoteDraft({
    id: "docx-export",
    now: "2026-08-19T10:00:00.000Z",
  });
  value.meta.number = "QT-20260819-001";
  value.seller = {
    name: "宁波远航贸易有限公司",
    address: "浙江省宁波市海曙区商贸路 128 号",
    contactName: "王经理",
    phone: "+86 574 0000 0000",
  };
  value.buyer = {
    name: "上海采购有限公司",
    address: "上海市浦东新区",
    contactName: "李经理",
  };
  const firstLine = value.lineItems[0];
  if (!firstLine) {
    throw new Error("Expected a quotation line item");
  }
  value.lineItems[0] = {
    ...firstLine,
    name: "工业真空泵",
    specification: "OV-100 / 220V",
    quantity: "2",
    unit: "台",
    unitPriceMinor: "10000",
    discountBps: 500,
    taxRateBps: 1300,
  };
  value.terms = {
    delivery: "收到预付款后 20 天。\n交付地点：上海港。",
    payment: "30% 预付款，发货前付清余款。",
    quality: "按双方确认的技术规格验收。",
    warranty: "验收后 12 个月。",
    notes: "本报价不含现场安装。",
  };
  return value;
}

function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(new Uint8Array(reader.result as ArrayBuffer)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsArrayBuffer(blob);
  });
}

describe("DOCX DocumentModel renderer", () => {
  it("builds explicit A4 geometry and fixed table widths from the validated model", () => {
    const model = prepareQuotationArtifacts(fullDraft()).model;
    const plan = buildDocxRenderPlan(model);
    const table = plan.blocks.find((block) => block.type === "table");

    expect(plan.page).toEqual({
      widthTwips: 11_906,
      heightTwips: 16_838,
      marginsTwips: { top: 1_020, right: 907, bottom: 1_020, left: 907 },
    });
    expect(plan.font).toBe("Source Han Sans CN");
    expect(table).toMatchObject({ repeatHeader: true, cantSplitRows: true });
    if (!table || table.type !== "table") {
      throw new Error("Expected the line item table render block");
    }
    expect(table.columnWidthsTwips.reduce((sum, width) => sum + width, 0)).toBe(10_092);
    expect(table.columnWidthsTwips.every((width) => Number.isInteger(width) && width > 0)).toBe(
      true,
    );
  });

  it("maps every DocumentModel node exhaustively without mutating the model", () => {
    const model = prepareQuotationArtifacts(fullDraft()).model;
    const before = JSON.stringify(model);
    const plan = buildDocxRenderPlan(model);

    expect(plan.blocks.map((block) => block.type)).toEqual([
      "heading",
      "metadata",
      "parties",
      "table",
      "totals",
      "terms",
      "notice",
      "signature",
    ]);
    expect(plan.footer).toEqual({
      text: "OpenTrad 开源商贸 · 本地生成",
      includePageNumbers: true,
    });
    expect(JSON.stringify(model)).toBe(before);
  });

  it("creates a browser DOCX ZIP Blob while preserving the validated model", async () => {
    const model = prepareQuotationArtifacts(fullDraft()).model;
    const before = JSON.stringify(model);
    const blob = await renderDocxBlob(model);
    const bytes = await readBlobBytes(blob);

    expect(blob.type).toBe(DOCX_MIME);
    expect(blob.size).toBeGreaterThan(2_000);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    expect(JSON.stringify(model)).toBe(before);
  });

  it("rejects an invalid model before loading the DOCX engine", async () => {
    await expect(
      renderDocxBlob({ page: { size: "Letter" }, nodes: [] } as unknown as DocumentModel),
    ).rejects.toThrow();
  });
});
