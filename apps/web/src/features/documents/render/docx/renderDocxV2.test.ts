import { inflateRawSync } from "node:zlib";
import {
  compileStandardGoodsQuote,
  createStandardGoodsQuoteDraft,
  type DocumentBlockV2,
  type DocumentLanguageV2,
  type DocumentModel,
  type DocumentModelV2,
  type LayoutStyleId,
} from "@opentrad/document-core";
import { describe, expect, it, vi } from "vitest";
import { createEveryBlockModel } from "../testFixtures";
import { buildDocxPlanV2, DOCX_V2_MIME, DocxV2GenerationError, renderDocxV2 } from "./renderDocxV2";

const EXPECTED_BLOCK_KINDS = [
  "cover",
  "heading",
  "paragraph",
  "keyValueGrid",
  "parties",
  "table",
  "totals",
  "clauseGroup",
  "list",
  "notice",
  "declaration",
  "toc",
  "complianceMatrix",
  "attachmentIndex",
  "attachmentPage",
  "signatureGroup",
  "pageBreak",
] as const;

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(new Uint8Array(reader.result as ArrayBuffer)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsArrayBuffer(blob);
  });
}

async function unzipDocx(blob: Blob): Promise<ReadonlyMap<string, string>> {
  const bytes = await readBlobBytes(blob);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOfCentralDirectory = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index -= 1) {
    if (readUint32(view, index) === 0x06054b50) {
      endOfCentralDirectory = index;
      break;
    }
  }
  if (endOfCentralDirectory < 0) throw new Error("DOCX ZIP central directory is missing");

  const entryCount = view.getUint16(endOfCentralDirectory + 10, true);
  let centralOffset = readUint32(view, endOfCentralDirectory + 16);
  const decoder = new TextDecoder();
  const entries = new Map<string, string>();
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (readUint32(view, centralOffset) !== 0x02014b50) {
      throw new Error("DOCX ZIP central entry is invalid");
    }
    const compression = view.getUint16(centralOffset + 10, true);
    const compressedSize = readUint32(view, centralOffset + 20);
    const nameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = readUint32(view, centralOffset + 42);
    const name = decoder.decode(
      bytes.subarray(centralOffset + 46, centralOffset + 46 + nameLength),
    );
    if (readUint32(view, localOffset) !== 0x04034b50) {
      throw new Error("DOCX ZIP local entry is invalid");
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    const content =
      compression === 0
        ? compressed
        : compression === 8
          ? inflateRawSync(compressed)
          : (() => {
              throw new Error("DOCX ZIP compression method is unsupported");
            })();
    entries.set(name, decoder.decode(content));
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function rebuildModel(
  model: DocumentModelV2,
  changes: Partial<Omit<DocumentModelV2, "schemaVersion">>,
): DocumentModelV2 {
  return { ...model, ...changes };
}

function threeSectionModel(): DocumentModelV2 {
  const model = createEveryBlockModel();
  const blocks = model.sections[0]?.blocks;
  if (!blocks) throw new Error("Expected every-block section");
  return rebuildModel(model, {
    sections: [
      {
        id: "portrait-start",
        page: { orientation: "portrait" },
        blocks: blocks.slice(0, 5),
      },
      {
        id: "landscape-middle",
        page: { orientation: "landscape" },
        blocks: blocks.slice(5, 13),
      },
      {
        id: "portrait-end",
        page: { orientation: "portrait" },
        blocks: blocks.slice(13),
      },
    ],
  });
}

function replaceBlock(model: DocumentModelV2, replacement: DocumentBlockV2): DocumentModelV2 {
  return rebuildModel(model, {
    sections: model.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => (block.id === replacement.id ? replacement : block)),
    })),
  });
}

function documentXml(entries: ReadonlyMap<string, string>): string {
  const xml = entries.get("word/document.xml");
  if (!xml) throw new Error("word/document.xml is missing");
  return xml;
}

function sectionPageSizes(xml: string): readonly string[] {
  return Array.from(xml.matchAll(/<w:pgSz\b[^>]*>/gu), (match) => match[0]);
}

function relationshipTargets(xml: string): ReadonlyMap<string, string> {
  return new Map(
    Array.from(
      xml.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/>/gu),
      (match) => [match[1] ?? "", match[2] ?? ""] as const,
    ),
  );
}

function headerReferences(xml: string, type: "default" | "first"): readonly string[] {
  return Array.from(
    xml.matchAll(new RegExp(`<w:headerReference\\b[^>]*w:type="${type}"[^>]*r:id="([^"]+)"`, "gu")),
    (match) => match[1] ?? "",
  );
}

