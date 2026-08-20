import { v2 } from "@opentrad/document-core";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { templates } from "../data/templates";
import { TemplatesPage } from "./TemplatesPage";

afterEach(cleanup);

function renderCatalogue(path = "/templates") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TemplatesPage />
    </MemoryRouter>,
  );
}

describe("15-template catalogue", () => {
  it("shows five quotations, five contracts and five bids from unique frozen entries", async () => {
    const user = userEvent.setup();
    renderCatalogue();

    expect(screen.getByText("15 个模板")).toBeInTheDocument();
    expect(templates).toHaveLength(15);
    expect(new Set(templates.map((template) => template.id)).size).toBe(15);
    expect(Object.isFrozen(templates)).toBe(true);
    expect(templates.every(Object.isFrozen)).toBe(true);
    expect(screen.queryByRole("button", { name: /发票/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /装箱单/u })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /合同.*5/u }));
    expect(screen.getAllByRole("link", { name: /使用模板/u })).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: /标书.*5/u }));
    expect(screen.getAllByRole("link", { name: /使用模板/u })).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: /报价单.*5/u }));
    expect(screen.getAllByRole("link", { name: /使用模板/u })).toHaveLength(5);
  });

  it("derives every V2 card from the registry and gives every card a real editor path", () => {
    renderCatalogue();

    expect(templates[0]).toMatchObject({
      id: "quotation.goods.standard.v1",
      editorPath: "/editor/standard-goods-quote",
    });
    expect(templates.slice(1).map(({ id }) => id)).toEqual(
      v2.V2_TEMPLATE_REGISTRY.list().map(({ definition }) => definition.id),
    );

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(15);
    for (const template of templates) {
      const card = cards.find((item) =>
        within(item).queryByRole("heading", { name: template.title }),
      );
      expect(card).toBeDefined();
      expect(
        within(card as HTMLElement).getByRole("link", { name: `使用模板：${template.title}` }),
      ).toHaveAttribute("href", template.editorPath);
      expect(
        within(card as HTMLElement).getByRole("link", { name: `查看详情：${template.title}` }),
      ).toHaveAttribute("href", `/templates/${template.id}`);
    }
    expect(screen.queryByText(/不可用|第二阶段开放编辑/u)).not.toBeInTheDocument();
  });

  it("filters by category, language, title, description and category copy", async () => {
    const user = userEvent.setup();
    renderCatalogue();

    await user.selectOptions(screen.getByRole("combobox", { name: "模板语言" }), "中英双语");
    expect(screen.getByText("3 个模板")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "中英双语出口报价单" })).toBeVisible();

    await user.selectOptions(screen.getByRole("combobox", { name: "模板语言" }), "全部语言");
    const search = screen.getByRole("searchbox", { name: "搜索模板" });
    await user.type(search, "常规商品询报价");
    expect(screen.getByRole("heading", { name: "标准货物报价单" })).toBeVisible();
    expect(screen.getAllByRole("link", { name: /使用模板/u })).toHaveLength(1);

    await user.clear(search);
    await user.type(search, "政府采购服务投标文件");
    expect(screen.getByRole("heading", { name: "政府采购服务投标文件" })).toBeVisible();

    await user.clear(search);
    await user.type(search, "合同");
    expect(screen.getAllByRole("link", { name: /使用模板/u })).toHaveLength(5);

    await user.clear(search);
    await user.click(screen.getByRole("button", { name: /合同.*5/u }));
    await user.selectOptions(screen.getByRole("combobox", { name: "模板语言" }), "中英双语");
    expect(screen.getAllByRole("link", { name: /使用模板/u })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "国际货物销售合同（中英双语）" })).toBeVisible();
  });

  it("announces a useful empty result without removing keyboard-operable controls", async () => {
    const user = userEvent.setup();
    renderCatalogue();

    const search = screen.getByRole("searchbox", { name: "搜索模板" });
    await user.type(search, "不存在的模板关键词");

    const emptyState = screen.getByRole("status");
    expect(emptyState).toHaveAttribute("aria-live", "polite");
    expect(within(emptyState).getByText("没有匹配的模板")).toBeVisible();
    expect(screen.getByText("0 个模板")).toBeVisible();
    expect(search).toBeEnabled();
    expect(screen.getByRole("button", { name: /全部模板.*15/u })).toBeEnabled();
  });

  it("moves through category filters with Tab and activates them with Enter or Space", async () => {
    const user = userEvent.setup();
    renderCatalogue();

    const allButton = screen.getByRole("button", { name: /全部模板.*15/u });
    const quotationButton = screen.getByRole("button", { name: /报价单.*5/u });
    const contractButton = screen.getByRole("button", { name: /合同.*5/u });

    expect(allButton).toHaveAttribute(
      "aria-controls",
      screen.getByRole("region", { name: "模板结果" }).id,
    );
    await user.tab();
    expect(allButton).toHaveFocus();
    await user.tab();
    expect(quotationButton).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(quotationButton).toHaveFocus();
    expect(quotationButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("link", { name: /使用模板/u })).toHaveLength(5);

    await user.tab();
    expect(contractButton).toHaveFocus();
    await user.keyboard(" ");
    expect(contractButton).toHaveFocus();
    expect(contractButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "商务服务合同" })).toBeVisible();
  });

  it("exposes a unique form field manifest for every V2 template", () => {
    for (const registration of v2.V2_TEMPLATE_REGISTRY.list()) {
      expect(registration.definition.fieldManifest.length).toBeGreaterThan(5);
      const paths = registration.definition.fieldManifest.map((field) => field.path);
      expect(new Set(paths).size).toBe(paths.length);
      expect(paths).not.toContain("id");
      expect(paths).not.toContain("templateId");
      expect(paths).not.toContain("templateVersion");
      expect(paths).not.toContain("updatedAt");
    }
  });
});
