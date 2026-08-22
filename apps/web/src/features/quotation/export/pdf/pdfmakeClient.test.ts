import { createStandardGoodsQuoteDraft } from "@opentrad/document-core";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { prepareQuotationArtifacts } from "../../project/projectFiles";
import { createPdfFontSecurity, PDF_MIME, renderPdfBlob } from "./pdfmakeClient";

const pdfmakeMocks = vi.hoisted(() => ({
  addFonts: vi.fn(),
  getBlob: vi.fn(async () => new Blob(["%PDF-test"], { type: "application/pdf" })),
  createPdf: vi.fn(),
  setUrlAccessPolicy: vi.fn(),
}));

vi.mock("pdfmake/build/pdfmake", () => ({
  default: {
    addFonts: pdfmakeMocks.addFonts,
    createPdf: pdfmakeMocks.createPdf,
    setUrlAccessPolicy: pdfmakeMocks.setUrlAccessPolicy,
  },
}));

function model() {
  return prepareQuotationArtifacts(
    createStandardGoodsQuoteDraft({ id: "pdf-client", now: "2026-08-19T10:00:00.000Z" }),
  ).model;
}

beforeAll(() => {
  pdfmakeMocks.addFonts.mockClear();
  pdfmakeMocks.createPdf.mockClear();
  pdfmakeMocks.createPdf.mockImplementation(() => ({ getBlob: pdfmakeMocks.getBlob }));
  pdfmakeMocks.getBlob.mockClear();
  pdfmakeMocks.setUrlAccessPolicy.mockClear();
});

describe("secure pdfmake browser client", () => {
  it("allows only the two exact same-origin BASE_URL font resources", () => {
    const security = createPdfFontSecurity({
      baseUrl: "/opentrad-web/",
      origin: "https://open-trad.github.io",
    });

    expect(security.regularUrl).toBe(
      "https://open-trad.github.io/opentrad-web/fonts/source-han-sans-cn/SourceHanSansCN-Regular.otf",
    );
    expect(security.boldUrl).toBe(
      "https://open-trad.github.io/opentrad-web/fonts/source-han-sans-cn/SourceHanSansCN-Bold.otf",
    );
    expect(security.allows(security.regularUrl)).toBe(true);
    expect(security.allows(security.boldUrl)).toBe(true);
    for (const candidate of [
      "https://evil.example/SourceHanSansCN-Regular.otf",
      `${security.regularUrl}?cache=1`,
      `${security.regularUrl}#fragment`,
      security.regularUrl.replace("github.io", "github.io:443"),
      security.regularUrl.replace("https://", "https://user:pass@"),
      security.regularUrl.replace("Regular", "Regular-copy"),
      "/opentrad-web/fonts/source-han-sans-cn/SourceHanSansCN-Regular.otf",
    ]) {
      expect(security.allows(candidate), candidate).toBe(false);
    }
    expect(security.fonts.SourceHanSansCN).toEqual({
      normal: security.regularUrl,
      italics: security.regularUrl,
      bold: security.boldUrl,
      bolditalics: security.boldUrl,
    });
  });

  it("validates before lazy loading and initializes the singleton before createPdf", async () => {
    await expect(renderPdfBlob({ nodes: [] } as never)).rejects.toThrow();
    expect(pdfmakeMocks.setUrlAccessPolicy).not.toHaveBeenCalled();

    const first = await renderPdfBlob(model());
    const second = await renderPdfBlob(model());

    expect(first.type).toBe(PDF_MIME);
    expect(second.type).toBe(PDF_MIME);
    expect(pdfmakeMocks.setUrlAccessPolicy).toHaveBeenCalledTimes(1);
    expect(pdfmakeMocks.addFonts).toHaveBeenCalledTimes(1);
    expect(pdfmakeMocks.createPdf).toHaveBeenCalledTimes(2);
    expect(pdfmakeMocks.setUrlAccessPolicy.mock.invocationCallOrder[0]).toBeLessThan(
      pdfmakeMocks.addFonts.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(pdfmakeMocks.addFonts.mock.invocationCallOrder[0]).toBeLessThan(
      pdfmakeMocks.createPdf.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("maps engine failures to a finite Chinese error without logging content", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    pdfmakeMocks.getBlob.mockRejectedValueOnce(new Error("secret document body"));

    await expect(renderPdfBlob(model())).rejects.toMatchObject({
      code: "PDF_GENERATION_FAILED",
      message: "PDF 文件生成失败，请检查文档内容后重试",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
