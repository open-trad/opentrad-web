import { createStandardGoodsQuoteDraft } from "@opentrad/document-core";
import { describe, expect, it } from "vitest";
import { prepareQuotationArtifacts } from "../project/projectFiles";
import { buildDocxRenderPlan } from "./docx/renderDocx";
import { buildPdfDefinition } from "./pdf/buildPdfDefinition";

describe("quotation export parity", () => {
  it("feeds JSON, DOCX, and PDF from the same validated model and calculated values", () => {
    const draft = createStandardGoodsQuoteDraft({
      id: "export-parity",
      now: "2026-08-19T10:00:00.000Z",
    });
    draft.seller.name = "宁波远航贸易有限公司";
    const firstLine = draft.lineItems[0];
    if (!firstLine) {
      throw new Error("Expected a quotation line item");
    }
    draft.lineItems[0] = {
      ...firstLine,
      name: "工业真空泵",
      quantity: "2",
      unitPriceMinor: "10000",
      discountBps: 500,
      taxRateBps: 1300,
    };

    const artifacts = prepareQuotationArtifacts(draft);
    const project = JSON.parse(artifacts.serializedProject) as {
      calculation: { summary: { totalMinor: string } };
    };
    const docxPlan = buildDocxRenderPlan(artifacts.model);
    const pdfDefinition = buildPdfDefinition(artifacts.model);

    expect(project.calculation.summary.totalMinor).toBe("21470");
    expect(JSON.stringify(docxPlan)).toContain("CNY 214.70");
    expect(JSON.stringify(pdfDefinition)).toContain("CNY 214.70");
    expect(JSON.stringify(docxPlan)).toContain("工业真空泵");
    expect(JSON.stringify(pdfDefinition)).toContain("工业真空泵");
    expect(artifacts.model.documentId).toBe(artifacts.draft.id);
  });
});
