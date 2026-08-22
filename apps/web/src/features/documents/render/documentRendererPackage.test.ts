import * as shared from "@opentrad/document-renderer";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import * as webPlan from "./docx/buildDocxPlan";
import * as webDocx from "./docx/renderDocxV2";
import * as webNormalize from "./normalizeModel";
import * as webWidths from "./tableWidths";
import { createEveryBlockModel } from "./testFixtures";

function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(new Uint8Array(reader.result as ArrayBuffer)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsArrayBuffer(blob);
  });
}

describe("shared renderer package boundary", () => {
  it("keeps every legacy Web path bound to the exact shared implementation", () => {
    expect(webNormalize.normalizeDocumentModel).toBe(shared.normalizeDocumentModel);
    expect(webNormalize.localizedTextParts).toBe(shared.localizedTextParts);
    expect(webNormalize.documentCellValue).toBe(shared.documentCellValue);
    expect(webNormalize.localizedTextValue).toBe(shared.localizedTextValue);
    expect(webNormalize.documentDisclaimerText).toBe(shared.documentDisclaimerText);
    expect(webNormalize.complianceRequirementText).toBe(shared.complianceRequirementText);
    expect(webNormalize.attachmentStatusText).toBe(shared.attachmentStatusText);
    expect(webNormalize.semanticTextDigest).toBe(shared.semanticTextDigest);
    expect(webWidths.allocatePercentageWidthsTwips).toBe(shared.allocatePercentageWidthsTwips);
    expect(webWidths.allocateComplianceMatrixWidthsTwips).toBe(
      shared.allocateComplianceMatrixWidthsTwips,
    );
    expect(webPlan.buildDocxPlanV2).toBe(shared.buildDocxPlanV2);
    expect(webDocx.buildDocxPlanV2).toBe(shared.buildDocxPlanV2);
    expect(webDocx.renderDocxV2).toBe(shared.renderDocxV2);
    expect(webDocx.DocxV2GenerationError).toBe(shared.DocxV2GenerationError);
  });

  it("keeps omitted-seam DOCX bytes identical and preserves the Web placeholder", async () => {
    const RealDate = Date;
    const fixedTime = RealDate.parse("2026-08-21T00:00:00.000Z");
    class FixedDate extends RealDate {
      constructor(value?: string | number) {
        super(value ?? fixedTime);
      }

      static override now(): number {
        return fixedTime;
      }
    }
    vi.stubGlobal("Date", FixedDate);
    try {
      const model = createEveryBlockModel();
      const [sharedBlob, webBlob] = await Promise.all([
        shared.renderDocxV2(model, "classic-formal.v1", "zh-CN"),
        webDocx.renderDocxV2(model, "classic-formal.v1", "zh-CN"),
      ]);
      const sharedBytes = await readBlobBytes(sharedBlob);
      const webBytes = await readBlobBytes(webBlob);
      const documentXml = strFromU8(
        unzipSync(sharedBytes)["word/document.xml"] ?? new Uint8Array(),
      );

      expect(sharedBytes).toEqual(webBytes);
      expect(documentXml).toContain("本地附件占位符");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
