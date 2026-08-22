import {
  compileStandardGoodsQuote,
  createStandardGoodsQuoteDraft,
  type DocumentLanguageV2,
  type DocumentModelV2,
  type LayoutStyleId,
} from "@opentrad/document-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEveryBlockModel } from "../testFixtures";
import { buildPdfDefinitionV2 } from "./buildPdfDefinitionV2";
import { PDF_V2_MIME, PdfV2GenerationError, renderPdfV2 } from "./renderPdfV2";

const pdfClientMocks = vi.hoisted(() => ({
  renderPdfDefinition: vi.fn(
    async (_definition: unknown) => new Blob(["%PDF-v2-test"], { type: "application/pdf" }),
  ),
}));

vi.mock("./pdfmakeClient", () => ({
  PDF_MIME: "application/pdf",
  renderPdfDefinition: pdfClientMocks.renderPdfDefinition,
}));

type PdfSection = {
  readonly section: { readonly stack: readonly unknown[] };
  readonly pageOrientation?: "portrait" | "landscape";
  readonly background?: (
    currentPage: number,
    pageSize: { width: number; height: number },
  ) => unknown;
};

const LAYOUTS = [
  "classic-formal.v1",
  "modern-business.v1",
  "international-compact.v1",
] as const satisfies readonly LayoutStyleId[];
const LANGUAGES = ["zh-CN", "en-US", "zh-en"] as const satisfies readonly DocumentLanguageV2[];

function sectionsOf(definition: ReturnType<typeof buildPdfDefinitionV2>): readonly PdfSection[] {
  return definition.content as readonly PdfSection[];
}

function sectionStack(section: PdfSection): readonly unknown[] {
  return section.section.stack;
}

function cloneModel(): DocumentModelV2 {
  return structuredClone(createEveryBlockModel());
}

function threeSectionModel(): DocumentModelV2 {
  const model = cloneModel();
  const blocks = model.sections[0]?.blocks;
  if (!blocks) throw new Error("Expected every-block section");
  return {
    ...model,
    sections: [
      { id: "portrait-a", page: { orientation: "portrait" }, blocks: blocks.slice(0, 6) },
      { id: "landscape", page: { orientation: "landscape" }, blocks: blocks.slice(6, 13) },
      { id: "portrait-b", page: { orientation: "portrait" }, blocks: blocks.slice(13) },
    ],
  };
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function collectTextValues(value: unknown, output: string[] = []): readonly string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectTextValues(item, output);
    return output;
  }
  if (value === null || typeof value !== "object") return output;
  for (const [key, child] of Object.entries(value)) {
    if (key === "text" && typeof child === "string" && child.trim()) output.push(child);
    else collectTextValues(child, output);
  }
  return output;
}

beforeEach(() => {
  pdfClientMocks.renderPdfDefinition.mockClear();
});