describe("DOCX V2", () => {
  it("rejects an invalid model before dynamically importing docx", async () => {
    let engineLoaded = false;
    vi.doMock("docx", () => {
      engineLoaded = true;
      throw new Error("DOCX_ENGINE_MUST_NOT_LOAD");
    });
    try {
      await expect(
        renderDocxV2({ schemaVersion: "9.0.0" } as unknown as DocumentModel),
      ).rejects.toThrow("不支持的文档模型版本");
      expect(engineLoaded).toBe(false);
    } finally {
      vi.doUnmock("docx");
    }
  });

  it("turns engine failures into one finite Chinese error without leaking the cause", async () => {
    vi.doMock("docx", () => {
      throw new Error("SECRET_ENGINE_DETAIL");
    });
    try {
      const failure = await renderDocxV2(createEveryBlockModel()).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(DocxV2GenerationError);
      expect(failure).toMatchObject({
        code: "DOCX_V2_GENERATION_FAILED",
        message: "Word 文件生成失败，请检查文档内容后重试",
      });
      expect(String(failure)).not.toContain("SECRET_ENGINE_DETAIL");
    } finally {
      vi.doUnmock("docx");
    }
  });

  it("plans all 17 blocks, exact A4 sections, footer fields, and immutable input", () => {
    const model = threeSectionModel();
    const before = JSON.stringify(model);
    const plan = buildDocxPlanV2(model, "classic-formal.v1", "zh-en");

    expect(plan.title).toBe("服务报价 / SERVICE QUOTATION");
    expect(plan.languageView).toBe("zh-en");
    expect(plan.profile.id).toBe("classic-formal.v1");
    expect(Object.isFrozen(plan.profile)).toBe(true);
    expect(plan.updateFields).toBe(true);
    expect(plan.footer).toEqual({
      text: "OpenTrad 开源商贸 · 本地生成 / OpenTrad · Generated locally",
      pageNumbers: true,
    });
    expect(plan.blockKinds).toEqual(EXPECTED_BLOCK_KINDS);
    expect(
      plan.sections.map(({ orientation, widthTwips, heightTwips }) => ({
        orientation,
        widthTwips,
        heightTwips,
      })),
    ).toEqual([
      { orientation: "portrait", widthTwips: 11_906, heightTwips: 16_838 },
      { orientation: "landscape", widthTwips: 16_838, heightTwips: 11_906 },
      { orientation: "portrait", widthTwips: 11_906, heightTwips: 16_838 },
    ]);
    expect(plan.sections[0]?.marginsTwips).toEqual({
      top: 1_020,
      right: 907,
      bottom: 1_020,
      left: 907,
    });
    expect(plan.watermarks).toHaveLength(1);
    expect(plan.disclaimers).toHaveLength(1);
    expect(plan.attachmentManifest).toHaveLength(1);
    expect(JSON.stringify(model)).toBe(before);
  });

  it("keeps semantics stable while all three profiles retain distinct presentation values", () => {
    const model = createEveryBlockModel();
    const profileIds: readonly LayoutStyleId[] = [
      "classic-formal.v1",
      "modern-business.v1",
      "international-compact.v1",
    ];
    const plans = profileIds.map((profileId) => buildDocxPlanV2(model, profileId, "zh-en"));

    expect(
      plans.map((plan) => ({
        title: plan.title,
        blockKinds: plan.blockKinds,
        disclaimers: plan.disclaimers,
        attachments: plan.attachmentManifest,
      })),
    ).toEqual(
      plans.map(() => ({
        title: "服务报价 / SERVICE QUOTATION",
        blockKinds: [...EXPECTED_BLOCK_KINDS],
        disclaimers: ["quotation-non-advice"],
        attachments: model.attachmentManifest,
      })),
    );
    expect(new Set(plans.map((plan) => plan.profile.typography.titlePt)).size).toBe(3);
    expect(new Set(plans.map((plan) => plan.profile.colors.accent)).size).toBe(3);
  });

  it("rejects non-exact ordinary and compliance widths during planning", () => {
    const source = createEveryBlockModel();
    const table = source.sections[0]?.blocks.find((block) => block.type === "table");
    const matrix = source.sections[0]?.blocks.find((block) => block.type === "complianceMatrix");
    if (!table || table.type !== "table" || !matrix || matrix.type !== "complianceMatrix") {
      throw new Error("Expected table fixtures");
    }
    const tableColumn = table.columns[0];
    const matrixColumn = matrix.columns[0];
    if (!tableColumn || !matrixColumn) throw new Error("Expected table columns");
    const badTable = replaceBlock(source, {
      ...table,
      columns: [
        { ...tableColumn, id: "first", width: "99.999%" },
        { ...tableColumn, id: "second", width: "0.0009%" },
      ],
      rows: [{ id: "row-1", cells: { first: { zhCN: "一" }, second: { zhCN: "二" } } }],
    });
    const badMatrix = replaceBlock(source, {
      ...matrix,
      columns: [{ ...matrixColumn, width: "99.9999%" }],
    });

    expect(() => buildDocxPlanV2(badTable, "classic-formal.v1", "zh-CN")).toThrow(
      "表格列宽必须为正数且精确合计 100%",
    );
    expect(() => buildDocxPlanV2(badMatrix, "classic-formal.v1", "zh-CN")).toThrow(
      "表格列宽必须为正数且精确合计 100%",
    );
  });

  it("does not emit zero-row or zero-width tables for schema-valid empty collection blocks", async () => {
    const source = createEveryBlockModel();
    const model = rebuildModel(source, {
      sections: [
        {
          id: "empty-collections",
          blocks: [
            { type: "keyValueGrid", id: "empty-grid", entries: [] },
            { type: "parties", id: "empty-parties", parties: [] },
            { type: "totals", id: "empty-totals", entries: [] },
          ],
        },
      ],
      watermarks: [],
      disclaimers: [],
      attachmentManifest: [],
    });
    const entries = await unzipDocx(await renderDocxV2(model, "classic-formal.v1", "zh-CN"));
    const xml = documentXml(entries);

    expect(xml).not.toContain("<w:tbl>");
    expect(xml).not.toContain('<w:tblW w:type="dxa" w:w="0"/>');
    expect(xml).not.toContain("<w:tr/>");
  });

  it.each([
    ["zh-CN", "服务报价", "本文件由 OpenTrad 辅助生成", "SERVICE QUOTATION"],
    ["en-US", "SERVICE QUOTATION", "Generated with OpenTrad", "服务报价"],
    ["zh-en", "服务报价 / SERVICE QUOTATION", "Generated with OpenTrad", "never-matches"],
  ] as const)(
    "renders title and disclaimer for %s",
    async (languageView, expectedTitle, expectedDisclaimer, absentTitle) => {
      const plan = buildDocxPlanV2(
        createEveryBlockModel(),
        "modern-business.v1",
        languageView as DocumentLanguageV2,
      );
      const entries = await unzipDocx(
        await renderDocxV2(
          createEveryBlockModel(),
          "modern-business.v1",
          languageView as DocumentLanguageV2,
        ),
      );
      const xml = documentXml(entries);

      expect(plan.title).toBe(expectedTitle);
      expect(xml).toContain(expectedTitle);
      expect(xml).toContain(expectedDisclaimer);
      expect(xml).not.toContain(absentTitle);
    },
  );

  it("creates a real DOCX with exhaustive block mappings and structural Word fields", async () => {
    const model = createEveryBlockModel();
    const before = JSON.stringify(model);
    const blob = await renderDocxV2(model, "classic-formal.v1", "zh-en");
    const bytes = await readBlobBytes(blob);
    const entries = await unzipDocx(blob);
    const xml = documentXml(entries);
    const footerXml = Array.from(entries)
      .filter(([name]) => /^word\/footer\d+\.xml$/u.test(name))
      .map(([, value]) => value)
      .join("\n");
    const relationships = Array.from(entries)
      .filter(([name]) => name.endsWith(".rels"))
      .map(([, value]) => value)
      .join("\n");

    expect(blob.type).toBe(DOCX_V2_MIME);
    expect(blob.size).toBeGreaterThan(1_000);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    expect(entries.has("word/document.xml")).toBe(true);
    expect(entries.get("word/settings.xml")).toMatch(/<w:updateFields\b/u);
    expect(xml).toContain("服务报价 / SERVICE QUOTATION");
    expect(xml).toMatch(/w:instrText[^>]*>[^<]*TOC/u);
    expect(xml).toMatch(/<w:pStyle w:val="Heading1"\/>/u);
    expect(xml).toMatch(/<w:tblHeader\/>/u);
    expect(xml).toMatch(/<w:cantSplit\/>/u);
    expect(xml).toMatch(/<w:keepNext\/>/u);
    expect(footerXml).toMatch(/PAGE/u);
    expect(footerXml).toMatch(/NUMPAGES/u);
    for (const text of [
      "封面",
      "第一章",
      "正文",
      "编号",
      "示例卖方",
      "服务",
      "CNY 1.00",
      "条款",
      "附件一",
      "请审阅",
      "声明",
      "目录",
      "3.1",
      "附件一.pdf",
      "本地附件占位符",
      "示例公司",
      "本文件由 OpenTrad 辅助生成",
    ]) {
      expect(xml).toContain(text);
    }
    expect(xml).not.toContain("内部底稿");
    expect(relationships).not.toMatch(/TargetMode="External"/u);
    expect(JSON.stringify(model)).toBe(before);
  });

  it("emits portrait, landscape and restored portrait section XML with correct dimensions", async () => {
    const entries = await unzipDocx(
      await renderDocxV2(threeSectionModel(), "classic-formal.v1", "zh-CN"),
    );
    const pageSizes = sectionPageSizes(documentXml(entries));

    expect(pageSizes).toHaveLength(3);
    expect(pageSizes[0]).toMatch(/w:w="11906"[^>]*w:h="16838"[^>]*w:orient="portrait"/u);
    expect(pageSizes[1]).toMatch(/w:w="16838"[^>]*w:h="11906"[^>]*w:orient="landscape"/u);
    expect(pageSizes[2]).toMatch(/w:w="11906"[^>]*w:h="16838"[^>]*w:orient="portrait"/u);
  });

  it("places every-page watermarks in every default header and first-page only once", async () => {
    const source = threeSectionModel();
    const model = rebuildModel(source, {
      watermarks: [
        {
          id: "first-only",
          text: { zhCN: "仅文档首页", enUS: "DOCUMENT FIRST PAGE" },
          scope: "first-page",
        },
        {
          id: "every-page",
          text: { zhCN: "每页水印", enUS: "EVERY PAGE" },
          scope: "every-page",
        },
      ],
    });
    const entries = await unzipDocx(await renderDocxV2(model, "classic-formal.v1", "zh-CN"));
    const xml = documentXml(entries);
    const relationXml = entries.get("word/_rels/document.xml.rels") ?? "";
    const targets = relationshipTargets(relationXml);
    const defaultHeaderIds = headerReferences(xml, "default");
    const firstHeaderIds = headerReferences(xml, "first");
    const headerXml = (relationshipId: string) => {
      const target = targets.get(relationshipId);
      return target ? (entries.get(`word/${target}`) ?? "") : "";
    };

    expect(defaultHeaderIds).toHaveLength(3);
    expect(firstHeaderIds).toHaveLength(1);
    expect(defaultHeaderIds.every((id) => headerXml(id).includes("每页水印"))).toBe(true);
    expect(firstHeaderIds.every((id) => headerXml(id).includes("仅文档首页"))).toBe(true);
    expect(
      Array.from(entries)
        .filter(([name]) => /^word\/header\d+\.xml$/u.test(name))
        .filter(([, value]) => value.includes("仅文档首页")),
    ).toHaveLength(1);
    expect(
      Array.from(entries)
        .filter(([name]) => /^word\/header\d+\.xml$/u.test(name))
        .every(([, value]) => value.includes("wps:wsp")),
    ).toBe(true);
    expect(xml).not.toContain("仅文档首页");
    expect(xml).not.toContain("每页水印");
  });

  it("accepts a V1 model through normalization without changing the V1 renderer", async () => {
    const source = compileStandardGoodsQuote(
      createStandardGoodsQuoteDraft({
        id: "docx-v2-v1-compat",
        now: "2026-08-19T00:00:00.000Z",
      }),
    );
    const before = JSON.stringify(source);
    const plan = buildDocxPlanV2(source, "modern-business.v1", "zh-CN");
    const blob = await renderDocxV2(source, "modern-business.v1", "zh-CN");
    const entries = await unzipDocx(blob);

    expect(plan.title).toBe("标准货物报价单");
    expect(plan.blockKinds).toEqual([
      "heading",
      "keyValueGrid",
      "parties",
      "table",
      "totals",
      "notice",
      "signatureGroup",
    ]);
    expect(documentXml(entries)).toContain("标准货物报价单");
    expect(blob.type).toBe(DOCX_V2_MIME);
    expect(JSON.stringify(source)).toBe(before);
  });
});
