import { readFileSync } from "node:fs";
import { compileStandardGoodsQuote, createStandardGoodsQuoteDraft } from "@opentrad/document-core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeDocumentModel } from "../normalizeModel";
import { createEveryBlockModel } from "../testFixtures";
import { DocumentHtml } from "./DocumentHtml";

afterEach(cleanup);

describe("DocumentHtml", () => {
  it("renders all 17 V2 block types with native semantic markup and stable hooks", () => {
    const model = createEveryBlockModel();
    const { container } = render(
      <DocumentHtml model={model} layoutStyleId="international-compact.v1" languageView="zh-en" />,
    );

    const article = screen.getByRole("article", {
      name: "服务报价 / SERVICE QUOTATION",
    });
    expect(article).toHaveAttribute("data-layout-style", "international-compact.v1");
    expect(article).toHaveAttribute("data-profile-label", "国际简洁");
    expect(article).toHaveAttribute("data-language-view", "zh-en");
    expect(article).not.toHaveAttribute("style");
    expect(article.querySelectorAll("[data-block-type]")).toHaveLength(17);
    expect(
      Array.from(article.querySelectorAll<HTMLElement>("[data-block-type]"), (element) =>
        element.getAttribute("data-block-type"),
      ),
    ).toEqual([
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
    ]);
    expect(
      within(article).getByRole("heading", { name: "服务报价 / SERVICE QUOTATION" }),
    ).toBeVisible();
    expect(
      within(article)
        .getAllByRole("definition")
        .some((entry) => entry.textContent === "Q-1"),
    ).toBe(true);
    expect(within(article).getAllByRole("table")).toHaveLength(2);
    const dataTable = within(article).getByRole("table", {
      name: "数据表格 / Data table：table",
    });
    expect(dataTable.querySelector("col")).toHaveAttribute("width", "100%");
    expect(within(dataTable).getByRole("columnheader", { name: "名称 / Name" })).toHaveClass(
      "document-html__align-left",
    );
    expect(within(article).getByText("实质性要求 / Substantial requirement")).toBeVisible();
    expect(within(article).getAllByRole("list").length).toBeGreaterThanOrEqual(1);
    expect(
      within(article).getByRole("navigation", { name: "目录 / Table of contents" }),
    ).toBeVisible();
    expect(within(article).getByRole("complementary", { name: "提示 / Notice" })).toHaveTextContent(
      "Review required",
    );
    expect(
      within(article).getByText(
        "本文件由 OpenTrad 辅助生成，不构成法律、税务或会计意见。 / Generated with OpenTrad. This document is not legal, tax, or accounting advice.",
      ),
    ).toBeVisible();
    expect(container.querySelector("script, iframe, object, embed, img, a")).toBeNull();
    expect(container.querySelector("[src], [href]")).toBeNull();
    expect(container.querySelector("[style]")).toBeNull();
  });

  it("switches between Chinese, English and paired views without changing the model", () => {
    const model = createEveryBlockModel();
    const before = JSON.stringify(model);
    const { rerender } = render(
      <DocumentHtml model={model} layoutStyleId="modern-business.v1" languageView="zh-CN" />,
    );

    expect(screen.getByRole("heading", { name: "服务报价" })).toBeVisible();
    expect(screen.queryByText("SERVICE QUOTATION")).not.toBeInTheDocument();

    rerender(
      <DocumentHtml model={model} layoutStyleId="modern-business.v1" languageView="en-US" />,
    );
    expect(screen.getByRole("heading", { name: "SERVICE QUOTATION" })).toBeVisible();
    expect(screen.queryByText("服务报价")).not.toBeInTheDocument();

    rerender(
      <DocumentHtml model={model} layoutStyleId="modern-business.v1" languageView="zh-en" />,
    );
    expect(screen.getByRole("heading", { name: "服务报价 / SERVICE QUOTATION" })).toBeVisible();
    expect(screen.getByText("服务报价")).toBeVisible();
    expect(screen.getByText("SERVICE QUOTATION")).toBeVisible();
    expect(JSON.stringify(model)).toBe(before);
    expect(Object.isFrozen(model)).toBe(false);
  });

  it("resolves attachment labels locally and exposes accessible table, attachment and signature names", () => {
    const article = render(
      <DocumentHtml
        model={createEveryBlockModel()}
        layoutStyleId="classic-formal.v1"
        languageView="zh-CN"
      />,
    ).getByRole("article", { name: "服务报价" });

    expect(within(article).getByRole("table", { name: "数据表格：table" })).toBeVisible();
    expect(within(article).getByRole("table", { name: "符合性矩阵：matrix" })).toBeVisible();
    expect(within(article).getByRole("region", { name: "附件目录" })).toHaveTextContent(
      "附件一.pdf 已附加",
    );
    expect(
      within(article).getByRole("region", { name: "附件页：附件一.pdf，第 1 页" }),
    ).toHaveTextContent("本地附件占位符");
    expect(within(article).getByRole("region", { name: "签署区" })).toHaveTextContent("示例公司");
    expect(within(article).getByRole("separator", { name: "分页符" })).toBeVisible();
  });

  it("renders a normalized V1 compatibility model and its disclaimer exactly once", () => {
    const source = structuredClone(
      compileStandardGoodsQuote(
        createStandardGoodsQuoteDraft({
          id: "html-v1-compat",
          now: "2026-08-19T00:00:00.000Z",
        }),
      ),
    );
    const heading = source.nodes.find((node) => node.type === "heading");
    const metadata = source.nodes.find((node) => node.type === "metadata");
    if (!heading || heading.type !== "heading" || !metadata || metadata.type !== "metadata") {
      throw new Error("Expected V1 compatibility fixture");
    }
    heading.id = "标题 节点";
    const firstEntry = metadata.entries[0];
    if (!firstEntry) throw new Error("Expected V1 metadata entry");
    firstEntry.value = "";
    const normalized = normalizeDocumentModel(source);

    const sourceRender = render(
      <DocumentHtml model={source} layoutStyleId="classic-formal.v1" languageView="zh-CN" />,
    );
    const sourceHtml = sourceRender.container.innerHTML;
    sourceRender.unmount();
    const normalizedRender = render(
      <DocumentHtml model={normalized} layoutStyleId="classic-formal.v1" languageView="zh-CN" />,
    );
    const article = normalizedRender.getByRole("article", { name: "标准货物报价单" });

    expect(normalizedRender.container.innerHTML).toBe(sourceHtml);
    expect(article.querySelector('[data-block-id="标题 节点"]')).toBeVisible();
    expect(article.querySelector('[data-entry-id="quote-number"] dd')).toHaveTextContent("");
    expect(
      within(article).getAllByText("本文件由 OpenTrad 辅助生成，不构成法律、税务或会计意见。"),
    ).toHaveLength(1);
  });

  it("renders missing and extra V1 cells plus duplicate ids without warnings or inherited reads", () => {
    const source = structuredClone(
      compileStandardGoodsQuote(
        createStandardGoodsQuoteDraft({
          id: "html-irregular-v1",
          now: "2026-08-19T00:00:00.000Z",
        }),
      ),
    );
    const heading = source.nodes.find((node) => node.type === "heading");
    const metadata = source.nodes.find((node) => node.type === "metadata");
    const parties = source.nodes.find((node) => node.type === "parties");
    const table = source.nodes.find((node) => node.type === "table");
    if (
      !heading ||
      heading.type !== "heading" ||
      !metadata ||
      metadata.type !== "metadata" ||
      !parties ||
      parties.type !== "parties" ||
      !table ||
      table.type !== "table"
    ) {
      throw new Error("Expected complete V1 HTML fixture");
    }
    const secondNode = source.nodes[1];
    const firstMetadataEntry = metadata.entries[0];
    const secondMetadataEntry = metadata.entries[1];
    const firstParty = parties.parties[0];
    const secondParty = parties.parties[1];
    const firstColumn = table.columns[0];
    const firstRow = table.rows[0];
    if (
      !secondNode ||
      !firstMetadataEntry ||
      !secondMetadataEntry ||
      !firstParty ||
      !secondParty ||
      !firstColumn ||
      !firstRow
    ) {
      throw new Error("Expected complete V1 HTML entries");
    }
    secondNode.id = heading.id;
    secondMetadataEntry.id = firstMetadataEntry.id;
    secondParty.role = firstParty.role;
    delete firstRow.cells[firstColumn.id];
    firstRow.cells["extra-cell"] = "不应进入可见表格";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const article = render(
        <DocumentHtml model={source} layoutStyleId="classic-formal.v1" languageView="zh-CN" />,
      ).getByRole("article", { name: "标准货物报价单" });
      const dataTable = within(article).getByRole("table", { name: "数据表格：line-items" });
      const firstRenderedRow = within(dataTable).getAllByRole("row")[1];
      if (!firstRenderedRow) throw new Error("Expected rendered V1 table row");
      const firstRenderedCell = within(firstRenderedRow).getAllByRole("cell")[0];

      expect(firstRenderedCell).toHaveTextContent("");
      expect(within(article).queryByText("不应进入可见表格")).not.toBeInTheDocument();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps URL-like hostile values as text and never creates executable or remote elements", () => {
    const model = structuredClone(createEveryBlockModel()) as unknown as {
      sections: Array<{ blocks: Array<Record<string, unknown>> }>;
    };
    const paragraph = model.sections[0]?.blocks.find((block) => block.type === "paragraph");
    if (!paragraph) throw new Error("Expected paragraph fixture");
    paragraph.text = {
      zhCN: 'javascript:alert(1) & "quoted"',
      enUS: "https://evil.example/tracker",
    };

    const { container } = render(
      <DocumentHtml
        model={model as unknown as ReturnType<typeof createEveryBlockModel>}
        layoutStyleId="classic-formal.v1"
        languageView="zh-en"
      />,
    );

    expect(screen.getByText('javascript:alert(1) & "quoted"')).toBeVisible();
    expect(screen.getByText("https://evil.example/tracker")).toBeVisible();
    expect(container.querySelector("script, iframe, object, embed, img, a")).toBeNull();
    expect(container.querySelector("[src], [href]")).toBeNull();
  });

  it("contains no raw HTML injection or URL-bearing render path in its source", () => {
    const source = readFileSync(
      `${process.cwd()}/src/features/documents/render/html/DocumentHtml.tsx`,
      "utf8",
    );
    const styles = readFileSync(
      `${process.cwd()}/src/features/documents/render/html/DocumentHtml.css`,
      "utf8",
    );

    expect(source).not.toContain("dangerouslySetInnerHTML");
    expect(source).not.toMatch(/\b(?:src|href)\s*=/u);
    expect(source).not.toMatch(/(?:data|https?):\/\//u);
    expect(source).not.toMatch(/(?:^|[\s<{])style\s*=/u);
    expect(source).not.toContain("CSSProperties");
    expect(styles).toMatch(
      /\.document-html--classic-formal-v1\s*\{[^}]*--document-accent:\s*#203a35/isu,
    );
    expect(styles).toMatch(
      /\.document-html--modern-business-v1\s*\{[^}]*--document-accent:\s*#285b50/isu,
    );
    expect(styles).toMatch(
      /\.document-html--international-compact-v1\s*\{[^}]*--document-accent:\s*#235b6a/isu,
    );
    expect(styles).toMatch(/\.document-html\s*\{[^}]*color:\s*var\(--document-ink\)/isu);
    expect(styles).toContain(".document-html__align-left");
    expect(styles).toContain(".document-html__align-center");
    expect(styles).toContain(".document-html__align-right");
  });
});
