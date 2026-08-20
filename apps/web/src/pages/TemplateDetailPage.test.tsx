import { OFFICIAL_SOURCES } from "@opentrad/document-core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { templates } from "../data/templates";
import { TemplateDetailPage } from "./TemplateDetailPage";

afterEach(cleanup);

function renderDetail(templateId: string) {
  return render(
    <MemoryRouter initialEntries={[`/templates/${templateId}`]}>
      <Routes>
        <Route path="/templates/:templateId" element={<TemplateDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("template detail evidence", () => {
  it("shows exact version, basis date, layout, languages and source descriptors", () => {
    renderDetail("contract.service.commercial.v1");

    expect(screen.getByText("版本 1.0.0")).toBeInTheDocument();
    expect(screen.getByText("依据审阅日期 2026-08-19")).toBeInTheDocument();
    expect(screen.getByText("默认版式 modern-business.v1")).toBeInTheDocument();
    expect(screen.getByText("语言 中文")).toBeInTheDocument();

    const sources = screen.getByRole("list", { name: "参考来源" });
    for (const sourceKey of ["samr-entrustment-2025", "prc-civil-code"] as const) {
      const source = OFFICIAL_SOURCES[sourceKey];
      const link = within(sources).getByRole("link", { name: source.title });
      expect(link).toHaveAttribute("href", source.url);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
      expect(within(sources).getByText(source.authority)).toBeVisible();
    }
    expect(
      screen.getByText(/参考来源不代表来源机构认可本模板，也不构成持续更新或合规保证/u),
    ).toBeVisible();
  });

  it.each([
    ["quotation.goods.standard.v1", "本工具生成报价结构，不构成法律、税务或会计意见。"],
    [
      "contract.service.commercial.v1",
      "本工具生成合同草案，不构成法律意见；签署前应由当事人自行审阅。",
    ],
    [
      "quotation.export.bilingual.v1",
      "本工具不判断 Incoterms、CISG、适用法、税则或语言优先的正确选择。",
    ],
    [
      "bid.government.goods.v1",
      "本工具不保证投标合规或中标；最终内容必须逐项对应招标文件及全部澄清版本。",
    ],
  ])("renders the fixed honest warning for %s", (templateId, warning) => {
    renderDetail(templateId);

    expect(screen.getByRole("heading", { name: "风险提示" })).toBeVisible();
    expect(screen.getByText(warning)).toBeVisible();
    expect(screen.queryByText(/官方模板|保证合规/u)).not.toBeInTheDocument();
  });

  it("uses the exact editor route and returns to the matching category", () => {
    const template = templates.find(({ id }) => id === "contract.service.commercial.v1");
    expect(template).toBeDefined();
    renderDetail(template?.id ?? "");

    expect(screen.getByRole("link", { name: "使用此模板" })).toHaveAttribute(
      "href",
      template?.editorPath,
    );
    expect(screen.getByRole("link", { name: "返回合同模板" })).toHaveAttribute(
      "href",
      "/templates?category=%E5%90%88%E5%90%8C",
    );
    expect(screen.queryByText(/第二阶段开放编辑|尚未实现/u)).not.toBeInTheDocument();
  });

  it("wraps exact metadata and safely breaks long identifiers on narrow screens", () => {
    renderDetail("contract.sale.international-bilingual.v1");

    const layout = screen.getByText("默认版式 international-compact.v1");
    expect(layout.parentElement).toHaveStyle({ flexWrap: "wrap" });
    expect(layout).toHaveStyle({ maxWidth: "100%", overflowWrap: "anywhere" });
  });

  it("returns an unknown id to a real catalogue error state", () => {
    renderDetail("not-a-template");

    expect(screen.getByRole("heading", { name: "模板不存在" })).toBeVisible();
    expect(screen.getByText(/未找到编号为 not-a-template 的模板/u)).toBeVisible();
    expect(screen.getByRole("link", { name: "返回模板中心" })).toHaveAttribute(
      "href",
      "/templates",
    );
  });
});
