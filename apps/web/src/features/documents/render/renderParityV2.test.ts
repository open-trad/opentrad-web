import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import type { DocumentModelV2 } from "@opentrad/document-core";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderDocxV2 } from "./docx/renderDocxV2";
import { DocumentHtml } from "./html/DocumentHtml";
import { renderPdfV2 } from "./pdf/renderPdfV2";
import { createEveryBlockModel } from "./testFixtures";

const FONT_DIR = resolve("public/fonts/source-han-sans-cn");
const BUNDLED_POPPLER =
  "/Users/a1-6/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/poppler/bin";
const RETAINED_ARTIFACT_DIR = mkdtempSync(join(tmpdir(), "opentrad-pdf-v2-parity-"));

const CANONICAL_TOKENS = [
  "服务报价",
  "封面",
  "本地生成",
  "第一章",
  "正文",
  "编号",
  "Q-1",
  "卖方",
  "示例卖方",
  "地址：宁波",
  "联系人：张三",
  "名称",
  "服务",
  "合计",
  "CNY 1.00",
  "条款",
  "1 付款",
  "现付",
  "付款",
  "附件一",
  "请审阅",
  "声明",
  "内容真实",
  "目录",
  "来源条款",
  "要求性质",
  "响应",
  "3.1",
  "实质性要求",
  "满足",
  "附件一.pdf",
  "已附加",
  "第 1 页",
  "本地附件占位符",
  "报价方",
  "示例公司",
  "日期",
  "盖章",
  "本文件由 OpenTrad 辅助生成，不构成法律、税务或会计意见。",
] as const;

function poppler(name: string): string {
  if (process.env.CI) return name;
  const bundled = join(process.env.POPPLER_BIN ?? BUNDLED_POPPLER, name);
  if (!existsSync(bundled)) {
    throw new Error(`Bundled Poppler tool missing: ${bundled}`);
  }
  return bundled;
}

function canonicalTokens(text: string): readonly string[] {
  const normalized = text.normalize("NFC").replace(/\s+/gu, "");
  return CANONICAL_TOKENS.filter((token) =>
    normalized.includes(token.normalize("NFC").replace(/\s+/gu, "")),
  );
}

function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolveRead, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () =>
      resolveRead(new Uint8Array(reader.result as ArrayBuffer)),
    );
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsArrayBuffer(blob);
  });
}

function unzipEntry(bytes: Uint8Array, expectedName: string): Uint8Array {
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const localSignature = 0x04034b50;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (
    let offset = bytes.byteLength - 22;
    offset >= Math.max(0, bytes.byteLength - 65_557);
    offset -= 1
  ) {
    if (view.getUint32(offset, true) === eocdSignature) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("DOCX end record missing");
  const entries = view.getUint16(eocd + 10, true);
  let centralOffset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  for (let index = 0; index < entries; index += 1) {
    if (view.getUint32(centralOffset, true) !== centralSignature) {
      throw new Error("DOCX central directory invalid");
    }
    const compression = view.getUint16(centralOffset + 10, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const nameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    const name = decoder.decode(
      bytes.subarray(centralOffset + 46, centralOffset + 46 + nameLength),
    );
    if (name === expectedName) {
      if (view.getUint32(localOffset, true) !== localSignature) {
        throw new Error("DOCX local entry invalid");
      }
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
      if (compression === 0) return compressed;
      if (compression === 8) return inflateRawSync(compressed);
      throw new Error("Unsupported DOCX compression");
    }
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`DOCX entry missing: ${expectedName}`);
}

function serveFont(requestPath: string): Uint8Array | undefined {
  const fileName = requestPath.split("/").at(-1);
  if (fileName !== "SourceHanSansCN-Regular.otf" && fileName !== "SourceHanSansCN-Bold.otf") {
    return undefined;
  }
  return readFileSync(join(FONT_DIR, fileName));
}

let originalFetch: typeof globalThis.fetch;
beforeAll(() => {
  originalFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.origin !== window.location.origin) {
      throw new Error(`Unexpected cross-origin PDF resource: ${url.origin}`);
    }
    const bytes = serveFont(url.pathname);
    if (!bytes) throw new Error(`Unexpected PDF resource: ${url.pathname}`);
    const responseBytes = new Uint8Array(bytes.byteLength);
    responseBytes.set(bytes);
    return new Response(responseBytes.buffer, {
      status: 200,
      headers: { "Content-Length": String(bytes.byteLength), "Content-Type": "font/otf" },
    });
  });
});

afterAll(() => {
  vi.stubGlobal("fetch", originalFetch);
});

