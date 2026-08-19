import {
  createStandardGoodsQuoteDraft,
  MAX_PROJECT_BYTES,
  type OpenTradProjectEnvelope,
  type StandardGoodsQuoteDraft,
} from "@opentrad/document-core";
import { describe, expect, it, vi } from "vitest";
import {
  createProjectFile,
  OPENTRAD_PROJECT_MIME,
  PROJECT_JSON_MIME,
  prepareQuotationArtifacts,
  readProjectFile,
} from "./projectFiles";

function draft(): StandardGoodsQuoteDraft {
  const value = createStandardGoodsQuoteDraft({
    id: "project-export",
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
  return value;
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsText(blob);
  });
}

describe("quotation project files", () => {
  it("parses once into one isolated draft, DocumentModel, and deterministic project envelope", () => {
    const input = draft();
    const artifacts = prepareQuotationArtifacts(input);
    input.seller.name = "调用方后续修改";

    expect(artifacts.draft.seller.name).toBe("宁波远航贸易有限公司");
    expect(artifacts.model.documentId).toBe(artifacts.draft.id);
    expect(artifacts.model.nodes.map((node) => node.id)).toContain("line-items");
    expect(JSON.parse(artifacts.serializedProject)).toMatchObject({
      formatVersion: "1.0.0",
      draft: { id: artifacts.draft.id },
      calculation: { summary: { totalMinor: "21470" } },
    });
  });

  it("exports JSON and .opentrad with identical bytes and distinct MIME and extensions", async () => {
    const artifacts = prepareQuotationArtifacts(draft());
    const json = createProjectFile(artifacts, "json", "QT-20260819-001");
    const project = createProjectFile(artifacts, "opentrad", "QT-20260819-001");

    expect(json.blob.type).toBe(PROJECT_JSON_MIME);
    expect(project.blob.type).toBe(OPENTRAD_PROJECT_MIME);
    expect(json.filename).toBe("QT-20260819-001.json");
    expect(project.filename).toBe("QT-20260819-001.opentrad");
    expect(await readBlob(json.blob)).toBe(await readBlob(project.blob));
    expect(await readBlob(json.blob)).toBe(artifacts.serializedProject);
  });

  it("checks file size before reading and maps invalid content to finite Chinese errors", async () => {
    const text = vi.fn(async () => "should-not-be-read");
    const oversized = { size: MAX_PROJECT_BYTES + 1, text };

    await expect(readProjectFile(oversized)).rejects.toMatchObject({
      code: "PROJECT_TOO_LARGE",
      message: "项目文件超过 1 MiB，请选择有效的 OpenTrad 项目文件",
    });
    expect(text).not.toHaveBeenCalled();

    await expect(readProjectFile({ size: 8, text: async () => "not-json" })).rejects.toMatchObject({
      code: "PROJECT_INVALID",
      message: "项目文件无效或版本不受支持",
    });
  });

  it("recalculates tampered derived amounts and never persists implicitly", async () => {
    const saveDraft = vi.fn();
    const artifacts = prepareQuotationArtifacts(draft());
    const tampered = JSON.parse(artifacts.serializedProject) as OpenTradProjectEnvelope;
    tampered.calculation.summary.totalMinor = "999999999";

    const imported = await readProjectFile({
      size: JSON.stringify(tampered).length,
      text: async () => JSON.stringify(tampered),
    });

    expect(imported.calculation.summary.totalMinor).toBe("21470");
    expect(imported.draft.seller.name).toBe("宁波远航贸易有限公司");
    expect(saveDraft).not.toHaveBeenCalled();
  });
});
