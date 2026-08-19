import { createStandardGoodsQuoteDraft } from "@opentrad/document-core";
import { describe, expect, it, vi } from "vitest";
import { exportQuotation, type QuotationExportDependencies } from "./exportQuotation";

describe("exportQuotation", () => {
  it.each(["docx", "pdf", "json", "opentrad"] as const)(
    "prepares exactly once and downloads one real %s artifact",
    async (format) => {
      const draft = createStandardGoodsQuoteDraft({
        id: `draft-export-${format}`,
        now: "2026-08-19T10:00:00.000Z",
      });
      draft.meta.number = "QT/EXPORT:001";
      const artifacts = {
        draft,
        model: { schemaVersion: "model" } as never,
        serializedProject: '{"project":true}',
      };
      const dependencies: QuotationExportDependencies = {
        prepare: vi.fn(() => artifacts),
        renderDocx: vi.fn(async () => new Blob(["docx"])),
        renderPdf: vi.fn(async () => new Blob(["pdf"])),
        createProject: vi.fn((_prepared, projectFormat) => ({
          blob: new Blob([projectFormat]),
          filename: `project.${projectFormat}`,
        })),
        download: vi.fn(),
        buildFilename: vi.fn((_basename, extension) => `safe.${extension}`),
      };

      const filename = await exportQuotation(format, draft, dependencies);

      expect(dependencies.prepare).toHaveBeenCalledTimes(1);
      expect(dependencies.download).toHaveBeenCalledTimes(1);
      if (format === "docx") {
        expect(dependencies.renderDocx).toHaveBeenCalledTimes(1);
        expect(filename).toBe("safe.docx");
      } else if (format === "pdf") {
        expect(dependencies.renderPdf).toHaveBeenCalledTimes(1);
        expect(filename).toBe("safe.pdf");
      } else {
        expect(dependencies.createProject).toHaveBeenCalledTimes(1);
        expect(dependencies.createProject).toHaveBeenCalledWith(artifacts, format, "QT/EXPORT:001");
        expect(filename).toBe(`project.${format}`);
      }
    },
  );

  it("returns a finite Chinese failure without exposing raw renderer details", async () => {
    const draft = createStandardGoodsQuoteDraft({
      id: "draft-export-fail",
      now: "2026-08-19T10:00:00.000Z",
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dependencies: QuotationExportDependencies = {
      prepare: vi.fn(() => ({ draft, model: {} as never, serializedProject: "{}" })),
      renderDocx: vi.fn(async () => {
        throw new Error("secret filename and body");
      }),
      renderPdf: vi.fn(async () => new Blob()),
      createProject: vi.fn(() => ({ blob: new Blob(), filename: "x.json" })),
      download: vi.fn(),
      buildFilename: vi.fn(() => "x.docx"),
    };

    await expect(exportQuotation("docx", draft, dependencies)).rejects.toMatchObject({
      code: "EXPORT_FAILED",
      message: "文件生成失败，请检查报价内容后重试",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
