import { createStandardGoodsQuoteDraft } from "@opentrad/document-core";
import { describe, expect, it, vi } from "vitest";
import { prepareQuotationArtifacts } from "../../project/projectFiles";
import { renderDocxBlob } from "./renderDocx";

vi.mock("docx", () => ({}));

describe("DOCX engine failures", () => {
  it("maps engine failures to a finite Chinese error without logging content", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const model = prepareQuotationArtifacts(
      createStandardGoodsQuoteDraft({ id: "docx-failure", now: "2026-08-19T10:00:00.000Z" }),
    ).model;

    await expect(renderDocxBlob(model)).rejects.toMatchObject({
      code: "DOCX_GENERATION_FAILED",
      message: "Word 文件生成失败，请检查文档内容后重试",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