describe("buildPdfDefinitionV2", () => {
  it("maps all 17 blocks, puts the title first and disclaimers last, and uses searchable text only", () => {
    const source = createEveryBlockModel();
    const sourceSection = source.sections[0];
    if (!sourceSection) throw new Error("Expected every-block section");
    const model: DocumentModelV2 = {
      ...source,
      sections: [
        {
          ...sourceSection,
          blocks: [
            ...sourceSection.blocks,
            {
              type: "paragraph",
              id: "after-page-break",
              text: { zhCN: "分页后正文", enUS: "Body after page break" },
            },
          ],
        },
      ],
    };
    const definition = buildPdfDefinitionV2(model, "international-compact.v1", "zh-en");
    const sections = sectionsOf(definition);
    const serialized = json(definition);
    const firstStack = sectionStack(sections[0] as PdfSection);
    const lastStack = sectionStack(sections.at(-1) as PdfSection);

    expect(definition.info?.title).toBe("服务报价 / SERVICE QUOTATION");
    expect(definition.defaultStyle?.font).toBe("SourceHanSansCN");
    expect(firstStack[0]).toMatchObject({
      text: "服务报价 / SERVICE QUOTATION",
      style: "documentTitle",
    });
    expect(lastStack.at(-1)).toMatchObject({
      text: expect.stringContaining("Generated with OpenTrad"),
    });
    expect(serialized).toContain('"toc"');
    expect(serialized).toContain('"headerRows":1');
    expect(serialized).toContain('"dontBreakRows":true');
    expect(serialized).toContain('"keepWithHeaderRows":1');
    expect(serialized).toContain('"widths":["15%","20%","65%"]');
    for (const blockId of [
      "cover",
      "heading",
      "paragraph",
      "grid",
      "parties",
      "table",
      "totals",
      "clauses",
      "list",
      "notice",
      "declaration",
      "toc",
      "matrix",
      "attachment-index",
      "attachment-page",
      "signatures",
      "page-break",
    ]) {
      expect(serialized, blockId).toContain(`"id":"${blockId}"`);
    }
    expect(serialized).toContain('"pageBreak":"after"');
    expect(serialized).toContain("分页后正文 / Body after page break");
    expect(serialized).not.toMatch(/"(?:images|files|svg|link)"/u);
    expect(serialized).not.toMatch(/(?:data:|blob:|https?:\/\/|localBlobKey)/u);
    expect(serialized).toContain("附件一.pdf");
    expect(serialized).toContain("Attached");
    expect(serialized).toContain("Local attachment placeholder");
  });

  it("uses root sections for portrait, landscape and portrait without orientation sentinels", () => {
    const definition = buildPdfDefinitionV2(threeSectionModel(), "modern-business.v1", "zh-CN");
    const sections = sectionsOf(definition);

    expect(sections.map((section) => section.pageOrientation)).toEqual([
      "portrait",
      "landscape",
      "portrait",
    ]);
    expect(sections.every((section) => "section" in section)).toBe(true);
    expect(json(sections.map((section) => section.section))).not.toContain("pageOrientation");
    expect(json(sections.map((section) => section.section))).not.toContain("pageBreak");
  });

  it("renders profile paper and scoped staggered watermarks through per-page backgrounds", () => {
    const model: DocumentModelV2 = {
      ...cloneModel(),
      watermarks: [
        {
          id: "first",
          text: { zhCN: "仅首页", enUS: "FIRST PAGE" },
          scope: "first-page",
        },
        {
          id: "every-a",
          text: { zhCN: "每页甲", enUS: "EVERY A" },
          scope: "every-page",
        },
        {
          id: "every-b",
          text: { zhCN: "每页乙", enUS: "EVERY B" },
          scope: "every-page",
        },
      ],
    };
    const definition = buildPdfDefinitionV2(model, "modern-business.v1", "zh-en");
    const background = sectionsOf(definition)[0]?.background;
    if (!background) throw new Error("Expected dynamic background");
    const first = background(1, { width: 595.28, height: 841.89 });
    const second = background(2, { width: 595.28, height: 841.89 });
    const firstJson = json(first);
    const secondJson = json(second);

    expect(definition.watermark).toBeUndefined();
    expect((first as readonly { font?: string }[])[0]?.font).toBe("SourceHanSansCN");
    expect(firstJson).toContain("#FDFBF5");
    expect(firstJson).toContain("仅首页 / FIRST PAGE");
    expect(firstJson).toContain("每页甲 / EVERY A");
    expect(firstJson).toContain("每页乙 / EVERY B");
    expect(secondJson).not.toContain("仅首页 / FIRST PAGE");
    expect(secondJson).toContain("每页甲 / EVERY A");
    expect(secondJson).toContain("每页乙 / EVERY B");
    const positions = (first as readonly { absolutePosition?: { x: number; y: number } }[])
      .map((item) => item.absolutePosition)
      .filter(Boolean);
    expect(new Set(positions.map((position) => `${position?.x}:${position?.y}`)).size).toBe(3);
  });

  it("uses profile-specific styles while preserving semantics for all 3 layouts and languages", () => {
    const model = createEveryBlockModel();
    for (const language of LANGUAGES) {
      const definitions = LAYOUTS.map((layout) => buildPdfDefinitionV2(model, layout, language));
      const searchableText = definitions.map((definition) => json(definition.content));
      for (const text of searchableText) {
        expect(text).toContain(language === "en-US" ? "SERVICE QUOTATION" : "服务报价");
        expect(text).toContain(language === "zh-CN" ? "正文" : "Body");
      }
      expect(
        new Set(definitions.map((definition) => definition.styles?.documentTitle?.color)).size,
      ).toBe(3);
      expect(collectTextValues(definitions[1]?.content)).toEqual(
        collectTextValues(definitions[0]?.content),
      );
      expect(collectTextValues(definitions[2]?.content)).toEqual(
        collectTextValues(definitions[0]?.content),
      );
    }
  });

  it("maps an interior pageBreak but removes a trailing one to avoid a blank final page", () => {
    const source = cloneModel();
    const paragraph = source.sections[0]?.blocks.find((block) => block.type === "paragraph");
    if (!paragraph) throw new Error("Expected paragraph block");
    const model: DocumentModelV2 = {
      ...source,
      sections: [
        {
          id: "page-breaks",
          blocks: [
            { type: "pageBreak", id: "interior-break" },
            paragraph,
            { type: "pageBreak", id: "trailing-break" },
          ],
        },
      ],
    };
    const serialized = json(buildPdfDefinitionV2(model, "classic-formal.v1", "zh-CN").content);

    expect(serialized).toContain('"id":"interior-break"');
    expect(serialized).toContain('"pageBreak":"after"');
    expect(serialized).not.toContain('"id":"trailing-break"');
  });

  it("creates a portrait fallback section for a valid zero-section model", () => {
    const model: DocumentModelV2 = { ...cloneModel(), sections: [] };
    const definition = buildPdfDefinitionV2(model, "classic-formal.v1", "zh-CN");
    const sections = sectionsOf(definition);

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ pageOrientation: "portrait" });
    expect(json(sectionStack(sections[0] as PdfSection))).toContain("服务报价");
    expect(json(sectionStack(sections[0] as PdfSection))).toContain("不构成法律");
  });

  it("normalizes V1 without changing the existing public PDF API", () => {
    const v1 = compileStandardGoodsQuote(
      createStandardGoodsQuoteDraft({ id: "pdf-v1-compat", now: "2026-08-19T00:00:00.000Z" }),
    );
    const definition = buildPdfDefinitionV2(v1, "classic-formal.v1", "zh-CN");

    expect(definition.info?.title).toBe("标准货物报价单");
    expect(json(definition.content)).toContain("本文件由 OpenTrad 辅助生成");
  });
});