describe("real HTML, DOCX and PDF parity", () => {
  it("extracts the same canonical V2 tokens from the DOM, unpacked Word XML and pdftotext", async () => {
    const model = createEveryBlockModel();
    const html = render(
      createElement(DocumentHtml, {
        model,
        layoutStyleId: "modern-business.v1",
        languageView: "zh-CN",
      }),
    );
    const htmlText = html.container.textContent ?? "";

    const docx = await renderDocxV2(model, "modern-business.v1", "zh-CN");
    const docxBytes = await readBlobBytes(docx);
    const documentXml = new TextDecoder().decode(unzipEntry(docxBytes, "word/document.xml"));
    const docxText = documentXml.replace(/<[^>]+>/gu, " ");

    const pdf = await renderPdfV2(model, "modern-business.v1", "zh-CN");
    const pdfPath = join(RETAINED_ARTIFACT_DIR, "every-block-zh-CN.pdf");
    const textPath = join(RETAINED_ARTIFACT_DIR, "every-block-zh-CN.txt");
    writeFileSync(pdfPath, await readBlobBytes(pdf));
    execFileSync(poppler("pdftotext"), ["-enc", "UTF-8", pdfPath, textPath]);
    const pdfText = readFileSync(textPath, "utf8");

    const htmlTokens = canonicalTokens(htmlText);
    const docxTokens = canonicalTokens(docxText);
    const pdfTokens = canonicalTokens(pdfText);
    expect(htmlTokens).toEqual(CANONICAL_TOKENS);
    expect(docxTokens).toEqual(htmlTokens);
    expect(pdfTokens).toEqual(htmlTokens);
    expect(documentXml).toContain("Source Han Sans CN");
    expect(pdfText).toContain("服务报价");
  }, 30_000);

  it("passes Poppler boxes, embedded-font, searchable-text and raster gates for long mixed-orientation output", async () => {
    const source = createEveryBlockModel();
    const sourceBlocks = source.sections[0]?.blocks;
    const attachedFixture = source.attachmentManifest[0];
    if (!sourceBlocks) throw new Error("Expected every-block fixture section");
    if (!attachedFixture) throw new Error("Expected attached fixture manifest entry");
    const expandedBlocks = sourceBlocks.map((block) => {
      if (block.type === "table") {
        return {
          ...block,
          rows: Array.from({ length: 90 }, (_, index) => ({
            id: `long-row-${index + 1}`,
            cells: {
              name: {
                zhCN: `长表中文行 ${index + 1}`,
                enUS: `Long table English row ${index + 1}`,
              },
            },
          })),
        };
      }
      if (block.type === "attachmentIndex") {
        return {
          ...block,
          attachmentIds: ["attachment-1", "attachment-missing", "attachment-rejected"],
        };
      }
      return block;
    });
    const model: DocumentModelV2 = {
      ...source,
      sections: [
        {
          id: "portrait-before",
          page: { orientation: "portrait" },
          blocks: expandedBlocks.slice(0, 5),
        },
        {
          id: "landscape-table",
          page: { orientation: "landscape" },
          blocks: expandedBlocks.slice(5, 6),
        },
        {
          id: "portrait-after",
          page: { orientation: "portrait" },
          blocks: expandedBlocks.slice(6),
        },
      ],
      watermarks: [
        {
          id: "first-page-watermark",
          text: { zhCN: "仅首页水印", enUS: "FIRST PAGE ONLY" },
          scope: "first-page",
        },
        {
          id: "every-page-watermark",
          text: { zhCN: "每页水印", enUS: "EVERY PAGE" },
          scope: "every-page",
        },
      ],
      attachmentManifest: [
        { ...attachedFixture, localBlobKey: "private-blob-key" },
        {
          id: "attachment-missing",
          category: "qualification",
          displayName: "缺失资质.pdf",
          mediaType: "application/pdf",
          required: true,
          status: "missing",
          includedInSubmission: false,
          localBlobKey: "missing-private-key",
        },
        {
          id: "attachment-rejected",
          category: "technical",
          displayName: "已拒绝附件.pdf",
          mediaType: "application/pdf",
          required: false,
          status: "rejected",
          includedInSubmission: false,
          localBlobKey: "rejected-private-key",
        },
      ],
    };
    const pdf = await renderPdfV2(model, "international-compact.v1", "zh-en");
    const pdfPath = join(RETAINED_ARTIFACT_DIR, "long-mixed-orientation-zh-en.pdf");
    writeFileSync(pdfPath, await readBlobBytes(pdf));

    const info = execFileSync(poppler("pdfinfo"), ["-box", pdfPath], { encoding: "utf8" });
    const pageCount = Number(/^Pages:\s+(\d+)$/mu.exec(info)?.[1]);
    expect(pageCount).toBeGreaterThan(3);
    const pageInfo = execFileSync(
      poppler("pdfinfo"),
      ["-f", "1", "-l", String(pageCount), "-box", pdfPath],
      { encoding: "utf8" },
    );
    const pageSizes = Array.from(
      pageInfo.matchAll(/Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+) pts/gu),
      (match) => ({ page: Number(match[1]), width: Number(match[2]), height: Number(match[3]) }),
    );
    expect(pageSizes).toHaveLength(pageCount);
    expect(pageSizes[0]?.width).toBeLessThan(pageSizes[0]?.height ?? 0);
    expect(pageSizes.some((page) => page.width > page.height)).toBe(true);
    expect(pageSizes.at(-1)?.width).toBeLessThan(pageSizes.at(-1)?.height ?? 0);

    const fonts = execFileSync(poppler("pdffonts"), [pdfPath], { encoding: "utf8" });
    const sourceHanRows = fonts.split("\n").filter((line) => line.includes("SourceHanSansCN"));
    expect(sourceHanRows.length).toBeGreaterThanOrEqual(2);
    expect(sourceHanRows.every((line) => /\byes\s+yes\s+yes\b/u.test(line))).toBe(true);

    const textPath = join(RETAINED_ARTIFACT_DIR, "long-mixed-orientation-zh-en.txt");
    execFileSync(poppler("pdftotext"), ["-enc", "UTF-8", pdfPath, textPath]);
    const extracted = readFileSync(textPath, "utf8");
    expect(extracted).toContain("长表中文行 90");
    expect(extracted).toContain("Long table English row 90");
    expect(extracted).toContain("缺失资质.pdf");
    expect(extracted).toContain("Missing");
    expect(extracted).toContain("Rejected");
    expect(extracted).not.toContain("private-blob-key");
    expect(extracted).not.toContain("missing-private-key");
    expect(extracted).not.toContain("rejected-private-key");

    const firstPageText = execFileSync(
      poppler("pdftotext"),
      ["-f", "1", "-l", "1", "-enc", "UTF-8", pdfPath, "-"],
      { encoding: "utf8" },
    );
    const secondPageText = execFileSync(
      poppler("pdftotext"),
      ["-f", "2", "-l", "2", "-enc", "UTF-8", pdfPath, "-"],
      { encoding: "utf8" },
    );
    expect(firstPageText).toContain("仅首页水印");
    expect(firstPageText).toContain("每页水印");
    expect(secondPageText).not.toContain("仅首页水印");
    expect(secondPageText).toContain("每页水印");
    expect(firstPageText).toContain(`1 / ${pageCount}`);
    expect(extracted).toContain(`${pageCount} / ${pageCount}`);

    const bbox = execFileSync(poppler("pdftotext"), ["-bbox-layout", pdfPath, "-"], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    const bboxDocument = new DOMParser().parseFromString(bbox, "application/xhtml+xml");
    const pages = Array.from(bboxDocument.querySelectorAll("page"));
    expect(pages).toHaveLength(pageCount);
    for (const page of pages) {
      const width = Number(page.getAttribute("width"));
      const height = Number(page.getAttribute("height"));
      for (const word of page.querySelectorAll("word")) {
        const xMin = Number(word.getAttribute("xMin"));
        const yMin = Number(word.getAttribute("yMin"));
        const xMax = Number(word.getAttribute("xMax"));
        const yMax = Number(word.getAttribute("yMax"));
        expect(xMin).toBeGreaterThanOrEqual(0);
        expect(yMin).toBeGreaterThanOrEqual(0);
        expect(xMax).toBeLessThanOrEqual(width + 0.01);
        expect(yMax).toBeLessThanOrEqual(height + 0.01);
        expect(xMax).toBeGreaterThanOrEqual(xMin);
        expect(yMax).toBeGreaterThanOrEqual(yMin);
      }
    }

    const rasterPrefix = join(RETAINED_ARTIFACT_DIR, "long-page");
    execFileSync(poppler("pdftoppm"), ["-png", "-r", "36", pdfPath, rasterPrefix], {
      maxBuffer: 8 * 1024 * 1024,
    });
    const pngs = readdirSync(RETAINED_ARTIFACT_DIR)
      .filter((name) => name.startsWith("long-page-") && name.endsWith(".png"))
      .sort();
    expect(pngs).toHaveLength(pageCount);
    for (const png of pngs) {
      expect(readFileSync(join(RETAINED_ARTIFACT_DIR, png)).subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    }
  }, 30_000);
});