describe("renderPdfV2", () => {
  it("validates invalid widths before loading the pdfmake runtime and returns a finite Chinese error", async () => {
    const source = cloneModel();
    const table = source.sections[0]?.blocks.find((block) => block.type === "table");
    if (!table || table.type !== "table") throw new Error("Expected table block");
    const firstColumn = table.columns[0];
    if (!firstColumn) throw new Error("Expected table column");
    const model: DocumentModelV2 = {
      ...source,
      sections: source.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((block) =>
          block.id === table.id && block.type === "table"
            ? {
                ...block,
                columns: [{ ...firstColumn, width: "99%" }, ...block.columns.slice(1)],
              }
            : block,
        ),
      })),
    };

    await expect(renderPdfV2(model)).rejects.toEqual(new PdfV2GenerationError());
    expect(pdfClientMocks.renderPdfDefinition).not.toHaveBeenCalled();
  });

  it("hands a fresh definition to the shared Promise runtime on every call without mutating input", async () => {
    const model = cloneModel();
    const before = JSON.stringify(model);
    const first = await renderPdfV2(model, "modern-business.v1", "zh-en");
    const firstDefinition = pdfClientMocks.renderPdfDefinition.mock.calls[0]?.[0] as
      | { content: unknown }
      | undefined;
    if (!firstDefinition) throw new Error("Expected first PDF definition");
    firstDefinition.content = [];
    const second = await renderPdfV2(model, "modern-business.v1", "zh-en");

    expect(first.type).toBe(PDF_V2_MIME);
    expect(second.type).toBe(PDF_V2_MIME);
    expect(pdfClientMocks.renderPdfDefinition).toHaveBeenCalledTimes(2);
    const secondDefinition = pdfClientMocks.renderPdfDefinition.mock.calls[1]?.[0];
    expect(firstDefinition).not.toBe(secondDefinition);
    expect(json((secondDefinition as { content: unknown }).content)).toContain("服务报价");
    expect(JSON.stringify(model)).toBe(before);
  });

  it("maps runtime failures without logging or exposing document content", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    pdfClientMocks.renderPdfDefinition.mockRejectedValueOnce(new Error("secret 正文 content"));

    await expect(renderPdfV2(createEveryBlockModel())).rejects.toMatchObject({
      code: "PDF_V2_GENERATION_FAILED",
      message: "PDF 文件生成失败，请检查文档内容后重试",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
